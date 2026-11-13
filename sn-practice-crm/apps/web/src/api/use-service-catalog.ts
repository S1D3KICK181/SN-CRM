import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { CreateServiceInput, ServiceDto, UpdateServiceInput } from '@sn/contracts';
import { useOptionalSessionActor } from '../shell/session-context';
import { HttpServiceCatalogAdapter } from './http-service-catalog-adapter';
import {
  SAFE_SERVICE_CATALOG_ERROR_MESSAGES,
  ServiceCatalogOperationError,
  sanitizeServiceCatalogError,
  type ServiceCatalogPort,
} from './service-catalog-types';

export interface UseServiceCatalogOptions {
  readonly port?: ServiceCatalogPort;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

export interface UseServiceCatalogResult {
  readonly services: ServiceDto[];
  readonly loading: boolean;
  readonly error: ServiceCatalogOperationError | null;
  readonly hasLiveSnapshot: boolean;
  readonly retry: () => void;
  /** Mutations throw a sanitized ServiceCatalogOperationError and reload the list on success. */
  readonly createService: (input: CreateServiceInput, idempotencyKey: string) => Promise<ServiceDto>;
  readonly updateService: (
    serviceId: string,
    input: UpdateServiceInput,
    idempotencyKey: string,
  ) => Promise<ServiceDto>;
}

interface ServiceCatalogSnapshot {
  readonly port: ServiceCatalogPort;
  readonly role: CompanyRole;
  readonly services: ServiceDto[];
  readonly loading: boolean;
  readonly error: ServiceCatalogOperationError | null;
  readonly hasLiveSnapshot: boolean;
}

const NO_SERVICES: ServiceDto[] = [];

function mayManageServices(role: CompanyRole): boolean {
  return role === 'founder';
}

/**
 * The firm's full service list and its changes. Only the Founder loads; every other role gets an
 * empty list and never triggers a request. Data loaded for one role is never exposed to another
 * (zero-frame suppression on role or port change).
 */
export function useServiceCatalog(role: CompanyRole, options: UseServiceCatalogOptions = {}): UseServiceCatalogResult {
  const { enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpServiceCatalogAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );

  const allowed = enabled && mayManageServices(role);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<ServiceCatalogSnapshot | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();

    setSnapshot((previous) => {
      const sameScope = previous !== null && previous.port === port && previous.role === role;
      return {
        port,
        role,
        services: sameScope ? previous.services : NO_SERVICES,
        loading: true,
        error: null,
        hasLiveSnapshot: sameScope ? previous.hasLiveSnapshot : false,
      };
    });

    port
      .listServiceCatalog(role, { signal: controller.signal })
      .then((dtos) => {
        if (controller.signal.aborted) return;
        setSnapshot({ port, role, services: dtos, loading: false, error: null, hasLiveSnapshot: true });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = sanitizeServiceCatalogError(err);
        if (error.code === 'aborted') return;
        setSnapshot((previous) => {
          const sameScope = previous !== null && previous.port === port && previous.role === role;
          return {
            port,
            role,
            services: sameScope ? previous.services : NO_SERVICES,
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
      const dtos = await port.listServiceCatalog(role);
      setSnapshot({ port, role, services: dtos, loading: false, error: null, hasLiveSnapshot: true });
    } catch {
      // The change itself was saved; fall back to the normal reload so the list catches up.
      setAttempt((value) => value + 1);
    }
  }, [port, role]);

  const mutate = useCallback(
    async (run: () => Promise<ServiceDto>): Promise<ServiceDto> => {
      if (!allowed) {
        throw new ServiceCatalogOperationError({
          code: 'forbidden',
          message: SAFE_SERVICE_CATALOG_ERROR_MESSAGES.forbidden,
        });
      }
      let result: ServiceDto;
      try {
        result = await run();
      } catch (err: unknown) {
        throw sanitizeServiceCatalogError(err);
      }
      await reload();
      return result;
    },
    [allowed, reload],
  );

  const createService = useCallback(
    (input: CreateServiceInput, key: string) => mutate(() => port.createService(role, input, key)),
    [mutate, port, role],
  );
  const updateService = useCallback(
    (serviceId: string, input: UpdateServiceInput, key: string) =>
      mutate(() => port.updateService(role, serviceId, input, key)),
    [mutate, port, role],
  );
  const actions = { retry, createService, updateService };

  if (!allowed) {
    return { services: NO_SERVICES, loading: false, error: null, hasLiveSnapshot: false, ...actions };
  }

  // Zero-frame privacy guard: a snapshot that belongs to another role or port is never shown.
  const current = snapshot !== null && snapshot.port === port && snapshot.role === role ? snapshot : null;
  if (!current) {
    return { services: NO_SERVICES, loading: true, error: null, hasLiveSnapshot: false, ...actions };
  }

  return {
    services: current.services,
    loading: current.loading,
    error: current.error,
    hasLiveSnapshot: current.hasLiveSnapshot,
    ...actions,
  };
}
