/* Wizard rules: defaults, navigation, form parsing, completeness. No DOM. */
(function (F) {
  "use strict";

  F.STEPS = F.STEPS.map((s) => ({
    enabled: true, intro: "", special: "", table: null, manual: [], ...s,
    fields: (s.fields || []).map((f) => ({ kind: "text", options: [], help: "", placeholder: "", ...f })),
  }));
  F.STEPS.forEach((s) => {
    if (s.table) s.table.columns = s.table.columns.map((c) => ({ kind: "text", options: [], w: 1, ...c }));
  });
  F.SECTIONS = F.STEPS.filter((s) => !s.special);   // count toward progress; become manual chapters

  F.byKey = (key) => F.STEPS.find((s) => s.key === key) || null;
  F.number = (step) => F.STEPS.indexOf(step) + 1;

  /** Next/previous enabled step; returns `step` itself at either end. */
  F.neighbor = (step, dir) => {
    for (let i = F.STEPS.indexOf(step) + dir; i >= 0 && i < F.STEPS.length; i += dir) {
      if (F.STEPS[i].enabled) return F.STEPS[i];
    }
    return step;
  };

  /** Read a submitted step from FormData. Returns {data, rows, errors}.
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

    const rows = [];
    if (step.table) {
      const t = step.table, key = t.columns[0];
      const cols = Object.fromEntries(t.columns.map((c) => [c.name, fd.getAll(`${t.system}-${c.name}`)]));
      const n = Math.max(0, ...Object.values(cols).map((v) => v.length));
      const seen = new Set(), rowErrors = [];
      for (let i = 0; i < n; i++) {
        const r = Object.fromEntries(t.columns.map((c) => [c.name, String(cols[c.name][i] ?? "").trim()]));
        if (!Object.values(r).some(Boolean)) continue;            // ignore fully blank rows
        const label = `Row ${rows.length + 1}`, tag = r[key.name];
        if (!tag) rowErrors.push(`${label}: ${key.label} is required.`);
        else if (seen.has(tag.toLowerCase())) rowErrors.push(`${label}: duplicate ${key.label} “${tag}”.`);
        seen.add(tag.toLowerCase());
        rows.push(r);
      }
      if (rowErrors.length) errors._table = rowErrors;
    }
    return { data, rows, errors };
  };

  /** Required items still blank. Empty means the section is complete. */
  F.missing = (step, data, rows) => {
    const out = step.fields.filter((f) => f.required && !data[f.name]).map((f) => f.label);
    if (step.table && rows.length < (step.table.minRows || 0)) {
      out.push(`at least ${step.table.minRows} ${step.table.unitNoun}`);
    }
    return out;
  };

  F.warnings = (step, data, rows) => {
    const out = F.missing(step, data, rows).map((m) => `Required: ${m}`);
    if (step.table) {
      const key = step.table.columns[0].name;
      for (const c of step.table.columns) {
        if (!c.warnBlank) continue;
        const tags = rows.filter((r) => !r[c.name]).map((r) => r[key]);
        if (tags.length) out.push(`${c.label} blank on ${tags.join(", ")}`);
      }
    }
    return out;
  };
})(window.FMB);
