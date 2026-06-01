const { sql, ensureSchema } = require("./_lib/db");
const { hashPassword, signToken } = require("./_lib/auth");
const { json } = require("./_lib/respond");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let b;
  try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }

  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  const name = String(b.name || "").trim();
  const code = String(b.code || "");

  // Registration must be explicitly enabled and gated by a shared code so
  // that not just anyone on the internet can create an account.
  if (!process.env.SIGNUP_CODE) {
    return json(403, { error: "Registration is disabled. An administrator must set SIGNUP_CODE." });
  }
  if (code !== process.env.SIGNUP_CODE) return json(403, { error: "Invalid signup code" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "A valid email is required" });
  if (password.length < 8) return json(400, { error: "Password must be at least 8 characters" });

  try {
    await ensureSchema();
    const q = sql();
    const existing = await q`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length) return json(409, { error: "An account with that email already exists" });

    const ph = hashPassword(password);
    const rows = await q`
      INSERT INTO users (email, name, password_hash)
      VALUES (${email}, ${name}, ${ph})
      RETURNING id, email, name`;
    const u = rows[0];
    const token = signToken({ sub: u.id, email: u.email, name: u.name });
    return json(200, { token, user: { id: u.id, email: u.email, name: u.name } });
  } catch (e) {
    console.error("register error", e);
    return json(500, { error: "Server error" });
  }
};
