import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  AssignmentDto,
  AssignmentStatus,
  ClientContactDto,
  ClientDocumentDto,
  ClientDto,
  ClientEntityType,
  ClientMessageDto,
  CreateClientContactInput,
  CreateDocumentInput,
  CreateEngagementDraftInput,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  CreateServiceInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  GenerateDueAssignmentsResult,
  InvoiceDto,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  PaymentReceiptDto,
  RecordClientMessageInput,
  RecordPaymentInput,
  RecordVyaparBillInput,
  RecurringScheduleDto,
  RemoveDocumentInput,
  ReportingLineDto,
  ReviseEngagementDraftInput,
  ServiceDto,
  SessionActor,
  UpdateClientContactInput,
  UpdateClientInput,
  UpdateRecurringScheduleInput,
  UpdateServiceInput,
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
  readonly entityType?: ClientEntityType | null;
  readonly addressLine1?: string | null;
  readonly addressLine2?: string | null;
  readonly city?: string | null;
  readonly state?: string | null;
  readonly pincode?: string | null;
  readonly tan?: string | null;
  readonly cinLlpin?: string | null;
  readonly udyamNumber?: string | null;
  readonly iec?: string | null;
  readonly incorporationDate?: string | null; // YYYY-MM-DD
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

// --- Client master commands (CLI-02a) ---

export type UpdateClientCommand = UpdateClientInput & {
  readonly id: string; // RFC 4122 UUID of the client
  readonly idempotencyKey: string;
};

export type CreateClientContactCommand = CreateClientContactInput & {
  readonly clientId: string; // RFC 4122 UUID of the client
  readonly idempotencyKey: string;
};

export type UpdateClientContactCommand = UpdateClientContactInput & {
  readonly id: string; // RFC 4122 UUID of the contact
  readonly idempotencyKey: string;
};

export function staleClient(): ApiError {
  return new ApiError(409, 'stale_client', 'This client was changed by someone else. Reload and try again.');
}

