import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, renameSync, readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { initialState, validateState, upgradeState, mutate, fail, balance } from './ledger.mjs';

export const WEEK = 7 * 24 * 60 * 60 * 1000;
export const SESSION_DURATION = 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(directory, backupDirectory, { pin, now = () => Date.now(), secondaryBackupDir } = {}) {
    this.directory = directory; this.backupDirectory = backupDirectory; this.now = now;
    this.secondaryBackupDir = secondaryBackupDir ? resolve(secondaryBackupDir) : null;
    fail(!this.secondaryBackupDir || resolve(directory) !== this.secondaryBackupDir && resolve(backupDirectory) !== this.secondaryBackupDir, 'Use a separate folder for secondary backups.');
    mkdirSync(directory, { recursive: true }); mkdirSync(backupDirectory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'pocket.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);');
    if (!this.get('state')) this.set('state', initialState());
    if (!this.get('auth') && pin) this.setPin(pin);
    this.authReady = Boolean(this.get('auth'));
    const original = this.state();
    if (original.schema === 1) {
      const upgraded = upgradeState(original);
      this.backup('before-upgrade'); // Exact original units, recoverable by the previous release.
      this.set('state', upgraded);
    }
    validateState(this.state());
  }
  get(key) { const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.db.prepare('INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  state() { return this.get('state'); }
  setPin(pin) {
    fail(typeof pin === 'string' && /^\d{4,12}$/.test(pin), 'PIN must contain 4–12 digits.');
    const salt = randomBytes(24).toString('hex');
    this.set('auth', { salt, hash: scryptSync(pin, salt, 64).toString('hex') });
    this.db.exec('DELETE FROM sessions'); this.authReady = true;
  }
  checkPin(pin) {
    const auth = this.get('auth');
    if (!auth || typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) return false;
    return timingSafeEqual(scryptSync(pin, auth.salt, 64), Buffer.from(auth.hash, 'hex'));
  }
  session() {
    const token = randomBytes(32).toString('hex'), expires = this.now() + SESSION_DURATION;
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(this.now());
    this.db.prepare('INSERT INTO sessions (token,expires) VALUES (?,?)').run(digest(token), expires);
    return { token, expires };
  }
  authenticated(token) { return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && Boolean(this.db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(digest(token), this.now())); }
  logout(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token)); }
  requestKey(action, input) { return digest(JSON.stringify({ action, input })); }
  receipt(id) {
    fail(typeof id === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(id), 'Invalid save identifier.');
    const row = this.db.prepare('SELECT result FROM requests WHERE id=?').get(id);
    return row ? JSON.parse(row.result) : null;
  }
  replay(action, input) {
    if (!input.requestId) return null;
    this.receipt(input.requestId);
    const row = this.db.prepare('SELECT fingerprint,result FROM requests WHERE id=?').get(input.requestId);
    if (!row) return null;
    fail(row.fingerprint === this.requestKey(action, input), 'This save identifier was already used for a different change.', 409);
    return { ...JSON.parse(row.result), replayed: true };
  }
  remember(action, input, state) {
    if (input.requestId) this.db.prepare('INSERT INTO requests(id,fingerprint,result) VALUES (?,?,?)').run(input.requestId, this.requestKey(action, input), JSON.stringify({ revision: state.revision, balance: balance(state) }));
  }
  update(action, input) {
    fail(input && typeof input === 'object' && !Array.isArray(input), 'Invalid request.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const replay = this.replay(action, input);
      if (replay) { this.db.exec('COMMIT'); return replay; }
      const state = mutate(this.state(), action, input, new Date(this.now()).toISOString()); this.set('state', state);
      this.remember(action, input, state); this.db.exec('COMMIT'); return state;
    }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  backup(kind = 'manual') {
    fail(['manual', 'weekly', 'before-restore', 'before-upgrade'].includes(kind), 'Invalid backup type.');
    const data = this.state(), createdAt = new Date(this.now()).toISOString();
    const backup = { app: 'Pocket', format: 1, createdAt, checksum: digest(JSON.stringify(data)), data };
    const name = `${kind}-${createdAt.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`;
    const dest = join(this.backupDirectory, name);
    writeFileSync(dest + '.tmp', JSON.stringify(backup, null, 2), { flag: 'wx' }); renameSync(dest + '.tmp', dest);
    this.checkedBackup(dest);
    this.mirror(name);
    if (kind === 'weekly') {
      this.set('lastWeekly', this.now());
      const weekly = this.backups().filter(b => b.kind === 'weekly');
      for (const extra of weekly.slice(8)) unlinkSync(join(this.backupDirectory, extra.name));
    }
    return { name, backup };
  }
  weekly() {
    this.syncSecondary();
    const last = this.get('lastWeekly');
    if (last === null || this.now() - last >= WEEK) return this.backup('weekly');
    return null;
  }
  backups() {
    return readdirSync(this.backupDirectory).filter(name => /^(manual|weekly|before-restore|before-upgrade)-[\w-]+\.json$/.test(name)).sort().reverse().map(name => ({ name, kind: name.startsWith('before-') ? name.startsWith('before-restore') ? 'before-restore' : 'before-upgrade' : name.split('-')[0], createdAt: this.backupDate(name) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  backupDate(name) {
    const match = name.match(/(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/);
    return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : '';
  }
  readBackup(name) {
    fail(typeof name === 'string' && /^(manual|weekly|before-restore|before-upgrade)-[\w-]+\.json$/.test(name), 'Invalid backup name.');
    const path = join(this.backupDirectory, name); fail(existsSync(path), 'Backup not found.', 404);
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  checkedBackup(path) {
    const snapshot = JSON.parse(readFileSync(path, 'utf8'));
    fail(snapshot.app === 'Pocket' && snapshot.format === 1 && snapshot.data && digest(JSON.stringify(snapshot.data)) === snapshot.checksum, 'Backup checksum validation failed.');
    upgradeState(snapshot.data); return snapshot;
  }
  mirror(name) {
    if (!this.secondaryBackupDir) return;
    try {
      const source = join(this.backupDirectory, name); const snapshot = this.checkedBackup(source);
      mkdirSync(this.secondaryBackupDir, { recursive: true });
      const dest = join(this.secondaryBackupDir, name);
      writeFileSync(dest + '.tmp', JSON.stringify(snapshot, null, 2)); renameSync(dest + '.tmp', dest);
      this.checkedBackup(dest);
      const weekly = readdirSync(this.secondaryBackupDir).filter(n => /^weekly-[\w-]+\.json$/.test(n)).sort().reverse();
      for (const old of weekly.slice(8)) unlinkSync(join(this.secondaryBackupDir, old));
      this.set('secondaryStatus', { lastCopied: snapshot.createdAt, name, error: null });
    } catch {
      this.set('secondaryStatus', { ...this.get('secondaryStatus'), error: 'Secondary backup unavailable. Check the configured drive or network folder. Local backups still work.' });
    }
  }
  syncSecondary() {
    if (!this.secondaryBackupDir) return;
    const newest = this.backups()[0];
    const status = this.get('secondaryStatus');
    let damaged = false;
    if (newest && status?.name === newest.name) { try { this.checkedBackup(join(this.secondaryBackupDir, newest.name)); } catch { damaged = true; } }
    if (newest && (damaged || status?.error || status?.name !== newest.name)) this.mirror(newest.name);
  }
  restore(backup, revision, requestId) {
    const input = { backup, revision, ...(requestId ? { requestId } : {}) };
    const replay = this.replay('restore', input); if (replay) return replay;
    fail(backup && backup.app === 'Pocket' && backup.format === 1 && backup.data && digest(JSON.stringify(backup.data)) === backup.checksum, 'This is not a valid Pocket backup, or the file is damaged.');
    const restored = upgradeState(backup.data);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const committed = this.replay('restore', input);
      if (committed) { this.db.exec('COMMIT'); return committed; }
      fail(revision === this.state().revision, 'Data changed. Refresh before restoring.', 409);
      this.backup('before-restore'); restored.revision = revision + 1;
      this.set('state', restored); this.remember('restore', input, restored); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return restored;
  }
  backupStatus() {
    const last = this.get('lastWeekly'), items = this.backups(); let health = 'No backup yet.';
    if (items[0]) { try { this.checkedBackup(join(this.backupDirectory, items[0].name)); health = 'Latest local backup verified.'; } catch { health = 'Latest local backup failed validation. Create a new backup.'; } }
    let secondary = { configured: Boolean(this.secondaryBackupDir), ...this.get('secondaryStatus') };
    if (secondary.configured && secondary.name) { try { this.checkedBackup(join(this.secondaryBackupDir, secondary.name)); } catch { secondary.error = 'Secondary backup is missing or damaged. Check the destination and create a new backup.'; } }
    return { lastWeekly: last ? new Date(last).toISOString() : null, nextWeekly: last ? new Date(last + WEEK).toISOString() : null, items, health, secondary, error: this.backupError || null };
  }
  close() { this.db.close(); }
}
