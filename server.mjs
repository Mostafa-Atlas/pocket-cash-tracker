import http from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { Store, SESSION_DURATION } from './lib/store.mjs';
import { UserError, fail, balance, analytics, history, dateKey, monthlyBudgets, validDate } from './lib/ledger.mjs';
import { historyCsv } from './lib/export.mjs';
import { transactionTime } from './public/domain.js';

const root = dirname(fileURLToPath(import.meta.url));
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/domain.js', ['domain.js', 'text/javascript; charset=utf-8']],
  ['/connection.js', ['connection.js', 'text/javascript; charset=utf-8']],
  ['/theme.js', ['theme.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']]
]);
const contentPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

async function readBody(req, limit = 12_000) {
  fail(req.headers['content-type']?.split(';')[0] === 'application/json', 'Use a JSON request.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; fail(size <= limit, 'Request is too large.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UserError('Invalid JSON request.'); }
}
function cookie(req) { return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('pocket_session='))?.slice(15) || ''; }
export function createApp({ dataDir = join(root, 'data'), backupDir = join(root, 'backups'), secondaryBackupDir, pin, now, allowedHosts = ['localhost', '127.0.0.1'], autoBackup = true } = {}) {
  const store = new Store(dataDir, backupDir, { pin, now, secondaryBackupDir });
  const clock = now || (() => Date.now());
  const attempts = new Map();
  const runBackup = () => { try { store.weekly(); store.backupError = null; } catch (error) { store.backupError = 'Automatic backup failed. Check free disk space and folder permissions.'; console.error(store.backupError, error.code || ''); } };
  if (autoBackup) runBackup();
  const timer = autoBackup ? setInterval(runBackup, 60_000) : null; timer?.unref();
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', contentPolicy); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      fail(allowedHosts.includes(url.hostname) && req.url.startsWith('/') && !req.url.startsWith('//'), 'Host is not allowed.', 403);
      if (req.headers.origin) fail(new URL(req.headers.origin).host === req.headers.host, 'Cross-origin request rejected.', 403);
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [name, contentType] = staticFiles.get(url.pathname); res.writeHead(200, { 'Content-Type': contentType }); res.end(readFileSync(join(root, 'public', name))); return;
      }
      fail(url.pathname.startsWith('/api/'), 'Page not found.', 404);
      fail(['GET', 'POST'].includes(req.method), 'Method not allowed.', 405);
      if (req.method === 'POST') fail(req.headers['x-pocket-request'] === '1', 'Invalid request source.', 403);
      if (url.pathname === '/api/session' && req.method === 'GET') { json(200, { authenticated: store.authenticated(cookie(req)), configured: store.authReady }); return; }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        fail(store.authReady, 'Set a PIN on the PC before opening Pocket.', 503);
        const address = req.socket.remoteAddress || 'local', current = clock();
        for (const [key, value] of attempts) if (current >= value.until) attempts.delete(key);
        const local = attempts.get(address), global = attempts.get('*');
        fail(!(local?.count >= 5 || global?.count >= 30), 'Too many attempts. Please try again in 15 minutes.', 429);
        const body = await readBody(req);
        if (!store.checkPin(body?.pin)) {
          for (const key of [address, '*']) { const a = attempts.get(key) || { count: 0, until: current + 900_000 }; a.count++; attempts.set(key, a); }
          throw new UserError('Incorrect PIN. Please try again.', 401);
        }
        attempts.delete(address);
        const session = store.session();
        res.setHeader('Set-Cookie', `pocket_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}`);
        json(200, { authenticated: true, expiresAt: new Date(session.expires).toISOString() }); return;
      }
      fail(store.authenticated(cookie(req)), 'Your session is locked. Enter your PIN to continue.', 401);
      if (req.method === 'POST' && (url.pathname.startsWith('/api/action/') || url.pathname === '/api/restore')) fail(req.headers['x-pocket-format'] === '2', 'Refresh Pocket to load the current money format before saving.', 409);
      if (url.pathname === '/api/logout' && req.method === 'POST') { store.logout(cookie(req)); res.setHeader('Set-Cookie', 'pocket_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); json(200, { ok: true }); return; }
      const filters = Object.fromEntries(url.searchParams);
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const state = store.state(); json(200, { revision: state.revision, initialized: state.initialized, currency: state.currency || 'EGP', balance: balance(state), categories: state.categories, subjects: state.subjects, budgets: state.budgets || { overall: null, categories: {} }, openingDate: state.transactions[0] ? dateKey(transactionTime(state.transactions[0]), state.timezone || 'Africa/Cairo') : null, today: dateKey(new Date(clock()).toISOString(), state.timezone || 'Africa/Cairo'), timezone: state.timezone || 'Africa/Cairo' }); return;
      }
      if (url.pathname === '/api/analytics' && req.method === 'GET') { const s = store.state(); json(200, analytics(s, filters, new Date(clock()).toISOString(), s.timezone || 'Africa/Cairo')); return; }
      if (url.pathname === '/api/history' && req.method === 'GET') { const s = store.state(); json(200, history(s, filters, s.timezone || 'Africa/Cairo')); return; }
      if (url.pathname === '/api/budgets' && req.method === 'GET') { json(200, monthlyBudgets(store.state(), new Date(clock()).toISOString())); return; }
      if (url.pathname === '/api/history/export' && req.method === 'GET') {
        fail(!filters.from || validDate(filters.from), 'Choose a valid start date.');
        fail(!filters.to || validDate(filters.to), 'Choose a valid end date.');
        fail(!filters.from || !filters.to || filters.from <= filters.to, 'Start date must be before the end date.');
        const s = store.state(), csv = historyCsv(s, filters);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pocket-history-${dateKey(new Date(clock()).toISOString(), s.timezone || 'Africa/Cairo')}.csv"` });
        res.end(csv); return;
      }
      if (url.pathname === '/api/backups' && req.method === 'GET') { json(200, store.backupStatus()); return; }
      if (url.pathname === '/api/request-status' && req.method === 'GET') { json(200, { result: store.receipt(filters.id) }); return; }
      if (url.pathname === '/api/backup/download' && req.method === 'GET') {
        const backup = store.readBackup(filters.name); res.setHeader('Content-Disposition', `attachment; filename="${filters.name}"`); json(200, backup); return;
      }
      if (url.pathname === '/api/backup' && req.method === 'POST') { const { name } = store.backup(); json(200, { name }); return; }
      if (url.pathname === '/api/restore' && req.method === 'POST') {
        const input = await readBody(req, 20_000_000);
        fail(input?.confirmation === 'RESTORE', 'Type RESTORE to confirm replacing the ledger.');
        const backup = input.name ? store.readBackup(input.name) : input.backup;
        const state = store.restore(backup, input.revision, input.requestId); json(200, { revision: state.revision, balance: state.replayed ? state.balance : balance(state) }); return;
      }
      if (url.pathname.startsWith('/api/action/') && req.method === 'POST') {
        const input = await readBody(req); const state = store.update(url.pathname.slice('/api/action/'.length), input);
        json(200, { revision: state.revision, balance: state.replayed ? state.balance : balance(state) }); return;
      }
      throw new UserError('Endpoint not found.', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!(error instanceof UserError)) console.error('Request failed:', error.message);
      json(error.status || 500, { error: error.status ? error.message : 'Something went wrong. Your change was not confirmed. Refresh before trying again.' });
    }
  };
  return { handler, store, close: () => { if (timer) clearInterval(timer); store.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4310);
  const tailscale = Object.entries(networkInterfaces()).filter(([name]) => /tailscale/i.test(name)).flatMap(([, entries]) => entries).find(i => i.family === 'IPv4')?.address;
  const hosts = process.env.POCKET_HOST ? [process.env.POCKET_HOST] : ['127.0.0.1', ...(tailscale ? [tailscale] : [])];
  const app = createApp({ dataDir: process.env.POCKET_DATA_DIR || join(root, 'data'), backupDir: process.env.POCKET_BACKUP_DIR || join(root, 'backups'), secondaryBackupDir: process.env.POCKET_SECONDARY_BACKUP_DIR, allowedHosts: [...new Set(['localhost', ...hosts])] });
  if (!app.store.authReady) { console.error('Set your PIN first: npm run set-pin (see README.md).'); app.close(); process.exit(1); }
  const servers = hosts.map(host => {
    const server = http.createServer(app.handler); server.requestTimeout = 30_000; server.headersTimeout = 15_000;
    server.on('error', error => { console.error(`Could not listen on ${host}:${port}: ${error.message}`); if (host === hosts[0]) process.exitCode = 1; });
    server.listen(port, host, () => console.log(`Pocket is ready at http://${host}:${port}`)); return server;
  });
  const stop = () => { for (const server of servers) server.close(); app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
