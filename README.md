# Referral Goal Tracker

A lightweight web app for the asset-management team to track investment
referrals that come from the bank, so referring employees can be credited.

It distinguishes the two referral types you track — **Initial** funds and
**Additional** funds — because they are credited differently, and it rolls
those up into per-employee credit totals and progress against goals.

## Features

- **Referrals** — log each referral with date, referring employee, branch,
  client, type (Initial / Additional), amount, status, and notes. Search,
  filter, sort, edit, and delete.
- **Credit logic** — set separate credit rates for Initial vs Additional funds
  in **Settings**. The dashboard estimates credit per employee from those rates.
- **Goals** — set targets by total amount or referral count, scoped to all
  referrals, a single type, or a specific employee, with optional date ranges.
  Each goal shows a live progress bar.
- **Dashboard** — totals for Initial vs Additional funds, estimated total
  credit, a credit-by-employee table, and goal progress. Filter by period
  (all time / YTD / QTD / MTD).
- **CSV export / import** — back up or bulk-load referrals.

## How data is stored

Data is saved in your browser's **localStorage** — there is no backend, which
is what keeps this deployable on Netlify with zero setup. Notes:

- Data lives in the browser/profile you use. It is **not** shared between
  people or devices automatically.
- Use **Export CSV** regularly to keep a backup, and **Import CSV** to move
  data to another machine.

If the team later needs shared, multi-user data, this can be extended with a
backend (e.g. Netlify Functions + a hosted database) without changing the UI.

## Running locally

It's a static site, so just open `index.html` in a browser, or serve the
folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploying to Netlify

This repo is build-free; `netlify.toml` publishes the repo root.

- **Drag & drop:** zip the folder and drop it on the Netlify dashboard, or
- **Git:** connect the repo in Netlify. No build command is needed (publish
  directory is `.`).

## CSV format

The importer expects these column headers (order doesn't matter; `client` and
`amount` are required):

```
date,type,employee,branch,client,amount,status,notes
```

- `type`: `initial` or `additional` (defaults to `initial`)
- `status`: `pending`, `credited`, or `declined` (defaults to `pending`)
- `date`: `YYYY-MM-DD` (defaults to today)
