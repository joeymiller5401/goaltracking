# Security model & threat notes

This document describes what the app's security measures protect against, and —
just as importantly — what they do **not**. Because this stores client names and
investment amounts, please read this before putting real client data in it, and
run it past your bank's information-security / compliance team.

## What is protected

- **Network interception** — all traffic is HTTPS (TLS), automatic on Netlify.
- **Database-at-rest exposure** — sensitive fields (client, employee, branch,
  amount, notes) are encrypted with **AES-256-GCM** in the API layer before
  being written. The database (Neon) only ever stores ciphertext, so a leak of
  the database files/backups, or access by the database provider, does **not**
  reveal plaintext PII.
- **Tampering** — GCM is authenticated encryption; modified ciphertext fails to
  decrypt rather than returning corrupted data.
- **Unauthorised access** — every data endpoint requires a valid, unexpired,
  HMAC-signed session token. Passwords are hashed with scrypt + per-user salt
  (never stored in plaintext). Account creation requires a shared signup code.
- **Common web headers** — strict CSP, clickjacking protection
  (`X-Frame-Options: DENY`), MIME sniffing protection, and `no-store` on API
  responses so PII isn't cached.

## What is NOT protected (important)

- **Compromise of the running app / its key.** This is *application-layer*
  encryption, not end-to-end. The Netlify Function holds `FIELD_ENCRYPTION_KEY`
  in memory to serve data, so anyone who can read your Netlify environment
  variables, your function logs, or run code in the function can decrypt data.
  Protect your Netlify account with SSO + strong MFA and limit who has access.
- **XSS stealing a session token.** The session token is stored in
  `localStorage`. We mitigate XSS with a strict CSP and by escaping all rendered
  content, but a successful XSS could still exfiltrate a token. Keep
  dependencies minimal (there are none on the front end) and review any future
  additions.
- **Authorization granularity.** Every signed-in user can see and edit *all*
  referrals (it's a shared team ledger). There are no roles/permissions or
  per-record access control yet.
- **Audit logging.** Creator is recorded per referral, but there is no full
  change/audit trail (who edited/deleted what, when).
- **Account recovery / password reset, rate limiting, lockout.** Not yet
  implemented. There is no brute-force throttling on login beyond what the
  platform provides.

## Key management

- `FIELD_ENCRYPTION_KEY` must be a 256-bit key (32 bytes), supplied as base64 or
  64 hex characters.
- It lives **only** in Netlify environment variables. Never commit it; never log
  it; never store it in the database.
- **Back it up securely.** If it is lost, all encrypted data is unrecoverable.
- **Key rotation** is not automated. Rotating the key requires a migration that
  decrypts with the old key and re-encrypts with the new one. Open an issue /
  ask before rotating so this can be done safely.

## Before using real client data

Because this handles client PII and financial figures at a bank, you should
confirm with your security/compliance team at minimum:

- Whether Netlify + Neon are approved vendors and meet data-residency rules.
- Whether key management must use the bank's KMS/HSM rather than an env var.
- Requirements for audit logging, access reviews, retention, and MFA/SSO.
- Whether per-user roles and least-privilege access are required.

Several of the gaps above (roles, audit log, password reset, rate limiting, KMS
integration) can be added — they were scoped out of the first version. Ask and
they can be prioritised.
