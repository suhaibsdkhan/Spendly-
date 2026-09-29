# Spendly: personal expense tracker

**Live app:** https://suhaibsdkhan.github.io/spendly-/

A small web app for logging expenses and tracking spending by category. It runs in any
browser and can be installed as a desktop app (Chrome or Edge: "Install app" button, or the
install icon in the address bar). It works offline once installed.

## What it does
- Log an expense with amount, category, date and an optional note. Edit or delete (with undo).
- Monthly view: total spent, budget left, change vs last month, donut chart and per-category bars.
- Optional monthly budget per category (Settings or "Set budgets"). Bars turn amber at 85% and red when over.
- Add, rename or remove categories; pick your currency.
- Export to CSV, download a JSON backup, restore a backup.

## Where the data lives
Everything is stored in the browser on the device you use (localStorage). Nothing is sent
anywhere. Each browser and device has its own copy, so use Download backup / Restore backup
to move data between them.

## Run it locally
The installable/offline features need the files served over http, not opened directly:

    python3 -m http.server 8000
    # open http://localhost:8000

## Hosting
It's plain static files with no build step. Every push to `main` deploys it to GitHub Pages
through `.github/workflows/pages.yml`.
