/* Shared vendor directory. Contracts and invoices link to a vendor by `vendorId`
 * (their `vendor` text is kept in sync); wizard fields/columns of kind "vendor"
 * store the vendor id. No DOM access here. */
(function (F) {
  "use strict";

  F.VENDOR_FIELDS = [
    { name: "name", label: "Vendor name", required: true, placeholder: "Acme Mechanical" },
    { name: "trade", label: "Main trade", kind: "select", options: F.TRADES },
    { name: "contact_name", label: "Contact person" },
    { name: "phone", label: "Phone", placeholder: "(813) 555-0100" },
    { name: "emergency_phone", label: "After-hours / emergency phone" },
    { name: "email", label: "Email" },
    { name: "account_number", label: "Our account / customer no." },
    { name: "website", label: "Website or portal" },
    { name: "address", label: "Address", wide: true },
    { name: "insurance_expires", label: "Insurance certificate (COI) expires", kind: "date",
      help: "Flagged on the Vendors page when it's expired or due within 30 days." },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];

  const vendors = () => F.store.records("vendors");
  const stamp = (r) => { r.updatedAt = new Date().toISOString(); };
  F.vendorById = (id) => (id ? F.store.record("vendors", id) : null);
  F.isVendorId = (v) => !!F.vendorById(v);
  F.vendorName = (v) => { const x = F.vendorById(v); return x ? x.name : v || ""; };
  /** "Acme Mechanical · (813) 555-0100 · after hours (813) 555-0199" */
  F.vendorText = (v) => {
    const x = F.vendorById(v);
    if (!x) return v || "";
    return [x.name, x.phone, x.emergency_phone ? `after hours ${x.emergency_phone}` : ""].filter(Boolean).join(" · ");
  };
  F.findVendor = (name) => {
    const c = F.canonVendor(name);
    return c ? vendors().find((v) => F.canonVendor(v.name) === c) || null : null;
  };
  /** Id of the directory vendor with this name, creating it if needed. "" for a blank name. */
  F.ensureVendor = (name, extra = {}) => {
    const n = String(name || "").trim();
    if (!n) return "";
    const hit = F.findVendor(n);
    if (hit) return hit.id;
    return F.store.saveRecord("vendors", { name: n, ...extra });
  };

  // every place a building's wizard data can hold a vendor id
  function vendorSlots(b) {
    const out = [];
    for (const s of F.STEPS) {
      for (const f of s.fields) if (f.kind === "vendor") out.push({ step: s, get: () => ((b.steps[s.key] || {}).data || {})[f.name], set: (v) => { b.steps[s.key].data[f.name] = v; }, where: `${s.title}: ${f.label}` });
      for (const t of s.tables) for (const c of t.columns) if (c.kind === "vendor") {
        (b.equipment[t.system] || []).forEach((r) => out.push({ step: s, get: () => r[c.name], set: (v) => { r[c.name] = v; }, where: `${s.title}: ${t.title}` }));
      }
    }
    return out;
  }

  /** Where a vendor is used. */
  F.vendorUsage = (id) => {
    const v = F.vendorById(id), c = v ? F.canonVendor(v.name) : "";
    const mine = (r) => r.vendorId === id || (!r.vendorId && c && F.canonVendor(r.vendor) === c);
    const places = [];
    for (const b of F.store.list()) for (const s of vendorSlots(b)) if (s.get() === id) places.push({ building: b, where: s.where, stepKey: s.step.key });
    return {
      contracts: F.store.records("contracts").filter(mine),
      invoices: F.store.records("invoices").filter(mine),
      places,
    };
  };

  /** Save a directory vendor; a rename is copied onto its contracts and invoices. */
  F.saveVendor = (rec) => {
    const prev = rec.id ? F.vendorById(rec.id) : null;
    const id = F.store.saveRecord("vendors", rec);
    if (prev && prev.name !== rec.name) {
      F.store.mutate((st) => {
        for (const kind of ["contracts", "invoices"]) for (const r of Object.values(st[kind])) {
          if (r.vendorId === id) { r.vendor = rec.name; stamp(r); }
        }
      });
    }
    return id;
  };

  /** Move everything from one vendor to another, then delete the first. */
  F.mergeVendor = (fromId, intoId) => {
    const into = F.vendorById(intoId);
    if (!into || fromId === intoId) throw new Error("Pick a different vendor to merge into.");
    const from = F.vendorById(fromId), fc = F.canonVendor(from ? from.name : "");
    F.store.mutate((st) => {
      for (const kind of ["contracts", "invoices"]) for (const r of Object.values(st[kind])) {
        if (r.vendorId === fromId || (!r.vendorId && fc && F.canonVendor(r.vendor) === fc)) { r.vendorId = intoId; r.vendor = into.name; stamp(r); }
      }
      for (const b of Object.values(st.buildings)) for (const s of vendorSlots(b)) if (s.get() === fromId) { s.set(intoId); stamp(b); }
      const v = st.vendors[intoId];
      if (from) for (const k of Object.keys(from)) if (!v[k] && from[k] && !["id", "createdAt", "updatedAt"].includes(k)) v[k] = from[k];
      stamp(v);
      delete st.vendors[fromId];
    });
  };

  /** Link contracts/invoices that only have vendor text to directory vendors (creating them). */
  F.linkVendors = () => {
    const todo = ["contracts", "invoices"].flatMap((k) => F.store.records(k).filter((r) => r.vendor && !F.isVendorId(r.vendorId)).map((r) => [k, r]));
    if (!todo.length) return 0;
    const ids = todo.map(([, r]) => F.ensureVendor(r.vendor, r.category ? { trade: F.TRADES.includes(r.category) ? r.category : "" } : {}));
    F.store.mutate((st) => todo.forEach(([k, r], i) => {
      const x = st[k][r.id];
      x.vendorId = ids[i];
      x.vendor = st.vendors[ids[i]].name;
      stamp(x);
    }));
    return todo.length;
  };

  /** Certificate of insurance status -> {tone, text} or null */
  F.coiStatus = (v, today = F.today()) => {
    if (!v || !F.isDate(v.insurance_expires)) return null;
    const d = F.diffDays(today, v.insurance_expires);
    if (d < 0) return { tone: "err", text: "COI expired" };
    if (d <= 30) return { tone: "warn", text: `COI expires in ${d} day${d === 1 ? "" : "s"}` };
    return { tone: "ok", text: "COI current" };
  };

  /** Directory vendors for a picker, those matching `trade` first. */
  F.vendorChoices = (trade) => vendors().slice().sort((a, b) =>
    ((b.trade === trade) - (a.trade === trade)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
})(window.FMB);
