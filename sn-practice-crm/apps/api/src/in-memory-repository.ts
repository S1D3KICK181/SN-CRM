import type {
  AssignmentDto,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  RecurringScheduleDto,
  ReportingLineDto,
  UpdateRecurringScheduleInput,
  WorkItemDto,
} from '@sn/contracts';
import { ApiError } from './errors';
import type {
  ClientReference,
  CreateAssignmentRecord,
  CreateWorkItemRecord,
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentReviewersCommand,
  UpdateAssignmentStatusCommand,
  UpdateWorkItemStatusCommand,
} from './repository';

export interface DemoSeed {
  employees: EmployeeRecord[];
  clients?: ClientReference[];
  services?: ServiceReference[];
  assignments: AssignmentDto[];
  recurringSchedules: RecurringScheduleDto[];
  workItems: WorkItemDto[];
  ledgerEntries: LedgerEntryDto[];
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

const DEFAULT_CLIENTS: readonly ClientReference[] = [
  { id: '10000000-0000-4000-a000-000000000001', code: 'CL-001001', name: 'Aster Foods Private Limited' },
  { id: '10000000-0000-4000-a000-000000000002', code: 'CL-001002', name: 'BluePeak Technologies LLP' },
  { id: '10000000-0000-4000-a000-000000000003', code: 'CL-001003', name: 'Sharma Retail Enterprises' },
  { id: '10000000-0000-4000-a000-000000000004', code: 'CL-001004', name: 'Kedia Holdings Private Limited' },
  { id: '10000000-0000-4000-a000-000000000005', code: 'CL-001005', name: 'Northstar Exports Incorporated' },
  { id: '10000000-0000-4000-a000-000000000006', code: 'CL-001006', name: 'Apex Logistics Private Limited' },
];

const DEFAULT_SERVICES: readonly ServiceReference[] = [
  { id: '50000000-0000-4000-a000-000000000001', name: 'GST Compliance' },
  { id: '50000000-0000-4000-a000-000000000002', name: 'Internal Audit' },
  { id: '50000000-0000-4000-a000-000000000003', name: 'Tax Compliance (TDS)' },
  { id: '50000000-0000-4000-a000-000000000004', name: 'Bookkeeping & Accounts' },
  { id: '50000000-0000-4000-a000-000000000005', name: 'Statutory Audit' },
  { id: '50000000-0000-4000-a000-000000000006', name: 'Direct Tax Advisory' },
];

export class InMemoryCrmRepository implements CrmRepository, DevActorDirectory {
  private readonly employees = new Map<string, EmployeeRecord>();
  private readonly clients = new Map<string, ClientReference>();
  private readonly services = new Map<string, ServiceReference>();
  private readonly assignments = new Map<string, AssignmentDto>();
  private readonly schedules = new Map<string, RecurringScheduleDto>();
  private readonly workItems = new Map<string, WorkItemDto>();
  private readonly ledgerEntries = new Map<string, LedgerEntryDto>();

  private assignmentCounter = 1000;
  private workItemCounter = 1000;
  private scheduleCounter = 1000;

  constructor(seed: DemoSeed) {
    seed.employees.forEach((value) => this.employees.set(value.id, copy(value)));

    const clientsToLoad = seed.clients ?? DEFAULT_CLIENTS;
    clientsToLoad.forEach((value) => this.clients.set(value.id, copy(value)));

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

  // --- Reference Lookups ---

  async getClientReference(_ctx: RepositoryContext, clientId: string): Promise<ClientReference | null> {
    const value = this.clients.get(clientId);
    return value ? copy(value) : null;
  }

  async listClientReferences(_ctx: RepositoryContext): Promise<ClientReference[]> {
    return copy([...this.clients.values()]);
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
    this.assignmentCounter += 1;
    const code = `AS-${String(this.assignmentCounter).padStart(6, '0')}`;
    const assignment: AssignmentDto = {
      id: record.id,
      code,
      clientId: record.clientId,
      clientName: record.clientName,
      serviceId: record.serviceId,
      service: record.service,
      title: record.title,
      ownerId: record.ownerId,
      reviewerIds: [...record.reviewerIds],
      status: record.status,
      dueAt: record.dueAt,
      recurringScheduleId: record.recurringScheduleId ?? null,
      periodStart: record.periodStart ?? null,
      periodEnd: record.periodEnd ?? null,
      priority: record.priority ?? 'normal',
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
    if (command.expectedUpdatedAt !== undefined && command.expectedUpdatedAt !== existing.updatedAt) {
      throw new ApiError(409, 'concurrency_conflict', 'The resource was updated concurrently by another operation.');
    }
    const updated: AssignmentDto = {
      ...existing,
      status: command.status,
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
    const updated: AssignmentDto = {
      ...existing,
      reviewerIds: [...command.reviewerIds],
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
    const schedule: RecurringScheduleDto = {
      id: input.id,
      code,
      clientId: input.clientId,
      clientName: input.clientName,
      serviceId: input.serviceId ?? '50000000-0000-4000-a000-000000000001',
      service: input.service,
      title: input.title,
      cadence: input.cadence,
      ownerId: input.ownerId,
      reviewerIds: input.reviewerIds ? [...input.reviewerIds] : [],
      nextOccurrenceOn: input.nextOccurrenceOn,
      dueDay: input.dueDay,
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
    const updated: RecurringScheduleDto = {
      ...existing,
      active: input.active !== undefined ? input.active : existing.active,
      nextOccurrenceOn: input.nextOccurrenceOn !== undefined ? input.nextOccurrenceOn : existing.nextOccurrenceOn,
      updatedAt: new Date().toISOString(),
    };
    this.schedules.set(updated.id, copy(updated));
    return copy(updated);
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
}
