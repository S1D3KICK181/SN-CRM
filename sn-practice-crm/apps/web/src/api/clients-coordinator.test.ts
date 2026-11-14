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
  pan: null,
  gstin: null,
  entityType: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  pincode: null,
  tan: null,
  cinLlpin: null,
  udyamNumber: null,
  iec: null,
  incorporationDate: null,
  contacts: [],
  canEdit: false,
  canChangeOwnerOrStatus: false,
  looksAfter: true,
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
  pan: null,
  gstin: null,
  entityType: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  pincode: null,
  tan: null,
  cinLlpin: null,
  udyamNumber: null,
  iec: null,
  incorporationDate: null,
  contacts: [],
  canEdit: false,
  canChangeOwnerOrStatus: false,
  looksAfter: true,
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

  describe('createClient mutation and concurrency invariants', () => {
    const NEW_CLIENT: ClientDto = {
      id: '90000000-0000-4000-a000-000000000099',
      code: 'CL-001099',
      displayName: 'Zenith Global Advisory',
      legalName: 'Zenith Global Advisory LLP',
      panMasked: '******9999',
      gstinMasked: '27**********9Z9',
      email: 'contact@zenith.in',
      phone: '9876543210',
      relationshipOwnerId: null,
      relationshipOwnerName: null,
      status: 'active',
      notes: 'New client record',
      activeAssignmentsCount: 0,
      pan: null,
      gstin: null,
      entityType: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      pincode: null,
      tan: null,
      cinLlpin: null,
      udyamNumber: null,
      iec: null,
      incorporationDate: null,
      contacts: [],
      canEdit: false,
      canChangeOwnerOrStatus: false,
      looksAfter: true,
      createdById: '00000000-0000-4000-a000-000000000001',
      createdAt: '2026-11-07T12:00:00.000Z',
      updatedAt: '2026-11-07T12:00:00.000Z',
    };

    it('successfully prepends and dedupes created client, sets hasLiveSnapshot, and notifies listeners', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      port.setCreateResponse(NEW_CLIENT);

      const onToast = vi.fn();
      const onError = vi.fn();
      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder', onToast, onError });

      await coordinator.sync();
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_ASTER]);

      const listener = vi.fn();
      coordinator.subscribe(listener);

      const created = await coordinator.createClient({
        displayName: 'Zenith Global Advisory',
        legalName: 'Zenith Global Advisory LLP',
        relationshipOwnerId: null,
      });

      expect(created).toEqual(NEW_CLIENT);
      const state = coordinator.getState();
      expect(state.items).toEqual([NEW_CLIENT, SAMPLE_CLIENT_ASTER]);
      expect(state.hasLiveSnapshot).toBe(true);
      expect(listener).toHaveBeenCalled();
      // Crucial: Coordinator does NOT produce a generic onToast or onError on create
      expect(onToast).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('prevents an in-flight list request from overwriting a newly created client', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true); // Simulate un-abortable or slow list response

      let resolveSlowList!: (items: ClientDto[]) => void;
      const slowListPromise = new Promise<ClientDto[]>((resolve) => {
        resolveSlowList = resolve;
      });
      port.enqueueDeferredList(slowListPromise, 'founder');
      port.setCreateResponse(NEW_CLIENT);

      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });

      // 1. In-flight list starts
      const listPromise = coordinator.sync();

      // 2. While list is in-flight, a create succeeds
      const createPromise = coordinator.createClient({
        displayName: 'Zenith Global Advisory',
      });
      const created = await createPromise;
      expect(created).toEqual(NEW_CLIENT);
      expect(coordinator.getState().items).toEqual([NEW_CLIENT]);

      // 3. Late list resolves with old Aster client
      resolveSlowList([SAMPLE_CLIENT_ASTER]);
      await listPromise;

      // Invalidation guard ensures the late list cannot wipe the newly created client
      expect(coordinator.getState().items).toEqual([NEW_CLIENT]);
    });

    it('propagates sanitized create error to caller without corrupting directory or emitting generic toast', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      const createErr = new ClientOperationError({
        code: 'validation',
        status: 422,
        serverCode: 'validation_failed',
        message: 'Invalid Indian PAN format with reflected identifier ABCDE1234F',
      });
      port.setCreateError(createErr);

      const onToast = vi.fn();
      const onError = vi.fn();
      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder', onToast, onError });
      await coordinator.sync();

      await expect(
        coordinator.createClient({ displayName: 'Bad PAN Client', pan: 'INVALID' }),
      ).rejects.toMatchObject({
        code: 'validation',
        message: 'The submitted client details could not be validated. Please check the entered fields.',
      });

      // Directory snapshot intact
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_ASTER]);
      expect(coordinator.getState().error).toBeNull();
      // No duplicate generic toast/error
      expect(onToast).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('suppresses stale rejected create after role switch, dispose, and replaced operation', async () => {
      // 1. Stale rejected create after role switch
      const port1 = new DeterministicTestClientsAdapter();
      port1.setIgnoreAbortSignals(true);
      port1.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      port1.setListResponse('staff', [SAMPLE_CLIENT_BLUEPEAK]);

      let rejectDeferredCreate1!: (err: Error) => void;
      const deferredCreatePromise1 = new Promise<ClientDto>((_, reject) => {
        rejectDeferredCreate1 = reject;
      });
      port1.setDeferredCreate(deferredCreatePromise1, 'founder');

      const onToast1 = vi.fn();
      const coordinator1 = new ClientsCoordinator({ port: port1, initialRole: 'founder', onToast: onToast1 });
      await coordinator1.sync();

      const createPromise1 = coordinator1.createClient({ displayName: 'Stale Error Client' });
      await coordinator1.switchRole('staff');

      rejectDeferredCreate1(new Error('Network or server failure'));
      const result1 = await createPromise1;
      expect(result1).toBeNull();
      expect(coordinator1.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
      expect(onToast1).not.toHaveBeenCalled();

      // 2. Stale rejected create after dispose
      const port2 = new DeterministicTestClientsAdapter();
      port2.setIgnoreAbortSignals(true);

      let rejectDeferredCreate2!: (err: Error) => void;
      const deferredCreatePromise2 = new Promise<ClientDto>((_, reject) => {
        rejectDeferredCreate2 = reject;
      });
      port2.setDeferredCreate(deferredCreatePromise2, 'founder');

      const coordinator2 = new ClientsCoordinator({ port: port2, initialRole: 'founder' });
      const createPromise2 = coordinator2.createClient({ displayName: 'Disposed Error Client' });

      coordinator2.dispose();
      rejectDeferredCreate2(new Error('Rejected after dispose'));
      const result2 = await createPromise2;
      expect(result2).toBeNull();

      // 3. Replaced/aborted operation: starting second create cancels first
      const port3 = new DeterministicTestClientsAdapter();
      port3.setIgnoreAbortSignals(true);

      let resolveCreateFirst!: (c: ClientDto) => void;
      const createFirstPromise = new Promise<ClientDto>((resolve) => {
        resolveCreateFirst = resolve;
      });
      port3.enqueueDeferredCreate(createFirstPromise, 'founder');
      port3.setCreateResponse(NEW_CLIENT);

      const coordinator3 = new ClientsCoordinator({ port: port3, initialRole: 'founder' });
      const firstCreate = coordinator3.createClient({ displayName: 'First Client' });
      const secondCreate = coordinator3.createClient({ displayName: 'Second Client' });

      const secondResult = await secondCreate;
      expect(secondResult).toEqual(NEW_CLIENT);

      resolveCreateFirst(SAMPLE_CLIENT_ASTER);
      const firstResult = await firstCreate;
      expect(firstResult).toBeNull();
    });

    it('reconciles with fresh committed server list post-create and ensures created client is authoritative', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      port.setCreateResponse(NEW_CLIENT);

      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
      await coordinator.sync();
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_ASTER]);

      // Create client
      const created = await coordinator.createClient({
        displayName: 'Zenith Global Advisory',
      });
      expect(created).toEqual(NEW_CLIENT);

      // Immediately prepended in state
      expect(coordinator.getState().items).toEqual([NEW_CLIENT, SAMPLE_CLIENT_ASTER]);

      // Post-create reconciliation: deterministic adapter truthfully updated list response with NEW_CLIENT
      // Wait for non-blocking reconciliation to complete
      await vi.waitFor(() => {
        expect(coordinator.getState().items).toEqual([NEW_CLIENT, SAMPLE_CLIENT_ASTER]);
        expect(coordinator.getState().error).toBeNull();
      });

      // Verify that a late pre-create list cannot overwrite post-create state
      expect(coordinator.getState().items[0]?.id).toBe(NEW_CLIENT.id);
    });

    it('cancels post-create reconciliation cleanly if role switches or coordinator is disposed', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true);
      port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      port.setListResponse('staff', [SAMPLE_CLIENT_BLUEPEAK]);
      port.setCreateResponse(NEW_CLIENT);

      let resolveReconciliationList!: (items: ClientDto[]) => void;
      const reconciliationListPromise = new Promise<ClientDto[]>((resolve) => {
        resolveReconciliationList = resolve;
      });

      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
      await coordinator.sync();

      // Configure next list (reconciliation) to be deferred
      port.setDeferredList('founder', reconciliationListPromise);

      await coordinator.createClient({ displayName: 'Zenith Global Advisory' });

      // Immediate state has newly created client
      expect(coordinator.getState().items[0]?.id).toBe(NEW_CLIENT.id);

      // Switch role to staff while reconciliation is pending
      await coordinator.switchRole('staff');
      expect(coordinator.getState().role).toBe('staff');
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);

      // Reconciliation resolves late
      resolveReconciliationList([NEW_CLIENT, SAMPLE_CLIENT_ASTER]);

      // Role isolation: founder reconciliation must not leak into staff
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
    });

    it('handles reconciliation failure non-destructively: preserves created client snapshot and triggers refresh warning', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      port.setCreateResponse(NEW_CLIENT);

      const onToast = vi.fn();
      const onError = vi.fn();
      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder', onToast, onError });
      await coordinator.sync();
      expect(onError).not.toHaveBeenCalled();
      expect(onToast).not.toHaveBeenCalled();

      // Set port list error for the subsequent reconciliation list call
      port.setListError(
        'founder',
        new ClientOperationError({
          code: 'network',
          message: 'Server connection dropped during refresh.',
        }),
      );

      // Create succeeds
      const created = await coordinator.createClient({ displayName: 'Zenith Global Advisory' });
      expect(created).toEqual(NEW_CLIENT);

      // Created snapshot is immediately live
      expect(coordinator.getState().items).toEqual([NEW_CLIENT, SAMPLE_CLIENT_ASTER]);

      // Await reconciliation failure handling
      await vi.waitFor(() => {
        expect(coordinator.getState().error?.code).toBe('network');
      });

      // Crucial: Items snapshot is PRESERVED, hasLiveSnapshot remains true
      expect(coordinator.getState().items).toEqual([NEW_CLIENT, SAMPLE_CLIENT_ASTER]);
      expect(coordinator.getState().hasLiveSnapshot).toBe(true);

      // Parity check: exactly one onError and one refresh-error toast fire
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'network',
          message: 'Server connection dropped during refresh.',
        }),
      );
      expect(onToast).toHaveBeenCalledTimes(1);
      expect(onToast).toHaveBeenCalledWith('Server connection dropped during refresh.');
    });

    it('suppresses create completion and returns null when role is switched while in-flight', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true);
      port.setListResponse('founder', [SAMPLE_CLIENT_ASTER]);
      port.setListResponse('staff', [SAMPLE_CLIENT_BLUEPEAK]);

      let resolveDeferredCreate!: (c: ClientDto) => void;
      const deferredCreatePromise = new Promise<ClientDto>((resolve) => {
        resolveDeferredCreate = resolve;
      });
      port.setDeferredCreate(deferredCreatePromise, 'founder');

      const onToast = vi.fn();
      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder', onToast });
      await coordinator.sync();

      // Start create under founder
      const createPromise = coordinator.createClient({ displayName: 'Founder Only Client' });

      // Role switches to staff immediately
      await coordinator.switchRole('staff');
      expect(coordinator.getState().role).toBe('staff');
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);

      // Stale create resolves later
      resolveDeferredCreate(NEW_CLIENT);
      const result = await createPromise;

      // Stale completion must be suppressed: returns null, items unaltered, no toast
      expect(result).toBeNull();
      expect(coordinator.getState().items).toEqual([SAMPLE_CLIENT_BLUEPEAK]);
      expect(onToast).not.toHaveBeenCalled();
    });

    it('suppresses create completion and returns null when coordinator is disposed while in-flight', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true);

      let resolveDeferredCreate!: (c: ClientDto) => void;
      const deferredCreatePromise = new Promise<ClientDto>((resolve) => {
        resolveDeferredCreate = resolve;
      });
      port.setDeferredCreate(deferredCreatePromise, 'founder');

      const coordinator = new ClientsCoordinator({ port, initialRole: 'founder' });
      const createPromise = coordinator.createClient({ displayName: 'Disposed Client' });

      coordinator.dispose();
      resolveDeferredCreate(NEW_CLIENT);
      const result = await createPromise;

      expect(result).toBeNull();
      expect(coordinator.getState().items).toEqual([]);
    });
  });

  describe('client and contact changes', () => {
    const CONTACT = {
      id: '70000000-0000-4000-a000-000000000001',
      name: 'Priya Nair',
      designation: null,
      email: 'priya@asterfoods.local',
      phone: null,
      whatsapp: null,
      isPrimary: false,
      notes: null,
      updatedAt: '2026-11-13T10:00:00.000Z',
    };
    const EDITABLE: ClientDto = { ...SAMPLE_CLIENT_ASTER, canEdit: true, canChangeOwnerOrStatus: true };

    async function openClient(role: 'founder' | 'staff' = 'founder') {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse(role, [EDITABLE, SAMPLE_CLIENT_BLUEPEAK]);
      port.setGetResponse(EDITABLE.id, EDITABLE);
      const onToast = vi.fn();
      const coordinator = new ClientsCoordinator({ port, initialRole: role, onToast });
      await coordinator.sync();
      await coordinator.selectClient(EDITABLE.id);
      port.calls.length = 0;
      return { port, coordinator, onToast };
    }

    it('updates a client, then refreshes the open client and the list', async () => {
      const { port, coordinator } = await openClient();

      const updated = await coordinator.updateClient(
        EDITABLE.id,
        { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt },
        'key-1',
      );

      expect(updated?.city).toBe('Pune');
      const actions = port.calls.map((call) => call.action);
      expect(actions[0]).toBe('updateClient');
      expect(actions).toContain('get');
      expect(actions).toContain('list');
      expect(port.calls[0]).toMatchObject({
        id: EDITABLE.id,
        idempotencyKey: 'key-1',
        changes: { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt },
      });
      const state = coordinator.getState();
      expect(state.selectedDetail?.city).toBe('Pune');
      expect(state.items.find((item) => item.id === EDITABLE.id)?.city).toBe('Pune');
      expect(state.detailLoading).toBe(false);
    });

    it('never blanks the drawer while the open client reloads', async () => {
      const { port, coordinator } = await openClient();
      const seen: Array<ClientDto | null> = [];
      coordinator.subscribe(() => seen.push(coordinator.getState().selectedDetail));

      await coordinator.updateClient(EDITABLE.id, { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt }, 'key-1');

      expect(port.calls.some((call) => call.action === 'get')).toBe(true);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((detail) => detail !== null)).toBe(true);
    });

    it('creates, updates and removes a contact, refreshing the open client each time', async () => {
      const { port, coordinator } = await openClient();
      port.setContactResponse(CONTACT);

      const created = await coordinator.createContact(EDITABLE.id, { name: 'Priya Nair' }, 'key-2');
      expect(created).toEqual(CONTACT);
      expect(port.calls.map((call) => call.action)).toEqual(
        expect.arrayContaining(['createContact', 'get', 'list']),
      );

      port.calls.length = 0;
      await coordinator.updateContact(
        CONTACT.id,
        { designation: 'Director', expectedUpdatedAt: CONTACT.updatedAt },
        'key-3',
      );
      expect(port.calls[0]).toMatchObject({ action: 'updateContact', id: CONTACT.id, idempotencyKey: 'key-3' });
      expect(port.calls.map((call) => call.action)).toEqual(expect.arrayContaining(['get', 'list']));

      port.calls.length = 0;
      await expect(coordinator.deleteContact(CONTACT.id)).resolves.toBe(true);
      expect(port.calls[0]).toMatchObject({ action: 'deleteContact', id: CONTACT.id });
      expect(port.calls.map((call) => call.action)).toEqual(expect.arrayContaining(['get', 'list']));
    });

    it.each([
      ['stale_client', 'This client was changed by someone else. Reload and try again.'],
      ['stale_contact', 'This contact was changed by someone else. Reload and try again.'],
    ])('rethrows %s as safe copy and reloads the open client in the background', async (serverCode, message) => {
      const { port, coordinator, onToast } = await openClient();
      port.setUpdateClientError(
        new ClientOperationError({ code: 'conflict', message: 'raw ABCDE1234F', status: 409, serverCode }),
      );

      const error = await coordinator
        .updateClient(EDITABLE.id, { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt }, 'key-1')
        .then(
          () => null,
          (err: unknown) => err,
        );

      expect(error).toBeInstanceOf(ClientOperationError);
      expect(error).toMatchObject({ code: 'conflict', serverCode, message });
      await vi.waitFor(() => {
        const actions = port.calls.map((call) => call.action);
        expect(actions).toContain('get');
        expect(actions).toContain('list');
      });
      expect(onToast).not.toHaveBeenCalled();
    });

    it('rethrows a 403 as the permission copy without refreshing', async () => {
      const { port, coordinator } = await openClient('staff');
      port.setContactError(new ClientOperationError({ code: 'forbidden', message: 'raw', status: 403 }));

      await expect(coordinator.createContact(EDITABLE.id, { name: 'Priya Nair' }, 'key-2')).rejects.toMatchObject({
        code: 'forbidden',
        message: "You don't have permission to do this.",
      });
      expect(port.calls.map((call) => call.action)).toEqual(['createContact']);
    });

    it('rethrows a failed removal as safe copy', async () => {
      const { port, coordinator } = await openClient();
      port.setDeleteContactError(new ClientOperationError({ code: 'not_found', message: 'raw', status: 404 }));

      await expect(coordinator.deleteContact(CONTACT.id)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('returns null and does nothing once disposed, or when the role changes mid-flight', async () => {
      const { port, coordinator } = await openClient();
      coordinator.dispose();
      await expect(
        coordinator.updateClient(EDITABLE.id, { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt }, 'key-1'),
      ).resolves.toBeNull();
      expect(port.calls).toEqual([]);

      const second = await openClient();
      const pending = second.coordinator.updateClient(
        EDITABLE.id,
        { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt },
        'key-1',
      );
      await second.coordinator.switchRole('manager');
      await expect(pending).resolves.toBeNull();
      expect(second.coordinator.getState().selectedDetail).toBeNull();
    });
  });
});
