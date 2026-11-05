/* Screens for Contracts, Invoices and Costs. Routes:
 *   #/contracts  #/contracts/new  #/contracts/<id>
 *   #/invoices   #/invoices/new   #/invoices/<id>   (new accepts ?contract=<id>)
 *   #/costs
 * app.js owns the router, top bar, flashes and dirty tracking; it calls into
 * F.finUI and exposes its helpers as F.ui. */
(function (F) {
  "use strict";

  const esc = (s) => F.ui.esc(s);
  const plural = (n, w) => F.ui.plural(n, w);
  const KIND = { contracts: "contract", invoices: "invoice" };
  const COMPANY = "Company-wide / unassigned";

  // per-viewer filters (remembered in this browser when possible)
  // year / invYear: budget years; null = the current one; invYear 0 = all years
  const view = { scope: "all", year: null, invYear: null, vendor: "", type: "" };
  try { Object.assign(view, JSON.parse(localStorage.getItem("fmb.view") || "{}")); } catch (e) { /* ignore */ }
  const remember = () => { try { localStorage.setItem("fmb.view", JSON.stringify(view)); } catch (e) { /* ignore */ } };

  let override = null;          // unsaved form state re-shown after a failed save or a building change
  let route = null;
  let shownUnsaved = false;     // the last render re-showed unsaved form values

  // --- small helpers -------------------------------------------------------------

  const SM = () => F.store.fyStart();
  const curFY = () => F.budgetYearOf(F.today(), SM());
  const costYear = () => view.year || curFY();
  const invYear = () => (view.invYear === null || view.invYear === undefined ? curFY() : view.invYear);
  const fyLabel = (y) => F.budgetYearLabel(y, SM());
  const fyOption = (y) => (SM() === 1 ? String(y) : `${fyLabel(y)} (${F.budgetYearSpan(y, SM())})`);
  const buildings = () => F.store.list();
  const bName = (id) => (id && F.store.get(id) ? F.store.get(id).name : COMPANY);
  const contracts = () => F.store.records("contracts");
  const invoices = () => F.store.records("invoices");
  const ctx = () => ({ buildings: buildings(), contracts: contracts(), invoices: invoices() });
  const inScope = (r) => view.scope === "all" || (r.buildingId || "") === view.scope;
  const badge = (tone, text) => `<span class="badge ${tone || ""}">${esc(text)}</span>`;
  const reviewBadge = (r) => (r.reviewed === false ? ` ${badge("warn", "CHECK")}` : "");
  const daysText = (n) => (n === 0 ? "today" : n > 0 ? `in ${plural(n, "day")}` : `${plural(-n, "day")} ago`);

  function scopeOptions(value, withAll) {
    const opts = [];
    if (withAll) opts.push(["all", "All buildings"]);
    for (const b of buildings()) opts.push([b.id, b.name]);
    opts.push(["", COMPANY]);
    return opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("");
  }

  /** Budget years that have data, plus the current and next one. Newest first. */
  function years() {
    const sm = SM(), cur = curFY(), ys = new Set([cur, cur + 1]);
    if (view.year) ys.add(view.year);
    for (const i of invoices()) { const y = F.budgetYearOf(i.invoice_date, sm); if (y) ys.add(y); }
    for (const c of contracts()) { const y = F.budgetYearOf(c.start_date, sm); if (y && y <= cur + 1) ys.add(y); }
    for (const k of F.store.budgetYears()) ys.add(k);
    return [...ys].sort((a, b) => b - a);
  }

  function filterBar(items) {
    return `<form class="filters" aria-label="Filters" onsubmit="return false">${items.join("")}</form>`;
  }
  const scopeFilter = () => `<label>Building <select data-filter="scope">${scopeOptions(view.scope, true)}</select></label>`;
  const yearFilter = (key, sel, all) => `<label>${SM() === 1 ? "Year" : "Budget year"} <select data-filter="${key}">${all ? `<option value="0"${sel === 0 ? " selected" : ""}>All years</option>` : ""}${years().map((y) =>
    `<option value="${y}"${y === sel ? " selected" : ""}>${esc(fyOption(y))}</option>`).join("")}</select></label>`;

  const pageHead = (title, lede, actions) => `
<div class="page-head">
  <div><h1>${title}</h1><p class="lede">${lede}</p></div>
  <div class="head-actions">${actions}</div>
</div>`;

  const tile = (label, value, sub = "", extra = "") =>
    `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ""}${extra}</div>`;

  // --- form fields ------------------------------------------------------------------

  function fieldHtml(f, value, error, opts = {}) {
    const id = `ff-${f.name}`, v = value ?? "";
    const wide = f.wide || f.kind === "textarea";
    let input;
    const select = (options) => `<select id="${id}" name="${f.name}">${options}</select>`;
    switch (f.kind) {
      case "select":
        input = select(`<option value="">—</option>${f.options.map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}`);
        break;
      case "yesno":
        input = select(["", "Yes", "No"].map((o) => `<option value="${o}"${o === v ? " selected" : ""}>${o || "—"}</option>`).join(""));
        break;
      case "building":
        input = select(scopeOptions(v, false));
        break;
      case "contract":
        input = select(`<option value="">— Not under a contract</option>${(opts.contracts || []).map((c) =>
          `<option value="${esc(c.id)}"${c.id === v ? " selected" : ""}>${esc(`${c.vendor} — ${c.title}`)}${(c.status || "Active") === "Ended" ? " (ended)" : ""}</option>`).join("")}`);
        break;
      case "textarea":
        input = `<textarea id="${id}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
        break;
      case "date":
        input = `<input id="${id}" name="${f.name}" type="date" value="${esc(v)}">`;
        break;
      case "money":
        input = `<div class="money"><span aria-hidden="true">$</span><input id="${id}" name="${f.name}" type="text" inputmode="decimal" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" autocomplete="off"></div>`;
        break;
      default:
        input = `<input id="${id}" name="${f.name}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}"${f.kind === "number" ? ' inputmode="decimal"' : ""} autocomplete="off">`;
    }
    return `<div class="field${wide ? " wide" : ""}${error ? " has-error" : ""}">
  <label for="${id}">${esc(f.label)}${f.required ? ' <span class="req" title="Required">*</span>' : ""}</label>
  ${input}
  ${error ? `<div class="err">${esc(error)}</div>` : f.help ? `<div class="help">${esc(f.help)}</div>` : ""}
</div>`;
  }

  // --- routing --------------------------------------------------------------------------

  function parse(hash) {
    let m = /^#\/(contracts|invoices)(?:\/([^/?]+))?(?:\?(.*))?$/.exec(hash);
    if (m) return { name: "fin", page: m[1], id: m[2] ? decodeURIComponent(m[2]) : "", query: new URLSearchParams(m[3] || "") };
    m = /^#\/costs\/?$/.exec(hash);
    if (m) return { name: "fin", page: "costs" };
    return null;
  }

  /** -> {html, title} or null when the record doesn't exist */
  function render(r) {
    route = r;
    shownUnsaved = false;
    if (r.page === "costs") return { html: renderCosts(), title: "Costs" };
    if (!r.id) return r.page === "contracts" ? { html: renderContracts(), title: "Contracts" } : { html: renderInvoices(), title: "Invoices" };
    const rec = r.id === "new" ? null : F.store.record(r.page, r.id);
    if (r.id !== "new" && !rec) return null;
    return r.page === "contracts"
      ? { html: renderContractForm(rec), title: rec ? `${rec.vendor} — ${rec.title}` : "New contract" }
      : { html: renderInvoiceForm(rec), title: rec ? `Invoice ${rec.invoice_number || ""} · ${rec.vendor}` : "New invoice" };
  }

  // --- contracts list ------------------------------------------------------------------

  function renderContracts() {
    const today = F.today(), all = contracts().filter(inScope);
    const rows = all.map((c) => ({ c, i: F.contractInfo(c, today) }))
      .sort((a, b) => (a.i.state === "Ended") - (b.i.state === "Ended") || (a.i.termEnd || "9").localeCompare(b.i.termEnd || "9"));
    const live = rows.filter((x) => !["Ended", "Expired"].includes(x.i.state));
    const annual = live.reduce((a, x) => a + (x.i.annual || 0), 0);
    const deadlines = F.deadlines(all, today, 120);
    const soon = deadlines.filter((d) => d.days >= 0 && d.days <= 90).length;

    const dl = deadlines.length ? `<section class="card">
  <div class="card-head"><h2>Upcoming deadlines</h2><span class="small dim-ink">next 120 days</span>
    <button type="button" class="btn push" data-fin="ics">Add reminders to calendar (.ics)</button></div>
  <ul class="deadlines">${deadlines.map((d) => `<li class="${d.days < 0 ? "missed" : d.days <= 30 ? "near" : ""}">
    <div class="dl-date"><span class="mono">${esc(F.fmtDate(d.date))}</span><span class="small">${esc(daysText(d.days))}</span></div>
    <div class="dl-body"><a href="#/contracts/${encodeURIComponent(d.contract.id)}"><strong>${esc(d.contract.vendor)}</strong> — ${esc(d.contract.title)}</a>
      <div class="small">${esc(d.text)} · ${esc(bName(d.contract.buildingId))}${d.info.annual ? ` · ${esc(F.money0(d.info.annual))}/yr` : ""}</div></div>
  </li>`).join("")}</ul>
</section>` : "";

    const table = rows.length ? `<section class="card"><div class="table-wrap"><table class="grid list">
  <thead><tr><th scope="col">Vendor / service</th><th scope="col">Building</th><th scope="col">Status</th><th scope="col">Term ends</th><th scope="col">Notice by</th><th scope="col" class="num">Annual cost</th><th scope="col">Next service</th></tr></thead>
  <tbody>${rows.map(({ c, i }) => `<tr>
    <td><a href="#/contracts/${encodeURIComponent(c.id)}"><strong>${esc(c.vendor)}</strong></a>${reviewBadge(c)}<div class="small dim-ink">${esc(c.title)}${c.category ? ` · ${esc(c.category)}` : ""}</div></td>
    <td>${esc(bName(c.buildingId))}</td>
    <td>${badge(i.tone, i.state)}</td>
    <td class="mono">${esc(F.fmtDate(i.termEnd))}${i.renews ? '<div class="small dim-ink">auto-renews</div>' : ""}</td>
    <td class="mono">${esc(F.fmtDate(i.noticeBy))}</td>
    <td class="num mono">${i.variable ? "varies" : esc(F.money0(i.annual))}</td>
    <td class="mono">${esc(F.fmtDate(i.nextService))}</td>
  </tr>`).join("")}</tbody></table></div></section>`
      : `<div class="card empty"><p>No contracts${view.scope === "all" ? "" : " for this building"} yet. Add one, or use <strong>Import from document</strong> with a signed agreement.</p></div>`;

    return `<div class="page">
${pageHead("Contracts", "Recurring service agreements: terms, renewal and notice deadlines, and what they commit you to spend.",
  `<a class="btn primary" href="#/contracts/new">+ New contract</a>
   <button type="button" class="btn dark" data-fin="import" data-kind="contract">Import from document…</button>
   <button type="button" class="btn" data-fin="csv-contracts">Export CSV</button>`)}
${filterBar([scopeFilter()])}
<div class="tiles">
  ${tile("Active contracts", String(live.length))}
  ${tile("Annual contracted cost", esc(F.money0(annual)), `${esc(F.money0(annual / 12))} per month`)}
  ${tile("Deadlines in 90 days", String(soon), soon ? "Notice dates and term ends" : "Nothing due")}
</div>
${dl}
${table}
</div>`;
  }

  // --- contract form ---------------------------------------------------------------------

  function assetChoices(bid, selected) {
    const list = bid ? [{ b: F.store.get(bid), tags: F.assetTags(F.store.get(bid)) }]
      : buildings().map((b) => ({ b, tags: F.assetTags(b) }));
    const sel = new Set(selected.map((a) => `${a.buildingId || ""}|${a.tag}`));
    const shown = new Set();
    let html = "";
    for (const { b, tags } of list) {
      if (!b || !tags.length) continue;
      html += `<fieldset class="assets"><legend>${esc(b.name)}</legend>${tags.map((t) => {
        const k = `${b.id}|${t.tag}`;
        shown.add(k);
        return `<label><input type="checkbox" name="asset" value="${esc(k)}"${sel.has(k) ? " checked" : ""}> <span class="mono">${esc(t.tag)}</span> <span class="small dim-ink">${esc(t.label.slice(t.tag.length).trim())}</span></label>`;
      }).join("")}</fieldset>`;
    }
    const extra = selected.filter((a) => !shown.has(`${a.buildingId || ""}|${a.tag}`));
    if (extra.length) {
      html += `<fieldset class="assets"><legend>Not in an equipment list</legend>${extra.map((a) =>
        `<label><input type="checkbox" name="asset" value="${esc(`${a.buildingId || ""}|${a.tag}`)}" checked> <span class="mono">${esc(a.tag)}</span></label>`).join("")}</fieldset>`;
    }
    return html || `<p class="small dim-ink">No equipment listed${bid ? " for this building" : ""} yet. Equipment comes from the building wizard (e.g. the HVAC step).</p>`;
  }

  function renderContractForm(rec) {
    const ov = override && override.kind === "contracts" && override.id === (rec ? rec.id : "new") ? override : null;
    override = null;
    shownUnsaved = !!ov;
    const data = ov ? ov.data : rec || { status: "Active", buildingId: view.scope === "all" ? "" : view.scope };
    const assets = ov ? ov.assets : (rec && rec.assets) || [];
    const errors = ov ? ov.errors : {};
    const info = F.contractInfo(data, F.today());
    const linked = rec ? invoices().filter((i) => i.contractId === rec.id).sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || "")) : [];
    const spent = linked.reduce((a, i) => a + F.invoiceTotal(i), 0);
    const ytd = linked.filter((i) => F.budgetYearOf(i.invoice_date, SM()) === curFY()).reduce((a, i) => a + F.invoiceTotal(i), 0);

    const group = (title, names) => `<section class="card"><h2 class="sec-title">${title}</h2><div class="fields">${
      F.CONTRACT_FIELDS.filter((f) => names.includes(f.name)).map((f) => fieldHtml(f, data[f.name], errors[f.name])).join("")}</div></section>`;

    const summary = data.start_date ? `
<div class="card">
  <div class="eyebrow">Summary</div>
  <dl class="kv">
    <div><dt>Status</dt><dd>${badge(info.tone, info.state)}</dd></div>
    <div><dt>Current term ends</dt><dd class="mono">${esc(F.fmtDate(info.termEnd))}${info.openEnded ? " (no end date)" : ""}</dd></div>
    <div><dt>Notice deadline</dt><dd class="mono">${esc(F.fmtDate(info.noticeBy))}${info.noticeBy ? `<div class="small dim-ink">${esc(daysText(info.daysToNotice))}</div>` : ""}</dd></div>
    <div><dt>Renewal</dt><dd>${info.renews ? "Renews automatically" : (data.status || "Active") === "Active" ? "Does not auto-renew" : esc(data.status)}</dd></div>
    <div><dt>Annual cost (est.)</dt><dd class="mono">${info.variable ? "varies (as needed)" : esc(F.money(info.annual))}</dd></div>
    <div><dt>Next service (est.)</dt><dd class="mono">${esc(F.fmtDate(info.nextService))}</dd></div>
  </dl>
</div>` : `<div class="card"><p class="small dim-ink">Enter a start date to see the term, notice deadline and annual cost.</p></div>`;

    const inv = rec ? `
<div class="card">
  <div class="eyebrow">Invoiced under this contract</div>
  <div class="big mono">${esc(F.money(spent))}</div>
  <div class="small dim-ink">${esc(F.money(ytd))} in ${esc(fyLabel(curFY()))} · ${plural(linked.length, "invoice")}</div>
  <ul class="mini">${linked.slice(0, 6).map((i) => `<li><a href="#/invoices/${encodeURIComponent(i.id)}">${esc(F.fmtDate(i.invoice_date))}</a><span class="mono">${esc(F.money(F.invoiceTotal(i)))}</span></li>`).join("")}</ul>
  <a class="side-link" href="#/invoices/new?contract=${encodeURIComponent(rec.id)}">+ Add an invoice for this contract</a>
</div>` : "";

    return `<div class="page">
<a class="crumb-link" href="#/contracts" data-fin="discard">← Contracts</a>
<div class="page-head"><div><h1>${rec ? `${esc(rec.vendor)} — ${esc(rec.title)}` : "New contract"}</h1>
  ${rec && rec.reviewed === false ? '<p class="lede warn-text">Imported from a document. Check each value against the contract, then Save.</p>' : ""}</div></div>
<div class="layout-2">
  <form id="fin-form" class="stack" novalidate>
    ${group("Agreement", ["vendor", "title", "buildingId", "category", "contract_number", "status"])}
    ${group("Term & renewal", ["start_date", "term_months", "end_date", "auto_renew", "renewal_term_months", "notice_days"])}
    ${group("Cost & service", ["cost_amount", "billing_frequency", "service_frequency", "escalation_pct"])}
    <section class="card"><h2 class="sec-title">Equipment covered</h2>${assetChoices(data.buildingId || "", assets)}</section>
    ${group("Details", ["contact", "scope", "notes"])}
    <div class="actions">
      <button class="btn primary" name="action" value="save">Save contract</button>
      <a class="btn" href="#/contracts" data-fin="discard">Cancel</a>
      ${rec ? `<button type="button" class="btn danger push" data-fin="delete">Delete</button>` : ""}
    </div>
  </form>
  <aside class="side">${summary}${inv}</aside>
</div>
</div>`;
  }

  // --- invoices list --------------------------------------------------------------------

  function filteredInvoices() {
    const v = F.canonVendor(view.vendor);
    return invoices().filter((i) => inScope(i) &&
      (!invYear() || F.budgetYearOf(i.invoice_date, SM()) === invYear()) &&
      (!v || F.canonVendor(i.vendor).includes(v)) &&
      (!view.type || (i.work_type || "") === view.type))
      .sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || ""));
  }

  function renderInvoices() {
    const list = filteredInvoices(), all = invoices();
    const total = list.reduce((a, i) => a + F.invoiceTotal(i), 0);
    const table = list.length ? `<section class="card"><div class="table-wrap"><table class="grid list">
  <thead><tr><th scope="col">Date</th><th scope="col">Vendor</th><th scope="col">Invoice #</th><th scope="col">Building</th><th scope="col">Equipment</th><th scope="col">Work type</th><th scope="col" class="num">Total</th></tr></thead>
  <tbody>${list.map((i) => {
    const tags = F.invoiceAllocation(i).assets.map((a) => a.tag);
    const dup = F.findDuplicateInvoice(all, i);
    return `<tr>
    <td class="mono">${esc(F.fmtDate(i.invoice_date))}</td>
    <td><a href="#/invoices/${encodeURIComponent(i.id)}"><strong>${esc(i.vendor)}</strong></a>${reviewBadge(i)}${dup ? ` ${badge("err", "DUPLICATE?")}` : ""}</td>
    <td class="mono">${esc(i.invoice_number || "—")}</td>
    <td>${esc(bName(i.buildingId))}</td>
    <td class="mono small">${tags.length ? esc(tags.join(", ")) : '<span class="dim-ink">—</span>'}</td>
    <td>${esc(i.work_type || "—")}</td>
    <td class="num mono">${esc(F.money(F.invoiceTotal(i)))}</td></tr>`;
  }).join("")}</tbody>
  <tfoot><tr><td colspan="6">${plural(list.length, "invoice")}</td><td class="num mono"><strong>${esc(F.money(total))}</strong></td></tr></tfoot>
  </table></div></section>`
      : `<div class="card empty"><p>No invoices match. Add one, or use <strong>Import from document</strong> with one or more service invoices.</p></div>`;

    return `<div class="page">
${pageHead("Invoices", "Service invoices, assigned to a building, vendor and equipment so costs roll up on the Costs page.",
  `<a class="btn primary" href="#/invoices/new">+ New invoice</a>
   <button type="button" class="btn dark" data-fin="import" data-kind="invoice">Import from document…</button>
   <button type="button" class="btn" data-fin="csv-invoices">Export CSV</button>`)}
${filterBar([scopeFilter(), yearFilter("invYear", invYear(), true),
  `<label>Vendor <input type="search" data-filter="vendor" value="${esc(view.vendor)}" placeholder="Any vendor"></label>`,
  `<label>Work type <select data-filter="type"><option value="">Any</option>${F.WORK_TYPES.map((t) => `<option${t === view.type ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`])}
