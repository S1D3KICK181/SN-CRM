import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import { HttpWorkItemsAdapter } from './http-work-items-adapter';
import { useOptionalSessionActor } from '../shell/session-context';
import { isValidUuid } from './metadata-safety';
import {
  deriveWorkItemViewGroups,
  parseDisplayDateToKolkataIso,
  validateDelegatedDeadline,
} from './work-items-mapper';
import {
  WorkItemsCoordinator,
  type WorkItemsCoordinatorOptions,
} from './work-items-coordinator';
import {
  WorkItemOperationError,
  type WorkItemsCoordinatorState,
  type WorkItemsPort,
} from './work-items-types';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface UseWorkItemsOptions {
  readonly port?: WorkItemsPort;
  readonly onToast?: (message: string) => void;
  readonly onError?: (error: WorkItemOperationError) => void;
  readonly clock?: Date | string;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly fetchFn?: typeof fetch;
  readonly baseUrl?: string;
  readonly currentActorId?: string;
  readonly employeeNameMap?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

export interface CreateDelegatedInput {
  readonly assignmentId: string;
  readonly assigneeId: string;
  readonly title: string;
  readonly due?: string;
  readonly dueDate?: string;
  readonly dueTime?: string;
  readonly instructions?: string;
  readonly reminderAt?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface CreatePersonalInput {
  readonly title: string;
  readonly context?: string;
  readonly time?: string;
  readonly due?: string;
  readonly dueDate?: string;
  readonly dueTime?: string;
  readonly relatedClientId?: string | null;
  readonly relatedPartyName?: string | null;
  readonly reminderAt?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface CreateInternalInput {
  readonly title: string;
  readonly assigneeId: string;
  readonly due?: string;
  readonly dueDate?: string;
  readonly dueTime?: string;
  readonly instructions?: string;
  readonly reminderAt?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
}

interface CoordinatorSession {
  readonly token: symbol;
  readonly coordinator: WorkItemsCoordinator;
}

export function useWorkItems(
  role: CompanyRole,
  assignments: AssignmentRow[],
  options: UseWorkItemsOptions = {},
) {
  const { onToast, onError, clock } = options;
  const sessionActor = useOptionalSessionActor();
  const rawGetAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const hasAuthSource = Boolean(rawGetAccessToken);

  const getAccessTokenRef = useRef(rawGetAccessToken);
  getAccessTokenRef.current = rawGetAccessToken;

  // Stable token getter wrapper only if an auth source is actually present; undefined if no auth source configured.
  // This preserves the crucial distinction in HttpWorkItemsAdapter between:
  // - no auth source configured -> explicit demo transport (x-demo-user-id)
  // - auth source configured but returned null/empty/throws -> fails closed (401)
  // And it prevents inline getAccessToken arrow function identity churn from triggering coordinator recreation loops.
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
  const currentActorId = options.currentActorId ?? sessionActor?.actor?.id;

  const fetchFn = options.fetchFn;

  const port = useMemo(
    () =>
      options.port ??
      new HttpWorkItemsAdapter({ getAccessToken: stableGetAccessToken, baseUrl, fetchFn }),
    [options.port, stableGetAccessToken, baseUrl, fetchFn],
  );

  const activeTokenRef = useRef<symbol | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;

  // Pure coordinator session creation without render side-effects.
  // Each session owns a unique token. Only the effect-activated token may dispatch actions
  // or deliver toast/error callbacks.
  const session = useMemo<CoordinatorSession>(() => {
    const token = Symbol('work-items-session');
    const coordinator = new WorkItemsCoordinator({
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
    coordinator: WorkItemsCoordinator;
    snapshot: WorkItemsCoordinatorState;
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
    if (activeTokenRef.current === session.token) {
      void session.coordinator.switchRole(role);
    }
  }, [session, role]);

  // ZERO-FRAME PRIVACY GUARD (Both Port identity change & Role switch):
  // Synchronously expose a privacy-safe empty snapshot:
  // 1. If state belongs to a prior coordinator (port change), or
  // 2. If coordinator state role does not match requested role.
  const isStale =
    state.coordinator !== session.coordinator ||
    state.snapshot.role !== role;

  const rawItems = isStale ? [] : state.snapshot.items;
  const loading = isStale ? true : state.snapshot.loading;
  const error = isStale ? null : state.snapshot.error;
  const hasLiveSnapshot = isStale ? false : state.snapshot.hasLiveSnapshot;

  // Pure selectors derive view groups from rawItems + latest assignments + active role
  const viewGroups = useMemo(() => {
    return deriveWorkItemViewGroups(rawItems, assignments, role, clock, {
      currentActorId,
      employeeNameMap: options.employeeNameMap,
    });
  }, [rawItems, assignments, role, clock, currentActorId, options.employeeNameMap]);

  const handleCreateDelegated = useCallback(
    async (input: CreateDelegatedInput): Promise<boolean> => {
      try {
        const timeString =
          input.due ||
          (input.dueDate ? `${input.dueDate} · ${input.dueTime || '18:00'}` : 'Tomorrow');
        const dueAtIso = parseDisplayDateToKolkataIso(timeString, clock);

        // Pre-validate deadline against parent assignment if parent is in assignments list
        const parent = assignmentsRef.current.find((a) => a.id === input.assignmentId);
        if (parent?.due) {
          try {
            const parentDueIso = parseDisplayDateToKolkataIso(parent.due, clock);
            const deadlineError = validateDelegatedDeadline(dueAtIso, parentDueIso);
            if (deadlineError) {
              const err = new WorkItemOperationError({
                code: 'validation',
                message: deadlineError,
                serverCode: 'task_due_after_assignment',
                status: 422,
              });
              onErrorRef.current?.(err);
              onToastRef.current?.(deadlineError);
              return false;
            }
          } catch {
            // If parent due string cannot be parsed, allow backend to be authoritative
          }
        }

        let reminderAtIso: string | null = null;
        if (input.reminderAt) {
          reminderAtIso = parseDisplayDateToKolkataIso(input.reminderAt, clock);
          if (reminderAtIso > dueAtIso) {
            const err = new WorkItemOperationError({
              code: 'validation',
              message: 'A reminder must occur on or before the task due time.',
              serverCode: 'reminder_after_due_time',
              status: 422,
            });
            onErrorRef.current?.(err);
            onToastRef.current?.(err.message);
            return false;
          }
        }

        const createInput: import('@sn/contracts').CreateWorkItemInput = {
          kind: 'delegated',
          title: input.title,
          assignmentId: input.assignmentId,
          assigneeId: input.assigneeId,
          dueAt: dueAtIso,
          ...(input.instructions ? { notes: input.instructions } : {}),
          ...(reminderAtIso ? { reminderAt: reminderAtIso } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        };

        const res = await session.coordinator.handleCreateWorkItem(createInput);
        return res.success;
      } catch (err: unknown) {
        const opError =
          err instanceof WorkItemOperationError
            ? err
            : new WorkItemOperationError({
                code: 'validation',
                message: err instanceof Error ? err.message : 'Invalid delegation details.',
                cause: err,
              });
        onErrorRef.current?.(opError);
        onToastRef.current?.(`Validation error: ${opError.message}`);
        return false;
      }
    },
    [session, clock],
  );

  const handleCreatePersonal = useCallback(
    async (input: CreatePersonalInput): Promise<boolean> => {
      try {
        const timeString =
          input.time ||
          input.due ||
          (input.dueDate ? `${input.dueDate} · ${input.dueTime || '18:00'}` : 'Today · 18:00');
        const dueAtIso = parseDisplayDateToKolkataIso(timeString, clock);

        let reminderAtIso: string | null = null;
        if (input.reminderAt) {
          reminderAtIso = parseDisplayDateToKolkataIso(input.reminderAt, clock);
          if (reminderAtIso > dueAtIso) {
            const err = new WorkItemOperationError({
              code: 'validation',
              message: 'A reminder must occur on or before the task due time.',
              serverCode: 'reminder_after_due_time',
              status: 422,
            });
            onErrorRef.current?.(err);
            onToastRef.current?.(err.message);
            return false;
          }
        }

        const isClientUuid =
          Boolean(input.relatedClientId && isValidUuid(input.relatedClientId));
        const resolvedPartyName =
          input.relatedPartyName ||
          input.context ||
          (input.relatedClientId && !isClientUuid ? input.relatedClientId : undefined);

        const createInput: import('@sn/contracts').CreateWorkItemInput = {
          kind: 'personal',
          title: input.title,
          dueAt: dueAtIso,
          ...(isClientUuid ? { relatedClientId: input.relatedClientId! } : {}),
          ...(resolvedPartyName ? { relatedPartyName: resolvedPartyName } : {}),
          ...(reminderAtIso ? { reminderAt: reminderAtIso } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        };

        const res = await session.coordinator.handleCreateWorkItem(createInput);
        return res.success;
      } catch (err: unknown) {
        const opError =
          err instanceof WorkItemOperationError
            ? err
            : new WorkItemOperationError({
                code: 'validation',
                message: err instanceof Error ? err.message : 'Invalid personal task details.',
                cause: err,
              });
        onErrorRef.current?.(opError);
        onToastRef.current?.(`Validation error: ${opError.message}`);
        return false;
      }
    },
    [session, clock],
  );

  const handleCreateInternal = useCallback(
    async (input: CreateInternalInput): Promise<boolean> => {
      try {
        const timeString =
          input.due ||
          (input.dueDate ? `${input.dueDate} · ${input.dueTime || '18:00'}` : 'Tomorrow');
        const dueAtIso = parseDisplayDateToKolkataIso(timeString, clock);

        let reminderAtIso: string | null = null;
        if (input.reminderAt) {
          reminderAtIso = parseDisplayDateToKolkataIso(input.reminderAt, clock);
          if (reminderAtIso > dueAtIso) {
            const err = new WorkItemOperationError({
              code: 'validation',
              message: 'A reminder must occur on or before the task due time.',
              serverCode: 'reminder_after_due_time',
              status: 422,
            });
            onErrorRef.current?.(err);
            onToastRef.current?.(err.message);
            return false;
          }
        }

        const createInput: import('@sn/contracts').CreateWorkItemInput = {
          kind: 'internal',
          title: input.title,
          assigneeId: input.assigneeId,
          dueAt: dueAtIso,
          ...(input.instructions ? { notes: input.instructions } : {}),
          ...(reminderAtIso ? { reminderAt: reminderAtIso } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
        };

        const res = await session.coordinator.handleCreateWorkItem(createInput);
        return res.success;
      } catch (err: unknown) {
        const opError =
          err instanceof WorkItemOperationError
            ? err
            : new WorkItemOperationError({
                code: 'validation',
                message: err instanceof Error ? err.message : 'Invalid internal task details.',
                cause: err,
              });
        onErrorRef.current?.(opError);
        onToastRef.current?.(`Validation error: ${opError.message}`);
        return false;
      }
    },
    [session, clock],
  );

  const handleStart = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await session.coordinator.handleTransitionWorkItem(id, 'start');
      return res.success;
    },
    [session],
  );

  const handleSubmit = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await session.coordinator.handleTransitionWorkItem(id, 'submit');
      return res.success;
    },
    [session],
  );

  const handleApprove = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await session.coordinator.handleTransitionWorkItem(id, 'complete');
      return res.success;
    },
    [session],
  );

  const handleReopen = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await session.coordinator.handleTransitionWorkItem(id, 'reopen');
      return res.success;
    },
    [session],
  );

  const handleTogglePersonal = useCallback(
    async (taskId: string): Promise<boolean> => {
      const existing = session.coordinator.getState().items.find((i) => i.id === taskId);
      if (!existing) return false;
      if (existing.status === 'completed') {
        onToastRef.current?.('Completed tasks are permanent audit records and cannot be reopened.');
        return false;
      }
      const res = await session.coordinator.handleTransitionWorkItem(taskId, 'complete');
      return res.success;
    },
    [session],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await session.coordinator.sync();
    } catch {
      // Handled internally in coordinator
    }
  }, [session]);

  return {
    items: rawItems,
    loading,
    error,
    hasLiveSnapshot,
    personalTasks: viewGroups.personalTasks,
    assignedToMe: viewGroups.assignedToMe,
    delegatedByMe: viewGroups.delegatedByMe,
    reviewableTasks: viewGroups.reviewableTasks,
    visibleDelegatedWork: viewGroups.visibleDelegatedWork,
    handleCreateDelegated,
    handleCreatePersonal,
    handleCreateInternal,
    handleStart,
    handleSubmit,
    handleApprove,
    handleReopen,
    handleTogglePersonal,
    refresh,
  };
}
