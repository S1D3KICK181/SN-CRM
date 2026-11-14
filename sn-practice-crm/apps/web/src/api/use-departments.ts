import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type {
  CreateDepartmentInput,
  DepartmentDto,
  SetDepartmentMembersInput,
  UpdateDepartmentInput,
} from '@sn/contracts';
import { useOptionalSessionActor } from '../shell/session-context';
import { HttpDepartmentsAdapter } from './http-departments-adapter';
import {
  DepartmentsOperationError,
  SAFE_DEPARTMENTS_ERROR_MESSAGES,
  sanitizeDepartmentsError,
  type DepartmentsPort,
} from './departments-types';

export interface UseDepartmentsOptions {
  readonly port?: DepartmentsPort;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

export interface UseDepartmentsResult {
  readonly departments: DepartmentDto[];
  readonly loading: boolean;
  readonly error: DepartmentsOperationError | null;
  readonly hasLiveSnapshot: boolean;
  readonly retry: () => void;
  /** Mutations throw a sanitized DepartmentsOperationError and reload the list on success. */
  readonly createDepartment: (input: CreateDepartmentInput, idempotencyKey: string) => Promise<DepartmentDto>;
  readonly updateDepartment: (
    departmentId: string,
    input: UpdateDepartmentInput,
    idempotencyKey: string,
  ) => Promise<DepartmentDto>;
  readonly setDepartmentMembers: (
    departmentId: string,
    input: SetDepartmentMembersInput,
    idempotencyKey: string,
  ) => Promise<DepartmentDto>;
}

interface DepartmentsSnapshot {
  readonly port: DepartmentsPort;
  readonly role: CompanyRole;
  readonly departments: DepartmentDto[];
  readonly loading: boolean;
  readonly error: DepartmentsOperationError | null;
  readonly hasLiveSnapshot: boolean;
}

const NO_DEPARTMENTS: DepartmentDto[] = [];

/** Trainees can be members but never see department views, so they never load the list. */
function mayReadDepartments(role: CompanyRole): boolean {
  return role !== 'trainee';
}

function mayManageDepartments(role: CompanyRole): boolean {
  return role === 'founder';
}

/**
 * The firm's departments, their members and the services filed under each. Every role except Trainee
 * loads the list (it drives the dashboard views); only the Founder may change it. Data loaded for one
 * role is never exposed to another (zero-frame suppression on role or port change).
 */
export function useDepartments(role: CompanyRole, options: UseDepartmentsOptions = {}): UseDepartmentsResult {
  const { enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpDepartmentsAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );

  const allowed = enabled && mayReadDepartments(role);
  const canManage = mayManageDepartments(role);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<DepartmentsSnapshot | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();

    setSnapshot((previous) => {
      const sameScope = previous !== null && previous.port === port && previous.role === role;
      return {
        port,
        role,
        departments: sameScope ? previous.departments : NO_DEPARTMENTS,
        loading: true,
        error: null,
        hasLiveSnapshot: sameScope ? previous.hasLiveSnapshot : false,
      };
    });

    port
      .listDepartments(role, { signal: controller.signal })
      .then((dtos) => {
        if (controller.signal.aborted) return;
        setSnapshot({ port, role, departments: dtos, loading: false, error: null, hasLiveSnapshot: true });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = sanitizeDepartmentsError(err);
        if (error.code === 'aborted') return;
        setSnapshot((previous) => {
          const sameScope = previous !== null && previous.port === port && previous.role === role;
          return {
            port,
            role,
            departments: sameScope ? previous.departments : NO_DEPARTMENTS,
            loading: false,
            error,
            hasLiveSnapshot: sameScope && previous.hasLiveSnapshot,
          };
        });
      });

    return () => controller.abort();
  }, [allowed, port, role, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const reload = useCallback(async () => {
    try {
      const dtos = await port.listDepartments(role);
      setSnapshot({ port, role, departments: dtos, loading: false, error: null, hasLiveSnapshot: true });
    } catch {
      // The change itself was saved; fall back to the normal reload so the list catches up.
      setAttempt((value) => value + 1);
    }
  }, [port, role]);

  const mutate = useCallback(
    async (run: () => Promise<DepartmentDto>): Promise<DepartmentDto> => {
      if (!allowed || !canManage) {
        throw new DepartmentsOperationError({
          code: 'forbidden',
          message: SAFE_DEPARTMENTS_ERROR_MESSAGES.forbidden,
        });
      }
      let result: DepartmentDto;
      try {
        result = await run();
      } catch (err: unknown) {
        throw sanitizeDepartmentsError(err);
      }
      await reload();
      return result;
    },
    [allowed, canManage, reload],
  );

  const createDepartment = useCallback(
    (input: CreateDepartmentInput, key: string) => mutate(() => port.createDepartment(role, input, key)),
    [mutate, port, role],
  );
  const updateDepartment = useCallback(
    (departmentId: string, input: UpdateDepartmentInput, key: string) =>
      mutate(() => port.updateDepartment(role, departmentId, input, key)),
    [mutate, port, role],
  );
  const setDepartmentMembers = useCallback(
    (departmentId: string, input: SetDepartmentMembersInput, key: string) =>
      mutate(() => port.setDepartmentMembers(role, departmentId, input, key)),
    [mutate, port, role],
  );
  const actions = { retry, createDepartment, updateDepartment, setDepartmentMembers };

  if (!allowed) {
    return { departments: NO_DEPARTMENTS, loading: false, error: null, hasLiveSnapshot: false, ...actions };
  }

  // Zero-frame privacy guard: a snapshot that belongs to another role or port is never shown.
  const current = snapshot !== null && snapshot.port === port && snapshot.role === role ? snapshot : null;
  if (!current) {
    return { departments: NO_DEPARTMENTS, loading: true, error: null, hasLiveSnapshot: false, ...actions };
  }

  return {
    departments: current.departments,
    loading: current.loading,
    error: current.error,
    hasLiveSnapshot: current.hasLiveSnapshot,
    ...actions,
  };
}
