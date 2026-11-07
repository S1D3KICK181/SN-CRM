import type { CompanyRole } from '@sn/domain';
import type { ClientDto, CreateClientInput } from '@sn/contracts';
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

const SAFE_SERVER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const RFC4122_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORT_REQ_REF_PATTERN = /^(?:req-|req_|req:)[A-Za-z0-9._:-]{0,76}$/;
const RAW_PAN_SHAPE_PATTERN = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const RAW_GSTIN_SHAPE_PATTERN = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/;

/**
 * Sanitizes serverCode to prevent reflecting arbitrary strings or tax IDs.
 * Preserves serverCode only if it is a conservative lower-snake-case machine code
 * matching ^[a-z][a-z0-9_]{0,63}$ and is not shaped like a raw PAN or GSTIN.
 */
export function sanitizeServerCode(code: string | undefined): string | undefined {
  if (typeof code !== 'string') return undefined;
  if (!SAFE_SERVER_CODE_PATTERN.test(code)) return undefined;
  if (RAW_PAN_SHAPE_PATTERN.test(code) || RAW_GSTIN_SHAPE_PATTERN.test(code)) return undefined;
  return code;
}

/**
 * Sanitizes requestId to prevent reflecting arbitrary strings or tax IDs.
 * Preserves requestId only if it is either an RFC4122 UUID or a conservative
 * support-reference form beginning req-, req_, or req: with total max length 80
 * and only characters in [A-Za-z0-9._:-]. Otherwise discards it.
 * Raw PAN/GSTIN-shaped values are always stripped.
 */
export function sanitizeRequestId(id: string | undefined): string | undefined {
  if (typeof id !== 'string') return undefined;
  if (RAW_PAN_SHAPE_PATTERN.test(id) || RAW_GSTIN_SHAPE_PATTERN.test(id)) return undefined;
  if (RFC4122_UUID_PATTERN.test(id)) return id;
  if (id.length <= 80 && SUPPORT_REQ_REF_PATTERN.test(id)) return id;
  return undefined;
}

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

/**
 * Stateless ClientsPort interface.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 */
export interface ClientsPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<ClientDto[]>;
  get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<ClientDto>;
  create(role: CompanyRole, input: CreateClientInput, options?: PortExecutionOptions): Promise<ClientDto>;
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
