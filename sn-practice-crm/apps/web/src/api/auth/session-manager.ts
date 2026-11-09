import type { SessionActor } from '@sn/contracts';
import type { SessionClient } from './session-client';
import {
  ApiClientError,
  type AuthChangeEvent,
  type AuthSession,
  type AuthSessionSource,
  type SessionState,
} from './types';

export class SessionManager {
  private state: SessionState = {
    status: 'initializing',
    actor: null,
    authUserId: null,
    error: null,
    refreshWarning: null,
    isRefreshing: false,
  };

  private generationId = 0;
  private started = false;
  private disposed = false;
  private inFlightFetch: Promise<SessionActor> | null = null;
  private inFlightAbortController: AbortController | null = null;
  private activeRetryUser: string | null = null;
  private unsubscribeAuth?: () => void;
  private readonly listeners = new Set<(state: SessionState) => void>();

  constructor(
    private readonly authSource: AuthSessionSource,
    private readonly client: SessionClient,
  ) {}

  public getState(): SessionState {
    return this.state;
  }

  public async getAccessToken(): Promise<string | null> {
    if (this.disposed) return null;
    const currentAuthUserId = this.state.authUserId;
    if (!currentAuthUserId || (this.state.status !== 'authenticated' && this.state.status !== 'refreshing')) {
      return null;
    }

    try {
      const session = await this.authSource.getSession();
      if (!session || typeof session.accessToken !== 'string') {
        return null;
      }
      if (session.userId !== currentAuthUserId) {
        return null;
      }
      const token = session.accessToken.trim();
      return token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }

  public start(): void {
    if (this.disposed || this.started) return;
    this.started = true;

    const gen = ++this.generationId;

    this.unsubscribeAuth?.();
    this.unsubscribeAuth = this.authSource.onAuthStateChange((event, session) => {
      const capturedGen = this.generationId;
      queueMicrotask(() => {
        if (!this.started || this.disposed || this.generationId !== capturedGen) return;
        this.handleAuthEvent(event, session);
      });
    });

    this.state = {
      ...this.state,
      status: 'initializing',
      error: null,
      refreshWarning: null,
    };
    this.notify();

    void (async () => {
      try {
        const session = await this.authSource.getSession();
        if (!this.started || this.disposed || gen !== this.generationId) return;

        if (!session) {
          this.state = {
            status: 'unauthenticated',
            actor: null,
            authUserId: null,
            error: null,
            refreshWarning: null,
            isRefreshing: false,
          };
          this.notify();
          return;
        }

        this.state = {
          ...this.state,
          authUserId: session.userId,
        };
        await this.resolveActorForSession(session, gen, false);
      } catch (err) {
        if (!this.started || this.disposed || gen !== this.generationId) return;
        this.state = {
          status: 'error',
          actor: null,
          authUserId: null,
          error: this.toApiClientError(err),
          refreshWarning: null,
          isRefreshing: false,
        };
        this.notify();
      }
    })();
  }

  public stop(): void {
    if (this.disposed || !this.started) return;
    this.started = false;

    // Increment generation to invalidate all pending queued microtasks and async fetches
    ++this.generationId;

    this.unsubscribeAuth?.();
    this.unsubscribeAuth = undefined;

    this.inFlightAbortController?.abort();
    this.inFlightAbortController = null;
    this.inFlightFetch = null;
    this.activeRetryUser = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    ++this.generationId;
    this.listeners.clear();
  }

  public subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async retry(): Promise<void> {
    if (this.disposed) return;
    if (!this.started) {
      this.start();
      return;
    }

    const gen = ++this.generationId;
    this.inFlightAbortController?.abort();
    this.inFlightAbortController = null;
    this.inFlightFetch = null;

    this.state = {
      ...this.state,
      status: 'initializing',
      error: null,
      refreshWarning: null,
    };
    this.notify();

    try {
      const session = await this.authSource.getSession();
      if (!this.started || this.disposed || gen !== this.generationId) return;

      if (!session) {
        this.state = {
          status: 'unauthenticated',
          actor: null,
          authUserId: null,
          error: null,
          refreshWarning: null,
          isRefreshing: false,
        };
        this.notify();
        return;
      }

      this.state = {
        ...this.state,
        authUserId: session.userId,
      };
      await this.resolveActorForSession(session, gen, false);
    } catch (err) {
      if (!this.started || this.disposed || gen !== this.generationId) return;
      this.state = {
        status: 'error',
        actor: null,
        authUserId: null,
        error: this.toApiClientError(err),
        refreshWarning: null,
        isRefreshing: false,
      };
      this.notify();
    }
  }

  public async signInWithPassword(credentials: { email: string; password: string }): Promise<AuthSession> {
    return await this.authSource.signInWithPassword(credentials);
  }

  public async signOut(options?: { scope?: 'local' | 'global' }): Promise<void> {
    // Synchronously clear state and cancel in-flight work before awaiting authSource
    ++this.generationId;
    this.inFlightAbortController?.abort();
    this.inFlightAbortController = null;
    this.inFlightFetch = null;
    this.activeRetryUser = null;

    this.state = {
      status: 'unauthenticated',
      actor: null,
      authUserId: null,
      error: null,
      refreshWarning: null,
      isRefreshing: false,
    };
    this.notify();

    await this.authSource.signOut(options);
  }

  private handleAuthEvent(event: AuthChangeEvent, session: AuthSession | null): void {
    if (!this.started || this.disposed) return;

    if (event === 'SIGNED_OUT' || !session) {
      ++this.generationId;
      this.inFlightAbortController?.abort();
      this.inFlightAbortController = null;
      this.inFlightFetch = null;
      this.activeRetryUser = null;

      this.state = {
        status: 'unauthenticated',
        actor: null,
        authUserId: null,
        error: null,
        refreshWarning: null,
        isRefreshing: false,
      };
      this.notify();
      return;
    }

    const isInitialAuth = this.state.authUserId === null;
    const isAccountSwitch = !isInitialAuth && this.state.authUserId !== session.userId;

    // Branch 1 & Branch 2: Primary Acquisition & Different-User Switch
    if (isInitialAuth || isAccountSwitch) {
      const gen = ++this.generationId;
      this.inFlightAbortController?.abort();
      this.inFlightAbortController = null;
      this.inFlightFetch = null;
      this.activeRetryUser = null;

      // Synchronously clear actor before any request uses the new token
      this.state = {
        status: 'initializing',
        actor: null,
        authUserId: session.userId,
        error: null,
        refreshWarning: null,
        isRefreshing: false,
      };
      this.notify();

      void this.resolveActorForSession(session, gen, false);
      return;
    }

    // Branch 3: Same-User Events
    // Reentrancy guard: active 401 retry ignores TOKEN_REFRESHED
    if (this.activeRetryUser === session.userId && event === 'TOKEN_REFRESHED') {
      return;
    }

    // Coalesce if a fetch is already in flight for this user
    if (this.inFlightFetch !== null) {
      return;
    }

    // Trigger background refresh (retaining existing actor and UI)
    const gen = this.generationId;
    this.state = {
      ...this.state,
      isRefreshing: true,
      refreshWarning: null,
    };
    this.notify();

    void this.resolveActorForSession(session, gen, true);
  }

  private async resolveActorForSession(
    session: AuthSession,
    gen: number,
    isBackground: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    this.inFlightAbortController = controller;

    const fetchPromise = (async (): Promise<SessionActor> => {
      try {
        return await this.client.getSession(session.accessToken, controller.signal);
      } catch (err) {
        if (err instanceof ApiClientError && (err.status === 401 || err.code === 'invalid_token')) {
          if (!this.activeRetryUser) {
            this.activeRetryUser = session.userId;
            try {
              const refreshed = await this.authSource.refreshSession();
              if (refreshed && refreshed.userId === session.userId) {
                return await this.client.getSession(refreshed.accessToken, controller.signal);
              }
            } catch {
              // Refresh failed
            } finally {
              this.activeRetryUser = null;
            }
          }
          await this.authSource.signOut({ scope: 'local' });
          throw new ApiClientError({
            code: 'unauthenticated',
            status: 401,
            message: 'Session token expired and refresh was rejected.',
          });
        }
        throw err;
      }
    })();

    this.inFlightFetch = fetchPromise;

    try {
      const actor = await fetchPromise;
      if (!this.started || this.disposed || gen !== this.generationId) return;

      // Exact Identity Invariant Verification: enforce actor.id === session.userId
      if (actor.id !== session.userId) {
        this.state = {
          status: 'error',
          actor: null,
          authUserId: session.userId,
          error: new ApiClientError({
            code: 'identity_mismatch',
            status: 502,
            message: `Security invariant violation: SessionActor id (${actor.id}) does not match authenticated user ID (${session.userId}).`,
          }),
          refreshWarning: null,
          isRefreshing: false,
        };
        this.notify();
        return;
      }

      this.state = {
        status: 'authenticated',
        actor,
        authUserId: session.userId,
        error: null,
        refreshWarning: null,
        isRefreshing: false,
      };
      this.notify();
    } catch (err: unknown) {
      if (!this.started || this.disposed || gen !== this.generationId) return;
      if (err instanceof Error && err.name === 'AbortError') return;

      const clientErr = this.toApiClientError(err);

      if (clientErr.status === 403 || clientErr.code === 'forbidden') {
        this.state = {
          status: 'forbidden',
          actor: null,
          authUserId: session.userId,
          error: clientErr,
          refreshWarning: null,
          isRefreshing: false,
        };
        this.notify();
        return;
      }

      if (clientErr.status === 401 || clientErr.code === 'unauthenticated' || clientErr.code === 'invalid_token') {
        this.state = {
          status: 'unauthenticated',
          actor: null,
          authUserId: null,
          error: clientErr,
          refreshWarning: null,
          isRefreshing: false,
        };
        this.notify();
        return;
      }

      // Distinguish initial bootstrap failure vs background revalidation failure
      if (isBackground && this.state.actor !== null) {
        this.state = {
          ...this.state,
          isRefreshing: false,
          refreshWarning: clientErr.message || 'Background session sync failed',
        };
        this.notify();
      } else {
        this.state = {
          status: 'error',
          actor: null,
          authUserId: session.userId,
          error: clientErr,
          refreshWarning: null,
          isRefreshing: false,
        };
        this.notify();
      }
    } finally {
      if (this.generationId === gen) {
        this.inFlightFetch = null;
        this.inFlightAbortController = null;
      }
    }
  }

  private notify(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private toApiClientError(err: unknown): ApiClientError {
    if (err instanceof ApiClientError) return err;
    return new ApiClientError({
      code: 'network_error',
      status: 0,
      message: err instanceof Error ? err.message : 'Network error communicating with CRM API',
      cause: err,
    });
  }
}
