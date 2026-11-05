/* UI: hash router, rendering, events. Routes: #/  and  #/b/<buildingId>/<stepKey>;
 * contracts, invoices and costs routes are handled by finance-ui.js. */
(function (F) {
  "use strict";

  const app = document.getElementById("app");
  const fileInput = document.getElementById("import-file");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const when = (iso) => iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  const day = (iso) => iso ? new Date(iso).toLocaleDateString() : "—";

  let flashes = [];          // [{cat, msg}] shown on next render
  let override = null;       // unsaved form state to re-show after a failed save
  let dirty = false;         // step form has unsaved edits
  let route = { name: "home" };

  const flash = (cat, msg) => flashes.push({ cat, msg });

  // --- data helpers ---------------------------------------------------------

  const progress = (b) => {
    const done = F.SECTIONS.filter((s) => (b.steps[s.key] || {}).completed).length;
    return { done, total: F.SECTIONS.length, pct: Math.round((done / F.SECTIONS.length) * 100) };
  };
  const firstOpenStep = (b) =>
    F.SECTIONS.find((s) => s.enabled && !(b.steps[s.key] || {}).completed) || F.byKey("review");
  const stepUrl = (bid, key) => `#/b/${encodeURIComponent(bid)}/${key}`;

  function parseRoute() {
    const fin = F.finUI.parse(location.hash);
    if (fin) return fin;
    if (/^#\/settings\/?$/.test(location.hash)) return { name: "settings" };
    const m = location.hash.match(/^#\/b\/([^/]+)\/([a-z_]+)$/);
    if (m) return { name: "step", bid: decodeURIComponent(m[1]), key: m[2] };
    return { name: "home" };
  }

  // --- rendering ------------------------------------------------------------

  function topbar(b) {
    const meta = F.store.meta(), any = F.store.hasAnyData();
    const tab = route.name === "fin" ? route.page : route.name === "settings" ? "" : "buildings";
    const nav = [["buildings", "#/", "Buildings"], ["contracts", "#/contracts", "Contracts"], ["invoices", "#/invoices", "Invoices"], ["vendors", "#/vendors", "Vendors"], ["costs", "#/costs", "Costs"]]
      .map(([k, href, label]) => `<a href="${href}"${k === tab ? ' aria-current="page"' : ""}>${label}</a>`).join("");
    const stale = any && (meta.changedSinceExport || !meta.lastExport);
    const status = meta.lastExport ? `Backup ${when(meta.lastExport)}` : "No backup yet";
    return `
<header class="topbar">
  <a class="brand" href="#/">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>
    Facilities Manual Builder
  </a>
  <nav class="tabs" aria-label="Main">${nav}</nav>
  ${b ? `<div class="crumb"><span class="dim">Building</span> <strong>${esc(b.name)}</strong></div>` : ""}
  <div class="topbar-right">
    <span class="backup${stale ? " stale" : ""}" title="${stale ? "Changes since your last backup" : "Backed up"}">${esc(status)}${stale && meta.lastExport ? " · changes since" : ""}</span>
    <a class="chip" href="#/settings"${route.name === "settings" ? ' aria-current="page"' : ""}>Settings</a>
    <button type="button" class="chip" data-action="export">Export backup</button>
    <button type="button" class="chip" data-action="import">Import</button>
  </div>
</header>
${F.store.available ? "" : `<div class="banner" role="alert">This browser is blocking local storage, so nothing is saved after you close the tab. Use <strong>Export backup</strong> before leaving, or try Edge or Chrome without InPrivate/Incognito.</div>`}
${flashes.length ? `<div class="flashes" role="status">${flashes.map((f) => `<div class="flash ${f.cat}">${esc(f.msg)}</div>`).join("")}</div>` : ""}`;
  }

  function renderHome() {
    const cards = F.store.list().map((b) => {
      const p = progress(b), prof = (b.steps.profile || {}).data || {}, issued = p.done === p.total;
      return `
<article class="card bcard">
  <div class="bhead">
    <div><h2>${esc(b.name)}</h2><div class="muted small">${esc(prof.address || "No address yet")}</div></div>
    <span class="badge${issued ? " ok" : ""}">${issued ? "COMPLETE" : "DRAFT"}</span>
  </div>
  <div>
    <div class="row-between small"><span>Wizard progress</span><span class="mono">${p.done} / ${p.total} sections</span></div>
    <div class="bar"><div style="width:${p.pct}%"></div></div>
  </div>
  <dl class="meta">
    <div><dt>Doc no.</dt><dd class="mono">${esc(prof.doc_number || "—")}</dd></div>
    <div><dt>Revision</dt><dd class="mono">${esc(prof.revision || "—")}</dd></div>
    <div><dt>Updated</dt><dd class="mono">${day(b.updatedAt)}</dd></div>
  </dl>
  <div class="bactions">
    <a class="btn dark grow" href="${stepUrl(b.id, firstOpenStep(b).key)}">${issued ? "Review" : "Resume wizard"}</a>
    <button type="button" class="btn" data-action="docx" data-bid="${esc(b.id)}">Word</button>
    <button type="button" class="btn" data-action="duplicate" data-bid="${esc(b.id)}">Duplicate</button>
    <button type="button" class="btn danger" data-action="delete" data-bid="${esc(b.id)}" aria-label="Delete ${esc(b.name)}">Delete</button>
  </div>
</article>`;
    }).join("");

    app.innerHTML = `${topbar()}
<div class="page">
  <div class="page-head">
    <div>
      <h1>Buildings</h1>
      <p class="lede">One manual per building. Duplicate a finished building to start the next one.</p>
    </div>
    <form class="new-building" id="new-building">
      <label class="sr" for="new-name">New building name</label>
      <input id="new-name" name="name" placeholder="Building name" required autocomplete="off">
      <button class="btn primary">+ New building</button>
    </form>
  </div>
  ${F.finUI.homeCard()}
  <p class="note">Your data is saved in this browser on this PC only. Use <strong>Export backup</strong> regularly and keep the file on OneDrive or a network drive; <strong>Import</strong> brings it back here or onto another PC.</p>
  ${cards ? `<div class="cards">${cards}</div>` : `<div class="card empty"><p>No buildings yet. Add one above, or Import a backup file.</p></div>`}
</div>`;
  }

  /** <select> of directory vendors; keeps a legacy free-text value selectable. */
  function vendorSelect(name, value, { id = "", label = "", trade = "" } = {}) {
    const opts = F.vendorChoices(trade).map((v) => `<option value="${esc(v.id)}"${v.id === value ? " selected" : ""}>${esc(v.name)}${v.trade ? ` · ${esc(v.trade)}` : ""}</option>`);
    if (value && !F.isVendorId(value)) opts.unshift(`<option value="${esc(value)}" selected>${esc(value)} (not in directory)</option>`);
    return `<select${id ? ` id="${id}"` : ""} name="${name}"${label ? ` aria-label="${esc(label)}"` : ""}><option value="">—</option>${opts.join("")}</select>`;
  }

  function fieldHtml(f, value, error) {
    const id = `f-${f.name}`, wide = f.wide || f.kind === "textarea" || f.kind === "lines";
    let input;
    if (f.kind === "vendor") {
      input = vendorSelect(f.name, value, { id, trade: f.trade });
    } else if (f.kind === "select") {
      input = `<select id="${id}" name="${f.name}"><option value="">—</option>${f.options.map((o) =>
        `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.kind === "textarea" || f.kind === "lines") {
      input = `<textarea id="${id}" name="${f.name}" rows="${f.kind === "lines" ? 5 : 3}" placeholder="${esc(f.placeholder)}">${esc(value)}</textarea>`;
    } else {
      input = `<input id="${id}" name="${f.name}" type="text" value="${esc(value)}" placeholder="${esc(f.placeholder)}"${f.kind === "number" ? ' inputmode="decimal"' : ""} autocomplete="off">`;
    }
    return `
<div class="field${wide ? " wide" : ""}${error ? " has-error" : ""}">
  <label for="${id}">${esc(f.label)}${f.required ? ' <span class="req" title="Required for this section to be complete">*</span>' : ""}</label>
  ${input}
  ${error ? `<div class="err">${esc(error)}</div>` : f.help ? `<div class="help">${esc(f.help)}</div>` : ""}
</div>`;
  }

  function rowHtml(t, r = {}) {
    return `<tr>${t.columns.map((c) => {
      const name = `${t.system}-${c.name}`, v = r[c.name] || "";
      const input = c.kind === "vendor" ? vendorSelect(name, v, { label: c.label })
        : c.kind === "select"
        ? `<select name="${name}" aria-label="${esc(c.label)}"><option value="">—</option>${c.options.map((o) =>
            `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
        : `<input name="${name}" aria-label="${esc(c.label)}" value="${esc(v)}"${c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : ""}${c.mono ? ' class="mono"' : ""} autocomplete="off">`;
      return `<td>${input}</td>`;
    }).join("")}<td class="rm"><button type="button" class="icon-btn" data-remove-row aria-label="Remove row">×</button></td></tr>`;
  }

  function photoCard(b, step, rows) {
    const list = F.store.photos(b.id, step.key);
    const refs = step.tables.flatMap((t) => (rows[t.system] || []).map((r) => r[t.key]).filter(Boolean)
      .map((k) => ({ k, label: F.displayValue(F.keyColumn(t), k) })));
    const seen = new Set(), refOpts = refs.filter((r) => !seen.has(r.k) && seen.add(r.k));
    const items = list.map((ph, i) => {
      const opts = [{ k: "", label: "General" }, ...refOpts];
      if (ph.ref && !opts.some((o) => o.k === ph.ref)) opts.push({ k: ph.ref, label: ph.ref });
      return `<li>
  <img data-file="${esc(ph.id)}" alt="${esc(ph.caption || ph.ref || "Photo")}">
  <div class="ph-meta">
    ${refOpts.length ? `<label class="small">Shows <select data-photo-ref="${i}">${opts.map((o) => `<option value="${esc(o.k)}"${o.k === (ph.ref || "") ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>` : ""}
    <input data-photo-caption="${i}" value="${esc(ph.caption || "")}" placeholder="Caption, e.g. Nameplate" aria-label="Caption for photo ${i + 1}" autocomplete="off">
    <button type="button" class="icon-btn" data-photo-rm="${i}" aria-label="Remove photo ${i + 1}">×</button>
  </div></li>`;
    }).join("");
    return `
<section class="card photos" aria-label="Photos">
  <div class="card-head">
    <h2>Photos</h2><span class="small dim-ink" id="photo-status" role="status">${list.length ? `${plural(list.length, "photo")} · printed in the manual's photo appendix` : "Nameplates, shutoff locations, panels: printed in the manual's photo appendix"}</span>
    <span class="push row-gap">
      <label class="btn take-photo">Take photo<input type="file" accept="image/*" capture="environment" data-photo-add hidden></label>
      <label class="btn dark">+ Add photos<input type="file" accept="image/*" multiple data-photo-add hidden></label>
    </span>
  </div>
  ${items ? `<ul class="photo-grid">${items}</ul>` : ""}
</section>`;
  }

  async function addPhotos(input) {
    const files = [...input.files];
    if (!files.length) return;
    const bid = route.bid, key = route.key, status = document.getElementById("photo-status");
    if (dirty && !saveForm()) return;
    const added = [];
    try {
      for (const [i, f] of files.entries()) {
        if (status) status.textContent = `Adding photo ${i + 1} of ${files.length}…`;
        const img = await F.prepareImage(f);
        const id = await F.files.put(img);
        added.push({ id, caption: f.name.replace(/\.[a-z0-9]+$/i, "").replace(/^(IMG|DSC|PXL|image)[_-]?\d.*$/i, ""), ref: "" });
      }
    } catch (e) {
      flash("error", e.message);
    }
    if (added.length) {
      F.store.setPhotos(bid, key, [...F.store.photos(bid, key), ...added]);
      flash("ok", `${plural(added.length, "photo")} added. Add a caption and pick what each one shows.`);
    }
    render();
  }

  function renderStep(b, step) {
    const num = F.number(step), saved = b.steps[step.key] || {};
    const ov = override && override.bid === b.id && override.key === step.key ? override : null;
    override = null;
    const data = ov ? ov.data : (saved.data || {});
    const rows = ov ? ov.rows : F.stepRows(b, step);
    const errors = ov ? ov.errors : {};
    const p = progress(b), back = F.neighbor(step, -1), next = F.neighbor(step, +1);

    const rail = F.STEPS.map((s, i) => {
      const sv = b.steps[s.key];
      const state = s === step ? "current" : !s.enabled ? "soon" : sv && sv.completed ? "done" : "todo";
      const dot = `<span class="dot">${state === "done" ? "✓" : i + 1}</span>`;
      return `<li class="${state}">${state === "soon"
        ? `<span class="step-link" aria-disabled="true">${dot}${esc(s.title)}<small>soon</small></span>`
        : `<a class="step-link" href="${stepUrl(b.id, s.key)}"${state === "current" ? ' aria-current="step"' : ""}>${dot}${esc(s.title)}</a>`}</li>`;
    }).join("");

    let main;
    if (step.special === "review") {
      const trs = F.SECTIONS.map((s) => {
        const sv = b.steps[s.key], rs = F.stepRows(b, s);
        let badge = "", label, miss = [];
        if (!s.enabled) label = "Not built";
        else if (!sv) label = "Not started";
        else { miss = F.warnings(s, sv.data, rs); [badge, label] = sv.completed ? ["ok", "Complete"] : ["warn", "Incomplete"]; }
        return `<tr>
  <td><span class="mono dim-ink">${F.number(s)}</span>&nbsp; ${s.enabled ? `<a href="${stepUrl(b.id, s.key)}">${esc(s.title)}</a>` : esc(s.title)}</td>
  <td><span class="badge ${badge}">${label}</span></td>
  <td class="small">${miss.length ? esc(miss.join("; ")) : "—"}</td></tr>`;
      }).join("");
      main = `
<section class="card"><div class="table-wrap"><table class="grid">
  <thead><tr><th scope="col">Section</th><th scope="col">Status</th><th scope="col">Still missing</th></tr></thead>
  <tbody>${trs}</tbody></table></div></section>
<div class="actions">
  <button type="button" class="btn primary" data-action="docx" data-bid="${esc(b.id)}">Download manual (.docx)</button>
  ${back !== step ? `<a class="btn back" href="${stepUrl(b.id, back.key)}">← ${esc(back.title)}</a>` : ""}
</div>`;
    } else if (!step.enabled) {
      main = `<section class="card empty"><p>This step isn't built yet. Give it fields in <code>js/steps.js</code> and remove <code>enabled: false</code>.</p></section>`;
    } else {
      const hasVendor = step.tables.some((t) => t.columns.some((c) => c.kind === "vendor")) || step.fields.some((f) => f.kind === "vendor");
      const tableHtml = step.tables.map((t) => {
        const list = rows[t.system] || [], errs = (errors._tables || {})[t.system];
        const vendorCol = t.columns.some((c) => c.kind === "vendor");
        return `
<section class="card">
  <div class="card-head">
    <h2>${esc(t.title)}</h2>
    <span class="dim-ink small" data-count="${t.system}" data-noun="${esc(t.unitNoun)}">${plural(list.length, t.unitNoun)}</span>
    <span class="push row-gap">
    <button type="button" class="btn ghost" data-action="csv-export" data-system="${t.system}" title="Download this table as a CSV file (also a template for importing)">Export CSV</button>
    <button type="button" class="btn ghost" data-action="csv-import" data-system="${t.system}" title="Add or update rows from a CSV file">Import CSV</button>
    ${vendorCol ? `<a class="btn" href="#/vendors/new?return=${encodeURIComponent(stepUrl(b.id, step.key))}">+ New vendor in directory</a>` : ""}
    <button type="button" class="btn dark" data-add-row="${t.system}">+ Add ${esc(t.unitNoun)}</button></span>
  </div>
  ${errs ? `<ul class="errors">${errs.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
  <div class="table-wrap"><table class="grid edit${t.columns.length <= 4 ? " narrow" : ""}" data-table="${t.system}">
    <colgroup>${(() => { const sum = t.columns.reduce((x, c) => x + c.w, 0); return t.columns.map((c) => `<col style="width:${((c.w / sum) * 94).toFixed(1)}%">`).join(""); })()}<col style="width:6%"></colgroup>
    <thead><tr>${t.columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("")}<th><span class="sr">Remove</span></th></tr></thead>
    <tbody>${list.map((r) => rowHtml(t, r)).join("")}</tbody>
  </table></div>
  <template id="row-${t.system}">${rowHtml(t)}</template>
</section>`;
      }).join("");
      const vendorHint = hasVendor && !F.store.records("vendors").length
        ? `<p class="note">The vendor directory is empty. <a href="#/vendors/new?return=${encodeURIComponent(stepUrl(b.id, step.key))}">Add a vendor</a>; it then appears in every vendor picker.</p>` : "";
      main = `
<form id="step-form" novalidate>
  ${vendorHint}
  ${tableHtml}
  ${step.fields.length ? `<section class="card fields">${step.fields.map((f) => fieldHtml(f, data[f.name] || "", errors[f.name])).join("")}</section>` : ""}
  ${photoCard(b, step, rows)}
  <div class="actions">
    <button class="btn link" name="action" value="save">Save draft</button>
    ${next !== step ? `<button class="btn primary" name="action" value="next">Next: ${esc(next.title)} →</button>` : ""}
    ${back !== step ? `<button class="btn back" name="action" value="back">← ${esc(back.title)}</button>` : ""}
    ${saved.updatedAt ? `<span class="dim-ink small saved">Last saved ${when(saved.updatedAt)}</span>` : ""}
  </div>
</form>`;
    }

    const warnings = step.enabled && !step.special ? F.warnings(step, data, rows) : [];
    const side = `
${step.manual.length ? `<div class="card">
  <div class="eyebrow">This step generates</div>
  <ul class="gen">${step.manual.map((m, i) => `<li><span class="mono dim-ink">${num}.${i + 1}</span>${esc(m.title)}</li>`).join("")}</ul>
  <button type="button" class="side-link" data-action="docx" data-bid="${esc(b.id)}">Download current draft →</button>
</div>` : ""}
${warnings.length ? `<div class="card warn"><div class="warn-title">Missing before publish</div><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}`;

    app.innerHTML = `${topbar(b)}
<div class="layout">
  <nav class="rail card" aria-label="Wizard steps">
    <div class="eyebrow">Progress</div>
    <div class="progress"><div class="bar"><div style="width:${p.pct}%"></div></div><span class="mono small">${p.done} / ${p.total}</span></div>
    <ol>${rail}</ol>
  </nav>
  <main class="content">
    <div class="step-head">
      <div>
        <div class="eyebrow mono">STEP ${num} OF ${F.STEPS.length}${step.special ? "" : ` · SECTION ${num} OF MANUAL`}</div>
        <h1>${esc(step.title)}</h1>
        ${step.intro ? `<p class="lede">${esc(step.intro)}</p>` : ""}
      </div>
      ${step.enabled ? `<button type="button" class="btn fill-btn" data-action="fill">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14l2 2 4-4"/></svg>
        Fill from document…</button>` : ""}
    </div>
    ${main}
  </main>
  <aside class="side">${side}</aside>
</div>`;
    dirty = !!ov;                // a re-shown failed save is still unsaved
  }

  const ACCENTS = [["#C2410C", "Orange"], ["#1D4ED8", "Blue"], ["#15803D", "Green"], ["#7C3AED", "Purple"], ["#B91C1C", "Red"], ["#1B2430", "Charcoal"]];

  function renderSettings() {
    const st = F.store.settings(), accent = st.accent || "#C2410C", sm = F.store.fyStart();
    const MONTHS = ["January (calendar year)", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    app.innerHTML = `${topbar()}
<div class="page narrow-page">
  <div class="page-head"><div><h1>Settings</h1><p class="lede">Branding for the manual cover, and how budget years are counted. Saved in this browser and included in backups.</p></div></div>
  <form id="settings-form" class="stack" novalidate>
    <section class="card"><h2 class="sec-title">Manual cover</h2><div class="fields">
      <div class="field"><label for="s-company">Company name</label><input id="s-company" name="companyName" value="${esc(st.companyName || "")}" autocomplete="organization"></div>
      <div class="field"><label for="s-prepared">Prepared by</label><input id="s-prepared" name="preparedBy" value="${esc(st.preparedBy || "")}" placeholder="Name, Facilities & Safety Manager"></div>
      <div class="field wide"><label for="s-footer">Footer text</label><input id="s-footer" name="footerText" value="${esc(st.footerText || "")}" placeholder="Uncontrolled when printed"><div class="help">Printed at the bottom-left of every page.</div></div>
      <fieldset class="field wide swatches"><legend>Accent color</legend>
        <div class="row-gap">${ACCENTS.map(([hex, label]) => `<label class="swatch"><input type="radio" name="accent" value="${hex}"${hex.toLowerCase() === accent.toLowerCase() ? " checked" : ""}><span style="background:${hex}"></span>${label}</label>`).join("")}
        <label class="swatch"><input type="radio" name="accent" value="custom"${ACCENTS.some(([h]) => h.toLowerCase() === accent.toLowerCase()) ? "" : " checked"}>Custom <input type="color" name="accentCustom" value="${esc(accent)}" aria-label="Custom accent color"></label></div>
        <div class="help">Used for headings, rules and the emergency boxes in the manual.</div>
      </fieldset>
    </div></section>
    <section class="card"><h2 class="sec-title">Logo</h2>
      <div class="logo-row">
        <div class="logo-box">${st.logoId ? `<img data-file="${esc(st.logoId)}" alt="Company logo">` : '<span class="small dim-ink">No logo</span>'}</div>
        <div class="row-gap">
          <label class="btn dark">${st.logoId ? "Replace logo" : "Upload logo"}<input type="file" accept="image/png,image/jpeg" data-logo hidden></label>
          ${st.logoId ? '<button type="button" class="btn" data-action="logo-remove">Remove</button>' : ""}
        </div>
      </div>
      <p class="small dim-ink">PNG or JPEG. A PNG with a transparent background looks best. Shown at the top of the cover page.</p>
    </section>
    <section class="card"><h2 class="sec-title">Budget years</h2><div class="fields">
      <div class="field"><label for="s-fy">Budget year starts</label><select id="s-fy" name="fy">${MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === sm ? " selected" : ""}>${m}</option>`).join("")}</select>
      <div class="help">A budget year is named by the year it ends: with July, FY2027 = Jul 2026 – Jun 2027.</div></div>
    </div></section>
    <div class="actions"><button class="btn primary">Save settings</button></div>
  </form>
  <section class="card"><h2 class="sec-title">Storage in this browser</h2><p class="small" id="storage-info">Checking…</p></section>
</div>`;
    storageInfo();
  }

  function saveSettingsForm(form) {
    const fd = new FormData(form);
    const accent = fd.get("accent") === "custom" ? String(fd.get("accentCustom") || "") : String(fd.get("accent") || "");
    F.store.setSettings({ companyName: String(fd.get("companyName") || "").trim(), preparedBy: String(fd.get("preparedBy") || "").trim(),
      footerText: String(fd.get("footerText") || "").trim(), accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#C2410C" });
    if (Number(fd.get("fy")) !== F.store.fyStart()) F.store.setFyStart(fd.get("fy"));
  }

  async function storageInfo() {
    const el = document.getElementById("storage-info");
    try {
      const files = await F.files.all();
      const bytes = files.reduce((a, f) => a + (f.blob ? f.blob.size : 0), 0);
      let quota = "";
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        if (e.quota) quota = ` Browser allows about ${(e.quota / 1e9).toFixed(1)} GB for this site.`;
      }
      const size = bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
      if (el) el.textContent = `${plural(files.length, "image")} stored (${files.length ? size : "0 KB"}).${quota} Backups include images, so keep the backup file somewhere with room.`;
    } catch (e) { if (el) el.textContent = e.message; }
  }

  function render() {
    route = parseRoute();
    let b = null, step = null;
    if (route.name === "step") {
      b = F.store.get(route.bid);
      step = F.byKey(route.key);
      if (!b || !step) {
        flash("error", "That building or step wasn't found. It may have been deleted, or it's saved in another browser.");
        route = { name: "home" };
        if (location.hash !== "#/") history.replaceState(null, "", "#/");
      }
    }
    let finTitle = "";
    if (route.name === "fin") {
      const out = F.finUI.render(route);
      if (!out) {
        flash("error", "That record wasn't found. It may have been deleted, or it's saved in another browser.");
        const list = `#/${route.page}`;
        history.replaceState(null, "", list);
        route = parseRoute();
        const again = F.finUI.render(route);
        app.innerHTML = `${topbar()}${again.html}`;
        finTitle = again.title;
      } else {
        app.innerHTML = `${topbar()}${out.html}`;
        finTitle = out.title;
      }
      dirty = F.finUI.unsaved();
    } else if (route.name === "settings") { dirty = false; renderSettings(); finTitle = "Settings"; }
    else if (route.name === "home") { dirty = false; renderHome(); }
    else renderStep(b, step);
    flashes = [];
    F.hydrateImages(app);
    document.title = finTitle ? `${finTitle} · Facilities Manual Builder` : step && b ? `${step.title} · ${b.name}` : "Facilities Manual Builder";
    window.scrollTo(0, 0);
  }

  // --- actions --------------------------------------------------------------

  /** Validate and save the open step form. Returns true on success. */
  function saveForm() {
    if (F.finUI.hasForm()) return F.finUI.save();
    const form = document.getElementById("step-form");
    if (!form || route.name !== "step") return true;
    const step = F.byKey(route.key), bid = route.bid;
    const { data, rows, errors } = F.parse(step, new FormData(form));
    if (Object.keys(errors).length) {
      override = { bid, key: step.key, data, rows, errors };
      flash("error", "Nothing was saved. Fix the items marked below.");
      render();
      return false;
    }
    try {
      F.store.saveStep(bid, step.key, data, F.missing(step, data, rows).length === 0, rows);
    } catch (e) {
      override = { bid, key: step.key, data, rows, errors: {} };
      flash("error", e.message);
      render();
      return false;
    }
    dirty = false;
    return true;
  }

  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }

  function loadDocx() {
    if (window.docx) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/docx.iife.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("couldn't load vendor/docx.iife.js"));
      document.head.appendChild(s);
    });
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadManual(bid, btn) {
    if (dirty) {                                  // save the open form first so the draft matches the screen
      if (!saveForm()) return;
      render();
      btn = null;
    }
    const b = F.store.get(bid);
    const label = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
    try {
      await loadDocx();
      const settings = F.store.settings(), images = {};
      const ids = [...Object.values(b.photos || {}).flat().map((p) => p.id), settings.logoId].filter(Boolean);
      for (const id of ids) {
        try {
          const f = await F.files.get(id);
          if (f) images[id] = { data: new Uint8Array(await f.blob.arrayBuffer()), type: /png/.test(f.type) ? "png" : "jpg", w: f.w, h: f.h };
        } catch (e) { /* missing image: the manual notes it */ }
      }
      const blob = await window.docx.Packer.toBlob(F.buildManual(b, new Date(), { settings, images }));
      saveBlob(blob, F.manualFilename(b));
    } catch (e) {
      console.error(e);
      flash("error", `Couldn't build the manual: ${e.message}`);
      render();
      return;
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  }

  async function exportBackup() {
    if (dirty && !saveForm()) return;
    const d = new Date(), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let files = [];
    try {
      const refs = F.store.fileRefs();
      for (const f of await F.files.all()) {
        if (!refs.has(f.id)) continue;
        files.push({ id: f.id, name: f.name || "", type: f.type, w: f.w, h: f.h, data: await F.blobToBase64(f.blob) });
      }
    } catch (e) { files = []; }
    const json = F.store.exportJSON(files.length ? files : undefined);
    saveBlob(new Blob([json], { type: "application/json" }), `facilities-manual-backup-${ymd}.json`);
    F.store.markExported();
    flash("ok", `Backup downloaded${files.length ? ` with ${plural(files.length, "image")} (${(json.length / 1e6).toFixed(1)} MB)` : ""}. Keep it somewhere safe, such as OneDrive or a network drive.`);
    render();
  }

  async function importBackup(file) {
    try {
      const r = F.store.importJSON(await file.text());
      F.linkVendors();
      let restored = 0;
      if (r.files.length) {
        const have = new Set(await F.files.keys());
        for (const f of r.files) {
          if (!f || typeof f.id !== "string" || typeof f.data !== "string" || have.has(f.id)) continue;
          await F.files.put({ id: f.id, name: f.name, type: f.type || "image/jpeg", w: f.w, h: f.h, blob: F.base64ToBlob(f.data, f.type || "image/jpeg") });
          restored++;
        }
      }
      const rec = r.records || { added: 0, updated: 0 };
      flash("ok", `Import complete: ${plural(r.added, "building")} added, ${r.updated} updated, ${r.skipped} unchanged; ` +
        `${plural(rec.added, "contract, invoice or vendor record")} added, ${rec.updated} updated${restored ? `; ${plural(restored, "image")} restored` : ""}. Existing items are only replaced by newer copies.`);
    } catch (e) {
      flash("error", e.message);
    }
    go("#/");
  }

  // --- fill from document (see importer.js) ---------------------------------

  const dlg = document.createElement("dialog");
  dlg.className = "imp";
  dlg.setAttribute("aria-labelledby", "imp-title");
  document.body.appendChild(dlg);
  let imp = null;   // { bid, stepKey, scope: "all"|"step", reply, plan, error, csv: filename|undefined }

  const fillSteps = () => F.importScope(imp.scope === "step" ? imp.stepKey : null);

  function openFill() {
    if (dirty) {
      if (!saveForm()) return;
      render();                                   // page behind the dialog reflects the save
    }
    const step = F.byKey(route.key);
    imp = { bid: route.bid, stepKey: step.special ? null : step.key, scope: "all", reply: "", plan: null, error: "" };
    drawFill();
    dlg.showModal();
  }

  const dlgHead = (title) => `<div class="dlg-head"><h2 id="imp-title">${title}</h2>
    <button type="button" class="icon-btn" data-imp="close" aria-label="Close">×</button></div>`;

  function drawFill() {
    const b = F.store.get(imp.bid);
    if (!imp.plan) {
      const thisStep = imp.stepKey ? F.byKey(imp.stepKey) : null;
      dlg.innerHTML = `<div class="dlg">
  ${dlgHead("Fill from a document")}
  <p class="lede">Have your company's AI assistant (for example Microsoft Copilot) read an equipment list, O&amp;M manual, survey or old facilities manual, then fill in <strong>${esc(b.name)}</strong> for you. Nothing changes until you review it.</p>
  ${thisStep ? `<fieldset class="scope"><legend>What to fill</legend>
    <label><input type="radio" name="imp-scope" value="all"${imp.scope === "all" ? " checked" : ""}> All sections (${esc(F.importScope().map((s) => s.title).join(", "))})</label>
    <label><input type="radio" name="imp-scope" value="step"${imp.scope === "step" ? " checked" : ""}> ${esc(thisStep.title)} only</label>
  </fieldset>` : ""}
  <ol class="howto">
    <li>
      <div><strong>Copy the prompt.</strong> It tells the AI exactly which fields to return.</div>
      <div class="row"><button type="button" class="btn dark" data-imp="copy">Copy prompt</button><span class="small dim-ink" id="imp-copied" role="status"></span></div>
      <details><summary>Show prompt</summary><textarea id="imp-prompt" readonly rows="10">${esc(F.importPrompt(fillSteps()))}</textarea></details>
    </li>
    <li>
      <div><strong>Open your AI and attach the document</strong> (or paste its text), then paste the prompt and send.</div>
      <div class="small dim-ink">Typed documents and spreadsheets work best. Scanned PDFs only work if your AI can read images.</div>
    </li>
    <li>
      <label for="imp-reply"><strong>Copy the AI's whole reply and paste it here.</strong></label>
      <textarea id="imp-reply" rows="8" placeholder='{ "profile": { … }, … }'>${esc(imp.reply)}</textarea>
      ${imp.error ? `<div class="err" role="alert">${esc(imp.error)}</div>` : ""}
    </li>
  </ol>
  <div class="actions">
    <button type="button" class="btn primary" data-imp="preview">Preview changes</button>
    <button type="button" class="btn" data-imp="close">Cancel</button>
  </div>
</div>`;
      return;
    }

    const p = imp.plan, n = F.importCounts(p);
    const secs = p.sections.map((sec, si) => {
      const fields = sec.fields.length ? `<div class="table-wrap"><table class="grid imp-table">
  <thead><tr><th scope="col"><span class="sr">Apply</span></th><th scope="col">Field</th><th scope="col">Now</th><th scope="col">From document</th></tr></thead>
  <tbody>${sec.fields.map((f, fi) => `<tr class="${f.problem ? "bad" : f.conflict ? "conflict" : ""}">
    <td><input type="checkbox" data-pick="${si}:f:${fi}" aria-label="Apply ${esc(f.label)}"${f.checked ? " checked" : ""}${f.problem ? " disabled" : ""}></td>
    <td>${esc(f.label)}</td>
    <td class="pre">${f.current ? esc(f.currentText) : '<span class="dim-ink">—</span>'}</td>
    <td class="pre">${f.problem ? `<span class="err">${esc(f.problem)}</span>` : esc(f.valueText)}${f.conflict ? '<span class="tagnote block">Replaces what is entered now</span>' : ""}${f.note ? `<span class="small dim-ink block">${esc(f.note)}</span>` : ""}</td>
  </tr>`).join("")}</tbody></table></div>` : "";

      const rows = sec.step.tables.map((t) => {
        const mine = sec.rows.map((r, ri) => [r, ri]).filter(([r]) => r.table === t);
        if (!mine.length) return "";
        return `<h4>${esc(t.title)}</h4><ul class="imp-rows">${mine.map(([r, ri]) => {
        const summary = r.kind === "add"
          ? t.columns.filter((c) => c.name !== t.key && r.row[c.name]).map((c) => `${esc(c.label)}: ${esc(F.displayValue(c, r.row[c.name]))}`).join(" · ")
          : r.changes.map((ch) => `${esc(ch.label)}: ${ch.from ? `<s>${esc(ch.from)}</s> → ` : ""}${esc(ch.to)}`).join(" · ");
        return `<li class="${r.conflict ? "conflict" : ""}"><label>
    <input type="checkbox" data-pick="${si}:r:${ri}"${r.checked ? " checked" : ""}${r.kind === "update" && !r.changes.length ? " disabled" : ""}>
    <span><strong class="mono">${esc(r.tagText)}</strong> <span class="badge ${r.kind === "add" ? "ok" : "warn"}">${r.kind === "add" ? "NEW" : "UPDATE"}</span>
      <span class="small block">${summary || "—"}</span>
      ${r.notes.map((x) => `<span class="small dim-ink block">${esc(x)}</span>`).join("")}
      ${r.problems.map((x) => `<span class="small err block">${esc(x)}</span>`).join("")}
      ${r.conflict ? '<span class="tagnote block">Replaces values already entered</span>' : ""}</span>
  </label></li>`;
      }).join("")}</ul>`;
      }).join("");
      return `<section class="imp-sec"><h3>${esc(sec.step.title)}</h3>${fields}${rows}</section>`;
    }).join("");

    dlg.innerHTML = `<div class="dlg">
  ${dlgHead(imp.csv ? `Review changes from ${esc(imp.csv)}` : "Review changes")}
  ${p.notes.length ? `<div class="card warn"><div class="warn-title">${imp.csv ? "About this file" : "The AI flagged these"}</div><ul>${p.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  ${p.sections.length
    ? `<p class="small dim-ink">Ticked items will be saved. Anything that would replace a value you already entered starts unticked. Blank values in the document never erase anything.</p>${secs}`
    : `<div class="card empty"><p>Nothing new to fill: everything in the ${imp.csv ? "file" : "reply"} is blank or already matches what's entered.</p></div>`}
  <div class="actions">
    <button type="button" class="btn primary" data-imp="apply"${n ? "" : " disabled"}>Apply ${plural(n, "change")}</button>
    ${imp.csv ? "" : '<button type="button" class="btn back" data-imp="back">← Back</button>'}
    <button type="button" class="btn" data-imp="close">Cancel</button>
  </div>
</div>`;
  }

  async function copyPrompt() {
    const ta = dlg.querySelector("#imp-prompt"), status = dlg.querySelector("#imp-copied");
    try {
      await navigator.clipboard.writeText(ta.value);
      status.textContent = "Copied. Now paste it into your AI.";
    } catch (e) {
      ta.closest("details").open = true;
      ta.focus(); ta.select();
      status.textContent = document.execCommand && document.execCommand("copy")
        ? "Copied. Now paste it into your AI."
        : "Press Ctrl+C to copy the selected prompt.";
    }
  }

  dlg.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-imp]");
    if (!btn) return;
    const b = F.store.get(imp.bid);
    switch (btn.dataset.imp) {
      case "copy": copyPrompt(); break;
      case "close": dlg.close(); break;
      case "back": imp.plan = null; drawFill(); break;
      case "preview":
        imp.reply = dlg.querySelector("#imp-reply").value;
        if (!imp.reply.trim()) { imp.error = "Paste the AI's reply first."; drawFill(); break; }
        try { imp.plan = F.buildImportPlan(b, fillSteps(), imp.reply); imp.error = ""; }
        catch (err) { imp.error = err.message; }
        drawFill();
        break;
      case "apply": {
        let r;
        try { r = F.applyImport(b, imp.plan); }
        catch (err) { flash("error", err.message); dlg.close(); render(); break; }
        const parts = [];
        if (r.fields) parts.push(plural(r.fields, "field"));
        if (r.added) parts.push(`${plural(r.added, "row")} added`);
        if (r.updated) parts.push(`${plural(r.updated, "row")} updated`);
        if (r.vendors) parts.push(`${plural(r.vendors, "new vendor")} added to the directory`);
        flash("ok", `${imp.csv ? `Imported ${imp.csv}` : "Filled from document"}: ${parts.join(", ")}. Look over each section before you publish.`);
        dlg.close();
        render();
        break;
      }
    }
  });

  dlg.addEventListener("change", (e) => {
    if (e.target.name === "imp-scope") {
      imp.reply = dlg.querySelector("#imp-reply").value;
      imp.scope = e.target.value;
      drawFill();
      return;
    }
    const pick = e.target.dataset.pick;
    if (pick) {
      const [si, kind, i] = pick.split(":");
      const sec = imp.plan.sections[+si];
      (kind === "f" ? sec.fields : sec.rows)[+i].checked = e.target.checked;
      const n = F.importCounts(imp.plan), apply = dlg.querySelector('[data-imp="apply"]');
      apply.textContent = `Apply ${plural(n, "change")}`;
      apply.disabled = !n;
    }
  });

  // --- CSV for wizard tables (see importer.js) -------------------------------

  const csvInput = document.createElement("input");
  csvInput.type = "file"; csvInput.accept = ".csv,text/csv"; csvInput.hidden = true;
  document.body.appendChild(csvInput);
  let csvTarget = null;

  function exportTableCSV(system) {
    if (dirty && !saveForm()) return;
    const b = F.store.get(route.bid), step = F.byKey(route.key), t = F.tableOf(step, system);
    const p = (b.steps.profile || {}).data || {};
    const stem = `${p.doc_number || b.name}-${t.system}`.replace(/[^A-Za-z0-9._-]+/g, "_");
    saveBlob(new Blob([F.toCSV(F.tableToCSVRows(t, b.equipment[t.system] || []))], { type: "text/csv" }), `${stem}.csv`);
  }

  function importTableCSV(system) {
    if (dirty) { if (!saveForm()) return; render(); }
    csvTarget = { bid: route.bid, key: route.key, system };
    csvInput.value = "";
    csvInput.click();
  }

  csvInput.addEventListener("change", async () => {
    const file = csvInput.files[0];
    if (!file || !csvTarget) return;
    const b = F.store.get(csvTarget.bid), step = F.byKey(csvTarget.key), t = F.tableOf(step, csvTarget.system);
    try {
      const { doc, notes } = F.csvToDoc(step, t, await file.text());
      const plan = F.buildImportPlanFromDoc(b, [step], doc);
      plan.notes = [...notes, ...plan.notes];
      imp = { bid: b.id, stepKey: step.key, scope: "step", reply: "", plan, error: "", csv: file.name };
      drawFill();
      dlg.showModal();
    } catch (e) {
      flash("error", `Couldn't import ${file.name}: ${e.message}`);
      render();
    }
  });

  // --- events ---------------------------------------------------------------

  document.addEventListener("click", (e) => {
    if (F.finUI.onClick(e)) return;
    const add = e.target.closest("[data-add-row]");
    if (add) {
      const sys = add.dataset.addRow;
      const tbody = document.querySelector(`table[data-table="${sys}"] tbody`);
      tbody.appendChild(document.getElementById(`row-${sys}`).content.cloneNode(true));
      const first = tbody.lastElementChild.querySelector("input, select");
      if (first) first.focus();
      updateCount(sys);
      dirty = true;
      return;
    }
    const prm = e.target.closest("[data-photo-rm]");
    if (prm) {
      if (window.confirm("Remove this photo?")) {
        const list = F.store.photos(route.bid, route.key).filter((_, i) => i !== Number(prm.dataset.photoRm));
        F.store.setPhotos(route.bid, route.key, list);
        F.cleanupFiles();
        render();
      }
      return;
    }
    const rm = e.target.closest("[data-remove-row]");
    if (rm) {
      const sys = rm.closest("table").dataset.table;
      rm.closest("tr").remove();
      updateCount(sys);
      dirty = true;
      return;
    }
    const act = e.target.closest("[data-action]");
    if (act) {
      const bid = act.dataset.bid;
      switch (act.dataset.action) {
        case "docx": downloadManual(bid, act); break;
        case "fill": openFill(); break;
        case "csv-export": exportTableCSV(act.dataset.system); break;
        case "logo-remove":
          if (act.form) saveSettingsForm(act.form);
          F.store.setSettings({ logoId: "" }); F.cleanupFiles();
          flash("ok", "Logo removed."); render(); break;
        case "csv-import": importTableCSV(act.dataset.system); break;
        case "export": exportBackup(); break;
        case "import": fileInput.value = ""; fileInput.click(); break;
        case "duplicate": {
          const nid = F.store.duplicate(bid);
          flash("ok", "Copied. Address, document number and serial numbers were cleared; every section is marked for review.");
          go(stepUrl(nid, "profile"));
          break;
        }
        case "delete": {
          const b = F.store.get(bid);
          const n = F.store.linkedCount(bid);
          const keep = n ? ` Its ${plural(n, "contract/invoice")} will be kept as company-wide / unassigned.` : "";
          if (window.confirm(`Delete “${b.name}”?${keep} This can't be undone unless you have a backup file.`)) {
            F.store.remove(bid);
            F.cleanupFiles();
            flash("ok", `Deleted ${b.name}.`);
            render();
          }
          break;
        }
      }
      return;
    }
    // Moving to another step or page saves the open form first.
    const link = e.target.closest('a[href^="#"]');
    if (link && dirty) {
      e.preventDefault();
      if (saveForm()) go(link.getAttribute("href"));
    }
  });

  document.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "settings-form") {
      saveSettingsForm(e.target);
      flash("ok", "Settings saved. They apply the next time you download a manual.");
      render();
      return;
    }
    if (e.target.id === "new-building") {
      const name = e.target.elements.name.value.trim();
      if (!name) return;
      try { go(stepUrl(F.store.create(name), "profile")); }
      catch (err) { flash("error", err.message); render(); }
      return;
    }
    if (e.target.id === "fin-form") {
      if (F.finUI.save()) { flash("ok", "Saved."); render(); }
      return;
    }
    if (e.target.id === "step-form") {
      const action = (e.submitter && e.submitter.value) || "save";
      if (!saveForm()) return;
      const step = F.byKey(route.key);
      const target = action === "next" ? F.neighbor(step, +1) : action === "back" ? F.neighbor(step, -1) : step;
      if (target === step) flash("ok", "Saved.");
      go(stepUrl(route.bid, target.key));
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.name === "accentCustom") { const r = e.target.form.querySelector('input[name=accent][value=custom]'); if (r) r.checked = true; return; }
    if (F.finUI.onInput(e)) return;
    if (e.target.closest("#step-form, #fin-form")) dirty = true;
  });
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches && t.matches("[data-photo-add]")) { addPhotos(t); return; }
    if (t.dataset && (t.dataset.photoRef !== undefined || t.dataset.photoCaption !== undefined)) {
      const list = F.store.photos(route.bid, route.key).map((p) => ({ ...p }));
      const i = Number(t.dataset.photoRef ?? t.dataset.photoCaption);
      if (!list[i]) return;
      if (t.dataset.photoRef !== undefined) list[i].ref = t.value; else list[i].caption = t.value.trim();
      F.store.setPhotos(route.bid, route.key, list);
      return;
    }
    if (t.matches && t.matches("[data-logo]") && t.files[0]) {
      try {
        const img = await F.prepareImage(t.files[0], 800);
        const id = await F.files.put(img);
        if (t.form) saveSettingsForm(t.form);                   // keep what was typed on the page
        F.store.setSettings({ logoId: id });
        F.cleanupFiles();
        flash("ok", "Logo saved.");
      } catch (err) { flash("error", err.message); }
      render();
      return;
    }
    if (F.finUI.onChange(e)) return;
    if (e.target.closest("#step-form, #fin-form")) dirty = true;
  });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) importBackup(fileInput.files[0]); });
  window.addEventListener("hashchange", render);
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function updateCount(sys) {
    const el = document.querySelector(`[data-count="${sys}"]`);
    if (el) el.textContent = plural(document.querySelectorAll(`table[data-table="${sys}"] tbody tr`).length, el.dataset.noun);
  }

  F.ui = { esc, plural, flash, render, go, saveBlob, vendorSelect, setDirty: (v) => { dirty = !!v; } };
  try { F.linkVendors(); } catch (e) { console.error(e); }       // older data: build the directory from contract/invoice vendors
  render();
})(window.FMB);
