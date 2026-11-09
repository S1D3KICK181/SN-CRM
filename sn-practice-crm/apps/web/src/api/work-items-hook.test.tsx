// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  code: 'WI-001001',
  kind: 'delegated',
  title: 'Founder Delegated Item',
  notes: null,
  assignmentId: 'ASN-0001',
  relatedClientId: 'CLI-0001',
  relatedPartyName: 'Aster Foods',
  assigneeId: '00000000-0000-4000-a000-000000000003',
  createdById: '00000000-0000-4000-a000-000000000001',
  status: 'todo',
  dueAt: '2026-11-04T12:30:00.000Z',
  reminderAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

const STAFF_PERSONAL_ITEM: WorkItemDto = {
  id: 'wrk_p_staff',
  code: 'WI-001002',
  kind: 'personal',
  title: 'Staff Private Task',
  notes: null,
  assignmentId: null,
  relatedClientId: null,
  relatedPartyName: 'Personal Note',
  assigneeId: '00000000-0000-4000-a000-000000000004',
  createdById: '00000000-0000-4000-a000-000000000004',
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
          code: 'WI-001004',
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
        code: 'WI-001003',
        kind: 'internal',
        title: 'Founder Internal Work',
        notes: null,
        assignmentId: null,
        relatedClientId: null,
        relatedPartyName: null,
        assigneeId: '00000000-0000-4000-a000-000000000002',
        createdById: '00000000-0000-4000-a000-000000000001',
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

    it('handleTogglePersonal rejects reopening an already completed task with user-facing notification', async () => {
      const completedPersonalItem: WorkItemDto = {
        id: 'wrk_p_done',
        code: 'WI-001099',
        kind: 'personal',
        title: 'Already completed task',
        notes: null,
        assignmentId: null,
        relatedClientId: null,
        relatedPartyName: 'Personal',
        assigneeId: '00000000-0000-4000-a000-000000000004',
        createdById: '00000000-0000-4000-a000-000000000004',
        status: 'completed',
        dueAt: '2026-11-04T12:30:00.000Z',
        reminderAt: null,
        createdAt: '2026-11-01T04:00:00.000Z',
        updatedAt: '2026-11-01T04:00:00.000Z',
      };
      const adapter = new DeterministicTestWorkItemsAdapter();
      adapter.setListResponse('staff', [completedPersonalItem]);

      const toasts: string[] = [];
      const { result } = renderHook(() =>
        useWorkItems('staff', [], {
          port: adapter,
          onToast: (msg) => toasts.push(msg),
        }),
      );

      await act(async () => {
        await Promise.resolve();
      });

      let toggleResult: boolean = true;
      await act(async () => {
        toggleResult = await result.current.handleTogglePersonal('wrk_p_done');
      });

      expect(toggleResult).toBe(false);
      expect(toasts.some((t) => t.includes('Completed tasks are permanent audit records'))).toBe(true);
      expect(adapter.calls.filter((c) => c.action === 'transition')).toHaveLength(0);
    });

    it('handleCreatePersonal supports exact dueDate and dueTime and rejects reminder after due time', async () => {
      const adapter = new DeterministicTestWorkItemsAdapter();
      const toasts: string[] = [];
      const { result } = renderHook(() =>
        useWorkItems('staff', [], {
          port: adapter,
          onToast: (msg) => toasts.push(msg),
        }),
      );

      // Rejects when reminder is after due time
      let failedCreation: boolean = true;
      await act(async () => {
        failedCreation = await result.current.handleCreatePersonal({
          title: 'Invalid reminder task',
          dueDate: '10/11/2026',
          dueTime: '14:00',
          reminderAt: '10/11/2026 15:00', // After 14:00
        });
      });
      expect(failedCreation).toBe(false);
      expect(toasts.some((t) => t.includes('reminder must occur on or before'))).toBe(true);

      // Successfully creates when valid with genuine UUID
      let successCreation: boolean = false;
      const validClientUuid = '10000000-0000-4000-a000-000000000001';
      await act(async () => {
        successCreation = await result.current.handleCreatePersonal({
          title: 'Valid client call reminder',
          dueDate: '10/11/2026',
          dueTime: '14:00',
          relatedClientId: validClientUuid,
          relatedPartyName: 'Aster Foods',
        });
      });
      expect(successCreation).toBe(true);

      const createCalls = adapter.calls.filter((c) => c.action === 'create');
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.input).toMatchObject({
        kind: 'personal',
        title: 'Valid client call reminder',
        relatedClientId: validClientUuid,
        relatedPartyName: 'Aster Foods',
      });

      // Proof: Non-UUID fixture codes like 'CLI-0001' are omitted from relatedClientId to avoid 422 API errors
      await act(async () => {
        await result.current.handleCreatePersonal({
          title: 'Legacy code reminder',
          dueDate: '10/11/2026',
          dueTime: '15:00',
          relatedClientId: 'CLI-0001',
          relatedPartyName: 'Kedia Holdings',
        });
      });

      const secondCreateCall = adapter.calls.filter((c) => c.action === 'create')[1];
      expect(secondCreateCall).toBeDefined();
      expect(secondCreateCall?.input).toMatchObject({
        kind: 'personal',
        title: 'Legacy code reminder',
        relatedPartyName: 'Kedia Holdings',
      });
      if (secondCreateCall?.input && secondCreateCall.input.kind === 'personal') {
        expect(secondCreateCall.input.relatedClientId).toBeUndefined();
      } else {
        expect.fail('Expected second create call to be kind: personal');
      }
    });

    it('guarantees getAccessToken function identity churn does not cause coordinator recreation or refetch loops', async () => {
      let fetchCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({ data: [], requestId: `req_${fetchCount}` }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      // Render hook with an inline getter identity
      const { rerender } = renderHook(
        ({ getter }: { getter: () => Promise<string | null> }) =>
          useWorkItems('staff', [], {
            getAccessToken: getter,
            baseUrl: 'http://localhost:3000',
            fetchFn: fetchFn as any,
          }),
        {
          initialProps: {
            getter: () => Promise.resolve('initial_token_1'),
          },
        },
      );

      // Allow initial fetch to settle
      await act(async () => {
        await Promise.resolve();
      });
      const initialFetchCount = fetchCount;
      expect(initialFetchCount).toBe(1);

      // Re-render multiple times with completely new inline function identities
      rerender({ getter: () => Promise.resolve('new_token_2') });
      rerender({ getter: () => Promise.resolve('new_token_3') });
      rerender({ getter: () => Promise.resolve('new_token_4') });

      await act(async () => {
        await Promise.resolve();
      });

      // Proves no coordinator recreation loop occurred due to function identity churn
      expect(fetchCount).toBe(initialFetchCount);
    });
  });
});
