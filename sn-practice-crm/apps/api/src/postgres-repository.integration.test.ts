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
  let seqClientSnapshot: { last_value: string; is_called: boolean };
  let seqEngagementSnapshot: { last_value: string; is_called: boolean };
  let initialCounts: { assignments: number; reviewers: number; workItems: number; clients: number; engagements: number; engagementVersions: number; operationReceipts: number; auditLog: number };

  beforeAll(async () => {
    // 1. Dedicated session-stable advisory lock on pinned single-connection client
    lockClient = postgres(DATABASE_URL, { max: 1 });
    await lockClient`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`;

    // 2. Privileged root client for snapshotting & restoring sequences
    rootClient = postgres(DATABASE_URL, { max: 1 });
    const assSeqRows = await rootClient`SELECT last_value::text, is_called FROM public.assignment_code_seq`;
    const workSeqRows = await rootClient`SELECT last_value::text, is_called FROM public.work_item_code_seq`;
    const clientSeqRows = await rootClient`SELECT last_value::text, is_called FROM public.client_code_seq`;
    const engagementSeqRows = await rootClient`SELECT last_value::text, is_called FROM public.engagement_code_seq`;
    const assSeq = assSeqRows[0];
    const workSeq = workSeqRows[0];
    const clientSeq = clientSeqRows[0];
    const engagementSeq = engagementSeqRows[0];
    if (!assSeq || !workSeq || !clientSeq || !engagementSeq) {
      throw new Error('Failed to snapshot sequences.');
    }
    seqAssSnapshot = { last_value: String(assSeq['last_value']), is_called: Boolean(assSeq['is_called']) };
    seqWorkSnapshot = { last_value: String(workSeq['last_value']), is_called: Boolean(workSeq['is_called']) };
    seqClientSnapshot = { last_value: String(clientSeq['last_value']), is_called: Boolean(clientSeq['is_called']) };
    seqEngagementSnapshot = { last_value: String(engagementSeq['last_value']), is_called: Boolean(engagementSeq['is_called']) };

    // 3. Dynamic baseline row counts
    const assCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignments`;
    const revCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignment_reviewers`;
    const workCountRows = await rootClient`SELECT count(*)::int as c FROM public.work_items`;
    const clientCountRows = await rootClient`SELECT count(*)::int as c FROM public.clients`;
    const engagementCountRows = await rootClient`SELECT count(*)::int as c FROM public.engagements`;
    const engagementVersionCountRows = await rootClient`SELECT count(*)::int as c FROM public.engagement_versions`;
    const operationReceiptCountRows = await rootClient`SELECT count(*)::int as c FROM public.operation_receipts`;
    const auditLogCountRows = await rootClient`SELECT count(*)::int as c FROM public.audit_log`;
    const assCount = assCountRows[0];
    const revCount = revCountRows[0];
    const workCount = workCountRows[0];
    const clientCount = clientCountRows[0];
    const engagementCount = engagementCountRows[0];
    const engagementVersionCount = engagementVersionCountRows[0];
    const operationReceiptCount = operationReceiptCountRows[0];
    const auditLogCount = auditLogCountRows[0];
    if (!assCount || !revCount || !workCount || !clientCount || !engagementCount || !engagementVersionCount || !operationReceiptCount || !auditLogCount) {
      throw new Error('Failed to read initial counts.');
    }
    initialCounts = {
      assignments: Number(assCount['c']),
      reviewers: Number(revCount['c']),
      workItems: Number(workCount['c']),
      clients: Number(clientCount['c']),
      engagements: Number(engagementCount['c']),
      engagementVersions: Number(engagementVersionCount['c']),
      operationReceipts: Number(operationReceiptCount['c']),
      auditLog: Number(auditLogCount['c']),
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
        await rootClient`SELECT setval('public.client_code_seq', ${seqClientSnapshot.last_value}::bigint, ${seqClientSnapshot.is_called})`;
        await rootClient`SELECT setval('public.engagement_code_seq', ${seqEngagementSnapshot.last_value}::bigint, ${seqEngagementSnapshot.is_called})`;

        // Post-condition: assert 0 table count drift
        const assCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignments`;
        const revCountRows = await rootClient`SELECT count(*)::int as c FROM public.assignment_reviewers`;
        const workCountRows = await rootClient`SELECT count(*)::int as c FROM public.work_items`;
        const clientCountRows = await rootClient`SELECT count(*)::int as c FROM public.clients`;
        const engagementCountRows = await rootClient`SELECT count(*)::int as c FROM public.engagements`;
        const engagementVersionCountRows = await rootClient`SELECT count(*)::int as c FROM public.engagement_versions`;
        const operationReceiptCountRows = await rootClient`SELECT count(*)::int as c FROM public.operation_receipts`;
        const auditLogCountRows = await rootClient`SELECT count(*)::int as c FROM public.audit_log`;
        const assCount = assCountRows[0];
        const revCount = revCountRows[0];
        const workCount = workCountRows[0];
        const clientCount = clientCountRows[0];
        const engagementCount = engagementCountRows[0];
        const engagementVersionCount = engagementVersionCountRows[0];
        const operationReceiptCount = operationReceiptCountRows[0];
        const auditLogCount = auditLogCountRows[0];
        if (assCount && revCount && workCount && clientCount && engagementCount && engagementVersionCount && operationReceiptCount && auditLogCount) {
          expect(Number(assCount['c'])).toBe(initialCounts.assignments);
          expect(Number(revCount['c'])).toBe(initialCounts.reviewers);
          expect(Number(workCount['c'])).toBe(initialCounts.workItems);
          expect(Number(clientCount['c'])).toBe(initialCounts.clients);
          expect(Number(engagementCount['c'])).toBe(initialCounts.engagements);
          expect(Number(engagementVersionCount['c'])).toBe(initialCounts.engagementVersions);
          expect(Number(operationReceiptCount['c'])).toBe(initialCounts.operationReceipts);
          expect(Number(auditLogCount['c'])).toBe(initialCounts.auditLog);
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
          expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
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
    expect(founderClients[0]).not.toHaveProperty('pan');
    expect(founderClients[0]).not.toHaveProperty('gstin');
    expect(founderClients[0]).toMatchObject({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      gstinMasked: '27**********1Z5',
      panMasked: '******1234',
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
    expect(founderAster).not.toHaveProperty('pan');
    expect(founderAster).not.toHaveProperty('gstin');
    expect(founderAster).toMatchObject({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      gstinMasked: '27**********1Z5',
      panMasked: '******1234',
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

  it('IT-13: createClient persists client with auto CL-###### sequence code and returns routine-safe masked ClientDto', async () => {
    await runIsolatedTest(async (repo, tx) => {
      const founderCtx = { actorId: FOUNDER_ID };
      const newClientId = '90000000-0000-4000-a000-000000000099';
      const created = await repo.createClient(founderCtx, {
        id: newClientId,
        displayName: 'Integration Test Client Ltd',
        legalName: 'Integration Test Client Limited',
        pan: 'ABCDE1234F',
        gstin: '27ABCDE1234F1Z5',
        email: 'billing@testclient.com',
        phone: '9876543210',
        relationshipOwnerId: MANAGER_ID,
        notes: 'Created during integration test',
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      });

      expect(created.id).toBe(newClientId);
      expect(created.code).toMatch(/^CL-\d{6}$/);
      expect(created.displayName).toBe('Integration Test Client Ltd');
      expect(created.legalName).toBe('Integration Test Client Limited');
      expect(created.panMasked).toBe('******1234');
      expect(created.gstinMasked).toBe('27**********1Z5');
      expect(created.relationshipOwnerId).toBe(MANAGER_ID);
      expect(created.relationshipOwnerName).toBe('Priya Desai');
      expect(created.status).toBe('active');
      expect(created.activeAssignmentsCount).toBe(0);
      expect(created.createdById).toBe(FOUNDER_ID);

      // Verify raw database row has plaintext stored securely and is_demo = false
      const rawRows = await tx`SELECT pan, gstin, code, created_by, is_demo FROM public.clients WHERE id = ${newClientId}::uuid`;
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]!['pan']).toBe('ABCDE1234F');
      expect(rawRows[0]!['gstin']).toBe('27ABCDE1234F1Z5');
      expect(rawRows[0]!['created_by']).toBe(FOUNDER_ID);
      expect(rawRows[0]!['is_demo']).toBe(false);

      // Verify real database trigger validate_client_relationship_owner rejects trainee ownership with 422
      await expect(
        repo.createClient(founderCtx, {
          id: '90000000-0000-4000-a000-000000000097',
          displayName: 'Trainee Owned Client',
          relationshipOwnerId: TRAINEE_ID,
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'validation_failed',
        message: 'A Client relationship owner must be active and cannot be a Trainee.',
      });

      // Verify RLS client_insert blocks non-management roles (e.g. staff)
      const staffCtx = { actorId: STAFF_ID };
      await expect(
        repo.createClient(staffCtx, {
          id: '90000000-0000-4000-a000-000000000098',
          displayName: 'Unauthorized Staff Insert',
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 403,
        code: 'forbidden',
      });
    });
  });

  it('IT-14: description round-trips create, read, and clearing to null under Postgres RLS', async () => {
    await runIsolatedTest(async (repo, tx) => {
      const ctx = { actorId: FOUNDER_ID };
      const clients = await repo.listClientReferences(ctx);
      const services = await repo.listServiceReferences(ctx);
      const firstClient = clients[0]!;
      const firstService = services[0]!;

      const newId = '90000000-0000-4000-a000-000000000014';
      const created = await repo.createAssignment(ctx, {
        id: newId,
        clientId: firstClient.id,
        clientName: firstClient.name,
        serviceId: firstService.id,
        service: firstService.name,
        title: 'GST Deliverable with Scope Description',
        description: 'Statutory GST audit scope instructions',
        ownerId: SENIOR_ID,
        reviewerIds: [MANAGER_ID],
        status: 'assigned',
        dueAt: new Date(Date.now() + 86400000 * 7).toISOString(),
        createdById: FOUNDER_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      expect(created.description).toBe('Statutory GST audit scope instructions');

      // Verify Postgres direct column
      const rawRows = await tx`SELECT description FROM public.assignments WHERE id = ${newId}::uuid`;
      expect(rawRows[0]?.['description']).toBe('Statutory GST audit scope instructions');

      // Read back via repository DTO mapping
      const fetched = await repo.getAssignment(ctx, newId);
      expect(fetched?.description).toBe('Statutory GST audit scope instructions');

      // Update clearing description to null
      const updated = await repo.updateAssignment(ctx, {
        id: newId,
        actorId: ctx.actorId,
        expectedUpdatedAt: fetched!.updatedAt,
        description: null,
      });

      expect(updated.description).toBeNull();

      // Verify Postgres direct column is null
      const rawAfterClear = await tx`SELECT description FROM public.assignments WHERE id = ${newId}::uuid`;
      expect(rawAfterClear[0]?.['description']).toBeNull();

      const fetchedAfterClear = await repo.getAssignment(ctx, newId);
      expect(fetchedAfterClear?.description).toBeNull();
    });
  });

  describe('ENG-01-A2a Postgres Integration: Engagements, Versions, and Operation Receipts', () => {
    it('IT-15: creates draft engagement + v1 atomically with ENG-###### code sequence', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const ctx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(ctx);
        const services = await repo.listServiceReferences(ctx);
        const firstService = services[0]!;
        const realClient = await repo.createClient(ctx, {
          id: '90000000-0000-4000-a000-000000000015',
          displayName: 'IT-15 Real Client',
          relationshipOwnerId: MANAGER_ID,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        });

        const created = await repo.mutateEngagement(ctx, {
          kind: 'createDraft',
          idempotencyKey: 'it-create-draft-1',
          clientId: realClient.id,
          serviceId: firstService.id,
          title: 'Integration Test Statutory Audit',
          scope: 'Comprehensive annual financial audit and statutory reporting',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 50000000,
          billingTerms: '50% advance on sign-off, 50% on deliverable',
          startDate: '2026-04-01',
          endDate: '2027-03-31',
        });

        expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(created.code).toMatch(/^ENG-\d{6}$/);
        expect(created.status).toBe('draft');
        expect(created.approvedVersionId).toBeNull();
        expect(created.approvedVersion).toBeNull();
        expect(created.approvedAt).toBeNull();
        expect(created.endedAt).toBeNull();

        // Verify version 1 exists in DB
        const versions = await repo.listEngagementVersions(ctx, created.id);
        expect(versions).toHaveLength(1);
        expect(versions[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(versions[0]!.versionNumber).toBe(1);
        expect(versions[0]!.approvedAt).toBeNull();

        // Verify operation_receipt was recorded
        const receipts = await tx`
          SELECT idempotency_key, operation_type, request_hash
          FROM public.operation_receipts
          WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = 'it-create-draft-1';
        `;
        expect(receipts).toHaveLength(1);
        expect(receipts[0]?.['operation_type']).toBe('createDraft');

        const rawLineage = await tx`
          SELECT e.is_demo AS engagement_demo, ev.is_demo AS version_demo, r.is_demo AS receipt_demo
          FROM public.engagements e
          JOIN public.engagement_versions ev ON ev.engagement_id = e.id
          JOIN public.operation_receipts r ON r.actor_id = ${FOUNDER_ID}::uuid
            AND r.idempotency_key = 'it-create-draft-1'
          WHERE e.id = ${created.id}::uuid AND ev.version_number = 1;
        `;
        expect(rawLineage[0]).toMatchObject({ engagement_demo: false, version_demo: false, receipt_demo: false });

        const demoClient = (await tx`SELECT id FROM public.clients WHERE is_demo = true LIMIT 1`)[0];
        expect(demoClient).toBeDefined();
        const realClientRaw = await tx`SELECT is_demo FROM public.clients WHERE id = ${realClient.id}::uuid`;
        expect(realClientRaw[0]?.['is_demo']).toBe(false);
        const demo = await repo.mutateEngagement(ctx, {
          kind: 'createDraft', idempotencyKey: 'it-create-demo-lineage', clientId: String(demoClient!['id']),
          serviceId: firstService.id, title: 'Demo lineage', scope: 'Demo scope',
          responsiblePartnerId: FOUNDER_ID, deliveryManagerId: MANAGER_ID, feeModel: 'fixed',
          agreedFeePaise: 1000000, billingTerms: 'Terms', startDate: '2026-04-01',
        });
        const demoLineage = await tx`
          SELECT e.is_demo AS engagement_demo, ev.is_demo AS version_demo, r.is_demo AS receipt_demo
          FROM public.engagements e JOIN public.engagement_versions ev ON ev.engagement_id = e.id
          JOIN public.operation_receipts r ON r.actor_id = ${FOUNDER_ID}::uuid AND r.idempotency_key = 'it-create-demo-lineage'
          WHERE e.id = ${demo.id}::uuid AND ev.version_number = 1;
        `;
        expect(demoLineage[0]).toMatchObject({ engagement_demo: true, version_demo: true, receipt_demo: true });
      });
    });

    it('IT-15b: preserves real and demo is_demo lineage through amendment', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const ctx = { actorId: FOUNDER_ID };
        const service = (await repo.listServiceReferences(ctx))[0];
        if (!service) throw new Error('Service missing');
        const realClient = await repo.createClient(ctx, {
          id: '90000000-0000-4000-a000-00000000015b',
          displayName: 'IT-15b Real Client',
          relationshipOwnerId: MANAGER_ID,
          createdAt: '2026-04-02T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z',
        });
        const demoClient = (await tx`SELECT id FROM public.clients WHERE is_demo = true LIMIT 1`)[0];
        if (!demoClient) throw new Error('Demo client missing');

        const createAndAmend = async (clientId: string, prefix: string) => {
          const draft = await repo.mutateEngagement(ctx, {
            kind: 'createDraft', idempotencyKey: `${prefix}-create`, clientId, serviceId: service.id,
            title: `${prefix} engagement`, scope: `${prefix} scope`, responsiblePartnerId: FOUNDER_ID,
            deliveryManagerId: MANAGER_ID, feeModel: 'fixed', agreedFeePaise: 1000000,
            billingTerms: 'Terms', startDate: '2026-04-02',
          });
          const version = (await repo.listEngagementVersions(ctx, draft.id))[0];
          if (!version) throw new Error('Version missing');
          const activated = await repo.mutateEngagement(ctx, {
            kind: 'activate', idempotencyKey: `${prefix}-activate`, engagementId: draft.id,
            versionId: version.id, expectedUpdatedAt: draft.updatedAt,
          });
          const amended = await repo.mutateEngagement(ctx, {
            kind: 'amend', idempotencyKey: `${prefix}-amend`, engagementId: draft.id,
            title: `${prefix} amended`, scope: `${prefix} amended scope`, responsiblePartnerId: FOUNDER_ID,
            deliveryManagerId: MANAGER_ID, feeModel: 'fixed', agreedFeePaise: 2000000,
            billingTerms: 'Updated terms', startDate: '2026-04-02', expectedUpdatedAt: activated.updatedAt,
          });
          return { id: draft.id, amendedVersionId: amended.approvedVersion?.id };
        };

        const real = await createAndAmend(realClient.id, 'it-15b-real');
        const demo = await createAndAmend(String(demoClient['id']), 'it-15b-demo');
        const lineage = await tx`
          SELECT e.id, e.is_demo AS engagement_demo, ev.version_number, ev.is_demo AS version_demo
          FROM public.engagements e
          JOIN public.engagement_versions ev ON ev.engagement_id = e.id
          WHERE e.id IN (${real.id}::uuid, ${demo.id}::uuid)
          ORDER BY e.id, ev.version_number;
        `;
        expect(lineage.filter((row) => row['id'] === real.id).map((row) => [row['engagement_demo'], row['version_number'], row['version_demo']])).toEqual([[false, 1, false], [false, 2, false]]);
        expect(lineage.filter((row) => row['id'] === demo.id).map((row) => [row['engagement_demo'], row['version_number'], row['version_demo']])).toEqual([[true, 1, true], [true, 2, true]]);
        const receipts = await tx`
          SELECT idempotency_key, is_demo FROM public.operation_receipts
          WHERE idempotency_key IN ('it-15b-real-create', 'it-15b-real-amend', 'it-15b-demo-create', 'it-15b-demo-amend')
          ORDER BY idempotency_key;
        `;
        expect(receipts.map((row) => [row['idempotency_key'], row['is_demo']])).toEqual([
          ['it-15b-demo-amend', true], ['it-15b-demo-create', true],
          ['it-15b-real-amend', false], ['it-15b-real-create', false],
        ]);
      });
    });

    it('IT-16: executes full lifecycle: activate -> amend to v2 -> end under Postgres authority', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const services = await repo.listServiceReferences(founderCtx);
        const client = clients[0]!;
        const service = services[0]!;

        // 1. Create draft (adapter generates IDs internally)
        const draft = await repo.mutateEngagement(founderCtx, {
          kind: 'createDraft',
          idempotencyKey: 'it-lifecycle-create',
          clientId: client.id,
          serviceId: service.id,
          title: 'Full Lifecycle Engagement',
          scope: 'Scope definition for full lifecycle',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 20000000,
          billingTerms: 'Deliverable completion',
          startDate: '2026-05-01',
        });

        // Use returned IDs — no caller-generated IDs
        const versions = await repo.listEngagementVersions(founderCtx, draft.id);
        const verId = versions[0]!.id;

        // 2. Activate
        const activated = await repo.mutateEngagement(founderCtx, {
          kind: 'activate',
          idempotencyKey: 'it-lifecycle-activate',
          engagementId: draft.id,
          versionId: verId,
          expectedUpdatedAt: draft.updatedAt,
        });

        expect(activated.status).toBe('active');
        expect(activated.approvedVersionId).toBe(verId);
        expect(activated.approvedVersion?.id).toBe(verId);
        expect(activated.approvedAt).not.toBeNull();
        expect(activated.approvedById).toBe(FOUNDER_ID);

        // 3. Amend active engagement -> allocates version 2
        const amended = await repo.mutateEngagement(founderCtx, {
          kind: 'amend',
          idempotencyKey: 'it-lifecycle-amend',
          engagementId: draft.id,
          title: 'Full Lifecycle Engagement (Amended)',
          scope: 'Amended scope with branch offices',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'recurring',
          agreedFeePaise: 25000000,
          billingTerms: 'Quarterly',
          startDate: '2026-05-01',
          expectedUpdatedAt: activated.updatedAt,
        });

        expect(amended.status).toBe('active');
        expect(amended.approvedVersion?.versionNumber).toBe(2);
        expect(amended.approvedVersion?.agreedFeePaise).toBe(25000000);

        const allVersions = await repo.listEngagementVersions(founderCtx, draft.id);
        expect(allVersions).toHaveLength(2);
        expect(allVersions.map((v) => v.versionNumber)).toEqual([1, 2]);

        // 4. End active engagement
        const ended = await repo.mutateEngagement(founderCtx, {
          kind: 'end',
          idempotencyKey: 'it-lifecycle-end',
          engagementId: draft.id,
          outcome: 'completed',
          reason: 'Engagement deliverables fulfilled in accordance with terms.',
          expectedUpdatedAt: amended.updatedAt,
        });

        expect(ended.status).toBe('ended');
        expect(ended.endOutcome).toBe('completed');
        expect(ended.endReason).toBe('Engagement deliverables fulfilled in accordance with terms.');
        expect(ended.endedAt).not.toBeNull();
        expect(ended.endedById).toBe(FOUNDER_ID);
      });
    });

    it('IT-17: rejects stale-write concurrency and enforces non-management RLS/forbidden', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const staffCtx = { actorId: STAFF_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const services = await repo.listServiceReferences(founderCtx);

        // Staff cannot mutate or read engagements under RLS
        await expect(
          repo.mutateEngagement(staffCtx, {
            kind: 'createDraft',
            idempotencyKey: 'staff-forbidden-attempt',
            clientId: clients[0]!.id,
            serviceId: services[0]!.id,
            title: 'Staff Attempt',
            scope: 'Scope',
            responsiblePartnerId: FOUNDER_ID,
            deliveryManagerId: MANAGER_ID,
            feeModel: 'fixed',
            agreedFeePaise: 1000000,
            billingTerms: 'Terms',
            startDate: '2026-06-01',
          }),
        ).rejects.toMatchObject({
          code: 'forbidden',
        });

        // Founder creates draft
        const created = await repo.mutateEngagement(founderCtx, {
          kind: 'createDraft',
          idempotencyKey: 'stale-rejection-test',
          clientId: clients[0]!.id,
          serviceId: services[0]!.id,
          title: 'Concurrency Rejection Test',
          scope: 'Scope',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 10000000,
          billingTerms: 'Terms',
          startDate: '2026-06-01',
        });

        const versions = await repo.listEngagementVersions(founderCtx, created.id);

        // 409 optimistic_lock_conflict on stale expectedUpdatedAt
        await expect(
          repo.mutateEngagement(founderCtx, {
            kind: 'activate',
            idempotencyKey: 'stale-activate-key',
            engagementId: created.id,
            versionId: versions[0]!.id,
            expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
          }),
        ).rejects.toMatchObject({
          status: 409,
          code: 'optimistic_lock_conflict',
        });
      });
    });

    it('IT-18: identical replay returns stored original; mismatched payload throws conflict (409)', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const services = await repo.listServiceReferences(founderCtx);

        const payload = {
          kind: 'createDraft' as const,
          idempotencyKey: 'it-idemp-key-99',
          clientId: clients[0]!.id,
          serviceId: services[0]!.id,
          title: 'Idempotent Integration Test',
          scope: 'Integration scope',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed' as const,
          agreedFeePaise: 15000000,
          billingTerms: 'Terms',
          startDate: '2026-07-01',
        };

        const original = await repo.mutateEngagement(founderCtx, payload);

        // Identical replay returns exact stored DTO
        const replay = await repo.mutateEngagement(founderCtx, payload);
        expect(replay.id).toBe(original.id);
        expect(replay.code).toBe(original.code);

        // Mismatched payload with same key throws 409 conflict
        await expect(
          repo.mutateEngagement(founderCtx, {
            ...payload,
            agreedFeePaise: 88888888,
          }),
        ).rejects.toMatchObject({
          status: 409,
          code: 'conflict',
        });
      });
    });

    it('IT-19: rolls back atomically leaving no orphan version or receipt on failure', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);

        const invalidServiceId = '00000000-0000-4000-a000-999999999999';
        const beforeCounts = await tx`
          SELECT
            (SELECT count(*) FROM public.engagements WHERE client_id = ${clients[0]!.id}::uuid) AS engagements,
            (SELECT count(*) FROM public.engagement_versions WHERE engagement_id IN
              (SELECT id FROM public.engagements WHERE client_id = ${clients[0]!.id}::uuid)) AS versions;
        `;

        await expect(
          repo.mutateEngagement(founderCtx, {
            kind: 'createDraft',
            idempotencyKey: 'it-failing-rollback-key',
            clientId: clients[0]!.id,
            serviceId: invalidServiceId,
            title: 'Failing Engagement',
            scope: 'Scope',
            responsiblePartnerId: FOUNDER_ID,
            deliveryManagerId: MANAGER_ID,
            feeModel: 'fixed',
            agreedFeePaise: 10000000,
            billingTerms: 'Terms',
            startDate: '2026-08-01',
          }),
        ).rejects.toBeDefined();

        const afterCounts = await tx`
          SELECT
            (SELECT count(*) FROM public.engagements WHERE client_id = ${clients[0]!.id}::uuid) AS engagements,
            (SELECT count(*) FROM public.engagement_versions WHERE engagement_id IN
              (SELECT id FROM public.engagements WHERE client_id = ${clients[0]!.id}::uuid)) AS versions;
        `;
        expect(afterCounts[0]).toMatchObject({ engagements: beforeCounts[0]!['engagements'], versions: beforeCounts[0]!['versions'] });

        // Verify no orphaned receipt
        const rcptRows = await tx`
          SELECT id FROM public.operation_receipts
          WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = 'it-failing-rollback-key';
        `;
        expect(rcptRows).toHaveLength(0);
      });
    });

    it('IT-20: parallel same-key requests under advisory lock — only one write; replay returns stored DTO', async () => {
      // Uses two independent pool connections racing the same actor+key
      const founderCtx = { actorId: FOUNDER_ID };
      const idempotencyKey = 'it-parallel-race-key-' + Date.now();

      const clients = await new PostgresCrmRepository(pool).listClientReferences(founderCtx);
      const services = await new PostgresCrmRepository(pool).listServiceReferences(founderCtx);

      const payload = {
        kind: 'createDraft' as const,
        idempotencyKey,
        clientId: clients[0]!.id,
        serviceId: services[0]!.id,
        title: 'Parallel Race Engagement',
        scope: 'Race condition test scope',
        responsiblePartnerId: FOUNDER_ID,
        deliveryManagerId: MANAGER_ID,
        feeModel: 'fixed' as const,
        agreedFeePaise: 7000000,
        billingTerms: 'Race terms',
        startDate: '2026-09-01',
      };

      let createdEngagementId: string | undefined;
      try {
        // Fire two concurrent mutateEngagement calls for the same actor+key
        const [r1, r2] = await Promise.allSettled([
          new PostgresCrmRepository(pool).mutateEngagement(founderCtx, payload),
          new PostgresCrmRepository(pool).mutateEngagement(founderCtx, payload),
        ]);
        if (r1.status === 'fulfilled') createdEngagementId = r1.value.id;
        if (!createdEngagementId && r2.status === 'fulfilled') createdEngagementId = r2.value.id;
        expect(r1.status).toBe('fulfilled');
        expect(r2.status).toBe('fulfilled');
        if (r1.status !== 'fulfilled' || r2.status !== 'fulfilled') return;

        // Both returned the same engagement ID and code (idempotent)
        expect(r1.value.id).toBe(r2.value.id);
        expect(r1.value.code).toBe(r2.value.code);

        const counts = await pool`
          SELECT (SELECT count(*) FROM public.engagements WHERE id = ${r1.value.id}::uuid) AS engagements,
                 (SELECT count(*) FROM public.engagement_versions WHERE engagement_id = ${r1.value.id}::uuid) AS versions,
                 (SELECT count(*) FROM public.operation_receipts WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = ${idempotencyKey}) AS receipts;
        `;
        expect(Number(counts[0]!['engagements'])).toBe(1);
        expect(Number(counts[0]!['versions'])).toBe(1);
        expect(Number(counts[0]!['receipts'])).toBe(1);

      } finally {
        if (createdEngagementId) {
          const cleanupEngagementId = createdEngagementId;
          await rootClient.begin(async (tx) => {
            await tx`SELECT set_config('request.jwt.claim.sub', ${FOUNDER_ID}, true)`;
            await tx`SELECT set_config('app.demo_cleanup', 'on', true)`;
            await tx`SELECT set_config('app.demo_cleanup_actor', ${FOUNDER_ID}, true)`;
            await tx`
              DELETE FROM public.audit_log
              WHERE is_demo = true
                AND (
                  (table_name = 'engagements' AND record_pk = ${cleanupEngagementId})
                  OR (table_name = 'engagement_versions' AND record_pk IN (
                    SELECT id::text FROM public.engagement_versions WHERE engagement_id = ${cleanupEngagementId}::uuid
                  ))
                  OR (table_name = 'operation_receipts' AND record_pk IN (
                    SELECT id::text FROM public.operation_receipts
                    WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = ${idempotencyKey}
                  ))
                )
            `;
            await tx`
              DELETE FROM public.operation_receipts
              WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = ${idempotencyKey}
            `;
            await tx`DELETE FROM public.engagement_versions WHERE engagement_id = ${cleanupEngagementId}::uuid`;
            await tx`DELETE FROM public.engagements WHERE id = ${cleanupEngagementId}::uuid`;
            await tx`SELECT set_config('app.demo_cleanup', 'off', true)`;
            await tx`SELECT set_config('app.demo_cleanup_actor', '', true)`;
          });
        }
      }
    });

    it('IT-21: cross-management-actor receipt isolation — Manager cannot replay Founder receipt', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const managerCtx = { actorId: MANAGER_ID };

        const clients = await repo.listClientReferences(founderCtx);
        const services = await repo.listServiceReferences(founderCtx);
        const idempotencyKey = 'it-cross-actor-isolation-key';

        // Founder creates a draft
        const founderDraft = await repo.mutateEngagement(founderCtx, {
          kind: 'createDraft',
          idempotencyKey,
          clientId: clients[0]!.id,
          serviceId: services[0]!.id,
          title: 'Cross-Actor Isolation Test',
          scope: 'Actor isolation scope',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 3000000,
          billingTerms: 'Terms',
          startDate: '2026-10-01',
        });

        // Verify Founder receipt exists for Founder
        const founderReceipts = await tx`
          SELECT id FROM public.operation_receipts
          WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = ${idempotencyKey};
        `;
        expect(founderReceipts).toHaveLength(1);

        // Even with the exact same payload, RLS/actor scoping prevents replay of the Founder receipt.
        const managerDraft = await repo.mutateEngagement(managerCtx, {
          kind: 'createDraft',
          idempotencyKey,
          clientId: clients[0]!.id,
          serviceId: services[0]!.id,
          title: 'Cross-Actor Isolation Test',
          scope: 'Actor isolation scope',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 3000000,
          billingTerms: 'Terms',
          startDate: '2026-10-01',
        });

        // Manager receipt stored separately — different actor_id produces different receipt row
        const founderReceiptInvisible = await tx`
          SELECT id FROM public.operation_receipts
          WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key = ${idempotencyKey};
        `;
        expect(founderReceiptInvisible).toHaveLength(0);
        const managerReceiptVisible = await tx`
          SELECT id FROM public.operation_receipts
          WHERE actor_id = ${MANAGER_ID}::uuid AND idempotency_key = ${idempotencyKey};
        `;
        expect(managerReceiptVisible).toHaveLength(1);

        // The two engagements are distinct
        expect(founderDraft.id).not.toBe(managerDraft.id);
      });
    });
  });

  describe('ENG-02a Postgres Integration: Assignment engagement link', () => {
    async function createActiveEngagement(repo: PostgresCrmRepository, clientId: string, serviceId: string, key: string) {
      const founderCtx = { actorId: FOUNDER_ID };
      const draft = await repo.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: `${key}-create`,
        clientId,
        serviceId,
        title: 'Linked Assignment Engagement',
        scope: 'Scope for linked assignments',
        responsiblePartnerId: FOUNDER_ID,
        deliveryManagerId: MANAGER_ID,
        feeModel: 'fixed',
        agreedFeePaise: 1000000,
        billingTerms: 'Terms',
        startDate: '2026-11-01',
      });
      const versions = await repo.listEngagementVersions(founderCtx, draft.id);
      return repo.mutateEngagement(founderCtx, {
        kind: 'activate',
        idempotencyKey: `${key}-activate`,
        engagementId: draft.id,
        versionId: versions[0]!.id,
        expectedUpdatedAt: draft.updatedAt,
      });
    }

    function assignmentRecord(
      id: string,
      client: { id: string; name: string },
      service: { id: string; name: string },
      engagementId?: string | null,
    ) {
      return {
        id,
        clientId: client.id,
        clientName: client.name,
        serviceId: service.id,
        service: service.name,
        title: 'Linked assignment',
        ownerId: STAFF_ID,
        reviewerIds: [],
        status: 'assigned' as const,
        dueAt: new Date(Date.now() + 86400000 * 7).toISOString(),
        engagementId: engagementId ?? null,
        createdById: FOUNDER_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    async function asFounder<T>(tx: postgres.TransactionSql, statement: (sp: postgres.TransactionSql) => Promise<T>) {
      return tx.savepoint(async (sp) => {
        await sp`SELECT set_config('request.jwt.claim.sub', ${FOUNDER_ID}, true)`;
        await sp`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`;
        await sp`SELECT set_config('role', 'authenticated', true)`;
        return statement(sp);
      });
    }

    it('IT-22: a linked insert stores the engagement id and the engagement code', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-22');

        const newId = '90000000-0000-4000-a000-0000000000a1';
        const created = await repo.createAssignment(founderCtx, assignmentRecord(newId, client, service, engagement.id));
        expect(created).toMatchObject({ engagementId: engagement.id, engagementCode: engagement.code });

        const rawRows = await tx`SELECT engagement_id, engagement_code FROM public.assignments WHERE id = ${newId}::uuid`;
        expect(rawRows[0]).toMatchObject({ engagement_id: engagement.id, engagement_code: engagement.code });

        const unlinkedId = '90000000-0000-4000-a000-0000000000a2';
        const unlinked = await repo.createAssignment(founderCtx, assignmentRecord(unlinkedId, client, service));
        expect(unlinked).toMatchObject({ engagementId: null, engagementCode: null });
      });
    });

    it('IT-23: the database rejects a cross-client link, a draft engagement and an unknown engagement', async () => {
      await runIsolatedTest(async (repo) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const clientA = clients[0]!;
        const clientB = clients[1]!;
        const engagementForB = await createActiveEngagement(repo, clientB.id, service.id, 'it-23');

        await expect(
          repo.createAssignment(founderCtx, assignmentRecord('90000000-0000-4000-a000-0000000000b1', clientA, service, engagementForB.id)),
        ).rejects.toBeDefined();

        const draft = await repo.mutateEngagement(founderCtx, {
          kind: 'createDraft',
          idempotencyKey: 'it-23-draft',
          clientId: clientA.id,
          serviceId: service.id,
          title: 'Draft only',
          scope: 'Scope',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 1000000,
          billingTerms: 'Terms',
          startDate: '2026-11-01',
        });
        await expect(
          repo.createAssignment(founderCtx, assignmentRecord('90000000-0000-4000-a000-0000000000b2', clientA, service, draft.id)),
        ).rejects.toBeDefined();

        await expect(
          repo.createAssignment(
            founderCtx,
            assignmentRecord('90000000-0000-4000-a000-0000000000b3', clientA, service, '00000000-0000-4000-e000-999999999999'),
          ),
        ).rejects.toBeDefined();
      });
    });

    it('IT-24: engagement_id, engagement_code and client_id cannot change after insert', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const client = clients[0]!;
        const otherClient = clients[1]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-24');
        const otherEngagement = await createActiveEngagement(repo, client.id, service.id, 'it-24-other');

        const linkedId = '90000000-0000-4000-a000-0000000000c1';
        const unlinkedId = '90000000-0000-4000-a000-0000000000c2';
        await repo.createAssignment(founderCtx, assignmentRecord(linkedId, client, service, engagement.id));
        await repo.createAssignment(founderCtx, assignmentRecord(unlinkedId, client, service));

        // Re-linking to another engagement
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.assignments SET engagement_id = ${otherEngagement.id}::uuid WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        // Clearing the link
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.assignments SET engagement_id = NULL, engagement_code = NULL WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        // Adding a link after creation
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.assignments SET engagement_id = ${engagement.id}::uuid, engagement_code = ${engagement.code} WHERE id = ${unlinkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        // Changing the client of a linked assignment
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.assignments SET client_id = ${otherClient.id}::uuid WHERE id = ${linkedId}::uuid`),
        ).rejects.toBeDefined();

        const rawRows = await tx`SELECT engagement_id, engagement_code, client_id FROM public.assignments WHERE id = ${linkedId}::uuid`;
        expect(rawRows[0]).toMatchObject({ engagement_id: engagement.id, engagement_code: engagement.code, client_id: client.id });
      });
    });

    it('IT-25: a direct write to engagement_code is rejected on update and discarded on insert', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-25');

        const linkedId = '90000000-0000-4000-a000-0000000000d1';
        await repo.createAssignment(founderCtx, assignmentRecord(linkedId, client, service, engagement.id));

        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.assignments SET engagement_code = 'ENG-999999' WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);

        // A forged code on insert is overwritten by the engagement's own code (or nulled when unlinked)
        const forgedLinkedId = '90000000-0000-4000-a000-0000000000d2';
        const forgedUnlinkedId = '90000000-0000-4000-a000-0000000000d3';
        await asFounder(tx, async (sp) => {
          await sp`
            INSERT INTO public.assignments (id, client_id, service_id, title, owner_id, status, due_at, engagement_id, engagement_code, created_by)
            VALUES (${forgedLinkedId}::uuid, ${client.id}::uuid, ${service.id}::uuid, 'Forged linked', ${STAFF_ID}::uuid, 'assigned', now() + interval '7 days', ${engagement.id}::uuid, 'ENG-999999', ${FOUNDER_ID}::uuid)`;
          await sp`
            INSERT INTO public.assignments (id, client_id, service_id, title, owner_id, status, due_at, engagement_code, created_by)
            VALUES (${forgedUnlinkedId}::uuid, ${client.id}::uuid, ${service.id}::uuid, 'Forged unlinked', ${STAFF_ID}::uuid, 'assigned', now() + interval '7 days', 'ENG-999999', ${FOUNDER_ID}::uuid)`;
        });
        const rows = await tx`SELECT id, engagement_code FROM public.assignments WHERE id IN (${forgedLinkedId}::uuid, ${forgedUnlinkedId}::uuid)`;
        const codeById = new Map(rows.map((row) => [String(row['id']), row['engagement_code']]));
        expect(codeById.get(forgedLinkedId)).toBe(engagement.code);
        expect(codeById.get(forgedUnlinkedId)).toBeNull();
      });
    });

    it('IT-26: a Staff actor who can read the assignment sees engagementCode but cannot read the engagement', async () => {
      await runIsolatedTest(async (repo) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const staffCtx = { actorId: STAFF_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-26');

        const linkedId = '90000000-0000-4000-a000-0000000000e1';
        await repo.createAssignment(founderCtx, assignmentRecord(linkedId, client, service, engagement.id));

        const seen = await repo.getAssignment(staffCtx, linkedId);
        expect(seen).toMatchObject({ engagementId: engagement.id, engagementCode: engagement.code });
        expect((await repo.listAssignments(staffCtx)).find((a) => a.id === linkedId)).toMatchObject({
          engagementCode: engagement.code,
        });
        expect(await repo.getEngagement(staffCtx, engagement.id)).toBeNull();
      });
    });
  });

  describe('ENG-02c Postgres Integration: Recurring Schedule engagement link', () => {
    async function createActiveEngagement(repo: PostgresCrmRepository, clientId: string, serviceId: string, key: string) {
      const founderCtx = { actorId: FOUNDER_ID };
      const draft = await repo.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: `${key}-create`,
        clientId,
        serviceId,
        title: 'Linked Schedule Engagement',
        scope: 'Scope for linked schedules',
        responsiblePartnerId: FOUNDER_ID,
        deliveryManagerId: MANAGER_ID,
        feeModel: 'fixed',
        agreedFeePaise: 1000000,
        billingTerms: 'Terms',
        startDate: '2026-11-01',
      });
      const versions = await repo.listEngagementVersions(founderCtx, draft.id);
      return repo.mutateEngagement(founderCtx, {
        kind: 'activate',
        idempotencyKey: `${key}-activate`,
        engagementId: draft.id,
        versionId: versions[0]!.id,
        expectedUpdatedAt: draft.updatedAt,
      });
    }

    function endEngagement(repo: PostgresCrmRepository, engagementId: string, expectedUpdatedAt: string, key: string) {
      return repo.mutateEngagement({ actorId: FOUNDER_ID }, {
        kind: 'end',
        idempotencyKey: `${key}-end`,
        engagementId,
        outcome: 'completed',
        reason: 'Work completed',
        expectedUpdatedAt,
      });
    }

    // The materializer is granted to the service role only and, in production, runs in its own
    // transaction outside any user context. Inside one isolated test transaction the earlier
    // user-context calls leave the role set to `authenticated`, so restore the server's own role first.
    async function asServerRole(tx: postgres.TransactionSql) {
      await tx`RESET ROLE`;
      await tx`SELECT set_config('request.jwt.claim.sub', '', true)`;
      await tx`SELECT set_config('request.jwt.claim.role', '', true)`;
    }

    function scheduleRecord(
      id: string,
      client: { id: string; name: string },
      service: { id: string; name: string },
      engagementId?: string | null,
    ) {
      return {
        id,
        clientId: client.id,
        clientName: client.name,
        serviceId: service.id,
        service: service.name,
        title: 'Linked schedule',
        cadence: 'monthly' as const,
        ownerId: STAFF_ID,
        reviewerIds: [],
        nextOccurrenceOn: '2026-11-01',
        dueDay: 10,
        engagementId: engagementId ?? null,
        createdById: FOUNDER_ID,
      };
    }

    async function asFounder<T>(tx: postgres.TransactionSql, statement: (sp: postgres.TransactionSql) => Promise<T>) {
      return tx.savepoint(async (sp) => {
        await sp`SELECT set_config('request.jwt.claim.sub', ${FOUNDER_ID}, true)`;
        await sp`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`;
        await sp`SELECT set_config('role', 'authenticated', true)`;
        return statement(sp);
      });
    }

    it('IT-27: a linked schedule insert stores the engagement id and code', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-27');

        const linkedId = '90000000-0000-4000-a000-0000000000f1';
        const created = await repo.createRecurringSchedule(founderCtx, scheduleRecord(linkedId, client, service, engagement.id));
        expect(created).toMatchObject({ engagementId: engagement.id, engagementCode: engagement.code });
        expect((await repo.listRecurringSchedules(founderCtx)).find((s) => s.id === linkedId)).toMatchObject({
          engagementId: engagement.id,
          engagementCode: engagement.code,
        });
        const rawRows = await tx`SELECT engagement_id, engagement_code FROM public.recurring_schedules WHERE id = ${linkedId}::uuid`;
        expect(rawRows[0]).toMatchObject({ engagement_id: engagement.id, engagement_code: engagement.code });

        const unlinked = await repo.createRecurringSchedule(
          founderCtx,
          scheduleRecord('90000000-0000-4000-a000-0000000000f2', client, service),
        );
        expect(unlinked).toMatchObject({ engagementId: null, engagementCode: null });
      });
    });

    it('IT-28: the database rejects a cross-client link, a draft or ended engagement and an unknown engagement', async () => {
      await runIsolatedTest(async (repo) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const clientA = clients[0]!;
        const clientB = clients[1]!;
        const engagementForB = await createActiveEngagement(repo, clientB.id, service.id, 'it-28');

        await expect(
          repo.createRecurringSchedule(founderCtx, scheduleRecord('90000000-0000-4000-a000-000000000101', clientA, service, engagementForB.id)),
        ).rejects.toBeDefined();

        const draft = await repo.mutateEngagement(founderCtx, {
          kind: 'createDraft',
          idempotencyKey: 'it-28-draft',
          clientId: clientA.id,
          serviceId: service.id,
          title: 'Draft only',
          scope: 'Scope',
          responsiblePartnerId: FOUNDER_ID,
          deliveryManagerId: MANAGER_ID,
          feeModel: 'fixed',
          agreedFeePaise: 1000000,
          billingTerms: 'Terms',
          startDate: '2026-11-01',
        });
        await expect(
          repo.createRecurringSchedule(founderCtx, scheduleRecord('90000000-0000-4000-a000-000000000102', clientA, service, draft.id)),
        ).rejects.toBeDefined();

        const toEnd = await createActiveEngagement(repo, clientA.id, service.id, 'it-28-ended');
        const ended = await endEngagement(repo, toEnd.id, toEnd.updatedAt, 'it-28-ended');
        await expect(
          repo.createRecurringSchedule(founderCtx, scheduleRecord('90000000-0000-4000-a000-000000000103', clientA, service, ended.id)),
        ).rejects.toBeDefined();

        await expect(
          repo.createRecurringSchedule(
            founderCtx,
            scheduleRecord('90000000-0000-4000-a000-000000000104', clientA, service, '00000000-0000-4000-e000-999999999999'),
          ),
        ).rejects.toBeDefined();
      });
    });

    it('IT-29: a generated assignment inherits the schedule engagement id and code', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-29');
        const scheduleId = '90000000-0000-4000-a000-000000000111';
        await repo.createRecurringSchedule(founderCtx, scheduleRecord(scheduleId, client, service, engagement.id));

        await asServerRole(tx);
        const result = await repo.materializeDueAssignments(founderCtx, '2026-11-05');
        const generated = result.occurrences.filter((o) => o.scheduleId === scheduleId);
        expect(generated.length).toBe(1);
        const rows = await tx`SELECT engagement_id, engagement_code FROM public.assignments WHERE id = ${generated[0]!.assignmentId}::uuid`;
        expect(rows[0]).toMatchObject({ engagement_id: engagement.id, engagement_code: engagement.code });
      });
    });

    it('IT-30: ending the engagement deactivates its schedules and the materializer skips them', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-30');
        const linkedId = '90000000-0000-4000-a000-000000000121';
        const unlinkedId = '90000000-0000-4000-a000-000000000122';
        await repo.createRecurringSchedule(founderCtx, scheduleRecord(linkedId, client, service, engagement.id));
        await repo.createRecurringSchedule(founderCtx, scheduleRecord(unlinkedId, client, service));

        await endEngagement(repo, engagement.id, engagement.updatedAt, 'it-30');

        const rows = await tx`SELECT id, is_active FROM public.recurring_schedules WHERE id IN (${linkedId}::uuid, ${unlinkedId}::uuid)`;
        const activeById = new Map(rows.map((row) => [String(row['id']), row['is_active']]));
        expect(activeById.get(linkedId)).toBe(false);
        expect(activeById.get(unlinkedId)).toBe(true);

        await asServerRole(tx);
        const result = await repo.materializeDueAssignments(founderCtx, '2026-11-05');
        expect(result.occurrences.some((o) => o.scheduleId === linkedId)).toBe(false);
        expect(result.occurrences.some((o) => o.scheduleId === unlinkedId)).toBe(true);
      });
    });

    it('IT-31: a schedule linked to an ended engagement cannot be reactivated', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-31');
        const linkedId = '90000000-0000-4000-a000-000000000131';
        await repo.createRecurringSchedule(founderCtx, scheduleRecord(linkedId, client, service, engagement.id));
        await endEngagement(repo, engagement.id, engagement.updatedAt, 'it-31');

        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.recurring_schedules SET is_active = true WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/cannot be reactivated/i);
        await expect(repo.updateRecurringSchedule(founderCtx, linkedId, { active: true })).rejects.toBeDefined();

        const rows = await tx`SELECT is_active FROM public.recurring_schedules WHERE id = ${linkedId}::uuid`;
        expect(rows[0]).toMatchObject({ is_active: false });
      });
    });

    it('IT-32: engagement_id, engagement_code and client_id cannot change after insert', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const founderCtx = { actorId: FOUNDER_ID };
        const clients = await repo.listClientReferences(founderCtx);
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        const client = clients[0]!;
        const otherClient = clients[1]!;
        const engagement = await createActiveEngagement(repo, client.id, service.id, 'it-32');
        const otherEngagement = await createActiveEngagement(repo, client.id, service.id, 'it-32-other');

        const linkedId = '90000000-0000-4000-a000-000000000141';
        const unlinkedId = '90000000-0000-4000-a000-000000000142';
        await repo.createRecurringSchedule(founderCtx, scheduleRecord(linkedId, client, service, engagement.id));
        await repo.createRecurringSchedule(founderCtx, scheduleRecord(unlinkedId, client, service));

        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.recurring_schedules SET engagement_id = ${otherEngagement.id}::uuid WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.recurring_schedules SET engagement_id = NULL, engagement_code = NULL WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.recurring_schedules SET engagement_id = ${engagement.id}::uuid, engagement_code = ${engagement.code} WHERE id = ${unlinkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.recurring_schedules SET engagement_code = 'ENG-999999' WHERE id = ${linkedId}::uuid`),
        ).rejects.toThrow(/immutable/i);
        await expect(
          asFounder(tx, (sp) => sp`UPDATE public.recurring_schedules SET client_id = ${otherClient.id}::uuid WHERE id = ${linkedId}::uuid`),
        ).rejects.toBeDefined();

        const rawRows = await tx`SELECT engagement_id, engagement_code, client_id FROM public.recurring_schedules WHERE id = ${linkedId}::uuid`;
        expect(rawRows[0]).toMatchObject({ engagement_id: engagement.id, engagement_code: engagement.code, client_id: client.id });
      });
    });
  });

  describe('BIL-01a billing reads', () => {
    let invoiceSeq: { last_value: string; is_called: boolean } | undefined;
    let receiptSeq: { last_value: string; is_called: boolean } | undefined;

    // The fixtures roll back, but sequence draws do not; put both code sequences back afterwards.
    beforeAll(async () => {
      const invoiceRows = await rootClient`SELECT last_value::text, is_called FROM public.invoice_code_seq`;
      const receiptRows = await rootClient`SELECT last_value::text, is_called FROM public.receipt_code_seq`;
      invoiceSeq = { last_value: String(invoiceRows[0]!['last_value']), is_called: Boolean(invoiceRows[0]!['is_called']) };
      receiptSeq = { last_value: String(receiptRows[0]!['last_value']), is_called: Boolean(receiptRows[0]!['is_called']) };
    });

    afterAll(async () => {
      if (invoiceSeq) await rootClient`SELECT setval('public.invoice_code_seq', ${invoiceSeq.last_value}::bigint, ${invoiceSeq.is_called})`;
      if (receiptSeq) await rootClient`SELECT setval('public.receipt_code_seq', ${receiptSeq.last_value}::bigint, ${receiptSeq.is_called})`;
    });

    // Fixtures are built in the server role (no user claim), as the billing writers will be later.
    async function createBillingFixtures(tx: postgres.TransactionSql, clientId: string) {
      const draftRows = await tx`
        INSERT INTO public.invoices (client_id, issue_date, due_date, created_by)
        VALUES (
          ${clientId}::uuid,
          (now() AT TIME ZONE 'Asia/Kolkata')::date - 30,
          (now() AT TIME ZONE 'Asia/Kolkata')::date - 10,
          ${FOUNDER_ID}::uuid
        )
        RETURNING id, code`;
      const invoice = draftRows[0]!;
      await tx`
        INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, tax_rate, sort_order)
        VALUES
          (${invoice['id']}::uuid, 'Audit fee', 1, 10000.00, 18, 0),
          (${invoice['id']}::uuid, 'Travel and filing costs', 1.5, 1000.50, 0, 1)`;
      await tx`UPDATE public.invoices SET status = 'issued', notes = 'IT billing fixture' WHERE id = ${invoice['id']}::uuid`;

      const staleDraftRows = await tx`
        INSERT INTO public.invoices (client_id, issue_date, due_date, created_by)
        VALUES (
          ${clientId}::uuid,
          (now() AT TIME ZONE 'Asia/Kolkata')::date - 40,
          (now() AT TIME ZONE 'Asia/Kolkata')::date - 20,
          ${FOUNDER_ID}::uuid
        )
        RETURNING id, code`;
      const draft = staleDraftRows[0]!;

      const receiptRows = await tx`
        INSERT INTO public.payment_receipts (client_id, received_on, amount, method, reference, created_by)
        VALUES (${clientId}::uuid, (now() AT TIME ZONE 'Asia/Kolkata')::date - 5, 5000.25, 'upi', 'UPI-IT-33', ${FOUNDER_ID}::uuid)
        RETURNING id, code`;
      const receipt = receiptRows[0]!;
      await tx`
        INSERT INTO public.payment_allocations (receipt_id, invoice_id, amount, created_by)
        VALUES (${receipt['id']}::uuid, ${invoice['id']}::uuid, 3000.10, ${FOUNDER_ID}::uuid)`;

      const voidedRows = await tx`
        INSERT INTO public.payment_receipts (client_id, received_on, amount, method, created_by)
        VALUES (${clientId}::uuid, (now() AT TIME ZONE 'Asia/Kolkata')::date - 3, 750.00, 'cheque', ${FOUNDER_ID}::uuid)
        RETURNING id, code`;
      const voided = voidedRows[0]!;
      await tx`UPDATE public.payment_receipts SET status = 'voided', void_reason = 'Cheque bounced' WHERE id = ${voided['id']}::uuid`;

      return {
        invoiceId: String(invoice['id']),
        invoiceCode: String(invoice['code']),
        draftCode: String(draft['code']),
        receiptId: String(receipt['id']),
        receiptCode: String(receipt['code']),
        voidedCode: String(voided['code']),
      };
    }

    it('IT-33: the founder reads an issued invoice with paise totals, items, payments, balance and days overdue', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = (await repo.listClientReferences({ actorId: FOUNDER_ID }))[0]!;
        const fixtures = await createBillingFixtures(tx, client.id);

        const invoices = await repo.listInvoices({ actorId: FOUNDER_ID });
        const invoice = invoices.find((item) => item.code === fixtures.invoiceCode)!;
        expect(invoice).toBeDefined();
        expect(invoice).toMatchObject({
          clientId: client.id,
          clientCode: client.code,
          clientName: client.name,
          assignmentId: null,
          assignmentCode: null,
          currency: 'INR',
          status: 'part_paid',
          subtotalPaise: 1150075,
          taxPaise: 180000,
          totalPaise: 1330075,
          amountReceivedPaise: 300010,
          balancePaise: 1030065,
          daysOverdue: 10,
          notes: 'IT billing fixture',
          voidReason: null,
          voidedAt: null,
        });
        expect(invoice.issuedAt).toEqual(expect.any(String));
        expect(invoice.items).toHaveLength(2);
        expect(invoice.items[0]).toMatchObject({
          description: 'Audit fee',
          quantity: 1,
          unitPricePaise: 1000000,
          taxRatePercent: 18,
          lineSubtotalPaise: 1000000,
          lineTaxPaise: 180000,
          lineTotalPaise: 1180000,
        });
        expect(invoice.items[1]).toMatchObject({
          description: 'Travel and filing costs',
          quantity: 1.5,
          unitPricePaise: 100050,
          taxRatePercent: 0,
          lineSubtotalPaise: 150075,
          lineTaxPaise: 0,
          lineTotalPaise: 150075,
        });
        expect(invoice.payments).toEqual([
          {
            receiptId: fixtures.receiptId,
            receiptCode: fixtures.receiptCode,
            receivedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            amountPaise: 300010,
            receiptStatus: 'received',
          },
        ]);

        const draft = invoices.find((item) => item.code === fixtures.draftCode)!;
        expect(draft).toMatchObject({ status: 'draft', totalPaise: 0, balancePaise: 0, daysOverdue: 0, items: [], payments: [] });
      });
    });

    it('IT-34: the founder reads receipts with allocations, unallocated amounts and voided status', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = (await repo.listClientReferences({ actorId: FOUNDER_ID }))[0]!;
        const fixtures = await createBillingFixtures(tx, client.id);

        const receipts = await repo.listPaymentReceipts({ actorId: FOUNDER_ID });
        const received = receipts.find((item) => item.code === fixtures.receiptCode)!;
        expect(received).toMatchObject({
          clientCode: client.code,
          clientName: client.name,
          amountPaise: 500025,
          method: 'upi',
          reference: 'UPI-IT-33',
          status: 'received',
          voidReason: null,
          allocatedPaise: 300010,
          unallocatedPaise: 200015,
        });
        expect(received.allocations).toEqual([
          { invoiceId: fixtures.invoiceId, invoiceCode: fixtures.invoiceCode, amountPaise: 300010 },
        ]);

        const voided = receipts.find((item) => item.code === fixtures.voidedCode)!;
        expect(voided).toMatchObject({
          amountPaise: 75000,
          method: 'cheque',
          status: 'voided',
          voidReason: 'Cheque bounced',
          allocatedPaise: 0,
          unallocatedPaise: 75000,
          allocations: [],
        });
        expect(voided.voidedAt).toEqual(expect.any(String));
        expect(receipts.indexOf(voided)).toBeLessThan(receipts.indexOf(received));
      });
    });

    it('IT-35: a staff user context reads no invoices or receipts of a client it does not look after', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const unrelated = await repo.createClient(
          { actorId: FOUNDER_ID },
          {
            id: crypto.randomUUID(),
            displayName: 'IT-35 unrelated client',
            relationshipOwnerId: MANAGER_ID,
            createdAt: '2026-11-13T12:00:00.000Z',
            updatedAt: '2026-11-13T12:00:00.000Z',
          },
        );
        const fixtures = await createBillingFixtures(tx, unrelated.id);

        const invoices = await repo.listInvoices({ actorId: STAFF_ID });
        expect(invoices.some((invoice) => invoice.clientId === unrelated.id || invoice.code === fixtures.invoiceCode)).toBe(false);
        const receipts = await repo.listPaymentReceipts({ actorId: STAFF_ID });
        expect(receipts.some((receipt) => receipt.clientId === unrelated.id || receipt.code === fixtures.receiptCode)).toBe(false);
      });
    });
  });

  describe('FEE-01a Vyapar bills and payments', () => {
    let invoiceSeq: { last_value: string; is_called: boolean } | undefined;
    let receiptSeq: { last_value: string; is_called: boolean } | undefined;
    let sequenceNumber = 0;

    // The fixtures roll back, but sequence draws do not; put both code sequences back afterwards.
    beforeAll(async () => {
      const invoiceRows = await rootClient`SELECT last_value::text, is_called FROM public.invoice_code_seq`;
      const receiptRows = await rootClient`SELECT last_value::text, is_called FROM public.receipt_code_seq`;
      invoiceSeq = { last_value: String(invoiceRows[0]!['last_value']), is_called: Boolean(invoiceRows[0]!['is_called']) };
      receiptSeq = { last_value: String(receiptRows[0]!['last_value']), is_called: Boolean(receiptRows[0]!['is_called']) };
    });

    afterAll(async () => {
      if (invoiceSeq) await rootClient`SELECT setval('public.invoice_code_seq', ${invoiceSeq.last_value}::bigint, ${invoiceSeq.is_called})`;
      if (receiptSeq) await rootClient`SELECT setval('public.receipt_code_seq', ${receiptSeq.last_value}::bigint, ${receiptSeq.is_called})`;
    });

    const founderCtx = { actorId: FOUNDER_ID };
    const staffCtx = { actorId: STAFF_ID };

    // Same role handling as the materializer tests: user-context calls leave the role on `authenticated`.
    async function asServerRole(tx: postgres.TransactionSql) {
      await tx`RESET ROLE`;
      await tx`SELECT set_config('request.jwt.claim.sub', '', true)`;
      await tx`SELECT set_config('request.jwt.claim.role', '', true)`;
    }

    async function asUser(tx: postgres.TransactionSql, actorId: string) {
      await tx`SELECT set_config('request.jwt.claim.sub', ${actorId}, true)`;
      await tx`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`;
      await tx`SELECT set_config('role', 'authenticated', true)`;
    }

    // A fresh client whose relationship owner decides who looks after it (Staff or the Manager).
    async function newClient(repo: PostgresCrmRepository, ownerId: string) {
      sequenceNumber += 1;
      return repo.createClient(founderCtx, {
        id: crypto.randomUUID(),
        displayName: `FEE Integration Client ${sequenceNumber}`,
        relationshipOwnerId: ownerId,
        createdAt: '2026-11-13T12:00:00.000Z',
        updatedAt: '2026-11-13T12:00:00.000Z',
      });
    }

    function billCommand(clientId: string, overrides: Record<string, unknown> = {}) {
      sequenceNumber += 1;
      return {
        clientId,
        vyaparBillNumber: `IT-${sequenceNumber}`,
        billDate: '2026-11-01',
        dueDate: '2026-11-30',
        amountPaise: 1000000,
        description: 'Monthly accounting fee',
        idempotencyKey: `it-bill-${crypto.randomUUID()}`,
        ...overrides,
      };
    }

    function paymentCommand(invoiceId: string, amountPaise: number, overrides: Record<string, unknown> = {}) {
      return {
        invoiceId,
        receivedOn: '2026-11-10',
        amountPaise,
        method: 'upi' as const,
        reference: 'UPI-IT',
        idempotencyKey: `it-pay-${crypto.randomUUID()}`,
        ...overrides,
      };
    }

    it('IT-36: the founder records a Vyapar bill as an issued, single-line invoice with totals in paise', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const command = billCommand(client.id, { vyaparBillNumber: 'VYP-IT-36', amountPaise: 1234567 });
        const bill = await repo.recordVyaparBill(founderCtx, command as Parameters<typeof repo.recordVyaparBill>[1]);

        expect(bill).toMatchObject({
          vyaparBillNumber: 'VYP-IT-36',
          clientId: client.id,
          clientCode: client.code,
          status: 'issued',
          issueDate: '2026-11-01',
          dueDate: '2026-11-30',
          subtotalPaise: 1234567,
          taxPaise: 0,
          totalPaise: 1234567,
          amountReceivedPaise: 0,
          balancePaise: 1234567,
          assignmentId: null,
          payments: [],
        });
        expect(bill.issuedAt).toEqual(expect.any(String));
        expect(bill.items).toHaveLength(1);
        expect(bill.items[0]).toMatchObject({
          description: 'Monthly accounting fee',
          quantity: 1,
          unitPricePaise: 1234567,
          taxRatePercent: 0,
          lineTotalPaise: 1234567,
        });

        const listed = (await repo.listInvoices(founderCtx)).find((invoice) => invoice.id === bill.id);
        expect(listed?.vyaparBillNumber).toBe('VYP-IT-36');

        await asServerRole(tx);
        const raw = await tx`SELECT is_demo, created_by, status FROM public.invoices WHERE id = ${bill.id}::uuid`;
        expect(raw[0]).toMatchObject({ is_demo: false, created_by: FOUNDER_ID, status: 'issued' });
        const items = await tx`SELECT is_demo FROM public.invoice_items WHERE invoice_id = ${bill.id}::uuid`;
        expect(items.map((row) => row['is_demo'])).toEqual([false]);
      });
    });

    it('IT-37: a Vyapar number is unique per financial year, case-insensitively, until the bill is cancelled', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const first = await repo.recordVyaparBill(
          founderCtx,
          billCommand(client.id, { vyaparBillNumber: 'VYP-IT-37', billDate: '2026-04-01', dueDate: '2026-05-01' }) as Parameters<typeof repo.recordVyaparBill>[1],
        );

        const duplicate = billCommand(client.id, { vyaparBillNumber: ' vyp-it-37 ', billDate: '2027-03-31', dueDate: '2027-04-30' });
        await expect(repo.recordVyaparBill(founderCtx, duplicate as Parameters<typeof repo.recordVyaparBill>[1])).rejects.toMatchObject({
          status: 409,
          code: 'duplicate_vyapar_bill',
          message: 'Vyapar bill vyp-it-37 is already recorded for 2026–27.',
        });

        // 31 Mar 2026 belongs to the previous financial year, 1 Apr 2027 to the next one
        for (const billDate of ['2026-03-31', '2027-04-01']) {
          await expect(
            repo.recordVyaparBill(founderCtx, billCommand(client.id, { vyaparBillNumber: 'VYP-IT-37', billDate, dueDate: '2027-06-30' }) as Parameters<typeof repo.recordVyaparBill>[1]),
          ).resolves.toMatchObject({ vyaparBillNumber: 'VYP-IT-37', status: 'issued' });
        }

        // The unique index itself backs the pre-check
        await asServerRole(tx);
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.invoices (client_id, issue_date, due_date, vyapar_bill_number, created_by)
              VALUES (${client.id}::uuid, '2026-08-01', '2026-08-31', 'VYP-IT-37', ${FOUNDER_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '23505', constraint_name: 'invoices_vyapar_bill_fy_uidx' });

        await repo.voidInvoice(founderCtx, { id: first.id, reason: 'Entered in error', idempotencyKey: `it-void-${crypto.randomUUID()}` });
        await expect(
          repo.recordVyaparBill(founderCtx, duplicate as Parameters<typeof repo.recordVyaparBill>[1]),
        ).resolves.toMatchObject({ status: 'issued' });
      });
    });

    it('IT-38: Staff who look after the client see its bills and record payments, moving the bill to paid', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const bill = await repo.recordVyaparBill(founderCtx, billCommand(client.id) as Parameters<typeof repo.recordVyaparBill>[1]);

        const seen = (await repo.listInvoices(staffCtx)).find((invoice) => invoice.id === bill.id);
        expect(seen).toMatchObject({ vyaparBillNumber: bill.vyaparBillNumber, status: 'issued', items: expect.any(Array) });
        expect(seen?.items).toHaveLength(1);

        const first = await repo.recordPayment(staffCtx, paymentCommand(bill.id, 400000) as Parameters<typeof repo.recordPayment>[1]);
        expect(first).toMatchObject({
          clientId: client.id,
          status: 'received',
          amountPaise: 400000,
          method: 'upi',
          reference: 'UPI-IT',
          allocatedPaise: 400000,
          unallocatedPaise: 0,
        });
        let current = (await repo.listInvoices(staffCtx)).find((invoice) => invoice.id === bill.id)!;
        expect(current).toMatchObject({ status: 'part_paid', amountReceivedPaise: 400000, balancePaise: 600000 });
        expect((await repo.listPaymentReceipts(staffCtx)).some((receipt) => receipt.id === first.id)).toBe(true);

        await repo.recordPayment(staffCtx, paymentCommand(bill.id, 600000) as Parameters<typeof repo.recordPayment>[1]);
        current = (await repo.listInvoices(staffCtx)).find((invoice) => invoice.id === bill.id)!;
        expect(current).toMatchObject({ status: 'paid', amountReceivedPaise: 1000000, balancePaise: 0 });
        expect(current.payments).toHaveLength(2);

        await asServerRole(tx);
        const raw = await tx`SELECT created_by, is_demo FROM public.payment_receipts WHERE id = ${first.id}::uuid`;
        expect(raw[0]).toMatchObject({ created_by: STAFF_ID, is_demo: false });
        const allocation = await tx`SELECT created_by FROM public.payment_allocations WHERE receipt_id = ${first.id}::uuid`;
        expect(allocation[0]?.['created_by']).toBe(STAFF_ID);
        const invoiceRow = await tx`SELECT amount_received::text AS received FROM public.invoices WHERE id = ${bill.id}::uuid`;
        expect(invoiceRow[0]?.['received']).toBe('10000.00');
      });
    });

    it('IT-39: Staff who do not look after the client see none of its bills and cannot record a payment', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, MANAGER_ID);
        const bill = await repo.recordVyaparBill(founderCtx, billCommand(client.id) as Parameters<typeof repo.recordVyaparBill>[1]);
        const receipt = await repo.recordPayment(founderCtx, paymentCommand(bill.id, 100000) as Parameters<typeof repo.recordPayment>[1]);

        expect((await repo.listInvoices(staffCtx)).some((invoice) => invoice.clientId === client.id)).toBe(false);
        expect((await repo.listPaymentReceipts(staffCtx)).some((item) => item.clientId === client.id)).toBe(false);
        await expect(
          repo.recordPayment(staffCtx, paymentCommand(bill.id, 100000) as Parameters<typeof repo.recordPayment>[1]),
        ).rejects.toMatchObject({ status: 404, message: 'Invoice was not found.' });

        // The database refuses the same write made directly, not only the repository
        await asUser(tx, STAFF_ID);
        expect(await tx`SELECT id FROM public.invoices WHERE client_id = ${client.id}::uuid`).toHaveLength(0);
        expect(await tx`SELECT id FROM public.invoice_items WHERE invoice_id = ${bill.id}::uuid`).toHaveLength(0);
        expect(await tx`SELECT id FROM public.payment_receipts WHERE id = ${receipt.id}::uuid`).toHaveLength(0);
        expect(await tx`SELECT id FROM public.payment_allocations WHERE receipt_id = ${receipt.id}::uuid`).toHaveLength(0);
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.payment_receipts (client_id, received_on, amount, method, created_by)
              VALUES (${client.id}::uuid, '2026-11-10', 10.00, 'cash', ${STAFF_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });

    it('IT-40: Staff cannot insert an invoice, void a receipt, or attach a ledger entry to a receipt', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const bill = await repo.recordVyaparBill(founderCtx, billCommand(client.id) as Parameters<typeof repo.recordVyaparBill>[1]);
        const receipt = await repo.recordPayment(staffCtx, paymentCommand(bill.id, 100000) as Parameters<typeof repo.recordPayment>[1]);

        await asUser(tx, STAFF_ID);
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.invoices (client_id, issue_date, due_date, vyapar_bill_number, created_by)
              VALUES (${client.id}::uuid, '2026-11-01', '2026-11-30', 'STAFF-DIRECT', ${STAFF_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '42501' });

        // Row level security hides the receipt from the update, so nothing changes
        const voided = await tx`
          UPDATE public.payment_receipts SET status = 'voided', void_reason = 'Staff attempt'
          WHERE id = ${receipt.id}::uuid
          RETURNING id`;
        expect(voided).toHaveLength(0);
        const stillReceived = await tx`SELECT status FROM public.payment_receipts WHERE id = ${receipt.id}::uuid`;
        expect(stillReceived[0]?.['status']).toBe('received');

        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.payment_receipts (client_id, received_on, amount, method, ledger_entry_id, created_by)
              VALUES (${client.id}::uuid, '2026-11-10', 10.00, 'cash', ${crypto.randomUUID()}::uuid, ${STAFF_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '42501', message: 'Only the Founder or Manager, or staff looking after this client, may record payments.' });

        // Neither may Staff edit or remove an allocation
        const allocationUpdate = await tx`UPDATE public.payment_allocations SET amount = 1.00 WHERE receipt_id = ${receipt.id}::uuid RETURNING id`;
        expect(allocationUpdate).toHaveLength(0);
        const allocationDelete = await tx`DELETE FROM public.payment_allocations WHERE receipt_id = ${receipt.id}::uuid RETURNING id`;
        expect(allocationDelete).toHaveLength(0);
      });
    });

    it('IT-41: overpayment is refused and cancelling payments and bills follows the rules', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const bill = await repo.recordVyaparBill(founderCtx, billCommand(client.id) as Parameters<typeof repo.recordVyaparBill>[1]);
        const statusOf = async () => (await repo.listInvoices(founderCtx)).find((invoice) => invoice.id === bill.id)!;

        await expect(
          repo.recordPayment(founderCtx, paymentCommand(bill.id, 1000001) as Parameters<typeof repo.recordPayment>[1]),
        ).rejects.toMatchObject({
          status: 422,
          code: 'payment_exceeds_balance',
          message: 'The payment is more than the ₹10,000 still pending on this bill.',
        });

        const one = await repo.recordPayment(founderCtx, paymentCommand(bill.id, 400000) as Parameters<typeof repo.recordPayment>[1]);
        const two = await repo.recordPayment(founderCtx, paymentCommand(bill.id, 600000) as Parameters<typeof repo.recordPayment>[1]);
        expect((await statusOf()).status).toBe('paid');
        await expect(
          repo.recordPayment(founderCtx, paymentCommand(bill.id, 1) as Parameters<typeof repo.recordPayment>[1]),
        ).rejects.toMatchObject({ status: 422, code: 'bill_not_open' });

        await expect(
          repo.voidInvoice(founderCtx, { id: bill.id, reason: 'Entered twice', idempotencyKey: `it-void-${crypto.randomUUID()}` }),
        ).rejects.toMatchObject({ status: 422, code: 'bill_has_payments', message: 'Cancel the payments on this bill first.' });

        const voidedTwo = await repo.voidPaymentReceipt(founderCtx, { id: two.id, reason: 'Cheque bounced', idempotencyKey: `it-void-${crypto.randomUUID()}` });
        expect(voidedTwo).toMatchObject({ status: 'voided', voidReason: 'Cheque bounced' });
        expect(await statusOf()).toMatchObject({ status: 'part_paid', amountReceivedPaise: 400000 });

        await repo.voidPaymentReceipt(founderCtx, { id: one.id, reason: 'Wrong bill', idempotencyKey: `it-void-${crypto.randomUUID()}` });
        expect(await statusOf()).toMatchObject({ status: 'issued', amountReceivedPaise: 0, balancePaise: 1000000 });
        await expect(
          repo.voidPaymentReceipt(founderCtx, { id: one.id, reason: 'Again', idempotencyKey: `it-void-${crypto.randomUUID()}` }),
        ).rejects.toMatchObject({ status: 422, code: 'already_voided' });

        const voidedBill = await repo.voidInvoice(founderCtx, { id: bill.id, reason: 'Entered twice', idempotencyKey: `it-void-${crypto.randomUUID()}` });
        expect(voidedBill).toMatchObject({ status: 'voided', voidReason: 'Entered twice', balancePaise: 0 });
        await expect(
          repo.voidInvoice(founderCtx, { id: bill.id, reason: 'Again', idempotencyKey: `it-void-${crypto.randomUUID()}` }),
        ).rejects.toMatchObject({ status: 422, code: 'already_voided' });
        await expect(
          repo.recordPayment(founderCtx, paymentCommand(bill.id, 100) as Parameters<typeof repo.recordPayment>[1]),
        ).rejects.toMatchObject({ status: 422, code: 'bill_not_open' });

        await asServerRole(tx);
        const raw = await tx`SELECT voided_by FROM public.invoices WHERE id = ${bill.id}::uuid`;
        expect(raw[0]?.['voided_by']).toBe(FOUNDER_ID);
      });
    });

    it('IT-42: an idempotent replay creates no second receipt, and a changed payload on the same key is a 409', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const billKey = `it-bill-${crypto.randomUUID()}`;
        const command = billCommand(client.id, { idempotencyKey: billKey }) as Parameters<typeof repo.recordVyaparBill>[1];
        const bill = await repo.recordVyaparBill(founderCtx, command);
        const billReplay = await repo.recordVyaparBill(founderCtx, command);
        expect(billReplay).toEqual(bill);
        await expect(
          repo.recordVyaparBill(founderCtx, { ...command, amountPaise: 2000000 }),
        ).rejects.toMatchObject({ status: 409, code: 'conflict' });

        const payment = paymentCommand(bill.id, 300000) as Parameters<typeof repo.recordPayment>[1];
        const first = await repo.recordPayment(staffCtx, payment);
        const replay = await repo.recordPayment(staffCtx, payment);
        expect(replay).toEqual(first);
        await expect(
          repo.recordPayment(staffCtx, { ...payment, amountPaise: 300001 }),
        ).rejects.toMatchObject({ status: 409, code: 'conflict' });

        await asServerRole(tx);
        const receipts = await tx`
          SELECT pr.id FROM public.payment_receipts pr
          JOIN public.payment_allocations pa ON pa.receipt_id = pr.id
          WHERE pa.invoice_id = ${bill.id}::uuid`;
        expect(receipts).toHaveLength(1);
        const invoices = await tx`SELECT id FROM public.invoices WHERE client_id = ${client.id}::uuid`;
        expect(invoices).toHaveLength(1);
        const stored = await tx`
          SELECT actor_id, operation_type FROM public.operation_receipts
          WHERE idempotency_key IN (${billKey}, ${payment.idempotencyKey}) ORDER BY operation_type`;
        expect(stored.map((row) => [row['actor_id'], row['operation_type']])).toEqual([
          [STAFF_ID, 'recordPayment'],
          [FOUNDER_ID, 'recordVyaparBill'],
        ]);
      });
    });

    it('IT-43: Senior Staff who review an assignment of the client see its bills; a Trainee sees none', async () => {
      await runIsolatedTest(async (repo) => {
        const client = await newClient(repo, MANAGER_ID);
        const service = (await repo.listServiceReferences(founderCtx))[0]!;
        await repo.createAssignment(founderCtx, {
          id: crypto.randomUUID(),
          clientId: client.id,
          clientName: client.displayName,
          serviceId: service.id,
          service: service.name,
          title: 'Fee visibility fixture',
          ownerId: MANAGER_ID,
          reviewerIds: [SENIOR_ID],
          status: 'assigned',
          dueAt: new Date(Date.now() + 86400000 * 7).toISOString(),
          createdById: FOUNDER_ID,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const bill = await repo.recordVyaparBill(founderCtx, billCommand(client.id) as Parameters<typeof repo.recordVyaparBill>[1]);

        expect((await repo.listInvoices({ actorId: SENIOR_ID })).some((invoice) => invoice.id === bill.id)).toBe(true);
        expect((await repo.listInvoices(staffCtx)).some((invoice) => invoice.id === bill.id)).toBe(false);
        expect(await repo.listInvoices({ actorId: TRAINEE_ID })).toEqual([]);
        expect(await repo.listPaymentReceipts({ actorId: TRAINEE_ID })).toEqual([]);
      });
    });
  });
});
