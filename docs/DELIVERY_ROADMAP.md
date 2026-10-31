# SN Practice CRM — Delivery Roadmap

## Purpose

This roadmap moves the current Lovable/Supabase CRM to the target single-firm product without discarding working features or attempting a risky full rewrite. Delivery proceeds in vertical slices. Each slice includes its server query/operations, permissions, audit evidence, UI, demo behavior, migration, and tests.

Sequence is intentional; calendar estimates should be added only after the product-owner decisions in Phase 0 and an engineering sizing pass.

## Delivery rules

- Preserve a working branch and published Lovable history.
- Do not remove an existing capability until its replacement passes parity and migration checks.
- Do not introduce dual writes. During migration, each operation has exactly one authoritative write path.
- Move one complete user outcome at a time, not tables or visual components in isolation.
- Keep RLS enabled and tested throughout migration.
- Use the query/operation contract for production and local demo.
- Put all new external credentials and provider calls on the server or worker.
- Mark advanced features honestly; do not imitate them with decorative UI or fake integrations.

## Phase 0 — Product decisions and baseline

### Outcomes

- Confirm the product is SN Practice **CRM**, not healthcare RCM.
- Confirm single-firm production scope.
- Decide whether audit features coordinate engagements or must eventually replace workpaper software.
- Decide whether “Client Tax Money” records actual controlled funds or client obligations only.
- Select the first service catalogue and deadline owner.
- Agree roles, approval thresholds, billing models, retention classes, RPO/RTO, hosting region, and required integrations.
- Inventory every existing route, query, mutation, RLS rule, database trigger, demo path, report, and export.
- Capture current screenshots, dashboard results, and representative records for parity tests.

### Deliverables

- approved scope and decision register;
- canonical vocabulary from the product blueprint;
- existing-behavior matrix;
- data inventory and migration source list;
- permission and segregation-of-duties matrix;
- service/deadline ownership policy; and
- acceptance criteria for each core workflow.

### Exit gate

No unresolved decision may change the persistence isolation model, client-money controls, core workflow scope, or data migration approach. If it can, resolve it before Phase 1.

## Phase 1 — Server foundation and compatibility seam

### Outcomes

- Introduce the separate CRM server and health/version endpoints.
- Add the frontend PracticeClient and typed outcomes.
- Verify Supabase JWTs and resolve actor, roles, departments, scopes, and assurance level on the server.
- Preserve user-scoped Supabase/RLS access for ordinary operations.
- Implement operation idempotency, aggregate versions, audit events, domain events, outbox, and webhook inbox.
- Add structured logging, correlation IDs, metrics, secret handling, and rate limits.
- Build the local server demo adapter with seeded data and captured providers.
- Keep a temporary direct-Supabase compatibility adapter for unmigrated routes.

### First contract capabilities

- `operation.status`
- `actor.context` as the harmless authenticated identity-and-scope query;
- `organisation.updateSettings` as one audited settings change; and
- `communication.queue` with a captured demo provider.

### Exit gate

- No service-role secret reaches a browser bundle or client response.
- Authenticated, disabled, expired, forged, cross-user, and insufficient-assurance cases pass.
- Production and demo adapters pass the same initial contract tests.
- An operation can be retried without duplicate mutation, audit event, or outbox effect.
- A stale aggregate version produces a conflict rather than an overwrite.

## Phase 2 — Dashboard read vertical slice

### Outcomes

- Replace browser-side multi-table dashboard calculations with `dashboard.get`.
- Implement role-aware leadership, manager, staff, accounts, and client read models.
- Deliver the selected leadership composition:
  - Due today / Open assignments / Pending review / Outstanding fees strip;
  - Collections Snapshot grid;
  - Top Client Outstanding;
  - Billing & Collections graph;
  - All Open Assignments; and
  - compact attention queue.
- Give every metric a common `asOf` timestamp and drill-through filter.
- Add saved filters only after the server owns their canonical form.

### Exit gate

- Dashboard totals reconcile to controlled SQL fixtures and current production/demo data.
- Users cannot infer inaccessible client or financial counts.
- Loading, empty, partial-data, stale, error, and no-permission states are designed and tested.
- Desktop and mobile checks meet the project’s accessibility and responsiveness requirements.

