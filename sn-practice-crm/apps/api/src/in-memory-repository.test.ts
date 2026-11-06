import { describe, expect, it } from 'vitest';
import { createDemoSeed, DEMO_ACTOR_IDS } from './demo-seed';
import { InMemoryCrmRepository } from './in-memory-repository';
import type {
  CreateAssignmentRecord,
  CreateWorkItemRecord,
  RepositoryContext,
  UpdateAssignmentStatusCommand,
  UpdateWorkItemStatusCommand,
} from './repository';

describe('InMemoryCrmRepository Contract, Lookups and Invariants', () => {
  const ctx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };

  it('implements DevActorDirectory with dual lookup (UUID and usr_* aliases)', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const actors = await repository.listDevActors();
    expect(actors.length).toBe(5);

    // Canonical UUID lookups
    const founder = await repository.resolveDevActor(DEMO_ACTOR_IDS.founder);
    expect(founder?.name).toBe('S. Narayanan');
    expect(founder?.role).toBe('founder');

    const manager = await repository.resolveDevActor(DEMO_ACTOR_IDS.manager);
    expect(manager?.name).toBe('Priya Desai');
    expect(manager?.role).toBe('manager');

    // Legacy usr_* aliases
    const aliasFounder = await repository.resolveDevActor('usr_founder');
    expect(aliasFounder?.id).toBe(DEMO_ACTOR_IDS.founder);
    expect(aliasFounder?.name).toBe('S. Narayanan');

    const aliasManager = await repository.resolveDevActor('usr_manager');
    expect(aliasManager?.id).toBe(DEMO_ACTOR_IDS.manager);
    expect(aliasManager?.name).toBe('Priya Desai');

    const aliasSenior = await repository.resolveDevActor('usr_senior');
    expect(aliasSenior?.id).toBe(DEMO_ACTOR_IDS.senior);
    expect(aliasSenior?.name).toBe('Ananya Rao');

    const aliasStaff = await repository.resolveDevActor('usr_staff');
    expect(aliasStaff?.id).toBe(DEMO_ACTOR_IDS.staff);
    expect(aliasStaff?.name).toBe('Rohan Mehta');

    const aliasTrainee = await repository.resolveDevActor('usr_trainee');
    expect(aliasTrainee?.id).toBe(DEMO_ACTOR_IDS.trainee);
    expect(aliasTrainee?.name).toBe('Neha Kapoor');

    const missing = await repository.resolveDevActor('nonexistent');
    expect(missing).toBeNull();
  });

  it('provides repository-backed reference lookups with split service lookups and strict UUID client lookup', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    // Client reference by UUID
    const client = await repository.getClientReference(ctx, '10000000-0000-4000-a000-000000000001');
    expect(client).toEqual({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      name: 'Aster Foods',
    });

    const unknownClient = await repository.getClientReference(ctx, '10000000-0000-4000-a000-999999999999');
    expect(unknownClient).toBeNull();

    const clientList = await repository.listClientReferences(ctx);
    expect(clientList).toHaveLength(6);

    // Split service lookups
    const serviceById = await repository.getServiceReferenceById(ctx, '50000000-0000-4000-a000-000000000001');
    expect(serviceById).toEqual({
      id: '50000000-0000-4000-a000-000000000001',
      name: 'GST Compliance',
    });

    const serviceByName = await repository.getServiceReferenceByName(ctx, 'GST Compliance');
    expect(serviceByName).toEqual({
      id: '50000000-0000-4000-a000-000000000001',
      name: 'GST Compliance',
    });

    const unknownService = await repository.getServiceReferenceById(ctx, '50000000-0000-4000-a000-999999999999');
    expect(unknownService).toBeNull();

    const serviceList = await repository.listServiceReferences(ctx);
    expect(serviceList).toHaveLength(6);
  });

  it('generates sequential collision-proof business codes from max(seed) + 1', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    // 1. Initial createAssignment generates AS-001007
    const newAssignment1: CreateAssignmentRecord = {
      id: '30000000-0000-4000-a000-000000000007',
      clientId: '10000000-0000-4000-a000-000000000001',
      clientName: 'Aster Foods',
      serviceId: '50000000-0000-4000-a000-000000000001',
      service: 'GST Compliance',
      title: 'November GST filing',
      ownerId: DEMO_ACTOR_IDS.manager,
      reviewerIds: [DEMO_ACTOR_IDS.senior],
      status: 'assigned',
      dueAt: '2026-11-20T12:00:00.000Z',
      createdById: DEMO_ACTOR_IDS.founder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created1 = await repository.createAssignment(ctx, newAssignment1);
    expect(created1.code).toBe('AS-001007');
    expect(created1.reviewerIds).toEqual([DEMO_ACTOR_IDS.senior]);

    // 2. Sequential createAssignment generates AS-001008
    const newAssignment2: CreateAssignmentRecord = {
      id: '30000000-0000-4000-a000-000000000008',
      clientId: '10000000-0000-4000-a000-000000000002',
      clientName: 'BluePeak Tech',
      serviceId: '50000000-0000-4000-a000-000000000002',
      service: 'Internal Audit',
      title: 'Q3 Internal Audit',
      ownerId: DEMO_ACTOR_IDS.staff,
      reviewerIds: [DEMO_ACTOR_IDS.manager],
      status: 'assigned',
      dueAt: '2026-12-15T12:00:00.000Z',
      createdById: DEMO_ACTOR_IDS.founder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const created2 = await repository.createAssignment(ctx, newAssignment2);
    expect(created2.code).toBe('AS-001008');

    // 3. createWorkItem generates WI-001007
    const newWorkItem: CreateWorkItemRecord = {
      id: '40000000-0000-4000-a000-000000000007',
      kind: 'delegated',
      title: 'Reconcile invoices',
      assignmentId: '30000000-0000-4000-a000-000000000001',
      relatedClientId: '10000000-0000-4000-a000-000000000001',
      relatedPartyName: 'Aster Foods Private Limited',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      status: 'todo',
      dueAt: '2026-11-10T12:00:00.000Z',
      createdById: DEMO_ACTOR_IDS.manager,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const createdWorkItem = await repository.createWorkItem(ctx, newWorkItem);
    expect(createdWorkItem.code).toBe('WI-001007');
  });

  it('updates assignment status without mutating reviewers and enforces concurrency check', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const assignment = await repository.getAssignment(ctx, '30000000-0000-4000-a000-000000000001');
    expect(assignment).not.toBeNull();
    const originalReviewers = [...assignment!.reviewerIds];
    const originalUpdatedAt = assignment!.updatedAt;

    // Concurrency conflict test (409)
    const conflictCmd: UpdateAssignmentStatusCommand = {
      id: assignment!.id,
      status: 'ready_for_review',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z', // Mismatched timestamp
    };

    await expect(repository.updateAssignmentStatus(ctx, conflictCmd)).rejects.toMatchObject({
      status: 409,
      code: 'concurrency_conflict',
    });

    // Valid update with matching expectedUpdatedAt
    const validCmd: UpdateAssignmentStatusCommand = {
      id: assignment!.id,
      status: 'ready_for_review',
      expectedUpdatedAt: originalUpdatedAt,
      deliveryNotes: 'Ready for partner review',
      progressPercent: 80,
    };

    const updated = await repository.updateAssignmentStatus(ctx, validCmd);
    expect(updated.status).toBe('ready_for_review');
    expect(updated.reviewerIds).toEqual(originalReviewers);
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);

    // Verify independent reviewer update
    const updatedReviewers = await repository.updateAssignmentReviewers(ctx, {
      id: assignment!.id,
      reviewerIds: [DEMO_ACTOR_IDS.founder],
      assignedBy: DEMO_ACTOR_IDS.manager,
    });
    expect(updatedReviewers.reviewerIds).toEqual([DEMO_ACTOR_IDS.founder]);
    expect(updatedReviewers.status).toBe('ready_for_review');
  });

  it('updates work item status and enforces concurrency check', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const workItem = await repository.getWorkItem(ctx, '40000000-0000-4000-a000-000000000001');
    expect(workItem).not.toBeNull();
    const originalUpdatedAt = workItem!.updatedAt;

    const conflictCmd: UpdateWorkItemStatusCommand = {
      id: workItem!.id,
      status: 'ready_for_review',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    };

    await expect(repository.updateWorkItemStatus(ctx, conflictCmd)).rejects.toMatchObject({
      status: 409,
      code: 'concurrency_conflict',
    });

    const validCmd: UpdateWorkItemStatusCommand = {
      id: workItem!.id,
      status: 'ready_for_review',
      expectedUpdatedAt: originalUpdatedAt,
      progressPercent: 90,
    };

    const updated = await repository.updateWorkItemStatus(ctx, validCmd);
    expect(updated.status).toBe('ready_for_review');
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('updates reporting line and deletes row when supervisorId is null', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    // Update supervisor
    const updatedLine = await repository.updateReportingLine(ctx, DEMO_ACTOR_IDS.staff, DEMO_ACTOR_IDS.founder);
    expect(updatedLine.employee.id).toBe(DEMO_ACTOR_IDS.staff);
    expect(updatedLine.manager?.id).toBe(DEMO_ACTOR_IDS.founder);

    const emp = await repository.getEmployee(ctx, DEMO_ACTOR_IDS.staff);
    expect(emp?.reportsToId).toBe(DEMO_ACTOR_IDS.founder);

    // Remove supervisor (null)
    const removedLine = await repository.updateReportingLine(ctx, DEMO_ACTOR_IDS.staff, null);
    expect(removedLine.employee.id).toBe(DEMO_ACTOR_IDS.staff);
    expect(removedLine.manager).toBeNull();

    const empAfter = await repository.getEmployee(ctx, DEMO_ACTOR_IDS.staff);
    expect(empAfter?.reportsToId).toBeNull();
  });
});

