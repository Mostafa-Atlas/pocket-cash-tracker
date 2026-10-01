import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, mutate, money, balance, validateState, history, analytics, periodRange, dateKey } from '../lib/ledger.mjs';

const MONDAY = '2026-09-14T12:00:00.000Z';
function ledger() {
  let state = initialState();
  return { get state() { return state; }, act(action, input = {}, now = MONDAY) { state = mutate(state, action, { revision: state.revision, ...input }, now); return state.transactions.at(-1); } };
}
test('money parses decimal strings exactly and rejects ambiguous amounts', () => {
  assert.equal(money('0.10'), 100); assert.equal(money('1.01'), 1010); assert.equal(money(' 5.5 '), 5500); assert.equal(money('0', true), 0);
  for (const invalid of ['-1', '0', '1.001', '1e3', '', 'NaN', 'Infinity', '1,000', '1000001', 1, null]) assert.throws(() => money(invalid));
});
test('opening is single-use; money received and expenses maintain exact cash', () => {
  const l = ledger(); assert.throws(() => l.act('expense', { amount: '1', categoryId: 'food' }));
  l.act('opening', { amount: '100' }); l.act('income', { amount: '50.20', description: 'Dad' }); l.act('expense', { amount: '20.10', categoryId: 'food' });
  assert.equal(balance(l.state), 130100); assert.throws(() => l.act('opening', { amount: '1' }));
});
test('overspending and negative corrections are rejected without modifying source', () => {
  const l = ledger(); l.act('opening', { amount: '10' }); const before = JSON.stringify(l.state);
  assert.throws(() => l.act('expense', { amount: '10.01', categoryId: 'food' }), /Not enough cash/);
  assert.equal(JSON.stringify(l.state), before); const expense = l.act('expense', { amount: '10', categoryId: 'food' });
  assert.equal(balance(l.state), 0); assert.throws(() => l.act('edit', { id: expense.id, amount: '11', categoryId: 'food' }), /negative/);
});
test('full and partial refunds are capped; expense deletion requires removing linked refunds', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); const expense = l.act('expense', { amount: '30', categoryId: 'food' });
  const r1 = l.act('refund', { expenseId: expense.id, amount: '10' });
  assert.equal(balance(l.state), 80000);
  assert.throws(() => l.act('refund', { expenseId: expense.id, amount: '20.01' }), /refundable/);
  const r2 = l.act('refund', { expenseId: expense.id, amount: '20' });
  assert.equal(balance(l.state), 100000); assert.equal(analytics(l.state, {}, MONDAY).spent, 0);
  assert.throws(() => l.act('delete', { id: expense.id }), /linked refunds/);
  assert.throws(() => l.act('edit', { id: expense.id, amount: '29', categoryId: 'food' }), /smaller than its refunds/);
  l.act('delete', { id: r1.id }); l.act('delete', { id: r2.id }); l.act('delete', { id: expense.id });
  assert.equal(balance(l.state), 100000);
});
test('refund edits preserve caps and original timestamps', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); const expense = l.act('expense', { amount: '30', categoryId: 'food' });
  const refund = l.act('refund', { expenseId: expense.id, amount: '5' });
  l.act('edit', { id: refund.id, amount: '8', createdAt: '1999-01-01', description: 'Correct return' }, '2026-09-15T12:00:00.000Z');
  assert.equal(l.state.transactions.at(-1).createdAt, MONDAY); assert.equal(balance(l.state), 78000);
  assert.throws(() => l.act('edit', { id: refund.id, amount: '31' }), /Refunds cannot exceed/);
});
test('corrections change only permitted fields and reject stale revisions', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); const expense = l.act('expense', { amount: '20', categoryId: 'food' });
  l.act('edit', { id: expense.id, amount: '15', categoryId: 'lessons', subjectId: 'chemistry', description: 'Lesson', createdAt: '2000-01-01', type: 'income' }, '2026-09-15T12:00:00.000Z');
  const t = l.state.transactions.at(-1); assert.equal(t.createdAt, MONDAY); assert.equal(t.type, 'expense'); assert.equal(t.subjectId, 'chemistry'); assert.equal(balance(l.state), 85000);
  assert.throws(() => mutate(l.state, 'income', { revision: 0, amount: '1' }), e => e.status === 409);
});
test('deleting or reducing income cannot break an earlier balance', () => {
  const l = ledger(); l.act('opening', { amount: '0' }); const income = l.act('income', { amount: '100' }); l.act('expense', { amount: '80', categoryId: 'food' }); l.act('income', { amount: '100' });
  assert.throws(() => l.act('delete', { id: income.id }), /negative/); assert.throws(() => l.act('edit', { id: income.id, amount: '70' }), /negative/);
});
test('balance corrections appear in history but not spending or income', () => {
  const l = ledger(); l.act('opening', { amount: '200' }); l.act('adjust', { amount: '180' });
  assert.equal(balance(l.state), 180000); const a = analytics(l.state, {}, MONDAY); assert.equal(a.spent, 0); assert.equal(a.income, 0); assert.equal(a.cash.at(-1).amount, 180000);
  assert.equal(history(l.state, { type: 'adjustment' }).total, 1); assert.throws(() => l.act('adjust', { amount: '180' }), /already/);
});
test('archives preserve history; unused category and subject deletion is allowed', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); const expense = l.act('expense', { amount: '10', categoryId: 'lessons', subjectId: 'chemistry' });
  for (const [kind, id] of [['category', 'lessons'], ['subject', 'chemistry']]) {
    assert.throws(() => l.act('taxonomy', { kind, id, operation: 'delete' }), /history/);
    l.act('taxonomy', { kind, id, operation: 'archive' });
  }
  assert.throws(() => l.act('expense', { amount: '10', categoryId: 'lessons', subjectId: 'chemistry' }), /active category/);
  l.act('edit', { id: expense.id, amount: '12', categoryId: 'lessons', subjectId: 'chemistry' });
  assert.equal(history(l.state, { category: 'lessons', subject: 'chemistry' }).total, 1);
  l.act('taxonomy', { kind: 'category', id: 'food', operation: 'delete' }); assert.ok(!l.state.categories.some(c => c.id === 'food'));
  l.act('taxonomy', { kind: 'subject', operation: 'add', name: 'Maths' });
  const id = l.state.subjects.at(-1).id; l.act('taxonomy', { kind: 'subject', id, operation: 'delete' });
});
test('taxonomy rename is reflected in history and duplicate/invalid names fail', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); l.act('expense', { amount: '10', categoryId: 'food' });
  l.act('taxonomy', { kind: 'category', id: 'food', operation: 'rename', name: 'Meals' });
  assert.equal(history(l.state, { q: 'meals' }).total, 1);
  assert.throws(() => l.act('taxonomy', { kind: 'category', operation: 'add', name: 'meals' }), /unique/);
  assert.throws(() => l.act('taxonomy', { kind: 'subject', operation: 'add', name: ' ' }));
  assert.throws(() => l.act('taxonomy', { kind: 'category', operation: 'add', name: 'Other', color: 'red;display:none' }));
});
test('Cairo calendar switches at local midnight and weeks run Sunday through Saturday', () => {
  assert.equal(dateKey('2026-09-12T21:30:00.000Z'), '2026-09-13');
  assert.deepEqual(periodRange('week', undefined, undefined, MONDAY), { from: '2026-09-13', to: '2026-09-19', label: 'This week' });
  assert.equal(periodRange('month', undefined, undefined, MONDAY).from, '2026-09-01');
  assert.throws(() => periodRange('custom', '2026-02-30', '2026-03-01'));
  assert.throws(() => periodRange('custom', '2026-09-15', '2026-09-14'));
});
test('refunds count when returned, even if original expense was in previous week', () => {
  const l = ledger(); l.act('opening', { amount: '100' }, '2026-09-01T12:00:00.000Z'); const expense = l.act('expense', { amount: '20', categoryId: 'food' }, '2026-09-05T12:00:00.000Z');
  l.act('refund', { expenseId: expense.id, amount: '10' }, MONDAY);
  const a = analytics(l.state, { period: 'week' }, MONDAY); assert.equal(a.gross, 0); assert.equal(a.refunds, 10000); assert.equal(a.spent, -10000); assert.equal(a.categories[0].amount, -10000); assert.equal(a.biggest, null);
  assert.equal(a.cash[0].amount, 80000); assert.equal(a.cash.at(-1).amount, 90000);
});
test('history filters type, description, categories, subjects, and dates together', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); l.act('expense', { amount: '10', categoryId: 'lessons', subjectId: 'chemistry', description: 'Organic revision' }); l.act('expense', { amount: '3', categoryId: 'food', description: 'Lunch' });
  assert.equal(history(l.state, { q: 'organic', type: 'expense', subject: 'chemistry', category: 'lessons', from: '2026-09-14', to: '2026-09-14' }).total, 1);
  assert.equal(history(l.state, { from: '2026-09-15' }).total, 0);
});
test('long periods aggregate by month and carry prior balances across empty months', () => {
  const l = ledger(); l.act('opening', { amount: '100' }, '2026-01-01T12:00:00.000Z'); l.act('expense', { amount: '10', categoryId: 'food' }, MONDAY);
  const a = analytics(l.state, { period: 'all' }, MONDAY); assert.equal(a.monthly, true); assert.equal(a.daily.length, 9); assert.equal(a.cash[3].amount, 100000); assert.equal(a.cash.at(-1).amount, 90000);
});
test('balance charts do not invent cash values before tracking began', () => {
  const l = ledger(); l.act('opening', { amount: '100' }, MONDAY);
  const a = analytics(l.state, { period: 'week' }, MONDAY);
  assert.deepEqual(a.cash, [{ date: '2026-09-14', amount: 100000 }]);
  const past = analytics(l.state, { period: 'custom', from: '2026-09-01', to: '2026-09-10' }, MONDAY);
  assert.deepEqual(past.cash, []);
});
test('state validation rejects orphaned refunds, duplicate IDs, missing opening, and invalid timestamps', () => {
  const l = ledger(); l.act('opening', { amount: '100' }); const expense = l.act('expense', { amount: '10', categoryId: 'food' });
  for (const change of [s => s.transactions[1].id = s.transactions[0].id, s => s.transactions[1].createdAt = 'invalid', s => s.transactions[1].amount = .1, s => s.transactions.shift(), s => s.transactions[1].categoryId = 'missing', s => { s.transactions[1].type = 'refund'; s.transactions[1].expenseId = expense.id; }]) {
    const invalid = structuredClone(l.state); change(invalid); assert.throws(() => validateState(invalid));
  }
});
test('many exact decimal expenses never accumulate float rounding error', () => {
  const l = ledger(); l.act('opening', { amount: '10' });
  for (let i = 0; i < 100; i++) l.act('expense', { amount: '0.10', categoryId: 'food' });
  assert.equal(balance(l.state), 0); assert.equal(analytics(l.state, {}, MONDAY).spent, 10000);
});
test('opening sets currency; invalid codes rejected; currency can be relabelled later', () => {
  const l = ledger();
  assert.throws(() => l.act('opening', { amount: '100', currency: 'XX' }), /currency/i);
  l.act('opening', { amount: '100', currency: 'USD' });
  assert.equal(l.state.currency, 'USD');
  assert.equal(balance(l.state), 100000);
  assert.throws(() => l.act('currency', { currency: 'XX' }), /currency/i);
  assert.throws(() => l.act('currency', { currency: 'USD' }), /already selected/);
  l.act('currency', { currency: 'EUR' });
  assert.equal(l.state.currency, 'EUR');
  assert.equal(balance(l.state), 100000); // relabel only, amounts untouched
});
test('legacy states without currency default to EGP', () => {
  const l = ledger(); l.act('opening', { amount: '50' });
  assert.equal(l.state.currency, 'EGP');
  const legacy = structuredClone(l.state); delete legacy.currency;
  validateState(legacy);
  assert.equal(legacy.currency, 'EGP');
});
test('opening sets timezone; invalid zones rejected; timezone can change later', () => {
  const l = ledger();
  assert.throws(() => l.act('opening', { amount: '100', currency: 'USD', timezone: 'Mars/Olympus' }), /timezone/i);
  l.act('opening', { amount: '100', currency: 'USD', timezone: 'America/New_York' });
  assert.equal(l.state.timezone, 'America/New_York');
  assert.throws(() => l.act('timezone', { timezone: 'Not/AZone' }), /timezone/i);
  assert.throws(() => l.act('timezone', { timezone: 'America/New_York' }), /already selected/);
  l.act('timezone', { timezone: 'Europe/Paris' });
  assert.equal(l.state.timezone, 'Europe/Paris');
  assert.equal(balance(l.state), 100000);
});
test('legacy states without timezone default to Africa/Cairo; day boundaries follow zone', () => {
  const l = ledger(); l.act('opening', { amount: '50' });
  assert.equal(l.state.timezone, 'Africa/Cairo');
  // 2026-09-14T22:30:00Z is still 14 Sept in Cairo (UTC+3) but 14 Sept in New York too at 18:30;
  // use a UTC time that falls on different local days: 2026-09-14T01:30:00Z = 04:30 Cairo (14th), 21:30 NY 13th.
  assert.equal(dateKey('2026-09-14T01:30:00.000Z', 'Africa/Cairo'), '2026-09-14');
  assert.equal(dateKey('2026-09-14T01:30:00.000Z', 'America/New_York'), '2026-09-13');
});
