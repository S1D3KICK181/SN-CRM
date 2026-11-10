import { describe, expect, it } from 'vitest';
import type { AssignmentRow } from '../data';
import { AssignmentsCoordinator } from './coordinator';
import { DeterministicTestAssignmentsAdapter } from './test-adapter';
import { AssignmentOperationError } from './types';

const INITIAL_ROWS: AssignmentRow[] = [
  {
    id: 'ASN-0001',
    title: 'Initial Assignment 1',
    client: 'Client One',
    service: 'GST Compliance',
    due: '03/11/2026',
    owner: 'Priya Desai',
    status: 'In progress',
    progress: 50,
    tone: 'default',
    expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
  },
  {
    id: 'ASN-0002',
    title: 'Initial Assignment 2',
    client: 'Client Two',
    service: 'Audit',
    due: '06/11/2026',
    owner: 'Rohan Mehta',
    status: 'Pending review',
    progress: 80,
    tone: 'warning',
    expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
  },
];

const FOUNDER_ROW: AssignmentRow = {
  id: 'asg_founder',
  title: 'Founder Assignment',
  client: 'Big Corp',
  service: 'Advisory',
  due: '10/11/2026',
  owner: 'S. Narayanan',
  status: 'Open',
  progress: 15,
  tone: 'default',
  expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
};

const STAFF_ROW: AssignmentRow = {
  id: 'asg_staff',
  title: 'Staff Assignment',
  client: 'Local Shop',
  service: 'Bookkeeping',
  due: '12/11/2026',
  owner: 'Rohan Mehta',
  status: 'In progress',
  progress: 50,
  tone: 'default',
  expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
};

