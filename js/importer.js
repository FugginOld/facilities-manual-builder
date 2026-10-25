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
    return d.label;
  };

  F.importPrompt = (steps) => {
    const shape = {};
    for (const s of steps) {
      const o = {};
      for (const f of s.fields) o[f.name] = describe(f);
      if (s.table) o.equipment = [Object.fromEntries(s.table.columns.map((c) => [c.name, describe(c)]))];
      shape[s.key] = o;
    }
    shape.uncertain = ["anything you were unsure about, and why"];

    return [
      "Read the attached document (or the document text I paste below) and extract facility information to fill in a form.",
      "",
      "Rules:",
      "1. Use only information the document actually states. If a value isn't in the document, use \"\". Do not guess, estimate, or fill in typical values.",
      "2. Where a field says \"one of:\", use exactly one of those values, or \"\" if none clearly applies.",
      "3. Numbers: digits only, no units or commas (for example 42000).",
      "4. Fields marked \"one item per line\": put each item on its own line, separated by \\n.",
      "5. \"equipment\": one object per physical unit. \"tag\" is the unit's ID exactly as written (for example RTU-1). If the document gives no ID, use \"\".",
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

  /** Turn a pasted AI reply into a reviewable plan for building `b`. Throws on unreadable input. */
  F.buildImportPlan = (b, steps, text) => {
    const doc = extractJSON(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("The reply should be a single JSON object { … }.");

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
        const r = coerce(f, src[f.name]);
        if (!r.value && !r.problem) continue;
        const current = saved[f.name] || "";
        if (current === r.value) continue;                      // already filled in the same
        fields.push({ name: f.name, label: f.label, current, value: r.value, note: r.note, problem: r.problem,
                      conflict: !!current && !r.problem, checked: !r.problem && !current });
      }

      const rows = [];
      if (s.table && Array.isArray(src.equipment)) {
        const t = s.table, key = t.columns[0].name;
        const existing = b.equipment[t.system] || [];
        const byTag = new Map(existing.map((r) => [String(r[key]).toLowerCase(), r]));
        const used = new Set(byTag.keys());
        let auto = 0;
        for (const raw of src.equipment) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
          const row = {}, notes = [], problems = [];
          for (const c of t.columns) {
            const r = coerce(c, raw[c.name]);
            row[c.name] = r.value;
            if (r.note) notes.push(`${c.label}: ${r.note}`);
            if (r.problem) problems.push(`${c.label}: ${r.problem}`);
          }
          if (!Object.values(row).some(Boolean)) continue;

          const match = row[key] && byTag.get(row[key].toLowerCase());
          if (match) {
            const changes = t.columns
              .filter((c) => c.name !== key && row[c.name] && row[c.name] !== (match[c.name] || ""))
              .map((c) => ({ label: c.label, from: match[c.name] || "", to: row[c.name] }));
            if (!changes.length && !problems.length) continue;
            const conflict = changes.some((ch) => ch.from);
            rows.push({ kind: "update", tag: match[key], row, changes, notes, problems, conflict,
                        checked: changes.length > 0 && !conflict });
          } else {
            let tag = row[key];
            if (!tag) {
              do { auto++; tag = `NEW-${auto}`; } while (used.has(tag.toLowerCase()));
              notes.unshift(`No ID in the document, so it was named ${tag}. Rename it on the HVAC step.`);
            } else if (used.has(tag.toLowerCase())) {
              let i = 2;
              while (used.has(`${tag} (${i})`.toLowerCase())) i++;
              notes.unshift(`${tag} appears more than once in the reply; this one was named ${tag} (${i}).`);
              tag = `${tag} (${i})`;
            }
            row[key] = tag;
            used.add(tag.toLowerCase());
            rows.push({ kind: "add", tag, row, notes, problems, checked: true });
          }
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

  /** Save the ticked changes. Document blanks never erase existing values. */
  F.applyImport = (b, plan) => {
    const res = { fields: 0, added: 0, updated: 0 };
    for (const sec of plan.sections) {
      const s = sec.step;
      const picked = sec.fields.filter((f) => f.checked && !f.problem);
      const pickedRows = sec.rows.filter((r) => r.checked);
      if (!picked.length && !pickedRows.length) continue;

      const data = { ...((b.steps[s.key] || {}).data || {}) };
      for (const f of picked) { data[f.name] = f.value; res.fields++; }

      let rows = [];
      if (s.table) {
        const key = s.table.columns[0].name;
        rows = (b.equipment[s.table.system] || []).map((r) => ({ ...r }));
        for (const r of pickedRows) {
          if (r.kind === "add") {
            rows.push(Object.fromEntries(s.table.columns.map((c) => [c.name, r.row[c.name] || ""])));
            res.added++;
          } else {
            const target = rows.find((x) => String(x[key]).toLowerCase() === r.tag.toLowerCase());
            if (!target) continue;
            for (const c of s.table.columns) if (c.name !== key && r.row[c.name]) target[c.name] = r.row[c.name];
            res.updated++;
          }
        }
      }
      F.store.saveStep(b.id, s.key, data, F.missing(s, data, rows).length === 0,
                       s.table ? s.table.system : null, rows);
    }
    return res;
  };
})(window.FMB);
