# Facilities Manual Builder: Company Copilot AI Integration Plan

## Purpose

This document provides a comprehensive implementation plan for integrating the company's approved Microsoft Copilot or Microsoft AI capability into the Facilities Manual Builder.

The application is hosted on a department server. Facilities records, uploaded documents, generated manuals, photos, invoices, contracts, and other retained files should remain on the department server unless company IT, security, privacy, and records-management teams approve another storage location.

This plan is written so it can be imported into a future AI session as project context.

---

## 1. Project Objectives

The integration should:

1. Replace the current copy-and-paste AI workflow with a secure in-application process.
2. Use the company's approved Microsoft Copilot, Copilot Studio, Azure AI, Azure OpenAI, or related enterprise AI service.
3. Keep API credentials, access tokens, and service configuration out of browser code.
4. Keep retained Facilities data and files on the department server.
5. Send only the minimum required content to the approved AI service for processing.
6. Return structured data that the application can validate, preview, and apply.
7. Require user review before AI-extracted values replace existing records.
8. Maintain an audit trail of AI requests, results, approvals, failures, and changes.
9. Preserve the existing Word manual, contract, invoice, cost, vendor, equipment, and file-management capabilities.
10. Create a foundation for future Facilities-specific AI assistance.

---

## 2. Current Application Structure

```text
index.html          page shell
js/steps.js         wizard definition: steps, fields, equipment columns, manual subsections
js/logic.js         validation, completeness, navigation
js/store.js         local storage, backup export/import
js/vendors.js       vendor directory: lookup, linking, rename, merge, COI status
js/files.js         photos and logo in IndexedDB, image resizing
js/manual.js        Word document generator
js/importer.js      facility document prompt, reply parsing, review plan, apply
js/finance.js       contracts, invoices, renewal math, budget years, reports, CSV, calendar
js/docimport.js     contract and invoice prompts, parsing, and entity matching
js/finance-ui.js    Contracts, Invoices, and Costs screens
js/app.js           screens, application state, and buttons
css/style.css       application styling
vendor/docx.iife.js client-side Word document generation library
```

### Current AI-assisted workflow

```text
User selects Fill from document
        ↓
Application generates a prompt
        ↓
User copies prompt into company AI
        ↓
User attaches or pastes the source document
        ↓
AI produces a response
        ↓
User copies the response into the application
        ↓
Application parses and previews proposed changes
        ↓
User approves selected changes
```

The existing review-and-apply process is valuable and should be retained. The main change is replacing manual transfer with a secure API-mediated request.

---

## 3. Important Terminology and Decision Point

"Company Copilot" may refer to different Microsoft products. The exact integration method depends on what the company has licensed and approved.

Possible services include:

- Microsoft 365 Copilot
- Microsoft Copilot Studio
- An agent created in Copilot Studio
- Azure OpenAI Service
- Azure AI Foundry models or agents
- Microsoft Graph-connected services
- A company-built internal AI gateway

Do not assume that the interactive Microsoft 365 Copilot chat used by employees exposes a general-purpose API that this application can call. Company IT must identify the approved programmatic endpoint, authentication approach, licensing model, data-handling terms, and supported use cases.

### Required question for company IT

> Which approved Microsoft AI service or internal AI gateway can a department-hosted web application call programmatically to analyze Facilities documents and return structured JSON?

The answer to that question determines the final backend implementation.

---

## 4. Recommended Architecture

```text
Employee Browser
        │
        │ HTTPS with company authentication
        ▼
Facilities Manual Builder
Hosted on Department Server
        │
        │ Same-origin HTTPS request
        ▼
Department AI API
Server-side component
        │
        ├── authenticates the user
        ├── verifies authorization
        ├── validates file type and size
        ├── removes unnecessary content
        ├── creates the AI request
        ├── retrieves credentials securely
        ├── calls the approved company AI service
        ├── validates the AI response
        ├── records an audit event
        └── returns structured JSON
        │
        ▼
Approved Microsoft or Company AI Endpoint
        │
        ▼
Structured JSON Result
        │
        ▼
Existing Preview and Apply Workflow
        │
        ▼
Department Server Data and File Storage
```

### Core principle

The browser must never contain AI service secrets, permanent access tokens, client secrets, or subscription keys. All AI calls must pass through a trusted server-side API.

