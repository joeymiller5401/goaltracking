const { ensureSchema, getAccount } = require("./_lib/db");
const { requireUser } = require("./_lib/auth");
const { json } = require("./_lib/respond");
const { BRANCHES } = require("./_lib/branches");
const { allowedBranches } = require("./_lib/advisors");

exports.handler = async (event) => {
  const token = requireUser(event);
  if (!token) return json(401, { error: "Not authenticated" });
  try {
    await ensureSchema();
    const u = await getAccount(token.sub);
    if (!u) return json(401, { error: "Not authenticated" });
    const branches = u.role === "admin" ? BRANCHES : allowedBranches(u);
    return json(200, {
      user: { id: u.id, email: u.email, name: u.name, role: u.role, branch: u.branch, advisor: u.advisor, branches },
    });
  } catch (e) {
    console.error("me error", e);
    return json(500, { error: "Server error" });
  }
};