## Phase 3 — Client lifecycle, engagements, obligations, and work

### Outcomes

- Add prospects, due diligence, conflict/independence checks, acceptance decisions, and client conversion.
- Sharpen client, contact, branch, registration, beneficial-owner, and access-grant records.
- Version engagement terms and acceptance evidence.
- Add versioned service, workflow, and deadline rules.
- Materialise recurring obligations and assignments idempotently.
- Migrate assignment and task work to intent operations.
- Implement maker-checker submission, changes requested, approval, filing, completion, and controlled reopening.
- Add acknowledgement, deliverable, signatory, and UDIN tracking where applicable.

### Exit gate

- An unaccepted prospect cannot receive an active engagement.
- Re-running period materialisation cannot duplicate obligations or assignments.
- A deadline override records source, reason, actor, old value, new value, and affected records.
- Required checks and evidence prevent premature submission.
- A preparer cannot review their own controlled work.
- Approval binds to a version and becomes invalid after a material edit.
- Completed work cannot be silently edited or reopened.

## Phase 4 — Documents, client portal, and communication

### Outcomes

- Replace metadata-only document records with requests, upload sessions, versions, scan results, review decisions, retention, and legal hold.
- Configure private object storage and short-lived server-issued upload/download access.
- Add client-contact invitations and explicit entity grants.
- Deliver client request/upload/comment/approval views without exposing internal notes.
- Queue email and, where configured, WhatsApp messages through outbox workers.
- Record provider delivery events and visible failures.
- Add reminder policies that stop after accepted evidence exists.

### Exit gate

- Unauthorised clients and staff cannot enumerate, upload, download, or replace another subject’s file.
- A file cannot be accepted or used to satisfy a required request before scan completion.
- A new version preserves prior versions and review history.
- Client-visible and firm-private content are demonstrably separated.
- Retention and legal-hold behavior is tested against representative audit and non-audit records.
- Provider timeout, duplication, invalid webhook, and retry exhaustion are visible and recoverable.

## Phase 5 — Billing, receipts, allocations, and collections

### Outcomes

- Add engagement-driven invoice drafting and approval.
- Complete GST-capable invoice data and tax calculation.
- Preserve database numbering and generate the invoice number on issue.
- Make issued invoices immutable and add credit/debit-note and controlled cancellation paths.
- Migrate receipts and allocations through transactional operations while preserving allocation-driven balances.
- Add unapplied receipts, disputes, promises to pay, collection owners, and next actions.
- Rebuild ageing, collection snapshots, weekly reporting, and drill-through from canonical measures.
- Determine and implement the safe scope of Client Tax Money.

### Exit gate

- Invoice totals are derived from line and tax inputs, not trusted caller totals.
- Issued invoice edits are rejected; correction uses an auditable financial document.
- Allocation sums cannot exceed the receipt or invoice balance, including concurrent requests.
- Reversals use compensating records and required approval.
- Dashboard, invoice, receipt, allocation, and ageing totals reconcile on migrated data.
- If the firm controls client funds, segregation, dual approval, reconciliation, AML/CFT, and record-retention controls pass before release.

