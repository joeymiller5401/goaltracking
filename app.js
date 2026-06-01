/* Referral Goal Tracker — front-end.
 * Talks to the encrypted, multi-user backend via window.Api. Data is loaded
 * into memory after sign-in and kept in sync as the user makes changes.
 */
(function () {
  "use strict";

  // ---- In-memory state (mirrors the server) --------------------------------
  let referrals = [];
  let goals = [];
  let settings = { rateInitial: 1.0, rateAdditional: 0.5 };

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
    const u = Api.currentUser();
    $("#user-name").textContent = u ? (u.name || u.email) : "";
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
      const [refs, gls, st] = await Promise.all([
        Api.listReferrals(),
        Api.listGoals(),
        Api.getSettings(),
      ]);
      referrals = refs;
      goals = gls;
      settings = st;
      loadSettingsForm();
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

  // ---- Datalists -----------------------------------------------------------
  function refreshDatalists() {
    const employees = [...new Set(referrals.map((r) => r.employee).filter(Boolean))].sort();
    const branches = [...new Set(referrals.map((r) => r.branch).filter(Boolean))].sort();
    $("#employee-list").innerHTML = employees.map((e) => `<option value="${esc(e)}">`).join("");
    $("#branch-list").innerHTML = branches.map((b) => `<option value="${esc(b)}">`).join("");
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
    $("#ref-branch").value = editing ? editing.branch || "" : "";
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
      branch: $("#ref-branch").value.trim(),
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
    if (goal.scope === "initial") return ref.type === "initial";
    if (goal.scope === "additional") return ref.type === "additional";
    if (goal.scope === "employee")
      return (ref.employee || "").toLowerCase() === (goal.employee || "").toLowerCase();
    return true;
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
    if (goal.scope === "initial") return "Initial funds";
    if (goal.scope === "additional") return "Additional funds";
    if (goal.scope === "employee") return goal.employee || "Employee";
    return "All referrals";
  }
  function metricValue(goal, v) {
    return goal.metric === "count" ? Math.round(v).toLocaleString("en-US") : fmtMoney0(v);
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
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = e.target.closest(".goal-card").dataset.id;
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

  // ---- Goal modal ----------------------------------------------------------
  const goalModal = $("#goal-modal");
  function toggleGoalEmployee() {
    $("#goal-employee-wrap").hidden = $("#goal-scope").value !== "employee";
  }
  $("#goal-scope").addEventListener("change", toggleGoalEmployee);

  function openGoalModal(id) {
    const editing = goals.find((g) => g.id === id);
    $("#goal-error").hidden = true;
    $("#goal-modal-title").textContent = editing ? "Edit goal" : "New goal";
    $("#goal-id").value = editing ? editing.id : "";
    $("#goal-name").value = editing ? editing.name : "";
    $("#goal-metric").value = editing ? editing.metric : "amount";
    $("#goal-scope").value = editing ? editing.scope : "all";
    $("#goal-employee").value = editing ? editing.employee || "" : "";
    $("#goal-target").value = editing ? editing.target : "";
    $("#goal-start").value = editing ? editing.start || "" : "";
    $("#goal-end").value = editing ? editing.end || "" : "";
    toggleGoalEmployee();
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
      scope: $("#goal-scope").value,
      employee: $("#goal-employee").value.trim(),
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
  function creditFor(ref) {
    const rate = ref.type === "initial" ? settings.rateInitial : settings.rateAdditional;
    return (Number(ref.amount) || 0) * (Number(rate) || 0) / 100;
  }

  function renderDashboard() {
    const period = $("#dash-period").value;
    const rows = referrals.filter((r) => inPeriod(r, period));
    const active = rows.filter((r) => r.status !== "declined");

    const initial = active.filter((r) => r.type === "initial");
    const additional = active.filter((r) => r.type === "additional");
    const sum = (arr) => arr.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const cards = [
      { cls: "", label: "Total referrals", value: active.length.toLocaleString("en-US"),
        sub: `${rows.length - active.length} declined` },
      { cls: "initial", label: "Initial funds", value: fmtMoney0(sum(initial)),
        sub: `${initial.length} referral${initial.length === 1 ? "" : "s"}` },
      { cls: "additional", label: "Additional funds", value: fmtMoney0(sum(additional)),
        sub: `${additional.length} referral${additional.length === 1 ? "" : "s"}` },
      { cls: "", label: "Est. total credit", value: fmtMoney0(active.reduce((s, r) => s + creditFor(r), 0)),
        sub: "across all employees" },
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

    const byEmp = {};
    active.forEach((r) => {
      const k = r.employee || "(unassigned)";
      const e = byEmp[k] || (byEmp[k] = { initial: 0, additional: 0, credit: 0 });
      if (r.type === "initial") e.initial += Number(r.amount) || 0;
      else e.additional += Number(r.amount) || 0;
      e.credit += creditFor(r);
    });
    const empRows = Object.entries(byEmp).sort((a, b) => b[1].credit - a[1].credit);
    $("#credit-table tbody").innerHTML = empRows.length
      ? empRows
          .map(
            ([name, v]) => `<tr>
              <td>${esc(name)}</td>
              <td class="num">${esc(fmtMoney0(v.initial))}</td>
              <td class="num">${esc(fmtMoney0(v.additional))}</td>
              <td class="num">${esc(fmtMoney(v.credit))}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted" style="text-align:center">No referrals in this period.</td></tr>`;

    const dg = $("#dash-goals");
    if (!goals.length) {
      dg.innerHTML = `<p class="muted small">No goals set yet. Add one on the Goals tab.</p>`;
    } else {
      dg.innerHTML = goals
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
  $("#dash-period").addEventListener("change", renderDashboard);

  // =========================================================================
  //  SETTINGS
  // =========================================================================
  function loadSettingsForm() {
    $("#rate-initial").value = settings.rateInitial;
    $("#rate-additional").value = settings.rateAdditional;
  }
  $("#save-settings").addEventListener("click", async () => {
    try {
      settings = await Api.saveSettings({
        rateInitial: parseFloat($("#rate-initial").value) || 0,
        rateAdditional: parseFloat($("#rate-additional").value) || 0,
      });
      const note = $("#settings-saved");
      note.hidden = false;
      setTimeout(() => (note.hidden = true), 1800);
      renderDashboard();
    } catch (err) { alert("Could not save settings: " + err.message); }
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
    if (e.key === "Escape") { closeReferralModal(); closeGoalModal(); }
  });

  // =========================================================================
  //  INIT
  // =========================================================================
  async function init() {
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