${table}
</div>`;
  }

  // --- invoice form ------------------------------------------------------------------------

  function lineRow(l, tags) {
    const opts = [{ tag: "", label: "General / not equipment" }, ...tags];
    if (l.asset && !tags.some((t) => t.tag === l.asset)) opts.push({ tag: l.asset, label: `${l.asset} (not in equipment list)` });
    return `<tr>
  <td><input name="line-description" aria-label="Line description" value="${esc(l.description || "")}" autocomplete="off"></td>
  <td><select name="line-asset" aria-label="Equipment">${opts.map((o) => `<option value="${esc(o.tag)}"${o.tag === (l.asset || "") ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></td>
  <td><div class="money"><span aria-hidden="true">$</span><input name="line-amount" aria-label="Amount" inputmode="decimal" value="${esc(l.amount || "")}" autocomplete="off"></div></td>
  <td class="rm"><button type="button" class="icon-btn" data-fin="rm-line" aria-label="Remove line">×</button></td>
</tr>`;
  }

  function renderInvoiceForm(rec) {
    const ov = override && override.kind === "invoices" && override.id === (rec ? rec.id : "new") ? override : null;
    override = null;
    shownUnsaved = !!ov;
    let data = ov ? ov.data : rec;
    if (!data) {
      const c = route.query && route.query.get("contract") ? F.store.record("contracts", route.query.get("contract")) : null;
      data = c ? { vendor: c.vendor, buildingId: c.buildingId || "", contractId: c.id, work_type: "Contract service", invoice_date: F.today() }
        : { buildingId: view.scope === "all" ? "" : view.scope, invoice_date: F.today() };
    }
    const saved = ov ? ov.lines : rec ? rec.lines || [] : [];
    const lines = saved.length ? saved : [{}];                     // always offer one row to fill in
    const errors = ov ? ov.errors : {};
    const b = data.buildingId ? F.store.get(data.buildingId) : null;
    const tags = F.assetTags(b);
    const cOpts = contracts().filter((c) => (c.buildingId || "") === (data.buildingId || "") || c.buildingId === "" || c.id === data.contractId)
      .sort((x, y) => x.vendor.localeCompare(y.vendor));
    const field = (n) => fieldHtml(F.INVOICE_FIELDS.find((f) => f.name === n), data[n], errors[n], { contracts: cOpts });
    const probe = { ...data, lines };
    const dup = rec || data.invoice_number ? F.findDuplicateInvoice(invoices(), { ...probe, id: rec ? rec.id : "" }) : null;
    const check = F.invoiceCheck(probe);

    // equipment history for tags on this invoice
    const hist = F.invoiceAllocation(probe).assets.map((a) => {
      const past = invoices().filter((i) => (i.buildingId || "") === (data.buildingId || ""))
        .flatMap((i) => F.invoiceAllocation(i).assets.filter((x) => x.tag.toUpperCase() === a.tag.toUpperCase()).map((x) => ({ i, amount: x.amount })));
      return { tag: a.tag, total: past.reduce((s, x) => s + x.amount, 0), count: past.length };
    });

    return `<div class="page">
<a class="crumb-link" href="#/invoices" data-fin="discard">← Invoices</a>
<div class="page-head"><div><h1>${rec ? `Invoice ${esc(rec.invoice_number || "")} · ${esc(rec.vendor)}` : "New invoice"}</h1>
  ${rec && rec.reviewed === false ? '<p class="lede warn-text">Imported from a document. Check each value against the invoice, then Save.</p>' : ""}</div></div>
<div class="layout-2">
  <form id="fin-form" class="stack" novalidate>
    <section class="card"><div class="fields">
      ${["vendor", "invoice_number", "buildingId", "invoice_date", "work_type", "contractId", "po_number", "due_date", "description"].map(field).join("")}
    </div></section>
    <section class="card">
      <div class="card-head"><h2>Line items</h2><span class="small dim-ink">Assign lines to equipment to track cost per asset.</span>
        <button type="button" class="btn dark push" data-fin="add-line">+ Add line</button></div>
      ${errors._lines ? `<ul class="errors">${errors._lines.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      <div class="table-wrap"><table class="grid edit lines">
        <thead><tr><th scope="col">Description</th><th scope="col">Equipment</th><th scope="col">Amount</th><th><span class="sr">Remove</span></th></tr></thead>
        <tbody>${lines.map((l) => lineRow(l, tags)).join("")}</tbody>
      </table></div>
      <template id="line-tpl">${lineRow({}, tags)}</template>
      <div class="fields totals">${field("tax")}${field("total")}
        <div class="field"><span class="label-like">Lines + tax</span><output class="mono calc" id="calc-total">${esc(F.money((lines || []).reduce((a, l) => a + (Number(F.parseMoney(l.amount)) || 0), 0) + (Number(data.tax) || 0)))}</output></div>
      </div>
    </section>
    <section class="card">${fieldHtml({ name: "notes", label: "Notes", kind: "textarea" }, data.notes, "")}</section>
    <div class="actions">
      <button class="btn primary" name="action" value="save">Save invoice</button>
      <a class="btn" href="#/invoices" data-fin="discard">Cancel</a>
      ${rec ? `<button type="button" class="btn danger push" data-fin="delete">Delete</button>` : ""}
    </div>
  </form>
  <aside class="side">
    ${dup ? `<div class="card errbox"><div class="warn-title">Possible duplicate</div><p class="small">Invoice ${esc(dup.invoice_number)} from ${esc(dup.vendor)} is already saved (${esc(F.fmtDate(dup.invoice_date))}, ${esc(F.money(F.invoiceTotal(dup)))}). <a href="#/invoices/${encodeURIComponent(dup.id)}">Open it</a></p></div>` : ""}
    ${check ? `<div class="card warn"><div class="warn-title">Totals don't match</div><p class="small">${esc(check)}</p></div>` : ""}
    ${hist.length ? `<div class="card"><div class="eyebrow">Equipment cost history</div><ul class="mini">${hist.map((h) =>
      `<li><span class="mono">${esc(h.tag)}</span><span class="mono">${esc(F.money(h.total))} · ${plural(h.count, "invoice")}</span></li>`).join("")}</ul>
      <p class="small dim-ink">Saved invoices at ${esc(bName(data.buildingId))}, all years.</p></div>` : ""}
  </aside>
</div>
</div>`;
  }

  // --- saving ------------------------------------------------------------------------------

  function readForm(form) {
    const fd = new FormData(form), kind = route.page;
    if (kind === "contracts") {
      const { data, errors } = F.parseFields(F.CONTRACT_FIELDS, fd);
      const assets = fd.getAll("asset").map((v) => { const k = String(v), i = k.indexOf("|"); return { buildingId: k.slice(0, i), tag: k.slice(i + 1) }; });
      if (data.end_date && data.start_date && data.end_date < data.start_date) errors.end_date = "The end date is before the start date.";
      return { data, assets, errors };
    }
    const { data, errors } = F.parseFields([...F.INVOICE_FIELDS, { name: "notes", kind: "textarea" }], fd);
    const { lines, errors: le } = F.parseLines(fd);
    if (le.length) errors._lines = le;
    if (!lines.length && data.total === "") errors.total = "Enter the total, or add line items.";
    return { data, lines, errors };
  }

  /** Save the open record form. Returns true on success (app.js uses this before navigating). */
  function save() {
    const form = document.getElementById("fin-form");
    if (!form) return true;
    const kind = route.page, id = route.id === "new" ? "" : route.id;
    const st = readForm(form);
    if (Object.keys(st.errors).length) {
      override = { kind, id: id || "new", ...st };
      F.ui.flash("error", "Nothing was saved. Fix the items marked below.");
      F.ui.render();
      return false;
    }
    const prev = id ? F.store.record(kind, id) : null;
    const rec = { ...(prev || {}), ...st.data, id, reviewed: true };
    if (kind === "contracts") rec.assets = st.assets; else rec.lines = st.lines;
    try {
      const nid = F.store.saveRecord(kind, rec);
      F.ui.setDirty(false);
      if (!id) history.replaceState(null, "", `#/${kind}/${encodeURIComponent(nid)}`);
      return true;
    } catch (e) {
      override = { kind, id: id || "new", ...st };
      F.ui.flash("error", e.message);
      F.ui.render();
      return false;
    }
  }

  // --- costs -----------------------------------------------------------------------------

  function niceMax(v) {
    if (v <= 0) return 1000;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const tick = (v, compact) => compact ? (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : `$${+(v / 1e3).toFixed(v % 1000 ? 1 : 0)}K`) : `$${v.toLocaleString("en-US")}`;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monName = ([y, m]) => `${MON[m - 1]} ${y}`;

  function chart(r) {
    // drawn at the real width (re-drawn on resize) so text stays 11px at any screen size
    const W = Math.max(300, Math.min(1180, document.documentElement.clientWidth - (document.documentElement.clientWidth < 700 ? 72 : 112)));
    const H = W < 560 ? 220 : 260, L = 56, R = 12, T = 14, B = 28, pw = W - L - R, ph = H - T - B;
    const max = niceMax(Math.max(...r.invoiced, ...r.contracted)), compact = max >= 10000;
    const band = pw / 12, bw = Math.min(24, band * 0.55), y = (v) => T + ph - (v / max) * ph;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gridline"/><text x="${L - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${tick(v, compact)}</text>`).join("");
    const bars = r.invoiced.map((v, m) => {
      if (v <= 0) return "";
      const x = L + band * m + (band - bw) / 2, top = y(v), h = T + ph - top, rr = Math.min(4, h);
      return `<path class="bar" d="M${x},${T + ph} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${T + ph} Z"/>`;
    }).join("");
    const pts = r.contracted.map((v, m) => [L + band * m + band / 2, y(v)]);
    const line = r.contracted.some((v) => v > 0)
      ? `<polyline class="cline" points="${pts.map((p) => p.join(",")).join(" ")}"/>${pts.map((p) => `<circle class="cdot" cx="${p[0]}" cy="${p[1]}" r="4"/>`).join("")}` : "";
    const short = band < 40;
    const labels = r.months.map(([yy, m], i) => `<text x="${L + band * i + band / 2}" y="${H - 8}" class="axis" text-anchor="middle">${short ? MON[m - 1][0] : MON[m - 1]}${m === 1 && i > 0 && !short ? ` ’${String(yy).slice(2)}` : ""}</text>`).join("");
    const hits = r.months.map((ym, i) => `<rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${ph}" tabindex="0" data-m="${i}" data-label="${monName(ym)}"
      aria-label="${monName(ym)}: invoiced ${F.money0(r.invoiced[i])}, contracted ${F.money0(r.contracted[i])}"/>`).join("");
    return `<div class="chart-wrap">
  <div class="legend"><span><i class="sw bar-sw"></i>Invoiced (actual)</span><span><i class="sw line-sw"></i>Contracted (scheduled)</span></div>
  <div class="chart-box">
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Monthly invoiced and contracted cost, ${esc(r.label)} (${esc(r.span)})" data-inv="${r.invoiced.join(",")}" data-con="${r.contracted.join(",")}">${grid}${bars}${line}${labels}${hits}</svg>
    <div class="tip" role="status" hidden></div>
  </div>
  <details class="small"><summary>Show as table</summary><div class="table-wrap"><table class="grid">
    <thead><tr><th scope="col">Month</th><th scope="col" class="num">Invoiced</th><th scope="col" class="num">Contracted</th></tr></thead>
    <tbody>${r.months.map((ym, i) => `<tr><td>${monName(ym)}</td><td class="num mono">${esc(F.money0(r.invoiced[i]))}</td><td class="num mono">${esc(F.money0(r.contracted[i]))}</td></tr>`).join("")}</tbody>
  </table></div></details>
</div>`;
  }

  function renderCosts() {
    const year = costYear(), sm = SM(), today = F.today();
    const data = { contracts: contracts(), invoices: invoices(), budgets: F.store.allBudgets() };
    const r = F.costReport(data, year, view.scope, today, sm);
    const yl = r.label, py = fyLabel(year - 1);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
    const change = r.priorSamePeriod ? Math.round(((r.ytd - r.priorSamePeriod) / r.priorSamePeriod) * 100) : null;
    const over = r.budget !== null ? r.forecast - r.budget : null;

    const budgetTile = view.scope === "all"
      ? tile(`Budget ${esc(yl)}`, r.budget === null ? "—" : esc(F.money0(r.budget)), "Sum of all budgets. Pick a building to set one.")
      : tile(`Budget ${esc(yl)}`, "", "", `<form class="budget" data-fin-form="budget" onsubmit="return false">
          <div class="money"><span aria-hidden="true">$</span><input id="budget-input" inputmode="decimal" aria-label="Budget for ${esc(yl)}" value="${r.budget === null ? "" : esc(r.budget)}" placeholder="Set budget"></div>
          <button type="button" class="btn" data-fin="budget-save">Save</button></form>`);

    const vendors = r.byVendor.length ? `<div class="table-wrap"><table class="grid list">
  <thead><tr><th scope="col">Vendor</th><th scope="col" class="num">${esc(yl)}</th><th scope="col" class="num">${esc(py)}</th><th scope="col" class="num">Change</th><th scope="col" class="num">Invoices</th></tr></thead>
  <tbody>${r.byVendor.slice(0, 15).map((v) => {
    const ch = v.prior ? Math.round(((v.total - v.prior) / v.prior) * 100) : null;
    return `<tr><td>${esc(v.vendor)}</td><td class="num mono">${esc(F.money0(v.total))}</td><td class="num mono">${esc(F.money0(v.prior))}</td>
      <td class="num mono">${ch === null ? "—" : `${ch > 0 ? "+" : ""}${ch}%`}</td><td class="num mono">${v.count}</td></tr>`;
  }).join("")}</tbody></table></div>` : '<p class="small dim-ink">No invoices for this period.</p>';

    const assets = r.byAsset.length ? `<div class="table-wrap"><table class="grid list">
  <thead><tr><th scope="col">Equipment</th><th scope="col">Building</th><th scope="col" class="num">${esc(yl)}</th><th scope="col" class="num">All years</th><th scope="col" class="num">Repairs</th><th scope="col">Last invoice</th></tr></thead>
  <tbody>${r.byAsset.slice(0, 25).map((a) => `<tr><td class="mono">${esc(a.tag)}${a.repairs >= 3 ? ` ${badge("warn", "FREQUENT REPAIRS")}` : ""}</td><td>${esc(bName(a.buildingId))}</td>
    <td class="num mono">${esc(F.money0(a.year))}</td><td class="num mono">${esc(F.money0(a.lifetime))}</td><td class="num mono">${a.repairs}</td><td class="mono">${esc(F.fmtDate(a.last))}</td></tr>`).join("")}</tbody>
  </table></div><p class="small dim-ink">From invoice lines assigned to equipment. 3+ repair invoices are flagged as repair-or-replace candidates.</p>`
      : '<p class="small dim-ink">No invoice lines are assigned to equipment yet.</p>';

    const tmax = Math.max(1, ...r.byType.map((t) => t.total));
    const types = r.byType.length ? `<ul class="hbars">${r.byType.map((t) => `<li><span>${esc(t.type)}</span>
      <span class="hbar"><i style="width:${Math.max(1, (t.total / tmax) * 100)}%"></i></span><span class="mono">${esc(F.money0(t.total))}</span></li>`).join("")}</ul>`
      : '<p class="small dim-ink">No invoices for this period.</p>';

    // all budget years side by side, newest first
    const ys = years().filter((y) => y <= curFY() + 1);
    const summary = F.yearSummary(data, ys, view.scope, today, sm).filter((x) => x.current || x.budget !== null || x.invoiced || x.contracted || x.year === year);
    const yearsTable = `<div class="table-wrap"><table class="grid list years">
  <thead><tr><th scope="col">${sm === 1 ? "Year" : "Budget year"}</th><th scope="col" class="num">Budget</th><th scope="col" class="num">Contracted</th><th scope="col" class="num">Invoiced</th><th scope="col" class="num">Forecast</th><th scope="col" class="num">Budget left</th><th scope="col" class="num">Invoices</th></tr></thead>
  <tbody>${summary.map((x) => `<tr class="${x.year === year ? "sel" : ""}">
    <td><button type="button" class="linkish" data-fin="pick-year" data-year="${x.year}"><strong>${esc(x.label)}</strong></button>${x.current ? ` ${badge("", "CURRENT")}` : ""}${sm === 1 ? "" : `<div class="small dim-ink">${esc(x.span)}</div>`}</td>
    <td class="num mono">${esc(F.money0(x.budget))}</td><td class="num mono">${esc(F.money0(x.contracted))}</td><td class="num mono">${esc(F.money0(x.invoiced))}</td>
    <td class="num mono">${esc(F.money0(x.forecast))}</td>
    <td class="num mono">${x.variance === null ? "—" : `<span class="${x.variance < 0 ? "neg" : "pos"}">${esc(F.money0(x.variance))}</span>`}</td>
    <td class="num mono">${x.count}</td></tr>`).join("")}</tbody></table></div>
  <p class="small dim-ink">Each invoice counts in the budget year of its invoice date. Forecast = invoiced so far + contracted cost for the rest of the year (past years: actual; future years: contracted).</p>`;

    const FULL = ["January (calendar year)", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const fySetting = `<label>Budget year starts <select data-fin-setting="fy">${FULL.map((m, i) =>
      `<option value="${i + 1}"${i + 1 === sm ? " selected" : ""}>${m}</option>`).join("")}</select></label>`;

    return `<div class="page">
${pageHead("Costs", `Budget against actual invoiced spend for ${esc(sm === 1 ? yl : `${yl}, ${r.span}`)}, with contracted costs scheduled across the year.`, "")}
${filterBar([scopeFilter(), yearFilter("year", year, false), fySetting])}
<div class="tiles">
  ${budgetTile}
  ${tile(r.partialYear ? "Invoiced to date" : `Invoiced ${esc(yl)}`, esc(F.money0(r.totalInvoiced)),
    [r.budget ? `${pct(r.totalInvoiced, r.budget)}% of budget` : "", change === null ? "" : `${change > 0 ? "+" : ""}${change}% vs same point in ${esc(py)}`].filter(Boolean).join(" · ") || plural(r.invoiceCount, "invoice"))}
  ${tile(`Forecast ${esc(yl)}`, esc(F.money0(r.forecast)),
    over === null ? (r.partialYear ? "Invoiced so far + contracted for the rest of the year" : year > curFY() ? "Contracted costs only" : "Actual")
      : `<span class="${over > 0 ? "neg" : "pos"}">${over > 0 ? `${esc(F.money0(over))} over budget` : `${esc(F.money0(-over))} under budget`}</span>`)}
  ${tile(`Contracted ${esc(yl)}`, esc(F.money0(r.totalContracted)), "Scheduled recurring contract cost")}
</div>
<section class="card"><div class="card-head"><h2>By month</h2><span class="small dim-ink">${esc(r.span)}</span></div>${chart(r)}</section>
<div class="two-col">
  <section class="card"><div class="card-head"><h2>Vendors</h2></div>${vendors}</section>
  <section class="card"><div class="card-head"><h2>By work type, ${esc(yl)}</h2></div>${types}</section>
</div>
<section class="card"><div class="card-head"><h2>Equipment</h2></div>${assets}</section>
<section class="card"><div class="card-head"><h2>Budget years</h2></div>${yearsTable}</section>
</div>`;
  }

  // --- exports ---------------------------------------------------------------------------

  const stamp = () => F.today();
  function exportContractsCSV() {
    const today = F.today();
    const rows = [["Vendor", "Service", "Building", "Category", "Contract no.", "Status", "State", "Start", "Initial term end",
      "Current term end", "Auto-renews", "Notice days", "Notice by", "Cost", "Billed", "Annual cost (est.)", "Service visits",
      "Next service (est.)", "Escalation %", "Contact", "Equipment"]];
    for (const c of contracts().filter(inScope)) {
      const i = F.contractInfo(c, today);
      rows.push([c.vendor, c.title, bName(c.buildingId), c.category, c.contract_number, c.status || "Active", i.state, c.start_date,
        i.firstEnd, i.termEnd, c.auto_renew, c.notice_days, i.noticeBy, c.cost_amount, c.billing_frequency,
        i.annual ? i.annual.toFixed(2) : "", c.service_frequency, i.nextService, c.escalation_pct, c.contact,
        (c.assets || []).map((a) => a.tag).join("; ")]);
    }
    F.ui.saveBlob(new Blob([F.toCSV(rows)], { type: "text/csv" }), `contracts-${stamp()}.csv`);
  }

  function exportInvoicesCSV() {
    const rows = [["Invoice date", "Budget year", "Calendar year", "Month", "Vendor", "Invoice no.", "Building", "Work type", "Contract", "PO",
      "Line", "Equipment", "Amount", "Invoice total", "Due date"]];
    for (const i of filteredInvoices()) {
      const c = i.contractId ? F.store.record("contracts", i.contractId) : null;
      const head = [i.invoice_date, F.isDate(i.invoice_date) ? fyLabel(F.budgetYearOf(i.invoice_date, SM())) : "", (i.invoice_date || "").slice(0, 4), (i.invoice_date || "").slice(5, 7), i.vendor, i.invoice_number,
        bName(i.buildingId), i.work_type, c ? `${c.vendor} — ${c.title}` : "", i.po_number];
      const total = F.invoiceTotal(i);
      let used = 0;
      const push = (desc, asset, amt) => { used += amt; rows.push([...head, desc, asset, amt.toFixed(2), total.toFixed(2), i.due_date]); };
      for (const l of i.lines || []) push(l.description, l.asset, Number(l.amount) || 0);
      if (Number(i.tax)) push("Tax", "", Number(i.tax));
      const rest = Math.round((total - used) * 100) / 100;
      if (Math.abs(rest) > 0.004 || !(i.lines || []).length) push((i.lines || []).length ? "Other / unallocated" : (i.description || "Invoice total"), "", rest);
    }
    F.ui.saveBlob(new Blob([F.toCSV(rows)], { type: "text/csv" }), `invoices-${stamp()}.csv`);
  }

  function exportICS() {
    const list = contracts().filter(inScope);
    const ics = F.contractsICS(list, bName, F.today());
    const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
    if (!n) { F.ui.flash("error", "No upcoming notice deadlines or term ends in the next 2 years to add."); F.ui.render(); return; }
    F.ui.saveBlob(new Blob([ics], { type: "text/calendar" }), `contract-deadlines-${stamp()}.ics`);
    F.ui.flash("ok", `Calendar file with ${plural(n, "reminder")} downloaded. Open it to add them to Outlook. Download it again after you change contracts.`);
    F.ui.render();
  }

  // --- import dialog -----------------------------------------------------------------------

  const dlg = document.createElement("dialog");
  dlg.className = "imp";
  dlg.setAttribute("aria-labelledby", "fin-imp-title");
  document.body.appendChild(dlg);
  let imp = null;   // { kind, reply, drafts, notes, error }

  function openImport(kind) {
    imp = { kind, reply: "", drafts: null, notes: [], error: "" };
    drawImport();
    dlg.showModal();
  }

  const head = (t) => `<div class="dlg-head"><h2 id="fin-imp-title">${t}</h2><button type="button" class="icon-btn" data-imp2="close" aria-label="Close">×</button></div>`;

  function draftCard(d, i) {
    const r = d.record;
    let facts;
    if (d.kind === "contract") {
      const info = F.contractInfo(r, F.today());
      facts = [
        ["Term", `${F.fmtDate(r.start_date)} – ${F.fmtDate(info.firstEnd)}${r.auto_renew === "Yes" ? " · auto-renews" : ""}`],
        ["Notice", r.notice_days ? `${r.notice_days} days (next deadline ${F.fmtDate(info.noticeBy)})` : "—"],
        ["Cost", r.cost_amount ? `${F.money(r.cost_amount)} ${String(r.billing_frequency || "").toLowerCase()} ≈ ${F.money0(info.annual)}/yr` : "—"],
        ["Service", r.service_frequency || "—"],
        ["Equipment", (r.assets || []).map((a) => a.tag).join(", ") || "—"],
      ];
    } else {
      const c = r.contractId ? F.store.record("contracts", r.contractId) : null;
      facts = [
        ["Invoice", `${r.invoice_number || "no number"} · ${F.fmtDate(r.invoice_date)}`],
        ["Total", F.money(F.invoiceTotal(r))],
        ["Work type", r.work_type || "—"],
        ["Contract", c ? `${c.vendor} — ${c.title}` : "—"],
        ["Lines", r.lines.length ? r.lines.map((l) => `${l.description || "—"}${l.asset ? ` [${l.asset}]` : ""}: ${F.money(l.amount)}`).join("\n") : "—"],
      ];
    }
    const dup = d.duplicate;
    const notes = [d.buildingNote, d.contractNote, ...d.notes, ...d.assetNotes].filter(Boolean);
    return `<li class="draft${d.include ? "" : " off"}">
  <div class="draft-head">
    <label class="inc"><input type="checkbox" data-draft="${i}"${d.include ? " checked" : ""}> <strong>${esc(r.vendor || "(no vendor)")}</strong> — ${esc(d.kind === "contract" ? r.title : `invoice ${r.invoice_number || ""}`)}</label>
    <label class="bsel">Building <select data-draft-building="${i}">${scopeOptions(r.buildingId || "", false)}</select></label>
  </div>
  <dl class="facts">${facts.map(([k, v]) => `<div${k === "Lines" || k === "Equipment" ? ' class="full"' : ""}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
  ${dup ? `<p class="small err">Already saved: ${esc(dup.vendor)} ${d.kind === "invoice" ? `invoice ${esc(dup.invoice_number)} (${esc(F.fmtDate(dup.invoice_date))})` : `— ${esc(dup.title)}`}. Unticked to avoid a duplicate.</p>` : ""}
  ${d.problems.map((p) => `<p class="small err">${esc(p)}</p>`).join("")}
  ${notes.length ? `<ul class="small dim-ink notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
</li>`;
  }

  function drawImport() {
    const what = imp.kind === "contract" ? "contract" : "invoice";
    if (!imp.drafts) {
      dlg.innerHTML = `<div class="dlg">
  ${head(`Import ${what}s from a document`)}
  <p class="lede">Your company's AI assistant (for example Microsoft Copilot) reads the ${what === "contract" ? "agreement" : "invoice(s)"} and returns the details. Nothing is saved until you review it.</p>
  <ol class="howto">
    <li><div><strong>Copy the prompt.</strong></div>
      <div class="row"><button type="button" class="btn dark" data-imp2="copy">Copy prompt</button><span class="small dim-ink" id="fin-copied" role="status"></span></div>
      <details><summary>Show prompt</summary><textarea id="fin-prompt" readonly rows="10">${esc(what === "contract" ? F.contractPrompt() : F.invoicePrompt())}</textarea></details></li>
    <li><div><strong>Open your AI, attach the ${what === "contract" ? "contract (PDF or Word)" : "invoice PDF(s)"}</strong>, paste the prompt and send.</div>
      <div class="small dim-ink">${what === "invoice" ? "You can attach several invoices at once. " : ""}Scanned documents only work if your AI can read images.</div></li>
    <li><label for="fin-reply"><strong>Paste the AI's whole reply here.</strong></label>
      <textarea id="fin-reply" rows="8" placeholder='{ "${what}s": [ … ] }'>${esc(imp.reply)}</textarea>
      ${imp.error ? `<div class="err" role="alert">${esc(imp.error)}</div>` : ""}</li>
  </ol>
  <div class="actions"><button type="button" class="btn primary" data-imp2="preview">Preview</button><button type="button" class="btn" data-imp2="close">Cancel</button></div>
</div>`;
      return;
    }
    const n = imp.drafts.filter((d) => d.include).length;
    dlg.innerHTML = `<div class="dlg">
  ${head(`Review ${plural(imp.drafts.length, what)}`)}
  ${imp.notes.length ? `<div class="card warn"><div class="warn-title">The AI flagged these</div><ul>${imp.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  <p class="small dim-ink">Check the building for each one. Saved ${what}s are marked <strong>CHECK</strong> until you open and save them.</p>
  <ul class="drafts">${imp.drafts.map(draftCard).join("")}</ul>
  <div class="actions">
    <button type="button" class="btn primary" data-imp2="apply"${n ? "" : " disabled"}>Save ${plural(n, what)}</button>
    <button type="button" class="btn back" data-imp2="back">← Back</button>
    <button type="button" class="btn" data-imp2="close">Cancel</button>
  </div>
</div>`;
  }

  async function copyPrompt() {
    const ta = dlg.querySelector("#fin-prompt"), s = dlg.querySelector("#fin-copied");
    try { await navigator.clipboard.writeText(ta.value); s.textContent = "Copied. Now paste it into your AI."; }
    catch (e) {
      ta.closest("details").open = true; ta.focus(); ta.select();
      s.textContent = document.execCommand && document.execCommand("copy") ? "Copied. Now paste it into your AI." : "Press Ctrl+C to copy the selected prompt.";
    }
  }

  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-imp2]");
    if (!b) return;
    switch (b.dataset.imp2) {
      case "close": dlg.close(); break;
      case "copy": copyPrompt(); break;
      case "back": imp.drafts = null; drawImport(); break;
      case "preview":
        imp.reply = dlg.querySelector("#fin-reply").value;
        if (!imp.reply.trim()) { imp.error = "Paste the AI's reply first."; drawImport(); break; }
        try {
          const res = (imp.kind === "contract" ? F.parseContractDrafts : F.parseInvoiceDrafts)(imp.reply, ctx());
          Object.assign(imp, res, { error: "" });
        } catch (err) { imp.error = err.message; }
        drawImport();
        break;
      case "apply": {
        let ids;
        try { ids = F.applyDrafts(imp.drafts); } catch (err) { F.ui.flash("error", err.message); dlg.close(); F.ui.render(); break; }
        const what = imp.kind === "contract" ? "contract" : "invoice";
        F.ui.flash("ok", `Saved ${plural(ids.length, what)} from the document. Open each one marked CHECK, compare it with the document, and Save.`);
        dlg.close();
        F.ui.go(`#/${what}s`);
        break;
      }
    }
  });

  dlg.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.draft !== undefined) {
      imp.drafts[+t.dataset.draft].include = t.checked;
    } else if (t.dataset.draftBuilding !== undefined) {
      F.assignDraftBuilding(imp.drafts[+t.dataset.draftBuilding], t.value, ctx());
    } else return;
    drawImport();
  });

  // --- tooltip on the chart ---------------------------------------------------------------

  function showTip(hit) {
    const svg = hit.closest("svg"), box = svg.parentElement, tip = box.querySelector(".tip");
    const m = +hit.dataset.m, inv = svg.dataset.inv.split(",").map(Number), con = svg.dataset.con.split(",").map(Number);
    tip.innerHTML = `<strong>${esc(hit.dataset.label)}</strong><div><i class="sw bar-sw"></i>Invoiced <span class="mono">${esc(F.money0(inv[m]))}</span></div><div><i class="sw line-sw"></i>Contracted <span class="mono">${esc(F.money0(con[m]))}</span></div>`;
    tip.hidden = false;
    const br = box.getBoundingClientRect(), hr = hit.getBoundingClientRect();
    const x = hr.left - br.left + hr.width / 2;
    tip.style.left = `${Math.min(Math.max(x, 80), br.width - 80)}px`;
    svg.querySelectorAll(".hit").forEach((h) => h.classList.toggle("on", h === hit));
  }
  function hideTip(svg) {
    const tip = svg.parentElement.querySelector(".tip");
    if (tip) tip.hidden = true;
    svg.querySelectorAll(".hit.on").forEach((h) => h.classList.remove("on"));
  }
  document.addEventListener("mouseover", (e) => { const h = e.target.closest && e.target.closest("svg.chart .hit"); if (h) showTip(h); });
  document.addEventListener("focusin", (e) => { const h = e.target.closest && e.target.closest("svg.chart .hit"); if (h) showTip(h); });
  document.addEventListener("mouseout", (e) => {
    const svg = e.target.closest && e.target.closest("svg.chart");
    if (svg && !svg.contains(e.relatedTarget)) hideTip(svg);
  });

  let lastW = document.documentElement.clientWidth, resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = document.documentElement.clientWidth, a = document.activeElement;
      if (Math.abs(w - lastW) < 40 || !document.querySelector("svg.chart") || (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName))) return;
      lastW = w;
      const y = window.scrollY;
      F.ui.render();
      window.scrollTo(0, y);
    }, 200);
  });

  // --- events (called from app.js) ---------------------------------------------------------

  function recalc(form) {
    const out = form.querySelector("#calc-total");
    if (!out) return;
    const sum = [...form.querySelectorAll("[name=line-amount]")].reduce((a, el) => a + (Number(F.parseMoney(el.value)) || 0), 0);
    const tax = Number(F.parseMoney((form.querySelector("[name=tax]") || {}).value || "")) || 0;
    out.textContent = F.money(sum + tax);
  }

  /** Returns true if the click was handled here. */
  function onClick(e) {
    const el = e.target.closest("[data-fin]");
    if (!el) return false;
    const a = el.dataset.fin;
    switch (a) {
      case "discard": F.ui.setDirty(false); return false;            // let the link navigate
      case "import": openImport(el.dataset.kind); break;
      case "ics": exportICS(); break;
      case "csv-contracts": exportContractsCSV(); break;
      case "csv-invoices": exportInvoicesCSV(); break;
      case "add-line": {
        const tb = document.querySelector("table.lines tbody");
        tb.appendChild(document.getElementById("line-tpl").content.cloneNode(true));
        tb.lastElementChild.querySelector("input").focus();
        F.ui.setDirty(true);
        break;
      }
      case "rm-line": el.closest("tr").remove(); recalc(document.getElementById("fin-form")); F.ui.setDirty(true); break;
      case "budget-save": {
        const v = document.getElementById("budget-input").value.trim();
        const m = v ? F.parseMoney(v) : "";
        if (v && m === "") { F.ui.flash("error", "Enter the budget as an amount, e.g. 125000."); F.ui.render(); break; }
        F.store.setBudget(costYear(), view.scope, m === "" ? null : m);
        F.ui.flash("ok", m === "" ? "Budget cleared." : `Budget saved: ${F.money0(m)} for ${bName(view.scope)}, ${fyLabel(costYear())}.`);
        F.ui.render();
        break;
      }
      case "pick-year": view.year = Number(el.dataset.year); remember(); F.ui.render(); break;
      case "delete": {
        const kind = route.page, rec = F.store.record(kind, route.id);
        const what = kind === "contracts" ? `the ${rec.vendor} contract “${rec.title}”` : `invoice ${rec.invoice_number || ""} from ${rec.vendor}`;
        const extra = kind === "contracts" ? " Invoices linked to it are kept and unlinked." : "";
        if (window.confirm(`Delete ${what}?${extra} This can't be undone unless you have a backup file.`)) {
          F.store.removeRecord(kind, route.id);
          F.ui.setDirty(false);
          F.ui.flash("ok", "Deleted.");
          F.ui.go(`#/${kind}`);
        }
        break;
      }
      default: return false;
    }
    e.preventDefault();
    return true;
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset && t.dataset.filter) {
      const k = t.dataset.filter;
      view[k] = k === "year" || k === "invYear" ? Number(t.value) : t.value;
      remember();
      F.ui.render();
      if (k === "vendor") {                                  // keep typing position in the search box
        const s = document.querySelector('[data-filter="vendor"]');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }
      return true;
    }
    if (t.dataset && t.dataset.finSetting === "fy") {
      F.store.setFyStart(t.value);
      view.year = null; view.invYear = null; remember();       // jump to the current budget year
      F.ui.flash("ok", `Budget years now start in ${t.options[t.selectedIndex].text.replace(" (calendar year)", "")}. Invoices and budgets are grouped by the new budget years.`);
      F.ui.render();
      return true;
    }
    const form = t.closest && t.closest("#fin-form");
    if (form && t.name === "buildingId") {                   // refresh equipment / contract choices
      override = { kind: route.page, id: route.id || "new", ...readForm(form), errors: {} };
      F.ui.render();
      return true;
    }
    if (form) recalc(form);
    return false;
  }

  let vendorTimer = null;
  function onInput(e) {
    const t = e.target;
    if (t.dataset && t.dataset.filter === "vendor") {
      clearTimeout(vendorTimer);
      vendorTimer = setTimeout(() => onChange(e), 250);
      return true;
    }
    const form = t.closest && t.closest("#fin-form");
    if (form) recalc(form);
    return false;
  }

  /** Small card for the Buildings page. */
  function homeCard() {
    const d = F.deadlines(contracts(), F.today(), 60).filter((x) => x.days >= -30);
    if (!d.length) return "";
    return `<section class="card warn home-deadlines"><div class="warn-title">Contract deadlines in the next 60 days</div>
  <ul>${d.slice(0, 5).map((x) => `<li><span class="mono">${esc(F.fmtDate(x.date))}</span> · <a href="#/contracts/${encodeURIComponent(x.contract.id)}">${esc(x.contract.vendor)} — ${esc(x.contract.title)}</a>: ${esc(x.text)}</li>`).join("")}</ul>
  ${d.length > 5 ? `<a href="#/contracts">See all ${d.length}</a>` : ""}</section>`;
  }

  F.finUI = { parse, render, save, unsaved: () => shownUnsaved, onClick, onChange, onInput, homeCard, hasForm: () => !!document.getElementById("fin-form") };
})(window.FMB);
