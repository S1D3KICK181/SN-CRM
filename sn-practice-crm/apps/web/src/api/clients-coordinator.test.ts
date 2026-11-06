import { describe, expect, it, vi } from 'vitest';
import type { ClientDto } from '@sn/contracts';
import { DeterministicTestClientsAdapter } from './test-clients-adapter';
import { ClientsCoordinator } from './clients-coordinator';
import { ClientOperationError } from './clients-types';

const SAMPLE_CLIENT_ASTER: ClientDto = {
  id: '10000000-0000-4000-a000-000000000001',
  code: 'CL-001001',
  displayName: 'Aster Foods',
  legalName: 'Aster Foods Private Limited',
  panMasked: '******1234',
  gstinMasked: '27**********1Z5',
  email: 'accounts@asterfoods.local',
  phone: '+91 98200 12345',
  relationshipOwnerId: '00000000-0000-4000-a000-000000000002',
  relationshipOwnerName: 'Priya Desai',
  status: 'active',
  notes: 'Corporate client',
  activeAssignmentsCount: 1,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

const SAMPLE_CLIENT_BLUEPEAK: ClientDto = {
  id: '10000000-0000-4000-a000-000000000002',
  code: 'CL-001002',
  displayName: 'BluePeak Technologies',
  legalName: 'BluePeak Technologies LLP',
  panMasked: '******2345',
  gstinMasked: '27**********1Z4',
  email: 'finance@bluepeak.local',
  phone: '+91 98200 23456',
  relationshipOwnerId: '00000000-0000-4000-a000-000000000004',
  relationshipOwnerName: 'Rohan Mehta',
  status: 'active',
  notes: 'IT services LLP',
  activeAssignmentsCount: 1,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

describe('ClientsCoordinator', () => {
  it('starts with empty items and no live snapshot (hasLiveSnapshot=false)', () => {
    const port = new DeterministicTestClientsAdapter();
    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

    const state = coordinator.getState();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.role).toBe('founder');
    expect(state.hasLiveSnapshot).toBe(false);
    expect(state.selectedClientId).toBeNull();
    expect(state.selectedDetail).toBeNull();
    expect(state.detailLoading).toBe(false);
    expect(state.detailError).toBeNull();
    expect(coordinator.getPort()).toBe(port);
  });

  it('sync() loads server snapshot, sets hasLiveSnapshot=true, and notifies listeners', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

    const listener = vi.fn();
    coordinator.subscribe(listener);

    await coordinator.sync();

    const state = coordinator.getState();
    expect(state.items).toEqual([SAMPLE_CLIENT_ASTER]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.hasLiveSnapshot).toBe(true);
    expect(listener).toHaveBeenCalled();
  });

  it('handles sync error and retry cleanly', async () => {
    const port = new DeterministicTestClientsAdapter();
    const networkErr = new ClientOperationError({ code: 'network', message: 'Failed to connect' });
    port.setListError('founder', networkErr);

    const onError = vi.fn();
    const onToast = vi.fn();
    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder', onError, onToast });

    await coordinator.sync();

    let state = coordinator.getState();
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.hasLiveSnapshot).toBe(false);
    expect(state.error).toBe(networkErr);
    expect(onError).toHaveBeenCalledWith(networkErr);
    expect(onToast).toHaveBeenCalledWith('Failed to connect');

    // Retry after fixing port response
    port.setListError('founder', null as any);
    port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);

    await coordinator.sync();

    state = coordinator.getState();
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([SAMPLE_CLIENT_ASTER]);
    expect(state.hasLiveSnapshot).toBe(true);
    expect(state.error).toBeNull();
  });

  it('synchronously clears list, detail, and live-snapshot on role switch before fetch settles', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_CLIENT_ASTER, SAMPLE_CLIENT_BLUEPEAK]);

    let resolveStaffList: (items: ClientDto[]) => void = () => {};
    const staffDeferred = new Promise<ClientDto[]>((resolve) => {
      resolveStaffList = resolve;
    });
    port.setDeferredList('staff', staffDeferred);

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
    await coordinator.sync();
    expect(coordinator.getState().items).toHaveLength(2);

    // Switch role to staff
    const switchPromise = coordinator.switchRole('staff');

    // Synchronously before fetch settles: items must be cleared and loading must be true
    const intermediateState = coordinator.getState();
    expect(intermediateState.role).toBe('staff');
    expect(intermediateState.items).toEqual([]);
    expect(intermediateState.hasLiveSnapshot).toBe(false);
    expect(intermediateState.loading).toBe(true);

    // Now resolve staff fetch
    resolveStaffList([SAMPLE_CLIENT_BLUEPEAK]);
    await switchPromise;

    const settledState = coordinator.getState();
    expect(settledState.role).toBe('staff');
    expect(settledState.items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
    expect(settledState.hasLiveSnapshot).toBe(true);
    expect(settledState.loading).toBe(false);
  });

  it('ignores late prior-role response when switching roles quickly even if abort signal is ignored', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true);

    let resolveFounderList: (items: ClientDto[]) => void = () => {};
    const founderDeferred = new Promise<ClientDto[]>((resolve) => {
      resolveFounderList = resolve;
    });
    port.setDeferredList('founder', founderDeferred);
    port.setListResponse('staff', [SAMPLE_CLIENT_BLUEPEAK]);

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
    void coordinator.sync();

    // While founder fetch is still in flight, switch to staff
    await coordinator.switchRole('staff');

    // Late resolve founder fetch
    resolveFounderList([SAMPLE_CLIENT_ASTER]);
    await Promise.resolve();

    // Coordinator must still show staff items, never founder items!
    const state = coordinator.getState();
    expect(state.role).toBe('staff');
    expect(state.items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
  });

  // Finding 3: True stale-success test for same-role repeated list loads
  it('prevents stale out-of-order success on repeated list loads for the same role even when abort is ignored', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true);

    let resolveFirstList: (items: ClientDto[]) => void = () => {};
    const firstListPromise = new Promise<ClientDto[]>((resolve) => {
      resolveFirstList = resolve;
    });

    let resolveSecondList: (items: ClientDto[]) => void = () => {};
    const secondListPromise = new Promise<ClientDto[]>((resolve) => {
      resolveSecondList = resolve;
    });

    port.enqueueDeferredList(firstListPromise, 'founder');
    port.enqueueDeferredList(secondListPromise, 'founder');

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

    // Request 1 starts (generation 1)
    const sync1 = coordinator.sync();
    // Request 2 starts (generation 2)
    const sync2 = coordinator.sync();

    // Newer request 2 resolves FIRST with [SAMPLE_CLIENT_BLUEPEAK]
    resolveSecondList([SAMPLE_CLIENT_BLUEPEAK]);
    await sync2;

    expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
    expect(coordinator.getState().loading).toBe(false);

    // Older request 1 resolves LATER with [SAMPLE_CLIENT_ASTER]
    resolveFirstList([SAMPLE_CLIENT_ASTER]);
    await sync1;

    // Generation guard must ensure older response does NOT overwrite newer state
    expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
  });

  it('selectClient fetches detail through port.get and updates selectedDetail', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setGetResponse(SAMPLE_CLIENT_ASTER.id, SAMPLE_CLIENT_ASTER);

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
    const selectPromise = coordinator.selectClient(SAMPLE_CLIENT_ASTER.id);

    // Synchronously loading
    expect(coordinator.getState().selectedClientId).toBe(SAMPLE_CLIENT_ASTER.id);
    expect(coordinator.getState().detailLoading).toBe(true);
    expect(coordinator.getState().selectedDetail).toBeNull();

    await selectPromise;

    const state = coordinator.getState();
    expect(state.selectedClientId).toBe(SAMPLE_CLIENT_ASTER.id);
    expect(state.selectedDetail).toEqual(SAMPLE_CLIENT_ASTER);
    expect(state.detailLoading).toBe(false);
    expect(state.detailError).toBeNull();
  });

  it('ignores stale detail response when client reselection occurs quickly even if abort is ignored', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true);

    let resolveFirstGet: (c: ClientDto) => void = () => {};
    const firstDeferred = new Promise<ClientDto>((resolve) => {
      resolveFirstGet = resolve;
    });
    port.setDeferredGet(SAMPLE_CLIENT_ASTER.id, firstDeferred);
    port.setGetResponse(SAMPLE_CLIENT_BLUEPEAK.id, SAMPLE_CLIENT_BLUEPEAK);

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

    // Select Aster (slow)
    void coordinator.selectClient(SAMPLE_CLIENT_ASTER.id);

    // Immediately select BluePeak (fast)
    await coordinator.selectClient(SAMPLE_CLIENT_BLUEPEAK.id);

    // Late resolve Aster
    resolveFirstGet(SAMPLE_CLIENT_ASTER);
    await Promise.resolve();

    const state = coordinator.getState();
    expect(state.selectedClientId).toBe(SAMPLE_CLIENT_BLUEPEAK.id);
    expect(state.selectedDetail).toEqual(SAMPLE_CLIENT_BLUEPEAK);
  });

  // Finding 3: True stale-success test for same-ID repeated detail loads
  it('prevents stale out-of-order success on repeated detail loads for the same ID even when abort is ignored', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true);

    const staleAster: ClientDto = { ...SAMPLE_CLIENT_ASTER, displayName: 'Aster Foods (Old Version)' };
    const freshAster: ClientDto = { ...SAMPLE_CLIENT_ASTER, displayName: 'Aster Foods (Updated Version)' };

    let resolveFirstDetail: (c: ClientDto) => void = () => {};
    const firstDetailPromise = new Promise<ClientDto>((resolve) => {
      resolveFirstDetail = resolve;
    });

    let resolveSecondDetail: (c: ClientDto) => void = () => {};
    const secondDetailPromise = new Promise<ClientDto>((resolve) => {
      resolveSecondDetail = resolve;
    });

    port.enqueueDeferredGet(firstDetailPromise, SAMPLE_CLIENT_ASTER.id);
    port.enqueueDeferredGet(secondDetailPromise, SAMPLE_CLIENT_ASTER.id);

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

    // Selection 1 starts (detailGeneration 1)
    const select1 = coordinator.selectClient(SAMPLE_CLIENT_ASTER.id);
    // Selection 2 starts (detailGeneration 2)
    const select2 = coordinator.selectClient(SAMPLE_CLIENT_ASTER.id);

    // Newer request 2 resolves FIRST
    resolveSecondDetail(freshAster);
    await select2;

    expect(coordinator.getState().selectedDetail).toEqual(freshAster);
    expect(coordinator.getState().detailLoading).toBe(false);

    // Older request 1 resolves LATER
    resolveFirstDetail(staleAster);
    await select1;

    // Detail generation guard must prevent older stale detail from overwriting newer detail
    expect(coordinator.getState().selectedDetail).toEqual(freshAster);
  });

  it('clearSelection aborts pending detail and resets detail state', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setGetResponse(SAMPLE_CLIENT_ASTER.id, SAMPLE_CLIENT_ASTER);

    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
    await coordinator.selectClient(SAMPLE_CLIENT_ASTER.id);
    expect(coordinator.getState().selectedDetail).toEqual(SAMPLE_CLIENT_ASTER);

    coordinator.clearSelection();

    const state = coordinator.getState();
    expect(state.selectedClientId).toBeNull();
    expect(state.selectedDetail).toBeNull();
    expect(state.detailLoading).toBe(false);
    expect(state.detailError).toBeNull();
  });

  it('handles 404 detail error without modifying the visible list snapshot', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('trainee', [SAMPLE_CLIENT_ASTER]);
    // BluePeak not configured on get -> port returns 404 not_found

    const coordinator = new ClientsCoordinator({ port, initialRole: 'trainee' });
    await coordinator.sync();
    expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_ASTER]);

    // Try to get BluePeak (hidden from trainee)
    await coordinator.selectClient('10000000-0000-4000-a000-000000000002');

    const state = coordinator.getState();
    expect(state.detailLoading).toBe(false);
    expect(state.selectedDetail).toBeNull();
    expect(state.detailError).not.toBeNull();
    expect(state.detailError?.code).toBe('not_found');
    // Crucial requirement: list items remain intact
    expect(state.items).toEqual([SAMPLE_CLIENT_ASTER]);
    expect(state.hasLiveSnapshot).toBe(true);
  });

  it('disposal aborts in-flight work and prevents further notifications', async () => {
    const port = new DeterministicTestClientsAdapter();
    const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

    const listener = vi.fn();
    coordinator.subscribe(listener);

    coordinator.dispose();
    expect(coordinator.isDisposed()).toBe(true);

    await coordinator.sync();
    await coordinator.selectClient('any');
    coordinator.clearSelection();

    expect(listener).not.toHaveBeenCalled();
  });
});
