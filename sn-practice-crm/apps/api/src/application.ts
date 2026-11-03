import { authorize, type Actor, type AuthorityRequest, type CompanyRole } from '@sn/domain';
import type {
  AssignmentDto,
  AssignmentTransition,
  CreateAssignmentInput,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  CreateWorkItemInput,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  RecurringScheduleDto,
  ReportingLineDto,
  SessionActor,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import { ApiError, forbidden, notFound } from './errors';
import type {
  CrmApplicationDependencies,
  EmployeeRecord,
  RepositoryContext,
} from './repository';
import { parseIsoInstant } from './schemas';

export interface ApplicationOptions {
  now?: () => Date;
  createId?: (prefix: string) => string;
}

function isLeadership(role: CompanyRole): boolean {
  return role === 'founder' || role === 'manager';
}

function asActor(employee: SessionActor): Actor {
  return { id: employee.id, role: employee.role };
}

function asSession(employee: EmployeeRecord): SessionActor {
  const { active: _active, ...session } = employee;
  return session;
}

function requireAuthority(request: AuthorityRequest): void {
  const decision = authorize(request);
  if (!decision.allowed) {
    throw forbidden(decision.code, decision.reason);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function invalidTransition(message: string): never {
  throw new ApiError(409, 'invalid_state_transition', message);
}

export type CreateWorkItemServiceInput = CreateWorkItemInput extends infer T
  ? T extends { kind: string }
    ? Omit<T, 'reminderAt'> & { reminderAt?: string | null }
    : never
  : never;

export class CrmApplication {
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(
    private readonly repository: CrmApplicationDependencies,
    options: ApplicationOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${crypto.randomUUID()}`);
  }

  async listDemoActors(): Promise<SessionActor[]> {
    const employees = await this.repository.listDevActors();
    return employees
      .filter((employee) => employee.active)
      .map(asSession)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async requireActor(id: string | undefined): Promise<SessionActor> {
    if (!id) {
      throw new ApiError(401, 'demo_session_required', 'Choose a demo user and send its id in the x-demo-user-id header.');
    }

    const employee = await this.repository.resolveDevActor(id);
    if (!employee?.active) {
      throw new ApiError(401, 'invalid_demo_session', 'The selected demo user does not exist or is inactive.');
    }
    return asSession(employee);
  }

  async listAssignments(actor: SessionActor): Promise<AssignmentDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const [assignments, workItems] = await Promise.all([
      this.repository.listAssignments(ctx),
      this.repository.listWorkItems(ctx),
    ]);

    const involvedAssignmentIds = new Set(
      workItems
        .filter((item) => item.assignmentId && (item.assigneeId === actor.id || item.createdById === actor.id))
        .map((item) => item.assignmentId as string),
    );

    return assignments
      .filter(
        (assignment) =>
          isLeadership(actor.role) ||
          assignment.ownerId === actor.id ||
          assignment.reviewerIds.includes(actor.id) ||
          involvedAssignmentIds.has(assignment.id),
      )
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async createAssignment(actor: SessionActor, input: CreateAssignmentInput): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'assignment.create', actor: asActor(actor) });
    const owner = await this.getActiveEmployee(ctx, input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });
    const reviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds ?? []);
    const timestamp = this.now().toISOString();
    const existingCount = (await this.repository.listAssignments(ctx)).length;

    const assignment: AssignmentDto = {
      id: this.createId('asg'),
      code: `ASN-DEMO-${String(existingCount + 1).padStart(4, '0')}`,
      clientId: input.clientId,
      clientName: input.clientName,
      title: input.title,
      service: input.service,
      ownerId: owner.id,
      reviewerIds,
      status: 'open',
      dueAt: input.dueAt,
      recurringScheduleId: null,
      createdById: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.saveAssignment(ctx, assignment);
  }

  async transitionAssignment(
    actor: SessionActor,
    assignmentId: string,
    transition: AssignmentTransition,
  ): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const assignment = await this.getAssignment(ctx, assignmentId);

    switch (transition) {
      case 'start':
        requireAuthority({
          action: 'assignment.progress',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (assignment.status !== 'open') invalidTransition('Only an open Assignment can be started.');
        assignment.status = 'in_progress';
        break;
      case 'submit':
        requireAuthority({
          action: 'assignment.submit',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
        });
        if (assignment.status !== 'open' && assignment.status !== 'in_progress') {
          invalidTransition('Only an open or in-progress Assignment can be submitted.');
        }
        assignment.status = 'ready_for_review';
        break;
      case 'complete':
        requireAuthority({ action: 'assignment.approve', actor: asActor(actor) });
        if (assignment.status !== 'ready_for_review') {
          invalidTransition('An Assignment must be ready for review before leadership completes it.');
        }
        assignment.status = 'completed';
        break;
      case 'reopen':
        requireAuthority({ action: 'assignment.reassign', actor: asActor(actor) });
        if (assignment.status === 'completed') {
          invalidTransition('An approved Assignment is a terminal immutable audit artifact and cannot be reopened.');
        }
        if (assignment.status !== 'ready_for_review') {
          invalidTransition('Only a submitted Assignment can be reopened (request changes).');
        }
        assignment.status = 'in_progress';
        break;
    }

    assignment.updatedAt = this.now().toISOString();
    return await this.repository.saveAssignment(ctx, assignment);
  }

  async listRecurringSchedules(actor: SessionActor): Promise<RecurringScheduleDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const schedules = await this.repository.listRecurringSchedules(ctx);
    return schedules
      .filter(
        (schedule) =>
          isLeadership(actor.role) || schedule.ownerId === actor.id || schedule.reviewerIds.includes(actor.id),
      )
      .sort((left, right) => left.nextOccurrenceOn.localeCompare(right.nextOccurrenceOn));
  }

  async createRecurringSchedule(
    actor: SessionActor,
    input: CreateRecurringScheduleInput,
  ): Promise<RecurringScheduleDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    const owner = await this.getActiveEmployee(ctx, input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });
    const timestamp = this.now().toISOString();
    const schedule: RecurringScheduleDto = {
      id: this.createId('sch'),
      clientId: input.clientId,
      clientName: input.clientName,
      title: input.title,
      service: input.service,
      cadence: input.cadence,
      ownerId: owner.id,
      reviewerIds: await this.validateReviewerIds(ctx, input.reviewerIds ?? []),
      nextOccurrenceOn: input.nextOccurrenceOn,
      dueDay: input.dueDay,
      active: true,
      createdById: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.saveRecurringSchedule(ctx, schedule);
  }

  async updateRecurringSchedule(
    actor: SessionActor,
    scheduleId: string,
    patch: { active?: boolean; nextOccurrenceOn?: string },
  ): Promise<RecurringScheduleDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    const schedule = await this.repository.getRecurringSchedule(ctx, scheduleId);
    if (!schedule) throw notFound('Recurring Schedule');

    if (patch.active !== undefined) schedule.active = patch.active;
    if (patch.nextOccurrenceOn !== undefined) schedule.nextOccurrenceOn = patch.nextOccurrenceOn;
    schedule.updatedAt = this.now().toISOString();
    return await this.repository.saveRecurringSchedule(ctx, schedule);
  }

  async listWorkItems(actor: SessionActor): Promise<WorkItemDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const [items, assignments] = await Promise.all([
      this.repository.listWorkItems(ctx),
      this.repository.listAssignments(ctx),
    ]);
    const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));

    return items
      .filter((item) => {
        if (item.kind === 'personal') return item.assigneeId === actor.id;
        if (isLeadership(actor.role) || item.assigneeId === actor.id || item.createdById === actor.id) return true;
        const assignment = item.assignmentId ? assignmentsById.get(item.assignmentId) : undefined;
        return assignment?.ownerId === actor.id || assignment?.reviewerIds.includes(actor.id) || false;
      })
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async createWorkItem(
    actor: SessionActor,
    input: CreateWorkItemServiceInput,
  ): Promise<WorkItemDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const dueTime = parseIsoInstant(input.dueAt);
    let assignmentId: string | null = null;
    let relatedClientId: string | null = null;
    let relatedPartyName: string | null = null;
    let assigneeId: string;

    if (input.kind === 'delegated') {
      const [assignment, assignee] = await Promise.all([
        this.getAssignment(ctx, input.assignmentId),
        this.getActiveEmployee(ctx, input.assigneeId),
      ]);
      requireAuthority({
        action: 'task.delegate',
        actor: asActor(actor),
        target: assignee,
        assignmentOwnerId: assignment.ownerId,
        reviewerIds: assignment.reviewerIds,
      });
      const assignmentDueTime = parseIsoInstant(assignment.dueAt);
      if (dueTime > assignmentDueTime) {
        throw new ApiError(422, 'task_due_after_assignment', 'Delegated work must be due no later than its parent Assignment.');
      }
      assignmentId = assignment.id;
      relatedClientId = assignment.clientId;
      relatedPartyName = assignment.clientName;
      assigneeId = assignee.id;
    } else if (input.kind === 'internal') {
      const assignee = await this.getActiveEmployee(ctx, input.assigneeId);
      requireAuthority({ action: 'task.create_internal', actor: asActor(actor), target: assignee });
      assigneeId = assignee.id;
    } else {
      requireAuthority({ action: 'task.create_personal', actor: asActor(actor), ownerId: actor.id });
      assigneeId = actor.id;
      relatedClientId = input.relatedClientId ?? null;
      relatedPartyName = input.relatedPartyName ?? null;
    }

    let reminderAt: string | null = null;
    if (input.reminderAt !== undefined && input.reminderAt !== null) {
      const reminderTime = parseIsoInstant(input.reminderAt);
      if (reminderTime > dueTime) {
        throw new ApiError(422, 'reminder_after_due_time', 'A reminder must occur on or before the task due time.');
      }
      reminderAt = input.reminderAt;
    }

    const timestamp = this.now().toISOString();
    const item: WorkItemDto = {
      id: this.createId('wrk'),
      kind: input.kind,
      title: input.title,
      notes: input.notes ?? null,
      assignmentId,
      relatedClientId,
      relatedPartyName,
      assigneeId,
      createdById: actor.id,
      status: 'todo',
      dueAt: input.dueAt,
      reminderAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.saveWorkItem(ctx, item);
  }

  async transitionWorkItem(
    actor: SessionActor,
    workItemId: string,
    transition: WorkItemTransition,
  ): Promise<WorkItemDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const item = await this.repository.getWorkItem(ctx, workItemId);
    if (!item) throw notFound('Work Item');
    const actorIsAssignee = item.assigneeId === actor.id;
    const actorCanReview = isLeadership(actor.role) || item.createdById === actor.id;

    switch (transition) {
      case 'start':
        if (!actorIsAssignee && !isLeadership(actor.role)) {
          throw forbidden('not_work_item_assignee', 'Only the assignee or practice leadership may start this Work Item.');
        }
        if (item.status !== 'todo') invalidTransition('Only a queued Work Item can be started.');
        item.status = 'in_progress';
        break;
      case 'submit':
        if (item.kind === 'personal') invalidTransition('Personal Tasks are completed directly and do not require review.');
        if (!actorIsAssignee) {
          throw forbidden('not_work_item_assignee', 'Only the assignee may submit this Work Item for review.');
        }
        if (item.status !== 'todo' && item.status !== 'in_progress') {
          invalidTransition('Only a queued or in-progress Work Item can be submitted.');
        }
        item.status = 'ready_for_review';
        break;
      case 'complete':
        if (item.kind === 'personal') {
          if (!actorIsAssignee) {
            throw forbidden('not_work_item_owner', 'Only the owner may complete a Personal Task.');
          }
          if (item.status !== 'todo' && item.status !== 'in_progress') {
            invalidTransition('Only a queued or in-progress Personal Task can be completed.');
          }
        } else {
          if (!actorCanReview) {
            throw forbidden('not_work_item_reviewer', 'Only its delegator or practice leadership may approve this Work Item.');
          }
          if (item.status !== 'ready_for_review') {
            invalidTransition('A delegated or internal Work Item must be submitted before it is completed.');
          }
        }
        item.status = 'done';
        break;
      case 'reopen':
        if (item.kind === 'personal' ? !actorIsAssignee : !actorCanReview) {
          throw forbidden('not_work_item_reviewer', 'You do not have authority to reopen this Work Item.');
        }
        if (item.status === 'done') {
          invalidTransition('A completed Work Item is a terminal immutable audit artifact and cannot be reopened.');
        }
        if (item.status !== 'ready_for_review') {
          invalidTransition('Only a submitted Work Item can be reopened (request changes).');
        }
        item.status = 'in_progress';
        break;
    }

    item.updatedAt = this.now().toISOString();
    return await this.repository.saveWorkItem(ctx, item);
  }

  async listReportingLines(actor: SessionActor): Promise<ReportingLineDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const employees = (await this.repository.listEmployees(ctx)).filter((employee) => employee.active);
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    return employees
      .map((employee) => ({
        employee: asSession(employee),
        manager: employee.reportsToId ? asSession(byId.get(employee.reportsToId)!) : null,
      }))
      .sort((left, right) => left.employee.name.localeCompare(right.employee.name));
  }

  async updateReportingLine(
    actor: SessionActor,
    employeeId: string,
    managerId: string | null,
  ): Promise<ReportingLineDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const subject = await this.getActiveEmployee(ctx, employeeId);
    const manager = managerId ? await this.getActiveEmployee(ctx, managerId) : null;
    requireAuthority({
      action: 'team.manage_reporting',
      actor: asActor(actor),
      subject,
      proposedManager: manager,
    });

    subject.reportsToId = manager?.id ?? null;
    const savedSubject = await this.repository.saveEmployee(ctx, subject);
    return { employee: asSession(savedSubject), manager: manager ? asSession(manager) : null };
  }

  async getOfficeAccountsSummary(actor: SessionActor): Promise<OfficeAccountsSummaryDto> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    const entries = await this.repository.listLedgerEntries(ctx);
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

  async listLedgerEntries(actor: SessionActor): Promise<LedgerEntryDto[]> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    const entries = await this.repository.listLedgerEntries(ctx);
    return entries.sort(
      (left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.createdAt.localeCompare(left.createdAt),
    );
  }

  async createLedgerEntry(actor: SessionActor, input: CreateLedgerEntryInput): Promise<LedgerEntryDto> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    const entry: LedgerEntryDto = {
      id: this.createId('led'),
      occurredOn: input.occurredOn,
      account: input.account,
      direction: input.direction,
      amountPaise: input.amountPaise,
      narration: input.narration,
      reference: input.reference ?? null,
      recordedById: actor.id,
      createdAt: this.now().toISOString(),
    };
    return await this.repository.saveLedgerEntry(ctx, entry);
  }

  private requireFinanceAuthority(actor: SessionActor): void {
    requireAuthority({ action: 'finance.manage', actor: asActor(actor) });
  }

  private async getActiveEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord> {
    const employee = await this.repository.getEmployee(ctx, id);
    if (!employee?.active) throw notFound('Employee');
    return employee;
  }

  private async getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto> {
    const assignment = await this.repository.getAssignment(ctx, id);
    if (!assignment) throw notFound('Assignment');
    return assignment;
  }

  private async validateReviewerIds(ctx: RepositoryContext, ids: readonly string[]): Promise<string[]> {
    const reviewerIds = unique(ids);
    const reviewers = await Promise.all(reviewerIds.map((id) => this.getActiveEmployee(ctx, id)));
    if (reviewers.some((reviewer) => !isLeadership(reviewer.role))) {
      throw new ApiError(422, 'invalid_assignment_reviewer', 'Assignment reviewers must be the Founder or Manager.');
    }
    return reviewerIds;
  }
}
