import type { CompanyRole } from '@sn/domain';
import type {
  CreateDepartmentInput,
  DepartmentDto,
  SetDepartmentMembersInput,
  UpdateDepartmentInput,
} from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type DepartmentsErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface DepartmentsOperationErrorOptions {
  code: DepartmentsErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class DepartmentsOperationError extends Error {
  readonly code: DepartmentsErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: DepartmentsOperationErrorOptions) {
    super(options.message);
    this.name = 'DepartmentsOperationError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
    this.serverCode = options.serverCode;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Whitelisted, user-safe error copy for the departments seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_DEPARTMENTS_ERROR_MESSAGES: Readonly<Record<DepartmentsErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to manage departments.',
  forbidden: 'You do not have permission to manage departments.',
  not_found: 'The department could not be located.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The department request was cancelled.',
  unexpected: 'Something went wrong with the departments. Please try again.',
};

export const GENERIC_SAFE_DEPARTMENTS_ERROR = SAFE_DEPARTMENTS_ERROR_MESSAGES.unexpected;

/**
 * Sanitizes any error caught during department operations.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * and discards causes that might hold unverified server text.
 */
export function sanitizeDepartmentsError(err: unknown): DepartmentsOperationError {
  if (err instanceof DepartmentsOperationError) {
    return new DepartmentsOperationError({
      code: err.code,
      message: SAFE_DEPARTMENTS_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_DEPARTMENTS_ERROR,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new DepartmentsOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_DEPARTMENTS_ERROR,
  });
}

export const DEPARTMENT_FORBIDDEN_MESSAGE = "You don't have permission to do this.";
export const DEPARTMENT_STALE_MESSAGE = 'This department was changed by someone else. Reload and try again.';
export const DEPARTMENT_TRAINEE_HEAD_MESSAGE = "Trainees can't be heads.";

/** User-facing copy for a failed save. Never reflects raw server text; the name is the one the user typed. */
export function departmentSaveErrorMessage(err: unknown, departmentName: string): string {
  const safe = sanitizeDepartmentsError(err);
  if (safe.serverCode === 'duplicate_department') return `A department named ${departmentName} already exists.`;
  if (safe.serverCode === 'stale_department') return DEPARTMENT_STALE_MESSAGE;
  if (safe.serverCode === 'trainee_cannot_head') return DEPARTMENT_TRAINEE_HEAD_MESSAGE;
  if (safe.code === 'forbidden' || safe.status === 403) return DEPARTMENT_FORBIDDEN_MESSAGE;
  return safe.message;
}

/**
 * Stateless DepartmentsPort. Role must be passed explicitly on every invocation;
 * no ambient mutable role state. Every mutation requires an idempotency key.
 */
export interface DepartmentsPort {
  listDepartments(role: CompanyRole, options?: PortExecutionOptions): Promise<DepartmentDto[]>;
  createDepartment(
    role: CompanyRole,
    input: CreateDepartmentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto>;
  updateDepartment(
    role: CompanyRole,
    departmentId: string,
    input: UpdateDepartmentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto>;
  setDepartmentMembers(
    role: CompanyRole,
    departmentId: string,
    input: SetDepartmentMembersInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto>;
}
