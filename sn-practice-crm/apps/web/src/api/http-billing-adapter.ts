import type {
  InvoiceDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceStatus,
  PaymentAllocationDto,
  PaymentMethod,
  PaymentReceiptDto,
  PaymentReceiptStatus,
} from '@sn/contracts';
import { INVOICE_STATUSES, PAYMENT_METHODS } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { isValidUuid } from './metadata-safety';
import type { PortExecutionOptions } from './types';
import {
  BillingOperationError,
  sanitizeBillingError,
  type BillingErrorCode,
  type BillingPort,
} from './billing-types';

export interface HttpBillingAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

const VALID_COMPANY_ROLES = new Set<CompanyRole>(['founder', 'manager', 'senior_staff', 'staff', 'trainee']);
const RECEIPT_STATUSES: readonly PaymentReceiptStatus[] = ['received', 'voided'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getDemoActorId(role: CompanyRole): string | null {
  if (!VALID_COMPANY_ROLES.has(role)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(ROLE_TO_DEMO_ACTOR_ID, role)) {
    return null;
  }
  const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
  return typeof actorId === 'string' && actorId.trim().length > 0 ? actorId : null;
}

function malformed(message: string): BillingOperationError {
  return new BillingOperationError({ code: 'unexpected', message });
}

function asObject(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw malformed(`Expected ${label} to be a non-null object.`);
  }
  return raw as Record<string, unknown>;
}

function field(rec: Record<string, unknown>, key: string, label: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) {
    throw malformed(`Missing required property "${key}" on ${label}.`);
  }
  return rec[key];
}

function readUuid(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (!isValidUuid(value)) throw malformed(`Invalid ${label} ${key}: must be an RFC 4122 UUID.`);
  return value;
}

function readNullableUuid(rec: Record<string, unknown>, key: string, label: string): string | null {
  const value = field(rec, key, label);
  if (value === null) return null;
  if (!isValidUuid(value)) throw malformed(`Invalid ${label} ${key}: must be an RFC 4122 UUID or null.`);
  return value;
}

function readString(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-empty string.`);
  }
  return value;
}

function readNullableString(rec: Record<string, unknown>, key: string, label: string): string | null {
  const value = field(rec, key, label);
  if (value === null) return null;
  if (typeof value !== 'string') throw malformed(`Invalid ${label} ${key}: must be a string or null.`);
  return value;
}

function readIsoDate(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    throw malformed(`Invalid ${label} ${key}: must be a YYYY-MM-DD date.`);
  }
  return value;
}

function readTimestamp(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw malformed(`Invalid ${label} ${key}: must be an ISO timestamp.`);
  }
  return value;
}

function readNullableTimestamp(rec: Record<string, unknown>, key: string, label: string): string | null {
  const value = field(rec, key, label);
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw malformed(`Invalid ${label} ${key}: must be an ISO timestamp or null.`);
  }
  return value;
}

/** Integer paise: a safe, non-negative integer. */
function readPaise(rec: Record<string, unknown>, key: string, label: string): number {
  const value = field(rec, key, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-negative safe integer amount in paise.`);
  }
  return value;
}

function readNonNegativeNumber(rec: Record<string, unknown>, key: string, label: string): number {
  const value = field(rec, key, label);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-negative number.`);
  }
  return value;
}

function readNonNegativeInteger(rec: Record<string, unknown>, key: string, label: string): number {
  const value = field(rec, key, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-negative integer.`);
  }
  return value;
}

function readEnum<T extends string>(
  rec: Record<string, unknown>,
  key: string,
  label: string,
  allowed: readonly T[],
): T {
  const value = field(rec, key, label);
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw malformed(`Invalid ${label} ${key}.`);
  }
  return value as T;
}

function readArray(rec: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = field(rec, key, label);
  if (!Array.isArray(value)) throw malformed(`Invalid ${label} ${key}: must be an array.`);
  return value;
}

function parseInvoiceItem(raw: unknown): InvoiceItemDto {
  const rec = asObject(raw, 'invoice item');
  return {
    id: readUuid(rec, 'id', 'invoice item'),
    description: readString(rec, 'description', 'invoice item'),
    quantity: readNonNegativeNumber(rec, 'quantity', 'invoice item'),
    unitPricePaise: readPaise(rec, 'unitPricePaise', 'invoice item'),
    taxRatePercent: readNonNegativeNumber(rec, 'taxRatePercent', 'invoice item'),
    lineSubtotalPaise: readPaise(rec, 'lineSubtotalPaise', 'invoice item'),
    lineTaxPaise: readPaise(rec, 'lineTaxPaise', 'invoice item'),
    lineTotalPaise: readPaise(rec, 'lineTotalPaise', 'invoice item'),
  };
}

