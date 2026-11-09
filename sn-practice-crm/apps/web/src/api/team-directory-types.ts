import type { CompanyRole } from '@sn/domain';
import type { ReportingLineDto } from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type TeamDirectoryErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface TeamDirectoryOperationErrorOptions {
  code: TeamDirectoryErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class TeamDirectoryOperationError extends Error {
  readonly code: TeamDirectoryErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: TeamDirectoryOperationErrorOptions) {
    super(options.message);
    this.name = 'TeamDirectoryOperationError';
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
 * Whitelisted, user-safe error copy for the team directory seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_TEAM_DIRECTORY_ERROR_MESSAGES: Readonly<Record<TeamDirectoryErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to view the practice team.',
  forbidden: 'You do not have permission to view the team directory.',
  not_found: 'The team directory service could not be located.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The team directory request was cancelled.',
  unexpected: 'An unexpected error occurred while loading the team directory. Please try again.',
};

export const GENERIC_SAFE_TEAM_DIRECTORY_ERROR =
  'An unexpected error occurred while loading the team directory. Please try again.';

/**
 * Sanitizes any error caught during team directory operations.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * and discards causes that might hold unverified server text.
 */
export function sanitizeTeamDirectoryError(err: unknown): TeamDirectoryOperationError {
  if (err instanceof TeamDirectoryOperationError) {
    const safeMessage =
      SAFE_TEAM_DIRECTORY_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_TEAM_DIRECTORY_ERROR;
    return new TeamDirectoryOperationError({
      code: err.code,
      message: safeMessage,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new TeamDirectoryOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_TEAM_DIRECTORY_ERROR,
  });
}

/**
 * Stateless TeamDirectoryPort interface for listing practice reporting lines.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 */
export interface TeamDirectoryPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<ReportingLineDto[]>;
}

export interface TeamDirectoryState {
  readonly items: ReportingLineDto[];
  readonly loading: boolean;
  readonly error: TeamDirectoryOperationError | null;
  readonly role: CompanyRole;
  readonly hasLiveSnapshot: boolean;
}
