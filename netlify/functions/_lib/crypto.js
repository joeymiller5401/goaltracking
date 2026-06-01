/* Application-layer field encryption (AES-256-GCM).
 *
 * Sensitive PII (client name, employee, branch, amount, notes) is encrypted
 * here before it is written to Postgres, so the database only ever stores
 * ciphertext. The key lives ONLY in the FIELD_ENCRYPTION_KEY env var and is
 * never persisted to the database or the repo.
 *
 * Each value gets a fresh random 96-bit IV; GCM provides authenticated
 * encryption (tampering is detected on decrypt).
 */
const crypto = require("crypto");

let _key = null;
function key() {
  if (_key) return _key;
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEY is not set");
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must decode to 32 bytes (256-bit): use 64 hex chars or base64 of 32 bytes");
  }
  _key = buf;
  return _key;
}

// Encrypts a JS object -> storable blob { v, iv, tag, ct } (all base64).
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const pt = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

// Decrypts a blob produced by encrypt() back to the original object.
function decrypt(blob) {
  if (!blob || typeof blob !== "object") return {};
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(blob.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(blob.ct, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(pt.toString("utf8"));
}

module.exports = { encrypt, decrypt };
