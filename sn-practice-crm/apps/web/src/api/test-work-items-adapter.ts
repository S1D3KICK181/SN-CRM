import type {
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import {
  WorkItemOperationError,
  type WorkItemsPort,
} from './work-items-types';

export interface RecordedWorkItemCall {
  action: 'list' | 'create' | 'transition';
  role: CompanyRole;
  id?: string;
  input?: CreateWorkItemInput;
  transition?: WorkItemTransition;
  signal?: AbortSignal;
}

export class DeterministicTestWorkItemsAdapter implements WorkItemsPort {
  private readonly listResponses = new Map<CompanyRole, WorkItemDto[]>();
  private readonly deferredLists = new Map<CompanyRole, Promise<WorkItemDto[]>>();
  private readonly listErrors = new Map<CompanyRole, Error>();

  private createResponseHandler?: (
    role: CompanyRole,
    input: CreateWorkItemInput,
  ) => Promise<WorkItemDto> | WorkItemDto;
  private createError?: Error;

  private transitionResponseHandler?: (
    role: CompanyRole,
    id: string,
    action: WorkItemTransition,
  ) => Promise<WorkItemDto> | WorkItemDto;
  private transitionErrors = new Map<string, Error>();

  readonly calls: RecordedWorkItemCall[] = [];

  setListResponse(role: CompanyRole, items: WorkItemDto[]): void {
    this.listResponses.set(role, items);
  }

  setDeferredList(role: CompanyRole, promise: Promise<WorkItemDto[]>): void {
    this.deferredLists.set(role, promise);
  }

  setListError(role: CompanyRole, error: Error): void {
    this.listErrors.set(role, error);
  }

  setCreateHandler(
    handler: (role: CompanyRole, input: CreateWorkItemInput) => Promise<WorkItemDto> | WorkItemDto,
  ): void {
    this.createResponseHandler = handler;
  }

  setCreateError(error: Error): void {
    this.createError = error;
  }

  setTransitionHandler(
    handler: (
      role: CompanyRole,
      id: string,
      action: WorkItemTransition,
    ) => Promise<WorkItemDto> | WorkItemDto,
  ): void {
    this.transitionResponseHandler = handler;
  }

  setTransitionError(id: string, error: Error): void {
    this.transitionErrors.set(id, error);
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<WorkItemDto[]> {
    this.calls.push({ action: 'list', role, signal: options?.signal });

    if (options?.signal?.aborted) {
      throw new WorkItemOperationError({
        code: 'aborted',
        message: 'List operation was aborted.',
      });
    }

    const err = this.listErrors.get(role);
    if (err) throw err;

    const deferred = this.deferredLists.get(role);
    if (deferred) {
      return deferred;
    }

    const items = this.listResponses.get(role);
    if (items) {
      return [...items];
    }

    return [];
  }

  async create(
    role: CompanyRole,
    input: CreateWorkItemInput,
    options?: PortExecutionOptions,
  ): Promise<WorkItemDto> {
    this.calls.push({ action: 'create', role, input, signal: options?.signal });

    if (options?.signal?.aborted) {
      throw new WorkItemOperationError({
        code: 'aborted',
        message: 'Create operation was aborted.',
      });
    }

    if (this.createError) {
      throw this.createError;
    }

    if (this.createResponseHandler) {
      return this.createResponseHandler(role, input);
    }

    // Default mock response
    return {
      id: `wrk_mock_${Date.now()}`,
      kind: input.kind,
      title: input.title,
      notes: input.notes ?? null,
      assignmentId: input.kind === 'delegated' ? input.assignmentId : null,
      relatedClientId: input.kind === 'personal' ? input.relatedClientId ?? null : null,
      relatedPartyName: input.kind === 'personal' ? input.relatedPartyName ?? null : null,
      assigneeId: input.kind === 'delegated' ? input.assigneeId : 'usr_staff',
      createdById: 'usr_staff',
      status: 'todo',
      dueAt: input.dueAt,
      reminderAt: input.reminderAt ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async transition(
    role: CompanyRole,
    id: string,
    action: WorkItemTransition,
    options?: PortExecutionOptions,
  ): Promise<WorkItemDto> {
    this.calls.push({ action: 'transition', role, id, transition: action, signal: options?.signal });

    if (options?.signal?.aborted) {
      throw new WorkItemOperationError({
        code: 'aborted',
        message: 'Transition operation was aborted.',
      });
    }

    const err = this.transitionErrors.get(id);
    if (err) throw err;

    if (this.transitionResponseHandler) {
      return this.transitionResponseHandler(role, id, action);
    }

    // Default mock response
    const nextStatus =
      action === 'start'
        ? 'in_progress'
        : action === 'submit'
        ? 'ready_for_review'
        : action === 'complete'
        ? 'done'
        : 'in_progress';

    return {
      id,
      kind: 'delegated',
      title: 'Mock transitioned item',
      notes: null,
      assignmentId: 'asg_mock',
      relatedClientId: 'cli_mock',
      relatedPartyName: 'Mock Client',
      assigneeId: 'usr_trainee',
      createdById: 'usr_staff',
      status: nextStatus,
      dueAt: new Date().toISOString(),
      reminderAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
