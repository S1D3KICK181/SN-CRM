import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  AssignmentDto,
  AssignmentStatus,
  ClientDto,
  CreateEngagementDraftInput,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  GenerateDueAssignmentsResult,
  InvoiceDto,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  PaymentReceiptDto,
  RecordPaymentInput,
  RecordVyaparBillInput,
  RecurringScheduleDto,
  ReportingLineDto,
  ReviseEngagementDraftInput,
  SessionActor,
  UpdateRecurringScheduleInput,
  WorkItemDto,
  WorkItemKind,
  WorkItemStatus,
} from '@sn/contracts';
import { ApiError } from './errors';

export interface EmployeeRecord extends SessionActor {
  readonly active: boolean;
  readonly email: string;
}

export interface RepositoryContext {
  readonly actorId: string; // Authenticated actor's RFC 4122 UUID
}

export interface DevActorDirectory {
  resolveDevActor(idOrAlias: string): Promise<EmployeeRecord | null>;
  listDevActors(): Promise<EmployeeRecord[]>;
}

// --- Reference Lookups ---

export interface ClientReference {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // CL-xxxxxx
  readonly name: string; // Legal/trade name
}

export interface ServiceReference {
  readonly id: string; // RFC 4122 UUID
  readonly name: string; // Catalog service name
}

// --- Granular Command Payloads ---

