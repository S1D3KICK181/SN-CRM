# SN Practice CRM — Product Blueprint

## Document status

This document defines the target product for the next production build of SN Practice CRM. It preserves the useful behavior in the current Lovable/Supabase application while adding the lifecycle, controls, and server-side domain logic required for a dependable accounting-practice system.

The product is a **CRM and practice-operations platform** for SN & Associates. It is not a healthcare revenue-cycle-management product, and the acronym **RCM** must not be used in navigation, documentation, or marketing. Where revenue-cycle concepts are useful, describe them plainly as billing, receipts, allocations, and collections.

## Product assumptions

- The first production deployment serves one accounting practice: SN & Associates.
- Users work primarily on desktop during long sessions, with responsive mobile views for approvals and quick checks.
- Dates use `DD/MM/YYYY`, money uses INR, financial years use labels such as `FY 2026–27`, and business time is interpreted in `Asia/Kolkata`.
- The server, not the browser, is authoritative for permissions, state transitions, numbering, money calculations, and audit evidence.
- The product coordinates practice work. It does not become a complete statutory-audit workpaper suite in the core release.
- Existing routes, data relationships, demo data, database numbering, allocation-driven balances, and RLS behavior remain available while each slice is migrated.

If the product may later be sold to other firms, that is a separate multi-tenant product decision. The caller-facing contract must not accept a caller-selected firm ID. The persistence model may carry a server-resolved firm ID to reduce future migration cost.

## Product purpose

SN Practice CRM gives each role a trustworthy next-action view across:

1. prospects and client acceptance;
2. services and engagements;
3. recurring statutory obligations and deadlines;
4. assignments, tasks, documents, review, filing, and sign-off;
5. invoices, receipts, allocations, and collection follow-ups; and
6. administration, quality control, reporting, and evidence.

Success means that urgent work, missing evidence, pending review, and overdue money are visible without manual reconciliation, and that a user can move from a signal to the responsible record in one action.

## Existing capabilities to retain

The redesign and server migration must retain the current working foundation:

- email/password authentication, signup, password reset, and role-aware navigation;
- Dashboard;
- Clients and client detail;
- Services and Engagements;
- Work Assignments and assignment detail, including workflow stages, checklists, documents, comments, and WhatsApp drafting;
- My Tasks;
- Team and Departments;
- Documents;
- Communication and Reminders;
- Billing and Invoices, including PDF output;
- Receipts and Collections, including payment allocation, ageing, and weekly reporting;
- Client Tax Money;
- Internal Audit;
- L2 / Virtual CFO advisory records;
- Reports, CSV export, and print;
- Settings and demo-data removal;
- database-generated client, engagement, assignment, task, invoice, and receipt codes;
- allocation-driven invoice balances;
- row-level-security policies and database helper functions;
- browser-local demo behavior until the local server demo adapter replaces it; and
- the realistic demo clients, staff, assignments, invoices, receipts, audit, and advisory records.

“Retain” means behavioral parity or an intentional, documented improvement. It does not require preserving unsafe direct table mutations from the browser.

## Canonical lifecycle

```text
Prospect
  → due diligence, conflict and independence checks
  → acceptance decision
  → client
  → engagement and fee terms
  → recurring or one-time obligation
  → assignment and document requests
  → preparation
  → maker-checker review
  → filing / signing / delivery
  → invoice
  → receipt and allocation
  → collection or closure
  → renewal, suspension, or offboarding
```

The product must not collapse these concepts into a generic status field. Each step has its own evidence, permissions, and allowed transitions.

## Domain vocabulary

| Term                 | Meaning                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Prospect             | A person or legal entity not yet accepted as a client.                                                               |
| Client               | An accepted person or legal entity receiving services from the firm.                                                 |
| Contact              | A person authorised to communicate or act for a client. A contact is not the client entity.                          |
| Engagement           | The approved professional and commercial arrangement for a service, scope, period, partner, fee, and billing method. |
| Service              | A reusable catalogue definition such as GST return, tax audit, payroll, or virtual CFO.                              |
| Obligation           | A one-time or recurring requirement for a client, registration, jurisdiction, and period.                            |
| Assignment           | The execution instance created to fulfil an obligation or another engagement deliverable.                            |
| Task                 | A smaller action within or related to an assignment.                                                                 |
| Document request     | A requirement for evidence. It is distinct from an uploaded document and its versions.                               |
| Deliverable          | A filed, signed, issued, or otherwise completed output.                                                              |
| Invoice              | A fee claim issued by the firm. An issued invoice is not freely editable.                                            |
| Receipt              | Money received from a client.                                                                                        |
| Allocation           | Application of all or part of a receipt to an invoice.                                                               |
| Collection follow-up | A recorded contact, outcome, promise, and next action concerning outstanding fees.                                   |
| Activity entry       | Human-readable operational history. It is not compliance-grade audit evidence.                                       |
| Audit event          | Immutable evidence of a command or sensitive access, including actor, reason, subject, and result.                   |

