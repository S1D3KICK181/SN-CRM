# SN Practice CRM — User Guide

## About this guide

This guide explains how SN & Associates will use the target SN Practice CRM and how that target relates to the application that exists today. The product is a **client relationship and practice-operations system** for an accounting practice. It is not a healthcare revenue-cycle-management system; call it **CRM**, not RCM.

The target product is designed for one firm, SN & Associates. A user never chooses or types a firm ID. Access comes from the signed-in account, role, department, client grants, and assignment involvement.

### Capability labels

| Label                      | Meaning                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current**                | A capability known to exist in the present Lovable/Supabase application. It may still use direct browser-to-Supabase access while migration is in progress. |
| **Core target**            | An approved capability for the server-backed production product. It is not a claim that implementation is complete.                                         |
| **Advanced / conditional** | A later feature, an integration requiring provider access, or a feature that depends on an unresolved business decision.                                    |

The delivery status of a feature is governed by the [Delivery Roadmap](./DELIVERY_ROADMAP.md), not by its appearance in this guide. Provider integrations, statutory filing, compliance certification, AI functions, and production service levels must never be represented as live until they have been implemented, configured, tested, and approved.

## The practice lifecycle

The system follows the work from first contact to completion and collection:

```text
Prospect
  → due diligence and acceptance
  → client
  → engagement
  → obligation
  → assignment and evidence
  → preparation and review
  → filing, signing, or delivery
  → invoice
  → receipt and allocation
  → collection or closure
  → renewal, suspension, or offboarding
```

These are separate records, not labels for the same object. For example, an engagement records what the firm agreed to do, an obligation records what is due for a period, and an assignment records the work performed to fulfil it.

## Sign-in and local demonstration

### Current application

The current application supports email/password sign-in, signup, password reset, role-aware navigation, and browser-local demo behavior. Use an authorised account or the approved demo path supplied with the project. Never put a Supabase service-role key or provider secret into a browser prompt, `.env` value exposed to the client, or demo form.

For the current no-credentials preview:

1. Run `npm install` once if dependencies are not installed.
2. Run `npm run dev` from the repository root.
3. Open the local URL printed by Vite.
4. Choose **Enter local demo**.

With `VITE_USE_LOCAL_DEMO=true` in `.env.local`, seeded CRM data and edits remain in that browser’s local storage and are not sent to Lovable Cloud. Use **Reset demo data** in the top banner to restore the seed. This is a TanStack Start application, so a static-file “Live Server” extension is not the correct preview mechanism.

### Core target local demo

The target local preview consists of the frontend plus a **local demo server adapter**. It uses the same query and operation contract as production, seeded fictional records, captured notification providers, and no live third-party credentials. Exact start and reset commands must be documented alongside that implementation; this guide does not invent commands that do not yet exist.

The demo must:

- remain visibly marked as demo;
- prevent messages, filings, payments, or webhooks from reaching real providers;
- generate deterministic sample data and business codes;
- support a safe reset; and
- preserve the same permissions and workflow rules tested in production adapters.

## Roles and access

Navigation helps users find their work, but it is not the permission boundary. The server rechecks every read and action, and Supabase row-level security remains active.

| Role                           | Typical use                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Founder / Partner              | Firm-wide oversight, acceptance and engagement approval, final sign-off, and sensitive approvals                                |
| Manager / Reviewer             | Plan work, assign staff, review submissions, manage deadlines, and resolve blockers                                             |
| Senior Staff / Staff / Trainee | Prepare assigned work, complete checklists, request evidence, and respond to review comments                                    |
| Accounts & Collections         | Prepare invoices, record and allocate receipts, manage ageing, disputes, and follow-ups                                         |
| Practice Administrator         | Manage staff access, departments, catalogues, templates, and policies without automatic access to every client record           |
| Quality / Risk                 | Perform conflict, independence, acceptance, retention, and quality-control work                                                 |
| Client Contact                 | See only explicitly granted client records, upload requested evidence, and view client-visible deliverables and issued invoices |

Important safeguards:

