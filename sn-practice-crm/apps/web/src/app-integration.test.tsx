// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionActor } from '@sn/contracts';
import { AppRoot } from './app';
import type { SessionManager } from './api/auth/session-manager';
import type { AuthChangeCallback, AuthChangeEvent, AuthSession, AuthSessionSource, SessionState } from './api/auth/types';
import type { SessionClient } from './api/auth/session-client';

afterEach(() => {
  cleanup();
});

function createMockAuthSource(initialSession: AuthSession | null = null) {
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
      const session: AuthSession = {
        accessToken: `token-for-${email}`,
        userId: '00000000-0000-4000-a000-000000000001',
      };
      currentSession = session;
      return session;
    }),
  };

  const emitEvent = (event: AuthChangeEvent, session: AuthSession | null) => {
    currentSession = session;
    authCallback?.(event, session);
  };

  return { authSource, emitEvent };
}

function createMockSessionManager(initialState: Partial<SessionState> = {}): {
  manager: SessionManager;
  updateState: (next: Partial<SessionState>) => void;
} {
  let currentState: SessionState = {
    status: 'unauthenticated',
    actor: null,
    authUserId: null,
    error: null,
    refreshWarning: null,
    isRefreshing: false,
    ...initialState,
  };

  const listeners = new Set<(state: SessionState) => void>();

  const manager = {
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
    signOut: vi.fn().mockImplementation(async () => {
      currentState = {
        status: 'unauthenticated',
        actor: null,
        authUserId: null,
        error: null,
        refreshWarning: null,
        isRefreshing: false,
      };
      for (const l of listeners) l(currentState);
    }),
    signInWithPassword: vi.fn().mockResolvedValue({
      accessToken: 'token-123',
      userId: '00000000-0000-4000-a000-000000000001',
    }),
  } as unknown as SessionManager;

  const updateState = (next: Partial<SessionState>) => {
    currentState = { ...currentState, ...next };
    for (const l of listeners) l(currentState);
  };

  return { manager, updateState };
}

describe('App & AppRoot Integration', () => {
  const founderActor: SessionActor = {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'Suresh Narayanan',
    role: 'founder',
    reportsToId: null,
  };

  const managerActor: SessionActor = {
    id: '00000000-0000-4000-a000-000000000002',
    name: 'Manoj Kumar',
    role: 'manager',
    reportsToId: '00000000-0000-4000-a000-000000000001',
  };

  it('TC-INT-01: Unauthenticated user is gated at <SignInGate>', async () => {
    const { manager } = createMockSessionManager({ status: 'unauthenticated' });
    render(<AppRoot manager={manager} />);

    expect(screen.getByRole('heading', { name: /sn practice crm/i })).toBeTruthy();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('TC-INT-02: Successful sign-in transitions through loading to authenticated dashboard with role matching actor.role', async () => {
    const { manager, updateState } = createMockSessionManager({ status: 'unauthenticated' });
    (manager.signInWithPassword as any).mockImplementation(async () => {
      updateState({ status: 'initializing', authUserId: managerActor.id });
      setTimeout(() => {
        updateState({
          status: 'authenticated',
          actor: managerActor,
          authUserId: managerActor.id,
        });
      }, 10);
      return { accessToken: 'token-manoj', userId: managerActor.id };
    });

    render(<AppRoot manager={manager} />);

    // Initially at SignInGate
    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    fireEvent.change(emailInput, { target: { value: 'manoj@sn-demo.local' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });

    const submitBtn = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitBtn);

    // Transitions to authenticated dashboard
    await waitFor(() => {
      expect(screen.getByText(/verified:/i)).toBeTruthy();
      expect(screen.getByText(/manoj kumar \(manager\)/i)).toBeTruthy();
      expect(screen.getByText(/workspace \/ dashboard/i)).toBeTruthy();
    });
  });

  it('TC-INT-03: Rules of Hooks invariant: session state transitions between unauthenticated and authenticated without throwing React hook order errors', async () => {
    const { manager, updateState } = createMockSessionManager({ status: 'unauthenticated' });
    const { container } = render(<AppRoot manager={manager} />);

    // Gated
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();

    // Transition 1: unauthenticated -> authenticated
    act(() => {
      updateState({
        status: 'authenticated',
        actor: founderActor,
        authUserId: founderActor.id,
      });
    });
    expect(screen.getByText(/suresh narayanan \(founder\)/i)).toBeTruthy();

    // Transition 2: authenticated -> unauthenticated (sign out)
    act(() => {
      updateState({
        status: 'unauthenticated',
        actor: null,
        authUserId: null,
      });
    });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();

    // Transition 3: unauthenticated -> authenticated again
    act(() => {
      updateState({
        status: 'authenticated',
        actor: managerActor,
        authUserId: managerActor.id,
      });
    });
    expect(screen.getByText(/manoj kumar \(manager\)/i)).toBeTruthy();
  });

  it('TC-INT-04: Account switch event synchronously wipes previous user data and displays loading/new identity without rendering stale state', async () => {
    const { manager, updateState } = createMockSessionManager({
      status: 'authenticated',
      actor: founderActor,
      authUserId: founderActor.id,
    });

    render(<AppRoot manager={manager} />);
    expect(screen.getByText(/suresh narayanan \(founder\)/i)).toBeTruthy();

    // Account switch synchronously sets initializing and clears actor
    act(() => {
      updateState({
        status: 'initializing',
        actor: null,
        authUserId: managerActor.id,
      });
    });

    // Previous user data wiped, loading shown
    expect(screen.queryByText(/suresh narayanan \(founder\)/i)).toBeNull();
    expect(screen.getByText(/verifying secure session/i)).toBeTruthy();

    // New user actor resolves
    act(() => {
      updateState({
        status: 'authenticated',
        actor: managerActor,
        authUserId: managerActor.id,
      });
    });

    expect(screen.getByText(/manoj kumar \(manager\)/i)).toBeTruthy();
  });

  it('TC-INT-05: Exportable AppRoot supports dependency injection and renders complete provider + app stack', () => {
    const { manager } = createMockSessionManager({
      status: 'authenticated',
      actor: founderActor,
      authUserId: founderActor.id,
    });

    render(<AppRoot manager={manager} />);
    expect(screen.getByText('SN Practice CRM')).toBeTruthy();
    expect(screen.getByText(/verified:/i)).toBeTruthy();
    expect(manager.start).toHaveBeenCalled();
  });
});
