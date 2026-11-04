import { describe, expect, it, vi } from 'vitest';
import type { CreateWorkItemInput, WorkItemDto } from '@sn/contracts';
import { DeterministicTestWorkItemsAdapter } from './test-work-items-adapter';
import { WorkItemsCoordinator } from './work-items-coordinator';
import { WorkItemOperationError } from './work-items-types';

const SAMPLE_ITEM_1: WorkItemDto = {
  id: 'wrk_001',
  code: 'WI-001001',
  kind: 'delegated',
  title: 'Vouch purchase register',
  notes: 'Audit Aster Foods',
  assignmentId: 'asg_001',
  relatedClientId: 'cli_001',
  relatedPartyName: 'Aster Foods',
  assigneeId: 'usr_trainee',
  createdById: 'usr_senior',
  status: 'todo',
  dueAt: '2026-11-04T12:30:00.000Z',
  reminderAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

const SAMPLE_ITEM_STAFF: WorkItemDto = {
  id: 'wrk_002',
  code: 'WI-001002',
  kind: 'personal',
  title: 'Call banker',
  notes: null,
  assignmentId: null,
  relatedClientId: null,
  relatedPartyName: 'Bank',
  assigneeId: 'usr_staff',
  createdById: 'usr_staff',
  status: 'todo',
  dueAt: '2026-11-02T12:30:00.000Z',
  reminderAt: null,
  createdAt: '2026-11-01T04:00:00.000Z',
  updatedAt: '2026-11-01T04:00:00.000Z',
};

describe('WorkItemsCoordinator', () => {
  it('starts with empty items and no private demo fallback (hasLiveSnapshot=false)', () => {
    const port = new DeterministicTestWorkItemsAdapter();
    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'founder' });

    const state = coordinator.getState();
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.role).toBe('founder');
    expect(state.hasLiveSnapshot).toBe(false);
  });

  it('sync() loads server-authoritative snapshot and sets hasLiveSnapshot=true', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    port.setListResponse('founder', [SAMPLE_ITEM_1]);
    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'founder' });

    await coordinator.sync();

    const state = coordinator.getState();
    expect(state.items).toEqual([SAMPLE_ITEM_1]);
    expect(state.loading).toBe(false);
    expect(state.hasLiveSnapshot).toBe(true);
  });

  it('actual role change synchronously clears raw items before new fetch settles', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    port.setListResponse('founder', [SAMPLE_ITEM_1]);

    let resolveStaffList: (items: WorkItemDto[]) => void = () => {};
    const staffDeferred = new Promise<WorkItemDto[]>((resolve) => {
      resolveStaffList = resolve;
    });
    port.setDeferredList('staff', staffDeferred);

    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'founder' });
    await coordinator.sync();
    expect(coordinator.getState().items).toEqual([SAMPLE_ITEM_1]);

    // Switch role to staff
    const switchPromise = coordinator.switchRole('staff');

    // Synchronously before fetch settles: items must be cleared and loading must be true
    const synchronousState = coordinator.getState();
    expect(synchronousState.role).toBe('staff');
    expect(synchronousState.items).toEqual([]);
    expect(synchronousState.hasLiveSnapshot).toBe(false);
    expect(synchronousState.loading).toBe(true);

    // Now resolve staff fetch
    resolveStaffList([SAMPLE_ITEM_STAFF]);
    await switchPromise;

    const settledState = coordinator.getState();
    expect(settledState.role).toBe('staff');
    expect(settledState.items).toEqual([SAMPLE_ITEM_STAFF]);
    expect(settledState.hasLiveSnapshot).toBe(true);
    expect(settledState.loading).toBe(false);
  });

  it('generation guard discards old-role list response if user switches role quickly', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    let resolveFounder: (items: WorkItemDto[]) => void = () => {};
    const founderDeferred = new Promise<WorkItemDto[]>((resolve) => {
      resolveFounder = resolve;
    });
    port.setDeferredList('founder', founderDeferred);
    port.setListResponse('trainee', []);

    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'founder' });
    const founderSync = coordinator.sync();

    // User switches to trainee immediately
    await coordinator.switchRole('trainee');
    expect(coordinator.getState().role).toBe('trainee');

    // Late resolution of founder fetch
    resolveFounder([SAMPLE_ITEM_1]);
    await founderSync;

    // Must remain trainee with empty items, never leaked founder items
    expect(coordinator.getState().items).toEqual([]);
    expect(coordinator.getState().role).toBe('trainee');
  });

  it('cancelPending makes loading truthful and aborts active requests', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    const deferred = new Promise<WorkItemDto[]>(() => {});
    port.setDeferredList('senior_staff', deferred);

    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'senior_staff' });
    void coordinator.sync();
    expect(coordinator.getState().loading).toBe(true);

    coordinator.cancelPending();
    expect(coordinator.getState().loading).toBe(false);
  });

  it('handleCreateWorkItem is server-authoritative and non-optimistic', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'senior_staff' });

    const input: CreateWorkItemInput = {
      kind: 'delegated',
      title: 'Verify invoices',
      assignmentId: 'asg_001',
      assigneeId: 'usr_trainee',
      dueAt: '2026-11-04T12:30:00.000Z',
    };

    const serverCreatedDto: WorkItemDto = {
      id: 'wrk_created_999',
      code: 'WI-001003',
      kind: 'delegated',
      title: 'Verify invoices',
      notes: null,
      assignmentId: 'asg_001',
      relatedClientId: 'cli_001',
      relatedPartyName: 'Aster Foods',
      assigneeId: 'usr_trainee',
      createdById: 'usr_senior',
      status: 'todo',
      dueAt: '2026-11-04T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-02T04:00:00.000Z',
      updatedAt: '2026-11-02T04:00:00.000Z',
    };

    port.setCreateHandler(async () => serverCreatedDto);

    const res = await coordinator.handleCreateWorkItem(input);
    expect(res.success).toBe(true);
    expect(res.item).toEqual(serverCreatedDto);
    expect(coordinator.getState().items).toContainEqual(serverCreatedDto);
  });

  it('deduplicates duplicate in-flight create requests', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    let resolveCreate: (item: WorkItemDto) => void = () => {};
    const deferredCreate = new Promise<WorkItemDto>((resolve) => {
      resolveCreate = resolve;
    });
    port.setCreateHandler(() => deferredCreate);

    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'senior_staff' });

    const input: CreateWorkItemInput = {
      kind: 'delegated',
      title: 'Double click test',
      assignmentId: 'asg_001',
      assigneeId: 'usr_trainee',
      dueAt: '2026-11-04T12:30:00.000Z',
    };

    const firstPromise = coordinator.handleCreateWorkItem(input);
    const secondPromise = coordinator.handleCreateWorkItem(input);

    const secondRes = await secondPromise;
    expect(secondRes.success).toBe(false);
    expect(secondRes.error?.code).toBe('conflict');

    resolveCreate(SAMPLE_ITEM_1);
    const firstRes = await firstPromise;
    expect(firstRes.success).toBe(true);
  });

  it('allows concurrent creates for distinct parent assignments, different assignees, or distinct personal parties while rejecting exact duplicate', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    const deferredMap = new Map<string, { promise: Promise<WorkItemDto>; resolve: (item: WorkItemDto) => void }>();

    function createDeferred(key: string) {
      let resolve: (item: WorkItemDto) => void = () => {};
      const promise = new Promise<WorkItemDto>((r) => {
        resolve = r;
      });
      deferredMap.set(key, { promise, resolve });
      return promise;
    }

    port.setCreateHandler((_role, input) => {
      const key = `${input.kind}:${input.title}:${input.kind === 'delegated' ? `${input.assignmentId}:${input.assigneeId}` : (input.kind === 'personal' ? `${input.relatedPartyName}` : '')}`;
      const entry = deferredMap.get(key);
      if (entry) return entry.promise;
      return createDeferred(key);
    });

    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'senior_staff' });

    // 1. Exact duplicate rejected
    const exactInputA: CreateWorkItemInput = {
      kind: 'delegated',
      title: 'Vouch ledger',
      assignmentId: 'asg_001',
      assigneeId: 'usr_trainee',
      dueAt: '2026-11-04T12:30:00.000Z',
    };
    const exactKey = 'delegated:Vouch ledger:asg_001:usr_trainee';
    createDeferred(exactKey);

    const exactA = coordinator.handleCreateWorkItem(exactInputA);
    const exactB = coordinator.handleCreateWorkItem(exactInputA); // exact duplicate in-flight

    const exactBRes = await exactB;
    expect(exactBRes.success).toBe(false);
    expect(exactBRes.error?.code).toBe('conflict');

    // 2. Different parent assignment (same title, dueAt, assigneeId, but different assignmentId)
    const diffParentInput: CreateWorkItemInput = {
      kind: 'delegated',
      title: 'Vouch ledger',
      assignmentId: 'asg_002', // different parent
      assigneeId: 'usr_trainee',
      dueAt: '2026-11-04T12:30:00.000Z',
    };
    const diffParentKey = 'delegated:Vouch ledger:asg_002:usr_trainee';
    createDeferred(diffParentKey);

    const diffParentPromise = coordinator.handleCreateWorkItem(diffParentInput);

    // 3. Different assignee (same title, dueAt, assignmentId, but different assigneeId)
    const diffAssigneeInput: CreateWorkItemInput = {
      kind: 'delegated',
      title: 'Vouch ledger',
      assignmentId: 'asg_001',
      assigneeId: 'usr_staff', // different assignee
      dueAt: '2026-11-04T12:30:00.000Z',
    };
    const diffAssigneeKey = 'delegated:Vouch ledger:asg_001:usr_staff';
    createDeferred(diffAssigneeKey);

    const diffAssigneePromise = coordinator.handleCreateWorkItem(diffAssigneeInput);

    // 4. Distinct personal parties (same title, dueAt, but different relatedPartyName)
    const personalA: CreateWorkItemInput = {
      kind: 'personal',
      title: 'Call director',
      relatedPartyName: 'Aster Foods',
      dueAt: '2026-11-04T12:30:00.000Z',
    };
    const personalB: CreateWorkItemInput = {
      kind: 'personal',
      title: 'Call director',
      relatedPartyName: 'BluePeak Tech', // distinct party
      dueAt: '2026-11-04T12:30:00.000Z',
    };
    const personalAKey = 'personal:Call director:Aster Foods';
    const personalBKey = 'personal:Call director:BluePeak Tech';
    createDeferred(personalAKey);
    createDeferred(personalBKey);

    const personalAPromise = coordinator.handleCreateWorkItem(personalA);
    const personalBPromise = coordinator.handleCreateWorkItem(personalB);

    // Now resolve all the non-duplicate in-flight creates: none should have failed with conflict!
    deferredMap.get(exactKey)!.resolve({ ...SAMPLE_ITEM_1, id: 'wrk_exact' });
    deferredMap.get(diffParentKey)!.resolve({ ...SAMPLE_ITEM_1, id: 'wrk_diff_parent', assignmentId: 'asg_002' });
    deferredMap.get(diffAssigneeKey)!.resolve({ ...SAMPLE_ITEM_1, id: 'wrk_diff_assignee', assigneeId: 'usr_staff' });
    deferredMap.get(personalAKey)!.resolve({ ...SAMPLE_ITEM_STAFF, id: 'wrk_pers_a', relatedPartyName: 'Aster Foods' });
    deferredMap.get(personalBKey)!.resolve({ ...SAMPLE_ITEM_STAFF, id: 'wrk_pers_b', relatedPartyName: 'BluePeak Tech' });

    const [resExactA, resDiffParent, resDiffAssignee, resPersA, resPersB] = await Promise.all([
      exactA,
      diffParentPromise,
      diffAssigneePromise,
      personalAPromise,
      personalBPromise,
    ]);

    expect(resExactA.success).toBe(true);
    expect(resDiffParent.success).toBe(true);
    expect(resDiffAssignee.success).toBe(true);
    expect(resPersA.success).toBe(true);
    expect(resPersB.success).toBe(true);
  });

  it('handleTransitionWorkItem rejects missing ID with normalized not_found error without mutating state', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'senior_staff' });

    const res = await coordinator.handleTransitionWorkItem('non_existent_id', 'start');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('not_found');
    expect(coordinator.getState().items).toEqual([]);
  });

  it('re-reads current item after await and does not resurrect a removed row', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    port.setListResponse('staff', [SAMPLE_ITEM_STAFF]);
    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'staff' });
    await coordinator.sync();

    let resolveTransition: (item: WorkItemDto) => void = () => {};
    const deferredTransition = new Promise<WorkItemDto>((resolve) => {
      resolveTransition = resolve;
    });
    port.setTransitionHandler(() => deferredTransition);

    const transitionPromise = coordinator.handleTransitionWorkItem(SAMPLE_ITEM_STAFF.id, 'complete');

    // While in flight, role switch clears items
    void coordinator.switchRole('founder');

    // Late resolution of transition
    resolveTransition({ ...SAMPLE_ITEM_STAFF, status: 'completed' });
    const result = await transitionPromise;

    // Transition should have been discarded due to generation/role switch, never resurrecting row
    expect(result.success).toBe(false);
    expect(coordinator.getState().items).toEqual([]);
  });

  it('deduplicates active transition for the same item ID preventing double submit', async () => {
    const port = new DeterministicTestWorkItemsAdapter();
    port.setListResponse('staff', [SAMPLE_ITEM_STAFF]);
    const coordinator = new WorkItemsCoordinator({ port, initialRole: 'staff' });
    await coordinator.sync();

    let resolveTrans: (item: WorkItemDto) => void = () => {};
    const deferredTrans = new Promise<WorkItemDto>((resolve) => {
      resolveTrans = resolve;
    });
    port.setTransitionHandler(() => deferredTrans);

    const first = coordinator.handleTransitionWorkItem(SAMPLE_ITEM_STAFF.id, 'complete');
    const second = coordinator.handleTransitionWorkItem(SAMPLE_ITEM_STAFF.id, 'complete');

    const secondRes = await second;
    expect(secondRes.success).toBe(false);
    expect(secondRes.error?.code).toBe('conflict');

    resolveTrans({ ...SAMPLE_ITEM_STAFF, status: 'completed' });
    const firstRes = await first;
    expect(firstRes.success).toBe(true);
  });
});
