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
  const code = String(b.code || "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "A valid email is required" });
  if (password.length < 8) return json(400, { error: "Password must be at least 8 characters" });
  if (!code) return json(400, { error: "A signup code is required" });

  try {
    await ensureSchema();
    const q = sql();

    // Resolve the code: the admin code (env) grants full access; otherwise it
    // must match a branch signup code, which ties the account to that branch.
    let role = null, branch = null;
    if (process.env.SIGNUP_CODE && code === process.env.SIGNUP_CODE) {
      role = "admin";
      branch = null;
    } else {
      const rows = await q`SELECT branch FROM branch_codes WHERE code = ${code}`;
      if (rows.length) { role = "user"; branch = rows[0].branch; }
    }
    if (!role) return json(403, { error: "Invalid signup code" });

    const existing = await q`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length) return json(409, { error: "An account with that email already exists" });

    const ph = hashPassword(password);
    const rows = await q`
      INSERT INTO users (email, name, password_hash, role, branch)
      VALUES (${email}, ${name}, ${ph}, ${role}, ${branch})
      RETURNING id, email, name, role, branch`;
    const u = rows[0];
    const token = signToken({ sub: u.id, email: u.email, name: u.name, role: u.role, branch: u.branch });
    return json(200, { token, user: { id: u.id, email: u.email, name: u.name, role: u.role, branch: u.branch } });
  } catch (e) {
    console.error("register error", e);
    return json(500, { error: "Server error" });
  }
};
