import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ServiceCatalogItemDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow, RecurringScheduleRecord } from '../data';
import { useOptionalSessionActor } from '../shell/session-context';
import {
  AssignmentsCoordinator,
  type ClientFieldCascadePayload,
  type CoordinatorState,
} from './coordinator';
import { HttpAssignmentsAdapter } from './http-adapter';
import {
  AssignmentOperationError,
  type AssignmentsPort,
  type CreateAssignmentCommand,
  type CreateRecurringScheduleCommand,
  type GenerateDueAssignmentsResult,
  type UpdateRecurringSchedulePatch,
} from './types';

export interface UseAssignmentsOptions {
  port?: AssignmentsPort;
  initialRows?: AssignmentRow[];
  initialSchedules?: RecurringScheduleRecord[];
  onToast?: (message: string) => void;
  onError?: (error: AssignmentOperationError) => void;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  currentActorId?: string;
}

export function useAssignments(role: CompanyRole, options: UseAssignmentsOptions = {}) {
  const {
    onToast,
    onError,
    initialRows = [],
    initialSchedules = [],
  } = options;

  const sessionActor = useOptionalSessionActor();
  const rawGetAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const hasAuthSource = Boolean(rawGetAccessToken);

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

  const fetchFn = options.fetchFn;

  // Stable port instance: use provided or default to HttpAssignmentsAdapter
  const port = useMemo(
    () =>
      options.port ??
      new HttpAssignmentsAdapter({
        getAccessToken: stableGetAccessToken,
        baseUrl,
        fetchFn,
      }),
    [options.port, stableGetAccessToken, baseUrl, fetchFn],
  );

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
      initialSchedules,
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
  const [services, setServices] = useState<readonly ServiceCatalogItemDto[]>([]);
  const [serviceReloads, setServiceReloads] = useState(0);

  useEffect(() => {
    let active = true;
    if (typeof port.listServices === 'function') {
      port.listServices(role)
        .then((items) => {
          if (active) setServices(items);
        })
        .catch(() => {
          // ignore or fallback
        });
    }
    return () => {
      active = false;
    };
  }, [port, role, serviceReloads]);

  /** Loads the pickers' service list again, after the firm's service list changed. */
  const reloadServices = useCallback((): void => {
    setServiceReloads((value) => value + 1);
  }, []);

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

  // Rebind port to coordinator when auth token source hydrates or port changes
  useEffect(() => {
    coordinator.setPort(port);
  }, [coordinator, port]);

  // Sync / switch role whenever role changes
  useEffect(() => {
    void coordinator.switchRole(role);
  }, [coordinator, role]);

  const handleCreateAssignment = useCallback(
    async (
      commandOrRow: AssignmentRow | CreateAssignmentCommand,
    ): Promise<AssignmentRow | undefined> => {
      const res = await coordinator.handleCreateAssignment(commandOrRow);
      if (!res.success) {
        throw (
          res.error ??
          new AssignmentOperationError({
            code: 'unexpected',
            message: 'Failed to create assignment.',
          })
        );
      }
      return res.row;
    },
    [coordinator],
  );

  const handleUpdateAssignment = useCallback(
    async (updated: AssignmentRow): Promise<AssignmentRow | undefined> => {
      const res = await coordinator.handleUpdateAssignment(updated);
      if (!res.success) {
        throw (
          res.error ??
          new AssignmentOperationError({
            code: 'unexpected',
            message: 'Failed to update assignment.',
          })
        );
      }
      return res.row;
    },
    [coordinator],
  );

  const handlePatchAssignment = useCallback(
    async (
      id: string,
      patch: import('./types').UpdateAssignmentPatch,
    ): Promise<AssignmentRow | undefined> => {
      const res = await coordinator.handlePatchAssignment(id, patch);
      if (!res.success) {
        throw (
          res.error ??
          new AssignmentOperationError({
            code: 'unexpected',
            message: 'Failed to patch assignment.',
          })
        );
      }
      return res.row;
    },
    [coordinator],
  );

  const handleCreateSchedule = useCallback(
    async (
      command: CreateRecurringScheduleCommand,
    ): Promise<RecurringScheduleRecord | undefined> => {
      const res = await coordinator.handleCreateSchedule(command);
      if (!res.success) {
        throw (
          res.error ??
          new AssignmentOperationError({
            code: 'unexpected',
            message: 'Failed to create schedule.',
          })
        );
      }
      return res.schedule;
    },
    [coordinator],
  );

  const handleUpdateSchedule = useCallback(
    async (
      id: string,
      patch: UpdateRecurringSchedulePatch,
    ): Promise<RecurringScheduleRecord | undefined> => {
      const res = await coordinator.handleUpdateSchedule(id, patch);
      if (!res.success) {
        throw (
          res.error ??
          new AssignmentOperationError({
            code: 'unexpected',
            message: 'Failed to update schedule.',
          })
        );
      }
      return res.schedule;
    },
    [coordinator],
  );

  const generateDueAssignments = useCallback(
    async (
      genOptions?: { throughDate?: string },
    ): Promise<GenerateDueAssignmentsResult | undefined> => {
      try {
        const res = await coordinator.generateDueAssignments(genOptions);
        return res.result;
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
    schedules: isRoleStale ? [] : state.schedules,
    services,
    reloadServices,
    loading: isRoleStale ? true : state.loading,
    isGeneratingDue: state.isGeneratingDue ?? false,
    error: isRoleStale ? null : state.error,
    handleCreateAssignment,
    handleUpdateAssignment,
    handlePatchAssignment,
    handleCreateSchedule,
    handleUpdateSchedule,
    generateDueAssignments,
    cascadeClientFields,
    markAssignmentBilled,
    refresh,
  };
}
