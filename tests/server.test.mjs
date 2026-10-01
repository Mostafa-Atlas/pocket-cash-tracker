import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server.mjs';
import { Store, WEEK, SESSION_DURATION } from '../lib/store.mjs';

const PIN = '24682468';
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-tests-'));
  const app = createApp({ dataDir: join(directory, 'data'), backupDir: join(directory, 'backups'), pin: PIN, ...options });
  const server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`; let cookie = '';
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.close(); rmSync(directory, { recursive: true, force: true }); });
  async function request(path, body, extraHeaders = {}) {
    const response = await fetch(url + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Pocket-Request': '1', 'X-Pocket-Format': '2' }), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, body: await response.json() };
  }
  async function act(action, input) { const { body: state } = await request('state'); return request('action/' + action, { revision: state.revision, ...input }); }
  return { app, url, directory, request, act, login: () => request('login', { pin: PIN }) };
}
test('authentication requires correct PIN and cookie expires after 24h; lock revokes it', async t => {
  let current = Date.now(); const f = await fixture(t, { now: () => current });
  assert.equal((await f.request('state')).response.status, 401); assert.equal((await f.request('login', { pin: '0000' })).response.status, 401);
  const login = await f.login(); assert.equal(login.response.status, 200); assert.match(login.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await f.request('state')).response.status, 200);
  current += SESSION_DURATION + 1; assert.equal((await f.request('state')).response.status, 401);
  await f.login(); await f.request('logout', {}); assert.equal((await f.request('state')).response.status, 401);
});
test('PIN attempts are rate-limited and recover after cooldown', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now });
  for (let i = 0; i < 5; i++) assert.equal((await f.request('login', { pin: '0000' })).response.status, 401);
  assert.equal((await f.login()).response.status, 429); now += 900_001; assert.equal((await f.login()).response.status, 200);
});
test('HTTP transactions persist and stale simultaneous edits are blocked', async t => {
  const f = await fixture(t); await f.login(); await f.act('opening', { amount: '100' });
  const { body: state } = await f.request('state');
  const results = await Promise.all([f.request('action/expense', { revision: state.revision, amount: '80', categoryId: 'food' }), f.request('action/expense', { revision: state.revision, amount: '80', categoryId: 'transport' })]);
  assert.deepEqual(results.map(r => r.response.status).sort(), [200, 409]);
  assert.equal((await f.request('state')).body.balance, 20000);
  assert.equal((await f.act('expense', { amount: '21', categoryId: 'food' })).response.status, 400);
  assert.equal((await f.request('state')).body.balance, 20000);
  const other = new Store(join(f.directory, 'data'), join(f.directory, 'backups')); assert.equal(other.state().transactions.length, 2); other.close();
});
test('save receipts are private, replay requests exactly once, and old browser formats cannot save', async t => {
  const f = await fixture(t); await f.login(); await f.act('opening', { amount: '100' });
  const input = { revision: 1, amount: '2', categoryId: 'food', requestId: 'http-save-receipt-00001' };
  assert.equal((await f.request('action/expense', input, { 'X-Pocket-Format': '' })).response.status, 409);
  assert.equal((await f.request('action/expense', input)).response.status, 200);
  assert.equal((await f.request('action/expense', input)).response.status, 200);
  assert.equal((await f.request('history')).body.rows.filter(t => t.type === 'expense').length, 1);
  assert.equal((await f.request('request-status?id=' + input.requestId)).body.result.balance, 98000);
  assert.equal((await f.request('request-status?id=bad')).response.status, 400);
  await f.request('logout', {});
  assert.equal((await f.request('request-status?id=' + input.requestId)).response.status, 401);
});
test('origin checks, custom request header, host checks, private routes, and CSP', async t => {
  const f = await fixture(t); await f.login();
  assert.equal((await f.request('action/opening', { revision: 0, amount: '100' }, { Origin: 'https://evil.example' })).response.status, 403);
  assert.equal((await f.request('login', { pin: PIN }, { 'X-Pocket-Request': '' })).response.status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => { http.get(f.url + '/api/session', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); }); assert.equal(wrongHostStatus, 403);
  for (const path of ['/data/pocket.sqlite', '/backups/', '/instructions.md', '/server.mjs']) assert.equal((await fetch(f.url + path)).status, 404);
  const page = await fetch(f.url); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('manual download excludes credentials; restore saves recovery copy and restores exact ledger', async t => {
  const f = await fixture(t); await f.login(); await f.act('opening', { amount: '123.45' });
  const created = await f.request('backup', {}); assert.equal(created.response.status, 200);
  const { body: backup } = await f.request('backup/download?name=' + encodeURIComponent(created.body.name));
  assert.equal(JSON.stringify(backup).includes(PIN), false); assert.equal('auth' in backup.data, false); assert.equal('sessions' in backup.data, false);
  await f.act('expense', { amount: '10', categoryId: 'food' });
  const { body: before } = await f.request('state');
  assert.equal((await f.request('restore', { revision: before.revision, backup, confirmation: 'WRONG' })).response.status, 400);
  assert.equal((await f.request('restore', { revision: before.revision, backup, confirmation: 'RESTORE' })).response.status, 200);
  assert.equal((await f.request('state')).body.balance, 123450);
  assert.ok((await f.request('backups')).body.items.some(b => b.kind === 'before-restore'));
  assert.equal((await f.request('backup/download?name=..%2Fdata%2Fpocket.sqlite')).response.status, 400);
});
test('damaged, tampered, invalid, and stale backup restores leave ledger unchanged', async t => {
  const f = await fixture(t); await f.login(); await f.act('opening', { amount: '100' });
  const { backup } = f.app.store.backup(); const revision = f.app.store.state().revision;
  const tampered = structuredClone(backup); tampered.data.transactions[0].amount = 20000;
  assert.equal((await f.request('restore', { backup: tampered, revision, confirmation: 'RESTORE' })).response.status, 400);
  const invalid = structuredClone(backup); invalid.data.transactions[0].amount = -100;
  invalid.checksum = createHash('sha256').update(JSON.stringify(invalid.data)).digest('hex');
  assert.equal((await f.request('restore', { backup: invalid, revision, confirmation: 'RESTORE' })).response.status, 400);
  assert.equal((await f.request('restore', { backup, revision: 0, confirmation: 'RESTORE' })).response.status, 409);
  assert.equal((await f.request('state')).body.balance, 100000);
});
test('automatic backups catch up after downtime and retain eight weekly files plus manual files', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-backup-tests-')); let now = Date.now();
  const store = new Store(join(directory, 'data'), join(directory, 'backups'), { pin: PIN, now: () => now });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.weekly(); const manual = store.backup('manual'); assert.equal(store.weekly(), null);
  for (let i = 0; i < 10; i++) { now += WEEK; store.weekly(); }
  assert.equal(store.backups().filter(b => b.kind === 'weekly').length, 8); assert.equal(store.backups().filter(b => b.kind === 'manual').length, 1);
  assert.equal(existsSync(join(directory, 'backups', manual.name)), true);
  now += WEEK * 3; store.weekly(); assert.equal(store.backups().filter(b => b.kind === 'weekly').length, 8); assert.equal(store.get('lastWeekly'), now);
});
test('restoration and restart preserve the configured PIN while PIN recovery invalidates sessions', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-persistence-tests-'));
  let store = new Store(join(directory, 'data'), join(directory, 'backups'), { pin: PIN });
  store.update('opening', { revision: 0, amount: '50' }); const session = store.session(); store.close();
  store = new Store(join(directory, 'data'), join(directory, 'backups'));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(store.checkPin(PIN), true); assert.equal(store.authenticated(session.token), true); assert.equal(store.state().transactions[0].amount, 50000);
  store.setPin('12345678'); assert.equal(store.authenticated(session.token), false); assert.equal(store.checkPin(PIN), false); assert.equal(store.checkPin('12345678'), true);
});
