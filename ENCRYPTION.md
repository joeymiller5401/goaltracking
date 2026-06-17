# Encryption & Data Protection Overview

*Audience: information-security / compliance reviewers evaluating the Referral
Goal Tracker for use. This describes exactly how the application protects data,
and its current limitations, so it can be assessed honestly.*

---

## 1. Summary

| Concern | Control | Detail |
|---|---|---|
| Data in transit | **TLS/HTTPS** | Enforced by Netlify (browser ↔ app) and by the database connection (`sslmode=require`). |
| Sensitive fields at rest | **AES-256-GCM field-level encryption** | Applied in the application *before* data is written to the database. The database stores ciphertext only. |
| Database storage at rest | **Provider disk encryption** | Neon (managed PostgreSQL) encrypts stored data at the storage layer. |
| Passwords | **scrypt + per-user salt** | No password is ever stored or logged in plaintext. |
| Sessions | **HMAC-SHA256 signed tokens** | Stateless, 7-day expiry, signature verified in constant time. |
| Authorization | **Per-user roles + branch scoping** | Branch users can only access their own branch's data; enforced server-side. |
| Browser hardening | **CSP + security headers** | Strict Content-Security-Policy, anti-clickjacking, no-sniff, no-store on API responses. |

The system uses **three independent layers of protection** for the most
sensitive data: TLS in transit, application-layer field encryption, and the
database provider's at-rest encryption.

---

## 2. What data is stored, and what is encrypted

Sensitive personally-identifiable / financial fields are encrypted at the
application layer. Lower-sensitivity operational metadata is stored in clear
columns so the application can sort, filter, and total without decrypting
everything.

**Referrals**
- **Encrypted (AES-256-GCM):** client name, referring employee, branch,
  investment amount, notes.
- **Clear:** date, type (initial/additional), status (pending/credited/declined),
  created/updated timestamps, and the database row ID.

**Goals**
- **Encrypted:** goal name, branch.
- **Clear:** fund type (total/initial/additional), target value, date range.

**Users**
- Email, display name, **role**, **branch** stored in clear; **password** stored
  only as a scrypt hash (never reversible).

**Settings**
- Credit-rate percentages (not personal data) stored in clear.

The database provider therefore never sees plaintext client names, employees,
amounts, or notes — only ciphertext.

---

## 3. Field-level encryption details

- **Algorithm:** AES-256-GCM — a NIST-recommended authenticated encryption mode
  (confidentiality **and** integrity/tamper-detection).
- **Key size:** 256-bit (32 bytes).
- **Initialization vector (IV):** a fresh 96-bit cryptographically-random IV is
  generated for **every** encryption operation (never reused).
- **Authentication tag:** 128-bit GCM tag stored with each value. If ciphertext
  is altered, decryption **fails** rather than returning corrupted data.
- **Stored format:** each encrypted value is a small JSON object
  `{ v, iv, tag, ct }` (version, IV, tag, ciphertext — all base64). The plaintext
  is a JSON object of the sensitive fields, encrypted as a unit per row.
- **Implementation:** Node.js built-in `crypto` module (OpenSSL under the hood);
  no third-party crypto libraries are used for the encryption itself.
- **Where it runs:** inside the serverless API function, on the server side.
  Encryption happens before any database write; decryption happens after read,
  only to serve an authenticated, authorized request.

---

## 4. Key management

- **The key** (`FIELD_ENCRYPTION_KEY`) is a 256-bit value supplied as an
  environment variable in the hosting platform (Netlify).
- **It is never** committed to source control, written to the database, or
  written to application logs.
- **Generation:** 32 bytes from a cryptographically-secure random generator.
- **Separation:** the encryption key, the session-signing secret
  (`AUTH_SECRET`), and the database credentials (`DATABASE_URL`) are three
  distinct secrets.
- **Backup:** the key must be backed up securely; if lost, encrypted data is
  unrecoverable (this is by design — there is no recovery backdoor).
- **Rotation:** key rotation is currently a **manual** operation (decrypt with
  the old key, re-encrypt with the new key). It is **not** automated today.

