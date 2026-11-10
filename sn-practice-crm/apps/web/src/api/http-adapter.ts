import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  AssignmentDto,
  GenerateDueAssignmentsResult,
  RecurringScheduleDto,
  ServiceCatalogItemDto,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow, RecurringScheduleRecord } from '../data';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID, NAME_TO_DEMO_ACTOR_ID } from './dev-auth';
import {
  mapCommandToCreateInput,
  mapDtoToAssignmentRow,
  mapDtoToRecurringScheduleRecord,
  mapScheduleCommandToCreateInput,
  parseDisplayDateToIso,
} from './mapper';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';
import {
  AssignmentOperationError,
  SAFE_ASSIGNMENT_ERROR_MESSAGES,
  sanitizeAssignmentError,
  type AssignmentContractTransition,
  type AssignmentErrorCode,
  type AssignmentsPort,
  type CreateAssignmentCommand,
  type CreateRecurringScheduleCommand,
  type PortExecutionOptions,
  type UpdateAssignmentPatch,
  type UpdateRecurringSchedulePatch,
} from './types';

export interface HttpAssignmentsAdapterOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  authSource?: AuthSessionSource;
}

export class HttpAssignmentsAdapter implements AssignmentsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpAssignmentsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
    this.getAccessToken = options.getAccessToken;
    this.authSource = options.authSource;

    this.list = this.list.bind(this);
    this.listServices = this.listServices.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.transition = this.transition.bind(this);
    this.listSchedules = this.listSchedules.bind(this);
    this.createSchedule = this.createSchedule.bind(this);
    this.updateSchedule = this.updateSchedule.bind(this);
    this.generateDueAssignments = this.generateDueAssignments.bind(this);
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
    if (options?.signal?.aborted) {
      throw new AssignmentOperationError({
        code: 'aborted',
        message: 'The assignment operation was aborted.',
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

    if (options?.signal?.aborted) {
      throw new AssignmentOperationError({
        code: 'aborted',
        message: 'The assignment operation was aborted.',
        requestId: sanitizeRequestId(options?.requestId),
      });
    }

    const headers = new Headers(init.headers);

    if (hasTokenSource) {
      // Production authenticated transport path: must have a valid Bearer token.
      // If a token source is configured but resolves null, blank, or threw, fail locally closed.
      // Never fall back to x-demo-user-id and never dispatch fetch without a valid Bearer token.
      if (!token) {
        throw sanitizeAssignmentError(
          new AssignmentOperationError({
            code: 'unauthorized',
            message: 'Session expired or unauthenticated. Please sign in again to manage assignments.',
            requestId: sanitizeRequestId(options?.requestId),
          }),
        );
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Demo preview path: x-demo-user-id based on explicit role.
      const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
      if (!actorId) {
        throw new AssignmentOperationError({
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

    const requestId = sanitizeRequestId(response.headers.get('x-request-id') ?? undefined);

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let serverCode: string | undefined;
      let bodyRequestId = requestId;

      try {
        const errorJson = (await response.json()) as Partial<ApiErrorEnvelope>;
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorMessage;
          serverCode = sanitizeServerCode(errorJson.error.code);
        }
        if (errorJson.requestId) {
          bodyRequestId = sanitizeRequestId(errorJson.requestId) ?? bodyRequestId;
        }
      } catch {
        // Failed to parse error JSON (e.g. 500 HTML)
      }

      const code = this.mapStatusToErrorCode(response.status);
      throw sanitizeAssignmentError(
        new AssignmentOperationError({
          code,
          message: errorMessage,
          requestId: bodyRequestId,
          status: response.status,
          serverCode,
        }),
      );
    }

    try {
      const envelope = (await response.json()) as ApiEnvelope<T>;
      return {
        data: envelope.data,
        requestId: sanitizeRequestId(envelope.requestId) ?? requestId,
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

  async listServices(role: CompanyRole, options?: PortExecutionOptions): Promise<readonly ServiceCatalogItemDto[]> {
    const result = await this.execute<ServiceCatalogItemDto[]>(
      role,
      '/api/v1/services',
      { method: 'GET' },
      options,
    );
    return result.data;
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

  async update(
    role: CompanyRole,
    id: string,
    patch: UpdateAssignmentPatch,
    options?: PortExecutionOptions,
  ): Promise<AssignmentRow> {
    const body: {
      title?: string;
      description?: string | null;
      serviceId?: string;
      ownerId?: string;
      reviewerIds?: string[];
      dueAt?: string;
      deliveryNotes?: string | null;
      reviewNotes?: string | null;
      progressPercent?: number;
      expectedUpdatedAt?: string;
    } = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.serviceId !== undefined) body.serviceId = patch.serviceId;
    if (patch.ownerId !== undefined) body.ownerId = patch.ownerId;
    if (patch.reviewerIds !== undefined) body.reviewerIds = [...patch.reviewerIds];
    if (patch.dueAt !== undefined) body.dueAt = patch.dueAt;
    if (patch.deliveryNotes !== undefined) body.deliveryNotes = patch.deliveryNotes;
    if (patch.reviewNotes !== undefined) body.reviewNotes = patch.reviewNotes;
    if (patch.progressPercent !== undefined) body.progressPercent = patch.progressPercent;
    if (patch.expectedUpdatedAt !== undefined) body.expectedUpdatedAt = patch.expectedUpdatedAt;

    const result = await this.execute<AssignmentDto>(
      role,
      `/api/v1/assignments/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    );
    return mapDtoToAssignmentRow(result.data);
  }

  async transition(
    role: CompanyRole,
    id: string,
    action: AssignmentContractTransition,
    options?: PortExecutionOptions & {
      expectedUpdatedAt?: string;
      deliveryNotes?: string | null;
      reviewNotes?: string | null;
      progressPercent?: number;
    },
  ): Promise<AssignmentRow> {
    const payload: {
      action: AssignmentContractTransition;
      expectedUpdatedAt?: string;
      deliveryNotes?: string | null;
      reviewNotes?: string | null;
      progressPercent?: number;
    } = { action };
    if (options?.expectedUpdatedAt) {
      payload.expectedUpdatedAt = options.expectedUpdatedAt;
    }
    if (options?.deliveryNotes !== undefined) {
      payload.deliveryNotes = options.deliveryNotes;
    }
    if (options?.reviewNotes !== undefined) {
      payload.reviewNotes = options.reviewNotes;
    }
    if (options?.progressPercent !== undefined) {
      payload.progressPercent = options.progressPercent;
    }
    const result = await this.execute<AssignmentDto>(
      role,
      `/api/v1/assignments/${encodeURIComponent(id)}/transitions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      options,
    );
    return mapDtoToAssignmentRow(result.data);
  }

  async listSchedules(
    role: CompanyRole,
    options?: PortExecutionOptions,
  ): Promise<RecurringScheduleRecord[]> {
    const result = await this.execute<RecurringScheduleDto[]>(
      role,
      '/api/v1/recurring-schedules',
      { method: 'GET' },
      options,
    );
    return result.data.map(mapDtoToRecurringScheduleRecord);
  }

  async createSchedule(
    role: CompanyRole,
    command: CreateRecurringScheduleCommand,
    options?: PortExecutionOptions,
  ): Promise<RecurringScheduleRecord> {
    const input = mapScheduleCommandToCreateInput(command);
    const result = await this.execute<RecurringScheduleDto>(
      role,
      '/api/v1/recurring-schedules',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      options,
    );
    return mapDtoToRecurringScheduleRecord(result.data);
  }

  async updateSchedule(
    role: CompanyRole,
    id: string,
    patch: UpdateRecurringSchedulePatch,
    options?: PortExecutionOptions,
  ): Promise<RecurringScheduleRecord> {
    const body: {
      active?: boolean;
      nextOccurrenceOn?: string;
    } = {};
    if (patch.active !== undefined) body.active = patch.active;
    if (patch.nextOccurrenceOn !== undefined) body.nextOccurrenceOn = patch.nextOccurrenceOn;

    const result = await this.execute<RecurringScheduleDto>(
      role,
      `/api/v1/recurring-schedules/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    );
    return mapDtoToRecurringScheduleRecord(result.data);
  }

  async generateDueAssignments(
    role: CompanyRole,
    options?: PortExecutionOptions & { throughDate?: string },
  ): Promise<GenerateDueAssignmentsResult> {
    const body: { throughDate?: string } = {};
    if (options?.throughDate) {
      body.throughDate = options.throughDate;
    }
    const result = await this.execute<GenerateDueAssignmentsResult>(
      role,
      '/api/v1/recurring-schedules/generate-due',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      options,
    );
    return result.data;
  }
}
