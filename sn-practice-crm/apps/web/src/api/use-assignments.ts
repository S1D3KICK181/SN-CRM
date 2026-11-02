import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import { ASSIGNMENTS, type AssignmentRow } from '../data';
import {
  AssignmentsCoordinator,
  type ClientFieldCascadePayload,
  type CoordinatorState,
} from './coordinator';
import { HttpAssignmentsAdapter } from './http-adapter';
import type {
  AssignmentOperationError,
  AssignmentsPort,
  CreateAssignmentCommand,
} from './types';

export interface UseAssignmentsOptions {
  port?: AssignmentsPort;
  initialRows?: AssignmentRow[];
  onToast?: (message: string) => void;
  onError?: (error: AssignmentOperationError) => void;
}

export function useAssignments(role: CompanyRole, options: UseAssignmentsOptions = {}) {
  const { onToast, onError, initialRows = ASSIGNMENTS } = options;

  // Stable port instance: use provided or default to HttpAssignmentsAdapter
  const port = useMemo(() => options.port ?? new HttpAssignmentsAdapter(), [options.port]);

  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const isMountedRef = useRef(true);

  // Stable coordinator instance
  const coordinatorRef = useRef<AssignmentsCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = new AssignmentsCoordinator({
      initialRows,
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
  const [state, setState] = useState<CoordinatorState>(() => coordinator.getState());

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

  // Sync / switch role whenever role changes
  useEffect(() => {
    void coordinator.switchRole(role);
  }, [coordinator, role]);

  const handleCreateAssignment = useCallback(
    async (
      commandOrRow: AssignmentRow | CreateAssignmentCommand,
    ): Promise<AssignmentRow | undefined> => {
      try {
        const res = await coordinator.handleCreateAssignment(commandOrRow);
        return res.row;
      } catch {
        return undefined;
      }
    },
    [coordinator],
  );

  const handleUpdateAssignment = useCallback(
    async (updated: AssignmentRow): Promise<AssignmentRow | undefined> => {
      try {
        const res = await coordinator.handleUpdateAssignment(updated);
        return res.row;
      } catch {
        return undefined;
      }
    },
    [coordinator],
  );

  const cascadeClientFields = useCallback(
    (client: ClientFieldCascadePayload): void => {
      coordinator.cascadeClientFields(client);
    },
    [coordinator],
  );

  const markAssignmentBilled = useCallback(
    (assignmentId: string): void => {
      coordinator.markAssignmentBilled(assignmentId);
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

  const isRoleStale = state.role !== role;

  return {
    assignments: isRoleStale ? [] : state.assignments,
    loading: isRoleStale ? true : state.loading,
    error: isRoleStale ? null : state.error,
    handleCreateAssignment,
    handleUpdateAssignment,
    cascadeClientFields,
    markAssignmentBilled,
    refresh,
  };
}