function parseInvoicePayment(raw: unknown): InvoicePaymentDto {
  const rec = asObject(raw, 'invoice payment');
  return {
    receiptId: readUuid(rec, 'receiptId', 'invoice payment'),
    receiptCode: readString(rec, 'receiptCode', 'invoice payment'),
    receivedOn: readIsoDate(rec, 'receivedOn', 'invoice payment'),
    amountPaise: readPaise(rec, 'amountPaise', 'invoice payment'),
    receiptStatus: readEnum(rec, 'receiptStatus', 'invoice payment', RECEIPT_STATUSES),
  };
}

export function parseInvoiceDto(raw: unknown): InvoiceDto {
  const rec = asObject(raw, 'invoice');
  const currency = field(rec, 'currency', 'invoice');
  if (currency !== 'INR') throw malformed('Invalid invoice currency: expected INR.');
  const status: InvoiceStatus = readEnum(rec, 'status', 'invoice', INVOICE_STATUSES);
  return {
    id: readUuid(rec, 'id', 'invoice'),
    code: readString(rec, 'code', 'invoice'),
    clientId: readUuid(rec, 'clientId', 'invoice'),
    clientCode: readString(rec, 'clientCode', 'invoice'),
    clientName: readString(rec, 'clientName', 'invoice'),
    assignmentId: readNullableUuid(rec, 'assignmentId', 'invoice'),
    assignmentCode: readNullableString(rec, 'assignmentCode', 'invoice'),
    issueDate: readIsoDate(rec, 'issueDate', 'invoice'),
    dueDate: readIsoDate(rec, 'dueDate', 'invoice'),
    currency: 'INR',
    subtotalPaise: readPaise(rec, 'subtotalPaise', 'invoice'),
    taxPaise: readPaise(rec, 'taxPaise', 'invoice'),
    totalPaise: readPaise(rec, 'totalPaise', 'invoice'),
    amountReceivedPaise: readPaise(rec, 'amountReceivedPaise', 'invoice'),
    balancePaise: readPaise(rec, 'balancePaise', 'invoice'),
    daysOverdue: readNonNegativeInteger(rec, 'daysOverdue', 'invoice'),
    status,
    notes: readNullableString(rec, 'notes', 'invoice'),
    issuedAt: readNullableTimestamp(rec, 'issuedAt', 'invoice'),
    voidReason: readNullableString(rec, 'voidReason', 'invoice'),
    voidedAt: readNullableTimestamp(rec, 'voidedAt', 'invoice'),
    items: readArray(rec, 'items', 'invoice').map(parseInvoiceItem),
    payments: readArray(rec, 'payments', 'invoice').map(parseInvoicePayment),
    createdAt: readTimestamp(rec, 'createdAt', 'invoice'),
    updatedAt: readTimestamp(rec, 'updatedAt', 'invoice'),
  };
}

function parsePaymentAllocation(raw: unknown): PaymentAllocationDto {
  const rec = asObject(raw, 'receipt allocation');
  return {
    invoiceId: readUuid(rec, 'invoiceId', 'receipt allocation'),
    invoiceCode: readString(rec, 'invoiceCode', 'receipt allocation'),
    amountPaise: readPaise(rec, 'amountPaise', 'receipt allocation'),
  };
}

export function parsePaymentReceiptDto(raw: unknown): PaymentReceiptDto {
  const rec = asObject(raw, 'payment receipt');
  const method: PaymentMethod = readEnum(rec, 'method', 'payment receipt', PAYMENT_METHODS);
  return {
    id: readUuid(rec, 'id', 'payment receipt'),
    code: readString(rec, 'code', 'payment receipt'),
    clientId: readUuid(rec, 'clientId', 'payment receipt'),
    clientCode: readString(rec, 'clientCode', 'payment receipt'),
    clientName: readString(rec, 'clientName', 'payment receipt'),
    receivedOn: readIsoDate(rec, 'receivedOn', 'payment receipt'),
    amountPaise: readPaise(rec, 'amountPaise', 'payment receipt'),
    method,
    reference: readNullableString(rec, 'reference', 'payment receipt'),
    notes: readNullableString(rec, 'notes', 'payment receipt'),
    status: readEnum(rec, 'status', 'payment receipt', RECEIPT_STATUSES),
    voidReason: readNullableString(rec, 'voidReason', 'payment receipt'),
    voidedAt: readNullableTimestamp(rec, 'voidedAt', 'payment receipt'),
    allocatedPaise: readPaise(rec, 'allocatedPaise', 'payment receipt'),
    unallocatedPaise: readPaise(rec, 'unallocatedPaise', 'payment receipt'),
    allocations: readArray(rec, 'allocations', 'payment receipt').map(parsePaymentAllocation),
    createdAt: readTimestamp(rec, 'createdAt', 'payment receipt'),
  };
}

