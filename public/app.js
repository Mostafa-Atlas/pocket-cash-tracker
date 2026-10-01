import { CURRENCIES, MONEY_SCALE, currencyDigits, parseAmount, formatAmount, transactionTime, calendarLabel, shiftCalendar } from './domain.js';
import { createRequestClient, saveIdentifier } from './connection.js';
const $ = selector => document.querySelector(selector);
const app = $('#app'), modal = $('#modal');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H6V10"/><path d="M9 20v-7h6v7"/>',
  chart: '<path d="M4 4v16h17M8 15v-4m5 4V7m5 8V4"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2"/>',
  settings: '<path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  down: '<path d="M7 7l10 10M7 17h10V7"/>',
  up: '<path d="M7 17 17 7M7 7h10v10"/>',
  wallet: '<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7"/><path d="M21 12h-6v5h6M17 14.5h.01"/>',
  book: '<path d="M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15"/>',
  bus: '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 10h14M8 19v2m8-2v2M8 15h1m6 0h1"/>',
  food: '<path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18M19 3c-4 3-4 9 0 9v9V3"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8m-10 4h6"/>',
  restore: '<path d="M3 5v6h6M3 11a9 9 0 1 1 2 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.tag}</svg>`;
const code = () => (state?.currency && CURRENCIES[state.currency] ? state.currency : 'EGP');
const currencyName = c => CURRENCIES[c] || 'Egyptian pound';
const amount = units => formatAmount(units, code());
const egp = cents => `${amount(cents)} ${code()}`;
const numeric = units => formatAmount(units, code(), false);
const shortMoney = units => Math.abs(units) >= MONEY_SCALE * 1000 ? `${(units / (MONEY_SCALE * 1000)).toFixed(1).replace(/\.0$/, '')}k` : new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(units / MONEY_SCALE);
const TIMEZONES = ['Africa/Cairo', 'Africa/Algiers', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Nairobi', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Amman', 'Asia/Istanbul', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Manila', 'America/New_York', 'America/Toronto', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];
const zone = () => (state?.timezone || 'Africa/Cairo');
const detectedZone = () => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z || 'Africa/Cairo'; } catch { return 'Africa/Cairo'; } };
const zoneOptions = selected => [...new Set([selected, detectedZone(), ...TIMEZONES])].filter(Boolean).map(z => `<option value="${escape(z)}" ${z === selected ? 'selected' : ''}>${escape(z)}</option>`).join('');
const formatDate = (iso, options = {}) => new Intl.DateTimeFormat('en-GB', { timeZone: zone(), ...options }).format(new Date(iso));
const dayLabel = key => calendarLabel(key);
const dateKey = iso => new Intl.DateTimeFormat('en-CA', { timeZone: zone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const time = iso => formatDate(iso, { hour: 'numeric', minute: '2-digit', hour12: true });
const types = { expense: 'Expense', income: 'Money received', refund: 'Refund', opening: 'Opening balance', adjustment: 'Balance adjustment' };
let state, authenticated = false, currentPage = '', pageToken = 0, formContext = null;
let period = 'week', customFrom = '', customTo = '', historyFilters = {}, historyRows = [], historyTotal = 0;
let records = new Map(), toastTimer;
const pages = ['home', 'analysis', 'history', 'settings'];

let connected = null;
function connectionStatus(ok) {
  connected = ok;
  const label = $('#connection-status');
  if (label) { label.textContent = ok ? 'Connected to PC' : 'PC unreachable'; label.classList.toggle('offline', !ok); }
}
const request = createRequestClient({ onConnection: connectionStatus });
function stored(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } }
function persist(key, value) { try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* A blocked storage policy still allows in-memory recovery. */ } }
let draft = stored('pocket-entry-draft'), pendingSave = stored('pocket-pending-save');
let openingDraft = stored('pocket-opening-draft');
function captureOpeningDraft() {
  const form = $('#opening'); if (!form || pendingSave) return;
  openingDraft = Object.fromEntries(new FormData(form)); persist('pocket-opening-draft', openingDraft);
}
function captureDraft() {
  const form = $('#entry-form'); if (!form || pendingSave) return;
  draft = { action: formContext.action, old: formContext.old, categoryId: formContext.categoryId, values: Object.fromEntries(new FormData(form)) };
  persist('pocket-entry-draft', draft);
}
function clearDraft() { draft = null; openingDraft = null; persist('pocket-entry-draft', null); persist('pocket-opening-draft', null); }
function savePending(value) { pendingSave = value; persist('pocket-pending-save', value); }
function pendingNotice() { return pendingSave ? '<div class="error-banner">Your last save is not confirmed. Its draft is kept. <button class="btn small secondary" data-action="retry-save">Check / retry save</button></div>' : ''; }
async function api(path, body) {
  try { return await request(path, body); }
  catch (error) {
    if (error.status === 401 && path !== 'login') { captureDraft(); authenticated = false; pageToken++; modal.close(); renderLogin('Unlock to recover your draft or check the pending save.'); }
    throw error;
  }
}

