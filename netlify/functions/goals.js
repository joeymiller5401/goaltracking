/* Goals CRUD with branch access control.
 *  - Admins manage goals for any branch (or "all branches").
 *  - Branch users only see/manage goals for their own branch.
 * A goal carries two targets: an investment $ target (`target` column) and a
 * qualified-referrals count target (`qualified_target`). Goal name and branch
 * are encrypted in the `enc` blob. (`metric`/`scope` are legacy columns kept
 * for compatibility.)
 */
const { sql, ensureSchema, getAccount } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { encrypt, decrypt } = require("./_lib/crypto");
const { json } = require("./_lib/respond");
const { BRANCHES } = require("./_lib/branches");

function rowToGoal(r) {
  const d = decrypt(r.enc);
  return {
    id: r.id,
    name: d.name || "",
    branch: d.branch || "",
    amountTarget: Number(r.target) || 0,
    qualifiedTarget: Number(r.qualified_target) || 0,
    start: r.start_date || "",
    end: r.end_date || "",
  };
}

async function fetchRow(q, id) {
  const rows = await q`
    SELECT id, target, qualified_target,
           to_char(start_date, 'YYYY-MM-DD') AS start_date,
           to_char(end_date, 'YYYY-MM-DD') AS end_date,
           enc, created_at
    FROM goals WHERE id = ${id}`;
  return rows[0] ? rowToGoal(rows[0]) : null;
}

function validate(b) {
  if (!String(b.name || "").trim()) return { error: "Goal name is required" };
  const amountTarget = Number(b.amountTarget) || 0;
  const qualifiedTarget = Number(b.qualifiedTarget) || 0;
  if (amountTarget < 0 || qualifiedTarget < 0) return { error: "Targets cannot be negative" };
  if (amountTarget <= 0 && qualifiedTarget <= 0) return { error: "Set at least one target" };
  const start = b.start ? String(b.start).slice(0, 10) : null;
  const end = b.end ? String(b.end).slice(0, 10) : null;
  return { amountTarget, qualifiedTarget, start, end };
}

exports.handler = async (event) => {
  const token = requireUser(event);
  if (!token) return json(401, { error: "Not authenticated" });

  try {
    await ensureSchema();
    const q = sql();
    const user = await getAccount(token.sub);
    if (!user) return json(401, { error: "Not authenticated" });
    const isAdmin = user.role === "admin";
    const method = event.httpMethod;
    const id = event.queryStringParameters && event.queryStringParameters.id;

    if (method === "GET") {
      const rows = await q`
        SELECT id, target, qualified_target,
               to_char(start_date, 'YYYY-MM-DD') AS start_date,
               to_char(end_date, 'YYYY-MM-DD') AS end_date,
               enc, created_at
        FROM goals ORDER BY created_at ASC`;
      let out = rows.map(rowToGoal);
      if (!isAdmin) out = out.filter((g) => g.branch === user.branch);
      return json(200, { goals: out });
    }

    if (method === "POST" || method === "PUT") {
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const v = validate(b);
      if (v.error) return json(400, { error: v.error });

      // Admins may target a specific branch or "" (all branches); branch users
      // are pinned to their own branch.
      let branch;
      if (isAdmin) {
        branch = String(b.branch || "").trim();
        if (branch && !BRANCHES.includes(branch)) return json(400, { error: "Unknown branch" });
      } else {
        branch = user.branch || "";
      }
      const enc = JSON.stringify(encrypt({ name: b.name, branch }));

      if (method === "POST") {
        const ins = await q`
          INSERT INTO goals (owner_id, metric, scope, target, qualified_target, start_date, end_date, enc)
          VALUES (${user.id}, 'amount', 'total', ${v.amountTarget}, ${v.qualifiedTarget}, ${v.start}, ${v.end}, ${enc}::jsonb)
          RETURNING id`;
        return json(200, { goal: await fetchRow(q, ins[0].id) });
      }

      if (!id) return json(400, { error: "Missing id" });
      const current = await fetchRow(q, id);
      if (!current) return json(404, { error: "Goal not found" });
      if (!isAdmin && current.branch !== user.branch) return json(403, { error: "Not allowed" });

      const upd = await q`
        UPDATE goals
        SET target = ${v.amountTarget}, qualified_target = ${v.qualifiedTarget},
            start_date = ${v.start}, end_date = ${v.end}, enc = ${enc}::jsonb
        WHERE id = ${id}
        RETURNING id`;
      if (!upd.length) return json(404, { error: "Goal not found" });
      return json(200, { goal: await fetchRow(q, id) });
    }

    if (method === "DELETE") {
      if (!id) return json(400, { error: "Missing id" });
      if (!isAdmin) {
        const current = await fetchRow(q, id);
        if (!current) return json(404, { error: "Goal not found" });
        if (current.branch !== user.branch) return json(403, { error: "Not allowed" });
      }
      await q`DELETE FROM goals WHERE id = ${id}`;
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("goals error", e);
    return json(500, { error: "Server error" });
  }
};
