// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { DeterministicTestServiceCatalogAdapter } from './test-service-catalog-adapter';
import { ServiceCatalogOperationError } from './service-catalog-types';
import { useServiceCatalog } from './use-service-catalog';

const gst: ServiceDto = {
  id: '50000000-0000-4000-a000-000000000001',
  name: 'GST Compliance',
  description: null,
  turnaroundDays: 7,
  isStatutory: true,
  isActive: true,
  usage: { assignments: 4, recurringSchedules: 2, engagements: 0 },
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

const trademark: ServiceDto = {
  ...gst,
  id: '50000000-0000-4000-a000-000000000007',
  name: 'Trademark',
  turnaroundDays: null,
  isStatutory: false,
  usage: { assignments: 0, recurringSchedules: 0, engagements: 0 },
};

describe('useServiceCatalog', () => {
  afterEach(() => {
    cleanup();
  });

  it('loads the full service list for the Founder', async () => {
    const port = new DeterministicTestServiceCatalogAdapter();
    port.setServicesResponse('founder', [gst, trademark]);

    const { result } = renderHook(() => useServiceCatalog('founder', { port }));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.services).toEqual([gst, trademark]);
    expect(port.calls).toEqual([expect.objectContaining({ role: 'founder' })]);
  });

  it.each(['manager', 'senior_staff', 'staff', 'trainee'] as const)('never loads anything for %s', async (role) => {
    const port = new DeterministicTestServiceCatalogAdapter();
    port.setServicesResponse(role, [gst]);

    const { result } = renderHook(() => useServiceCatalog(role, { port }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(0);
    expect(result.current.services).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not load when disabled', async () => {
    const port = new DeterministicTestServiceCatalogAdapter();
    const { result } = renderHook(() => useServiceCatalog('founder', { port, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('suppresses data synchronously when the role drops to one without access', async () => {
    const port = new DeterministicTestServiceCatalogAdapter();
    port.setServicesResponse('founder', [gst]);

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => useServiceCatalog(role, { port }),
      { initialProps: { role: 'founder' as CompanyRole } },
    );
    await waitFor(() => expect(result.current.services).toHaveLength(1));

    rerender({ role: 'manager' });
    expect(result.current.services).toEqual([]);
    expect(result.current.hasLiveSnapshot).toBe(false);
  });

  it('exposes a sanitized error and recovers on retry', async () => {
    const port = new DeterministicTestServiceCatalogAdapter();
    port.setDefaultError(new ServiceCatalogOperationError({ code: 'network', message: 'raw socket text 10.0.0.5' }));

    const { result } = renderHook(() => useServiceCatalog('founder', { port }));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.loading).toBe(false);
    expect(result.current.error?.code).toBe('network');
    expect(result.current.error?.message).toBe(
      'Unable to reach the server. Please check your network connection and try again.',
    );
    expect(result.current.error?.message).not.toContain('10.0.0.5');
    expect(result.current.services).toEqual([]);

    port.setDefaultError(undefined);
    port.setServicesResponse('founder', [gst]);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.services).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.hasLiveSnapshot).toBe(true);
  });

  it('keeps the last loaded services when a retry fails', async () => {
    const port = new DeterministicTestServiceCatalogAdapter();
    port.setServicesResponse('founder', [gst]);

    const { result } = renderHook(() => useServiceCatalog('founder', { port }));
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

    port.setDefaultError(new ServiceCatalogOperationError({ code: 'unexpected', message: 'boom' }));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.services).toHaveLength(1);
    expect(result.current.hasLiveSnapshot).toBe(true);
  });

  it('ignores a stale response that resolves after the role changed', async () => {
    const port = new DeterministicTestServiceCatalogAdapter();
    let releaseFounder: (value: ServiceDto[]) => void = () => undefined;
    port.enqueueDeferredServices(new Promise<ServiceDto[]>((resolve) => { releaseFounder = resolve; }));

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => useServiceCatalog(role, { port }),
      { initialProps: { role: 'founder' as CompanyRole } },
    );
    rerender({ role: 'manager' });
    await act(async () => {
      releaseFounder([gst]);
    });
    expect(result.current.services).toEqual([]);
  });
});

describe('useServiceCatalog mutations', () => {
  afterEach(() => {
    cleanup();
  });

  async function setup(role: CompanyRole = 'founder') {
    const port = new DeterministicTestServiceCatalogAdapter();
    port.setServicesResponse(role, [gst]);
    port.setMutationService(trademark);
    const hook = renderHook(() => useServiceCatalog(role, { port }));
    await waitFor(() => expect(hook.result.current.hasLiveSnapshot).toBe(true));
    return { port, ...hook };
  }

  it('creating a service sends the key and reloads the list', async () => {
    const { port, result } = await setup();
    const before = port.calls.length;
    port.setServicesResponse('founder', [gst, trademark]);
    let created: ServiceDto | undefined;
    await act(async () => {
      created = await result.current.createService({ name: 'Trademark' }, 'key-1');
    });
    expect(created).toEqual(trademark);
    expect(port.mutations).toEqual([
      { kind: 'create-service', role: 'founder', input: { name: 'Trademark' }, idempotencyKey: 'key-1' },
    ]);
    expect(port.calls.length).toBe(before + 1);
    expect(result.current.services).toEqual([gst, trademark]);
  });

  it('updating a service sends the id, the body and the key, then reloads the list', async () => {
    const { port, result } = await setup();
    const before = port.calls.length;
    const input = { isActive: false, expectedUpdatedAt: gst.updatedAt };
    await act(async () => {
      await result.current.updateService(gst.id, input, 'key-2');
    });
    expect(port.mutations).toEqual([
      { kind: 'update-service', role: 'founder', targetId: gst.id, input, idempotencyKey: 'key-2' },
    ]);
    expect(port.calls.length).toBe(before + 1);
  });

  it('a failed mutation throws a sanitized error and does not reload', async () => {
    const { port, result } = await setup();
    port.setMutationError(
      new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw stack', status: 409, serverCode: 'duplicate_service' }),
    );
    const before = port.calls.length;
    let caught: unknown;
    await act(async () => {
      caught = await result.current.createService({ name: 'GST Compliance' }, 'key-1').catch((err: unknown) => err);
    });
    expect(caught).toBeInstanceOf(ServiceCatalogOperationError);
    expect((caught as ServiceCatalogOperationError).serverCode).toBe('duplicate_service');
    expect((caught as ServiceCatalogOperationError).message).not.toContain('raw stack');
    expect(port.calls.length).toBe(before);
  });

  it.each(['manager', 'trainee'] as const)('refuses to mutate for %s without touching the port', async (role) => {
    const port = new DeterministicTestServiceCatalogAdapter();
    const { result } = renderHook(() => useServiceCatalog(role, { port }));
    let created: unknown;
    let updated: unknown;
    await act(async () => {
      created = await result.current.createService({ name: 'Trademark' }, 'key-1').catch((err: unknown) => err);
      updated = await result.current
        .updateService(gst.id, { isActive: false, expectedUpdatedAt: gst.updatedAt }, 'key-2')
        .catch((err: unknown) => err);
    });
    expect((created as ServiceCatalogOperationError).code).toBe('forbidden');
    expect((updated as ServiceCatalogOperationError).code).toBe('forbidden');
    expect(port.mutations).toHaveLength(0);
  });
});
