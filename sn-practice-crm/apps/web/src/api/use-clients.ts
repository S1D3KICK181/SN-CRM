import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type {
  ClientContactDto,
  ClientDto,
  CreateClientContactInput,
  CreateClientInput,
  UpdateClientContactInput,
  UpdateClientInput,
} from '@sn/contracts';
import { ClientsCoordinator } from './clients-coordinator';
import { HttpClientsAdapter } from './http-clients-adapter';
import { useOptionalSessionActor } from '../shell/session-context';
import {
  ClientOperationError,
  type ClientsCoordinatorState,
  type ClientsPort,
} from './clients-types';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface UseClientsOptions {
  port?: ClientsPort;
  onToast?: (message: string) => void;
  onError?: (error: ClientOperationError) => void;
  getAccessToken?: () => Promise<string | null> | string | null;
  baseUrl?: string;
}

export interface UseClientsResult {
  readonly items: ClientDto[];
  readonly loading: boolean;
  readonly error: ClientOperationError | null;
  readonly role: CompanyRole;
  readonly hasLiveSnapshot: boolean;
  readonly selectedClientId: string | null;
  readonly selectedDetail: ClientDto | null;
  readonly detailLoading: boolean;
  readonly detailError: ClientOperationError | null;
  readonly selectClient: (id: string) => Promise<void>;
  readonly clearSelection: () => void;
  readonly refresh: () => Promise<void>;
  readonly createClient: (input: CreateClientInput) => Promise<ClientDto | null>;
  /** Each change rejects with a sanitized ClientOperationError; null means it was cancelled. */
  readonly updateClient: (
    clientId: string,
    input: UpdateClientInput,
    idempotencyKey: string,
  ) => Promise<ClientDto | null>;
  readonly createContact: (
    clientId: string,
    input: CreateClientContactInput,
    idempotencyKey: string,
  ) => Promise<ClientContactDto | null>;
  readonly updateContact: (
    contactId: string,
    input: UpdateClientContactInput,
    idempotencyKey: string,
  ) => Promise<ClientContactDto | null>;
  readonly deleteContact: (contactId: string) => Promise<boolean>;
}

interface CoordinatorSession {
  readonly token: symbol;
  readonly coordinator: ClientsCoordinator;
}

export function useClients(
  role: CompanyRole,
  options: UseClientsOptions = {},
): UseClientsResult {
  const { onToast, onError } = options;
  const sessionActor = useOptionalSessionActor();
  const rawGetAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const hasAuthSource = Boolean(rawGetAccessToken);

  // Stable token getter, as in useEngagements: a new function identity on each render must not
  // recreate the port (and reload clients). No source means demo transport; a source that yields
  // nothing fails closed in the adapter.
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
    () => options.port ?? new HttpClientsAdapter({ getAccessToken: stableGetAccessToken, baseUrl }),
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
    const token = Symbol('clients-session');
    const coordinator = new ClientsCoordinator({
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
    coordinator: ClientsCoordinator;
    snapshot: ClientsCoordinatorState;
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
        setState({ coordinator: session.coordinator, snapshot: session.coordinator.getState() });
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

  // Role synchronization: commit-synchronous role switch and old-role work cancellation.
  useIsomorphicLayoutEffect(() => {
    if (activeTokenRef.current === session.token) {
      void session.coordinator.switchRole(role);
    }
  }, [session, role]);

  // ZERO-FRAME PRIVACY GUARD (Both Port identity change & Role switch):
  // Synchronously expose a privacy-safe empty snapshot:
  // 1. If state belongs to a prior coordinator (port change), or
  // 2. If coordinator state role does not match requested role.
  const isStale = state.coordinator !== session.coordinator || state.snapshot.role !== role;

  const items = isStale ? [] : state.snapshot.items;
  const loading = isStale ? true : state.snapshot.loading;
  const error = isStale ? null : state.snapshot.error;
  const hasLiveSnapshot = isStale ? false : state.snapshot.hasLiveSnapshot;
  const selectedClientId = isStale ? null : state.snapshot.selectedClientId;
  const selectedDetail = isStale ? null : state.snapshot.selectedDetail;
  const detailLoading = isStale ? false : state.snapshot.detailLoading;
  const detailError = isStale ? null : state.snapshot.detailError;

  const selectClient = useCallback(
    async (id: string): Promise<void> => {
      if (activeTokenRef.current !== session.token) {
        return;
      }
      await session.coordinator.selectClient(id);
    },
    [session],
  );

  const clearSelection = useCallback((): void => {
    if (activeTokenRef.current !== session.token) {
      return;
    }
    session.coordinator.clearSelection();
  }, [session]);

  const refresh = useCallback(async (): Promise<void> => {
    if (activeTokenRef.current !== session.token) {
      return;
    }
    await session.coordinator.sync();
  }, [session]);

  const createClient = useCallback(
    async (input: CreateClientInput): Promise<ClientDto | null> => {
      if (activeTokenRef.current !== session.token) {
        return null;
      }
      return await session.coordinator.createClient(input);
    },
    [session],
  );

  const updateClient = useCallback(
    async (clientId: string, input: UpdateClientInput, idempotencyKey: string): Promise<ClientDto | null> => {
      if (activeTokenRef.current !== session.token) return null;
      return await session.coordinator.updateClient(clientId, input, idempotencyKey);
    },
    [session],
  );

  const createContact = useCallback(
    async (
      clientId: string,
      input: CreateClientContactInput,
      idempotencyKey: string,
    ): Promise<ClientContactDto | null> => {
      if (activeTokenRef.current !== session.token) return null;
      return await session.coordinator.createContact(clientId, input, idempotencyKey);
    },
    [session],
  );

  const updateContact = useCallback(
    async (
      contactId: string,
      input: UpdateClientContactInput,
      idempotencyKey: string,
    ): Promise<ClientContactDto | null> => {
      if (activeTokenRef.current !== session.token) return null;
      return await session.coordinator.updateContact(contactId, input, idempotencyKey);
    },
    [session],
  );

  const deleteContact = useCallback(
    async (contactId: string): Promise<boolean> => {
      if (activeTokenRef.current !== session.token) return false;
      return await session.coordinator.deleteContact(contactId);
    },
    [session],
  );

  return {
    items,
    loading,
    error,
    role,
    hasLiveSnapshot,
    selectedClientId,
    selectedDetail,
    detailLoading,
    detailError,
    selectClient,
    clearSelection,
    refresh,
    createClient,
    updateClient,
    createContact,
    updateContact,
    deleteContact,
  };
}
