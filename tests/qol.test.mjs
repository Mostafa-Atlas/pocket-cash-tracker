import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, mutate, balance, history, monthlyBudgets, validateState } from '../lib/ledger.mjs';
import { historyCsv } from '../lib/export.mjs';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

const now = '2026-10-01T12:00:00.000Z';
function ledger(currency = 'EGP') {
  let state = initialState();
  const act = (action, input = {}) => (state = mutate(state, action, { revision: state.revision, ...input }, now));
  act('opening', { amount: '1000', currency, timezone: 'Africa/Cairo', date: '2026-08-31' });
  return { act, state: () => state };
}
// Independent CSV reader used to verify escaped fields and embedded newlines.
function parseCsv(csv) {
  const rows = []; let row = [], value = '', quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if (char === '\r' && text[i + 1] === '\n' && !quoted) { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += char;
  }
  return rows;
}

test('monthly targets count net spending, refund month and category, excluding received money and adjustments', () => {
  const f = ledger();
  f.act('expense', { amount: '50', categoryId: 'food', date: '2026-09-30' });
  const original = f.state().transactions.at(-1).id;
  f.act('expense', { amount: '100', categoryId: 'food' });
  f.act('refund', { amount: '20', expenseId: original });
  f.act('income', { amount: '400' });
  f.act('adjust', { amount: '2000' });
  const cash = balance(f.state());
  f.act('budget', { amount: '90' }); f.act('budget', { categoryId: 'food', amount: '75' });
  assert.equal(balance(f.state()), cash);
  const report = monthlyBudgets(f.state(), now);
  assert.equal(report.month, '2026-10');
  assert.deepEqual(report.overall, { target: 90000, spent: 80000, remaining: 10000, percent: 89, over: false });
  assert.equal(report.categories[0].over, true); assert.equal(report.categories[0].remaining, -5000); assert.equal(report.categories[0].percent, 100);
  assert.equal(monthlyBudgets(f.state(), '2026-11-01T12:00:00.000Z').overall.remaining, 90000);
});

test('refund-only month preserves negative net spending while clamping its progress bar', () => {
  const f = ledger(); f.act('expense', { amount: '50', categoryId: 'food', date: '2026-09-30' });
  f.act('refund', { amount: '20', expenseId: f.state().transactions.at(-1).id });
  f.act('budget', { amount: '100' });
  const report = monthlyBudgets(f.state(), now);
  assert.equal(report.overall.spent, -20000); assert.equal(report.overall.percent, 0); assert.equal(report.overall.remaining, 120000);
});

test('budget targets validate precision, remove cleanly and respect category archive/delete and currency changes', () => {
  const f = ledger('KWD'); f.act('budget', { amount: '5.001', categoryId: 'food' });
  assert.throws(() => f.act('currency', { currency: 'EGP' }), /decimal places/);
  assert.throws(() => f.act('budget', { amount: '0' }), /above 0/);
  assert.throws(() => f.act('budget', { amount: '-5' }), /valid/);
  assert.throws(() => f.act('budget', { amount: '10', categoryId: 'unknown' }), /existing category/);
  f.act('taxonomy', { kind: 'category', id: 'food', operation: 'rename', name: 'Meals' });
  f.act('taxonomy', { kind: 'category', id: 'food', operation: 'archive' });
  assert.equal(monthlyBudgets(f.state(), now).categories[0].name, 'Meals');
  f.act('taxonomy', { kind: 'category', id: 'food', operation: 'delete' });
  assert.deepEqual(f.state().budgets.categories, {});
  f.act('budget', { amount: '20' }); f.act('budget', { amount: '' }); assert.equal(f.state().budgets.overall, null);
  const invalid = structuredClone(f.state()); invalid.budgets.categories.unknown = 10;
  assert.throws(() => validateState(invalid), /budget target/);
});

test('monthly targets follow the configured timezone at month boundaries', () => {
  const f = ledger(); f.act('budget', { amount: '10' }); f.act('timezone', { timezone: 'Pacific/Auckland' });
  assert.equal(monthlyBudgets(f.state(), '2026-10-31T22:00:00.000Z').month, '2026-11');
  f.act('timezone', { timezone: 'UTC' }); assert.equal(monthlyBudgets(f.state(), '2026-10-31T22:00:00.000Z').month, '2026-10');
});

