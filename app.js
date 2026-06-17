/* Referral Goal Tracker — front-end.
 * Talks to the encrypted, multi-user backend via window.Api. Data is loaded
 * into memory after sign-in and kept in sync as the user makes changes.
 */
(function () {
  "use strict";

  // ---- Branches ------------------------------------------------------------
  // The bank's branch list. Referrals and (optionally) goals are scoped to one.
  const BRANCHES = [
    "Rhinebeck", "Red Hook", "Hyde Park", "South Rd", "Mid Hudson", "Kingston",
    "East Fishkill", "Arlington", "Fishkill", "Goshen", "Warwick", "Newburgh",
  ];

  // ---- Advisors ------------------------------------------------------------
  // The asset-management advisors clients can be referred to.
  const ADVISORS = ["Brian Daly", "Joe Pillot", "Anthony Piccolino", "Jason Netrosio"];

  // ---- In-memory state (mirrors the server) --------------------------------
  let referrals = [];
  let goals = [];

  // ---- DOM helpers ---------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const fmtMoney = (n) =>
    "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMoney0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  const fmtDate = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // ---- Period helpers (dashboard) ------------------------------------------
  function periodStart(period) {
    const now = new Date();
    if (period === "ytd") return new Date(now.getFullYear(), 0, 1);
    if (period === "mtd") return new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === "qtd") {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return new Date(now.getFullYear(), q, 1);
    }
    return null;
  }
  function inPeriod(ref, period) {
    const start = periodStart(period);
    if (!start) return true;
    return new Date(ref.date + "T00:00:00") >= start;
  }

  // =========================================================================
  //  AUTH
  // =========================================================================
  const authScreen = $("#auth");
  const appRoot = $("#app");

  function showAuth() {
    appRoot.hidden = true;
    authScreen.hidden = false;
  }
  function showApp() {
    authScreen.hidden = true;
    appRoot.hidden = false;
    // Always land on the Dashboard tab on sign-in.
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "dashboard"));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-dashboard"));
    applyRole();
  }

  function isAdmin() {
    const u = Api.currentUser();
    return !!(u && u.role === "admin");
  }
  // Branches the signed-in user may work with (admins get all).
  function userBranches() {
    const u = Api.currentUser() || {};
    if (u.role === "admin") return BRANCHES.slice();
    if (Array.isArray(u.branches) && u.branches.length) return u.branches.slice();
    return u.branch ? [u.branch] : [];
  }
  // Can the user choose among multiple branches (admin or multi-branch advisor)?
  function canChooseBranch() {
    return isAdmin() || userBranches().length > 1;
  }

  // Show/hide cross-branch UI based on the signed-in user's role.
  function applyRole() {
    const u = Api.currentUser() || {};
    const admin = u.role === "admin";
    const branches = userBranches();
    // Show the user's branches (admins show "Admin").
    const roleLabel = admin ? "Admin" : branches.join(", ");
    $("#user-name").textContent = (u.name || u.email || "") + (roleLabel ? " · " + roleLabel : "");
    $("#dash-title").textContent = branches.length > 1 ? "Branch goals" : ((branches[0] || "") + " goals");
    $("#admin-panel").hidden = !admin;
    $("#advisor-panel").hidden = !admin;
    // Goals are admin-managed; hide the Goals tab from advisors/branch users.
    $$(".tab").forEach((t) => { if (t.dataset.tab === "goals") t.hidden = !admin; });
    // Single-branch users have nothing to filter, so hide the report branch filter.
    $("#rep-branch-wrap").hidden = branches.length <= 1;
    populateBranchSelects();
    if (admin) { renderBranchCodes(); renderAdvisorCodes(); }
  }

  Api.onUnauthorized = () => {
    referrals = []; goals = [];
    showAuth();
  };

  // Switch between sign-in / register
  $$(".auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.auth;
      $$(".auth-tab").forEach((b) => b.classList.toggle("active", b === btn));
      $("#login-form").hidden = which !== "login";
      $("#register-form").hidden = which !== "register";
      $("#login-error").hidden = true;
      $("#reg-error").hidden = true;
    });
  });

  function showErr(el, msg) { el.textContent = msg; el.hidden = false; }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#login-error").hidden = true;
    try {
      await Api.login({
        email: $("#login-email").value.trim(),
        password: $("#login-password").value,
      });
      showApp();
      await loadAll();
    } catch (err) {
      showErr($("#login-error"), err.message);
    }
  });

  $("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#reg-error").hidden = true;
    try {
      await Api.register({
        name: $("#reg-name").value.trim(),
        email: $("#reg-email").value.trim(),
        password: $("#reg-password").value,
        code: $("#reg-code").value.trim(),
      });
      showApp();
      await loadAll();
    } catch (err) {
      showErr($("#reg-error"), err.message);
    }
  });

  $("#logout-btn").addEventListener("click", () => {
    Api.logout();
    referrals = []; goals = [];
    showAuth();
  });

  // ---- Load everything after sign-in --------------------------------------
  async function loadAll() {
    try {
      const [refs, gls] = await Promise.all([
        Api.listReferrals(),
        Api.listGoals(),
      ]);
      referrals = refs;
      goals = gls;
      renderReferrals();
      renderGoals();
      renderDashboard();
    } catch (err) {
      // 401s are handled by onUnauthorized; surface anything else.
      if (!/authenticated/i.test(err.message)) alert("Failed to load data: " + err.message);
    }
  }

  // =========================================================================
  //  TABS
  // =========================================================================
  $("#tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const tab = btn.dataset.tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t === btn));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
    if (tab === "dashboard") renderDashboard();
    if (tab === "reports") renderReports();
  });

  // ---- Branch, advisor & employee option lists -----------------------------
  // Dropdowns reflect the signed-in user's allowed branches.
  function populateBranchSelects() {
    const opt = (v) => `<option value="${esc(v)}">${esc(v)}</option>`;
    const branchOpts = userBranches().map(opt).join("");
    $("#ref-branch").innerHTML = `<option value="">Select branch…</option>` + branchOpts;
    // Only admins can target "all branches" with a goal; others pick one.
    $("#goal-branch").innerHTML = (isAdmin() ? `<option value="">All branches</option>` : "") + branchOpts;
    $("#rep-branch").innerHTML = `<option value="all">All branches</option>` + branchOpts;

    const advisorOpts = ADVISORS.map(opt).join("");
    $("#ref-advisor").innerHTML = `<option value="">Select advisor…</option>` + advisorOpts;
    $("#rep-advisor").innerHTML = `<option value="all">All advisors</option>` + advisorOpts;
  }
  function refreshDatalists() {
    const employees = [...new Set(referrals.map((r) => r.employee).filter(Boolean))].sort();
    $("#employee-list").innerHTML = employees.map((e) => `<option value="${esc(e)}">`).join("");
  }

  // =========================================================================
  //  REFERRALS
  // =========================================================================
  const refState = { search: "", type: "all", status: "all", sortKey: "date", sortDir: -1 };

  function filteredReferrals() {
    let rows = referrals.slice();
    const q = refState.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.employee, r.advisor, r.client, r.branch, r.notes].some((v) => (v || "").toLowerCase().includes(q))
      );
    }
    if (refState.type !== "all") rows = rows.filter((r) => r.type === refState.type);
    if (refState.status !== "all") rows = rows.filter((r) => r.status === refState.status);

    const k = refState.sortKey;
    rows.sort((a, b) => {
      let av = a[k], bv = b[k];
      if (k === "amount") { av = Number(av); bv = Number(bv); }
      else { av = (av || "").toString().toLowerCase(); bv = (bv || "").toString().toLowerCase(); }
      if (av < bv) return -1 * refState.sortDir;
      if (av > bv) return 1 * refState.sortDir;
      return 0;
    });
    return rows;
  }

  function renderReferrals() {
    const tbody = $("#referrals-table tbody");
    const rows = filteredReferrals();
    $("#referrals-empty").hidden = referrals.length !== 0;
    $("#referrals-table").style.display = referrals.length === 0 ? "none" : "";

    tbody.innerHTML = rows
      .map(
        (r) => `
      <tr data-id="${esc(r.id)}">
        <td>${esc(fmtDate(r.date))}</td>
        <td>${esc(r.employee)}</td>
        <td>${esc(r.advisor || "")}</td>
        <td>${esc(r.branch || "")}</td>
        <td>${esc(r.client)}</td>
        <td><span class="badge ${esc(r.type)}">${capitalize(r.type)}</span></td>
        <td class="num">${esc(fmtMoney(r.amount))}</td>
        <td><span class="badge ${esc(r.status)}">${capitalize(r.status)}</span></td>
        <td class="muted small">${esc(r.owner || "")}</td>
        <td class="row-actions">
          <button class="link-btn" data-act="edit">Edit</button>
          <button class="link-btn del" data-act="delete">Delete</button>
        </td>
      </tr>`
      )
      .join("");
    refreshDatalists();
  }

  $$("#referrals-table thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (refState.sortKey === key) refState.sortDir *= -1;
      else { refState.sortKey = key; refState.sortDir = key === "date" || key === "amount" ? -1 : 1; }
      renderReferrals();
    });
  });

  $("#ref-search").addEventListener("input", (e) => { refState.search = e.target.value; renderReferrals(); });
  $("#ref-type-filter").addEventListener("change", (e) => { refState.type = e.target.value; renderReferrals(); });
  $("#ref-status-filter").addEventListener("change", (e) => { refState.status = e.target.value; renderReferrals(); });

  $("#referrals-table tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = e.target.closest("tr").dataset.id;
    if (btn.dataset.act === "edit") openReferralModal(id);
    else if (btn.dataset.act === "delete") {
      const r = referrals.find((x) => x.id === id);
      if (!confirm(`Delete referral for ${r ? r.client : "this client"}?`)) return;
      try {
        await Api.deleteReferral(id);
        referrals = referrals.filter((x) => x.id !== id);
        renderReferrals();
        renderDashboard();
      } catch (err) { alert("Delete failed: " + err.message); }
    }
  });

  // ---- Referral modal ------------------------------------------------------
  const refModal = $("#referral-modal");

  function openReferralModal(id) {
    const editing = referrals.find((r) => r.id === id);
    $("#referral-error").hidden = true;
    $("#referral-modal-title").textContent = editing ? "Edit referral" : "New referral";
    $("#ref-id").value = editing ? editing.id : "";
    $("#ref-date").value = editing ? editing.date : todayISO();
    $("#ref-type").value = editing ? editing.type : "initial";
    $("#ref-employee").value = editing ? editing.employee : "";
    $("#ref-advisor").value = editing ? editing.advisor || "" : "";
    if (canChooseBranch()) {
      $("#ref-branch").disabled = false;
      $("#ref-branch").value = editing ? editing.branch || "" : "";
    } else {
      // Single-branch users are pinned to their own branch.
      $("#ref-branch").value = userBranches()[0] || "";
      $("#ref-branch").disabled = true;
    }
    $("#ref-client").value = editing ? editing.client : "";
    $("#ref-amount").value = editing ? editing.amount : "";
    $("#ref-status").value = editing ? editing.status : "pending";
    $("#ref-notes").value = editing ? editing.notes || "" : "";
    refModal.hidden = false;
    $("#ref-employee").focus();
  }
  function closeReferralModal() { refModal.hidden = true; }

  $("#add-referral-btn").addEventListener("click", () => openReferralModal());
  $("#referral-cancel").addEventListener("click", closeReferralModal);
  refModal.addEventListener("click", (e) => { if (e.target === refModal) closeReferralModal(); });

  $("#referral-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#referral-error").hidden = true;
    const id = $("#ref-id").value;
    const data = {
      date: $("#ref-date").value,
      type: $("#ref-type").value,
      employee: $("#ref-employee").value.trim(),
      advisor: $("#ref-advisor").value,
      branch: canChooseBranch() ? $("#ref-branch").value : (userBranches()[0] || ""),
      client: $("#ref-client").value.trim(),
      amount: parseFloat($("#ref-amount").value) || 0,
      status: $("#ref-status").value,
      notes: $("#ref-notes").value.trim(),
    };
    try {
      if (id) {
        const updated = await Api.updateReferral(id, data);
        const i = referrals.findIndex((x) => x.id === id);
        if (i >= 0) referrals[i] = updated;
      } else {
        const created = await Api.createReferral(data);
        referrals.unshift(created);
      }
      renderReferrals();
      renderDashboard();
      closeReferralModal();
    } catch (err) {
      showErr($("#referral-error"), err.message);
    }
  });

  // =========================================================================
  //  GOALS
  // =========================================================================
  // A referral counts toward a goal if it's in the goal's branch and date range.
  function goalMatches(goal, ref) {
    if (goal.start && ref.date < goal.start) return false;
    if (goal.end && ref.date > goal.end) return false;
    if (goal.branch && (ref.branch || "").toLowerCase() !== goal.branch.toLowerCase()) return false;
    return true;
  }
  function goalMatched(goal) {
    return referrals.filter((r) => r.status !== "declined" && goalMatches(goal, r));
  }
  // Two-target progress: investment $ (all matched) and qualified (# initial).
  function goalProgress(goal) {
    const matched = goalMatched(goal);
    const amountCurrent = matched.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const qualifiedCurrent = matched.filter((r) => r.type === "initial").length;
    const amountPct = goal.amountTarget > 0 ? Math.min(100, (amountCurrent / goal.amountTarget) * 100) : 0;
    const qualifiedPct = goal.qualifiedTarget > 0 ? Math.min(100, (qualifiedCurrent / goal.qualifiedTarget) * 100) : 0;
    return { matched, amountCurrent, qualifiedCurrent, amountPct, qualifiedPct };
  }
  function scopeLabel(goal) {
    return goal.branch ? goal.branch : "All branches";
  }
  const fmtCount = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

  // Two progress rings (Investment $ and Qualified referrals) for a goal.
  function circleBlock(label, pct, cur, tgt) {
    return `<div class="circle-block">${miniDonutSVG(pct)}
      <div class="cb-info"><div class="cb-label">${esc(label)}</div>
        <div class="cb-fig"><b>${esc(cur)}</b> <span class="muted">/ ${esc(tgt)}</span></div></div></div>`;
  }
  function goalCirclesHTML(goal) {
    const p = goalProgress(goal);
    const parts = [];
    if (goal.amountTarget > 0) parts.push(circleBlock("Investment", p.amountPct, fmtMoney0(p.amountCurrent), fmtMoney0(goal.amountTarget)));
    if (goal.qualifiedTarget > 0) parts.push(circleBlock("Qualified", p.qualifiedPct, fmtCount(p.qualifiedCurrent), fmtCount(goal.qualifiedTarget)));
    return `<div class="goal-circles">${parts.join("") || '<span class="muted small">No targets set.</span>'}</div>`;
  }

  // ---- Goal detail (mini-dashboard) ---------------------------------------

  // Circular progress gauge.
  function donutSVG(pct) {
    const r = 54, c = 2 * Math.PI * r, w = 140, cx = w / 2, cy = w / 2;
    const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
    const done = pct >= 100;
    const color = done ? "#15803d" : "#1d4ed8";
    return `<svg viewBox="0 0 ${w} ${w}" width="150" height="150" class="donut" role="img">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="16"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="16"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-pct">${Math.round(pct)}%</text>
      <text x="${cx}" y="${cy + 20}" text-anchor="middle" class="donut-sub">${done ? "complete 🎉" : "complete"}</text>
    </svg>`;
  }

  // Cumulative step-area chart of progress toward the target over time.
  function lineChartSVG(goal, matched) {
    const W = 680, H = 230, padL = 60, padR = 18, padT = 18, padB = 38;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const t = (iso) => new Date(iso + "T00:00:00").getTime();
    const sorted = matched.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const firstDate = sorted.length ? sorted[0].date : todayISO();
    const lastDate = sorted.length ? sorted[sorted.length - 1].date : todayISO();
    let x0 = t(goal.start || firstDate);
    let x1 = t(goal.end || lastDate);
    if (x1 <= x0) x1 = x0 + 86400000;

    let cum = 0;
    const pts = sorted.map((r) => { cum += Number(r.amount) || 0; return { x: t(r.date), y: cum }; });
    const yMax = Math.max(goal.amountTarget, cum, 1);

    const sx = (x) => padL + ((Math.min(Math.max(x, x0), x1) - x0) / (x1 - x0)) * innerW;
    const sy = (y) => padT + innerH - (y / yMax) * innerH;

    let line = `M ${sx(x0).toFixed(1)} ${sy(0).toFixed(1)}`;
    let prevY = 0;
    pts.forEach((p) => {
      line += ` L ${sx(p.x).toFixed(1)} ${sy(prevY).toFixed(1)} L ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
      prevY = p.y;
    });
    line += ` L ${sx(x1).toFixed(1)} ${sy(prevY).toFixed(1)}`;
    const area = line + ` L ${sx(x1).toFixed(1)} ${sy(0).toFixed(1)} L ${sx(x0).toFixed(1)} ${sy(0).toFixed(1)} Z`;

    const ty = sy(goal.amountTarget);
    const baseY = sy(0);
    const fmtAxis = (v) => fmtMoney0(v);

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1d4ed8" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="#e2e8f0"/>
      <line x1="${padL}" y1="${ty.toFixed(1)}" x2="${W - padR}" y2="${ty.toFixed(1)}"
        stroke="#15803d" stroke-width="1.5" stroke-dasharray="5 4"/>
      <text x="${W - padR}" y="${(ty - 6).toFixed(1)}" text-anchor="end" class="chart-target">target ${esc(fmtAxis(goal.amountTarget))}</text>
      <path d="${area}" fill="url(#gfill)"/>
      <path d="${line}" fill="none" stroke="#1d4ed8" stroke-width="2.5"/>
      <text x="${padL - 8}" y="${baseY}" text-anchor="end" dominant-baseline="middle" class="chart-axis">0</text>
      <text x="${padL - 8}" y="${(padT + 6)}" text-anchor="end" class="chart-axis">${esc(fmtAxis(yMax))}</text>
      <text x="${padL}" y="${H - 12}" text-anchor="start" class="chart-axis">${esc(fmtDate(new Date(x0).toISOString().slice(0,10)))}</text>
      <text x="${W - padR}" y="${H - 12}" text-anchor="end" class="chart-axis">${esc(fmtDate(new Date(x1).toISOString().slice(0,10)))}</text>
    </svg>`;
  }

  // Horizontal bar chart of top contributors.
  function barChartSVG(goal, items) {
    if (!items.length) return `<p class="muted small">No data yet.</p>`;
    const top = items.slice(0, 8);
    const max = Math.max.apply(null, top.map((i) => i.value).concat([1]));
    const W = 680, labelW = 140, valW = 96, rowH = 30;
    const barMax = W - labelW - valW;
    const fmtV = (v) => fmtMoney0(v);
    let y = 0, rows = "";
    top.forEach((i) => {
      const bw = Math.max(2, (i.value / max) * barMax);
      rows += `<g transform="translate(0 ${y})">
        <text x="0" y="${rowH / 2}" dominant-baseline="middle" class="bar-label">${esc(i.label)}</text>
        <rect x="${labelW}" y="6" width="${bw.toFixed(1)}" height="${rowH - 12}" rx="4" fill="#1d4ed8"/>
        <text x="${labelW + bw + 8}" y="${rowH / 2}" dominant-baseline="middle" class="bar-val">${esc(fmtV(i.value))}</text>
      </g>`;
      y += rowH;
    });
    return `<svg viewBox="0 0 ${W} ${y}" width="100%" class="chart">${rows}</svg>`;
  }

  function statTile(label, value, sub) {
    return `<div class="stat-tile"><div class="stat-label">${esc(label)}</div>
      <div class="stat-value">${esc(value)}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}</div>`;
  }

  const goalDetailModal = $("#goal-detail-modal");
  function closeGoalDetail() { goalDetailModal.hidden = true; }
  $("#goal-detail-close").addEventListener("click", closeGoalDetail);
  goalDetailModal.addEventListener("click", (e) => { if (e.target === goalDetailModal) closeGoalDetail(); });

  function openGoalDetail(id) {
    const g = goals.find((x) => x.id === id);
    if (!g) return;
    const p = goalProgress(g);
    const matched = p.matched;

    // Two donuts (only those with a target set).
    const donuts = [];
    if (g.amountTarget > 0) donuts.push(`<div class="gd-donut"><div class="gd-donut-label">Investment</div>${donutSVG(p.amountPct)}<div class="gd-donut-fig">${esc(fmtMoney0(p.amountCurrent))} / ${esc(fmtMoney0(g.amountTarget))}</div></div>`);
    if (g.qualifiedTarget > 0) donuts.push(`<div class="gd-donut"><div class="gd-donut-label">Qualified referrals</div>${donutSVG(p.qualifiedPct)}<div class="gd-donut-fig">${esc(fmtCount(p.qualifiedCurrent))} / ${esc(fmtCount(g.qualifiedTarget))}</div></div>`);

    // Contributor breakdown by employee (by $).
    const agg = {};
    matched.forEach((r) => {
      const key = r.employee || "(unassigned)";
      agg[key] = (agg[key] || 0) + (Number(r.amount) || 0);
    });
    const items = Object.entries(agg).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

    // Stat tiles.
    const tiles = [];
    if (g.amountTarget > 0) {
      tiles.push(statTile("Investment remaining", fmtMoney0(Math.max(0, g.amountTarget - p.amountCurrent)), p.amountPct >= 100 ? "met 🎉" : ""));
    }
    if (g.qualifiedTarget > 0) {
      tiles.push(statTile("Qualified remaining", fmtCount(Math.max(0, g.qualifiedTarget - p.qualifiedCurrent)), p.qualifiedPct >= 100 ? "met 🎉" : ""));
    }
    tiles.push(statTile("Referrals", fmtCount(matched.length), matched.filter((r) => r.type === "initial").length + " initial"));
    if (matched.length) tiles.push(statTile("Avg / referral", fmtMoney0(p.amountCurrent / matched.length), ""));
    if (g.end) {
      const days = Math.ceil((new Date(g.end + "T00:00:00").getTime() - Date.now()) / 86400000);
      tiles.push(statTile("Days left", days >= 0 ? String(days) : "ended", days >= 0 ? "until " + fmtDate(g.end) : "on " + fmtDate(g.end)));
    }

    const range = [g.start ? fmtDate(g.start) : null, g.end ? fmtDate(g.end) : null].filter(Boolean).join(" – ");

    $("#goal-detail-body").innerHTML = `
      <div class="gd-head">
        <div>
          <h3>${esc(g.name)}</h3>
          <div class="goal-meta">${esc(scopeLabel(g))}${range ? " · " + esc(range) : ""}</div>
        </div>
        ${isAdmin() ? `<button class="btn" data-act="edit-from-detail" data-id="${esc(g.id)}">Edit goal</button>` : ""}
      </div>

      <div class="gd-top">
        <div class="gd-donuts">${donuts.join("")}</div>
        <div class="gd-tiles">${tiles.join("")}</div>
      </div>

      <div class="gd-section">
        <h4>Investment over time</h4>
        ${matched.length ? lineChartSVG(g, matched) : `<p class="muted small">No referrals counted toward this goal yet.</p>`}
      </div>

      <div class="gd-section">
        <h4>Top contributors</h4>
        ${barChartSVG(g, items)}
      </div>`;

    goalDetailModal.hidden = false;
  }

  function renderGoals() {
    const wrap = $("#goals-list");
    $("#goals-empty").hidden = goals.length !== 0;
    wrap.innerHTML = goals
      .map((g) => {
        const range = [g.start ? fmtDate(g.start) : null, g.end ? fmtDate(g.end) : null]
          .filter(Boolean).join(" – ");
        return `
        <div class="goal-card" data-id="${esc(g.id)}">
          <div class="goal-top">
            <div>
              <h4>${esc(g.name)}</h4>
              <div class="goal-meta">${esc(scopeLabel(g))}${range ? " · " + esc(range) : ""}</div>
            </div>
            <div class="row-actions">
              <button class="link-btn" data-act="edit-goal">Edit</button>
              <button class="link-btn del" data-act="del-goal">Delete</button>
            </div>
          </div>
          ${goalCirclesHTML(g)}
        </div>`;
      })
      .join("");
  }

  $("#goals-list").addEventListener("click", async (e) => {
    const card = e.target.closest(".goal-card");
    if (!card) return;
    const id = card.dataset.id;
    const btn = e.target.closest("[data-act]");
    if (!btn) { openGoalDetail(id); return; } // click the card body → mini-dashboard
    if (btn.dataset.act === "edit-goal") openGoalModal(id);
    else if (btn.dataset.act === "del-goal") {
      if (!confirm("Delete this goal?")) return;
      try {
        await Api.deleteGoal(id);
        goals = goals.filter((g) => g.id !== id);
        renderGoals();
        renderDashboard();
      } catch (err) { alert("Delete failed: " + err.message); }
    }
  });

  // "Edit goal" button inside the detail view.
  $("#goal-detail-body").addEventListener("click", (e) => {
    const btn = e.target.closest('[data-act="edit-from-detail"]');
    if (!btn) return;
    closeGoalDetail();
    openGoalModal(btn.dataset.id);
  });

  // ---- Goal modal ----------------------------------------------------------
  const goalModal = $("#goal-modal");

  function openGoalModal(id) {
    const editing = goals.find((g) => g.id === id);
    $("#goal-error").hidden = true;
    $("#goal-modal-title").textContent = editing ? "Edit goal" : "New goal";
    $("#goal-id").value = editing ? editing.id : "";
    $("#goal-name").value = editing ? editing.name : "";
    if (canChooseBranch()) {
      $("#goal-branch").disabled = false;
      $("#goal-branch").value = editing ? editing.branch || "" : "";
    } else {
      $("#goal-branch").value = userBranches()[0] || "";
      $("#goal-branch").disabled = true;
    }
    $("#goal-amount-target").value = editing && editing.amountTarget ? editing.amountTarget : "";
    $("#goal-qualified-target").value = editing && editing.qualifiedTarget ? editing.qualifiedTarget : "";
    // New goals default to the current calendar year (Jan 1 – Dec 31); computed
    // at open time so it rolls over automatically each year.
    const yr = new Date().getFullYear();
    $("#goal-start").value = editing ? (editing.start || "") : `${yr}-01-01`;
    $("#goal-end").value = editing ? (editing.end || "") : `${yr}-12-31`;
    goalModal.hidden = false;
    $("#goal-name").focus();
  }
  function closeGoalModal() { goalModal.hidden = true; }

  $("#add-goal-btn").addEventListener("click", () => openGoalModal());
  $("#goal-cancel").addEventListener("click", closeGoalModal);
  goalModal.addEventListener("click", (e) => { if (e.target === goalModal) closeGoalModal(); });

  $("#goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#goal-error").hidden = true;
    const id = $("#goal-id").value;
    const data = {
      name: $("#goal-name").value.trim(),
      branch: canChooseBranch() ? $("#goal-branch").value : (userBranches()[0] || ""),
      amountTarget: parseFloat($("#goal-amount-target").value) || 0,
      qualifiedTarget: parseFloat($("#goal-qualified-target").value) || 0,
      start: $("#goal-start").value || "",
      end: $("#goal-end").value || "",
    };
    try {
      if (id) {
        const updated = await Api.updateGoal(id, data);
        const i = goals.findIndex((x) => x.id === id);
        if (i >= 0) goals[i] = updated;
      } else {
        const created = await Api.createGoal(data);
        goals.push(created);
      }
      renderGoals();
      renderDashboard();
      closeGoalModal();
    } catch (err) {
      showErr($("#goal-error"), err.message);
    }
  });

  // =========================================================================
  //  DASHBOARD
  // =========================================================================

  // Small progress ring for a branch box's goal row.
  function miniDonutSVG(pct) {
    const r = 26, c = 2 * Math.PI * r, w = 64, cx = w / 2, cy = w / 2;
    const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
    const color = pct >= 100 ? "#15803d" : "#1d4ed8";
    return `<svg viewBox="0 0 ${w} ${w}" width="64" height="64">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="8"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>
      <text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="middle"
        style="font-size:13px;font-weight:800;fill:#0f172a">${Math.round(pct)}%</text>
    </svg>`;
  }

  function goalRowHTML(g) {
    return `<div class="branch-goal" data-goal-id="${esc(g.id)}" role="button" tabindex="0">
      <div class="bg-name">${esc(g.name)}</div>
      ${goalCirclesHTML(g)}
    </div>`;
  }

  function branchBoxHTML(branch) {
    const bg = goals.filter((g) => g.branch === branch);
    const body = bg.length
      ? bg.map(goalRowHTML).join("")
      : `<p class="branch-empty muted small">No goal set yet.</p>`;
    return `<div class="branch-box">
      <div class="branch-box-head">
        <h3>${esc(branch)}</h3>
        <span class="muted small">${bg.length} goal${bg.length === 1 ? "" : "s"}</span>
      </div>
      ${body}
    </div>`;
  }

  // Large "feature" goal card for the branch-user dashboard (uses the space
  // since a branch user only has one branch).
  function featureGoalCardHTML(g) {
    const p = goalProgress(g);
    const range = [g.start ? fmtDate(g.start) : null, g.end ? fmtDate(g.end) : null].filter(Boolean).join(" – ");
    const rings = [];
    if (g.amountTarget > 0) rings.push(`<div class="gf-ring"><div class="gf-ring-label">Investment</div>${donutSVG(p.amountPct)}<div class="gf-ring-fig"><b>${esc(fmtMoney0(p.amountCurrent))}</b> <span class="muted">/ ${esc(fmtMoney0(g.amountTarget))}</span></div></div>`);
    if (g.qualifiedTarget > 0) rings.push(`<div class="gf-ring"><div class="gf-ring-label">Qualified referrals</div>${donutSVG(p.qualifiedPct)}<div class="gf-ring-fig"><b>${esc(fmtCount(p.qualifiedCurrent))}</b> <span class="muted">/ ${esc(fmtCount(g.qualifiedTarget))}</span></div></div>`);

    const tiles = [];
    if (g.amountTarget > 0) tiles.push(statTile("Investment remaining", fmtMoney0(Math.max(0, g.amountTarget - p.amountCurrent)), p.amountPct >= 100 ? "met 🎉" : ""));
    if (g.qualifiedTarget > 0) tiles.push(statTile("Qualified remaining", fmtCount(Math.max(0, g.qualifiedTarget - p.qualifiedCurrent)), p.qualifiedPct >= 100 ? "met 🎉" : ""));
    tiles.push(statTile("Referrals", fmtCount(p.matched.length), p.matched.filter((r) => r.type === "initial").length + " initial"));
    if (g.end) {
      const days = Math.ceil((new Date(g.end + "T00:00:00").getTime() - Date.now()) / 86400000);
      tiles.push(statTile("Days left", days >= 0 ? String(days) : "ended", days >= 0 ? "until " + fmtDate(g.end) : "on " + fmtDate(g.end)));
    }

    return `<div class="card-block goal-feature" data-goal-id="${esc(g.id)}" role="button" tabindex="0">
      <div class="gf-head">
        <h3>${esc(g.name)}</h3>
        <span class="muted small">${esc(scopeLabel(g))}${range ? " · " + esc(range) : ""}</span>
      </div>
      <div class="gf-body">
        <div class="gf-rings">${rings.join("")}</div>
        <div class="gf-stats">${tiles.join("")}</div>
      </div>
    </div>`;
  }

  // Dashboard: multi-branch users (admin / advisor) see a box per branch; a
  // single-branch user sees large feature cards for their branch's goals.
  function renderDashboard() {
    const grid = $("#branch-goal-grid");
    if (!grid) return;
    const branches = userBranches();
    if (branches.length > 1) {
      grid.className = "branch-grid";
      grid.innerHTML = branches.map(branchBoxHTML).join("");
      const any = goals.some((g) => branches.includes(g.branch));
      $("#dash-empty").hidden = any;
      $("#dash-intro").hidden = !any;
    } else {
      const branch = branches[0] || "";
      const list = goals.filter((g) => g.branch === branch);
      grid.className = "feature-grid";
      grid.innerHTML = list.map(featureGoalCardHTML).join("");
      $("#dash-empty").hidden = list.length !== 0;
      $("#dash-intro").hidden = list.length === 0;
    }
  }

  $("#branch-goal-grid").addEventListener("click", (e) => {
    const el = e.target.closest("[data-goal-id]");
    if (el) openGoalDetail(el.dataset.goalId);
  });
  $("#branch-goal-grid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest("[data-goal-id]");
    if (el) { e.preventDefault(); openGoalDetail(el.dataset.goalId); }
  });

  // =========================================================================
  //  SETTINGS
  // =========================================================================

  // ---- Admin: branch signup codes -----------------------------------------
  async function renderBranchCodes() {
    const tbody = $("#branch-codes-table tbody");
    if (!tbody) return;
    try {
      const codes = await Api.listBranchCodes();
      tbody.innerHTML = codes
        .map(
          (c) => `<tr data-branch="${esc(c.branch)}">
            <td>${esc(c.branch)}</td>
            <td><code class="code">${esc(c.code)}</code></td>
            <td class="row-actions">
              <button class="link-btn" data-act="copy">Copy</button>
              <button class="link-btn" data-act="regen">Regenerate</button>
            </td>
          </tr>`
        )
        .join("");
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="muted">Could not load codes: ${esc(err.message)}</td></tr>`;
    }
  }

  $("#branch-codes-table tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const branch = tr.dataset.branch;
    const codeEl = tr.querySelector(".code");
    if (btn.dataset.act === "copy") {
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = prev), 1200);
      } catch (err) { /* clipboard unavailable */ }
    } else if (btn.dataset.act === "regen") {
      if (!confirm(`Regenerate the signup code for ${branch}? The old code stops working immediately.`)) return;
      try {
        const r = await Api.regenBranchCode(branch);
        codeEl.textContent = r.code;
      } catch (err) { alert("Could not regenerate: " + err.message); }
    }
  });

  // ---- Admin: advisor signup codes ----------------------------------------
  async function renderAdvisorCodes() {
    const tbody = $("#advisor-codes-table tbody");
    if (!tbody) return;
    try {
      const codes = await Api.listAdvisorCodes();
      tbody.innerHTML = codes
        .map(
          (c) => `<tr data-advisor="${esc(c.advisor)}">
            <td>${esc(c.advisor)}</td>
            <td class="muted small">${esc((c.branches || []).join(", "))}</td>
            <td><code class="code">${esc(c.code)}</code></td>
            <td class="row-actions">
              <button class="link-btn" data-act="copy">Copy</button>
              <button class="link-btn" data-act="regen">Regenerate</button>
            </td>
          </tr>`
        )
        .join("");
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">Could not load codes: ${esc(err.message)}</td></tr>`;
    }
  }

  $("#advisor-codes-table tbody").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const tr = e.target.closest("tr");
    const advisor = tr.dataset.advisor;
    const codeEl = tr.querySelector(".code");
    if (btn.dataset.act === "copy") {
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = prev), 1200);
      } catch (err) { /* clipboard unavailable */ }
    } else if (btn.dataset.act === "regen") {
      if (!confirm(`Regenerate the signup code for ${advisor}? The old code stops working immediately.`)) return;
      try {
        const r = await Api.regenAdvisorCode(advisor);
        codeEl.textContent = r.code;
      } catch (err) { alert("Could not regenerate: " + err.message); }
    }
  });

  // =========================================================================
  //  REPORTS (customizable)
  // =========================================================================
  const reportState = { dim: "branch", dimLabel: "Branch", entries: [], tot: null };
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthLabel(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return (MONTH_NAMES[m - 1] || ym) + " " + y;
  }

  function reportFilteredReferrals() {
    // Data is already scoped server-side to the user's branches, so we can read
    // the branch selector directly ("all" = all branches the user can see).
    const branchSel = $("#rep-branch").value;
    const advisorSel = $("#rep-advisor").value;
    const typeSel = $("#rep-type").value;
    const statusSel = $("#rep-status").value;
    const period = $("#rep-period").value;
    const from = $("#rep-from").value, to = $("#rep-to").value;
    return referrals.filter((r) => {
      if (period === "custom") {
        if (from && (r.date || "") < from) return false;
        if (to && (r.date || "") > to) return false;
      } else if (!inPeriod(r, period)) return false;
      if (branchSel && branchSel !== "all" && (r.branch || "") !== branchSel) return false;
      if (advisorSel !== "all" && (r.advisor || "") !== advisorSel) return false;
      if (typeSel !== "all" && r.type !== typeSel) return false;
      if (statusSel === "active") { if (r.status === "declined") return false; }
      else if (statusSel !== "all") { if (r.status !== statusSel) return false; }
      return true;
    });
  }

  function reportGroupKey(r, dim) {
    if (dim === "advisor") return r.advisor || "(unassigned)";
    if (dim === "employee") return r.employee || "(unassigned)";
    if (dim === "type") return capitalize(r.type);
    if (dim === "month") return (r.date || "").slice(0, 7);
    return r.branch || "(no branch)";
  }

  function renderReports() {
    if (!$("#rep-groupby")) return;
    const custom = $("#rep-period").value === "custom";
    $("#rep-from-wrap").hidden = !custom;
    $("#rep-to-wrap").hidden = !custom;
    const dim = $("#rep-groupby").value;
    const rows = reportFilteredReferrals();
    const sum = (arr) => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const initial = rows.filter((r) => r.type === "initial");
    const additional = rows.filter((r) => r.type === "additional");

    const cards = [
      { label: "Total investment", value: fmtMoney0(sum(rows)) },
      { label: "Initial funds", value: fmtMoney0(sum(initial)) },
      { label: "Additional funds", value: fmtMoney0(sum(additional)) },
      { label: "Qualified referrals", value: fmtCount(initial.length) },
      { label: "Referrals", value: fmtCount(rows.length) },
    ];
    $("#report-cards").innerHTML = cards
      .map((c) => `<div class="metric"><div class="label">${esc(c.label)}</div><div class="value">${esc(c.value)}</div></div>`)
      .join("");

    const groups = {};
    rows.forEach((r) => {
      const k = reportGroupKey(r, dim);
      const g = groups[k] || (groups[k] = { count: 0, qualified: 0, initial: 0, additional: 0 });
      g.count++;
      if (r.type === "initial") { g.initial += Number(r.amount) || 0; g.qualified++; }
      else g.additional += Number(r.amount) || 0;
    });
    let entries = Object.entries(groups);
    if (dim === "month") entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    else entries.sort((a, b) => (b[1].initial + b[1].additional) - (a[1].initial + a[1].additional));

    const dimLabel = { branch: "Branch", advisor: "Advisor", employee: "Employee", month: "Month", type: "Fund type" }[dim];
    $("#report-table-title").textContent = "By " + dimLabel.toLowerCase();
    $("#report-empty").hidden = entries.length !== 0;

    const fmtKey = (k) => (dim === "month" ? monthLabel(k) : k);
    $("#report-table thead").innerHTML =
      `<tr><th>${esc(dimLabel)}</th><th class="num">Referrals</th><th class="num">Qualified</th>` +
      `<th class="num">Initial $</th><th class="num">Additional $</th><th class="num">Total $</th></tr>`;
    $("#report-table tbody").innerHTML = entries
      .map(([k, v]) => `<tr>
        <td>${esc(fmtKey(k))}</td>
        <td class="num">${v.count}</td>
        <td class="num">${v.qualified}</td>
        <td class="num">${esc(fmtMoney0(v.initial))}</td>
        <td class="num">${esc(fmtMoney0(v.additional))}</td>
        <td class="num">${esc(fmtMoney0(v.initial + v.additional))}</td>
      </tr>`)
      .join("");
    const tot = rows.reduce((a, r) => {
      if (r.type === "initial") { a.initial += Number(r.amount) || 0; a.qualified++; }
      else a.additional += Number(r.amount) || 0;
      a.count++; return a;
    }, { count: 0, qualified: 0, initial: 0, additional: 0 });
    $("#report-table tfoot").innerHTML = entries.length
      ? `<tr><th>Total</th><th class="num">${tot.count}</th><th class="num">${tot.qualified}</th>` +
        `<th class="num">${esc(fmtMoney0(tot.initial))}</th><th class="num">${esc(fmtMoney0(tot.additional))}</th>` +
        `<th class="num">${esc(fmtMoney0(tot.initial + tot.additional))}</th></tr>`
      : "";

    reportState.dim = dim; reportState.dimLabel = dimLabel; reportState.entries = entries; reportState.tot = tot;
  }

  ["rep-groupby", "rep-branch", "rep-advisor", "rep-type", "rep-status", "rep-period", "rep-from", "rep-to"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.addEventListener("change", renderReports);
  });

  $("#report-export").addEventListener("click", () => {
    const cols = [reportState.dimLabel, "Referrals", "Qualified", "Initial $", "Additional $", "Total $"];
    const lines = [cols.map(csvCell).join(",")];
    reportState.entries.forEach(([k, v]) => {
      const key = reportState.dim === "month" ? monthLabel(k) : k;
      lines.push([key, v.count, v.qualified, v.initial, v.additional, v.initial + v.additional].map(csvCell).join(","));
    });
    if (reportState.tot) {
      const t = reportState.tot;
      lines.push(["Total", t.count, t.qualified, t.initial, t.additional, t.initial + t.additional].map(csvCell).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "report-" + reportState.dim + "-" + todayISO() + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // =========================================================================
  //  CSV export / import
  // =========================================================================
  const CSV_COLS = ["date", "type", "employee", "advisor", "branch", "client", "amount", "status", "notes"];

  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    const lines = [CSV_COLS.join(",")];
    referrals.forEach((r) => lines.push(CSV_COLS.map((c) => csvCell(r[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "referrals-" + todayISO() + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  async function importCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {};
    CSV_COLS.forEach((c) => (idx[c] = header.indexOf(c)));
    if (idx.amount === -1 || idx.client === -1) {
      alert("CSV must include at least 'client' and 'amount' columns. Expected headers: " + CSV_COLS.join(", "));
      return;
    }
    const toCreate = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const get = (c) => (idx[c] >= 0 ? (r[idx[c]] || "").trim() : "");
      if (!get("client") && !get("employee")) continue;
      toCreate.push({
        date: get("date") || todayISO(),
        type: get("type").toLowerCase() === "additional" ? "additional" : "initial",
        employee: get("employee"),
        advisor: get("advisor"),
        branch: get("branch"),
        client: get("client"),
        amount: parseFloat(get("amount")) || 0,
        status: ["pending", "credited", "declined"].includes(get("status").toLowerCase())
          ? get("status").toLowerCase() : "pending",
        notes: get("notes"),
      });
    }
    if (!toCreate.length) { alert("No rows to import."); return; }
    if (!confirm(`Import ${toCreate.length} referral${toCreate.length === 1 ? "" : "s"} into the shared database?`)) return;

    let added = 0, failed = 0;
    for (const rec of toCreate) {
      try {
        const created = await Api.createReferral(rec);
        referrals.unshift(created);
        added++;
      } catch (err) { failed++; }
    }
    renderReferrals();
    renderDashboard();
    alert(`Imported ${added} referral${added === 1 ? "" : "s"}.` + (failed ? ` ${failed} failed.` : ""));
  }

  $("#export-btn").addEventListener("click", exportCSV);
  $("#export-btn-2").addEventListener("click", exportCSV);
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importCSV(reader.result);
    reader.readAsText(file);
    e.target.value = "";
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeReferralModal(); closeGoalModal(); closeGoalDetail(); }
  });

  // =========================================================================
  //  INIT
  // =========================================================================
  async function init() {
    // Dropdowns are populated per-user in applyRole() once we know the account.
    if (Api.hasToken()) {
      try {
        await Api.me();   // validate the stored token
        showApp();
        await loadAll();
        return;
      } catch (e) { /* fall through to auth */ }
    }
    showAuth();
  }
  init();
})();
