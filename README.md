# Spendly: personal expense tracker

**Live app:** https://suhaibsdkhan.github.io/Spendly-/

A small web app for logging expenses and tracking spending by category. It runs in any
browser and can be installed as a desktop app (Chrome or Edge: "Install app" button, or the
install icon in the address bar). It works offline once installed.

## What it does
- Log an expense with amount, category, date and an optional note. Edit or delete (with undo).
- Monthly view: total spent, budget left, change vs last month, donut chart and per-category bars.
- Optional monthly budget per category (Settings or "Set budgets"). Bars turn amber at 85% and red when over.
- Add, rename or remove categories; pick your currency.
- Import a credit card statement PDF (Scotiabank format): every purchase lands in the month it
  was made, refunds cancel the original purchase, card payments are skipped, and anything already
  in the app is skipped, so overlapping statements never double count. Categories are guessed
  from the merchant, and the app remembers when you change one. The PDF is read on your device;
  nothing is uploaded.
- Export to CSV, download a JSON backup, restore a backup.

## Where the data lives
Everything is stored in the browser on the device you use (localStorage). Nothing is sent
anywhere. Each browser and device has its own copy, so use Download backup / Restore backup
to move data between them.

## Third-party code
`vendor/pdfjs/` is Mozilla's PDF.js 3.11.174 (Apache-2.0, see its LICENSE), used to read statements.

## Run it locally
The installable/offline features need the files served over http, not opened directly:

    python3 -m http.server 8000
    # open http://localhost:8000

## Hosting
It's plain static files with no build step. Every push to `main` deploys it to GitHub Pages
through `.github/workflows/pages.yml`.
