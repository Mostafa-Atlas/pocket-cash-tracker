# Screenshots

Portfolio images in `docs/screenshots/` show disposable sample data. The preview database and backups stay outside Git; the screenshots are committed.

## Current captures

Captured on 1 October 2026 from the updated app, using EGP and Africa/Cairo.

| File | View |
| --- | --- |
| `home-desktop.jpg` | Full desktop overview, weekly totals, categories, and recent activity |
| `analysis-desktop.jpg` | Full desktop spending and balance charts |
| `settings-desktop.jpg` | Full desktop settings, tracking start date, and verified backups |
| `home-mobile.jpg` | Phone overview and bottom navigation |
| `expense-mobile.jpg` | Phone expense sheet with Yesterday selected |

Desktop captures use the browser's default desktop viewport and full-page screenshots. Phone captures use a 390 × 844 viewport and show the visible screen. These demonstrate responsive browser layouts; they were not captured on a physical phone. Images use JPEG format.

The sample ledger contains a 2,000 EGP opening balance, 500 EGP income, eight expenses across Lessons, Transport, and Food, and a 20 EGP partial refund. Its resulting balance is 1,920 EGP, with 580 EGP net spending for the week. One transport expense was recorded a day later than its transaction date.

The secondary backup status was demonstrated with a separate disposable directory. It does not indicate that a secondary destination is enabled in the real app.

## Refresh the screenshots

1. Start the isolated preview from the project directory:

   ```powershell
   node scripts/ui-preview.mjs
   ```

   This uses `.test-data/ui` and `.test-data/ui-backups`; it never opens the production database.

2. Open `http://127.0.0.1:4311` and unlock with the preview PIN `24682468`.
3. Add sample opening cash, expenses, income, and a partial refund. Choose several dates in the current week so the charts have useful variation.
4. Capture Home, Analysis, and Settings on desktop. Switch to a 390 × 844 responsive viewport for Home and the expense sheet. Use Yesterday or a chosen date in the expense form; leave it unsaved for the capture.
5. To demonstrate secondary backup health, configure `secondaryBackupDir` on the disposable preview's `createApp` call and create a manual backup. Use a separate sample folder.
6. Save screenshots with the filenames above, check that their content is readable, and update the README captions and capture date. Keep the actual image format consistent with its extension.
7. Stop the preview with Ctrl+C when finished.
