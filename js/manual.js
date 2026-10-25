/* Build the .docx manual for one building with the bundled docx library
 * (vendor/docx.iife.js, global `docx`). Returns a docx.Document; the caller
 * packs it with docx.Packer.toBlob(). No DOM access, so it also runs in Node. */
(function (F) {
  "use strict";

  const INK = "1B2430", ACCENT = "C2410C", MUTED = "5B6575", ZEBRA = "F2F4F7", GRIDLINE = "9AA3AF";
  const MONO = "Consolas", BODY = "Arial";
  const PAGE_W = 12240, PAGE_H = 15840, MARGIN = 1152;      // twips: Letter, 0.8" margins
  const CONTENT = PAGE_W - 2 * MARGIN;                     // 9936 = 6.9"

  F.buildManual = function (b, today = new Date()) {
    const D = window.docx;
    const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
            BorderStyle, Header, Footer, PageNumber, TabStopType, HeadingLevel, TableLayoutType } = D;

    // --- helpers -----------------------------------------------------------
    const run = (text, o = {}) => new TextRun({
      text, bold: o.bold, italics: o.italic, color: o.color,
      size: o.size ? Math.round(o.size * 2) : undefined, font: o.mono ? MONO : undefined,
    });
    const para = (children, o = {}) => new Paragraph({ spacing: { after: 120 }, ...o, children });
    const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] });
    const muted = (text) => para([run(text, { italic: true, color: MUTED })]);

    const edge = (color, size) => ({ style: BorderStyle.SINGLE, size, color });
    const allBorders = (color, size) => {
      const e = edge(color, size);
      return { top: e, bottom: e, left: e, right: e, insideHorizontal: e, insideVertical: e };
    };

    const widths = (weights, total = CONTENT) => {
      const sum = weights.reduce((a, c) => a + c, 0);
      const ws = weights.map((w) => Math.floor((w / sum) * total));
      ws[ws.length - 1] += total - ws.reduce((a, c) => a + c, 0);
      return ws;
    };

    const cell = (text, o = {}) => new TableCell({
      width: { size: o.w, type: WidthType.DXA },
      shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
      margins: { top: 50, bottom: 50, left: 100, right: 100 },
      children: [new Paragraph({ spacing: { after: 0 }, children: [
        run(text ? String(text) : "—", { bold: o.bold, color: o.color, mono: o.mono, size: 9.5 }),
      ] })],
    });

    const table = (ws, rows) => new Table({
      width: { size: ws.reduce((a, c) => a + c, 0), type: WidthType.DXA },
      columnWidths: ws, layout: TableLayoutType.FIXED, borders: allBorders(GRIDLINE, 4), rows,
    });

    const grid = (headers, rows, { mono = [], weights } = {}) => {
      const ws = widths(weights || headers.map(() => 1));
      const head = new TableRow({ tableHeader: true,
        children: headers.map((h, i) => cell(h, { w: ws[i], bold: true, color: "FFFFFF", fill: INK })) });
      const body = rows.map((r, n) => new TableRow({
        children: r.map((v, i) => cell(v, { w: ws[i], mono: mono.includes(i), fill: n % 2 ? ZEBRA : undefined })),
      }));
      return [table(ws, [head, ...body]), spacer()];
    };

    const kv = (pairs, total = CONTENT) => {
      const ws = [2880, total - 2880];
      return [table(ws, pairs.map(([k, v]) => new TableRow({ children: [
        cell(k, { w: ws[0], bold: true, fill: ZEBRA }), cell(v, { w: ws[1] }),
      ] }))), spacer()];
    };

    const numbered = (items) => items.map((t, i) => new Paragraph({
      spacing: { after: 40 }, indent: { left: 432, hanging: 432 },
      tabStops: [{ type: TabStopType.LEFT, position: 432 }],
      children: [run(`${i + 1}.\t`, { bold: true }), run(t)],
    }));

    const lines = (text) => String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

    // --- manual parts ------------------------------------------------------
    const parts = {
      fields(step, part, data) {
        const fields = step.fields.filter((f) => !part.fields || part.fields.includes(f.name));
        const plain = fields.filter((f) => f.kind !== "lines");
        const lists = fields.filter((f) => f.kind === "lines");

        if (part.callout) {                       // boxed emergency info, readable at a glance
          const kids = [];
          for (const f of plain) {
            kids.push(para([run(f.label.toUpperCase(), { bold: true, size: 8.5, color: ACCENT })], { spacing: { after: 40 } }));
            kids.push(para([run(data[f.name] || "—", { size: 11 })]));
          }
          for (const f of lists) {
            kids.push(para([run(f.label.toUpperCase(), { bold: true, size: 8.5, color: ACCENT })], { spacing: { after: 40 } }));
            kids.push(...numbered(lines(data[f.name]).length ? lines(data[f.name]) : ["—"]));
          }
          return [new Table({
            width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [CONTENT],
            layout: TableLayoutType.FIXED, borders: allBorders(ACCENT, 16),
            rows: [new TableRow({ children: [new TableCell({
              width: { size: CONTENT, type: WidthType.DXA },
              margins: { top: 120, bottom: 120, left: 160, right: 160 }, children: kids,
            })] })],
          }), spacer()];
        }

        const out = plain.length ? kv(plain.map((f) => [f.label, data[f.name] || ""])) : [];
        for (const f of lists) {
          out.push(para([run(f.label, { bold: true })]));
          out.push(...numbered(lines(data[f.name]).length ? lines(data[f.name]) : ["—"]));
        }
        return out;
      },

      table(step, part, data, rows) {
        if (!rows.length) return [muted(`No ${step.table.unitNoun}s listed.`)];
        const cols = step.table.columns;
        return grid(cols.map((c) => c.label), rows.map((r) => cols.map((c) => r[c.name] || "")), {
          mono: cols.map((c, i) => (c.mono ? i : -1)).filter((i) => i >= 0),
          weights: cols.map((c) => c.w),
        });
      },

      pm(step, part, data, rows) {
        const key = step.table.columns[0].name;
        const groups = Object.fromEntries(F.PM_INTERVALS.map((i) => [i, []]));
        const unscheduled = [];
        for (const r of rows) (groups[r.pm_interval] || unscheduled).push(r[key]);
        const by = data.service_vendor || "In-house";
        const out = Object.entries(groups).filter(([, tags]) => tags.length)
          .map(([interval, tags]) => [F.PM_TASK, tags.join(", "), interval, by]);
        if (unscheduled.length) out.push(["No PM interval set: assign one", unscheduled.join(", "), "—", "—"]);
        if (!out.length) return [muted("No equipment listed.")];
        return grid(["Task", "Units", "Interval", "Performed by"], out, { mono: [1], weights: [3, 2, 1.2, 1.8] });
      },
    };

    // --- document ----------------------------------------------------------
    const profile = (b.steps.profile || {}).data || {};
    const name = profile.name || b.name || "Unnamed building";
    const docNo = profile.doc_number || "FM-?";
    const rev = profile.revision || "A";
    const complete = F.SECTIONS.every((s) => (b.steps[s.key] || {}).completed);
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const body = [
      para([run("FACILITIES MANUAL", { bold: true, size: 11, color: ACCENT })], { spacing: { before: 1920, after: 120 } }),
      para([run(name, { bold: true, size: 30 })], { border: { bottom: { ...edge(ACCENT, 18), space: 4 } } }),
      para([run(profile.address || "Address not set", { size: 12, color: MUTED })]),
      spacer(),
      ...kv([
        ["Document number", docNo],
        ["Revision", rev],
        ["Generated", ymd],
        ["Status", complete ? "COMPLETE" : "DRAFT: sections incomplete"],
      ], 7200),
      para([run("Contents", { bold: true, size: 12 })]),
      ...grid(["§", "Section", "Status"], F.SECTIONS.map((s) => {
        const sv = b.steps[s.key];
        return [String(F.number(s)), s.title, sv && sv.completed ? "Complete" : sv ? "Draft" : "Not started"];
      }), { weights: [0.5, 4, 1.5] }),
    ];

    for (const s of F.SECTIONS) {
      const num = F.number(s);
      body.push(new Paragraph({
        heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
        border: { bottom: { ...edge(ACCENT, 18), space: 4 } },
        children: [run(`${num}   `, { color: ACCENT }), run(s.title)],
      }));
      const sv = b.steps[s.key];
      if (!s.enabled || !sv) { body.push(muted("Not yet completed.")); continue; }
      const rows = s.table ? (b.equipment[s.table.system] || []) : [];
      if (!sv.completed) body.push(muted("Draft: required items in this section are still missing."));
      s.manual.forEach((part, j) => {
        body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run(`${num}.${j + 1}  ${part.title}`)] }));
        body.push(...parts[part.kind](s, part, sv.data, rows));
      });
    }

    const small = { size: 8.5, color: MUTED };
    return new D.Document({
      creator: "Facilities Manual Builder",
      title: `${name} — Facilities Manual`,
      styles: {
        default: { document: { run: { font: BODY, size: 20, color: INK } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { font: BODY, size: 36, bold: true, color: INK }, paragraph: { spacing: { after: 240 } } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
            run: { font: BODY, size: 25, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true } },
        ],
      },
      sections: [{
        properties: { page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        } },
        headers: { default: new Header({ children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT }],
          children: [run(name, small), run(`\t${docNo} · Rev ${rev}`, { ...small, mono: true })],
        })] }) },
        footers: { default: new Footer({ children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: CONTENT }],
          children: [run("Uncontrolled when printed", small),
            new TextRun({ children: ["\tPage ", PageNumber.CURRENT], size: 17, color: MUTED })],
        })] }) },
        children: body,
      }],
    });
  };

  F.manualFilename = function (b) {
    const p = (b.steps.profile || {}).data || {};
    return `${p.doc_number || "FM"}-Rev${p.revision || "A"}`.replace(/[^A-Za-z0-9._-]+/g, "_") + ".docx";
  };
})(window.FMB);
