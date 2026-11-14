import type {
  CreateDepartmentInput,
  DepartmentDto,
  SetDepartmentMembersInput,
  UpdateDepartmentInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { DepartmentsOperationError, type DepartmentsPort } from './departments-types';

export interface RecordedDepartmentsCall {
  role: CompanyRole;
  signal?: AbortSignal;
  requestId?: string;
}

export interface RecordedDepartmentsMutation {
  kind: 'create-department' | 'update-department' | 'set-members';
  role: CompanyRole;
  /** Department id for an update or a membership change. */
  targetId?: string;
  input: CreateDepartmentInput | UpdateDepartmentInput | SetDepartmentMembersInput;
  idempotencyKey: string;
}

export class DeterministicTestDepartmentsAdapter implements DepartmentsPort {
  private readonly responses = new Map<CompanyRole, DepartmentDto[]>();
  private readonly queue: Array<Promise<DepartmentDto[]>> = [];
  private defaultError?: Error;
  private mutationDepartment?: DepartmentDto;
  private mutationError?: Error;

  readonly calls: RecordedDepartmentsCall[] = [];
  readonly mutations: RecordedDepartmentsMutation[] = [];

  setDepartmentsResponse(role: CompanyRole, items: DepartmentDto[]): void {
    this.responses.set(role, items);
  }

  enqueueDeferredDepartments(promise: Promise<DepartmentDto[]>): void {
    this.queue.push(promise);
  }

  setDefaultError(error: Error | undefined): void {
    this.defaultError = error;
  }

  /** Response returned by the create, update and members calls. */
  setMutationDepartment(department: DepartmentDto | undefined): void {
    this.mutationDepartment = department;
  }

  /** Error thrown by every mutation until cleared. */
  setMutationError(error: Error | undefined): void {
    this.mutationError = error;
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new DepartmentsOperationError({ code: 'aborted', message: 'The department operation was aborted.' });
    }
  }

  private mutationResult(): DepartmentDto {
    if (this.mutationError) throw this.mutationError;
    if (!this.mutationDepartment) throw new Error('No mutation department configured on the test departments adapter.');
    return this.mutationDepartment;
  }

  async listDepartments(role: CompanyRole, options?: PortExecutionOptions): Promise<DepartmentDto[]> {
    this.calls.push({ role, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    const deferred = this.queue.shift();
    if (deferred) return deferred;

    if (this.defaultError) throw this.defaultError;
    return [...(this.responses.get(role) ?? [])];
  }

  async createDepartment(
    role: CompanyRole,
    input: CreateDepartmentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'create-department', role, input, idempotencyKey });
    return this.mutationResult();
  }

  async updateDepartment(
    role: CompanyRole,
    departmentId: string,
    input: UpdateDepartmentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'update-department', role, targetId: departmentId, input, idempotencyKey });
    return this.mutationResult();
  }

  async setDepartmentMembers(
    role: CompanyRole,
    departmentId: string,
    input: SetDepartmentMembersInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'set-members', role, targetId: departmentId, input, idempotencyKey });
    return this.mutationResult();
  }
}
