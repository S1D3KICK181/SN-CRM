import type {
  AssignmentDto,
  ClientDto,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  EngagementDto,
  EngagementVersionDto,
  GenerateDueAssignmentsResult,
  InvoiceDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceStatus,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  PaymentAllocationDto,
  PaymentMethod,
  PaymentReceiptDto,
  PaymentReceiptStatus,
  RecurringScheduleDto,
  ReportingLineDto,
  UpdateRecurringScheduleInput,
  WorkItemDto,
} from '@sn/contracts';
import { ApiError } from './errors';
import { maskGstinForRoutineRead, maskPanForRoutineRead } from './client-privacy';
import { computeRequestHash } from './idempotency';
import type {
  ClientReference,
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
  MutateEngagementCommand,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentCommand,
  UpdateAssignmentReviewersCommand,
  UpdateAssignmentStatusCommand,
  UpdateWorkItemStatusCommand,
} from './repository';

export interface StoredOperationReceipt {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly operationType: string;
  readonly requestHash: string;
  readonly result: unknown;
  readonly isDemo: boolean;
  readonly createdAt: string;
}

export type ClientSeedRecord = Omit<
  ClientDto,
  'relationshipOwnerName' | 'activeAssignmentsCount' | 'panMasked' | 'gstinMasked'
> & {
  pan: string | null;
  gstin: string | null;
  isDemo?: boolean;
};

export interface InvoiceSeedRecord {
  id: string;
  code: string;
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
  allocations: { invoiceId: string; amountPaise: number }[];
  createdAt: string;
}