test('legacy ledgers receive empty targets; saved targets survive restart and backup restoration', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-qol-store-'));
  const f = ledger(); const legacy = structuredClone(f.state()); delete legacy.budgets;
  assert.deepEqual(validateState(legacy).budgets, { overall: null, categories: {} });
  let store = new Store(join(directory, 'data'), join(directory, 'backups'), { now: () => Date.parse(now) });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.set('state', f.state()); store.update('budget', { revision: store.state().revision, amount: '250', requestId: 'budget-request-0123456789' });
  const { name, backup } = store.backup();
  const snapshot = backup || store.readBackup(name);
  store.close(); store = new Store(join(directory, 'data'), join(directory, 'backups'));
  assert.equal(store.state().budgets.overall, 250000);
  store.update('budget', { revision: store.state().revision, amount: '' });
  store.restore(snapshot, store.state().revision); assert.equal(store.state().budgets.overall, 250000);
});

test('CSV exports every matching row beyond pagination, with ungrouped signed values and original balances', () => {
  const f = ledger();
  for (let i = 0; i < 55; i++) f.act('expense', { amount: '1.25', categoryId: 'food', description: 'Lunch ' + i });
  assert.equal(history(f.state(), { category: 'food' }).rows.length, 50);
  const rows = parseCsv(historyCsv(f.state(), { category: 'food', offset: '50' }));
  assert.equal(rows.length, 56); assert.equal(rows[1][5], '-1.25'); assert.equal(rows[1][11], '931.25');
  assert.equal(rows.at(-1)[11], '998.75'); assert.equal(rows[1][12], 'Africa/Cairo');
  assert.equal(parseCsv(historyCsv(f.state(), { q: 'Lunch 54', type: 'expense', from: '2026-10-01', to: '2026-10-01' })).length, 2);
  assert.equal(parseCsv(historyCsv(f.state(), { type: 'refund' })).length, 1);
});

test('CSV round-trips quotes, commas, multiline Unicode and neutralizes untrusted spreadsheet formulas', () => {
  const f = ledger('KWD'); f.act('taxonomy', { kind: 'category', operation: 'rename', id: 'food', name: '=SUM(1,2)' });
  f.act('expense', { amount: '1.005', categoryId: 'food', description: 'Tea, "mint"\nقهوة' });
  let row = parseCsv(historyCsv(f.state()))[1]; assert.equal(row[5], '-1.005'); assert.equal(row[7], "'=SUM(1,2)"); assert.equal(row[9], 'Tea, "mint"\nقهوة');
  for (const description of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '\t=1+1', '  =1+1']) {
    f.act('expense', { amount: '1', categoryId: 'food', description });
    row = parseCsv(historyCsv(f.state()))[1]; assert.ok(row[9].startsWith("'"));
  }
});

test('HTTP CSV export requires authentication, matches filters and leaves the ledger unchanged', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-qol-http-'));
  const app = createApp({ dataDir: join(directory, 'data'), backupDir: join(directory, 'backups'), pin: '24682468', now: () => Date.parse(now), autoBackup: false });
  const f = ledger(); f.act('expense', { amount: '10', categoryId: 'food' }); app.store.set('state', f.state());
  const server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.close(); rmSync(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}/api/`;
  assert.equal((await fetch(url + 'history/export')).status, 401);
  const login = await fetch(url + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pocket-Request': '1' }, body: JSON.stringify({ pin: '24682468' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0], before = app.store.state();
  const response = await fetch(url + 'history/export?category=food', { headers: { cookie } });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/csv/); assert.match(response.headers.get('content-disposition'), /attachment; filename="pocket-history-2026-10-01.csv"/);
  assert.equal(parseCsv(await response.text()).length, 2); assert.deepEqual(app.store.state(), before);
  assert.equal((await fetch(url + 'history/export?from=2026-11-01&to=2026-10-01', { headers: { cookie } })).status, 400);
});
