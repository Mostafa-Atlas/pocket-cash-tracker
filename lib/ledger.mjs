import { randomUUID } from 'node:crypto';
import { CURRENCIES, MONEY_SCALE, currencyDigits, parseAmount, formatAmount, transactionTime } from '../public/domain.js';
export { CURRENCIES } from '../public/domain.js';

export const ZONE = 'Africa/Cairo';
export const MAX_MONEY = 1_000_000 * MONEY_SCALE;
export const validCurrency = code => typeof code === 'string' && Object.hasOwn(CURRENCIES, code);
export const currencyLabel = code => (validCurrency(code) ? `${code} · ${CURRENCIES[code]}` : 'EGP · Egyptian pound');
export const TIMEZONES = ['Africa/Cairo', 'Africa/Algiers', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Nairobi', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Amman', 'Asia/Istanbul', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Manila', 'America/New_York', 'America/Toronto', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];
export function validTimezone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); return true; }
  catch { return false; }
}
export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function fail(condition, message, status) { if (!condition) throw new UserError(message, status); }
export function money(value, allowZero = false, currency = 'EGP') {
  const units = parseAmount(value, currency), digits = currencyDigits(currency);
  fail(units !== null, digits ? `Enter a valid ${currency} amount with up to ${digits} decimal places.` : `Enter a whole-number ${currency} amount.`);
  fail(units <= MAX_MONEY && (allowZero ? units >= 0 : units > 0), `Enter an amount ${allowZero ? 'from 0' : 'above 0'} and no more than 1,000,000.`);
  return units;
}
export function cleanText(value = '', max = 500) {
  fail(typeof value === 'string' && value.length <= max, `Text must be ${max} characters or fewer.`);
  return value.trim();
}
export function initialState() {
  return { schema: 2, revision: 0, initialized: false, currency: null, timezone: null, categories: [
    { id: 'lessons', name: 'Lessons', color: '#ac9af7', icon: 'book', subjects: true, archived: false },
    { id: 'transport', name: 'Transport', color: '#71b6f9', icon: 'bus', subjects: false, archived: false },
    { id: 'food', name: 'Food', color: '#f1ba77', icon: 'food', subjects: false, archived: false }
  ], subjects: [{ id: 'chemistry', name: 'Chemistry', archived: false }], budgets: { overall: null, categories: {} }, transactions: [] };
}
export function effect(t) { return t.type === 'expense' ? -t.amount : t.amount; }
export function balance(state) { return state.transactions.reduce((sum, t) => sum + effect(t), 0); }
export function refunded(state, id) { return state.transactions.filter(t => t.type === 'refund' && t.expenseId === id).reduce((sum, t) => sum + t.amount, 0); }
export function dateKey(iso = new Date().toISOString(), zone = ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: validTimezone(zone) ? zone : ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function shiftDate(key, days) { const date = new Date(key + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function upgradeState(source) {
  const state = structuredClone(source);
  if (state?.schema === 1) {
    fail(Array.isArray(state.transactions), 'Invalid legacy ledger.');
    for (const t of state.transactions) {
      fail(Number.isSafeInteger(t.amount) && Math.abs(t.amount) <= MAX_MONEY / 10, 'Invalid legacy amount.');
      t.amount *= 10;
    }
    state.schema = 2;
  }
  return validateState(state);
}
function datedTime(date, now, zone, original) {
  if (date === undefined || date === '') return original || now;
  fail(validDate(date) && date <= dateKey(now, zone), 'Choose a valid transaction date no later than today.');
  if (original && date === dateKey(original, zone)) return original;
  if (date === dateKey(now, zone)) return now;
  // Find local noon; midday avoids DST transitions at midnight.
  const wanted = Date.parse(date + 'T12:00:00Z'); let instant = wanted;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const difference = wanted - local; instant += difference; if (!difference) break;
  }
  const iso = new Date(instant).toISOString();
  fail(dateKey(iso, zone) === date, 'This calendar date does not exist in your timezone.'); return iso;
}
export function periodRange(period = 'week', from, to, now = new Date().toISOString(), zone = ZONE) {
  const today = dateKey(now, validTimezone(zone) ? zone : ZONE);
  if (period === 'today') return { from: today, to: today, label: 'Today' };
  if (period === 'month') return { from: today.slice(0, 7) + '-01', to: today, label: 'This month' };
  if (period === 'all') return { from: '0001-01-01', to: today, label: 'All time' };
  if (period === 'custom') {
    fail(validDate(from) && validDate(to) && from <= to, 'Choose a valid start and end date.');
    return { from, to, label: 'Custom range' };
  }
  fail(period === 'week', 'Unknown period.');
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  return { from: shiftDate(today, -weekday), to: shiftDate(today, 6 - weekday), label: 'This week' };
}
function selectedCategory(state, id, subjectId, old) {
  const category = state.categories.find(c => c.id === id);
  fail(category && (!category.archived || old?.categoryId === id), 'Choose an active category.');
  if (subjectId) {
    const subject = state.subjects.find(s => s.id === subjectId);
    fail(category.subjects && subject && (!subject.archived || old?.subjectId === subjectId), 'Choose an active lesson subject.');
  }
  return { categoryId: id, subjectId: category.subjects ? (subjectId || null) : null };
}
export function validateState(state) {
  fail(state && state.schema === 2 && Number.isSafeInteger(state.revision) && state.revision >= 0 && typeof state.initialized === 'boolean', 'Unsupported or invalid backup format.');
  if (state.currency == null && !state.initialized) state.currency = null;
  else { if (state.currency == null) state.currency = 'EGP'; fail(validCurrency(state.currency), 'Unknown currency.'); }
  if (state.timezone == null && !state.initialized) state.timezone = null;
  else { if (state.timezone == null) state.timezone = ZONE; fail(validTimezone(state.timezone), 'Unknown timezone.'); }
  fail(Array.isArray(state.categories) && state.categories.length <= 200 && Array.isArray(state.subjects) && state.subjects.length <= 200 && Array.isArray(state.transactions) && state.transactions.length <= 100_000, 'Invalid or oversized data.');
  const ids = new Set();
  const checkId = id => { fail(typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id) && !ids.has(id), 'Invalid or duplicate record ID.'); ids.add(id); };
  for (const list of [state.categories, state.subjects]) {
    const names = new Set();
    for (const item of list) {
      checkId(item.id); fail(cleanText(item.name, 40).length > 0 && typeof item.archived === 'boolean', 'Invalid category or subject.');
      fail(!names.has(item.name.toLowerCase()), 'Category and subject names must be unique.'); names.add(item.name.toLowerCase());
    }
  }
  for (const c of state.categories) fail(/^#[0-9a-fA-F]{6}$/.test(c.color) && typeof c.subjects === 'boolean' && ['book', 'bus', 'food', 'tag'].includes(c.icon), 'Invalid category appearance.');
  // Older schema-2 ledgers and backups have no targets yet.
  if (state.budgets === undefined) state.budgets = { overall: null, categories: {} };
  const budgets = state.budgets;
  fail(budgets && typeof budgets === 'object' && !Array.isArray(budgets) && budgets.categories && typeof budgets.categories === 'object' && !Array.isArray(budgets.categories), 'Invalid budget targets.');
  const validTarget = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_MONEY && value % (MONEY_SCALE / 10 ** currencyDigits(state.currency || 'EGP')) === 0;
  fail(budgets.overall === null || validTarget(budgets.overall), 'Invalid overall budget target.');
  for (const [id, target] of Object.entries(budgets.categories)) fail(state.categories.some(c => c.id === id) && validTarget(target), 'Invalid category budget target.');
  let cash = 0, previousTime = '', openingCount = 0;
  const seen = new Map();
  const returns = new Map();
  for (const t of state.transactions) {
    checkId(t.id);
    fail(['opening', 'income', 'expense', 'refund', 'adjustment'].includes(t.type), 'Invalid transaction type.');
    fail(Number.isSafeInteger(t.amount) && Math.abs(t.amount) <= MAX_MONEY && (['opening', 'adjustment'].includes(t.type) || t.amount > 0) && (t.type === 'adjustment' || t.amount >= 0), 'Invalid transaction amount.');
    for (const stamp of [t.createdAt, transactionTime(t)]) fail(typeof stamp === 'string' && !Number.isNaN(Date.parse(stamp)) && new Date(stamp).toISOString() === stamp, 'Invalid transaction timestamp.');
    fail(transactionTime(t) >= previousTime, 'Invalid transaction date or order.');
    previousTime = transactionTime(t); cleanText(t.description, 500);
    if (t.type === 'opening') { openingCount++; fail(seen.size === 0, 'Opening balance must be first.'); }
    if (t.type === 'expense') {
      const c = state.categories.find(c => c.id === t.categoryId);
      fail(c && (!t.subjectId || (c.subjects && state.subjects.some(s => s.id === t.subjectId))), 'Expense has an unknown category or subject.');
    }
    if (t.type === 'refund') {
      const original = seen.get(t.expenseId);
      fail(original?.type === 'expense', 'Refund must follow its original expense.');
      const total = (returns.get(t.expenseId) || 0) + t.amount;
      fail(total <= original.amount, 'Refunds cannot exceed the original expense.'); returns.set(t.expenseId, total);
    }
    cash += effect(t);
    fail(Number.isSafeInteger(cash) && cash >= 0 && cash <= MAX_MONEY, 'This change would leave a negative or oversized cash balance. Add missing money or correct related records first.');
    seen.set(t.id, t);
  }
  fail(state.initialized ? openingCount === 1 : state.transactions.length === 0, 'Invalid opening balance.');
  return state;
}
export function mutate(source, action, input, now = new Date().toISOString()) {
  const state = structuredClone(source);
  if (state.budgets === undefined) state.budgets = { overall: null, categories: {} };
  fail(input && typeof input === 'object' && !Array.isArray(input), 'Invalid request.');
  fail(input.revision === state.revision, 'Your data changed on another screen. Refresh and try again.', 409);
  const add = data => {
    const timestamp = state.transactions.at(-1)?.createdAt > now ? state.transactions.at(-1).createdAt : now;
    const t = { id: randomUUID(), createdAt: timestamp, occurredAt: datedTime(input.date, timestamp, state.timezone || ZONE), description: '', ...data };
    state.transactions.push(t); return t;
  };
  if (action === 'opening') {
    fail(!state.initialized, 'Opening balance has already been set.');
    const code = input.currency ?? state.currency ?? 'EGP';
    fail(validCurrency(code), 'Choose a valid currency.');
    const tz = input.timezone ?? state.timezone ?? ZONE;
    fail(validTimezone(tz), 'Choose a valid timezone.');
    state.currency = code; state.timezone = tz;
    add({ type: 'opening', amount: money(input.amount, true, code), description: 'Opening cash balance' }); state.initialized = true;
  } else {
    fail(state.initialized, 'Set your opening balance first.');
    if (action === 'budget') {
      const id = input.categoryId === '' || input.categoryId == null ? null : input.categoryId;
      fail(id === null || typeof id === 'string' && state.categories.some(c => c.id === id), 'Choose an existing category.');
      const target = input.amount === '' || input.amount === null ? null : money(input.amount, false, state.currency);
      if (id === null) state.budgets.overall = target;
      else if (target === null) delete state.budgets.categories[id];
      else state.budgets.categories[id] = target;
    } else if (action === 'opening-date') {
      const opening = state.transactions.find(t => t.type === 'opening');
      opening.occurredAt = datedTime(input.date, now, state.timezone || ZONE, transactionTime(opening));
    } else if (action === 'timezone') {
      fail(validTimezone(input.timezone), 'Choose a valid timezone.');
      fail(input.timezone !== state.timezone, 'This timezone is already selected.');
      state.timezone = input.timezone;
    } else if (action === 'currency') {
      fail(validCurrency(input.currency), 'Choose a valid currency.');
      fail(input.currency !== state.currency, 'This currency is already selected.');
      const step = MONEY_SCALE / 10 ** currencyDigits(input.currency);
      fail([...state.transactions.map(t => t.amount), state.budgets.overall || 0, ...Object.values(state.budgets.categories)].every(amount => amount % step === 0), 'Existing amounts or budget targets need more decimal places than this currency supports. Keep the current currency to avoid rounding your history.');
      state.currency = input.currency;
    } else if (action === 'expense' || action === 'income') {
      const amount = money(input.amount, false, state.currency);
      if (action === 'expense') fail(amount <= balance(state), 'Not enough cash. This expense exceeds your available balance.');
      add({ type: action, amount, description: cleanText(input.description), ...(action === 'expense' ? selectedCategory(state, input.categoryId, input.subjectId) : {}) });
    } else if (action === 'adjust') {
      const target = money(input.amount, true, state.currency), amount = target - balance(state);
      fail(amount !== 0, 'Your balance is already this amount.');
      add({ type: 'adjustment', amount, description: cleanText(input.description) || 'Cash balance corrected' });
    } else if (action === 'refund') {
      const original = state.transactions.find(t => t.id === input.expenseId && t.type === 'expense');
      fail(original, 'Original expense not found.');
      const amount = money(input.amount, false, state.currency);
      fail(amount <= original.amount - refunded(state, original.id), 'This refund exceeds the amount still refundable.');
      const refund = add({ type: 'refund', amount, expenseId: original.id, description: cleanText(input.description) });
      if (dateKey(transactionTime(refund), state.timezone || ZONE) === dateKey(transactionTime(original), state.timezone || ZONE) && transactionTime(refund) < transactionTime(original)) refund.occurredAt = transactionTime(original);
    } else if (action === 'edit' || action === 'delete') {
      const index = state.transactions.findIndex(t => t.id === input.id), old = state.transactions[index];
      fail(old && old.type !== 'opening', 'This record cannot be changed. Use Edit balance for opening cash.');
      if (action === 'delete') {
        fail(old.type !== 'expense' || refunded(state, old.id) === 0, 'Delete linked refunds before deleting this expense.'); state.transactions.splice(index, 1);
      } else {
        fail(old.type !== 'adjustment', 'Use Edit balance to make another correction.');
        const amount = input.amount === formatAmount(old.amount, state.currency, false) ? old.amount : money(input.amount, false, state.currency);
        if (old.type === 'expense') fail(amount >= refunded(state, old.id), 'The expense cannot be smaller than its refunds.');
        state.transactions[index] = { ...old, amount, occurredAt: datedTime(input.date, now, state.timezone || ZONE, transactionTime(old)), description: cleanText(input.description), ...(old.type === 'expense' ? selectedCategory(state, input.categoryId, input.subjectId, old) : {}) };
        if (old.type === 'refund') {
          const refund = state.transactions[index], expense = state.transactions.find(t => t.id === old.expenseId);
          if (dateKey(transactionTime(refund), state.timezone || ZONE) === dateKey(transactionTime(expense), state.timezone || ZONE) && transactionTime(refund) < transactionTime(expense)) refund.occurredAt = transactionTime(expense);
        }
      }
    } else if (action === 'taxonomy') {
      fail(['category', 'subject'].includes(input.kind), 'Unknown category type.');
      const list = input.kind === 'category' ? state.categories : state.subjects;
      if (input.operation === 'add') {
        fail(list.length < 200, 'You have reached the limit of 200 items.');
        const name = cleanText(input.name, 40); fail(name.length > 0, 'Enter a name.');
        list.push({ id: randomUUID(), name, archived: false, ...(input.kind === 'category' ? { color: input.color || '#75dbc6', icon: 'tag', subjects: false } : {}) });
      } else {
        const index = list.findIndex(i => i.id === input.id), item = list[index]; fail(item, 'Item not found.');
        if (input.operation === 'rename') { item.name = cleanText(input.name, 40); fail(item.name.length > 0, 'Enter a name.'); }
        else if (input.operation === 'archive') item.archived = true;
        else if (input.operation === 'unarchive') item.archived = false;
        else if (input.operation === 'delete') {
          fail(!state.transactions.some(t => input.kind === 'category' ? t.categoryId === item.id : t.subjectId === item.id), 'This item has history. Archive it instead.');
          list.splice(index, 1);
          if (input.kind === 'category') delete state.budgets.categories[item.id];
        } else throw new UserError('Unknown category action.');
      }
    } else throw new UserError('Unknown action.');
  }
  state.revision++;
  const opening = state.transactions.find(t => t.type === 'opening');
  fail(!opening || state.transactions.every(t => transactionTime(t) >= transactionTime(opening)), 'This date is before your opening balance. Change the tracking start date in Settings first.');
  state.transactions.sort((a, b) => transactionTime(a).localeCompare(transactionTime(b)) || (a.type === 'opening' ? -1 : b.type === 'opening' ? 1 : 0));
  return validateState(state);
}
function decorationLookup(state) {
  const refunds = new Map();
  for (const t of state.transactions) if (t.type === 'refund') refunds.set(t.expenseId, (refunds.get(t.expenseId) || 0) + t.amount);
  return { transactions: new Map(state.transactions.map(t => [t.id, t])), categories: new Map(state.categories.map(c => [c.id, c])), subjects: new Map(state.subjects.map(s => [s.id, s])), refunds };
}
export function decorate(state, t, lookup = decorationLookup(state)) {
  const original = t.type === 'refund' ? lookup.transactions.get(t.expenseId) : t;
  const category = lookup.categories.get(original?.categoryId), subject = lookup.subjects.get(original?.subjectId);
  const returned = t.type === 'expense' ? lookup.refunds.get(t.id) || 0 : 0;
  return { ...t, categoryId: category?.id || null, category: category?.name || null, color: category?.color || '#75dbc6', icon: category?.icon || (t.type === 'income' ? 'plus' : 'wallet'), subjectId: subject?.id || null, subject: subject?.name || null, effect: effect(t), refundable: t.type === 'expense' ? t.amount - returned : 0, refunded: returned };
}
export function filteredHistory(state, filters = {}, zone = state.timezone || ZONE) {
  const z = validTimezone(zone) ? zone : ZONE;
  const lookup = decorationLookup(state);
  let rows = state.transactions.map(t => decorate(state, t, lookup)).reverse();
  const query = String(filters.q || '').trim().toLowerCase();
  rows = rows.filter(t => (!query || [t.description, t.category, t.subject, t.type].some(v => v?.toLowerCase().includes(query))) && (!filters.type || t.type === filters.type) && (!filters.category || t.categoryId === filters.category) && (!filters.subject || t.subjectId === filters.subject) && (!filters.from || dateKey(transactionTime(t), z) >= filters.from) && (!filters.to || dateKey(transactionTime(t), z) <= filters.to));
  return rows;
}
export function history(state, filters = {}, zone = state.timezone || ZONE) {
  const rows = filteredHistory(state, filters, zone), total = rows.length;
  const offset = Math.max(0, Number(filters.offset) || 0);
  return { rows: rows.slice(offset, offset + 50), total };
}
export function monthlyBudgets(state, now = new Date().toISOString()) {
  const summary = analytics(state, { period: 'month' }, now);
  const budgets = state.budgets || { overall: null, categories: {} };
  const progress = (target, spent) => ({ target, spent, remaining: target - spent, percent: Math.min(100, Math.max(0, Math.round(spent / target * 100))), over: spent > target });
  return { month: summary.range.from.slice(0, 7), overall: budgets.overall === null ? null : progress(budgets.overall, summary.spent), categories: state.categories.filter(c => Object.hasOwn(budgets.categories, c.id)).map(c => ({ ...c, ...progress(budgets.categories[c.id], summary.categories.find(row => row.id === c.id)?.amount || 0) })) };
}
export function analytics(state, filters = {}, now, zone = state.timezone || ZONE) {
  const z = validTimezone(zone) ? zone : ZONE;
  const lookup = decorationLookup(state);
  const range = periodRange(filters.period, filters.from, filters.to, now, z);
  const today = dateKey(now, z), byDay = new Map(), categories = new Map(), subjects = new Map();
  let gross = 0, refunds = 0, income = 0, count = 0, running = 0, before = 0;
  const balanceDays = new Map();
  for (const t of state.transactions) {
    const day = dateKey(transactionTime(t), z); running += effect(t);
    if (day < range.from) before = running;
    if (day < range.from || day > range.to) continue;
    balanceDays.set(day, running);
    if (t.type === 'income') income += t.amount;
    if (!['expense', 'refund'].includes(t.type)) continue;
    const d = decorate(state, t, lookup), amount = t.type === 'expense' ? t.amount : -t.amount;
    if (t.type === 'expense') { gross += t.amount; count++; } else refunds += t.amount;
    byDay.set(day, (byDay.get(day) || 0) + amount);
    categories.set(d.categoryId, (categories.get(d.categoryId) || 0) + amount);
    if (d.subjectId) subjects.set(d.subjectId, (subjects.get(d.subjectId) || 0) + amount);
  }
  const firstDate = range.from === '0001-01-01' ? (state.transactions[0] ? dateKey(transactionTime(state.transactions[0]), z) : today) : range.from;
  const trackingStarted = state.transactions[0] ? dateKey(transactionTime(state.transactions[0]), z) : null;
  const end = range.to > today ? today : range.to;
  const daily = [], cash = [];
  let lastBalance = before;
  // Aggregate long histories by month to bound the chart payload.
  const span = Math.max(0, Math.round((Date.parse(end) - Date.parse(firstDate)) / 86_400_000));
  const monthly = span > 120;
  if (firstDate <= end) {
    if (!monthly) {
      for (let d = firstDate; d <= end; d = shiftDate(d, 1)) {
        if (balanceDays.has(d)) lastBalance = balanceDays.get(d);
        daily.push({ date: d, amount: byDay.get(d) || 0 });
        if (trackingStarted && d >= trackingStarted) cash.push({ date: d, amount: lastBalance });
      }
    } else {
      const monthSpending = new Map(), monthCash = new Map();
      for (const [d, v] of byDay) monthSpending.set(d.slice(0, 7), (monthSpending.get(d.slice(0, 7)) || 0) + v);
      for (const [d, v] of balanceDays) monthCash.set(d.slice(0, 7), v);
      let d = firstDate.slice(0, 7) + '-01';
      while (d <= end && daily.length < 2400) {
        const m = d.slice(0, 7); if (monthCash.has(m)) lastBalance = monthCash.get(m);
        daily.push({ date: d, amount: monthSpending.get(m) || 0 });
        if (trackingStarted && m >= trackingStarted.slice(0, 7)) cash.push({ date: d, amount: lastBalance });
        const next = new Date(d + 'T12:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1); d = next.toISOString().slice(0, 10);
      }
    }
  }
  const breakdown = state.categories.filter(c => categories.has(c.id)).map(c => ({ ...c, amount: categories.get(c.id) })).sort((a, b) => b.amount - a.amount);
  const subjectBreakdown = state.subjects.filter(s => subjects.has(s.id)).map(s => ({ ...s, amount: subjects.get(s.id) })).sort((a, b) => b.amount - a.amount);
  return { range, balance: balance(state), spent: gross - refunds, gross, refunds, income, count, categories: breakdown, subjects: subjectBreakdown, daily, cash, monthly, biggest: breakdown.find(c => c.amount > 0) || null };
}
