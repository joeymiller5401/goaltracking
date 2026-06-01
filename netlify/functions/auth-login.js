const { sql, ensureSchema } = require("./_lib/db");
const { verifyPassword, signToken } = require("./_lib/auth");
const { json } = require("./_lib/respond");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }

  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");

  try {
    await ensureSchema();
    const q = sql();
    const rows = await q`SELECT id, email, name, password_hash FROM users WHERE email = ${email}`;
    const u = rows[0];
    // Same generic message whether the email exists or not.
    if (!u || !verifyPassword(password, u.password_hash)) {
      return json(401, { error: "Invalid email or password" });
    }
    const token = signToken({ sub: u.id, email: u.email, name: u.name });
    return json(200, { token, user: { id: u.id, email: u.email, name: u.name } });
  } catch (e) {
    console.error("login error", e);
    return json(500, { error: "Server error" });
  }
};
