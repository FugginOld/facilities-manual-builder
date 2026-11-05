/* Fill from a document, via any AI chat (Copilot, ChatGPT, Gemini...).
 *   1. importPrompt()  -> prompt + JSON template built from steps.js
 *   2. the user runs it in their AI with the document attached
 *   3. buildImportPlan() -> parses the pasted reply into reviewable changes
 *   4. applyImport()    -> saves the changes the user ticked
 * The AI's reply is untrusted: values are coerced to each field's rules and
 * nothing is saved without review. No DOM access here. */
(function (F) {
  "use strict";

  /** Built (enabled, non-special) steps, optionally limited to one key. */
  F.importScope = (key) => F.STEPS.filter((s) => s.enabled && !s.special && (!key || s.key === key));

  // --- 1. prompt ----------------------------------------------------------------

  const describe = (d) => {
    if (d.kind === "select") return `one of: ${d.options.join(" | ")}`;
    if (d.kind === "number") return `${d.label} (number only)`;
    if (d.kind === "lines") return `${d.label} (one item per line, separated by \\n)`;
    if (d.kind === "vendor") return `${d.label} (company name)`;
    return d.label;
  };
  /** JSON key for a table in the prompt/reply. */
  F.tableImportKey = (s, t) => t.importKey || (s.tables.length === 1 ? "equipment" : t.system);

  F.importPrompt = (steps) => {
    const shape = {};
    for (const s of steps) {
      const o = {};
      for (const f of s.fields) o[f.name] = describe(f);
      for (const t of s.tables) o[F.tableImportKey(s, t)] = [Object.fromEntries(t.columns.map((c) => [c.name, describe(c)]))];
      shape[s.key] = o;
    }
    shape.uncertain = ["anything you were unsure about, and why"];
    const lists = steps.flatMap((s) => s.tables.map((t) => `"${F.tableImportKey(s, t)}" (${t.title.toLowerCase()}): one object per ${t.unitNoun}`));

    return [
      "Read the attached document (or the document text I paste below) and extract facility information to fill in a form.",
      "",
      "Rules:",
      "1. Use only information the document actually states. If a value isn't in the document, use \"\". Do not guess, estimate, or fill in typical values.",
      "2. Where a field says \"one of:\", use exactly one of those values, or \"\" if none clearly applies.",
      "3. Numbers: digits only, no units or commas (for example 42000).",
      "4. Fields marked \"one item per line\": put each item on its own line, separated by \\n.",
      `5. Lists: ${lists.join("; ")}. Equipment "tag" is the unit's ID exactly as written (for example RTU-1); if the document gives no ID, use "".`,
      "6. List anything you were unsure about in \"uncertain\".",
      "7. Reply with only the filled-in JSON object below, as valid JSON. No other text.",
      "",
      "Sections: " + steps.map((s) => `${s.key} = ${s.title}`).join("; "),
      "",
      JSON.stringify(shape, null, 2),
    ].join("\n");
  };

  // --- 2. parse the reply -----------------------------------------------------

  function extractJSON(text) {
    let t = String(text || "").replace(/^﻿/, "").trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1];
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b <= a) {
      throw new Error("No JSON found in what you pasted. Copy the AI's whole reply, including the { and } braces.");
    }
    t = t.slice(a, b + 1);
    const noTrailing = t.replace(/,\s*([}\]])/g, "$1");
    let last;
    for (const attempt of [t, noTrailing, noTrailing.replace(/[“”]/g, '"')]) {
      try { return JSON.parse(attempt); } catch (e) { last = e; }
    }
    throw new Error(`The reply isn't valid JSON (${last.message}). Ask the AI to "reply with only valid JSON", then paste again.`);
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const ALIASES = {
    semiannual: "Semi-annual", semiannually: "Semi-annual", biannual: "Semi-annual", biannually: "Semi-annual",
    twiceayear: "Semi-annual", every6months: "Semi-annual", "6months": "Semi-annual",
    yearly: "Annual", annually: "Annual", every12months: "Annual", "12months": "Annual",
    everymonth: "Monthly", every3months: "Quarterly", "3months": "Quarterly",
    rtu: "Rooftop package", rooftopunit: "Rooftop package", splitsystemac: "Split system",
  };

  function matchOption(v, options) {
    const n = norm(v);
    const exact = options.find((o) => norm(o) === n);
    if (exact) return { value: exact };
    if (ALIASES[n] && options.includes(ALIASES[n])) return { value: ALIASES[n], note: `“${v}” read as “${ALIASES[n]}”` };
    const hits = options.filter((o) => {
      const no = norm(o), paren = o.match(/\(([^)]+)\)/);
      return no.includes(n) || n.includes(no) || (paren && norm(paren[1]) === n);
    });
    if (hits.length === 1) return { value: hits[0], note: `“${v}” read as “${hits[0]}”` };
    return { value: "", problem: `“${v}” isn't one of the allowed choices` };
  }

  const EMPTY = /^(n\/?a|none|null|unknown|not (stated|specified|provided|listed|given)|-+|—|–)$/i;

  /** Coerce one AI value to a field/column definition -> {value, note?, problem?} */
  function coerce(def, raw) {
    if (raw === null || raw === undefined) return { value: "" };
    if (Array.isArray(raw)) raw = raw.join("\n");
    if (typeof raw === "object") return { value: "", problem: "unexpected structure in the reply" };
    let v = String(raw).trim();
    if (!v || EMPTY.test(v)) return { value: "" };
    if (def.kind === "select") return matchOption(v, def.options);
    if (def.kind === "number") {
      const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
      if (!m) return { value: "", problem: `“${v}” isn't a number` };
      return { value: m[0], note: m[0] !== v ? `“${v}” read as ${m[0]}` : undefined };
    }
    if (def.kind === "lines") {
      v = v.replace(/\\n/g, "\n").split(/\r?\n/)
        .map((s) => s.replace(/^\s*(\d+[.)]|[-*•])\s+/, "").trim()).filter(Boolean).join("\n");
    } else if (def.kind !== "textarea") {
      v = v.replace(/\s*\r?\n\s*/g, " ");
    }
    return { value: v };
  }

  F.extractJSON = extractJSON;          // shared with docimport.js
  F.coerceValue = coerce;
  F.matchOption = matchOption;

  /** coerce() plus vendor matching: a known vendor becomes its id; an unknown one stays as text (added on apply). */
  function coerceAny(def, raw) {
    if (def.kind !== "vendor") return coerce(def, raw);
    const r = coerce({ ...def, kind: "text" }, raw);
    if (!r.value) return r;
    const hit = F.findVendor(r.value);
    if (hit) return { value: hit.id, note: hit.name !== r.value ? `“${r.value}” matched to “${hit.name}” in the vendor directory` : undefined };
    return { value: r.value, note: `“${r.value}” isn't in the vendor directory yet; it's added when you apply` };
  }
  const show = (def, v) => F.displayValue(def, v);

  /** Turn a pasted AI reply into a reviewable plan for building `b`. Throws on unreadable input. */
  F.buildImportPlan = (b, steps, text) => {
    const doc = extractJSON(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("The reply should be a single JSON object { … }.");
    return F.buildImportPlanFromDoc(b, steps, doc);
  };

  // --- CSV for wizard tables ------------------------------------------------------

  /** RFC 4180-ish CSV parser: quotes, doubled quotes, CRLF, BOM; delimiter , ; or tab (auto). */
  F.parseCSV = (text) => {
    const t = String(text || "").replace(/^\uFEFF/, "");
    const first = t.split(/\r?\n/, 1)[0] || "";
    const count = (ch) => (first.match(new RegExp(ch === "\t" ? "\t" : `\\${ch}`, "g")) || []).length;
    const d = [",", ";", "\t"].sort((x, y) => count(y) - count(x))[0];
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"' && cur === "") q = true;
      else if (c === d) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && t[i + 1] === "\n") i++;
        row.push(cur); rows.push(row); row = []; cur = "";
      } else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ""));
  };

  const normHead = (s) => String(s || "").toLowerCase().replace(/^'/, "").replace(/[^a-z0-9]+/g, "");

  /** CSV text -> { doc (as an AI reply would look), notes } for one table of a step. */
  F.csvToDoc = (step, t, text) => {
    const rows = F.parseCSV(text);
    if (rows.length < 2) throw new Error("The CSV file needs a header row and at least one data row.");
    const map = rows[0].map((h) => {
      const n = normHead(h);
      return t.columns.find((c) => normHead(c.label) === n || normHead(c.name) === n) || null;
    });
    const notes = [];
    rows[0].forEach((h, i) => { if (!map[i] && h.trim()) notes.push(`Column “${h.trim()}” doesn't match a field in ${t.title}; ignored.`); });
    if (!map.some((c) => c && c.name === t.key)) {
      throw new Error(`The CSV has no “${F.keyColumn(t).label}” column, which identifies each row. Export a CSV first to see the expected columns.`);
    }
    const items = rows.slice(1).map((r) => {
      const o = {};
      map.forEach((c, i) => { if (c) o[c.name] = String(r[i] ?? "").replace(/^'(?=[=+@\-])/, "").trim(); });
      return o;
    });
    return { doc: { [step.key]: { [F.tableImportKey(step, t)]: items } }, notes };
  };

  /** One table as CSV rows (header = column labels; vendor ids shown as names). */
  F.tableToCSVRows = (t, list) => [t.columns.map((c) => c.label),
    ...list.map((r) => t.columns.map((c) => (c.kind === "vendor" ? F.vendorName(r[c.name]) : r[c.name] || "")))];

  /** Plan from an already-parsed reply object. */
  F.buildImportPlanFromDoc = (b, steps, doc) => {

    const plan = { sections: [], notes: [] };
    const unc = doc.uncertain;
    if (Array.isArray(unc)) plan.notes = unc.map((x) => String(typeof x === "object" ? JSON.stringify(x) : x).trim()).filter(Boolean);
    else if (typeof unc === "string" && unc.trim()) plan.notes = [unc.trim()];

    for (const s of steps) {
      const src = doc[s.key];
      if (!src || typeof src !== "object" || Array.isArray(src)) continue;
      const saved = (b.steps[s.key] || {}).data || {};

      const fields = [];
      for (const f of s.fields) {
        const r = coerceAny(f, src[f.name]);
        if (!r.value && !r.problem) continue;
        const current = saved[f.name] || "";
        if (current === r.value) continue;                      // already filled in the same
        fields.push({ name: f.name, label: f.label, current, value: r.value, note: r.note, problem: r.problem,
                      currentText: show(f, current), valueText: show(f, r.value),
                      conflict: !!current && !r.problem, checked: !r.problem && !current });
      }

      const rows = [];
      for (const t of s.tables) {
        const list = src[F.tableImportKey(s, t)];
        if (!Array.isArray(list)) continue;
        const key = t.key, kc = F.keyColumn(t);
        const byTag = new Map((b.equipment[t.system] || []).map((r) => [String(r[key]).toLowerCase(), r]));
        const used = new Set(byTag.keys());
        let auto = 0;
        for (const raw of list) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const row = {}, notes = [], problems = [];
          for (const c of t.columns) {
            const r = coerceAny(c, raw[c.name]);
            row[c.name] = r.value;
            if (r.note) notes.push(`${c.label}: ${r.note}`);
            if (r.problem) problems.push(`${c.label}: ${r.problem}`);
          }
          if (!Object.values(row).some(Boolean)) continue;
          if (!row[key] && key === "name" && row.role) row[key] = row.role;

          const match = row[key] && byTag.get(row[key].toLowerCase());
          if (match) {
            const changes = t.columns
              .filter((c) => c.name !== key && row[c.name] && row[c.name] !== (match[c.name] || ""))
              .map((c) => ({ label: c.label, from: show(c, match[c.name]), to: show(c, row[c.name]) }));
            if (!changes.length && !problems.length) continue;
            const conflict = changes.some((ch) => ch.from);
            rows.push({ table: t, kind: "update", tag: match[key], tagText: show(kc, match[key]), row, changes, notes, problems, conflict,
                        checked: changes.length > 0 && !conflict });
            continue;
          }
          let tag = row[key];
          if (!tag) {
            if (!t.assets) continue;                            // nothing to identify the row by
            do { auto++; tag = `NEW-${auto}`; } while (used.has(tag.toLowerCase()));
            notes.unshift(`No ID in the document, so it was named ${tag}. Rename it on the ${s.title} step.`);
          } else if (t.unique && used.has(tag.toLowerCase())) {
            if (!t.assets) continue;                            // same vendor listed twice: keep one
            let i = 2;
            while (used.has(`${tag} (${i})`.toLowerCase())) i++;
            notes.unshift(`${tag} appears more than once in the reply; this one was named ${tag} (${i}).`);
            tag = `${tag} (${i})`;
          }
          row[key] = tag;
          used.add(tag.toLowerCase());
          rows.push({ table: t, kind: "add", tag, tagText: show(kc, tag), row, notes, problems, checked: true });
        }
      }
      if (fields.length || rows.length) plan.sections.push({ step: s, fields, rows });
    }
    return plan;
  };

  F.importCounts = (plan) => {
    let n = 0;
    for (const sec of plan.sections) n += sec.fields.filter((f) => f.checked).length + sec.rows.filter((r) => r.checked).length;
    return n;
  };

  // --- 4. apply -----------------------------------------------------------------

  // vendor names not yet in the directory become directory vendors
  const toVendorId = (v, trade) => (!v || F.isVendorId(v) ? v : F.ensureVendor(v, trade && F.TRADES.includes(trade) ? { trade } : {}));

  /** Save the ticked changes. Document blanks never erase existing values. */
  F.applyImport = (b, plan) => {
    const res = { fields: 0, added: 0, updated: 0, vendors: 0 };
    const before = F.store.records("vendors").length;
    for (const sec of plan.sections) {
      const s = sec.step;
      const picked = sec.fields.filter((f) => f.checked && !f.problem);
      const pickedRows = sec.rows.filter((r) => r.checked);
      if (!picked.length && !pickedRows.length) continue;

      const data = { ...((b.steps[s.key] || {}).data || {}) };
      for (const f of picked) {
        const def = s.fields.find((x) => x.name === f.name);
        data[f.name] = def.kind === "vendor" ? toVendorId(f.value, def.trade) : f.value;
        res.fields++;
      }

      const rows = {};
      for (const t of s.tables) {
        const key = t.key, list = (b.equipment[t.system] || []).map((r) => ({ ...r }));
        const fix = (row) => { for (const c of t.columns) if (c.kind === "vendor") row[c.name] = toVendorId(row[c.name], row.trade); return row; };
        for (const r of pickedRows.filter((x) => x.table === t)) {
          if (r.kind === "add") {
            list.push(fix(Object.fromEntries(t.columns.map((c) => [c.name, r.row[c.name] || ""]))));
            res.added++;
          } else {
            const target = list.find((x) => String(x[key]).toLowerCase() === r.tag.toLowerCase());
            if (!target) continue;
            for (const c of t.columns) if (c.name !== key && r.row[c.name]) target[c.name] = r.row[c.name];
            fix(target);
            res.updated++;
          }
        }
        rows[t.system] = list;
      }
      F.store.saveStep(b.id, s.key, data, F.missing(s, data, rows).length === 0, rows);
    }
    res.vendors = F.store.records("vendors").length - before;
    return res;
  };
})(window.FMB);