export interface DemoSeed {
  employees: EmployeeRecord[];
  clients: ClientSeedRecord[];
  services?: ServiceReference[];
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

/** Today's calendar date (YYYY-MM-DD) in Asia/Kolkata, matching the SQL read path. */
export function kolkataToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

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

const DEFAULT_SERVICES: readonly ServiceReference[] = [
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

export class InMemoryCrmRepository implements CrmRepository, DevActorDirectory {
  private readonly employees = new Map<string, EmployeeRecord>();
  private readonly clients = new Map<string, ClientSeedRecord>();
  private readonly services = new Map<string, ServiceReference>();
  private readonly assignments = new Map<string, AssignmentDto>();
  private readonly schedules = new Map<string, RecurringScheduleDto>();
  private readonly workItems = new Map<string, WorkItemDto>();
  private readonly ledgerEntries = new Map<string, LedgerEntryDto>();
  private readonly engagements = new Map<string, EngagementDto>();
  private readonly engagementVersions = new Map<string, EngagementVersionDto[]>();
  private readonly operationReceipts = new Map<string, StoredOperationReceipt>();
  private readonly engagementIsDemo = new Map<string, boolean>();
  private readonly invoiceSeeds: InvoiceSeedRecord[];
  private readonly paymentReceipts: PaymentReceiptSeedRecord[];
  private readonly now: () => Date;

  private assignmentCounter = 1000;
  private workItemCounter = 1000;
  private scheduleCounter = 1000;
  private clientCounter = 1000;
  private engagementCounter = 1000;

  constructor(seed: DemoSeed, options: InMemoryRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.invoiceSeeds = copy(seed.invoices ?? []);
    this.paymentReceipts = copy(seed.paymentReceipts ?? []);
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
    servicesToLoad.forEach((value) => this.services.set(value.id, copy(value)));

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

    let activeAssignmentsCount = 0;
    for (const assignment of this.assignments.values()) {
      if (
        assignment.clientId === client.id &&
        assignment.status !== 'closed' &&
        assignment.status !== 'cancelled' &&
        this.hasAssignmentInvolvement(actor, assignment)
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
      email: client.email,
      phone: client.phone,
      relationshipOwnerId: client.relationshipOwnerId,
      relationshipOwnerName,
      status: client.status,
      notes: client.notes,
      activeAssignmentsCount,
      createdById: client.createdById,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  private getVisibleClientRecord(
    ctx: RepositoryContext,
    clientId: string,
  ): { actor: EmployeeRecord; client: ClientSeedRecord } | null {
    const actor = this.getActor(ctx);
    if (!actor) {
      return null;
    }
    const client = this.clients.get(clientId);
    if (!client || !this.isClientVisible(actor, client)) {
      return null;
    }
    return { actor, client };
  }

  private getVisibleClientRecords(
    ctx: RepositoryContext,
  ): { actor: EmployeeRecord; clients: ClientSeedRecord[] } | null {
    const actor = this.getActor(ctx);
    if (!actor) {
      return null;
    }
    const clients: ClientSeedRecord[] = [];
    for (const client of this.clients.values()) {
      if (this.isClientVisible(actor, client)) {
        clients.push(client);
      }
    }
    clients.sort((a, b) => a.code.localeCompare(b.code));
    return { actor, clients };
  }

  // --- Clients (Read-Only) ---

  async getClient(ctx: RepositoryContext, clientId: string): Promise<ClientDto | null> {
    const match = this.getVisibleClientRecord(ctx, clientId);
    if (!match) {
      return null;
    }
    return copy(this.toClientDto(match.actor, match.client));
  }

  async listClients(ctx: RepositoryContext): Promise<ClientDto[]> {
    const result = this.getVisibleClientRecords(ctx);
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
      createdById: actor.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      isDemo: false,
    };

    this.clients.set(seedRecord.id, copy(seedRecord));
    return copy(this.toClientDto(actor, seedRecord));
  }

  // --- Reference Lookups ---

  async getClientReference(ctx: RepositoryContext, clientId: string): Promise<ClientReference | null> {
    const match = this.getVisibleClientRecord(ctx, clientId);
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
    const result = this.getVisibleClientRecords(ctx);
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
    const value = this.services.get(serviceId);
    return value ? copy(value) : null;
  }

  async getServiceReferenceByName(_ctx: RepositoryContext, serviceName: string): Promise<ServiceReference | null> {
    const normalized = serviceName.trim().toLowerCase();
    for (const service of this.services.values()) {
      if (service.name.trim().toLowerCase() === normalized) {
        return copy(service);
      }
    }
    return null;
  }

  async listServiceReferences(_ctx: RepositoryContext): Promise<ServiceReference[]> {
    return copy([...this.services.values()]);
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

  // --- Billing (BIL-01a, read-only) ---

  async listInvoices(_ctx: RepositoryContext): Promise<InvoiceDto[]> {
    const today = kolkataToday(this.now());
    const dtos = this.invoiceSeeds.map((invoice): InvoiceDto => {
      const client = this.clients.get(invoice.clientId);
      const assignment = invoice.assignmentId ? this.assignments.get(invoice.assignmentId) : undefined;
      const payments: InvoicePaymentDto[] = [];
      for (const receipt of this.paymentReceipts) {
        for (const allocation of receipt.allocations) {
          if (allocation.invoiceId !== invoice.id) continue;
          payments.push({
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
    });
    dtos.sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.code.localeCompare(a.code));
    return copy(dtos);
  }

  async listPaymentReceipts(_ctx: RepositoryContext): Promise<PaymentReceiptDto[]> {
    const invoiceCodes = new Map(this.invoiceSeeds.map((invoice) => [invoice.id, invoice.code]));
    const dtos = this.paymentReceipts.map((receipt): PaymentReceiptDto => {
      const client = this.clients.get(receipt.clientId);
      const allocations: PaymentAllocationDto[] = receipt.allocations
        .map((allocation) => ({
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
    });
    dtos.sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.code.localeCompare(a.code));
    return copy(dtos);
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
        const isDemo = client.isDemo ?? false;
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
        this.engagementIsDemo.set(engagementId, isDemo);
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

    const receiptIsDemo = command.kind === 'createDraft'
      ? (this.clients.get(command.clientId)?.isDemo ?? false)
      : (this.engagementIsDemo.get(
          command.kind === 'reviseDraft' || command.kind === 'activate' || command.kind === 'amend' || command.kind === 'end'
            ? command.engagementId
            : ''
        ) ?? false);

    const storedReceipt: StoredOperationReceipt = {
      actorId: ctx.actorId,
      idempotencyKey: trimmedKey,
      operationType: command.kind,
      requestHash,
      result: copy(result),
      isDemo: receiptIsDemo,
      createdAt: new Date().toISOString(),
    };
    this.operationReceipts.set(receiptKey, storedReceipt);

    return result;
  }
}
