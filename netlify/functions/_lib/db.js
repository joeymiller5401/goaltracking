/* Neon Postgres client + lazy schema bootstrap.
 * Uses the @neondatabase/serverless HTTP driver, which is built for
 * serverless/edge runtimes (no long-lived connections to manage).
 */
const { neon } = require("@neondatabase/serverless");

let _sql = null;
function sql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
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
  schemaReady = true;
}

module.exports = { sql, ensureSchema };