---

## 5. Department Server Requirements

The current application can run as static files. Direct AI integration requires a server-side component in addition to the static site.

The department server will need one supported runtime, such as:

- ASP.NET Core Web API
- Node.js with Express
- Python with FastAPI or Flask
- An approved internal application platform

ASP.NET Core may be the best fit if the organization primarily uses Microsoft identity, Windows Server, IIS, and Microsoft development tooling. The final choice should follow company IT standards.

### Suggested server folders

```text
FacilitiesManualBuilder/
├── public/
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── vendor/
├── server/
│   ├── api/
│   ├── ai/
│   ├── authentication/
│   ├── validation/
│   ├── logging/
│   └── storage/
├── data/
│   ├── buildings/
│   ├── contracts/
│   ├── invoices/
│   ├── vendors/
│   ├── equipment/
│   └── settings/
├── files/
│   ├── source-documents/
│   ├── photos/
│   ├── logos/
│   ├── generated-manuals/
│   └── exports/
├── audit/
└── configuration/
```

Folders containing data, files, audit records, and configuration must not be directly browsable through the web server.

---

## 6. Data Storage Strategy

### Current state

The application currently relies heavily on browser local storage and IndexedDB. This is convenient for a single user but creates limitations:

- Data is tied to a particular browser and computer.
- Clearing browser data can remove the working copy.
- Multi-user collaboration is difficult.
- Central backup and recovery are limited.
- Server-side authorization and auditing are not available.

### Recommended target state

Move persistent business data to the department server while optionally retaining browser storage as a temporary cache.

Possible storage approaches:

1. **Relational database**
   - Best for buildings, equipment, contracts, invoices, vendors, budgets, and relationships.
   - Examples include a company-approved SQL Server instance or another approved database.

2. **Department server file storage**
   - Best for source documents, photos, logos, exports, and generated manuals.

3. **Hybrid approach**
   - Store structured records in a database.
   - Store binary files on the department server.
   - Store the server file identifier and metadata in the database.

### Storage rules

- Generate unique server-side file identifiers.
- Do not rely on the original filename as the storage key.
- Preserve the original filename as metadata.
- Record the uploader, upload date, file size, MIME type, checksum, and related building or record.
- Define retention and deletion rules with Records Management.
- Include server data and files in departmental backup and recovery processes.
- Encrypt storage where required by company policy.

---

## 7. Application Files to Add or Modify

### 7.1 Add `js/ai.js`

Create a dedicated browser-side AI service module. It should only communicate with the department API, not directly with Microsoft AI services.

Responsibilities:

- Submit a selected document or extracted text.
- Identify the requested operation and application section.
- Display progress and cancellation controls.
- Handle authentication and authorization errors.
- Handle service limits, timeouts, and malformed responses.
- Return normalized result objects to `importer.js` or `docimport.js`.

Conceptual interface:

```javascript
window.FacilitiesAI = {
  analyzeFacilityDocument(file, sectionId) {},
  analyzeContractDocument(file) {},
  analyzeInvoiceDocument(file) {},
  analyzeInvoiceBatch(files) {},
  cancelRequest(requestId) {}
};
```

The browser function should call a same-origin endpoint such as:

```text
POST /api/ai/facility-document
POST /api/ai/contract
POST /api/ai/invoice
POST /api/ai/invoice-batch
```

### 7.2 Modify `index.html`

Load `js/ai.js` before modules that use it.

Conceptual order:

```html
<script src="js/steps.js"></script>
<script src="js/logic.js"></script>
<script src="js/store.js"></script>
<script src="js/vendors.js"></script>
<script src="js/files.js"></script>
<script src="js/manual.js"></script>
<script src="js/ai.js"></script>
<script src="js/importer.js"></script>
<script src="js/finance.js"></script>
<script src="js/docimport.js"></script>
<script src="js/finance-ui.js"></script>
<script src="js/app.js"></script>
```

### 7.3 Modify `js/importer.js`

Retain the existing prompt-building, parsing, matching, preview, and apply logic as a fallback during migration.

Add a direct workflow:

