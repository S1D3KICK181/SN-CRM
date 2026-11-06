import type { ClientDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import type { PortExecutionOptions } from './types';
import {
  ClientOperationError,
  type ClientErrorCode,
  type ClientsPort,
} from './clients-types';

export interface HttpClientsAdapterOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

const RFC4122_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_CODE_REGEX = /^CL-\d{6}$/;
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MASKED_PAN_REGEX = /^(\*{6}[0-9]{4}|\*{10})$/;
const MASKED_GSTIN_REGEX = /^([0-9]{2}\*{10}[0-9A-Z]Z[0-9A-Z]|\*{15})$/;

const VALID_COMPANY_ROLES = new Set<CompanyRole>([
  'founder',
  'manager',
  'senior_staff',
  'staff',
  'trainee',
]);

const REQUIRED_NULLABLE_FIELDS = [
  'legalName',
  'panMasked',
  'gstinMasked',
  'email',
  'phone',
  'relationshipOwnerId',
  'relationshipOwnerName',
  'notes',
] as const;

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

function isValidIsoUtcDate(isoString: string): boolean {
  if (!ISO_UTC_REGEX.test(isoString)) {
    return false;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const datePart = isoString.slice(0, 10);
  const parts = datePart.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
}

function parseClientDto(raw: unknown): ClientDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client item to be a non-null object.',
    });
  }

  const rec = raw as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(rec, 'id')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "id".',
    });
  }
  const id = rec['id'];
  if (typeof id !== 'string' || !RFC4122_UUID_REGEX.test(id)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "id" (must be RFC 4122 UUID).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'code')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "code".',
    });
  }
  const code = rec['code'];
  if (typeof code !== 'string' || !CLIENT_CODE_REGEX.test(code)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "code" (must match CL-xxxxxx).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'displayName')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "displayName".',
    });
  }
  const displayName = rec['displayName'];
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "displayName".',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'createdById')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "createdById".',
    });
  }
  const createdById = rec['createdById'];
  if (typeof createdById !== 'string' || !RFC4122_UUID_REGEX.test(createdById)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "createdById" (must be RFC 4122 UUID).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'createdAt')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "createdAt".',
    });
  }
  const createdAt = rec['createdAt'];
  if (typeof createdAt !== 'string' || !isValidIsoUtcDate(createdAt)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid "createdAt" (must be valid ISO-8601 UTC ending in Z).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'updatedAt')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "updatedAt".',
    });
  }
  const updatedAt = rec['updatedAt'];
  if (typeof updatedAt !== 'string' || !isValidIsoUtcDate(updatedAt)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid "updatedAt" (must be valid ISO-8601 UTC ending in Z).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'status')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "status".',
    });
  }
  const status = rec['status'];
  if (status !== 'active' && status !== 'on_hold' && status !== 'archived') {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid status.',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'activeAssignmentsCount')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "activeAssignmentsCount".',
    });
  }
  const activeAssignmentsCount = rec['activeAssignmentsCount'];
  if (
    typeof activeAssignmentsCount !== 'number' ||
    !Number.isInteger(activeAssignmentsCount) ||
    activeAssignmentsCount < 0
  ) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid "activeAssignmentsCount" (must be non-negative integer).',
    });
  }

  for (const field of REQUIRED_NULLABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, field)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: `Invalid client item: missing required property "${field}".`,
      });
    }
    const val = rec[field];
    if (val !== null && typeof val !== 'string') {
      throw new ClientOperationError({
        code: 'unexpected',
        message: `Invalid client item: field "${field}" must be string or null.`,
      });
    }
  }

  const relationshipOwnerId = rec['relationshipOwnerId'] as string | null;
  if (relationshipOwnerId !== null) {
    if (!RFC4122_UUID_REGEX.test(relationshipOwnerId)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "relationshipOwnerId" (must be RFC 4122 UUID or null).',
      });
    }
  }

  const panMasked = rec['panMasked'] as string | null;
  if (panMasked !== null) {
    if (!MASKED_PAN_REGEX.test(panMasked)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "panMasked" format.',
      });
    }
  }

  const gstinMasked = rec['gstinMasked'] as string | null;
  if (gstinMasked !== null) {
    if (!MASKED_GSTIN_REGEX.test(gstinMasked)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "gstinMasked" format.',
      });
    }
  }

  const legalName = rec['legalName'] as string | null;
  const email = rec['email'] as string | null;
  const phone = rec['phone'] as string | null;
  const relationshipOwnerName = rec['relationshipOwnerName'] as string | null;
  const notes = rec['notes'] as string | null;

  // Construct a safe, clean projection containing ONLY contract-approved fields.
  // Hostile/untrusted properties (such as raw `pan`, raw `gstin`, or arbitrary properties)
  // are never passed through.
  return {
    id,
    code,
    displayName,
    legalName,
    gstinMasked,
    panMasked,
    email,
    phone,
    relationshipOwnerId,
    relationshipOwnerName,
    status,
    notes,
    activeAssignmentsCount,
    createdById,
    createdAt,
    updatedAt,
  };
}

function parseClientList(raw: unknown): ClientDto[] {
  if (!Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client list data to be an array.',
    });
  }
  return raw.map((item) => parseClientDto(item));
}

