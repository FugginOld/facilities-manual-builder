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

- Data is saved in **this browser's local storage, on this PC**. Another browser, another PC, or an InPrivate/Incognito window will not see it.
- **Export backup** (top right) downloads a `.json` file of every building. Keep it on OneDrive or a network drive. The top bar shows an orange dot when there are changes since your last backup.
- **Import** loads a backup into any browser. It only adds data: new buildings are added, and an existing building is replaced only if the file's copy is newer. Nothing gets deleted.
- Clearing browser data ("cookies and site data") erases the local copy. Your backup file is the safety net.

## Using it

- **Save draft / Next / Back** save the step. Clicking any other step in the left rail also saves first.
- Missing required items (`*`) never block saving; they keep the section marked incomplete. Bad numbers, duplicate equipment tags, or a row with no tag do block saving.
- **Duplicate** copies a building, clears its address, doc number and serials, and marks every section for review.
- **Word** (home) / **Download manual** (Review step) builds the .docx. Unfinished sections are labeled in the manual and on its cover.

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

## Files

```
index.html          page shell
js/steps.js         THE WIZARD DEFINITION: steps, fields, equipment columns, manual subsections
js/logic.js         validation, completeness, navigation
js/store.js         local storage, backup export/import
js/manual.js        Word document generator
js/importer.js      Fill from document: prompt, reply parsing, review plan, apply
js/app.js           screens and buttons
css/style.css
vendor/docx.iife.js docx 9.14.0 (MIT; see vendor/docx-LICENSE.txt), loaded only when generating a manual
```

## Adding a section

Edit only `js/steps.js`. Give the step `fields`, optionally a `table` (repeating rows) and `manual` parts, then delete `enabled: false`. The page, validation, review status and Word chapter all follow from that. Existing saved data keeps working.

Example: Electrical would get `table: { system: "electrical", title: "Panel schedule", unitNoun: "panel", columns: [...] }` plus a `{ title: "Emergency shutdown", kind: "fields", fields: [...], callout: true }` manual part.

To update the live site, edit the file on github.com (pencil icon) or upload the changed file. Pages republishes in about a minute.

## Next up

1. Contacts & vendors, then turn "Service contractor" into a picker
2. Utilities & shutoffs and Life safety
3. Photo attachments (nameplates, shutoff locations) in a manual appendix
4. CSV import/export for equipment tables
5. Company logo and styles on the cover
