/* Admin-only: view and regenerate the per-branch signup codes that branch
 * users need to create an account. Codes are never exposed to non-admins.
 */
const { sql, ensureSchema, genBranchCode, getAccount } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { json } = require("./_lib/respond");
const { BRANCHES } = require("./_lib/branches");

exports.handler = async (event) => {
  const token = requireUser(event);
  if (!token) return json(401, { error: "Not authenticated" });

  try {
    await ensureSchema();
    const q = sql();
    const user = await getAccount(token.sub);
    if (!user) return json(401, { error: "Not authenticated" });
    if (user.role !== "admin") return json(403, { error: "Admins only" });

    if (event.httpMethod === "GET") {
      const rows = await q`SELECT branch, code FROM branch_codes`;
      const map = {};
      rows.forEach((r) => (map[r.branch] = r.code));
      // Return in the canonical branch order.
      const codes = BRANCHES.map((b) => ({ branch: b, code: map[b] || "" }));
      return json(200, { codes });
    }

    if (event.httpMethod === "POST") {
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const branch = String(b.branch || "").trim();
      if (!BRANCHES.includes(branch)) return json(400, { error: "Unknown branch" });
      const code = genBranchCode(branch);
      await q`
        INSERT INTO branch_codes (branch, code) VALUES (${branch}, ${code})
        ON CONFLICT (branch) DO UPDATE SET code = EXCLUDED.code`;
      return json(200, { branch, code });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("branch-codes error", e);
    return json(500, { error: "Server error" });
  }
};