1. User selects a source document.
2. User chooses all sections or the current section.
3. Application submits the file and section identifier to the department API.
4. API returns structured extraction results.
5. Existing normalization and validation logic evaluates the response.
6. Existing preview screen compares current and proposed values.
7. Replacement values remain unchecked by default.
8. User manually approves selected changes.
9. Application saves approved changes.

Keep the current copy-and-paste process available until direct integration is validated and formally approved.

### 7.4 Modify `js/docimport.js`

Add direct endpoints for:

- Contract extraction
- Single-invoice extraction
- Multi-invoice extraction

Continue using existing matching logic for:

- Building by service address
- Existing vendor spelling
- Equipment tag normalization
- Contract number matching
- Duplicate invoice detection

AI should propose extracted values. Deterministic application code should continue to perform entity matching and duplicate detection whenever possible.

### 7.5 Modify `js/files.js`

Add support for uploading source documents to the department API.

Required controls:

- Approved file extension list
- MIME-type verification
- File-size limits
- Malware scanning integration if available
- Image resizing rules
- Metadata capture
- Temporary upload cleanup
- Permanent retention only when required

Do not automatically store every document submitted for AI analysis. Provide a retention choice or apply a documented retention rule.

### 7.6 Modify `js/store.js`

Create a storage abstraction so code can move from browser-only storage to server storage without rewriting every screen.

Conceptual interface:

```javascript
const DataStore = {
  async getBuildings() {},
  async getBuilding(id) {},
  async saveBuilding(record) {},
  async saveContract(record) {},
  async saveInvoice(record) {},
  async saveVendor(record) {},
  async exportBackup() {},
  async importBackup(file) {}
};
```

During migration, `DataStore` can route to local storage or the department API through a feature flag.

### 7.7 Modify `js/app.js`

Add:

- Signed-in user display
- AI availability indicator
- Permission-sensitive buttons
- Upload and analysis progress
- Error notifications
- Request cancellation
- Link to AI activity history when permitted
- Clear labeling that AI-generated values require review

### 7.8 Reuse `js/steps.js` as the schema source

`js/steps.js` should remain the single source of truth for Facilities fields and allowed values.

Create a function that converts the relevant step definition into a simplified extraction schema. Do not send executable JavaScript or unrelated application configuration to the AI service.

The generated schema should identify:

- Internal field key
- Human-readable label
- Data type
- Required status
- Allowed choices
- Units
- Repeating-table columns
- Validation constraints
- Whether multiple values are permitted

---

## 8. Server API Design

### Example request

```json
{
  "operation": "facility-document-extraction",
  "sectionId": "hvac",
  "buildingId": "BLDG-00125",
  "schemaVersion": "2026-11-05",
  "documentId": "DOC-00912"
}
```

The actual document should be uploaded using a secure multipart request or referenced by a server-side document identifier. Avoid placing large document contents into normal application logs.

### Example response

```json
{
  "requestId": "AI-20261105-000184",
  "status": "completed",
  "schemaVersion": "2026-11-05",
  "values": {
    "systemType": {
      "value": "Building automation system (BMS)",
      "confidence": "high",
      "source": {
        "documentId": "DOC-00912",
        "page": 14,
        "excerpt": "Controls are provided by the building automation system."
      }
    }
  },
  "equipment": [
    {
      "tag": "RTU-1",
      "manufacturer": "Example Manufacturer",
      "model": "Example Model",
      "serial": "Example Serial",
      "confidence": "medium",
      "source": {
        "documentId": "DOC-00912",
        "page": 22
      }
    }
  ],
  "uncertainties": [
    "The installation year was not stated explicitly."
  ],
  "warnings": []
}
```

### Required API behavior

The API must:

- Require an authenticated company user.
- Verify Facilities application permissions.
- Reject unsupported operations.
- Enforce file type and size limits.
- Use a server-side allowlist of fields.
- Avoid accepting arbitrary system prompts from browsers.
- Add server-controlled system instructions.
- Validate responses against a JSON schema.
- Reject unknown or malformed fields.
- Return safe error messages to the browser.
- Log sufficient metadata for auditing without unnecessarily logging document contents.

---

## 9. Prompt and Response Design

### Use structured output

The AI service should return JSON matching a server-controlled schema. Free-form text should not be treated as trusted application data.

The server instruction should require the model to:

