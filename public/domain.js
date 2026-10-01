// Shared by the server and browser. Money uses integer thousandths internally.
export const MONEY_SCALE = 1000;
export const CURRENCIES = {
  EGP: 'Egyptian pound', USD: 'US dollar', EUR: 'Euro', GBP: 'British pound',
  SAR: 'Saudi riyal', AED: 'UAE dirham', KWD: 'Kuwaiti dinar', BHD: 'Bahraini dinar',
  QAR: 'Qatari riyal', JOD: 'Jordanian dinar', MAD: 'Moroccan dirham', DZD: 'Algerian dinar',
  TND: 'Tunisian dinar', LYD: 'Libyan dinar', SDG: 'Sudanese pound', TRY: 'Turkish lira',
  INR: 'Indian rupee', PKR: 'Pakistani rupee', PHP: 'Philippine peso', CAD: 'Canadian dollar',
  AUD: 'Australian dollar', JPY: 'Japanese yen'
};
export const currencyDigits = code => code === 'JPY' ? 0 : ['KWD', 'BHD', 'JOD', 'TND', 'LYD'].includes(code) ? 3 : 2;
export function parseAmount(value, currency = 'EGP') {
  const digits = currencyDigits(currency);
  const pattern = new RegExp(`^\\d{1,7}${digits ? `(\\.\\d{1,${digits}})?` : ''}$`);
  if (typeof value !== 'string' || !pattern.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  return Number(whole) * MONEY_SCALE + Number(fraction.padEnd(3, '0'));
}
export function formatAmount(units, currency = 'EGP', grouped = true) {
  const digits = currencyDigits(currency);
  // Preserve fractional historical amounts, including old JPY records, without rounding.
  const required = units % 10 !== 0 ? 3 : units % 100 !== 0 ? 2 : units % 1000 !== 0 ? 1 : 0;
  return new Intl.NumberFormat('en', { useGrouping: grouped, minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, required) }).format(units / MONEY_SCALE);
}
export const transactionTime = transaction => transaction.occurredAt || transaction.createdAt;
export function calendarLabel(key, options = { day: 'numeric', month: 'short' }) {
  // A calendar key is already local. Do not apply a timezone conversion again.
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(key + 'T12:00:00Z'));
}
export function shiftCalendar(key, days) {
  const date = new Date(key + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
