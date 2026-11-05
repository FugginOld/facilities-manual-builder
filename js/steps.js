/* Wizard definition. Each step is one wizard page and one manual section.
 *
 * To build out a section: give its step `fields`, optionally a `table`
 * (repeating rows) and `manual` parts, then remove `enabled: false`.
 * The page, validation, review status and Word chapter all come from here.
 *
 * Field kinds:  text | number | select | textarea | lines (one item per line)
 *               vendor (picker from the shared vendor directory; stores the vendor id)
 * Column kinds: text | select | vendor
 * Tables:       `tables: [...]` (or a single `table`). Each row's identity is its `key`
 *               column (default: the first column); `unique: false` allows repeats.
 *               `assets: true` marks equipment tables (invoices and contracts can
 *               reference their rows). `importKey` names the table in AI prompts.
 * Manual parts: fields | table (part.table = system; default the first) | pm
 *               (pm needs a pm_interval column; part.task = task text, part.by = the
 *               vendor field that does the work, default "service_vendor")
 */
window.FMB = window.FMB || {};

FMB.PM_INTERVALS = ["Monthly", "Quarterly", "Semi-annual", "Annual"];
FMB.TRADES = ["HVAC", "Fire & life safety", "Elevator", "Electrical / generator", "Plumbing / backflow",
  "Roofing", "Janitorial", "Landscaping", "Pest control", "Waste / recycling", "Security / access", "Utility", "Other"];
