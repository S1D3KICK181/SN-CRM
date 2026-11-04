import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import type {
  AssignmentContractTransition,
  AssignmentsPort,
  CreateAssignmentCommand,
  PortExecutionOptions,
} from './types';

export class DeterministicTestAssignmentsAdapter implements AssignmentsPort {
  private listResponses = new Map<CompanyRole, AssignmentRow[]>();
  private listErrors = new Map<CompanyRole, Error>();
  private deferredLists = new Map<CompanyRole, Promise<AssignmentRow[]>>();

  private defaultCreateResponse?: AssignmentRow;
  private createError?: Error;
  private deferredCreate?: Promise<AssignmentRow>;

  private transitionResponses = new Map<string, AssignmentRow>();
  private transitionErrors = new Map<string, Error>();
  private transitionCallCount = 0;

  setListResponse(role: CompanyRole, rows: AssignmentRow[]): void {
    this.listResponses.set(role, rows);
  }

  setListError(role: CompanyRole, error: Error): void {
    this.listErrors.set(role, error);
  }

  setDeferredList(role: CompanyRole, promise: Promise<AssignmentRow[]>): void {
    this.deferredLists.set(role, promise);
  }

  setCreateResponse(row: AssignmentRow): void {
    this.defaultCreateResponse = row;
  }

  setCreateError(error: Error): void {
    this.createError = error;
  }

  setDeferredCreate(promise: Promise<AssignmentRow>): void {
    this.deferredCreate = promise;
  }

  setTransitionResponse(id: string, action: AssignmentContractTransition, row: AssignmentRow): void {
    this.transitionResponses.set(`${id}:${action}`, row);
  }

  setTransitionError(id: string, action: AssignmentContractTransition, error: Error): void {
    this.transitionErrors.set(`${id}:${action}`, error);
  }

  getTransitionCallCount(): number {
    return this.transitionCallCount;
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<AssignmentRow[]> {
    if (options?.signal?.aborted) {
      throw new Error('Aborted');
    }

    if (this.deferredLists.has(role)) {
      return await this.deferredLists.get(role)!;
    }

    if (this.listErrors.has(role)) {
      throw this.listErrors.get(role)!;
    }

    return this.listResponses.get(role) ?? [];
  }

  async create(
    role: CompanyRole,
    command: CreateAssignmentCommand,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow> {
    if (options?.signal?.aborted) {
      throw new Error('Aborted');
    }

    if (this.deferredCreate) {
      return await this.deferredCreate;
    }

    if (this.createError) {
      throw this.createError;
    }

    if (this.defaultCreateResponse) {
      return this.defaultCreateResponse;
    }

    return {
      id: command.id ?? '30000000-0000-4000-a000-000000000099',
      title: command.title,
      client: command.clientName ?? command.client ?? 'Mock Client',
      service: command.service,
      due: command.dueDate ?? command.due ?? '11/11/2026',
      owner: command.ownerNameOrId ?? command.owner ?? 'Priya Desai',
      status: 'Awaiting documents',
      progress: 15,
      tone: 'default',
    };
  }

  async transition(
    role: CompanyRole,
    id: string,
    action: AssignmentContractTransition,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow> {
    this.transitionCallCount++;

    if (options?.signal?.aborted) {
      throw new Error('Aborted');
    }

    const key = `${id}:${action}`;
    if (this.transitionErrors.has(key)) {
      throw this.transitionErrors.get(key)!;
    }

    if (this.transitionResponses.has(key)) {
      return this.transitionResponses.get(key)!;
    }

    return {
      id,
      title: 'Transitioned Assignment',
      client: 'Mock Client',
      service: 'Compliance',
      due: '11/11/2026',
      owner: 'Priya Desai',
      status:
        action === 'complete'
          ? 'Completed'
          : action === 'submit'
            ? 'Pending review'
            : action === 'request_changes'
              ? 'Changes requested'
              : 'In progress',
      progress:
        action === 'complete'
          ? 100
          : action === 'submit'
            ? 80
            : action === 'request_changes'
              ? 60
              : 50,
      tone:
        action === 'complete'
          ? 'success'
          : action === 'submit'
            ? 'warning'
            : action === 'request_changes'
              ? 'danger'
              : 'default',
    };
  }
}
