import type {
  AssignmentDto,
  LedgerEntryDto,
  RecurringScheduleDto,
  WorkItemDto,
} from '@sn/contracts';
import type {
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
  RepositoryContext,
} from './repository';

export interface DemoSeed {
  employees: EmployeeRecord[];
  assignments: AssignmentDto[];
  recurringSchedules: RecurringScheduleDto[];
  workItems: WorkItemDto[];
  ledgerEntries: LedgerEntryDto[];
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCrmRepository implements CrmRepository, DevActorDirectory {
  private readonly employees = new Map<string, EmployeeRecord>();
  private readonly assignments = new Map<string, AssignmentDto>();
  private readonly schedules = new Map<string, RecurringScheduleDto>();
  private readonly workItems = new Map<string, WorkItemDto>();
  private readonly ledgerEntries = new Map<string, LedgerEntryDto>();

  constructor(seed: DemoSeed) {
    seed.employees.forEach((value) => this.employees.set(value.id, copy(value)));
    seed.assignments.forEach((value) => this.assignments.set(value.id, copy(value)));
    seed.recurringSchedules.forEach((value) => this.schedules.set(value.id, copy(value)));
    seed.workItems.forEach((value) => this.workItems.set(value.id, copy(value)));
    seed.ledgerEntries.forEach((value) => this.ledgerEntries.set(value.id, copy(value)));
  }

  // --- DevActorDirectory (Bootstrap) ---

  async resolveDevActor(id: string): Promise<EmployeeRecord | null> {
    const value = this.employees.get(id);
    return value ? copy(value) : null;
  }

  async listDevActors(): Promise<EmployeeRecord[]> {
    return copy([...this.employees.values()]);
  }

  // --- Dev / Test Bootstrap Helper (Concrete InMemory only, uncontexted) ---

  async upsertDevActor(employee: EmployeeRecord): Promise<EmployeeRecord> {
    this.employees.set(employee.id, copy(employee));
    return copy(this.employees.get(employee.id)!);
  }

  // --- CrmRepository (Actor-Scoped Domain Methods) ---

  async getEmployee(_ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null> {
    const value = this.employees.get(id);
    return value ? copy(value) : null;
  }

  async listEmployees(_ctx: RepositoryContext): Promise<EmployeeRecord[]> {
    return copy([...this.employees.values()]);
  }

  async saveEmployee(_ctx: RepositoryContext, employee: EmployeeRecord): Promise<EmployeeRecord> {
    this.employees.set(employee.id, copy(employee));
    return copy(this.employees.get(employee.id)!);
  }

  async getAssignment(_ctx: RepositoryContext, id: string): Promise<AssignmentDto | null> {
    const value = this.assignments.get(id);
    return value ? copy(value) : null;
  }

  async listAssignments(_ctx: RepositoryContext): Promise<AssignmentDto[]> {
    return copy([...this.assignments.values()]);
  }

  async saveAssignment(_ctx: RepositoryContext, assignment: AssignmentDto): Promise<AssignmentDto> {
    this.assignments.set(assignment.id, copy(assignment));
    return copy(this.assignments.get(assignment.id)!);
  }

  async getRecurringSchedule(_ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null> {
    const value = this.schedules.get(id);
    return value ? copy(value) : null;
  }

  async listRecurringSchedules(_ctx: RepositoryContext): Promise<RecurringScheduleDto[]> {
    return copy([...this.schedules.values()]);
  }

  async saveRecurringSchedule(
    _ctx: RepositoryContext,
    schedule: RecurringScheduleDto,
  ): Promise<RecurringScheduleDto> {
    this.schedules.set(schedule.id, copy(schedule));
    return copy(this.schedules.get(schedule.id)!);
  }

  async getWorkItem(_ctx: RepositoryContext, id: string): Promise<WorkItemDto | null> {
    const value = this.workItems.get(id);
    return value ? copy(value) : null;
  }

  async listWorkItems(_ctx: RepositoryContext): Promise<WorkItemDto[]> {
    return copy([...this.workItems.values()]);
  }

  async saveWorkItem(_ctx: RepositoryContext, workItem: WorkItemDto): Promise<WorkItemDto> {
    this.workItems.set(workItem.id, copy(workItem));
    return copy(this.workItems.get(workItem.id)!);
  }

  async listLedgerEntries(_ctx: RepositoryContext): Promise<LedgerEntryDto[]> {
    return copy([...this.ledgerEntries.values()]);
  }

  async saveLedgerEntry(_ctx: RepositoryContext, entry: LedgerEntryDto): Promise<LedgerEntryDto> {
    this.ledgerEntries.set(entry.id, copy(entry));
    return copy(this.ledgerEntries.get(entry.id)!);
  }
}
