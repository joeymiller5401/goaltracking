/* Goals CRUD. Team-shared. Goal name and target-employee are encrypted;
 * metric/scope/target/date-range stay in clear columns for filtering.
 */
const { sql, ensureSchema } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { encrypt, decrypt } = require("./_lib/crypto");
const { json } = require("./_lib/respond");

const SELECT = (q, where) => q`
  SELECT id, metric, scope, target,
         to_char(start_date, 'YYYY-MM-DD') AS start_date,
         to_char(end_date, 'YYYY-MM-DD') AS end_date,
         enc, created_at
  FROM goals
  ${where}`;

function rowToGoal(r) {
  const d = decrypt(r.enc);
  return {
    id: r.id,
    name: d.name || "",
    employee: d.employee || "",
    metric: r.metric,
    scope: r.scope,
    target: Number(r.target) || 0,
    start: r.start_date || "",
    end: r.end_date || "",
  };
}

function validate(b) {
  if (!String(b.name || "").trim()) return { error: "Goal name is required" };
  const metric = b.metric === "count" ? "count" : "amount";
  const scope = ["all", "initial", "additional", "employee"].includes(b.scope) ? b.scope : "all";
  const target = Number(b.target);
  if (!(target >= 0)) return { error: "A valid target is required" };
  const start = b.start ? String(b.start).slice(0, 10) : null;
  const end = b.end ? String(b.end).slice(0, 10) : null;
  return { metric, scope, target, start, end };
}

exports.handler = async (event) => {
  const user = requireUser(event);
  if (!user) return json(401, { error: "Not authenticated" });

  try {
    await ensureSchema();
    const q = sql();
    const method = event.httpMethod;
    const id = event.queryStringParameters && event.queryStringParameters.id;

    if (method === "GET") {
      const rows = await SELECT(q, q`ORDER BY created_at ASC`);
      return json(200, { goals: rows.map(rowToGoal) });
    }

    if (method === "POST" || method === "PUT") {
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const v = validate(b);
      if (v.error) return json(400, { error: v.error });
      const enc = JSON.stringify(encrypt({ name: b.name, employee: b.employee || "" }));

      if (method === "POST") {
        const ins = await q`
          INSERT INTO goals (owner_id, metric, scope, target, start_date, end_date, enc)
          VALUES (${user.sub}, ${v.metric}, ${v.scope}, ${v.target}, ${v.start}, ${v.end}, ${enc}::jsonb)
          RETURNING id`;
        const rows = await SELECT(q, q`WHERE id = ${ins[0].id}`);
        return json(200, { goal: rowToGoal(rows[0]) });
      }

      if (!id) return json(400, { error: "Missing id" });
      const upd = await q`
        UPDATE goals
        SET metric = ${v.metric}, scope = ${v.scope}, target = ${v.target},
            start_date = ${v.start}, end_date = ${v.end}, enc = ${enc}::jsonb
        WHERE id = ${id}
        RETURNING id`;
      if (!upd.length) return json(404, { error: "Goal not found" });
      const rows = await SELECT(q, q`WHERE id = ${id}`);
      return json(200, { goal: rowToGoal(rows[0]) });
    }

    if (method === "DELETE") {
      if (!id) return json(400, { error: "Missing id" });
      await q`DELETE FROM goals WHERE id = ${id}`;
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("goals error", e);
    return json(500, { error: "Server error" });
  }
};
