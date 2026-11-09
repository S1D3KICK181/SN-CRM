import type {
  ApiEnvelope,
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';
import type { PortExecutionOptions } from './types';
import {
  GENERIC_SAFE_WORK_ITEM_ERROR,
  SAFE_WORK_ITEMS_ERROR_MESSAGES,
  WorkItemOperationError,
  sanitizeWorkItemError,
  type WorkItemErrorCode,
  type WorkItemsPort,
} from './work-items-types';

export interface HttpWorkItemsAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

export class HttpWorkItemsAdapter implements WorkItemsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpWorkItemsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
    this.getAccessToken = options.getAccessToken;
    this.authSource = options.authSource;

    // Safe method binding for usage as callback references
    this.list = this.list.bind(this);
    this.create = this.create.bind(this);
    this.transition = this.transition.bind(this);
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return this.baseUrl ? `${this.baseUrl}${cleanPath}` : cleanPath;
  }

  private mapStatusToErrorCode(status: number): WorkItemErrorCode {
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
    if (options?.signal?.aborted) {
      throw new WorkItemOperationError({
        code: 'aborted',
        message: 'The work item operation was aborted.',
        requestId: sanitizeRequestId(options?.requestId),
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
      throw new WorkItemOperationError({
        code: 'aborted',
        message: 'The work item operation was aborted.',
        requestId: sanitizeRequestId(options?.requestId),
      });
    }

    const headers = new Headers(init.headers);

    if (hasTokenSource) {
      // Production authenticated transport path: must have a valid Bearer token.
      // If a token source is configured but resolves null, blank, or threw, fail locally closed.
      // Never fall back to x-demo-user-id and never dispatch fetch without a valid Bearer token.
      if (!token) {
        throw sanitizeWorkItemError(
          new WorkItemOperationError({
            code: 'unauthorized',
            message: 'Session expired or unauthenticated. Please sign in again to manage tasks.',
            requestId: sanitizeRequestId(options?.requestId),
          }),
        );
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
      if (!actorId) {
        throw new WorkItemOperationError({
          code: 'unauthorized',
          message: `Unknown company role: ${role}`,
          requestId: sanitizeRequestId(options?.requestId),
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
      if (err instanceof WorkItemOperationError) {
        throw err;
      }
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        (options?.signal && options.signal.aborted)
      ) {
        throw new WorkItemOperationError({
          code: 'aborted',
          message: 'The work item operation was aborted.',
          requestId: sanitizeRequestId(options?.requestId),
          cause: err,
        });
      }
      throw new WorkItemOperationError({
        code: 'network',
        message: SAFE_WORK_ITEMS_ERROR_MESSAGES.network,
        requestId: sanitizeRequestId(options?.requestId),
        cause: err,
      });
    }

    const headerRequestId =
      sanitizeRequestId(response.headers.get('x-request-id') ?? options?.requestId);

    if (!response.ok) {
      const errorCode = this.mapStatusToErrorCode(response.status);
      let serverCode: string | undefined;
      let bodyRequestId: string | undefined;

      try {
        const body = (await response.json()) as Record<string, unknown>;
        if (body && typeof body === 'object') {
          if (typeof body['error'] === 'object' && body['error'] !== null) {
            const errObj = body['error'] as Record<string, unknown>;
            if (typeof errObj['code'] === 'string') serverCode = errObj['code'];
          }
          if (typeof body['requestId'] === 'string' && body['requestId'].trim().length > 0) {
            bodyRequestId = body['requestId'].trim();
          }
        }
      } catch {
        // Non-JSON response, ignore body
      }

      const effectiveRequestId = sanitizeRequestId(bodyRequestId) ?? headerRequestId;
      const safeMessage = SAFE_WORK_ITEMS_ERROR_MESSAGES[errorCode] ?? GENERIC_SAFE_WORK_ITEM_ERROR;

      throw new WorkItemOperationError({
        code: errorCode,
        status: response.status,
        message: safeMessage,
        serverCode: sanitizeServerCode(serverCode),
        requestId: effectiveRequestId,
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      throw new WorkItemOperationError({
        code: 'unexpected',
        message: SAFE_WORK_ITEMS_ERROR_MESSAGES.unexpected,
        requestId: headerRequestId,
        status: response.status,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new WorkItemOperationError({
        code: 'unexpected',
        status: response.status,
        message: SAFE_WORK_ITEMS_ERROR_MESSAGES.unexpected,
        requestId: headerRequestId,
      });
    }

    const envelope = payload as ApiEnvelope<T>;
    return {
      data: envelope.data,
      requestId: sanitizeRequestId(envelope.requestId ?? headerRequestId),
    };
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<WorkItemDto[]> {
    const result = await this.execute<WorkItemDto[]>(
      role,
      '/api/v1/work-items',
      { method: 'GET' },
      options,
    );
    return result.data;
  }

  async create(
    role: CompanyRole,
    input: CreateWorkItemInput,
    options?: PortExecutionOptions,
  ): Promise<WorkItemDto> {
    const result = await this.execute<WorkItemDto>(
      role,
      '/api/v1/work-items',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      options,
    );
    return result.data;
  }

  async transition(
    role: CompanyRole,
    id: string,
    action: WorkItemTransition,
    options?: PortExecutionOptions,
  ): Promise<WorkItemDto> {
    const result = await this.execute<WorkItemDto>(
      role,
      `/api/v1/work-items/${encodeURIComponent(id)}/transitions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      },
      options,
    );
    return result.data;
  }
}