## Roles and segregation of duties

The core product keeps the existing roles and sharpens their authority. Additional quality and client roles may be introduced without granting broad database access.

| Role                           | Default responsibilities                                                                                   | Important restrictions                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Founder / Partner              | Firm-wide leadership, client acceptance, engagement approval, final sign-off, sensitive financial approval | Cannot erase history or bypass required reasons and evidence                                  |
| Manager / Reviewer             | Plan work, assign staff, review submissions, manage department and client delivery                         | Cannot approve work they prepared                                                             |
| Senior Staff / Staff / Trainee | Prepare assigned work, maintain checklists, request evidence, respond to review notes                      | Cannot approve acceptance, their own work, access changes, invoice issue, or receipt reversal |
| Accounts & Collections         | Prepare invoices, record receipts, allocate payments, manage follow-ups and ageing                         | No default access to confidential workpapers or quality-risk assessments                      |
| Practice Administrator         | Invite/deactivate staff, configure departments, catalogues, templates, and policies                        | Administration does not automatically grant client-content access                             |
| Quality / Risk                 | Conflict, independence, acceptance, retention, quality monitoring, and audit review                        | No routine fee or receipt authority unless separately granted                                 |
| Client Contact                 | View explicitly granted client records, respond to requests, upload evidence, view issued invoices         | Cannot see internal comments, risk assessments, staff notes, or other client entities         |
| System Actor                   | Run a named scheduled or integration operation                                                             | Cannot use interactive or unrestricted administrative operations                              |

Permissions combine role, department, client, engagement, assignment involvement, and field sensitivity. Hiding navigation is never the security control. Step-up MFA is required for access changes, bulk export, receipt reversal, write-off or credit approval, client-money actions, and sensitive downloads.

## Role-aware home experience

The first page after sign-in is the dashboard, but it is not the same dashboard for every role.

### Leadership composition

The leadership dashboard must keep the five user-selected elements and remove duplicate or decorative widgets:

1. **KPI strip** — Due today, Open assignments, Pending review, Outstanding fees.
2. **Collections Snapshot grid** — current and ageing buckets with amount and count.
3. **Top Client Outstanding** — highest client balances with oldest due date.
4. **Billing & Collections graph** — billed and collected amounts over a consistent period.
5. **All Open Assignments** — a filterable, sortable table with owner, stage, blocker, internal due date, statutory due date, and next action.

Add one compact attention queue for statutory deadlines at risk, blocked work, missing documents, promises to pay due, and failed automations. Every metric must show an `as of` time and drill into the exact filtered records behind it.

### Other dashboards

- **Manager:** deadlines at risk, unassigned work, review queue age, missing documents, blockers, and team capacity.
- **Staff:** today’s work, returned work, awaiting-client items, upcoming deadlines, and personal tasks.
- **Accounts:** bills to raise, outstanding and overdue fees, unapplied receipts, promises due, disputes, and failed reminders.
- **Client:** requested documents, upcoming obligations, approvals, deliverables, issued invoices, and payment status.

## Core workflows

### 1. Prospect, due diligence, and acceptance

- Create a prospect and authorised contacts.
- Record legal form, registrations, ownership and beneficial-owner details when applicable.
- Perform duplicate, conflict, independence, integrity, capability, and risk checks.
- Submit a complete acceptance pack.
- Require an authorised acceptance or rejection with reason.
- Create the client only through the approved transition.

