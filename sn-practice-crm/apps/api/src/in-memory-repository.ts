import { DOCUMENT_CATEGORIES, DOCUMENT_MAX_BYTES, MESSAGE_PURPOSES } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type {
  AssignmentDto,
  AssignmentStatus,
  ClientContactDto,
  ClientDocumentDto,
  ClientDto,
  ClientMessageDto,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  DepartmentDto,
  EngagementDto,
  EngagementVersionDto,
  FeesByClientRowDto,
  GenerateDueAssignmentsResult,
  InvoiceDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceStatus,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  PaymentAllocationDto,
  PaymentAllocationSource,
  PaymentMethod,
  PaymentReceiptDto,
  PaymentReceiptStatus,
  RecurringScheduleDto,
  ReportPeriodDto,
  ReportingLineDto,
  ServiceDto,
  UpdateRecurringScheduleInput,
  WorkItemDto,
} from '@sn/contracts';
import { ApiError, notFound } from './errors';
import { maskGstinForRoutineRead, maskPanForRoutineRead } from './client-privacy';
import { computeRequestHash } from './idempotency';
import type {
  ApplyCreditCommand,
  ClientReference,
  ConfirmDocumentCommand,
  CreateAssignmentRecord,
  CreateClientContactCommand,
  CreateClientRecord,
  CreateDepartmentCommand,
  CreateDocumentCommand,
  CreateServiceCommand,
  CreateWorkItemRecord,
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
  MutateEngagementCommand,
  PracticeReportBody,
  RecordClientMessageCommand,
  RecordPaymentCommand,
  RecordVyaparBillCommand,
  RemoveCreditAllocationCommand,
  RemoveDocumentCommand,
  RepositoryContext,
  ServiceReference,
  SetDepartmentMembersCommand,
  UpdateAssignmentCommand,
  UpdateAssignmentReviewersCommand,
  UpdateAssignmentStatusCommand,
  UpdateClientCommand,
  UpdateClientContactCommand,
  UpdateDepartmentCommand,
  UpdateServiceCommand,
  UpdateWorkItemStatusCommand,
  VoidFeeRecordCommand,
} from './repository';
import {
  alreadyRemoved,
  alreadyVoided,
  billHasPayments,
  billNotOpen,
  contactNotOfClient,
  departmentNotFound,
  documentNotConfirmable,
  documentNotRemovable,
  documentStoragePath,
  duplicateDepartment,
  duplicateService,
  duplicateVyaparBill,
  fileTooLarge,
  financialYearStart,
  kolkataToday,
  linkedWorkNotOfClient,
  noCreditAvailable,
  notCreditAllocation,
  staleClient,
  staleContact,
  staleDepartment,
  staleService,
  traineeCannotHead,
  uploadMissing,
} from './repository';