- a preparer cannot approve their own controlled work;
- access administration does not automatically grant access to client content;
- accounts staff do not receive confidential workpaper access merely because they manage fees;
- client contacts cannot see internal notes, risk assessments, or other clients; and
- sensitive actions may require a fresh second authentication factor.

If an expected action is missing, do not ask another person to share credentials. The record may be in the wrong state, required evidence may be missing, or your role/scope may not permit the action.

## Home dashboard

The first page after sign-in is the dashboard. It is role-aware: every user sees a home view suited to their responsibilities and only data they are permitted to access.

### Leadership dashboard — core target

The leadership view contains the selected modules:

1. **KPI strip** — Due today, Open assignments, Pending review, and Outstanding fees.
2. **Collections Snapshot** — current and ageing buckets, each showing amount and record count.
3. **Top Client Outstanding** — the largest open client balances and oldest due dates.
4. **Billing & Collections** — billed and collected amounts over one consistent period.
5. **All Open Assignments** — a sortable, filterable table showing owner, stage, blocker, internal due date, statutory due date, and next action.
6. **Attention queue** — a compact list of deadline risk, blocked work, missing evidence, promises to pay due, and failed automations.

All dashboard figures share an **as-of time**. Selecting a figure opens the exact filtered records behind it. If the number on the drill-through screen does not reconcile with the card at the same as-of time, report it as a defect rather than manually adjusting records.

### Other role homes — core target

- **Manager:** deadlines at risk, unassigned work, ageing review queue, missing evidence, blockers, and team capacity.
- **Staff:** work due today, returned work, awaiting-client items, upcoming deadlines, and personal tasks.
- **Accounts:** bills to raise, overdue fees, unapplied receipts, promises due, disputes, and reminder failures.
- **Client:** requested evidence, upcoming obligations, approvals, deliverables, issued invoices, and payment status.

### Reading dashboard states

- **Loading** means the current snapshot is still being assembled.
- **No records** is a valid empty result and is different from lack of permission.
- **Partial or stale** means some source or background operation is delayed; check the as-of time and warning before acting.
- **No permission** means the system deliberately withheld that measure.
- **Unavailable** means the request did not complete; use the displayed request ID when contacting support.

## Clients and acceptance

### Current

The application already has Clients and client-detail areas. Continue to use them during migration according to the current permission rules.

### Core target workflow

1. Choose **Create prospect** and enter the entity and authorised-contact information available at this stage.
2. Record registrations, ownership or beneficial-owner information where applicable.
3. Complete the duplicate, conflict, independence, integrity, capability, and risk checks required by firm policy.
4. Attach or reference the supporting evidence.
5. Choose **Submit for acceptance**. The system lists any missing preconditions.
6. An authorised partner or risk user chooses **Accept** or **Reject** and records the reason.
7. Acceptance creates the client through a controlled transition. Do not create a second client record manually.

