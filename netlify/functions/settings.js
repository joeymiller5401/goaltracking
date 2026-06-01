/* Shared app settings (credit rates). Not PII, so stored in clear jsonb. */
const { sql, ensureSchema, getAccount } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { json } = require("./_lib/respond");

const DEFAULTS = { rateInitial: 1.0, rateAdditional: 0.5 };
const KEY = "credit_rates";

exports.handler = async (event) => {
  const token = requireUser(event);
  if (!token) return json(401, { error: "Not authenticated" });

  try {
    await ensureSchema();
    const q = sql();
    const user = await getAccount(token.sub);
    if (!user) return json(401, { error: "Not authenticated" });

    if (event.httpMethod === "GET") {
      const rows = await q`SELECT value FROM app_settings WHERE key = ${KEY}`;
      const settings = rows.length ? Object.assign({}, DEFAULTS, rows[0].value) : DEFAULTS;
      return json(200, { settings });
    }

    if (event.httpMethod === "PUT") {
      if (user.role !== "admin") return json(403, { error: "Admins only" });
      let b;
      try { b = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Invalid JSON" }); }
      const value = {
        rateInitial: Number(b.rateInitial) || 0,
        rateAdditional: Number(b.rateAdditional) || 0,
      };
      await q`
        INSERT INTO app_settings (key, value)
        VALUES (${KEY}, ${JSON.stringify(value)}::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
      return json(200, { settings: value });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("settings error", e);
    return json(500, { error: "Server error" });
  }
};