export interface CreateClientRecord {
  readonly id: string; // RFC 4122 UUID (pre-generated)
  readonly displayName: string;
  readonly legalName?: string | null;
  readonly pan?: string | null;
  readonly gstin?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly relationshipOwnerId?: string | null; // RFC 4122 UUID
  readonly notes?: string | null;
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

export interface CreateAssignmentRecord {
  readonly id: string; // RFC 4122 UUID (pre-generated)
  readonly clientId: string; // RFC 4122 UUID
  readonly clientName: string; // Resolved from repository reference
  readonly serviceId: string; // RFC 4122 UUID
  readonly service: string; // Resolved from catalog reference
  readonly title: string;
  readonly description?: string | null;
  readonly ownerId: string; // RFC 4122 UUID
  readonly reviewerIds: readonly string[]; // Atomically persisted
  readonly status: 'assigned' | 'draft'; // Literal legal initial status
  readonly dueAt: string; // ISO-8601 UTC
  readonly recurringScheduleId?: string | null;
  readonly engagementId?: string | null; // RFC 4122 UUID; validated by the application, enforced by the database
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

export interface UpdateAssignmentStatusCommand {
  readonly id: string; // RFC 4122 UUID
  readonly status: AssignmentStatus;
  readonly expectedUpdatedAt: string; // Optimistic concurrency verification (mandatory)
  readonly deliveryNotes?: string | null;
  readonly reviewNotes?: string | null;
  readonly progressPercent?: number;
}

export interface UpdateAssignmentReviewersCommand {
  readonly id: string; // RFC 4122 UUID
  readonly reviewerIds: readonly string[]; // RFC 4122 UUIDs
  readonly assignedBy: string; // Actor UUID
}

export interface UpdateAssignmentCommand {
  readonly id: string; // RFC 4122 UUID
  readonly title?: string;
  readonly description?: string | null;
  readonly serviceId?: string; // RFC 4122 UUID
  readonly service?: string;
  readonly ownerId?: string; // RFC 4122 UUID
  readonly reviewerIds?: readonly string[]; // RFC 4122 UUIDs
  readonly dueAt?: string; // ISO-8601 UTC
  readonly deliveryNotes?: string | null;
  readonly reviewNotes?: string | null;
  readonly progressPercent?: number;
  readonly expectedUpdatedAt: string; // Optimistic concurrency verification (mandatory)
  readonly actorId: string;
}

export interface CreateWorkItemRecord {
  readonly id: string; // RFC 4122 UUID (pre-generated)
  readonly kind: WorkItemKind;
  readonly title: string;
  readonly notes?: string | null;
  readonly assignmentId?: string | null; // RFC 4122 UUID
  readonly relatedClientId?: string | null; // RFC 4122 UUID
  readonly relatedPartyName?: string | null;
  readonly assigneeId: string; // RFC 4122 UUID
  readonly status: 'todo'; // Literal legal initial status
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly dueAt: string; // ISO-8601 UTC
  readonly reminderAt?: string | null; // ISO-8601 UTC
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

export interface UpdateWorkItemStatusCommand {
  readonly id: string; // RFC 4122 UUID
  readonly status: WorkItemStatus;
  readonly expectedUpdatedAt?: string; // Optimistic concurrency verification
  readonly notes?: string | null;
  readonly progressPercent?: number;
  readonly completionNote?: string | null;
}

// --- Engagement Mutation Command Union ---

export type MutateEngagementCommand =
  | ({
      readonly kind: 'createDraft';
      readonly idempotencyKey: string;
    } & CreateEngagementDraftInput)
  | ({
      readonly kind: 'reviseDraft';
      readonly idempotencyKey: string;
    } & ReviseEngagementDraftInput)
  | ({
      readonly kind: 'activate';
      readonly idempotencyKey: string;
    } & ActivateEngagementInput)
  | ({
      readonly kind: 'amend';
      readonly idempotencyKey: string;
    } & AmendActiveEngagementInput)
  | ({
      readonly kind: 'end';
      readonly idempotencyKey: string;
    } & EndEngagementInput);

// --- Vyapar bill and payment commands (FEE-01a) ---
// Stateful business rules (duplicate number, open bill, balance, void state) are enforced by the
// repositories inside the same transaction as the idempotency lookup, so a replay returns the stored
// result instead of re-running a check the first call already changed the answer to.

export type RecordVyaparBillCommand = RecordVyaparBillInput & { readonly idempotencyKey: string };
export type RecordPaymentCommand = RecordPaymentInput & { readonly idempotencyKey: string };
export interface VoidFeeRecordCommand {
  readonly id: string; // RFC 4122 UUID of the bill or payment receipt
  readonly reason: string;
  readonly idempotencyKey: string;
}

// --- Client credit commands (FEE-02a) ---

export interface ApplyCreditCommand {
  readonly invoiceId: string; // RFC 4122 UUID of the open bill
  readonly idempotencyKey: string;
}
export interface RemoveCreditAllocationCommand {
  readonly allocationId: string; // RFC 4122 UUID of a credit allocation
  readonly idempotencyKey: string;
}

/** Today's calendar date (YYYY-MM-DD) in Asia/Kolkata, matching the SQL read path. */
export function kolkataToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Financial year (April to March) in which a YYYY-MM-DD date falls, as its starting calendar year. */
export function financialYearStart(date: string): number {
  const year = Number.parseInt(date.slice(0, 4), 10);
  const month = Number.parseInt(date.slice(5, 7), 10);
  return month < 4 ? year - 1 : year;
}

/** Display label for a financial year, e.g. 2026–27. */
export function financialYearLabel(startYear: number): string {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function duplicateVyaparBill(vyaparBillNumber: string, billDate: string): ApiError {
  return new ApiError(
    409,
    'duplicate_vyapar_bill',
    `Vyapar bill ${vyaparBillNumber} is already recorded for ${financialYearLabel(financialYearStart(billDate))}.`,
  );
}

export function billNotOpen(): ApiError {
  return new ApiError(422, 'bill_not_open', 'This bill is already paid or cancelled.');
}

export function noCreditAvailable(): ApiError {
  return new ApiError(422, 'no_credit_available', 'This client has no credit to use.');
}

export function notCreditAllocation(): ApiError {
  return new ApiError(
    422,
    'not_credit_allocation',
    'This is a direct payment. Cancel the payment instead.',
  );
}

export function alreadyVoided(): ApiError {
  return new ApiError(422, 'already_voided', 'This record is already cancelled.');
}

export function billHasPayments(): ApiError {
  return new ApiError(422, 'bill_has_payments', 'Cancel the payments and remove any credit on this bill first.');
}

export interface CrmRepository {
  // Clients
  getClient(ctx: RepositoryContext, clientId: string): Promise<ClientDto | null>;
  listClients(ctx: RepositoryContext): Promise<ClientDto[]>;
  createClient(ctx: RepositoryContext, record: CreateClientRecord): Promise<ClientDto>;

  // Reference Lookups (Repository-backed, split for SQL safety)
  getClientReference(ctx: RepositoryContext, clientId: string): Promise<ClientReference | null>;
  listClientReferences(ctx: RepositoryContext): Promise<ClientReference[]>;
  getServiceReferenceById(ctx: RepositoryContext, serviceId: string): Promise<ServiceReference | null>;
  getServiceReferenceByName(ctx: RepositoryContext, serviceName: string): Promise<ServiceReference | null>;
  listServiceReferences(ctx: RepositoryContext): Promise<ServiceReference[]>;

  // Identity & Reporting Lines
  getEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null>;
  listEmployees(ctx: RepositoryContext): Promise<EmployeeRecord[]>;
  updateReportingLine(
    ctx: RepositoryContext,
    employeeId: string,
    supervisorId: string | null,
  ): Promise<ReportingLineDto>;

  // Assignments
  getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto | null>;
  listAssignments(ctx: RepositoryContext): Promise<AssignmentDto[]>;
  createAssignment(ctx: RepositoryContext, record: CreateAssignmentRecord): Promise<AssignmentDto>;
  updateAssignmentStatus(
    ctx: RepositoryContext,
    command: UpdateAssignmentStatusCommand,
  ): Promise<AssignmentDto>;
  updateAssignmentReviewers(
    ctx: RepositoryContext,
    command: UpdateAssignmentReviewersCommand,
  ): Promise<AssignmentDto>;
  updateAssignment(
    ctx: RepositoryContext,
    command: UpdateAssignmentCommand,
  ): Promise<AssignmentDto>;

  // Work Items
  getWorkItem(ctx: RepositoryContext, id: string): Promise<WorkItemDto | null>;
  listWorkItems(ctx: RepositoryContext): Promise<WorkItemDto[]>;
  createWorkItem(ctx: RepositoryContext, record: CreateWorkItemRecord): Promise<WorkItemDto>;
  updateWorkItemStatus(
    ctx: RepositoryContext,
    command: UpdateWorkItemStatusCommand,
  ): Promise<WorkItemDto>;

  // Recurring Schedules
  getRecurringSchedule(ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null>;
  listRecurringSchedules(ctx: RepositoryContext): Promise<RecurringScheduleDto[]>;
  createRecurringSchedule(
    ctx: RepositoryContext,
    input: CreateRecurringScheduleInput & { id: string; createdById: string; code?: string; clientName: string; service: string },
  ): Promise<RecurringScheduleDto>;
  updateRecurringSchedule(
    ctx: RepositoryContext,
    id: string,
    input: UpdateRecurringScheduleInput,
  ): Promise<RecurringScheduleDto>;
  materializeDueAssignments(
    ctx: RepositoryContext,
    throughDate: string,
  ): Promise<GenerateDueAssignmentsResult>;

  // Engagements (ENG-01)
  getEngagement(ctx: RepositoryContext, id: string): Promise<EngagementDto | null>;
  listEngagements(ctx: RepositoryContext): Promise<EngagementDto[]>;
  listEngagementVersions(ctx: RepositoryContext, engagementId: string): Promise<EngagementVersionDto[]>;
  mutateEngagement(ctx: RepositoryContext, command: MutateEngagementCommand): Promise<EngagementDto>;

  // Billing (BIL-01a, read-only)
  listInvoices(ctx: RepositoryContext): Promise<InvoiceDto[]>;
  listPaymentReceipts(ctx: RepositoryContext): Promise<PaymentReceiptDto[]>;

  // Vyapar bills and payments (FEE-01a); every mutation is idempotent on (actor, key)
  recordVyaparBill(ctx: RepositoryContext, command: RecordVyaparBillCommand): Promise<InvoiceDto>;
  recordPayment(ctx: RepositoryContext, command: RecordPaymentCommand): Promise<PaymentReceiptDto>;
  voidInvoice(ctx: RepositoryContext, command: VoidFeeRecordCommand): Promise<InvoiceDto>;
  voidPaymentReceipt(ctx: RepositoryContext, command: VoidFeeRecordCommand): Promise<PaymentReceiptDto>;

  // Client credit (FEE-02a): the unallocated part of received payment receipts
  applyCredit(ctx: RepositoryContext, command: ApplyCreditCommand): Promise<InvoiceDto>;
  removeCreditAllocation(ctx: RepositoryContext, command: RemoveCreditAllocationCommand): Promise<InvoiceDto>;

  // Office Accounts & Ledger
  getOfficeAccountsSummary(ctx: RepositoryContext): Promise<OfficeAccountsSummaryDto>;
  listLedgerEntries(ctx: RepositoryContext): Promise<LedgerEntryDto[]>;
  createLedgerEntry(
    ctx: RepositoryContext,
    input: CreateLedgerEntryInput & { id: string; recordedById: string },
  ): Promise<LedgerEntryDto>;
}

export type CrmApplicationDependencies = CrmRepository & DevActorDirectory;
