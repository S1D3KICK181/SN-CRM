// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { WorkItemDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import { DeterministicTestWorkItemsAdapter } from './test-work-items-adapter';
import { useWorkItems } from './use-work-items';

afterEach(() => {
  cleanup();
});

const FOUNDER_ITEM: WorkItemDto = {
  id: 'wrk_f01',
  kind: 'delegated',
  title: 'Founder Delegated Item',
  notes: null,
  assignmentId: 'ASN-0001',
  relatedClientId: 'CLI-0001',
  relatedPartyName: 'Aster Foods',
  assigneeId: 'usr_senior',
  createdById: 'usr_founder',
  status: 'todo',
  dueAt: '2026-11-04T12:30:00.000Z',
  reminderAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

const STAFF_PERSONAL_ITEM: WorkItemDto = {
  id: 'wrk_p_staff',
  kind: 'personal',
  title: 'Staff Private Task',
  notes: null,
  assignmentId: null,
  relatedClientId: null,
  relatedPartyName: 'Personal Note',
  assigneeId: 'usr_staff',
  createdById: 'usr_staff',
  status: 'todo',
  dueAt: '2026-11-03T12:30:00.000Z',
  reminderAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

const SAMPLE_ASSIGNMENT: AssignmentRow = {
  id: 'ASN-0001',
  title: 'October GST return',
  client: 'Aster Foods Private Limited',
  clientId: 'CLI-0001',
  service: 'GST Compliance',
  due: '11/11/2026',
  owner: 'Priya Desai',
  reviewer: 'Ananya Rao',
  status: 'In progress',
  progress: 70,
  tone: 'default',
};

describe('useWorkItems React hook integration', () => {
  it('guarantees zero-frame role privacy: synchronously exposes empty lists and loading=true when role changes before fetch settles', async () => {
    const adapter = new DeterministicTestWorkItemsAdapter();
    adapter.setListResponse('founder', [FOUNDER_ITEM]);

    let resolveStaff: (items: WorkItemDto[]) => void = () => {};
    const staffDeferred = new Promise<WorkItemDto[]>((resolve) => {
      resolveStaff = resolve;
    });
    adapter.setDeferredList('staff', staffDeferred);

    const renderFrames: Array<{
      role: CompanyRole;
      rawCount: number;
      personalCount: number;
      delegatedCount: number;
      loading: boolean;
    }> = [];

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => {
        const hook = useWorkItems(role, [SAMPLE_ASSIGNMENT], { port: adapter });
        renderFrames.push({
          role,
          rawCount: hook.items.length,
          personalCount: hook.personalTasks.length,
          delegatedCount: hook.visibleDelegatedWork.length,
          loading: hook.loading,
        });
        return hook;
      },
      {
        initialProps: { role: 'founder' as CompanyRole },
      },
    );

    // Initial render before founder sync settles
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items).toEqual([FOUNDER_ITEM]);

    // Clear history to inspect switch
    renderFrames.length = 0;

    // Rerender with 'staff' while staff list is in flight
    rerender({ role: 'staff' });

    // The synchronous frame rendered with role='staff' before effect runs MUST be completely empty
    expect(renderFrames[0]?.role).toBe('staff');
    expect(renderFrames[0]?.rawCount).toBe(0);
    expect(renderFrames[0]?.personalCount).toBe(0);
    expect(renderFrames[0]?.delegatedCount).toBe(0);
    expect(renderFrames[0]?.loading).toBe(true);

    // Resolve deferred fetch for staff
    await act(async () => {
      resolveStaff([STAFF_PERSONAL_ITEM]);
      await Promise.resolve();
    });

    expect(result.current.personalTasks).toHaveLength(1);
    expect(result.current.personalTasks[0]?.id).toBe('wrk_p_staff');
    expect(result.current.loading).toBe(false);
  });

  it('provides stable callback identities across rerenders', async () => {
    const adapter = new DeterministicTestWorkItemsAdapter();
    adapter.setListResponse('founder', [FOUNDER_ITEM]);

    const { result, rerender } = renderHook(
      ({ role, assignments }: { role: CompanyRole; assignments: AssignmentRow[] }) =>
        useWorkItems(role, assignments, { port: adapter }),
      {
        initialProps: { role: 'founder' as CompanyRole, assignments: [SAMPLE_ASSIGNMENT] },
      },
    );

    const initialCreateDelegated = result.current.handleCreateDelegated;
    const initialCreatePersonal = result.current.handleCreatePersonal;
    const initialStart = result.current.handleStart;
    const initialSubmit = result.current.handleSubmit;
    const initialApprove = result.current.handleApprove;
    const initialReopen = result.current.handleReopen;
    const initialToggle = result.current.handleTogglePersonal;
    const initialRefresh = result.current.refresh;

    rerender({ role: 'founder', assignments: [SAMPLE_ASSIGNMENT] });

    expect(result.current.handleCreateDelegated).toBe(initialCreateDelegated);
    expect(result.current.handleCreatePersonal).toBe(initialCreatePersonal);
    expect(result.current.handleStart).toBe(initialStart);
    expect(result.current.handleSubmit).toBe(initialSubmit);
    expect(result.current.handleApprove).toBe(initialApprove);
    expect(result.current.handleReopen).toBe(initialReopen);
    expect(result.current.handleTogglePersonal).toBe(initialToggle);
    expect(result.current.refresh).toBe(initialRefresh);
  });

  it('recomputes dynamic view models when assignments prop updates without refetching API', async () => {
    const adapter = new DeterministicTestWorkItemsAdapter();
    adapter.setListResponse('founder', [FOUNDER_ITEM]);

    const { result, rerender } = renderHook(
      ({ assignments }: { assignments: AssignmentRow[] }) =>
        useWorkItems('founder', assignments, { port: adapter }),
      {
        initialProps: { assignments: [] as AssignmentRow[] },
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Parent label with no assignment loaded
    expect(result.current.visibleDelegatedWork[0]?.parent).toBe('ASN-0001 · Aster Foods');

    // Assignments prop arrives
    rerender({ assignments: [SAMPLE_ASSIGNMENT] });

    // Parent label dynamically recomputes!
    expect(result.current.visibleDelegatedWork[0]?.parent).toBe('ASN-0001 · October GST return');
  });

  it('survives React.StrictMode setup-cleanup-setup replay cleanly', async () => {
    const adapter = new DeterministicTestWorkItemsAdapter();
    adapter.setListResponse('founder', [FOUNDER_ITEM]);

    const { result, unmount } = renderHook(
      () => useWorkItems('founder', [SAMPLE_ASSIGNMENT], { port: adapter }),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <React.StrictMode>{children}</React.StrictMode>
        ),
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([FOUNDER_ITEM]);
    unmount();
  });

  it('aborts in-flight request and suppresses callbacks on unmount', async () => {
    const toasts: string[] = [];
    const errors: any[] = [];
    let resolveList: (items: WorkItemDto[]) => void = () => {};
    const deferredList = new Promise<WorkItemDto[]>((resolve) => {
      resolveList = resolve;
    });

    const adapter = new DeterministicTestWorkItemsAdapter();
    adapter.setDeferredList('staff', deferredList);

    const { unmount } = renderHook(() =>
      useWorkItems('staff', [], {
        port: adapter,
        onToast: (msg) => toasts.push(msg),
        onError: (err) => errors.push(err),
      }),
    );

    unmount();

    await act(async () => {
      resolveList([STAFF_PERSONAL_ITEM]);
      await Promise.resolve();
    });

    expect(toasts).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  describe('Slice 1C: handleCreateInternal and internal items in hook', () => {
    it('handleCreateInternal constructs strict payload {kind:"internal", title, assigneeId, dueAt, notes} without assignmentId or client context keys', async () => {
      const adapter = new DeterministicTestWorkItemsAdapter();
      adapter.setCreateHandler((_role, input) => {
        return {
          id: 'wrk_int_created_1',
          kind: 'internal',
          title: input.title,
          notes: input.notes ?? null,
          assignmentId: null,
          relatedClientId: null,
          relatedPartyName: null,
          assigneeId: (input as any).assigneeId,
          createdById: 'usr_manager',
          status: 'todo',
          dueAt: input.dueAt,
          reminderAt: null,
          createdAt: '2026-11-02T04:00:00.000Z',
          updatedAt: '2026-11-02T04:00:00.000Z',
        };
      });

      const { result } = renderHook(() =>
        useWorkItems('manager', [], {
          port: adapter,
          clock: new Date('2026-11-02T06:30:00.000Z'),
        }),
      );

      let success: boolean = false;
      await act(async () => {
        success = await (result.current as any).handleCreateInternal({
          title: 'File purchase vouchers in blue box',
          assigneeId: 'usr_staff',
          due: 'Tomorrow',
          instructions: 'Box 4',
        });
      });

      expect(success).toBe(true);
      const createCalls = adapter.calls.filter((c) => c.action === 'create');
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.input).toEqual({
        kind: 'internal',
        title: 'File purchase vouchers in blue box',
        assigneeId: 'usr_staff',
        dueAt: expect.stringMatching(/2026-11-03/),
        notes: 'Box 4',
      });
      expect((createCalls[0]?.input as any).assignmentId).toBeUndefined();
      expect((createCalls[0]?.input as any).relatedClientId).toBeUndefined();
    });

    it('handleCreateInternal rejects invalid date string, raises toast, and avoids port create mutation', async () => {
      const adapter = new DeterministicTestWorkItemsAdapter();
      const toasts: string[] = [];
      const errors: any[] = [];
      const { result } = renderHook(() =>
        useWorkItems('manager', [], {
          port: adapter,
          onToast: (msg) => toasts.push(msg),
          onError: (err) => errors.push(err),
        }),
      );

      let success: boolean = true;
      await act(async () => {
        success = await (result.current as any).handleCreateInternal({
          title: 'Bad date task',
          assigneeId: 'usr_staff',
          due: 'not-a-valid-date-ever',
        });
      });

      expect(success).toBe(false);
      expect(toasts.some((t) => t.includes('Validation error'))).toBe(true);
      expect(adapter.calls.filter((c) => c.action === 'create')).toHaveLength(0);
    });

    it('handleCreateInternal maintains stable callback identity across rerenders', async () => {
      const adapter = new DeterministicTestWorkItemsAdapter();
      const { result, rerender } = renderHook(
        ({ assignments }) => useWorkItems('manager', assignments, { port: adapter }),
        { initialProps: { assignments: [] as AssignmentRow[] } },
      );

      const initialHandleCreateInternal = (result.current as any).handleCreateInternal;
      rerender({ assignments: [SAMPLE_ASSIGNMENT] });
      expect((result.current as any).handleCreateInternal).toBe(initialHandleCreateInternal);
    });

    it('zero-frame role privacy guard synchronously clears internal items on role change', async () => {
      const internalItem: WorkItemDto = {
        id: 'wrk_int_founder',
        kind: 'internal',
        title: 'Founder Internal Work',
        notes: null,
        assignmentId: null,
        relatedClientId: null,
        relatedPartyName: null,
        assigneeId: 'usr_manager',
        createdById: 'usr_founder',
        status: 'todo',
        dueAt: '2026-11-04T12:30:00.000Z',
        reminderAt: null,
        createdAt: '2026-11-01T04:00:00.000Z',
        updatedAt: '2026-11-01T04:00:00.000Z',
      };
      const adapter = new DeterministicTestWorkItemsAdapter();
      adapter.setListResponse('founder', [internalItem]);

      let resolveStaff: (items: WorkItemDto[]) => void = () => {};
      const staffDeferred = new Promise<WorkItemDto[]>((resolve) => {
        resolveStaff = resolve;
      });
      adapter.setDeferredList('staff', staffDeferred);

      const renderFrames: Array<{ role: CompanyRole; visibleDelegatedCount: number; loading: boolean }> = [];

      const { result, rerender } = renderHook(
        ({ role }: { role: CompanyRole }) => {
          const hook = useWorkItems(role, [], { port: adapter });
          renderFrames.push({
            role,
            visibleDelegatedCount: hook.visibleDelegatedWork.length,
            loading: hook.loading,
          });
          return hook;
        },
        { initialProps: { role: 'founder' as CompanyRole } },
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.visibleDelegatedWork).toHaveLength(1);

      renderFrames.length = 0;
      rerender({ role: 'staff' });

      // Synchronous zero-frame privacy guard check
      expect(renderFrames[0]?.role).toBe('staff');
      expect(renderFrames[0]?.visibleDelegatedCount).toBe(0);
      expect(renderFrames[0]?.loading).toBe(true);

      await act(async () => {
        resolveStaff([]);
        await Promise.resolve();
      });
    });
  });
});