---

## 5. Authentication & authorization

- **Passwords:** hashed with **scrypt** (a memory-hard KDF) using a unique
  16-byte random salt per user; verification uses constant-time comparison.
- **Sessions:** a stateless token signed with **HMAC-SHA256** using a server-only
  secret, with a 7-day expiry; signatures are verified in constant time. Sent as
  a Bearer token over HTTPS.
- **Accounts & roles:** every user has an account and a role:
  - **Admin** — full access across all branches.
  - **Advisor** — access restricted to the set of branches that advisor covers.
  - **Branch user** — access restricted to a single branch.
- **Server-side scoping:** a branch user's referral and goal data is filtered to
  their branch **in the API**, and create/update/delete operations are
  branch-checked. Role and branch are read from the database on **every request**
  (not trusted from the token), so revocation/role changes take effect
  immediately.
- **Registration control:** account creation requires a code. The **admin code**
  is an environment variable; **per-branch codes** are generated and stored in
  the database and can be regenerated by an admin to revoke future signups.

---

## 6. Transport & browser hardening

- All traffic is HTTPS (TLS); the database connection requires TLS.
- **Content-Security-Policy** restricts the page to same-origin scripts and
  connections (no third-party scripts or CDNs are loaded).
- **X-Frame-Options: DENY** (anti-clickjacking), **X-Content-Type-Options:
  nosniff**, **Referrer-Policy: no-referrer**.
- API responses are returned with **Cache-Control: no-store** so decrypted data
  is not cached by browsers or intermediaries.
- All user-supplied content is HTML-escaped when rendered (XSS mitigation).

---

## 7. Hosting & data location (vendors)

- **Netlify** — hosts the static front end and runs the serverless API functions.
- **Neon** — managed PostgreSQL database.
- Data residency depends on the region selected for the Neon database and should
  be set to meet the bank's requirements. Both vendors should be confirmed as
  acceptable under the bank's third-party/vendor policy.

---

## 8. Current limitations (please review)

These are stated plainly so reviewers can make an informed decision and decide
what (if anything) must be addressed before approval.

1. **Application-layer, not end-to-end.** The API function holds the encryption
   key in memory to serve data, so anyone with access to the hosting
   environment's variables, the running function, or its logs could decrypt
   data. This protects against database-provider compromise and stolen
   backups — **not** against compromise of the application/hosting account.
   *Mitigation:* protect the Netlify account with SSO + strong MFA and
   least-privilege access; restrict who can read environment variables.
2. **Key stored in an environment variable, not an HSM/KMS.** If policy requires
   keys to be managed in a hardware security module or cloud KMS, that is a
   future enhancement, not the current design.
3. **No automated key rotation.** Rotation is a manual re-encryption process.
4. **Session token stored in browser localStorage.** Mitigated by a strict CSP
   and output escaping, but a successful cross-site-scripting attack could
   expose a token. (An httpOnly-cookie scheme is a possible hardening step.)
5. **No full audit log.** The creator of each referral is recorded, but there is
   no comprehensive read/change audit trail yet.
6. **No login rate-limiting / lockout** beyond what the platform provides.
7. **Account lifecycle.** There is currently no self-service password reset, and
   no admin "deactivate user" function (codes can be regenerated to stop new
   signups, but existing accounts are not individually revocable yet).

Several of the above (KMS-backed keys, audit logging, account deactivation,
rate limiting, httpOnly cookies) can be added if required for approval.

---

## 9. Quick technical reference

- Encryption: `AES-256-GCM`, random 96-bit IV per value, 128-bit auth tag.
- Password hashing: `scrypt`, 16-byte random salt, 64-byte output, constant-time
  compare.
- Session token: `HMAC-SHA256`, 7-day expiry, constant-time verify.
- Secrets (all server-side only): `FIELD_ENCRYPTION_KEY` (data encryption),
  `AUTH_SECRET` (token signing), `DATABASE_URL` (DB credentials), `SIGNUP_CODE`
  (admin registration code).
- Crypto provider: Node.js `crypto` (OpenSSL); no custom cryptography.
