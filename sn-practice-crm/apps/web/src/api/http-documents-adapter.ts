import {
  DOCUMENT_CATEGORIES,
  type ClientDocumentDto,
  type CreateDocumentInput,
  type DocumentCategory,
  type DocumentStatus,
  type RemoveDocumentInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { validateIdempotencyKey } from './engagements-types';
import { isValidUuid } from './metadata-safety';
import type { PortExecutionOptions } from './types';
import { DocumentsOperationError, sanitizeDocumentsError, type DocumentsErrorCode, type DocumentsPort } from './documents-types';

export interface HttpDocumentsAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

const VALID_COMPANY_ROLES = new Set<CompanyRole>(['founder', 'manager', 'senior_staff', 'staff', 'trainee']);
const DOCUMENT_STATUSES: readonly DocumentStatus[] = ['pending', 'available', 'removed'];

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

function malformed(message: string): DocumentsOperationError {
  return new DocumentsOperationError({ code: 'unexpected', message });
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

function readUuid(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (!isValidUuid(value)) throw malformed(`Invalid ${label} ${key}: must be an RFC 4122 UUID.`);
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

function readNullableYear(rec: Record<string, unknown>, key: string, label: string): number | null {
  const value = field(rec, key, label);
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 2000 || value > 2100) {
    throw malformed(`Invalid ${label} ${key}: must be a year or null.`);
  }
  return value;
}

function readSize(rec: Record<string, unknown>, key: string, label: string): number {
  const value = field(rec, key, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-negative integer.`);
  }
  return value;
}

function readCategory(rec: Record<string, unknown>): DocumentCategory {
  const value = field(rec, 'category', 'document');
  const match = DOCUMENT_CATEGORIES.find((category) => category === value);
  if (!match) throw malformed('Invalid document category.');
  return match;
}

function readStatus(rec: Record<string, unknown>): DocumentStatus {
  const value = field(rec, 'status', 'document');
  const match = DOCUMENT_STATUSES.find((status) => status === value);
  if (!match) throw malformed('Invalid document status.');
  return match;
}

export function parseClientDocumentDto(raw: unknown): ClientDocumentDto {
  const rec = asObject(raw, 'document');
  return {
    id: readUuid(rec, 'id', 'document'),
    clientId: readUuid(rec, 'clientId', 'document'),
    clientCode: readString(rec, 'clientCode', 'document'),
    clientName: readString(rec, 'clientName', 'document'),
    title: readString(rec, 'title', 'document'),
    category: readCategory(rec),
    financialYearStart: readNullableYear(rec, 'financialYearStart', 'document'),
    fileName: readString(rec, 'fileName', 'document'),
    mimeType: readString(rec, 'mimeType', 'document'),
    sizeBytes: readSize(rec, 'sizeBytes', 'document'),
    status: readStatus(rec),
    storagePath: readString(rec, 'storagePath', 'document'),
    uploadedById: readUuid(rec, 'uploadedById', 'document'),
    uploadedByName: readString(rec, 'uploadedByName', 'document'),
    createdAt: readTimestamp(rec, 'createdAt', 'document'),
    removedReason: readNullableString(rec, 'removedReason', 'document'),
    removedAt: readNullableTimestamp(rec, 'removedAt', 'document'),
  };
}

export class HttpDocumentsAdapter implements DocumentsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpDocumentsAdapterOptions = {}) {
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

  private mapStatusToErrorCode(status: number): DocumentsErrorCode {
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

  private abortedError(options?: PortExecutionOptions, cause?: unknown): DocumentsOperationError {
    return new DocumentsOperationError({
      code: 'aborted',
      message: 'The documents operation was aborted.',
      requestId: options?.requestId,
      cause,
    });
  }

  private async execute(
    role: CompanyRole,
    path: string,
    options?: PortExecutionOptions,
    mutation?: { readonly body: unknown; readonly idempotencyKey: string },
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
        throw new DocumentsOperationError({
          code: 'unauthorized',
          message: 'Session expired or unauthenticated. Please sign in again to use documents.',
          requestId: options?.requestId,
        });
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = getDemoActorId(role);
      if (!actorId) {
        throw new DocumentsOperationError({
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

    if (mutation) {
      headers.set('content-type', 'application/json');
      headers.set('idempotency-key', mutation.idempotencyKey);
    }

    let response: Response;
    try {
      response = await this.fetchFn(this.buildUrl(path), {
        method: mutation ? 'POST' : 'GET',
        headers,
        body: mutation ? JSON.stringify(mutation.body) : undefined,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof DocumentsOperationError) {
        throw err;
      }
      if ((err instanceof Error && err.name === 'AbortError') || options?.signal?.aborted) {
        throw this.abortedError(options, err);
      }
      throw new DocumentsOperationError({
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

      throw new DocumentsOperationError({
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
      throw new DocumentsOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Failed to parse JSON response from CRM API.',
        requestId: responseRequestId,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new DocumentsOperationError({
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
      throw new DocumentsOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'API envelope missing required "data" property.',
        requestId: finalRequestId,
      });
    }

    return { data: envelope['data'], requestId: finalRequestId };
  }

  async listDocuments(
    role: CompanyRole,
    clientId?: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto[]> {
    try {
      const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const result = await this.execute(role, `/api/v1/documents${query}`, options);
      if (!Array.isArray(result.data)) {
        throw new DocumentsOperationError({
          code: 'unexpected',
          message: 'Expected documents array in response.',
          requestId: result.requestId,
        });
      }
      return result.data.map((item) => parseClientDocumentDto(item));
    } catch (err: unknown) {
      throw sanitizeDocumentsError(err);
    }
  }

  private async mutate(
    role: CompanyRole,
    path: string,
    body: unknown,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    const key = validateIdempotencyKey(idempotencyKey);
    if (key === null) {
      throw new DocumentsOperationError({
        code: 'unexpected',
        message: 'Idempotency-Key is required: must be a non-blank string of at most 255 characters.',
        requestId: options?.requestId,
      });
    }
    try {
      const result = await this.execute(role, path, options, { body, idempotencyKey: key });
      return parseClientDocumentDto(result.data);
    } catch (err: unknown) {
      throw sanitizeDocumentsError(err);
    }
  }

  createDocument(
    role: CompanyRole,
    input: CreateDocumentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    return this.mutate(role, '/api/v1/documents', input, idempotencyKey, options);
  }

  confirmDocument(
    role: CompanyRole,
    documentId: string,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    return this.mutate(
      role,
      `/api/v1/documents/${encodeURIComponent(documentId)}/confirm`,
      {},
      idempotencyKey,
      options,
    );
  }

  removeDocument(
    role: CompanyRole,
    documentId: string,
    input: RemoveDocumentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    return this.mutate(
      role,
      `/api/v1/documents/${encodeURIComponent(documentId)}/remove`,
      input,
      idempotencyKey,
      options,
    );
  }
}
