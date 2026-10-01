import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { initialState, mutate, money, balance, analytics, history, upgradeState, dateKey } from '../lib/ledger.mjs';
import { formatAmount, calendarLabel, transactionTime } from '../public/domain.js';
import { createRequestClient } from '../public/connection.js';
import { Store, WEEK } from '../lib/store.mjs';

const now = '2026-10-01T12:00:00.000Z';
function ledger(currency = 'EGP', timezone = 'Africa/Cairo') {
  let state = mutate(initialState(), 'opening', { revision: 0, amount: '100', date: '2026-09-01', currency, timezone }, now);
  return { get state() { return state; }, act(action, input) { state = mutate(state, action, { revision: state.revision, ...input }, now); return state; } };
}
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pocket-improvements-'));
  let store = new Store(join(root, 'data'), join(root, 'backups'), { pin: '24682468', ...options });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, get store() { return store; }, restart() { store.close(); store = new Store(join(root, 'data'), join(root, 'backups'), options); } };
}
test('currency precision accepts exact dinar thousandths and whole yen, preserving integer math', () => {
  assert.equal(money('1.001', false, 'KWD'), 1001);
  for (const code of ['KWD', 'BHD', 'JOD', 'TND', 'LYD']) assert.equal(money('0.001', false, code), 1);
  assert.throws(() => money('1.001', false, 'EGP'));
  assert.throws(() => money('1.01', false, 'JPY'));
  assert.equal(formatAmount(1001, 'KWD'), '1.001'); assert.equal(formatAmount(1000, 'JPY'), '1');
  const l = ledger('KWD'); for (let i = 0; i < 100; i++) l.act('expense', { amount: '0.001', categoryId: 'food' });
  assert.equal(balance(l.state), 99900);
  assert.throws(() => l.act('currency', { currency: 'EGP' }), /decimal places/);
});
test('legacy upgrade and restore preserve cents, including fractional legacy yen', t => {
  const f = fixture(t); const legacy = ledger().state; legacy.schema = 1;
  legacy.currency = 'JPY'; legacy.transactions[0].amount = 12345;
  const upgraded = upgradeState(legacy);
  assert.equal(upgraded.transactions[0].amount, 123450); assert.equal(legacy.transactions[0].amount, 12345);
  assert.equal(formatAmount(balance(upgraded), 'JPY'), '123.45');
  const backup = { app: 'Pocket', format: 1, data: legacy, checksum: createHash('sha256').update(JSON.stringify(legacy)).digest('hex') };
  f.store.restore(backup, 0); assert.equal(balance(f.store.state()), 123450);
  f.restart(); assert.equal(balance(f.store.state()), 123450);
});
test('startup migration saves the untouched schema-1 recovery snapshot and keeps PIN/sessions', t => {
  const f = fixture(t); const session = f.store.session(); const legacy = ledger().state;
  legacy.schema = 1; legacy.transactions[0].amount = 10000; f.store.set('state', legacy);
  f.restart(); assert.equal(f.store.state().schema, 2); assert.equal(balance(f.store.state()), 100000);
  assert.ok(f.store.checkPin('24682468')); assert.ok(f.store.authenticated(session.token));
  const recovery = f.store.readBackup(f.store.backups().find(b => b.kind === 'before-upgrade').name);
  assert.equal(recovery.data.schema, 1); assert.equal(recovery.data.transactions[0].amount, 10000);
});
test('backdated entries and date edits affect history/analysis while preserving recording timestamps', () => {
  const l = ledger(); l.act('expense', { amount: '10', categoryId: 'food', date: '2026-09-29' });
  const entry = l.state.transactions[1]; assert.equal(entry.createdAt, now); assert.equal(dateKey(transactionTime(entry)), '2026-09-29');
  assert.equal(history(l.state, { from: '2026-09-29', to: '2026-09-29' }).total, 1);
  assert.equal(analytics(l.state, { period: 'today' }, now).spent, 0);
  l.act('edit', { id: entry.id, amount: '10', categoryId: 'food', date: '2026-09-30' });
  assert.equal(l.state.transactions[1].createdAt, now);
  assert.equal(dateKey(transactionTime(l.state.transactions[1])), '2026-09-30');
});
test('backdates enforce opening cash, historical solvency, future dates and refund order', () => {
  const l = ledger(); l.act('income', { amount: '100', date: '2026-09-20' });
  assert.throws(() => l.act('expense', { amount: '110', categoryId: 'food', date: '2026-09-19' }), /negative/);
  assert.throws(() => l.act('expense', { amount: '1', categoryId: 'food', date: '2026-08-31' }), /opening balance/);
  assert.throws(() => l.act('expense', { amount: '1', categoryId: 'food', date: '2026-10-02' }), /no later/);
  l.act('expense', { amount: '10', categoryId: 'food', date: '2026-09-22' });
  const expense = l.state.transactions.find(t => t.type === 'expense');
  assert.throws(() => l.act('refund', { amount: '1', expenseId: expense.id, date: '2026-09-21' }), /follow/);
  assert.throws(() => l.act('opening-date', { date: '2026-09-23' }), /opening balance/);
  l.act('opening-date', { date: '2026-08-01' }); assert.equal(dateKey(transactionTime(l.state.transactions[0])), '2026-08-01');
});
test('calendar labels and entered dates stay correct across Auckland, DST and extreme timezone offsets', () => {
  assert.equal(calendarLabel('2026-10-01'), '1 Oct');
  for (const zone of ['Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York', 'Africa/Cairo']) {
    const l = ledger('EGP', zone); l.act('expense', { amount: '1', categoryId: 'food', date: '2026-09-15' });
    assert.equal(dateKey(transactionTime(l.state.transactions[1]), zone), '2026-09-15');
  }
  for (const [date, zone] of [['2026-03-08', 'America/New_York'], ['2026-09-27', 'Pacific/Auckland'], ['2026-04-24', 'Africa/Cairo']]) {
    const state = mutate(initialState(), 'opening', { revision: 0, amount: '1', date, timezone: zone }, now);
    assert.equal(dateKey(transactionTime(state.transactions[0]), zone), date);
  }
});
test('same-day backdated refunds can follow an expense recorded after local noon', () => {
  let state = mutate(initialState(), 'opening', { revision: 0, amount: '100', date: '2026-09-01' }, '2026-09-01T12:00:00.000Z');
  state = mutate(state, 'expense', { revision: 1, amount: '10', categoryId: 'food' }, '2026-09-20T18:00:00.000Z');
  state = mutate(state, 'refund', { revision: 2, amount: '5', expenseId: state.transactions[1].id, date: '2026-09-20' }, now);
  assert.equal(dateKey(transactionTime(state.transactions[2])), '2026-09-20'); assert.equal(balance(state), 95000);
});
test('save receipts survive restarts, reject changed payloads and prevent duplicate expenses', t => {
  const f = fixture(t); f.store.update('opening', { revision: 0, amount: '100' });
  const input = { revision: 1, amount: '10', categoryId: 'food', requestId: 'safe-save-identifier-0001' };
  f.store.update('expense', input); f.restart();
  const replay = f.store.update('expense', input);
  assert.equal(replay.replayed, true); assert.equal(replay.balance, 90000);
  assert.equal(f.store.state().transactions.length, 2); assert.equal(f.store.receipt(input.requestId).revision, 2);
  assert.throws(() => f.store.update('expense', { ...input, amount: '20' }), /different change/);
});
test('restore retries do not create another recovery snapshot or replace later changes', t => {
  const f = fixture(t); f.store.update('opening', { revision: 0, amount: '100' });
  const { backup } = f.store.backup(); f.store.update('expense', { revision: 1, amount: '10', categoryId: 'food' });
  f.store.restore(backup, 2, 'safe-restore-identifier-0001');
  f.store.update('income', { revision: 3, amount: '1' });
  assert.equal(f.store.restore(backup, 2, 'safe-restore-identifier-0001').replayed, true);
  assert.equal(balance(f.store.state()), 101000);
  assert.equal(f.store.backups().filter(b => b.kind === 'before-restore').length, 1);
});
test('secondary copies are verified, keep eight weekly snapshots and recover after destination failure', t => {
  const secondary = mkdtempSync(join(tmpdir(), 'pocket-secondary-')); let current = Date.now();
  t.after(() => rmSync(secondary, { recursive: true, force: true }));
  const f = fixture(t, { secondaryBackupDir: join(secondary, 'copies'), now: () => current });
  f.store.update('opening', { revision: 0, amount: '100' });
  for (let i = 0; i < 10; i++) { f.store.weekly(); current += WEEK; }
  const status = f.store.backupStatus(); assert.equal(status.secondary.error, null); assert.match(status.health, /verified/);
  const latest = status.items[0]; const copy = JSON.parse(readFileSync(join(secondary, 'copies', latest.name)));
  assert.deepEqual(copy, f.store.readBackup(latest.name));
  assert.equal((awaitDirectory(secondary)).length, 8);
  writeFileSync(join(secondary, 'copies', latest.name), '{}'); assert.match(f.store.backupStatus().secondary.error, /damaged/);
  f.store.backup(); assert.equal(f.store.backupStatus().secondary.error, null);
});
function awaitDirectory(root) { return readdirSync(join(root, 'copies')).filter(n => n.startsWith('weekly-')); }
import { readdirSync } from 'node:fs';
test('failed secondary destinations do not block local backups and retry once the folder becomes available', t => {
  const f = fixture(t); const blocked = join(f.root, 'blocked'); writeFileSync(blocked, 'occupied');
  f.store.secondaryBackupDir = join(blocked, 'copies'); f.store.backup();
  assert.match(f.store.backupStatus().secondary.error, /unavailable/); assert.match(f.store.backupStatus().health, /verified/);
  rmSync(blocked); mkdirSync(blocked); f.store.weekly(); assert.equal(f.store.backupStatus().secondary.error, null);
  const newest = f.store.backups()[0]; writeFileSync(join(f.root, 'backups', newest.name), '{}');
  assert.match(f.store.backupStatus().health, /failed validation/);
});
test('requests time out, keep mutation outcomes uncertain and handle response-body failures', async () => {
  const states = [];
  const request = createRequestClient({ timeout: 10, onConnection: ok => states.push(ok), fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  await assert.rejects(request('action/expense', { amount: '1' }), e => e.uncertain && /draft is kept/.test(e.message));
  assert.deepEqual(states, [false]);
  const broken = createRequestClient({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('truncated'); } }) });
  await assert.rejects(broken('action/expense', {}), e => e.uncertain);
});
