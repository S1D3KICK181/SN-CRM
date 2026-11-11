import type { CompanyRole } from '@sn/domain';
import type {
  EngagementDto,
  EngagementVersionDto,
  CreateEngagementDraftInput,
  ReviseEngagementDraftInput,
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  EndEngagementInput,
} from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type EngagementErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface EngagementOperationErrorOptions {
  code: EngagementErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class EngagementOperationError extends Error {
  readonly code: EngagementErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: EngagementOperationErrorOptions) {
    super(options.message);
    this.name = 'EngagementOperationError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
    this.serverCode = options.serverCode;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * Whitelisted, user-safe error copy for the engagements seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_ENGAGEMENT_ERROR_MESSAGES: Readonly<Record<EngagementErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to manage engagements.',
  forbidden: 'You do not have permission to perform this engagement operation.',
  not_found: 'The requested engagement could not be found.',
  conflict: 'The engagement was modified concurrently. Please refresh and try again.',
  validation: 'The submitted engagement details could not be validated. Please check the entered fields.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The engagement operation was cancelled.',
  unexpected: 'An unexpected error occurred while processing the engagement. Please try again.',
};

export const GENERIC_SAFE_ENGAGEMENT_ERROR =
  'An unexpected error occurred while processing the engagement. Please try again.';

/**
 * Sanitizes any error caught during engagement operations.
 * Preserves safe operational metadata (code, status, sanitized serverCode, sanitized requestId)
 * and discards causes that might hold unverified server text.
 */
export function sanitizeEngagementError(err: unknown): EngagementOperationError {
  if (err instanceof EngagementOperationError) {
    const safeMessage =
      SAFE_ENGAGEMENT_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_ENGAGEMENT_ERROR;
    return new EngagementOperationError({
      code: err.code,
      message: safeMessage,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
      // Intentionally omit cause to prevent leaking unverified server text
    });
  }

  return new EngagementOperationError({
    code: 'unexpected',
    message: GENERIC_SAFE_ENGAGEMENT_ERROR,
  });
}

// ---------------------------------------------------------------------------
// Idempotency key type and validation
// ---------------------------------------------------------------------------

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/**
 * Validates that an idempotency key is a non-blank string of at most 255 characters.
 * Returns the trimmed key on success, or null on failure.
 */
export function validateIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Role capabilities
// ---------------------------------------------------------------------------

export type EngagementCapability =
  | 'read'
  | 'createDraft'
  | 'reviseDraft'
  | 'activate'
  | 'amend'
  | 'end';

/**
 * Pure, stateless capability helper.
 * Returns the set of Engagement operations permitted for a given role.
 * The server remains authoritative; this is for consistent UI presentation only.
 *
 * founder: read, createDraft, reviseDraft, activate, amend, end
 * manager: read, createDraft, reviseDraft only
 * senior_staff / staff / trainee: no access
 */
export function getEngagementCapabilities(role: CompanyRole): ReadonlySet<EngagementCapability> {
  switch (role) {
    case 'founder':
      return new Set<EngagementCapability>([
        'read',
        'createDraft',
        'reviseDraft',
        'activate',
        'amend',
        'end',
      ]);
    case 'manager':
      return new Set<EngagementCapability>(['read', 'createDraft', 'reviseDraft']);
    default:
      return new Set<EngagementCapability>();
  }
}

export function hasEngagementCapability(
  role: CompanyRole,
  capability: EngagementCapability,
): boolean {
  return getEngagementCapabilities(role).has(capability);
}

// ---------------------------------------------------------------------------
// Mutation input types with idempotency key
// ---------------------------------------------------------------------------

export interface EngagementMutationOptions {
  readonly idempotencyKey?: string;
}

export interface EngagementMutationResult {
  readonly success: boolean;
  readonly item?: EngagementDto;
  readonly error?: EngagementOperationError;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * Stateless EngagementsPort interface.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 * Every mutation requires a non-blank Idempotency-Key of at most 255 characters.
 */
export interface EngagementsPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<EngagementDto[]>;
  get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<EngagementDto>;
  listVersions(
    role: CompanyRole,
    engagementId: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementVersionDto[]>;
  createDraft(
    role: CompanyRole,
    input: CreateEngagementDraftInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto>;
  reviseDraft(
    role: CompanyRole,
    engagementId: string,
    input: ReviseEngagementDraftInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto>;
  activate(
    role: CompanyRole,
    engagementId: string,
    input: ActivateEngagementInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto>;
  amend(
    role: CompanyRole,
    engagementId: string,
    input: AmendActiveEngagementInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto>;
  end(
    role: CompanyRole,
    engagementId: string,
    input: EndEngagementInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto>;
}

// ---------------------------------------------------------------------------
// Coordinator state
// ---------------------------------------------------------------------------

export interface EngagementsState {
  readonly role: CompanyRole;
  readonly items: EngagementDto[];
  readonly loading: boolean;
  readonly hasLiveSnapshot: boolean;
  readonly listError: EngagementOperationError | null;
  readonly selectedEngagementId: string | null;
  readonly selectedDetail: EngagementDto | null;
  readonly selectedVersions: EngagementVersionDto[];
  readonly detailLoading: boolean;
  readonly detailError: EngagementOperationError | null;
}
