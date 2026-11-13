import { describe, expect, it } from 'vitest';
import { createDemoSeed, DEMO_ACTOR_IDS } from './demo-seed';
import { InMemoryCrmRepository } from './in-memory-repository';
import type {
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  RecordPaymentCommand,
  RecordVyaparBillCommand,
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
    expect(aster).not.toHaveProperty('pan');
    expect(aster).not.toHaveProperty('gstin');
    expect(aster).toEqual({
      id: '10000000-0000-4000-a000-000000000001',
      code: 'CL-001001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      gstinMasked: '27**********1Z5',
      panMasked: '******1234',
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
      description: null,
      ownerId: DEMO_ACTOR_IDS.manager,
      ownerName: 'Priya Sharma',
      reviewerIds: [DEMO_ACTOR_IDS.senior],
      reviewerNames: ['Ananya Rao'],
      status: 'closed',
      progressPercent: 100,
      deliveryNotes: null,
      reviewNotes: null,
      dueAt: '2026-09-01T12:00:00.000Z',
      recurringScheduleId: null,
      engagementId: null,
      engagementCode: null,
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
      description: null,
      ownerId: DEMO_ACTOR_IDS.manager,
      ownerName: 'Priya Sharma',
      reviewerIds: [DEMO_ACTOR_IDS.founder],
      reviewerNames: ['Suresh Narayanan'],
      status: 'in_progress',
      progressPercent: 50,
      deliveryNotes: null,
      reviewNotes: null,
      dueAt: '2026-11-30T12:00:00.000Z',
      recurringScheduleId: null,
      engagementId: null,
      engagementCode: null,
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

  describe('createClient persistence and invariants', () => {
    const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };

    it('persists a new client with auto-generated CL-###### code, relationship owner name, masked identifiers, and actor-derived createdById', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());
      const newClientId = '10000000-0000-4000-a000-000000000099';
      const created = await repository.createClient(founderCtx, {
        id: newClientId,
        displayName: 'Apex Global Enterprises',
        legalName: 'Apex Global Enterprises LLP',
        pan: 'ABCDE1234F',
        gstin: '27ABCDE1234F1Z5',
        email: 'info@apexglobal.in',
        phone: '9876543210',
        relationshipOwnerId: DEMO_ACTOR_IDS.manager,
        notes: 'Priority tax account',
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      });

      expect(created.id).toBe(newClientId);
      expect(created.code).toMatch(/^CL-\d{6}$/);
      expect(created.displayName).toBe('Apex Global Enterprises');
      expect(created.legalName).toBe('Apex Global Enterprises LLP');
      expect(created.panMasked).toBe('******1234');
      expect(created.gstinMasked).toBe('27**********1Z5');
      expect(created.relationshipOwnerId).toBe(DEMO_ACTOR_IDS.manager);
      expect(created.relationshipOwnerName).toBe('Priya Desai');
      expect(created.status).toBe('active');
      expect(created.activeAssignmentsCount).toBe(0);
      expect(created.createdById).toBe(DEMO_ACTOR_IDS.founder);

      // Subsequent getClient verifies visibility and persistence
      const fetched = await repository.getClient(founderCtx, newClientId);
      expect(fetched).toEqual(created);

      // Verify that createdById is strictly derived from actorId, e.g. for manager
      const managerClientId = '10000000-0000-4000-a000-000000000096';
      const managerCreated = await repository.createClient(managerCtx, {
        id: managerClientId,
        displayName: 'Manager Created Client',
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      });
      expect(managerCreated.createdById).toBe(DEMO_ACTOR_IDS.manager);
    });

    it('denies creation for non-management actors with 403 forbidden', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());
      const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };

      await expect(
        repository.createClient(staffCtx, {
          id: '10000000-0000-4000-a000-000000000098',
          displayName: 'Unauthorized Client',
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 403,
        code: 'forbidden',
      });
    });

    it('rejects duplicate client ID with 409 conflict', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());
      const existingId = '10000000-0000-4000-a000-000000000001'; // Aster Foods

      await expect(
        repository.createClient(founderCtx, {
          id: existingId,
          displayName: 'Duplicate Client Name',
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'conflict',
      });
    });

    it('rejects nonexistent relationship owner with 422 referenced_entity_not_found', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      await expect(
        repository.createClient(founderCtx, {
          id: '10000000-0000-4000-a000-000000000097',
          displayName: 'Client With Ghost Owner',
          relationshipOwnerId: '00000000-0000-4000-a000-999999999999',
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'referenced_entity_not_found',
      });
    });

    it('rejects trainee relationship owner with 422 validation_failed', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      await expect(
        repository.createClient(founderCtx, {
          id: '10000000-0000-4000-a000-000000000095',
          displayName: 'Client With Trainee Owner',
          relationshipOwnerId: DEMO_ACTOR_IDS.trainee,
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'validation_failed',
        message: 'A Client relationship owner must be active and cannot be a Trainee.',
      });
    });

    it('rejects inactive relationship owner with 422 validation_failed', async () => {
      const seed = createDemoSeed();
      const staffEmp = seed.employees.find((e) => e.id === DEMO_ACTOR_IDS.staff);
      if (staffEmp) {
        (staffEmp as { active: boolean }).active = false;
      }
      const repository = new InMemoryCrmRepository(seed);

      await expect(
        repository.createClient(founderCtx, {
          id: '10000000-0000-4000-a000-000000000094',
          displayName: 'Client With Inactive Owner',
          relationshipOwnerId: DEMO_ACTOR_IDS.staff,
          createdAt: '2026-11-06T12:00:00.000Z',
          updatedAt: '2026-11-06T12:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'validation_failed',
        message: 'A Client relationship owner must be active and cannot be a Trainee.',
      });
    });

    it('allows senior_staff or staff relationship owner', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      const seniorClient = await repository.createClient(founderCtx, {
        id: '10000000-0000-4000-a000-000000000093',
        displayName: 'Client With Senior Staff Owner',
        relationshipOwnerId: DEMO_ACTOR_IDS.senior,
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      });
      expect(seniorClient.relationshipOwnerId).toBe(DEMO_ACTOR_IDS.senior);

      const staffClient = await repository.createClient(founderCtx, {
        id: '10000000-0000-4000-a000-000000000092',
        displayName: 'Client With Staff Owner',
        relationshipOwnerId: DEMO_ACTOR_IDS.staff,
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      });
      expect(staffClient.relationshipOwnerId).toBe(DEMO_ACTOR_IDS.staff);
    });
  });

  describe('AS-01-R2 Description round-trip & Service Resolution', () => {
    const testCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };

    it('round-trips description create, read, and clearing to null', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      const created = await repository.createAssignment(testCtx, {
        id: '30000000-0000-4000-a000-000000000099',
        clientId: '10000000-0000-4000-a000-000000000001',
        clientName: 'Aster Foods',
        serviceId: '50000000-0000-4000-a000-000000000001',
        service: 'GST Compliance',
        title: 'GST Deliverable With Description',
        description: 'Comprehensive annual GST return audit',
        ownerId: DEMO_ACTOR_IDS.manager,
        reviewerIds: [DEMO_ACTOR_IDS.founder],
        status: 'assigned',
        dueAt: '2026-11-20T12:00:00.000Z',
        createdById: DEMO_ACTOR_IDS.founder,
        createdAt: '2026-11-10T10:00:00.000Z',
        updatedAt: '2026-11-10T10:00:00.000Z',
      });

      expect(created.description).toBe('Comprehensive annual GST return audit');

      const read = await repository.getAssignment(testCtx, '30000000-0000-4000-a000-000000000099');
      expect(read?.description).toBe('Comprehensive annual GST return audit');

      // Update clearing description to null
      const updated = await repository.updateAssignment(testCtx, {
        id: '30000000-0000-4000-a000-000000000099',
        actorId: testCtx.actorId,
        expectedUpdatedAt: read!.updatedAt,
        description: null,
      });

      expect(updated.description).toBeNull();

      const readAfterClear = await repository.getAssignment(testCtx, '30000000-0000-4000-a000-000000000099');
      expect(readAfterClear?.description).toBeNull();
    });

    it('rejects recurring schedule creation with unknown service reference with 422', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      await expect(
        repository.createRecurringSchedule(testCtx, {
          id: '40000000-0000-4000-a000-000000000099',
          clientId: '10000000-0000-4000-a000-000000000001',
          clientName: 'Aster Foods',
          service: 'Completely Unknown Service Never Cataloged',
          title: 'Unknown Service Schedule',
          cadence: 'monthly',
          ownerId: DEMO_ACTOR_IDS.manager,
          reviewerIds: [],
          dueDay: 11,
          nextOccurrenceOn: '2026-12-01',
          createdById: DEMO_ACTOR_IDS.founder,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'referenced_entity_not_found',
      });
    });
  });

  describe('ENG-01-A2a Engagement Repository Invariants & Lifecycle Mutations', () => {
    const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
    const managerCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.manager };
    const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };

    const validClientId = '10000000-0000-4000-a000-000000000001';
    const validServiceId = '50000000-0000-4000-a000-000000000001';

    it('executes complete happy lifecycle: createDraft -> reviseDraft -> activate -> amend -> end', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      // 1. createDraft
      const created = await repository.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: 'eng-create-1',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Statutory Audit FY 2026-27',
        scope: 'Complete year-end audit of accounts and financial disclosures',
        exclusions: 'Direct tax assessment representation',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 25000000,
        billingTerms: '50% advance, 50% on deliverable',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      });

      expect(created.status).toBe('draft');
      expect(created.code).toMatch(/^ENG-\d{6}$/);
      expect(created.approvedVersionId).toBeNull();
      expect(created.approvedVersion).toBeNull();
      expect(created.approvedAt).toBeNull();
      expect(created.approvedById).toBeNull();
      expect(created.endedAt).toBeNull();
      expect(created.endedById).toBeNull();
      expect(created.endOutcome).toBeNull();
      expect(created.endReason).toBeNull();

      // List versions shows v1
      const versionsAfterCreate = await repository.listEngagementVersions(founderCtx, created.id);
      expect(versionsAfterCreate).toHaveLength(1);
      const v1 = versionsAfterCreate[0]!;
      expect(v1.versionNumber).toBe(1);
      expect(v1.title).toBe('Statutory Audit FY 2026-27');
      expect(v1.responsiblePartnerId).toBe(DEMO_ACTOR_IDS.founder);
      expect(v1.responsiblePartnerName).toBe('S. Narayanan');
      expect(v1.deliveryManagerId).toBe(DEMO_ACTOR_IDS.manager);
      expect(v1.deliveryManagerName).toBe('Priya Desai');
      expect(v1.approvedAt).toBeNull();

      // 2. reviseDraft
      const revised = await repository.mutateEngagement(managerCtx, {
        kind: 'reviseDraft',
        idempotencyKey: 'eng-revise-1',
        engagementId: created.id,
        title: 'Statutory Audit FY 2026-27 (Revised Scope)',
        scope: 'Expanded scope including branch audits',
        exclusions: null,
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 30000000,
        billingTerms: '100% on deliverable',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        expectedUpdatedAt: created.updatedAt,
      });

      expect(revised.status).toBe('draft');
      expect(revised.approvedVersionId).toBeNull();
      expect(revised.approvedVersion).toBeNull();

      const versionsAfterRevise = await repository.listEngagementVersions(founderCtx, created.id);
      expect(versionsAfterRevise).toHaveLength(1);
      expect(versionsAfterRevise[0]!.versionNumber).toBe(1);
      expect(versionsAfterRevise[0]!.title).toBe('Statutory Audit FY 2026-27 (Revised Scope)');
      expect(versionsAfterRevise[0]!.agreedFeePaise).toBe(30000000);

      // 3. activate
      const activated = await repository.mutateEngagement(founderCtx, {
        kind: 'activate',
        idempotencyKey: 'eng-activate-1',
        engagementId: created.id,
        versionId: v1.id,
        expectedUpdatedAt: revised.updatedAt,
      });

      expect(activated.status).toBe('active');
      expect(activated.approvedVersionId).toBe(v1.id);
      expect(activated.approvedVersion?.id).toBe(v1.id);
      expect(activated.approvedVersion?.versionNumber).toBe(1);
      expect(activated.approvedAt).not.toBeNull();
      expect(activated.approvedById).toBe(DEMO_ACTOR_IDS.founder);

      // 4. amend
      const amended = await repository.mutateEngagement(founderCtx, {
        kind: 'amend',
        idempotencyKey: 'eng-amend-1',
        engagementId: created.id,
        title: 'Statutory Audit FY 2026-27 (Amendment 1)',
        scope: 'Quarterly review additions',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'recurring',
        agreedFeePaise: 35000000,
        billingTerms: 'Quarterly arrears',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        expectedUpdatedAt: activated.updatedAt,
      });

      expect(amended.status).toBe('active');
      expect(amended.approvedVersion?.versionNumber).toBe(2);
      expect(amended.approvedVersion?.feeModel).toBe('recurring');
      expect(amended.approvedVersion?.agreedFeePaise).toBe(35000000);

      const versionsAfterAmend = await repository.listEngagementVersions(founderCtx, created.id);
      expect(versionsAfterAmend).toHaveLength(2);
      expect(versionsAfterAmend.map((v) => v.versionNumber)).toEqual([1, 2]);

      // 5. end
      const ended = await repository.mutateEngagement(founderCtx, {
        kind: 'end',
        idempotencyKey: 'eng-end-1',
        engagementId: created.id,
        outcome: 'completed',
        reason: 'Statutory audit concluded successfully with unqualified audit opinion.',
        expectedUpdatedAt: amended.updatedAt,
      });

      expect(ended.status).toBe('ended');
      expect(ended.endOutcome).toBe('completed');
      expect(ended.endReason).toBe('Statutory audit concluded successfully with unqualified audit opinion.');
      expect(ended.endedAt).not.toBeNull();
      expect(ended.endedById).toBe(DEMO_ACTOR_IDS.founder);
      expect(ended.approvedVersionId).toBe(amended.approvedVersionId);
    });

    it('enforces that draft approvedVersion remains null while listEngagementVersions returns draft v1', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      const draft = await repository.mutateEngagement(managerCtx, {
        kind: 'createDraft',
        idempotencyKey: 'draft-null-check-key',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Draft Terms Test',
        scope: 'Draft terms scope testing',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 10000000,
        billingTerms: 'Net 30',
        startDate: '2026-05-01',
      });

      expect(draft.status).toBe('draft');
      expect(draft.approvedVersionId).toBeNull();
      expect(draft.approvedVersion).toBeNull();

      const read = await repository.getEngagement(founderCtx, draft.id);
      expect(read?.approvedVersionId).toBeNull();
      expect(read?.approvedVersion).toBeNull();

      const versions = await repository.listEngagementVersions(founderCtx, draft.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]!.versionNumber).toBe(1);
      expect(versions[0]!.approvedAt).toBeNull();
    });

    it('rejects stale expectedUpdatedAt with optimistic_lock_conflict (409)', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      const created = await repository.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: 'stale-test-create',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Concurrency Test',
        scope: 'Testing concurrency timestamp check',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 5000000,
        billingTerms: 'Immediate',
        startDate: '2026-06-01',
      });

      const versions = await repository.listEngagementVersions(founderCtx, created.id);
      const v1Id = versions[0]!.id;

      await expect(
        repository.mutateEngagement(founderCtx, {
          kind: 'activate',
          idempotencyKey: 'stale-test-activate',
          engagementId: created.id,
          versionId: v1Id,
          expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'optimistic_lock_conflict',
      });
    });

    it('rejects invalid state transitions and non-management actors with 403 / 422', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      // Staff cannot mutate engagements
      await expect(
        repository.mutateEngagement(staffCtx, {
          kind: 'createDraft',
          idempotencyKey: 'staff-attempt',
          clientId: validClientId,
          serviceId: validServiceId,
          title: 'Unauthorized Draft',
          scope: 'Scope',
          responsiblePartnerId: DEMO_ACTOR_IDS.founder,
          deliveryManagerId: DEMO_ACTOR_IDS.manager,
          feeModel: 'fixed',
          agreedFeePaise: 1000000,
          billingTerms: 'Terms',
          startDate: '2026-07-01',
        }),
      ).rejects.toMatchObject({
        status: 403,
        code: 'forbidden',
      });

      // Manager cannot activate (Founder sole authority)
      const draft = await repository.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: 'founder-draft-transition-test',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Transition Test Draft',
        scope: 'Scope',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 1000000,
        billingTerms: 'Terms',
        startDate: '2026-07-01',
      });

      const versions = await repository.listEngagementVersions(founderCtx, draft.id);

      await expect(
        repository.mutateEngagement(managerCtx, {
          kind: 'activate',
          idempotencyKey: 'manager-activate-attempt',
          engagementId: draft.id,
          versionId: versions[0]!.id,
          expectedUpdatedAt: draft.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 403,
        code: 'forbidden',
      });

      // Cannot amend a draft engagement
      await expect(
        repository.mutateEngagement(founderCtx, {
          kind: 'amend',
          idempotencyKey: 'amend-draft-attempt',
          engagementId: draft.id,
          title: 'Premature Amendment',
          scope: 'Scope',
          responsiblePartnerId: DEMO_ACTOR_IDS.founder,
          deliveryManagerId: DEMO_ACTOR_IDS.manager,
          feeModel: 'fixed',
          agreedFeePaise: 2000000,
          billingTerms: 'Terms',
          startDate: '2026-07-01',
          expectedUpdatedAt: draft.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: 'validation_failed',
      });
    });

    it('returns stored original DTO on identical replay; rejects mismatched payload with conflict (409)', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      const payload = {
        kind: 'createDraft' as const,
        idempotencyKey: 'idemp-replay-key-1',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Idempotency Replay Test',
        scope: 'Idempotency test scope',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed' as const,
        agreedFeePaise: 12000000,
        billingTerms: 'Monthly',
        startDate: '2026-08-01',
      };

      const original = await repository.mutateEngagement(founderCtx, payload);
      expect(original.code).toBeDefined();

      // Identical replay with same actor and key returns identical original DTO
      const replay = await repository.mutateEngagement(founderCtx, payload);
      expect(replay).toEqual(original);

      // Replay with same key but different payload throws 409 conflict
      await expect(
        repository.mutateEngagement(founderCtx, {
          ...payload,
          agreedFeePaise: 99999999, // Mismatched fee
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'conflict',
      });

      // Replay with same key but different operation throws 409 conflict
      await expect(
        repository.mutateEngagement(founderCtx, {
          kind: 'end',
          idempotencyKey: 'idemp-replay-key-1',
          engagementId: original.id,
          outcome: 'terminated',
          reason: 'Different operation',
          expectedUpdatedAt: original.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'conflict',
      });
    });

    it('prevents duplicate versions and collision-proof codes', async () => {
      const repository = new InMemoryCrmRepository(createDemoSeed());

      const e1 = await repository.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: 'coll-test-1',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Code Collision Test 1',
        scope: 'Scope 1',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 5000000,
        billingTerms: 'Terms',
        startDate: '2026-09-01',
      });

      const e2 = await repository.mutateEngagement(founderCtx, {
        kind: 'createDraft',
        idempotencyKey: 'coll-test-2',
        clientId: validClientId,
        serviceId: validServiceId,
        title: 'Code Collision Test 2',
        scope: 'Scope 2',
        responsiblePartnerId: DEMO_ACTOR_IDS.founder,
        deliveryManagerId: DEMO_ACTOR_IDS.manager,
        feeModel: 'fixed',
        agreedFeePaise: 6000000,
        billingTerms: 'Terms',
        startDate: '2026-09-01',
      });

      expect(e1.code).not.toBe(e2.code);
      expect(e1.id).not.toBe(e2.id);
    });
  });
});

