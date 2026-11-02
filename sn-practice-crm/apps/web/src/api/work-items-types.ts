import type { CompanyRole } from '@sn/domain';
import type {
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import type { PortExecutionOptions } from './types';

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
