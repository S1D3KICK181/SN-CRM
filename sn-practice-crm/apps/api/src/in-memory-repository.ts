import type {
  AssignmentDto,
  LedgerEntryDto,
  RecurringScheduleDto,
  WorkItemDto,
} from '@sn/contracts';
import type { CrmRepository, EmployeeRecord } from './repository';

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

export class InMemoryCrmRepository implements CrmRepository {
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

  async getEmployee(id: string): Promise<EmployeeRecord | null> {
    const value = this.employees.get(id);
    return value ? copy(value) : null;
  }

  async listEmployees(): Promise<EmployeeRecord[]> {
    return copy([...this.employees.values()]);
  }

  async saveEmployee(employee: EmployeeRecord): Promise<void> {
    this.employees.set(employee.id, copy(employee));
  }

  async getAssignment(id: string): Promise<AssignmentDto | null> {
    const value = this.assignments.get(id);
    return value ? copy(value) : null;
  }

  async listAssignments(): Promise<AssignmentDto[]> {
    return copy([...this.assignments.values()]);
  }

  async saveAssignment(assignment: AssignmentDto): Promise<void> {
    this.assignments.set(assignment.id, copy(assignment));
  }

  async getRecurringSchedule(id: string): Promise<RecurringScheduleDto | null> {
    const value = this.schedules.get(id);
    return value ? copy(value) : null;
  }

  async listRecurringSchedules(): Promise<RecurringScheduleDto[]> {
    return copy([...this.schedules.values()]);
  }

  async saveRecurringSchedule(schedule: RecurringScheduleDto): Promise<void> {
    this.schedules.set(schedule.id, copy(schedule));
  }

  async getWorkItem(id: string): Promise<WorkItemDto | null> {
    const value = this.workItems.get(id);
    return value ? copy(value) : null;
  }

  async listWorkItems(): Promise<WorkItemDto[]> {
    return copy([...this.workItems.values()]);
  }

  async saveWorkItem(workItem: WorkItemDto): Promise<void> {
    this.workItems.set(workItem.id, copy(workItem));
  }

  async listLedgerEntries(): Promise<LedgerEntryDto[]> {
    return copy([...this.ledgerEntries.values()]);
  }

  async saveLedgerEntry(entry: LedgerEntryDto): Promise<void> {
    this.ledgerEntries.set(entry.id, copy(entry));
  }
}