function parseClientDetail(raw: unknown): ClientDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client detail data to be a non-null object.',
    });
  }
  return parseClientDto(raw);
}

export class HttpClientsAdapter implements ClientsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: HttpClientsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return this.baseUrl ? `${this.baseUrl}${cleanPath}` : cleanPath;
  }

  private mapStatusToErrorCode(status: number): ClientErrorCode {
    switch (status) {
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'not_found';
      case 409:
        return 'conflict';
      case 422:
        return 'validation';
      default:
        return 'unexpected';
    }
  }

  private async execute<T>(
    role: CompanyRole,
    path: string,
    init: RequestInit,
    options?: PortExecutionOptions,
  ): Promise<{ data: T; requestId?: string }> {
    const actorId = getDemoActorId(role);
    if (!actorId) {
      throw new ClientOperationError({
        code: 'unauthorized',
        message: `Unknown company role: ${String(role)}`,
        requestId: options?.requestId,
      });
    }

    if (options?.signal?.aborted) {
      throw new ClientOperationError({
        code: 'aborted',
        message: 'The client operation was aborted.',
        requestId: options?.requestId,
      });
    }

    const headers = new Headers(init.headers);
    headers.set('x-demo-user-id', actorId);
    if (options?.requestId) {
      headers.set('x-request-id', options.requestId);
    }

    let response: Response;
    try {
      response = await this.fetchFn(this.buildUrl(path), {
        ...init,
        headers,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof ClientOperationError) {
        throw err;
      }
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        (options?.signal && options.signal.aborted)
      ) {
        throw new ClientOperationError({
          code: 'aborted',
          message: 'The client operation was aborted.',
          requestId: options?.requestId,
          cause: err,
        });
      }
      throw new ClientOperationError({
        code: 'network',
        message: err instanceof Error ? err.message : 'Network error while contacting CRM API.',
        requestId: options?.requestId,
        cause: err,
      });
    }

    const headerRequestId = response.headers.get('x-request-id') ?? undefined;

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let serverCode: string | undefined;
      let bodyRequestId: string | undefined;

      try {
        const errorJson: unknown = await response.json();
        if (typeof errorJson === 'object' && errorJson !== null) {
          const rec = errorJson as Record<string, unknown>;
          const errVal = rec['error'];
          if (typeof errVal === 'object' && errVal !== null) {
            const errObj = errVal as Record<string, unknown>;
            const msgVal = errObj['message'];
            if (typeof msgVal === 'string' && msgVal.trim().length > 0) {
              errorMessage = msgVal;
            }
            const codeVal = errObj['code'];
            if (typeof codeVal === 'string') {
              serverCode = codeVal;
            }
          }
          const reqVal = rec['requestId'];
          if (typeof reqVal === 'string' && reqVal.trim().length > 0) {
            bodyRequestId = reqVal;
          }
        }
      } catch {
        // Non-JSON error body fallback (e.g. 500 HTML)
      }

      const effectiveRequestId = bodyRequestId ?? headerRequestId ?? options?.requestId;

      throw new ClientOperationError({
        code: this.mapStatusToErrorCode(response.status),
        message: errorMessage,
        requestId: effectiveRequestId,
        status: response.status,
        serverCode,
      });
    }

    let envelopeJson: unknown;
    try {
      envelopeJson = await response.json();
    } catch (err) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'The server response was not valid JSON.',
        requestId: headerRequestId ?? options?.requestId,
        status: response.status,
        cause: err,
      });
    }

    if (
      typeof envelopeJson !== 'object' ||
      envelopeJson === null ||
      Array.isArray(envelopeJson) ||
      !('data' in envelopeJson)
    ) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'The server response did not match the expected API envelope format.',
        requestId: headerRequestId ?? options?.requestId,
        status: response.status,
      });
    }

    const envelope = envelopeJson as { data: unknown; requestId?: unknown };
    const resolvedRequestId =
      typeof envelope.requestId === 'string' && envelope.requestId.trim().length > 0
        ? envelope.requestId
        : (headerRequestId ?? options?.requestId);

    return {
      data: envelope.data as T,
      requestId: resolvedRequestId,
    };
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<ClientDto[]> {
    const result = await this.execute<unknown>(
      role,
      '/api/v1/clients',
      { method: 'GET' },
      options,
    );
    try {
      return parseClientList(result.data);
    } catch (err) {
      if (err instanceof ClientOperationError) {
        throw new ClientOperationError({
          code: err.code,
          message: err.message,
          requestId: result.requestId ?? options?.requestId,
          status: 200,
          cause: err,
        });
      }
      throw err;
    }
  }

  async get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<ClientDto> {
    const result = await this.execute<unknown>(
      role,
      `/api/v1/clients/${encodeURIComponent(id)}`,
      { method: 'GET' },
      options,
    );
    try {
      return parseClientDetail(result.data);
    } catch (err) {
      if (err instanceof ClientOperationError) {
        throw new ClientOperationError({
          code: err.code,
          message: err.message,
          requestId: result.requestId ?? options?.requestId,
          status: 200,
          cause: err,
        });
      }
      throw err;
    }
  }
}
