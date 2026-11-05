/* Contracts, invoices and costs: field definitions and all the math.
 * Pure functions, no DOM, so it can be tested in Node. Dates are "YYYY-MM-DD"
 * strings throughout (no time zones); money is stored as plain number strings. */
(function (F) {
  "use strict";

  // --- option lists -------------------------------------------------------------

  F.CATEGORIES = ["HVAC", "Fire & life safety", "Elevator", "Electrical / generator", "Plumbing / backflow",
    "Roofing", "Janitorial", "Landscaping", "Pest control", "Waste / recycling", "Security / access", "Other"];
  F.BILLING = ["Monthly", "Quarterly", "Semi-annual", "Annual", "Per visit", "One-time"];
  F.SERVICE_FREQ = ["Weekly", "Monthly", "Quarterly", "Semi-annual", "Annual", "As needed"];
  F.CONTRACT_STATUS = ["Active", "Not renewing", "Ended"];
  F.WORK_TYPES = ["Contract service", "Repair", "Emergency repair", "Inspection / testing", "Parts / materials", "Other"];
  const REPAIRS = new Set(["Repair", "Emergency repair"]);

  // --- form definitions (kinds: text textarea number money date select yesno building contract) ---

  F.CONTRACT_FIELDS = [
    { name: "vendor", label: "Vendor", required: true, placeholder: "Acme Mechanical" },
    { name: "title", label: "Contract / service", required: true, placeholder: "HVAC preventive maintenance" },
    { name: "buildingId", label: "Building", kind: "building" },
    { name: "category", label: "Category", kind: "select", options: F.CATEGORIES },
    { name: "contract_number", label: "Contract / PO number" },
    { name: "status", label: "Status", kind: "select", options: F.CONTRACT_STATUS,
      help: "“Not renewing” ends it at the current term end; “Ended” stops all costs and reminders." },
    { name: "start_date", label: "Start date", kind: "date", required: true },
    { name: "term_months", label: "Initial term (months)", kind: "number", placeholder: "12" },
    { name: "end_date", label: "Initial term end date", kind: "date", help: "Leave blank to calculate it from start + term." },
    { name: "auto_renew", label: "Auto-renews", kind: "yesno" },
    { name: "renewal_term_months", label: "Renewal term (months)", kind: "number", placeholder: "12",
      help: "Length of each automatic renewal. Defaults to 12." },
    { name: "notice_days", label: "Notice to cancel (days)", kind: "number", placeholder: "60",
      help: "Written notice required before the term end to cancel or renegotiate." },
    { name: "cost_amount", label: "Cost", kind: "money", placeholder: "1,250.00" },
    { name: "billing_frequency", label: "Billed", kind: "select", options: F.BILLING },
    { name: "service_frequency", label: "Service visits", kind: "select", options: F.SERVICE_FREQ },
    { name: "escalation_pct", label: "Annual price increase (%)", kind: "number", placeholder: "3" },
    { name: "contact", label: "Vendor contact", wide: true, placeholder: "Name — phone — email" },
    { name: "scope", label: "Scope of services", kind: "textarea" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];

  F.INVOICE_FIELDS = [
    { name: "vendor", label: "Vendor", required: true },
    { name: "invoice_number", label: "Invoice number", help: "Used to catch duplicate imports." },
    { name: "buildingId", label: "Building", kind: "building" },
    { name: "invoice_date", label: "Invoice date", kind: "date", required: true },
    { name: "work_type", label: "Work type", kind: "select", options: F.WORK_TYPES },
    { name: "contractId", label: "Under contract", kind: "contract" },
    { name: "po_number", label: "PO number" },
    { name: "due_date", label: "Due date", kind: "date" },
    { name: "description", label: "Description of work", kind: "textarea" },
    { name: "tax", label: "Tax", kind: "money" },
    { name: "total", label: "Invoice total", kind: "money", help: "Leave blank to use line items + tax." },
  ];

  // --- dates ----------------------------------------------------------------------

  const pad = (n) => String(n).padStart(2, "0");
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();      // m is 1-12

  F.isDate = (s) => {
    const m = DATE_RE.exec(String(s || ""));
    return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= daysIn(+m[1], +m[2]);
  };
  const parts = (s) => s.split("-").map(Number);
  F.today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  F.addDays = (s, n) => {
    const [y, m, d] = parts(s), t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  };
  F.addMonths = (s, n) => {
    const [y, m, d] = parts(s), idx = y * 12 + (m - 1) + n, ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(d, daysIn(ny, nm)))}`;
  };
  F.diffDays = (a, b) => {                                              // b - a, in days
    const [y1, m1, d1] = parts(a), [y2, m2, d2] = parts(b);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
  };
  const monthsDiff = (a, b) => {                                        // whole months from a to b
    const [y1, m1, d1] = parts(a), [y2, m2, d2] = parts(b);
    return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  };
  F.fmtDate = (s) => {
    if (!F.isDate(s)) return "—";
    const [y, m, d] = parts(s);
    return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december"];

  /** Read a date the way people (and AIs) write them. US order for 1/2/2026. Returns "" if unreadable. */
  F.parseDate = (raw) => {
    const s = String(raw || "").trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
    if (!s) return "";
    let y, m, d, r;
    if ((r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) [y, m, d] = [+r[1], +r[2], +r[3]];
    else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
      [m, d, y] = [+r[1], +r[2], +r[3]];
      if (y < 100) y += 2000;
      if (m > 12 && d <= 12) [m, d] = [d, m];
    } else if ((r = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s))) {
      m = MONTHS.findIndex((x) => x.startsWith(r[1].toLowerCase().slice(0, 3))) + 1; d = +r[2]; y = +r[3];
    } else if ((r = /^(\d{1,2})\s+([a-z]{3,})\.?,?\s+(\d{4})$/i.exec(s))) {
      m = MONTHS.findIndex((x) => x.startsWith(r[2].toLowerCase().slice(0, 3))) + 1; d = +r[1]; y = +r[3];
    } else return "";
    const out = `${y}-${pad(m)}-${pad(d)}`;
    return F.isDate(out) ? out : "";
  };

  // --- money ------------------------------------------------------------------------

  /** "$1,234.50" / "(85.00)" / "1234.5 USD" -> "1234.5" ; "" if not money. */
  F.parseMoney = (raw) => {
    if (typeof raw === "number") return Number.isFinite(raw) ? String(Math.round(raw * 100) / 100) : "";
    let s = String(raw || "").trim();
    if (!s) return "";
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[$\s]/g, ""));
    s = s.replace(/[,$\s]|usd/gi, "").replace(/^\((.*)\)$/, "$1").replace(/^-/, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return "";
    const v = Math.round(Number(s) * 100) / 100;
    return String(neg ? -v : v);
  };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  F.money = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v))) ? "—" : usd.format(Number(v));
  F.money0 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? "—" : usd0.format(Math.round(Number(v)));

  // --- vendors ----------------------------------------------------------------------

  F.canonVendor = (s) => String(s || "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w && !["the", "inc", "llc", "co", "corp", "corporation", "company", "ltd", "lp", "llp", "pllc"].includes(w))
    .join(" ");

  // --- form parsing ------------------------------------------------------------------

  /** Parse a record form's fields from FormData -> {data, errors}. Required fields block saving. */
  F.parseFields = (fields, fd) => {
    const data = {}, errors = {};
    for (const f of fields) {
      let v = String(fd.get(f.name) ?? "").trim();
      if (f.kind === "money" && v) {
        const m = F.parseMoney(v);
        if (m === "") errors[f.name] = "Enter an amount, e.g. 1250.00"; else v = m;
      } else if (f.kind === "number" && v) {
        if (!Number.isFinite(Number(v.replace(/,/g, "")))) errors[f.name] = "Enter a number."; else v = v.replace(/,/g, "");
      } else if (f.kind === "date" && v && !F.isDate(v)) {
        errors[f.name] = "Enter a date.";
      } else if (f.kind === "select" && v && !f.options.includes(v)) {
        errors[f.name] = "Pick an option from the list.";
      }
      if (f.required && !v && !errors[f.name]) errors[f.name] = "Required.";
      data[f.name] = v;
    }
    return { data, errors };
  };

  /** Invoice line items from FormData -> {lines, errors[]} */
  F.parseLines = (fd) => {
    const d = fd.getAll("line-description"), a = fd.getAll("line-asset"), m = fd.getAll("line-amount");
    const lines = [], errors = [];
    for (let i = 0; i < Math.max(d.length, a.length, m.length); i++) {
      const l = { description: String(d[i] || "").trim(), asset: String(a[i] || "").trim(), amount: String(m[i] || "").trim() };
      if (!l.description && !l.asset && !l.amount) continue;
      const amt = F.parseMoney(l.amount);
      if (amt === "") errors.push(`Line ${lines.length + 1}: amount is missing or isn't a number.`);
      lines.push({ ...l, amount: amt });
    }
    return { lines, errors };
  };

  // --- contracts ----------------------------------------------------------------------

  const INTERVAL = { Weekly: [0, 7], Monthly: [1, 0], Quarterly: [3, 0], "Semi-annual": [6, 0], Annual: [12, 0] };
  const VISITS = { Weekly: 52, Monthly: 12, Quarterly: 4, "Semi-annual": 2, Annual: 1, "As needed": 0 };
  const FAR = "9999-12-31";

  /** Dates and status for one contract as of `today`. */
  F.contractInfo = (c, today = F.today()) => {
    const out = { start: F.isDate(c.start_date) ? c.start_date : "", firstEnd: "", termEnd: "", noticeBy: "",
                  renews: false, state: "Active", tone: "ok", openEnded: false };
    if (!out.start) return { ...out, state: "Missing dates", tone: "warn" };
    const term = num(c.term_months);
    out.firstEnd = F.isDate(c.end_date) ? c.end_date : term > 0 ? F.addDays(F.addMonths(out.start, term), -1) : "";
    out.openEnded = !out.firstEnd;
    const status = c.status || "Active";
    out.renews = c.auto_renew === "Yes" && status === "Active";
    let end = out.firstEnd;
    if (end && c.auto_renew === "Yes" && status !== "Ended") {
      const step = num(c.renewal_term_months) > 0 ? num(c.renewal_term_months) : 12;
      for (let i = 0; end < today && i < 600; i++) end = F.addDays(F.addMonths(F.addDays(end, 1), step), -1);
    }
    out.termEnd = end;
    if (end && num(c.notice_days) > 0) out.noticeBy = F.addDays(end, -num(c.notice_days));

    // projected last day of service, for cost and service forecasts
    if (status === "Ended") out.projectedEnd = end && end < today ? end : today;
    else if (out.renews || out.openEnded) out.projectedEnd = FAR;
    else out.projectedEnd = end;

    const days = (d) => (d ? F.diffDays(today, d) : null);
    out.daysToEnd = days(end);
    out.daysToNotice = days(out.noticeBy);
    if (status === "Ended") [out.state, out.tone] = ["Ended", "muted"];
    else if (out.start > today) [out.state, out.tone] = ["Upcoming", ""];
    else if (end && end < today) [out.state, out.tone] = ["Expired", "err"];
    else if (out.noticeBy && out.daysToNotice >= 0 && out.daysToNotice <= 60) [out.state, out.tone] = ["Notice due", "warn"];
    else if (end && out.daysToEnd <= 90) [out.state, out.tone] = [status === "Not renewing" || !out.renews ? "Expiring" : "Renewing soon", "warn"];
    out.monthly = monthlyRate(c);
    out.annual = annualAt(c, today, out);
    out.variable = c.billing_frequency === "Per visit" && (c.service_frequency === "As needed" || !c.service_frequency);
    out.nextService = nextService(c, today, out);
    return out;
  };

  function monthlyRate(c) {
    const a = num(c.cost_amount);
    switch (c.billing_frequency) {
      case "Monthly": return a;
      case "Quarterly": return a / 3;
      case "Semi-annual": return a / 6;
      case "Annual": return a / 12;
      case "Per visit": return (a * (VISITS[c.service_frequency] || 0)) / 12;
      default: return 0;                     // One-time or unset
    }
  }
  const escalation = (c, start, on) => Math.pow(1 + num(c.escalation_pct) / 100, Math.max(0, Math.floor(monthsDiff(start, on) / 12)));
  function annualAt(c, today, info) {
    if (c.billing_frequency === "One-time") return num(c.cost_amount);
    return monthlyRate(c) * 12 * escalation(c, info.start, today > info.start ? today : info.start);
  }

  function nextService(c, today, info) {
    const iv = INTERVAL[c.service_frequency];
    if (!iv || (c.status || "Active") === "Ended") return "";
    let d = info.start;
    for (let i = 0; d < today && i < 5000; i++) d = iv[0] ? F.addMonths(info.start, iv[0] * (i + 1)) : F.addDays(d, iv[1]);
    return d <= info.projectedEnd ? d : "";
  }

  /** Contracted cost falling in calendar month y/m (1-12): monthly-equivalent, with escalation. */
  F.contractCostInMonth = (c, y, m, today = F.today(), info = F.contractInfo(c, today)) => {
    if (!info.start) return 0;
    const ms = `${y}-${pad(m)}-01`, me = `${y}-${pad(m)}-${pad(daysIn(y, m))}`;
    if (c.billing_frequency === "One-time") return info.start >= ms && info.start <= me ? num(c.cost_amount) : 0;
    if (info.start > me || info.projectedEnd < ms) return 0;
    return info.monthly * escalation(c, info.start, ms > info.start ? ms : info.start);
  };

  /** Upcoming notice deadlines and term ends, soonest first. Includes recently missed notice dates. */
  F.deadlines = (contracts, today = F.today(), horizon = 120) => {
    const out = [];
    for (const c of contracts) {
      const i = F.contractInfo(c, today);
      if (!i.start || i.state === "Ended") continue;
      if (i.noticeBy && i.daysToNotice <= horizon && i.daysToNotice >= -30 && i.daysToEnd >= 0) {
        out.push({ date: i.noticeBy, days: i.daysToNotice, kind: "notice", contract: c, info: i,
          text: i.daysToNotice < 0
            ? `Notice deadline passed: ${i.renews ? "auto-renews" : "ends"} ${F.fmtDate(i.termEnd)}`
            : `Last day to give ${c.notice_days}-day notice${i.renews ? " (otherwise auto-renews)" : ""}` });
      }
      if (i.termEnd && i.daysToEnd >= 0 && i.daysToEnd <= horizon) {
        out.push({ date: i.termEnd, days: i.daysToEnd, kind: i.renews ? "renew" : "end", contract: c, info: i,
          text: i.renews ? "Term ends; renews automatically the next day" : "Contract ends" });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  };

  // --- invoices -----------------------------------------------------------------------

  F.invoiceTotal = (inv) => {
    const t = F.parseMoney(inv.total);
    if (t !== "") return Number(t);
    return (inv.lines || []).reduce((a, l) => a + num(l.amount), 0) + num(inv.tax);
  };
  /** Where an invoice's money went: [{tag, amount}] per equipment tag, plus the untagged remainder. */
  F.invoiceAllocation = (inv) => {
    const by = new Map();
    let tagged = 0;
    for (const l of inv.lines || []) {
      if (!l.asset) continue;
      const k = l.asset.toUpperCase();
      by.set(k, { tag: by.has(k) ? by.get(k).tag : l.asset, amount: (by.has(k) ? by.get(k).amount : 0) + num(l.amount) });
      tagged += num(l.amount);
    }
    return { assets: [...by.values()], general: Math.round((F.invoiceTotal(inv) - tagged) * 100) / 100 };
  };
  F.invoiceCheck = (inv) => {                                             // stated total vs lines + tax
    const stated = F.parseMoney(inv.total);
    if (stated === "" || !(inv.lines || []).length) return "";
    const calc = (inv.lines || []).reduce((a, l) => a + num(l.amount), 0) + num(inv.tax);
    return Math.abs(calc - Number(stated)) > 0.009
      ? `Line items + tax come to ${F.money(calc)}, but the invoice total is ${F.money(stated)}.` : "";
  };
  /** An existing invoice with the same vendor and invoice number. */
  F.findDuplicateInvoice = (invoices, inv) => {
    const n = String(inv.invoice_number || "").trim().toLowerCase(), v = F.canonVendor(inv.vendor);
    if (!n) return null;
    return invoices.find((x) => x.id !== inv.id && String(x.invoice_number || "").trim().toLowerCase() === n &&
      F.canonVendor(x.vendor) === v) || null;
  };

  // --- budget (fiscal) years ------------------------------------------------------------
  // A budget year is named by the calendar year it ENDS in (US convention): with a July
  // start, FY2027 = Jul 2026 – Jun 2027. Start month 1 = plain calendar years.

  const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  F.budgetYearOf = (date, sm = 1) => {
    if (!F.isDate(date)) return null;
    const y = +date.slice(0, 4), m = +date.slice(5, 7);
    return sm === 1 || m < sm ? y : y + 1;
  };
  /** The 12 [year, month] pairs of budget year `fy`, in order. */
  F.budgetYearMonths = (fy, sm = 1) => [...Array(12)].map((_, i) => {
    const idx = (sm === 1 ? fy : fy - 1) * 12 + (sm - 1) + i;
    return [Math.floor(idx / 12), (idx % 12) + 1];
  });
  F.budgetYearRange = (fy, sm = 1) => {
    const ms = F.budgetYearMonths(fy, sm), [y1, m1] = ms[0], [y2, m2] = ms[11];
    return { start: `${y1}-${pad(m1)}-01`, end: `${y2}-${pad(m2)}-${pad(daysIn(y2, m2))}` };
  };
  F.budgetYearLabel = (fy, sm = 1) => (sm === 1 ? String(fy) : `FY${fy}`);
  F.budgetYearSpan = (fy, sm = 1) => {
    const ms = F.budgetYearMonths(fy, sm);
    return `${MON3[ms[0][1] - 1]} ${ms[0][0]} – ${MON3[ms[11][1] - 1]} ${ms[11][0]}`;
  };
  F.monthLabels = (fy, sm = 1) => F.budgetYearMonths(fy, sm).map(([, m]) => MON3[m - 1]);

  // --- cost report ----------------------------------------------------------------------

  /** One budget year's numbers. year = budget year (see above); sm = start month 1-12.
   *  scope: "all" | "" (company-wide / unassigned) | building id */
  F.costReport = ({ contracts, invoices, budgets }, year, scope, today = F.today(), sm = 1) => {
    const inScope = (r) => scope === "all" || (r.buildingId || "") === scope;
    const cs = contracts.filter(inScope), inv = invoices.filter(inScope);
    const yearOf = (i) => F.budgetYearOf(i.invoice_date, sm);
    const months = F.budgetYearMonths(year, sm), key = (y, m) => y * 12 + m;
    const slot = new Map(months.map(([y, m], i) => [key(y, m), i]));
    const thisYear = F.budgetYearOf(today, sm);
    const nowIdx = slot.has(key(+today.slice(0, 4), +today.slice(5, 7))) ? slot.get(key(+today.slice(0, 4), +today.slice(5, 7))) : -1;

    const invoiced = Array(12).fill(0), contracted = Array(12).fill(0);
    for (const i of inv) if (yearOf(i) === year) invoiced[slot.get(key(+i.invoice_date.slice(0, 4), +i.invoice_date.slice(5, 7)))] += F.invoiceTotal(i);
    for (const c of cs) {
      const info = F.contractInfo(c, today);
      months.forEach(([y, m], k) => { contracted[k] += F.contractCostInMonth(c, y, m, today, info); });
    }
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const totalInvoiced = sum(invoiced), totalContracted = sum(contracted);
    let forecast;
    if (year < thisYear) forecast = totalInvoiced;
    else if (year > thisYear) forecast = totalContracted;
    else forecast = totalInvoiced + sum(contracted.slice(nowIdx + 1));

    // same point in the previous budget year, for a like-for-like trend
    const range = F.budgetYearRange(year, sm);
    const cutoff = year === thisYear ? today : range.end, priorCutoff = F.addMonths(cutoff, -12);
    const priorSamePeriod = inv.filter((i) => yearOf(i) === year - 1 && i.invoice_date <= priorCutoff)
      .reduce((a, i) => a + F.invoiceTotal(i), 0);
    const ytd = inv.filter((i) => yearOf(i) === year && i.invoice_date <= cutoff)
      .reduce((a, i) => a + F.invoiceTotal(i), 0);

    const vendors = new Map(), types = new Map(), assets = new Map();
    for (const i of inv) {
      const y = yearOf(i), total = F.invoiceTotal(i);
      if (y === year || y === year - 1) {
        const k = F.canonVendor(i.vendor) || "(no vendor)";
        const v = vendors.get(k) || { vendor: i.vendor || "(no vendor)", total: 0, prior: 0, count: 0, last: "" };
        if (y === year) { v.total += total; v.count++; } else v.prior += total;
        if (i.invoice_date > v.last) { v.last = i.invoice_date; v.vendor = i.vendor || v.vendor; }
        vendors.set(k, v);
      }
      if (y === year) {
        const t = i.work_type || "Unspecified";
        types.set(t, (types.get(t) || 0) + total);
      }
      const alloc = F.invoiceAllocation(i);
      for (const a of alloc.assets) {
        const k = `${i.buildingId || ""}|${a.tag.toUpperCase()}`;
        const r = assets.get(k) || { buildingId: i.buildingId || "", tag: a.tag, year: 0, lifetime: 0, count: 0, repairs: 0, last: "" };
        r.lifetime += a.amount; r.count++;
        if (y === year) r.year += a.amount;
        if (REPAIRS.has(i.work_type)) r.repairs++;
        if (i.invoice_date > r.last) r.last = i.invoice_date;
        assets.set(k, r);
      }
    }

    let budget = null;
    if (scope === "all") {
      const all = budgets.filter((b) => b.year === year);
      budget = all.length ? all.reduce((a, b) => a + b.amount, 0) : null;
    } else {
      const b = budgets.find((x) => x.year === year && x.scope === scope);
      budget = b ? b.amount : null;
    }

    return {
      year, scope, sm, months, label: F.budgetYearLabel(year, sm), span: F.budgetYearSpan(year, sm),
      invoiced, contracted, totalInvoiced, totalContracted, forecast, budget,
      ytd, priorSamePeriod, partialYear: year === thisYear,
      byVendor: [...vendors.values()].filter((v) => v.total || v.prior).sort((a, b) => b.total - a.total || b.prior - a.prior),
      byType: [...types.entries()].map(([type, total]) => ({ type, total })).sort((a, b) => b.total - a.total),
      byAsset: [...assets.values()].sort((a, b) => b.year - a.year || b.lifetime - a.lifetime),
      invoiceCount: inv.filter((i) => yearOf(i) === year).length,
    };
  };

  /** Side-by-side summary of several budget years (newest first). */
  F.yearSummary = (data, years, scope, today = F.today(), sm = 1) => years.map((y) => {
    const r = F.costReport(data, y, scope, today, sm);
    return { year: y, label: r.label, span: r.span, budget: r.budget, contracted: r.totalContracted, invoiced: r.totalInvoiced,
             forecast: r.forecast, variance: r.budget === null ? null : r.budget - r.forecast, count: r.invoiceCount,
             current: y === F.budgetYearOf(today, sm) };
  });

  // --- exports ------------------------------------------------------------------------

  /** CSV for Excel: BOM, quoted, formula-injection safe. rows: array of arrays (first = header). */
  F.toCSV = (rows) => "\uFEFF" + rows.map((r) => r.map((v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+@\t\r]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n") + "\r\n";

  const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line) => {                                    // RFC 5545: lines over 75 octets are folded
    const out = [];
    let cur = "";
    for (const ch of line) {
      if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = " " + ch; } else cur += ch;
    }
    out.push(cur);
    return out.join("\r\n");
  };

  /** Calendar file of notice deadlines and term ends for the next 2 years, with reminders. */
  F.contractsICS = (contracts, buildingName, today = F.today(), stamp = new Date()) => {
    const dt = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Facilities Manual Builder//Contracts//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Contract deadlines"];
    for (const d of F.deadlines(contracts, today, 730)) {
      if (d.days < 0) continue;
      const c = d.contract, i = d.info, ymd = d.date.replace(/-/g, "");
      const summary = `${d.kind === "notice" ? "Notice deadline" : d.kind === "renew" ? "Auto-renewal" : "Contract ends"}: ${c.vendor} — ${c.title}`;
      const desc = [
        d.text,
        `Building: ${buildingName(c.buildingId)}`,
        `Term ends: ${F.fmtDate(i.termEnd)}${i.renews ? " (auto-renews)" : ""}`,
        i.annual ? `Annual cost: ${F.money(i.annual)}` : "",
        c.contract_number ? `Contract no.: ${c.contract_number}` : "",
        c.contact ? `Contact: ${c.contact}` : "",
      ].filter(Boolean).join("\n");
      const lead = d.kind === "notice" ? ["-P14D", "-P2D"] : ["-P30D"];
      lines.push("BEGIN:VEVENT", `UID:${c.id}-${d.kind}-${ymd}@facilities-manual-builder`, `DTSTAMP:${dt}`,
        `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${F.addDays(d.date, 1).replace(/-/g, "")}`,
        `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(desc)}`, "TRANSP:TRANSPARENT");
      for (const t of lead) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(summary)}`, `TRIGGER:${t}`, "END:VALARM");
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  };
})(window.FMB);
