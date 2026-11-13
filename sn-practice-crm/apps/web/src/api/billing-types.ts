import type { CompanyRole } from '@sn/domain';
import type { InvoiceDto, PaymentReceiptDto } from '@sn/contracts';
import type { InvoiceRecord, ReceiptRecord } from '../data';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type BillingErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface BillingOperationErrorOptions {
  code: BillingErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class BillingOperationError extends Error {
  readonly code: BillingErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: BillingOperationErrorOptions) {
    super(options.message);
    this.name = 'BillingOperationError';
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
 * Whitelisted, user-safe error copy for the billing seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_BILLING_ERROR_MESSAGES: Readonly<Record<BillingErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to view billing records.',
  forbidden: 'Billing records are visible to the Founder and Manager only.',
  not_found: 'The billing service could not be located.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The billing request was cancelled.',
  unexpected: 'An unexpected error occurred while loading billing records. Please try again.',
};

export const GENERIC_SAFE_BILLING_ERROR =
  'An unexpected error occurred while loading billing records. Please try again.';

/**
 * Sanitizes any error caught during billing operations.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * and discards causes that might hold unverified server text.
 */
export function sanitizeBillingError(err: unknown): BillingOperationError {
  if (err instanceof BillingOperationError) {
    const safeMessage = SAFE_BILLING_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_BILLING_ERROR;
    return new BillingOperationError({
      code: err.code,
      message: safeMessage,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new BillingOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_BILLING_ERROR,
  });
}

/**
 * Stateless, read-only BillingPort. Role must be passed explicitly on every invocation;
 * no ambient mutable role state.
 */
export interface BillingPort {
  listInvoices(role: CompanyRole, options?: PortExecutionOptions): Promise<InvoiceDto[]>;
  listPaymentReceipts(role: CompanyRole, options?: PortExecutionOptions): Promise<PaymentReceiptDto[]>;
}

export interface BillingState {
  readonly invoices: InvoiceRecord[];
  readonly receipts: ReceiptRecord[];
  readonly loading: boolean;
  readonly error: BillingOperationError | null;
  readonly role: CompanyRole;
  readonly hasLiveSnapshot: boolean;
}
