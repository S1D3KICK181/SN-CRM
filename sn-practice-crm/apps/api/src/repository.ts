import type {
  AssignmentDto,
  LedgerEntryDto,
  RecurringScheduleDto,
  SessionActor,
  WorkItemDto,
} from '@sn/contracts';

export interface EmployeeRecord extends SessionActor {
  active: boolean;
}

export interface CrmRepository {
  getEmployee(id: string): Promise<EmployeeRecord | null>;
  listEmployees(): Promise<EmployeeRecord[]>;
  saveEmployee(employee: EmployeeRecord): Promise<void>;

  getAssignment(id: string): Promise<AssignmentDto | null>;
  listAssignments(): Promise<AssignmentDto[]>;
  saveAssignment(assignment: AssignmentDto): Promise<void>;

  getRecurringSchedule(id: string): Promise<RecurringScheduleDto | null>;
  listRecurringSchedules(): Promise<RecurringScheduleDto[]>;
  saveRecurringSchedule(schedule: RecurringScheduleDto): Promise<void>;

  getWorkItem(id: string): Promise<WorkItemDto | null>;
  listWorkItems(): Promise<WorkItemDto[]>;
  saveWorkItem(workItem: WorkItemDto): Promise<void>;

  listLedgerEntries(): Promise<LedgerEntryDto[]>;
  saveLedgerEntry(entry: LedgerEntryDto): Promise<void>;
}
