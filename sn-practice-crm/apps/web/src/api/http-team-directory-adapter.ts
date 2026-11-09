import type { ReportingLineDto, SessionActor } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import type { PortExecutionOptions } from './types';
import {
  TeamDirectoryOperationError,
  sanitizeTeamDirectoryError,
  type TeamDirectoryErrorCode,
  type TeamDirectoryPort,
} from './team-directory-types';

export interface HttpTeamDirectoryAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

const RFC4122_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_COMPANY_ROLES = new Set<CompanyRole>([
  'founder',
  'manager',
  'senior_staff',
  'staff',
  'trainee',
]);

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

function parseSessionActor(raw: unknown, label: string): SessionActor {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Expected ${label} to be a non-null object.`,
    });
  }

  const rec = raw as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(rec, 'id')) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Missing required property "id" on ${label}.`,
    });
  }
  if (typeof rec['id'] !== 'string' || !RFC4122_UUID_REGEX.test(rec['id'])) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Invalid ${label} id: must be RFC 4122 UUID.`,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'name')) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Missing required property "name" on ${label}.`,
    });
  }
  if (typeof rec['name'] !== 'string' || rec['name'].trim().length === 0) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Invalid ${label} name: must be non-empty string.`,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'role')) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Missing required property "role" on ${label}.`,
    });
  }
  if (typeof rec['role'] !== 'string' || !VALID_COMPANY_ROLES.has(rec['role'] as CompanyRole)) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Invalid ${label} role.`,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'reportsToId')) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: `Missing required property "reportsToId" on ${label}.`,
    });
  }

  const reportsToId = rec['reportsToId'];
  if (reportsToId !== null) {
    if (typeof reportsToId !== 'string' || !RFC4122_UUID_REGEX.test(reportsToId)) {
      throw new TeamDirectoryOperationError({
        code: 'unexpected',
        message: `Invalid ${label} reportsToId: must be RFC 4122 UUID or null.`,
      });
    }
  }

  return {
    id: rec['id'],
    name: rec['name'].trim(),
    role: rec['role'] as CompanyRole,
    reportsToId: reportsToId as string | null,
  };
}

function parseReportingLineDto(raw: unknown): ReportingLineDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: 'Expected reporting line item to be a non-null object.',
    });
  }

  const rec = raw as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(rec, 'employee')) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: 'Missing required field "employee".',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'manager')) {
    throw new TeamDirectoryOperationError({
      code: 'unexpected',
      message: 'Missing required field "manager".',
    });
  }

  const employee = parseSessionActor(rec['employee'], 'employee');

  let manager: SessionActor | null = null;
  const rawManager = rec['manager'];
  if (rawManager !== null) {
    manager = parseSessionActor(rawManager, 'manager');
  }

  return {
    employee,
    manager,
  };
}

export class HttpTeamDirectoryAdapter implements TeamDirectoryPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpTeamDirectoryAdapterOptions = {}) {
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

  private mapStatusToErrorCode(status: number): TeamDirectoryErrorCode {
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

  private async execute<T>(
    role: CompanyRole,
    path: string,
    init: RequestInit,
    options?: PortExecutionOptions,
  ): Promise<{ data: T; requestId?: string }> {
    if (options?.signal?.aborted) {
      throw new TeamDirectoryOperationError({
        code: 'aborted',
        message: 'The team directory operation was aborted.',
        requestId: options?.requestId,
      });
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
      throw new TeamDirectoryOperationError({
        code: 'aborted',
        message: 'The team directory operation was aborted.',
        requestId: options?.requestId,
      });
    }

    const headers = new Headers(init.headers);

    if (hasTokenSource) {
      // Production authenticated transport path: must have a valid Bearer token.
      // If a token source is configured but resolves null, blank, or threw, fail locally closed.
      // Never fall back to x-demo-user-id and never dispatch fetch without a valid Bearer token.
      if (!token) {
        throw sanitizeTeamDirectoryError(
          new TeamDirectoryOperationError({
            code: 'unauthorized',
            message: 'Session expired or unauthenticated. Please sign in again to view the practice team.',
            requestId: options?.requestId,
          }),
        );
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = getDemoActorId(role);
      if (!actorId) {
        throw new TeamDirectoryOperationError({
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
        ...init,
        headers,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof TeamDirectoryOperationError) {
        throw err;
      }
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        (options?.signal && options.signal.aborted)
      ) {
        throw new TeamDirectoryOperationError({
          code: 'aborted',
          message: 'The team directory operation was aborted.',
          requestId: options?.requestId,
          cause: err,
        });
      }
      throw new TeamDirectoryOperationError({
        code: 'network',
        message: err instanceof Error ? err.message : 'Network error while contacting CRM API.',
        requestId: options?.requestId,
        cause: err,
      });
    }

    const responseRequestId =
      response.headers.get('x-request-id') ?? options?.requestId ?? undefined;

    if (!response.ok) {
      const errorCode = this.mapStatusToErrorCode(response.status);
      let serverMessage: string | undefined;
      let serverCode: string | undefined;

      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (body && typeof body === 'object') {
          if (typeof body['error'] === 'object' && body['error'] !== null) {
            const errObj = body['error'] as Record<string, unknown>;
            if (typeof errObj['message'] === 'string') serverMessage = errObj['message'];
            if (typeof errObj['code'] === 'string') serverCode = errObj['code'];
          } else if (typeof body['message'] === 'string') {
            serverMessage = body['message'];
          }
        }
      } catch {
        // Non-JSON response, ignore body
      }

      throw sanitizeTeamDirectoryError(
        new TeamDirectoryOperationError({
          code: errorCode,
          status: response.status,
          message: serverMessage ?? `API request failed with status ${response.status}.`,
          serverCode,
          requestId: responseRequestId,
        }),
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err: unknown) {
      throw new TeamDirectoryOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Failed to parse JSON response from CRM API.',
        requestId: responseRequestId,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new TeamDirectoryOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Expected response envelope to be an object.',
        requestId: responseRequestId,
      });
    }

    const envelope = payload as Record<string, unknown>;
    const finalRequestId =
      (typeof envelope['requestId'] === 'string' ? envelope['requestId'] : undefined) ??
      responseRequestId;

    if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      throw new TeamDirectoryOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'API envelope missing required "data" property.',
        requestId: finalRequestId,
      });
    }

    return {
      data: envelope['data'] as T,
      requestId: finalRequestId,
    };
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<ReportingLineDto[]> {
    try {
      const result = await this.execute<unknown>(
        role,
        '/api/v1/reporting-lines',
        { method: 'GET' },
        options,
      );

      if (!Array.isArray(result.data)) {
        throw new TeamDirectoryOperationError({
          code: 'unexpected',
          message: 'Expected reporting lines array in response.',
          requestId: result.requestId,
        });
      }

      return result.data.map((item) => parseReportingLineDto(item));
    } catch (err: unknown) {
      throw sanitizeTeamDirectoryError(err);
    }
  }
}