export function staleContact(): ApiError {
  return new ApiError(409, 'stale_contact', 'This contact was changed by someone else. Reload and try again.');
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

// --- Service list commands (SVC-01) ---

export type CreateServiceCommand = CreateServiceInput & { readonly idempotencyKey: string };
export type UpdateServiceCommand = UpdateServiceInput & {
  readonly id: string; // RFC 4122 UUID of the service
  readonly idempotencyKey: string;
};

export function duplicateService(name: string): ApiError {
  return new ApiError(409, 'duplicate_service', `A service named ${name} already exists.`);
}

export function staleService(): ApiError {
  return new ApiError(409, 'stale_service', 'This service was changed by someone else. Reload and try again.');
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

// --- Client document commands (DOC-01a) ---
// The repository generates the document id and the storage path inside the idempotent work, so a
// replay returns the stored result rather than a second pending record.

export type CreateDocumentCommand = CreateDocumentInput & { readonly idempotencyKey: string };
export interface ConfirmDocumentCommand {
  readonly id: string; // RFC 4122 UUID of the caller's own pending document
  readonly idempotencyKey: string;
}
export type RemoveDocumentCommand = RemoveDocumentInput & {
  readonly id: string; // RFC 4122 UUID of the document
  readonly idempotencyKey: string;
};

/** Keeps letters, digits, dot, dash and underscore; every other character becomes an underscore. */
export function safeDocumentFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Path of a document's file inside the private client-documents bucket. */
export function documentStoragePath(clientId: string, documentId: string, fileName: string): string {
  return `clients/${clientId}/${documentId}/${safeDocumentFileName(fileName)}`;
}

export function fileTooLarge(): ApiError {
  return new ApiError(422, 'file_too_large', 'The file is larger than 25 MB.');
}

export function fileTypeNotAllowed(): ApiError {
  return new ApiError(422, 'file_type_not_allowed', 'Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.');
}

export function uploadMissing(): ApiError {
  return new ApiError(422, 'upload_missing', 'The file has not finished uploading. Try again.');
}

export function alreadyRemoved(): ApiError {
  return new ApiError(422, 'already_removed', 'This document is already removed.');
}

export function documentNotConfirmable(): ApiError {
  return new ApiError(409, 'invalid_state_transition', 'This document is not waiting for its upload.');
}

export function documentNotRemovable(): ApiError {
  return new ApiError(409, 'invalid_state_transition', 'Only an uploaded document can be removed.');
}

// --- Client message commands (MSG-01) ---
// The application has already normalised recipientNumber to digits with the country code.

export type RecordClientMessageCommand = RecordClientMessageInput & { readonly idempotencyKey: string };

export function contactNotOfClient(): ApiError {
  return new ApiError(422, 'validation_failed', 'The contact does not belong to this client.');
}

export function linkedWorkNotOfClient(): ApiError {
  return new ApiError(422, 'validation_failed', 'The linked work does not belong to this client.');
}

export interface CrmRepository {
  // Clients
  getClient(ctx: RepositoryContext, clientId: string): Promise<ClientDto | null>;
  listClients(ctx: RepositoryContext): Promise<ClientDto[]>;
  createClient(ctx: RepositoryContext, record: CreateClientRecord): Promise<ClientDto>;
  // Client master (CLI-02a); writes are idempotent on (actor, key), except deleting a contact
  updateClient(ctx: RepositoryContext, command: UpdateClientCommand): Promise<ClientDto>;
  getClientIdForContact(ctx: RepositoryContext, contactId: string): Promise<string | null>;
  createClientContact(ctx: RepositoryContext, command: CreateClientContactCommand): Promise<ClientContactDto>;
  updateClientContact(ctx: RepositoryContext, command: UpdateClientContactCommand): Promise<ClientContactDto>;
  deleteClientContact(ctx: RepositoryContext, contactId: string): Promise<void>;

  // Client documents (DOC-01a); visibility and upload follow "looks after the client".
  // Writes are idempotent on (actor, key).
  listClientDocuments(ctx: RepositoryContext, clientId?: string): Promise<ClientDocumentDto[]>;
  createClientDocument(ctx: RepositoryContext, command: CreateDocumentCommand): Promise<ClientDocumentDto>;
  confirmClientDocument(ctx: RepositoryContext, command: ConfirmDocumentCommand): Promise<ClientDocumentDto>;
  removeClientDocument(ctx: RepositoryContext, command: RemoveDocumentCommand): Promise<ClientDocumentDto>;

  // Client messages (MSG-01); visibility and recording follow "looks after the client".
  // Newest first; recording is idempotent on (actor, key).
  listClientMessages(ctx: RepositoryContext, clientId?: string): Promise<ClientMessageDto[]>;
  recordClientMessage(ctx: RepositoryContext, command: RecordClientMessageCommand): Promise<ClientMessageDto>;

  // Reference Lookups (Repository-backed, split for SQL safety)
  getClientReference(ctx: RepositoryContext, clientId: string): Promise<ClientReference | null>;
  listClientReferences(ctx: RepositoryContext): Promise<ClientReference[]>;
  getServiceReferenceById(ctx: RepositoryContext, serviceId: string): Promise<ServiceReference | null>;
  getServiceReferenceByName(ctx: RepositoryContext, serviceName: string): Promise<ServiceReference | null>;
  listServiceReferences(ctx: RepositoryContext): Promise<ServiceReference[]>;

  // Service list management (SVC-01); writes are idempotent on (actor, key)
  listServiceCatalog(ctx: RepositoryContext): Promise<ServiceDto[]>;
  createService(ctx: RepositoryContext, command: CreateServiceCommand): Promise<ServiceDto>;
  updateService(ctx: RepositoryContext, command: UpdateServiceCommand): Promise<ServiceDto>;

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