ICAI’s current SQC 1 expects acceptance and continuance decisions to consider client integrity, competence and resources, and ethical requirements. ICAI deferred the mandatory effective date of SQM 1 and SQM 2 on 31 March 2026, so SQC 1 continues to apply until a further announcement. See the [ICAI deferment announcement](https://www.icai.org/post/23949) and [SQC 1](https://kb.icai.org/pdfs/PDFFile5b43637fb468a3.76721073.pdf).

### 2. Client 360 and engagement

- Separate the client entity from contacts, branches, registrations, directors, partners, trustees, and related entities.
- Display services, engagements, obligations, assignments, documents, messages, invoices, receipts, collection activity, and risks in one permission-filtered workspace.
- Support fixed, recurring, milestone, and time-based fee arrangements.
- Store engagement-letter evidence and scope changes.
- Renew, suspend, or end an engagement without deleting its history.

### 3. Obligation and statutory deadline engine

- Define a versioned obligation rule by service, registration, jurisdiction, frequency, and source.
- Materialise obligations and assignments for a period without duplication.
- Store statutory due date, internal due date, source, rule version, extension history, and responsible owner.
- Require a reason and source for deadline overrides.
- Never silently rewrite assignments already generated from an older rule version.
- Treat `overdue` as a date-derived condition, not a manually selected status.

### 4. Assignment and maker-checker delivery

- Generate workflow stages, checklist items, document requests, preparer, reviewer, and internal dates from an approved template.
- Support assignment, reassignment, start, awaiting-client, submission, changes requested, approval, filing, completion, and controlled reopening.
- Prevent submission while required checklist items or accepted evidence are missing.
- Prevent the preparer from approving their own submission.
- Require filing acknowledgement, deliverable, and UDIN where relevant before completion.
- Lock completed work; reopening requires authority and reason.

UDIN tracking is part of the core workflow for applicable certificates and audit/assurance work. ICAI’s published guidance states the relevant mandatory coverage and a 60-day outer window where UDIN was not generated at signing. See the [ICAI UDIN FAQ](https://udin.icai.org/pdf/FAQs%20on%20UDIN%20%284th%20Edition%29%20Final-02-02-24.pdf).

### 5. Documents and client collaboration

- Request evidence from a named client contact with due date and reminders.
- Upload to private storage through short-lived server-issued upload instructions.
- Record document versions, checksum, source, uploader, scan status, review decision, and supersession.
- Quarantine uploads until malware scanning succeeds.
- Separate client-visible material from firm-private workpapers.
- Log downloads and sensitive reveals.
- Apply retention class and legal hold.

For audit engagements, SQC 1 states that the retention period is ordinarily no shorter than seven years and that changes after final file assembly must remain traceable. See [ICAI SQC 1](https://kb.icai.org/pdfs/PDFFile5b43637fb468a3.76721073.pdf).

### 6. Billing, receipts, and collections

- Prepare and approve invoices from engagement terms, milestones, or approved time/WIP.
- Calculate taxable value, tax components, totals, and balance on the server.
- Generate the financial-year invoice number only when issuing.
- Make issued invoices immutable; correct them with credit/debit notes or controlled cancellation.
- Record receipts, preserve unapplied balances, and allocate under row locks.
- Prevent allocations above the receipt’s available amount or invoice’s open balance.
- Reverse financial records with compensating entries and approval, never deletion.
- Track disputes, last contact, response, promise to pay, next action, and owner.

The invoice model must support the particulars and tax treatment required for the firm’s applicable GST invoices. See the [CBIC tax-invoice rules](https://cbic-gst.gov.in/pdf/invoice-gst-rules17052017.pdf).

### 7. Client tax money

The existing area remains visible, but production use is conditional. First determine whether it represents money actually controlled by the firm or only amounts a client must pay directly.

If the firm controls client funds, segregated ledgers, dual approval, transaction reconstruction, reconciliation, restricted access, and applicable AML/CFT controls become release gates. FIU-India’s guidance applies to notified professional activities, including specified transactions involving management of client money or assets; it does not apply indiscriminately to every engagement. See the [FIU-India professional guidelines](https://fiuindia.gov.in/pdfs/AML_legislation/AMLCFTguidelines04072023.pdf).

## Automations

Core automations are deterministic and explainable:

- recurring obligation and assignment generation;
- internal-deadline calculation from a published policy;
- document-request reminders that stop when accepted evidence exists;
- review and overdue-work escalation;
- recurring or milestone invoice preparation;
- ageing-based collection reminders and promise-to-pay follow-up;
- calendar events and registration/engagement renewal reminders;
- delivery retry and failure queues; and
- audit and outbox creation in the same transaction as every command.

Advanced automation may add OCR, structured extraction, suggested assignment routing, deadline-risk forecasting, collection forecasting, and record-grounded AI summaries. AI may propose; an authorised human remains responsible for professional conclusions, filing, sign-off, money movement, and access changes.

## Reporting

Reports must be drillable, exportable according to permission, and calculated from defined measures:

- on-time statutory completion and missed-deadline register;
- assignment throughput, blockers, review age, and turnaround;
- document-request cycle time;
- utilisation, budget variance, WIP, realisation, and profitability once time/cost capture exists;
- billing, collections, AR ageing, DSO, unapplied receipts, and cash forecast;
- promise-to-pay reliability and dispute ageing;
- client health, service penetration, engagement renewal, and concentration;
- quality exceptions, independence declarations, open findings, and file-lock exceptions; and
- access, export, sensitive-action, integration, and security-event reports.

## Data protection and governance

The product requires:

- a data inventory and named processing purposes;
- privacy-notice versioning and consent where consent is the applicable basis;
- field masking and least-privilege access;
- retention and approved destruction by record class;
- legal hold;
- data-principal request and breach workflows;
- a processor/subprocessor register;
- encrypted transport, managed secrets, backups, tested restoration, and incident response; and
- an append-only audit ledger separate from the activity feed.

India’s DPDP framework is phased. The 13 November 2025 commencement notification schedules most substantive provisions cited there for 18 months after publication. The system should be ready before those provisions take effect rather than retrofitted afterward. See the [MeitY commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) and [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).

## Core release versus advanced product

### Core release

- separate server and typed query/operation contract;
- RLS-preserving authentication and scoped permissions;
- role-aware dashboard and requested leadership composition;
- prospect, acceptance, client, contact, registration, and engagement lifecycle;
- versioned service, workflow, and deadline rules;
- recurring obligations and assignments;
- maker-checker delivery and controlled filing/completion;
- private document requests, upload, versioning, scanning, and client portal;
- GST-capable invoice, receipt, allocation, ageing, and collections workflow;
- staff access, settings, imports, exports, search, saved views, notifications, and reports;
- idempotency, optimistic concurrency, transactional audit events, and outbox; and
- local demo server with realistic seeded data and no external credentials.

### Advanced or conditional

- full time, WIP, capacity, realisation, and profitability analytics; capture foundational time/cost data early if these reports are expected;
- full assurance workpaper authoring, sampling, materiality, trial-balance imports, assertions, and lead schedules;
- Tally, bank-feed, payment, e-sign, WhatsApp Business, GST GSP, Income Tax ERI, MCA, and other regulatory integrations;
- visual workflow builder and custom report builder;
- SSO, SCIM, multi-office federation, commercial multi-tenancy, and customer-managed keys;
- OCR, extraction, anomaly detection, forecasting, and AI assistance; and
- full client-money/AML module, unless actual fund handling makes it a core release gate.

## Success measures

- statutory work completed on or before the statutory due date;
- internal due-date adherence;
- median submission-to-review and correction-to-approval time;
- document-request cycle time;
- unassigned and blocked-work age;
- billing lag after delivery;
- outstanding fees, overdue fees, DSO, and collection effectiveness;
- unapplied-receipt age;
- client-portal adoption;
- failed automation and integration retry age;
- permission and audit-control test pass rate; and
- backup-restore and incident-response exercise results.

## Decisions the product owner must confirm

1. Is the product permanently single-firm, or may it become a commercial multi-firm product?
2. Is the goal practice coordination, or eventual replacement of statutory-audit workpaper software?
3. Which services launch first, and who owns the authoritative deadline catalogue?
4. Does SN & Associates ever receive or control client tax money?
5. Which client contacts may use the portal, and who grants or revokes access?
6. Which billing models, approval thresholds, credit/write-off rules, and receipt-reversal rules apply?
7. Which records require partner, quality, or finance approval?
8. Which data must migrate from Excel, Tally, Drive, email, WhatsApp, or another practice system?
9. What retention periods apply to each service and record class beyond the audit minimum?
10. What hosting region, RPO, RTO, support hours, and availability target are required?
11. Which integrations are essential at launch, and does the firm have the provider eligibility and credentials?
12. Who may export PAN, bank, client-money, audit, and staff-cost data?
