/* Front-end API client. Talks to the Netlify Functions backend, carrying the
 * session token as a Bearer header. The token is kept in localStorage.
 *
 * Note on storage: a Bearer token in localStorage is the common pattern for a
 * static SPA, but it is readable by any script on the page, so a successful
 * XSS would expose it. We mitigate XSS with a strict Content-Security-Policy
 * and by escaping all rendered user content.
 */
window.Api = (function () {
  "use strict";
  const TOKEN_KEY = "rgt.token";
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let user = null;
  let onUnauthorized = function () {};

  async function req(path, method, body) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch("/api" + path, {
      method: method || "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (res.status === 401) {
      token = null; user = null;
      localStorage.removeItem(TOKEN_KEY);
      onUnauthorized();
      throw new Error((data && data.error) || "Not authenticated");
    }
    if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ")");
    return data;
  }

  function setSession(r) {
    token = r.token; user = r.user;
    localStorage.setItem(TOKEN_KEY, token);
    return r.user;
  }

  return {
    hasToken() { return !!token; },
    currentUser() { return user; },
    set onUnauthorized(fn) { onUnauthorized = fn; },

    async register(d) { return setSession(await req("/auth-register", "POST", d)); },
    async login(d) { return setSession(await req("/auth-login", "POST", d)); },
    async me() { const r = await req("/auth-me"); user = r.user; return r.user; },
    logout() { token = null; user = null; localStorage.removeItem(TOKEN_KEY); },

    listReferrals() { return req("/referrals").then((r) => r.referrals); },
    createReferral(d) { return req("/referrals", "POST", d).then((r) => r.referral); },
    updateReferral(id, d) { return req("/referrals?id=" + encodeURIComponent(id), "PUT", d).then((r) => r.referral); },
    deleteReferral(id) { return req("/referrals?id=" + encodeURIComponent(id), "DELETE"); },

    listGoals() { return req("/goals").then((r) => r.goals); },
    createGoal(d) { return req("/goals", "POST", d).then((r) => r.goal); },
    updateGoal(id, d) { return req("/goals?id=" + encodeURIComponent(id), "PUT", d).then((r) => r.goal); },
    deleteGoal(id) { return req("/goals?id=" + encodeURIComponent(id), "DELETE"); },

    listBranchCodes() { return req("/branch-codes").then((r) => r.codes); },
    regenBranchCode(branch) { return req("/branch-codes", "POST", { branch }); },

    listAdvisorCodes() { return req("/advisor-codes").then((r) => r.codes); },
    regenAdvisorCode(advisor) { return req("/advisor-codes", "POST", { advisor }); },

    listAccounts() { return req("/accounts").then((r) => r.accounts); },
    setAccountActive(id, active) { return req("/accounts", "POST", { id, active }); },
    deleteAccount(id) { return req("/accounts?id=" + encodeURIComponent(id), "DELETE"); },
  };
})();
