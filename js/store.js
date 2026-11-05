/* Persistence: everything lives in this browser's localStorage under one key.
 * Export/import JSON is the backup and the way to move data between PCs. */
(function (F) {
  "use strict";

  const KEY = "fmb.v1";
  const APP = "facilities-manual-builder";
  const now = () => new Date().toISOString();
  const uid = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let available = true;
  let state = load();

  function empty() {
    return { buildings: {}, contracts: {}, invoices: {}, budgets: {}, settings: {},
             meta: { lastExport: null, changedSinceExport: false } };
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return empty();
      const s = JSON.parse(raw);
      return { buildings: s.buildings || {}, contracts: s.contracts || {}, invoices: s.invoices || {},
               budgets: s.budgets || {}, settings: s.settings || {}, meta: { ...empty().meta, ...(s.meta || {}) } };
    } catch (e) {
      available = false;            // blocked storage (some locked-down browsers) or corrupt data
      return empty();
    }
  }

  function persist(changed = true) {
    if (changed) state.meta.changedSinceExport = true;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      available = false;
      throw new Error("Browser storage is full or blocked, so this change only lasts until you close the tab. Export a backup now.");
    }
  }

  function touch(b) { b.updatedAt = now(); }

  // Ask the browser not to evict our data under storage pressure (best effort).
  let persistAsked = false;
  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* ignore */ }
  }

  F.store = {
    get available() { return available; },
    meta: () => ({ ...state.meta }),

    list: () => Object.values(state.buildings)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),

    get: (id) => state.buildings[id] || null,

    create(name) {
      const id = uid(), t = now();
      state.buildings[id] = {
        id, name, createdAt: t, updatedAt: t,
        steps: { profile: { data: { name, revision: "A" }, completed: false, updatedAt: t } },
        equipment: {},
      };
      persist(); askPersist();
      return id;
    },

    /** Copy steps and equipment. Clears address/doc no./serials and marks every
     *  step incomplete so the new building gets reviewed, not rubber-stamped. */
    duplicate(id) {
      const src = state.buildings[id];
      const nid = uid(), t = now(), name = `${src.name} (copy)`;
      const b = { ...clone(src), id: nid, name, createdAt: t, updatedAt: t };
      for (const s of Object.values(b.steps)) { s.completed = false; s.updatedAt = t; }
      if (b.steps.profile) Object.assign(b.steps.profile.data, { name, address: "", doc_number: "", revision: "A" });
      for (const rows of Object.values(b.equipment)) rows.forEach((r) => { if ("serial" in r) r.serial = ""; });
      state.buildings[nid] = b;
      persist();
      return nid;
    },

    /** Delete a building. Its contracts and invoices are kept and become company-wide / unassigned. */
    remove(id) {
      delete state.buildings[id];
      for (const r of [...Object.values(state.contracts), ...Object.values(state.invoices)]) {
        if (r.buildingId === id) { r.buildingId = ""; r.updatedAt = now(); }   // equipment tags kept as text
      }
      persist();
    },

    linkedCount: (id) => Object.values(state.contracts).filter((r) => r.buildingId === id).length +
      Object.values(state.invoices).filter((r) => r.buildingId === id).length,

    hasAnyData: () => Object.keys(state.buildings).length + Object.keys(state.contracts).length +
      Object.keys(state.invoices).length > 0,

    // --- contracts & invoices (same shape of API for both) ---------------------
    records: (kind) => Object.values(state[kind]),
    record: (kind, id) => state[kind][id] || null,

    /** Insert or update a contract/invoice. Returns its id. */
    saveRecord(kind, rec) {
      const t = now(), id = rec.id || uid();
      const prev = state[kind][id];
      state[kind][id] = { ...rec, id, createdAt: (prev && prev.createdAt) || rec.createdAt || t, updatedAt: t };
      persist(); askPersist();
      return id;
    },

    removeRecord(kind, id) {
      delete state[kind][id];
      if (kind === "contracts") {
        for (const inv of Object.values(state.invoices)) if (inv.contractId === id) { inv.contractId = ""; inv.updatedAt = now(); }
      }
      persist();
    },

    // --- settings ---------------------------------------------------------------------
    /** Month (1-12) the budget year starts in. 1 = calendar year. */
    fyStart: () => { const m = Number(state.settings.fyStartMonth); return m >= 1 && m <= 12 ? m : 1; },
    setFyStart(m) { state.settings.fyStartMonth = Number(m); state.settings.updatedAt = now(); persist(); },

    // --- budgets: one amount per budget year per scope (building id, or "" company-wide)
    budget: (year, scope) => { const b = state.budgets[`${year}|${scope}`]; return b ? b.amount : null; },
    allBudgets: () => Object.entries(state.budgets).map(([k, v]) => {
      const i = k.indexOf("|");
      return { year: Number(k.slice(0, i)), scope: k.slice(i + 1), amount: v.amount };
    }),
    budgetYears: () => [...new Set(Object.keys(state.budgets).map((k) => Number(k.split("|")[0])))],
    budgetsForYear: (year) => Object.entries(state.budgets)
      .filter(([k]) => k.startsWith(`${year}|`)).map(([k, v]) => ({ scope: k.slice(String(year).length + 1), amount: v.amount })),
    setBudget(year, scope, amount) {
      const k = `${year}|${scope}`;
      if (amount === null || amount === "") delete state.budgets[k];
      else state.budgets[k] = { amount: Number(amount), updatedAt: now() };
      persist();
    },

    saveStep(id, key, data, completed, system, rows) {
      const b = state.buildings[id], t = now();
      b.steps[key] = { data, completed, updatedAt: t };
      if (system) b.equipment[system] = rows;
      if (key === "profile" && data.name) b.name = data.name;
      touch(b);
      persist(); askPersist();
    },

    exportJSON() {
      return JSON.stringify({
        app: APP, format: 2, exportedAt: now(),
        buildings: Object.values(state.buildings),
        contracts: Object.values(state.contracts),
        invoices: Object.values(state.invoices),
        budgets: state.budgets,
        settings: state.settings,
      }, null, 2);
    },

    markExported() {
      state.meta.lastExport = now();
      state.meta.changedSinceExport = false;
      try { persist(false); } catch (e) { /* surfaced elsewhere */ }
    },

    /** Merge a backup (format 1 or 2). New items are added; one that already exists
     *  is replaced only if the file's copy is newer. Nothing is ever deleted. */
    importJSON(text) {
      let doc;
      try { doc = JSON.parse(text); } catch (e) { throw new Error("That file isn't valid JSON."); }
      if (!doc || doc.app !== APP || !Array.isArray(doc.buildings)) {
        throw new Error("That file isn't a Facilities Manual Builder backup.");
      }
      const res = { added: 0, updated: 0, skipped: 0 };
      for (const b of doc.buildings) {
        if (!b || typeof b.id !== "string" || typeof b.name !== "string" ||
            typeof b.steps !== "object" || typeof b.equipment !== "object") { res.skipped++; continue; }
        const mine = state.buildings[b.id];
        if (!mine) { state.buildings[b.id] = b; res.added++; }
        else if ((b.updatedAt || "") > (mine.updatedAt || "")) { state.buildings[b.id] = b; res.updated++; }
        else res.skipped++;
      }
      res.records = { added: 0, updated: 0 };
      for (const kind of ["contracts", "invoices"]) {
        if (!Array.isArray(doc[kind])) continue;
        for (const r of doc[kind]) {
          if (!r || typeof r.id !== "string" || typeof r.vendor !== "string") continue;
          const mine = state[kind][r.id];
          if (!mine) { state[kind][r.id] = r; res.records.added++; }
          else if ((r.updatedAt || "") > (mine.updatedAt || "")) { state[kind][r.id] = r; res.records.updated++; }
        }
      }
      let budgetChanged = false;
      if (doc.budgets && typeof doc.budgets === "object") {
        for (const [k, v] of Object.entries(doc.budgets)) {
          if (!/^\d{4}\|/.test(k) || !v || !Number.isFinite(Number(v.amount))) continue;
          const mine = state.budgets[k];
          if (!mine || (v.updatedAt || "") > (mine.updatedAt || "")) { state.budgets[k] = v; budgetChanged = true; }
        }
      }
      if (doc.settings && typeof doc.settings === "object" && Number(doc.settings.fyStartMonth) >= 1 &&
          Number(doc.settings.fyStartMonth) <= 12 && (doc.settings.updatedAt || "") > (state.settings.updatedAt || "")) {
        state.settings = { ...state.settings, fyStartMonth: Number(doc.settings.fyStartMonth), updatedAt: doc.settings.updatedAt };
        budgetChanged = true;
      }
      if (res.added || res.updated || res.records.added || res.records.updated || budgetChanged) persist();
      return res;
    },
  };
})(window.FMB);
