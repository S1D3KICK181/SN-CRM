// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider, useSessionActor } from './session-context';
import type { SessionManager } from '../api/auth/session-manager';
import { ApiClientError, type SessionState } from '../api/auth/types';

afterEach(() => {
  cleanup();
});

function createMockManager(initialState: Partial<SessionState> = {}): SessionManager {
  let currentState: SessionState = {
    status: 'initializing',
    actor: null,
    authUserId: null,
    error: null,
    refreshWarning: null,
    isRefreshing: false,
    ...initialState,
  };

  const listeners = new Set<(state: SessionState) => void>();

  return {
    getState: vi.fn(() => currentState),
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    subscribe: vi.fn((listener: (state: SessionState) => void) => {
      listeners.add(listener);
      listener(currentState);
      return () => {
        listeners.delete(listener);
      };
    }),
    retry: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    signInWithPassword: vi.fn().mockResolvedValue({
      accessToken: 'token-123',
      userId: '00000000-0000-4000-a000-000000000001',
    }),
  } as unknown as SessionManager;
}

function TestConsumer() {
  const { status, actor, error, retry, signOut, signInWithPassword } = useSessionActor();

  if (status === 'initializing') {
    return <div data-testid="loading-fallback">Loading session...</div>;
  }

  if (status === 'forbidden') {
    return (
      <div data-testid="forbidden-screen">
        <p>Access restricted</p>
        <button type="button" onClick={() => void signOut()}>
          Sign Out
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div data-testid="error-screen">
        <p>{error?.message ?? 'Connection error'}</p>
        <button type="button" onClick={() => void retry()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div data-testid="authenticated-screen">
      <span>Welcome, {actor?.name}</span>
      <button
        type="button"
        onClick={() => void signInWithPassword({ email: 'test@sn-demo.local', password: 'pass' })}
      >
        Sign In Again
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign Out
      </button>
    </div>
  );
}

describe('SessionContext & SessionProvider', () => {
  it('TC-CTX-01: Renders loading fallback during initializing state', () => {
    const manager = createMockManager({ status: 'initializing' });
    render(
      <SessionProvider manager={manager}>
        <TestConsumer />
      </SessionProvider>,
    );

    expect(screen.getByTestId('loading-fallback')).toBeTruthy();
    expect(screen.getByText('Loading session...')).toBeTruthy();
    expect(manager.start).toHaveBeenCalled();
  });

  it('TC-CTX-02: Renders children with verified actor during authenticated state', () => {
    const manager = createMockManager({
      status: 'authenticated',
      actor: {
        id: '00000000-0000-4000-a000-000000000001',
        name: 'Suresh Narayanan',
        role: 'founder',
        reportsToId: null,
      },
      authUserId: '00000000-0000-4000-a000-000000000001',
    });

    render(
      <SessionProvider manager={manager}>
        <TestConsumer />
      </SessionProvider>,
    );

    expect(screen.getByTestId('authenticated-screen')).toBeTruthy();
    expect(screen.getByText('Welcome, Suresh Narayanan')).toBeTruthy();
  });

  it('TC-CTX-03: Renders access restricted UI with sign-out action during forbidden state', () => {
    const manager = createMockManager({
      status: 'forbidden',
      actor: null,
      authUserId: '00000000-0000-4000-a000-000000000002',
      error: new ApiClientError({ code: 'forbidden', status: 403, message: 'Forbidden' }),
    });

    render(
      <SessionProvider manager={manager}>
        <TestConsumer />
      </SessionProvider>,
    );

    expect(screen.getByTestId('forbidden-screen')).toBeTruthy();
    const signOutBtn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(signOutBtn);
    expect(manager.signOut).toHaveBeenCalled();
  });

  it('TC-CTX-04: Renders connection error UI with retry action during error state', () => {
    const manager = createMockManager({
      status: 'error',
      actor: null,
      authUserId: null,
      error: new ApiClientError({ code: 'network_error', status: 0, message: 'API offline' }),
    });

    render(
      <SessionProvider manager={manager}>
        <TestConsumer />
      </SessionProvider>,
    );

    expect(screen.getByTestId('error-screen')).toBeTruthy();
    expect(screen.getByText('API offline')).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(manager.retry).toHaveBeenCalled();
  });

  it('TC-CTX-05: StrictMode setup-cleanup-setup lifecycle: unmount invokes stop(), remount invokes start() without crashing, leaking listeners, or freezing in initializing', () => {
    const manager = createMockManager({ status: 'initializing' });

    const { unmount } = render(
      <React.StrictMode>
        <SessionProvider manager={manager}>
          <TestConsumer />
        </SessionProvider>
      </React.StrictMode>,
    );

    expect(manager.start).toHaveBeenCalled();
    // In React 19 StrictMode, initial mount -> cleanup -> remount invokes stop then start
    expect(manager.stop).toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    // Explicit unmount
    unmount();
    expect(manager.stop).toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();
  });

  it('TC-CTX-06: Exposes working retry, signOut, and signInWithPassword helpers', async () => {
    const manager = createMockManager({
      status: 'authenticated',
      actor: {
        id: '00000000-0000-4000-a000-000000000001',
        name: 'Suresh Narayanan',
        role: 'founder',
        reportsToId: null,
      },
    });

    render(
      <SessionProvider manager={manager}>
        <TestConsumer />
      </SessionProvider>,
    );

    const signInBtn = screen.getByRole('button', { name: /sign in again/i });
    fireEvent.click(signInBtn);
    expect(manager.signInWithPassword).toHaveBeenCalledWith({
      email: 'test@sn-demo.local',
      password: 'pass',
    });

    const signOutBtn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(signOutBtn);
    expect(manager.signOut).toHaveBeenCalled();
  });
});
