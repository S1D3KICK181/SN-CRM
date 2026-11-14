import {
  DOCUMENT_CATEGORIES,
  MESSAGE_PURPOSES,
  REPORT_PERIOD_KINDS,
  type DocumentCategory,
  type FeesReportDto,
  type FollowUpsReportDto,
  type MessagePurpose,
  type PracticeReportDto,
  type ReportPeriodDto,
  type ReportPeriodKind,
  type TeamActivityRowDto,
  type WorkProgressReportDto,
} from '@sn/contracts';
import { COMPANY_ROLES, type CompanyRole } from '@sn/domain';
import type { AuthSessionSource } from './auth/types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import type { PortExecutionOptions } from './types';
import {
  ReportsOperationError,
  sanitizeReportsError,
  type ReportQuery,
  type ReportsErrorCode,
  type ReportsPort,
} from './reports-types';

export interface HttpReportsAdapterOptions {
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly authSource?: AuthSessionSource;
}

const VALID_COMPANY_ROLES = new Set<CompanyRole>(COMPANY_ROLES);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

function malformed(message: string): ReportsOperationError {
  return new ReportsOperationError({ code: 'unexpected', message });
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

function readCount(rec: Record<string, unknown>, key: string, label: string): number {
  const value = field(rec, key, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-negative integer.`);
  }
  return value;
}

/** Money is integer paise; credit and pending figures are never negative either. */
function readPaise(rec: Record<string, unknown>, key: string, label: string): number {
  const value = field(rec, key, label);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw malformed(`Invalid ${label} ${key}: must be a non-negative integer amount in paise.`);
  }
  return value;
}

function readDate(rec: Record<string, unknown>, key: string, label: string): string {
  const value = field(rec, key, label);
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw malformed(`Invalid ${label} ${key}: must be a YYYY-MM-DD date.`);
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

function readArray(rec: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = field(rec, key, label);
  if (!Array.isArray(value)) throw malformed(`Invalid ${label} ${key}: must be an array.`);
  return value;
}

function readKind(rec: Record<string, unknown>): ReportPeriodKind {
  const value = field(rec, 'kind', 'report period');
  const match = REPORT_PERIOD_KINDS.find((kind) => kind === value);
  if (!match) throw malformed('Invalid report period kind.');
  return match;
}

function readRole(rec: Record<string, unknown>): CompanyRole {
  const value = field(rec, 'role', 'team activity row');
  const match = COMPANY_ROLES.find((role) => role === value);
  if (!match) throw malformed('Invalid team activity role.');
  return match;
}

function readPurpose(rec: Record<string, unknown>): MessagePurpose {
  const value = field(rec, 'purpose', 'message purpose row');
  const match = MESSAGE_PURPOSES.find((purpose) => purpose === value);
  if (!match) throw malformed('Invalid message purpose.');
  return match;
}

function readCategory(rec: Record<string, unknown>): DocumentCategory {
  const value = field(rec, 'category', 'document category row');
  const match = DOCUMENT_CATEGORIES.find((category) => category === value);
  if (!match) throw malformed('Invalid document category.');
  return match;
}

function parsePeriod(raw: unknown): ReportPeriodDto {
  const rec = asObject(raw, 'report period');
  return {
    kind: readKind(rec),
    start: readDate(rec, 'start', 'report period'),
    endExclusive: readDate(rec, 'endExclusive', 'report period'),
    label: readString(rec, 'label', 'report period'),
  };
}

function parseWorkProgress(raw: unknown): WorkProgressReportDto {
  const rec = asObject(raw, 'work progress');
  const summary = asObject(field(rec, 'summary', 'work progress'), 'work progress summary');
  const counts = (row: Record<string, unknown>, label: string) => ({
    created: readCount(row, 'created', label),
    completed: readCount(row, 'completed', label),
    openNow: readCount(row, 'openNow', label),
    overdueNow: readCount(row, 'overdueNow', label),
  });
  return {
    summary: {
      created: readCount(summary, 'created', 'work progress summary'),
      completed: readCount(summary, 'completed', 'work progress summary'),
      submittedForReview: readCount(summary, 'submittedForReview', 'work progress summary'),
      overdueNow: readCount(summary, 'overdueNow', 'work progress summary'),
      dueNext7Days: readCount(summary, 'dueNext7Days', 'work progress summary'),
    },
    byService: readArray(rec, 'byService', 'work progress').map((item) => {
      const row = asObject(item, 'service row');
      return { serviceName: readString(row, 'serviceName', 'service row'), ...counts(row, 'service row') };
    }),
    byOwner: readArray(rec, 'byOwner', 'work progress').map((item) => {
      const row = asObject(item, 'owner row');
      return { ownerName: readString(row, 'ownerName', 'owner row'), ...counts(row, 'owner row') };
    }),
    overdueList: readArray(rec, 'overdueList', 'work progress').map((item) => {
      const row = asObject(item, 'overdue assignment row');
      return {
        assignmentCode: readString(row, 'assignmentCode', 'overdue assignment row'),
        title: readString(row, 'title', 'overdue assignment row'),
        clientName: readString(row, 'clientName', 'overdue assignment row'),
        ownerName: readString(row, 'ownerName', 'overdue assignment row'),
        dueDate: readDate(row, 'dueDate', 'overdue assignment row'),
        daysOverdue: readCount(row, 'daysOverdue', 'overdue assignment row'),
      };
    }),
  };
}

function parseTeamActivity(raw: unknown): TeamActivityRowDto {
  const row = asObject(raw, 'team activity row');
  return {
    name: readString(row, 'name', 'team activity row'),
    role: readRole(row),
    assignmentsCompleted: readCount(row, 'assignmentsCompleted', 'team activity row'),
    submittedForReview: readCount(row, 'submittedForReview', 'team activity row'),
    tasksCompleted: readCount(row, 'tasksCompleted', 'team activity row'),
    tasksOpen: readCount(row, 'tasksOpen', 'team activity row'),
    tasksOverdue: readCount(row, 'tasksOverdue', 'team activity row'),
    reviewsDone: readCount(row, 'reviewsDone', 'team activity row'),
  };
}

function parseFees(raw: unknown): FeesReportDto | null {
  if (raw === null) return null;
  const rec = asObject(raw, 'fees');
  const summary = asObject(field(rec, 'summary', 'fees'), 'fees summary');
  return {
    summary: {
      billsRecorded: readCount(summary, 'billsRecorded', 'fees summary'),
      billedPaise: readPaise(summary, 'billedPaise', 'fees summary'),
      paymentsReceived: readCount(summary, 'paymentsReceived', 'fees summary'),
      receivedPaise: readPaise(summary, 'receivedPaise', 'fees summary'),
      pendingNowPaise: readPaise(summary, 'pendingNowPaise', 'fees summary'),
      overdueNowPaise: readPaise(summary, 'overdueNowPaise', 'fees summary'),
      creditHeldPaise: readPaise(summary, 'creditHeldPaise', 'fees summary'),
    },
    byClient: readArray(rec, 'byClient', 'fees').map((item) => {
      const row = asObject(item, 'fees client row');
      return {
        clientCode: readString(row, 'clientCode', 'fees client row'),
        clientName: readString(row, 'clientName', 'fees client row'),
        billedPaise: readPaise(row, 'billedPaise', 'fees client row'),
        receivedPaise: readPaise(row, 'receivedPaise', 'fees client row'),
        pendingNowPaise: readPaise(row, 'pendingNowPaise', 'fees client row'),
        overdueNowPaise: readPaise(row, 'overdueNowPaise', 'fees client row'),
        creditPaise: readPaise(row, 'creditPaise', 'fees client row'),
      };
    }),
  };
}

function parseFollowUps(raw: unknown): FollowUpsReportDto {
  const rec = asObject(raw, 'follow-ups');
  return {
    messagesByPurpose: readArray(rec, 'messagesByPurpose', 'follow-ups').map((item) => {
      const row = asObject(item, 'message purpose row');
      return { purpose: readPurpose(row), count: readCount(row, 'count', 'message purpose row') };
    }),
    documentsByCategory: readArray(rec, 'documentsByCategory', 'follow-ups').map((item) => {
      const row = asObject(item, 'document category row');
      return { category: readCategory(row), count: readCount(row, 'count', 'document category row') };
    }),
    needsFollowUp: readArray(rec, 'needsFollowUp', 'follow-ups').map((item) => {
      const row = asObject(item, 'follow-up client row');
      return {
        clientCode: readString(row, 'clientCode', 'follow-up client row'),
        clientName: readString(row, 'clientName', 'follow-up client row'),
        overdueAssignments: readCount(row, 'overdueAssignments', 'follow-up client row'),
        overdueFeesPaise: readPaise(row, 'overdueFeesPaise', 'follow-up client row'),
        lastMessageAt: readNullableTimestamp(row, 'lastMessageAt', 'follow-up client row'),
      };
    }),
  };
}

export function parsePracticeReportDto(raw: unknown): PracticeReportDto {
  const rec = asObject(raw, 'report');
  return {
    period: parsePeriod(field(rec, 'period', 'report')),
    workProgress: parseWorkProgress(field(rec, 'workProgress', 'report')),
    teamActivity: readArray(rec, 'teamActivity', 'report').map(parseTeamActivity),
    fees: parseFees(field(rec, 'fees', 'report')),
    followUps: parseFollowUps(field(rec, 'followUps', 'report')),
  };
}

export class HttpReportsAdapter implements ReportsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;
  private readonly authSource?: AuthSessionSource;

  constructor(options: HttpReportsAdapterOptions = {}) {
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

  private mapStatusToErrorCode(status: number): ReportsErrorCode {
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

  private abortedError(options?: PortExecutionOptions, cause?: unknown): ReportsOperationError {
    return new ReportsOperationError({
      code: 'aborted',
      message: 'The reports operation was aborted.',
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
        throw new ReportsOperationError({
          code: 'unauthorized',
          message: 'Session expired or unauthenticated. Please sign in again to see reports.',
          requestId: options?.requestId,
        });
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local deterministic / demo preview path: x-demo-user-id based on explicit role.
      const actorId = getDemoActorId(role);
      if (!actorId) {
        throw new ReportsOperationError({
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
      if (err instanceof ReportsOperationError) {
        throw err;
      }
      if ((err instanceof Error && err.name === 'AbortError') || options?.signal?.aborted) {
        throw this.abortedError(options, err);
      }
      throw new ReportsOperationError({
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

      throw new ReportsOperationError({
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
      throw new ReportsOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'Failed to parse JSON response from CRM API.',
        requestId: responseRequestId,
        cause: err,
      });
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ReportsOperationError({
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
      throw new ReportsOperationError({
        code: 'unexpected',
        status: response.status,
        message: 'API envelope missing required "data" property.',
        requestId: finalRequestId,
      });
    }

    return { data: envelope['data'], requestId: finalRequestId };
  }

  async getReport(role: CompanyRole, query: ReportQuery, options?: PortExecutionOptions): Promise<PracticeReportDto> {
    try {
      const search = `?period=${encodeURIComponent(query.period)}&date=${encodeURIComponent(query.date)}`;
      const result = await this.execute(role, `/api/v1/reports${search}`, options);
      return parsePracticeReportDto(result.data);
    } catch (err: unknown) {
      throw sanitizeReportsError(err);
    }
  }
}
