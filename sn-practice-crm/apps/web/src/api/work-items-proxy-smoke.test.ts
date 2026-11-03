import { fileURLToPath, URL } from 'node:url';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { CrmApplication } from '../../../api/src/application';
import { createDemoSeed, DEMO_ACTOR_IDS } from '../../../api/src/demo-seed';
import { createApiServer } from '../../../api/src/http';
import { InMemoryCrmRepository } from '../../../api/src/in-memory-repository';
import { HttpWorkItemsAdapter } from './http-work-items-adapter';
import { WorkItemOperationError } from './work-items-types';

describe('Vite Proxy & Real Work Items API Smoke (Authentic Authority)', () => {
  let repository: InMemoryCrmRepository;
  let apiServer: Server;
  let viteServer: ViteDevServer;
  let vitePort: number;
  let previousProxyTarget: string | undefined;

  beforeAll(async () => {
    // 1. Start the actual CRM API server bound to an ephemeral port (port 0)
    repository = new InMemoryCrmRepository(createDemoSeed());
    await repository.upsertDevActor({
      id: 'usr_senior_2',
      name: 'Vikram Patel',
      role: 'senior_staff',
      reportsToId: DEMO_ACTOR_IDS.manager,
      active: true,
    });
    const application = new CrmApplication(repository);
    apiServer = createApiServer(application, { allowDevActorHeader: true });

    await new Promise<void>((resolve, reject) => {
      apiServer.listen(0, '127.0.0.1', () => resolve());
      apiServer.once('error', reject);
    });

    const apiAddress = apiServer.address();
    const apiPort =
      typeof apiAddress === 'object' && apiAddress !== null ? apiAddress.port : null;
    if (!apiPort) {
      throw new Error('Failed to determine ephemeral port for CRM API server.');
    }
    const apiTarget = `http://127.0.0.1:${apiPort}`;

    // 2. Set the test proxy target before creating Vite dev server
    previousProxyTarget = process.env['CRM_API_PROXY_TARGET'];
    process.env['CRM_API_PROXY_TARGET'] = apiTarget;

    // 3. Start Vite with the real apps/web/vite.config.ts and ephemeral port 0
    const configPath = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
    viteServer = await createViteServer({
      configFile: configPath,
      server: {
        port: 0,
      },
    });
    await viteServer.listen();
    const address = viteServer.httpServer?.address();
    vitePort = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    try {
      if (viteServer) {
        const maybeViteHttpServer = viteServer.httpServer as
          | (Server & { closeAllConnections?: () => void })
          | null;
        if (typeof maybeViteHttpServer?.closeAllConnections === 'function') {
          maybeViteHttpServer.closeAllConnections();
        }
        await viteServer.close();
      }
    } finally {
      try {
        if (apiServer) {
          const maybeApiServer = apiServer as Server & { closeAllConnections?: () => void };
          if (typeof maybeApiServer.closeAllConnections === 'function') {
            maybeApiServer.closeAllConnections();
          }
          await new Promise<void>((resolve) => {
            apiServer.close(() => resolve());
          });
        }
      } finally {
        if (previousProxyTarget !== undefined) {
          process.env['CRM_API_PROXY_TARGET'] = previousProxyTarget;
        } else {
          delete process.env['CRM_API_PROXY_TARGET'];
        }
      }
    }
  });

  it('1. Senior delegates a real API-seeded assignment to Trainee with due <= parent due -> 201', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // asg_gst_october is owned by Priya Desai (DEMO_ACTOR_IDS.senior), due at 2026-11-11T12:30:00.000Z
    const created = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Audit sales registers vs GSTR-1',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-05T12:30:00.000Z',
      notes: 'Check 2 debit notes mentioned in delivery notes',
    });

    expect(created.id).toMatch(/^wrk_/);
    expect(created.title).toBe('Audit sales registers vs GSTR-1');
    expect(created.status).toBe('todo');
    expect(created.assigneeId).toBe(DEMO_ACTOR_IDS.trainee);
    expect(created.createdById).toBe(DEMO_ACTOR_IDS.senior);
  });

  it('2. Trainee list sees delegated item, starts it, and submits it', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // Create item to transition
    const created = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Verify e-way bills for October',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-06T12:30:00.000Z',
    });

    // Trainee lists items and sees it
    const traineeItems = await adapter.list('trainee');
    const target = traineeItems.find((i) => i.id === created.id);
    expect(target).toBeDefined();
    expect(target?.status).toBe('todo');

    // Trainee starts it
    const started = await adapter.transition('trainee', created.id, 'start');
    expect(started.status).toBe('in_progress');

    // Trainee submits it
    const submitted = await adapter.transition('trainee', created.id, 'submit');
    expect(submitted.status).toBe('ready_for_review');
  });

  it('3. Senior list sees ready item and approves -> done', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const item = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Prepare HSN summary table',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-07T12:30:00.000Z',
    });

    await adapter.transition('trainee', item.id, 'start');
    await adapter.transition('trainee', item.id, 'submit');

    // Senior lists items and verifies ready_for_review status
    const seniorItems = await adapter.list('senior_staff');
    const found = seniorItems.find((i) => i.id === item.id);
    expect(found?.status).toBe('ready_for_review');

    // Senior approves it (transition 'complete')
    const completed = await adapter.transition('senior_staff', item.id, 'complete');
    expect(completed.status).toBe('done');
  });

  it('4. Staff -> Senior delegation -> 403 forbidden', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // asg_tds_q2 is owned by Staff (DEMO_ACTOR_IDS.staff)
    // Staff attempts to delegate to Senior (violates delegation hierarchy!)
    await expect(
      adapter.create('staff', {
        kind: 'delegated',
        title: 'Unauthorized upward delegation',
        assignmentId: 'asg_tds_q2',
        assigneeId: DEMO_ACTOR_IDS.senior,
        dueAt: '2026-11-03T12:30:00.000Z',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('forbidden');
      expect(opErr.status).toBe(403);
      expect(opErr.serverCode).toBe('invalid_delegate_role');
      return true;
    });
  });

  it('5. Trainee delegation -> 403 forbidden', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    await expect(
      adapter.create('trainee', {
        kind: 'delegated',
        title: 'Trainee attempt to delegate',
        assignmentId: 'asg_gst_october',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-03T12:30:00.000Z',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('forbidden');
      expect(opErr.status).toBe(403);
      return true;
    });
  });

  it('6. Due after parent assignment -> 422 validation error', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    // asg_gst_october is due at 2026-11-11T12:30:00.000Z
    // Attempting due at 2026-11-15 (after parent) must fail with 422 task_due_after_assignment
    await expect(
      adapter.create('senior_staff', {
        kind: 'delegated',
        title: 'Late subtask',
        assignmentId: 'asg_gst_october',
        assigneeId: DEMO_ACTOR_IDS.trainee,
        dueAt: '2026-11-15T12:30:00.000Z',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('validation');
      expect(opErr.status).toBe(422);
      expect(opErr.serverCode).toBe('task_due_after_assignment');
      return true;
    });
  });

  it('7. Premature approval before submit -> 409 conflict', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const item = await adapter.create('senior_staff', {
      kind: 'delegated',
      title: 'Premature approval check',
      assignmentId: 'asg_gst_october',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: '2026-11-08T12:30:00.000Z',
    });

    // In 'todo' status: senior attempts premature 'complete'
    await expect(
      adapter.transition('senior_staff', item.id, 'complete'),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      const opErr = err as WorkItemOperationError;
      expect(opErr.code).toBe('conflict');
      expect(opErr.status).toBe(409);
      expect(opErr.message).toMatch(/must be submitted before it is completed/i);
      return true;
    });
  });

  it('8. Personal privacy: a Staff personal task never appears in Founder/Manager/Trainee lists', async () => {
    const adapter = new HttpWorkItemsAdapter({
      baseUrl: `http://127.0.0.1:${vitePort}`,
    });

    const staffPersonal = await adapter.create('staff', {
      kind: 'personal',
      title: 'Staff highly confidential private reminder',
      dueAt: '2026-11-04T10:00:00.000Z',
    });

    expect(staffPersonal.id).toMatch(/^wrk_/);
    expect(staffPersonal.kind).toBe('personal');
    expect(staffPersonal.assigneeId).toBe(DEMO_ACTOR_IDS.staff);

    // Verify Staff sees it
    const staffItems = await adapter.list('staff');
    expect(staffItems.some((i) => i.id === staffPersonal.id)).toBe(true);

    // Verify Founder DOES NOT see it
    const founderItems = await adapter.list('founder');
    expect(founderItems.some((i) => i.id === staffPersonal.id)).toBe(false);

    // Verify Manager DOES NOT see it
    const managerItems = await adapter.list('manager');
    expect(managerItems.some((i) => i.id === staffPersonal.id)).toBe(false);

    // Verify Trainee DOES NOT see it
    const traineeItems = await adapter.list('trainee');
    expect(traineeItems.some((i) => i.id === staffPersonal.id)).toBe(false);
  });

  describe('Slice 1C: Standalone Internal Office Tasks Authentic Lifecycle & Authority', () => {
    it('9. Manager creates internal for Staff (201, no assignment context), Staff starts/submits, Manager requests changes (ready_for_review -> in_progress), Staff resubmits, Manager completes -> done', async () => {
      const adapter = new HttpWorkItemsAdapter({
        baseUrl: `http://127.0.0.1:${vitePort}`,
      });

      // Manager creates internal task for Staff
      const created = await adapter.create('manager', {
        kind: 'internal',
        title: 'File November purchase vouchers in records cabinet',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-04T12:30:00.000Z',
        notes: 'Blue folder shelf 3',
      });

      expect(created.id).toMatch(/^wrk_/);
      expect(created.kind).toBe('internal');
      expect(created.assignmentId).toBeNull();
      expect(created.relatedClientId).toBeNull();
      expect(created.relatedPartyName).toBeNull();
      expect(created.assigneeId).toBe(DEMO_ACTOR_IDS.staff);
      expect(created.createdById).toBe(DEMO_ACTOR_IDS.manager);
      expect(created.status).toBe('todo');

      // Staff lists and sees it in todo
      const staffList1 = await adapter.list('staff');
      const staffTarget1 = staffList1.find((i) => i.id === created.id);
      expect(staffTarget1).toBeDefined();
      expect(staffTarget1?.status).toBe('todo');

      // Staff starts task -> in_progress
      const started = await adapter.transition('staff', created.id, 'start');
      expect(started.status).toBe('in_progress');

      // Staff submits task -> ready_for_review
      const submitted = await adapter.transition('staff', created.id, 'submit');
      expect(submitted.status).toBe('ready_for_review');

      // Manager requests changes (reopen while ready_for_review -> in_progress)
      const requestedChanges = await adapter.transition('manager', created.id, 'reopen');
      expect(requestedChanges.status).toBe('in_progress');

      // Staff resubmits -> ready_for_review
      const resubmitted = await adapter.transition('staff', created.id, 'submit');
      expect(resubmitted.status).toBe('ready_for_review');

      // Manager completes task -> done
      const completed = await adapter.transition('manager', created.id, 'complete');
      expect(completed.status).toBe('done');
    });

    it('10. Senior -> Staff internal office task lifecycle with creator approval', async () => {
      const adapter = new HttpWorkItemsAdapter({
        baseUrl: `http://127.0.0.1:${vitePort}`,
      });

      const item = await adapter.create('senior_staff', {
        kind: 'internal',
        title: 'Scan and archive ROC acknowledgement receipts',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-05T12:30:00.000Z',
        notes: 'Save as PDF on server /ROC/2026',
      });

      expect(item.kind).toBe('internal');
      expect(item.assigneeId).toBe(DEMO_ACTOR_IDS.staff);
      expect(item.createdById).toBe(DEMO_ACTOR_IDS.senior);

      await adapter.transition('staff', item.id, 'start');
      await adapter.transition('staff', item.id, 'submit');

      const approved = await adapter.transition('senior_staff', item.id, 'complete');
      expect(approved.status).toBe('done');
    });

    it('11. Downward delegation authority enforcement (upward, self, peer, and trainee delegation -> 403)', async () => {
      const adapter = new HttpWorkItemsAdapter({
        baseUrl: `http://127.0.0.1:${vitePort}`,
      });

      // Staff -> Senior upward
      await expect(
        adapter.create('staff', {
          kind: 'internal',
          title: 'Unauthorized upward office delegation',
          assigneeId: DEMO_ACTOR_IDS.senior,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });

      // Manager -> Founder upward
      await expect(
        adapter.create('manager', {
          kind: 'internal',
          title: 'Manager to Founder upward delegation',
          assigneeId: DEMO_ACTOR_IDS.founder,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });

      // Founder -> Founder self-delegation
      await expect(
        adapter.create('founder', {
          kind: 'internal',
          title: 'Founder self-delegation',
          assigneeId: DEMO_ACTOR_IDS.founder,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });

      // Manager -> Manager peer-delegation
      await expect(
        adapter.create('manager', {
          kind: 'internal',
          title: 'Manager peer-delegation',
          assigneeId: DEMO_ACTOR_IDS.manager,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });

      // Senior -> Senior peer-delegation
      await expect(
        adapter.create('senior_staff', {
          kind: 'internal',
          title: 'Senior peer-delegation',
          assigneeId: DEMO_ACTOR_IDS.senior,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });

      // Staff -> Staff peer-delegation
      await expect(
        adapter.create('staff', {
          kind: 'internal',
          title: 'Staff peer-delegation',
          assigneeId: DEMO_ACTOR_IDS.staff,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });

      // Trainee creation -> forbidden
      await expect(
        adapter.create('trainee', {
          kind: 'internal',
          title: 'Trainee internal creation attempt',
          assigneeId: DEMO_ACTOR_IDS.trainee,
          dueAt: '2026-11-05T12:30:00.000Z',
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('invalid_delegate_role');
        return true;
      });
    });

    it('12. Reviewer authority enforcement: assignee and unrelated peer cannot approve -> 403', async () => {
      const adapter = new HttpWorkItemsAdapter({
        baseUrl: `http://127.0.0.1:${vitePort}`,
      });

      const task = await adapter.create('senior_staff', {
        kind: 'internal',
        title: 'Organize physical records room',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-06T12:30:00.000Z',
      });

      await adapter.transition('staff', task.id, 'start');
      await adapter.transition('staff', task.id, 'submit');

      // Staff assignee attempts to approve their own task
      await expect(
        adapter.transition('staff', task.id, 'complete'),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('forbidden');
        expect(opErr.status).toBe(403);
        expect(opErr.serverCode).toBe('not_work_item_reviewer');
        return true;
      });

      // Unrelated Senior ('usr_senior_2') attempts to approve a task created by Priya Desai ('usr_senior')
      const transRes = await fetch(`http://127.0.0.1:${vitePort}/api/v1/work-items/${task.id}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': 'usr_senior_2',
        },
        body: JSON.stringify({ action: 'complete' }),
      });
      expect(transRes.status).toBe(403);
      const errData = await transRes.json();
      expect(errData.error?.code).toBe('not_work_item_reviewer');
    });

    it('13. Premature completion before submission -> 409 conflict', async () => {
      const adapter = new HttpWorkItemsAdapter({
        baseUrl: `http://127.0.0.1:${vitePort}`,
      });

      const task = await adapter.create('manager', {
        kind: 'internal',
        title: 'Check fire extinguishers and safety log',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-07T12:30:00.000Z',
      });

      // Manager attempts to complete while task is still in 'todo'
      await expect(
        adapter.transition('manager', task.id, 'complete'),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe('conflict');
        expect(opErr.status).toBe(409);
        expect(opErr.message).toMatch(/must be submitted before it is completed/i);
        return true;
      });
    });

    it('14. Strict schema payload validation rejection for client/assignment context on internal tasks -> 400/422 validation_failed', async () => {
      // Injected assignmentId into internal task
      const resWithAssignment = await fetch(`http://127.0.0.1:${vitePort}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({
          kind: 'internal',
          title: 'Illegally linked internal task',
          assigneeId: DEMO_ACTOR_IDS.staff,
          dueAt: '2026-11-05T12:30:00.000Z',
          assignmentId: 'asg_gst_october',
        }),
      });
      expect([400, 422]).toContain(resWithAssignment.status);
      const err1 = await resWithAssignment.json();
      expect(err1.error?.code).toBe('validation_failed');

      // Injected relatedClientId into internal task
      const resWithClient = await fetch(`http://127.0.0.1:${vitePort}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({
          kind: 'internal',
          title: 'Illegally client-linked internal task',
          assigneeId: DEMO_ACTOR_IDS.staff,
          dueAt: '2026-11-05T12:30:00.000Z',
          relatedClientId: 'cli_mehta',
        }),
      });
      expect([400, 422]).toContain(resWithClient.status);
      const err2 = await resWithClient.json();
      expect(err2.error?.code).toBe('validation_failed');
    });

    it('15. Strict privacy isolation: unrelated Senior and Trainee cannot list a Senior -> Staff internal item', async () => {
      const adapter = new HttpWorkItemsAdapter({
        baseUrl: `http://127.0.0.1:${vitePort}`,
      });

      // Senior ('usr_senior') delegates to Staff ('usr_staff')
      const task = await adapter.create('senior_staff', {
        kind: 'internal',
        title: 'Confidential staff attendance register reconciliation',
        assigneeId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-11-06T12:30:00.000Z',
      });

      // 1. Staff assignee sees it
      const staffItems = await adapter.list('staff');
      expect(staffItems.some((i) => i.id === task.id)).toBe(true);

      // 2. Senior creator sees it
      const seniorItems = await adapter.list('senior_staff');
      expect(seniorItems.some((i) => i.id === task.id)).toBe(true);

      // 3. Trainee CANNOT see it
      const traineeItems = await adapter.list('trainee');
      expect(traineeItems.some((i) => i.id === task.id)).toBe(false);

      // 4. Unrelated Senior ('usr_senior_2') CANNOT see it
      const unrelatedSeniorRes = await fetch(`http://127.0.0.1:${vitePort}/api/v1/work-items`, {
        headers: { 'x-demo-user-id': 'usr_senior_2' },
      });
      const unrelatedEnvelope = await unrelatedSeniorRes.json();
      expect(unrelatedEnvelope.data.some((i: any) => i.id === task.id)).toBe(false);
    });
  });
});