describe('Client visibility and read operations (CL-02A parity)', () => {
  const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const managerCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.manager };
  const seniorCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const traineeCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };
  const unknownCtx: RepositoryContext = { actorId: '00000000-0000-4000-a000-999999999999' };

  it('allows Founder and Manager to list all six clients with deterministic ascending code order', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const founderClients = await repository.listClients(founderCtx);
    expect(founderClients).toHaveLength(6);
    expect(founderClients.map((c) => c.code)).toEqual([
      'CL-001001',
      'CL-001002',
      'CL-001003',
      'CL-001004',
      'CL-001005',
      'CL-001006',
    ]);

    const managerClients = await repository.listClients(managerCtx);
    expect(managerClients).toHaveLength(6);
    expect(managerClients.map((c) => c.code)).toEqual(founderClients.map((c) => c.code));
  });

  it('allows Senior Staff to list exactly their five visible clients under the demo seed', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const seniorClients = await repository.listClients(seniorCtx);
    expect(seniorClients.map((c) => c.code)).toEqual([
      'CL-001001', // Aster (reviewer on AS-001001)
      'CL-001003', // Sharma (reviewer on AS-001003)
      'CL-001004', // Kedia (reviewer on AS-001004)
      'CL-001005', // Northstar (relationship owner & owner of AS-001005)
      'CL-001006', // Apex (relationship owner)
    ]);
    expect(seniorClients.find((c) => c.code === 'CL-001002')).toBeUndefined();
  });

  it('allows Staff to list exactly BluePeak and Kedia (two clients where Staff is relationship owner / assignment owner)', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const staffClients = await repository.listClients(staffCtx);
    expect(staffClients.map((c) => c.code)).toEqual([
      'CL-001002', // BluePeak (relationship owner & assignment owner)
      'CL-001004', // Kedia (relationship owner & assignment owner)
    ]);
  });

  it('allows Trainee to list exactly Aster (one client) through delegated work-item assignment involvement', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const traineeClients = await repository.listClients(traineeCtx);
    expect(traineeClients.map((c) => c.code)).toEqual(['CL-001001']);
  });

  it('returns empty list for an unknown actor or an explicitly inactive seeded actor', async () => {
    const seed = createDemoSeed();
    const inactiveManagerId = DEMO_ACTOR_IDS.manager;
    const inactiveManager = seed.employees.find((e) => e.id === inactiveManagerId);
    if (inactiveManager) {
      (inactiveManager as { active: boolean }).active = false;
    }
    const repository = new InMemoryCrmRepository(seed);

    const unknownList = await repository.listClients(unknownCtx);
    expect(unknownList).toEqual([]);
    const unknownClient = await repository.getClient(unknownCtx, '10000000-0000-4000-a000-000000000001');
    expect(unknownClient).toBeNull();

    const inactiveCtx: RepositoryContext = { actorId: inactiveManagerId };
    const inactiveList = await repository.listClients(inactiveCtx);
    expect(inactiveList).toEqual([]);
    const inactiveClient = await repository.getClient(inactiveCtx, '10000000-0000-4000-a000-000000000001');
    expect(inactiveClient).toBeNull();
  });

  it('returns full Aster DTO with Manager relationshipOwnerName and visible active assignments count for Trainee, but null for hidden client', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const aster = await repository.getClient(traineeCtx, '10000000-0000-4000-a000-000000000001');
    expect(aster).not.toBeNull();
    expect(aster).toEqual({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      gstin: '27AABCA1234A1Z5',
      pan: 'AABCA1234A',
      email: 'accounts@asterfoods.local',
      phone: '+91 98200 11001',
      relationshipOwnerId: DEMO_ACTOR_IDS.manager,
      relationshipOwnerName: 'Priya Desai',
      status: 'active',
      notes: null,
      activeAssignmentsCount: 1, // Only AS-001001, which trainee is involved in
      createdById: DEMO_ACTOR_IDS.founder,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const bluePeak = await repository.getClient(traineeCtx, '10000000-0000-4000-a000-000000000002');
    expect(bluePeak).toBeNull();
  });

  it('filters listClientReferences by visibility and active status, and returns displayName', async () => {
    const seed = createDemoSeed();
    // Archive Kedia Holdings (CL-001004) to verify exclusion from listClientReferences while retrievable by ID
    const kedia = seed.clients.find((c) => c.code === 'CL-001004');
    if (kedia) {
      (kedia as { status: string }).status = 'archived';
    }
    const repository = new InMemoryCrmRepository(seed);

    const traineeRefs = await repository.listClientReferences(traineeCtx);
    expect(traineeRefs).toEqual([
      {
        id: '10000000-0000-4000-a000-000000000001',
        code: 'CL-001001',
        name: 'Aster Foods',
      },
    ]);

    // Staff sees only BluePeak in list references because Kedia is archived
    const staffRefs = await repository.listClientReferences(staffCtx);
    expect(staffRefs).toEqual([
      {
        id: '10000000-0000-4000-a000-000000000002',
        code: 'CL-001002',
        name: 'BluePeak Tech',
      },
    ]);

    // Archived Kedia is still retrievable by ID for Staff who has visibility
    const kediaRef = await repository.getClientReference(staffCtx, '10000000-0000-4000-a000-000000000004');
    expect(kediaRef).toEqual({
      id: '10000000-0000-4000-a000-000000000004',
      code: 'CL-001004',
      name: 'Kedia Holdings',
    });

    const asterRef = await repository.getClientReference(traineeCtx, '10000000-0000-4000-a000-000000000001');
    expect(asterRef).toEqual({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      name: 'Aster Foods',
    });

    const hiddenRef = await repository.getClientReference(traineeCtx, '10000000-0000-4000-a000-000000000002');
    expect(hiddenRef).toBeNull();
  });

  it('derives activeAssignmentsCount excluding closed/cancelled assignments and assignments inaccessible to actor', async () => {
    const seed = createDemoSeed();
    // Add a second assignment to Aster Foods that is closed
    seed.assignments.push({
      id: '30000000-0000-4000-a000-000000000099',
      code: 'AS-001099',
      clientId: '10000000-0000-4000-a000-000000000001',
      clientName: 'Aster Foods',
      serviceId: '50000000-0000-4000-a000-000000000001',
      service: 'GST Compliance',
      title: 'Past Closed Assignment',
      ownerId: DEMO_ACTOR_IDS.manager,
      reviewerIds: [DEMO_ACTOR_IDS.senior],
      status: 'closed',
      dueAt: '2026-09-01T12:00:00.000Z',
      recurringScheduleId: null,
      priority: 'normal',
      createdById: DEMO_ACTOR_IDS.founder,
      createdAt: '2026-08-01T04:30:00.000Z',
      updatedAt: '2026-09-02T09:15:00.000Z',
    });
    // Add a third assignment to Aster Foods that is active (in_progress) but trainee is NOT involved in
    seed.assignments.push({
      id: '30000000-0000-4000-a000-000000000098',
      code: 'AS-001098',
      clientId: '10000000-0000-4000-a000-000000000001',
      clientName: 'Aster Foods',
      serviceId: '50000000-0000-4000-a000-000000000001',
      service: 'GST Compliance',
      title: 'Partner-only Active Assignment',
      ownerId: DEMO_ACTOR_IDS.manager,
      reviewerIds: [DEMO_ACTOR_IDS.founder],
      status: 'in_progress',
      dueAt: '2026-11-30T12:00:00.000Z',
      recurringScheduleId: null,
      priority: 'normal',
      createdById: DEMO_ACTOR_IDS.founder,
      createdAt: '2026-10-01T04:30:00.000Z',
      updatedAt: '2026-10-01T04:30:00.000Z',
    });

    const repository = new InMemoryCrmRepository(seed);

    const traineeAster = await repository.getClient(traineeCtx, '10000000-0000-4000-a000-000000000001');
    expect(traineeAster?.activeAssignmentsCount).toBe(1);

    const founderAster = await repository.getClient(founderCtx, '10000000-0000-4000-a000-000000000001');
    expect(founderAster?.activeAssignmentsCount).toBe(2);
  });

  it('grants client visibility via personal work item assigned to actor', async () => {
    const seed = createDemoSeed();
    // Add a personal work item for trainee attached to Sharma Retail (CL-001003)
    seed.workItems.push({
      id: '40000000-0000-4000-a000-000000000099',
      code: 'WI-001099',
      kind: 'personal',
      title: 'Review Sharma Retail file notes',
      notes: null,
      assignmentId: null,
      relatedClientId: '10000000-0000-4000-a000-000000000003',
      relatedPartyName: 'Sharma Retail',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      createdById: DEMO_ACTOR_IDS.trainee,
      status: 'todo',
      dueAt: '2026-11-15T12:00:00.000Z',
      reminderAt: null,
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z',
    });
    const repository = new InMemoryCrmRepository(seed);

    const traineeClients = await repository.listClients(traineeCtx);
    expect(traineeClients.map((c) => c.code)).toEqual([
      'CL-001001', // Aster (via delegated work item)
      'CL-001003', // Sharma (via personal work item)
    ]);
  });
});
