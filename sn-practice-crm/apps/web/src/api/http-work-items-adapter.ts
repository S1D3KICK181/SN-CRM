import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import type { PortExecutionOptions } from './types';
import {
  WorkItemOperationError,
  type WorkItemErrorCode,
  type WorkItemsPort,
} from './work-items-types';

export interface HttpWorkItemsAdapterOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export class HttpWorkItemsAdapter implements WorkItemsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: HttpWorkItemsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
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
    const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
    if (!actorId) {
      throw new WorkItemOperationError({
        code: 'unauthorized',
        message: `Unknown company role: ${role}`,
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
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        (options?.signal && options.signal.aborted)
      ) {
        throw new WorkItemOperationError({
          code: 'aborted',
          message: 'The work item operation was aborted.',
          cause: err,
        });
      }
      throw new WorkItemOperationError({
        code: 'network',
        message: err instanceof Error ? err.message : 'Network error while contacting CRM API.',
        cause: err,
      });
    }

    const requestId = response.headers.get('x-request-id') ?? undefined;

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let serverCode: string | undefined;
      let bodyRequestId = requestId;

      try {
        const errorJson = (await response.json()) as Partial<ApiErrorEnvelope>;
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorMessage;
          serverCode = errorJson.error.code;
        }
        if (errorJson.requestId) {
          bodyRequestId = errorJson.requestId;
        }
      } catch {
        // Failed to parse error JSON (e.g. 500 HTML)
      }

      throw new WorkItemOperationError({
        code: this.mapStatusToErrorCode(response.status),
        message: errorMessage,
        requestId: bodyRequestId,
        status: response.status,
        serverCode,
      });
    }

    try {
      const envelope = (await response.json()) as ApiEnvelope<T>;
      return {
        data: envelope.data,
        requestId: envelope.requestId ?? requestId,
      };
    } catch (err) {
      throw new WorkItemOperationError({
        code: 'unexpected',
        message: 'The server response was not valid JSON.',
        requestId,
        status: response.status,
        cause: err,
      });
    }
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
