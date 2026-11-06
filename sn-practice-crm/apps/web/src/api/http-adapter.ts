import type { AssignmentDto, ApiEnvelope, ApiErrorEnvelope } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { mapCommandToCreateInput, mapDtoToAssignmentRow } from './mapper';
import {
  AssignmentOperationError,
  type AssignmentContractTransition,
  type AssignmentErrorCode,
  type AssignmentsPort,
  type CreateAssignmentCommand,
  type PortExecutionOptions,
} from './types';

export interface HttpAssignmentsAdapterOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

export class HttpAssignmentsAdapter implements AssignmentsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: HttpAssignmentsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return this.baseUrl ? `${this.baseUrl}${cleanPath}` : cleanPath;
  }

  private mapStatusToErrorCode(status: number): AssignmentErrorCode {
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
      throw new AssignmentOperationError({
        code: 'unauthorized',
        message: `Unknown company role: ${role}`,
      });
    }

    const headers = new Headers(init.headers);
    // Explicit insecure dev auth header
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
        throw new AssignmentOperationError({
          code: 'aborted',
          message: 'The assignment operation was aborted.',
          cause: err,
        });
      }
      throw new AssignmentOperationError({
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

      throw new AssignmentOperationError({
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
      throw new AssignmentOperationError({
        code: 'unexpected',
        message: 'The server response was not valid JSON.',
        requestId,
        status: response.status,
        cause: err,
      });
    }
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<AssignmentRow[]> {
    const result = await this.execute<AssignmentDto[]>(
      role,
      '/api/v1/assignments',
      { method: 'GET' },
      options,
    );
    return result.data.map(mapDtoToAssignmentRow);
  }

  async create(
    role: CompanyRole,
    command: CreateAssignmentCommand,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow> {
    const input = mapCommandToCreateInput(command);
    const result = await this.execute<AssignmentDto>(
      role,
      '/api/v1/assignments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      options,
    );
    return mapDtoToAssignmentRow(result.data);
  }

  async transition(
    role: CompanyRole,
    id: string,
    action: AssignmentContractTransition,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow> {
    const result = await this.execute<AssignmentDto>(
      role,
      `/api/v1/assignments/${encodeURIComponent(id)}/transitions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      },
      options,
    );
    return mapDtoToAssignmentRow(result.data);
  }
}