describe('InMemoryCrmRepository billing reads (BIL-01a)', () => {
  const ctx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const now = new Date('2026-11-13T12:00:00.000Z');
  const build = () => new InMemoryCrmRepository(createDemoSeed(now), { now: () => now });

  it('lists invoices newest issue date first with client, assignment and line detail', async () => {
    const invoices = await build().listInvoices(ctx);
    expect(invoices.map((invoice) => invoice.code)).toEqual(['INV-0001004', 'INV-0001002', 'INV-0001003', 'INV-0001001']);
    const draft = invoices[0]!;
    expect(draft).toMatchObject({
      status: 'draft',
      clientCode: 'CL-001002',
      clientName: 'BluePeak Tech',
      assignmentCode: 'AS-001002',
      totalPaise: 4720000,
      balancePaise: 0,
      daysOverdue: 0,
    });
    expect(draft.items).toHaveLength(1);
  });

  it('computes balance and days overdue by status in Asia/Kolkata time', async () => {
    const invoices = await build().listInvoices(ctx);
    const byCode = Object.fromEntries(invoices.map((invoice) => [invoice.code, invoice]));
    expect(byCode['INV-0001003']).toMatchObject({ status: 'issued', totalPaise: 1770000, amountReceivedPaise: 0, balancePaise: 1770000, daysOverdue: 18 });
    expect(byCode['INV-0001002']).toMatchObject({ status: 'part_paid', amountReceivedPaise: 1650000, daysOverdue: 0 });
    expect(byCode['INV-0001002']!.balancePaise).toBe(byCode['INV-0001002']!.totalPaise - 1650000);
    expect(byCode['INV-0001001']).toMatchObject({ status: 'paid', balancePaise: 0, daysOverdue: 0 });
  });

  it('uses the Kolkata calendar day, not the UTC day, for overdue maths', async () => {
    // 19:00 UTC on 13 Nov is already 14 Nov 00:30 in Kolkata, so the invoice is one day more overdue.
    const lateUtc = new Date('2026-11-13T19:00:00.000Z');
    const repository = new InMemoryCrmRepository(createDemoSeed(now), { now: () => lateUtc });
    const overdue = (await repository.listInvoices(ctx)).find((invoice) => invoice.code === 'INV-0001003');
    expect(overdue?.daysOverdue).toBe(19);
  });

  it('orders payments by received date and links them to receipts', async () => {
    const invoices = await build().listInvoices(ctx);
    const partPaid = invoices.find((invoice) => invoice.code === 'INV-0001002')!;
    expect(partPaid.payments.map((payment) => payment.receiptCode)).toEqual(['RCT-0001001', 'RCT-0001002']);
    expect(partPaid.payments.map((payment) => payment.amountPaise)).toEqual([1050000, 600000]);
    expect(partPaid.payments.every((payment) => payment.receiptStatus === 'received')).toBe(true);
  });

  it('lists receipts newest first with allocations and unallocated amounts', async () => {
    const receipts = await build().listPaymentReceipts(ctx);
    expect(receipts.map((receipt) => receipt.code)).toEqual(['RCT-0001002', 'RCT-0001001']);
    expect(receipts[0]).toMatchObject({ amountPaise: 1000000, allocatedPaise: 600000, unallocatedPaise: 400000, method: 'upi' });
    expect(receipts[1]!.allocations.map((allocation) => allocation.invoiceCode)).toEqual(['INV-0001001', 'INV-0001002']);
    expect(receipts[1]).toMatchObject({ allocatedPaise: 4000000, unallocatedPaise: 0, clientCode: 'CL-001001' });
  });
});

