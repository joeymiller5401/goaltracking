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
    applyRole();
  }

  function isAdmin() {
    const u = Api.currentUser();
    return !!(u && u.role === "admin");
  }

  // Show/hide cross-branch UI based on the signed-in user's role.
  function applyRole() {
    const u = Api.currentUser() || {};
    const admin = u.role === "admin";
    $("#user-name").textContent =
      (u.name || u.email || "") + (admin ? " · Admin" : (u.branch ? " · " + u.branch : ""));
    $("#dash-title").textContent = admin ? "Branch goals" : ((u.branch || "") + " goals");
    $("#admin-panel").hidden = !admin;
    if (admin) renderBranchCodes();
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
  });

  // ---- Branch & employee option lists --------------------------------------
  function populateBranchSelects() {
    const opts = BRANCHES.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
    $("#ref-branch").innerHTML = `<option value="">Select branch…</option>` + opts;
    $("#goal-branch").innerHTML = `<option value="">All branches</option>` + opts;
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
        [r.employee, r.client, r.branch, r.notes].some((v) => (v || "").toLowerCase().includes(q))
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
    if (isAdmin()) {
      $("#ref-branch").disabled = false;
      $("#ref-branch").value = editing ? editing.branch || "" : "";
    } else {
      // Branch users are pinned to their own branch.
      $("#ref-branch").value = (Api.currentUser() || {}).branch || "";
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
      branch: isAdmin() ? $("#ref-branch").value : ((Api.currentUser() || {}).branch || ""),
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
        <button class="btn" data-act="edit-from-detail" data-id="${esc(g.id)}">Edit goal</button>
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
    if (isAdmin()) {
      $("#goal-branch").disabled = false;
      $("#goal-branch").value = editing ? editing.branch || "" : "";
    } else {
      $("#goal-branch").value = (Api.currentUser() || {}).branch || "";
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
      branch: isAdmin() ? $("#goal-branch").value : ((Api.currentUser() || {}).branch || ""),
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
        style="font-size:15px;font-weight:800;fill:#0f172a">${Math.round(pct)}</text>
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

  // Dashboard = one box per branch (admin sees all branches, a branch user sees
  // only their own), each showing that branch's goals and live progress.
  function renderDashboard() {
    const grid = $("#branch-goal-grid");
    if (!grid) return;
    const admin = isAdmin();
    const branches = admin ? BRANCHES.slice() : [(Api.currentUser() || {}).branch].filter(Boolean);
    grid.innerHTML = branches.map(branchBoxHTML).join("");
    $("#dash-empty").hidden = goals.length !== 0;
    $("#dash-intro").hidden = goals.length === 0;
  }

  $("#branch-goal-grid").addEventListener("click", (e) => {
    const el = e.target.closest(".branch-goal");
    if (el) openGoalDetail(el.dataset.goalId);
  });
  $("#branch-goal-grid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest(".branch-goal");
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

  // =========================================================================
  //  CSV export / import
  // =========================================================================
  const CSV_COLS = ["date", "type", "employee", "branch", "client", "amount", "status", "notes"];

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
    populateBranchSelects();
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
