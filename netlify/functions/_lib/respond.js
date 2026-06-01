/* Shared JSON response helper. Always no-store: responses can contain
 * decrypted PII and must never be cached by browsers or proxies.
 */
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
module.exports = { json };
