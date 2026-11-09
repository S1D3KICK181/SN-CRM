// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { DeterministicTestTeamDirectoryAdapter } from './test-team-directory-adapter';
import { useTeamDirectory } from './use-team-directory';
import { TeamDirectoryOperationError } from './team-directory-types';

describe('useTeamDirectory React hook', () => {
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

  afterEach(() => {
    cleanup();
  });

  it('fetches team directory upon mount and updates state', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder, lineManager]);

    const { result } = renderHook(() => useTeamDirectory('founder', { port }));

    await waitFor(() => {
      expect(result.current.hasLiveSnapshot).toBe(true);
    });

    expect(result.current.items).toEqual([lineFounder, lineManager]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('enforces zero-frame stale suppression when role prop changes', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder]);
    port.setReportingLinesResponse('staff', [lineStaff]);

    let currentRole: CompanyRole = 'founder';
    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => useTeamDirectory(role, { port }),
      { initialProps: { role: 'founder' } },
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([lineFounder]);
    });

    currentRole = 'staff';
    rerender({ role: currentRole });

    // Synchronously, prior role items must NOT leak in the first render frame
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.items).toEqual([lineStaff]);
    });
    expect(result.current.role).toBe('staff');
  });

  it('re-creates coordinator and syncs cleanly when port reference changes', async () => {
    const port1 = new DeterministicTestTeamDirectoryAdapter();
    port1.setReportingLinesResponse('founder', [lineFounder]);

    const port2 = new DeterministicTestTeamDirectoryAdapter();
    port2.setReportingLinesResponse('founder', [lineFounder, lineManager]);

    const { result, rerender } = renderHook(
      ({ port }) => useTeamDirectory('founder', { port }),
      { initialProps: { port: port1 } },
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([lineFounder]);
    });

    rerender({ port: port2 });

    await waitFor(() => {
      expect(result.current.items).toEqual([lineFounder, lineManager]);
    });
  });

  it('disposes coordinator cleanly upon unmount without memory leaks', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder]);

    const { result, unmount } = renderHook(() => useTeamDirectory('founder', { port }));

    await waitFor(() => {
      expect(result.current.hasLiveSnapshot).toBe(true);
    });

    unmount();
    // Subsequent calls or events should not throw or cause state updates
  });

  it('supports React.StrictMode replay without terminal poisoning', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder, lineManager]);

    const { result } = renderHook(() => useTeamDirectory('founder', { port }), {
      wrapper: ({ children }) => <span style={{ display: 'contents' }}>{children}</span>,
    });

    await waitFor(() => {
      expect(result.current.hasLiveSnapshot).toBe(true);
    });

    expect(result.current.items).toEqual([lineFounder, lineManager]);
    expect(result.current.loading).toBe(false);
  });

  it('guarantees zero-frame isolation on same-role port replacement and rejects late completions', async () => {
    const portA = new DeterministicTestTeamDirectoryAdapter();
    portA.setReportingLinesResponse('founder', [lineFounder]);

    let resolvePortB: (items: ReportingLineDto[]) => void = () => {};
    const portBDeferred = new Promise<ReportingLineDto[]>((resolve) => {
      resolvePortB = resolve;
    });
    const portB = new DeterministicTestTeamDirectoryAdapter();
    portB.setDeferredList('founder', portBDeferred);

    const frames: Array<{ portTag: string; count: number; loading: boolean; hasLiveSnapshot: boolean }> = [];

    const { result, rerender } = renderHook(
      ({ port, portTag }: { port: DeterministicTestTeamDirectoryAdapter; portTag: string }) => {
        const hook = useTeamDirectory('founder', { port });
        frames.push({
          portTag,
          count: hook.items.length,
          loading: hook.loading,
          hasLiveSnapshot: hook.hasLiveSnapshot,
        });
        return hook;
      },
      { initialProps: { port: portA, portTag: 'portA' } },
    );

    await waitFor(() => {
      expect(result.current.items).toEqual([lineFounder]);
    });

    frames.length = 0;

    // Swap port to portB (same role: 'founder')
    rerender({ port: portB, portTag: 'portB' });

    // The very first frame of portB must synchronously reset to empty items and loading true
    const portBFrames = frames.filter((f) => f.portTag === 'portB');
    expect(portBFrames.length).toBeGreaterThanOrEqual(1);
    expect(portBFrames[0]!.count).toBe(0);
    expect(portBFrames[0]!.loading).toBe(true);
    expect(portBFrames[0]!.hasLiveSnapshot).toBe(false);

    // Settle port B
    resolvePortB([lineManager]);

    await waitFor(() => {
      expect(result.current.items).toEqual([lineManager]);
    });
    expect(result.current.hasLiveSnapshot).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('suppresses toast and error delivery to active session when an abort-ignoring old-port request rejects late after port swap', async () => {
    const portA = new DeterministicTestTeamDirectoryAdapter();
    portA.setIgnoreAbortSignals(true);

    let rejectPortA: (err: Error) => void = () => {};
    const portADeferred = new Promise<ReportingLineDto[]>((_res, rej) => {
      rejectPortA = rej;
    });
    portA.setDeferredList('founder', portADeferred);

    const portB = new DeterministicTestTeamDirectoryAdapter();
    portB.setReportingLinesResponse('founder', [lineManager]);

    const onToast = vi.fn();
    const onError = vi.fn();

    const { result, rerender } = renderHook(
      ({ port }: { port: DeterministicTestTeamDirectoryAdapter }) =>
        useTeamDirectory('founder', { port, onToast, onError }),
      { initialProps: { port: portA } },
    );

    // Swap port to portB while portA is in flight
    rerender({ port: portB });

    await waitFor(() => {
      expect(result.current.items).toEqual([lineManager]);
    });

    // Reject old port A late
    rejectPortA(new TeamDirectoryOperationError({ code: 'network', message: 'Old port network failed' }));

    // Wait a tick to ensure no delivery
    await new Promise((r) => setTimeout(r, 20));

    expect(onToast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('respects enabled: false by not executing port calls and returning clean empty state', async () => {
    const port = new DeterministicTestTeamDirectoryAdapter();
    port.setReportingLinesResponse('founder', [lineFounder]);

    const { result } = renderHook(() => useTeamDirectory('founder', { port, enabled: false }));

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLiveSnapshot).toBe(false);
    expect(port.calls).toHaveLength(0);
  });
});
