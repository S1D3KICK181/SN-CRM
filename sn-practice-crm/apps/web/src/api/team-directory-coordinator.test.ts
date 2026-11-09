import { describe, expect, it, vi } from 'vitest';
import type { ReportingLineDto } from '@sn/contracts';
import { DeterministicTestTeamDirectoryAdapter } from './test-team-directory-adapter';
import { TeamDirectoryCoordinator } from './team-directory-coordinator';
import { TeamDirectoryOperationError } from './team-directory-types';

describe('TeamDirectoryCoordinator', () => {
  const lineFounder: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    },
    manager: null,
  };

  const lineManager: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    },
  };

  const lineStaff: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000004',
      name: 'Rohan Mehta',
      role: 'staff',
      reportsToId: '00000000-0000-4000-a000-000000000002',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
  };

  it('initializes with clean default state and updates after successful sync', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder, lineManager]);

    const coordinator = new TeamDirectoryCoordinator({ port, initialRole: 'founder' });
    expect(coordinator.getState()).toEqual({
      items: [],
      loading: false,
      error: null,
      role: 'founder',
      hasLiveSnapshot: false,
    });

    const listener = vi.fn();
    coordinator.subscribe(listener);

    await coordinator.sync();

    expect(coordinator.getState()).toEqual({
      items: [lineFounder, lineManager],
      loading: false,
      error: null,
      role: 'founder',
      hasLiveSnapshot: true,
    });
    expect(listener).toHaveBeenCalled();
  });

  it('handles sync failures non-destructively: preserves snapshot if present and notifies callbacks', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder]);

    const onToast = vi.fn();
    const onError = vi.fn();
    const coordinator = new TeamDirectoryCoordinator({
      port,
      initialRole: 'founder',
      onToast,
      onError,
    });

    await coordinator.sync();
    expect(coordinator.getState().items).toEqual([lineFounder]);
    expect(coordinator.getState().hasLiveSnapshot).toBe(true);

    // Now fail subsequent refresh
    port.setListError(
      'founder',
      new TeamDirectoryOperationError({
        code: 'network',
        message: 'Server connection dropped during refresh.',
      }),
    );

    await coordinator.sync();

    expect(coordinator.getState().items).toEqual([lineFounder]);
    expect(coordinator.getState().hasLiveSnapshot).toBe(true);
    expect(coordinator.getState().error?.code).toBe('network');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith(
      'Unable to reach the server. Please check your network connection and try again.',
    );
  });

  it('enforces zero-frame reset and aborts previous in-flight sync on role change', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setIgnoreAbortSignals(true); // Allow deferred promise to remain pending

    let resolveFounder!: (lines: ReportingLineDto[]) => void;
    const slowFounderPromise = new Promise<ReportingLineDto[]>((resolve) => {
      resolveFounder = resolve;
    });

    port.setDeferredList('founder', slowFounderPromise);
    port.setReportingLinesResponse('staff', [lineStaff]);

    const coordinator = new TeamDirectoryCoordinator({ port, initialRole: 'founder' });

    // Start sync as founder (will hang on slowFounderPromise)
    const syncPromise = coordinator.sync();
    expect(coordinator.getState().loading).toBe(true);

    // Switch role to staff
    const switchPromise = coordinator.setRole('staff');

    // Zero-frame reset must immediately clear items and reset live snapshot
    expect(coordinator.getState().items).toEqual([]);
    expect(coordinator.getState().hasLiveSnapshot).toBe(false);
    expect(coordinator.getState().role).toBe('staff');

    await switchPromise;

    // Staff items are loaded
    expect(coordinator.getState().items).toEqual([lineStaff]);
    expect(coordinator.getState().role).toBe('staff');

    // Late resolution of founder request must NOT overwrite staff
    resolveFounder([lineFounder]);
    await syncPromise;

    expect(coordinator.getState().items).toEqual([lineStaff]);
    expect(coordinator.getState().role).toBe('staff');
  });

  it('cancels pending requests and listener notifications on dispose', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    const slowPromise = new Promise<ReportingLineDto[]>(() => {});
    port.setDeferredList('founder', slowPromise);

    const listener = vi.fn();
    const coordinator = new TeamDirectoryCoordinator({ port, initialRole: 'founder' });
    coordinator.subscribe(listener);

    void coordinator.sync();
    coordinator.dispose();

    // After dispose, state remains frozen and no new listener calls fire
    const countBefore = listener.mock.calls.length;
    await coordinator.sync();
    expect(listener.mock.calls.length).toBe(countBefore);
  });

  it('does not toast on initial sync failure, but emits toast on refresh error when snapshot is live', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    const onToast = vi.fn();
    const onError = vi.fn();
    const coordinator = new TeamDirectoryCoordinator({
      port,
      initialRole: 'founder',
      onToast,
      onError,
    });

    // Initial sync failure: error in page, NO toast
    port.setListError('founder', new TeamDirectoryOperationError({ code: 'network', message: 'Failed' }));
    await coordinator.sync();

    expect(coordinator.getState().error?.code).toBe('network');
    expect(coordinator.getState().hasLiveSnapshot).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onToast).not.toHaveBeenCalled();

    // Now succeed to establish live snapshot
    port.clearListError('founder');
    port.setReportingLinesResponse('founder', [lineFounder]);
    await coordinator.sync();
    expect(coordinator.getState().hasLiveSnapshot).toBe(true);

    // Now fail refresh: toast MUST fire
    port.setListError('founder', new TeamDirectoryOperationError({ code: 'network', message: 'Failed again' }));
    await coordinator.sync();
    expect(onToast).toHaveBeenCalledTimes(1);
  });

  it('cancelPending cleanly settles loading state and notifies listeners', () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    const slowPromise = new Promise<ReportingLineDto[]>(() => {});
    port.setDeferredList('founder', slowPromise);

    const listener = vi.fn();
    const coordinator = new TeamDirectoryCoordinator({ port, initialRole: 'founder' });
    coordinator.subscribe(listener);

    void coordinator.sync();
    expect(coordinator.getState().loading).toBe(true);

    coordinator.cancelPending({ notify: true });
    expect(coordinator.getState().loading).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('guarantees that late success and late error after cancelPending cannot commit, notify, or toast', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setIgnoreAbortSignals(true); // Simulate abort-ignoring transport

    let resolveSlow!: (lines: ReportingLineDto[]) => void;
    let rejectSlow!: (err: Error) => void;

    // 1. Late success test
    const slowSuccessPromise = new Promise<ReportingLineDto[]>((res) => {
      resolveSlow = res;
    });
    port.setDeferredList('founder', slowSuccessPromise);

    const listener = vi.fn();
    const onToast = vi.fn();
    const onError = vi.fn();

    const coordinator = new TeamDirectoryCoordinator({
      port,
      initialRole: 'founder',
      onToast,
      onError,
    });
    coordinator.subscribe(listener);

    const sync1Promise = coordinator.sync();
    expect(coordinator.getState().loading).toBe(true);
    listener.mockClear();

    // Cancel pending without disposing
    coordinator.cancelPending({ notify: false });
    expect(coordinator.getState().loading).toBe(false);

    // Now resolve the old deferred promise late
    resolveSlow([lineFounder]);
    await sync1Promise;

    // Must NOT commit the late items or notify
    expect(coordinator.getState().items).toEqual([]);
    expect(coordinator.getState().hasLiveSnapshot).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    // 2. Late error test
    const slowErrorPromise = new Promise<ReportingLineDto[]>((_res, rej) => {
      rejectSlow = rej;
    });
    port.setDeferredList('founder', slowErrorPromise);

    const sync2Promise = coordinator.sync();
    expect(coordinator.getState().loading).toBe(true);

    coordinator.cancelPending({ notify: false });
    expect(coordinator.getState().loading).toBe(false);

    // Reject late
    rejectSlow(new TeamDirectoryOperationError({ code: 'network', message: 'Late network failure' }));
    await sync2Promise;

    // Must NOT commit error, nor toast, nor notify
    expect(coordinator.getState().error).toBeNull();
    expect(onToast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('remains replay-safe for React StrictMode: final sync commits cleanly while prior cancelled sync is discarded', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setIgnoreAbortSignals(true);

    let resolvePass1!: (lines: ReportingLineDto[]) => void;
    const pass1Promise = new Promise<ReportingLineDto[]>((res) => {
      resolvePass1 = res;
    });

    let resolvePass2!: (lines: ReportingLineDto[]) => void;
    const pass2Promise = new Promise<ReportingLineDto[]>((res) => {
      resolvePass2 = res;
    });

    // Pass 1: Mount
    port.setDeferredList('founder', pass1Promise);
    const coordinator = new TeamDirectoryCoordinator({ port, initialRole: 'founder' });
    const sync1 = coordinator.sync();

    // Pass 1: StrictMode unmount cleanup invokes cancelPending
    coordinator.cancelPending({ notify: false });

    // Pass 2: StrictMode remount re-triggers sync on the same coordinator session
    port.setDeferredList('founder', pass2Promise);
    const sync2 = coordinator.sync();
    expect(coordinator.getState().loading).toBe(true);

    // Resolve pass 1 late with outdated data
    resolvePass1([lineStaff]);
    await sync1;
    // Pass 1 was invalidated by cancelPending generation bump, so items remain empty
    expect(coordinator.getState().items).toEqual([]);

    // Now resolve pass 2 with current data
    resolvePass2([lineFounder, lineManager]);
    await sync2;

    expect(coordinator.getState().items).toEqual([lineFounder, lineManager]);
    expect(coordinator.getState().hasLiveSnapshot).toBe(true);
    expect(coordinator.getState().loading).toBe(false);
  });
});