An unaccepted prospect cannot receive an active engagement. Rejection does not erase the prospect or its evidence. Acceptance and continuance policy should follow the firm’s approved interpretation of ICAI quality requirements; see the official [ICAI SQC 1 material](https://kb.icai.org/pdfs/PDFFile5b43637fb468a3.76721073.pdf).

### Client workspace

The client workspace is the permission-filtered “Client 360” view. It brings together:

- legal entity details, contacts, branches, registrations, and related entities;
- accepted services and engagements;
- obligations, assignments, tasks, and deadlines;
- document requests, uploads, and client-visible deliverables;
- communications and reminders;
- invoices, receipts, allocations, disputes, and collection follow-ups; and
- risks or quality information only where the current user is allowed to see it.

Use **Edit profile** for permitted factual corrections. Use the specific engagement, suspension, access, or closure action for lifecycle changes; do not try to simulate them by changing a generic status.

### Suspend or close a client

Suspension or closure requires authority and a reason. The system checks active engagements, open work, unallocated receipts, balances, retention, legal holds, and access grants. Closing a client preserves historical records; it does not delete professional or financial evidence.

## Services, engagements, and obligations

### Services

A service is a reusable catalogue definition, such as a GST return, payroll, tax audit, or virtual CFO service. Administrators maintain service definitions and approved templates. Changing a catalogue entry must not silently rewrite active engagements or previously generated work.

### Engagements

An engagement records the approved scope, period, responsible partner, fee terms, billing method, and engagement-letter evidence for one client and service.

Core target steps:

1. Create an engagement draft from an accepted client and approved service.
2. Enter scope, exclusions, responsible roles, period, fee and billing terms, and required evidence.
3. Obtain the approvals required by firm policy.
4. Activate the engagement.
5. Use **Amend** for a controlled scope or term change; retain the prior version.
6. Use **End engagement** for completion or termination; do not delete it.

Supported fee arrangements in the target model are fixed, recurring, milestone-based, and time-based. Time-based profitability reporting remains meaningful only if the firm decides to capture reliable time, budgets, and cost rates.

### Obligations and deadlines

An obligation is a one-time or recurring requirement for a client, registration, jurisdiction, and period. It is generated from a versioned rule that includes the source and effective dates.

- The **statutory due date** comes from the applicable rule or an authorised override.
- The **internal due date** comes from firm policy and should be earlier where appropriate.
- **Overdue** is calculated from dates; users do not select it as a manual status.
- A deadline override requires the source, reason, actor, old value, and new value.
- Publishing a new rule does not silently alter assignments already generated from an older version.
- Running period generation again must not create duplicate obligations or assignments.

Use the obligation calendar to review upcoming, due, overdue, waived, and completed requirements. Only use **Waive** when firm policy permits it and record the reason and authority; waiver is not the same as completion.

## Assignments, tasks, and maker-checker review

### Current

Work Assignments, assignment detail, My Tasks, workflow stages, checklists, documents, comments, and WhatsApp drafting are present in the current application. Their target replacements retain the useful behavior while moving authoritative transitions to the server.

### Assignment states — core target

| State or action            | Meaning                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| Assigned                   | A preparer/reviewer and dates have been set, but work has not started |
| In progress                | Preparation is underway                                               |
| Awaiting client            | Work is blocked on named client evidence or response                  |
| Submitted for review       | The preparer has declared the version ready for independent review    |
| Changes requested          | The reviewer returned specific findings to the preparer               |
| Approved                   | The reviewer approved a specific version                              |
| Filing / delivery recorded | Acknowledgement or deliverable evidence has been recorded             |
| Completed                  | Required evidence and sign-off are present and the work is locked     |
| Reopened                   | An authorised user reopened completed work with a reason              |

### Prepare work

1. Open **My Tasks**, **All Open Assignments**, or the relevant client workspace.
2. Confirm the engagement, period, statutory due date, internal due date, preparer, reviewer, and current blockers.
3. Choose **Start**.
4. Complete checklist items and link accepted evidence.
5. Raise document requests for missing client material instead of treating an informal message as evidence.
6. Record material notes and blockers in the appropriate field; do not place sensitive information in a general comment if a protected field exists.
7. Resolve required items, then choose **Submit for review** with a concise submission note.

The system blocks submission when required checklist items or accepted evidence are missing. It also binds the submission to the current record version.

### Review work

1. Open the review queue or assignment workspace.
2. Confirm you did not prepare the controlled submission.
3. Review the submitted version, evidence, checklist, and open findings.
4. Choose **Request changes** and record actionable findings, or choose **Approve**.
5. A material edit after approval invalidates that approval and requires review again.

Review is not complete merely because the visible status was changed. The specific review action, actor, version, decision, time, and reason form the evidence.

### File, deliver, and complete

Record filing acknowledgements, signed or delivered outputs, signatory, and UDIN when the engagement requires them. The target workflow prevents completion until the configured evidence is present. ICAI’s official [UDIN FAQ](https://udin.icai.org/pdf/FAQs%20on%20UDIN%20%284th%20Edition%29%20Final-02-02-24.pdf) is a policy input; the firm must configure and review its applicable workflow rather than relying on the CRM as legal advice.

Completed work is locked. Use **Reopen** only with the required authority and reason. The previous completed state and evidence remain in history.

## Documents and client collaboration

### Current

The application already has Documents and document-related assignment features. During migration, follow the existing upload and access rules. A document row or filename by itself must not be treated as proof that the file was scanned, reviewed, or accepted.

### Document requests — core target

A document request describes evidence still needed. An uploaded document is a response to that request, and a new upload is a version rather than a silent replacement.

1. Choose **Request document** from the client or assignment workspace.
2. Name the requirement clearly, select the authorised client contact, set the due date, and state acceptable formats or period.
3. The client uploads through a short-lived private upload instruction.
4. The system records uploader, source, checksum, version, and scan state.
5. Until malware scanning succeeds, the upload remains quarantined and cannot satisfy required evidence.
6. An authorised staff member chooses **Accept**, **Reject**, or requests a replacement and records the reason.
7. A replacement creates a new version and preserves the earlier version and review history.

Reminder policies stop once accepted evidence fulfils the request. If a reminder continues after acceptance, report the automation failure; do not delete the evidence or request to silence it.

### Client-visible and firm-private records

Every document and comment has an intended audience. Client contacts see only material explicitly made client-visible for an entity they are granted. Internal workpapers, review notes, acceptance risk, staff comments, and unrelated client records remain private.

Sensitive downloads may require step-up verification and are logged. Downloaded copies leave the system’s access controls, so store and transmit them only through approved practice channels.

### Retention and legal hold

Retention follows the configured record class. A legal hold prevents normal destruction. Users must not delete or replace records to shorten retention or “clean up” a completed file. For applicable audit engagements, the firm’s approved policy should reflect ICAI requirements and the official [SQC 1 material](https://kb.icai.org/pdfs/PDFFile5b43637fb468a3.76721073.pdf).

## Communication and reminders

### Current

Communication, reminders, comments, and WhatsApp drafting are present in the current application. A draft is not evidence that a message was delivered.

### Core target

Use communication actions from the related client, assignment, document request, invoice, or collection record so the context is preserved.

- Select an approved template where appropriate.
- Verify the recipient and client entity before queueing.
- Keep confidential attachments client-visible only when explicitly intended.
- A queued message may be **pending**, **sent**, **delivered**, **failed**, or **cancelled**, depending on provider support.
- Provider failure remains visible and retryable; the system must not falsely mark the business task complete.
- Reminder rules stop when their business condition is resolved.

Live email, WhatsApp Business, SMS, e-sign, or regulatory-provider connections are available only after the relevant provider is configured and tested. The local demo captures messages instead of sending them.

## Billing and invoices

### Current

Billing, invoices, PDF output, financial-year numbering, and invoice balances already exist. Invoice codes come from the database, not from a user-entered counter. Continue to use the established workflow until the server-backed slice replaces it.

### Core target invoice workflow

1. Choose **Create invoice draft** from an engagement, milestone, approved time/WIP source, or billing workspace.
2. Confirm the client, billing address and registration, engagement, supply/tax treatment, line descriptions, taxable values, and applicable tax components.
3. Review derived subtotal, tax, total, and due date. The server recalculates totals; a caller-supplied total is not authoritative.
4. Submit for approval when the configured threshold or policy requires it.
5. An authorised user chooses **Approve**.
6. Choose **Issue**. The financial-year invoice number is generated only at issue and cannot be supplied by the browser.
7. Deliver the issued document through an approved channel and monitor any queued-message failure.

An issued invoice is immutable. Correct it through the configured credit note, debit note, or controlled cancellation process; never overwrite or delete the issued record. The data model and configured invoice template require professional review against applicable GST rules. The official reference is the [CBIC tax-invoice rules](https://cbic-gst.gov.in/pdf/invoice-gst-rules17052017.pdf).

## Receipts, allocations, and collections

### Current

Receipts, payment allocation, ageing, weekly reporting, and collections are present. The database allocation trigger recalculates invoice `amount_received` and status. Users and client code must not edit those derived fields directly.

### Record and allocate a receipt — core target

1. Choose **Record receipt** and enter the payer, date, amount, mode, reference, destination account, and available evidence.
2. Confirm the receipt. Its business code is generated by the system.
3. Allocate some or all of the available amount to one or more open invoices.
4. Review the remaining unapplied amount before saving.
5. The system updates invoice balances and states from the allocations.

The system rejects an allocation that would exceed the receipt’s available amount or the invoice’s open balance, including when another user allocated concurrently. An unapplied amount remains on the receipt; it is not silently discarded.

### Correct a receipt

Do not delete a posted receipt or allocation to hide an error. Reverse the incorrect receipt or allocation through the controlled workflow, then allocate the corrected amount. A reversal records the reason, authority, original entry, compensating entry, and resulting balance; configured thresholds may require finance or partner approval.

### Collection follow-up

The collections workspace organises balances by ageing and next action. For each follow-up, record:

- contact method and date;
- person contacted;
- outcome and dispute, if any;
- promise-to-pay amount and date;
- next action, date, and owner; and
- a factual note suitable for shared operational history.

The Collections Snapshot and Top Client Outstanding views are summaries of these same canonical balances. Use drill-through to work the underlying records. A promise to pay does not count as a receipt, and an unallocated receipt does not reduce a particular invoice until allocated.

## Client Tax Money

The current application includes a Client Tax Money area, but its production meaning is an unresolved business decision.

- If it only tracks an amount the client must pay directly, label and design it as a client obligation, not firm-held money.
- If the firm receives or controls client funds, the module cannot go live until segregated ledgers, restricted access, dual approval, transaction reconstruction, reconciliation, retention, and the applicable AML/CFT controls are approved and tested.

Do not record, transfer, approve, or reconcile real controlled funds in a demo or in an unapproved workflow. FIU-India’s official [guidelines for relevant professionals](https://fiuindia.gov.in/pdfs/AML_legislation/AMLCFTguidelines04072023.pdf) are a policy input only where the notified activity applies; the CRM does not determine legal applicability.

## Internal Audit and advisory work

### Current

Internal Audit and L2 / Virtual CFO advisory records exist and must be retained during migration.

### Target boundary

The core product coordinates the client, engagement, assignment, evidence request, review, deliverable, fee, and history for these services. It is not yet a complete statutory-audit workpaper system with materiality, sampling, assertions, trial-balance imports, lead schedules, and full file assembly. Those capabilities are advanced and require a separate product decision.

Do not describe the presence of an “Internal Audit” route as certification, audit completion, or replacement of professional workpaper software.

## Reports, search, and exports

### Current

Reports, CSV export, and print exist. Their output remains governed by current RLS and role rules during migration.

### Core target

Target reports include deadlines and completion, assignment throughput and review age, evidence-request cycle time, billing and collections, ageing and DSO, unapplied receipts, promises and disputes, client health, quality exceptions, and security/audit activity. Utilisation, WIP, realisation, and profitability are reliable only after approved time, budget, and cost capture exists.

Good report use:

1. Select a defined report and permitted date/client/department filters.
2. Note its measure definition and as-of time.
3. Drill into the records behind totals before escalating an apparent exception.
4. Export only when necessary and permitted.
5. Protect the downloaded file according to its data class and delete local copies under the approved policy.

An export never broadens access: the server applies the same row and field restrictions as the screen. Bulk or sensitive export may require step-up verification and an audit reason.

## Team, departments, settings, and templates

### Staff access

Only authorised administrators can invite or deactivate staff or replace access. Roles live in the dedicated role model, not on a user profile field. Administrators must grant the minimum necessary role, department, client scope, and assignment access.

- **Invite** creates an invitation; it does not justify sharing a temporary password.
- **Replace access** records the old and new scope and may require step-up verification.
- **Deactivate** prevents subsequent domain actions and starts the session-revocation process; it does not delete the staff member’s history.
- Periodically review dormant accounts, broad roles, client grants, and segregation conflicts.

### Catalogues and policy versions

Services, workflows, deadline rules, reminder policies, templates, and organisation settings are versioned where changing them could alter work or evidence. Publish a new version with effective dates and a reason. Do not edit a published version to rewrite history.

The invoice prefix may be configured in organisation settings, but the UI never invents an invoice number. Client, engagement, assignment, task, invoice, and receipt codes remain system-generated.

### Demo data

Current demo records are marked `is_demo = true` and belong to the named demo clients and `*@sn-demo.local` accounts. **Remove demo data** must delete only flagged demo rows. Review the confirmation summary before running it; never use a broad database deletion to reset a demo.

The target local demo server provides its own safe seeded reset and captured providers. Demo and production datasets must never share outbound credentials.

## How reads and actions behave

The target interface has two server entry points behind the UI:

- a **query** reads a permission-filtered workspace or queue without changing business state; and
- an **operation** expresses a named business intent such as Submit for review, Issue invoice, or Allocate receipt.

There is no generic public “change status” or “patch any record” action. This lets the system apply the right permissions, evidence, transitions, calculations, and audit rules for each intent.

### Safe retries

Each operation carries a unique idempotency key. If a network timeout occurs after you select an action, use the UI’s **Retry** or status check rather than recreating the transaction in another tab. A retry of the same action returns the existing result instead of duplicating a client, invoice, receipt, allocation, audit event, or message.

### Concurrent edits

Workspaces carry a record version. If someone changes the record after you opened it, the system returns a conflict rather than overwriting their work. Refresh, review the new values, and repeat the intended action if it is still valid. Do not copy an old value back merely to clear the warning.

### Operation receipts

Successful actions return a durable receipt and request ID. Provider work, such as delivering a message, may remain pending after the business change is saved. Use the visible operation status instead of assuming that a spinner or toast proves external delivery.

### UI-to-contract examples for support

| User action or screen              | Target contract intent                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| Open role-aware home               | `dashboard.get` query                                          |
| Open client workspace              | `client.workspace` query                                       |
| Submit an assignment               | `assignment.submitForReview` operation                         |
| Pause for client evidence / resume | `assignment.setAwaitingClient` / `assignment.resume` operation |
| Request changes / approve          | `assignment.requestChanges` / `assignment.approve` operation   |
| Record filing / complete           | `assignment.recordFiling` / `assignment.complete` operation    |
| Request or review evidence         | `document.request` / `document.review` operation               |
| Issue an invoice                   | `invoice.issue` operation                                      |
| Record or allocate a receipt       | `receipt.record` / `receipt.allocate` operation                |
| Reverse an incorrect allocation    | `receipt.reverseAllocation` operation                          |
| Record a collection outcome        | `collection.recordFollowUp` operation                          |
| Check a delayed action             | `operation.status` query                                       |

These identifiers help support correlate the UI with server logs. End users should use the labelled interface; they do not call the endpoints or supply authority fields themselves.

## Common messages

| What the user sees                      | Meaning                                                                    | Recommended response                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Sign in again                           | The session is absent or expired                                           | Sign in through the normal authentication screen                                                 |
| You do not have permission              | Role, scope, record involvement, or field access does not allow the action | Ask the authorised access owner to review scope; do not share accounts                           |
| Additional verification required        | A sensitive action requires AAL2 step-up                                   | Complete the approved second-factor flow                                                         |
| Check the highlighted fields            | Input validation failed                                                    | Correct only the identified values                                                               |
| Required items are missing              | A workflow precondition, evidence item, approval, or balance rule failed   | Open the listed items and resolve them; do not bypass the workflow                               |
| This action is not available now        | The record state does not allow that operation                             | Refresh and use one of the displayed available actions                                           |
| This record changed                     | The saved version is newer than the one on screen                          | Refresh, review, and retry if still appropriate                                                  |
| Request already used for another action | An idempotency key was reused with different content                       | Stop and contact support with the request ID                                                     |
| Try again later                         | Rate limit or temporary dependency failure                                 | Wait for the stated interval or use the displayed retry action                                   |
| Something went wrong                    | An unexpected error was safely hidden                                      | Record the time, page, and request ID; do not paste confidential data into an unapproved channel |

Raw database, storage, Supabase, or provider errors must not be displayed to users.

## Activity history and audit evidence

The activity feed is a readable operational timeline. The audit ledger is separate, append-only evidence of commands and sensitive access. An audit event identifies the actor or named system actor, time, subject, intent, reason where required, outcome, correlation, and redacted change summary.

Users cannot edit or delete audit events. Corrections happen through a new authorised operation that preserves the previous event. Background automations appear as a named system actor with causation information, not as an anonymous administrator.

## Role-based daily starts

### Partner or founder

1. Review the KPI strip and attention queue at the stated as-of time.
2. Open pending acceptance, high-risk deadlines, aged review, and sensitive approval items.
3. Review Top Client Outstanding and promises due before collection escalation.
4. Drill into exceptions; do not manage the practice from disconnected totals alone.

### Manager or reviewer

1. Check unassigned work, deadline risk, awaiting-client items, and blocker age.
2. Balance preparer and reviewer ownership without creating self-review.
3. Work the oldest review submissions first unless statutory risk dictates otherwise.
4. Confirm requested changes are resolved before approval.

### Staff or trainee

1. Open today’s tasks and returned work.
2. Check statutory and internal due dates before starting.
3. Request missing evidence early and mark the precise blocker.
4. Complete the checklist and submit a coherent version for review.

### Accounts and collections

1. Review bills to raise, overdue balances, unapplied receipts, disputes, and promises due.
2. Reconcile receipt evidence before allocation.
3. Record every material collection outcome and next action.
4. Escalate exceptions through approval workflows; never directly edit a derived balance.

### Administrator

1. Review invitations, deactivations, broad access, and failed background work.
2. Confirm deadline, workflow, reminder, and template versions before publishing.
3. Check demo/production separation, audit coverage, and scheduled recovery evidence.
4. Use the approved operation for privileged changes; never bypass RLS with browser credentials.

## Feature-status summary

| Area             | Current foundation retained                         | Core target improvement                                                          | Advanced / conditional                                 |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Dashboard        | Existing dashboard                                  | Role-aware canonical snapshots and selected leadership modules                   | Predictive risk and custom BI designer                 |
| Client           | Client list and detail                              | Prospect acceptance, Client 360, explicit access grants                          | Marketing automation and lead scoring                  |
| Work             | Assignments, tasks, checklists, documents, comments | Obligations, versioned workflow, maker-checker, controlled filing/completion     | Full audit workpaper suite                             |
| Documents        | Document records and assignment documents           | Requests, private upload, scan, versions, review, retention, client portal       | OCR and structured extraction                          |
| Communication    | Reminders and drafting                              | Outbox, delivery status, stop conditions, failure recovery                       | Live providers only when configured; AI drafting later |
| Finance          | Invoices, PDFs, receipts, allocations, ageing       | Approval, immutable issue, controlled correction/reversal, canonical collections | Bank feeds, payment automation, forecasting            |
| Administration   | Team, departments, services, settings, demo removal | Versioned policy, scoped access, audited privileged operations                   | SSO, SCIM, multi-office, commercial multi-tenancy      |
| Reporting        | Reports, CSV, print                                 | Defined measures, drill-through, governed exports                                | Custom report builder and predictive analytics         |
| Client tax money | Existing area                                       | Meaning and controls must be decided before production use                       | Full controlled-funds/AML module if applicable         |

## Getting help and reporting a problem

Before reporting a problem:

1. Confirm whether the feature is **Current**, **Core target**, or **Advanced / conditional**.
2. Refresh once if the message indicates stale data; do not repeat a financial action in a new tab.
3. Record the page, time in `Asia/Kolkata`, visible record code, action, as-of time, and request ID.
4. Describe the expected and actual result without including passwords, access tokens, bank credentials, or unnecessary personal data.
5. For a suspected access leak, financial mismatch, missed statutory deadline, or real message sent from demo, stop work on the affected flow and escalate through the incident contact immediately.

Product scope and terminology are defined in the [Product Blueprint](./PRODUCT_BLUEPRINT.md). Server behavior, permissions, and the query/operation contract are defined in [Architecture](./ARCHITECTURE.md). Delivery and release status are defined in the [Delivery Roadmap](./DELIVERY_ROADMAP.md).
