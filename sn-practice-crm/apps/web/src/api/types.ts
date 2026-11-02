import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';

export type AssignmentErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'validation'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface AssignmentOperationErrorOptions {
  code: AssignmentErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class AssignmentOperationError extends Error {
  readonly code: AssignmentErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: AssignmentOperationErrorOptions) {
    super(options.message);
    this.name = 'AssignmentOperationError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
    this.serverCode = options.serverCode;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export interface PortExecutionOptions {
  signal?: AbortSignal;
  requestId?: string;
}

export interface CreateAssignmentCommand {
  id?: string;
  clientId?: string;
  clientName?: string;
  client?: string;
  title: string;
  service: string;
  ownerNameOrId?: string;
  owner?: string;
  reviewerNameOrId?: string;
  reviewer?: string;
  dueDate?: string;
  due?: string;
  scope?: string;
  fee?: number;
  bankStatementRequired?: boolean;
  status?: string;
  progress?: number;
  tone?: 'default' | 'danger' | 'warning' | 'success';
}

export type AssignmentContractTransition = 'start' | 'submit' | 'complete' | 'reopen';

/**
 * Stateless AssignmentsPort interface.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 */
export interface AssignmentsPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<AssignmentRow[]>;
  create(
    role: CompanyRole,
    command: CreateAssignmentCommand,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow>;
  transition(
    role: CompanyRole,
    id: string,
    action: AssignmentContractTransition,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow>;
}
