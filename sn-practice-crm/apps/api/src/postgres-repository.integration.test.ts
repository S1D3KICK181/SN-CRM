import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrmApplication } from './application';
import { createApiServer } from './http';
import { PostgresCrmRepository } from './postgres-repository';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const GOTRUE_URL = process.env['SUPABASE_URL'] ? `${process.env['SUPABASE_URL']}/auth/v1` : 'http://127.0.0.1:54321/auth/v1';
const JWKS_URL = `${GOTRUE_URL}/.well-known/jwks.json`;
const ANON_KEY =
  process.env['SUPABASE_ANON_KEY'] ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const JWT_SECRET =
  process.env['SUPABASE_JWT_SECRET'] ??
  'super-secret-jwt-token-with-at-least-32-characters-long';

const ADVISORY_LOCK_ID = 7142026;

const FOUNDER_ID = '00000000-0000-4000-a000-000000000001';
const MANAGER_ID = '00000000-0000-4000-a000-000000000002';
const SENIOR_ID = '00000000-0000-4000-a000-000000000003';
const STAFF_ID = '00000000-0000-4000-a000-000000000004';
const TRAINEE_ID = '00000000-0000-4000-a000-000000000005';

describe('PostgresCrmRepository Integration Suite', () => {
  let lockClient: postgres.Sql;
  let rootClient: postgres.Sql;
  let pool: postgres.Sql;

  let seqAssSnapshot: { last_value: string; is_called: boolean };
  let seqWorkSnapshot: { last_value: string; is_called: boolean };
  let initialCounts: { assignments: number; reviewers: number; workItems: number };

  beforeAll(async () => {
    // 1. Dedicated session-stable advisory lock on pinned single-connection client
    lockClient = postgres(DATABASE_URL, { max: 1 });
    await lockClient`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`;

    // 2. Privileged root client for snapshotting & restoring sequences
    rootClient = postgres(DATABASE_URL, { max: 1 });
    const assSeqRows = await rootClient`SELECT last_value::text, is_called FROM public.assignment_code_seq`;
    const workSeqRows = await rootClient`SELECT last_value::text, is_called FROM public.work_item_code_seq`;
    const assSeq = assSeqRows[0];
    const workSeq = workSeqRows[0];
    if (!assSeq || !workSeq) {
      throw new Error('Failed to snapshot sequences.');
    }
    seqAssSnapshot = { last_value: String(assSeq['last_value']), is_called: Boolean(assSeq['is_called']) };
    seqWorkSnapshot = { last_value: String(workSeq['last_value']), is_called: Boolean(workSeq['is_called']) };

    // 3. Dynamic baseline row counts
    const assCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignments`;
    const revCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignment_reviewers`;
    const workCountRows = await rootClient`SELECT count(*)::int as c FROM public.work_items`;
    const assCount = assCountRows[0];
    const revCount = revCountRows[0];
    const workCount = workCountRows[0];
    if (!assCount || !revCount || !workCount) {
      throw new Error('Failed to read initial counts.');
    }
    initialCounts = {
      assignments: Number(assCount['c']),
      reviewers: Number(revCount['c']),
      workItems: Number(workCount['c']),
    };

    // 4. Standard application pool
    pool = postgres(DATABASE_URL, { max: 10 });
  });

  afterAll(async () => {
    try {
      if (rootClient) {
        // Restore sequence state
        await rootClient`SELECT setval('public.assignment_code_seq', ${seqAssSnapshot.last_value}::bigint, ${seqAssSnapshot.is_called})`;
        await rootClient`SELECT setval('public.work_item_code_seq', ${seqWorkSnapshot.last_value}::bigint, ${seqWorkSnapshot.is_called})`;

        // Post-condition: assert 0 table count drift
        const assCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignments`;
        const revCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignment_reviewers`;
        const workCountRows = await rootClient`SELECT count(*)::int as c FROM public.work_items`;
        const assCount = assCountRows[0];
        const revCount = revCountRows[0];
        const workCount = workCountRows[0];
        if (assCount && revCount && workCount) {
          expect(Number(assCount['c'])).toBe(initialCounts.assignments);
          expect(Number(revCount['c'])).toBe(initialCounts.reviewers);
          expect(Number(workCount['c'])).toBe(initialCounts.workItems);
        }
      }
    } finally {
      if (lockClient) {
        try {
          await lockClient`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
        } finally {
          await lockClient.end();
        }
      }
      if (rootClient) await rootClient.end();
      if (pool) await pool.end();
    }
  });

  async function runIsolatedTest(testFn: (repo: PostgresCrmRepository, tx: postgres.TransactionSql) => Promise<void>) {
    const ROLLBACK_SIGNAL = new Error('ROLLBACK_INTENTIONAL');
    try {
      await pool.begin(async (tx) => {
        const repo = new PostgresCrmRepository(tx);
        await testFn(repo, tx);
        throw ROLLBACK_SIGNAL;
      });
    } catch (err) {
      if (err !== ROLLBACK_SIGNAL) throw err;
    }
  }

  it('IT-01: Reference lookups query clients and services catalog correctly', async () => {
    const repo = new PostgresCrmRepository(pool);
    const ctx = { actorId: FOUNDER_ID };

    const clients = await repo.listClientReferences(ctx);
    expect(clients.length).toBeGreaterThanOrEqual(6);
    const firstC = clients[0];
    if (!firstC) throw new Error('No client found');
    expect(firstC).toHaveProperty('id');
    expect(firstC).toHaveProperty('code');
    expect(firstC).toHaveProperty('name');

    const firstClient = await repo.getClientReference(ctx, firstC.id);
    expect(firstClient).toEqual(firstC);

    const services = await repo.listServiceReferences(ctx);
    expect(services.length).toBeGreaterThanOrEqual(6);
    const firstS = services[0];
    if (!firstS) throw new Error('No service found');
    const serviceById = await repo.getServiceReferenceById(ctx, firstS.id);
    expect(serviceById).toEqual(firstS);

    const serviceByName = await repo.getServiceReferenceByName(ctx, firstS.name);
    expect(serviceByName).toEqual(firstS);
  });

  it('IT-02: Employee resolution verifies all 5 canonical personas with active roles', async () => {
    const repo = new PostgresCrmRepository(pool);
    const ctx = { actorId: FOUNDER_ID };

    const employees = await repo.listEmployees(ctx);
    expect(employees.length).toBe(5);

    const rolesFound = employees.map((e) => e.role).sort();
    expect(rolesFound).toEqual(['founder', 'manager', 'senior_staff', 'staff', 'trainee'].sort());

    const founder = await repo.getEmployee(ctx, FOUNDER_ID);
    expect(founder).not.toBeNull();
    expect(founder?.name).toBe('S. Narayanan');
    expect(founder?.role).toBe('founder');
  });

  it('IT-02b: Reporting-line clearing deletes row and preserves non-null behavior in rollback isolation', async () => {
    await runIsolatedTest(async (repo, tx) => {
      const ctx = { actorId: FOUNDER_ID };

      // Verify trainee currently has a supervisor (Manager)
      const traineeBefore = await repo.getEmployee(ctx, TRAINEE_ID);
      expect(traineeBefore).not.toBeNull();
      expect(traineeBefore?.reportsToId).toBe(MANAGER_ID);

      // Clear supervisor by passing supervisorId: null
      const cleared = await repo.updateReportingLine(ctx, TRAINEE_ID, null);
      expect(cleared.employee.reportsToId).toBeNull();
      expect(cleared.manager).toBeNull();

      // Verify row is absent in DB under transaction
      const rawLines = await tx`SELECT * FROM public.staff_reporting_lines WHERE employee_id = ${TRAINEE_ID}::uuid`;
      expect(rawLines.length).toBe(0);

      // Verify getEmployee reflects null reportsToId
      const traineeAfter = await repo.getEmployee(ctx, TRAINEE_ID);
      expect(traineeAfter?.reportsToId).toBeNull();

      // Verify clearing again is safe and idempotent
      const clearedAgain = await repo.updateReportingLine(ctx, TRAINEE_ID, null);
      expect(clearedAgain.employee.reportsToId).toBeNull();
      expect(clearedAgain.manager).toBeNull();

      // Verify re-assigning supervisor restores reporting line row (non-null behavior)
      const restored = await repo.updateReportingLine(ctx, TRAINEE_ID, MANAGER_ID);
      expect(restored.employee.reportsToId).toBe(MANAGER_ID);
      expect(restored.manager?.id).toBe(MANAGER_ID);

      const rawRestored = await tx`SELECT supervisor_id FROM public.staff_reporting_lines WHERE employee_id = ${TRAINEE_ID}::uuid`;
      expect(rawRestored.length).toBe(1);
      expect(rawRestored[0]?.['supervisor_id']).toBe(MANAGER_ID);
    });
  });

  it('IT-03 & IT-04: Assignment creation generates code, sets is_demo=false and is immune to demo cleanup', async () => {
    await runIsolatedTest(async (repo, tx) => {
      const ctx = { actorId: FOUNDER_ID };
      const clients = await repo.listClientReferences(ctx);
      const services = await repo.listServiceReferences(ctx);
      const firstClient = clients[0];
      const firstService = services[0];
      if (!firstClient || !firstService) throw new Error('Client or service missing');

      const newId = '90000000-0000-4000-a000-000000000001';
      const created = await repo.createAssignment(ctx, {
        id: newId,
        clientId: firstClient.id,
        clientName: firstClient.name,
        serviceId: firstService.id,
        service: firstService.name,
        title: 'Q3 Tax Return Preparation',
        ownerId: SENIOR_ID,
        reviewerIds: [MANAGER_ID],
        status: 'assigned',
        dueAt: new Date(Date.now() + 86400000 * 7).toISOString(),
        createdById: FOUNDER_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // IT-03: Code generated via trigger sequence and reviewers inserted
      expect(created.id).toBe(newId);
      expect(created.code).toMatch(/^AS-\d{6}$/);
      expect(created.reviewerIds).toEqual([MANAGER_ID]);

      // Raw inspection under transaction: is_demo must be false (column omitted in INSERT)
      const rawRows = await tx`SELECT is_demo FROM public.assignments WHERE id = ${newId}::uuid`;
      const rawRow = rawRows[0];
      if (!rawRow) throw new Error('Raw row missing');
      expect(rawRow['is_demo']).toBe(false);

      // IT-04: Demo data immunity - demo cleanup target check
      const demoCleanupTargets = await tx`SELECT id FROM public.assignments WHERE is_demo = true AND id = ${newId}::uuid`;
      expect(demoCleanupTargets.length).toBe(0);
    });
  });

  it('IT-05: Non-management delivery owner can update assignment delivery notes and status under RLS', async () => {
    await runIsolatedTest(async (repo, tx) => {
      // Find an assignment owned by Senior Staff
      const assRows = await tx`
        SELECT a.id, a.updated_at, a.status
        FROM public.assignments a
        WHERE a.owner_id = ${SENIOR_ID}::uuid AND a.status = 'assigned'
        LIMIT 1;
      `;
      const assRow = assRows[0];
      expect(assRow).toBeDefined();
      if (!assRow) throw new Error('Assignment row missing');

      const seniorCtx = { actorId: SENIOR_ID };
      const updated = await repo.updateAssignmentStatus(seniorCtx, {
        id: String(assRow['id']),
        status: 'in_progress',
        expectedUpdatedAt: (assRow['updated_at'] as Date).toISOString(),
        deliveryNotes: 'Work initiated by Senior Staff.',
        progressPercent: 25,
      });

      expect(updated.status).toBe('in_progress');

      // Check progress_percent and delivery_notes in database
      const rawRows = await tx`SELECT progress_percent, delivery_notes FROM public.assignments WHERE id = ${assRow['id']}::uuid`;
      const rawRow = rawRows[0];
      if (!rawRow) throw new Error('Raw updated row missing');
      expect(rawRow['progress_percent']).toBe(25);
      expect(rawRow['delivery_notes']).toBe('Work initiated by Senior Staff.');
    });
  });

  it('IT-06: Work item status update maps notes to completion_note and triggers set completed_at', async () => {
    await runIsolatedTest(async (repo, tx) => {
      // Find a work item assigned to Trainee
      const workRows = await tx`
        SELECT wi.id, wi.updated_at, wi.description, wi.status
        FROM public.work_items wi
        WHERE wi.assignee_id = ${TRAINEE_ID}::uuid AND wi.status = 'todo'
        LIMIT 1;
      `;
      const workRow = workRows[0];
      expect(workRow).toBeDefined();
      if (!workRow) throw new Error('Work item row missing');

      const traineeCtx = { actorId: TRAINEE_ID };
      const initialDesc = workRow['description'];

      // Assignee transitions status todo -> in_progress
      const updated = await repo.updateWorkItemStatus(traineeCtx, {
        id: String(workRow['id']),
        status: 'in_progress',
        expectedUpdatedAt: (workRow['updated_at'] as Date).toISOString(),
        completionNote: 'All deliverables finished and reconciled.',
        progressPercent: 50,
      });

      expect(updated.status).toBe('in_progress');
      expect(updated.completionNote).toBe('All deliverables finished and reconciled.');

      // Raw inspection: description untouched
      const rawUpdatedRows = await tx`
        SELECT description, completion_note, progress_percent
        FROM public.work_items
        WHERE id = ${workRow['id']}::uuid;
      `;
      const rawUpdated = rawUpdatedRows[0];
      if (!rawUpdated) throw new Error('Raw updated work item missing');
      expect(rawUpdated['description']).toBe(initialDesc);
      expect(rawUpdated['progress_percent']).toBe(50);

      // Test trigger setting completed_at on personal task completed by owner
      const personalRows = await tx`
        SELECT wi.id, wi.updated_at, wi.description, wi.assignee_id
        FROM public.work_items wi
        WHERE wi.kind = 'personal' AND wi.status = 'todo'
        LIMIT 1;
      `;
      const personalRow = personalRows[0];
      if (personalRow) {
        const ownerId = String(personalRow['assignee_id']);
        const completedPersonal = await repo.updateWorkItemStatus(
          { actorId: ownerId },
          {
            id: String(personalRow['id']),
            status: 'completed',
            expectedUpdatedAt: (personalRow['updated_at'] as Date).toISOString(),
            completionNote: 'Completed task.',
            progressPercent: 100,
          },
        );
        expect(completedPersonal.status).toBe('completed');
        expect(completedPersonal.completedAt).not.toBeNull();
      }
    });
  });

  it('IT-07: Concurrency conflict produces 409 and missing row produces 404', async () => {
    await runIsolatedTest(async (repo, tx) => {
      const rows = await tx`SELECT id, updated_at FROM public.assignments LIMIT 1;`;
      const row = rows[0];
      if (!row) throw new Error('No assignment found');
      const ctx = { actorId: FOUNDER_ID };

      // 409 on stale timestamp
      await expect(
        repo.updateAssignmentStatus(ctx, {
          id: String(row['id']),
          status: 'in_progress',
          expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'concurrency_conflict',
      });

      // 404 on non-existent UUID
      await expect(
        repo.updateAssignmentStatus(ctx, {
          id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
          status: 'in_progress',
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'not_found',
      });
    });
  });

  it('IT-08: Fail-closed honest 501 for unmigrated domains', async () => {
    const repo = new PostgresCrmRepository(pool);
    const ctx = { actorId: FOUNDER_ID };

    await expect(repo.getRecurringSchedule(ctx, '00000000-0000-4000-a000-000000000001')).rejects.toMatchObject({
      status: 501,
      code: 'domain_not_persisted',
    });
    await expect(repo.listRecurringSchedules(ctx)).rejects.toMatchObject({
      status: 501,
      code: 'domain_not_persisted',
    });
    await expect(repo.getOfficeAccountsSummary(ctx)).rejects.toMatchObject({
      status: 501,
      code: 'domain_not_persisted',
    });
    await expect(repo.listLedgerEntries(ctx)).rejects.toMatchObject({
      status: 501,
      code: 'domain_not_persisted',
    });
  });

  it('IT-09: Connection pool GUC non-leakage', async () => {
    const repo = new PostgresCrmRepository(pool);
    await repo.listEmployees({ actorId: TRAINEE_ID });

    // Checkout connection from pool and assert GUCs are clean
    const claimSubRows = await pool`SELECT current_setting('request.jwt.claim.sub', true) as val`;
    const userRows = await pool`SELECT current_user as u`;
    const claimSub = claimSubRows[0];
    const userRow = userRows[0];
    if (!claimSub || !userRow) throw new Error('GUC check missing');

    expect(claimSub['val']).toBe('');
    expect(userRow['u']).toBe('postgres');
  });

  it('IT-10: Read-only authentic GoTrue JWT HTTP test verifies RLS filtering', async () => {
    const repo = new PostgresCrmRepository(pool);
    const app = new CrmApplication(repo);
    const server = createApiServer(app, {
      allowedOrigins: ['http://127.0.0.1'],
      jwksUrl: JWKS_URL,
      jwtSecret: JWT_SECRET,
      allowDevActorHeader: false,
      sql: pool,
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const apiBase = `http://127.0.0.1:${port}`;

    let founderToken = '';
    let traineeToken = '';

    try {
      // 1. Sign in demo Founder via local GoTrue
      const founderLoginRes = await fetch(`${GOTRUE_URL}/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ email: 'demo.founder@sn-demo.local', password: 'Demo@1234' }),
      });
      expect(founderLoginRes.status).toBe(200);
      const founderLoginData = (await founderLoginRes.json()) as { access_token: string };
      founderToken = founderLoginData.access_token;

      // 2. Sign in demo Trainee via local GoTrue
      const traineeLoginRes = await fetch(`${GOTRUE_URL}/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ email: 'demo.trainee@sn-demo.local', password: 'Demo@1234' }),
      });
      expect(traineeLoginRes.status).toBe(200);
      const traineeLoginData = (await traineeLoginRes.json()) as { access_token: string };
      traineeToken = traineeLoginData.access_token;

      // 3. Founder calls /api/v1/session -> 200 OK, role founder
      const founderSessionRes = await fetch(`${apiBase}/api/v1/session`, {
        headers: { Authorization: `Bearer ${founderToken}`, Origin: 'http://127.0.0.1' },
      });
      expect(founderSessionRes.status).toBe(200);
      const founderSession = (await founderSessionRes.json()) as { data: { role: string; name: string } };
      expect(founderSession.data.role).toBe('founder');
      expect(founderSession.data.name).toBe('S. Narayanan');

      // 4. Founder calls /api/v1/assignments -> sees 6 assignments
      const founderAssRes = await fetch(`${apiBase}/api/v1/assignments`, {
        headers: { Authorization: `Bearer ${founderToken}`, Origin: 'http://127.0.0.1' },
      });
      expect(founderAssRes.status).toBe(200);
      const founderAss = (await founderAssRes.json()) as { data: unknown[] };
      expect(founderAss.data.length).toBe(6);

      // 5. Trainee calls /api/v1/session -> 200 OK, role trainee
      const traineeSessionRes = await fetch(`${apiBase}/api/v1/session`, {
        headers: { Authorization: `Bearer ${traineeToken}`, Origin: 'http://127.0.0.1' },
      });
      expect(traineeSessionRes.status).toBe(200);
      const traineeSession = (await traineeSessionRes.json()) as { data: { role: string; name: string } };
      expect(traineeSession.data.role).toBe('trainee');
      expect(traineeSession.data.name).toBe('Neha Kapoor');

      // 6. Trainee calls /api/v1/assignments -> sees exactly 1 assignment (RLS-filtered)
      const traineeAssRes = await fetch(`${apiBase}/api/v1/assignments`, {
        headers: { Authorization: `Bearer ${traineeToken}`, Origin: 'http://127.0.0.1' },
      });
      expect(traineeAssRes.status).toBe(200);
      const traineeAss = (await traineeAssRes.json()) as { data: unknown[] };
      expect(traineeAss.data.length).toBe(1);
    } finally {
      // Sign out GoTrue sessions
      if (founderToken) {
        await fetch(`${GOTRUE_URL}/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${founderToken}`, apikey: ANON_KEY },
        }).catch(() => undefined);
      }
      if (traineeToken) {
        await fetch(`${GOTRUE_URL}/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${traineeToken}`, apikey: ANON_KEY },
        }).catch(() => undefined);
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('IT-11: Client read operations enforce RLS visibility across all five roles and map complete DTOs', async () => {
    const repo = new PostgresCrmRepository(pool);
    const founderCtx = { actorId: FOUNDER_ID };
    const managerCtx = { actorId: MANAGER_ID };
    const seniorCtx = { actorId: SENIOR_ID };
    const staffCtx = { actorId: STAFF_ID };
    const traineeCtx = { actorId: TRAINEE_ID };

    // 1. Founder and Manager each list all six clients in ascending code order
    const founderClients = await repo.listClients(founderCtx);
    expect(founderClients.map((c) => c.code)).toEqual([
      'CL-001001',
      'CL-001002',
      'CL-001003',
      'CL-001004',
      'CL-001005',
      'CL-001006',
    ]);

    // Full DTO mapping assertion on listClients result
    expect(founderClients[0]).toMatchObject({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      gstin: '27AABCA1234A1Z5',
      pan: 'AABCA1234A',
      email: 'accounts@asterfoods.local',
      phone: '+91 98200 11001',
      relationshipOwnerId: MANAGER_ID,
      relationshipOwnerName: 'Priya Desai',
      status: 'active',
      notes: null,
      createdById: FOUNDER_ID,
      activeAssignmentsCount: 1,
    });
    expect(typeof founderClients[0]?.activeAssignmentsCount).toBe('number');
    expect(new Date(founderClients[0]!.createdAt).toISOString()).toBe(founderClients[0]!.createdAt);
    expect(new Date(founderClients[0]!.updatedAt).toISOString()).toBe(founderClients[0]!.updatedAt);

    const managerClients = await repo.listClients(managerCtx);
    expect(managerClients.map((c) => c.code)).toEqual(founderClients.map((c) => c.code));

    // 2. Senior Staff sees exactly CL-001001, 001003, 001004, 001005, 001006
    const seniorClients = await repo.listClients(seniorCtx);
    expect(seniorClients.map((c) => c.code)).toEqual([
      'CL-001001',
      'CL-001003',
      'CL-001004',
      'CL-001005',
      'CL-001006',
    ]);

    // 3. Staff sees exactly CL-001002 and CL-001004
    const staffClients = await repo.listClients(staffCtx);
    expect(staffClients.map((c) => c.code)).toEqual(['CL-001002', 'CL-001004']);

    // 4. Trainee sees exactly CL-001001
    const traineeClients = await repo.listClients(traineeCtx);
    expect(traineeClients.map((c) => c.code)).toEqual(['CL-001001']);

    const traineeAster = await repo.getClient(traineeCtx, '10000000-0000-4000-a000-000000000001');
    expect(traineeAster).not.toBeNull();
    expect(traineeAster?.relationshipOwnerName).toBe('Priya Desai');
    expect(traineeAster?.activeAssignmentsCount).toBe(1);

    // 5. Trainee getClient for BluePeak returns null (RLS hidden)
    const traineeBluePeak = await repo.getClient(traineeCtx, '10000000-0000-4000-a000-000000000002');
    expect(traineeBluePeak).toBeNull();

    // 6. getClient with valid but absent UUID returns null
    const absentClient = await repo.getClient(founderCtx, '10000000-0000-4000-a000-999999999999');
    expect(absentClient).toBeNull();

    // 7. Founder DTO mapping verifies representative DB-faithful fields, valid ISO timestamps, and numeric active assignment count
    const founderAster = await repo.getClient(founderCtx, '10000000-0000-4000-a000-000000000001');
    expect(founderAster).not.toBeNull();
    expect(founderAster).toMatchObject({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      gstin: '27AABCA1234A1Z5',
      pan: 'AABCA1234A',
      email: 'accounts@asterfoods.local',
      phone: '+91 98200 11001',
      relationshipOwnerId: MANAGER_ID,
      relationshipOwnerName: 'Priya Desai',
      status: 'active',
      notes: null,
      createdById: FOUNDER_ID,
      activeAssignmentsCount: 1,
    });
    expect(typeof founderAster?.activeAssignmentsCount).toBe('number');
    expect(new Date(founderAster!.createdAt).toISOString()).toBe(founderAster!.createdAt);
    expect(new Date(founderAster!.updatedAt).toISOString()).toBe(founderAster!.updatedAt);
  });

  it('IT-12: Client active assignment count filters closed status and enforces assignment RLS', async () => {
    await runIsolatedTest(async (repo, tx) => {
      const founderCtx = { actorId: FOUNDER_ID };
      const traineeCtx = { actorId: TRAINEE_ID };
      const asterId = '10000000-0000-4000-a000-000000000001';

      // Insert 1 valid closed assignment for Aster (owned by Founder, trainee not involved)
      await tx`
        INSERT INTO public.assignments (
          id, code, client_id, service_id, title, owner_id, status, due_at,
          approved_at, approved_by, closed_at, closed_by, created_by, is_demo
        ) VALUES (
          '90000000-0000-4000-a000-000000000081'::uuid,
          'AS-999981',
          ${asterId}::uuid,
          '50000000-0000-4000-a000-000000000001'::uuid,
          'Closed Test Audit Assignment',
          ${FOUNDER_ID}::uuid,
          'closed'::public.assignment_status,
          '2026-11-20T12:00:00.000Z'::timestamptz,
          '2026-11-20T10:00:00.000Z'::timestamptz,
          ${FOUNDER_ID}::uuid,
          '2026-11-20T12:00:00.000Z'::timestamptz,
          ${FOUNDER_ID}::uuid,
          ${FOUNDER_ID}::uuid,
          true
        );
      `;

      // Insert 1 valid active (in_progress) assignment for Aster (owned by Founder, trainee not involved)
      await tx`
        INSERT INTO public.assignments (
          id, code, client_id, service_id, title, owner_id, status, due_at, created_by, is_demo
        ) VALUES (
          '90000000-0000-4000-a000-000000000082'::uuid,
          'AS-999982',
          ${asterId}::uuid,
          '50000000-0000-4000-a000-000000000001'::uuid,
          'Active Test Tax Advisory Assignment',
          ${FOUNDER_ID}::uuid,
          'in_progress'::public.assignment_status,
          '2026-11-20T12:00:00.000Z'::timestamptz,
          ${FOUNDER_ID}::uuid,
          true
        );
      `;

      // Founder Aster count increases only by the new active assignment (closed is excluded: 1 existing + 1 active = 2)
      const founderAster = await repo.getClient(founderCtx, asterId);
      expect(founderAster?.activeAssignmentsCount).toBe(2);

      // Trainee Aster count remains exactly 1 (the new active assignment is hidden by assignment RLS)
      const traineeAster = await repo.getClient(traineeCtx, asterId);
      expect(traineeAster?.activeAssignmentsCount).toBe(1);
    });
  });
});
