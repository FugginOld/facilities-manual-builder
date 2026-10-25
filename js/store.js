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
    return { buildings: {}, meta: { lastExport: null, changedSinceExport: false } };
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return empty();
      const s = JSON.parse(raw);
      return { buildings: s.buildings || {}, meta: { ...empty().meta, ...(s.meta || {}) } };
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

    remove(id) {
      delete state.buildings[id];
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
        app: APP, format: 1, exportedAt: now(),
        buildings: Object.values(state.buildings),
      }, null, 2);
    },

    markExported() {
      state.meta.lastExport = now();
      state.meta.changedSinceExport = false;
      try { persist(false); } catch (e) { /* surfaced elsewhere */ }
    },

    /** Merge a backup. New buildings are added; one that already exists is
     *  replaced only if the file's copy is newer. Nothing is ever deleted. */
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
      if (res.added || res.updated) persist();
      return res;
    },
  };
})(window.FMB);
