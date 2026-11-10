import { authorize, type Actor, type AuthorityRequest, type CompanyRole } from '@sn/domain';
import type {
  AssignmentDto,
  AssignmentStatus,
  AssignmentTransition,
  ClientDto,
  CreateAssignmentInput,
  CreateClientInput,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  CreateWorkItemInput,
  GenerateDueAssignmentsInput,
  GenerateDueAssignmentsResult,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  RecurringScheduleDto,
  ReportingLineDto,
  SessionActor,
  UpdateAssignmentInput,
  UpdateRecurringScheduleInput,
  WorkItemDto,
  WorkItemStatus,
  WorkItemTransition,
} from '@sn/contracts';
import { ApiError, forbidden, notFound } from './errors';
import type {
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmApplicationDependencies,
  EmployeeRecord,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentCommand,
} from './repository';
import { parseIsoInstant } from './schemas';

export interface ApplicationOptions {
  now?: () => Date;
  createId?: (prefix?: string) => string;
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
  private readonly createId: (prefix?: string) => string;

  constructor(
    private readonly repository: CrmApplicationDependencies,
    options: ApplicationOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
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

  // --- Clients (Read-Only) ---

  async listClients(actor: SessionActor): Promise<ClientDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'client.read', actor: asActor(actor) });
    return await this.repository.listClients(ctx);
  }

  async getClient(actor: SessionActor, clientId: string): Promise<ClientDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'client.read', actor: asActor(actor) });
    const client = await this.repository.getClient(ctx, clientId);
    if (!client) {
      throw notFound('Client');
    }
    return client;
  }

  assertClientCreateAuthority(actor: SessionActor): void {
    requireAuthority({ action: 'client.create', actor: asActor(actor) });
  }

  async createClient(actor: SessionActor, input: CreateClientInput): Promise<ClientDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    this.assertClientCreateAuthority(actor);

    let relationshipOwnerId: string | null = null;
    if (input.relationshipOwnerId) {
      const owner = await this.repository.getEmployee(ctx, input.relationshipOwnerId);
      if (!owner) {
        throw notFound('Employee');
      }
      if (!owner.active || owner.role === 'trainee') {
        throw new ApiError(
          422,
          'validation_failed',
          'A Client relationship owner must be active and cannot be a Trainee.',
        );
      }
      relationshipOwnerId = owner.id;
    }

    const timestamp = this.now().toISOString();
    const record: CreateClientRecord = {
      id: this.createId('cli'),
      displayName: input.displayName,
      legalName: input.legalName ?? null,
      pan: input.pan ?? null,
      gstin: input.gstin ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      relationshipOwnerId,
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.createClient(ctx, record);
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

    const client = await this.repository.getClientReference(ctx, input.clientId);
    if (!client) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced client does not exist.');
    }

    let serviceRef: ServiceReference | null = null;
    if (input.serviceId) {
      serviceRef = await this.repository.getServiceReferenceById(ctx, input.serviceId);
    } else if (input.service) {
      serviceRef = await this.repository.getServiceReferenceByName(ctx, input.service);
    }
    if (!serviceRef) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced service does not exist.');
    }

    const owner = await this.getActiveEmployee(ctx, input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });

    const reviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds ?? []);
    const timestamp = this.now().toISOString();

    const record: CreateAssignmentRecord = {
      id: this.createId('asg'),
      clientId: client.id,
      clientName: client.name,
      serviceId: serviceRef.id,
      service: serviceRef.name,
      title: input.title,
      ownerId: owner.id,
      reviewerIds,
      status: 'assigned',
      dueAt: input.dueAt,
      recurringScheduleId: input.recurringScheduleId ?? null,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      priority: input.priority ?? 'normal',
      createdById: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.createAssignment(ctx, record);
  }

  async transitionAssignment(
    actor: SessionActor,
    assignmentId: string,
    transition: AssignmentTransition,
    options?: {
      expectedUpdatedAt?: string;
      deliveryNotes?: string;
      reviewNotes?: string;
      progressPercent?: number;
    },
  ): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const assignment = await this.getAssignment(ctx, assignmentId);

    const normalizedAction = transition === 'reopen' ? 'request_changes' : transition;

    if (assignment.status === 'approved' || assignment.status === 'closed') {
      throw new ApiError(
        409,
        'invalid_state_transition',
        'An approved Assignment is a terminal immutable audit artifact and cannot be reopened.',
      );
    }

    let nextStatus: AssignmentStatus;
    switch (normalizedAction) {
      case 'start': {
        requireAuthority({
          action: 'assignment.progress',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (assignment.status !== 'assigned' && assignment.status !== 'changes_requested') {
          invalidTransition(`Cannot start assignment in status ${assignment.status}.`);
        }
        nextStatus = 'in_progress';
        break;
      }
      case 'submit': {
        requireAuthority({
          action: 'assignment.submit',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (
          assignment.status !== 'assigned' &&
          assignment.status !== 'in_progress' &&
          assignment.status !== 'changes_requested'
        ) {
          invalidTransition(`Cannot submit assignment in status ${assignment.status}.`);
        }
        nextStatus = 'ready_for_review';
        break;
      }
      case 'complete': {
        requireAuthority({ action: 'assignment.approve', actor: asActor(actor) });
        if (assignment.status !== 'ready_for_review') {
          invalidTransition('An Assignment must be ready for review before leadership completes it.');
        }
        nextStatus = 'approved';
        break;
      }
      case 'request_changes': {
        requireAuthority({
          action: 'assignment.request_changes',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (assignment.status !== 'ready_for_review' && assignment.status !== 'in_progress') {
          invalidTransition('Only a submitted or in-progress Assignment can have changes requested.');
        }
        nextStatus = 'changes_requested';
        break;
      }
      default:
        invalidTransition(`Unsupported transition action: ${transition}`);
    }

    return await this.repository.updateAssignmentStatus(ctx, {
      id: assignment.id,
      status: nextStatus,
      expectedUpdatedAt: options?.expectedUpdatedAt,
      deliveryNotes: options?.deliveryNotes,
      reviewNotes: options?.reviewNotes,
      progressPercent: options?.progressPercent,
    });
  }

  async updateAssignment(
    actor: SessionActor,
    assignmentId: string,
    input: UpdateAssignmentInput,
  ): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const assignment = await this.getAssignment(ctx, assignmentId);

    const isModifyingLeadershipFields =
      input.title !== undefined ||
      input.serviceId !== undefined ||
      input.ownerId !== undefined ||
      input.reviewerIds !== undefined ||
      input.dueAt !== undefined ||
      input.fee !== undefined;

    if (isModifyingLeadershipFields) {
      if (!isLeadership(actor.role)) {
        throw forbidden('role_not_permitted', 'Only Founder and Manager may modify assignment configuration, ownership, or review gates.');
      }
    }

    // Any core mutation is locked once assignment is approved or closed
    if (assignment.status === 'approved' || assignment.status === 'closed') {
      const hasCoreMutation =
        input.title !== undefined ||
        input.serviceId !== undefined ||
        input.ownerId !== undefined ||
        input.reviewerIds !== undefined ||
        input.dueAt !== undefined ||
        input.fee !== undefined ||
        input.deliveryNotes !== undefined ||
        input.reviewNotes !== undefined ||
        input.progressPercent !== undefined ||
        input.bankStatementRequired !== undefined;

      if (hasCoreMutation) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          'An approved or closed Assignment is an immutable audit artifact.',
        );
      }
    }

    // If updating delivery notes or progress percent as non-leadership, must be owner or reviewer
    if (input.deliveryNotes !== undefined || input.progressPercent !== undefined) {
      requireAuthority({
        action: 'assignment.progress',
        actor: asActor(actor),
        assignmentOwnerId: assignment.ownerId,
        reviewerIds: assignment.reviewerIds,
      });
    }

    let serviceName = assignment.service;
    if (input.serviceId !== undefined) {
      const serviceRef = await this.repository.getServiceReferenceById(ctx, input.serviceId);
      if (!serviceRef) {
        throw new ApiError(422, 'referenced_entity_not_found', 'Referenced service does not exist in catalog.');
      }
      serviceName = serviceRef.name;
    }

    let targetOwnerId: string | undefined = undefined;
    if (input.ownerId !== undefined) {
      const owner = await this.getActiveEmployee(ctx, input.ownerId);
      if (owner.role === 'trainee') {
        throw new ApiError(
          422,
          'trainee_cannot_own_assignment',
          'A Trainee receives Work Items, not primary ownership of an Assignment.',
        );
      }
      requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });
      targetOwnerId = owner.id;
    }

    let targetReviewerIds: string[] | undefined = undefined;
    if (input.reviewerIds !== undefined) {
      targetReviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds);
    }

    const command: UpdateAssignmentCommand = {
      id: assignment.id,
      title: input.title,
      serviceId: input.serviceId,
      service: serviceName,
      ownerId: targetOwnerId,
      reviewerIds: targetReviewerIds,
      dueAt: input.dueAt,
      fee: input.fee,
      deliveryNotes: input.deliveryNotes,
      reviewNotes: input.reviewNotes,
      progressPercent: input.progressPercent,
      bankStatementRequired: input.bankStatementRequired,
      expectedUpdatedAt: input.expectedUpdatedAt,
      actorId: actor.id,
    };

    return await this.repository.updateAssignment(ctx, command);
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

    const client = await this.repository.getClientReference(ctx, input.clientId);
    if (!client) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced client does not exist.');
    }

    let serviceRef: ServiceReference | null = null;
    if (input.serviceId) {
      serviceRef = await this.repository.getServiceReferenceById(ctx, input.serviceId);
    } else if (input.service) {
      serviceRef = await this.repository.getServiceReferenceByName(ctx, input.service);
    }
    const serviceId = serviceRef?.id ?? input.serviceId ?? '50000000-0000-4000-a000-000000000001';
    const service = serviceRef?.name ?? input.service ?? 'General Compliance';

    const owner = await this.getActiveEmployee(ctx, input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });

    const reviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds ?? []);

    return await this.repository.createRecurringSchedule(ctx, {
      ...input,
      id: this.createId('sch'),
      createdById: actor.id,
      clientName: client.name,
      serviceId,
      service,
      reviewerIds,
    });
  }

  async updateRecurringSchedule(
    actor: SessionActor,
    scheduleId: string,
    patch: { active?: boolean; nextOccurrenceOn?: string },
  ): Promise<RecurringScheduleDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    return await this.repository.updateRecurringSchedule(ctx, scheduleId, patch);
  }

  async generateDueAssignments(
    actor: SessionActor,
    input?: GenerateDueAssignmentsInput,
  ): Promise<GenerateDueAssignmentsResult> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    const throughDate = input?.throughDate ?? this.now().toISOString().slice(0, 10);
    return await this.repository.materializeDueAssignments(ctx, throughDate);
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
    const record: CreateWorkItemRecord = {
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
      priority: input.priority ?? 'normal',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.createWorkItem(ctx, record);
  }

  async transitionWorkItem(
    actor: SessionActor,
    workItemId: string,
    transition: WorkItemTransition,
    options?: {
      expectedUpdatedAt?: string;
      notes?: string;
      completionNote?: string;
      progressPercent?: number;
    },
  ): Promise<WorkItemDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const item = await this.repository.getWorkItem(ctx, workItemId);
    if (!item) throw notFound('Work Item');
    const actorIsAssignee = item.assigneeId === actor.id;
    const actorCanReview = isLeadership(actor.role) || item.createdById === actor.id;

    const normalizedAction = transition === 'reopen' ? 'request_changes' : transition;

    if (item.status === 'completed') {
      throw new ApiError(
        409,
        'invalid_state_transition',
        'A completed Work Item is a terminal immutable audit artifact and cannot be reopened.',
      );
    }

    let nextStatus: WorkItemStatus;
    switch (normalizedAction) {
      case 'start': {
        if (!actorIsAssignee && !isLeadership(actor.role)) {
          throw forbidden('not_work_item_assignee', 'Only the assignee or practice leadership may start this Work Item.');
        }
        if (item.status !== 'todo' && item.status !== 'changes_requested') {
          invalidTransition('Only a queued or changes_requested Work Item can be started.');
        }
        nextStatus = 'in_progress';
        break;
      }
      case 'submit': {
        if (item.kind === 'personal') invalidTransition('Personal Tasks are completed directly and do not require review.');
        if (!actorIsAssignee) {
          throw forbidden('not_work_item_assignee', 'Only the assignee may submit this Work Item for review.');
        }
        if (item.status !== 'todo' && item.status !== 'in_progress' && item.status !== 'changes_requested') {
          invalidTransition('Only a queued, in-progress, or changes_requested Work Item can be submitted.');
        }
        nextStatus = 'ready_for_review';
        break;
      }
      case 'complete': {
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
        nextStatus = 'completed';
        break;
      }
      case 'request_changes': {
        if (item.kind === 'personal' ? !actorIsAssignee : !actorCanReview) {
          throw forbidden('not_work_item_reviewer', 'You do not have authority to request changes on this Work Item.');
        }
        if (item.status !== 'ready_for_review') {
          invalidTransition('Only a submitted Work Item can be requested for changes.');
        }
        nextStatus = 'changes_requested';
        break;
      }
      default:
        invalidTransition(`Unsupported transition action: ${transition}`);
    }

    return await this.repository.updateWorkItemStatus(ctx, {
      id: item.id,
      status: nextStatus,
      expectedUpdatedAt: options?.expectedUpdatedAt,
      notes: options?.notes,
      completionNote: options?.completionNote,
      progressPercent: options?.progressPercent,
    });
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

    return await this.repository.updateReportingLine(ctx, employeeId, manager?.id ?? null);
  }

  async getOfficeAccountsSummary(actor: SessionActor): Promise<OfficeAccountsSummaryDto> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    return await this.repository.getOfficeAccountsSummary(ctx);
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
    return await this.repository.createLedgerEntry(ctx, {
      ...input,
      id: this.createId('led'),
      recordedById: actor.id,
    });
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
    if (reviewers.some((reviewer) => reviewer.role === 'trainee')) {
      throw new ApiError(422, 'invalid_assignment_reviewer', 'A Trainee cannot be assigned as an assignment reviewer.');
    }
    return reviewerIds;
  }
}