- Extract only values supported by the document.
- Never invent missing values.
- Return `null` or omit a value when evidence is missing.
- Preserve source wording when appropriate.
- Identify uncertainty.
- Include page, section, or excerpt evidence when supported.
- Match only allowed enumerations.
- Return no executable code or HTML.

### Treat source documents as untrusted input

Documents can contain instructions that attempt to influence the AI. The server-controlled prompt should state that text inside the source document is data, not instructions.

The application must not allow document text to:

- Change the system instruction.
- Request secrets or credentials.
- Select unauthorized tools.
- Access unrelated server files.
- Write directly to the database.
- Bypass user review.

### Separate extraction from decision-making

AI may extract facts and highlight potential issues. Deterministic code should calculate:

- Contract notice dates
- Renewal periods
- Budget-year assignment
- Annualized cost
- Duplicate invoice rules
- Equipment-tag uniqueness
- Required-field completeness
- Repair count thresholds

This preserves consistency and makes results easier to audit.

---

## 10. Identity, Authentication, and Authorization

### Recommended authentication

Use Microsoft Entra ID or the company's approved identity provider.

Potential access groups:

- Facilities Manual Builder Viewers
- Facilities Manual Builder Editors
- Facilities Manual Builder Approvers
- Facilities Manual Builder Administrators

### Example permission model

| Role | Capabilities |
|---|---|
| Viewer | View approved Facilities records and manuals |
| Editor | Upload documents, request AI extraction, edit records, save drafts |
| Approver | Approve replacements, publish manuals, confirm imported contracts and invoices |
| Administrator | Configure field mappings, limits, retention, and AI service settings |

Service credentials should use a managed identity, certificate, workload identity, or company-approved secret vault. Credentials must not be stored in JavaScript, HTML, source control, ordinary configuration files, or browser storage.

---

## 11. Data Privacy and AI Data Flow

Retaining files on the department server does not necessarily mean that document content never leaves the server. If an external or cloud-hosted AI service analyzes a document, selected content is transmitted to that service for processing.

Before implementation, obtain written answers for:

- Which service receives the content?
- In which tenant, subscription, and geographic region is it processed?
- Is submitted content retained by the service?
- Is submitted content used to train models?
- What diagnostic logging occurs?
- What data classifications are permitted?
- Are contracts, invoices, equipment records, addresses, access information, or life-safety material restricted?
- Are users allowed to upload documents containing personal, financial, security, or confidential information?
- What deletion and incident-response processes apply?

### Data-minimization controls

- Send only the pages or text needed for the selected operation.
- Remove unrelated attachments and hidden metadata.
- Redact prohibited information before transmission when required.
- Avoid sending the complete Facilities database when processing one document.
- Prefer server-side document identifiers rather than file paths.
- Do not expose department server paths to the AI service.

---

## 12. Audit and Operational Logging

Store an audit record for each AI request.

Recommended fields:

```text
Request ID
Date and time
Authenticated user ID
Operation type
Building or record ID
Source document ID
Source document checksum
AI endpoint or deployment identifier
Prompt template version
Schema version
Response status
Processing duration
Fields proposed
Fields accepted by the user
Fields rejected by the user
Error category
```

Avoid logging full documents, full prompts, or full AI responses unless company policy specifically requires it and the log repository has appropriate protection.

Audit records should distinguish between:

- AI proposed a value.
- User accepted a value.
- User edited a value.
- User rejected a value.
- Application calculated a value.

---

## 13. Security Controls

Minimum controls should include:

- HTTPS for all browser and server traffic
- Company user authentication
- Role-based authorization
- Server-side credential protection
- File extension, MIME type, and content validation
- File-size and request-rate limits
- Malware scanning when available
- JSON schema validation
- Output encoding to prevent script injection
- Cross-site request forgery protection when applicable
- Same-origin or restricted CORS configuration
- Server-side allowlists for operations and fields
- Dependency inventory and patching
- Backup and recovery testing
- Central error monitoring
- AI endpoint usage limits and cost controls
- Prompt-injection defenses
- No automatic application of AI results

Do not place sensitive building-security details, alarm codes, keys, credentials, or access-control secrets into prompts unless explicitly approved and technically protected.

---

## 14. User Experience

### Proposed Facility document flow