/** A catalog service. Seeds may give just id and name; the rest default to an active, plain service. */
export interface ServiceSeedRecord extends ServiceReference {
  description?: string | null;
  turnaroundDays?: number | null;
  isStatutory?: boolean;
  isActive?: boolean;
  departmentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

type ServiceRecord = Omit<ServiceDto, 'usage' | 'departmentName'>;

/** A department. Seeds may give just id and name; the rest default to an active department with no members. */
export interface DepartmentSeedRecord {
  id: string;
  name: string;
  isActive?: boolean;
  members?: { userId: string; isHead?: boolean }[];
  createdAt?: string;
  updatedAt?: string;
}

interface DepartmentRecord {
  id: string;
  name: string;
  isActive: boolean;
  members: { userId: string; isHead: boolean }[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredOperationReceipt {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly operationType: string;
  readonly requestHash: string;
  readonly result: unknown;
  readonly createdAt: string;
}

type ClientDetailKey =
  | 'entityType'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'pincode'
  | 'tan'
  | 'cinLlpin'
  | 'udyamNumber'
  | 'iec'
  | 'incorporationDate';

type ContactRecord = { -readonly [K in keyof ClientContactDto]: ClientContactDto[K] };

/** A document row; the client and uploader names are joined in when it is read. */
type DocumentRecord = {
  -readonly [K in keyof Omit<ClientDocumentDto, 'clientCode' | 'clientName' | 'uploadedByName'>]: ClientDocumentDto[K];
};

/** A message row; the client, work and sender names are joined in when it is read. */
type MessageRecord = {
  -readonly [K in keyof Omit<
    ClientMessageDto,
    'clientCode' | 'clientName' | 'assignmentCode' | 'invoiceLabel' | 'sentByName'
  >]: ClientMessageDto[K];
};

/** A client row. The CLI-02a detail fields and contacts are optional so older seeds stay valid. */
export type ClientSeedRecord = Omit<
  ClientDto,
  | 'relationshipOwnerName'
  | 'activeAssignmentsCount'
  | 'panMasked'
  | 'gstinMasked'
  | 'canEdit'
  | 'canChangeOwnerOrStatus'
  | 'looksAfter'
  | 'contacts'
  | ClientDetailKey
> &
  Partial<Pick<ClientDto, ClientDetailKey>> & {
    pan: string | null;
    gstin: string | null;
    contacts?: ContactRecord[];
  };

export interface InvoiceSeedRecord {
  id: string;
  code: string;
  vyaparBillNumber?: string | null;
  clientId: string;
  assignmentId: string | null;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  notes: string | null;
  issuedAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  items: InvoiceItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAllocationSeedRecord {
  id: string;
  invoiceId: string;
  amountPaise: number;
  source: PaymentAllocationSource;
}

export interface PaymentReceiptSeedRecord {
  id: string;
  code: string;
  clientId: string;
  receivedOn: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentReceiptStatus;
  voidReason: string | null;
  voidedAt: string | null;
  allocations: PaymentAllocationSeedRecord[];
  createdAt: string;
}

export interface DemoSeed {
  employees: EmployeeRecord[];
  clients: ClientSeedRecord[];
  services?: ServiceSeedRecord[];
  departments?: DepartmentSeedRecord[];
  assignments: AssignmentDto[];
  recurringSchedules: RecurringScheduleDto[];
  workItems: WorkItemDto[];
  ledgerEntries: LedgerEntryDto[];
  invoices?: InvoiceSeedRecord[];
  paymentReceipts?: PaymentReceiptSeedRecord[];
}

export interface InMemoryRepositoryOptions {
  readonly now?: () => Date;
}

// Kept as a re-export so existing imports from this module keep working.
export { kolkataToday };

function wholeDaysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86400000);
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

const DEV_ACTOR_ALIASES: Record<string, string> = {
  usr_founder: '00000000-0000-4000-a000-000000000001',
  usr_manager: '00000000-0000-4000-a000-000000000002',
  usr_senior: '00000000-0000-4000-a000-000000000003',
  usr_staff: '00000000-0000-4000-a000-000000000004',
  usr_trainee: '00000000-0000-4000-a000-000000000005',
};

const DEFAULT_SERVICES: readonly ServiceSeedRecord[] = [
  { id: '50000000-0000-4000-a000-000000000001', name: 'GST Compliance' },
  { id: '50000000-0000-4000-a000-000000000002', name: 'Internal Audit' },
  { id: '50000000-0000-4000-a000-000000000003', name: 'Tax Compliance (TDS)' },
  { id: '50000000-0000-4000-a000-000000000004', name: 'Bookkeeping & Accounts' },
  { id: '50000000-0000-4000-a000-000000000005', name: 'Statutory Audit' },
  { id: '50000000-0000-4000-a000-000000000006', name: 'Direct Tax Advisory' },
];

function clampOccurrenceDate(origYear: number, origMonth1: number, origDay: number, monthsToAdd: number): string {
  const totalMonths = origYear * 12 + (origMonth1 - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth1 = (totalMonths % 12) + 1;
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth1, 0)).getUTCDate();
  const clampedDay = Math.min(origDay, daysInMonth);
  return `${targetYear}-${String(targetMonth1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

function calculateRecurrenceDates(
  occurrence: string,
  cadence: 'monthly' | 'quarterly' | 'annual',
  dueOffsetDays: number,
): { nextOccurrence: string; periodEnd: string; dueAt: string } {
  const months = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12;
  const parts = occurrence.split('-');
  const y = Number.parseInt(parts[0] ?? '0', 10);
  const m = Number.parseInt(parts[1] ?? '1', 10);
  const d = Number.parseInt(parts[2] ?? '1', 10);

  const nextOccurrence = clampOccurrenceDate(y, m, d, months);
  const nextOccurDate = new Date(`${nextOccurrence}T00:00:00.000Z`);
  const periodEndDate = new Date(nextOccurDate.getTime() - 86400000);
  const periodEnd = periodEndDate.toISOString().slice(0, 10);

  const dueDate = new Date(periodEndDate.getTime() + dueOffsetDays * 86400000);
  const dueDateStr = dueDate.toISOString().slice(0, 10);
  const dueAt = `${dueDateStr}T18:29:00.000Z`;

  return { nextOccurrence, periodEnd, dueAt };
}

/** Primary contact first, then by name. */
function compareContacts(a: ClientContactDto, b: ClientContactDto): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  return (
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

export class InMemoryCrmRepository implements CrmRepository, DevActorDirectory {
  private readonly employees = new Map<string, EmployeeRecord>();
  private readonly clients = new Map<string, ClientSeedRecord>();
  private readonly services = new Map<string, ServiceRecord>();
  private readonly departments = new Map<string, DepartmentRecord>();
  private readonly assignments = new Map<string, AssignmentDto>();
  private readonly schedules = new Map<string, RecurringScheduleDto>();
  private readonly workItems = new Map<string, WorkItemDto>();
  private readonly ledgerEntries = new Map<string, LedgerEntryDto>();
  private readonly engagements = new Map<string, EngagementDto>();
  private readonly engagementVersions = new Map<string, EngagementVersionDto[]>();
  private readonly operationReceipts = new Map<string, StoredOperationReceipt>();
  private readonly documents: DocumentRecord[] = [];
  private readonly messages: MessageRecord[] = [];
  private readonly uploadedObjects = new Map<string, number>(); // Simulated Storage: path to size in bytes
  private readonly invoiceSeeds: InvoiceSeedRecord[];
  private readonly paymentReceipts: PaymentReceiptSeedRecord[];
  private readonly now: () => Date;

  private assignmentCounter = 1000;
  private workItemCounter = 1000;
  private scheduleCounter = 1000;
  private clientCounter = 1000;
  private engagementCounter = 1000;
  private invoiceCounter = 1000;
  private receiptCounter = 1000;

  constructor(seed: DemoSeed, options: InMemoryRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.invoiceSeeds = copy(seed.invoices ?? []);
    this.paymentReceipts = copy(seed.paymentReceipts ?? []);
    for (const invoice of this.invoiceSeeds) {
      const num = Number.parseInt(invoice.code.match(/INV-(\d+)/)?.[1] ?? '', 10);
      if (!Number.isNaN(num) && num > this.invoiceCounter) this.invoiceCounter = num;
    }
    for (const receipt of this.paymentReceipts) {
      const num = Number.parseInt(receipt.code.match(/RCT-(\d+)/)?.[1] ?? '', 10);
      if (!Number.isNaN(num) && num > this.receiptCounter) this.receiptCounter = num;
    }
    seed.employees.forEach((value) => this.employees.set(value.id, copy(value)));

    seed.clients.forEach((value) => {
      this.clients.set(value.id, copy(value));
      const match = value.code?.match(/CL-(\d+)/);
      if (match?.[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > this.clientCounter) {
          this.clientCounter = num;
        }
      }
    });

    const servicesToLoad = seed.services ?? DEFAULT_SERVICES;
    const seededAt = this.now().toISOString();
    servicesToLoad.forEach((value) =>
      this.services.set(value.id, {
        id: value.id,
        name: value.name,
        description: value.description ?? null,
        turnaroundDays: value.turnaroundDays ?? null,
        isStatutory: value.isStatutory ?? false,
        isActive: value.isActive ?? true,
        departmentId: value.departmentId ?? null,
        createdAt: value.createdAt ?? seededAt,
        updatedAt: value.updatedAt ?? seededAt,
      }),
    );
    (seed.departments ?? []).forEach((value) =>
      this.departments.set(value.id, {
        id: value.id,
        name: value.name,
        isActive: value.isActive ?? true,
        members: (value.members ?? []).map((member) => ({ userId: member.userId, isHead: member.isHead ?? false })),
        createdAt: value.createdAt ?? seededAt,
        updatedAt: value.updatedAt ?? seededAt,
      }),
    );

    seed.assignments.forEach((value) => {
      this.assignments.set(value.id, copy(value));
      const match = value.code.match(/(?:AS|ASN)-(\d+)/);
      if (match?.[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > this.assignmentCounter) {
          this.assignmentCounter = num;
        }
      }
    });

    seed.recurringSchedules.forEach((value) => {
      this.schedules.set(value.id, copy(value));
      const match = value.code?.match(/RS-(\d+)/);
      if (match?.[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > this.scheduleCounter) {
          this.scheduleCounter = num;
        }
      }
    });

    seed.workItems.forEach((value) => {
      this.workItems.set(value.id, copy(value));
      const match = value.code?.match(/WI-(\d+)/);
      if (match?.[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > this.workItemCounter) {
          this.workItemCounter = num;
        }
      }
    });

    seed.ledgerEntries.forEach((value) => this.ledgerEntries.set(value.id, copy(value)));
  }

  // --- DevActorDirectory (Bootstrap) ---

  async resolveDevActor(idOrAlias: string): Promise<EmployeeRecord | null> {
    const resolvedId = DEV_ACTOR_ALIASES[idOrAlias] ?? idOrAlias;
    const value = this.employees.get(resolvedId);
    return value ? copy(value) : null;
  }

  async listDevActors(): Promise<EmployeeRecord[]> {
    return copy([...this.employees.values()]);
  }

  // --- Dev / Test Bootstrap Helper (Concrete InMemory only) ---

  async upsertDevActor(employee: EmployeeRecord): Promise<EmployeeRecord> {
    this.employees.set(employee.id, copy(employee));
    return copy(this.employees.get(employee.id)!);
  }

  // --- Private Helpers: Actor & Visibility (Postgres parity) ---

  private getActor(ctx: RepositoryContext): EmployeeRecord | null {
    const actor = this.employees.get(ctx.actorId);
    if (!actor || !actor.active) {
      return null;
    }
    return actor;
  }

  private isManagement(actor: EmployeeRecord): boolean {
    return actor.role === 'founder' || actor.role === 'manager';
  }

  private hasAssignmentInvolvement(actor: EmployeeRecord, assignment: AssignmentDto): boolean {
    if (this.isManagement(actor)) {
      return true;
    }
    if (assignment.ownerId === actor.id) {
      return true;
    }
    if (assignment.reviewerIds.includes(actor.id)) {
      return true;
    }
    for (const workItem of this.workItems.values()) {
      if (workItem.assignmentId === assignment.id) {
        if (workItem.assigneeId === actor.id || workItem.createdById === actor.id) {
          return true;
        }
      }
    }
    return false;
  }

  // Mirrors user_heads_department_of_assignment: a head-flagged member of the ACTIVE department of the
  // assignment's service. Trainees never count. Read access only; nothing here grants a write right.
  private headsDepartmentOfAssignment(actor: EmployeeRecord, assignment: AssignmentDto): boolean {
    if (actor.role === 'trainee') return false;
    const departmentId = this.services.get(assignment.serviceId)?.departmentId;
    if (!departmentId) return false;
    const department = this.departments.get(departmentId);
    return department?.isActive === true && department.members.some((m) => m.userId === actor.id && m.isHead);
  }

  // Mirrors user_can_read_assignment, used wherever Postgres relies on the assignment select policy.
  private canReadAssignment(actor: EmployeeRecord, assignment: AssignmentDto): boolean {
    return this.hasAssignmentInvolvement(actor, assignment) || this.headsDepartmentOfAssignment(actor, assignment);
  }

  // Mirrors user_can_read_client, used wherever Postgres relies on the clients select policy.
  private isClientReadable(actor: EmployeeRecord, client: ClientSeedRecord): boolean {
    if (this.isClientVisible(actor, client)) return true;
    for (const assignment of this.assignments.values()) {
      if (assignment.clientId === client.id && this.headsDepartmentOfAssignment(actor, assignment)) return true;
    }
    return false;
  }

  private isClientVisible(actor: EmployeeRecord, client: ClientSeedRecord): boolean {
    if (this.isManagement(actor)) {
      return true;
    }
    if (client.relationshipOwnerId === actor.id) {
      return true;
    }
    for (const assignment of this.assignments.values()) {
      if (assignment.clientId === client.id && this.hasAssignmentInvolvement(actor, assignment)) {
        return true;
      }
    }
    for (const workItem of this.workItems.values()) {
      if (
        workItem.kind === 'personal' &&
        workItem.relatedClientId === client.id &&
        workItem.assigneeId === actor.id
      ) {
        return true;
      }
    }
    return false;
  }

  private toClientDto(actor: EmployeeRecord, client: ClientSeedRecord): ClientDto {
    let relationshipOwnerName: string | null = null;
    if (client.relationshipOwnerId) {
      const owner = this.employees.get(client.relationshipOwnerId);
      relationshipOwnerName = owner ? owner.name : null;
    }

    const looksAfter = this.isFeeVisible(actor, client.id);
    let activeAssignmentsCount = 0;
    for (const assignment of this.assignments.values()) {
      if (
        assignment.clientId === client.id &&
        assignment.status !== 'closed' &&
        assignment.status !== 'cancelled' &&
        this.canReadAssignment(actor, assignment)
      ) {
        activeAssignmentsCount += 1;
      }
    }

    return {
      id: client.id,
      code: client.code,
      displayName: client.displayName,
      legalName: client.legalName,
      gstinMasked: maskGstinForRoutineRead(client.gstin),
      panMasked: maskPanForRoutineRead(client.pan),
      // Full values only for readers who look after the client; null for everyone else
      pan: looksAfter ? client.pan : null,
      gstin: looksAfter ? client.gstin : null,
      email: client.email,
      phone: client.phone,
      relationshipOwnerId: client.relationshipOwnerId,
      relationshipOwnerName,
      status: client.status,
      notes: client.notes,
      entityType: client.entityType ?? null,
      addressLine1: client.addressLine1 ?? null,
      addressLine2: client.addressLine2 ?? null,
      city: client.city ?? null,
      state: client.state ?? null,
      pincode: client.pincode ?? null,
      tan: client.tan ?? null,
      cinLlpin: client.cinLlpin ?? null,
      udyamNumber: client.udyamNumber ?? null,
      iec: client.iec ?? null,
      incorporationDate: client.incorporationDate ?? null,
      contacts: [...(client.contacts ?? [])].sort(compareContacts),
      canEdit: this.canEditClient(actor, client),
      canChangeOwnerOrStatus: this.isManagement(actor),
      looksAfter,
      activeAssignmentsCount,
      createdById: client.createdById,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  // 'visible' is client_visible (contacts, identifiers); 'readable' is the clients select policy, which also
  // lets a department head read the client row of their department's work.
  private getVisibleClientRecord(
    ctx: RepositoryContext,
    clientId: string,
    scope: 'visible' | 'readable' = 'visible',
  ): { actor: EmployeeRecord; client: ClientSeedRecord } | null {
    const actor = this.getActor(ctx);
    if (!actor) {
      return null;
    }
    const client = this.clients.get(clientId);
    if (!client || !(scope === 'readable' ? this.isClientReadable(actor, client) : this.isClientVisible(actor, client))) {
      return null;
    }
    return { actor, client };
  }

  private getVisibleClientRecords(
    ctx: RepositoryContext,
    scope: 'visible' | 'readable' = 'visible',
  ): { actor: EmployeeRecord; clients: ClientSeedRecord[] } | null {
    const actor = this.getActor(ctx);
    if (!actor) {
      return null;
    }
    const clients: ClientSeedRecord[] = [];
    for (const client of this.clients.values()) {
      if (scope === 'readable' ? this.isClientReadable(actor, client) : this.isClientVisible(actor, client)) {
        clients.push(client);
      }
    }
    clients.sort((a, b) => a.code.localeCompare(b.code));
    return { actor, clients };
  }

  // --- Clients (Read-Only) ---

  async getClient(ctx: RepositoryContext, clientId: string): Promise<ClientDto | null> {
    const match = this.getVisibleClientRecord(ctx, clientId, 'readable');
    if (!match) {
      return null;
    }
    return copy(this.toClientDto(match.actor, match.client));
  }

  async listClients(ctx: RepositoryContext): Promise<ClientDto[]> {
    const result = this.getVisibleClientRecords(ctx, 'readable');
    if (!result) {
      return [];
    }
    return copy(result.clients.map((c) => this.toClientDto(result.actor, c)));
  }

  async createClient(ctx: RepositoryContext, record: CreateClientRecord): Promise<ClientDto> {
    const actor = this.getActor(ctx);
    if (!actor) {
      throw new ApiError(401, 'unauthorized', 'Unknown actor');
    }
    if (!this.isManagement(actor)) {
      throw new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
    }
    if (this.clients.has(record.id)) {
      throw new ApiError(409, 'conflict', 'A record with this identifier already exists.');
    }
    if (record.relationshipOwnerId) {
      const owner = this.employees.get(record.relationshipOwnerId);
      if (!owner) {
        throw new ApiError(422, 'referenced_entity_not_found', 'The referenced entity does not exist.');
      }
      if (!owner.active || owner.role === 'trainee') {
        throw new ApiError(
          422,
          'validation_failed',
          'A Client relationship owner must be active and cannot be a Trainee.',
        );
      }
    }

    this.clientCounter += 1;
    let code = `CL-${String(this.clientCounter).padStart(6, '0')}`;
    while ([...this.clients.values()].some((c) => c.code === code)) {
      this.clientCounter += 1;
      code = `CL-${String(this.clientCounter).padStart(6, '0')}`;
    }

    const seedRecord: ClientSeedRecord = {
      id: record.id,
      code,
      displayName: record.displayName,
      legalName: record.legalName ?? null,
      pan: record.pan ?? null,
      gstin: record.gstin ?? null,
      email: record.email ?? null,
      phone: record.phone ?? null,
      relationshipOwnerId: record.relationshipOwnerId ?? null,
      status: 'active',
      notes: record.notes ?? null,
      entityType: record.entityType ?? null,
      addressLine1: record.addressLine1 ?? null,
      addressLine2: record.addressLine2 ?? null,
      city: record.city ?? null,
      state: record.state ?? null,
      pincode: record.pincode ?? null,
      tan: record.tan ?? null,
      cinLlpin: record.cinLlpin ?? null,
      udyamNumber: record.udyamNumber ?? null,
      iec: record.iec ?? null,
      incorporationDate: record.incorporationDate ?? null,
      contacts: [],
      createdById: actor.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };

    this.clients.set(seedRecord.id, copy(seedRecord));
    return copy(this.toClientDto(actor, seedRecord));
  }

  // --- Client master (CLI-02a) ---

  // Mirrors can_edit_client: management, or the client's relationship owner.
  private canEditClient(actor: EmployeeRecord, client: ClientSeedRecord): boolean {
    return this.isManagement(actor) || client.relationshipOwnerId === actor.id;
  }

  // Finds a contact the actor can see, with its client. A contact on a client the actor cannot see does not exist.
  private findVisibleContact(
    ctx: RepositoryContext,
    contactId: string,
  ): { actor: EmployeeRecord; client: ClientSeedRecord; contact: ContactRecord } | null {
    for (const client of this.clients.values()) {
      const contact = (client.contacts ?? []).find((candidate) => candidate.id === contactId);
      if (!contact) continue;
      const match = this.getVisibleClientRecord(ctx, client.id);
      return match ? { actor: match.actor, client: match.client, contact } : null;
    }
    return null;
  }

  async updateClient(ctx: RepositoryContext, command: UpdateClientCommand): Promise<ClientDto> {
    const { idempotencyKey, ...payload } = command;
    const { id } = this.runIdempotent<{ id: string }>(ctx, idempotencyKey, 'updateClient', payload, () => {
      const match = this.getVisibleClientRecord(ctx, command.id, 'readable');
      if (!match) throw notFound('Client');
      const { actor, client } = match;
      if (!this.canEditClient(actor, client)) throw this.forbiddenOperation();
      if (Date.parse(client.updatedAt) !== Date.parse(command.expectedUpdatedAt)) throw staleClient();
      if (
        !this.isManagement(actor) &&
        ((command.relationshipOwnerId !== undefined && command.relationshipOwnerId !== client.relationshipOwnerId) ||
          (command.status !== undefined && command.status !== client.status))
      ) {
        throw this.forbiddenOperation();
      }
      if (command.relationshipOwnerId) {
        const owner = this.employees.get(command.relationshipOwnerId);
        if (!owner) {
          throw new ApiError(422, 'referenced_entity_not_found', 'The referenced entity does not exist.');
        }
        if (!owner.active || owner.role === 'trainee') {
          throw new ApiError(
            422,
            'validation_failed',
            'A Client relationship owner must be active and cannot be a Trainee.',
          );
        }
      }

      const updated: ClientSeedRecord = {
        ...client,
        displayName: command.displayName ?? client.displayName,
        legalName: command.legalName !== undefined ? command.legalName : client.legalName,
        pan: command.pan !== undefined ? command.pan : client.pan,
        gstin: command.gstin !== undefined ? command.gstin : client.gstin,
        email: command.email !== undefined ? command.email : client.email,
        phone: command.phone !== undefined ? command.phone : client.phone,
        relationshipOwnerId:
          command.relationshipOwnerId !== undefined ? command.relationshipOwnerId : client.relationshipOwnerId,
        status: command.status ?? client.status,
        notes: command.notes !== undefined ? command.notes : client.notes,
        entityType: command.entityType !== undefined ? command.entityType : (client.entityType ?? null),
        addressLine1: command.addressLine1 !== undefined ? command.addressLine1 : (client.addressLine1 ?? null),
        addressLine2: command.addressLine2 !== undefined ? command.addressLine2 : (client.addressLine2 ?? null),
        city: command.city !== undefined ? command.city : (client.city ?? null),
        state: command.state !== undefined ? command.state : (client.state ?? null),
        pincode: command.pincode !== undefined ? command.pincode : (client.pincode ?? null),
        tan: command.tan !== undefined ? command.tan : (client.tan ?? null),
        cinLlpin: command.cinLlpin !== undefined ? command.cinLlpin : (client.cinLlpin ?? null),
        udyamNumber: command.udyamNumber !== undefined ? command.udyamNumber : (client.udyamNumber ?? null),
        iec: command.iec !== undefined ? command.iec : (client.iec ?? null),
        incorporationDate:
          command.incorporationDate !== undefined ? command.incorporationDate : (client.incorporationDate ?? null),
        updatedAt: this.now().toISOString(),
      };
      this.clients.set(updated.id, updated);
      return { result: { id: updated.id } };
    });
    const actor = this.getActor(ctx);
    const stored = this.clients.get(id);
    if (!actor || !stored) throw notFound('Client');
    return copy(this.toClientDto(actor, stored));
  }

  async getClientIdForContact(ctx: RepositoryContext, contactId: string): Promise<string | null> {
    return this.findVisibleContact(ctx, contactId)?.client.id ?? null;
  }

  async createClientContact(ctx: RepositoryContext, command: CreateClientContactCommand): Promise<ClientContactDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ClientContactDto>(ctx, idempotencyKey, 'createClientContact', payload, () => {
      const match = this.getVisibleClientRecord(ctx, command.clientId, 'readable');
      if (!match) throw notFound('Client');
      if (!this.canEditClient(match.actor, match.client)) throw this.forbiddenOperation();
      const contacts = match.client.contacts ?? [];
      if (command.isPrimary === true) {
        for (const existing of contacts) existing.isPrimary = false;
      }
      const contact: ContactRecord = {
        id: crypto.randomUUID(),
        name: command.name,
        designation: command.designation ?? null,
        email: command.email ?? null,
        phone: command.phone ?? null,
        whatsapp: command.whatsapp ?? null,
        isPrimary: command.isPrimary === true,
        notes: command.notes ?? null,
        updatedAt: this.now().toISOString(),
      };
      contacts.push(contact);
      match.client.contacts = contacts;
      return { result: contact };
    });
  }

  async updateClientContact(ctx: RepositoryContext, command: UpdateClientContactCommand): Promise<ClientContactDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ClientContactDto>(ctx, idempotencyKey, 'updateClientContact', payload, () => {
      const match = this.findVisibleContact(ctx, command.id);
      if (!match) throw notFound('Contact');
      if (!this.canEditClient(match.actor, match.client)) throw this.forbiddenOperation();
      if (Date.parse(match.contact.updatedAt) !== Date.parse(command.expectedUpdatedAt)) throw staleContact();
      if (command.isPrimary === true) {
        for (const other of match.client.contacts ?? []) {
          if (other.id !== match.contact.id) other.isPrimary = false;
        }
      }
      const contact = match.contact;
      if (command.name !== undefined) contact.name = command.name;
      if (command.designation !== undefined) contact.designation = command.designation;
      if (command.email !== undefined) contact.email = command.email;
      if (command.phone !== undefined) contact.phone = command.phone;
      if (command.whatsapp !== undefined) contact.whatsapp = command.whatsapp;
      if (command.isPrimary !== undefined) contact.isPrimary = command.isPrimary;
      if (command.notes !== undefined) contact.notes = command.notes;
      contact.updatedAt = this.now().toISOString();
      return { result: copy(contact) };
    });
  }

  async deleteClientContact(ctx: RepositoryContext, contactId: string): Promise<void> {
    const match = this.findVisibleContact(ctx, contactId);
    if (!match) throw notFound('Contact');
    if (!this.canEditClient(match.actor, match.client)) throw this.forbiddenOperation();
    match.client.contacts = (match.client.contacts ?? []).filter((candidate) => candidate.id !== contactId);
    // Recorded messages keep their recipient snapshot; only the link to the deleted contact goes (on delete set null)
    for (const message of this.messages) {
      if (message.contactId === contactId) message.contactId = null;
    }
  }

  // --- Reference Lookups ---

  async getClientReference(ctx: RepositoryContext, clientId: string): Promise<ClientReference | null> {
    const match = this.getVisibleClientRecord(ctx, clientId, 'readable');
    if (!match) {
      return null;
    }
    return {
      id: match.client.id,
      code: match.client.code,
      name: match.client.displayName,
    };
  }

  async listClientReferences(ctx: RepositoryContext): Promise<ClientReference[]> {
    const result = this.getVisibleClientRecords(ctx, 'readable');
    if (!result) {
      return [];
    }
    return copy(
      result.clients
        .filter((c) => c.status === 'active')
        .map((c) => ({
          id: c.id,
          code: c.code,
          name: c.displayName,
        })),
    );
  }

  async getServiceReferenceById(_ctx: RepositoryContext, serviceId: string): Promise<ServiceReference | null> {
    // Only active services can be chosen for new or changed work, matching Postgres.
    const value = this.services.get(serviceId);
    return value && value.isActive ? { id: value.id, name: value.name } : null;
  }

  async getServiceReferenceByName(_ctx: RepositoryContext, serviceName: string): Promise<ServiceReference | null> {
    const normalized = serviceName.trim().toLowerCase();
    for (const service of this.services.values()) {
      if (service.isActive && service.name.trim().toLowerCase() === normalized) {
        return { id: service.id, name: service.name };
      }
    }
    return null;
  }

  async listServiceReferences(_ctx: RepositoryContext): Promise<ServiceReference[]> {
    return [...this.services.values()]
      .filter((service) => service.isActive)
      .map((service) => ({ id: service.id, name: service.name }));
  }

  // --- Service list management (SVC-01) ---

  private toServiceDto(service: ServiceRecord): ServiceDto {
    return {
      ...service,
      departmentName: service.departmentId ? (this.departments.get(service.departmentId)?.name ?? null) : null,
      usage: {
        assignments: [...this.assignments.values()].filter((a) => a.serviceId === service.id).length,
        recurringSchedules: [...this.schedules.values()].filter((s) => s.serviceId === service.id).length,
        engagements: [...this.engagements.values()].filter((e) => e.serviceId === service.id).length,
      },
    };
  }

  private serviceNameTaken(name: string, exceptId: string | null): boolean {
    const normalized = name.trim().toLowerCase();
    return [...this.services.values()].some(
      (service) => service.id !== exceptId && service.name.trim().toLowerCase() === normalized,
    );
  }

  async listServiceCatalog(_ctx: RepositoryContext): Promise<ServiceDto[]> {
    return [...this.services.values()]
      .map((service) => this.toServiceDto(service))
      .sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
          a.name.localeCompare(b.name),
      );
  }

  async createService(ctx: RepositoryContext, command: CreateServiceCommand): Promise<ServiceDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ServiceDto>(ctx, idempotencyKey, 'createService', payload, () => {
      const name = command.name.trim();
      if (this.serviceNameTaken(name, null)) throw duplicateService(name);
      const departmentId = command.departmentId ?? null;
      if (departmentId !== null && this.departments.get(departmentId)?.isActive !== true) throw departmentNotFound();
      const nowIso = this.now().toISOString();
      const record: ServiceRecord = {
        id: crypto.randomUUID(),
        name,
        description: command.description ?? null,
        turnaroundDays: command.turnaroundDays ?? null,
        isStatutory: command.isStatutory === true,
        isActive: true,
        departmentId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.services.set(record.id, record);
      return { result: this.toServiceDto(record) };
    });
  }

  async updateService(ctx: RepositoryContext, command: UpdateServiceCommand): Promise<ServiceDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ServiceDto>(ctx, idempotencyKey, 'updateService', payload, () => {
      const current = this.services.get(command.id);
      if (!current) throw notFound('Service');
      if (Date.parse(current.updatedAt) !== Date.parse(command.expectedUpdatedAt)) throw staleService();
      if (command.name !== undefined && this.serviceNameTaken(command.name, command.id)) {
        throw duplicateService(command.name);
      }
      // Only a change of department is checked: a service keeps its department even after it is deactivated.
      if (
        command.departmentId !== undefined &&
        command.departmentId !== null &&
        command.departmentId !== current.departmentId &&
        this.departments.get(command.departmentId)?.isActive !== true
      ) {
        throw departmentNotFound();
      }
      // Every change moves updatedAt forward, even within the same millisecond, so a stale token never matches
      const nowMs = Math.max(this.now().getTime(), Date.parse(current.updatedAt) + 1);
      const updated: ServiceRecord = {
        ...current,
        ...(command.name !== undefined ? { name: command.name.trim() } : {}),
        ...(command.description !== undefined ? { description: command.description } : {}),
        ...(command.turnaroundDays !== undefined ? { turnaroundDays: command.turnaroundDays } : {}),
        ...(command.isStatutory !== undefined ? { isStatutory: command.isStatutory } : {}),
        ...(command.isActive !== undefined ? { isActive: command.isActive } : {}),
        ...(command.departmentId !== undefined ? { departmentId: command.departmentId } : {}),
        updatedAt: new Date(nowMs).toISOString(),
      };
      this.services.set(updated.id, updated);
      return { result: this.toServiceDto(updated) };
    });
  }

  // --- Departments (DEPT-01) ---

  private toDepartmentDto(department: DepartmentRecord): DepartmentDto {
    const members = department.members
      .flatMap((member) => {
        const employee = this.employees.get(member.userId);
        return employee?.active
          ? [{ userId: member.userId, name: employee.name, role: employee.role, isHead: member.isHead }]
          : [];
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name));
    const serviceIds = [...this.services.values()]
      .filter((service) => service.departmentId === department.id)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name))
      .map((service) => service.id);
    return {
      id: department.id,
      name: department.name,
      isActive: department.isActive,
      members,
      serviceIds,
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    };
  }

  private departmentNameTaken(name: string, exceptId: string | null): boolean {
    const normalized = name.trim().toLowerCase();
    return [...this.departments.values()].some(
      (department) => department.id !== exceptId && department.name.trim().toLowerCase() === normalized,
    );
  }

  async listDepartments(_ctx: RepositoryContext): Promise<DepartmentDto[]> {
    return [...this.departments.values()]
      .map((department) => this.toDepartmentDto(department))
      .sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
          a.name.localeCompare(b.name),
      );
  }

  async createDepartment(ctx: RepositoryContext, command: CreateDepartmentCommand): Promise<DepartmentDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<DepartmentDto>(ctx, idempotencyKey, 'createDepartment', payload, () => {
      const name = command.name.trim();
      if (this.departmentNameTaken(name, null)) throw duplicateDepartment(name);
      const nowIso = this.now().toISOString();
      const record: DepartmentRecord = {
        id: crypto.randomUUID(),
        name,
        isActive: true,
        members: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.departments.set(record.id, record);
      return { result: this.toDepartmentDto(record) };
    });
  }

  async updateDepartment(ctx: RepositoryContext, command: UpdateDepartmentCommand): Promise<DepartmentDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<DepartmentDto>(ctx, idempotencyKey, 'updateDepartment', payload, () => {
      const current = this.departments.get(command.id);
      if (!current) throw notFound('Department');
      if (Date.parse(current.updatedAt) !== Date.parse(command.expectedUpdatedAt)) throw staleDepartment();
      if (command.name !== undefined && this.departmentNameTaken(command.name, command.id)) {
        throw duplicateDepartment(command.name);
      }
      // Every change moves updatedAt forward, even within the same millisecond, so a stale token never matches
      const nowMs = Math.max(this.now().getTime(), Date.parse(current.updatedAt) + 1);
      const updated: DepartmentRecord = {
        ...current,
        ...(command.name !== undefined ? { name: command.name.trim() } : {}),
        ...(command.isActive !== undefined ? { isActive: command.isActive } : {}),
        updatedAt: new Date(nowMs).toISOString(),
      };
      this.departments.set(updated.id, updated);
      return { result: this.toDepartmentDto(updated) };
    });
  }

  async setDepartmentMembers(ctx: RepositoryContext, command: SetDepartmentMembersCommand): Promise<DepartmentDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<DepartmentDto>(ctx, idempotencyKey, 'setDepartmentMembers', payload, () => {
      const current = this.departments.get(command.id);
      if (!current) throw notFound('Department');
      const people = command.members.map((member) => ({ member, employee: this.employees.get(member.userId) }));
      if (people.some(({ employee }) => !employee?.active)) {
        throw new ApiError(422, 'referenced_entity_not_found', 'The referenced entity does not exist.');
      }
      if (people.some(({ member, employee }) => member.isHead && employee?.role === 'trainee')) {
        throw traineeCannotHead();
      }
      // The whole membership is replaced in one step
      const updated: DepartmentRecord = {
        ...current,
        members: command.members.map((member) => ({ userId: member.userId, isHead: member.isHead })),
      };
      this.departments.set(updated.id, updated);
      return { result: this.toDepartmentDto(updated) };
    });
  }

  // --- Identity & Reporting Lines ---

  async getEmployee(_ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null> {
    const value = this.employees.get(id);
    return value ? copy(value) : null;
  }

  async listEmployees(_ctx: RepositoryContext): Promise<EmployeeRecord[]> {
    return copy([...this.employees.values()]);
  }

  async updateReportingLine(
    _ctx: RepositoryContext,
    employeeId: string,
    supervisorId: string | null,
  ): Promise<ReportingLineDto> {
    const employee = this.employees.get(employeeId);
    if (!employee) {
      throw new ApiError(404, 'employee_not_found', 'Employee was not found.');
    }

    let manager: EmployeeRecord | null = null;
    if (supervisorId !== null) {
      const supervisor = this.employees.get(supervisorId);
      if (!supervisor) {
        throw new ApiError(422, 'referenced_entity_not_found', 'Supervisor was not found.');
      }
      manager = supervisor;
    }

    const updatedEmployee: EmployeeRecord = {
      ...employee,
      reportsToId: supervisorId,
    };
    this.employees.set(employeeId, updatedEmployee);

    return {
      employee: copy(updatedEmployee),
      manager: manager ? copy(manager) : null,
    };
  }

  // --- Assignments ---

  async getAssignment(_ctx: RepositoryContext, id: string): Promise<AssignmentDto | null> {
    const value = this.assignments.get(id);
    return value ? copy(value) : null;
  }

  async listAssignments(_ctx: RepositoryContext): Promise<AssignmentDto[]> {
    return copy([...this.assignments.values()]);
  }

  async createAssignment(_ctx: RepositoryContext, record: CreateAssignmentRecord): Promise<AssignmentDto> {
    // Mirrors guard_assignment_engagement_link: same client, active engagement, code copied from it
    let engagementCode: string | null = null;
    if (record.engagementId) {
      const engagement = this.engagements.get(record.engagementId);
      if (!engagement) {
        throw new ApiError(422, 'referenced_entity_not_found', 'Referenced engagement does not exist.');
      }
      if (engagement.clientId !== record.clientId) {
        throw new ApiError(422, 'engagement_client_mismatch', 'The engagement belongs to a different client than the Assignment.');
      }
      if (engagement.status !== 'active') {
        throw new ApiError(422, 'engagement_not_active', 'An Assignment can only be linked to an active engagement.');
      }
      engagementCode = engagement.code;
    }
    this.assignmentCounter += 1;
    const code = `AS-${String(this.assignmentCounter).padStart(6, '0')}`;
    const ownerName = this.employees.get(record.ownerId)?.name ?? 'Unassigned';
    const reviewerNames = record.reviewerIds.map((id) => this.employees.get(id)?.name ?? 'Unknown');
    const assignment: AssignmentDto = {
      id: record.id,
      code,
      clientId: record.clientId,
      clientName: record.clientName,
      serviceId: record.serviceId,
      service: record.service,
      title: record.title,
      description: record.description ?? null,
      ownerId: record.ownerId,
      ownerName,
      reviewerIds: [...record.reviewerIds],
      reviewerNames,
      status: record.status,
      dueAt: record.dueAt,
      recurringScheduleId: record.recurringScheduleId ?? null,
      engagementId: record.engagementId ?? null,
      engagementCode,
      periodStart: record.periodStart ?? null,
      periodEnd: record.periodEnd ?? null,
      priority: record.priority ?? 'normal',
      progressPercent: 0,
      deliveryNotes: null,
      reviewNotes: null,
      createdById: record.createdById,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    this.assignments.set(assignment.id, copy(assignment));
    return copy(assignment);
  }

  async updateAssignmentStatus(
    _ctx: RepositoryContext,
    command: UpdateAssignmentStatusCommand,
  ): Promise<AssignmentDto> {
    const existing = this.assignments.get(command.id);
    if (!existing) {
      throw new ApiError(404, 'assignment_not_found', 'Assignment was not found.');
    }
    if (!command.expectedUpdatedAt || command.expectedUpdatedAt !== existing.updatedAt) {
      throw new ApiError(409, 'concurrency_conflict', 'The resource was updated concurrently by another operation.');
    }
    const updated: AssignmentDto = {
      ...existing,
      status: command.status,
      deliveryNotes: command.deliveryNotes !== undefined ? command.deliveryNotes : existing.deliveryNotes,
      reviewNotes: command.reviewNotes !== undefined ? command.reviewNotes : existing.reviewNotes,
      progressPercent:
        command.progressPercent !== undefined
          ? command.progressPercent
          : command.status === 'approved' || command.status === 'closed'
            ? 100
            : existing.progressPercent,
      updatedAt: new Date().toISOString(),
    };
    this.assignments.set(updated.id, copy(updated));
    return copy(updated);
  }

  async updateAssignmentReviewers(
    _ctx: RepositoryContext,
    command: UpdateAssignmentReviewersCommand,
  ): Promise<AssignmentDto> {
    const existing = this.assignments.get(command.id);
    if (!existing) {
      throw new ApiError(404, 'assignment_not_found', 'Assignment was not found.');
    }
    const reviewerNames = command.reviewerIds.map((id) => this.employees.get(id)?.name ?? 'Unknown');
    const updated: AssignmentDto = {
      ...existing,
      reviewerIds: [...command.reviewerIds],
      reviewerNames,
      updatedAt: new Date().toISOString(),
    };
    this.assignments.set(updated.id, copy(updated));
    return copy(updated);
  }

  async updateAssignment(
    _ctx: RepositoryContext,
    command: UpdateAssignmentCommand,
  ): Promise<AssignmentDto> {
    const existing = this.assignments.get(command.id);
    if (!existing) {
      throw new ApiError(404, 'assignment_not_found', 'Assignment was not found.');
    }
    if (!command.expectedUpdatedAt || command.expectedUpdatedAt !== existing.updatedAt) {
      throw new ApiError(409, 'concurrency_conflict', 'The resource was updated concurrently by another operation.');
    }
    const nextOwnerId = command.ownerId !== undefined ? command.ownerId : existing.ownerId;
    const nextOwnerName = this.employees.get(nextOwnerId)?.name ?? existing.ownerName;
    const nextReviewerIds = command.reviewerIds !== undefined ? [...command.reviewerIds] : existing.reviewerIds;
    const nextReviewerNames = nextReviewerIds.map((id) => this.employees.get(id)?.name ?? 'Unknown');
    const updated: AssignmentDto = {
      ...existing,
      title: command.title !== undefined ? command.title : existing.title,
      description: command.description !== undefined ? command.description : existing.description,
      serviceId: command.serviceId !== undefined ? command.serviceId : existing.serviceId,
      service: command.service !== undefined ? command.service : existing.service,
      ownerId: nextOwnerId,
      ownerName: nextOwnerName,
      reviewerIds: nextReviewerIds,
      reviewerNames: nextReviewerNames,
      dueAt: command.dueAt !== undefined ? command.dueAt : existing.dueAt,
      deliveryNotes: command.deliveryNotes !== undefined ? command.deliveryNotes : existing.deliveryNotes,
      reviewNotes: command.reviewNotes !== undefined ? command.reviewNotes : existing.reviewNotes,
      progressPercent: command.progressPercent !== undefined ? command.progressPercent : existing.progressPercent,
      updatedAt: new Date().toISOString(),
    };
    this.assignments.set(updated.id, copy(updated));
    return copy(updated);
  }

  // --- Work Items ---

  async getWorkItem(_ctx: RepositoryContext, id: string): Promise<WorkItemDto | null> {
    const value = this.workItems.get(id);
    return value ? copy(value) : null;
  }

  async listWorkItems(_ctx: RepositoryContext): Promise<WorkItemDto[]> {
    return copy([...this.workItems.values()]);
  }

  async createWorkItem(_ctx: RepositoryContext, record: CreateWorkItemRecord): Promise<WorkItemDto> {
    this.workItemCounter += 1;
    const code = `WI-${String(this.workItemCounter).padStart(6, '0')}`;
    const item: WorkItemDto = {
      id: record.id,
      code,
      kind: record.kind,
      title: record.title,
      notes: record.notes ?? null,
      assignmentId: record.assignmentId ?? null,
      relatedClientId: record.relatedClientId ?? null,
      relatedPartyName: record.relatedPartyName ?? null,
      assigneeId: record.assigneeId,
      createdById: record.createdById,
      status: record.status,
      dueAt: record.dueAt,
      reminderAt: record.reminderAt ?? null,
      priority: record.priority ?? 'normal',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    this.workItems.set(item.id, copy(item));
    return copy(item);
  }

  async updateWorkItemStatus(
    _ctx: RepositoryContext,
    command: UpdateWorkItemStatusCommand,
  ): Promise<WorkItemDto> {
    const existing = this.workItems.get(command.id);
    if (!existing) {
      throw new ApiError(404, 'work_item_not_found', 'Work item was not found.');
    }
    if (command.expectedUpdatedAt !== undefined && command.expectedUpdatedAt !== existing.updatedAt) {
      throw new ApiError(409, 'concurrency_conflict', 'The resource was updated concurrently by another operation.');
    }
    const now = new Date().toISOString();
    const updated: WorkItemDto = {
      ...existing,
      status: command.status,
      notes: command.notes !== undefined ? command.notes : existing.notes,
      progressPercent: command.progressPercent !== undefined ? command.progressPercent : existing.progressPercent,
      completionNote: command.completionNote !== undefined ? command.completionNote : existing.completionNote,
      completedAt: command.status === 'completed' ? (existing.completedAt ?? now) : existing.completedAt,
      updatedAt: now,
    };
    this.workItems.set(updated.id, copy(updated));
    return copy(updated);
  }

  // --- Recurring Schedules ---

  async getRecurringSchedule(_ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null> {
    const value = this.schedules.get(id);
    return value ? copy(value) : null;
  }

  async listRecurringSchedules(_ctx: RepositoryContext): Promise<RecurringScheduleDto[]> {
    return copy([...this.schedules.values()]);
  }

  async createRecurringSchedule(
    _ctx: RepositoryContext,
    input: CreateRecurringScheduleInput & { id: string; createdById: string; code?: string; clientName: string; service: string },
  ): Promise<RecurringScheduleDto> {
    this.scheduleCounter += 1;
    const code = input.code ?? `RS-${String(this.scheduleCounter).padStart(6, '0')}`;
    const now = new Date().toISOString();
    const ownerName = this.employees.get(input.ownerId)?.name ?? 'Unassigned';
    const reviewerIds = input.reviewerIds ? [...input.reviewerIds] : [];
    const reviewerNames = reviewerIds.map((rid) => this.employees.get(rid)?.name ?? 'Unknown');

    let resolvedService: ServiceReference | undefined;
    if (input.serviceId) {
      resolvedService = this.services.get(input.serviceId);
    } else if (input.service) {
      resolvedService = [...this.services.values()].find((s) => s.name === input.service);
    }
    if (!resolvedService) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced service does not exist in catalog.');
    }

    // Mirrors guard_recurring_schedule_engagement_link: same client, active engagement, code copied from it
    let engagementCode: string | null = null;
    if (input.engagementId) {
      const engagement = this.engagements.get(input.engagementId);
      if (!engagement) {
        throw new ApiError(422, 'referenced_entity_not_found', 'Referenced engagement does not exist.');
      }
      if (engagement.clientId !== input.clientId) {
        throw new ApiError(422, 'engagement_client_mismatch', 'The engagement belongs to a different client than the Recurring Schedule.');
      }
      if (engagement.status !== 'active') {
        throw new ApiError(422, 'engagement_not_active', 'A Recurring Schedule can only be linked to an active engagement.');
      }
      engagementCode = engagement.code;
    }

    const schedule: RecurringScheduleDto = {
      id: input.id,
      code,
      clientId: input.clientId,
      clientName: input.clientName,
      serviceId: resolvedService.id,
      service: resolvedService.name,
      title: input.title,
      cadence: input.cadence,
      ownerId: input.ownerId,
      ownerName,
      reviewerIds,
      reviewerNames,
      nextOccurrenceOn: input.nextOccurrenceOn,
      dueDay: input.dueDay,
      engagementId: input.engagementId ?? null,
      engagementCode,
      active: true,
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(schedule.id, copy(schedule));
    return copy(schedule);
  }

  async updateRecurringSchedule(
    _ctx: RepositoryContext,
    id: string,
    input: UpdateRecurringScheduleInput,
  ): Promise<RecurringScheduleDto> {
    const existing = this.schedules.get(id);
    if (!existing) {
      throw new ApiError(404, 'schedule_not_found', 'Recurring schedule was not found.');
    }
    // Mirrors the reactivation guard: a schedule linked to a non-active engagement cannot be restarted
    if (input.active === true && !existing.active && existing.engagementId) {
      if (this.engagements.get(existing.engagementId)?.status !== 'active') {
        throw new ApiError(
          422,
          'engagement_not_active',
          "This schedule's engagement has ended, so the schedule cannot be restarted.",
        );
      }
    }
    const updated: RecurringScheduleDto = {
      ...existing,
      active: input.active !== undefined ? input.active : existing.active,
      nextOccurrenceOn: input.nextOccurrenceOn !== undefined ? input.nextOccurrenceOn : existing.nextOccurrenceOn,
      updatedAt: new Date().toISOString(),
    };
    this.schedules.set(updated.id, copy(updated));
    return copy(updated);
  }

  async materializeDueAssignments(
    _ctx: RepositoryContext,
    throughDate: string,
  ): Promise<GenerateDueAssignmentsResult> {
    const generated: Array<{ scheduleId: string; assignmentId: string; occurrenceDate: string }> = [];
    for (const schedule of this.schedules.values()) {
      if (!schedule.active) continue;
      // Defence in depth: schedules whose engagement is not active never generate work
      if (schedule.engagementId && this.engagements.get(schedule.engagementId)?.status !== 'active') continue;
      let occurrence = schedule.nextOccurrenceOn;
      while (occurrence <= throughDate) {
        // Idempotency: skip if occurrence for (scheduleId, periodStart) already exists
        const exists = [...this.assignments.values()].some(
          (a) => a.recurringScheduleId === schedule.id && a.periodStart === occurrence,
        );
        if (!exists) {
          this.assignmentCounter += 1;
          const code = `AS-${String(this.assignmentCounter).padStart(6, '0')}`;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          const recurrenceDates = calculateRecurrenceDates(occurrence, schedule.cadence, schedule.dueDay);
          const assignment: AssignmentDto = {
            id,
            code,
            clientId: schedule.clientId,
            clientName: schedule.clientName,
            serviceId: schedule.serviceId,
            service: schedule.service,
            title: schedule.title,
            description: null,
            ownerId: schedule.ownerId,
            ownerName: schedule.ownerName ?? 'Unassigned',
            reviewerIds: [...schedule.reviewerIds],
            reviewerNames: [...schedule.reviewerNames],
            status: 'assigned',
            progressPercent: 0,
            deliveryNotes: null,
            reviewNotes: null,
            dueAt: recurrenceDates.dueAt,
            recurringScheduleId: schedule.id,
            engagementId: schedule.engagementId,
            engagementCode: schedule.engagementCode,
            periodStart: occurrence,
            periodEnd: recurrenceDates.periodEnd,
            priority: 'normal',
            createdById: schedule.createdById,
            createdAt: now,
            updatedAt: now,
          };
          this.assignments.set(id, copy(assignment));
          generated.push({
            scheduleId: schedule.id,
            assignmentId: id,
            occurrenceDate: occurrence,
          });
        }
        // advance occurrence according to cadence with calendar clamping
        const recurrenceDates = calculateRecurrenceDates(occurrence, schedule.cadence, schedule.dueDay);
        occurrence = recurrenceDates.nextOccurrence;
      }
      this.schedules.set(schedule.id, {
        ...schedule,
        nextOccurrenceOn: occurrence,
      });
    }
    return {
      generatedCount: generated.length,
      occurrences: generated,
    };
  }

  // --- Office Accounts & Ledger ---

  async getOfficeAccountsSummary(_ctx: RepositoryContext): Promise<OfficeAccountsSummaryDto> {
    const entries = [...this.ledgerEntries.values()];
    const balanceFor = (account: 'cash' | 'bank') =>
      entries
        .filter((entry) => entry.account === account)
        .reduce((total, entry) => total + (entry.direction === 'inflow' ? entry.amountPaise : -entry.amountPaise), 0);
    const totalFor = (direction: 'inflow' | 'outflow') =>
      entries
        .filter((entry) => entry.direction === direction)
        .reduce((total, entry) => total + entry.amountPaise, 0);

    return {
      currency: 'INR',
      cashBalancePaise: balanceFor('cash'),
      bankBalancePaise: balanceFor('bank'),
      totalInflowsPaise: totalFor('inflow'),
      totalOutflowsPaise: totalFor('outflow'),
      recentEntries: [...entries]
        .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.createdAt.localeCompare(left.createdAt))
        .slice(0, 10),
    };
  }

  async listLedgerEntries(_ctx: RepositoryContext): Promise<LedgerEntryDto[]> {
    return copy([...this.ledgerEntries.values()]);
  }

  async createLedgerEntry(
    _ctx: RepositoryContext,
    input: CreateLedgerEntryInput & { id: string; recordedById: string },
  ): Promise<LedgerEntryDto> {
    const entry: LedgerEntryDto = {
      id: input.id,
      occurredOn: input.occurredOn,
      account: input.account,
      direction: input.direction,
      amountPaise: input.amountPaise,
      narration: input.narration,
      reference: input.reference ?? null,
      recordedById: input.recordedById,
      createdAt: new Date().toISOString(),
    };
    this.ledgerEntries.set(entry.id, copy(entry));
    return copy(entry);
  }

  // --- Billing (BIL-01a reads, FEE-01a writes) ---

  // Mirrors fee_visible: management, or Senior Staff/Staff who own the client relationship or own/review
  // one of its assignments. Work-item involvement does not count.
  private isFeeVisible(actor: EmployeeRecord, clientId: string): boolean {
    if (this.isManagement(actor)) return true;
    if (actor.role !== 'senior_staff' && actor.role !== 'staff') return false;
    if (this.clients.get(clientId)?.relationshipOwnerId === actor.id) return true;
    for (const assignment of this.assignments.values()) {
      if (
        assignment.clientId === clientId &&
        (assignment.ownerId === actor.id || assignment.reviewerIds.includes(actor.id))
      ) {
        return true;
      }
    }
    return false;
  }

  private forbiddenOperation(): ApiError {
    return new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
  }

  private toInvoiceDto(invoice: InvoiceSeedRecord, today: string): InvoiceDto {
    const client = this.clients.get(invoice.clientId);
    const assignment = invoice.assignmentId ? this.assignments.get(invoice.assignmentId) : undefined;
    const payments: InvoicePaymentDto[] = [];
    for (const receipt of this.paymentReceipts) {
      for (const allocation of receipt.allocations) {
        if (allocation.invoiceId !== invoice.id) continue;
        payments.push({
          allocationId: allocation.id,
          source: allocation.source,
          receiptId: receipt.id,
          receiptCode: receipt.code,
          receivedOn: receipt.receivedOn,
          amountPaise: allocation.amountPaise,
          receiptStatus: receipt.status,
        });
      }
    }
    payments.sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.receiptCode.localeCompare(b.receiptCode));

    const subtotalPaise = invoice.items.reduce((sum, item) => sum + item.lineSubtotalPaise, 0);
    const taxPaise = invoice.items.reduce((sum, item) => sum + item.lineTaxPaise, 0);
    const totalPaise = subtotalPaise + taxPaise;
    const amountReceivedPaise = payments
      .filter((payment) => payment.receiptStatus === 'received')
      .reduce((sum, payment) => sum + payment.amountPaise, 0);
    const carriesBalance = invoice.status === 'issued' || invoice.status === 'part_paid' || invoice.status === 'paid';
    const isOpen = invoice.status === 'issued' || invoice.status === 'part_paid';

    return {
      id: invoice.id,
      code: invoice.code,
      vyaparBillNumber: invoice.vyaparBillNumber ?? null,
      clientId: invoice.clientId,
      clientCode: client?.code ?? '',
      clientName: client?.displayName ?? '',
      assignmentId: invoice.assignmentId,
      assignmentCode: assignment?.code ?? null,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: 'INR',
      subtotalPaise,
      taxPaise,
      totalPaise,
      amountReceivedPaise,
      balancePaise: carriesBalance ? totalPaise - amountReceivedPaise : 0,
      daysOverdue: isOpen && invoice.dueDate < today ? wholeDaysBetween(invoice.dueDate, today) : 0,
      status: invoice.status,
      notes: invoice.notes,
      issuedAt: invoice.issuedAt,
      voidReason: invoice.voidReason,
      voidedAt: invoice.voidedAt,
      items: invoice.items,
      payments,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }

  private toReceiptDto(receipt: PaymentReceiptSeedRecord): PaymentReceiptDto {
    const invoiceCodes = new Map(this.invoiceSeeds.map((invoice) => [invoice.id, invoice.code]));
    const client = this.clients.get(receipt.clientId);
    const allocations: PaymentAllocationDto[] = receipt.allocations
      .map((allocation) => ({
        allocationId: allocation.id,
        source: allocation.source,
        invoiceId: allocation.invoiceId,
        invoiceCode: invoiceCodes.get(allocation.invoiceId) ?? '',
        amountPaise: allocation.amountPaise,
      }))
      .sort((a, b) => a.invoiceCode.localeCompare(b.invoiceCode));
    const allocatedPaise = allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0);
    return {
      id: receipt.id,
      code: receipt.code,
      clientId: receipt.clientId,
      clientCode: client?.code ?? '',
      clientName: client?.displayName ?? '',
      receivedOn: receipt.receivedOn,
      amountPaise: receipt.amountPaise,
      method: receipt.method,
      reference: receipt.reference,
      notes: receipt.notes,
      status: receipt.status,
      voidReason: receipt.voidReason,
      voidedAt: receipt.voidedAt,
      allocatedPaise,
      unallocatedPaise: receipt.amountPaise - allocatedPaise,
      allocations,
      createdAt: receipt.createdAt,
    };
  }

  // Mirrors recompute_invoice_payment_state: paid/part-paid/issued follows the received allocations.
  private recomputeInvoiceStatus(invoice: InvoiceSeedRecord): void {
    if (invoice.status !== 'issued' && invoice.status !== 'part_paid' && invoice.status !== 'paid') return;
    let received = 0;
    for (const receipt of this.paymentReceipts) {
      if (receipt.status !== 'received') continue;
      for (const allocation of receipt.allocations) {
        if (allocation.invoiceId === invoice.id) received += allocation.amountPaise;
      }
    }
    const total = invoice.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    invoice.status = received === 0 ? 'issued' : received < total ? 'part_paid' : 'paid';
    invoice.updatedAt = this.now().toISOString();
  }

  private findVisibleInvoice(actor: EmployeeRecord, invoiceId: string): InvoiceSeedRecord | null {
    const invoice = this.invoiceSeeds.find((candidate) => candidate.id === invoiceId);
    return invoice && this.isFeeVisible(actor, invoice.clientId) ? invoice : null;
  }

  private findVisibleReceipt(actor: EmployeeRecord, receiptId: string): PaymentReceiptSeedRecord | null {
    const receipt = this.paymentReceipts.find((candidate) => candidate.id === receiptId);
    return receipt && this.isFeeVisible(actor, receipt.clientId) ? receipt : null;
  }

  async listInvoices(ctx: RepositoryContext): Promise<InvoiceDto[]> {
    const actor = this.getActor(ctx);
    if (!actor) return [];
    const today = kolkataToday(this.now());
    const dtos = this.invoiceSeeds
      .filter((invoice) => this.isFeeVisible(actor, invoice.clientId))
      .map((invoice) => this.toInvoiceDto(invoice, today));
    dtos.sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.code.localeCompare(a.code));
    return copy(dtos);
  }

  async listPaymentReceipts(ctx: RepositoryContext): Promise<PaymentReceiptDto[]> {
    const actor = this.getActor(ctx);
    if (!actor) return [];
    const dtos = this.paymentReceipts
      .filter((receipt) => this.isFeeVisible(actor, receipt.clientId))
      .map((receipt) => this.toReceiptDto(receipt));
    dtos.sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.code.localeCompare(a.code));
    return copy(dtos);
  }

  // Shared idempotency wrapper, keyed on (actor, key) like operation_receipts. The work callback
  // validates before it mutates, so a refusal leaves no receipt and no partial change.
  private runIdempotent<T>(
    ctx: RepositoryContext,
    idempotencyKey: string,
    operationType: string,
    payload: unknown,
    work: () => { result: T },
  ): T {
    const trimmedKey = idempotencyKey.trim();
    if (trimmedKey.length < 1 || trimmedKey.length > 255) {
      throw new ApiError(422, 'validation_failed', 'idempotencyKey must be between 1 and 255 characters.');
    }
    const requestHash = computeRequestHash(payload);
    const receiptKey = `${ctx.actorId}:${trimmedKey}`;
    const existing = this.operationReceipts.get(receiptKey);
    if (existing) {
      if (existing.operationType !== operationType || existing.requestHash !== requestHash) {
        throw new ApiError(
          409,
          'conflict',
          'Idempotency key was previously used with a different operation or payload.',
        );
      }
      return copy(existing.result as T);
    }

    const { result } = work();
    this.operationReceipts.set(receiptKey, {
      actorId: ctx.actorId,
      idempotencyKey: trimmedKey,
      operationType,
      requestHash,
      result: copy(result),
      createdAt: this.now().toISOString(),
    });
    return copy(result);
  }

  async recordVyaparBill(ctx: RepositoryContext, command: RecordVyaparBillCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<InvoiceDto>(ctx, idempotencyKey, 'recordVyaparBill', payload, () => {
      const actor = this.getActor(ctx);
      if (!actor || !this.isManagement(actor)) throw this.forbiddenOperation();
      const visible = this.getVisibleClientRecord(ctx, command.clientId);
      if (!visible) throw notFound('Client');

      const vyaparBillNumber = command.vyaparBillNumber.trim();
      const fiscalYear = financialYearStart(command.billDate);
      const duplicate = this.invoiceSeeds.some(
        (invoice) =>
          invoice.vyaparBillNumber != null &&
          invoice.status !== 'voided' &&
          invoice.vyaparBillNumber.trim().toUpperCase() === vyaparBillNumber.toUpperCase() &&
          financialYearStart(invoice.issueDate) === fiscalYear,
      );
      if (duplicate) throw duplicateVyaparBill(vyaparBillNumber, command.billDate);

      const nowIso = this.now().toISOString();
      this.invoiceCounter += 1;
      const invoice: InvoiceSeedRecord = {
        id: crypto.randomUUID(),
        code: `INV-${String(this.invoiceCounter).padStart(7, '0')}`,
        vyaparBillNumber,
        clientId: command.clientId,
        assignmentId: null,
        issueDate: command.billDate,
        dueDate: command.dueDate,
        status: 'issued',
        notes: null,
        issuedAt: nowIso,
        voidReason: null,
        voidedAt: null,
        items: [
          {
            id: crypto.randomUUID(),
            description: command.description.trim(),
            quantity: 1,
            unitPricePaise: command.amountPaise,
            taxRatePercent: 0,
            lineSubtotalPaise: command.amountPaise,
            lineTaxPaise: 0,
            lineTotalPaise: command.amountPaise,
          },
        ],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      this.invoiceSeeds.push(invoice);
      if (command.applyCredit === true) this.spendClientCredit(invoice);
      return {
        result: this.toInvoiceDto(invoice, kolkataToday(this.now())),
      };
    });
  }

  async recordPayment(ctx: RepositoryContext, command: RecordPaymentCommand): Promise<PaymentReceiptDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<PaymentReceiptDto>(ctx, idempotencyKey, 'recordPayment', payload, () => {
      const actor = this.getActor(ctx);
      if (!actor || actor.role === 'trainee') throw this.forbiddenOperation();
      const invoice = this.findVisibleInvoice(actor, command.invoiceId);
      if (!invoice) throw notFound('Invoice');
      if (invoice.status !== 'issued' && invoice.status !== 'part_paid') throw billNotOpen();
      const bill = this.toInvoiceDto(invoice, kolkataToday(this.now()));
      // An overpayment is kept: the receipt is for the full amount, the rest stays as client credit
      const allocatedPaise = Math.min(command.amountPaise, bill.balancePaise);

      const nowIso = this.now().toISOString();
      this.receiptCounter += 1;
      const receipt: PaymentReceiptSeedRecord = {
        id: crypto.randomUUID(),
        code: `RCT-${String(this.receiptCounter).padStart(7, '0')}`,
        clientId: invoice.clientId,
        receivedOn: command.receivedOn,
        amountPaise: command.amountPaise,
        method: command.method,
        reference: command.reference?.trim() || null,
        notes: command.notes?.trim() || null,
        status: 'received',
        voidReason: null,
        voidedAt: null,
        allocations: [
          { id: crypto.randomUUID(), invoiceId: invoice.id, amountPaise: allocatedPaise, source: 'payment' },
        ],
        createdAt: nowIso,
      };
      this.paymentReceipts.push(receipt);
      this.recomputeInvoiceStatus(invoice);
      return {
        result: this.toReceiptDto(receipt),
      };
    });
  }

  async voidInvoice(ctx: RepositoryContext, command: VoidFeeRecordCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<InvoiceDto>(ctx, idempotencyKey, 'voidInvoice', payload, () => {
      const actor = this.getActor(ctx);
      if (!actor || !this.isManagement(actor)) throw this.forbiddenOperation();
      const invoice = this.findVisibleInvoice(actor, command.id);
      if (!invoice) throw notFound('Invoice');
      if (invoice.status === 'voided') throw alreadyVoided();
      const today = kolkataToday(this.now());
      if (this.toInvoiceDto(invoice, today).amountReceivedPaise > 0) throw billHasPayments();

      const nowIso = this.now().toISOString();
      invoice.status = 'voided';
      invoice.voidReason = command.reason.trim();
      invoice.voidedAt = nowIso;
      invoice.updatedAt = nowIso;
      return {
        result: this.toInvoiceDto(invoice, today),
      };
    });
  }

  async voidPaymentReceipt(ctx: RepositoryContext, command: VoidFeeRecordCommand): Promise<PaymentReceiptDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<PaymentReceiptDto>(ctx, idempotencyKey, 'voidPaymentReceipt', payload, () => {
      const actor = this.getActor(ctx);
      if (!actor || !this.isManagement(actor)) throw this.forbiddenOperation();
      const receipt = this.findVisibleReceipt(actor, command.id);
      if (!receipt) throw notFound('Payment receipt');
      if (receipt.status === 'voided') throw alreadyVoided();

      receipt.status = 'voided';
      receipt.voidReason = command.reason.trim();
      receipt.voidedAt = this.now().toISOString();
      for (const allocation of receipt.allocations) {
        const invoice = this.invoiceSeeds.find((candidate) => candidate.id === allocation.invoiceId);
        if (invoice) this.recomputeInvoiceStatus(invoice);
      }
      return {
        result: this.toReceiptDto(receipt),
      };
    });
  }

  // --- Client credit (FEE-02a) ---

  // Spends the client's credit on one open bill, oldest receipt first (received date, then code).
  // Receipts that already have an allocation to this bill are skipped. Returns the paise applied.
  private spendClientCredit(invoice: InvoiceSeedRecord): number {
    const total = invoice.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    let pendingPaise = total - this.toInvoiceDto(invoice, kolkataToday(this.now())).amountReceivedPaise;
    const candidates = this.paymentReceipts
      .filter(
        (receipt) =>
          receipt.clientId === invoice.clientId &&
          receipt.status === 'received' &&
          !receipt.allocations.some((allocation) => allocation.invoiceId === invoice.id),
      )
      .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.code.localeCompare(b.code));

    let appliedPaise = 0;
    for (const receipt of candidates) {
      if (pendingPaise <= 0) break;
      const unallocatedPaise =
        receipt.amountPaise - receipt.allocations.reduce((sum, allocation) => sum + allocation.amountPaise, 0);
      if (unallocatedPaise <= 0) continue;
      const takePaise = Math.min(pendingPaise, unallocatedPaise);
      receipt.allocations.push({
        id: crypto.randomUUID(),
        invoiceId: invoice.id,
        amountPaise: takePaise,
        source: 'credit',
      });
      pendingPaise -= takePaise;
      appliedPaise += takePaise;
    }
    if (appliedPaise > 0) this.recomputeInvoiceStatus(invoice);
    return appliedPaise;
  }

  // --- Client documents (DOC-01a) ---
  // Storage is simulated by a map of uploaded paths to their sizes; markObjectUploaded stands in for
  // the browser's upload. Visibility is "looks after the client", the same test as fee visibility.

  /** Test hook: records that the file at this storage path now exists in Storage with this size. */
  markObjectUploaded(storagePath: string, sizeBytes: number): void {
    this.uploadedObjects.set(storagePath, sizeBytes);
  }

  private toDocumentDto(record: DocumentRecord): ClientDocumentDto {
    const client = this.clients.get(record.clientId);
    return copy({
      ...record,
      clientCode: client?.code ?? '',
      clientName: client?.displayName ?? '',
      uploadedByName: this.employees.get(record.uploadedById)?.name ?? '',
    });
  }

  private findDocumentFor(actor: EmployeeRecord, documentId: string): DocumentRecord | null {
    const record = this.documents.find((candidate) => candidate.id === documentId);
    return record && this.isFeeVisible(actor, record.clientId) ? record : null;
  }

  async listClientDocuments(ctx: RepositoryContext, clientId?: string): Promise<ClientDocumentDto[]> {
    const actor = this.getActor(ctx);
    if (!actor) return [];
    return this.documents
      .filter(
        (record) =>
          record.status === 'available' &&
          (clientId === undefined || record.clientId === clientId) &&
          this.isFeeVisible(actor, record.clientId),
      )
      .map((record, index) => ({ record, index }))
      .sort((left, right) => {
        const byTime = Date.parse(right.record.createdAt) - Date.parse(left.record.createdAt);
        return byTime !== 0 ? byTime : right.index - left.index;
      })
      .map(({ record }) => this.toDocumentDto(record));
  }

  async createClientDocument(ctx: RepositoryContext, command: CreateDocumentCommand): Promise<ClientDocumentDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ClientDocumentDto>(ctx, idempotencyKey, 'createClientDocument', payload, () => {
      const actor = this.getActor(ctx);
      const client = this.clients.get(command.clientId);
      if (!actor || !client || !this.isFeeVisible(actor, client.id)) throw notFound('Client');

      const documentId = crypto.randomUUID();
      const record: DocumentRecord = {
        id: documentId,
        clientId: command.clientId,
        title: command.title,
        category: command.category,
        financialYearStart: command.financialYearStart ?? null,
        fileName: command.fileName,
        mimeType: command.mimeType,
        sizeBytes: command.sizeBytes,
        status: 'pending',
        storagePath: documentStoragePath(command.clientId, documentId, command.fileName),
        uploadedById: actor.id,
        createdAt: this.now().toISOString(),
        removedReason: null,
        removedAt: null,
      };
      this.documents.push(record);
      return { result: this.toDocumentDto(record) };
    });
  }

  async confirmClientDocument(ctx: RepositoryContext, command: ConfirmDocumentCommand): Promise<ClientDocumentDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ClientDocumentDto>(ctx, idempotencyKey, 'confirmClientDocument', payload, () => {
      const actor = this.getActor(ctx);
      const record = actor ? this.findDocumentFor(actor, command.id) : null;
      if (!actor || !record) throw notFound('Document');
      if (record.uploadedById !== actor.id) throw this.forbiddenOperation();
      if (record.status !== 'pending') throw documentNotConfirmable();

      const size = this.uploadedObjects.get(record.storagePath);
      if (size === undefined) throw uploadMissing();
      if (size > DOCUMENT_MAX_BYTES) throw fileTooLarge();

      record.status = 'available';
      record.sizeBytes = size;
      return { result: this.toDocumentDto(record) };
    });
  }

  async removeClientDocument(ctx: RepositoryContext, command: RemoveDocumentCommand): Promise<ClientDocumentDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ClientDocumentDto>(ctx, idempotencyKey, 'removeClientDocument', payload, () => {
      const actor = this.getActor(ctx);
      const record = actor ? this.findDocumentFor(actor, command.id) : null;
      // Visible means the actor looks after the client, which is exactly who may remove (as in Postgres).
      if (!actor || !record) throw notFound('Document');
      if (record.status === 'removed') throw alreadyRemoved();
      if (record.status !== 'available') throw documentNotRemovable();

      record.status = 'removed';
      record.removedReason = command.reason;
      record.removedAt = this.now().toISOString();
      return { result: this.toDocumentDto(record) };
    });
  }

  // --- Reports (REP-01) ---
  // Mirrors the SQL aggregates with simple loops over the visible rows. Periods are Asia/Kolkata calendar
  // days; "now" figures use the repository clock. Reviews are not tracked in memory, so reviewsDone is 0,
  // and a document counts from the time it was uploaded because no confirmation time is kept.

  private canViewWorkItem(actor: EmployeeRecord, item: WorkItemDto): boolean {
    const assignment = item.assignmentId ? this.assignments.get(item.assignmentId) : undefined;
    const hasAuthority =
      assignment !== undefined &&
      (this.isManagement(actor) || assignment.ownerId === actor.id || assignment.reviewerIds.includes(actor.id));
    if (item.kind === 'personal') return item.assigneeId === actor.id || hasAuthority;
    if (this.isManagement(actor) || item.assigneeId === actor.id || item.createdById === actor.id) return true;
    return item.kind === 'delegated' && assignment !== undefined && this.hasAssignmentInvolvement(actor, assignment);
  }

  async getPracticeReport(ctx: RepositoryContext, period: ReportPeriodDto): Promise<PracticeReportBody> {
    const actor = this.getActor(ctx);
    const now = this.now();
    const nowMs = now.getTime();
    const today = kolkataToday(now);
    const startMs = Date.parse(`${period.start}T00:00:00+05:30`);
    const endMs = Date.parse(`${period.endExclusive}T00:00:00+05:30`);
    const inPeriod = (instant: string | null | undefined): boolean => {
      if (!instant) return false;
      const time = Date.parse(instant);
      return time >= startMs && time < endMs;
    };
    const dateInPeriod = (date: string): boolean => date >= period.start && date < period.endExclusive;
    const isOpen = (status: AssignmentStatus): boolean =>
      status !== 'approved' && status !== 'closed' && status !== 'cancelled';
    const isLate = (assignment: AssignmentDto): boolean => isOpen(assignment.status) && Date.parse(assignment.dueAt) < nowMs;
    const ownerName = (id: string): string => this.employees.get(id)?.name ?? 'Unassigned';

    const assignments = actor
      ? [...this.assignments.values()].filter((assignment) => this.canReadAssignment(actor, assignment))
      : [];
    const workItems = actor ? [...this.workItems.values()].filter((item) => this.canViewWorkItem(actor, item)) : [];

    // Work progress
    const completedAt = (assignment: AssignmentDto): string | null =>
      assignment.approvedAt ?? assignment.closedAt ?? null;
    const summary = {
      created: assignments.filter((assignment) => inPeriod(assignment.createdAt)).length,
      completed: assignments.filter((assignment) => inPeriod(completedAt(assignment))).length,
      submittedForReview: assignments.filter((assignment) => inPeriod(assignment.submittedAt)).length,
      overdueNow: assignments.filter(isLate).length,
      dueNext7Days: assignments.filter((assignment) => {
        const due = Date.parse(assignment.dueAt);
        return isOpen(assignment.status) && due >= nowMs && due <= nowMs + 7 * 86400000;
      }).length,
    };

    type Counts = { created: number; completed: number; openNow: number; overdueNow: number };
    const tally = (
      groups: Map<string, { name: string; counts: Counts }>,
      key: string,
      name: string,
      assignment: AssignmentDto,
    ): void => {
      const entry = groups.get(key) ?? { name, counts: { created: 0, completed: 0, openNow: 0, overdueNow: 0 } };
      if (inPeriod(assignment.createdAt)) entry.counts.created += 1;
      if (inPeriod(completedAt(assignment))) entry.counts.completed += 1;
      if (isOpen(assignment.status)) entry.counts.openNow += 1;
      if (isLate(assignment)) entry.counts.overdueNow += 1;
      groups.set(key, entry);
    };
    const byServiceGroups = new Map<string, { name: string; counts: Counts }>();
    const byOwnerGroups = new Map<string, { name: string; counts: Counts }>();
    for (const assignment of assignments) {
      tally(byServiceGroups, assignment.service, assignment.service, assignment);
      tally(byOwnerGroups, assignment.ownerId, ownerName(assignment.ownerId), assignment);
    }
    const byName = (left: { name: string }, right: { name: string }): number =>
      left.name.toLowerCase().localeCompare(right.name.toLowerCase()) || left.name.localeCompare(right.name);
    const hasWork = (counts: Counts): boolean => counts.created + counts.completed + counts.openNow > 0;

    const overdueList = assignments
      .filter(isLate)
      .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.code.localeCompare(right.code))
      .slice(0, 25)
      .map((assignment) => {
        const dueDate = kolkataToday(new Date(assignment.dueAt));
        return {
          assignmentCode: assignment.code,
          title: assignment.title,
          clientName: this.clients.get(assignment.clientId)?.displayName ?? '',
          ownerName: ownerName(assignment.ownerId),
          dueDate,
          daysOverdue: wholeDaysBetween(dueDate, today),
        };
      });

    // Team activity: leadership see every active employee, everyone else only themselves.
    const roleRank: Record<CompanyRole, number> = { founder: 1, manager: 2, senior_staff: 3, staff: 4, trainee: 5 };
    const people = actor
      ? [...this.employees.values()].filter(
          (employee) => employee.active && (this.isManagement(actor) || employee.id === actor.id),
        )
      : [];
    const teamActivity = people
      .sort((left, right) => roleRank[left.role] - roleRank[right.role] || byName(
        { name: left.name },
        { name: right.name },
      ))
      .map((employee) => {
        const owned = assignments.filter((assignment) => assignment.ownerId === employee.id);
        const tasks = workItems.filter((item) => item.assigneeId === employee.id);
        const openTasks = tasks.filter(
          (item) => item.kind !== 'personal' && item.status !== 'completed' && item.status !== 'cancelled',
        );
        return {
          name: employee.name,
          role: employee.role,
          assignmentsCompleted: owned.filter((assignment) => inPeriod(completedAt(assignment))).length,
          submittedForReview: owned.filter((assignment) => inPeriod(assignment.submittedAt)).length,
          tasksCompleted: tasks.filter((item) => inPeriod(item.completedAt)).length,
          tasksOpen: openTasks.length,
          tasksOverdue: openTasks.filter((item) => Date.parse(item.dueAt) < nowMs).length,
          reviewsDone: 0,
        };
      });

    // Fees and collections
    const visibleInvoices = actor
      ? this.invoiceSeeds
          .filter((invoice) => this.isFeeVisible(actor, invoice.clientId))
          .map((invoice) => this.toInvoiceDto(invoice, today))
      : [];
    const visibleReceipts = actor
      ? this.paymentReceipts
          .filter((receipt) => this.isFeeVisible(actor, receipt.clientId))
          .map((receipt) => this.toReceiptDto(receipt))
      : [];
    const feeRows = new Map<
      string,
      {
        bills: number;
        payments: number;
        row: FeesByClientRowDto;
      }
    >();
    const feeRowFor = (clientId: string) => {
      const existing = feeRows.get(clientId);
      if (existing) return existing;
      const client = this.clients.get(clientId);
      const created = {
        bills: 0,
        payments: 0,
        row: {
          clientCode: client?.code ?? '',
          clientName: client?.displayName ?? '',
          billedPaise: 0,
          receivedPaise: 0,
          pendingNowPaise: 0,
          overdueNowPaise: 0,
          creditPaise: 0,
        },
      };
      feeRows.set(clientId, created);
      return created;
    };
    for (const invoice of visibleInvoices) {
      const entry = feeRowFor(invoice.clientId);
      if (invoice.status !== 'draft' && invoice.status !== 'voided' && dateInPeriod(invoice.issueDate)) {
        entry.bills += 1;
        entry.row = { ...entry.row, billedPaise: entry.row.billedPaise + invoice.totalPaise };
      }
      if (invoice.status === 'issued' || invoice.status === 'part_paid') {
        entry.row = {
          ...entry.row,
          pendingNowPaise: entry.row.pendingNowPaise + invoice.balancePaise,
          overdueNowPaise: entry.row.overdueNowPaise + (invoice.dueDate < today ? invoice.balancePaise : 0),
        };
      }
    }
    for (const receipt of visibleReceipts) {
      if (receipt.status !== 'received') continue;
      const entry = feeRowFor(receipt.clientId);
      if (dateInPeriod(receipt.receivedOn)) {
        entry.payments += 1;
        entry.row = { ...entry.row, receivedPaise: entry.row.receivedPaise + receipt.amountPaise };
      }
      entry.row = { ...entry.row, creditPaise: entry.row.creditPaise + receipt.unallocatedPaise };
    }
    const feeEntries = [...feeRows.values()];
    const feeSum = (pick: (row: FeesByClientRowDto) => number): number =>
      feeEntries.reduce((total, entry) => total + pick(entry.row), 0);
    const byClient = feeEntries
      .map((entry) => entry.row)
      .filter(
        (row) =>
          row.billedPaise !== 0 ||
          row.receivedPaise !== 0 ||
          row.pendingNowPaise !== 0 ||
          row.overdueNowPaise !== 0 ||
          row.creditPaise !== 0,
      )
      .sort((left, right) => right.pendingNowPaise - left.pendingNowPaise || left.clientCode.localeCompare(right.clientCode));

    // Client follow-ups
    const visibleMessages = actor
      ? this.messages.filter((record) => this.isFeeVisible(actor, record.clientId))
      : [];
    const visibleDocuments = actor
      ? this.documents.filter((record) => record.status === 'available' && this.isFeeVisible(actor, record.clientId))
      : [];
    const needsFollowUp = (actor ? [...this.clients.values()].filter((client) => this.isFeeVisible(actor, client.id)) : [])
      .map((client) => {
        const overdueAssignments = assignments.filter(
          (assignment) => assignment.clientId === client.id && isLate(assignment),
        ).length;
        const overdueFeesPaise = visibleInvoices
          .filter(
            (invoice) =>
              invoice.clientId === client.id &&
              (invoice.status === 'issued' || invoice.status === 'part_paid') &&
              invoice.dueDate < today,
          )
          .reduce((total, invoice) => total + invoice.balancePaise, 0);
        const sentTimes = visibleMessages
          .filter((record) => record.clientId === client.id)
          .map((record) => Date.parse(record.createdAt));
        const last = sentTimes.length > 0 ? Math.max(...sentTimes) : null;
        return {
          clientCode: client.code,
          clientName: client.displayName,
          overdueAssignments,
          overdueFeesPaise,
          lastMessageAt: last === null ? null : new Date(last).toISOString(),
          last,
        };
      })
      .filter(
        (row) =>
          (row.overdueAssignments > 0 || row.overdueFeesPaise > 0) &&
          (row.last === null || row.last < nowMs - 14 * 86400000),
      )
      .sort(
        (left, right) =>
          right.overdueFeesPaise - left.overdueFeesPaise ||
          right.overdueAssignments - left.overdueAssignments ||
          left.clientCode.localeCompare(right.clientCode),
      )
      .map(({ last: _last, ...row }) => row);

    return {
      workProgress: {
        summary,
        byService: [...byServiceGroups.values()]
          .filter((entry) => hasWork(entry.counts))
          .sort(byName)
          .map((entry) => ({ serviceName: entry.name, ...entry.counts })),
        byOwner: [...byOwnerGroups.values()]
          .filter((entry) => hasWork(entry.counts))
          .sort(byName)
          .map((entry) => ({ ownerName: entry.name, ...entry.counts })),
        overdueList,
      },
      teamActivity,
      fees: {
        summary: {
          billsRecorded: feeEntries.reduce((total, entry) => total + entry.bills, 0),
          billedPaise: feeSum((row) => row.billedPaise),
          paymentsReceived: feeEntries.reduce((total, entry) => total + entry.payments, 0),
          receivedPaise: feeSum((row) => row.receivedPaise),
          pendingNowPaise: feeSum((row) => row.pendingNowPaise),
          overdueNowPaise: feeSum((row) => row.overdueNowPaise),
          creditHeldPaise: feeSum((row) => row.creditPaise),
        },
        byClient,
      },
      followUps: {
        messagesByPurpose: MESSAGE_PURPOSES.map((purpose) => ({
          purpose,
          count: visibleMessages.filter((record) => record.purpose === purpose && inPeriod(record.createdAt)).length,
        })).filter((row) => row.count > 0),
        documentsByCategory: DOCUMENT_CATEGORIES.map((category) => ({
          category,
          count: visibleDocuments.filter((record) => record.category === category && inPeriod(record.createdAt)).length,
        })).filter((row) => row.count > 0),
        needsFollowUp,
      },
    };
  }

  // --- Client messages (MSG-01) ---
  // Append-only. Visibility and recording are "looks after the client", the same test as fee visibility.

  private toMessageDto(record: MessageRecord): ClientMessageDto {
    const client = this.clients.get(record.clientId);
    const assignment = record.assignmentId ? this.assignments.get(record.assignmentId) : undefined;
    const invoice = record.invoiceId ? this.invoiceSeeds.find((candidate) => candidate.id === record.invoiceId) : undefined;
    return copy({
      ...record,
      clientCode: client?.code ?? '',
      clientName: client?.displayName ?? '',
      assignmentCode: assignment?.code ?? null,
      invoiceLabel: invoice ? (invoice.vyaparBillNumber ?? invoice.code) : null,
      sentByName: this.employees.get(record.sentById)?.name ?? '',
    });
  }

  async listClientMessages(ctx: RepositoryContext, clientId?: string): Promise<ClientMessageDto[]> {
    const actor = this.getActor(ctx);
    if (!actor) return [];
    return this.messages
      .filter(
        (record) =>
          (clientId === undefined || record.clientId === clientId) && this.isFeeVisible(actor, record.clientId),
      )
      .map((record, index) => ({ record, index }))
      .sort((left, right) => {
        const byTime = Date.parse(right.record.createdAt) - Date.parse(left.record.createdAt);
        return byTime !== 0 ? byTime : right.index - left.index;
      })
      .map(({ record }) => this.toMessageDto(record));
  }

  async recordClientMessage(ctx: RepositoryContext, command: RecordClientMessageCommand): Promise<ClientMessageDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<ClientMessageDto>(ctx, idempotencyKey, 'recordClientMessage', payload, () => {
      const actor = this.getActor(ctx);
      const client = this.clients.get(command.clientId);
      if (!actor || !client || !this.isFeeVisible(actor, client.id)) throw notFound('Client');

      if (command.contactId && !(client.contacts ?? []).some((contact) => contact.id === command.contactId)) {
        throw contactNotOfClient();
      }
      if (command.assignmentId && this.assignments.get(command.assignmentId)?.clientId !== client.id) {
        throw linkedWorkNotOfClient();
      }
      if (
        command.invoiceId &&
        this.invoiceSeeds.find((candidate) => candidate.id === command.invoiceId)?.clientId !== client.id
      ) {
        throw linkedWorkNotOfClient();
      }

      const record: MessageRecord = {
        id: crypto.randomUUID(),
        clientId: client.id,
        contactId: command.contactId ?? null,
        recipientName: command.recipientName,
        recipientNumber: command.recipientNumber,
        channel: 'whatsapp',
        purpose: command.purpose,
        assignmentId: command.assignmentId ?? null,
        invoiceId: command.invoiceId ?? null,
        body: command.body,
        status: 'opened',
        sentById: actor.id,
        createdAt: this.now().toISOString(),
      };
      this.messages.push(record);
      return { result: this.toMessageDto(record) };
    });
  }

  async applyCredit(ctx: RepositoryContext, command: ApplyCreditCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<InvoiceDto>(ctx, idempotencyKey, 'applyCredit', payload, () => {
      const actor = this.getActor(ctx);
      if (!actor || actor.role === 'trainee') throw this.forbiddenOperation();
      const invoice = this.findVisibleInvoice(actor, command.invoiceId);
      if (!invoice) throw notFound('Invoice');
      if (invoice.status !== 'issued' && invoice.status !== 'part_paid') throw billNotOpen();
      if (this.spendClientCredit(invoice) <= 0) throw noCreditAvailable();
      return {
        result: this.toInvoiceDto(invoice, kolkataToday(this.now())),
      };
    });
  }

  async removeCreditAllocation(ctx: RepositoryContext, command: RemoveCreditAllocationCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    return this.runIdempotent<InvoiceDto>(ctx, idempotencyKey, 'removeCreditAllocation', payload, () => {
      const actor = this.getActor(ctx);
      if (!actor || !this.isManagement(actor)) throw this.forbiddenOperation();
      const receipt = this.paymentReceipts.find(
        (candidate) =>
          this.isFeeVisible(actor, candidate.clientId) &&
          candidate.allocations.some((allocation) => allocation.id === command.allocationId),
      );
      const allocation = receipt?.allocations.find((candidate) => candidate.id === command.allocationId);
      if (!receipt || !allocation) throw notFound('Payment allocation');
      if (allocation.source !== 'credit') throw notCreditAllocation();

      receipt.allocations = receipt.allocations.filter((candidate) => candidate.id !== command.allocationId);
      const invoice = this.invoiceSeeds.find((candidate) => candidate.id === allocation.invoiceId);
      if (!invoice) throw notFound('Invoice');
      this.recomputeInvoiceStatus(invoice);
      return {
        result: this.toInvoiceDto(invoice, kolkataToday(this.now())),
      };
    });
  }

  // --- Engagements (ENG-01) ---

  async getEngagement(_ctx: RepositoryContext, id: string): Promise<EngagementDto | null> {
    const engagement = this.engagements.get(id);
    if (!engagement) return null;
    return this.enrichEngagementDto(engagement);
  }

  async listEngagements(_ctx: RepositoryContext): Promise<EngagementDto[]> {
    const list = [...this.engagements.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list.map((e) => this.enrichEngagementDto(e));
  }

  async listEngagementVersions(_ctx: RepositoryContext, engagementId: string): Promise<EngagementVersionDto[]> {
    const versions = this.engagementVersions.get(engagementId) ?? [];
    return copy(versions).sort((a, b) => a.versionNumber - b.versionNumber);
  }

  private enrichEngagementDto(engagement: EngagementDto): EngagementDto {
    const client = this.clients.get(engagement.clientId);
    const service = this.services.get(engagement.serviceId);

    let approvedVersion: EngagementVersionDto | null = null;
    if (engagement.approvedVersionId) {
      const versions = this.engagementVersions.get(engagement.id) ?? [];
      const found = versions.find((v) => v.id === engagement.approvedVersionId);
      if (found) {
        approvedVersion = copy(found);
      }
    }

    return {
      ...copy(engagement),
      clientName: client?.displayName,
      serviceName: service?.name ?? null,
      approvedVersion,
    };
  }

  private enrichEngagementVersionDto(version: EngagementVersionDto): EngagementVersionDto {
    const partner = this.employees.get(version.responsiblePartnerId);
    const manager = this.employees.get(version.deliveryManagerId);

    return {
      ...copy(version),
      responsiblePartnerName: partner?.name,
      deliveryManagerName: manager?.name,
    };
  }

  private checkExpectedUpdatedAt(currentUpdatedAt: string, expectedUpdatedAt: string): void {
    const curMs = new Date(currentUpdatedAt).getTime();
    const expMs = new Date(expectedUpdatedAt).getTime();
    if (isNaN(curMs) || isNaN(expMs) || curMs !== expMs) {
      throw new ApiError(
        409,
        'optimistic_lock_conflict',
        'The resource was updated concurrently by another operation.',
      );
    }
  }

  async mutateEngagement(ctx: RepositoryContext, command: MutateEngagementCommand): Promise<EngagementDto> {
    const actor = this.employees.get(ctx.actorId);
    if (!actor || (actor.role !== 'founder' && actor.role !== 'manager')) {
      throw new ApiError(403, 'forbidden', 'Only Founder or Manager may access engagements.');
    }

    const trimmedKey = command.idempotencyKey.trim();
    if (trimmedKey.length < 1 || trimmedKey.length > 255) {
      throw new ApiError(422, 'validation_failed', 'idempotencyKey must be between 1 and 255 characters.');
    }

    // Strip idempotencyKey for canonical payload hashing
    const { idempotencyKey: _, ...payload } = command;
    const requestHash = computeRequestHash(payload);
    const receiptKey = `${ctx.actorId}:${trimmedKey}`;

    const existingReceipt = this.operationReceipts.get(receiptKey);
    if (existingReceipt) {
      if (existingReceipt.operationType !== command.kind || existingReceipt.requestHash !== requestHash) {
        throw new ApiError(
          409,
          'conflict',
          'Idempotency key was previously used with a different operation or payload.',
        );
      }
      return copy(existingReceipt.result as EngagementDto);
    }

    let result: EngagementDto;

    switch (command.kind) {
      case 'createDraft': {
        const client = this.clients.get(command.clientId);
        if (!client) {
          throw new ApiError(422, 'referenced_entity_not_found', 'Client does not exist.');
        }
        if (client.status !== 'active') {
          throw new ApiError(422, 'validation_failed', 'Client must be active for engagement creation.');
        }

        const service = this.services.get(command.serviceId);
        if (!service) {
          throw new ApiError(422, 'referenced_entity_not_found', 'Service does not exist.');
        }

        const partner = this.employees.get(command.responsiblePartnerId);
        if (!partner || !partner.active || partner.role !== 'founder') {
          throw new ApiError(422, 'validation_failed', 'The responsible partner must be an active Founder.');
        }

        const deliveryManager = this.employees.get(command.deliveryManagerId);
        if (!deliveryManager || !deliveryManager.active || (deliveryManager.role !== 'founder' && deliveryManager.role !== 'manager')) {
          throw new ApiError(422, 'validation_failed', 'The delivery manager must be an active Founder or Manager.');
        }

        this.engagementCounter += 1;
        const code = `ENG-${String(this.engagementCounter).padStart(6, '0')}`;
        const engagementId = crypto.randomUUID();
        const versionId = crypto.randomUUID();
        const now = new Date().toISOString();

        const versionDto: EngagementVersionDto = this.enrichEngagementVersionDto({
          id: versionId,
          engagementId,
          versionNumber: 1,
          title: command.title.trim(),
          scope: command.scope.trim(),
          exclusions: command.exclusions ? command.exclusions.trim() : null,
          responsiblePartnerId: command.responsiblePartnerId,
          deliveryManagerId: command.deliveryManagerId,
          feeModel: command.feeModel,
          agreedFeePaise: command.agreedFeePaise,
          billingTerms: command.billingTerms.trim(),
          startDate: command.startDate,
          endDate: command.endDate ?? null,
          approvedAt: null,
          approvedById: null,
          createdById: ctx.actorId,
          createdAt: now,
        });

        const engagementDto: EngagementDto = {
          id: engagementId,
          code,
          clientId: command.clientId,
          clientName: client.displayName,
          serviceId: command.serviceId,
          serviceName: service.name,
          status: 'draft',
          approvedVersionId: null,
          approvedVersion: null,
          approvedAt: null,
          approvedById: null,
          endedAt: null,
          endedById: null,
          endOutcome: null,
          endReason: null,
          createdById: ctx.actorId,
          createdAt: now,
          updatedAt: now,
        };

        this.engagements.set(engagementId, copy(engagementDto));
        this.engagementVersions.set(engagementId, [copy(versionDto)]);
        result = copy(engagementDto);
        break;
      }

      case 'reviseDraft': {
        const existing = this.engagements.get(command.engagementId);
        if (!existing) {
          throw new ApiError(404, 'not_found', 'Engagement was not found.');
        }
        if (existing.status !== 'draft') {
          throw new ApiError(422, 'validation_failed', 'Cannot update versions on an active or ended engagement.');
        }

        this.checkExpectedUpdatedAt(existing.updatedAt, command.expectedUpdatedAt);

        const partner = this.employees.get(command.responsiblePartnerId);
        if (!partner || !partner.active || partner.role !== 'founder') {
          throw new ApiError(422, 'validation_failed', 'The responsible partner must be an active Founder.');
        }

        const deliveryManager = this.employees.get(command.deliveryManagerId);
        if (!deliveryManager || !deliveryManager.active || (deliveryManager.role !== 'founder' && deliveryManager.role !== 'manager')) {
          throw new ApiError(422, 'validation_failed', 'The delivery manager must be an active Founder or Manager.');
        }

        const versions = this.engagementVersions.get(command.engagementId) ?? [];
        const v1 = versions.find((v) => v.versionNumber === 1);
        if (!v1) {
          throw new ApiError(404, 'not_found', 'Draft version was not found.');
        }
        if (v1.approvedAt !== null) {
          throw new ApiError(422, 'validation_failed', 'Approved engagement versions are strictly immutable.');
        }

        const now = new Date().toISOString();
        const updatedV1: EngagementVersionDto = this.enrichEngagementVersionDto({
          ...v1,
          title: command.title.trim(),
          scope: command.scope.trim(),
          exclusions: command.exclusions ? command.exclusions.trim() : null,
          responsiblePartnerId: command.responsiblePartnerId,
          deliveryManagerId: command.deliveryManagerId,
          feeModel: command.feeModel,
          agreedFeePaise: command.agreedFeePaise,
          billingTerms: command.billingTerms.trim(),
          startDate: command.startDate,
          endDate: command.endDate ?? null,
        });

        const updatedEngagement: EngagementDto = {
          ...existing,
          updatedAt: now,
        };

        this.engagements.set(existing.id, copy(updatedEngagement));
        this.engagementVersions.set(existing.id, [copy(updatedV1)]);
        result = this.enrichEngagementDto(updatedEngagement);
        break;
      }

      case 'activate': {
        if (actor.role !== 'founder') {
          throw new ApiError(403, 'forbidden', 'Only the Founder may activate an engagement.');
        }

        const existing = this.engagements.get(command.engagementId);
        if (!existing) {
          throw new ApiError(404, 'not_found', 'Engagement was not found.');
        }
        if (existing.status !== 'draft') {
          throw new ApiError(422, 'validation_failed', `Cannot activate engagement with status ${existing.status}.`);
        }

        this.checkExpectedUpdatedAt(existing.updatedAt, command.expectedUpdatedAt);

        const client = this.clients.get(existing.clientId);
        if (!client || client.status !== 'active') {
          throw new ApiError(422, 'validation_failed', 'Client must be active for engagement activation.');
        }

        const service = this.services.get(existing.serviceId);
        if (!service) {
          throw new ApiError(422, 'validation_failed', 'Service must be active in catalog for engagement activation.');
        }

        const versions = this.engagementVersions.get(command.engagementId) ?? [];
        const version = versions.find((v) => v.id === command.versionId);
        if (!version) {
          throw new ApiError(404, 'not_found', 'Approved version does not exist.');
        }

        const now = new Date().toISOString();
        const approvedVersion: EngagementVersionDto = this.enrichEngagementVersionDto({
          ...version,
          approvedAt: now,
          approvedById: ctx.actorId,
        });

        const updatedVersions = versions.map((v) => (v.id === approvedVersion.id ? copy(approvedVersion) : copy(v)));
        this.engagementVersions.set(existing.id, updatedVersions);

        const updatedEngagement: EngagementDto = {
          ...existing,
          status: 'active',
          approvedVersionId: approvedVersion.id,
          approvedAt: now,
          approvedById: ctx.actorId,
          updatedAt: now,
        };

        this.engagements.set(existing.id, copy(updatedEngagement));
        result = this.enrichEngagementDto(updatedEngagement);
        break;
      }

      case 'amend': {
        if (actor.role !== 'founder') {
          throw new ApiError(403, 'forbidden', 'Only the Founder may approve an amendment on an active engagement.');
        }

        const existing = this.engagements.get(command.engagementId);
        if (!existing) {
          throw new ApiError(404, 'not_found', 'Engagement was not found.');
        }
        if (existing.status !== 'active') {
          throw new ApiError(422, 'validation_failed', 'Cannot amend an engagement that is not active.');
        }

        this.checkExpectedUpdatedAt(existing.updatedAt, command.expectedUpdatedAt);

        const partner = this.employees.get(command.responsiblePartnerId);
        if (!partner || !partner.active || partner.role !== 'founder') {
          throw new ApiError(422, 'validation_failed', 'The responsible partner must be an active Founder.');
        }

        const deliveryManager = this.employees.get(command.deliveryManagerId);
        if (!deliveryManager || !deliveryManager.active || (deliveryManager.role !== 'founder' && deliveryManager.role !== 'manager')) {
          throw new ApiError(422, 'validation_failed', 'The delivery manager must be an active Founder or Manager.');
        }

        const versions = this.engagementVersions.get(command.engagementId) ?? [];
        const maxVersionNumber = versions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
        const nextVersionNumber = maxVersionNumber + 1;

        const newVersionId = crypto.randomUUID();
        const now = new Date().toISOString();

        const approvedNewVersion: EngagementVersionDto = this.enrichEngagementVersionDto({
          id: newVersionId,
          engagementId: existing.id,
          versionNumber: nextVersionNumber,
          title: command.title.trim(),
          scope: command.scope.trim(),
          exclusions: command.exclusions ? command.exclusions.trim() : null,
          responsiblePartnerId: command.responsiblePartnerId,
          deliveryManagerId: command.deliveryManagerId,
          feeModel: command.feeModel,
          agreedFeePaise: command.agreedFeePaise,
          billingTerms: command.billingTerms.trim(),
          startDate: command.startDate,
          endDate: command.endDate ?? null,
          approvedAt: now,
          approvedById: ctx.actorId,
          createdById: ctx.actorId,
          createdAt: now,
        });

        versions.push(copy(approvedNewVersion));
        this.engagementVersions.set(existing.id, versions);

        const updatedEngagement: EngagementDto = {
          ...existing,
          approvedVersionId: approvedNewVersion.id,
          approvedAt: now,
          approvedById: ctx.actorId,
          updatedAt: now,
        };

        this.engagements.set(existing.id, copy(updatedEngagement));
        result = this.enrichEngagementDto(updatedEngagement);
        break;
      }

      case 'end': {
        if (actor.role !== 'founder') {
          throw new ApiError(403, 'forbidden', 'Only the Founder may end an engagement.');
        }

        const existing = this.engagements.get(command.engagementId);
        if (!existing) {
          throw new ApiError(404, 'not_found', 'Engagement was not found.');
        }
        if (existing.status !== 'active') {
          throw new ApiError(422, 'validation_failed', 'Cannot end an engagement that is not active.');
        }

        this.checkExpectedUpdatedAt(existing.updatedAt, command.expectedUpdatedAt);

        const now = new Date().toISOString();
        const updatedEngagement: EngagementDto = {
          ...existing,
          status: 'ended',
          endedAt: now,
          endedById: ctx.actorId,
          endOutcome: command.outcome,
          endReason: command.reason.trim(),
          updatedAt: now,
        };

        this.engagements.set(existing.id, copy(updatedEngagement));

        // Mirrors stop_engagement_recurring_schedules: ending an engagement stops its schedules
        for (const schedule of this.schedules.values()) {
          if (schedule.engagementId === existing.id && schedule.active) {
            this.schedules.set(schedule.id, { ...schedule, active: false, updatedAt: now });
          }
        }
        result = this.enrichEngagementDto(updatedEngagement);
        break;
      }
    }

    const storedReceipt: StoredOperationReceipt = {
      actorId: ctx.actorId,
      idempotencyKey: trimmedKey,
      operationType: command.kind,
      requestHash,
      result: copy(result),
      createdAt: new Date().toISOString(),
    };
    this.operationReceipts.set(receiptKey, storedReceipt);

    return result;
  }
}
