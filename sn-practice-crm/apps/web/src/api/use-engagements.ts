import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  CreateEngagementDraftInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from '@sn/contracts';
import { HttpEngagementsAdapter } from './http-engagements-adapter';
import { EngagementsCoordinator } from './engagements-coordinator';
import { useOptionalSessionActor } from '../shell/session-context';
import type { EngagementsPort, EngagementsState } from './engagements-types';
import { EngagementOperationError } from './engagements-types';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

export interface UseEngagementsOptions {
  readonly port?: EngagementsPort;
  readonly onToast?: (message: string) => void;
  readonly onError?: (error: EngagementOperationError) => void;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
  readonly enabled?: boolean;
}

export interface UseEngagementsResult extends EngagementsState {
  readonly refresh: () => Promise<void>;
  readonly selectEngagement: (id: string) => Promise<void>;
  readonly clearSelection: () => void;
  readonly createDraft: (
    input: CreateEngagementDraftInput,
    options?: { idempotencyKey?: string },
  ) => Promise<{ success: boolean; item?: EngagementDto; error?: EngagementOperationError }>;
  readonly reviseDraft: (
    engagementId: string,
    input: ReviseEngagementDraftInput,
    options?: { idempotencyKey?: string },
  ) => Promise<{ success: boolean; item?: EngagementDto; error?: EngagementOperationError }>;
  readonly activate: (
    engagementId: string,
    input: ActivateEngagementInput,
    options?: { idempotencyKey?: string },
  ) => Promise<{ success: boolean; item?: EngagementDto; error?: EngagementOperationError }>;
  readonly amend: (
    engagementId: string,
    input: AmendActiveEngagementInput,
    options?: { idempotencyKey?: string },
  ) => Promise<{ success: boolean; item?: EngagementDto; error?: EngagementOperationError }>;
  readonly end: (
    engagementId: string,
    input: EndEngagementInput,
    options?: { idempotencyKey?: string },
  ) => Promise<{ success: boolean; item?: EngagementDto; error?: EngagementOperationError }>;
}

interface CoordinatorSession {
  readonly token: symbol;
  readonly coordinator: EngagementsCoordinator;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEngagements(
  role: CompanyRole,
  options: UseEngagementsOptions = {},
): UseEngagementsResult {
  const { onToast, onError, enabled = true } = options;

  const sessionActor = useOptionalSessionActor();
  const rawGetAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const hasAuthSource = Boolean(rawGetAccessToken);

  // Stable token getter: prevents inline arrow function identity churn from triggering
  // coordinator recreation on every render. Preserves the crucial distinction between:
  // - no auth source -> demo transport (x-demo-user-id)
  // - auth source but null/blank/throws -> fail closed (unauthorized)
  const getAccessTokenRef = useRef(rawGetAccessToken);
  getAccessTokenRef.current = rawGetAccessToken;

  const stableGetAccessToken = useMemo(() => {
    if (!hasAuthSource) return undefined;
    return async () => {
      const fn = getAccessTokenRef.current;
      return fn ? await fn() : null;
    };
  }, [hasAuthSource]);

  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpEngagementsAdapter({ getAccessToken: stableGetAccessToken, baseUrl }),
    [options.port, stableGetAccessToken, baseUrl],
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
    const token = Symbol('engagements-session');
    const coordinator = new EngagementsCoordinator({
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
  }, [port, enabled]);

  // Pair coordinator with its latest snapshot in React state
  const [state, setState] = useState<{
    coordinator: EngagementsCoordinator;
    snapshot: EngagementsState;
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
  const listError = isStale ? null : state.snapshot.listError;
  const hasLiveSnapshot = isStale ? false : state.snapshot.hasLiveSnapshot;
  const selectedEngagementId = isStale ? null : state.snapshot.selectedEngagementId;
  const selectedDetail = isStale ? null : state.snapshot.selectedDetail;
  const selectedVersions: EngagementVersionDto[] = isStale ? [] : state.snapshot.selectedVersions;
  const detailLoading = isStale ? false : state.snapshot.detailLoading;
  const detailError = isStale ? null : state.snapshot.detailError;

  // ---------------------------------------------------------------------------
  // Stable callbacks
  // ---------------------------------------------------------------------------

  const refresh = useCallback(async (): Promise<void> => {
    if (activeTokenRef.current !== session.token || !enabled) {
      return;
    }
    await session.coordinator.sync();
  }, [session, enabled]);

  const selectEngagement = useCallback(
    async (id: string): Promise<void> => {
      if (activeTokenRef.current !== session.token || !enabled) return;
      await session.coordinator.selectEngagement(id);
    },
    [session, enabled],
  );

  const clearSelection = useCallback((): void => {
    if (activeTokenRef.current !== session.token || !enabled) return;
    session.coordinator.clearSelection();
  }, [session, enabled]);

  const createDraft = useCallback(
    async (
      input: CreateEngagementDraftInput,
      opts?: { idempotencyKey?: string },
    ) => {
      if (activeTokenRef.current !== session.token || !enabled) {
        return {
          success: false,
          error: new EngagementOperationError({
            code: 'aborted',
            message: 'Hook is inactive.',
          }),
        };
      }
      return await session.coordinator.createDraft(input, opts);
    },
    [session, enabled],
  );

  const reviseDraft = useCallback(
    async (
      engagementId: string,
      input: ReviseEngagementDraftInput,
      opts?: { idempotencyKey?: string },
    ) => {
      if (activeTokenRef.current !== session.token || !enabled) {
        return {
          success: false,
          error: new EngagementOperationError({
            code: 'aborted',
            message: 'Hook is inactive.',
          }),
        };
      }
      return await session.coordinator.reviseDraft(engagementId, input, opts);
    },
    [session, enabled],
  );

  const activate = useCallback(
    async (
      engagementId: string,
      input: ActivateEngagementInput,
      opts?: { idempotencyKey?: string },
    ) => {
      if (activeTokenRef.current !== session.token || !enabled) {
        return {
          success: false,
          error: new EngagementOperationError({
            code: 'aborted',
            message: 'Hook is inactive.',
          }),
        };
      }
      return await session.coordinator.activate(engagementId, input, opts);
    },
    [session, enabled],
  );

  const amend = useCallback(
    async (
      engagementId: string,
      input: AmendActiveEngagementInput,
      opts?: { idempotencyKey?: string },
    ) => {
      if (activeTokenRef.current !== session.token || !enabled) {
        return {
          success: false,
          error: new EngagementOperationError({
            code: 'aborted',
            message: 'Hook is inactive.',
          }),
        };
      }
      return await session.coordinator.amend(engagementId, input, opts);
    },
    [session, enabled],
  );

  const end = useCallback(
    async (
      engagementId: string,
      input: EndEngagementInput,
      opts?: { idempotencyKey?: string },
    ) => {
      if (activeTokenRef.current !== session.token || !enabled) {
        return {
          success: false,
          error: new EngagementOperationError({
            code: 'aborted',
            message: 'Hook is inactive.',
          }),
        };
      }
      return await session.coordinator.end(engagementId, input, opts);
    },
    [session, enabled],
  );

  return {
    role,
    items,
    loading,
    listError,
    hasLiveSnapshot,
    selectedEngagementId,
    selectedDetail,
    selectedVersions,
    detailLoading,
    detailError,
    refresh,
    selectEngagement,
    clearSelection,
    createDraft,
    reviseDraft,
    activate,
    amend,
    end,
  };
}
