// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import { DeterministicTestAssignmentsAdapter } from './test-adapter';
import { useAssignments } from './use-assignments';

afterEach(() => {
  cleanup();
});

const ROW_FOUNDER: AssignmentRow = {
  id: 'ASN-F01',
  title: 'Founder Tax Advisory',
  client: 'Alpha Ltd',
  service: 'Advisory',
  due: '10/11/2026',
  owner: 'S. Narayanan',
  status: 'Open',
  progress: 15,
  tone: 'default',
};

const ROW_STAFF: AssignmentRow = {
  id: 'ASN-S01',
  title: 'Staff Bookkeeping',
  client: 'Beta Ltd',
  service: 'Bookkeeping',
  due: '12/11/2026',
  owner: 'Rohan Mehta',
  status: 'In progress',
  progress: 50,
  tone: 'default',
};

describe('useAssignments React hook integration', () => {
  it('initializes with initialRows and syncs live snapshot on mount', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListResponse('founder', [ROW_FOUNDER]);

    const { result } = renderHook(() =>
      useAssignments('founder', {
        port: adapter,
        initialRows: [],
      }),
    );

    // Initial state before sync resolves
    expect(result.current.assignments).toEqual([]);

    // Wait for the initial sync to finish
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.assignments).toEqual([ROW_FOUNDER]);
  });

  it('provides stable callback identities across rerenders', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListResponse('founder', [ROW_FOUNDER]);

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) =>
        useAssignments(role, {
          port: adapter,
          initialRows: [ROW_FOUNDER],
        }),
      {
        initialProps: { role: 'founder' },
      },
    );

    const initialCreate = result.current.handleCreateAssignment;
    const initialUpdate = result.current.handleUpdateAssignment;
    const initialCascade = result.current.cascadeClientFields;
    const initialMarkBilled = result.current.markAssignmentBilled;
    const initialRefresh = result.current.refresh;

    rerender({ role: 'founder' });

    expect(result.current.handleCreateAssignment).toBe(initialCreate);
    expect(result.current.handleUpdateAssignment).toBe(initialUpdate);
    expect(result.current.cascadeClientFields).toBe(initialCascade);
    expect(result.current.markAssignmentBilled).toBe(initialMarkBilled);
    expect(result.current.refresh).toBe(initialRefresh);
  });

  it('switches assignments snapshot when role changes', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListResponse('founder', [ROW_FOUNDER]);
    adapter.setListResponse('staff', [ROW_STAFF]);

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) =>
        useAssignments(role, {
          port: adapter,
          initialRows: [],
        }),
      {
        initialProps: { role: 'founder' as CompanyRole },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.assignments).toEqual([ROW_FOUNDER]);

    // Switch role to staff
    await act(async () => {
      rerender({ role: 'staff' });
    });

    expect(result.current.assignments).toEqual([ROW_STAFF]);
  });

  it('survives actual React StrictMode setup-cleanup-setup replay cleanly on same hook', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListResponse('founder', [ROW_FOUNDER]);

    const { result, unmount } = renderHook(
      () =>
        useAssignments('founder', {
          port: adapter,
          initialRows: [],
        }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <React.StrictMode>{children}</React.StrictMode>
        ),
      },
    );

    // Initial state before sync resolves
    expect(result.current.assignments).toEqual([]);

    await act(async () => {
      await Promise.resolve();
    });

    // Final live sync works cleanly after StrictMode replay
    expect(result.current.assignments).toEqual([ROW_FOUNDER]);

    unmount();
  });

  it('aborts in-flight requests and suppresses callbacks on unmount', async () => {
    const toasts: string[] = [];
    const errors: any[] = [];
    let resolveList: (rows: AssignmentRow[]) => void = () => {};
    const deferredList = new Promise<AssignmentRow[]>((resolve) => {
      resolveList = resolve;
    });

    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setDeferredList('founder', deferredList);

    const { unmount } = renderHook(() =>
      useAssignments('founder', {
        port: adapter,
        initialRows: [ROW_FOUNDER],
        onToast: (msg) => toasts.push(msg),
        onError: (err) => errors.push(err),
      }),
    );

    // Unmount while list request is in flight
    unmount();

    // Now resolve deferred list
    await act(async () => {
      resolveList([ROW_FOUNDER]);
      await Promise.resolve();
    });

    // Callbacks must have been suppressed
    expect(toasts).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('guarantees zero-frame role privacy: synchronously exposes zero rows when role prop changes before fetch settles', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListResponse('founder', [ROW_FOUNDER]);

    let resolveStaff: (rows: AssignmentRow[]) => void = () => {};
    const staffDeferred = new Promise<AssignmentRow[]>((resolve) => {
      resolveStaff = resolve;
    });
    adapter.setDeferredList('staff', staffDeferred);

    const renderFrames: Array<{ role: CompanyRole; rows: AssignmentRow[]; loading: boolean }> = [];

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => {
        const hook = useAssignments(role, {
          port: adapter,
          initialRows: [ROW_FOUNDER],
        });
        renderFrames.push({ role, rows: [...hook.assignments], loading: hook.loading });
        return hook;
      },
      {
        initialProps: { role: 'founder' as CompanyRole },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.assignments).toEqual([ROW_FOUNDER]);

    // Clear history to inspect only the frames during switch to staff
    renderFrames.length = 0;

    // Rerender with 'staff' while staff fetch is deferred
    rerender({ role: 'staff' });

    // The VERY FIRST frame rendered with role='staff' (before effects ran)
    // MUST have empty rows and loading=true!
    expect(renderFrames[0]?.role).toBe('staff');
    expect(renderFrames[0]?.rows).toEqual([]);
    expect(renderFrames[0]?.loading).toBe(true);
  });
});
