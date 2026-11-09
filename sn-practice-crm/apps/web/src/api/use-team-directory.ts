import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { ReportingLineDto } from '@sn/contracts';
import { HttpTeamDirectoryAdapter } from './http-team-directory-adapter';
import { TeamDirectoryCoordinator } from './team-directory-coordinator';
import { useOptionalSessionActor } from '../shell/session-context';
import type {
  TeamDirectoryOperationError,
  TeamDirectoryPort,
  TeamDirectoryState,
} from './team-directory-types';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface UseTeamDirectoryOptions {
  readonly port?: TeamDirectoryPort;
  readonly onToast?: (message: string) => void;
  readonly onError?: (error: TeamDirectoryOperationError) => void;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

export interface UseTeamDirectoryResult extends TeamDirectoryState {
  readonly lines: ReportingLineDto[];
  readonly refresh: () => Promise<void>;
}

interface CoordinatorSession {
  readonly token: symbol;
  readonly coordinator: TeamDirectoryCoordinator;
}

export function useTeamDirectory(
  role: CompanyRole,
  options: UseTeamDirectoryOptions = {},
): UseTeamDirectoryResult {
  const { onToast, onError, enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpTeamDirectoryAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );

  const activeTokenRef = useRef<symbol | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Pure coordinator session creation without render side-effects.
  // Each session owns a unique token. Only the effect-activated token may dispatch actions
  // or deliver toast/error callbacks.
  const session = useMemo<CoordinatorSession>(() => {
    const token = Symbol('team-directory-session');
    const coordinator = new TeamDirectoryCoordinator({
      port,
      initialRole: role,
      onToast: (msg) => {
        if (activeTokenRef.current === token) {
          onToastRef.current?.(msg);
        }
      },
      onError: (err) => {
        if (activeTokenRef.current === token) {
          onErrorRef.current?.(err);
        }
      },
    });
    return { token, coordinator };
  }, [port]);

  // Pair coordinator with its latest snapshot in React state
  const [state, setState] = useState<{
    coordinator: TeamDirectoryCoordinator;
    snapshot: TeamDirectoryState;
  }>(() => ({
    coordinator: session.coordinator,
    snapshot: session.coordinator.getState(),
  }));

  // Coordinator lifecycle: commit-synchronous activation, subscription and cancelPending on unmount or port change.
  // Replay-safe for React.StrictMode: the same session token can reactivate upon replay.
  useIsomorphicLayoutEffect(() => {
    activeTokenRef.current = session.token;
    const unsubscribe = session.coordinator.subscribe(() => {
      if (activeTokenRef.current === session.token) {
        setState({
          coordinator: session.coordinator,
          snapshot: session.coordinator.getState(),
        });
      }
    });

    return () => {
      if (activeTokenRef.current === session.token) {
        activeTokenRef.current = null;
      }
      unsubscribe();
      session.coordinator.cancelPending({ notify: false });
    };
  }, [session]);

  // Role synchronization & fetch: commit-synchronous role switch and old-role work cancellation.
  useIsomorphicLayoutEffect(() => {
    if (activeTokenRef.current === session.token && enabled) {
      void session.coordinator.switchRole(role);
    }
  }, [session, role, enabled]);

  // ZERO-FRAME PRIVACY GUARD (Both Port identity change & Role switch):
  // Synchronously expose a privacy-safe empty snapshot:
  // 1. If disabled, or
  // 2. If state belongs to a prior coordinator (port change), or
  // 3. If coordinator state role does not match requested role.
  const isStale =
    !enabled ||
    state.coordinator !== session.coordinator ||
    state.snapshot.role !== role;

  const items = isStale ? [] : state.snapshot.items;
  const loading = !enabled ? false : isStale ? true : state.snapshot.loading;
  const error = isStale ? null : state.snapshot.error;
  const hasLiveSnapshot = isStale ? false : state.snapshot.hasLiveSnapshot;

  const refresh = useCallback(async (): Promise<void> => {
    if (activeTokenRef.current !== session.token || !enabled) {
      return;
    }
    await session.coordinator.sync();
  }, [session, enabled]);

  return {
    items,
    lines: items,
    loading,
    error,
    role,
    hasLiveSnapshot,
    refresh,
  };
}
