/* Wizard definition. Each step is one wizard page and one manual section.
 *
 * To build out a section: give its step `fields`, optionally a `table`
 * (repeating rows) and `manual` parts, then remove `enabled: false`.
 * The page, validation, review status and Word chapter all come from here.
 *
 * Field kinds:  text | number | select | textarea | lines (one item per line)
 * Column kinds: text | select      (the first column is the row's unique tag)
 * Manual parts: fields | table | pm  (pm needs a pm_interval column)
 */
window.FMB = window.FMB || {};

FMB.PM_INTERVALS = ["Monthly", "Quarterly", "Semi-annual", "Annual"];
FMB.PM_TASK = "Routine PM per manufacturer: filters, belts, drains, coils";

FMB.STEPS = [
  {
    key: "profile",
    title: "Building profile",
    intro: "Basic facts about the building. These go on the cover page and into Section 1.",
    fields: [
      { name: "name", label: "Building name", required: true, placeholder: "Building B" },
      { name: "address", label: "Street address", required: true, wide: true },
      { name: "doc_number", label: "Document number", required: true, placeholder: "FM-B",
        help: "Used in the manual header and the file name." },
      { name: "revision", label: "Revision", required: true, placeholder: "A" },
      { name: "square_feet", label: "Gross square feet", kind: "number" },
      { name: "year_built", label: "Year built", kind: "number" },
      { name: "floors", label: "Floors", kind: "number" },
      { name: "occupancy", label: "Occupancy type", kind: "select",
        options: ["Business (B)", "Factory / Industrial (F)", "Storage (S)", "Mixed use"] },
      { name: "hours", label: "Normal operating hours", placeholder: "Mon–Fri 6:00–17:00" },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    manual: [{ title: "Building data", kind: "fields" }],
  },

  { key: "contacts", title: "Contacts & vendors", enabled: false },
  { key: "utilities", title: "Utilities & shutoffs", enabled: false },
  { key: "life_safety", title: "Life safety", enabled: false },

  {
    key: "hvac",
    title: "Mechanical — HVAC",
    intro: "List every unit serving this building. Each row becomes a line in the equipment " +
           "schedule, and its PM interval feeds the maintenance table.",
    fields: [
      { name: "controls", label: "Controls", kind: "select",
        options: ["Programmable thermostats", "Building automation system (BMS)", "Manual only"] },
      { name: "service_vendor", label: "Service contractor", placeholder: "Company — phone",
        help: "Becomes a picker once Contacts & vendors is built." },
      { name: "shutdown_location", label: "Emergency shutdown location", required: true, wide: true,
        placeholder: "Rooftop disconnects; panel H1 in Rm 104" },
      { name: "shutdown_steps", label: "Shutdown procedure", kind: "lines", required: true,
        help: "One step per line. Numbered automatically in the manual." },
      { name: "notes", label: "Notes for the manual", kind: "textarea" },
    ],
    table: {
      system: "hvac", title: "Equipment schedule", unitNoun: "unit", minRows: 1,
      columns: [
        { name: "tag", label: "Tag", mono: true, w: 1 },
        { name: "type", label: "Type", kind: "select", w: 1.4,
          options: ["Rooftop package", "Split system", "Mini-split", "Exhaust fan", "Make-up air", "Other"] },
        { name: "make_model", label: "Make / Model", warnBlank: true, w: 1.6 },
        { name: "serial", label: "Serial", mono: true, warnBlank: true, w: 1.2 },
        { name: "area_served", label: "Area served", w: 1.4 },
        { name: "filter_size", label: "Filter", mono: true, w: 1 },
        { name: "pm_interval", label: "PM", kind: "select", options: FMB.PM_INTERVALS, warnBlank: true, w: 1.1 },
      ],
    },
    manual: [
      { title: "Equipment schedule", kind: "table" },
      { title: "Emergency shutdown", kind: "fields", fields: ["shutdown_location", "shutdown_steps"], callout: true },
      { title: "Preventive maintenance", kind: "pm" },
      { title: "General", kind: "fields", fields: ["controls", "service_vendor", "notes"] },
    ],
  },

  { key: "electrical", title: "Electrical", enabled: false },
  { key: "plumbing", title: "Plumbing", enabled: false },
  { key: "pm", title: "PM schedule", enabled: false },

  {
    key: "review",
    title: "Review & generate",
    intro: "Check what's still missing, then download the manual as an editable Word file.",
    special: "review",
  },
];
