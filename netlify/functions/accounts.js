/* Admin-only: list user accounts and deactivate/reactivate them.
 * Deactivation is reversible and blocks sign-in + ongoing access; it never
 * deletes data, so who-added-what history is preserved.
 */
const { sql, ensureSchema, getAccount } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { json } = require("./_lib/respond");
const { allowedBranches } = require("./_lib/advisors");

function scopeLabel(u) {
  if (u.role === "admin") return "All branches";
  const b = allowedBranches(u);
  return (b || []).join(", ");
}

exports.handler = async (event) => {
  const token = requireUser(event);
  if (!token) return json(401, { error: "Not authenticated" });

  try {
    await ensureSchema();
    const q = sql();
    const me = await getAccount(token.sub);
    if (!me) return json(401, { error: "Not authenticated" });
    if (me.role !== "admin") return json(403, { error: "Admins only" });

    if (event.httpMethod === "GET") {
      const rows = await q`
        SELECT u.id, u.name, u.email, u.role, u.branch, u.advisor, u.active,
               to_char(u.created_at, 'YYYY-MM-DD') AS created,
               (SELECT count(*) FROM referrals r WHERE r.owner_id = u.id) AS referral_count
        FROM users u
        ORDER BY u.created_at ASC`;
      const accounts = rows.map((u) => ({
        id: u.id, name: u.name, email: u.email, role: u.role,
        scope: scopeLabel(u), active: u.active,
        created: u.created, referralCount: Number(u.referral_count) || 0,
      }));
      return json(200, { accounts });
    }

    if (event.httpMethod === "POST") {
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const id = String(b.id || "");
      const active = !!b.active;
      if (!id) return json(400, { error: "Missing id" });
      if (id === me.id) return json(400, { error: "You can't change your own account status" });
      const upd = await q`UPDATE users SET active = ${active} WHERE id = ${id} RETURNING id`;
      if (!upd.length) return json(404, { error: "Account not found" });
      return json(200, { id, active });
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!id) return json(400, { error: "Missing id" });
      if (id === me.id) return json(400, { error: "You can't delete your own account" });
      // referrals/goals reference users with ON DELETE SET NULL, so their data
      // is preserved (only the "added by" attribution clears).
      const del = await q`DELETE FROM users WHERE id = ${id} RETURNING id`;
      if (!del.length) return json(404, { error: "Account not found" });
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("accounts error", e);
    return json(500, { error: "Server error" });
  }
};
