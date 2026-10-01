import { test as base, expect } from '@playwright/test';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server.mjs';
import { dateKey } from '../../lib/ledger.mjs';
import { shiftCalendar } from '../../public/domain.js';

const PIN = '24682468';
const test = base.extend({
  pocket: async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), 'pocket-browser-'));
    const app = createApp({ dataDir: join(root, 'data'), backupDir: join(root, 'backups'), secondaryBackupDir: join(root, 'secondary'), pin: PIN });
    const today = dateKey(new Date().toISOString());
    app.store.update('opening', { revision: 0, amount: '100', date: shiftCalendar(today, -7), timezone: 'Africa/Cairo' });
    const server = http.createServer(app.handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await use({ app, today, url: `http://127.0.0.1:${server.address().port}` }); }
    finally { await new Promise(resolve => server.close(resolve)); app.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
async function unlock(page, url) {
  await page.goto(url); await page.getByRole('textbox', { name: 'Your PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock Pocket' }).click();
  await expect(page.getByRole('button', { name: 'Add Expense', exact: true })).toBeVisible();
}
async function expense(page, amount = '10') {
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount EGP' }).fill(amount);
  await page.getByRole('button', { name: 'Food', exact: true }).click();
}

test('CSV download respects applied filters and includes results beyond the first page', async ({ page, pocket }) => {
  for (let i = 0; i < 55; i++) pocket.app.store.update('expense', { revision: pocket.app.store.state().revision, amount: '1', categoryId: 'food', description: 'Sample lunch ' + i });
  pocket.app.store.update('expense', { revision: pocket.app.store.state().revision, amount: '2', categoryId: 'transport', description: 'Excluded bus fare' });
  await unlock(page, pocket.url);
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('combobox', { name: 'Category', exact: true }).selectOption('food');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  await expect(page.getByText('All matching transactions · 55 records', { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^pocket-history-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.trim().split('\r\n')).toHaveLength(56);
  expect(csv).toContain('Sample lunch 54'); expect(csv).toContain('Sample lunch 0'); expect(csv).not.toContain('Excluded bus fare');
});

test('overall and category budgets save, report overspending, remove, and preserve actual cash', async ({ page, pocket }) => {
  await unlock(page, pocket.url);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set Overall spending budget', exact: true }).click();
  await page.getByRole('textbox', { name: 'Monthly target · EGP', exact: true }).fill('50');
  await page.getByRole('button', { name: 'Save target', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Overall spending budget', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set Food budget', exact: true }).click();
  await page.getByRole('textbox', { name: 'Monthly target · EGP', exact: true }).fill('10');
  await page.getByRole('button', { name: 'Save target', exact: true }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expense(page, '15'); await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('85.00');
  await expect(page.getByRole('progressbar', { name: 'Overall spending monthly budget', exact: true })).toHaveAttribute('aria-valuenow', '30');
  await expect(page.getByRole('progressbar', { name: 'Food monthly budget', exact: true })).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByText('Over target by 5.00 EGP', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('Over target by 5.00 EGP', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Food budget', exact: true }).click();
  await page.getByRole('textbox', { name: 'Monthly target · EGP', exact: true }).fill('');
  await page.getByRole('button', { name: 'Save target', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set Food budget', exact: true })).toBeVisible();
  expect(pocket.app.store.state().budgets.categories).toEqual({});
});

test('light theme persists through reload, navigation, PIN lock and syncs to another tab', async ({ page, context, pocket }) => {
  await unlock(page, pocket.url);
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f7f5');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.locator('#theme-name')).toHaveText('Light');
  await page.getByRole('button', { name: 'Set Overall spending budget', exact: true }).click();
  const colors = await page.getByRole('dialog').evaluate(dialog => ({ color: getComputedStyle(dialog).color, background: getComputedStyle(dialog).backgroundColor }));
  expect(colors).toEqual({ color: 'rgb(23, 41, 32)', background: 'rgb(255, 255, 255)' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const other = await context.newPage(); await other.goto(pocket.url);
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); await expect(page.locator('#theme-name')).toHaveText('Dark');
  await page.getByRole('button', { name: 'Lock now', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your PIN', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('theme switching still works when browser preference storage is blocked', async ({ page, context, pocket }) => {
  await context.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }); });
  await unlock(page, pocket.url);
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText('Theme changed for now. This browser could not save the preference.', { exact: true })).toBeVisible();
});

test('a lost budget save response is recovered after reload without duplicate mutations', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Set Overall spending budget', exact: true }).click();
  await page.getByRole('textbox', { name: 'Monthly target · EGP', exact: true }).fill('50');
  const before = pocket.app.store.state().revision;
  await page.route('**/api/action/budget', async route => { await route.fetch(); await route.abort('connectionfailed'); });
  await page.getByRole('button', { name: 'Save target', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Monthly target · EGP', exact: true })).toBeDisabled();
  await page.unroute('**/api/action/budget'); await page.reload();
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Overall spending budget', exact: true })).toBeVisible();
  expect(pocket.app.store.state().revision).toBe(before + 1); expect(pocket.app.store.state().budgets.overall).toBe(50000);
});
test('entry dates, history, analysis timezone and secondary backup health', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await expense(page);
  await page.getByRole('button', { name: 'Yesterday', exact: true }).click();
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('90.00');
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.locator('.history-day').first()).not.toHaveText('Today');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Latest local backup verified.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Secondary backup: last copied/)).toBeVisible();
  await page.locator('.setting-row').filter({ hasText: 'Timezone' }).getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('combobox', { name: 'Timezone', exact: true }).selectOption('Pacific/Auckland');
  await page.getByRole('button', { name: 'Save timezone', exact: true }).click();
  await page.getByRole('link', { name: 'Analysis', exact: true }).click();
  await expect(page.getByText(/All dates use Pacific\/Auckland/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('missing response is resolved from receipt exactly once, including after reload', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await expense(page);
  await page.route('**/api/action/expense', async route => { await route.fetch(); await route.abort('connectionfailed'); });
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check / retry save', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount EGP' })).toHaveValue('10');
  await page.unroute('**/api/action/expense'); await page.reload();
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('90.00');
  expect(pocket.app.store.state().transactions.filter(t => t.type === 'expense')).toHaveLength(1);
});
test('connection loss before save preserves a draft and succeeds after reconnecting', async ({ page, context, pocket }) => {
  await unlock(page, pocket.url); await expense(page, '5');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check / retry save', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount EGP' })).toHaveValue('5');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('95.00');
});
test('expired sessions recover the entry after unlocking, and keyboard focus stays in the dialog', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await expense(page, '7');
  await page.getByRole('textbox', { name: 'Description · optional' }).fill('Draft to recover');
  await page.getByRole('textbox', { name: 'Amount EGP' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('dialog :focus')).toHaveCount(1);
  pocket.app.store.db.exec('DELETE FROM sessions');
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your PIN' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock Pocket' }).click();
  // A pending save is checked explicitly after authentication rather than silently submitted.
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('93.00');
  expect(pocket.app.store.state().transactions.find(t => t.type === 'expense').description).toBe('Draft to recover');
});
test('stale edits keep their values and can be reviewed and resubmitted', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await expense(page, '9');
  pocket.app.store.update('income', { revision: pocket.app.store.state().revision, amount: '1' });
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('#entry-error')).toContainText('Your draft is kept');
  await expect(page.getByRole('textbox', { name: 'Amount EGP' })).toHaveValue('9');
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('92.00');
});
test('currency precision reaches forms, live balance preview and displayed totals', async ({ page, pocket }) => {
  pocket.app.store.update('currency', { revision: pocket.app.store.state().revision, currency: 'KWD' });
  await unlock(page, pocket.url);
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  await page.getByRole('textbox', { name: 'Amount KWD' }).fill('0.001');
  await page.getByRole('button', { name: 'Food', exact: true }).click();
  await expect(page.locator('#balance-preview strong')).toHaveText('99.999 KWD');
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('99.999');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('unsaved form drafts survive closing and refreshing without being automatically saved', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await expense(page, '3');
  await page.getByRole('textbox', { name: 'Description · optional' }).fill('Keep this draft');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Amount EGP' })).toHaveValue('3');
  await expect(page.getByRole('textbox', { name: 'Description · optional' })).toHaveValue('Keep this draft');
  expect(pocket.app.store.state().transactions).toHaveLength(1);
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('97.00');
});
test('restore with a lost response is checked safely after reloading', async ({ page, pocket }) => {
  const { name } = pocket.app.store.backup();
  pocket.app.store.update('expense', { revision: pocket.app.store.state().revision, amount: '20', categoryId: 'food' });
  await unlock(page, pocket.url); await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('.backup-list .setting-row').filter({ has: page.locator(`[data-name="${name}"]`) }).getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('textbox', { name: 'Type RESTORE to confirm' }).fill('RESTORE');
  await page.route('**/api/restore', async route => { await route.fetch(); await route.abort('connectionfailed'); });
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click();
  await expect(page.locator('#restore-error')).toContainText('not confirmed');
  await page.unroute('**/api/restore'); await page.reload();
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  expect(pocket.app.store.state().transactions).toHaveLength(1);
  expect(pocket.app.store.backups().filter(b => b.kind === 'before-restore')).toHaveLength(1);
});
test('first-run currency/date choices survive a lost opening response', async ({ page, pocket }) => {
  pocket.app.store.set('state', { ...pocket.app.store.state(), revision: 0, initialized: false, currency: null, timezone: null, transactions: [] });
  await page.goto(pocket.url); await page.getByRole('textbox', { name: 'Your PIN' }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock Pocket' }).click();
  await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('KWD');
  await page.getByRole('combobox', { name: 'Timezone', exact: true }).selectOption('Pacific/Auckland');
  await page.getByRole('textbox', { name: 'Your current cash KWD' }).fill('20.001');
  await page.route('**/api/action/opening', async route => { await route.fetch(); await route.abort('connectionfailed'); });
  await page.getByRole('button', { name: /Let's get started/ }).click();
  await expect(page.locator('#opening-error')).toContainText('not confirmed');
  await page.unroute('**/api/action/opening'); await page.reload();
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('20.001');
  expect(pocket.app.store.state().transactions).toHaveLength(1);
});
test('pending saves stay recoverable when the initial state cannot load after refresh', async ({ page, pocket }) => {
  await unlock(page, pocket.url); await expense(page, '4');
  await page.route('**/api/action/expense', async route => { await route.fetch(); await route.abort('connectionfailed'); });
  await page.getByRole('button', { name: 'Save expense', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check / retry save', exact: true })).toBeVisible();
  await page.unroute('**/api/action/expense');
  await page.route('**/api/state', route => route.abort('connectionfailed')); await page.reload();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check / retry save', exact: true })).toBeVisible();
  await page.unroute('**/api/state');
  await page.getByRole('button', { name: 'Check / retry save', exact: true }).click();
  await expect(page.locator('.balance-amount')).toContainText('96.00');
  expect(pocket.app.store.state().transactions.filter(t => t.type === 'expense')).toHaveLength(1);
});
