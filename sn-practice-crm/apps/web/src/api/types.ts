import type { GenerateDueAssignmentsResult } from '@sn/contracts';
export type { GenerateDueAssignmentsResult };
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow, RecurringScheduleRecord } from '../data';

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

export const SAFE_ASSIGNMENT_ERROR_MESSAGES: Record<AssignmentErrorCode, string> = {
  unauthorized: 'Session expired or unauthenticated. Please sign in again.',
  forbidden: 'You do not have permission to perform this assignment operation.',
  conflict: 'The assignment or schedule was modified concurrently or is locked.',
  not_found: 'The requested assignment or schedule was not found.',
  validation: 'The assignment or schedule input failed business validation.',
  network: 'Network connection failed while contacting the practice CRM API.',
  aborted: 'The assignment operation was cancelled.',
  unexpected: 'An unexpected error occurred while processing the assignment request.',
};

export function sanitizeAssignmentError(error: AssignmentOperationError): AssignmentOperationError {
  const safeMessage = SAFE_ASSIGNMENT_ERROR_MESSAGES[error.code] ?? error.message;
  return new AssignmentOperationError({
    code: error.code,
    message: safeMessage,
    requestId: error.requestId,
    status: error.status,
    serverCode: error.serverCode,
    cause: error.cause,
  });
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

export interface UpdateAssignmentPatch {
  readonly title?: string;
  readonly serviceId?: string;
  readonly ownerId?: string;
  readonly reviewerIds?: readonly string[];
  readonly dueAt?: string;
  readonly deliveryNotes?: string | null;
  readonly reviewNotes?: string | null;
  readonly progressPercent?: number;
  readonly expectedUpdatedAt?: string;
}

export interface CreateRecurringScheduleCommand {
  readonly clientId: string;
  readonly clientName?: string;
  readonly serviceId?: string;
  readonly service?: string;
  readonly title: string;
  readonly cadence: 'monthly' | 'quarterly' | 'annual' | 'Monthly' | 'Quarterly' | 'Annual';
  readonly ownerId: string;
  readonly ownerNameOrId?: string;
  readonly reviewerIds?: readonly string[];
  readonly nextOccurrenceOn: string;
  readonly dueDay: number;
}

export interface UpdateRecurringSchedulePatch {
  readonly active?: boolean;
  readonly nextOccurrenceOn?: string;
  readonly bankRecStatus?: string;
  readonly currentStatus?: string;
}

export type AssignmentContractTransition = 'start' | 'submit' | 'complete' | 'request_changes' | 'reopen';

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
  update(
    role: CompanyRole,
    id: string,
    patch: UpdateAssignmentPatch,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow>;
  transition(
    role: CompanyRole,
    id: string,
    action: AssignmentContractTransition,
    options?: PortExecutionOptions & { expectedUpdatedAt?: string },
  ): Promise<AssignmentRow>;
  listSchedules(
    role: CompanyRole,
    options?: PortExecutionOptions,
  ): Promise<RecurringScheduleRecord[]>;
  createSchedule(
    role: CompanyRole,
    command: CreateRecurringScheduleCommand,
    options?: PortExecutionOptions,
  ): Promise<RecurringScheduleRecord>;
  updateSchedule(
    role: CompanyRole,
    id: string,
    patch: UpdateRecurringSchedulePatch,
    options?: PortExecutionOptions,
  ): Promise<RecurringScheduleRecord>;
  generateDueAssignments(
    role: CompanyRole,
    options?: PortExecutionOptions & { throughDate?: string },
  ): Promise<GenerateDueAssignmentsResult>;
}