FMB.CONTACT_ROLES = ["Facilities manager", "Building owner / landlord", "Property manager", "Security",
  "EHS / safety", "IT", "Maintenance technician", "Emergency contact", "Utility company", "Other"];
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

  {
    key: "contacts",
    title: "Contacts & vendors",
    intro: "Who to call for this building. Vendors are picked from the shared vendor directory (Vendors tab), " +
           "so their phone numbers stay current in every manual.",
    fields: [
      { name: "emergency_number", label: "Emergency numbers to post", wide: true,
        placeholder: "911 · Site security (813) 555-0199", help: "Printed in a box at the top of this section." },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    tables: [
      {
        system: "contacts", importKey: "contacts", title: "Building contacts", unitNoun: "contact",
        minRows: 1, key: "name", unique: false,
        columns: [
          { name: "role", label: "Role", kind: "select", options: FMB.CONTACT_ROLES, w: 1.4 },
          { name: "name", label: "Name", w: 1.4 },
          { name: "phone", label: "Phone", mono: true, w: 1.2 },
          { name: "after_hours", label: "After-hours phone", mono: true, w: 1.2 },
          { name: "email", label: "Email", w: 1.6 },
        ],
      },
      {
        system: "vendors", importKey: "vendors", title: "Service vendors", unitNoun: "vendor", key: "vendor",
        columns: [
          { name: "trade", label: "Trade", kind: "select", options: FMB.TRADES, w: 1.2 },
          { name: "vendor", label: "Vendor", kind: "vendor", w: 2 },
          { name: "account_number", label: "Account / customer no.", mono: true, w: 1.2 },
          { name: "notes", label: "Notes", w: 1.6 },
        ],
      },
    ],
    manual: [
      { title: "Emergency numbers", kind: "fields", fields: ["emergency_number"], callout: true },
      { title: "Building contacts", kind: "table", table: "contacts" },
      { title: "Service vendors", kind: "table", table: "vendors" },
      { title: "Notes", kind: "fields", fields: ["notes"] },
    ],
  },
  {
    key: "utilities",
    title: "Utilities & shutoffs",
    intro: "Every utility service, who provides it, and exactly where and how to shut it off. " +
           "This is the page people need in an emergency, so be specific about locations.",
    fields: [
      { name: "shutoff_tools", label: "Shutoff tools / keys kept at", wide: true, required: true,
        placeholder: "Red cabinet in Rm 104: gas valve wrench, curb-stop key, panel keys" },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    tables: [{
      system: "utilities", importKey: "utilities", title: "Utility services", unitNoun: "service",
      minRows: 1, key: "service", unique: false,
      columns: [
        { name: "service", label: "Service", kind: "select", w: 1.2,
          options: ["Electric", "Natural gas", "Domestic water", "Fire water / sprinkler supply", "Sewer", "Storm",
                    "Telecom / internet", "Propane", "Other"] },
        { name: "provider", label: "Provider", kind: "vendor", w: 1.5 },
        { name: "account_number", label: "Account no.", mono: true, w: 1.1 },
        { name: "meter", label: "Meter no.", mono: true, w: 1 },
        { name: "shutoff_location", label: "Shutoff location", warnBlank: true, w: 1.8 },
        { name: "shutoff_method", label: "How to shut off", w: 1.8 },
      ],
    }],
    manual: [
      { title: "Shutoff tools", kind: "fields", fields: ["shutoff_tools"], callout: true },
      { title: "Utility services and shutoffs", kind: "table", table: "utilities" },
      { title: "Notes", kind: "fields", fields: ["notes"] },
    ],
  },

  {
    key: "life_safety",
    title: "Life safety",
    intro: "Fire alarm, sprinklers, emergency access and safety equipment. Equipment listed here can be " +
           "assigned to invoices and covered by contracts, like HVAC units.",
    fields: [
      { name: "fire_alarm_panel", label: "Fire alarm control panel location", required: true, wide: true,
        placeholder: "Main lobby, east wall" },
      { name: "monitoring_company", label: "Alarm monitoring company", kind: "vendor", trade: "Fire & life safety" },
      { name: "monitoring_account", label: "Monitoring account / passcode hint", help: "Don't store the passcode itself." },
      { name: "sprinkler_type", label: "Sprinkler system", kind: "select",
        options: ["Wet pipe", "Dry pipe", "Pre-action", "Deluge", "Combination", "None"] },
      { name: "sprinkler_riser", label: "Sprinkler riser / main control valve location", wide: true },
      { name: "fdc_location", label: "Fire department connection (FDC) location" },
      { name: "knox_box", label: "Knox box location" },
      { name: "assembly_point", label: "Evacuation assembly point", required: true, wide: true,
        placeholder: "North parking lot, light pole 12" },
      { name: "inspection_vendor", label: "Fire protection inspection company", kind: "vendor", trade: "Fire & life safety" },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    tables: [{
      system: "life_safety", importKey: "safety_equipment", title: "Safety equipment", unitNoun: "item", assets: true,
      columns: [
        { name: "tag", label: "ID / tag", mono: true, w: 0.9 },
        { name: "type", label: "Type", kind: "select", w: 1.4,
          options: ["Fire extinguisher", "AED", "First aid kit", "Eyewash station", "Emergency shower", "Spill kit",
                    "Emergency lighting", "Exit sign", "Fire blanket", "Pull station", "Other"] },
        { name: "location", label: "Location", warnBlank: true, w: 1.8 },
        { name: "size_class", label: "Size / class", w: 1, placeholder: "10 lb ABC" },
        { name: "pm_interval", label: "Inspection", kind: "select", options: FMB.PM_INTERVALS, warnBlank: true, w: 1.1 },
      ],
    }],
    manual: [
      { title: "Emergency access", kind: "fields", callout: true,
        fields: ["fire_alarm_panel", "sprinkler_riser", "fdc_location", "knox_box", "assembly_point"] },
      { title: "Fire alarm and sprinklers", kind: "fields",
        fields: ["monitoring_company", "monitoring_account", "sprinkler_type", "inspection_vendor"] },
      { title: "Safety equipment", kind: "table", table: "life_safety" },
      { title: "Inspection schedule", kind: "pm", table: "life_safety", by: "inspection_vendor",
        task: "Inspect per NFPA / manufacturer: monthly visual checks, annual service" },
      { title: "Notes", kind: "fields", fields: ["notes"] },
    ],
  },

  {
    key: "hvac",
    title: "Mechanical — HVAC",
    intro: "List every unit serving this building. Each row becomes a line in the equipment " +
           "schedule, and its PM interval feeds the maintenance table.",
    fields: [
      { name: "controls", label: "Controls", kind: "select",
        options: ["Programmable thermostats", "Building automation system (BMS)", "Manual only"] },
      { name: "service_vendor", label: "Service contractor", kind: "vendor", trade: "HVAC",
        help: "From the vendor directory. Add vendors on the Vendors tab." },
      { name: "shutdown_location", label: "Emergency shutdown location", required: true, wide: true,
        placeholder: "Rooftop disconnects; panel H1 in Rm 104" },
      { name: "shutdown_steps", label: "Shutdown procedure", kind: "lines", required: true,
        help: "One step per line. Numbered automatically in the manual." },
      { name: "notes", label: "Notes for the manual", kind: "textarea" },
    ],
    table: {
      system: "hvac", title: "Equipment schedule", unitNoun: "unit", minRows: 1, assets: true,
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
