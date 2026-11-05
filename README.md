# Facilities Manual Builder

A wizard that collects building data and exports an editable Word (.docx) facilities manual. It runs entirely in the browser, with no install, no server and no build step.

## Put it on GitHub Pages (no git needed)

1. On github.com, create a new **public** repository, e.g. `facilities-manual-builder`.
2. On the empty repo page, click **uploading an existing file**. Drag in the **contents** of this folder (`index.html`, `css`, `js`, `vendor`, `README.md`), not the folder itself. Commit.
3. **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch *main*, folder */ (root)*. Save.
4. After a minute or two the app is live at `https://<your-username>.github.io/facilities-manual-builder/`. Bookmark it on your work PC.

Only the code goes in the repo. Building data never leaves the browser it was entered in.

**No GitHub access at work?** Unzip this folder anywhere (desktop, network drive) and open `index.html` in Edge or Chrome. It works the same way.

## Where your data lives

- Data is saved in **this browser on this PC**: records in local storage, photos and the logo in the browser's database (IndexedDB). Another browser, another PC, or an InPrivate/Incognito window will not see it.
- **Export backup** (top right) downloads a `.json` file of every building, contract, invoice, vendor, budget, setting **and photo**. With many photos the file can be tens of MB. Keep it on OneDrive or a network drive. The top bar shows an orange dot when there are changes since your last backup.
- **Import** loads a backup into any browser. It only adds data: new buildings are added, and an existing building is replaced only if the file's copy is newer. Nothing gets deleted.
- Clearing browser data ("cookies and site data") erases the local copy. Your backup file is the safety net.

## Using it

- **Save draft / Next / Back** save the step. Clicking any other step in the left rail also saves first.
- Missing required items (`*`) never block saving; they keep the section marked incomplete. Bad numbers, duplicate equipment tags, or a row with no tag do block saving.
- **Duplicate** copies a building, clears its address, doc number and serials, and marks every section for review.
- **Word** (home) / **Download manual** (Review step) builds the .docx. Unfinished sections are labeled in the manual and on its cover.
- **Wizard sections built:** Building profile, Contacts & vendors, Utilities & shutoffs, Life safety, Mechanical — HVAC. Electrical, Plumbing and PM schedule show as "soon".
- **Photos** (card on every step): *+ Add photos* from files, or *Take photo* with the camera on a phone or tablet. Give each a caption and pick what it shows (e.g. RTU-1). Photos are shrunk to about 1600 px before saving, and printed two per row in **Appendix A — Photos** of the manual.
- **CSV** on every wizard table: *Export CSV* downloads the table (it doubles as a template); *Import CSV* adds or updates rows from a spreadsheet through the same review screen as Fill from document. Columns are matched by heading; unknown columns are ignored; rows are matched by their tag/ID.
- **Settings** (top right): company name, logo, accent color, "Prepared by" and footer text for the manual, plus the budget-year start month.

## Vendors

The **Vendors** tab is one directory shared by everything: the wizard's vendor pickers (Contacts & vendors, utility providers, HVAC service contractor, fire alarm monitoring and inspection), contracts, invoices and costs.
- Each vendor has a trade, contact, phone, **after-hours phone**, email, account no., address, notes and **insurance certificate (COI) expiry**. Expired or soon-expiring COIs are flagged.
- The manual prints vendor names with their phone numbers, so updating a phone in the directory updates every manual.
- Typing a vendor on a contract or invoice suggests directory names. Spelling variants ("ACME MECHANICAL LLC") match the existing vendor, and a genuinely new name is added to the directory when you save.
- Renaming a vendor updates its contracts and invoices. **Merge duplicate** moves everything from one vendor to another. A vendor in use can't be deleted, only merged.
- Each vendor page shows spend by budget year, its contracts, and every building manual it appears in.

## Fill from a document (with your work AI)

The **Fill from document…** button on each step works with any AI chat your company allows (Microsoft Copilot, ChatGPT, Gemini). The app doesn't connect to the AI itself; you carry the text across:

1. **Copy prompt.** The prompt is generated from `js/steps.js`, so it always matches the current fields. Choose *All sections* or *This section only*.
2. In your AI, **attach the document** (equipment list, O&M manual, survey, old facilities manual) or paste its text, then paste the prompt and send.
3. **Paste the AI's whole reply** back into the app and click **Preview changes**.
4. **Review and apply.** Every value is shown next to what's entered now:
   - New values start ticked. Anything that would **replace** a value you already entered starts unticked.
   - Blank or "N/A" values never erase anything.
   - Loose answers are matched to the allowed choices ("BMS" becomes "Building automation system (BMS)", "yearly" becomes "Annual", "42,000 sq ft" becomes 42000). Anything that can't be matched is shown in red and skipped.
   - Equipment is matched by tag. A known tag becomes an UPDATE and a new tag is added. A unit with no tag is added as `NEW-1`, `NEW-2`… for you to rename.
   - Anything the AI said it was unsure about is listed at the top.

