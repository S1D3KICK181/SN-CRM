import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  CreateEngagementDraftInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';
import type { PortExecutionOptions } from './types';
import {
  EngagementOperationError,
  SAFE_ENGAGEMENT_ERROR_MESSAGES,
  sanitizeEngagementError,
  validateIdempotencyKey,
  type EngagementErrorCode,
  type EngagementsPort,
} from './engagements-types';

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

export interface HttpEngagementsAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

// ---------------------------------------------------------------------------
// HttpEngagementsAdapter
// ---------------------------------------------------------------------------

export class HttpEngagementsAdapter implements EngagementsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpEngagementsAdapterOptions = {}) {
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

  private mapStatusToErrorCode(status: number): EngagementErrorCode {
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

  /**
   * Core fetch execution with:
   * - Pre-flight abort check
   * - Token resolution (Bearer or demo header)
   * - Post-token-await abort check
   * - x-request-id propagation
   * - Idempotency-Key header injection (for mutations)
   * - Safe error mapping and envelope unwrap
   */
  private async execute<T>(
    role: CompanyRole,
    path: string,
    init: RequestInit,
    options?: PortExecutionOptions,
    idempotencyKey?: string,
  ): Promise<{ data: T; requestId?: string }> {
    // Pre-flight abort check
    if (options?.signal?.aborted) {
      throw new EngagementOperationError({
        code: 'aborted',
        message: SAFE_ENGAGEMENT_ERROR_MESSAGES.aborted,
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

    // Post-token abort check: prevent dispatching after token resolution if cancelled
    if (options?.signal?.aborted) {
      throw new EngagementOperationError({
        code: 'aborted',
        message: SAFE_ENGAGEMENT_ERROR_MESSAGES.aborted,
        requestId: sanitizeRequestId(options?.requestId),
      });
    }

    const headers = new Headers(init.headers);

    if (hasTokenSource) {
      // Production authenticated transport: must have a valid Bearer token.
      // A null/blank/thrown token source fails locally closed as unauthorized.
      // Never send x-demo-user-id when a token source is configured.
      if (!token) {
        throw sanitizeEngagementError(
          new EngagementOperationError({
            code: 'unauthorized',
            message: SAFE_ENGAGEMENT_ERROR_MESSAGES.unauthorized,
            requestId: sanitizeRequestId(options?.requestId),
          }),
        );
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
      if (!actorId) {
        throw new EngagementOperationError({
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

    // Idempotency key for mutations
    if (idempotencyKey !== undefined) {
      headers.set('idempotency-key', idempotencyKey);
    }

    let response: Response;
    try {
      response = await this.fetchFn(this.buildUrl(path), {
        ...init,
        headers,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof EngagementOperationError) {
        throw err;
      }
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        (options?.signal && options.signal.aborted)
      ) {
        throw new EngagementOperationError({
          code: 'aborted',
          message: SAFE_ENGAGEMENT_ERROR_MESSAGES.aborted,
          requestId: sanitizeRequestId(options?.requestId),
          cause: err,
        });
      }
      throw new EngagementOperationError({
        code: 'network',
        message: SAFE_ENGAGEMENT_ERROR_MESSAGES.network,
        requestId: sanitizeRequestId(options?.requestId),
        cause: err,
      });
    }

    const headerRequestId = sanitizeRequestId(
      response.headers.get('x-request-id') ?? options?.requestId,
    );

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
        // Non-JSON error response — ignore body
      }

      const effectiveRequestId = sanitizeRequestId(bodyRequestId) ?? headerRequestId;
      const safeMessage =
        SAFE_ENGAGEMENT_ERROR_MESSAGES[errorCode] ??
        SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected;

      throw new EngagementOperationError({
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
      throw new EngagementOperationError({
        code: 'unexpected',
        message: SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected,
        requestId: headerRequestId,
        status: response.status,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new EngagementOperationError({
        code: 'unexpected',
        status: response.status,
        message: SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected,
        requestId: headerRequestId,
      });
    }

    const envelope = payload as Record<string, unknown>;
    const envelopeRequestId = sanitizeRequestId(
      typeof envelope['requestId'] === 'string' ? envelope['requestId'] : undefined,
    );
    const finalRequestId = envelopeRequestId ?? headerRequestId;

    if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
      throw new EngagementOperationError({
        code: 'unexpected',
        status: response.status,
        message: SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected,
        requestId: finalRequestId,
      });
    }

    return {
      data: envelope['data'] as T,
      requestId: finalRequestId,
    };
  }

  /**
   * Validates and enforces an idempotency key before any mutation.
   * Throws an EngagementOperationError with code 'validation' if the key is missing or invalid.
   * Returns the validated (trimmed) key.
   */
  private requireIdempotencyKey(raw: string, requestId?: string): string {
    const valid = validateIdempotencyKey(raw);
    if (valid === null) {
      throw new EngagementOperationError({
        code: 'validation',
        message:
          'Idempotency-Key is required: must be a non-blank string of at most 255 characters.',
        requestId: sanitizeRequestId(requestId),
      });
    }
    return valid;
  }

  // ---------------------------------------------------------------------------
  // Port methods
  // ---------------------------------------------------------------------------

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<EngagementDto[]> {
    try {
      const result = await this.execute<EngagementDto[]>(
        role,
        '/api/v1/engagements',
        { method: 'GET' },
        options,
      );
      if (!Array.isArray(result.data)) {
        throw new EngagementOperationError({
          code: 'unexpected',
          message: SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected,
          requestId: result.requestId,
        });
      }
      return result.data;
    } catch (err: unknown) {
      throw sanitizeEngagementError(err);
    }
  }

  async get(
    role: CompanyRole,
    id: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    try {
      const result = await this.execute<EngagementDto>(
        role,
        `/api/v1/engagements/${encodeURIComponent(id)}`,
        { method: 'GET' },
        options,
      );
      return result.data;
    } catch (err: unknown) {
      throw sanitizeEngagementError(err);
    }
  }

  async listVersions(
    role: CompanyRole,
    engagementId: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementVersionDto[]> {
    try {
      const result = await this.execute<EngagementVersionDto[]>(
        role,
        `/api/v1/engagements/${encodeURIComponent(engagementId)}/versions`,
        { method: 'GET' },
        options,
      );
      if (!Array.isArray(result.data)) {
        throw new EngagementOperationError({
          code: 'unexpected',
          message: SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected,
          requestId: result.requestId,
        });
      }
      return result.data;
    } catch (err: unknown) {
      throw sanitizeEngagementError(err);
    }
  }

  async createDraft(
    role: CompanyRole,
    input: CreateEngagementDraftInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    const validKey = this.requireIdempotencyKey(idempotencyKey, options?.requestId);
    try {
      const result = await this.execute<EngagementDto>(
        role,
        '/api/v1/engagements',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        options,
        validKey,
      );
      return result.data;
    } catch (err: unknown) {
      if (err instanceof EngagementOperationError && err.code === 'validation') throw err;
      throw sanitizeEngagementError(err);
    }
  }

  async reviseDraft(
    role: CompanyRole,
    engagementId: string,
    input: ReviseEngagementDraftInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    const validKey = this.requireIdempotencyKey(idempotencyKey, options?.requestId);
    // Route-bound engagementId must not be duplicated in the JSON body.
    // The input type carries engagementId for contract consistency; strip it from the body.
    const { engagementId: _id, ...bodyInput } = input as ReviseEngagementDraftInput & { engagementId?: string };
    void _id;
    try {
      const result = await this.execute<EngagementDto>(
        role,
        `/api/v1/engagements/${encodeURIComponent(engagementId)}/draft`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyInput),
        },
        options,
        validKey,
      );
      return result.data;
    } catch (err: unknown) {
      if (err instanceof EngagementOperationError && err.code === 'validation') throw err;
      throw sanitizeEngagementError(err);
    }
  }

  async activate(
    role: CompanyRole,
    engagementId: string,
    input: ActivateEngagementInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    const validKey = this.requireIdempotencyKey(idempotencyKey, options?.requestId);
    // Route-bound engagementId must not be duplicated in the JSON body.
    const { engagementId: _id, ...bodyInput } = input as ActivateEngagementInput & { engagementId?: string };
    void _id;
    try {
      const result = await this.execute<EngagementDto>(
        role,
        `/api/v1/engagements/${encodeURIComponent(engagementId)}/activate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyInput),
        },
        options,
        validKey,
      );
      return result.data;
    } catch (err: unknown) {
      if (err instanceof EngagementOperationError && err.code === 'validation') throw err;
      throw sanitizeEngagementError(err);
    }
  }

  async amend(
    role: CompanyRole,
    engagementId: string,
    input: AmendActiveEngagementInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    const validKey = this.requireIdempotencyKey(idempotencyKey, options?.requestId);
    // Route-bound engagementId must not be duplicated in the JSON body.
    const { engagementId: _id, ...bodyInput } = input as AmendActiveEngagementInput & { engagementId?: string };
    void _id;
    try {
      const result = await this.execute<EngagementDto>(
        role,
        `/api/v1/engagements/${encodeURIComponent(engagementId)}/amendments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyInput),
        },
        options,
        validKey,
      );
      return result.data;
    } catch (err: unknown) {
      if (err instanceof EngagementOperationError && err.code === 'validation') throw err;
      throw sanitizeEngagementError(err);
    }
  }

  async end(
    role: CompanyRole,
    engagementId: string,
    input: EndEngagementInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    const validKey = this.requireIdempotencyKey(idempotencyKey, options?.requestId);
    // Route-bound engagementId must not be duplicated in the JSON body.
    const { engagementId: _id, ...bodyInput } = input as EndEngagementInput & { engagementId?: string };
    void _id;
    try {
      const result = await this.execute<EngagementDto>(
        role,
        `/api/v1/engagements/${encodeURIComponent(engagementId)}/end`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyInput),
        },
        options,
        validKey,
      );
      return result.data;
    } catch (err: unknown) {
      if (err instanceof EngagementOperationError && err.code === 'validation') throw err;
      throw sanitizeEngagementError(err);
    }
  }
}
