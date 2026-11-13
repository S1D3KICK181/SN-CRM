import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrmApplication } from './application';
import { maskGstinForRoutineRead, maskPanForRoutineRead } from './client-privacy';
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

    // Full DTO mapping assertion on listClients result (the Founder looks after every client)
    expect(founderClients[0]).toMatchObject({
      pan: 'AABCA1234A',
      gstin: '27AABCA1234A1Z5',
      canEdit: true,
      canChangeOwnerOrStatus: true,
      contacts: [],
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
    expect(traineeAster).toMatchObject({ pan: null, gstin: null, panMasked: '******1234', gstinMasked: '27**********1Z5' });

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
      pan: 'AABCA1234A',
      gstin: '27AABCA1234A1Z5',
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

      // Verify raw database row has plaintext stored securely and is_demo = false (read as the owner role;
      // the authenticated role cannot select pan or gstin)
      await tx`RESET ROLE`;
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
            allocationId: expect.any(String),
            source: 'payment',
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
          { allocationId: expect.any(String), source: 'payment', invoiceId: fixtures.invoiceId, invoiceCode: fixtures.invoiceCode, amountPaise: 300010 },
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

    it('IT-41: cancelling payments and bills follows the rules', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const bill = await repo.recordVyaparBill(founderCtx, billCommand(client.id) as Parameters<typeof repo.recordVyaparBill>[1]);
        const statusOf = async () => (await repo.listInvoices(founderCtx)).find((invoice) => invoice.id === bill.id)!;

        const one = await repo.recordPayment(founderCtx, paymentCommand(bill.id, 400000) as Parameters<typeof repo.recordPayment>[1]);
        const two = await repo.recordPayment(founderCtx, paymentCommand(bill.id, 600000) as Parameters<typeof repo.recordPayment>[1]);
        expect((await statusOf()).status).toBe('paid');
        await expect(
          repo.recordPayment(founderCtx, paymentCommand(bill.id, 1) as Parameters<typeof repo.recordPayment>[1]),
        ).rejects.toMatchObject({ status: 422, code: 'bill_not_open' });

        await expect(
          repo.voidInvoice(founderCtx, { id: bill.id, reason: 'Entered twice', idempotencyKey: `it-void-${crypto.randomUUID()}` }),
        ).rejects.toMatchObject({ status: 422, code: 'bill_has_payments', message: 'Cancel the payments and remove any credit on this bill first.' });

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

    // --- FEE-02a client credit ---

    type BillCommand = Parameters<PostgresCrmRepository['recordVyaparBill']>[1];
    type PaymentCommand = Parameters<PostgresCrmRepository['recordPayment']>[1];
    const asBill = (command: ReturnType<typeof billCommand>) => command as BillCommand;
    const asPayment = (command: ReturnType<typeof paymentCommand>) => command as PaymentCommand;
    const creditKey = () => `it-credit-${crypto.randomUUID()}`;

    it('IT-44: an overpayment keeps the extra as client credit and the allocation source cannot change', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const bill = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 500000 })));
        const receipt = await repo.recordPayment(founderCtx, asPayment(paymentCommand(bill.id, 800000)));

        expect(receipt).toMatchObject({ amountPaise: 800000, allocatedPaise: 500000, unallocatedPaise: 300000, status: 'received' });
        expect(receipt.allocations).toEqual([
          expect.objectContaining({ allocationId: expect.any(String), source: 'payment', invoiceId: bill.id, amountPaise: 500000 }),
        ]);
        const listed = (await repo.listInvoices(founderCtx)).find((invoice) => invoice.id === bill.id)!;
        expect(listed).toMatchObject({ status: 'paid', amountReceivedPaise: 500000, balancePaise: 0 });
        expect(listed.payments[0]).toMatchObject({ allocationId: receipt.allocations[0]!.allocationId, source: 'payment', amountPaise: 500000 });

        // The bill is now paid, so a payment is still refused as before
        await expect(repo.recordPayment(founderCtx, asPayment(paymentCommand(bill.id, 100)))).rejects.toMatchObject({
          status: 422,
          code: 'bill_not_open',
        });

        await asServerRole(tx);
        const allocationId = receipt.allocations[0]!.allocationId;
        await expect(
          tx.savepoint(async (sp) => {
            await sp`UPDATE public.payment_allocations SET source = 'credit' WHERE id = ${allocationId}::uuid`;
          }),
        ).rejects.toMatchObject({ code: '23514', message: 'Allocation source is immutable.' });
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.payment_allocations (receipt_id, invoice_id, amount, source, created_by)
              VALUES (${receipt.id}::uuid, ${bill.id}::uuid, 1.00, 'gift', ${FOUNDER_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '23514' });
      });
    });

    it('IT-45: credit is applied oldest receipt first, partially when it runs short, and then reports none', async () => {
      await runIsolatedTest(async (repo) => {
        const client = await newClient(repo, STAFF_ID);
        const a = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id)));
        const newer = await repo.recordPayment(founderCtx, asPayment(paymentCommand(a.id, 1300000, { receivedOn: '2026-11-05' })));
        const b = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 500000 })));
        const older = await repo.recordPayment(founderCtx, asPayment(paymentCommand(b.id, 700000, { receivedOn: '2026-11-02' })));
        const c = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 400000 })));

        const applied = await repo.applyCredit(founderCtx, { invoiceId: c.id, idempotencyKey: creditKey() });
        expect(applied).toMatchObject({ status: 'paid', amountReceivedPaise: 400000, balancePaise: 0 });
        expect(applied.payments.map((entry) => [entry.receiptCode, entry.amountPaise, entry.source])).toEqual([
          [older.code, 200000, 'credit'],
          [newer.code, 200000, 'credit'],
        ]);
        const receipts = await repo.listPaymentReceipts(founderCtx);
        expect(receipts.find((receipt) => receipt.id === older.id)!.unallocatedPaise).toBe(0);
        expect(receipts.find((receipt) => receipt.id === newer.id)!.unallocatedPaise).toBe(100000);

        // 1,000 of credit remains; a bigger bill uses it all and stays part paid
        const big = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 900000 })));
        const partial = await repo.applyCredit(founderCtx, { invoiceId: big.id, idempotencyKey: creditKey() });
        expect(partial).toMatchObject({ status: 'part_paid', amountReceivedPaise: 100000, balancePaise: 800000 });
        await expect(repo.applyCredit(founderCtx, { invoiceId: big.id, idempotencyKey: creditKey() })).rejects.toMatchObject({
          status: 422,
          code: 'no_credit_available',
          message: 'This client has no credit to use.',
        });
      });
    });

    it('IT-46: a receipt that already allocates to the bill is skipped, and cancelled receipts give no credit', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const client = await newClient(repo, STAFF_ID);
        const bill = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id)));
        // A receipt of 10,000 with 6,000 allocated to the open bill leaves 4,000 of credit on it
        await asServerRole(tx);
        const receiptId = crypto.randomUUID();
        await tx`
          INSERT INTO public.payment_receipts (id, client_id, received_on, amount, method, created_by)
          VALUES (${receiptId}::uuid, ${client.id}::uuid, '2026-11-02', 10000.00, 'cash', ${FOUNDER_ID}::uuid)`;
        await tx`
          INSERT INTO public.payment_allocations (receipt_id, invoice_id, amount, created_by)
          VALUES (${receiptId}::uuid, ${bill.id}::uuid, 6000.00, ${FOUNDER_ID}::uuid)`;
        const before = (await repo.listInvoices(founderCtx)).find((invoice) => invoice.id === bill.id)!;
        expect(before).toMatchObject({ status: 'part_paid', amountReceivedPaise: 600000 });

        await expect(repo.applyCredit(founderCtx, { invoiceId: bill.id, idempotencyKey: creditKey() })).rejects.toMatchObject({
          code: 'no_credit_available',
        });
        // Another bill of the same client can use it
        const other = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 300000 })));
        const used = await repo.applyCredit(founderCtx, { invoiceId: other.id, idempotencyKey: creditKey() });
        expect(used.payments).toEqual([expect.objectContaining({ receiptId, source: 'credit', amountPaise: 300000 })]);

        // Cancelling the receipt removes its credit and puts both bills back to pending
        await repo.voidPaymentReceipt(founderCtx, { id: receiptId, reason: 'Bounced', idempotencyKey: creditKey() });
        const bills = await repo.listInvoices(founderCtx);
        expect(bills.find((invoice) => invoice.id === bill.id)).toMatchObject({ status: 'issued', amountReceivedPaise: 0 });
        expect(bills.find((invoice) => invoice.id === other.id)).toMatchObject({ status: 'issued', amountReceivedPaise: 0 });
        const third = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 100000 })));
        await expect(repo.applyCredit(founderCtx, { invoiceId: third.id, idempotencyKey: creditKey() })).rejects.toMatchObject({
          code: 'no_credit_available',
        });
      });
    });

    it('IT-47: recording a bill can use credit, credit can be removed, and a bill with credit cannot be cancelled', async () => {
      await runIsolatedTest(async (repo) => {
        const client = await newClient(repo, STAFF_ID);
        const a = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 500000 })));
        const receipt = await repo.recordPayment(founderCtx, asPayment(paymentCommand(a.id, 800000)));

        const plain = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 200000 })));
        expect(plain).toMatchObject({ status: 'issued', payments: [] });
        const used = await repo.recordVyaparBill(founderCtx, asBill(billCommand(client.id, { amountPaise: 200000, applyCredit: true })));
        expect(used).toMatchObject({ status: 'paid', amountReceivedPaise: 200000 });
        expect(used.payments[0]).toMatchObject({ source: 'credit', receiptId: receipt.id });

        await expect(
          repo.voidInvoice(founderCtx, { id: used.id, reason: 'Entered twice', idempotencyKey: creditKey() }),
        ).rejects.toMatchObject({
          status: 422,
          code: 'bill_has_payments',
          message: 'Cancel the payments and remove any credit on this bill first.',
        });

        // A direct payment allocation is not credit
        await expect(
          repo.removeCreditAllocation(founderCtx, { allocationId: receipt.allocations[0]!.allocationId, idempotencyKey: creditKey() }),
        ).rejects.toMatchObject({
          status: 422,
          code: 'not_credit_allocation',
          message: 'This is a direct payment. Cancel the payment instead.',
        });
        await expect(
          repo.removeCreditAllocation(founderCtx, { allocationId: crypto.randomUUID(), idempotencyKey: creditKey() }),
        ).rejects.toMatchObject({ status: 404, message: 'Payment allocation was not found.' });

        const removeKey = creditKey();
        const removed = await repo.removeCreditAllocation(founderCtx, { allocationId: used.payments[0]!.allocationId, idempotencyKey: removeKey });
        expect(removed).toMatchObject({ id: used.id, status: 'issued', amountReceivedPaise: 0, payments: [] });
        expect(await repo.removeCreditAllocation(founderCtx, { allocationId: used.payments[0]!.allocationId, idempotencyKey: removeKey })).toEqual(removed);
        const restored = (await repo.listPaymentReceipts(founderCtx)).find((item) => item.id === receipt.id)!;
        expect(restored.unallocatedPaise).toBe(300000);
        await expect(
          repo.voidInvoice(founderCtx, { id: used.id, reason: 'Entered twice', idempotencyKey: creditKey() }),
        ).resolves.toMatchObject({ status: 'voided' });

        // The same key cannot be reused for a different operation
        await expect(
          repo.applyCredit(founderCtx, { invoiceId: plain.id, idempotencyKey: removeKey }),
        ).rejects.toMatchObject({ status: 409, code: 'conflict' });
      });
    });

    it('IT-48: Staff who look after the client can apply credit but cannot remove it; other Staff cannot apply it', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const mine = await newClient(repo, STAFF_ID);
        const a = await repo.recordVyaparBill(founderCtx, asBill(billCommand(mine.id, { amountPaise: 500000 })));
        await repo.recordPayment(founderCtx, asPayment(paymentCommand(a.id, 800000)));
        const b = await repo.recordVyaparBill(founderCtx, asBill(billCommand(mine.id, { amountPaise: 300000 })));

        const applied = await repo.applyCredit(staffCtx, { invoiceId: b.id, idempotencyKey: creditKey() });
        expect(applied).toMatchObject({ status: 'paid', amountReceivedPaise: 300000 });
        const allocationId = applied.payments[0]!.allocationId;

        await expect(
          repo.removeCreditAllocation(staffCtx, { allocationId, idempotencyKey: creditKey() }),
        ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
        await asUser(tx, STAFF_ID);
        const direct = await tx`DELETE FROM public.payment_allocations WHERE id = ${allocationId}::uuid RETURNING id`;
        expect(direct).toHaveLength(0);
        await asServerRole(tx);
        const stillThere = await tx`SELECT source, created_by FROM public.payment_allocations WHERE id = ${allocationId}::uuid`;
        expect(stillThere[0]).toMatchObject({ source: 'credit', created_by: STAFF_ID });

        // Staff who do not look after the client see neither its bills nor its credit
        const theirs = await newClient(repo, MANAGER_ID);
        const c = await repo.recordVyaparBill(founderCtx, asBill(billCommand(theirs.id, { amountPaise: 500000 })));
        await repo.recordPayment(founderCtx, asPayment(paymentCommand(c.id, 800000)));
        const d = await repo.recordVyaparBill(founderCtx, asBill(billCommand(theirs.id, { amountPaise: 300000 })));
        await expect(repo.applyCredit(staffCtx, { invoiceId: d.id, idempotencyKey: creditKey() })).rejects.toMatchObject({
          status: 404,
          message: 'Invoice was not found.',
        });
        // and the database refuses the same allocation written directly
        const receiptRows = await tx`SELECT id FROM public.payment_receipts WHERE client_id = ${theirs.id}::uuid`;
        await asUser(tx, STAFF_ID);
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.payment_allocations (receipt_id, invoice_id, amount, source, created_by)
              VALUES (${String(receiptRows[0]!['id'])}::uuid, ${d.id}::uuid, 100.00, 'credit', ${STAFF_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });

    it('IT-49: two applications of one client credit to different bills in parallel never spend more than the credit', async () => {
      // Needs two real connections, so the fixture is committed on a throwaway demo client and then removed
      const runKey = crypto.randomUUID();
      const startedAt = (await rootClient`SELECT clock_timestamp() AS now`)[0]!['now'] as Date;
      const clientRows = await rootClient`
        INSERT INTO public.clients (display_name, relationship_owner_id, created_by, is_demo)
        VALUES ('FEE-02 Concurrency Client', ${STAFF_ID}::uuid, ${FOUNDER_ID}::uuid, true)
        RETURNING id`;
      const clientId = String(clientRows[0]!['id']);
      const repo = new PostgresCrmRepository(pool);
      try {
        const base = await repo.recordVyaparBill(founderCtx, asBill(billCommand(clientId, { amountPaise: 500000, idempotencyKey: `${runKey}-base` })));
        const receipt = await repo.recordPayment(founderCtx, asPayment(paymentCommand(base.id, 1000000, { idempotencyKey: `${runKey}-pay` })));
        expect(receipt.unallocatedPaise).toBe(500000);
        const first = await repo.recordVyaparBill(founderCtx, asBill(billCommand(clientId, { amountPaise: 400000, idempotencyKey: `${runKey}-b1` })));
        const second = await repo.recordVyaparBill(founderCtx, asBill(billCommand(clientId, { amountPaise: 400000, idempotencyKey: `${runKey}-b2` })));

        const results = await Promise.allSettled([
          new PostgresCrmRepository(pool).applyCredit(founderCtx, { invoiceId: first.id, idempotencyKey: `${runKey}-a1` }),
          new PostgresCrmRepository(pool).applyCredit(founderCtx, { invoiceId: second.id, idempotencyKey: `${runKey}-a2` }),
        ]);
        expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);

        const rows = await rootClient`
          SELECT coalesce(sum(round(amount * 100)), 0)::bigint AS credit_paise, count(*)::int AS allocations
          FROM public.payment_allocations
          WHERE receipt_id = ${receipt.id}::uuid AND source = 'credit'`;
        expect(Number(rows[0]!['credit_paise'])).toBe(500000);
        const total = await rootClient`
          SELECT coalesce(sum(round(amount * 100)), 0)::bigint AS all_paise
          FROM public.payment_allocations WHERE receipt_id = ${receipt.id}::uuid`;
        expect(Number(total[0]!['all_paise'])).toBe(1000000);
        const received = (await repo.listInvoices(founderCtx))
          .filter((invoice) => invoice.id === first.id || invoice.id === second.id)
          .map((invoice) => invoice.amountReceivedPaise)
          .sort((x, y) => x - y);
        expect(received).toEqual([100000, 400000]);
      } finally {
        await rootClient.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claim.sub', ${FOUNDER_ID}, true)`;
          await tx`SELECT set_config('app.demo_cleanup', 'on', true)`;
          await tx`SELECT set_config('app.demo_cleanup_actor', ${FOUNDER_ID}, true)`;
          // Collect this test's own fixture ids first, so the audit cleanup below touches nothing else.
          const fixtureInvoiceIds = (
            await tx`SELECT id::text AS id FROM public.invoices WHERE client_id = ${clientId}::uuid`
          ).map((row) => String(row['id']));
          const fixtureReceiptIds = (
            await tx`SELECT id::text AS id FROM public.payment_receipts WHERE client_id = ${clientId}::uuid`
          ).map((row) => String(row['id']));
          await tx`
            DELETE FROM public.payment_allocations
            WHERE receipt_id IN (SELECT id FROM public.payment_receipts WHERE client_id = ${clientId}::uuid)`;
          await tx`DELETE FROM public.payment_receipts WHERE client_id = ${clientId}::uuid`;
          await tx`DELETE FROM public.invoice_items WHERE invoice_id IN (SELECT id FROM public.invoices WHERE client_id = ${clientId}::uuid)`;
          await tx`DELETE FROM public.invoices WHERE client_id = ${clientId}::uuid`;
          await tx`DELETE FROM public.operation_receipts WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key LIKE ${`${runKey}-%`}`;
          await tx`DELETE FROM public.clients WHERE id = ${clientId}::uuid`;
          await tx`
            DELETE FROM public.audit_log a
            WHERE a.is_demo = true
              AND a.occurred_at >= ${startedAt}
              AND (
                (a.table_name = 'clients' AND a.record_pk = ${clientId})
                OR (a.table_name IN ('invoices', 'payment_receipts')
                    AND coalesce(a.new_row, a.old_row)->>'client_id' = ${clientId})
                OR (a.table_name = 'invoice_items'
                    AND coalesce(a.new_row, a.old_row)->>'invoice_id' = ANY(${fixtureInvoiceIds}::text[]))
                OR (a.table_name = 'payment_allocations'
                    AND coalesce(a.new_row, a.old_row)->>'receipt_id' = ANY(${fixtureReceiptIds}::text[]))
                OR (a.table_name = 'operation_receipts'
                    AND coalesce(a.new_row, a.old_row)->>'idempotency_key' LIKE ${`${runKey}-%`})
              )`;
          await tx`SELECT set_config('app.demo_cleanup', 'off', true)`;
          await tx`SELECT set_config('app.demo_cleanup_actor', '', true)`;
        });
      }
    });
  });

  describe('SVC-01 service list management', () => {
    const founderCtx = { actorId: FOUNDER_ID };
    let serviceSequence = 0;

    function serviceName(label: string) {
      serviceSequence += 1;
      return `SVC Integration ${label} ${serviceSequence}`;
    }

    function key() {
      return `it-svc-${crypto.randomUUID()}`;
    }

    it('IT-50: the founder creates a service, renames it and sets its turnaround and statutory flag', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const name = serviceName('Trademark');
        const created = await repo.createService(founderCtx, {
          name: `  ${name}  `,
          description: 'Registrations and renewals',
          turnaroundDays: 45,
          isStatutory: false,
          idempotencyKey: key(),
        });
        expect(created).toMatchObject({
          name,
          description: 'Registrations and renewals',
          turnaroundDays: 45,
          isStatutory: false,
          isActive: true,
          usage: { assignments: 0, recurringSchedules: 0, engagements: 0 },
        });

        const renamed = await repo.updateService(founderCtx, {
          id: created.id,
          name: `${name} Services`,
          description: null,
          turnaroundDays: 90,
          isStatutory: true,
          expectedUpdatedAt: created.updatedAt,
          idempotencyKey: key(),
        });
        expect(renamed).toMatchObject({
          name: `${name} Services`,
          description: null,
          turnaroundDays: 90,
          isStatutory: true,
          isActive: true,
        });
        expect(Date.parse(renamed.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));

        // Fields the update leaves out are untouched
        const turnaroundOnly = await repo.updateService(founderCtx, {
          id: created.id,
          turnaroundDays: null,
          expectedUpdatedAt: renamed.updatedAt,
          idempotencyKey: key(),
        });
        expect(turnaroundOnly).toMatchObject({ name: `${name} Services`, turnaroundDays: null, isStatutory: true });

        const listed = (await repo.listServiceCatalog(founderCtx)).find((service) => service.id === created.id);
        expect(listed).toEqual(turnaroundOnly);

        await tx`RESET ROLE`;
        const raw = await tx`
          SELECT default_duration_days, is_statutory, is_demo, created_by
          FROM public.service_catalog WHERE id = ${created.id}::uuid`;
        expect(raw[0]).toMatchObject({
          default_duration_days: null,
          is_statutory: true,
          is_demo: false,
          created_by: FOUNDER_ID,
        });
      });
    });

    it('IT-51: names are unique ignoring case and surrounding spaces, in the repository and in the database', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const name = serviceName('Unique');
        const created = await repo.createService(founderCtx, { name, idempotencyKey: key() });

        await expect(
          repo.createService(founderCtx, { name: `  ${name.toUpperCase()} `, idempotencyKey: key() }),
        ).rejects.toMatchObject({
          status: 409,
          code: 'duplicate_service',
          message: `A service named ${name.toUpperCase()} already exists.`,
        });
        await expect(
          repo.createService(founderCtx, { name: 'gst compliance', idempotencyKey: key() }),
        ).rejects.toMatchObject({ status: 409, code: 'duplicate_service' });

        const other = await repo.createService(founderCtx, { name: serviceName('Other'), idempotencyKey: key() });
        await expect(
          repo.updateService(founderCtx, {
            id: other.id,
            name: name.toLowerCase(),
            expectedUpdatedAt: other.updatedAt,
            idempotencyKey: key(),
          }),
        ).rejects.toMatchObject({ status: 409, code: 'duplicate_service' });
        // A service may change the case of its own name
        const recased = await repo.updateService(founderCtx, {
          id: created.id,
          name: name.toUpperCase(),
          expectedUpdatedAt: created.updatedAt,
          idempotencyKey: key(),
        });
        expect(recased.name).toBe(name.toUpperCase());

        // The unique index itself refuses a write that skips the repository check
        await tx`RESET ROLE`;
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.service_catalog (name, created_by)
              VALUES (${`  ${name.toLowerCase()}  `}, ${FOUNDER_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '23505', constraint_name: 'service_catalog_name_normalized_key' });
      });
    });

    it('IT-52: a stale expectedUpdatedAt is refused and an unknown service is not found', async () => {
      await runIsolatedTest(async (repo) => {
        const created = await repo.createService(founderCtx, { name: serviceName('Stale'), idempotencyKey: key() });
        // Postgres keeps one transaction timestamp, so move the stored token to prove a mismatch is caught
        const stale = new Date(Date.parse(created.updatedAt) - 5000).toISOString();
        await expect(
          repo.updateService(founderCtx, { id: created.id, isStatutory: true, expectedUpdatedAt: stale, idempotencyKey: key() }),
        ).rejects.toMatchObject({
          status: 409,
          code: 'stale_service',
          message: 'This service was changed by someone else. Reload and try again.',
        });
        await expect(
          repo.updateService(founderCtx, {
            id: '50000000-0000-4000-a000-999999999999',
            isStatutory: true,
            expectedUpdatedAt: created.updatedAt,
            idempotencyKey: key(),
          }),
        ).rejects.toMatchObject({ status: 404, message: 'Service was not found.' });
        const untouched = (await repo.listServiceCatalog(founderCtx)).find((service) => service.id === created.id);
        expect(untouched?.isStatutory).toBe(false);
      });
    });

    it('IT-53: the same key replays the stored result and a changed payload on that key is refused', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const name = serviceName('Replay');
        const createKey = key();
        const first = await repo.createService(founderCtx, { name, turnaroundDays: 30, idempotencyKey: createKey });
        const replay = await repo.createService(founderCtx, { name, turnaroundDays: 30, idempotencyKey: createKey });
        expect(replay).toEqual(first);
        expect((await repo.listServiceCatalog(founderCtx)).filter((service) => service.name === name)).toHaveLength(1);
        await expect(
          repo.createService(founderCtx, { name, turnaroundDays: 31, idempotencyKey: createKey }),
        ).rejects.toMatchObject({ status: 409, code: 'conflict' });

        const updateKey = key();
        const command = { id: first.id, isStatutory: true, expectedUpdatedAt: first.updatedAt, idempotencyKey: updateKey };
        const updated = await repo.updateService(founderCtx, command);
        // The replay succeeds even though the token is now out of date
        expect(await repo.updateService(founderCtx, command)).toEqual(updated);

        await tx`RESET ROLE`;
        const receipts = await tx`
          SELECT operation_type FROM public.operation_receipts
          WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key IN (${createKey}, ${updateKey})
          ORDER BY operation_type`;
        expect(receipts.map((row) => row['operation_type'])).toEqual(['createService', 'updateService']);
      });
    });

    it('IT-54: a deactivated service leaves the pickers, keeps its name on existing work and can be reactivated', async () => {
      await runIsolatedTest(async (repo) => {
        const client = (await repo.listClientReferences(founderCtx))[0]!;
        const name = serviceName('Deactivate');
        const created = await repo.createService(founderCtx, { name, idempotencyKey: key() });
        const assignmentId = '90000000-0000-4000-a000-0000000000b1';
        await repo.createAssignment(founderCtx, {
          id: assignmentId,
          clientId: client.id,
          clientName: client.name,
          serviceId: created.id,
          service: created.name,
          title: 'Work filed under the new service',
          ownerId: STAFF_ID,
          reviewerIds: [],
          status: 'assigned',
          dueAt: new Date(Date.now() + 86400000 * 7).toISOString(),
          createdById: FOUNDER_ID,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        expect((await repo.listServiceReferences(founderCtx)).map((service) => service.name)).toContain(name);

        const off = await repo.updateService(founderCtx, {
          id: created.id,
          isActive: false,
          expectedUpdatedAt: created.updatedAt,
          idempotencyKey: key(),
        });
        expect(off).toMatchObject({ isActive: false, usage: { assignments: 1, recurringSchedules: 0, engagements: 0 } });
        expect((await repo.listServiceReferences(founderCtx)).map((service) => service.name)).not.toContain(name);
        expect((await repo.listAssignments(founderCtx)).find((assignment) => assignment.id === assignmentId)).toMatchObject({
          serviceId: created.id,
          service: name,
        });
        expect((await repo.listServiceCatalog(founderCtx)).find((service) => service.id === created.id)?.isActive).toBe(false);

        const on = await repo.updateService(founderCtx, {
          id: created.id,
          isActive: true,
          expectedUpdatedAt: off.updatedAt,
          idempotencyKey: key(),
        });
        expect(on.isActive).toBe(true);
        expect((await repo.listServiceReferences(founderCtx)).map((service) => service.name)).toContain(name);
      });
    });

    it('IT-55: the full list shows inactive services last and counts assignments, schedules and engagements', async () => {
      await runIsolatedTest(async (repo) => {
        const created = await repo.createService(founderCtx, { name: serviceName('Aaa Retired'), idempotencyKey: key() });
        await repo.updateService(founderCtx, {
          id: created.id,
          isActive: false,
          expectedUpdatedAt: created.updatedAt,
          idempotencyKey: key(),
        });
        const catalog = await repo.listServiceCatalog(founderCtx);
        expect(catalog.at(-1)).toMatchObject({ id: created.id, isActive: false });
        const activeNames = catalog.filter((service) => service.isActive).map((service) => service.name);
        expect(activeNames).toEqual([...activeNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
        expect(catalog.slice(0, activeNames.length).every((service) => service.isActive)).toBe(true);
        expect(catalog.some((service) => service.usage.assignments > 0)).toBe(true);
      });
    });

    it.each([
      ['manager', MANAGER_ID],
      ['senior_staff', SENIOR_ID],
      ['staff', STAFF_ID],
      ['trainee', TRAINEE_ID],
    ] as const)('IT-56: %s gets 403 on listing, creating and updating services', async (_role, actorId) => {
      await runIsolatedTest(async (repo) => {
        const application = new CrmApplication(repo);
        const actor = await application.requireActor(actorId);
        const denied = { status: 403, message: 'Only the Founder may manage the service list.' };
        await expect(application.listServiceCatalog(actor)).rejects.toMatchObject(denied);
        await expect(application.createService(actor, { name: serviceName('Denied') }, key())).rejects.toMatchObject(denied);
        const target = (await repo.listServiceCatalog(founderCtx))[0]!;
        await expect(
          application.updateService(actor, target.id, { isActive: false, expectedUpdatedAt: target.updatedAt }, key()),
        ).rejects.toMatchObject(denied);
        const unchanged = (await repo.listServiceCatalog(founderCtx)).find((service) => service.id === target.id);
        expect(unchanged?.isActive).toBe(target.isActive);
        // Every role still reads the active services for the pickers
        expect((await application.listServices(actor)).length).toBeGreaterThan(0);
      });
    });
  });

  describe('CLI-02a client master', () => {
    const founderCtx = { actorId: FOUNDER_ID };
    const managerCtx = { actorId: MANAGER_ID };
    const seniorCtx = { actorId: SENIOR_ID };
    const staffCtx = { actorId: STAFF_ID };
    const traineeCtx = { actorId: TRAINEE_ID };
    const ASTER = '10000000-0000-4000-a000-000000000001'; // owner: Manager; Senior reviews its assignment
    const BLUEPEAK = '10000000-0000-4000-a000-000000000002'; // owner: Staff

    function key() {
      return `it-cli-${crypto.randomUUID()}`;
    }

    async function updatedAtOf(repo: PostgresCrmRepository, ctx: { actorId: string }, clientId: string) {
      const client = await repo.getClient(ctx, clientId);
      if (!client) throw new Error('Client not found');
      return client.updatedAt;
    }

    it('IT-57: the founder edits every field and fields left out stay as they were', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const updated = await repo.updateClient(founderCtx, {
          id: ASTER,
          displayName: 'Aster Foods Limited',
          legalName: 'Aster Foods Limited',
          pan: 'AABCA9999Z',
          gstin: '27AABCA9999Z1Z5',
          email: 'tax@asterfoods.local',
          phone: '+91 98200 99999',
          relationshipOwnerId: STAFF_ID,
          status: 'on_hold',
          notes: 'Moved to quarterly review',
          entityType: 'private_limited',
          addressLine1: '12 Marine Drive',
          addressLine2: 'Nariman Point',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400021',
          tan: 'MUMA12345B',
          cinLlpin: 'U12345MH2020PTC123456',
          udyamNumber: 'UDYAM-MH-01-0000001',
          iec: 'ABCDE12345',
          incorporationDate: '2015-04-01',
          expectedUpdatedAt: await updatedAtOf(repo, founderCtx, ASTER),
          idempotencyKey: key(),
        });
        expect(updated).toMatchObject({
          displayName: 'Aster Foods Limited',
          pan: 'AABCA9999Z',
          panMasked: '******9999',
          gstin: '27AABCA9999Z1Z5',
          relationshipOwnerId: STAFF_ID,
          relationshipOwnerName: 'Rohan Mehta',
          status: 'on_hold',
          entityType: 'private_limited',
          addressLine1: '12 Marine Drive',
          state: 'Maharashtra',
          pincode: '400021',
          tan: 'MUMA12345B',
          cinLlpin: 'U12345MH2020PTC123456',
          udyamNumber: 'UDYAM-MH-01-0000001',
          iec: 'ABCDE12345',
          incorporationDate: '2015-04-01',
          canEdit: true,
          canChangeOwnerOrStatus: true,
        });

        // Only the notes change; everything else is left as it was, and null clears a field
        const notesOnly = await repo.updateClient(founderCtx, {
          id: ASTER,
          notes: null,
          tan: null,
          expectedUpdatedAt: updated.updatedAt,
          idempotencyKey: key(),
        });
        expect(notesOnly).toMatchObject({ notes: null, tan: null, city: 'Mumbai', pan: 'AABCA9999Z', status: 'on_hold' });

        await tx`RESET ROLE`;
        const raw = await tx`
          SELECT is_demo, created_by, code, incorporation_date::text AS incorporation_date
          FROM public.clients WHERE id = ${ASTER}::uuid`;
        expect(raw[0]).toMatchObject({
          is_demo: true,
          created_by: FOUNDER_ID,
          code: 'CL-001001',
          incorporation_date: '2015-04-01',
        });
      });
    });

    it('IT-58: the relationship owner edits details but the database refuses an owner or status change', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const application = new CrmApplication(repo);
        const staff = await application.requireActor(STAFF_ID);

        const edited = await repo.updateClient(staffCtx, {
          id: BLUEPEAK,
          email: 'ops@bluepeak.local',
          city: 'Pune',
          state: 'Maharashtra',
          expectedUpdatedAt: await updatedAtOf(repo, staffCtx, BLUEPEAK),
          idempotencyKey: key(),
        });
        expect(edited).toMatchObject({
          email: 'ops@bluepeak.local',
          city: 'Pune',
          canEdit: true,
          canChangeOwnerOrStatus: false,
        });

        // The application says role_not_permitted before touching the database
        await expect(
          application.updateClient(staff, BLUEPEAK, { status: 'archived', expectedUpdatedAt: edited.updatedAt }, key()),
        ).rejects.toMatchObject({ status: 403, code: 'role_not_permitted' });
        await expect(
          application.updateClient(
            staff,
            BLUEPEAK,
            { relationshipOwnerId: SENIOR_ID, expectedUpdatedAt: edited.updatedAt },
            key(),
          ),
        ).rejects.toMatchObject({ status: 403, code: 'role_not_permitted' });

        // A caller that skips the application is stopped by the repository's database trigger
        await expect(
          repo.updateClient(staffCtx, { id: BLUEPEAK, status: 'archived', expectedUpdatedAt: edited.updatedAt, idempotencyKey: key() }),
        ).rejects.toMatchObject({ status: 403 });

        // ...and the trigger itself carries the plain message
        await expect(
          tx.savepoint(async (sp) => {
            await sp`SELECT set_config('request.jwt.claim.sub', ${STAFF_ID}, true)`;
            await sp`SELECT set_config('role', 'authenticated', true)`;
            await sp`UPDATE public.clients SET relationship_owner_id = ${SENIOR_ID}::uuid WHERE id = ${BLUEPEAK}::uuid`;
          }),
        ).rejects.toMatchObject({
          code: '42501',
          message: 'Only the Founder or Manager may change the relationship owner or status.',
        });

        // The owner and status are still as they were
        await tx`RESET ROLE`;
        const raw = await tx`SELECT relationship_owner_id, status FROM public.clients WHERE id = ${BLUEPEAK}::uuid`;
        expect(raw[0]).toMatchObject({ relationship_owner_id: STAFF_ID, status: 'active' });
      });
    });

    it('IT-59: staff who are not the owner get 403, and staff who cannot see the client get 404', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const application = new CrmApplication(repo);
        const edit = { notes: 'Not mine', expectedUpdatedAt: await updatedAtOf(repo, founderCtx, ASTER) };

        // Senior reviews an Aster assignment and the Trainee works on it, so both can see it but not edit it
        await expect(repo.updateClient(seniorCtx, { id: ASTER, ...edit, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 });
        await expect(repo.updateClient(traineeCtx, { id: ASTER, ...edit, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 });
        await expect(
          application.updateClient(await application.requireActor(SENIOR_ID), ASTER, edit, key()),
        ).rejects.toMatchObject({ status: 403, code: 'role_not_permitted' });
        // Staff has no link to Aster at all
        await expect(repo.updateClient(staffCtx, { id: ASTER, ...edit, idempotencyKey: key() })).rejects.toMatchObject({ status: 404 });

        // Row security agrees: a direct update by Senior or Staff changes nothing
        for (const actorId of [SENIOR_ID, STAFF_ID]) {
          const result = await tx.savepoint(async (sp) => {
            await sp`SELECT set_config('request.jwt.claim.sub', ${actorId}, true)`;
            await sp`SELECT set_config('role', 'authenticated', true)`;
            return sp`UPDATE public.clients SET notes = 'sneaky' WHERE id = ${ASTER}::uuid`;
          });
          expect(result.count).toBe(0);
        }
        await tx`RESET ROLE`;
        const raw = await tx`SELECT notes FROM public.clients WHERE id = ${ASTER}::uuid`;
        expect(raw[0]!['notes']).toBeNull();
      });
    });

    it('IT-60: the full PAN and GSTIN reach management and the staff who look after the client, nobody else', async () => {
      await runIsolatedTest(async (repo, tx) => {
        for (const ctx of [founderCtx, managerCtx]) {
          const clients = await repo.listClients(ctx);
          expect(clients).toHaveLength(6);
          expect(clients.every((client) => client.pan !== null && client.gstin !== null)).toBe(true);
        }

        // Senior owns or reviews an assignment of each client it can see
        const seniorClients = await repo.listClients(seniorCtx);
        expect(seniorClients.map((client) => client.code)).toEqual(['CL-001001', 'CL-001003', 'CL-001004', 'CL-001005', 'CL-001006']);
        expect(seniorClients.every((client) => client.pan !== null && client.gstin !== null)).toBe(true);

        // Staff owns CL-001002 and CL-001004
        const staffClients = await repo.listClients(staffCtx);
        expect(staffClients.map((client) => [client.code, client.pan !== null])).toEqual([
          ['CL-001002', true],
          ['CL-001004', true],
        ]);

        // The Trainee sees Aster, but only masked
        const traineeAster = await repo.getClient(traineeCtx, ASTER);
        expect(traineeAster).toMatchObject({ pan: null, gstin: null });
        expect(JSON.stringify(traineeAster)).not.toContain('AABCA1234A');
        expect(JSON.stringify(traineeAster)).not.toContain('27AABCA1234A1Z5');

        // Masked values are identical for every reader
        const founderAster = await repo.getClient(founderCtx, ASTER);
        const seniorAster = await repo.getClient(seniorCtx, ASTER);
        for (const aster of [founderAster, seniorAster]) {
          expect(aster).toMatchObject({ panMasked: traineeAster?.panMasked, gstinMasked: traineeAster?.gstinMasked });
        }
        expect(traineeAster).toMatchObject({ panMasked: '******1234', gstinMasked: '27**********1Z5' });

        // Staff with no link to a client looks after nothing there; fee visibility is the same test
        await tx`RESET ROLE`;
        const unlinked = await tx`SELECT public.user_looks_after_client(${STAFF_ID}::uuid, ${ASTER}::uuid) AS looks_after`;
        expect(unlinked[0]!['looks_after']).toBe(false);
        const parity = await tx`
          SELECT count(*)::int AS mismatches
          FROM public.profiles p
          CROSS JOIN public.clients c
          WHERE public.user_looks_after_client(p.user_id, c.id) IS DISTINCT FROM public.user_fee_visible(p.user_id, c.id)`;
        expect(parity[0]!['mismatches']).toBe(0);
        const trainees = await tx`SELECT public.user_looks_after_client(${TRAINEE_ID}::uuid, ${ASTER}::uuid) AS looks_after`;
        expect(trainees[0]!['looks_after']).toBe(false);
      });
    });

    it('IT-61: invalid identifiers and a GSTIN that does not match the PAN are refused, in the application and in the database', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const application = new CrmApplication(repo);
        const founder = await application.requireActor(FOUNDER_ID);
        const expectedUpdatedAt = await updatedAtOf(repo, founderCtx, ASTER);

        const refusals: [Record<string, string>, string][] = [
          [{ pan: 'ABCDE12345' }, 'Enter a valid 10-character PAN, like ABCDE1234F.'],
          [{ gstin: '27AABCA1234A1Y5' }, 'Enter a valid 15-character GSTIN.'],
          [{ gstin: '27ZZZZZ9999Z1Z5' }, 'The GSTIN does not match the PAN.'],
          [{ tan: 'ABC12345DE' }, 'Enter a valid TAN, like ABCD12345E.'],
          [{ cinLlpin: 'X12345' }, 'Enter a valid CIN or LLPIN.'],
          [{ udyamNumber: 'UDYAM-1-2-3' }, 'Enter a valid Udyam number, like UDYAM-MH-01-0000001.'],
          [{ iec: 'SHORT' }, 'Enter a valid 10-character IEC.'],
          [{ pincode: '012345' }, 'Enter a valid 6-digit PIN code.'],
        ];
        for (const [change, message] of refusals) {
          await expect(
            application.updateClient(founder, ASTER, { ...change, expectedUpdatedAt }, key()),
          ).rejects.toMatchObject({ status: 422, code: 'validation_failed', message });
        }
        expect((await repo.getClient(founderCtx, ASTER))?.updatedAt).toBe(expectedUpdatedAt);

        // The table's own checks refuse bad values from a writer that skips the application
        await tx`RESET ROLE`;
        for (const [column, value, constraint] of [
          ['tan', 'ABC12345DE', 'clients_tan_format'],
          ['pincode', '012345', 'clients_pincode_format'],
          ['iec', 'SHORT', 'clients_iec_format'],
          ['udyam_number', 'UDYAM-1-2-3', 'clients_udyam_number_format'],
          ['cin_llpin', 'X12345', 'clients_cin_llpin_format'],
          ['entity_type', 'company', 'clients_entity_type_check'],
        ] as const) {
          await expect(
            tx.savepoint(async (sp) => {
              await sp`UPDATE public.clients SET ${sp(column)} = ${value} WHERE id = ${ASTER}::uuid`;
            }),
          ).rejects.toMatchObject({ code: '23514', constraint_name: constraint });
        }
      });
    });

    it('IT-62: a stale client or contact edit is refused and an unknown one is not found', async () => {
      await runIsolatedTest(async (repo) => {
        const staleToken = '2020-01-01T00:00:00.000Z';
        await expect(
          repo.updateClient(founderCtx, { id: ASTER, notes: 'late', expectedUpdatedAt: staleToken, idempotencyKey: key() }),
        ).rejects.toMatchObject({
          status: 409,
          code: 'stale_client',
          message: 'This client was changed by someone else. Reload and try again.',
        });
        await expect(
          repo.updateClient(founderCtx, {
            id: '10000000-0000-4000-a000-999999999999',
            notes: 'x',
            expectedUpdatedAt: staleToken,
            idempotencyKey: key(),
          }),
        ).rejects.toMatchObject({ status: 404 });

        const contact = await repo.createClientContact(founderCtx, {
          clientId: ASTER,
          name: 'Priya Nair',
          phone: '98200 44444',
          idempotencyKey: key(),
        });
        await expect(
          repo.updateClientContact(founderCtx, { id: contact.id, notes: 'late', expectedUpdatedAt: staleToken, idempotencyKey: key() }),
        ).rejects.toMatchObject({
          status: 409,
          code: 'stale_contact',
          message: 'This contact was changed by someone else. Reload and try again.',
        });
        await expect(
          repo.updateClientContact(founderCtx, {
            id: '90000000-0000-4000-a000-999999999999',
            notes: 'x',
            expectedUpdatedAt: staleToken,
            idempotencyKey: key(),
          }),
        ).rejects.toMatchObject({ status: 404 });
      });
    });

    it('IT-63: contacts are added, edited and deleted, with one primary per client', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const first = await repo.createClientContact(founderCtx, {
          clientId: ASTER,
          name: 'Zed Khan',
          designation: 'Accountant',
          whatsapp: '98200 11111',
          isPrimary: true,
          idempotencyKey: key(),
        });
        const second = await repo.createClientContact(founderCtx, {
          clientId: ASTER,
          name: 'Amit Shah',
          email: 'amit@asterfoods.local',
          isPrimary: true,
          idempotencyKey: key(),
        });
        expect(first).toMatchObject({ name: 'Zed Khan', designation: 'Accountant', whatsapp: '98200 11111', phone: null });

        // Creating a second primary demoted the first
        let aster = await repo.getClient(founderCtx, ASTER);
        expect(aster?.contacts.map((contact) => [contact.name, contact.isPrimary])).toEqual([
          ['Amit Shah', true],
          ['Zed Khan', false],
        ]);

        // Making the first primary again demotes the second
        const promoted = await repo.updateClientContact(founderCtx, {
          id: first.id,
          isPrimary: true,
          designation: null,
          expectedUpdatedAt: first.updatedAt,
          idempotencyKey: key(),
        });
        expect(promoted).toMatchObject({ isPrimary: true, designation: null, name: 'Zed Khan' });
        aster = await repo.getClient(founderCtx, ASTER);
        expect(aster?.contacts.map((contact) => [contact.name, contact.isPrimary])).toEqual([
          ['Zed Khan', true],
          ['Amit Shah', false],
        ]);

        // The partial unique index and the reach check hold for a writer that skips the repository
        await tx`RESET ROLE`;
        await expect(
          tx.savepoint(async (sp) => {
            await sp`UPDATE public.client_contacts SET is_primary = true WHERE id = ${second.id}::uuid`;
          }),
        ).rejects.toMatchObject({ code: '23505', constraint_name: 'client_contacts_one_primary_idx' });
        await expect(
          tx.savepoint(async (sp) => {
            await sp`
              INSERT INTO public.client_contacts (client_id, name, created_by)
              VALUES (${ASTER}::uuid, 'Nobody Reachable', ${FOUNDER_ID}::uuid)`;
          }),
        ).rejects.toMatchObject({ code: '23514', constraint_name: 'client_contacts_reachable' });

        await repo.deleteClientContact(founderCtx, second.id);
        aster = await repo.getClient(founderCtx, ASTER);
        expect(aster?.contacts.map((contact) => contact.name)).toEqual(['Zed Khan']);
        await expect(repo.deleteClientContact(founderCtx, second.id)).rejects.toMatchObject({ status: 404 });
      });
    });

    it('IT-64: contact changes follow the edit rule: owner may, others who see the client may not, unrelated staff cannot see it', async () => {
      await runIsolatedTest(async (repo) => {
        const own = await repo.createClientContact(staffCtx, {
          clientId: BLUEPEAK,
          name: 'Owner Contact',
          phone: '98200 33333',
          idempotencyKey: key(),
        });
        await repo.updateClientContact(staffCtx, {
          id: own.id,
          designation: 'CFO',
          expectedUpdatedAt: own.updatedAt,
          idempotencyKey: key(),
        });

        const other = await repo.createClientContact(founderCtx, {
          clientId: ASTER,
          name: 'Aster Contact',
          phone: '98200 44444',
          idempotencyKey: key(),
        });
        // Senior and Trainee see the contact, but cannot change anything
        for (const ctx of [seniorCtx, traineeCtx]) {
          expect((await repo.getClient(ctx, ASTER))?.contacts.map((contact) => contact.id)).toEqual([other.id]);
          await expect(
            repo.createClientContact(ctx, { clientId: ASTER, name: 'Nope Nope', phone: '98200 55555', idempotencyKey: key() }),
          ).rejects.toMatchObject({ status: 403 });
          await expect(
            repo.updateClientContact(ctx, { id: other.id, notes: 'x', expectedUpdatedAt: other.updatedAt, idempotencyKey: key() }),
          ).rejects.toMatchObject({ status: 403 });
          await expect(repo.deleteClientContact(ctx, other.id)).rejects.toMatchObject({ status: 403 });
        }
        // Staff has no link to Aster: its contacts do not exist for them
        await expect(repo.getClientIdForContact(staffCtx, other.id)).resolves.toBeNull();
        await expect(repo.deleteClientContact(staffCtx, other.id)).rejects.toMatchObject({ status: 404 });
        await expect(
          repo.createClientContact(staffCtx, { clientId: ASTER, name: 'Nope Nope', phone: '98200 55555', idempotencyKey: key() }),
        ).rejects.toMatchObject({ status: 404 });

        await repo.deleteClientContact(staffCtx, own.id);
        expect((await repo.getClient(staffCtx, BLUEPEAK))?.contacts).toEqual([]);
      });
    });

    it('IT-65: an idempotent replay changes nothing twice, and stored results never hold a full PAN or GSTIN', async () => {
      await runIsolatedTest(async (repo, tx) => {
        const contactKey = key();
        const command = { clientId: ASTER, name: 'Priya Nair', phone: '98200 44444', idempotencyKey: contactKey };
        const created = await repo.createClientContact(founderCtx, command);
        const replay = await repo.createClientContact(founderCtx, command);
        expect(replay).toEqual(created);
        await expect(
          repo.createClientContact(founderCtx, { ...command, name: 'Someone Else' }),
        ).rejects.toMatchObject({ status: 409, code: 'conflict' });
        expect((await repo.getClient(founderCtx, ASTER))?.contacts).toHaveLength(1);

        const editKey = key();
        const edit = {
          id: ASTER,
          notes: 'Once',
          pan: 'AABCA1234A',
          expectedUpdatedAt: await updatedAtOf(repo, founderCtx, ASTER),
          idempotencyKey: editKey,
        };
        const first = await repo.updateClient(founderCtx, edit);
        const second = await repo.updateClient(founderCtx, edit);
        expect(second).toEqual(first);
        await expect(repo.updateClient(founderCtx, { ...edit, notes: 'Twice' })).rejects.toMatchObject({
          status: 409,
          code: 'conflict',
        });

        await tx`RESET ROLE`;
        const receipts = await tx`
          SELECT operation_type, result::text AS result
          FROM public.operation_receipts
          WHERE actor_id = ${FOUNDER_ID}::uuid AND idempotency_key IN (${editKey}, ${contactKey})`;
        expect(receipts).toHaveLength(2);
        const editReceipt = receipts.find((row) => row['operation_type'] === 'updateClient');
        expect(editReceipt?.['result']).not.toMatch(/AABCA1234A|27AABCA1234A1Z5/);
      });
    });

    it('IT-66: contacts inherit is_demo from their client, and removing demo data still works with contacts present', async () => {
      await runIsolatedTest(async (repo, tx) => {
        // Aster is demo data; a client created through the repository is not
        const demoContact = await repo.createClientContact(founderCtx, {
          clientId: ASTER,
          name: 'Demo Contact',
          phone: '98200 66666',
          idempotencyKey: key(),
        });
        const liveClientId = crypto.randomUUID();
        const now = new Date().toISOString();
        await repo.createClient(founderCtx, { id: liveClientId, displayName: 'Live Contact Client', createdAt: now, updatedAt: now });
        const liveContact = await repo.createClientContact(founderCtx, {
          clientId: liveClientId,
          name: 'Live Contact',
          phone: '98200 77777',
          idempotencyKey: key(),
        });

        await tx`RESET ROLE`;
        const flags = await tx`
          SELECT id::text AS id, is_demo FROM public.client_contacts
          WHERE id IN (${demoContact.id}::uuid, ${liveContact.id}::uuid)`;
        expect(flags.find((row) => row['id'] === demoContact.id)?.['is_demo']).toBe(true);
        expect(flags.find((row) => row['id'] === liveContact.id)?.['is_demo']).toBe(false);

        // The flag cannot be changed afterwards
        await expect(
          tx.savepoint(async (sp) => {
            await sp`UPDATE public.client_contacts SET is_demo = false WHERE id = ${demoContact.id}::uuid`;
          }),
        ).rejects.toMatchObject({ code: '23514' });

        await tx`SELECT set_config('request.jwt.claim.sub', ${FOUNDER_ID}, true)`;
        await tx`SELECT set_config('role', 'authenticated', true)`;
        const removal = await tx`SELECT public.remove_demo_data() AS result`;
        expect(removal[0]!['result']).toMatchObject({ ok: true });

        await tx`RESET ROLE`;
        const demoLeft = await tx`SELECT count(*)::int AS c FROM public.client_contacts WHERE id = ${demoContact.id}::uuid`;
        const liveLeft = await tx`SELECT count(*)::int AS c FROM public.client_contacts WHERE id = ${liveContact.id}::uuid`;
        expect(demoLeft[0]!['c']).toBe(0);
        expect(liveLeft[0]!['c']).toBe(1);
        const demoContactsAnywhere = await tx`SELECT count(*)::int AS c FROM public.client_contacts WHERE is_demo = true`;
        expect(demoContactsAnywhere[0]!['c']).toBe(0);
      });
    });

    async function asRole(tx: postgres.TransactionSql, actorId: string) {
      await tx`SELECT set_config('request.jwt.claim.sub', ${actorId}, true)`;
      await tx`SELECT set_config('role', 'authenticated', true)`;
    }

    it('IT-67: the authenticated role cannot select pan or gstin from clients, but can read every other column', async () => {
      await runIsolatedTest(async (_repo, tx) => {
        for (const actorId of [TRAINEE_ID, STAFF_ID, SENIOR_ID, MANAGER_ID, FOUNDER_ID]) {
          for (const column of ['pan', 'gstin']) {
            await expect(
              tx.savepoint(async (sp) => {
                await asRole(sp, actorId);
                await sp`SELECT ${sp(column)} FROM public.clients`;
              }),
            ).rejects.toMatchObject({ code: '42501' });
          }
          await expect(
            tx.savepoint(async (sp) => {
              await asRole(sp, actorId);
              await sp`SELECT * FROM public.clients`;
            }),
          ).rejects.toMatchObject({ code: '42501' });
          await expect(
            tx.savepoint(async (sp) => {
              await asRole(sp, actorId);
              await sp`SELECT code FROM public.clients WHERE pan = 'AABCA1234A'`;
            }),
          ).rejects.toMatchObject({ code: '42501' });

          const rows = await tx.savepoint(async (sp) => {
            await asRole(sp, actorId);
            return sp`SELECT code, display_name, tan, incorporation_date FROM public.clients`;
          });
          expect(rows.length).toBeGreaterThan(0);
        }
      });
    });

    it('IT-68: client_identifiers masks for everyone and reveals the full values only to readers who look after the client', async () => {
      await runIsolatedTest(async (_repo, tx) => {
        async function identifiers(actorId: string, clientId: string) {
          return tx.savepoint(async (sp) => {
            await asRole(sp, actorId);
            return sp`SELECT pan_masked, gstin_masked, pan, gstin FROM public.client_identifiers(${clientId}::uuid)`;
          });
        }

        const masked = { pan_masked: '******1234', gstin_masked: '27**********1Z5' };
        for (const actorId of [FOUNDER_ID, MANAGER_ID, SENIOR_ID]) {
          expect((await identifiers(actorId, ASTER))[0]).toEqual({ ...masked, pan: 'AABCA1234A', gstin: '27AABCA1234A1Z5' });
        }
        // The Trainee can see Aster but looks after nothing
        expect((await identifiers(TRAINEE_ID, ASTER))[0]).toEqual({ ...masked, pan: null, gstin: null });
        // Staff owns BluePeak, so sees the full values there
        expect((await identifiers(STAFF_ID, BLUEPEAK))[0]).toMatchObject({ pan: 'AABCB2345B', gstin: '27AABCB2345B1Z4' });
        // Staff cannot see Aster at all: no row, not even masked
        expect(await identifiers(STAFF_ID, ASTER)).toHaveLength(0);
        expect(await identifiers(TRAINEE_ID, BLUEPEAK)).toHaveLength(0);
        expect(await identifiers(FOUNDER_ID, '10000000-0000-4000-a000-999999999999')).toHaveLength(0);

        // The function is not callable without signing in
        await tx`RESET ROLE`;
        const grants = await tx`
          SELECT has_function_privilege('anon', 'public.client_identifiers(uuid)', 'execute') AS anon_can,
                 has_function_privilege('authenticated', 'public.client_identifiers(uuid)', 'execute') AS auth_can`;
        expect(grants[0]).toEqual({ anon_can: false, auth_can: true });
      });
    });

    it('IT-69: the SQL masking functions give exactly the same results as the TypeScript masking', async () => {
      await runIsolatedTest(async (_repo, tx) => {
        const inputs: (string | null)[] = [
          null,
          '',
          '   ',
          'ABCDE1234F',
          ' abcde1234f ',
          'ABCDE12345',
          'ABCDE1234',
          'not a pan',
          '27ABCDE1234F1Z5',
          '27abcde1234f1z5',
          ' 27ABCDE1234F1Z5 ',
          '27ABCDE1234F1Y5',
          '27ABCDE1234F1Z',
          '2ABCDE1234F1Z5X',
          'x',
        ];
        for (const input of inputs) {
          const row = (
            await tx`SELECT public.mask_pan(${input}::text) AS pan, public.mask_gstin(${input}::text) AS gstin`
          )[0]!;
          expect(row['pan']).toBe(maskPanForRoutineRead(input));
          expect(row['gstin']).toBe(maskGstinForRoutineRead(input));
        }
      });
    });
  });
});
