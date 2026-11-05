/* Wizard rules: defaults, navigation, form parsing, completeness. No DOM.
 * Table rows travel as a map { system: [rows] } (stored in building.equipment). */
(function (F) {
  "use strict";

  const normTable = (t) => {
    const columns = t.columns.map((c) => ({ kind: "text", options: [], w: 1, ...c }));
    return { unique: true, minRows: 0, ...t, columns, key: t.key || columns[0].name };
  };
  F.STEPS = F.STEPS.map((s) => {
    const tables = (s.tables || (s.table ? [s.table] : [])).map(normTable);
    return {
      enabled: true, intro: "", special: "", manual: [], ...s, tables, table: tables[0] || null,
      fields: (s.fields || []).map((f) => ({ kind: "text", options: [], help: "", placeholder: "", ...f })),
    };
  });
  F.SECTIONS = F.STEPS.filter((s) => !s.special);   // count toward progress; become manual chapters

  F.byKey = (key) => F.STEPS.find((s) => s.key === key) || null;
  F.number = (step) => F.STEPS.indexOf(step) + 1;
  F.tableOf = (step, system) => step.tables.find((t) => t.system === system) || step.tables[0] || null;
  F.keyColumn = (t) => t.columns.find((c) => c.name === t.key);
  /** Saved rows for every table of a step: { system: [rows] } */
  F.stepRows = (b, step) => Object.fromEntries(step.tables.map((t) => [t.system, (b.equipment[t.system] || [])]));

  /** Next/previous enabled step; returns `step` itself at either end. */
  F.neighbor = (step, dir) => {
    for (let i = F.STEPS.indexOf(step) + dir; i >= 0 && i < F.STEPS.length; i += dir) {
      if (F.STEPS[i].enabled) return F.STEPS[i];
    }
    return step;
  };

  /** Plain text for a stored field/column value (resolves vendor ids). */
  F.displayValue = (def, v) => (def && def.kind === "vendor" && F.vendorText ? F.vendorText(v) : (v || ""));

  /** Read a submitted step from FormData. Returns {data, rows: {system: []}, errors}.
   *  Errors block saving; missing required fields don't (they keep the step incomplete). */
  F.parse = (step, fd) => {
    const data = {}, errors = {};
    for (const f of step.fields) {
      const v = String(fd.get(f.name) ?? "").trim();
      if (f.kind === "number" && v && !Number.isFinite(Number(v.replace(/,/g, "")))) {
        errors[f.name] = "Enter a number.";
      } else if (f.kind === "select" && v && !f.options.includes(v)) {
        errors[f.name] = "Pick an option from the list.";
      }
      data[f.name] = v;
    }

    const rows = {};
    for (const t of step.tables) {
      const key = F.keyColumn(t);
      const cols = Object.fromEntries(t.columns.map((c) => [c.name, fd.getAll(`${t.system}-${c.name}`)]));
      const n = Math.max(0, ...Object.values(cols).map((v) => v.length));
      const seen = new Set(), rowErrors = [], out = [];
      for (let i = 0; i < n; i++) {
        const r = Object.fromEntries(t.columns.map((c) => [c.name, String(cols[c.name][i] ?? "").trim()]));
        if (!Object.values(r).some(Boolean)) continue;            // ignore fully blank rows
        const label = `Row ${out.length + 1}`, id = r[key.name];
        if (!id) rowErrors.push(`${label}: ${key.label} is required.`);
        else if (t.unique && seen.has(id.toLowerCase())) rowErrors.push(`${label}: duplicate ${key.label} “${F.displayValue(key, id)}”.`);
        if (id) seen.add(id.toLowerCase());
        out.push(r);
      }
      rows[t.system] = out;
      if (rowErrors.length) (errors._tables = errors._tables || {})[t.system] = rowErrors;
    }
    return { data, rows, errors };
  };

  /** Required items still blank. Empty means the section is complete. */
  F.missing = (step, data, rows) => {
    const out = step.fields.filter((f) => f.required && !data[f.name]).map((f) => f.label);
    for (const t of step.tables) {
      if ((rows[t.system] || []).length < t.minRows) out.push(`at least ${t.minRows} ${t.unitNoun}`);
    }
    return out;
  };

  F.warnings = (step, data, rows) => {
    const out = F.missing(step, data, rows).map((m) => `Required: ${m}`);
    for (const t of step.tables) {
      const key = t.key, list = rows[t.system] || [];
      for (const c of t.columns) {
        if (!c.warnBlank) continue;
        const tags = list.filter((r) => !r[c.name]).map((r) => r[key]);
        if (tags.length) out.push(`${c.label} blank on ${tags.join(", ")}`);
      }
      const kc = F.keyColumn(t);
      if (kc.kind === "vendor") {
        const legacy = list.filter((r) => r[kc.name] && F.isVendorId && !F.isVendorId(r[kc.name])).map((r) => r[kc.name]);
        if (legacy.length) out.push(`Not in the vendor directory: ${legacy.join(", ")}`);
      }
    }
    for (const f of step.fields) {
      if (f.kind === "vendor" && data[f.name] && F.isVendorId && !F.isVendorId(data[f.name])) {
        out.push(`${f.label} “${data[f.name]}” isn't in the vendor directory. Pick or add the vendor.`);
      }
    }
    return out;
  };
})(window.FMB);
