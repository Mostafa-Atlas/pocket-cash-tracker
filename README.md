# Pocket — local cash tracker

[![CI](https://github.com/Mostafa-Atlas/pocket-cash-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Mostafa-Atlas/pocket-cash-tracker/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)
![Deps](https://img.shields.io/badge/dependencies-0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

A private physical-cash tracker for PC and mobile. Your currency, your timezone, Sunday-first weeks. Runs locally with **zero runtime npm dependencies** — just Node.js + SQLite + vanilla HTML/CSS/JS.

> **Portfolio note:** I built this to track real cash reliably on my own PC, with correct money math, safe concurrent edits, and restorable backups. No frameworks, no cloud, no tracking.

## Screenshots

Fresh captures of the current app, taken on 1 October 2026 with disposable sample data.

**Desktop overview** — cash in hand, weekly totals, categories, and recent activity, including a backdated expense.

![Home — desktop overview with sample cash and activity](docs/screenshots/home-desktop.jpg)

**Spending analysis** — daily spending, refunds, category breakdown, and cash over time.

![Analysis — desktop spending charts with sample data](docs/screenshots/analysis-desktop.jpg)

**On your phone** — the overview and expense sheet with a chosen transaction date.

<p>
  <img src="docs/screenshots/home-mobile.jpg" alt="Mobile home with cash balance, weekly totals, and bottom navigation" width="280">
  <img src="docs/screenshots/expense-mobile.jpg" alt="Mobile expense sheet with Yesterday selected and balance preview" width="280">
</p>

<details>
<summary>Settings and verified backup status</summary>

Categories, tracking start date, currency, timezone, and local/secondary backup status. The secondary destination shown here belongs to the disposable preview.

![Settings — desktop preferences and verified sample backups](docs/screenshots/settings-desktop.jpg)

</details>

See [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md) for the capture setup.

## Features

- Cash in hand, Add Expense / Add Money, period summary, categories, recent activity
- Choose your currency at first launch; currency-specific input precision (whole yen, two decimals for EGP/USD, three for dinars); relabel later without silently rounding history
- Choose your timezone at first launch (auto-detected from your device); day, week and month boundaries follow it, changeable later in Settings
- Analysis: net spent, refunds, largest category, category breakdown, daily spending, balance over time, lesson subjects
- History: search + filters (date, category, subject, type), edit / delete / refund with revision-conflict protection
- Transaction dates: Today, Yesterday, or a chosen date; corrections preserve the original recording timestamp; balance corrections are visible adjustments excluded from spending totals
- Refunds link to an expense, can be partial, never exceed the expense; counted on return date
- Categories / lesson subjects: add, rename, archive, delete-only-when-unused
- PIN auth (salted scrypt hash), 24h HttpOnly SameSite sessions, rate-limited login, same-origin + custom-header mutation guard
- Backups: verified weekly (keep 8), manual snapshots, optional secondary destination, visible backup health, download/upload JSON, validated restore with recovery copy
- Mobile-friendly manifest, mobile bottom tabs + bottom-sheet expense form, desktop sidebar + dialog, keyboard + reduced-motion + touch friendly

## Tech stack

- **Runtime:** Node.js 24+ (uses built-in `node:http`, `node:sqlite`, `node:crypto`, `node:test` — that's why Node 24 is required)
- **Frontend:** plain HTML / CSS / JavaScript + inline SVG charts, no CDN, no frameworks
- **Storage:** SQLite locally (`data/pocket.sqlite`), money as integer thousandths, with currency-specific input precision, atomic mutations, chronological non-negative ledger validation
- **Tests:** 42 Node tests for ledger/server/recovery behavior; a Playwright suite runs browser scenarios on desktop and phone-sized Chromium layouts. Playwright is a development dependency only.

## Architecture

```text
browser (vanilla JS + SVG)
   │  same-origin JSON, x-pocket-request: 1, session cookie
   ▼
server.mjs (built-in http, CSP + host allowlist + Tailscale bind)
   │  lib/store.mjs (SQLite persistence, sessions, backups)
   │  lib/ledger.mjs (pure money rules: balance, analytics, history)
   ▼
data/pocket.sqlite (ignored by git) + backups/*.json (ignored by git)
```

Key decisions:
- Integer thousandths everywhere — exact decimal arithmetic; currency precision is enforced when entering amounts.
- Server is source of truth; no offline queue that lies about saving.
- Configured timezone boundaries, Sunday-first weeks; calendar labels never convert a local date a second time.
- Listens on loopback + detected Tailscale IPv4 only, never LAN/WAN by default.

## Quickstart

Requirements: **Node.js 24+**, Git. Optional: Tailscale on both devices for phone access.

```powershell
git clone https://github.com/Mostafa-Atlas/pocket-cash-tracker.git
cd pocket-cash-tracker
node --version
node scripts/set-pin.mjs
node server.mjs
```

Visit http://127.0.0.1:4310, enter your PIN, choose your currency and timezone, and set your opening cash. That's it — no `npm install`.

| Command | Purpose |
| --- | --- |
| `node server.mjs` / `npm start` | run production server |
| `node scripts/set-pin.mjs` / `npm run set-pin` | create / recover PIN (invalidates sessions) |
| `node --test tests/*.test.mjs` / `npm test` | run isolated temp-DB tests |
| `npm run check` | JS syntax checks |
| `node scripts/ui-preview.mjs` / `npm run preview` | disposable browser-testing app on :4311 with test PIN `24682468` |

## Requirements

- **Node.js 24 or newer**, available in your terminal as `node`. Needed for the built-in `node:sqlite` module — no dependencies to install.
- **Git** to clone the repository (or download and extract its ZIP from GitHub).
- **Tailscale on both devices**, signed into the same Tailnet, for phone access.

There are no third-party runtime npm dependencies. Browser regression testing has one optional development dependency. **You do not need to run `npm install`.** All fonts, styles, scripts, and icons are served locally. Use `nvm use` / `fnm use` with the included `.nvmrc` if you use a version manager.

## First-time setup

Open PowerShell or a terminal and run:

```powershell
git clone https://github.com/Mostafa-Atlas/pocket-cash-tracker.git
cd pocket-cash-tracker
node --version
node scripts/set-pin.mjs
```

Choose a PIN containing **4–12 digits** and enter it twice. Do this privately: digits are visible in this terminal. A fresh clone has **no default PIN, cash balance, or transactions**. Setup creates the local SQLite database and stores a salted PIN hash; your PIN is never added to the source code.

Then start Pocket:

```powershell
node server.mjs
```

Keep the terminal open. Visit [Pocket on this PC](http://127.0.0.1:4310), enter your PIN, choose your currency and timezone, and set the physical cash you currently have as your opening balance. Each unlocked browser is remembered for 24 hours.

**Already set up on this PC?** Skip the clone and PIN-setup steps. Run `node server.mjs` from the existing project folder.

## Everyday start and stop

On Windows, double-click **[start-pocket.cmd](start-pocket.cmd)**. On macOS/Linux, run `./start-pocket.sh` (first time: `chmod +x start-pocket.sh`). Alternatively, run `node server.mjs` from the project directory. `npm start` is an equivalent option when npm is working.

Press **Ctrl+C** in the server terminal to stop Pocket. Your saved records remain on disk. Launch it again when you need it; the app does not register itself to start with Windows.

## Access from your phone

1. Connect your PC and phone to the same Tailnet.
2. Start Tailscale on the PC **before** starting Pocket.
3. Start Pocket and look for the additional `http://...:4310` address printed in the terminal alongside the loopback address.
4. Open that **PC Tailnet address** in your phone's browser and enter your PIN. Do not use `127.0.0.1` on the phone; that refers to the phone itself.

The PC must stay awake and the server must stay running. By default, Pocket listens only on loopback and the detected Tailscale IPv4 interface; it does not expose the app on Wi-Fi/LAN or publish it to the internet. If Tailscale connects after Pocket starts, restart Pocket to detect it.

## Use

Home gives you cash in hand, Add Expense, Add Money, a period summary, categories, and recent activity. Analysis contains the full set of graphs. History supports search and filters; open a record to edit, delete, or refund it. Settings manages categories/subjects, balance corrections, lock, and backups.

Expense/income/refund corrections preserve their original recording timestamps. Their transaction dates can be corrected separately; History and Analysis use the transaction date. Balance corrections create new visible adjustments. An operation that would create a negative balance anywhere in the ledger is rejected. Remove dependent refunds before deleting their expense. Refunds count on the date returned, so a period can have negative net spending if it contains refunds for older purchases. Category and subject labels follow renames; archived items retain their historical association.

Pocket works without internet while this PC is reachable. It does not load or save transactions on a disconnected phone; no service worker or offline transaction queue is included. A manifest alone is not offline support. The server remains the source of truth. Revision checks prevent simultaneous browser edits from overwriting one another. Saves use persistent identifiers and receipts, so checking or retrying an unconfirmed save does not create a duplicate. Return to a page or refresh to fetch the latest data; switching back to the browser also checks for changes.

## Transaction dates and connection recovery

Choose Today, Yesterday, or a calendar date when recording an expense, money received, or a refund. Entries cannot be in the future or before the opening balance, and every historical cash balance must remain non-negative. Refunds must follow their original expense. Set the tracking start date during onboarding, or change it under Settings → Your cash when your opening cash was available earlier. Changing that date does not invent additional cash.

The connection indicator checks whether the PC is reachable. Requests time out after ten seconds. Entry drafts and pending saves are kept in this browser tab (session storage), without storing your PIN. An expired session hides the ledger; unlock to recover the draft or check the pending save. Closing the tab can discard its draft, and browser storage policies can limit recovery across refreshes. Explicitly locking clears ordinary drafts; an unconfirmed save is retained so it can be resolved after unlocking.

After a lost response, use **Check / retry save**. Pocket checks the server receipt first, then retries the same identified change if needed. Resolve a pending save before making a different change. After a revision conflict, your entry stays in the form; review it and submit again. These drafts are not a background offline queue and are never automatically submitted.

## Existing data and upgrades

Stop Pocket and refresh or close existing browser tabs before launching this version. The first launch upgrades the old integer-hundredths ledger to integer-thousandths exactly, retaining the PIN, sessions, descriptions, and timestamps. A `before-upgrade` JSON recovery snapshot preserves the original ledger before the conversion. The live database is not converted just by installing or pulling the code. Older browser code is rejected when it tries to save; refresh to load the new format.

Old JSON backups remain restorable and are converted during restoration. Existing fractional legacy JPY records remain visible exactly. New JPY entries require whole yen. Currency relabeling is blocked if existing amounts would require more decimals than the new currency supports. Currency relabeling does not perform exchange-rate conversion.

## Backups and restore

Live data is in `data/pocket.sqlite` (with SQLite WAL companions while running). This contains your ledger, salted PIN hash, and hashed session tokens. Keep it private.

Portable JSON snapshots are in `backups/`. Automatic snapshots run every seven days, starting with the first server launch. The latest eight weekly snapshots are retained. An overdue backup runs on the next launch. Manual and pre-restore recovery snapshots are retained separately.

Use Settings → Create manual backup → Download to save a copy elsewhere. Backups in the same PC/folder are useful for restoring edits; a downloaded copy on another device also survives PC loss. Backups contain financial data, not the PIN or sessions.

To restore, choose a saved snapshot or upload a downloaded JSON file in Settings, then type RESTORE. The file checksum and complete ledger are validated before anything changes. A recovery snapshot is written before replacing data. The PIN stays unchanged.

The `data/`, `backups/`, `.test-data/`, and `artifacts/` directories are ignored by Git. They are not included when you clone the repository. Never commit your live database, downloaded financial backups, or credentials.

## Secondary backups

Optionally configure a second destination before starting Pocket. Choose an external drive or a trusted network share on another device for protection against loss of this PC. A different folder on the same drive does not protect against drive failure.

```powershell
$env:POCKET_SECONDARY_BACKUP_DIR = "F:\PocketBackups"
node server.mjs
```

Or use a Windows share such as `\\your-server\backups\Pocket`. Pocket mirrors new snapshots, validates their checksum and ledger, and retains the latest eight weekly copies at that destination. Manual, pre-restore, and pre-upgrade copies remain separate. If the destination is unavailable, local backups continue; the latest snapshot is retried every minute while Pocket runs and at startup. Older snapshots created during an outage remain available locally. Settings shows the latest local validation result and the secondary copy status. Secondary snapshots contain financial data; protect access to the destination. This feature is off until you configure a path.

## Optional configuration

Set environment variables before starting the server:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4310` | Change the listening port. |
| `POCKET_DATA_DIR` | Project's `data/` folder | Local database location. |
| `POCKET_BACKUP_DIR` | Project's `backups/` folder | Portable backup location. |
| `POCKET_SECONDARY_BACKUP_DIR` | Unset | Optional external-drive/network-share snapshot destination. |

For example, to use another port in PowerShell:

```powershell
$env:PORT = "4312"
node server.mjs
```

Use the matching port in your browser. Environment changes apply to that terminal session. Stop the server before changing storage paths. Use absolute paths for custom storage locations, keep them outside Git, and set the same variables when running the PIN setup command. Changing a path does not move existing data automatically.

## PIN recovery

Run `node scripts/set-pin.mjs` (or `npm run set-pin`) on the PC to choose a new PIN. This local recovery command invalidates all remembered sessions. Enter it privately because this terminal command displays typed digits. Stop/restart Pocket when setting the first PIN on a fresh installation.

## Development and verification

- `node --test tests/*.test.mjs` (or `npm test`): isolated temporary-database tests for ledger, dates, authentication, HTTP, concurrent edits, backup/restore, and persistence.
- `npm run check`: JavaScript syntax checks.
- `npm run preview`: disposable browser-testing app on http://127.0.0.1:4311 with test PIN `24682468`, isolated `.test-data/`, never touches production.

For browser regression tests only:

```powershell
npm ci
npx playwright install chromium
npm run test:browser
```

Each browser test creates an isolated temporary ledger and server; production data is never opened. The suite exercises navigation, backdated entries, currency previews, keyboard focus, draft recovery, session expiry, stale revisions, lost responses, restores, and desktop/phone layouts. CI runs both Node and browser tests. These are simulated phone viewports; physical phone/Tailnet connectivity still requires device testing.

Implementation uses Node's built-in HTTP, SQLite, crypto, and test modules, with plain HTML/CSS/JavaScript and SVG. The SQLite module may print an experimental-feature warning in Node 24; it does not prevent startup. Everything needed by the frontend is local, without CDN or font downloads.

Physical phone connectivity requires verification from the phone. Windows/Tailnet policy can still block access even when the PC's own Tailnet address responds; no firewall or Tailnet policy is changed automatically.

## Roadmap

- [x] Screenshots in README
- [ ] Demo GIF
- [ ] CSV export / import
- [ ] Monthly budget targets with progress bar
- [ ] Light theme toggle
- [ ] Docker image for one-command self-host

Contributions welcome — open an issue first to discuss scope. No external services or tracking will be accepted.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `node` is not recognized | Install Node.js 24 or newer and reopen the terminal. |
| Error mentioning `node:sqlite` | Check `node --version`; older Node versions are unsupported. |
| Pocket asks you to set a PIN first | Run `node scripts/set-pin.mjs`, then restart the server. |
| `npm` reports a missing `npm-cli.js` | Use the direct `node` commands above; Pocket does not need npm to run. |
| `EADDRINUSE` / address already in use | Pocket or another app already uses that port. Use the running instance, stop the conflicting process, or choose another `PORT`. |
| Phone cannot connect | Check that the PC is awake, the server is running, both devices are connected to the Tailnet, and you used the PC's Tailnet address. Then check Windows Firewall and Tailnet access policy for the chosen port. |
| Data changed on another screen | Refresh to get the latest records before retrying the correction. |
| Automatic backup failed | Check free disk space and write permission for the backup directory. |

## License

MIT — see [LICENSE](LICENSE).
