import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import { HttpWorkItemsAdapter } from './http-work-items-adapter';
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

export interface UseWorkItemsOptions {
  port?: WorkItemsPort;
  onToast?: (message: string) => void;
  onError?: (error: WorkItemOperationError) => void;
  clock?: Date | string;
}

export interface CreateDelegatedInput {
  assignmentId: string;
  assigneeId: string;
  title: string;
  due: string;
  instructions?: string;
}

export interface CreatePersonalInput {
  title: string;
  context?: string;
  time?: string;
}

export interface CreateInternalInput {
  title: string;
  assigneeId: string;
  due: string;
  instructions?: string;
}

export function useWorkItems(
  role: CompanyRole,
  assignments: AssignmentRow[],
  options: UseWorkItemsOptions = {},
) {
  const { onToast, onError, clock } = options;

  const port = useMemo(() => options.port ?? new HttpWorkItemsAdapter(), [options.port]);

  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const isMountedRef = useRef(true);

  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;

  const coordinatorRef = useRef<WorkItemsCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new WorkItemsCoordinator({
      port,
      initialRole: role,
      onToast: (msg) => {
        if (isMountedRef.current) {
          onToastRef.current?.(msg);
        }
      },
      onError: (err) => {
        if (isMountedRef.current) {
          onErrorRef.current?.(err);
        }
      },
    });
  }

  const coordinator = coordinatorRef.current;
  const [state, setState] = useState<WorkItemsCoordinatorState>(() => coordinator.getState());

  useEffect(() => {
    isMountedRef.current = true;
    const unsubscribe = coordinator.subscribe(() => {
      if (isMountedRef.current) {
        setState(coordinator.getState());
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
      coordinator.cancelPending();
    };
  }, [coordinator]);

  // Role switch effect
  useEffect(() => {
    void coordinator.switchRole(role);
  }, [coordinator, role]);

  // ZERO-FRAME ROLE PRIVACY GUARD:
  // Synchronously return empty item/view arrays and loading=true
  // whenever coordinator state.role !== requested role, before effects run.
  const isRoleStale = state.role !== role;
  const rawItems = isRoleStale ? [] : state.items;
  const loading = isRoleStale ? true : state.loading;
  const error = isRoleStale ? null : state.error;

  // Pure selectors derive view groups from rawItems + latest assignments + active role
  const viewGroups = useMemo(() => {
    return deriveWorkItemViewGroups(rawItems, assignments, role, clock);
  }, [rawItems, assignments, role, clock]);

  const handleCreateDelegated = useCallback(
    async (input: CreateDelegatedInput): Promise<boolean> => {
      try {
        const dueAtIso = parseDisplayDateToKolkataIso(input.due, clock);

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

        const res = await coordinator.handleCreateWorkItem({
          kind: 'delegated',
          title: input.title,
          assignmentId: input.assignmentId,
          assigneeId: input.assigneeId,
          dueAt: dueAtIso,
          notes: input.instructions || undefined,
        });
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
    [coordinator, clock],
  );

  const handleCreatePersonal = useCallback(
    async (input: CreatePersonalInput): Promise<boolean> => {
      try {
        const dueAtIso = parseDisplayDateToKolkataIso(input.time, clock);
        const res = await coordinator.handleCreateWorkItem({
          kind: 'personal',
          title: input.title,
          relatedPartyName: input.context || undefined,
          dueAt: dueAtIso,
        });
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
    [coordinator, clock],
  );

  const handleCreateInternal = useCallback(
    async (input: CreateInternalInput): Promise<boolean> => {
      try {
        const dueAtIso = parseDisplayDateToKolkataIso(input.due, clock);
        const res = await coordinator.handleCreateWorkItem({
          kind: 'internal',
          title: input.title,
          assigneeId: input.assigneeId,
          dueAt: dueAtIso,
          notes: input.instructions || undefined,
        });
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
    [coordinator, clock],
  );

  const handleStart = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await coordinator.handleTransitionWorkItem(id, 'start');
      return res.success;
    },
    [coordinator],
  );

  const handleSubmit = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await coordinator.handleTransitionWorkItem(id, 'submit');
      return res.success;
    },
    [coordinator],
  );

  const handleApprove = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await coordinator.handleTransitionWorkItem(id, 'complete');
      return res.success;
    },
    [coordinator],
  );

  const handleReopen = useCallback(
    async (taskIdOrRecord: string | { id: string }): Promise<boolean> => {
      const id = typeof taskIdOrRecord === 'string' ? taskIdOrRecord : taskIdOrRecord.id;
      const res = await coordinator.handleTransitionWorkItem(id, 'reopen');
      return res.success;
    },
    [coordinator],
  );

  const handleTogglePersonal = useCallback(
    async (taskId: string): Promise<boolean> => {
      const existing = coordinator.getState().items.find((i) => i.id === taskId);
      if (!existing) return false;
      const action = existing.status === 'completed' ? 'reopen' : 'complete';
      const res = await coordinator.handleTransitionWorkItem(taskId, action);
      return res.success;
    },
    [coordinator],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await coordinator.sync();
    } catch {
      // Handled internally in coordinator
    }
  }, [coordinator]);

  return {
    items: rawItems,
    loading,
    error,
    hasLiveSnapshot: state.hasLiveSnapshot,
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