describe('AssignmentsCoordinator', () => {
  it('keeps INITIAL_ROWS visible until first live list succeeds, then replaces with snapshot', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListResponse('founder', [FOUNDER_ROW]);

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
    });

    expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);

    await coordinator.sync();
    expect(coordinator.getState().assignments).toEqual([FOUNDER_ROW]);
  });

  it('preserves previous snapshot on list failure and reports explicit live-data error', async () => {
    const errorsReported: string[] = [];
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setListError(
      'founder',
      new AssignmentOperationError({
        code: 'network',
        message: 'Backend is unreachable',
      }),
    );

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
      onError: (err) => errorsReported.push(err.message),
    });

    await coordinator.sync();

    // Snapshot preserved
    expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);
    // Explicit error reported
    expect(errorsReported).toHaveLength(1);
    expect(errorsReported[0]).toContain('Backend is unreachable');
  });

  it('prevents old-role late list response from overwriting new-role view (race condition protection)', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    // Founder response takes longer to resolve
    let resolveFounderList: (rows: AssignmentRow[]) => void = () => {};
    adapter.setDeferredList('founder', new Promise<AssignmentRow[]>((resolve) => {
      resolveFounderList = resolve;
    }));
    // Staff response resolves immediately
    adapter.setListResponse('staff', [STAFF_ROW]);

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
    });

    // Start founder list fetch (slow)
    const founderSync = coordinator.sync();

    // User rapidly switches role to staff
    await coordinator.switchRole('staff');
    expect(coordinator.getState().assignments).toEqual([STAFF_ROW]);

    // Late founder list arrives
    resolveFounderList([FOUNDER_ROW]);
    await founderSync;

    // View MUST still be staff view!
    expect(coordinator.getState().assignments).toEqual([STAFF_ROW]);
  });

  it('prevents old-role writes from mutating a new-role view (generation guard on writes)', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    let resolveCreate: (row: AssignmentRow) => void = () => {};
    adapter.setDeferredCreate(new Promise<AssignmentRow>((resolve) => {
      resolveCreate = resolve;
    }));
    adapter.setListResponse('staff', [STAFF_ROW]);

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
    });

    // Trigger create under founder role
    const createPromise = coordinator.handleCreateAssignment({
      title: 'Slow Created Assignment',
      client: 'Pending Client',
      service: 'GST',
      due: '15/11/2026',
      owner: 'Priya Desai',
      status: 'Open',
      progress: 0,
      tone: 'default',
    });

    // User switches role before create finishes
    await coordinator.switchRole('staff');
    expect(coordinator.getState().assignments).toEqual([STAFF_ROW]);

    // Create resolves now
    resolveCreate({
      id: 'asg_late_created',
      title: 'Slow Created Assignment',
      client: 'Pending Client',
      service: 'GST',
      due: '15/11/2026',
      owner: 'Priya Desai',
      status: 'Open',
      progress: 0,
      tone: 'default',
    });

    const result = await createPromise;
    expect(result.success).toBe(false); // Ignored due to generation mismatch
    expect(coordinator.getState().assignments).toEqual([STAFF_ROW]);
  });

  it('is server-authoritative on create: no optimistic insert; inserts once on success', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    const createdServerRow: AssignmentRow = {
      id: 'asg_new_server_id',
      title: 'New Service',
      client: 'New Client',
      service: 'TDS Compliance',
      due: '20/11/2026',
      owner: 'Rohan Mehta',
      status: 'Open',
      progress: 15,
      tone: 'default',
    };
    adapter.setCreateResponse(createdServerRow);

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
    });

    const result = await coordinator.handleCreateAssignment({
      title: 'New Service',
      client: 'New Client',
      service: 'TDS Compliance',
      due: '20/11/2026',
      owner: 'Rohan Mehta',
      status: 'Open',
      progress: 15,
      tone: 'default',
    });

    expect(result.success).toBe(true);
    expect(coordinator.getState().assignments[0]?.id).toBe('asg_new_server_id');
    expect(coordinator.getState().assignments).toHaveLength(3);

    // Deduplication check: duplicate call will not add duplicate ID
    await coordinator.handleCreateAssignment({
      id: 'asg_new_server_id',
      title: 'New Service',
      client: 'New Client',
      service: 'TDS Compliance',
      due: '20/11/2026',
      owner: 'Rohan Mehta',
      status: 'Open',
      progress: 15,
      tone: 'default',
    });
    expect(coordinator.getState().assignments).toHaveLength(3);
  });

  it('leaves state unchanged on failed create and reports normalized error', async () => {
    const errors: string[] = [];
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setCreateError(
      new AssignmentOperationError({
        code: 'forbidden',
        message: 'Only leadership may create assignments',
      }),
    );

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'trainee',
      onError: (err) => errors.push(err.message),
    });

    const result = await coordinator.handleCreateAssignment({
      title: 'Unauthorized Assignment',
      client: 'Client',
      service: 'GST',
      due: '20/11/2026',
      owner: 'Neha Kapoor',
      status: 'Open',
      progress: 0,
      tone: 'default',
    });

    expect(result.success).toBe(false);
    expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);
    expect(errors[0]).toContain('Only leadership may create assignments');
  });

  it('is server-authoritative on transition: replaces exact server ID row on success', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    const updatedServerRow: AssignmentRow = {
      ...INITIAL_ROWS[0]!,
      status: 'Pending review',
      tone: 'warning',
      progress: 80,
    };
    adapter.setTransitionResponse('ASN-0001', 'submit', updatedServerRow);

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'senior_staff',
    });

    const result = await coordinator.handleUpdateAssignment({
      ...INITIAL_ROWS[0]!,
      status: 'Pending review',
    });

    expect(result.success).toBe(true);
    const updatedRow = coordinator.getState().assignments.find((a) => a.id === 'ASN-0001');
    expect(updatedRow?.status).toBe('Pending review');
    expect(updatedRow?.progress).toBe(80);
    // Unrelated row unchanged
    expect(coordinator.getState().assignments.find((a) => a.id === 'ASN-0002')).toEqual(INITIAL_ROWS[1]);
  });

  it('leaves state unchanged on failed transition and reports normalized error', async () => {
    const errors: string[] = [];
    const adapter = new DeterministicTestAssignmentsAdapter();
    adapter.setTransitionError(
      'ASN-0001',
      'submit',
      new AssignmentOperationError({
        code: 'conflict',
        message: 'Assignment state conflict',
      }),
    );

    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'senior_staff',
      onError: (err) => errors.push(err.message),
    });

    const result = await coordinator.handleUpdateAssignment({
      ...INITIAL_ROWS[0]!,
      status: 'Pending review',
    });

    expect(result.success).toBe(false);
    expect(coordinator.getState().assignments[0]?.status).toBe('In progress');
    expect(errors[0]).toContain('Assignment state conflict');
  });

  it('dispatches port.update for same-status core edits, and treats non-wire edits as local-only', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
    });

    const editedRow: AssignmentRow = {
      ...INITIAL_ROWS[0]!,
      title: 'Edited Title Locally',
      fee: 45000,
      deliveryNotes: 'Updated local note',
      // status is unchanged: 'In progress'
    };

    const result = await coordinator.handleUpdateAssignment(editedRow);

    expect(result.success).toBe(true);
    expect(adapter.getTransitionCallCount()).toBe(0); // Zero transition API calls!
    const inState = coordinator.getState().assignments.find((a) => a.id === 'ASN-0001');
    expect(inState?.title).toBe('Edited Title Locally');

    // Pure local edit (no wire field changed)
    const localResult = await coordinator.handleUpdateAssignment(inState!);
    expect(localResult.success).toBe(true);
    expect(localResult.localOnly).toBe(true);
  });

  it('fails with not_found AssignmentOperationError when updated.id does not exist', async () => {
    const errors: AssignmentOperationError[] = [];
    const toasts: string[] = [];
    const adapter = new DeterministicTestAssignmentsAdapter();
    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
      onError: (err) => errors.push(err),
      onToast: (msg) => toasts.push(msg),
    });

    const ghostRow: AssignmentRow = {
      id: 'ASN-NONEXISTENT',
      title: 'Ghost Row',
      client: 'Ghost Client',
      service: 'Advisory',
      due: '10/11/2026',
      owner: 'S. Narayanan',
      status: 'Open',
      progress: 0,
      tone: 'default',
    };

    const result = await coordinator.handleUpdateAssignment(ghostRow);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('not_found');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('not_found');
    expect(toasts).toHaveLength(0); // must not show success toast
    expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);
  });

  it('preserves exact baseline toast copy for same-status/UI-only edits without implementation commentary', async () => {
    const toasts: string[] = [];
    const adapter = new DeterministicTestAssignmentsAdapter();
    const coordinator = new AssignmentsCoordinator({
      initialRows: INITIAL_ROWS,
      port: adapter,
      initialRole: 'founder',
      onToast: (msg) => toasts.push(msg),
    });

    const editedRow: AssignmentRow = {
      ...INITIAL_ROWS[0]!,
      title: 'Edited Title Locally',
    };

    await coordinator.handleUpdateAssignment(editedRow);

    expect(toasts).toEqual(['Updated ASN-0001 (Edited Title Locally)']);
  });

  describe('Coordinator disposal and cancellation', () => {
    it('aborts active operations, suppresses callbacks, and is idempotent upon dispose', async () => {
      const toasts: string[] = [];
      const errors: AssignmentOperationError[] = [];
      let notifications = 0;

      const adapter = new DeterministicTestAssignmentsAdapter();
      // Setup a deferred list that never resolves on its own
      let resolveListDeferred: (rows: AssignmentRow[]) => void = () => {};
      const listPromise = new Promise<AssignmentRow[]>((resolve) => {
        resolveListDeferred = resolve;
      });
      adapter.setDeferredList('founder', listPromise);

      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: adapter,
        initialRole: 'founder',
        onError: (err) => errors.push(err),
        onToast: (msg) => toasts.push(msg),
      });

      coordinator.subscribe(() => {
        notifications++;
      });

      // Start sync
      const syncPromise = coordinator.sync();
      expect(coordinator.getState().loading).toBe(true);

      // Dispose while sync is in flight
      coordinator.dispose();
      expect(coordinator.isDisposed()).toBe(true);

      // Calling dispose again should be safe and idempotent
      coordinator.dispose();
      expect(coordinator.isDisposed()).toBe(true);

      // Now resolve the deferred list
      resolveListDeferred([FOUNDER_ROW]);
      await syncPromise;

      // Ensure no state update or callbacks occurred after disposal
      expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);
      expect(errors).toHaveLength(0);
      expect(toasts).toHaveLength(0);
    });

    it('suppresses callbacks and aborts in-flight transition upon dispose', async () => {
      const toasts: string[] = [];
      const errors: AssignmentOperationError[] = [];

      let resolveTransitionDeferred: (row: AssignmentRow) => void = () => {};
      const transitionPromise = new Promise<AssignmentRow>((resolve) => {
        resolveTransitionDeferred = resolve;
      });

      const adapter = new DeterministicTestAssignmentsAdapter();
      const customPort = {
        ...adapter,
        list: (role: any, opts: any) => adapter.list(role, opts),
        create: (role: any, cmd: any, opts: any) => adapter.create(role, cmd, opts),
        transition: async (role: any, id: string, action: any, opts: any) => {
          opts?.signal?.addEventListener('abort', () => {
            // Signal aborted
          });
          return await transitionPromise;
        },
      };

      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: customPort as any,
        initialRole: 'senior_staff',
        onError: (err) => errors.push(err),
        onToast: (msg) => toasts.push(msg),
      });

      const updatePromise = coordinator.handleUpdateAssignment({
        ...INITIAL_ROWS[0]!,
        status: 'Pending review',
      });

      coordinator.dispose();

      // Resolve after disposal
      resolveTransitionDeferred({
        ...INITIAL_ROWS[0]!,
        status: 'Pending review',
      });

      const res = await updatePromise;
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('aborted');
      expect(toasts).toHaveLength(0);
      expect(errors).toHaveLength(0);
      expect(coordinator.getState().assignments[0]?.status).toBe('In progress');
    });
  });

  describe('Explicit domain operations', () => {
    it('cascades client field updates to matching assignments by id, name, or tradeName', () => {
      let notified = 0;
      const initial: AssignmentRow[] = [
        {
          id: 'ASN-001',
          clientId: 'cli-001',
          client: 'Aster Foods Private Limited',
          title: 'GST Return',
          service: 'GST',
          due: '10/11/2026',
          owner: 'Priya Desai',
          status: 'In progress',
          progress: 50,
          tone: 'default',
          bankStatementRequired: true,
          bankRecStatus: 'Awaited',
        },
        {
          id: 'ASN-002',
          client: 'Aster Foods', // Matches tradeName
          title: 'TDS Return',
          service: 'TDS',
          due: '12/11/2026',
          owner: 'Rohan Mehta',
          status: 'Open',
          progress: 10,
          tone: 'default',
          bankStatementRequired: true,
          bankRecStatus: 'Completed',
        },
        {
          id: 'ASN-003',
          clientId: 'cli-999',
          client: 'Unrelated Corp',
          title: 'Advisory',
          service: 'Consulting',
          due: '15/11/2026',
          owner: 'S. Narayanan',
          status: 'Open',
          progress: 0,
          tone: 'default',
          bankStatementRequired: true,
          bankRecStatus: 'Awaited',
        },
      ];

      const adapter = new DeterministicTestAssignmentsAdapter();
      const coordinator = new AssignmentsCoordinator({
        initialRows: initial,
        port: adapter,
        initialRole: 'founder',
      });

      coordinator.subscribe(() => {
        notified++;
      });

      coordinator.cascadeClientFields({
        id: 'cli-001',
        name: 'Aster Foods Private Limited',
        tradeName: 'Aster Foods',
        bankStatementRequired: false,
      });

      expect(notified).toBe(1);
      const state = coordinator.getState().assignments;

      // ASN-001 matched by id and name
      expect(state[0]?.bankStatementRequired).toBe(false);
      expect(state[0]?.bankRecStatus).toBe('Not applicable');

      // ASN-002 matched by tradeName
      expect(state[1]?.bankStatementRequired).toBe(false);
      expect(state[1]?.bankRecStatus).toBe('Not applicable');

      // ASN-003 untouched
      expect(state[2]?.bankStatementRequired).toBe(true);
      expect(state[2]?.bankRecStatus).toBe('Awaited');
    });

    it('marks assignment as billed and notifies subscribers once', () => {
      let notified = 0;
      const adapter = new DeterministicTestAssignmentsAdapter();
      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: adapter,
        initialRole: 'founder',
      });

      coordinator.subscribe(() => {
        notified++;
      });

      coordinator.markAssignmentBilled('ASN-0001');

      expect(notified).toBe(1);
      const target = coordinator.getState().assignments.find((a) => a.id === 'ASN-0001');
      expect(target?.billed).toBe(true);

      // Redundant mark does not notify again
      coordinator.markAssignmentBilled('ASN-0001');
      expect(notified).toBe(1);
    });
  });

  describe('Blocker 1: Cross-role data isolation', () => {
    it('Founder to Trainee switch synchronously removes Founder rows before list resolves', async () => {
      const adapter = new DeterministicTestAssignmentsAdapter();
      adapter.setListResponse('founder', [FOUNDER_ROW]);

      let resolveTraineeList: (rows: AssignmentRow[]) => void = () => {};
      const traineeListPromise = new Promise<AssignmentRow[]>((resolve) => {
        resolveTraineeList = resolve;
      });
      adapter.setDeferredList('trainee', traineeListPromise);

      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: adapter,
        initialRole: 'founder',
      });

      await coordinator.sync();
      expect(coordinator.getState().assignments).toEqual([FOUNDER_ROW]);

      // Switch to trainee (pending fetch)
      const switchPromise = coordinator.switchRole('trainee');

      // SYNCHRONOUS ASSERTION: Founder rows MUST be cleared immediately before list resolves!
      expect(coordinator.getState().assignments).toEqual([]);
      expect(coordinator.getState().loading).toBe(true);

      // Now resolve trainee list
      const TRAINEE_ROW: AssignmentRow = {
        id: 'asg_trainee_01',
        title: 'Trainee Task',
        client: 'Client C',
        service: 'Bookkeeping',
        due: '15/11/2026',
        owner: 'Neha Kapoor',
        status: 'Open',
        progress: 10,
        tone: 'default',
      };
      resolveTraineeList([TRAINEE_ROW]);
      await switchPromise;

      expect(coordinator.getState().assignments).toEqual([TRAINEE_ROW]);
      expect(coordinator.getState().loading).toBe(false);
    });

    it('new-role list failure remains in safe new-role state and never restores Founder rows', async () => {
      const adapter = new DeterministicTestAssignmentsAdapter();
      adapter.setListResponse('founder', [FOUNDER_ROW]);
      adapter.setListError(
        'trainee',
        new AssignmentOperationError({
          code: 'network',
          message: 'Trainee network timeout',
        }),
      );

      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: adapter,
        initialRole: 'founder',
      });

      await coordinator.sync();
      expect(coordinator.getState().assignments).toEqual([FOUNDER_ROW]);

      // Switch to trainee, which will fail
      await coordinator.switchRole('trainee');

      // Must remain empty/safe, NEVER restoring Founder rows
      expect(coordinator.getState().assignments).toEqual([]);
      expect(coordinator.getState().error?.message).toContain('Trainee network timeout');
    });

    it('initial same-role pending or failure retains only the intended initial snapshot', async () => {
      let rejectInitial: (err: Error) => void = () => {};
      const initialPromise = new Promise<AssignmentRow[]>((_, reject) => {
        rejectInitial = reject;
      });

      const adapter = new DeterministicTestAssignmentsAdapter();
      adapter.setDeferredList('founder', initialPromise);

      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: adapter,
        initialRole: 'founder',
      });

      // Same-role sync pending retains initial rows
      const syncPromise = coordinator.sync();
      expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);

      // Fail initial list
      rejectInitial(new AssignmentOperationError({ code: 'network', message: 'Offline' }));
      await syncPromise;

      // Retains intended initial snapshot
      expect(coordinator.getState().assignments).toEqual(INITIAL_ROWS);
    });
  });

  describe('Lifecycle: Permanent disposal invariants', () => {
    it('permanently disposed coordinator cannot be resurrected via subscribe or switchRole', async () => {
      const adapter = new DeterministicTestAssignmentsAdapter();
      adapter.setListResponse('founder', [FOUNDER_ROW]);
      adapter.setListResponse('staff', [STAFF_ROW]);

      const coordinator = new AssignmentsCoordinator({
        initialRows: INITIAL_ROWS,
        port: adapter,
        initialRole: 'founder',
      });

      await coordinator.sync();
      expect(coordinator.getState().assignments).toEqual([FOUNDER_ROW]);

      // Permanently dispose
      coordinator.dispose();
      expect(coordinator.isDisposed()).toBe(true);

      // Attempting to subscribe must NOT resurrect
      let notified = 0;
      coordinator.subscribe(() => {
        notified++;
      });
      expect(coordinator.isDisposed()).toBe(true);

      // Attempting to switchRole must NOT resurrect or execute
      await coordinator.switchRole('staff');
      expect(coordinator.isDisposed()).toBe(true);
      expect(coordinator.getState().assignments).toEqual([FOUNDER_ROW]); // Not mutated to STAFF_ROW
      expect(notified).toBe(0);
    });
  });

  describe('Blocker 2: Transition preserves local domain fields in coordinator', () => {
    it('preserves fee, scope, deliveryNotes, billed, invoiceId, and bankRec across transition', async () => {
      const adapter = new DeterministicTestAssignmentsAdapter();
      const richRow: AssignmentRow = {
        id: 'ASN-0001',
        title: 'GST Engagement',
        client: 'Acme Corp',
        clientId: 'cli_acme',
        service: 'GST Compliance',
        due: '10/11/2026',
        owner: 'Priya Desai',
        reviewer: 'Ananya Rao',
        status: 'In progress',
        progress: 50,
        tone: 'default',
        fee: 45000,
        scope: 'Custom high-risk audit scope',
        deliveryNotes: 'Awaiting ledger',
        billed: true,
        invoiceId: 'INV-999',
        bankStatementRequired: false,
        bankRecStatus: 'Not applicable',
        expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
      };

      // Server returns row with standard mapper defaults
      adapter.setTransitionResponse('ASN-0001', 'submit', {
        id: 'ASN-0001',
        title: 'GST Engagement',
        client: 'Acme Corp',
        clientId: 'cli_acme',
        service: 'GST Compliance',
        due: '10/11/2026',
        owner: 'Priya Desai',
        reviewer: 'Ananya Rao',
        status: 'Pending review',
        progress: 80,
        tone: 'warning',
        fee: 25000, // mapper default
        billed: false, // mapper default
        bankStatementRequired: true, // mapper default
        bankRecStatus: 'Awaited', // mapper default
      });

      const coordinator = new AssignmentsCoordinator({
        initialRows: [richRow],
        port: adapter,
        initialRole: 'senior_staff',
      });

      const res = await coordinator.handleUpdateAssignment({
        ...richRow,
        status: 'Pending review',
      });

      expect(res.success).toBe(true);
      const updated = coordinator.getState().assignments[0]!;
      expect(updated.status).toBe('Pending review');
      expect(updated.progress).toBe(80);
      expect(updated.fee).toBe(45000); // Preserved!
      expect(updated.scope).toBe('Custom high-risk audit scope'); // Preserved!
      expect(updated.deliveryNotes).toBe('Awaiting ledger'); // Preserved!
      expect(updated.billed).toBe(true); // Preserved!
      expect(updated.invoiceId).toBe('INV-999'); // Preserved!
      expect(updated.bankStatementRequired).toBe(false); // Preserved!
      expect(updated.bankRecStatus).toBe('Not applicable'); // Preserved!
    });
  });

  describe('Final review pass regressions', () => {
    describe('Finding 2: cancel/abort state truthfulness', () => {
      it('cancelPending immediately makes getState().loading false and notifies subscribers', async () => {
        let resolveList: (rows: AssignmentRow[]) => void = () => {};
        const adapter = new DeterministicTestAssignmentsAdapter();
        // Override list with deferred promise
        adapter.list = () =>
          new Promise((resolve) => {
            resolveList = resolve;
          });

        const coordinator = new AssignmentsCoordinator({
          initialRows: INITIAL_ROWS,
          port: adapter,
          initialRole: 'founder',
        });

        const states: boolean[] = [];
        coordinator.subscribe(() => {
          states.push(coordinator.getState().loading);
        });

        // Trigger sync
        void coordinator.sync();

        expect(coordinator.getState().loading).toBe(true);
        expect(states).toContain(true);

        // Cancel while loading is in-flight
        coordinator.cancelPending();

        // getState().loading must be false immediately
        expect(coordinator.getState().loading).toBe(false);

        // Subscriber must receive loading=false transition
        expect(states[states.length - 1]).toBe(false);

        // Resolving the abandoned promise later must not mutate or re-enter loading
        resolveList([FOUNDER_ROW]);
        await Promise.resolve();
        expect(coordinator.getState().loading).toBe(false);
      });

      it('same-generation abort notifies subscriber of loading=false transition', async () => {
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.list = () => {
          throw new AssignmentOperationError({
            code: 'aborted',
            message: 'Request was aborted',
          });
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: INITIAL_ROWS,
          port: adapter,
          initialRole: 'founder',
        });

        const loadingEvents: boolean[] = [];
        coordinator.subscribe(() => {
          loadingEvents.push(coordinator.getState().loading);
        });

        await coordinator.sync();

        expect(coordinator.getState().loading).toBe(false);
        // Must contain true (sync started) and end with false (aborted and notified)
        expect(loadingEvents).toEqual([true, false]);
      });

      it('role switch isolates state immediately without stale-row flash to subscribers', async () => {
        let resolveStaffList: (rows: AssignmentRow[]) => void = () => {};
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.list = (role) => {
          if (role === 'staff') {
            return new Promise((resolve) => {
              resolveStaffList = resolve;
            });
          }
          return Promise.resolve([FOUNDER_ROW]);
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [FOUNDER_ROW],
          port: adapter,
          initialRole: 'founder',
        });

        // Live snapshot populated for founder
        await coordinator.sync();
        expect(coordinator.getState().assignments).toEqual([FOUNDER_ROW]);

        const capturedNotifications: Array<{ role: string; count: number }> = [];
        coordinator.subscribe(() => {
          const st = coordinator.getState();
          capturedNotifications.push({ role: st.role, count: st.assignments.length });
        });

        // Switch role to staff
        const switchPromise = coordinator.switchRole('staff');

        // Immediately after switchRole starts, role is staff and assignments are cleared
        expect(coordinator.getState().role).toBe('staff');
        expect(coordinator.getState().assignments).toEqual([]);

        // Ensure NO notification presented role 'staff' with founder's 1 row
        for (const notification of capturedNotifications) {
          if (notification.role === 'staff') {
            expect(notification.count).toBe(0);
          }
        }

        resolveStaffList([STAFF_ROW]);
        await switchPromise;
        expect(coordinator.getState().assignments).toEqual([STAFF_ROW]);
      });
    });

    describe('Finding 3: concurrent local mutation during transition', () => {
      it('preserves concurrent billed and bank cascade mutations during deferred transition', async () => {
        let resolveTransition: (row: AssignmentRow) => void = () => {};
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.transition = () =>
          new Promise((resolve) => {
            resolveTransition = resolve;
          });

        const initialRow: AssignmentRow = {
          id: 'ASN-0001',
          title: 'Initial Title',
          client: 'Acme Corp',
          clientId: 'cli_acme',
          service: 'GST Compliance',
          due: '10/11/2026',
          owner: 'Priya Desai',
          reviewer: 'Ananya Rao',
          status: 'In progress',
          progress: 50,
          tone: 'default',
          fee: 30000,
          scope: 'Initial audit scope',
          billed: false,
          bankStatementRequired: true,
          bankRecStatus: 'Awaited',
          expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [initialRow],
          port: adapter,
          initialRole: 'senior_staff',
        });

        const updatePromise = coordinator.handleUpdateAssignment({
          ...initialRow,
          status: 'Pending review',
          fee: 42000,
        });

        // While transition is pending, concurrent events happen:
        // 1. Assignment is billed
        coordinator.markAssignmentBilled('ASN-0001');
        // 2. Client bank requirement changes to false
        coordinator.cascadeClientFields({
          id: 'cli_acme',
          name: 'Acme Corp',
          bankStatementRequired: false,
        });

        // Verify local state reflects the concurrent mutations
        const currentMidState = coordinator.getState().assignments[0]!;
        expect(currentMidState.billed).toBe(true);
        expect(currentMidState.bankStatementRequired).toBe(false);
        expect(currentMidState.bankRecStatus).toBe('Not applicable');

        // Allow update step microtasks to complete and transition promise to be created
        await new Promise((r) => setTimeout(r, 10));

        // Now resolve server transition
        resolveTransition({
          id: 'ASN-0001',
          title: 'Initial Title', // server default
          client: 'Acme Corp',
          clientId: 'cli_acme',
          service: 'GST Compliance',
          due: '10/11/2026',
          owner: 'Priya Desai',
          reviewer: 'Ananya Rao',
          status: 'Pending review',
          progress: 80,
          tone: 'warning',
          fee: 25000, // mapper default
          billed: false, // mapper default
          bankStatementRequired: true, // mapper default
          bankRecStatus: 'Awaited', // mapper default
        });

        const res = await updatePromise;
        expect(res.success).toBe(true);

        const finalRow = coordinator.getState().assignments[0]!;
        // Lifecycle status advanced
        expect(finalRow.status).toBe('Pending review');
        expect(finalRow.progress).toBe(80);
        // Drawer edits preserved
        expect(finalRow.title).toBe('Initial Title');
        expect(finalRow.fee).toBe(42000);
        // CONCURRENT LOCAL MUTATIONS MUST SURVIVE!
        expect(finalRow.billed).toBe(true);
        expect(finalRow.bankStatementRequired).toBe(false);
        expect(finalRow.bankRecStatus).toBe('Not applicable');
      });

      it('fails safely and does not resurrect stale data if row disappeared during transition', async () => {
        let resolveTransition: (row: AssignmentRow) => void = () => {};
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.transition = () =>
          new Promise((resolve) => {
            resolveTransition = resolve;
          });

        const initialRow: AssignmentRow = {
          id: 'ASN-0001',
          title: 'Initial Title',
          client: 'Acme Corp',
          service: 'GST Compliance',
          due: '10/11/2026',
          owner: 'Priya Desai',
          status: 'In progress',
          progress: 50,
          tone: 'default',
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [initialRow],
          port: adapter,
          initialRole: 'founder',
        });

        const updatePromise = coordinator.handleUpdateAssignment({
          ...initialRow,
          status: 'Pending review',
        });

        // Clear row in coordinator while transition is pending
        (coordinator as any).assignments = [];

        resolveTransition({
          ...initialRow,
          status: 'Pending review',
        });

        const res = await updatePromise;
        expect(res.success).toBe(false);
        // Must NOT resurrect stale row into assignments
        expect(coordinator.getState().assignments).toHaveLength(0);
      });
    });

    describe('Finding 4: status alias and drawer vocabulary', () => {
      it('treats "Open" ↔ "Awaiting documents" as a local-only edit without server transition or conflict', async () => {
        const adapter = new DeterministicTestAssignmentsAdapter();
        let transitionCalled = false;
        adapter.transition = async () => {
          transitionCalled = true;
          throw new Error('Should not call transition');
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Open Assignment',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'Open',
              progress: 15,
              tone: 'default',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          status: 'Awaiting documents',
        });

        expect(res.success).toBe(true);
        expect(res.localOnly).toBe(true);
        expect(transitionCalled).toBe(false);
        expect(coordinator.getState().assignments[0]!.status).toBe('Awaiting documents');
      });

      it('treats "In progress" ↔ "On track" as a local-only edit', async () => {
        const adapter = new DeterministicTestAssignmentsAdapter();
        let transitionCalled = false;
        adapter.transition = async () => {
          transitionCalled = true;
          throw new Error('Should not call transition');
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0002',
              title: 'In Progress Assignment',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'In progress',
              progress: 50,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          status: 'On track',
        });

        expect(res.success).toBe(true);
        expect(res.localOnly).toBe(true);
        expect(transitionCalled).toBe(false);
        expect(coordinator.getState().assignments[0]!.status).toBe('On track');
      });

      it('triggers real server transition ("start") when moving from "Awaiting documents" to "In progress"', async () => {
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.setTransitionResponse('ASN-0001', 'start', {
          id: 'ASN-0001',
          title: 'Started Assignment',
          client: 'Acme Corp',
          service: 'GST Compliance',
          due: '10/11/2026',
          owner: 'Priya Desai',
          status: 'In progress',
          progress: 50,
          tone: 'default',
        });

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Open Assignment',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'Awaiting documents',
              progress: 15,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          status: 'In progress',
        });

        expect(res.success).toBe(true);
        expect(res.localOnly).toBeUndefined();
        expect(coordinator.getState().assignments[0]!.status).toBe('In progress');
      });

      it('control case: rejects illegal jump from "Awaiting documents" directly to "Completed"', async () => {
        const adapter = new DeterministicTestAssignmentsAdapter();
        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Open Assignment',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'Awaiting documents',
              progress: 15,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          status: 'Completed',
        });

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe('conflict');
      });

      it('dispatches port.update for non-status field changes when status is unchanged', async () => {
        const updateCalls: Array<{ role: string; id: string; patch: any }> = [];
        const adapter = new DeterministicTestAssignmentsAdapter();
        const origUpdate = adapter.update.bind(adapter);
        adapter.update = async (role, id, patch, opts) => {
          updateCalls.push({ role, id, patch });
          return origUpdate(role, id, patch, opts);
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Original Title',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'In progress',
              progress: 50,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          title: 'Renamed Title',
          due: '20/11/2026',
        });

        expect(res.success).toBe(true);
        expect(res.localOnly).toBeUndefined();
        expect(updateCalls).toHaveLength(1);
        expect(updateCalls[0]?.id).toBe('ASN-0001');
        expect(updateCalls[0]?.patch.title).toBe('Renamed Title');
        expect(coordinator.getState().assignments[0]!.title).toBe('Renamed Title');
      });

      it('combined status + structural edit causes zero port calls and returns conflict error', async () => {
        let updateCalls = 0;
        let transitionCalls = 0;
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.update = async () => {
          updateCalls++;
          return {} as any;
        };
        adapter.transition = async () => {
          transitionCalls++;
          return {} as any;
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Original Title',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'In progress',
              progress: 50,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          title: 'Sequenced Title',
          status: 'Pending review',
        });

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe('conflict');
        expect(updateCalls).toBe(0);
        expect(transitionCalls).toBe(0);
      });

      it('missing expectedUpdatedAt causes zero port mutation calls and returns conflict error', async () => {
        let updateCalls = 0;
        let transitionCalls = 0;
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.update = async () => {
          updateCalls++;
          return {} as any;
        };
        adapter.transition = async () => {
          transitionCalls++;
          return {} as any;
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Original Title',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'In progress',
              progress: 50,
              tone: 'default',
              // Note: expectedUpdatedAt is intentionally missing
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          title: 'Updated Title',
        });

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe('conflict');
        expect(updateCalls).toBe(0);
        expect(transitionCalls).toBe(0);
      });

      it('status + allowed transition notes/progress performs exactly one transition and zero PATCH', async () => {
        let updateCalls = 0;
        let transitionCalls = 0;
        let capturedTransitionOpts: any = null;
        const adapter = new DeterministicTestAssignmentsAdapter();
        adapter.update = async () => {
          updateCalls++;
          return {} as any;
        };
        adapter.transition = async (role, id, action, opts) => {
          transitionCalls++;
          capturedTransitionOpts = opts;
          return {
            id,
            title: 'Original Title',
            client: 'Acme Corp',
            service: 'GST Compliance',
            due: '10/11/2026',
            owner: 'Priya Desai',
            status: 'Pending review',
            progress: 85,
            tone: 'warning',
            expectedUpdatedAt: '2026-11-10T12:05:00.000Z',
          };
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Original Title',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'In progress',
              progress: 50,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter,
          initialRole: 'founder',
        });

        const res = await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          status: 'Pending review',
          deliveryNotes: 'Ready for final partner sign-off',
          progress: 85,
        });

        expect(res.success).toBe(true);
        expect(updateCalls).toBe(0);
        expect(transitionCalls).toBe(1);
        expect(capturedTransitionOpts?.deliveryNotes).toBe('Ready for final partner sign-off');
        expect(capturedTransitionOpts?.progressPercent).toBe(85);
      });

      it('updates active port via setPort without dropping existing data snapshot', async () => {
        const adapter1 = new DeterministicTestAssignmentsAdapter();
        const adapter2 = new DeterministicTestAssignmentsAdapter();
        let port2Used = false;
        adapter2.update = async (_role, id, patch) => {
          port2Used = true;
          return {
            id,
            title: patch.title ?? 'Updated',
            client: 'Acme Corp',
            service: 'GST Compliance',
            due: '10/11/2026',
            owner: 'Priya Desai',
            status: 'In progress',
            progress: 50,
            tone: 'default',
            expectedUpdatedAt: '2026-11-10T12:05:00.000Z',
          };
        };

        const coordinator = new AssignmentsCoordinator({
          initialRows: [
            {
              id: 'ASN-0001',
              title: 'Port Test',
              client: 'Acme Corp',
              service: 'GST Compliance',
              due: '10/11/2026',
              owner: 'Priya Desai',
              status: 'In progress',
              progress: 50,
              tone: 'default',
              expectedUpdatedAt: '2026-11-10T12:00:00.000Z',
            },
          ],
          port: adapter1,
          initialRole: 'founder',
        });

        expect(coordinator.getState().assignments[0]!.title).toBe('Port Test');

        coordinator.setPort(adapter2);

        await coordinator.handleUpdateAssignment({
          ...coordinator.getState().assignments[0]!,
          title: 'Port 2 Title',
        });

        expect(port2Used).toBe(true);
      });
    });
  });
});
