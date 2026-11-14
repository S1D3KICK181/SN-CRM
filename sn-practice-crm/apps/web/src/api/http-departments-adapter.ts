import type {
  CreateDepartmentInput,
  DepartmentDto,
  DepartmentMemberDto,
  SetDepartmentMembersInput,
  UpdateDepartmentInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { validateIdempotencyKey } from './engagements-types';
import { isValidUuid } from './metadata-safety';
import type { PortExecutionOptions } from './types';
import {
  DepartmentsOperationError,
  sanitizeDepartmentsError,
  type DepartmentsErrorCode,
  type DepartmentsPort,
} from './departments-types';

export interface HttpDepartmentsAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

const VALID_COMPANY_ROLES = new Set<CompanyRole>(['founder', 'manager', 'senior_staff', 'staff', 'trainee']);

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

function malformed(message: string): DepartmentsOperationError {
  return new DepartmentsOperationError({ code: 'unexpected', message });
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

function readBoolean(rec: Record<string, unknown>, key: string, label: string): boolean {
  const value = field(rec, key, label);
  if (typeof value !== 'boolean') throw malformed(`Invalid ${label} ${key}: must be a boolean.`);
  return value;
}

function readTimestamp(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw malformed(`Invalid ${label} ${key}: must be an ISO timestamp.`);
  }
  return value;
}

function readUuid(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (!isValidUuid(value)) throw malformed(`Invalid ${label} ${key}: must be an RFC 4122 UUID.`);
  return value;
}

function readRole(rec: Record<string, unknown>, label: string): CompanyRole {
  const value = field(rec, 'role', label);
  if (typeof value !== 'string' || !VALID_COMPANY_ROLES.has(value as CompanyRole)) {
    throw malformed(`Invalid ${label} role: must be a company role.`);
  }
  return value as CompanyRole;
}

function parseMember(raw: unknown): DepartmentMemberDto {
  const rec = asObject(raw, 'department member');
  return {
    userId: readUuid(rec, 'userId', 'department member'),
    name: readString(rec, 'name', 'department member'),
    role: readRole(rec, 'department member'),
    isHead: readBoolean(rec, 'isHead', 'department member'),
  };
}

export function parseDepartmentDto(raw: unknown): DepartmentDto {
  const rec = asObject(raw, 'department');
  const members = field(rec, 'members', 'department');
  const serviceIds = field(rec, 'serviceIds', 'department');
  if (!Array.isArray(members)) throw malformed('Invalid department members: must be an array.');
  if (!Array.isArray(serviceIds) || !serviceIds.every((id) => isValidUuid(id))) {
    throw malformed('Invalid department serviceIds: must be an array of RFC 4122 UUIDs.');
  }
  return {
    id: readUuid(rec, 'id', 'department'),
    name: readString(rec, 'name', 'department'),
    isActive: readBoolean(rec, 'isActive', 'department'),
    members: members.map(parseMember),
    serviceIds: serviceIds as string[],
    createdAt: readTimestamp(rec, 'createdAt', 'department'),
    updatedAt: readTimestamp(rec, 'updatedAt', 'department'),
  };
}

export class HttpDepartmentsAdapter implements DepartmentsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpDepartmentsAdapterOptions = {}) {
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

  private mapStatusToErrorCode(status: number): DepartmentsErrorCode {
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

  private abortedError(options?: PortExecutionOptions, cause?: unknown): DepartmentsOperationError {
    return new DepartmentsOperationError({
      code: 'aborted',
      message: 'The department operation was aborted.',
      requestId: options?.requestId,
      cause,
    });
  }

  private async execute(
    role: CompanyRole,
    path: string,
    options?: PortExecutionOptions,
    mutation?: { readonly method: 'POST' | 'PATCH' | 'PUT'; readonly body: unknown; readonly idempotencyKey: string },
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
        throw new DepartmentsOperationError({
          code: 'unauthorized',
          message: 'Session expired or unauthenticated. Please sign in again to manage departments.',
          requestId: options?.requestId,
        });
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = getDemoActorId(role);
      if (!actorId) {
        throw new DepartmentsOperationError({
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
        method: mutation ? mutation.method : 'GET',
        headers,
        body: mutation ? JSON.stringify(mutation.body) : undefined,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof DepartmentsOperationError) {
        throw err;
      }
      if ((err instanceof Error && err.name === 'AbortError') || options?.signal?.aborted) {
        throw this.abortedError(options, err);
      }
      throw new DepartmentsOperationError({
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

      throw new DepartmentsOperationError({
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
      throw new DepartmentsOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Failed to parse JSON response from CRM API.',
        requestId: responseRequestId,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new DepartmentsOperationError({
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
      throw new DepartmentsOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'API envelope missing required "data" property.',
        requestId: finalRequestId,
      });
    }

    return { data: envelope['data'], requestId: finalRequestId };
  }

  async listDepartments(role: CompanyRole, options?: PortExecutionOptions): Promise<DepartmentDto[]> {
    try {
      const result = await this.execute(role, '/api/v1/departments', options);
      if (!Array.isArray(result.data)) {
        throw new DepartmentsOperationError({
          code: 'unexpected',
          message: 'Expected departments array in response.',
          requestId: result.requestId,
        });
      }
      return result.data.map((item) => parseDepartmentDto(item));
    } catch (err: unknown) {
      throw sanitizeDepartmentsError(err);
    }
  }

  private async mutate(
    role: CompanyRole,
    method: 'POST' | 'PATCH' | 'PUT',
    path: string,
    body: unknown,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    const key = validateIdempotencyKey(idempotencyKey);
    if (key === null) {
      throw new DepartmentsOperationError({
        code: 'unexpected',
        message: 'Idempotency-Key is required: must be a non-blank string of at most 255 characters.',
        requestId: options?.requestId,
      });
    }
    try {
      const result = await this.execute(role, path, options, { method, body, idempotencyKey: key });
      return parseDepartmentDto(result.data);
    } catch (err: unknown) {
      throw sanitizeDepartmentsError(err);
    }
  }

  createDepartment(
    role: CompanyRole,
    input: CreateDepartmentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    return this.mutate(role, 'POST', '/api/v1/departments', input, idempotencyKey, options);
  }

  updateDepartment(
    role: CompanyRole,
    departmentId: string,
    input: UpdateDepartmentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    return this.mutate(
      role,
      'PATCH',
      `/api/v1/departments/${encodeURIComponent(departmentId)}`,
      input,
      idempotencyKey,
      options,
    );
  }

  setDepartmentMembers(
    role: CompanyRole,
    departmentId: string,
    input: SetDepartmentMembersInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<DepartmentDto> {
    return this.mutate(
      role,
      'PUT',
      `/api/v1/departments/${encodeURIComponent(departmentId)}/members`,
      input,
      idempotencyKey,
      options,
    );
  }
}
