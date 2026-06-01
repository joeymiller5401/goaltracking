/* Authentication helpers: password hashing (scrypt) and stateless
 * HMAC-signed session tokens. No external auth dependency.
 */
const crypto = require("crypto");

// ---- base64url ----
function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function b64urlToBuf(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

// ---- Passwords (scrypt + per-user random salt) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return "s2$" + salt.toString("hex") + "$" + hash.toString("hex");
}
function verifyPassword(pw, stored) {
  try {
    const parts = String(stored).split("$");
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const hash = crypto.scryptSync(pw, salt, expected.length);
    return crypto.timingSafeEqual(hash, expected);
  } catch (e) {
    return false;
  }
}

// ---- Session tokens (HMAC-SHA256 signed) ----
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET must be set (>= 16 chars)");
  return s;
}
function signToken(payload, ttlDays) {
  const body = Object.assign({}, payload, {
    exp: Date.now() + (ttlDays || 7) * 86400000,
  });
  const bodyB64 = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(bodyB64).digest());
  return bodyB64 + "." + sig;
}
function verifyToken(token) {
  if (!token || token.indexOf(".") < 0) return null;
  const [bodyB64, sig] = token.split(".");
  const expected = b64url(
    crypto.createHmac("sha256", secret()).update(bodyB64).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(b64urlToBuf(bodyB64).toString("utf8"));
  } catch (e) {
    return null;
  }
  if (!data.exp || data.exp < Date.now()) return null;
  return data;
}

// Pull and verify the bearer token off a Netlify function event.
function requireUser(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return null;
  return verifyToken(m[1]); // { sub, email, name, exp } or null
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireUser };
