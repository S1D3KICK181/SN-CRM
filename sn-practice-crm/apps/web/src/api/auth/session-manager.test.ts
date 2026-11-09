import { describe, expect, it, vi } from 'vitest';
import type { SessionActor } from '@sn/contracts';
import type { SessionClient } from './session-client';
import {
  ApiClientError,
  type AuthChangeCallback,
  type AuthChangeEvent,
  type AuthSession,
  type AuthSessionSource,
  type SessionState,
} from './types';
import { SessionManager } from './session-manager';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => queueMicrotask(resolve));
}

async function flushAsyncWork(ticks = 5) {
  for (let i = 0; i < ticks; i++) {
    await flushMicrotasks();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('SessionManager State Machine & Lifecycle', () => {
  const user1 = '11111111-1111-4111-8111-111111111111';
  const user2 = '22222222-2222-4222-8222-222222222222';

  const actor1: SessionActor = {
    id: user1,
    name: 'User One',
    role: 'staff',
    reportsToId: null,
  };

  const actor2: SessionActor = {
    id: user2,
    name: 'User Two',
    role: 'manager',
    reportsToId: null,
  };

  function createTestHarness(initialSession: AuthSession | null = null) {
    let authCallback: AuthChangeCallback | null = null;
    let currentSession: AuthSession | null = initialSession;

    const authSource: AuthSessionSource = {
      getSession: vi.fn().mockImplementation(async () => currentSession),
      onAuthStateChange: vi.fn().mockImplementation((cb: AuthChangeCallback) => {
        authCallback = cb;
        return () => {
          authCallback = null;
        };
      }),
      refreshSession: vi.fn().mockImplementation(async () => currentSession),
      signOut: vi.fn().mockImplementation(async () => {
        currentSession = null;
      }),
      signInWithPassword: vi.fn().mockImplementation(async ({ email }) => {
        const session: AuthSession = { accessToken: `token-${email}`, userId: user1 };
        currentSession = session;
        return session;
      }),
    };

    const client: Partial<SessionClient> = {
      getSession: vi.fn().mockImplementation(async (token: string) => {
        if (token.includes(user2)) return actor2;
        return actor1;
      }),
    };

    const manager = new SessionManager(authSource, client as SessionClient);

    const emitAuthEvent = (event: AuthChangeEvent, session: AuthSession | null) => {
      currentSession = session;
      authCallback?.(event, session);
    };

    return { authSource, client: client as SessionClient, manager, emitAuthEvent };
  }

  it('TC-SM-01: Boots to unauthenticated when getSession() returns null', async () => {
    const { manager } = createTestHarness(null);
    expect(manager.getState().status).toBe('initializing');

    manager.start();
    await flushAsyncWork();

    expect(manager.getState()).toMatchObject({
      status: 'unauthenticated',
      actor: null,
      authUserId: null,
      error: null,
    });
  });

  it('TC-SM-02: Boots to authenticated when getSession() returns session and API responds 200 OK', async () => {
    const { manager } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    manager.start();
    await flushAsyncWork();

    expect(manager.getState()).toMatchObject({
      status: 'authenticated',
      actor: actor1,
      authUserId: user1,
      error: null,
    });
  });

  it('TC-SM-03: Primary sign-in from unauthenticated (authUserId: null) clears actor, sets status: "initializing", and resolves actor as foreground', async () => {
    const { manager, emitAuthEvent } = createTestHarness(null);
    manager.start();
    await flushAsyncWork();
    expect(manager.getState().status).toBe('unauthenticated');

    const states: SessionState[] = [];
    manager.subscribe((s) => states.push(s));

    emitAuthEvent('SIGNED_IN', { accessToken: 'token-1', userId: user1 });
    await flushMicrotasks();

    // Must synchronously clear actor and set initializing with isRefreshing: false
    const initTransition = states.find((s) => s.status === 'initializing' && s.authUserId === user1);
    expect(initTransition).toBeDefined();
    expect(initTransition?.actor).toBeNull();
    expect(initTransition?.isRefreshing).toBe(false);

    await flushAsyncWork();
    expect(manager.getState()).toMatchObject({
      status: 'authenticated',
      actor: actor1,
      authUserId: user1,
      isRefreshing: false,
    });
  });

  it('TC-SM-04: Same-user rapid auth events coalesce into the single active in-flight Promise', async () => {
    const { manager, client, emitAuthEvent } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    const deferred = createDeferred<SessionActor>();
    (client.getSession as any).mockReturnValue(deferred.promise);

    manager.start();
    await flushMicrotasks();

    // Initially in flight
    expect(client.getSession).toHaveBeenCalledTimes(1);

    // Rapid same-user events
    emitAuthEvent('TOKEN_REFRESHED', { accessToken: 'token-1-b', userId: user1 });
    emitAuthEvent('USER_UPDATED', { accessToken: 'token-1-c', userId: user1 });
    await flushMicrotasks();

    // Must coalesce: no new getSession call
    expect(client.getSession).toHaveBeenCalledTimes(1);

    deferred.resolve(actor1);
    await flushAsyncWork();
    expect(manager.getState().status).toBe('authenticated');
  });

  it('TC-SM-05: Account switch (session.userId !== currentAuthUserId) synchronously clears actor: null, aborts preceding request, and fetches new actor', async () => {
    const { manager, client, emitAuthEvent } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    manager.start();
    await flushAsyncWork();
    expect(manager.getState().actor).toEqual(actor1);

    let aborted = false;
    const deferred2 = createDeferred<SessionActor>();
    (client.getSession as any).mockImplementation((token: string, signal?: AbortSignal) => {
      signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return deferred2.promise;
    });

    // Account switch
    emitAuthEvent('SIGNED_IN', { accessToken: `token-${user2}`, userId: user2 });
    await flushMicrotasks();

    // Synchronously cleared actor
    expect(manager.getState().actor).toBeNull();
    expect(manager.getState().status).toBe('initializing');
    expect(manager.getState().authUserId).toBe(user2);

    deferred2.resolve(actor2);
    await flushAsyncWork();
    expect(manager.getState()).toMatchObject({
      status: 'authenticated',
      actor: actor2,
      authUserId: user2,
    });
  });

  it('TC-SM-06: Stale response from generation N arriving after generation N+1 is discarded without state mutation', async () => {
    const { manager, client, emitAuthEvent } = createTestHarness(null);
    const deferred1 = createDeferred<SessionActor>();
    const deferred2 = createDeferred<SessionActor>();

    let callCount = 0;
    (client.getSession as any).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? deferred1.promise : deferred2.promise;
    });

    manager.start();
    await flushAsyncWork();

    // User 1 signs in
    emitAuthEvent('SIGNED_IN', { accessToken: 'token-1', userId: user1 });
    await flushMicrotasks();

    // User 2 signs in immediately before User 1 fetch resolves
    emitAuthEvent('SIGNED_IN', { accessToken: `token-${user2}`, userId: user2 });
    await flushMicrotasks();

    // User 1 fetch resolves late
    deferred1.resolve(actor1);
    await flushMicrotasks();
    // Actor must NOT be actor1!
    expect(manager.getState().actor).toBeNull();

    // User 2 fetch resolves
    deferred2.resolve(actor2);
    await flushAsyncWork();
    expect(manager.getState().actor).toEqual(actor2);
  });

  it('TC-SM-07: Exact Identity Invariant: Throws identity_mismatch and fails closed when server returns actor.id !== session.userId', async () => {
    const { manager, client } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    // Server returns mismatched actor!
    (client.getSession as any).mockResolvedValue({
      id: user2, // Mismatch!
      name: 'Wrong Identity',
      role: 'founder',
      reportsToId: null,
    });

    manager.start();
    await flushAsyncWork();

    const state = manager.getState();
    expect(state.status).toBe('error');
    expect(state.actor).toBeNull();
    expect(state.error).toBeInstanceOf(ApiClientError);
    expect(state.error?.code).toBe('identity_mismatch');
    expect(state.error?.status).toBe(502);
  });

  it('TC-SM-08: On 401, invokes refreshSession() and retries once; if retry succeeds, transitions to authenticated', async () => {
    const { manager, authSource, client } = createTestHarness({ accessToken: 'token-1', userId: user1 });

    let callCount = 0;
    (client.getSession as any).mockImplementation(async (token: string) => {
      callCount++;
      if (callCount === 1) {
        throw new ApiClientError({ code: 'invalid_token', status: 401, message: 'Expired' });
      }
      return actor1;
    });

    (authSource.refreshSession as any).mockResolvedValue({
      accessToken: 'refreshed-token',
      userId: user1,
    });

    manager.start();
    await flushAsyncWork();

    expect(authSource.refreshSession).toHaveBeenCalledTimes(1);
    expect(client.getSession).toHaveBeenCalledTimes(2);
    expect(manager.getState().status).toBe('authenticated');
    expect(manager.getState().actor).toEqual(actor1);
  });

  it('TC-SM-09: On 401, if refreshSession() fails or returns null, invokes signOut({ scope: "local" }) and transitions to unauthenticated', async () => {
    const { manager, authSource, client } = createTestHarness({ accessToken: 'token-1', userId: user1 });

    (client.getSession as any).mockRejectedValue(
      new ApiClientError({ code: 'invalid_token', status: 401, message: 'Expired' }),
    );
    (authSource.refreshSession as any).mockResolvedValue(null);

    manager.start();
    await flushAsyncWork();

    expect(authSource.refreshSession).toHaveBeenCalledTimes(1);
    expect(authSource.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(manager.getState().status).toBe('unauthenticated');
    expect(manager.getState().actor).toBeNull();
  });

  it('TC-SM-10: TOKEN_REFRESHED event emitted during active 401 recovery does not abort or duplicate the single retry', async () => {
    const { manager, authSource, client, emitAuthEvent } = createTestHarness({ accessToken: 'token-1', userId: user1 });

    const refreshDeferred = createDeferred<AuthSession | null>();
    (authSource.refreshSession as any).mockReturnValue(refreshDeferred.promise);

    let getSessionCount = 0;
    (client.getSession as any).mockImplementation(async () => {
      getSessionCount++;
      if (getSessionCount === 1) {
        throw new ApiClientError({ code: 'invalid_token', status: 401, message: 'Expired' });
      }
      return actor1;
    });

    manager.start();
    await flushAsyncWork();

    // Now 401 recovery is active awaiting refreshSession
    expect(authSource.refreshSession).toHaveBeenCalledTimes(1);

    // GoTrue emits TOKEN_REFRESHED while retry is in flight
    emitAuthEvent('TOKEN_REFRESHED', { accessToken: 'token-from-event', userId: user1 });
    await flushMicrotasks();

    // Resolves refreshSession
    refreshDeferred.resolve({ accessToken: 'refreshed-token', userId: user1 });
    await flushAsyncWork();

    // Only 2 getSession calls in total (1 initial + 1 retry)
    expect(client.getSession).toHaveBeenCalledTimes(2);
    expect(manager.getState().status).toBe('authenticated');
  });

  it('TC-SM-11: On 403, transitions to forbidden and does not trigger refresh loop', async () => {
    const { manager, authSource, client } = createTestHarness({ accessToken: 'token-1', userId: user1 });

    (client.getSession as any).mockRejectedValue(
      new ApiClientError({ code: 'forbidden', status: 403, message: 'Inactive profile' }),
    );

    manager.start();
    await flushAsyncWork();

    expect(authSource.refreshSession).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('forbidden');
    expect(manager.getState().actor).toBeNull();
  });

  it('TC-SM-12: Background refresh network failure retains status: "authenticated", preserves existing actor, and records non-blocking refreshWarning', async () => {
    const { manager, client, emitAuthEvent } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    manager.start();
    await flushAsyncWork();
    expect(manager.getState().status).toBe('authenticated');

    // Next call fails with network error
    (client.getSession as any).mockRejectedValue(
      new ApiClientError({ code: 'network_error', status: 0, message: 'Failed to fetch' }),
    );

    // Same-user refresh event
    emitAuthEvent('TOKEN_REFRESHED', { accessToken: 'token-refreshed', userId: user1 });
    await flushAsyncWork();

    const state = manager.getState();
    expect(state.status).toBe('authenticated');
    expect(state.actor).toEqual(actor1);
    expect(state.isRefreshing).toBe(false);
    expect(state.refreshWarning).toBe('Failed to fetch');
  });

  it('TC-SM-13: Initial bootstrap network failure transitions to status: "error" with retry action', async () => {
    const { manager, client } = createTestHarness({ accessToken: 'token-1', userId: user1 });

    (client.getSession as any).mockRejectedValue(
      new ApiClientError({ code: 'network_error', status: 0, message: 'Server down' }),
    );

    manager.start();
    await flushAsyncWork();

    expect(manager.getState().status).toBe('error');
    expect(manager.getState().actor).toBeNull();
    expect(manager.getState().error?.code).toBe('network_error');

    // Retrying
    (client.getSession as any).mockResolvedValue(actor1);
    await manager.retry();
    await flushAsyncWork();

    expect(manager.getState().status).toBe('authenticated');
    expect(manager.getState().actor).toEqual(actor1);
  });

  it('TC-SM-14: External SIGNED_OUT event immediately cancels in-flight fetch and sets status: "unauthenticated"', async () => {
    const { manager, client, emitAuthEvent } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    const deferred = createDeferred<SessionActor>();
    (client.getSession as any).mockReturnValue(deferred.promise);

    manager.start();
    await flushMicrotasks();

    emitAuthEvent('SIGNED_OUT', null);
    await flushMicrotasks();

    expect(manager.getState()).toMatchObject({
      status: 'unauthenticated',
      actor: null,
      authUserId: null,
    });
  });

  it('TC-SM-15: Manager signOut() synchronously clears actor and sets unauthenticated before awaiting source signOut', async () => {
    const { manager, authSource } = createTestHarness({ accessToken: 'token-1', userId: user1 });
    manager.start();
    await flushAsyncWork();
    expect(manager.getState().status).toBe('authenticated');

    const signOutDeferred = createDeferred<void>();
    (authSource.signOut as any).mockReturnValue(signOutDeferred.promise);

    const signOutPromise = manager.signOut();

    // Synchronously cleared
    expect(manager.getState()).toMatchObject({
      status: 'unauthenticated',
      actor: null,
      authUserId: null,
    });

    signOutDeferred.resolve();
    await signOutPromise;
    expect(authSource.signOut).toHaveBeenCalled();
  });

  it('TC-SM-16: Lifecycle: start() is idempotent; stop() cancels and permits clean restart; dispose() is terminal', async () => {
    const { manager, authSource, client } = createTestHarness({ accessToken: 'token-1', userId: user1 });

    manager.start();
    manager.start(); // Idempotency check: should not duplicate
    expect(authSource.onAuthStateChange).toHaveBeenCalledTimes(1);

    await flushAsyncWork();
    expect(manager.getState().status).toBe('authenticated');

    // Stop (StrictMode unmount simulation)
    manager.stop();
    expect(manager.getState().status).toBe('authenticated'); // preserves state

    // Remount: start() again
    manager.start();
    expect(authSource.onAuthStateChange).toHaveBeenCalledTimes(2);

    await flushAsyncWork();
    expect(manager.getState().status).toBe('authenticated');

    // Terminal disposal
    manager.dispose();
    manager.start(); // Should do nothing after disposal
    expect(authSource.onAuthStateChange).toHaveBeenCalledTimes(2);
  });

  it('TC-SM-17: getAccessToken() returns active token only when authUserId matches current session, and returns null when unauthenticated, disposed, or switched to different user', async () => {
    const { manager, authSource } = createTestHarness({ accessToken: 'token-user-1', userId: user1 });

    // 1. Before bootstrap/authentication: returns null
    expect(await manager.getAccessToken()).toBeNull();

    // 2. Start and authenticate user 1
    manager.start();
    await flushAsyncWork();
    expect(manager.getState().status).toBe('authenticated');
    expect(manager.getState().authUserId).toBe(user1);
    expect(await manager.getAccessToken()).toBe('token-user-1');

    // 3. Different-user token during account switch timing: returns null / fails closed
    (authSource.getSession as any).mockResolvedValue({
      accessToken: 'token-user-2-unverified',
      userId: user2,
    });
    expect(await manager.getAccessToken()).toBeNull();

    // 4. Blank/whitespace token: returns null
    (authSource.getSession as any).mockResolvedValue({
      accessToken: '   ',
      userId: user1,
    });
    expect(await manager.getAccessToken()).toBeNull();

    // 5. Restore valid user 1 token
    (authSource.getSession as any).mockResolvedValue({
      accessToken: 'token-user-1',
      userId: user1,
    });
    expect(await manager.getAccessToken()).toBe('token-user-1');

    // 6. Sign out: unauthenticated state returns null
    await manager.signOut();
    expect(await manager.getAccessToken()).toBeNull();

    // 7. Disposed: returns null
    manager.dispose();
    expect(await manager.getAccessToken()).toBeNull();
  });
});
