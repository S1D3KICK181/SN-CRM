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
import type { CrmRepository, EmployeeRecord } from './repository';

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

export class CrmApplication {
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(
    private readonly repository: CrmRepository,
    options: ApplicationOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? ((prefix) => `${prefix}_${crypto.randomUUID()}`);
  }

  async listDemoActors(): Promise<SessionActor[]> {
    const employees = await this.repository.listEmployees();
    return employees
      .filter((employee) => employee.active)
      .map(asSession)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async requireActor(id: string | undefined): Promise<SessionActor> {
    if (!id) {
      throw new ApiError(401, 'demo_session_required', 'Choose a demo user and send its id in the x-demo-user-id header.');
    }

    const employee = await this.repository.getEmployee(id);
    if (!employee?.active) {
      throw new ApiError(401, 'invalid_demo_session', 'The selected demo user does not exist or is inactive.');
    }
    return asSession(employee);
  }

  async listAssignments(actor: SessionActor): Promise<AssignmentDto[]> {
    const [assignments, workItems] = await Promise.all([
      this.repository.listAssignments(),
      this.repository.listWorkItems(),
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
    requireAuthority({ action: 'assignment.create', actor: asActor(actor) });
    const owner = await this.getActiveEmployee(input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });
    const reviewerIds = await this.validateReviewerIds(input.reviewerIds ?? []);
    const timestamp = this.now().toISOString();
    const existingCount = (await this.repository.listAssignments()).length;

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

    await this.repository.saveAssignment(assignment);
    return assignment;
  }

  async transitionAssignment(
    actor: SessionActor,
    assignmentId: string,
    transition: AssignmentTransition,
  ): Promise<AssignmentDto> {
    const assignment = await this.getAssignment(assignmentId);

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
        if (assignment.status !== 'completed' && assignment.status !== 'ready_for_review') {
          invalidTransition('Only a completed or submitted Assignment can be reopened.');
        }
        assignment.status = 'in_progress';
        break;
    }

    assignment.updatedAt = this.now().toISOString();
    await this.repository.saveAssignment(assignment);
    return assignment;
  }

  async listRecurringSchedules(actor: SessionActor): Promise<RecurringScheduleDto[]> {
    const schedules = await this.repository.listRecurringSchedules();
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
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    const owner = await this.getActiveEmployee(input.ownerId);
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
      reviewerIds: await this.validateReviewerIds(input.reviewerIds ?? []),
      nextOccurrenceOn: input.nextOccurrenceOn,
      dueDay: input.dueDay,
      active: true,
      createdById: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.saveRecurringSchedule(schedule);
    return schedule;
  }

  async updateRecurringSchedule(
    actor: SessionActor,
    scheduleId: string,
    patch: { active?: boolean; nextOccurrenceOn?: string },
  ): Promise<RecurringScheduleDto> {
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    const schedule = await this.repository.getRecurringSchedule(scheduleId);
    if (!schedule) throw notFound('Recurring Schedule');

    if (patch.active !== undefined) schedule.active = patch.active;
    if (patch.nextOccurrenceOn !== undefined) schedule.nextOccurrenceOn = patch.nextOccurrenceOn;
    schedule.updatedAt = this.now().toISOString();
    await this.repository.saveRecurringSchedule(schedule);
    return schedule;
  }

  async listWorkItems(actor: SessionActor): Promise<WorkItemDto[]> {
    const [items, assignments] = await Promise.all([
      this.repository.listWorkItems(),
      this.repository.listAssignments(),
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

  async createWorkItem(actor: SessionActor, input: CreateWorkItemInput): Promise<WorkItemDto> {
    let assignmentId: string | null = null;
    let relatedClientId: string | null = null;
    let relatedPartyName: string | null = null;
    let assigneeId: string;

    if (input.kind === 'delegated') {
      const [assignment, assignee] = await Promise.all([
        this.getAssignment(input.assignmentId),
        this.getActiveEmployee(input.assigneeId),
      ]);
      requireAuthority({
        action: 'task.delegate',
        actor: asActor(actor),
        target: assignee,
        assignmentOwnerId: assignment.ownerId,
        reviewerIds: assignment.reviewerIds,
      });
      if (input.dueAt > assignment.dueAt) {
        throw new ApiError(422, 'task_due_after_assignment', 'Delegated work must be due no later than its parent Assignment.');
      }
      assignmentId = assignment.id;
      relatedClientId = assignment.clientId;
      relatedPartyName = assignment.clientName;
      assigneeId = assignee.id;
    } else if (input.kind === 'internal') {
      const assignee = await this.getActiveEmployee(input.assigneeId);
      requireAuthority({ action: 'task.create_internal', actor: asActor(actor), target: assignee });
      assigneeId = assignee.id;
    } else {
      requireAuthority({ action: 'task.create_personal', actor: asActor(actor), ownerId: actor.id });
      assigneeId = actor.id;
      relatedClientId = input.relatedClientId ?? null;
      relatedPartyName = input.relatedPartyName ?? null;
    }

    if (input.reminderAt && input.reminderAt > input.dueAt) {
      throw new ApiError(422, 'reminder_after_due_time', 'A reminder must occur on or before the task due time.');
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
      reminderAt: input.reminderAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.saveWorkItem(item);
    return item;
  }

  async transitionWorkItem(
    actor: SessionActor,
    workItemId: string,
    transition: WorkItemTransition,
  ): Promise<WorkItemDto> {
    const item = await this.repository.getWorkItem(workItemId);
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
        if (item.status !== 'ready_for_review' && item.status !== 'done') {
          invalidTransition('Only a submitted or completed Work Item can be reopened.');
        }
        item.status = 'in_progress';
        break;
    }

    item.updatedAt = this.now().toISOString();
    await this.repository.saveWorkItem(item);
    return item;
  }

  async listReportingLines(_actor: SessionActor): Promise<ReportingLineDto[]> {
    const employees = (await this.repository.listEmployees()).filter((employee) => employee.active);
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
    const subject = await this.getActiveEmployee(employeeId);
    const manager = managerId ? await this.getActiveEmployee(managerId) : null;
    requireAuthority({
      action: 'team.manage_reporting',
      actor: asActor(actor),
      subject,
      proposedManager: manager,
    });

    subject.reportsToId = manager?.id ?? null;
    await this.repository.saveEmployee(subject);
    return { employee: asSession(subject), manager: manager ? asSession(manager) : null };
  }

  async getOfficeAccountsSummary(actor: SessionActor): Promise<OfficeAccountsSummaryDto> {
    this.requireFinanceAuthority(actor);
    const entries = await this.repository.listLedgerEntries();
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
    const entries = await this.repository.listLedgerEntries();
    return entries.sort(
      (left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.createdAt.localeCompare(left.createdAt),
    );
  }

  async createLedgerEntry(actor: SessionActor, input: CreateLedgerEntryInput): Promise<LedgerEntryDto> {
    this.requireFinanceAuthority(actor);
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
    await this.repository.saveLedgerEntry(entry);
    return entry;
  }

  private requireFinanceAuthority(actor: SessionActor): void {
    requireAuthority({ action: 'finance.manage', actor: asActor(actor) });
  }

  private async getActiveEmployee(id: string): Promise<EmployeeRecord> {
    const employee = await this.repository.getEmployee(id);
    if (!employee?.active) throw notFound('Employee');
    return employee;
  }

  private async getAssignment(id: string): Promise<AssignmentDto> {
    const assignment = await this.repository.getAssignment(id);
    if (!assignment) throw notFound('Assignment');
    return assignment;
  }

  private async validateReviewerIds(ids: readonly string[]): Promise<string[]> {
    const reviewerIds = unique(ids);
    const reviewers = await Promise.all(reviewerIds.map((id) => this.getActiveEmployee(id)));
    if (reviewers.some((reviewer) => !isLeadership(reviewer.role))) {
      throw new ApiError(422, 'invalid_assignment_reviewer', 'Assignment reviewers must be the Founder or Manager.');
    }
    return reviewerIds;
  }
}