export class HttpBillingAdapter implements BillingPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpBillingAdapterOptions = {}) {
    // Preserve browser fetch receiver binding
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
    this.getAccessToken = options.getAccessToken;
    this.authSource = options.authSource;
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return this.baseUrl ? `${this.baseUrl}${cleanPath}` : cleanPath;
  }

  private mapStatusToErrorCode(status: number): BillingErrorCode {
    switch (status) {
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'not_found';
      default:
        return 'unexpected';
    }
  }

  private abortedError(options?: PortExecutionOptions, cause?: unknown): BillingOperationError {
    return new BillingOperationError({
      code: 'aborted',
      message: 'The billing operation was aborted.',
      requestId: options?.requestId,
      cause,
    });
  }

  private async execute(
    role: CompanyRole,
    path: string,
    options?: PortExecutionOptions,
  ): Promise<{ data: unknown; requestId?: string }> {
    if (options?.signal?.aborted) {
      throw this.abortedError(options);
    }

    const hasTokenSource = Boolean(this.getAccessToken || this.authSource);
    let token: string | null = null;

    if (this.getAccessToken) {
      try {
        const resolved = await this.getAccessToken();
        if (typeof resolved === 'string' && resolved.trim().length > 0) {
          token = resolved.trim();
        }
      } catch {
        token = null;
      }
    } else if (this.authSource) {
      try {
        const session = await this.authSource.getSession();
        if (session && typeof session.accessToken === 'string' && session.accessToken.trim().length > 0) {
          token = session.accessToken.trim();
        }
      } catch {
        token = null;
      }
    }

    // Check abort again after awaiting token resolution so role/session cancellation cannot still dispatch
    if (options?.signal?.aborted) {
      throw this.abortedError(options);
    }

    const headers = new Headers();

    if (hasTokenSource) {
      // Production authenticated transport path: must have a valid Bearer token.
      // Never fall back to x-demo-user-id and never dispatch fetch without a valid Bearer token.
      if (!token) {
        throw new BillingOperationError({
          code: 'unauthorized',
          message: 'Session expired or unauthenticated. Please sign in again to view billing records.',
          requestId: options?.requestId,
        });
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = getDemoActorId(role);
      if (!actorId) {
        throw new BillingOperationError({
          code: 'unauthorized',
          message: `Unknown or unmapped company role "${role}".`,
          requestId: options?.requestId,
        });
      }
      headers.set('x-demo-user-id', actorId);
    }

    if (options?.requestId) {
      headers.set('x-request-id', options.requestId);
    }

    let response: Response;
    try {
      response = await this.fetchFn(this.buildUrl(path), {
        method: 'GET',
        headers,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof BillingOperationError) {
        throw err;
      }
      if ((err instanceof Error && err.name === 'AbortError') || options?.signal?.aborted) {
        throw this.abortedError(options, err);
      }
      throw new BillingOperationError({
        code: 'network',
        message: 'Network error while contacting CRM API.',
        requestId: options?.requestId,
        cause: err,
      });
    }

    const responseRequestId = response.headers.get('x-request-id') ?? options?.requestId ?? undefined;

    if (!response.ok) {
      let serverCode: string | undefined;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (body && typeof body === 'object' && typeof body['error'] === 'object' && body['error'] !== null) {
          const errObj = body['error'] as Record<string, unknown>;
          if (typeof errObj['code'] === 'string') serverCode = errObj['code'];
        }
      } catch {
        // Non-JSON response, ignore body
      }

      throw new BillingOperationError({
        code: this.mapStatusToErrorCode(response.status),
        status: response.status,
        message: `API request failed with status ${response.status}.`,
        serverCode,
        requestId: responseRequestId,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err: unknown) {
      throw new BillingOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Failed to parse JSON response from CRM API.',
        requestId: responseRequestId,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new BillingOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Expected response envelope to be an object.',
        requestId: responseRequestId,
      });
    }

    const envelope = payload as Record<string, unknown>;
    const finalRequestId =
      (typeof envelope['requestId'] === 'string' ? envelope['requestId'] : undefined) ?? responseRequestId;

    if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      throw new BillingOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'API envelope missing required "data" property.',
        requestId: finalRequestId,
      });
    }

    return { data: envelope['data'], requestId: finalRequestId };
  }

  async listInvoices(role: CompanyRole, options?: PortExecutionOptions): Promise<InvoiceDto[]> {
    try {
      const result = await this.execute(role, '/api/v1/invoices', options);
      if (!Array.isArray(result.data)) {
        throw new BillingOperationError({
          code: 'unexpected',
          message: 'Expected invoices array in response.',
          requestId: result.requestId,
        });
      }
      return result.data.map((item) => parseInvoiceDto(item));
    } catch (err: unknown) {
      throw sanitizeBillingError(err);
    }
  }

  async listPaymentReceipts(role: CompanyRole, options?: PortExecutionOptions): Promise<PaymentReceiptDto[]> {
    try {
      const result = await this.execute(role, '/api/v1/payment-receipts', options);
      if (!Array.isArray(result.data)) {
        throw new BillingOperationError({
          code: 'unexpected',
          message: 'Expected payment receipts array in response.',
          requestId: result.requestId,
        });
      }
      return result.data.map((item) => parsePaymentReceiptDto(item));
    } catch (err: unknown) {
      throw sanitizeBillingError(err);
    }
  }
}
