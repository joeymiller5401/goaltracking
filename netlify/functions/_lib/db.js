/* Neon Postgres client + lazy schema bootstrap.
 * Uses the @neondatabase/serverless HTTP driver, which is built for
 * serverless/edge runtimes (no long-lived connections to manage).
 */
const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const { BRANCHES } = require("./branches");

let _sql = null;
function sql() {
  if (!_sql) {
    // DATABASE_URL if supplied directly; otherwise the variables set by
    // Netlify's built-in Neon database extension.
    const url =
      process.env.DATABASE_URL ||
      process.env.NETLIFY_DATABASE_URL ||
      process.env.NETLIFY_DATABASE_URL_UNPOOLED;
    if (!url) throw new Error("No database URL set (DATABASE_URL or NETLIFY_DATABASE_URL)");
    _sql = neon(url);
  }
  return _sql;
}

// Readable but unguessable signup code for a branch, e.g. "red-hook-9f3a21".
function genBranchCode(branch) {
  const slug = String(branch).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug + "-" + crypto.randomBytes(3).toString("hex");
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const q = sql();

  await q`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    name text,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  // Role/branch for access control. Added via ALTER so existing tables migrate.
  await q`ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'`;
  await q`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch text`;
  // Invariant: a non-admin always has a branch; anyone without a branch is an
  // admin. This promotes pre-existing (pre-roles) accounts to admin.
  await q`UPDATE users SET role = 'admin' WHERE branch IS NULL AND role <> 'admin'`;

  await q`CREATE TABLE IF NOT EXISTS referrals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
    date date NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    enc jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
    metric text NOT NULL,
    scope text NOT NULL,
    target numeric NOT NULL,
    start_date date,
    end_date date,
    enc jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL
  )`;

  // Per-branch signup codes. Seed any branch that doesn't have one yet.
  await q`CREATE TABLE IF NOT EXISTS branch_codes (
    branch text PRIMARY KEY,
    code text NOT NULL
  )`;
  for (const b of BRANCHES) {
    await q`INSERT INTO branch_codes (branch, code) VALUES (${b}, ${genBranchCode(b)})
            ON CONFLICT (branch) DO NOTHING`;
  }

  schemaReady = true;
}

// Authoritative role/branch for a user id — looked up per request so that
// access reflects the current database state, not a possibly-stale token.
async function getAccount(id) {
  const rows = await sql()`SELECT id, email, name, role, branch FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

module.exports = { sql, ensureSchema, genBranchCode, getAccount };
