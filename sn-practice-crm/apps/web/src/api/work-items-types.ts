import type { CompanyRole } from '@sn/domain';
import type {
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { isValidUuid, sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export { isValidUuid, sanitizeRequestId, sanitizeServerCode };

export interface TaskClientOption {
  readonly id: string;
  readonly name: string;
  readonly type?: string;
}

export type WorkItemErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'validation'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface WorkItemOperationErrorOptions {
  code: WorkItemErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class WorkItemOperationError extends Error {
  readonly code: WorkItemErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: WorkItemOperationErrorOptions) {
    super(options.message);
    this.name = 'WorkItemOperationError';
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
 * Whitelisted, user-safe error copy for the work items seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks
 * and leakage of raw database/SQL details.
 */
export const SAFE_WORK_ITEMS_ERROR_MESSAGES: Readonly<Record<WorkItemErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to manage tasks.',
  forbidden: 'You do not have permission to perform this task operation.',
  conflict: 'This task state was modified by another operation. Please refresh.',
  not_found: 'The requested task could not be found.',
  validation: 'The submitted task details could not be validated. Please check the entered fields.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The task operation was cancelled.',
  unexpected: 'An unexpected error occurred while processing the task. Please try again.',
};

export const GENERIC_SAFE_WORK_ITEM_ERROR =
  'An unexpected error occurred while processing the task. Please try again.';

/**
 * Sanitizes any error caught during work item operations.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * and discards causes/messages that might hold unverified server text.
 */
export function sanitizeWorkItemError(err: unknown): WorkItemOperationError {
  if (err instanceof WorkItemOperationError) {
    const safeMessage =
      SAFE_WORK_ITEMS_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_WORK_ITEM_ERROR;
    return new WorkItemOperationError({
      code: err.code,
      message: safeMessage,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new WorkItemOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_WORK_ITEM_ERROR,
  });
}

/**
 * Stateless WorkItemsPort interface.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 */
export interface WorkItemsPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<WorkItemDto[]>;
  create(
    role: CompanyRole,
    input: CreateWorkItemInput,
    options?: PortExecutionOptions,
  ): Promise<WorkItemDto>;
  transition(
    role: CompanyRole,
    id: string,
    action: WorkItemTransition,
    options?: PortExecutionOptions,
  ): Promise<WorkItemDto>;
}

export interface WorkItemsCoordinatorState {
  items: WorkItemDto[];
  loading: boolean;
  error: WorkItemOperationError | null;
  role: CompanyRole;
  hasLiveSnapshot: boolean;
}