The invoicing implementation must be reviewed against the firm’s applicable GST requirements, using authoritative CBIC material such as the [tax-invoice rules](https://cbic-gst.gov.in/pdf/invoice-gst-rules17052017.pdf).

## Phase 6 — Administration, reporting, governance, and migration closure

### Outcomes

- Migrate Team, Departments, Services, Templates, Reports, Settings, Internal Audit, and Advisory administration.
- Separate practice administration from automatic client-content access.
- Add audited staff invitation, role/scope replacement, deactivation, and session revocation.
- Deliver saved views, global search, approved imports/exports, and report definitions.
- Complete data retention, legal hold, data-principal request, processor register, and breach workflows.
- Configure backups, PITR where selected, restore runbooks, monitoring, alerting, and incident contacts.
- Rehearse data migration and rollback with reconciliation.
- Remove remaining direct browser writes and narrow database grants.
- Retire the browser-local business implementation after local server demo parity.

### Exit gate

- No migrated route imports the direct Supabase client for a business write.
- Every privileged operation follows the founder/authorised check before administrative access.
- Permission, RLS, export, audit, and sensitive-read tests pass for every role.
- Migration rehearsal produces matching counts and financial control totals.
- Backup restoration meets agreed RPO/RTO in a non-production exercise.
- Applicable DPDP readiness tasks have named owners and evidence.

India’s DPDP commencement is phased; see the [MeitY commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) and [DPDP Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf). Production readiness must follow the applicable dates and professional legal review rather than relying only on this roadmap.

## Phase 7 — Production release, training, and presentation

### Outcomes

- production cutover and smoke tests;
- role-based onboarding and administrator training;
- client-portal pilot with selected clients;
- support, escalation, incident, and change-management runbooks;
- post-release metric baseline and review cadence; and
- final presentation explaining product purpose, roles, lifecycle, dashboard, workflows, controls, architecture, integrations, limitations, and roadmap.

### Final presentation outline

1. CRM definition and the single-firm product goal.
2. Users and segregation of duties.
3. Prospect-to-collection lifecycle.
4. Leadership dashboard and role-aware homes.
5. Client 360, engagement, and obligations.
6. Assignment maker-checker and documents.
7. Billing, receipts, allocations, and collections.
8. Reports and automations.
9. Separate-server architecture and local demo.
10. Security, RLS, audit, data protection, and recovery.
11. Demonstrated end-to-end scenario.
12. Advanced roadmap and decisions still open.

The presentation must distinguish implemented, configured, piloted, and planned features. It must not claim provider integration, statutory compliance certification, uptime, customer results, or security assurance without evidence.

## Route migration map

| Current area                | Target query/operations                                         | Delivery phase |
| --------------------------- | --------------------------------------------------------------- | -------------: |
| Dashboard                   | `dashboard.get`                                                 |              2 |
| Clients and client detail   | `client.list`, `client.workspace`, `client.*`                   |              3 |
| Services and Engagements    | `engagement.workspace`, `engagement.*`                          |              3 |
| Work Assignments and detail | `assignment.queue`, `assignment.workspace`, `assignment.*`      |              3 |
| My Tasks                    | `task.myQueue`, task/assignment operations                      |              3 |
| Documents                   | `document.inbox`, `document.workspace`, `document.*`            |              4 |
| Communication and Reminders | communication queries, `communication.queue`, reminder policies |              4 |
| Billing and Invoices        | `billing.workspace`, `invoice.*`                                |              5 |
| Receipts and Collections    | `collections.workspace`, `receipt.*`, `collection.*`            |              5 |
| Client Tax Money            | conditional controlled-funds operations                         |              5 |
| Team and Departments        | `admin.workspace`, `staff.*`                                    |              6 |
| Internal Audit              | engagement/assignment/evidence queries and operations           |              6 |
| L2 / Virtual CFO            | advisory read models and actions                                |              6 |
| Reports                     | `report.run`, export operations                                 |              6 |
| Settings                    | versioned policy operations                                     |              6 |

## Definition of done for every migrated slice

- canonical terms and states are documented;
- query and operation types are versioned;
- permissions and field scopes are explicit;
- optimistic concurrency and idempotency are covered;
- successful operations write audit and outbox evidence transactionally;
- RLS and horizontal-access tests pass;
- loading, empty, validation, conflict, forbidden, unavailable, and retry states exist;
- desktop, keyboard, focus, contrast, reduced-motion, and mobile checks pass;
- demo seed and capturing providers cover the workflow;
- current data is migrated or mapped without silent loss;
- metrics and financial totals reconcile;
- rollback is documented until cutover is accepted; and
- the user guide is updated.

## Global release gates

### Product and scope

- Product owner has signed off the single-firm scope, service catalogue, client-money meaning, billing policies, and audit-workpaper boundary.
- No advanced feature is presented as production-ready.

### Security and access

- No secret/service-role key is present in browser assets, logs, source control, or client-visible errors.
- RLS and operation-level authorization pass adversarial tests.
- AAL2 gates, account deactivation, session handling, rate limits, and sensitive-access logs pass.
- Private storage and signed-link expiry pass.

### Workflow control

- Acceptance, maker-checker, version-bound approval, deadline overrides, filing evidence, and reopen reasons cannot be bypassed.
- SQC 1-related retention and audit-document traceability are implemented for applicable engagements. See [ICAI SQC 1](https://kb.icai.org/pdfs/PDFFile5b43637fb468a3.76721073.pdf).

### Financial integrity

- Numbering, tax calculation, issue immutability, credits, receipts, allocations, reversals, and ageing reconcile under concurrent tests.
- No financial status or balance relies on a browser-calculated authoritative value.

### Data and recovery

- Migration is rehearsed, reconciled, and reversible before final cutover.
- Backup and restore are tested.
- Retention, legal hold, approved destruction, data requests, and breach runbooks have owners.

### Reliability and operations

- SLOs, alerts, queue/dead-letter dashboards, provider runbooks, and incident contacts exist.
- Logs are redacted and retained according to the approved policy. CERT-In applicability and its secure rolling-log requirements must be assessed using the [official directions](https://cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf).

### Experience

- Core role journeys pass usability, accessibility, responsive, and performance checks.
- Dashboard metrics drill to matching records.
- Destructive and irreversible actions use clear confirmation and explain recovery.

### Demo and documentation

- Local demo starts without Live Server or external credentials, resets safely, and cannot contact real providers.
- Product blueprint, architecture, roadmap, user guide, administrator runbooks, and final presentation match implemented behavior.

## Core and advanced backlog

| Core release                                  | Advanced / conditional                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| Separate server and PracticeClient            | Commercial multi-tenancy and white-labelling               |
| RLS-preserving auth and scoped roles          | SSO, SCIM, customer-managed keys                           |
| Dashboard and drill-through                   | Custom BI/report designer                                  |
| Prospect, acceptance, client, engagement      | Marketing automation and lead scoring                      |
| Obligation/deadline engine                    | Direct regulator filing where authorised                   |
| Maker-checker assignments                     | Full audit workpaper suite                                 |
| Private documents and client portal           | OCR and AI extraction                                      |
| Invoicing, receipts, allocations, collections | Bank feeds, payment automation, cash forecasting           |
| Audit/idempotency/outbox/webhook controls     | Advanced anomaly and predictive models                     |
| Search, saved views, imports/exports          | Native mobile applications                                 |
| Local demo server                             | Multi-office offline/sync scenarios                        |
| Foundational time/cost capture if required    | Capacity, WIP, realisation, and profitability optimisation |

## Principal risks and mitigations

| Risk                                         | Mitigation                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Scope expands into full audit software       | Keep core scope at engagement coordination, evidence, review, and sign-off; require a separate product decision for workpaper authoring |
| RLS is bypassed by the server                | Default to user-scoped adapters; isolate and test every service-role handler                                                            |
| Direct and server writes diverge             | One authoritative writer per operation and route-level cutover flags; no dual writes                                                    |
| Dashboard numbers do not reconcile           | Canonical server measures, common `asOf`, fixture reconciliation, drill-through                                                         |
| Deadline rules become stale                  | Named content owner, version/source/effective dates, review reminders, controlled overrides                                             |
| Demo behavior drifts                         | Shared contract suite and same domain module; capturing provider adapters only                                                          |
| Financial migration corrupts balances        | Allocation and invoice control-total reconciliation before and after every rehearsal                                                    |
| Client portal leaks information              | Explicit grants, field-filtered read models, private storage, negative RLS tests                                                        |
| Provider outage blocks work                  | Transactional outbox, visible pending/failure states, retries, manual fallback                                                          |
| Profitability cannot be calculated later     | Decide early whether to capture time, effective cost rates, and assignment budgets                                                      |
| Legal or professional requirement is misread | Treat linked sources as inputs, assign professional review, and record the reviewed policy version                                      |

## Decisions still required

The following remain product-owner inputs, not implementation guesses:

1. Permanent single-firm product or future multi-firm SaaS?
2. Practice workflow only or eventual complete audit workpaper platform?
3. Exact launch services and authoritative deadline sources?
4. Does Client Tax Money represent controlled funds?
5. Client portal launch cohort and access approvers?
6. Invoice approval thresholds, numbering series, credit/write-off/reversal policy?
7. Existing data sources and migration history depth?
8. Required provider integrations and available credentials/eligibility?
9. Record-class retention, hosting region, RPO, RTO, and support expectations?
10. Whether time/cost capture is required from day one?
