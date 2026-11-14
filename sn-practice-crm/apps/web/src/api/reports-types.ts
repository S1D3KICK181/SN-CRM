import type { CompanyRole } from '@sn/domain';
import type { PracticeReportDto, ReportPeriodKind } from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type ReportsErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface ReportsOperationErrorOptions {
  code: ReportsErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class ReportsOperationError extends Error {
  readonly code: ReportsErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: ReportsOperationErrorOptions) {
    super(options.message);
    this.name = 'ReportsOperationError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
    this.serverCode = options.serverCode;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Whitelisted, user-safe error copy for the reports seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_REPORTS_ERROR_MESSAGES: Readonly<Record<ReportsErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to see reports.',
  forbidden: "You don't have permission to see reports.",
  not_found: 'The report could not be found.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The report request was cancelled.',
  unexpected: 'Something went wrong with the report. Please try again.',
};

export const GENERIC_SAFE_REPORTS_ERROR = SAFE_REPORTS_ERROR_MESSAGES.unexpected;

/** Sanitizes any error caught during a report request. Discards causes and unverified server text. */
export function sanitizeReportsError(err: unknown): ReportsOperationError {
  if (err instanceof ReportsOperationError) {
    return new ReportsOperationError({
      code: err.code,
      message: SAFE_REPORTS_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_REPORTS_ERROR,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new ReportsOperationError({ code: 'unexpected', message: GENERIC_SAFE_REPORTS_ERROR });
}

export interface ReportQuery {
  readonly period: ReportPeriodKind;
  /** A calendar date (YYYY-MM-DD, Asia/Kolkata) inside the period. */
  readonly date: string;
}

export interface ReportsPort {
  /** Reads one report for a day, week or month; the API limits it to what the reader may see. */
  getReport(role: CompanyRole, query: ReportQuery, options?: PortExecutionOptions): Promise<PracticeReportDto>;
}
