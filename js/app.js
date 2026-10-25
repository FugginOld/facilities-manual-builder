/* UI: hash router, rendering, events. Routes: #/  and  #/b/<buildingId>/<stepKey> */
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
    const m = location.hash.match(/^#\/b\/([^/]+)\/([a-z_]+)$/);
    if (m) return { name: "step", bid: decodeURIComponent(m[1]), key: m[2] };
    return { name: "home" };
  }

  // --- rendering ------------------------------------------------------------

  function topbar(b) {
    const meta = F.store.meta(), any = F.store.list().length > 0;
    const stale = any && (meta.changedSinceExport || !meta.lastExport);
    const status = meta.lastExport ? `Backup ${when(meta.lastExport)}` : "No backup yet";
    return `
<header class="topbar">
  <a class="brand" href="#/">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>
    Facilities Manual Builder
  </a>
  ${b ? `<div class="crumb"><span class="dim">Building</span> <strong>${esc(b.name)}</strong></div>` : ""}
  <div class="topbar-right">
    <span class="backup${stale ? " stale" : ""}" title="${stale ? "Changes since your last backup" : "Backed up"}">${esc(status)}${stale && meta.lastExport ? " · changes since" : ""}</span>
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
  <p class="note">Your data is saved in this browser on this PC only. Use <strong>Export backup</strong> regularly and keep the file on OneDrive or a network drive; <strong>Import</strong> brings it back here or onto another PC.</p>
  ${cards ? `<div class="cards">${cards}</div>` : `<div class="card empty"><p>No buildings yet. Add one above, or Import a backup file.</p></div>`}
</div>`;
  }

  function fieldHtml(f, value, error) {
    const id = `f-${f.name}`, wide = f.wide || f.kind === "textarea" || f.kind === "lines";
    let input;
    if (f.kind === "select") {
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
      const input = c.kind === "select"
        ? `<select name="${name}" aria-label="${esc(c.label)}"><option value="">—</option>${c.options.map((o) =>
            `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
        : `<input name="${name}" aria-label="${esc(c.label)}" value="${esc(v)}"${c.mono ? ' class="mono"' : ""} autocomplete="off">`;
      return `<td>${input}</td>`;
    }).join("")}<td class="rm"><button type="button" class="icon-btn" data-remove-row aria-label="Remove row">×</button></td></tr>`;
  }

  function renderStep(b, step) {
    const num = F.number(step), saved = b.steps[step.key] || {};
    const ov = override && override.bid === b.id && override.key === step.key ? override : null;
    override = null;
    const data = ov ? ov.data : (saved.data || {});
    const rows = ov ? ov.rows : (step.table ? (b.equipment[step.table.system] || []) : []);
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
        const sv = b.steps[s.key], rs = s.table ? (b.equipment[s.table.system] || []) : [];
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
      const t = step.table;
      const tableHtml = t ? `