describe('InMemoryCrmRepository Vyapar bills and payments (FEE-01a)', () => {
  const founder: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const manager: RepositoryContext = { actorId: DEMO_ACTOR_IDS.manager };
  const senior: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staff: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const trainee: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };
  const now = new Date('2026-11-13T12:00:00.000Z');
  const build = () => new InMemoryCrmRepository(createDemoSeed(now), { now: () => now });
  // Client 2 is looked after by Staff (relationship owner and assignment owner); client 1 is not.
  const CLIENT_1 = '10000000-0000-4000-a000-000000000001';
  const CLIENT_2 = '10000000-0000-4000-a000-000000000002';
  const bill = (overrides: Partial<RecordVyaparBillCommand> = {}): RecordVyaparBillCommand => ({
    clientId: CLIENT_2,
    vyaparBillNumber: 'VYP-300',
    billDate: '2026-11-01',
    dueDate: '2026-11-30',
    amountPaise: 500000,
    description: 'Retainer fee',
    idempotencyKey: 'bill-1',
    ...overrides,
  });
  const payment = (invoiceId: string, overrides: Partial<RecordPaymentCommand> = {}): RecordPaymentCommand => ({
    invoiceId,
    receivedOn: '2026-11-10',
    amountPaise: 200000,
    method: 'upi',
    idempotencyKey: 'pay-1',
    ...overrides,
  });

  it('gives the demo bills Vyapar numbers and leaves the draft without one', async () => {
    const invoices = await build().listInvoices(founder);
    const byCode = Object.fromEntries(invoices.map((invoice) => [invoice.code, invoice.vyaparBillNumber]));
    expect(byCode).toEqual({
      'INV-0001001': 'VYP-118',
      'INV-0001002': 'VYP-124',
      'INV-0001003': 'VYP-131',
      'INV-0001004': null,
    });
  });

  it('numbers new bills and receipts after the existing codes and stores the bill issued', async () => {
    const repository = build();
    const created = await repository.recordVyaparBill(founder, bill());
    expect(created).toMatchObject({ code: 'INV-0001005', status: 'issued', vyaparBillNumber: 'VYP-300', totalPaise: 500000 });
    expect(created.issuedAt).toBe(now.toISOString());
    const receipt = await repository.recordPayment(founder, payment(created.id));
    expect(receipt.code).toBe('RCT-0001003');
  });

  it('shows Staff only the bills and payments of clients they look after', async () => {
    const repository = build();
    expect((await repository.listInvoices(staff)).map((invoice) => invoice.clientId)).toEqual([CLIENT_2]);
    expect(await repository.listPaymentReceipts(staff)).toEqual([]);
    expect(await repository.listInvoices(trainee)).toEqual([]);
    expect((await repository.listInvoices(senior)).map((invoice) => invoice.code).sort()).toEqual([
      'INV-0001001',
      'INV-0001002',
      'INV-0001003',
    ]);
    expect(await repository.listInvoices({ actorId: '00000000-0000-4000-a000-0000000000ff' })).toEqual([]);
  });

  it('lets only the Founder or Manager record a bill', async () => {
    const repository = build();
    for (const ctx of [senior, staff, trainee]) {
      await expect(repository.recordVyaparBill(ctx, bill({ idempotencyKey: 'denied' }))).rejects.toMatchObject({ status: 403 });
    }
    await expect(repository.recordVyaparBill(manager, bill())).resolves.toMatchObject({ status: 'issued' });
  });

  it('lets Staff pay only fee-visible bills and never lets a Trainee pay', async () => {
    const repository = build();
    const mine = await repository.recordVyaparBill(founder, bill());
    const theirs = await repository.recordVyaparBill(
      founder,
      bill({ clientId: CLIENT_1, vyaparBillNumber: 'VYP-301', idempotencyKey: 'bill-2' }),
    );
    await expect(repository.recordPayment(staff, payment(theirs.id))).rejects.toMatchObject({ status: 404 });
    await expect(repository.recordPayment(trainee, payment(mine.id, { idempotencyKey: 'pay-2' }))).rejects.toMatchObject({ status: 403 });
    await expect(repository.recordPayment(staff, payment(mine.id))).resolves.toMatchObject({ status: 'received', clientId: CLIENT_2 });
    expect((await repository.listInvoices(staff)).find((invoice) => invoice.id === mine.id)).toMatchObject({
      status: 'part_paid',
      amountReceivedPaise: 200000,
    });
  });

  it('lets only the Founder or Manager cancel bills and payments', async () => {
    const repository = build();
    const created = await repository.recordVyaparBill(founder, bill());
    const receipt = await repository.recordPayment(founder, payment(created.id));
    for (const ctx of [senior, staff, trainee]) {
      await expect(repository.voidPaymentReceipt(ctx, { id: receipt.id, reason: 'No', idempotencyKey: 'v-1' })).rejects.toMatchObject({ status: 403 });
      await expect(repository.voidInvoice(ctx, { id: created.id, reason: 'No', idempotencyKey: 'v-2' })).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      repository.voidPaymentReceipt(manager, { id: receipt.id, reason: 'Bounced', idempotencyKey: 'v-3' }),
    ).resolves.toMatchObject({ status: 'voided' });
  });

  it('keeps a refused call out of the idempotency store so the key can be reused', async () => {
    const repository = build();
    await repository.recordVyaparBill(founder, bill());
    await expect(repository.recordVyaparBill(founder, bill({ idempotencyKey: 'dup-key' }))).rejects.toMatchObject({ code: 'duplicate_vyapar_bill' });
    // The refused call stored nothing, so the same key works for a corrected request
    await expect(
      repository.recordVyaparBill(founder, bill({ vyaparBillNumber: 'VYP-302', idempotencyKey: 'dup-key' })),
    ).resolves.toMatchObject({ vyaparBillNumber: 'VYP-302' });
  });

  it('replays per actor and refuses the same key with another operation', async () => {
    const repository = build();
    const first = await repository.recordVyaparBill(founder, bill());
    expect(await repository.recordVyaparBill(founder, bill())).toEqual(first);
    // Another actor's identical key is a separate receipt, so it hits the duplicate rule instead of replaying
    await expect(repository.recordVyaparBill(manager, bill())).rejects.toMatchObject({ code: 'duplicate_vyapar_bill' });
    await expect(repository.recordPayment(founder, payment(first.id, { idempotencyKey: 'bill-1' }))).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(repository.recordVyaparBill(founder, bill({ idempotencyKey: ' ' }))).rejects.toMatchObject({ status: 422 });
  });

  it('derives status as payments are recorded and cancelled and refuses overpayment', async () => {
    const repository = build();
    const created = await repository.recordVyaparBill(founder, bill());
    const a = await repository.recordPayment(founder, payment(created.id, { amountPaise: 300000, idempotencyKey: 'p-a' }));
    await expect(repository.recordPayment(founder, payment(created.id, { amountPaise: 200001, idempotencyKey: 'p-b' }))).rejects.toMatchObject({
      code: 'payment_exceeds_balance',
      message: 'The payment is more than the ₹2,000 still pending on this bill.',
    });
    await repository.recordPayment(founder, payment(created.id, { amountPaise: 200000, idempotencyKey: 'p-c' }));
    const status = async () => (await repository.listInvoices(founder)).find((invoice) => invoice.id === created.id)!.status;
    expect(await status()).toBe('paid');
    await repository.voidPaymentReceipt(founder, { id: a.id, reason: 'Bounced', idempotencyKey: 'v-a' });
    expect(await status()).toBe('part_paid');
  });
});
