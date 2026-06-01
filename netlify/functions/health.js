/* Diagnostic endpoint: reports whether required configuration is present and
 * whether the database is reachable. Returns ONLY booleans and error
 * messages — never the secret values themselves. Safe to remove once the
 * deployment is confirmed healthy.
 */
const { sql } = require("./_lib/db");
const { json } = require("./_lib/respond");

exports.handler = async () => {
  const env = {
    database_url:
      !!(process.env.DATABASE_URL ||
         process.env.NETLIFY_DATABASE_URL ||
         process.env.NETLIFY_DATABASE_URL_UNPOOLED),
    auth_secret: !!process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16,
    signup_code: !!process.env.SIGNUP_CODE,
    field_encryption_key: false,
  };
  try {
    const raw = process.env.FIELD_ENCRYPTION_KEY || "";
    const buf = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    env.field_encryption_key = buf.length === 32;
  } catch (e) { /* leave false */ }

  const db = { ok: false, error: null };
  try {
    const q = sql();
    const rows = await q`SELECT 1 AS ok`;
    db.ok = rows[0] && Number(rows[0].ok) === 1;
  } catch (e) {
    db.error = String((e && e.message) || e);
  }

  return json(200, { env, db });
};
