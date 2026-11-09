import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SessionClient } from '../api/auth/session-client';
import { SessionManager } from '../api/auth/session-manager';
import { getSupabaseAuthAdapter } from '../api/auth/supabase-client';
import type { AuthSession, AuthSessionSource, SessionState } from '../api/auth/types';

export interface SessionContextValue extends SessionState {
  retry: () => Promise<void>;
  signOut: (options?: { scope?: 'local' | 'global' }) => Promise<void>;
  signInWithPassword: (credentials: { email: string; password: string }) => Promise<AuthSession>;
  getAccessToken?: () => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  authSource?: AuthSessionSource;
  client?: SessionClient;
  manager?: SessionManager;
  children: ReactNode;
}

export function SessionProvider({ authSource, client, manager: injectedManager, children }: SessionProviderProps) {
  const manager = useMemo(() => {
    if (injectedManager) return injectedManager;
    const source = authSource ?? getSupabaseAuthAdapter();
    const sessionClient = client ?? new SessionClient({
      baseUrl: typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '',
    });
    return new SessionManager(source, sessionClient);
  }, [injectedManager, authSource, client]);

  const [state, setState] = useState<SessionState>(() => manager.getState());

  useEffect(() => {
    const unsubscribe = manager.subscribe(setState);
    manager.start();
    return () => {
      unsubscribe();
      // In React StrictMode development, cleanup must use stop(), NEVER dispose()
      manager.stop();
    };
  }, [manager]);

  const retry = useCallback(() => manager.retry(), [manager]);
  const signOut = useCallback((options?: { scope?: 'local' | 'global' }) => manager.signOut(options), [manager]);
  const signInWithPassword = useCallback(
    (credentials: { email: string; password: string }) => manager.signInWithPassword(credentials),
    [manager],
  );
  const getAccessToken = useCallback(() => manager.getAccessToken(), [manager]);

  const value = useMemo<SessionContextValue>(() => ({
    ...state,
    retry,
    signOut,
    signInWithPassword,
    getAccessToken,
  }), [state, retry, signOut, signInWithPassword, getAccessToken]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionActor(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSessionActor must be used within a <SessionProvider>');
  }
  return ctx;
}

export function useOptionalSessionActor(): SessionContextValue | null {
  return useContext(SessionContext);
}
