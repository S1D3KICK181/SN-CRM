// @vitest-environment jsdom
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ClientDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { DeterministicTestClientsAdapter } from './test-clients-adapter';
import { useClients } from './use-clients';
import { ClientOperationError } from './clients-types';

afterEach(() => {
  cleanup();
});

const SAMPLE_ASTER: ClientDto = {
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

const SAMPLE_BLUEPEAK: ClientDto = {
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

describe('useClients React hook', () => {
  it('syncs on mount and exposes loaded clients', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_ASTER, SAMPLE_BLUEPEAK]);

    const { result } = renderHook(() => useClients('founder', { port }));

    await act(async () => {
      // allow mount effect to settle
    });

    expect(result.current.items).toEqual([SAMPLE_ASTER, SAMPLE_BLUEPEAK]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLiveSnapshot).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('loads through the HTTP adapter with the signed-in session token, not the demo header', async () => {
    const seen: Headers[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response(JSON.stringify({ data: [SAMPLE_ASTER] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { result } = renderHook(() =>
        useClients('founder', { getAccessToken: () => 'jwt-session', baseUrl: '' }),
      );

      await waitFor(() => expect(result.current.items).toEqual([SAMPLE_ASTER]));
      expect(seen.length).toBeGreaterThan(0);
      for (const headers of seen) {
        expect(headers.get('authorization')).toBe('Bearer jwt-session');
        expect(headers.get('x-demo-user-id')).toBeNull();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // FIX 1: Real React.StrictMode wrapper test
  it('supports React.StrictMode replay without terminal poisoning: loads data on final sync', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_ASTER, SAMPLE_BLUEPEAK]);

    const { result } = renderHook(() => useClients('founder', { port }), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });

    await act(async () => {
      // allow StrictMode setup -> cleanup -> setup replay to settle
    });

    expect(result.current.items).toEqual([SAMPLE_ASTER, SAMPLE_BLUEPEAK]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasLiveSnapshot).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('guarantees zero-frame role privacy: synchronously exposes empty list when role prop changes before fetch settles', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_ASTER, SAMPLE_BLUEPEAK]);

    let resolveStaff: (items: ClientDto[]) => void = () => {};
    const staffDeferred = new Promise<ClientDto[]>((resolve) => {
      resolveStaff = resolve;
    });
    port.setDeferredList('staff', staffDeferred);

    const renderFrames: Array<{
      role: CompanyRole;
      itemsCount: number;
      loading: boolean;
      hasLiveSnapshot: boolean;
    }> = [];

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => {
        const hook = useClients(role, { port });
        renderFrames.push({
          role,
          itemsCount: hook.items.length,
          loading: hook.loading,
          hasLiveSnapshot: hook.hasLiveSnapshot,
        });
        return hook;
      },
      {
        initialProps: { role: 'founder' as CompanyRole },
      },
    );

    await act(async () => {
      // founder sync settles
    });

    expect(result.current.items).toHaveLength(2);
    renderFrames.length = 0; // reset frame recording

    // Switch role to staff
    act(() => {
      rerender({ role: 'staff' });
    });

    // In ALL rendered frames for staff, prior founder data must NEVER appear
    const staffFramesBeforeSettling = renderFrames.filter((f) => f.role === 'staff');
    expect(staffFramesBeforeSettling.length).toBeGreaterThanOrEqual(1);
    for (const frame of staffFramesBeforeSettling) {
      expect(frame.itemsCount).toBe(0);
      expect(frame.hasLiveSnapshot).toBe(false);
    }

    // Now resolve staff fetch
    await act(async () => {
      resolveStaff([SAMPLE_BLUEPEAK]);
    });

    expect(result.current.role).toBe('staff');
    expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    expect(result.current.hasLiveSnapshot).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  // STRENGTHENED TEST: Same-role port replacement with real loaded data + in-flight refresh
  it('guarantees zero-frame privacy on same-role port replacement: when replacing port while real loaded data & in-flight refresh are active, synchronously hides all old state and rejects late old completions', async () => {
    const portA = new DeterministicTestClientsAdapter();
    portA.setListResponse('founder', [SAMPLE_ASTER]);
    portA.setGetResponse(SAMPLE_ASTER.id, SAMPLE_ASTER);

    const renderedSnapshots: Array<{
      activePort: string;
      itemsCount: number;
      selectedClientId: string | null;
      selectedDetail: ClientDto | null;
      loading: boolean;
      error: unknown;
      detailError: unknown;
      hasLiveSnapshot: boolean;
    }> = [];

    const { result, rerender } = renderHook(
      ({ port, portTag }: { port: DeterministicTestClientsAdapter; portTag: string }) => {
        const hook = useClients('founder', { port });
        renderedSnapshots.push({
          activePort: portTag,
          itemsCount: hook.items.length,
          selectedClientId: hook.selectedClientId,
          selectedDetail: hook.selectedDetail,
          loading: hook.loading,
          error: hook.error,
          detailError: hook.detailError,
          hasLiveSnapshot: hook.hasLiveSnapshot,
        });
        return hook;
      },
      {
        initialProps: { port: portA, portTag: 'portA' },
      },
    );

    // 1. Settle initial portA list load
    await act(async () => {});
    expect(result.current.items).toEqual([SAMPLE_ASTER]);

    // 2. Select real portA detail
    await act(async () => {
      await result.current.selectClient(SAMPLE_ASTER.id);
    });
    expect(result.current.selectedClientId).toBe(SAMPLE_ASTER.id);
    expect(result.current.selectedDetail).toEqual(SAMPLE_ASTER);

    // 3. Enqueue/start an abort-ignoring deferred port-A refresh so loaded old list/detail remain present while old work is in flight
    portA.setIgnoreAbortSignals(true);
    let resolvePortAList: (items: ClientDto[]) => void = () => {};
    const portADeferred = new Promise<ClientDto[]>((resolve) => {
      resolvePortAList = resolve;
    });
    portA.enqueueDeferredList(portADeferred, 'founder');

    // Trigger refresh in-flight
    act(() => {
      void result.current.refresh();
    });
    // Verify old loaded items and detail are still present while refresh is in flight on portA
    expect(result.current.items).toEqual([SAMPLE_ASTER]);
    expect(result.current.selectedDetail).toEqual(SAMPLE_ASTER);

    // 4. Setup portB
    const portB = new DeterministicTestClientsAdapter();
    let resolvePortBList: (items: ClientDto[]) => void = () => {};
    const portBDeferred = new Promise<ClientDto[]>((resolve) => {
      resolvePortBList = resolve;
    });
    portB.enqueueDeferredList(portBDeferred, 'founder');

    // Reset snapshot tracking right before switching port
    renderedSnapshots.length = 0;

    // 5. Swap to portB with the same role ('founder')
    act(() => {
      rerender({ port: portB, portTag: 'portB' });
    });

    // In every new-port pre-settlement frame:
    const portBFramesBeforeSettling = renderedSnapshots.filter((s) => s.activePort === 'portB');
    expect(portBFramesBeforeSettling.length).toBeGreaterThanOrEqual(1);
    for (const frame of portBFramesBeforeSettling) {
      expect(frame.itemsCount).toBe(0);
      expect(frame.selectedClientId).toBeNull();
      expect(frame.selectedDetail).toBeNull();
      expect(frame.error).toBeNull();
      expect(frame.detailError).toBeNull();
      expect(frame.hasLiveSnapshot).toBe(false);
      expect(frame.loading).toBe(true);
    }

    // 6. Settle B
    await act(async () => {
      resolvePortBList([SAMPLE_BLUEPEAK]);
    });
    expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    expect(result.current.selectedClientId).toBeNull();
    expect(result.current.selectedDetail).toBeNull();
    expect(result.current.hasLiveSnapshot).toBe(true);
    expect(result.current.loading).toBe(false);

    // 7. Resolve A late
    await act(async () => {
      resolvePortAList([SAMPLE_ASTER]);
    });

    // Prove B state remains intact
    expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    expect(result.current.selectedClientId).toBeNull();
    expect(result.current.selectedDetail).toBeNull();
  });

  // STRENGTHENED TEST: Pre-swap old list AND detail error states synchronously hidden on first new-port render
  it('synchronously hides prior list and detail errors on the very first frame of port replacement', async () => {
    const portA = new DeterministicTestClientsAdapter();
    portA.setListResponse('founder', [SAMPLE_ASTER]);
    const detailErr = new ClientOperationError({ code: 'not_found', message: 'Port A detail failed' });
    portA.setGetError(SAMPLE_ASTER.id, detailErr);

    const portB = new DeterministicTestClientsAdapter();
    let resolvePortBList: (items: ClientDto[]) => void = () => {};
    const portBDeferred = new Promise<ClientDto[]>((resolve) => {
      resolvePortBList = resolve;
    });
    portB.setDeferredList('founder', portBDeferred);

    const frames: Array<{
      activePort: string;
      error: unknown;
      detailError: unknown;
      loading: boolean;
      itemsCount: number;
    }> = [];

    const { result, rerender } = renderHook(
      ({ port, portTag }: { port: DeterministicTestClientsAdapter; portTag: string }) => {
        const hook = useClients('founder', { port });
        frames.push({
          activePort: portTag,
          error: hook.error,
          detailError: hook.detailError,
          loading: hook.loading,
          itemsCount: hook.items.length,
        });
        return hook;
      },
      {
        initialProps: { port: portA, portTag: 'portA' },
      },
    );

    // Settle portA list
    await act(async () => {});
    expect(result.current.items).toEqual([SAMPLE_ASTER]);

    // Induce detail error
    await act(async () => {
      await result.current.selectClient(SAMPLE_ASTER.id);
    });
    expect(result.current.detailError).toBe(detailErr);

    // Induce list error
    const listErr = new ClientOperationError({ code: 'network', message: 'Port A list refresh failed' });
    portA.setListError('founder', listErr);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe(listErr);

    frames.length = 0; // reset

    // Swap port to portB (same role)
    act(() => {
      rerender({ port: portB, portTag: 'portB' });
    });

    // In the VERY FIRST post-rerender frame for portB:
    const firstPortBFrame = frames.find((f) => f.activePort === 'portB');
    expect(firstPortBFrame).toBeDefined();
    expect(firstPortBFrame?.error).toBeNull(); // Old list error synchronously hidden!
    expect(firstPortBFrame?.detailError).toBeNull(); // Old detail error synchronously hidden!
    expect(firstPortBFrame?.itemsCount).toBe(0);
    expect(firstPortBFrame?.loading).toBe(true);

    // Settle portB
    await act(async () => {
      resolvePortBList([SAMPLE_ASTER]);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.detailError).toBeNull();
    expect(result.current.items).toEqual([SAMPLE_ASTER]);
  });

  it('makes captured callbacks from an old session harmless no-ops after same-role port swap without network calls or state mutation', async () => {
    const portA = new DeterministicTestClientsAdapter();
    portA.setListResponse('founder', [SAMPLE_ASTER]);
    portA.setGetResponse(SAMPLE_ASTER.id, SAMPLE_ASTER);

    const portB = new DeterministicTestClientsAdapter();
    portB.setListResponse('founder', [SAMPLE_BLUEPEAK]);
    portB.setGetResponse(SAMPLE_BLUEPEAK.id, SAMPLE_BLUEPEAK);

    const { result, rerender } = renderHook(
      ({ port }: { port: DeterministicTestClientsAdapter }) => useClients('founder', { port }),
      { initialProps: { port: portA } },
    );

    await act(async () => {});
    expect(result.current.items).toEqual([SAMPLE_ASTER]);

    // Capture old callbacks from session A
    const capturedOldRefresh = result.current.refresh;
    const capturedOldSelect = result.current.selectClient;
    const capturedOldClear = result.current.clearSelection;

    // Swap to port B (same role)
    rerender({ port: portB });
    await act(async () => {});
    expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);

    // Record calls on port A prior to invoking captured callbacks
    const portACallsBefore = portA.calls.length;

    // Invoke captured callbacks from retired session A
    await act(async () => {
      await capturedOldRefresh();
      await capturedOldSelect(SAMPLE_ASTER.id);
      capturedOldClear();
    });

    // None of the captured callbacks must have dispatched network calls to port A
    expect(portA.calls.length).toBe(portACallsBefore);

    // Active state from port B must remain completely intact
    expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    expect(result.current.selectedClientId).toBeNull();
  });

  it('makes captured callbacks harmless no-ops after unmount without throwing or triggering port calls', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_ASTER]);
    port.setGetResponse(SAMPLE_ASTER.id, SAMPLE_ASTER);

    const { result, unmount } = renderHook(() => useClients('founder', { port }));
    await act(async () => {});

    const capturedRefresh = result.current.refresh;
    const capturedSelect = result.current.selectClient;
    const capturedClear = result.current.clearSelection;

    unmount();

    const callsBefore = port.calls.length;

    await act(async () => {
      await capturedRefresh();
      await capturedSelect(SAMPLE_ASTER.id);
      capturedClear();
    });

    expect(port.calls.length).toBe(callsBefore);
  });

  it('suppresses toast and error delivery to active session when an abort-ignoring old-port request rejects late after port swap', async () => {
    const portA = new DeterministicTestClientsAdapter();
    portA.setIgnoreAbortSignals(true);

    let rejectPortAList: (error: Error) => void = () => {};
    const portADeferred = new Promise<ClientDto[]>((_resolve, reject) => {
      rejectPortAList = reject;
    });
    portA.setDeferredList('founder', portADeferred);

    const portB = new DeterministicTestClientsAdapter();
    portB.setListResponse('founder', [SAMPLE_BLUEPEAK]);

    const onToast = vi.fn();
    const onError = vi.fn();

    const { result, rerender } = renderHook(
      ({ port }: { port: DeterministicTestClientsAdapter }) =>
        useClients('founder', { port, onToast, onError }),
      { initialProps: { port: portA } },
    );

    // Swap to port B while port A fetch is in flight
    rerender({ port: portB });
    await act(async () => {});
    expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);

    // Now reject the old port A request late with an error
    await act(async () => {
      rejectPortAList(
        new ClientOperationError({ code: 'network', message: 'Old port network failure' }),
      );
    });

    // Neither onToast nor onError must receive the old error
    expect(onToast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  // STRENGTHENED TEST: Commit-boundary regression proving commit-synchronous session deactivation closes the passive-effect stale-notification window
  it('suppresses stale notifications when an old abort-ignoring request rejects at the new-port commit boundary before passive effects flush', async () => {
    const portA = new DeterministicTestClientsAdapter();
    portA.setIgnoreAbortSignals(true);

    let rejectPortAList: (error: Error) => void = () => {};
    const portADeferred = new Promise<ClientDto[]>((_resolve, reject) => {
      rejectPortAList = reject;
    });
    portA.setDeferredList('founder', portADeferred);

    const portB = new DeterministicTestClientsAdapter();
    portB.setListResponse('founder', [SAMPLE_BLUEPEAK]);

    const onToastA = vi.fn();
    const onErrorA = vi.fn();
    const onToastB = vi.fn();
    const onErrorB = vi.fn();

    let setPortFn: (p: DeterministicTestClientsAdapter) => void = () => {};
    let triggerRejectInLayout = false;
    let latestHookResult: any = null;

    function Harness() {
      const [port, setPort] = React.useState<DeterministicTestClientsAdapter>(portA);
      setPortFn = setPort;

      const hook = useClients(
        'founder',
        port === portA
          ? { port, onToast: onToastA, onError: onErrorA }
          : { port, onToast: onToastB, onError: onErrorB },
      );
      latestHookResult = hook;

      React.useLayoutEffect(() => {
        if (triggerRejectInLayout) {
          triggerRejectInLayout = false;
          // Synchronously reject old portA request during the layout phase of the portB commit
          rejectPortAList(
            new ClientOperationError({ code: 'network', message: 'Old port crashed at commit boundary' }),
          );
        }
      });

      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      // 1. Initial mount with portA
      flushSync(() => {
        root.render(<Harness />);
      });
      expect(portA.calls).toHaveLength(1);

      // 2. Arm trigger for portB layout effect
      triggerRejectInLayout = true;

      // 3. Switch port to portB WITHOUT flushSync/act, allowing commit/layout to execute and microtasks to drain before passive effects
      setPortFn(portB);

      // Yield to let layout phase execute and microtasks drain before passive effects flush
      await new Promise((r) => setImmediate(r));

      // With commit-synchronous session deactivation (useIsomorphicLayoutEffect), sessionA token was deactivated in layout cleanup.
      // With passive useEffect, sessionA token would still be active here and deliver to onErrorB!
      expect(onErrorA).not.toHaveBeenCalled();
      expect(onToastA).not.toHaveBeenCalled();
      expect(onErrorB).not.toHaveBeenCalled();
      expect(onToastB).not.toHaveBeenCalled();

      // Settle remaining work in act
      await act(async () => {});

      expect(latestHookResult.items).toEqual([SAMPLE_BLUEPEAK]);
      expect(latestHookResult.error).toBeNull();
    } finally {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('manages client detail selection and clearing', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_ASTER]);
    port.setGetResponse(SAMPLE_ASTER.id, SAMPLE_ASTER);

    const { result } = renderHook(() => useClients('founder', { port }));

    await act(async () => {
      // mount sync
    });

    expect(result.current.selectedClientId).toBeNull();
    expect(result.current.selectedDetail).toBeNull();

    // Select Aster
    await act(async () => {
      await result.current.selectClient(SAMPLE_ASTER.id);
    });

    expect(result.current.selectedClientId).toBe(SAMPLE_ASTER.id);
    expect(result.current.selectedDetail).toEqual(SAMPLE_ASTER);
    expect(result.current.detailLoading).toBe(false);
    expect(result.current.detailError).toBeNull();

    // Clear selection
    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedClientId).toBeNull();
    expect(result.current.selectedDetail).toBeNull();
  });

  it('refresh re-fetches list via sync', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setListResponse('founder', [SAMPLE_ASTER]);

    const { result } = renderHook(() => useClients('founder', { port }));

    await act(async () => {
      // initial
    });
    expect(result.current.items).toHaveLength(1);

    // Update port
    port.setListResponse('founder', [SAMPLE_ASTER, SAMPLE_BLUEPEAK]);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items).toHaveLength(2);
  });

  // FIX 1 & FIX 4: Observable assertions on unmount lifecycle with abort-ignoring adapter
  it('observably aborts active signal on unmount and suppresses late completions/callbacks even when adapter ignores abort', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true); // Ignore abort signal so deferred resolution genuinely reaches coordinator

    let resolveSlowList: (items: ClientDto[]) => void = () => {};
    const slowDeferred = new Promise<ClientDto[]>((resolve) => {
      resolveSlowList = resolve;
    });
    port.setDeferredList('founder', slowDeferred);

    const onToast = vi.fn();
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useClients('founder', { port, onToast, onError }),
    );

    // Verify initial call occurred with an active, un-aborted signal
    expect(port.calls).toHaveLength(1);
    const initialCall = port.calls[0]!;
    expect(initialCall.action).toBe('list');
    expect(initialCall.signal?.aborted).toBe(false);

    // Unmount while fetch is in-flight
    unmount();

    // Observable assertion 1: active signal MUST be aborted on unmount
    expect(initialCall.signal?.aborted).toBe(true);

    // Resolve late after unmount with abort-ignoring promise
    await act(async () => {
      resolveSlowList([SAMPLE_ASTER]);
    });

    // Observable assertion 2: late completion triggers no toast, no error, and no React console warnings
    expect(onToast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  // ITEM 3: Truthful unmount rejection assertion proving late error dispatch is suppressed
  // REQUIRED REGRESSION TEST: Role-change commit-boundary regression test proving commit-synchronous switchRole closes the passive-effect stale-notification window
  it('suppresses stale notifications when an old abort-ignoring role request rejects at the role-change commit boundary before passive effects flush', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true);

    let rejectFounderList: (error: Error) => void = () => {};
    const founderDeferred = new Promise<ClientDto[]>((_resolve, reject) => {
      rejectFounderList = reject;
    });
    port.setDeferredList('founder', founderDeferred);
    port.setListResponse('staff', [SAMPLE_BLUEPEAK]);

    const onToastFounder = vi.fn();
    const onErrorFounder = vi.fn();
    const onToastStaff = vi.fn();
    const onErrorStaff = vi.fn();

    let setRoleFn: (r: CompanyRole) => void = () => {};
    let triggerRejectInLayout = false;
    let latestResult: any = null;

    function Harness() {
      const [role, setRole] = React.useState<CompanyRole>('founder');
      setRoleFn = setRole;

      const hook = useClients(
        role,
        role === 'founder'
          ? { port, onToast: onToastFounder, onError: onErrorFounder }
          : { port, onToast: onToastStaff, onError: onErrorStaff },
      );
      latestResult = hook;

      React.useLayoutEffect(() => {
        if (triggerRejectInLayout) {
          triggerRejectInLayout = false;
          // Synchronously reject old founder request during the layout phase of staff commit
          rejectFounderList(
            new ClientOperationError({
              code: 'network',
              message: 'Old founder request failed at commit boundary',
            }),
          );
        }
      });

      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      // 1. Initial mount with founder
      flushSync(() => {
        root.render(<Harness />);
      });
      expect(port.calls).toHaveLength(1);
      expect(port.calls[0]!.role).toBe('founder');

      // 2. Arm trigger for staff layout effect
      triggerRejectInLayout = true;

      // 3. Switch role to staff WITHOUT flushSync/act, allowing commit/layout to execute and microtasks to drain before passive effects
      setRoleFn('staff');

      // Yield to let layout phase execute and microtasks drain before passive effects flush
      await new Promise((r) => setImmediate(r));

      // With commit-synchronous switchRole (useIsomorphicLayoutEffect), switchRole('staff') ran during the layout phase,
      // advancing the generation and setting currentRole='staff'. The rejection microtask sees generation/role mismatch and discards it.
      // With passive useEffect, switchRole('staff') has not run yet when the microtask fires, so onErrorStaff would be called!
      expect(onErrorFounder).not.toHaveBeenCalled();
      expect(onToastFounder).not.toHaveBeenCalled();
      expect(onErrorStaff).not.toHaveBeenCalled();
      expect(onToastStaff).not.toHaveBeenCalled();

      // Now settle remaining work in act
      await act(async () => {});

      expect(latestResult.items).toEqual([SAMPLE_BLUEPEAK]);
      expect(latestResult.role).toBe('staff');
      expect(latestResult.error).toBeNull();
    } finally {
      flushSync(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  // ITEM 3: Truthful unmount rejection assertion proving late error dispatch is suppressed
  it('suppresses error and toast callbacks when an abort-ignoring request rejects late after unmount', async () => {
    const port = new DeterministicTestClientsAdapter();
    port.setIgnoreAbortSignals(true); // Ignore abort so deferred rejection genuinely reaches coordinator catch block

    let rejectSlowList: (error: Error) => void = () => {};
    const slowDeferred = new Promise<ClientDto[]>((_resolve, reject) => {
      rejectSlowList = reject;
    });
    port.setDeferredList('founder', slowDeferred);

    const onToast = vi.fn();
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useClients('founder', { port, onToast, onError }),
    );

    expect(port.calls).toHaveLength(1);
    const initialCall = port.calls[0]!;
    expect(initialCall.signal?.aborted).toBe(false);

    // Unmount while fetch is in-flight
    unmount();
    expect(initialCall.signal?.aborted).toBe(true);

    // Reject late after unmount with abort-ignoring promise
    await act(async () => {
      rejectSlowList(
        new ClientOperationError({ code: 'network', message: 'Late unmount network failure' }),
      );
    });

    // Truthful assertions: late rejection must NOT trigger onToast or onError, and NO React console errors
    expect(onToast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  describe('createClient mutation in useClients hook', () => {
    const CREATED_CLIENT: ClientDto = {
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

    it('delegates to coordinator and updates state upon successful creation', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [SAMPLE_ASTER]);
      port.setCreateResponse(CREATED_CLIENT);

      const onToast = vi.fn();
      const { result } = renderHook(() => useClients('founder', { port, onToast }));

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });
      expect(result.current.items).toEqual([SAMPLE_ASTER]);

      let createdResult: ClientDto | null = null;
      await act(async () => {
        createdResult = await result.current.createClient({
          displayName: 'Zenith Global Advisory',
        });
      });

      expect(createdResult).toEqual(CREATED_CLIENT);
      expect(result.current.items).toEqual([CREATED_CLIENT, SAMPLE_ASTER]);
      // Coordinator does not auto-toast; toast will be triggered by workspace UI
      expect(onToast).not.toHaveBeenCalled();
    });

    it('suppresses create completion when role changes while create is in-flight', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true);
      port.setListResponse('founder', [SAMPLE_ASTER]);
      port.setListResponse('staff', [SAMPLE_BLUEPEAK]);

      let resolveCreate!: (c: ClientDto) => void;
      const deferredCreate = new Promise<ClientDto>((resolve) => {
        resolveCreate = resolve;
      });
      port.setDeferredCreate(deferredCreate, 'founder');

      const { result, rerender } = renderHook(
        ({ role }: { role: CompanyRole }) => useClients(role, { port }),
        { initialProps: { role: 'founder' } },
      );

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      // Start create in founder scope
      let createPromise!: Promise<ClientDto | null>;
      act(() => {
        createPromise = result.current.createClient({ displayName: 'Founder Client' });
      });

      // Switch to staff
      act(() => {
        rerender({ role: 'staff' });
      });

      await waitFor(() => {
        expect(result.current.role).toBe('staff');
        expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
      });

      // Resolve old create
      await act(async () => {
        resolveCreate(CREATED_CLIENT);
      });

      const outcome = await createPromise;
      expect(outcome).toBeNull();
      // Staff items never contaminated with founder's created client
      expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    });

    it('handles in-flight create followed by unmount without errors or state leaks', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true);
      port.setListResponse('founder', [SAMPLE_ASTER]);

      let resolveCreate!: (c: ClientDto) => void;
      const deferredCreate = new Promise<ClientDto>((resolve) => {
        resolveCreate = resolve;
      });
      port.setDeferredCreate(deferredCreate, 'founder');

      const { result, unmount } = renderHook(() => useClients('founder', { port }));

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      let createPromise!: Promise<ClientDto | null>;
      act(() => {
        createPromise = result.current.createClient({ displayName: 'Unmounting Client' });
      });

      unmount();

      resolveCreate(CREATED_CLIENT);
      const outcome = await createPromise;
      expect(outcome).toBeNull();
    });

    it('handles in-flight create followed by port replacement without contamination', async () => {
      const port1 = new DeterministicTestClientsAdapter();
      port1.setIgnoreAbortSignals(true);
      port1.setListResponse('founder', [SAMPLE_ASTER]);

      const port2 = new DeterministicTestClientsAdapter();
      port2.setListResponse('founder', [SAMPLE_BLUEPEAK]);

      let resolveCreate1!: (c: ClientDto) => void;
      const deferredCreate1 = new Promise<ClientDto>((resolve) => {
        resolveCreate1 = resolve;
      });
      port1.setDeferredCreate(deferredCreate1, 'founder');

      const { result, rerender } = renderHook(
        ({ activePort }: { activePort: DeterministicTestClientsAdapter }) =>
          useClients('founder', { port: activePort }),
        { initialProps: { activePort: port1 } },
      );

      await waitFor(() => {
        expect(result.current.items).toEqual([SAMPLE_ASTER]);
      });

      let createPromise!: Promise<ClientDto | null>;
      act(() => {
        createPromise = result.current.createClient({ displayName: 'Port1 Client' });
      });

      // Replace port
      rerender({ activePort: port2 });

      await waitFor(() => {
        expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
      });

      resolveCreate1(CREATED_CLIENT);
      const outcome = await createPromise;
      expect(outcome).toBeNull();
      expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    });

    it('suppresses stale error after role switch: returns null without throwing or triggering toast', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setIgnoreAbortSignals(true);
      port.setListResponse('founder', [SAMPLE_ASTER]);
      port.setListResponse('staff', [SAMPLE_BLUEPEAK]);

      let rejectCreate!: (err: Error) => void;
      const deferredCreate = new Promise<ClientDto>((_, reject) => {
        rejectCreate = reject;
      });
      port.setDeferredCreate(deferredCreate, 'founder');

      const onToast = vi.fn();
      const { result, rerender } = renderHook(
        ({ role }: { role: CompanyRole }) => useClients(role, { port, onToast }),
        { initialProps: { role: 'founder' } },
      );

      await waitFor(() => {
        expect(result.current.hasLiveSnapshot).toBe(true);
      });

      let createPromise!: Promise<ClientDto | null>;
      act(() => {
        createPromise = result.current.createClient({ displayName: 'Failing Client' });
      });

      rerender({ role: 'staff' });

      await waitFor(() => {
        expect(result.current.role).toBe('staff');
        expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
      });

      rejectCreate(new Error('Server error occurred'));
      const outcome = await createPromise;

      expect(outcome).toBeNull();
      expect(onToast).not.toHaveBeenCalled();
      expect(result.current.items).toEqual([SAMPLE_BLUEPEAK]);
    });
  });

  describe('client and contact changes', () => {
    const EDITABLE: ClientDto = { ...SAMPLE_ASTER, canEdit: true, canChangeOwnerOrStatus: true };
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

    async function openClient() {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [EDITABLE, SAMPLE_BLUEPEAK]);
      port.setGetResponse(EDITABLE.id, EDITABLE);
      const hook = renderHook(() => useClients('founder', { port }));
      await waitFor(() => expect(hook.result.current.hasLiveSnapshot).toBe(true));
      await act(async () => {
        await hook.result.current.selectClient(EDITABLE.id);
      });
      await waitFor(() => expect(hook.result.current.selectedDetail).toEqual(EDITABLE));
      port.calls.length = 0;
      return { port, ...hook };
    }

    it('updateClient sends the key, then shows the saved detail and list', async () => {
      const { port, result } = await openClient();

      let saved: ClientDto | null = null;
      await act(async () => {
        saved = await result.current.updateClient(
          EDITABLE.id,
          { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt },
          'key-1',
        );
      });

      expect(saved).toMatchObject({ city: 'Pune' });
      expect(port.calls[0]).toMatchObject({ action: 'updateClient', id: EDITABLE.id, idempotencyKey: 'key-1' });
      await waitFor(() => {
        expect(result.current.selectedDetail?.city).toBe('Pune');
        expect(result.current.items.find((item) => item.id === EDITABLE.id)?.city).toBe('Pune');
      });
    });

    it('contact actions reach the port and refresh the open client', async () => {
      const { port, result } = await openClient();
      port.setContactResponse(CONTACT);

      await act(async () => {
        await result.current.createContact(EDITABLE.id, { name: 'Priya Nair' }, 'key-2');
        await result.current.updateContact(
          CONTACT.id,
          { designation: 'Director', expectedUpdatedAt: CONTACT.updatedAt },
          'key-3',
        );
      });
      let removed = false;
      await act(async () => {
        removed = await result.current.deleteContact(CONTACT.id);
      });

      expect(removed).toBe(true);
      const actions = port.calls.map((call) => call.action);
      expect(actions).toEqual(expect.arrayContaining(['createContact', 'updateContact', 'deleteContact', 'get', 'list']));
      expect(port.calls.find((call) => call.action === 'createContact')?.idempotencyKey).toBe('key-2');
      expect(port.calls.find((call) => call.action === 'updateContact')?.idempotencyKey).toBe('key-3');
    });

    it('rejects with safe copy and shows no toast when a change is refused', async () => {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse('founder', [EDITABLE]);
      port.setGetResponse(EDITABLE.id, EDITABLE);
      port.setUpdateClientError(
        new ClientOperationError({ code: 'conflict', message: 'raw', status: 409, serverCode: 'stale_client' }),
      );
      const onToast = vi.fn();
      const { result } = renderHook(() => useClients('founder', { port, onToast }));
      await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

      await act(async () => {
        await expect(
          result.current.updateClient(EDITABLE.id, { city: 'Pune', expectedUpdatedAt: EDITABLE.updatedAt }, 'key-1'),
        ).rejects.toMatchObject({
          serverCode: 'stale_client',
          message: 'This client was changed by someone else. Reload and try again.',
        });
      });
      expect(onToast).not.toHaveBeenCalled();
    });
  });
});