<section class="card">
  <div class="card-head">
    <h2>${esc(t.title)}</h2>
    <span class="dim-ink small" data-count="${t.system}" data-noun="${esc(t.unitNoun)}">${plural(rows.length, t.unitNoun)}</span>
    <button type="button" class="btn dark push" data-add-row="${t.system}">+ Add ${esc(t.unitNoun)}</button>
  </div>
  ${errors._table ? `<ul class="errors">${errors._table.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
  <div class="table-wrap"><table class="grid edit" data-table="${t.system}">
    <thead><tr>${t.columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("")}<th><span class="sr">Remove</span></th></tr></thead>
    <tbody>${rows.map((r) => rowHtml(t, r)).join("")}</tbody>
  </table></div>
  <template id="row-${t.system}">${rowHtml(t)}</template>
</section>` : "";
      main = `
<form id="step-form" novalidate>
  ${tableHtml}
  ${step.fields.length ? `<section class="card fields">${step.fields.map((f) => fieldHtml(f, data[f.name] || "", errors[f.name])).join("")}</section>` : ""}
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
    if (route.name === "home") { dirty = false; renderHome(); }
    else renderStep(b, step);
    flashes = [];
    document.title = step && b ? `${step.title} · ${b.name}` : "Facilities Manual Builder";
    window.scrollTo(0, 0);
  }

  // --- actions --------------------------------------------------------------

  /** Validate and save the open step form. Returns true on success. */
  function saveForm() {
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
      F.store.saveStep(bid, step.key, data, F.missing(step, data, rows).length === 0,
                       step.table ? step.table.system : null, rows);
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
      const blob = await window.docx.Packer.toBlob(F.buildManual(b));
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

  function exportBackup() {
    if (dirty && !saveForm()) return;
    const d = new Date(), ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    saveBlob(new Blob([F.store.exportJSON()], { type: "application/json" }), `facilities-manual-backup-${ymd}.json`);
    F.store.markExported();
    flash("ok", "Backup downloaded. Keep it somewhere safe, such as OneDrive or a network drive.");
    render();
  }

  async function importBackup(file) {
    try {
      const r = F.store.importJSON(await file.text());
      flash("ok", `Import complete: ${plural(r.added, "building")} added, ${r.updated} updated, ${r.skipped} unchanged (this browser already had the same or newer copy).`);
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
  let imp = null;   // { bid, stepKey, scope: "all"|"step", reply, plan, error }

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
    <td class="pre">${f.current ? esc(f.current) : '<span class="dim-ink">—</span>'}</td>
    <td class="pre">${f.problem ? `<span class="err">${esc(f.problem)}</span>` : esc(f.value)}${f.conflict ? '<span class="tagnote block">Replaces what is entered now</span>' : ""}${f.note ? `<span class="small dim-ink block">${esc(f.note)}</span>` : ""}</td>
  </tr>`).join("")}</tbody></table></div>` : "";

      const cols = sec.step.table ? sec.step.table.columns : [];
      const rows = sec.rows.length ? `<h4>${esc(sec.step.table.title)}</h4><ul class="imp-rows">${sec.rows.map((r, ri) => {
        const summary = r.kind === "add"
          ? cols.slice(1).filter((c) => r.row[c.name]).map((c) => `${esc(c.label)}: ${esc(r.row[c.name])}`).join(" · ")
          : r.changes.map((ch) => `${esc(ch.label)}: ${ch.from ? `<s>${esc(ch.from)}</s> → ` : ""}${esc(ch.to)}`).join(" · ");
        return `<li class="${r.conflict ? "conflict" : ""}"><label>
    <input type="checkbox" data-pick="${si}:r:${ri}"${r.checked ? " checked" : ""}${r.kind === "update" && !r.changes.length ? " disabled" : ""}>
    <span><strong class="mono">${esc(r.tag)}</strong> <span class="badge ${r.kind === "add" ? "ok" : "warn"}">${r.kind === "add" ? "NEW" : "UPDATE"}</span>
      <span class="small block">${summary || "—"}</span>
      ${r.notes.map((x) => `<span class="small dim-ink block">${esc(x)}</span>`).join("")}
      ${r.problems.map((x) => `<span class="small err block">${esc(x)}</span>`).join("")}
      ${r.conflict ? '<span class="tagnote block">Replaces values already entered</span>' : ""}</span>
  </label></li>`;
      }).join("")}</ul>` : "";
      return `<section class="imp-sec"><h3>${esc(sec.step.title)}</h3>${fields}${rows}</section>`;
    }).join("");

    dlg.innerHTML = `<div class="dlg">
  ${dlgHead("Review changes")}
  ${p.notes.length ? `<div class="card warn"><div class="warn-title">The AI flagged these</div><ul>${p.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  ${p.sections.length
    ? `<p class="small dim-ink">Ticked items will be saved. Anything that would replace a value you already entered starts unticked. Blank values in the document never erase anything.</p>${secs}`
    : `<div class="card empty"><p>Nothing new to fill: everything in the reply is blank or already matches what's entered.</p></div>`}
  <div class="actions">
    <button type="button" class="btn primary" data-imp="apply"${n ? "" : " disabled"}>Apply ${plural(n, "change")}</button>
    <button type="button" class="btn back" data-imp="back">← Back</button>
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
        if (r.added) parts.push(`${plural(r.added, "unit")} added`);
        if (r.updated) parts.push(`${plural(r.updated, "unit")} updated`);
        flash("ok", `Filled from document: ${parts.join(", ")}. Look over each section before you publish.`);
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

  // --- events ---------------------------------------------------------------

  document.addEventListener("click", (e) => {
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
          if (window.confirm(`Delete “${b.name}”? This can't be undone unless you have a backup file.`)) {
            F.store.remove(bid);
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
    if (e.target.id === "new-building") {
      const name = e.target.elements.name.value.trim();
      if (!name) return;
      try { go(stepUrl(F.store.create(name), "profile")); }
      catch (err) { flash("error", err.message); render(); }
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

  document.addEventListener("input", (e) => { if (e.target.closest("#step-form")) dirty = true; });
  document.addEventListener("change", (e) => { if (e.target.closest("#step-form")) dirty = true; });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) importBackup(fileInput.files[0]); });
  window.addEventListener("hashchange", render);
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function updateCount(sys) {
    const el = document.querySelector(`[data-count="${sys}"]`);
    if (el) el.textContent = plural(document.querySelectorAll(`table[data-table="${sys}"] tbody tr`).length, el.dataset.noun);
  }

  render();
})(window.FMB);