```text
Fill from document
        ↓
Choose file already on server or upload a new file
        ↓
Choose This section or All sections
        ↓
Analyze with Company AI
        ↓
Progress indicator
        ↓
Preview proposed changes with evidence
        ↓
Select approved values
        ↓
Apply and save
```

### Review screen requirements

Display:

- Current value
- Proposed value
- Confidence or uncertainty
- Source document
- Page or section reference when available
- Whether the change adds or replaces information
- Validation errors
- Matching explanation for vendors, equipment, buildings, and contracts

Continue the existing safety behavior:

- New values may start selected.
- Replacements should start unselected.
- Blank or `N/A` values must not erase existing fields.
- Invalid choices should be skipped and clearly shown.
- Equipment without a reliable tag should receive a temporary identifier for human review.
- Imported invoices and contracts should remain marked for checking until reviewed and saved.

---

## 15. Error Handling and Reliability

The application should handle:

- AI service unavailable
- User not authorized
- Access token expired
- Unsupported file format
- File too large
- Encrypted or unreadable document
- No extractable text
- Model timeout
- Rate limit exceeded
- Invalid JSON response
- Schema version mismatch
- Partial extraction
- Duplicate submission
- Network interruption

Recommended behavior:

- Preserve unsaved user work.
- Provide a request ID for support.
- Allow a safe retry.
- Do not apply partial results automatically.
- Keep the manual copy-and-paste workflow as a temporary fallback.
- Prevent duplicate invoice or contract creation after a retry.

---

## 16. Implementation Phases

### Phase 0: Governance and service selection

Deliverables:

- Identify the exact company AI service.
- Confirm programmatic API availability.
- Confirm licensing and expected cost.
- Approve data classifications and document types.
- Select server runtime and identity method.
- Approve retention, logging, and backup requirements.
- Complete security and architecture review.

### Phase 1: Proof of concept

Scope:

- One document type
- One application section
- Test or non-sensitive documents
- Structured JSON output
- Existing preview and apply screen
- No automatic replacement of data

Suggested first use case:

- Extract HVAC equipment data from an equipment schedule or O&M document.

### Phase 2: Facility manual extraction

Add:

- All-section and current-section extraction
- Source evidence
- Schema generation from `steps.js`
- Central audit records
- Production authentication and authorization

### Phase 3: Contracts and invoices

Add:

- Contract extraction
- Invoice extraction
- Multi-invoice support
- Vendor, building, equipment, and contract matching
- Duplicate controls
- Human confirmation status

### Phase 4: Central server storage

Add:

- Server-side records
- Department file repository
- Multi-user access
- Version history
- Backup and recovery
- Storage abstraction in `store.js`

### Phase 5: Facilities AI assistant

Possible capabilities:

- Search approved Facilities records.
- Answer questions about equipment, contracts, invoices, and manuals.
- Identify upcoming contract notice dates.
- Summarize repair history.
- Draft budget narratives.
- Locate source evidence.

Any recommendation involving employee performance or consequential decisions should remain outside the assistant or receive separate governance review.

---

## 17. Testing Plan

### Functional testing

Test:

- Every supported file type
- Every wizard field type
- Allowed-choice normalization
- Numbers and units
- Dates
- Empty values
- Repeating equipment rows
- Existing tag updates
- New temporary tags
- Vendor spelling matches
- Building service-address matches
- Contract number matches
- Duplicate invoice detection
- Replacement-selection behavior

### Security testing

Test:

- Unauthenticated access
- Unauthorized roles
- Oversized files
- Incorrect MIME types
- Malicious filenames
- Prompt injection inside documents
- HTML and script content in model output
- Attempts to access unrelated files
- Attempts to manipulate server prompts
- Excessive request rates
- Direct access to stored files
- Secrets accidentally included in browser bundles

### AI quality testing

Build a test set of approved sample documents with known expected answers.

Measure:

- Field accuracy
- Unsupported-value rate
- Missing-value rate
- False replacement rate
- Equipment-tag match accuracy
- Vendor match accuracy
- Contract match accuracy
- Invoice total reconciliation
- Human acceptance and correction rates

A production launch should require agreed acceptance thresholds and documented handling for fields that do not meet them.

---

## 18. Deployment and Change Management

Recommended deployment practices:

- Separate development, test, and production environments.
- Use version control for application and server code.
- Do not store real credentials in the repository.
- Use automated or documented deployment procedures.
- Version prompt templates and JSON schemas.
- Maintain release notes.
- Provide a rollback method.
- Train Facilities users on reviewing AI results.
- Provide support instructions and escalation contacts.

Feature flags can enable controlled rollout:

```text
AI integration enabled
Direct facility extraction enabled
Contract extraction enabled
Invoice extraction enabled
Server storage enabled
Manual copy/paste fallback enabled
```

---

## 19. Questions for IT, Security, and Microsoft Administrators

1. What does the company mean by "company Copilot" for programmatic integration?
2. Is there an approved API, Copilot Studio agent, Azure AI deployment, or internal AI gateway?
3. Which authentication flow is required?
4. Can the department server use a managed identity, certificate, or service principal?
5. Which AI models and document-processing capabilities are approved?
6. Can the service return schema-constrained JSON?
7. What file types and maximum sizes are supported?
8. Can the service process images and scanned PDFs?
9. Where is content processed and retained?
10. Is customer content used to train models?
11. What data classifications are allowed?
12. Are source documents or prompts recorded by the service?
13. Is malware scanning available for uploaded files?
14. What logging is required?
15. What retention and deletion rules apply?
16. What network routes, proxy settings, firewall rules, or private endpoints are required?
17. What usage quotas and cost controls apply?
18. Is a security, privacy, legal, or records-management review required?
19. Can the application use Microsoft Entra ID groups for authorization?
20. Who will own the AI service, credentials, monitoring, and incident response?

---

## 20. Initial Development Backlog

### Architecture and governance

- [ ] Identify approved company AI endpoint.
- [ ] Select backend runtime.
- [ ] Define supported document classifications.
- [ ] Approve data flow and retention.
- [ ] Define identity and authorization groups.

### Backend

- [ ] Create department AI API.
- [ ] Implement authenticated endpoints.
- [ ] Add secure credential retrieval.
- [ ] Add file validation and temporary storage.
- [ ] Add AI request adapter.
- [ ] Add JSON schema validation.
- [ ] Add audit logging.
- [ ] Add request limits and safe error handling.

### Frontend

- [ ] Add `js/ai.js`.
- [ ] Load the module from `index.html`.
- [ ] Add direct analysis to `js/importer.js`.
- [ ] Add contract and invoice analysis to `js/docimport.js`.
- [ ] Add upload controls to `js/files.js`.
- [ ] Add progress, cancellation, and errors to `js/app.js`.
- [ ] Preserve manual copy-and-paste fallback.

### Data

- [ ] Define server database schema.
- [ ] Define file repository structure.
- [ ] Add record and file versioning.
- [ ] Add backup and recovery.
- [ ] Create migration plan from local storage and IndexedDB.

### Quality

- [ ] Assemble an approved test-document set.
- [ ] Define extraction accuracy thresholds.
- [ ] Test prompt injection and malicious files.
- [ ] Test accessibility and browser compatibility.
- [ ] Run user acceptance testing with Facilities staff.

---

## 21. Final Recommendation

Use the following target architecture:

```text
Facilities Manual Builder
Department-hosted browser application
        ↓
Authenticated Department AI API
        ↓
Company-approved Microsoft AI service
        ↓
Schema-validated JSON
        ↓
Human review and approval
        ↓
Department server database and file storage
```

The first implementation should focus on structured document extraction, not a general-purpose chatbot. It should reuse `js/steps.js` as the field-definition source and preserve the existing preview-and-apply safeguards in `js/importer.js` and `js/docimport.js`.

The most important preliminary task is to identify the exact company-approved AI service and its supported API. After that decision, the department can implement a small server-side adapter without placing secrets in the browser or redesigning the entire application.

---

## 22. Context for a Future AI Session

When using this document in another AI session, provide the following instruction:

> Act as a senior Microsoft enterprise application architect and secure web application developer. Use this integration plan as project context. Do not assume that Microsoft 365 Copilot chat exposes a general-purpose API. Ask for or inspect the company's approved AI endpoint, authentication requirements, server runtime, and the actual application source files before generating production code. Keep AI credentials server-side, require schema-validated JSON, retain human review, and store persistent Facilities records and files on the department server.
