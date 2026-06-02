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
    $("#dash-branch-label").hidden = !admin;
    $("#branch-card").hidden = !admin;
    $("#admin-panel").hidden = !admin;
    if (!admin) $("#dash-branch").value = "all";
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
    $("#dash-branch").innerHTML = `<option value="all">All branches</option>` + opts;
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
  function goalMatches(goal, ref) {
    if (goal.start && ref.date < goal.start) return false;
    if (goal.end && ref.date > goal.end) return false;
    if (goal.branch && (ref.branch || "").toLowerCase() !== goal.branch.toLowerCase()) return false;
    if (goal.fundType === "initial") return ref.type === "initial";
    if (goal.fundType === "additional") return ref.type === "additional";
    return true; // total = initial + additional
  }
  function goalProgress(goal) {
    const matched = referrals.filter((r) => r.status !== "declined" && goalMatches(goal, r));
    const current = goal.metric === "count"
      ? matched.length
      : matched.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pct = goal.target > 0 ? Math.min(100, (current / goal.target) * 100) : 0;
    return { current, pct };
  }
  function scopeLabel(goal) {
    const b = goal.branch ? goal.branch : "All branches";
    const t = goal.fundType === "initial" ? "Initial"
      : goal.fundType === "additional" ? "Additional" : "Total";
    return b + " · " + t;
  }
  function metricValue(goal, v) {
    return goal.metric === "count" ? Math.round(v).toLocaleString("en-US") : fmtMoney0(v);
  }

  // ---- Goal detail (mini-dashboard) ---------------------------------------
  function goalValueOf(goal, r) {
    return goal.metric === "count" ? 1 : (Number(r.amount) || 0);
  }
  function goalMatched(goal) {
    return referrals.filter((r) => r.status !== "declined" && goalMatches(goal, r));
  }

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
    const pts = sorted.map((r) => { cum += goalValueOf(goal, r); return { x: t(r.date), y: cum }; });
    const yMax = Math.max(goal.target, cum, 1);

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

    const ty = sy(goal.target);
    const baseY = sy(0);
    const fmtAxis = (v) => goal.metric === "count" ? Math.round(v).toLocaleString("en-US") : fmtMoney0(v);

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
      <text x="${W - padR}" y="${(ty - 6).toFixed(1)}" text-anchor="end" class="chart-target">target ${esc(fmtAxis(goal.target))}</text>
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
    const fmtV = (v) => goal.metric === "count" ? Math.round(v).toLocaleString("en-US") : fmtMoney0(v);
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
    const matched = goalMatched(g);
    const current = matched.reduce((s, r) => s + goalValueOf(g, r), 0);
    const pctRaw = g.target > 0 ? (current / g.target) * 100 : 0;
    const remaining = Math.max(0, g.target - current);

    // Contributor breakdown: by branch for an all-branches goal, else by employee.
    const byBranch = g.branch === "";
    const agg = {};
    matched.forEach((r) => {
      const key = (byBranch ? r.branch : r.employee) || (byBranch ? "(no branch)" : "(unassigned)");
      agg[key] = (agg[key] || 0) + goalValueOf(g, r);
    });
    const items = Object.entries(agg).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

    // Pace/projection if there's a start date.
    let paceTile = "";
    if (g.start && current > 0) {
      const day = 86400000;
      const start = new Date(g.start + "T00:00:00").getTime();
      const now = Date.now();
      const elapsed = Math.max(1, Math.round((now - start) / day));
      const pace = current / elapsed; // per day
      if (g.end) {
        const total = Math.max(1, Math.round((new Date(g.end + "T00:00:00").getTime() - start) / day));
        const projected = pace * total;
        paceTile = statTile("On-pace projection", metricValue(g, projected),
          projected >= g.target ? "ahead of target 🚀" : "short of target");
      } else {
        paceTile = statTile("Pace", metricValue(g, pace * 30) + "/mo", "");
      }
    }

    let daysTile = "";
    if (g.end) {
      const days = Math.ceil((new Date(g.end + "T00:00:00").getTime() - Date.now()) / 86400000);
      daysTile = statTile("Days left", days >= 0 ? String(days) : "ended",
        days >= 0 ? "until " + fmtDate(g.end) : "on " + fmtDate(g.end));
    }

    const avgTile = g.metric === "amount" && matched.length
      ? statTile("Avg / referral", fmtMoney0(current / matched.length), "")
      : "";

    const range = [g.start ? fmtDate(g.start) : null, g.end ? fmtDate(g.end) : null].filter(Boolean).join(" – ");

    $("#goal-detail-body").innerHTML = `
      <div class="gd-head">
        <div>
          <h3>${esc(g.name)}</h3>
          <div class="goal-meta">${esc(scopeLabel(g))}${range ? " · " + esc(range) : ""} · ${g.metric === "count" ? "count goal" : "amount goal"}</div>
        </div>
        <button class="btn" data-act="edit-from-detail" data-id="${esc(g.id)}">Edit goal</button>
      </div>

      <div class="gd-top">
        <div class="gd-donut">${donutSVG(pctRaw)}</div>
        <div class="gd-tiles">
          ${statTile("Current", metricValue(g, current), matched.length + " referral" + (matched.length === 1 ? "" : "s"))}
          ${statTile("Target", metricValue(g, g.target), "")}
          ${statTile("Remaining", metricValue(g, remaining), pctRaw >= 100 ? "goal met 🎉" : "")}
          ${avgTile}${daysTile}${paceTile}
        </div>
      </div>

      <div class="gd-section">
        <h4>Progress over time</h4>
        ${matched.length ? lineChartSVG(g, matched) : `<p class="muted small">No referrals counted toward this goal yet.</p>`}
      </div>

      <div class="gd-section">
        <h4>${byBranch ? "By branch" : "Top contributors"}</h4>
        ${barChartSVG(g, items)}
      </div>`;

    goalDetailModal.hidden = false;
  }

  function renderGoals() {
    const wrap = $("#goals-list");
    $("#goals-empty").hidden = goals.length !== 0;
    wrap.innerHTML = goals
      .map((g) => {
        const { current, pct } = goalProgress(g);
        const done = pct >= 100;
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
          <div class="goal-figures">
            <b>${esc(metricValue(g, current))}</b> <span class="muted">/ ${esc(metricValue(g, g.target))}</span>
          </div>
          <div class="progress ${done ? "done" : ""}"><span style="width:${pct}%"></span></div>
          <div class="progress-label"><span>${pct.toFixed(0)}%</span><span>${done ? "Goal met 🎉" : "in progress"}</span></div>
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
    $("#goal-metric").value = editing ? editing.metric : "amount";
    if (isAdmin()) {
      $("#goal-branch").disabled = false;
      $("#goal-branch").value = editing ? editing.branch || "" : "";
    } else {
      $("#goal-branch").value = (Api.currentUser() || {}).branch || "";
      $("#goal-branch").disabled = true;
    }
    $("#goal-fundtype").value = editing ? editing.fundType || "total" : "total";
    $("#goal-target").value = editing ? editing.target : "";
    $("#goal-start").value = editing ? editing.start || "" : "";
    $("#goal-end").value = editing ? editing.end || "" : "";
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
      metric: $("#goal-metric").value,
      branch: isAdmin() ? $("#goal-branch").value : ((Api.currentUser() || {}).branch || ""),
      fundType: $("#goal-fundtype").value,
      target: parseFloat($("#goal-target").value) || 0,
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

  // Stacked monthly bar chart (Initial vs Additional), last 12 months in range.
  function monthlyChartSVG(rows) {
    const byMonth = {};
    rows.forEach((r) => {
      if (!/^\d{4}-\d{2}/.test(r.date || "")) return;
      const m = r.date.slice(0, 7);
      const e = byMonth[m] || (byMonth[m] = { initial: 0, additional: 0 });
      if (r.type === "initial") e.initial += Number(r.amount) || 0;
      else e.additional += Number(r.amount) || 0;
    });
    const present = Object.keys(byMonth).sort();
    if (!present.length) return `<p class="muted small">No referrals to chart for this selection.</p>`;

    // Fill the continuous month range, then keep the most recent 12.
    const months = [];
    let [sy, sm] = present[0].split("-").map(Number);
    const [ey, em] = present[present.length - 1].split("-").map(Number);
    while (sy < ey || (sy === ey && sm <= em)) {
      months.push(`${sy}-${String(sm).padStart(2, "0")}`);
      sm++; if (sm > 12) { sm = 1; sy++; }
    }
    const data = months.slice(-12).map((m) => ({ m, initial: (byMonth[m] || {}).initial || 0, additional: (byMonth[m] || {}).additional || 0 }));
    const yMax = Math.max(1, ...data.map((d) => d.initial + d.additional));

    const W = 680, padL = 60, padR = 14, padT = 14, padB = 40, innerH = 160;
    const innerW = W - padL - padR, H = padT + innerH + padB, sy0 = padT + innerH;
    const slot = innerW / data.length, bw = Math.min(46, slot * 0.6);
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const label = (m, i) => {
      const [y, mm] = m.split("-").map(Number);
      return (mm === 1 || i === 0) ? names[mm - 1] + " '" + String(y).slice(2) : names[mm - 1];
    };

    let bars = "";
    data.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2, x = cx - bw / 2;
      const hi = (d.initial / yMax) * innerH, ha = (d.additional / yMax) * innerH;
      const yi = sy0 - hi, ya = yi - ha;
      const tip = `${label(d.m, i)} — Initial ${fmtMoney0(d.initial)}, Additional ${fmtMoney0(d.additional)}, Total ${fmtMoney0(d.initial + d.additional)}`;
      bars += `<g><title>${esc(tip)}</title>`;
      if (d.initial > 0) bars += `<rect x="${x.toFixed(1)}" y="${yi.toFixed(1)}" width="${bw.toFixed(1)}" height="${hi.toFixed(1)}" fill="#1d4ed8" rx="2"/>`;
      if (d.additional > 0) bars += `<rect x="${x.toFixed(1)}" y="${ya.toFixed(1)}" width="${bw.toFixed(1)}" height="${ha.toFixed(1)}" fill="#15803d" rx="2"/>`;
      bars += `<text x="${cx.toFixed(1)}" y="${H - 20}" text-anchor="middle" class="chart-axis">${esc(label(d.m, i))}</text></g>`;
    });

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="chart" preserveAspectRatio="xMidYMid meet">
      <line x1="${padL}" y1="${sy0}" x2="${W - padR}" y2="${sy0}" stroke="#e2e8f0"/>
      <text x="${padL - 8}" y="${sy0}" text-anchor="end" dominant-baseline="middle" class="chart-axis">0</text>
      <text x="${padL - 8}" y="${padT + 6}" text-anchor="end" class="chart-axis">${esc(fmtMoney0(yMax))}</text>
      ${bars}
    </svg>`;
  }

  function renderDashboard() {
    const period = $("#dash-period").value;
    const branch = $("#dash-branch").value;
    let rows = referrals.filter((r) => inPeriod(r, period));
    if (branch !== "all") rows = rows.filter((r) => (r.branch || "") === branch);
    const active = rows.filter((r) => r.status !== "declined");

    const initial = active.filter((r) => r.type === "initial");
    const additional = active.filter((r) => r.type === "additional");
    const sum = (arr) => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const declined = rows.length - active.length;
    const cards = [
      { cls: "total", label: "Total investment", value: fmtMoney0(sum(active)),
        sub: `${active.length} referral${active.length === 1 ? "" : "s"}${declined ? " · " + declined + " declined" : ""}` },
      { cls: "initial", label: "Initial funds", value: fmtMoney0(sum(initial)),
        sub: `${initial.length} referral${initial.length === 1 ? "" : "s"}` },
      { cls: "additional", label: "Additional funds", value: fmtMoney0(sum(additional)),
        sub: `${additional.length} referral${additional.length === 1 ? "" : "s"}` },
      { cls: "", label: "Qualified referrals", value: initial.length.toLocaleString("en-US"),
        sub: "initial sales" },
    ];
    $("#summary-cards").innerHTML = cards
      .map(
        (c) => `<div class="metric ${c.cls}">
          <div class="label">${esc(c.label)}</div>
          <div class="value">${esc(c.value)}</div>
          <div class="sub">${esc(c.sub)}</div>
        </div>`
      )
      .join("");

    $("#monthly-chart").innerHTML = monthlyChartSVG(active);

    // Per-branch breakdown — all branches, period only (ignores the branch filter).
    const periodActive = referrals.filter((r) => inPeriod(r, period) && r.status !== "declined");
    const bAgg = {};
    periodActive.forEach((r) => {
      const k = r.branch || "(no branch)";
      const e = bAgg[k] || (bAgg[k] = { initial: 0, additional: 0, count: 0 });
      if (r.type === "initial") e.initial += Number(r.amount) || 0;
      else e.additional += Number(r.amount) || 0;
      e.count++;
    });
    const bRows = Object.entries(bAgg).sort(
      (a, b) => (b[1].initial + b[1].additional) - (a[1].initial + a[1].additional)
    );
    $("#branch-table tbody").innerHTML = bRows.length
      ? bRows
          .map(
            ([name, v]) => `<tr>
              <td>${esc(name)}</td>
              <td class="num">${esc(fmtMoney0(v.initial))}</td>
              <td class="num">${esc(fmtMoney0(v.additional))}</td>
              <td class="num">${esc(fmtMoney0(v.initial + v.additional))}</td>
              <td class="num">${v.count}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="muted" style="text-align:center">No referrals in this period.</td></tr>`;
    const bTot = periodActive.reduce(
      (a, r) => {
        if (r.type === "initial") a.initial += Number(r.amount) || 0;
        else a.additional += Number(r.amount) || 0;
        a.count++;
        return a;
      },
      { initial: 0, additional: 0, count: 0 }
    );
    $("#branch-table tfoot").innerHTML = bRows.length
      ? `<tr>
          <th>All branches</th>
          <th class="num">${esc(fmtMoney0(bTot.initial))}</th>
          <th class="num">${esc(fmtMoney0(bTot.additional))}</th>
          <th class="num">${esc(fmtMoney0(bTot.initial + bTot.additional))}</th>
          <th class="num">${bTot.count}</th>
        </tr>`
      : "";

    const byEmp = {};
    active.forEach((r) => {
      const k = r.employee || "(unassigned)";
      const e = byEmp[k] || (byEmp[k] = { qualified: 0, initial: 0, additional: 0 });
      if (r.type === "initial") { e.initial += Number(r.amount) || 0; e.qualified += 1; }
      else e.additional += Number(r.amount) || 0;
    });
    const empRows = Object.entries(byEmp).sort(
      (a, b) => (b[1].initial + b[1].additional) - (a[1].initial + a[1].additional)
    );
    $("#credit-table tbody").innerHTML = empRows.length
      ? empRows
          .map(
            ([name, v]) => `<tr>
              <td>${esc(name)}</td>
              <td class="num">${v.qualified}</td>
              <td class="num">${esc(fmtMoney0(v.initial))}</td>
              <td class="num">${esc(fmtMoney0(v.additional))}</td>
              <td class="num">${esc(fmtMoney0(v.initial + v.additional))}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="muted" style="text-align:center">No referrals in this period.</td></tr>`;

    // Goals are branch-specific, so an admin must pick a branch before the
    // goal list is meaningful. Branch users always see their own branch's goals.
    const dg = $("#dash-goals");
    if (isAdmin() && branch === "all") {
      dg.innerHTML = `<p class="muted small">Select a branch above to see its goals.</p>`;
    } else {
      const scopeBranch = isAdmin() ? branch : ((Api.currentUser() || {}).branch || "");
      const list = goals.filter((g) => g.branch === scopeBranch);
      if (!list.length) {
        dg.innerHTML = `<p class="muted small">No goals for ${esc(scopeBranch)} yet. Add one on the Goals tab.</p>`;
      } else {
        dg.innerHTML = list
          .slice(0, 5)
          .map((g) => {
            const { current, pct } = goalProgress(g);
            const done = pct >= 100;
            return `<div class="mini">
              <h5>${esc(g.name)} <span>${esc(metricValue(g, current))} / ${esc(metricValue(g, g.target))}</span></h5>
              <div class="progress ${done ? "done" : ""}"><span style="width:${pct}%"></span></div>
            </div>`;
          })
          .join("");
      }
    }
  }
  $("#dash-period").addEventListener("change", renderDashboard);
  $("#dash-branch").addEventListener("change", renderDashboard);

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
