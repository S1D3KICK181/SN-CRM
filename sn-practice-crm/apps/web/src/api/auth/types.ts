import type { ApiEnvelope, ApiErrorEnvelope, SessionActor } from '@sn/contracts';
import { COMPANY_ROLES, type CompanyRole } from '@sn/domain';

export { COMPANY_ROLES, type CompanyRole, type SessionActor, type ApiEnvelope, type ApiErrorEnvelope };

export interface AuthSession {
  readonly accessToken: string;
  readonly userId: string; // RFC 4122 UUID of GoTrue auth.users
}

export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED';

export type AuthChangeCallback = (event: AuthChangeEvent, session: AuthSession | null) => void;

export interface AuthSessionSource {
  getSession(): Promise<AuthSession | null>;
  onAuthStateChange(callback: AuthChangeCallback): () => void;
  refreshSession(): Promise<AuthSession | null>;
  signOut(options?: { scope?: 'local' | 'global' }): Promise<void>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<AuthSession>;
}

export type SessionStatus =
  | 'initializing'    // Bootstrapping session from GoTrue storage
  | 'unauthenticated' // No active session (render sign-in gate)
  | 'authenticated'   // Cryptographically validated SessionActor active
  | 'refreshing'      // Background re-validation while preserving UI stability
  | 'forbidden'       // Valid GoTrue user, but inactive or no role in CRM DB
  | 'error';          // Network or 5xx failure during initial bootstrap / invariant violation

export interface ApiClientErrorOptions {
  code: string;
  status: number;
  message: string;
  cause?: unknown;
  details?: unknown;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(options: ApiClientErrorOptions) {
    super(options.message);
    this.name = 'ApiClientError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface SessionState {
  readonly status: SessionStatus;
  readonly actor: SessionActor | null;
  readonly authUserId: string | null;
  readonly error: ApiClientError | null;
  readonly refreshWarning: string | null;
  readonly isRefreshing: boolean;
}

export interface SessionClientConfig {
  readonly baseUrl?: string;
  readonly fetchFn?: typeof fetch;
  readonly createRequestId?: () => string;
}
