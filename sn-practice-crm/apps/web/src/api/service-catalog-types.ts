import type { CompanyRole } from '@sn/domain';
import type { CreateServiceInput, ServiceDto, UpdateServiceInput } from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type ServiceCatalogErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface ServiceCatalogOperationErrorOptions {
  code: ServiceCatalogErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class ServiceCatalogOperationError extends Error {
  readonly code: ServiceCatalogErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: ServiceCatalogOperationErrorOptions) {
    super(options.message);
    this.name = 'ServiceCatalogOperationError';
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
 * Whitelisted, user-safe error copy for the service list seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_SERVICE_CATALOG_ERROR_MESSAGES: Readonly<Record<ServiceCatalogErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to manage services.',
  forbidden: 'You do not have permission to manage services.',
  not_found: 'The service could not be located.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The service request was cancelled.',
  unexpected: 'Something went wrong with the service list. Please try again.',
};

export const GENERIC_SAFE_SERVICE_CATALOG_ERROR = SAFE_SERVICE_CATALOG_ERROR_MESSAGES.unexpected;

/**
 * Sanitizes any error caught during service list operations.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * and discards causes that might hold unverified server text.
 */
export function sanitizeServiceCatalogError(err: unknown): ServiceCatalogOperationError {
  if (err instanceof ServiceCatalogOperationError) {
    return new ServiceCatalogOperationError({
      code: err.code,
      message: SAFE_SERVICE_CATALOG_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_SERVICE_CATALOG_ERROR,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new ServiceCatalogOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_SERVICE_CATALOG_ERROR,
  });
}

export const SERVICE_FORBIDDEN_MESSAGE = "You don't have permission to do this.";
export const SERVICE_STALE_MESSAGE = 'This service was changed by someone else. Reload and try again.';

/** User-facing copy for a failed save. Never reflects raw server text; the name is the one the user typed. */
export function serviceSaveErrorMessage(err: unknown, serviceName: string): string {
  const safe = sanitizeServiceCatalogError(err);
  if (safe.serverCode === 'duplicate_service') return `A service named ${serviceName} already exists.`;
  if (safe.serverCode === 'stale_service') return SERVICE_STALE_MESSAGE;
  if (safe.code === 'forbidden' || safe.status === 403) return SERVICE_FORBIDDEN_MESSAGE;
  return safe.message;
}

/**
 * Stateless ServiceCatalogPort. Role must be passed explicitly on every invocation;
 * no ambient mutable role state. Every mutation requires an idempotency key.
 */
export interface ServiceCatalogPort {
  listServiceCatalog(role: CompanyRole, options?: PortExecutionOptions): Promise<ServiceDto[]>;
  createService(
    role: CompanyRole,
    input: CreateServiceInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ServiceDto>;
  updateService(
    role: CompanyRole,
    serviceId: string,
    input: UpdateServiceInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ServiceDto>;
}
