import { dateKey, effect, filteredHistory, ZONE } from './ledger.mjs';
import { formatAmount, transactionTime } from '../public/domain.js';

// Quoting handles CSV delimiters. Text cells also need protection from spreadsheet formulas.
function cell(value, numeric = false) {
  let text = String(value ?? '');
  if (!numeric && (/^[\s\uFEFF]*[=+@\-]/u.test(text) || /^[\t\r\n]/u.test(text))) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function historyCsv(state, filters = {}) {
  const currency = state.currency || 'EGP', zone = state.timezone || ZONE;
  const balances = new Map(); let running = 0;
  for (const transaction of state.transactions) { running += effect(transaction); balances.set(transaction.id, running); }
  const headers = ['id', 'transaction_date', 'occurred_at', 'recorded_at', 'type', 'amount', 'currency', 'category', 'subject', 'description', 'expense_id', 'balance_after', 'timezone'];
  const rows = filteredHistory(state, filters, zone).map(t => [
    cell(t.id), cell(dateKey(transactionTime(t), zone)), cell(transactionTime(t)), cell(t.createdAt), cell(t.type),
    cell(formatAmount(effect(t), currency, false), true), cell(currency), cell(t.category), cell(t.subject), cell(t.description), cell(t.expenseId),
    cell(formatAmount(balances.get(t.id), currency, false), true), cell(zone)
  ].join(','));
  return '\uFEFF' + [headers.map(header => cell(header)).join(','), ...rows].join('\r\n') + '\r\n';
}