function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4200); }
function errorBox(message) { return `<div class="error-banner" role="alert">${escape(message)}</div>`; }
function empty(title, text, symbol = 'wallet') { return `<div class="empty"><div class="empty-icon">${icon(symbol)}</div><h3>${escape(title)}</h3><p>${escape(text)}</p></div>`; }
function query(values) { return new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v != null))).toString(); }
function periodQuery() { return query({ period, from: customFrom, to: customTo }); }
function periodSelect() { return `<div class="period-wrap"><label class="period-control"><span class="sr-only">Analysis period</span><select id="period">${[['week', 'This week'], ['today', 'Today'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom range']].map(([v, n]) => `<option value="${v}" ${v === period ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${period === 'custom' ? `<form id="custom-range" class="custom-dates"><label><span class="sr-only">Start date</span><input type="date" name="from" value="${escape(customFrom)}" required></label><span class="muted">–</span><label><span class="sr-only">End date</span><input type="date" name="to" value="${escape(customTo)}" required></label><button class="btn small secondary">Apply</button></form>` : ''}</div>`; }
function intro(title, subtitle, filter = false) { return `<div class="page-intro"><div><h1>${title}</h1><p>${subtitle}</p></div>${filter ? periodSelect() : ''}</div>`; }
function shell(page) {
  currentPage = page;
  const label = { home: 'Overview', analysis: 'Analysis', history: 'History', settings: 'Settings' }[page];
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="#home"><img src="/icon.svg" alt="">Pocket<span class="sr-only"> home</span></a><p class="brand-sub">Your cash, a little clearer.</p><p class="eyebrow nav-label">Workspace</p><nav class="nav" aria-label="Main navigation">${pages.map(p => `<a href="#${p}" class="${p === page ? 'active' : ''}" ${p === page ? 'aria-current="page"' : ''}>${icon({ home: 'home', analysis: 'chart', history: 'history', settings: 'settings' }[p])}<span>${p[0].toUpperCase() + p.slice(1)}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="private-note">${icon('shield')}Just for you.</div><p>Physical cash. One clear picture.</p><button class="btn ghost" data-action="lock">${icon('lock')}Lock Pocket</button></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><span>Pocket</span>${icon('chevron')}<span>${label}</span></div><div class="topbar-right"><span id="connection-status" class="connection-status" role="status">${connected === false ? 'PC unreachable' : 'Connected to PC'}</span><span class="date-label">${formatDate(new Date().toISOString(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span><span class="private-label">Personal workspace</span><span class="avatar" aria-label="Personal account">P</span></div></header><main id="main" tabindex="-1"><div class="empty">Loading your cash…</div></main><footer class="page-foot"><span>${icon('shield')}Your data stays on your PC.</span><span>${code()} · ${escape(zone())} · Made for everyday cash</span></footer></div>`;
}
function renderLogin(message = '') {
  app.innerHTML = `<main id="main" class="auth-page"><div class="auth-card"><div class="brand"><img src="/icon.svg" alt="">Pocket</div><section class="panel auth-panel"><div class="auth-mark">${icon('lock')}</div><h1>A little peace of mind.</h1><p>Your cash, spending, and small everyday decisions. All in one private place.</p><form id="login" class="form-grid"><label class="field"><span>Your PIN</span><input class="pin-input" type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,12}" minlength="4" maxlength="12" autocomplete="current-password" required aria-describedby="login-error" autofocus></label><div id="login-error" class="inline-error" role="alert">${escape(message)}</div><button class="btn full">Unlock Pocket ${icon('arrow')}</button><p class="form-tip">${icon('clock')}This device stays unlocked for 24 hours.</p></form></section><p class="auth-foot">${icon('shield')}Private by design. Yours by default.</p></div></main>`;
  $('#login input')?.focus();
}
function renderOpening() {
  app.innerHTML = `<main id="main" class="auth-page onboarding"><div class="auth-card"><div class="brand"><img src="/icon.svg" alt="">Pocket</div><section class="panel auth-panel"><div class="auth-mark">${icon('wallet')}</div><h1>Start with what's in hand.</h1><p>Choose your currency and timezone, then count the physical cash you have right now. This is your starting point—you can correct it later.</p><form id="opening" class="form-grid"><label class="field"><span>Currency</span><select name="currency" required>${Object.entries(CURRENCIES).map(([c, n]) => `<option value="${c}" ${c === 'EGP' ? 'selected' : ''}>${c} · ${escape(n)}</option>`).join('')}</select></label><label class="field"><span>Timezone</span><select name="timezone" required>${zoneOptions(detectedZone())}</select></label><label class="field"><span>Your current cash</span><div class="amount-input"><input name="amount" type="text" inputmode="decimal" placeholder="0.00" maxlength="11" required autocomplete="off" aria-describedby="opening-error"><span>${code()}</span></div></label><label class="field"><span>Tracking start date</span><input name="date" type="date" max="${state.today}" value="${state.today}" required></label><div id="opening-error" class="inline-error" role="alert"></div><button class="btn full">Let's get started ${icon('arrow')}</button><p class="form-tip">${icon('shield')}Just cash. Your bank money stays separate.</p></form></section><p class="auth-foot"><button class="text-button" data-action="lock">${icon('lock')}Lock Pocket</button></p></div></main>`;
  $('#opening input')?.focus();
  const values = pendingSave?.action === 'opening' ? pendingSave.input : openingDraft;
  for (const [name, value] of Object.entries(values || {})) { const input = $('#opening').elements.namedItem(name); if (input) input.value = value; }
  state.currency = $('#opening [name=currency]').value; state.timezone = $('#opening [name=timezone]').value;
  state.today = dateKey(new Date().toISOString()); $('#opening [name=date]').max = state.today;
  $('#opening .amount-input > span').textContent = code();
  $('#opening').insertAdjacentHTML('beforebegin', pendingNotice()); freezePendingForm();
}
function transactionTitle(t) { return t.type === 'expense' ? (t.subject || t.category) : types[t.type]; }
function transactionRows(rows) {
  rows.forEach(t => records.set(t.id, t));
  return `<div class="transactions">${rows.map(t => `<button class="tx" data-action="detail" data-id="${t.id}" aria-label="${escape(`${transactionTitle(t)}, ${egp(t.amount)}, ${types[t.type]}, ${dayLabel(dateKey(transactionTime(t)))}`)}"><span class="tx-icon" style="--tx-color:${t.color}">${icon(t.type === 'refund' ? 'restore' : t.icon)}</span><span class="tx-copy"><span class="tx-title">${escape(transactionTitle(t))}</span><span class="tx-meta" style="display:block">${escape(t.description || (t.subject ? `${t.category} · ${t.subject}` : types[t.type]))}</span></span><span class="tx-right"><span class="tx-amount ${t.effect >= 0 ? 'positive' : ''}">${t.effect >= 0 ? '+' : '−'}${amount(Math.abs(t.effect))}<small>${code()}</small></span><span class="tx-meta" style="display:block">${dayLabel(dateKey(transactionTime(t)))}${transactionTime(t) === t.createdAt ? ' · ' + time(t.createdAt) : ' · Recorded later'}</span></span></button>`).join('')}</div>`;
}
function categoryChart(a, compact = false) {
  if (!a.categories.length) return empty('A clearer picture starts here', 'Add your first expense to see where your cash goes.', 'chart');
  const positive = a.categories.filter(c => c.amount > 0), total = positive.reduce((n, c) => n + c.amount, 0);
  let offset = 0;
  const arcs = positive.map(c => { const length = c.amount / total * 100; const arc = `<circle cx="80" cy="80" r="65" fill="none" stroke="${c.color}" stroke-width="13" pathLength="100" stroke-dasharray="${Math.max(0, length - (positive.length > 1 ? 2 : 0))} 100" stroke-dashoffset="${-offset}"><title>${escape(c.name)}: ${egp(c.amount)}</title></circle>`; offset += length; return arc; }).join('');
  return `<div class="category-summary"><div class="donut-wrap"><svg viewBox="0 0 160 160" role="img" aria-label="Positive net spending by category; amounts listed below"><circle cx="80" cy="80" r="65" fill="none" stroke="#303b33" stroke-width="13"/>${arcs}</svg><div class="donut-center"><strong>${shortMoney(a.spent)}</strong><span>${code()} net spent</span></div></div><div class="category-list">${a.categories.map(c => `<div><div class="category-line"><span class="category-name"><span class="dot" style="background:${c.color}"></span>${escape(c.name)}</span><span class="category-money">${amount(c.amount)}<small>${code()}</small></span></div>${!compact ? `<div class="meter"><span style="width:${Math.max(0, total ? c.amount / total * 100 : 0)}%;background:${c.color}"></span></div>` : ''}</div>`).join('')}</div></div>${a.categories.some(c => c.amount < 0) ? '<p class="caption">Negative categories received more refunds than new spending. The ring shows positive amounts only.</p>' : ''}`;
}
function chart(data, name, line = false, monthly = false) {
  if (!state.initialized || !data.length) return empty('No data in this period', 'Choose another period to explore your history.', 'chart');
  const mobile = matchMedia('(max-width:640px)').matches;
  const width = mobile ? Math.max(240, innerWidth - 90) : 640, height = mobile ? 210 : 230, left = 42, right = 16, top = 19, bottom = 38;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const vals = data.map(p => p.amount); let min = Math.min(0, ...vals), max = Math.max(MONEY_SCALE, ...vals);
  if (min === max) max = min + MONEY_SCALE;
  const y = value => top + (max - value) / (max - min) * plotHeight;
  const x = i => left + plotWidth * (i + .5) / data.length;
  const base = y(0), step = Math.max(1, Math.ceil(data.length / (mobile ? 4 : 7)));
  const grid = [0, 1, 2, 3].map(i => { const v = min + (max - min) * i / 3; return `<line x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}" class="gridline"/><text x="${left - 9}" y="${y(v) + 4}" text-anchor="end">${shortMoney(v)}</text>`; }).join('');
  const axisLabels = data.map((d, i) => i % step === 0 || i === data.length - 1 && data.length < 9 ? `<text x="${x(i)}" y="${height - 10}" text-anchor="middle">${monthly ? calendarLabel(d.date, { month: 'short', year: '2-digit' }) : dayLabel(d.date)}</text>` : '').join('');
  const points = data.map((d, i) => `${x(i)},${y(d.amount)}`).join(' ');
  const graph = line ? `<polygon points="${x(0)},${base} ${points} ${x(data.length - 1)},${base}" fill="#83e3ca" opacity=".07"/><polyline points="${points}" fill="none" stroke="#83e3ca" stroke-width="2.5" stroke-linejoin="round"/>${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.amount)}" r="${data.length > 45 ? 1.5 : 3}" fill="#a9f0da"><title>${dayLabel(d.date)}: ${egp(d.amount)}</title></circle>`).join('')}` : data.map((d, i) => `<rect x="${x(i) - Math.min(34, plotWidth / data.length * .5) / 2}" y="${Math.min(base, y(d.amount))}" width="${Math.min(34, plotWidth / data.length * .5)}" height="${Math.max(d.amount === 0 ? 0 : 2, Math.abs(base - y(d.amount)))}" rx="3" fill="${d.amount >= 0 ? '#83d6ba' : '#a6bdfa'}"><title>${dayLabel(d.date)}: ${egp(d.amount)}</title></rect>`).join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(name)}. ${data.length} ${monthly ? 'months' : 'days'}; values available below.">${grid}${graph}${axisLabels}</svg><details class="chart-access"><summary>View chart values · ${code()}</summary><div class="chart-data-scroll"><table><thead><tr><th>${monthly ? 'Month' : 'Date'}</th><th>${escape(name)}</th></tr></thead><tbody>${data.map(d => `<tr><td>${monthly ? escape(d.date.slice(0, 7)) : dayLabel(d.date)}</td><td>${egp(d.amount)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function renderHome(a, recent) {
  $('#main').innerHTML = `${intro('Your money, at a glance.', 'A little awareness goes a long way.', true)}<div class="overview-grid"><section class="panel balance-card"><div class="balance-top"><span>Your available cash</span><span class="balance-icon">${icon('wallet')}</span></div><div class="balance-amount">${amount(state.balance)}<small>${code()}</small></div><p class="balance-caption">The cash you have in hand, right now.</p><div class="balance-actions"><button class="btn" data-action="expense">${icon('plus')}Add Expense</button><button class="btn secondary" data-action="income">${icon('plus')}Add Money</button></div></section><section class="panel week-summary"><div class="week-head"><h2>${escape(a.range.label)}</h2><span>${period === 'all' ? 'Your full history' : `${dayLabel(a.range.from)} – ${dayLabel(a.range.to)}`}</span></div><div class="stat-line"><div class="stat-label"><span class="stat-icon">${icon('up')}</span>Net spent</div><div class="stat-value">${amount(a.spent)}<small>${code()}</small></div></div><div class="stat-line"><div class="stat-label"><span class="stat-icon in">${icon('down')}</span>Money received</div><div class="stat-value">${amount(a.income)}<small>${code()}</small></div></div><p class="week-foot">${a.count} expense${a.count === 1 ? '' : 's'} recorded${a.refunds ? ` · ${egp(a.refunds)} refunded` : ' · One entry at a time.'}</p></section></div><div class="lower-grid"><section class="panel"><div class="panel-head"><div><h2>Where it goes</h2><p>Your spending by category</p></div><a class="text-button" href="#analysis" aria-label="See spending analysis">${icon('arrow')}</a></div>${categoryChart(a, true)}${a.biggest ? `<p class="caption"><strong>${escape(a.biggest.name)}</strong> is your biggest spending category this period.</p>` : ''}</section><section class="panel"><div class="panel-head"><div><h2>Recent activity</h2><p>The little things, all accounted for.</p></div><a class="text-button" href="#history">View all ${icon('arrow')}</a></div>${recent.rows.length ? transactionRows(recent.rows.slice(0, 5)) : empty('Your story starts with your first entry', 'Add money received or something you spent to see it here.', 'history')}</section></div>`;
}
function renderAnalysis(a) {
  $('#main').innerHTML = `${intro('Make sense of your spending.', 'Small details. A much clearer picture.', true)}<div class="stats-grid"><section class="panel metric"><span class="eyebrow">Net spent</span><strong>${amount(a.spent)} <small>${code()}</small></strong><p>Expenses minus refunds</p></section><section class="panel metric"><span class="eyebrow">Expenses</span><strong>${amount(a.gross)} <small>${code()}</small></strong><p>${a.count} expense${a.count === 1 ? '' : 's'} in this period</p></section><section class="panel metric"><span class="eyebrow">Refunds</span><strong>${amount(a.refunds)} <small>${code()}</small></strong><p>Cash returned in this period</p></section><section class="panel metric"><span class="eyebrow">Top category</span><strong>${escape(a.biggest?.name || '—')}</strong><p>${a.biggest ? egp(a.biggest.amount) + ' net spent' : 'No spending yet'}</p></section></div><div class="charts-grid"><section class="panel"><div class="panel-head"><div><h2>${a.monthly ? 'Monthly' : 'Daily'} spending</h2><p>When your cash goes out—and comes back</p></div><span class="pill">${code()}</span></div>${a.count || a.refunds ? chart(a.daily, 'Net spending', false, a.monthly) : empty('No spending recorded', 'Your spending pattern will appear as you add expenses.', 'chart')}</section><section class="panel"><div class="panel-head"><div><h2>Spending by category</h2><p>Every category has its place</p></div></div>${categoryChart(a)}</section><section class="panel"><div class="panel-head"><div><h2>Your cash over time</h2><p>Closing balance ${a.monthly ? 'each month' : 'each day'} · includes balance corrections</p></div></div>${chart(a.cash, 'Cash balance', true, a.monthly)}</section><section class="panel"><div class="panel-head"><div><h2>A closer look at lessons</h2><p>Net spending across your subjects</p></div>${icon('book')}</div>${a.subjects.length ? `<div class="category-list">${a.subjects.map(s => `<div><div class="category-line"><span>${escape(s.name)}</span><span>${egp(s.amount)}</span></div><div class="meter"><span style="width:${Math.max(0, s.amount / Math.max(1, ...a.subjects.map(x => x.amount)) * 100)}%;background:#ac9af7"></span></div></div>`).join('')}</div>` : empty('A little more detail', 'Choose a subject when recording a lesson to see its spending here.', 'book')}</section></div><p class="caption">Refunds count on the day the cash was returned. Balance adjustments and opening cash are excluded from spending. All dates use ${escape(zone())}.</p>`;
}
function options(items, selected, all) { return `<option value="">${all}</option>${items.map(i => `<option value="${i.id}" ${selected === i.id ? 'selected' : ''}>${escape(i.name)}${i.archived ? ' (archived)' : ''}</option>`).join('')}`; }
function renderHistory() {
  $('#main').innerHTML = `${intro('Every little transaction.', 'Find it, understand it, or make a correction.')}<form id="history-filters" class="panel filter-panel"><div class="filters"><label class="search-wrap"><span>Search history</span><div style="position:relative">${icon('search')}<input name="q" value="${escape(historyFilters.q || '')}" placeholder="Description, category, subject…" type="search"></div></label><label>Type<select name="type">${options(Object.entries(types).map(([id, name]) => ({ id, name })), historyFilters.type, 'All transactions')}</select></label><label>Category<select name="category">${options(state.categories, historyFilters.category, 'All categories')}</select></label><label>Subject<select name="subject">${options(state.subjects, historyFilters.subject, 'All subjects')}</select></label><label>From<input name="from" type="date" value="${escape(historyFilters.from || '')}"></label><label>To<input name="to" type="date" value="${escape(historyFilters.to || '')}"></label><button class="btn" type="submit">Apply filters</button><button class="btn ghost" type="button" data-action="clear-filters">Reset</button></div><div class="inline-error" id="filter-error" role="alert" style="margin-top:10px"></div></form><section class="panel history-panel"><div class="history-heading"><h2>Transactions</h2><span class="muted" style="font-size:12px">${historyTotal} record${historyTotal === 1 ? '' : 's'}</span></div><div id="history-rows">${historyList()}</div>${historyRows.length < historyTotal ? '<div class="load-more"><button class="btn ghost" data-action="load-more">Load more</button></div>' : ''}</section>`;
}
function historyList() {
  if (!historyRows.length) return empty('Nothing here just yet', 'Try changing your filters, or add a new transaction.', 'search');
  const groups = new Map(); historyRows.forEach(t => { const day = dateKey(transactionTime(t)); if (!groups.has(day)) groups.set(day, []); groups.get(day).push(t); });
  return [...groups].map(([day, rows]) => `<h3 class="history-day">${day === state.today ? 'Today' : calendarLabel(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h3>${transactionRows(rows)}`).join('');
}
function taxonomyRows(items, kind) {
  return items.map(item => `<div class="setting-row"><div class="name">${kind === 'category' ? `<span class="dot" style="background:${item.color}"></span>` : icon('book')}${escape(item.name)}${item.archived ? '<span class="archive-tag">Archived</span>' : ''}</div><div class="row-actions"><button class="icon-button" data-action="rename-item" data-kind="${kind}" data-id="${item.id}" aria-label="Rename ${escape(item.name)}">${icon('edit')}</button><button class="icon-button" data-action="${item.archived ? 'unarchive' : 'archive'}-item" data-kind="${kind}" data-id="${item.id}" aria-label="${item.archived ? 'Unarchive' : 'Archive'} ${escape(item.name)}">${icon(item.archived ? 'restore' : 'archive')}</button><button class="icon-button" data-action="delete-item" data-kind="${kind}" data-id="${item.id}" aria-label="Delete ${escape(item.name)}">${icon('trash')}</button></div></div>`).join('');
}
function renderSettings(backups) {
  $('#main').innerHTML = `${intro('A space that works for you.', 'Your categories, your cash, your peace of mind.')}<div class="settings-grid"><section class="panel"><div class="panel-head"><div><h2>Categories</h2><p>Give every expense a home</p></div><button class="btn small ghost" data-action="add-item" data-kind="category">${icon('plus')}Add</button></div>${taxonomyRows(state.categories, 'category') || '<p class="muted">Add a category to record expenses.</p>'}<p class="caption">Used categories can be archived. Their history stays intact.</p></section><section class="panel"><div class="panel-head"><div><h2>Lesson subjects</h2><p>The details behind your lessons</p></div><button class="btn small ghost" data-action="add-item" data-kind="subject">${icon('plus')}Add</button></div>${taxonomyRows(state.subjects, 'subject') || '<p class="muted">No subjects yet.</p>'}<p class="caption">Subjects appear when you choose the Lessons category.</p></section><section class="panel"><div class="panel-head"><div><h2>Your cash</h2><p>Keep the number true to what's in hand</p></div>${icon('wallet')}</div><div class="setting-row"><div><span class="eyebrow">Current balance</span><p style="font-size:28px;color:var(--text);font-variant-numeric:tabular-nums">${amount(state.balance)} <small>${code()}</small></p></div><button class="btn secondary" data-action="adjust">${icon('edit')}Edit balance</button></div><div class="setting-row"><div><span class="name">Tracking start date</span><p>${dayLabel(state.openingDate)}</p></div><button class="btn small secondary" data-action="opening-date">Change</button></div><p class="caption">Corrections are recorded as balance adjustments. They won't change your spending totals.</p></section><section class="panel"><div class="panel-head"><div><h2>Privacy & preferences</h2><p>A small app, just for you</p></div>${icon('shield')}</div><div class="setting-row"><div class="name">Currency</div><div class="row-actions"><span class="muted">${code()} · ${escape(currencyName(code()))}</span><button class="btn small secondary" data-action="change-currency">Change</button></div></div><p class="caption">Changing currency only relabels amounts. Past numbers are not converted.</p><div class="setting-row"><div class="name">Timezone</div><div class="row-actions"><span class="muted">${escape(zone())}</span><button class="btn small secondary" data-action="change-timezone">Change</button></div></div><div class="setting-row"><div class="name">Week starts</div><span class="muted">Sunday</span></div><div class="setting-row"><div><span class="name">PIN lock</span><p>Each device stays unlocked for 24 hours.</p></div><button class="btn ghost small" data-action="lock">${icon('lock')}Lock now</button></div></section><section class="panel wide"><div class="panel-head"><div><h2>A little backup goes a long way.</h2><p>Keep a copy of your cash history</p></div>${icon('archive')}</div><div class="setting-info">${icon('check')}Automatic backup every week · Latest 8 weekly copies retained<br>${backups.lastWeekly ? `Last backup: ${formatDate(backups.lastWeekly, { dateStyle: 'medium', timeStyle: 'short' })}. Next due: ${formatDate(backups.nextWeekly, { dateStyle: 'medium' })}.` : 'Your first automatic backup is pending.'} If your PC is off, an overdue backup runs when Pocket next starts.</div>${backups.error ? errorBox(backups.error) : ''}<p class="caption">${escape(backups.health)}</p><div class="setting-info">${backups.secondary.configured ? `Secondary backup: ${backups.secondary.lastCopied ? 'last copied ' + formatDate(backups.secondary.lastCopied, { dateStyle: 'medium', timeStyle: 'short' }) : 'waiting for first copy'}.` : 'Secondary backup is not configured. You can configure another drive or network folder on the PC; see README → Secondary backups.'}</div>${backups.secondary.error ? errorBox(backups.secondary.error) : ''}<div class="backup-actions"><button class="btn" data-action="backup">${icon('download')}Create manual backup</button><button class="btn ghost" data-action="import-backup">${icon('upload')}Restore from file</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div><p class="caption">Backups contain financial records, categories, and subjects. Your PIN and device sessions are excluded. Download a copy to keep it somewhere else.</p><div class="backup-list">${backups.items.map(b => `<div class="setting-row"><div><span class="name">${icon('archive')}${{ weekly: 'Weekly backup', manual: 'Manual backup', 'before-restore': 'Before restore · recovery copy', 'before-upgrade': 'Before upgrade · original data' }[b.kind]}</span><p>${formatDate(b.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</p></div><div class="row-actions"><a class="btn ghost small" href="/api/backup/download?name=${encodeURIComponent(b.name)}" download aria-label="Download ${escape(b.kind)} backup from ${escape(b.createdAt)}">${icon('download')}Download</a><button class="btn ghost small" data-action="restore-backup" data-name="${b.name}">Restore</button></div></div>`).join('')}</div></section></div>`;
}
async function loadPage({ preserve = false } = {}) {
  if (!authenticated) return;
  const page = pages.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  const token = ++pageToken;
  if (!preserve || currentPage !== page || !$('#main')) shell(page);
  try {
    const fresh = await api('state'); if (token !== pageToken) return; state = fresh;
    if (!state.initialized) { currentPage = ''; renderOpening(); return; }
    if (!customFrom) customFrom = state.today; if (!customTo) customTo = state.today;
    if (page === 'home') {
      const [a, recent] = await Promise.all([api(`analytics?${periodQuery()}`), api('history')]); if (token !== pageToken) return; renderHome(a, recent);
    } else if (page === 'analysis') { const a = await api(`analytics?${periodQuery()}`); if (token !== pageToken) return; renderAnalysis(a); }
    else if (page === 'history') { const h = await api(`history?${query(historyFilters)}`); if (token !== pageToken) return; historyRows = h.rows; historyTotal = h.total; renderHistory(); }
    else { const b = await api('backups'); if (token !== pageToken) return; renderSettings(b); }
    $('#main').insertAdjacentHTML('afterbegin', pendingNotice());
  } catch (error) {
    if (!authenticated || token !== pageToken) return;
    $('#main').innerHTML = `<div class="connection-error">${errorBox(error.message)}${pendingNotice()}<button class="btn secondary" data-action="refresh">${icon('restore')}Try again</button></div>`;
  }
}
function modalFrame(title, subtitle, content) {
  modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><p class="modal-subtitle">${escape(subtitle)}</p>${content}`;
  if (!modal.open) modal.showModal();
  const input = modal.querySelector('input:not([type=hidden])'); if (input && !matchMedia('(max-width:640px)').matches) input.focus();
}
function categoryFields(old) {
  const selected = old?.categoryId || formContext.categoryId || '';
  const categories = state.categories.filter(c => !c.archived || c.id === old?.categoryId);
  return `<div class="field"><span id="category-label">Category</span><div class="choice-grid" role="group" aria-labelledby="category-label">${categories.map(c => `<button type="button" class="choice ${selected === c.id ? 'selected' : ''}" data-action="choose-category" data-id="${c.id}" aria-pressed="${selected === c.id}">${icon(c.icon)}${escape(c.name)}${c.archived ? ' (archived)' : ''}</button>`).join('')}</div>${!categories.length ? '<small>Add a category in Settings first.</small>' : ''}</div><div id="subject-field">${subjectField(selected, old)}</div>`;
}
function subjectField(categoryId, old) {
  if (!state.categories.find(c => c.id === categoryId)?.subjects) return '';
  return `<label class="field"><span>Lesson subject <span class="optional">· optional</span></span><select name="subjectId">${options(state.subjects.filter(s => !s.archived || s.id === old?.subjectId), old?.subjectId, 'Choose a subject')}</select></label>`;
}
function openEntry(action, old) {
  if (pendingSave) throw new Error('Check / retry your pending save before starting another change.');
  formContext = { action, old, categoryId: old?.categoryId || '', revision: state.revision };
  const expense = action === 'expense' || action === 'edit' && old.type === 'expense';
  const title = { expense: 'A little spent.', income: 'A little added.', adjust: 'Set your actual cash.', refund: 'Cash coming back.', edit: 'Make a correction.' }[action];
  const subtitle = { expense: 'Record it now. Understand it later.', income: 'Money from your father, or any cash you receive.', adjust: 'Enter the total cash you actually have—not the difference.', refund: `You can refund up to ${egp(old?.refundable || 0)} for this expense.`, edit: 'Correct the amount or transaction date. The original recording time stays unchanged.' }[action];
  modalFrame(title, subtitle, `<form id="entry-form"><div class="form-grid"><label class="field"><span>${action === 'adjust' ? 'Actual cash balance' : 'Amount'}</span><div class="amount-input"><input name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" maxlength="11" value="${action === 'edit' ? numeric(old.amount) : action === 'adjust' ? numeric(state.balance) : ''}" required aria-describedby="entry-error"><span>${code()}</span></div></label>${expense ? categoryFields(old) : ''}${action !== 'adjust' ? dateFields(old) : ''}<label class="field"><span>${action === 'income' ? 'Note' : 'Description'} <span class="optional">· optional</span></span><textarea name="description" maxlength="500" rows="2" placeholder="${expense ? 'What was it for?' : 'Anything you want to remember…'}">${escape(action === 'edit' ? old.description : '')}</textarea></label><div id="balance-preview" class="balance-preview"><span>Balance after ${action === 'edit' ? 'correction' : action === 'refund' ? 'refund' : action === 'expense' ? 'expense' : 'saving'}</span><strong>${egp(state.balance)}</strong></div><div class="inline-error" id="entry-error" role="alert"></div><p class="form-tip">${icon('clock')}${action === 'edit' ? escape(formatDate(old.createdAt, { dateStyle: 'medium', timeStyle: 'short' })) + ' · original timestamp' : 'Recording time is automatic. The transaction date controls your history and analysis.'}</p></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn" type="submit">${{ expense: 'Save expense', income: 'Add money', refund: 'Save refund', adjust: 'Update balance', edit: 'Save changes' }[action]}</button></div></form>`);
  restoreDraft(action, old);
  updatePreview();
}
function updatePreview() {
  if (!$('#entry-form')) return;
  const raw = $('#entry-form [name=amount]').value;
  const parsed = parseAmount(raw, code());
  const valid = parsed !== null;
  const entered = parsed || 0;
  const { action, old } = formContext;
  let predicted = state.balance;
  if (action === 'adjust') predicted = entered;
  else if (action === 'edit') predicted += (old.type === 'expense' ? -1 : 1) * (entered - old.amount);
  else predicted += (action === 'expense' ? -1 : 1) * entered;
  $('#balance-preview strong').textContent = valid ? egp(predicted) : '—';
  $('#balance-preview').classList.toggle('invalid', valid && predicted < 0);
}
function openDetail(t) {
  formContext = { old: t };
  modalFrame(transactionTitle(t), `${types[t.type]} · ${formatDate(transactionTime(t), { dateStyle: 'medium' })}`, `<div class="detail-amount">${t.effect >= 0 ? '+' : '−'}${amount(Math.abs(t.effect))}<small>${code()}</small></div><div class="detail-row"><span>Recorded</span><span>${formatDate(t.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}</span></div><div class="detail-row"><span>Type</span><span>${types[t.type]}</span></div>${t.category ? `<div class="detail-row"><span>Category</span><span>${escape(t.category)}</span></div>` : ''}${t.subject ? `<div class="detail-row"><span>Subject</span><span>${escape(t.subject)}</span></div>` : ''}${t.refunded ? `<div class="detail-row"><span>Already refunded</span><span>${egp(t.refunded)}</span></div>` : ''}${t.description ? `<div class="detail-note">${escape(t.description)}</div>` : ''}${t.type === 'opening' ? '<p class="caption">Use Edit balance in Settings to correct your current cash.</p>' : `<div class="detail-buttons">${t.type !== 'adjustment' ? `<button class="btn secondary" data-action="edit-record" data-id="${t.id}">${icon('edit')}Edit</button>` : ''}${t.type === 'expense' && t.refundable > 0 ? `<button class="btn secondary" data-action="refund-record" data-id="${t.id}">${icon('restore')}Refund</button>` : ''}<button class="btn danger" data-action="delete-record" data-id="${t.id}">${icon('trash')}Delete</button></div>`}`);
}
function confirmAction(title, description, context, label = 'Confirm') {
  formContext = context;
  modalFrame(title, description, `<form id="confirm-form"><div class="inline-error" id="confirm-error" role="alert"></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="close-modal">Cancel</button><button class="btn ${context.danger ? 'danger' : ''}" type="submit">${escape(label)}</button></div></form>`);
}
function openTaxonomy(operation, kind, id) {
  const item = (kind === 'category' ? state.categories : state.subjects).find(i => i.id === id);
  formContext = { action: 'taxonomy', operation, kind, id, revision: state.revision, color: '#75dbc6' };
  modalFrame(operation === 'add' ? `A new ${kind}.` : `Rename ${item.name}.`, kind === 'category' ? 'Choose a name that makes sense to you.' : 'This subject will be available under Lessons.', `<form id="taxonomy-form"><div class="form-grid"><label class="field"><span>${kind === 'category' ? 'Category' : 'Subject'} name</span><input name="name" maxlength="40" value="${escape(item?.name || '')}" required autocomplete="off" placeholder="${kind === 'category' ? 'e.g. Outings' : 'e.g. Maths'}"></label>${kind === 'category' && operation === 'add' ? `<div class="field"><span>Colour</span><div class="color-options" role="group" aria-label="Category colour">${[['#75dbc6', 'Teal'], ['#ac9af7', 'Purple'], ['#71b6f9', 'Blue'], ['#f1ba77', 'Amber'], ['#f096a5', 'Pink']].map(([color, name], i) => `<button type="button" class="color-choice ${i === 0 ? 'selected' : ''}" data-action="choose-color" data-color="${color}" aria-label="${name}" aria-pressed="${i === 0}"><span style="background:${color}"></span></button>`).join('')}</div></div>` : ''}<div id="taxonomy-error" class="inline-error" role="alert"></div></div><div class="modal-actions"><button class="btn ghost" type="button" data-action="close-modal">Cancel</button><button class="btn">${operation === 'add' ? 'Add ' + kind : 'Save name'}</button></div></form>`);
}
function openCurrency() {
  formContext = { action: 'currency', revision: state.revision };
  modalFrame('Change currency.', `Current: ${code()} · ${currencyName(code())}. Amounts stay the same—only the label changes.`, `<form id="currency-form"><div class="form-grid"><label class="field"><span>Currency</span><select name="currency">${Object.entries(CURRENCIES).map(([c, n]) => `<option value="${c}" ${c === code() ? 'selected' : ''}>${c} · ${escape(n)}</option>`).join('')}</select></label><div class="inline-error" id="currency-error" role="alert"></div></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn" type="submit">Save currency</button></div></form>`);
}
function openTimezone() {
  formContext = { action: 'timezone', revision: state.revision };
  modalFrame('Change timezone.', `Current: ${zone()}. Day boundaries and week/month ranges use this zone.`, `<form id="timezone-form"><div class="form-grid"><label class="field"><span>Timezone</span><select name="timezone">${zoneOptions(zone())}</select></label><div class="inline-error" id="timezone-error" role="alert"></div></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn" type="submit">Save timezone</button></div></form>`);
}
function openRestore(backup, name) {
  formContext = { action: 'restore', backup, name, revision: state.revision };
  modalFrame('Restore your cash history?', 'This replaces your current records, categories, and subjects. Pocket saves a recovery copy first. Your PIN stays the same.', `<form id="restore-form" class="form-grid">${backup ? `<div class="setting-info">${backup.data?.transactions?.length ?? '?'} transactions in this file${backup.createdAt && !Number.isNaN(Date.parse(backup.createdAt)) ? ` · saved ${formatDate(backup.createdAt, { dateStyle: 'medium' })}` : ''}</div>` : ''}<label class="field"><span>Type RESTORE to confirm</span><input name="confirmation" autocomplete="off" required pattern="RESTORE" placeholder="RESTORE"></label><div class="inline-error" id="restore-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn danger">Restore backup</button></div></form>`);
}
async function saveAction(action, input, message) {
  if (pendingSave && pendingSave.action !== action) throw new Error('Check / retry your pending save before starting another change.');
  captureDraft();
  captureOpeningDraft();
  const pending = pendingSave || { action, input: { ...input, requestId: saveIdentifier() }, message };
  savePending(pending);
  try {
    const receipt = await api('request-status?' + query({ id: pending.input.requestId }));
    if (!receipt.result) await api(pending.action === 'restore' ? 'restore' : 'action/' + pending.action, pending.input);
    savePending(null); clearDraft(); modal.close(); toast(pending.message); await loadPage({ preserve: true });
  } catch (error) {
    if (!error.uncertain && error.status && error.status !== 401) {
      savePending(null);
      if (error.status === 409 && authenticated) {
        state = await api('state'); if (formContext) formContext.revision = state.revision;
        error.message += ' Your draft is kept; review it and submit again.';
      }
    }
    throw error;
  } finally { freezePendingForm(); }
}
function freezePendingForm() {
  const form = $('#entry-form') || $('#opening') || $('#restore-form'); if (!form) return;
  form.querySelectorAll('input,textarea,select,button[type=button]').forEach(control => control.disabled = Boolean(pendingSave));
  const save = form.querySelector('button[type=submit],button:not([type])'); if (save && pendingSave) save.textContent = 'Check / retry save';
}
function dateFields(old) {
  const value = old ? dateKey(transactionTime(old)) : state.today;
  return '<label class="field"><span>Transaction date</span><input type="date" name="date" value="' + value + '" max="' + state.today + '" required></label><div class="date-shortcuts"><button type="button" class="btn small ghost" data-action="entry-today">Today</button><button type="button" class="btn small ghost" data-action="entry-yesterday">Yesterday</button></div>';
}
function restoreDraft(action, old) {
  if (draft?.action === action && draft.old?.id === old?.id) {
    for (const [name, value] of Object.entries(draft.values || {})) { const input = $('#entry-form')?.elements.namedItem(name); if (input) input.value = value; }
    if (draft.categoryId) {
      formContext.categoryId = draft.categoryId;
      modal.querySelectorAll('.choice').forEach(button => { const selected = button.dataset.id === draft.categoryId; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
      $('#subject-field').innerHTML = subjectField(draft.categoryId, old);
      const subject = $('#entry-form')?.elements.namedItem('subjectId'); if (subject) subject.value = draft.values.subjectId || '';
    }
  }
  freezePendingForm();
}
function openStartDate() {
  formContext = { revision: state.revision };
  modalFrame('Tracking start date', 'Choose when your opening cash was available. Entries must follow it and every historical balance must stay non-negative.', '<form id="opening-date-form"><label class="field"><span>Tracking start date</span><input type="date" name="date" value="' + state.openingDate + '" max="' + state.today + '" required></label><div class="inline-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-modal">Cancel</button><button class="btn">Save date</button></div></form>');
}

async function submit(form, callback) {
  const buttons = [...form.querySelectorAll('button[type=submit],button:not([type])')];
  const error = form.querySelector('.inline-error'); if (error) error.textContent = '';
  buttons.forEach(b => b.disabled = true);
  try { await callback(); }
  catch (e) { if (error && error.isConnected) { error.textContent = e.message; error.scrollIntoView({ block: 'nearest' }); } else if (authenticated) toast(e.message); }
  finally { buttons.forEach(b => b.disabled = false); }
}
document.addEventListener('submit', event => {
  const form = event.target; event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  submit(form, async () => {
    if (form.id === 'login') { await api('login', values); authenticated = true; await loadPage(); if (draft && !pendingSave) openEntry(draft.action, draft.old); }
    else if (form.id === 'opening') { await saveAction('opening', { ...values, revision: state.revision }, 'Your starting cash is ready. Welcome to Pocket.'); }
    else if (form.id === 'opening-date-form') { await saveAction('opening-date', { ...values, revision: formContext.revision }, 'Tracking start date updated.'); }
    else if (form.id === 'custom-range') { if (values.from > values.to) throw new Error('Start date must be before the end date.'); customFrom = values.from; customTo = values.to; await loadPage({ preserve: true }); }
    else if (form.id === 'history-filters') { if (values.from && values.to && values.from > values.to) throw new Error('Start date must be before the end date.'); historyFilters = values; await loadPage({ preserve: true }); }
    else if (form.id === 'entry-form') {
      const ctx = formContext, input = { ...values, revision: ctx.revision };
      if (ctx.action === 'expense' || ctx.action === 'edit' && ctx.old.type === 'expense') { if (!ctx.categoryId) throw new Error('Choose a category for this expense.'); input.categoryId = ctx.categoryId; }
      if (ctx.action === 'edit') input.id = ctx.old.id;
      if (ctx.action === 'refund') input.expenseId = ctx.old.id;
      await saveAction(ctx.action, input, { expense: 'Expense saved. All accounted for.', income: 'Money added to your cash.', edit: 'Correction saved.', adjust: 'Cash balance updated.', refund: 'Refund recorded. Cash added back.' }[ctx.action]);
    }     else if (form.id === 'taxonomy-form') { await saveAction('taxonomy', { ...formContext, ...values }, 'Saved. Your categories are up to date.'); }
    else if (form.id === 'currency-form') { await saveAction('currency', { currency: values.currency, revision: formContext.revision }, 'Currency updated.'); }
    else if (form.id === 'timezone-form') { await saveAction('timezone', { timezone: values.timezone, revision: formContext.revision }, 'Timezone updated. Dates now use the new zone.'); }
    else if (form.id === 'confirm-form') { const { action, input, message } = formContext; await saveAction(action, input, message); }
    else if (form.id === 'restore-form') { await saveAction('restore', { backup: formContext.backup, name: formContext.name, revision: formContext.revision, confirmation: values.confirmation }, 'Backup restored. A recovery copy was saved.'); }
  });
});
document.addEventListener('input', event => { if (event.target.closest('#entry-form')) captureDraft(); if (event.target.closest('#opening')) captureOpeningDraft(); if (event.target.matches('#entry-form [name=amount]')) updatePreview(); });
document.addEventListener('change', async event => {
  if (event.target.closest('#entry-form')) captureDraft();
  if (event.target.closest('#opening')) captureOpeningDraft();
  if (event.target.matches('#opening [name=currency]')) {
    state.currency = event.target.value; $('#opening .amount-input > span').textContent = code();
    $('#opening [name=amount]').placeholder = currencyDigits(code()) ? '0.' + '0'.repeat(currencyDigits(code())) : '0';
  }
  if (event.target.matches('#opening [name=timezone]')) {
    const previous = state.today; state.timezone = event.target.value; state.today = dateKey(new Date().toISOString());
    const field = $('#opening [name=date]'); field.max = state.today; if (field.value === previous) field.value = state.today;
  }
  if (event.target.id === 'period') { period = event.target.value; await loadPage({ preserve: true }); }
  if (event.target.id === 'backup-file') {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 20_000_000) throw new Error('This backup file is too large.'); const backup = JSON.parse(await file.text()); if (backup.app !== 'Pocket' || !backup.data) throw new Error('Choose a Pocket backup file.'); openRestore(backup); }
    catch (error) { toast(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message); }
    event.target.value = '';
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const { action, id, kind, name } = button.dataset;
  try {
    if (pendingSave && !['retry-save', 'close-modal', 'lock', 'refresh', 'detail', 'clear-filters', 'load-more'].includes(action)) throw new Error('Check / retry your pending save before starting another change.');
    if (action === 'close-modal') { captureDraft(); modal.close(); }
    else if (action === 'retry-save') await saveAction(pendingSave.action, pendingSave.input, pendingSave.message);
    else if (action === 'opening-date') openStartDate();
    else if (action === 'entry-today' || action === 'entry-yesterday') { $('#entry-form [name=date]').value = action === 'entry-today' ? state.today : shiftCalendar(state.today, -1); captureDraft(); }
    else if (action === 'lock') { await api('logout', {}); if (!pendingSave) clearDraft(); authenticated = false; pageToken++; modal.close(); renderLogin(); }
    else if (['expense', 'income', 'adjust'].includes(action)) openEntry(action);
    else if (action === 'detail') openDetail(records.get(id));
    else if (action === 'edit-record') openEntry('edit', records.get(id));
    else if (action === 'refund-record') openEntry('refund', records.get(id));
    else if (action === 'delete-record') confirmAction('Delete this transaction?', 'Your balance and analysis will be recalculated. This is blocked if it would make your cash negative or leave an expense with linked refunds.', { action: 'delete', input: { id, revision: state.revision }, message: 'Transaction deleted.', danger: true }, 'Delete transaction');
    else if (action === 'choose-category') {
      formContext.categoryId = id;
      modal.querySelectorAll('.choice').forEach(b => { const on = b.dataset.id === id; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', on); });
      $('#subject-field').innerHTML = subjectField(id, formContext.old); captureDraft();
    } else if (action === 'choose-color') {
      formContext.color = button.dataset.color; modal.querySelectorAll('.color-choice').forEach(b => { const on = b === button; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', on); });
    } else if (action === 'refresh') await loadPage();
    else if (action === 'clear-filters') { historyFilters = {}; await loadPage({ preserve: true }); }
    else if (action === 'load-more') { button.disabled = true; const h = await api(`history?${query({ ...historyFilters, offset: historyRows.length })}`); historyRows.push(...h.rows); historyTotal = h.total; renderHistory(); }
    else if (action === 'add-item' || action === 'rename-item') openTaxonomy(action === 'add-item' ? 'add' : 'rename', kind, id);
    else if (action === 'change-currency') openCurrency();
    else if (action === 'change-timezone') openTimezone();
    else if (['archive-item', 'unarchive-item', 'delete-item'].includes(action)) {
      const operation = action.replace('-item', ''), item = (kind === 'category' ? state.categories : state.subjects).find(i => i.id === id);
      confirmAction(`${operation[0].toUpperCase() + operation.slice(1)} ${item.name}?`, operation === 'delete' ? 'Only unused items can be deleted. Items with transactions must be archived instead.' : operation === 'archive' ? 'It will stay in history and disappear from new-entry choices.' : 'It will appear in new-entry choices again.', { action: 'taxonomy', input: { kind, operation, id, revision: state.revision }, message: 'Your list has been updated.', danger: operation === 'delete' }, operation[0].toUpperCase() + operation.slice(1));
    } else if (action === 'backup') { button.disabled = true; const result = await api('backup', {}); toast('Manual backup saved. You can download it below.'); await loadPage({ preserve: true }); }
    else if (action === 'import-backup') $('#backup-file').click();
    else if (action === 'restore-backup') openRestore(undefined, name);
  } catch (error) { if (authenticated) toast(error.message); }
  finally { if (button.isConnected) button.disabled = false; }
});
modal.addEventListener('cancel', captureDraft);
window.addEventListener('hashchange', () => { captureDraft(); modal.close(); loadPage(); });
window.addEventListener('offline', () => connectionStatus(false));
window.addEventListener('online', () => { if (authenticated) api('session').catch(() => {}); });
setInterval(() => { if (authenticated && !document.hidden) api('session').catch(() => {}); }, 20000);
window.addEventListener('focus', async () => {
  if (!authenticated || modal.open || !state?.initialized || document.activeElement?.matches('input,textarea,select')) return;
  try { const fresh = await api('state'); if (fresh.revision !== state.revision || fresh.today !== state.today) await loadPage({ preserve: true }); } catch { /* Explicit actions expose connection errors without interrupting typing. */ }
});
async function boot() {
  try { const session = await api('session'); authenticated = session.authenticated; if (authenticated) { await loadPage(); if (draft && !pendingSave) openEntry(draft.action, draft.old); } else renderLogin(session.configured ? '' : 'Set a PIN on your PC before opening Pocket.'); }
  catch (error) { app.innerHTML = `<main id="main" class="auth-page"><section class="panel connection-error"><h1>Pocket is taking a moment.</h1>${errorBox(error.message)}<button class="btn" id="retry-boot">Try again</button></section></main>`; $('#retry-boot').addEventListener('click', boot); }
}
await boot();
