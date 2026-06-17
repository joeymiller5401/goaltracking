const { sql, ensureSchema } = require("./_lib/db");
const { hashPassword, signToken } = require("./_lib/auth");
const { json } = require("./_lib/respond");
const { BRANCHES } = require("./_lib/branches");
const { allowedBranches } = require("./_lib/advisors");

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

    // Resolve the code: admin (env) → full access; advisor code → that
    // advisor's branches; branch code → that single branch.
    let role = null, branch = null, advisor = null;
    if (process.env.SIGNUP_CODE && code === process.env.SIGNUP_CODE) {
      role = "admin";
    } else {
      const adv = await q`SELECT advisor FROM advisor_codes WHERE code = ${code}`;
      if (adv.length) {
        role = "advisor"; advisor = adv[0].advisor;
      } else {
        const br = await q`SELECT branch FROM branch_codes WHERE code = ${code}`;
        if (br.length) { role = "user"; branch = br[0].branch; }
      }
    }
    if (!role) return json(403, { error: "Invalid signup code" });

    const existing = await q`SELECT id FROM users WHERE email = ${email}`;
    if (existing.length) return json(409, { error: "An account with that email already exists" });

    const ph = hashPassword(password);
    const rows = await q`
      INSERT INTO users (email, name, password_hash, role, branch, advisor)
      VALUES (${email}, ${name}, ${ph}, ${role}, ${branch}, ${advisor})
      RETURNING id, email, name, role, branch, advisor`;
    const u = rows[0];
    const branches = role === "admin" ? BRANCHES : allowedBranches(u);
    const token = signToken({ sub: u.id, email: u.email, name: u.name, role: u.role, branch: u.branch, advisor: u.advisor });
    return json(200, { token, user: { id: u.id, email: u.email, name: u.name, role: u.role, branch: u.branch, advisor: u.advisor, branches } });
  } catch (e) {
    console.error("register error", e);
    return json(500, { error: "Server error" });
  }
};
