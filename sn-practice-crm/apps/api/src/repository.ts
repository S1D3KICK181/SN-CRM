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

export interface RepositoryContext {
  readonly actorId: string;
}

export interface DevActorDirectory {
  resolveDevActor(id: string): Promise<EmployeeRecord | null>;
  listDevActors(): Promise<EmployeeRecord[]>;
}

export interface CrmRepository {
  getEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null>;
  listEmployees(ctx: RepositoryContext): Promise<EmployeeRecord[]>;
  saveEmployee(ctx: RepositoryContext, employee: EmployeeRecord): Promise<EmployeeRecord>;

  getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto | null>;
  listAssignments(ctx: RepositoryContext): Promise<AssignmentDto[]>;
  saveAssignment(ctx: RepositoryContext, assignment: AssignmentDto): Promise<AssignmentDto>;

  getRecurringSchedule(ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null>;
  listRecurringSchedules(ctx: RepositoryContext): Promise<RecurringScheduleDto[]>;
  saveRecurringSchedule(ctx: RepositoryContext, schedule: RecurringScheduleDto): Promise<RecurringScheduleDto>;

  getWorkItem(ctx: RepositoryContext, id: string): Promise<WorkItemDto | null>;
  listWorkItems(ctx: RepositoryContext): Promise<WorkItemDto[]>;
  saveWorkItem(ctx: RepositoryContext, workItem: WorkItemDto): Promise<WorkItemDto>;

  listLedgerEntries(ctx: RepositoryContext): Promise<LedgerEntryDto[]>;
  saveLedgerEntry(ctx: RepositoryContext, entry: LedgerEntryDto): Promise<LedgerEntryDto>;
}

export type CrmApplicationDependencies = CrmRepository & DevActorDirectory;
