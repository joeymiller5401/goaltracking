/* Admin-only: view and regenerate the per-advisor signup codes. Each code lets
 * someone create an advisor account scoped to that advisor's branches.
 */
const { sql, ensureSchema, genBranchCode, getAccount } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { json } = require("./_lib/respond");
const { ADVISORS, ADVISOR_BRANCHES } = require("./_lib/advisors");

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
      const rows = await q`SELECT advisor, code FROM advisor_codes`;
      const map = {};
      rows.forEach((r) => (map[r.advisor] = r.code));
      const codes = ADVISORS.map((a) => ({ advisor: a, branches: ADVISOR_BRANCHES[a] || [], code: map[a] || "" }));
      return json(200, { codes });
    }

    if (event.httpMethod === "POST") {
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const advisor = String(b.advisor || "").trim();
      if (!ADVISORS.includes(advisor)) return json(400, { error: "Unknown advisor" });
      const code = genBranchCode(advisor);
      await q`
        INSERT INTO advisor_codes (advisor, code) VALUES (${advisor}, ${code})
        ON CONFLICT (advisor) DO UPDATE SET code = EXCLUDED.code`;
      return json(200, { advisor, code });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("advisor-codes error", e);
    return json(500, { error: "Server error" });
  }
};
