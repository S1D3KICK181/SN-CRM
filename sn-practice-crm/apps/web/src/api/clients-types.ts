import type { CompanyRole } from '@sn/domain';
import type {
  ClientContactDto,
  ClientDto,
  CreateClientContactInput,
  CreateClientInput,
  UpdateClientContactInput,
  UpdateClientInput,
} from '@sn/contracts';
import type { PortExecutionOptions } from './types';

export type ClientErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface ClientOperationErrorOptions {
  code: ClientErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class ClientOperationError extends Error {
  readonly code: ClientErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: ClientOperationErrorOptions) {
    super(options.message);
    this.name = 'ClientOperationError';
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
 * Whitelisted, strongly typed safe error messages for client creation.
 * Arbitrary server/proxy payloads must never be rendered to users to prevent
 * reflecting untrusted strings or sensitive tax identifiers.
 */
export const SAFE_CREATE_CLIENT_ERROR_MESSAGES: Readonly<Record<ClientErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to continue.',
  forbidden: 'You do not have permission to create client records.',
  not_found: 'The client registration service could not be located.',
  validation: 'The submitted client details could not be validated. Please check the entered fields.',
  conflict: 'A client record with conflicting identifiers already exists in the directory.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'Client creation was cancelled.',
  unexpected: 'An unexpected error occurred while creating the client. Please try again.',
};

export const GENERIC_SAFE_CREATE_CLIENT_ERROR =
  'An unexpected error occurred while creating the client. Please try again.';

export {
  SAFE_SERVER_CODE_PATTERN,
  RFC4122_UUID_PATTERN,
  SUPPORT_REQ_REF_PATTERN,
  RAW_PAN_SHAPE_PATTERN,
  RAW_GSTIN_SHAPE_PATTERN,
  sanitizeServerCode,
  sanitizeRequestId,
} from './metadata-safety';
import { sanitizeServerCode, sanitizeRequestId } from './metadata-safety';

/**
 * Sanitizes any error caught during client creation.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * but replaces arbitrary error messages with whitelisted user-safe copy and
 * discards causes that might hold raw server payloads or reflected tax IDs.
 */
export function sanitizeCreateClientError(err: unknown): ClientOperationError {
  if (err instanceof ClientOperationError) {
    const safeMessage = SAFE_CREATE_CLIENT_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_CREATE_CLIENT_ERROR;
    return new ClientOperationError({
      code: err.code,
      message: safeMessage,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
      // Intentionally omit cause and original message to prevent leaking unverified server text
    });
  }

  return new ClientOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_CREATE_CLIENT_ERROR,
  });
}

export const CLIENT_FORBIDDEN_MESSAGE = "You don't have permission to do this.";
export const CLIENT_STALE_MESSAGE = 'This client was changed by someone else. Reload and try again.';
export const CONTACT_STALE_MESSAGE = 'This contact was changed by someone else. Reload and try again.';

/**
 * Whitelisted safe copy for failed client and contact changes (edit details, add, edit or remove a
 * contact). Server text is never reflected.
 */
export const SAFE_CLIENT_MUTATION_ERROR_MESSAGES: Readonly<Record<ClientErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to continue.',
  forbidden: CLIENT_FORBIDDEN_MESSAGE,
  not_found: 'This client or contact could not be found. It may have been removed.',
  validation: 'The details could not be saved. Please check the entered fields.',
  conflict: 'This record was changed by someone else. Reload and try again.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The change was cancelled.',
  unexpected: 'Something went wrong while saving. Please try again.',
};

/** Sanitizes any error caught while changing a client or contact. */
export function sanitizeClientMutationError(err: unknown): ClientOperationError {
  if (err instanceof ClientOperationError) {
    let message = SAFE_CLIENT_MUTATION_ERROR_MESSAGES[err.code] ?? SAFE_CLIENT_MUTATION_ERROR_MESSAGES.unexpected;
    const serverCode = sanitizeServerCode(err.serverCode);
    if (serverCode === 'stale_client') message = CLIENT_STALE_MESSAGE;
    else if (serverCode === 'stale_contact') message = CONTACT_STALE_MESSAGE;
    else if (err.code === 'forbidden' || err.status === 403) message = CLIENT_FORBIDDEN_MESSAGE;
    return new ClientOperationError({
      code: err.code,
      message,
      status: err.status,
      serverCode,
      requestId: sanitizeRequestId(err.requestId),
    });
  }
  return new ClientOperationError({
    code: 'unexpected',
    message: SAFE_CLIENT_MUTATION_ERROR_MESSAGES.unexpected,
  });
}

/** User-facing copy for a failed client or contact change. */
export function clientSaveErrorMessage(err: unknown): string {
  return sanitizeClientMutationError(err).message;
}

export function isStaleClientError(err: unknown): boolean {
  return (
    err instanceof ClientOperationError &&
    (err.serverCode === 'stale_client' || err.serverCode === 'stale_contact')
  );
}

/**
 * Stateless ClientsPort interface.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 * Every change except removing a contact requires an idempotency key.
 */
export interface ClientsPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<ClientDto[]>;
  get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<ClientDto>;
  create(role: CompanyRole, input: CreateClientInput, options?: PortExecutionOptions): Promise<ClientDto>;
  updateClient(
    role: CompanyRole,
    clientId: string,
    input: UpdateClientInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDto>;
  createContact(
    role: CompanyRole,
    clientId: string,
    input: CreateClientContactInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientContactDto>;
  updateContact(
    role: CompanyRole,
    contactId: string,
    input: UpdateClientContactInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientContactDto>;
  deleteContact(role: CompanyRole, contactId: string, options?: PortExecutionOptions): Promise<void>;
}

export interface ClientsCoordinatorState {
  readonly items: ClientDto[];
  readonly loading: boolean;
  readonly error: ClientOperationError | null;
  readonly role: CompanyRole;
  readonly hasLiveSnapshot: boolean;
  readonly selectedClientId: string | null;
  readonly selectedDetail: ClientDto | null;
  readonly detailLoading: boolean;
  readonly detailError: ClientOperationError | null;
}
