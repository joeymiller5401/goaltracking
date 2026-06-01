# Referral Goal Tracker

A shared, **encrypted** web app for the asset-management team to track
investment referrals that come from the bank, so referring employees can be
credited. It distinguishes the two referral types you track — **Initial** funds
and **Additional** funds — because they are credited differently, and rolls
them up into per-employee credit totals and progress against goals.

Multiple team members sign in with their own accounts and all see the same
shared referral ledger.

## Features

- **Accounts** — per-user email/password sign-in. Registration is gated by a
  shared signup code, so only your team can create accounts.
- **Referrals** — log each referral (date, referring employee, branch, client,
  type, amount, status, notes). Search, filter, sort, edit, delete. Each row
  records who added it.
- **Credit logic** — separate, team-wide credit rates for Initial vs Additional
  funds (Settings). The dashboard estimates credit per employee.
- **Goals** — targets by total amount or referral count, scoped to all
  referrals, a single type, or a specific employee, with optional date ranges
  and live progress bars.
- **Dashboard** — Initial vs Additional totals, estimated total credit,
  credit-by-employee, and goal progress, filterable by period.
- **CSV export / import**.

## Architecture

```
Browser (static SPA)  ──HTTPS──►  Netlify Functions (API)  ──►  Neon Postgres
  index.html / app.js                 auth, referrals,            (ciphertext
  api.js (Bearer token)               goals, settings              at rest)
```

- **Front end:** plain HTML/CSS/JS, no build step. Served from the repo root.
- **API:** Netlify Functions in `netlify/functions/` (Node). Routed at `/api/*`.
- **Database:** [Neon](https://neon.tech) serverless Postgres. Tables are
  created automatically on first request.

## Security model

| Layer | What protects it |
|---|---|
| **In transit** | HTTPS/TLS (automatic on Netlify) |
| **At rest** | Neon's managed disk encryption |
| **Field-level** | Sensitive fields (client, employee, branch, amount, notes) are encrypted with **AES-256-GCM** in the function layer *before* they reach the database. Neon only ever stores ciphertext. |
| **Auth** | Passwords hashed with scrypt + per-user salt; sessions are HMAC-signed tokens with a 7-day expiry. Registration requires a shared `SIGNUP_CODE`. |
| **Headers** | Strict `Content-Security-Policy`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`; API responses are `no-store`. |

The encryption key (`FIELD_ENCRYPTION_KEY`) lives **only** in a Netlify
environment variable — never in the repo or the database. **If you lose it,
encrypted data cannot be recovered**, so back it up somewhere safe (e.g. a
password manager / your bank's secrets vault).

See [SECURITY.md](SECURITY.md) for the threat model and what this does and does
not protect against.

## Setup

### 1. Create a Neon database
Sign up at [neon.tech](https://neon.tech), create a project, and copy the
**pooled** connection string (looks like
`postgresql://user:pass@…neon.tech/db?sslmode=require`).

### 2. Generate secrets
```bash
# 256-bit field-encryption key (base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# token-signing secret (hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Configure environment variables in Netlify
In **Site settings → Environment variables**, add (see `.env.example`):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `FIELD_ENCRYPTION_KEY` | the 32-byte base64 key from step 2 |
| `AUTH_SECRET` | the hex secret from step 2 |
| `SIGNUP_CODE` | a code you share with your team |

### 4. Deploy
Connect this repo in Netlify. No build command is needed; `netlify.toml`
publishes the repo root and picks up the functions directory automatically.
Netlify installs the function dependencies (`@neondatabase/serverless`) from
`package.json`.

The first person to register (with the signup code) creates the first account;
the schema is created automatically on first use.

## Local development

```bash
npm install
npm install -g netlify-cli   # if you don't have it
# set the four env vars in your shell or a .env file, then:
netlify dev
```
`netlify dev` serves the static files and runs the functions locally at
`/api/*`. You still need a reachable `DATABASE_URL` (your Neon dev branch is
fine).

## CSV format

Headers (order doesn't matter; `client` and `amount` are required):
```
date,type,employee,branch,client,amount,status,notes
```
- `type`: `initial` or `additional` (defaults to `initial`)
- `status`: `pending`, `credited`, or `declined` (defaults to `pending`)
- `date`: `YYYY-MM-DD` (defaults to today)
