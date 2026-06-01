const { requireUser } = require("./_lib/auth");
const { json } = require("./_lib/respond");

exports.handler = async (event) => {
  const u = requireUser(event);
  if (!u) return json(401, { error: "Not authenticated" });
  return json(200, { user: { id: u.sub, email: u.email, name: u.name } });
};