The AI will make mistakes, so check the preview against the document. The document goes to your AI, not to this app, so use only an AI your company has approved for these documents.

## Contracts, invoices and costs

Use the tabs at the top: **Buildings · Contracts · Invoices · Costs**. Each contract or invoice belongs to a building, or to *Company-wide / unassigned*.

**Contracts** track vendor, term, auto-renewal, notice period, cost and billing frequency, service visits, annual escalation, and the equipment covered. From these the app works out:
- the current term end (auto-renewals rolled forward), the **notice deadline**, and status (*Notice due*, *Renewing soon*, *Expiring*, *Expired*…)
- annual cost (e.g. $1,200 billed quarterly = $4,800/yr, plus the escalation % each contract year) and the next service visit
- **Upcoming deadlines** on the Contracts page and the Buildings page. **Add reminders to calendar (.ics)** downloads a file you open in Outlook; it adds each deadline with alerts 14 and 2 days before (30 days before for term ends). Download it again after you change contracts.

**Invoices** record vendor, number, date, work type, and line items. Assign each line to a piece of equipment to track cost per asset. An invoice can be linked to a contract. Same vendor + invoice number is flagged as a possible duplicate.

**Import from document…** (on both pages) uses the same copy-prompt → your AI → paste-reply steps as Fill from document. Several invoices can go in one reply. The app matches the building from the service address, the vendor to its existing spelling, equipment tags ("RTU 1" → RTU-1), and invoices to their contract by contract number. Anything already saved is unticked. Imported records are marked **CHECK** until you open one, compare it with the document, and Save.

**Costs** shows, for one budget year: the budget (set per building), invoiced to date (with % of budget and change vs the same point last year), forecast (invoiced so far + contracted cost for the rest of the year) against budget, and contracted cost. Below that: a month-by-month chart, vendors this year vs last, spend by work type, spend per piece of equipment (3+ repair invoices are flagged as repair-or-replace candidates), and a **Budget years** table comparing every year side by side.

**Budget years.** Set *Budget year starts* on the Costs page (default January = calendar year). A budget year is named by the year it ends: with July, FY2027 = Jul 2026 – Jun 2027. Every invoice counts in the budget year of its invoice date. Contracted costs are spread month by month, so a contract that spans two budget years is split between them. Budgets are stored per budget year and building. If you change the start month, check your budgets, because each one now covers the new 12-month window.

**Export CSV** on either page gives Excel-ready files. In the invoice export each row is a line item, tax or remainder, so the Amount column always adds up to the invoice totals (good for pivot tables).

## Files

```
index.html          page shell
js/steps.js         THE WIZARD DEFINITION: steps, fields, equipment columns, manual subsections
js/logic.js         validation, completeness, navigation
js/store.js         local storage, backup export/import
js/vendors.js       vendor directory: lookup, linking, rename, merge, COI status
js/files.js         photos and logo in IndexedDB, image resizing
js/manual.js        Word document generator
js/importer.js      Fill from document: prompt, reply parsing, review plan, apply
js/finance.js       contract/invoice fields, term & renewal math, budget years, cost report, CSV, calendar file
js/docimport.js     contract & invoice import: prompts, parsing, building/vendor/equipment/contract matching
js/finance-ui.js    Contracts, Invoices and Costs screens
js/app.js           screens and buttons
css/style.css
vendor/docx.iife.js docx 9.14.0 (MIT; see vendor/docx-LICENSE.txt), loaded only when generating a manual
```

## Adding a section

Edit only `js/steps.js`. Give the step `fields`, optionally `tables` (repeating rows) and `manual` parts, then delete `enabled: false`. The page, validation, review status, Fill from document, CSV, photos and Word chapter all follow from that. Existing saved data keeps working. The comment at the top of `steps.js` lists every option (vendor pickers, `assets: true` for equipment tables, inspection schedules, etc.); Utilities and Life safety are good examples to copy.

Example: Electrical would get `tables: [{ system: "electrical", title: "Panel schedule", unitNoun: "panel", assets: true, columns: [...] }]` plus a `{ title: "Emergency shutdown", kind: "fields", fields: [...], callout: true }` manual part.

To update the live site, edit the file on github.com (pencil icon) or upload the changed file. Pages republishes in about a minute.

## Next up

1. Electrical step: panel schedule, main disconnect, generator / UPS, transfer switch
2. Plumbing step: water heaters, backflow preventers (with annual test dates), sump and lift pumps
3. PM schedule step: one combined calendar across HVAC, life safety and the others, plus contract service visits
4. COI and inspection due dates in the calendar (.ics) reminders, alongside contract deadlines
