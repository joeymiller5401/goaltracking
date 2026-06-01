/* Referrals CRUD. Team-shared: any authenticated user sees all referrals.
 * Sensitive fields are encrypted at rest in the `enc` jsonb column.
 */
const { sql, ensureSchema } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { encrypt, decrypt } = require("./_lib/crypto");
const { json } = require("./_lib/respond");

function rowToReferral(r) {
  const d = decrypt(r.enc);
  return {
    id: r.id,
    date: r.date,
    type: r.type,
    status: r.status,
    employee: d.employee || "",
    branch: d.branch || "",
    client: d.client || "",
    amount: Number(d.amount) || 0,
    notes: d.notes || "",
    owner: r.owner_name || r.owner_email || "",
    createdAt: r.created_at,
  };
}

// Re-read a single referral (with owner join) after insert/update.
async function fetchOne(q, id) {
  const rows = await q`
    SELECT r.id, to_char(r.date, 'YYYY-MM-DD') AS date, r.type, r.status, r.enc, r.created_at,
           u.name AS owner_name, u.email AS owner_email
    FROM referrals r LEFT JOIN users u ON u.id = r.owner_id
    WHERE r.id = ${id}`;
  return rows[0] ? rowToReferral(rows[0]) : null;
}

function validate(b) {
  const date = String(b.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "A valid date is required" };
  const type = b.type === "additional" ? "additional" : "initial";
  let status = String(b.status || "pending");
  if (!["pending", "credited", "declined"].includes(status)) status = "pending";
  const amount = Number(b.amount);
  if (!(amount >= 0)) return { error: "A valid amount is required" };
  if (!String(b.client || "").trim()) return { error: "Client is required" };
  if (!String(b.employee || "").trim()) return { error: "Referring employee is required" };
  return { date, type, status, amount };
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
      const rows = await q`
        SELECT r.id, to_char(r.date, 'YYYY-MM-DD') AS date, r.type, r.status, r.enc, r.created_at,
               u.name AS owner_name, u.email AS owner_email
        FROM referrals r LEFT JOIN users u ON u.id = r.owner_id
        ORDER BY r.date DESC, r.created_at DESC`;
      return json(200, { referrals: rows.map(rowToReferral) });
    }

    if (method === "POST" || method === "PUT") {
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const v = validate(b);
      if (v.error) return json(400, { error: v.error });
      const enc = JSON.stringify(
        encrypt({ employee: b.employee, branch: b.branch, client: b.client, amount: v.amount, notes: b.notes })
      );

      if (method === "POST") {
        const ins = await q`
          INSERT INTO referrals (owner_id, date, type, status, enc)
          VALUES (${user.sub}, ${v.date}, ${v.type}, ${v.status}, ${enc}::jsonb)
          RETURNING id`;
        return json(200, { referral: await fetchOne(q, ins[0].id) });
      }

      if (!id) return json(400, { error: "Missing id" });
      const upd = await q`
        UPDATE referrals
        SET date = ${v.date}, type = ${v.type}, status = ${v.status}, enc = ${enc}::jsonb, updated_at = now()
        WHERE id = ${id}
        RETURNING id`;
      if (!upd.length) return json(404, { error: "Referral not found" });
      return json(200, { referral: await fetchOne(q, id) });
    }

    if (method === "DELETE") {
      if (!id) return json(400, { error: "Missing id" });
      await q`DELETE FROM referrals WHERE id = ${id}`;
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("referrals error", e);
    return json(500, { error: "Server error" });
  }
};
