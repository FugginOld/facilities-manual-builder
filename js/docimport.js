/* Import contracts and invoices from documents via any AI chat (same copy/paste
 * bridge as "Fill from document"). The reply is untrusted: every value is
 * coerced, matched to known buildings/vendors/equipment, and shown for review.
 * No DOM access here. */
(function (F) {
  "use strict";

  const normTag = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  const normText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const oneOf = (opts) => `one of: ${opts.join(" | ")}`;

  /** All equipment tags in a building: [{tag, system, label}] */
  F.assetTags = (b) => {
    if (!b) return [];
    const out = [];
    for (const s of F.STEPS) {
      if (!s.table) continue;
      const key = s.table.columns[0].name;
      for (const r of b.equipment[s.table.system] || []) {
        if (!r[key]) continue;
        const desc = [r.type, r.area_served].filter(Boolean).join(", ");
        out.push({ tag: r[key], system: s.title, label: desc ? `${r[key]} (${desc})` : r[key] });
      }
    }
    return out;
  };

  // --- prompts ------------------------------------------------------------------

  const RULES = [
    "Rules:",
    "1. Use only information the document actually states. If a value isn't in the document, use \"\". Do not guess or fill in typical values.",
    "2. Where a field says \"one of:\", use exactly one of those values, or \"\" if none clearly applies.",
    "3. Dates: YYYY-MM-DD. Money and numbers: digits only, no $ or commas (for example 1250.00).",
    "4. Equipment IDs/tags exactly as written in the document (for example RTU-1). Don't invent IDs.",
    "5. List anything you were unsure about in \"uncertain\".",
    "6. Reply with only the filled-in JSON object below, as valid JSON. No other text.",
  ];

  F.contractPrompt = () => [
    "Read the attached service agreement / contract (or the text I paste below) and extract its key terms.",
    "If the document contains more than one agreement, add one object per agreement to \"contracts\".",
    "",
    ...RULES,
    "",
    JSON.stringify({
      contracts: [{
        vendor: "company providing the service",
        title: "short name of the service, e.g. HVAC preventive maintenance",
        contract_number: "contract, agreement or PO number",
        service_location: "building name or service address the contract covers",
        category: oneOf(F.CATEGORIES),
        start_date: "YYYY-MM-DD",
        term_months: "length of the initial term in months (number)",
        end_date: "YYYY-MM-DD end of the initial term",
        auto_renew: "Yes | No (does it renew automatically?)",
        renewal_term_months: "length of each renewal in months (number)",
        notice_days: "days of written notice required to cancel or not renew (number)",
        cost_amount: "price per billing period (number)",
        billing_frequency: oneOf(F.BILLING),
        service_frequency: oneOf(F.SERVICE_FREQ),
        escalation_pct: "annual price increase percent (number)",
        contact: "vendor contact name, phone, email",
        scope: "services included, one per line",
        equipment: ["equipment IDs/tags covered, exactly as written"],
        notes: "other important terms: exclusions, termination, cancellation fees, insurance",
      }],
      uncertain: ["anything you were unsure about, and why"],
    }, null, 2),
  ].join("\n");

  F.invoicePrompt = () => [
    "Read the attached service invoice(s) (or the text I paste below) and extract the details.",
    "If there is more than one invoice, add one object per invoice to \"invoices\".",
    "",
    ...RULES,
    "7. \"lines\": one object per charge line. \"amount\" is the line's extended amount before tax.",
    "",
    JSON.stringify({
      invoices: [{
        vendor: "company that issued the invoice",
        invoice_number: "",
        invoice_date: "YYYY-MM-DD",
        due_date: "YYYY-MM-DD",
        po_number: "",
        contract_number: "contract or agreement number referenced, if any",
        service_location: "building name or service address where the work was done",
        work_type: oneOf(F.WORK_TYPES),
        description: "summary of the work performed",
        lines: [{ description: "", equipment: "equipment ID/tag this line is for, exactly as written, or \"\"", amount: "number" }],
        tax: "number",
        total: "invoice total (number)",
      }],
      uncertain: ["anything you were unsure about, and why"],
    }, null, 2),
  ].join("\n");

  // --- value coercion ------------------------------------------------------------

  const EMPTY = /^(n\/?a|none|null|unknown|not (stated|specified|provided|listed|given)|-+|—|–)$/i;
  const str = (v) => (v === null || v === undefined || typeof v === "object") ? "" : String(v).trim();

  function take(def, raw, notes, problems, where = "") {
    const label = where ? `${where} ${def.label.toLowerCase()}` : def.label;
    let v = Array.isArray(raw) ? raw.map(str).filter(Boolean).join("\n") : str(raw);
    if (!v || EMPTY.test(v)) return "";
    switch (def.kind) {
      case "date": {
        const d = F.parseDate(v);
        if (!d) { problems.push(`${label}: couldn't read “${v}” as a date`); return ""; }
        return d;
      }
      case "money": {
        const m = F.parseMoney(v);
        if (m === "") { problems.push(`${label}: “${v}” isn't an amount`); return ""; }
        return m;
      }
      case "yesno":
        if (/^(y|yes|true|auto)/i.test(v)) return "Yes";
        if (/^(n|no|false)/i.test(v)) return "No";
        problems.push(`${label}: “${v}” isn't Yes or No`); return "";
      default: {
        const r = F.coerceValue(def, v);
        if (r.note) notes.push(`${label}: ${r.note}`);
        if (r.problem) problems.push(`${label}: ${r.problem}`);
        return r.value;
      }
    }
  }

  // --- matching --------------------------------------------------------------------

  /** Best building for a free-text location -> {id, note} */
  F.matchBuilding = (location, buildings) => {
    const loc = normText(location);
    if (!loc) {
      return buildings.length === 1
        ? { id: buildings[0].id, note: `No location in the document; assigned to ${buildings[0].name}, the only building.` }
        : { id: "", note: "No location in the document. Pick the building." };
    }
    const hits = buildings.filter((b) => {
      const p = (b.steps.profile || {}).data || {};
      const name = normText(p.name || b.name), street = normText(String(p.address || "").split(",")[0]);
      return (street.length >= 6 && (loc.includes(street) || street.includes(loc))) ||
             (name.length >= 3 && new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`).test(loc));
    });
    if (hits.length === 1) return { id: hits[0].id, note: "" };
    return { id: "", note: `“${location}” ${hits.length ? "matches more than one building" : "doesn't match a building"}. Pick one.` };
  };

  /** Use the spelling already on file for this vendor. */
  function matchVendor(name, known, notes) {
    const c = F.canonVendor(name);
    const hit = c && known.find((k) => F.canonVendor(k) === c);
    if (hit && hit !== name) { notes.push(`Vendor “${name}” matched to existing vendor “${hit}”.`); return hit; }
    return name;
  }

  function knownVendors(ctx) {
    const seen = new Map();
    for (const r of [...ctx.contracts, ...ctx.invoices].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))) {
      const c = F.canonVendor(r.vendor);
      if (c && !seen.has(c)) seen.set(c, r.vendor);
    }
    return [...seen.values()];
  }

  /** Match raw tags against a building's equipment. -> {tag, matched} */
  function matchTag(raw, tags) {
    const n = normTag(raw);
    const hit = n && tags.find((t) => normTag(t.tag) === n);
    return hit ? { tag: hit.tag, matched: true } : { tag: raw, matched: false };
  }

  // --- drafts ----------------------------------------------------------------------

  /** (Re)apply everything that depends on the chosen building. Mutates the draft. */
  F.assignDraftBuilding = (draft, bid, ctx) => {
    const b = ctx.buildings.find((x) => x.id === bid) || null;
    const tags = F.assetTags(b);
    draft.record.buildingId = b ? b.id : "";
    draft.assetNotes = [];
    if (draft.kind === "contract") {
      draft.record.assets = draft.rawAssets.map((raw) => {
        const m = matchTag(raw, tags);
        if (!m.matched) draft.assetNotes.push(`Equipment “${raw}” isn't in ${b ? `${b.name}'s equipment list` : "a building"}; kept as written.`);
        return { buildingId: draft.record.buildingId, tag: m.tag };
      });
    } else {
      draft.record.lines.forEach((l, i) => {
        const raw = draft.rawLineAssets[i];
        if (!raw) { l.asset = ""; return; }
        const m = matchTag(raw, tags);
        l.asset = m.tag;
        if (!m.matched) draft.assetNotes.push(`Line ${i + 1}: equipment “${raw}” isn't in ${b ? `${b.name}'s equipment list` : "a building"}; kept as written.`);
      });
      linkContract(draft, ctx);
    }
    draft.duplicate = findDuplicate(draft, ctx);
    return draft;
  };

  function linkContract(draft, ctx) {
    const r = draft.record;
    draft.contractNote = "";
    const num = normTag(draft.rawContractNumber || r.po_number);
    let hit = num && ctx.contracts.find((c) => normTag(c.contract_number) === num);
    if (hit) draft.contractNote = `Linked to contract “${hit.vendor} — ${hit.title}” by contract number.`;
    if (!hit) {
      const v = F.canonVendor(r.vendor);
      const same = ctx.contracts.filter((c) => F.canonVendor(c.vendor) === v && (c.status || "Active") !== "Ended" &&
        (c.buildingId || "") === (r.buildingId || ""));
      if (same.length === 1 && (!r.work_type || r.work_type === "Contract service")) {
        hit = same[0];
        draft.contractNote = `Linked to “${hit.vendor} — ${hit.title}”, the only contract with this vendor here. Unlink it if this was extra work.`;
      }
    }
    r.contractId = hit ? hit.id : "";
    if (hit && !r.work_type) r.work_type = "Contract service";
  }

  function findDuplicate(draft, ctx) {
    const r = draft.record;
    if (draft.kind === "invoice") return F.findDuplicateInvoice(ctx.invoices, r);
    const v = F.canonVendor(r.vendor), n = normTag(r.contract_number);
    return ctx.contracts.find((c) => F.canonVendor(c.vendor) === v &&
      ((n && normTag(c.contract_number) === n) || (!n && normText(c.title) === normText(r.title) && c.start_date === r.start_date))) || null;
  }

  function parseItems(text, key) {
    const doc = F.extractJSON(text);
    let items = Array.isArray(doc) ? doc : doc && Array.isArray(doc[key]) ? doc[key] : doc && typeof doc === "object" ? [doc] : [];
    items = items.filter((x) => x && typeof x === "object" && !Array.isArray(x));
    const unc = doc && doc.uncertain;
    const notes = Array.isArray(unc) ? unc.map((x) => String(typeof x === "object" ? JSON.stringify(x) : x).trim()).filter(Boolean)
      : typeof unc === "string" && unc.trim() ? [unc.trim()] : [];
    return { items, notes };
  }

  F.parseContractDrafts = (text, ctx) => {
    const { items, notes } = parseItems(text, "contracts");
    const vendors = knownVendors(ctx), drafts = [];
    for (const it of items) {
      const n = [], p = [], rec = { status: "Active", reviewed: false, source: "import" };
      for (const f of F.CONTRACT_FIELDS) {
        if (f.kind === "building" || f.name === "status") continue;
        rec[f.name] = take(f, it[f.name], n, p);
      }
      if (!rec.vendor && !rec.title) continue;
      if (rec.vendor) rec.vendor = matchVendor(rec.vendor, vendors, n);
      if (!rec.title) rec.title = rec.category ? `${rec.category} service` : "Service agreement";
      if (!rec.vendor) p.push("No vendor name found.");
      if (!rec.start_date) p.push("No start date found, so renewal dates can't be calculated.");
      if (rec.term_months && !/^\d+(\.\d+)?$/.test(rec.term_months)) rec.term_months = "";
      if (rec.end_date && rec.start_date && rec.end_date < rec.start_date) { p.push("End date is before the start date; check both."); }
      const eq = Array.isArray(it.equipment) ? it.equipment.map(str).filter(Boolean)
        : str(it.equipment).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      const loc = F.matchBuilding(str(it.service_location), ctx.buildings);
      const d = { kind: "contract", record: rec, notes: n, problems: p, rawAssets: [...new Set(eq)],
                  location: str(it.service_location), buildingNote: loc.note };
      F.assignDraftBuilding(d, loc.id, ctx);
      d.include = !d.duplicate && !!rec.vendor;
      drafts.push(d);
    }
    if (!drafts.length) throw new Error("No contracts found in the reply. Check that you used the contract prompt.");
    return { drafts, notes };
  };

  F.parseInvoiceDrafts = (text, ctx) => {
    const { items, notes } = parseItems(text, "invoices");
    const vendors = knownVendors(ctx), drafts = [], seen = new Set();
    for (const it of items) {
      const n = [], p = [], rec = { reviewed: false, source: "import", contractId: "" };
      for (const f of F.INVOICE_FIELDS) {
        if (f.kind === "building" || f.kind === "contract") continue;
        rec[f.name] = take(f, it[f.name], n, p);
      }
      const pairs = (Array.isArray(it.lines) ? it.lines : [])
        .filter((l) => l && typeof l === "object")
        .map((l) => ({ description: str(l.description), raw: str(l.equipment || l.asset), amountRaw: l.amount }))
        .filter((l) => l.description || l.raw || str(l.amountRaw));
      rec.lines = pairs.map((l, i) => ({ description: l.description, asset: "",
        amount: take({ label: "amount", kind: "money" }, l.amountRaw, n, p, `Line ${i + 1}`) }));
      const assetsKept = pairs.map((l) => l.raw);
      if (!rec.vendor && !rec.total && !rec.lines.length) continue;
      if (rec.vendor) rec.vendor = matchVendor(rec.vendor, vendors, n);
      else p.push("No vendor name found.");
      if (!rec.invoice_date) p.push("No invoice date found. Add it before saving, or costs won't land in the right month.");
      if (rec.total === "" && !rec.lines.length) p.push("No total or line items found.");
      const check = F.invoiceCheck(rec);
      if (check) n.push(check + " The stated total is used.");
      const loc = F.matchBuilding(str(it.service_location), ctx.buildings);
      const d = { kind: "invoice", record: rec, notes: n, problems: p, rawLineAssets: assetsKept,
                  rawContractNumber: str(it.contract_number), location: str(it.service_location), buildingNote: loc.note };
      F.assignDraftBuilding(d, loc.id, ctx);
      const key = `${F.canonVendor(rec.vendor)}|${String(rec.invoice_number).toLowerCase()}`;
      if (rec.invoice_number && seen.has(key)) {
        d.problems.push(`Invoice ${rec.invoice_number} appears more than once in the reply.`);
        d.repeat = true;
      }
      seen.add(key);
      d.include = !d.duplicate && !d.repeat && !!rec.vendor && !!rec.invoice_date;
      drafts.push(d);
    }
    if (!drafts.length) throw new Error("No invoices found in the reply. Check that you used the invoice prompt.");
    return { drafts, notes };
  };

  /** Save the ticked drafts. Returns ids saved. */
  F.applyDrafts = (drafts) => drafts.filter((d) => d.include).map((d) => {
    const r = d.record;
    if (d.kind === "invoice") {
      r.lines = r.lines.map((l) => ({ description: l.description, asset: l.asset, amount: l.amount }));
      return F.store.saveRecord("invoices", r);
    }
    return F.store.saveRecord("contracts", r);
  });
})(window.FMB);
