import { describe, expect, it } from 'vitest';
import type { AssignmentDto, ReportPeriodKind, WorkItemDto } from '@sn/contracts';
import { createDemoSeed, DEMO_ACTOR_IDS } from './demo-seed';
import { InMemoryCrmRepository } from './in-memory-repository';
import type {
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateDocumentCommand,
  CreateWorkItemRecord,
  RecordClientMessageCommand,
  RecordPaymentCommand,
  RecordVyaparBillCommand,
  RepositoryContext,
  UpdateAssignmentStatusCommand,
  UpdateWorkItemStatusCommand,
} from './repository';
import { documentStoragePath, resolveReportPeriod, safeDocumentFileName } from './repository';

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
      gstinMasked: '27**********1Z5',
      panMasked: '******1234',
      // A Trainee never looks after a client, so the full values stay hidden
      pan: null,
      gstin: null,
      email: 'accounts@asterfoods.local',
      phone: '+91 98200 11001',
      relationshipOwnerId: DEMO_ACTOR_IDS.manager,
      relationshipOwnerName: 'Priya Desai',
      status: 'active',
      notes: null,
      entityType: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      pincode: null,
      tan: null,
      cinLlpin: null,
      udyamNumber: null,
      iec: null,
      incorporationDate: null,
      contacts: [],
      canEdit: false,
      canChangeOwnerOrStatus: false,
      looksAfter: false, // A Trainee never looks after a client
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

  it('derives status as payments are recorded and cancelled and keeps an overpayment as credit', async () => {
    const repository = build();
    const created = await repository.recordVyaparBill(founder, bill());
    const a = await repository.recordPayment(founder, payment(created.id, { amountPaise: 300000, idempotencyKey: 'p-a' }));
    await repository.recordPayment(founder, payment(created.id, { amountPaise: 200000, idempotencyKey: 'p-c' }));
    const status = async () => (await repository.listInvoices(founder)).find((invoice) => invoice.id === created.id)!.status;
    expect(await status()).toBe('paid');
    await repository.voidPaymentReceipt(founder, { id: a.id, reason: 'Bounced', idempotencyKey: 'v-a' });
    expect(await status()).toBe('part_paid');
  });
});

describe('InMemoryCrmRepository client credit (FEE-02a)', () => {
  const founder: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const manager: RepositoryContext = { actorId: DEMO_ACTOR_IDS.manager };
  const senior: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staff: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const trainee: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };
  const now = new Date('2026-11-13T12:00:00.000Z');
  const build = () => new InMemoryCrmRepository(createDemoSeed(now), { now: () => now });
  // Client 2 is looked after by Staff and has no credit in the demo data; client 1 has 4,00,000 on RCT-0001002.
  const CLIENT_1 = '10000000-0000-4000-a000-000000000001';
  const CLIENT_2 = '10000000-0000-4000-a000-000000000002';
  let counter = 0;
  const key = () => `credit-${++counter}`;
  const bill = (number: string, amountPaise: number, overrides: Partial<RecordVyaparBillCommand> = {}): RecordVyaparBillCommand => ({
    clientId: CLIENT_2,
    vyaparBillNumber: number,
    billDate: '2026-11-01',
    dueDate: '2026-11-30',
    amountPaise,
    description: 'Retainer fee',
    idempotencyKey: key(),
    ...overrides,
  });
  const payment = (invoiceId: string, amountPaise: number, receivedOn: string): RecordPaymentCommand => ({
    invoiceId,
    receivedOn,
    amountPaise,
    method: 'upi',
    idempotencyKey: key(),
  });
  const apply = (invoiceId: string) => ({ invoiceId, idempotencyKey: key() });
  const remove = (allocationId: string) => ({ allocationId, idempotencyKey: key() });

  it('keeps an overpayment as credit on the receipt, allocating only the pending amount', async () => {
    const repository = build();
    const created = await repository.recordVyaparBill(founder, bill('VYP-600', 500000));
    const receipt = await repository.recordPayment(founder, payment(created.id, 800000, '2026-11-10'));
    expect(receipt).toMatchObject({ amountPaise: 800000, allocatedPaise: 500000, unallocatedPaise: 300000 });
    expect(receipt.allocations).toEqual([
      expect.objectContaining({ allocationId: expect.any(String), source: 'payment', amountPaise: 500000 }),
    ]);
    const updated = (await repository.listInvoices(founder)).find((invoice) => invoice.id === created.id)!;
    expect(updated).toMatchObject({ status: 'paid', amountReceivedPaise: 500000, balancePaise: 0 });
    expect(updated.payments[0]).toMatchObject({ source: 'payment', allocationId: receipt.allocations[0]!.allocationId });
  });

  it('applies credit oldest receipt first across two receipts, then keeps the rest for a later bill', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-601', 1000000));
    const r1 = await repository.recordPayment(founder, payment(a.id, 1300000, '2026-11-05')); // 3,000 credit, newer
    const b = await repository.recordVyaparBill(founder, bill('VYP-602', 500000));
    const r2 = await repository.recordPayment(founder, payment(b.id, 700000, '2026-11-02')); // 2,000 credit, older
    const c = await repository.recordVyaparBill(founder, bill('VYP-603', 400000));

    const applied = await repository.applyCredit(founder, apply(c.id));
    expect(applied).toMatchObject({ status: 'paid', amountReceivedPaise: 400000, balancePaise: 0 });
    expect(applied.payments.map((entry) => [entry.receiptCode, entry.amountPaise, entry.source])).toEqual([
      [r2.code, 200000, 'credit'],
      [r1.code, 200000, 'credit'],
    ]);
    const receipts = await repository.listPaymentReceipts(founder);
    expect(receipts.find((receipt) => receipt.id === r2.id)!.unallocatedPaise).toBe(0);
    expect(receipts.find((receipt) => receipt.id === r1.id)!.unallocatedPaise).toBe(100000);
  });

  it('uses part of the credit when the bill is bigger than the credit, leaving the bill part paid', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-604', 500000));
    await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    const big = await repository.recordVyaparBill(founder, bill('VYP-605', 900000));
    const applied = await repository.applyCredit(founder, apply(big.id));
    expect(applied).toMatchObject({ status: 'part_paid', amountReceivedPaise: 300000, balancePaise: 600000 });
    await expect(repository.applyCredit(founder, apply(big.id))).rejects.toMatchObject({
      status: 422,
      code: 'no_credit_available',
      message: 'This client has no credit to use.',
    });
  });

  it('skips a receipt that already has an allocation to the bill', async () => {
    const repository = build();
    // RCT-0001002 holds 4,00,000 of credit but already allocates 6,00,000 to INV-0001002
    const partPaid = (await repository.listInvoices(founder)).find((invoice) => invoice.code === 'INV-0001002')!;
    await expect(repository.applyCredit(founder, apply(partPaid.id))).rejects.toMatchObject({ code: 'no_credit_available' });
    // A new bill for the same client can use it
    const fresh = await repository.recordVyaparBill(founder, bill('VYP-606', 300000, { clientId: CLIENT_1 }));
    const applied = await repository.applyCredit(senior, apply(fresh.id));
    expect(applied).toMatchObject({ status: 'paid' });
    expect(applied.payments[0]).toMatchObject({ receiptCode: 'RCT-0001002', source: 'credit', amountPaise: 300000 });
  });

  it('never uses credit from a cancelled receipt', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-607', 500000));
    const receipt = await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    await repository.voidPaymentReceipt(founder, { id: receipt.id, reason: 'Bounced', idempotencyKey: key() });
    const next = await repository.recordVyaparBill(founder, bill('VYP-608', 200000));
    await expect(repository.applyCredit(founder, apply(next.id))).rejects.toMatchObject({ code: 'no_credit_available' });
  });

  it('refuses credit on a closed, cancelled or invisible bill and a missing one', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-609', 500000));
    await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    await expect(repository.applyCredit(founder, apply(a.id))).rejects.toMatchObject({ status: 422, code: 'bill_not_open' });
    const other = await repository.recordVyaparBill(founder, bill('VYP-610', 200000, { clientId: CLIENT_1 }));
    await expect(repository.applyCredit(staff, apply(other.id))).rejects.toMatchObject({ status: 404, message: 'Invoice was not found.' });
    await expect(repository.applyCredit(trainee, apply(other.id))).rejects.toMatchObject({ status: 403 });
    await expect(repository.applyCredit(founder, apply('70000000-0000-4000-a000-0000000000ff'))).rejects.toMatchObject({ status: 404 });
    const draft = (await repository.listInvoices(founder)).find((invoice) => invoice.status === 'draft')!;
    await expect(repository.applyCredit(founder, apply(draft.id))).rejects.toMatchObject({ code: 'bill_not_open' });
  });

  it('applies credit when recording a bill only when asked, and treats no credit as normal', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-611', 500000));
    await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    const plain = await repository.recordVyaparBill(founder, bill('VYP-612', 200000));
    expect(plain).toMatchObject({ status: 'issued', payments: [] });
    const used = await repository.recordVyaparBill(founder, bill('VYP-613', 200000, { applyCredit: true }));
    expect(used).toMatchObject({ status: 'paid', amountReceivedPaise: 200000 });
    expect(used.payments[0]).toMatchObject({ source: 'credit' });
    const none = await repository.recordVyaparBill(founder, bill('VYP-614', 200000, { applyCredit: true }));
    expect(none).toMatchObject({ status: 'part_paid', amountReceivedPaise: 100000 });
    const empty = await repository.recordVyaparBill(founder, bill('VYP-615', 200000, { applyCredit: true }));
    expect(empty).toMatchObject({ status: 'issued', payments: [] });
  });

  it('removes credit from a bill and gives it back to the receipt', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-616', 500000));
    const receipt = await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    const b = await repository.recordVyaparBill(founder, bill('VYP-617', 300000));
    const used = await repository.applyCredit(founder, apply(b.id));
    expect(used.status).toBe('paid');

    const removed = await repository.removeCreditAllocation(manager, remove(used.payments[0]!.allocationId));
    expect(removed).toMatchObject({ id: b.id, status: 'issued', amountReceivedPaise: 0, payments: [] });
    const restored = (await repository.listPaymentReceipts(founder)).find((candidate) => candidate.id === receipt.id)!;
    expect(restored.unallocatedPaise).toBe(300000);
    await expect(repository.applyCredit(founder, apply(b.id))).resolves.toMatchObject({ status: 'paid' });
  });

  it('refuses to remove a direct payment allocation, a missing one, and any removal by non-managers', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-618', 500000));
    const receipt = await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    const b = await repository.recordVyaparBill(founder, bill('VYP-619', 300000));
    const used = await repository.applyCredit(founder, apply(b.id));
    await expect(repository.removeCreditAllocation(founder, remove(receipt.allocations[0]!.allocationId))).rejects.toMatchObject({
      status: 422,
      code: 'not_credit_allocation',
      message: 'This is a direct payment. Cancel the payment instead.',
    });
    await expect(repository.removeCreditAllocation(founder, remove('73000000-0000-4000-a000-0000000000ff'))).rejects.toMatchObject({
      status: 404,
      message: 'Payment allocation was not found.',
    });
    for (const ctx of [senior, staff, trainee]) {
      await expect(repository.removeCreditAllocation(ctx, remove(used.payments[0]!.allocationId))).rejects.toMatchObject({ status: 403 });
    }
  });

  it('puts a bill back to pending when the receipt behind its credit is cancelled', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-620', 500000));
    const receipt = await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    const b = await repository.recordVyaparBill(founder, bill('VYP-621', 300000));
    await repository.applyCredit(founder, apply(b.id));
    await repository.voidPaymentReceipt(founder, { id: receipt.id, reason: 'Bounced', idempotencyKey: key() });
    const after = (await repository.listInvoices(founder)).find((invoice) => invoice.id === b.id)!;
    expect(after).toMatchObject({ status: 'issued', amountReceivedPaise: 0, balancePaise: 300000 });
  });

  it('refuses to cancel a bill carrying credit until the credit is removed', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-622', 500000));
    await repository.recordPayment(founder, payment(a.id, 800000, '2026-11-05'));
    const b = await repository.recordVyaparBill(founder, bill('VYP-623', 300000));
    const used = await repository.applyCredit(founder, apply(b.id));
    await expect(repository.voidInvoice(founder, { id: b.id, reason: 'Entered twice', idempotencyKey: key() })).rejects.toMatchObject({
      status: 422,
      code: 'bill_has_payments',
      message: 'Cancel the payments and remove any credit on this bill first.',
    });
    await repository.removeCreditAllocation(founder, remove(used.payments[0]!.allocationId));
    await expect(repository.voidInvoice(founder, { id: b.id, reason: 'Entered twice', idempotencyKey: key() })).resolves.toMatchObject({
      status: 'voided',
    });
  });

  it('replays an apply-credit call without applying twice and refuses the key for another operation', async () => {
    const repository = build();
    const a = await repository.recordVyaparBill(founder, bill('VYP-624', 500000));
    await repository.recordPayment(founder, payment(a.id, 1000000, '2026-11-05'));
    const b = await repository.recordVyaparBill(founder, bill('VYP-625', 300000));
    const command = { invoiceId: b.id, idempotencyKey: 'apply-once' };
    const first = await repository.applyCredit(founder, command);
    expect(await repository.applyCredit(founder, command)).toEqual(first);
    await expect(repository.removeCreditAllocation(founder, { allocationId: first.payments[0]!.allocationId, idempotencyKey: 'apply-once' }))
      .rejects.toMatchObject({ status: 409, code: 'conflict' });
  });

  it('gives the demo data a receipt with credit and shows source and allocation ids on reads', async () => {
    const repository = build();
    const receipts = await repository.listPaymentReceipts(founder);
    expect(receipts.find((receipt) => receipt.code === 'RCT-0001002')).toMatchObject({ unallocatedPaise: 400000 });
    for (const receipt of receipts) {
      for (const allocation of receipt.allocations) {
        expect(allocation).toMatchObject({ allocationId: expect.any(String), source: 'payment' });
      }
    }
  });
});

describe('InMemoryCrmRepository service list management (SVC-01)', () => {
  const ctx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const GST_SERVICE_ID = '50000000-0000-4000-a000-000000000001';

  function createRepository() {
    let nowMs = Date.parse('2026-11-13T10:00:00.000Z');
    const repository = new InMemoryCrmRepository(createDemoSeed(), { now: () => new Date(nowMs) });
    return { repository, tick: (ms: number) => (nowMs += ms) };
  }

  it('creates a service that starts active, unused and named as given', async () => {
    const { repository } = createRepository();
    const created = await repository.createService(ctx, {
      name: 'Trademark',
      description: 'Registrations and renewals',
      turnaroundDays: 45,
      isStatutory: false,
      idempotencyKey: 'create-trademark',
    });

    expect(created).toMatchObject({
      name: 'Trademark',
      description: 'Registrations and renewals',
      turnaroundDays: 45,
      isStatutory: false,
      isActive: true,
      usage: { assignments: 0, recurringSchedules: 0, engagements: 0 },
    });
    expect(created.createdAt).toBe(created.updatedAt);
  });

  it('refuses a duplicate name differing only in case or surrounding spaces', async () => {
    const { repository } = createRepository();
    await repository.createService(ctx, { name: 'Trademark', idempotencyKey: 'create-1' });

    await expect(
      repository.createService(ctx, { name: 'TRADEMARK', idempotencyKey: 'create-2' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_service',
      message: 'A service named TRADEMARK already exists.',
    });
    await expect(
      repository.createService(ctx, { name: ' gst compliance ', idempotencyKey: 'create-3' }),
    ).rejects.toMatchObject({ status: 409, code: 'duplicate_service' });
  });

  it('renames, sets turnaround and statutory flag, and clears the description', async () => {
    const { repository, tick } = createRepository();
    const created = await repository.createService(ctx, {
      name: 'ISO',
      description: 'Certification',
      idempotencyKey: 'create-iso',
    });
    tick(1000);

    const updated = await repository.updateService(ctx, {
      id: created.id,
      name: 'ISO Certification',
      description: null,
      turnaroundDays: 90,
      isStatutory: true,
      expectedUpdatedAt: created.updatedAt,
      idempotencyKey: 'update-iso',
    });

    expect(updated).toMatchObject({
      name: 'ISO Certification',
      description: null,
      turnaroundDays: 90,
      isStatutory: true,
      isActive: true,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it('allows a service to change only the case of its own name', async () => {
    const { repository } = createRepository();
    const created = await repository.createService(ctx, { name: 'Trademark', idempotencyKey: 'create-1' });
    const renamed = await repository.updateService(ctx, {
      id: created.id,
      name: 'TRADEMARK',
      expectedUpdatedAt: created.updatedAt,
      idempotencyKey: 'rename-1',
    });
    expect(renamed.name).toBe('TRADEMARK');
  });

  it('refuses renaming onto another service name', async () => {
    const { repository } = createRepository();
    const created = await repository.createService(ctx, { name: 'Trademark', idempotencyKey: 'create-1' });
    await expect(
      repository.updateService(ctx, {
        id: created.id,
        name: 'gst compliance',
        expectedUpdatedAt: created.updatedAt,
        idempotencyKey: 'rename-1',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'duplicate_service' });
  });

  it('refuses a stale expectedUpdatedAt and an unknown service', async () => {
    const { repository, tick } = createRepository();
    const created = await repository.createService(ctx, { name: 'Trademark', idempotencyKey: 'create-1' });
    tick(1000);
    await repository.updateService(ctx, {
      id: created.id,
      turnaroundDays: 10,
      expectedUpdatedAt: created.updatedAt,
      idempotencyKey: 'update-1',
    });

    await expect(
      repository.updateService(ctx, {
        id: created.id,
        turnaroundDays: 20,
        expectedUpdatedAt: created.updatedAt,
        idempotencyKey: 'update-2',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'stale_service',
      message: 'This service was changed by someone else. Reload and try again.',
    });
    await expect(
      repository.updateService(ctx, {
        id: '50000000-0000-4000-a000-999999999999',
        turnaroundDays: 20,
        expectedUpdatedAt: created.updatedAt,
        idempotencyKey: 'update-3',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('detects a stale token even when two changes land in the same millisecond', async () => {
    const { repository } = createRepository();
    const created = await repository.createService(ctx, { name: 'Trademark', idempotencyKey: 'create-1' });
    const first = await repository.updateService(ctx, {
      id: created.id,
      isActive: false,
      expectedUpdatedAt: created.updatedAt,
      idempotencyKey: 'update-1',
    });
    expect(first.updatedAt).not.toBe(created.updatedAt);
    await expect(
      repository.updateService(ctx, {
        id: created.id,
        isActive: true,
        expectedUpdatedAt: created.updatedAt,
        idempotencyKey: 'update-2',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_service' });
  });

  it('deactivates and reactivates; the picker list follows and the full list keeps the service', async () => {
    const { repository, tick } = createRepository();
    const created = await repository.createService(ctx, { name: 'Trademark', idempotencyKey: 'create-1' });
    tick(1000);
    const off = await repository.updateService(ctx, {
      id: created.id,
      isActive: false,
      expectedUpdatedAt: created.updatedAt,
      idempotencyKey: 'off',
    });
    expect(off.isActive).toBe(false);
    expect((await repository.listServiceReferences(ctx)).map((s) => s.name)).not.toContain('Trademark');
    expect((await repository.listServiceCatalog(ctx)).map((s) => s.name)).toContain('Trademark');
    // New or changed work cannot choose an inactive service, by id or by name
    expect(await repository.getServiceReferenceById(ctx, created.id)).toBeNull();
    expect(await repository.getServiceReferenceByName(ctx, 'trademark')).toBeNull();

    tick(1000);
    const on = await repository.updateService(ctx, {
      id: created.id,
      isActive: true,
      expectedUpdatedAt: off.updatedAt,
      idempotencyKey: 'on',
    });
    expect(on.isActive).toBe(true);
    expect((await repository.listServiceReferences(ctx)).map((s) => s.name)).toContain('Trademark');
    expect(await repository.getServiceReferenceById(ctx, created.id)).toEqual({ id: created.id, name: 'Trademark' });
  });

  it('lists active services first, then by name, with usage counts', async () => {
    const { repository, tick } = createRepository();
    const created = await repository.createService(ctx, { name: 'Aaa Retired', idempotencyKey: 'create-1' });
    tick(1000);
    await repository.updateService(ctx, {
      id: created.id,
      isActive: false,
      expectedUpdatedAt: created.updatedAt,
      idempotencyKey: 'off',
    });

    const catalog = await repository.listServiceCatalog(ctx);
    expect(catalog.at(-1)?.name).toBe('Aaa Retired');
    const activeNames = catalog.filter((s) => s.isActive).map((s) => s.name);
    expect(activeNames).toEqual([...activeNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));

    const gst = catalog.find((s) => s.id === GST_SERVICE_ID);
    expect(gst?.usage.assignments).toBeGreaterThan(0);
  });

  it('replays the stored result for the same key and payload, and rejects a changed payload', async () => {
    const { repository } = createRepository();
    const command = { name: 'Trademark', turnaroundDays: 30, idempotencyKey: 'create-1' };
    const first = await repository.createService(ctx, command);
    const replay = await repository.createService(ctx, command);
    expect(replay).toEqual(first);
    expect((await repository.listServiceCatalog(ctx)).filter((s) => s.name === 'Trademark')).toHaveLength(1);

    await expect(
      repository.createService(ctx, { ...command, turnaroundDays: 31 }),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
  });
});

describe('InMemoryCrmRepository client master (CLI-02a)', () => {
  const ASTER = '10000000-0000-4000-a000-000000000001';
  const BLUEPEAK = '10000000-0000-4000-a000-000000000002';
  const UPDATED_AT = '2026-01-01T00:00:00.000Z';
  const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const seniorCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const traineeCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };

  it('mirrors looks_after_client: full PAN and GSTIN only for management and the staff who look after the client', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    // Senior owns or reviews an assignment of Aster; Staff is the relationship owner of BluePeak
    expect(await repository.getClient(seniorCtx, ASTER)).toMatchObject({ pan: 'AABCA1234A', gstin: '27AABCA1234A1Z5' });
    expect(await repository.getClient(staffCtx, BLUEPEAK)).toMatchObject({ pan: 'AABCB2345B', gstin: '27AABCB2345B1Z4' });
    expect(await repository.getClient(founderCtx, BLUEPEAK)).toMatchObject({ pan: 'AABCB2345B' });

    const trainee = await repository.getClient(traineeCtx, ASTER);
    expect(trainee).toMatchObject({ pan: null, gstin: null, panMasked: '******1234', gstinMasked: '27**********1Z5' });

    // The masked values are the same for everyone who can see the client
    const founder = await repository.getClient(founderCtx, ASTER);
    expect(founder).toMatchObject({ panMasked: trainee?.panMasked, gstinMasked: trainee?.gstinMasked });

    const traineeList = await repository.listClients(traineeCtx);
    expect(traineeList.every((client) => client.pan === null && client.gstin === null)).toBe(true);
  });

  it('mirrors can_edit_client: management and the relationship owner may edit, nobody else', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const edit = { notes: 'Note', expectedUpdatedAt: UPDATED_AT };

    expect((await repository.getClient(staffCtx, BLUEPEAK))?.canEdit).toBe(true);
    expect((await repository.getClient(seniorCtx, ASTER))?.canEdit).toBe(false);

    await expect(repository.updateClient(seniorCtx, { id: ASTER, ...edit, idempotencyKey: 'k1' })).rejects.toMatchObject({ status: 403 });
    await expect(repository.updateClient(staffCtx, { id: ASTER, ...edit, idempotencyKey: 'k2' })).rejects.toMatchObject({ status: 404 });
    await expect(repository.updateClient(staffCtx, { id: BLUEPEAK, ...edit, idempotencyKey: 'k3' })).resolves.toMatchObject({ notes: 'Note' });
  });

  it('lets only management change the relationship owner or status, as the database trigger does', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    await expect(
      repository.updateClient(staffCtx, { id: BLUEPEAK, status: 'archived', expectedUpdatedAt: UPDATED_AT, idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repository.updateClient(staffCtx, {
        id: BLUEPEAK,
        relationshipOwnerId: DEMO_ACTOR_IDS.senior,
        expectedUpdatedAt: UPDATED_AT,
        idempotencyKey: 'k2',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repository.updateClient(founderCtx, {
        id: BLUEPEAK,
        status: 'archived',
        relationshipOwnerId: DEMO_ACTOR_IDS.senior,
        expectedUpdatedAt: UPDATED_AT,
        idempotencyKey: 'k3',
      }),
    ).resolves.toMatchObject({ status: 'archived', relationshipOwnerId: DEMO_ACTOR_IDS.senior });
  });

  it('refuses a stale edit and replays an idempotent one without a second change', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    await expect(
      repository.updateClient(founderCtx, { id: ASTER, notes: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z', idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_client' });

    const command = { id: ASTER, notes: 'Once', expectedUpdatedAt: UPDATED_AT, idempotencyKey: 'k2' };
    const first = await repository.updateClient(founderCtx, command);
    expect(await repository.updateClient(founderCtx, command)).toEqual(first);
    await expect(repository.updateClient(founderCtx, { ...command, notes: 'Other' })).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
    });
  });

  it('keeps one primary contact per client and lists the primary first', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const a = await repository.createClientContact(founderCtx, { clientId: ASTER, name: 'Zed Khan', phone: '98200 11111', isPrimary: true, idempotencyKey: 'c1' });
    const b = await repository.createClientContact(founderCtx, { clientId: ASTER, name: 'Amit Shah', phone: '98200 22222', isPrimary: true, idempotencyKey: 'c2' });
    let client = await repository.getClient(founderCtx, ASTER);
    expect(client?.contacts.map((contact) => [contact.name, contact.isPrimary])).toEqual([
      ['Amit Shah', true],
      ['Zed Khan', false],
    ]);

    await repository.updateClientContact(founderCtx, { id: a.id, isPrimary: true, expectedUpdatedAt: a.updatedAt, idempotencyKey: 'c3' });
    client = await repository.getClient(founderCtx, ASTER);
    expect(client?.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.id)).toEqual([a.id]);
    expect(client?.contacts.find((contact) => contact.id === b.id)?.isPrimary).toBe(false);
  });

  it('applies the same edit rules to contacts: owner may, reviewer may not, unrelated staff cannot see them', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const own = await repository.createClientContact(staffCtx, { clientId: BLUEPEAK, name: 'Owner Contact', phone: '98200 33333', idempotencyKey: 'c1' });
    const other = await repository.createClientContact(founderCtx, { clientId: ASTER, name: 'Aster Contact', phone: '98200 44444', idempotencyKey: 'c2' });

    await expect(repository.getClientIdForContact(staffCtx, own.id)).resolves.toBe(BLUEPEAK);
    await expect(repository.getClientIdForContact(staffCtx, other.id)).resolves.toBeNull();
    await expect(repository.getClientIdForContact(seniorCtx, other.id)).resolves.toBe(ASTER);

    await expect(
      repository.createClientContact(seniorCtx, { clientId: ASTER, name: 'Nope Nope', phone: '98200 55555', idempotencyKey: 'c3' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repository.updateClientContact(seniorCtx, { id: other.id, notes: 'x', expectedUpdatedAt: other.updatedAt, idempotencyKey: 'c4' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(repository.deleteClientContact(seniorCtx, other.id)).rejects.toMatchObject({ status: 403 });
    await expect(repository.deleteClientContact(staffCtx, other.id)).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.updateClientContact(founderCtx, { id: other.id, notes: 'x', expectedUpdatedAt: '2020-01-01T00:00:00.000Z', idempotencyKey: 'c5' }),
    ).rejects.toMatchObject({ status: 409, code: 'stale_contact' });

    await repository.deleteClientContact(staffCtx, own.id);
    expect((await repository.getClient(staffCtx, BLUEPEAK))?.contacts).toEqual([]);
  });
});

describe('InMemoryCrmRepository client documents (DOC-01a)', () => {
  const ASTER = '10000000-0000-4000-a000-000000000001'; // looked after by Founder, Manager and Senior Staff
  const BLUEPEAK = '10000000-0000-4000-a000-000000000002'; // looked after by Founder, Manager and Staff
  const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const managerCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.manager };
  const seniorCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const traineeCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };

  const command = (overrides: Partial<CreateDocumentCommand> = {}): CreateDocumentCommand => ({
    clientId: BLUEPEAK,
    title: 'Board resolution',
    category: 'agreements',
    financialYearStart: 2026,
    fileName: 'resolution.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    idempotencyKey: 'create-1',
    ...overrides,
  });

  it('builds the storage path from the client, the document and a safe file name', () => {
    expect(safeDocumentFileName('Balance sheet (FY 26-27) ₹.xlsx')).toBe('Balance_sheet__FY_26-27___.xlsx');
    expect(safeDocumentFileName('a_b-c.d.pdf')).toBe('a_b-c.d.pdf');
    expect(documentStoragePath('client', 'doc', 'my file.pdf')).toBe('clients/client/doc/my_file.pdf');
  });

  it('simulates Storage: a document is available only once its object exists, with the real size', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const created = await repository.createClientDocument(staffCtx, command());
    expect(created.status).toBe('pending');
    expect(created.storagePath).toBe(`clients/${BLUEPEAK}/${created.id}/resolution.pdf`);

    await expect(
      repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-1' }),
    ).rejects.toMatchObject({ status: 422, code: 'upload_missing' });

    repository.markObjectUploaded(created.storagePath, 777);
    const confirmed = await repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-2' });
    expect(confirmed).toMatchObject({ status: 'available', sizeBytes: 777 });
    expect(await repository.listClientDocuments(staffCtx)).toEqual([confirmed]);
  });

  it('refuses an object over 25 MB at confirmation', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const created = await repository.createClientDocument(staffCtx, command());
    repository.markObjectUploaded(created.storagePath, 26214401);
    await expect(
      repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-1' }),
    ).rejects.toMatchObject({ status: 422, code: 'file_too_large' });
  });

  it('shows and accepts documents only for clients the actor looks after', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    await expect(repository.createClientDocument(seniorCtx, command())).rejects.toMatchObject({ status: 404 });
    await expect(repository.createClientDocument(traineeCtx, command())).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.createClientDocument(staffCtx, command({ clientId: ASTER, idempotencyKey: 'create-2' })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.createClientDocument(founderCtx, command({ clientId: '10000000-0000-4000-a000-0000000000ff', idempotencyKey: 'create-3' })),
    ).rejects.toMatchObject({ status: 404 });

    const owned = await repository.createClientDocument(staffCtx, command({ idempotencyKey: 'create-4' }));
    const reviewed = await repository.createClientDocument(seniorCtx, command({ clientId: ASTER, idempotencyKey: 'create-5' }));
    for (const [ctx, document] of [
      [staffCtx, owned],
      [seniorCtx, reviewed],
    ] as const) {
      repository.markObjectUploaded(document.storagePath, 10);
      await repository.confirmClientDocument(ctx, { id: document.id, idempotencyKey: `confirm-${document.id}` });
    }

    const ids = async (ctx: RepositoryContext, clientId?: string) =>
      (await repository.listClientDocuments(ctx, clientId)).map((document) => document.id);
    expect((await ids(founderCtx)).sort()).toEqual([owned.id, reviewed.id].sort());
    expect((await ids(managerCtx)).sort()).toEqual([owned.id, reviewed.id].sort());
    expect(await ids(staffCtx)).toEqual([owned.id]);
    expect(await ids(seniorCtx)).toEqual([reviewed.id]);
    expect(await ids(traineeCtx)).toEqual([]);
    expect(await ids(founderCtx, ASTER)).toEqual([reviewed.id]);
    expect(await ids(staffCtx, ASTER)).toEqual([]);
  });

  it('lets only the uploader confirm a pending document', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const created = await repository.createClientDocument(staffCtx, command());
    repository.markObjectUploaded(created.storagePath, 10);
    await expect(
      repository.confirmClientDocument(founderCtx, { id: created.id, idempotencyKey: 'confirm-1' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repository.confirmClientDocument(seniorCtx, { id: created.id, idempotencyKey: 'confirm-2' }),
    ).rejects.toMatchObject({ status: 404 });
    await repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-3' });
    await expect(
      repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-4' }),
    ).rejects.toMatchObject({ status: 409, code: 'invalid_state_transition' });
  });

  it('lets staff on the client remove a document, keeps the record, and never removes twice', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const created = await repository.createClientDocument(staffCtx, command());
    repository.markObjectUploaded(created.storagePath, 10);
    await repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-s' });
    const removed = await repository.removeClientDocument(staffCtx, {
      id: created.id,
      reason: 'Wrong file',
      idempotencyKey: 'remove-s',
    });
    expect(removed).toMatchObject({ status: 'removed', removedReason: 'Wrong file' });
    await expect(
      repository.removeClientDocument(managerCtx, { id: created.id, reason: 'Again', idempotencyKey: 'remove-s2' }),
    ).rejects.toMatchObject({ status: 422, code: 'already_removed' });
  });

  it('removes a document for management, keeps the record, and never removes twice', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const created = await repository.createClientDocument(staffCtx, command());
    await expect(
      repository.removeClientDocument(managerCtx, { id: created.id, reason: 'Too early', idempotencyKey: 'remove-0' }),
    ).rejects.toMatchObject({ status: 409, code: 'invalid_state_transition' });
    repository.markObjectUploaded(created.storagePath, 10);
    await repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-1' });

    const removed = await repository.removeClientDocument(managerCtx, {
      id: created.id,
      reason: 'Wrong file',
      idempotencyKey: 'remove-2',
    });
    expect(removed).toMatchObject({ status: 'removed', removedReason: 'Wrong file' });
    expect(removed.removedAt).not.toBeNull();
    expect(await repository.listClientDocuments(founderCtx)).toEqual([]);
    await expect(
      repository.removeClientDocument(founderCtx, { id: created.id, reason: 'Again', idempotencyKey: 'remove-3' }),
    ).rejects.toMatchObject({ status: 422, code: 'already_removed' });
  });

  it('replays a write with the same key and refuses the key for a different payload', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const first = await repository.createClientDocument(staffCtx, command());
    expect(await repository.createClientDocument(staffCtx, command())).toEqual(first);
    await expect(
      repository.createClientDocument(staffCtx, command({ title: 'Different title' })),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(await repository.createClientDocument(staffCtx, command({ idempotencyKey: 'create-2' }))).not.toEqual(first);
  });

  it('returns copies, so a caller cannot change a stored document', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const created = await repository.createClientDocument(staffCtx, command());
    repository.markObjectUploaded(created.storagePath, 10);
    await repository.confirmClientDocument(staffCtx, { id: created.id, idempotencyKey: 'confirm-1' });
    const [listed] = await repository.listClientDocuments(staffCtx);
    (listed as { title: string }).title = 'Changed';
    expect((await repository.listClientDocuments(staffCtx))[0]?.title).toBe('Board resolution');
  });
});

describe('InMemoryCrmRepository client messages (MSG-01)', () => {
  const ASTER = '10000000-0000-4000-a000-000000000001'; // looked after by Founder, Manager and Senior Staff
  const BLUEPEAK = '10000000-0000-4000-a000-000000000002'; // looked after by Founder, Manager and Staff
  const ASTER_BILL = '70000000-0000-4000-a000-000000000001'; // Aster, Vyapar bill VYP-118
  const BLUEPEAK_ASSIGNMENT = '30000000-0000-4000-a000-000000000002'; // BluePeak, AS-001002
  const ASTER_ASSIGNMENT = '30000000-0000-4000-a000-000000000001'; // Aster, AS-001001
  const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const managerCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.manager };
  const seniorCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const traineeCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };

  const command = (overrides: Partial<RecordClientMessageCommand> = {}): RecordClientMessageCommand => ({
    clientId: BLUEPEAK,
    recipientName: 'Rahul Shah',
    recipientNumber: '919820012345',
    purpose: 'general',
    body: 'Dear Rahul, ',
    idempotencyKey: 'msg-1',
    ...overrides,
  });

  it('records a message with the work it is about and the sender, newest first', async () => {
    let tick = 0;
    const repository = new InMemoryCrmRepository(createDemoSeed(), {
      now: () => new Date(Date.UTC(2026, 10, 13, 10, 0, tick++)),
    });
    const contact = await repository.createClientContact(staffCtx, {
      clientId: BLUEPEAK,
      name: 'Rahul Shah',
      whatsapp: '98200 12345',
      idempotencyKey: 'c1',
    });
    const first = await repository.recordClientMessage(
      staffCtx,
      command({ contactId: contact.id, purpose: 'deadline_reminder', assignmentId: BLUEPEAK_ASSIGNMENT }),
    );
    expect(first).toMatchObject({
      clientId: BLUEPEAK,
      clientCode: 'CL-001002',
      clientName: 'BluePeak Tech',
      contactId: contact.id,
      recipientName: 'Rahul Shah',
      recipientNumber: '919820012345',
      channel: 'whatsapp',
      purpose: 'deadline_reminder',
      assignmentId: BLUEPEAK_ASSIGNMENT,
      assignmentCode: 'AS-001002',
      invoiceId: null,
      invoiceLabel: null,
      body: 'Dear Rahul, ',
      status: 'opened',
      sentById: DEMO_ACTOR_IDS.staff,
      sentByName: 'Rohan Mehta',
    });
    const second = await repository.recordClientMessage(
      founderCtx,
      command({ clientId: ASTER, purpose: 'payment_reminder', invoiceId: ASTER_BILL, idempotencyKey: 'msg-2' }),
    );
    expect(second).toMatchObject({ contactId: null, invoiceLabel: 'VYP-118', assignmentCode: null });
    expect((await repository.listClientMessages(founderCtx)).map((message) => message.id)).toEqual([second.id, first.id]);
  });

  it('lets Founder, Manager and the staff on the client record and see, and nobody else', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    await expect(repository.recordClientMessage(seniorCtx, command())).rejects.toMatchObject({ status: 404 });
    await expect(repository.recordClientMessage(traineeCtx, command({ idempotencyKey: 'msg-t' }))).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.recordClientMessage(staffCtx, command({ clientId: ASTER, idempotencyKey: 'msg-a' })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repository.recordClientMessage(founderCtx, command({ clientId: '10000000-0000-4000-a000-0000000000ff', idempotencyKey: 'msg-x' })),
    ).rejects.toMatchObject({ status: 404 });

    const owned = await repository.recordClientMessage(staffCtx, command({ idempotencyKey: 'msg-4' }));
    const reviewed = await repository.recordClientMessage(seniorCtx, command({ clientId: ASTER, idempotencyKey: 'msg-5' }));
    const byManager = await repository.recordClientMessage(managerCtx, command({ idempotencyKey: 'msg-6' }));

    const ids = async (ctx: RepositoryContext, clientId?: string) =>
      (await repository.listClientMessages(ctx, clientId)).map((message) => message.id);
    expect((await ids(founderCtx)).sort()).toEqual([owned.id, reviewed.id, byManager.id].sort());
    expect((await ids(managerCtx)).sort()).toEqual([owned.id, reviewed.id, byManager.id].sort());
    expect((await ids(staffCtx)).sort()).toEqual([owned.id, byManager.id].sort());
    expect(await ids(seniorCtx)).toEqual([reviewed.id]);
    expect(await ids(traineeCtx)).toEqual([]);
    expect(await ids(founderCtx, ASTER)).toEqual([reviewed.id]);
    expect(await ids(staffCtx, ASTER)).toEqual([]);
  });

  it('refuses a contact, assignment or bill that belongs to another client', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const asterContact = await repository.createClientContact(founderCtx, {
      clientId: ASTER,
      name: 'Aster Contact',
      whatsapp: '98200 44444',
      idempotencyKey: 'c1',
    });
    await expect(
      repository.recordClientMessage(staffCtx, command({ contactId: asterContact.id, idempotencyKey: 'm1' })),
    ).rejects.toMatchObject({ status: 422, message: 'The contact does not belong to this client.' });
    const linked = { status: 422, message: 'The linked work does not belong to this client.' };
    await expect(
      repository.recordClientMessage(staffCtx, command({ assignmentId: ASTER_ASSIGNMENT, idempotencyKey: 'm2' })),
    ).rejects.toMatchObject(linked);
    await expect(
      repository.recordClientMessage(staffCtx, command({ invoiceId: ASTER_BILL, idempotencyKey: 'm3' })),
    ).rejects.toMatchObject(linked);
    await expect(
      repository.recordClientMessage(staffCtx, command({ assignmentId: '30000000-0000-4000-a000-0000000000ff', idempotencyKey: 'm4' })),
    ).rejects.toMatchObject(linked);
    expect(await repository.listClientMessages(founderCtx)).toEqual([]);
  });

  it('keeps the recipient snapshot and drops only the contact link when the contact is deleted', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const contact = await repository.createClientContact(staffCtx, {
      clientId: BLUEPEAK,
      name: 'Rahul Shah',
      whatsapp: '98200 12345',
      idempotencyKey: 'c1',
    });
    const message = await repository.recordClientMessage(staffCtx, command({ contactId: contact.id }));
    await repository.deleteClientContact(staffCtx, contact.id);
    const [listed] = await repository.listClientMessages(staffCtx);
    expect(listed).toEqual({ ...message, contactId: null });
  });

  it('replays a write with the same key and refuses the key for a different payload', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const first = await repository.recordClientMessage(staffCtx, command());
    expect(await repository.recordClientMessage(staffCtx, command())).toEqual(first);
    expect(await repository.listClientMessages(staffCtx)).toHaveLength(1);
    await expect(
      repository.recordClientMessage(staffCtx, command({ body: 'Different text' })),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(await repository.recordClientMessage(staffCtx, command({ idempotencyKey: 'msg-2' }))).not.toEqual(first);
  });

  it('returns copies, so a caller cannot change a recorded message', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    await repository.recordClientMessage(staffCtx, command());
    const [listed] = await repository.listClientMessages(staffCtx);
    (listed as { body: string }).body = 'Changed';
    expect((await repository.listClientMessages(staffCtx))[0]?.body).toBe('Dear Rahul, ');
  });
});

describe('InMemoryCrmRepository reports (REP-01)', () => {
  const NOW = new Date('2026-11-14T10:00:00.000Z'); // Saturday 14 November 2026, 15:30 in Kolkata
  const ASTER = '10000000-0000-4000-a000-000000000001'; // looked after by Founder, Manager and Senior Staff
  const BLUEPEAK = '10000000-0000-4000-a000-000000000002'; // looked after by Founder, Manager and Staff
  const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const seniorCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const traineeCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.trainee };

  describe('resolveReportPeriod', () => {
    it.each([
      ['day', '2026-11-14', '2026-11-14', '2026-11-15', '14 Nov 2026'],
      ['day', '2026-12-31', '2026-12-31', '2027-01-01', '31 Dec 2026'],
      // Monday to Sunday: Wednesday, Monday and Sunday of the same week resolve to the same window
      ['week', '2026-11-11', '2026-11-09', '2026-11-16', '9–15 Nov 2026'],
      ['week', '2026-11-09', '2026-11-09', '2026-11-16', '9–15 Nov 2026'],
      ['week', '2026-11-15', '2026-11-09', '2026-11-16', '9–15 Nov 2026'],
      ['week', '2026-11-16', '2026-11-16', '2026-11-23', '16–22 Nov 2026'],
      ['week', '2026-11-01', '2026-10-26', '2026-11-02', '26 Oct – 1 Nov 2026'],
      ['week', '2026-12-31', '2026-12-28', '2027-01-04', '28 Dec 2026 – 3 Jan 2027'],
      ['month', '2026-11-14', '2026-11-01', '2026-12-01', 'November 2026'],
      ['month', '2026-11-30', '2026-11-01', '2026-12-01', 'November 2026'],
      ['month', '2026-12-31', '2026-12-01', '2027-01-01', 'December 2026'],
      ['month', '2028-02-29', '2028-02-01', '2028-03-01', 'February 2028'],
      ['month', '2027-02-28', '2027-02-01', '2027-03-01', 'February 2027'],
    ] as const)('%s of %s is %s up to %s, labelled %s', (kind, date, start, endExclusive, label) => {
      expect(resolveReportPeriod(kind, date)).toEqual({ kind, start, endExclusive, label });
    });
  });

  // BluePeak's assignment AS-001002 is owned by Staff; the helper makes more like it
  const template = createDemoSeed(NOW).assignments[1]!;
  const assignment = (code: string, overrides: Partial<AssignmentDto>): AssignmentDto => ({
    ...template,
    id: `30000000-0000-4000-a000-0000000${code.slice(-5)}`,
    code,
    clientId: BLUEPEAK,
    clientName: 'BluePeak Tech',
    service: 'GST Compliance',
    ownerId: DEMO_ACTOR_IDS.staff,
    reviewerIds: [DEMO_ACTOR_IDS.manager],
    status: 'assigned',
    createdAt: '2026-10-01T05:00:00.000Z',
    dueAt: '2026-11-30T06:30:00.000Z',
    ...overrides,
  });

  const workAssignments: AssignmentDto[] = [
    // Approved just after midnight on Tuesday 10 November in Kolkata, though still the 9th in UTC
    assignment('AS-099001', { status: 'approved', createdAt: '2026-11-01T05:00:00.000Z', approvedAt: '2026-11-09T18:45:00.000Z' }),
    // Approved at 23:45 on Tuesday 10 November in Kolkata
    assignment('AS-099002', { status: 'approved', createdAt: '2026-11-01T05:00:00.000Z', approvedAt: '2026-11-10T18:15:00.000Z' }),
    // Closed with no approval time, so the closing time counts
    assignment('AS-099007', { status: 'closed', createdAt: '2026-11-01T05:00:00.000Z', approvedAt: null, closedAt: '2026-11-11T05:00:00.000Z' }),
    // Submitted at exactly midnight starting Monday 16 November in Kolkata
    assignment('AS-099003', { status: 'ready_for_review', submittedAt: '2026-11-15T18:30:00.000Z' }),
    // Overdue, owned by the Manager, for Aster
    assignment('AS-099004', {
      status: 'in_progress',
      clientId: ASTER,
      clientName: 'Aster Foods',
      service: 'Internal Audit',
      ownerId: DEMO_ACTOR_IDS.manager,
      reviewerIds: [DEMO_ACTOR_IDS.founder],
      dueAt: '2026-11-12T06:30:00.000Z',
    }),
    // Due within the next seven days, owned by Senior Staff
    assignment('AS-099005', {
      clientId: ASTER,
      clientName: 'Aster Foods',
      service: 'Statutory Audit',
      ownerId: DEMO_ACTOR_IDS.senior,
      reviewerIds: [DEMO_ACTOR_IDS.founder],
      dueAt: '2026-11-18T06:30:00.000Z',
    }),
    // Cancelled work is never overdue, and counts nowhere for November
    assignment('AS-099006', { status: 'cancelled', service: 'Direct Tax Advisory', dueAt: '2026-11-01T06:30:00.000Z' }),
  ];

  const workItem = (code: string, overrides: Partial<WorkItemDto>): WorkItemDto => ({
    id: `40000000-0000-4000-a000-0000000${code.slice(-5)}`,
    code,
    kind: 'internal',
    title: `Task ${code}`,
    notes: null,
    assignmentId: null,
    relatedClientId: null,
    relatedPartyName: null,
    assigneeId: DEMO_ACTOR_IDS.staff,
    createdById: DEMO_ACTOR_IDS.manager,
    status: 'todo',
    dueAt: '2026-11-20T06:30:00.000Z',
    reminderAt: null,
    createdAt: '2026-11-01T05:00:00.000Z',
    updatedAt: '2026-11-01T05:00:00.000Z',
    ...overrides,
  });

  const buildWork = () =>
    new InMemoryCrmRepository(
      {
        ...createDemoSeed(NOW),
        assignments: workAssignments,
        workItems: [
          workItem('WI-099001', { dueAt: '2026-11-10T06:30:00.000Z' }), // open and overdue
          workItem('WI-099002', { kind: 'personal', createdById: DEMO_ACTOR_IDS.staff, dueAt: '2026-11-10T06:30:00.000Z' }), // private, open, overdue
          workItem('WI-099003', {
            kind: 'personal',
            createdById: DEMO_ACTOR_IDS.staff,
            status: 'completed',
            completedAt: '2026-11-12T05:00:00.000Z',
          }),
          workItem('WI-099004', {
            kind: 'delegated',
            assignmentId: workAssignments[0]!.id,
            status: 'completed',
            completedAt: '2026-11-12T06:00:00.000Z',
          }),
        ],
        invoices: [],
        paymentReceipts: [],
      },
      { now: () => NOW },
    );

  const report = (repository: InMemoryCrmRepository, ctx: RepositoryContext, kind: ReportPeriodKind, date: string) =>
    repository.getPracticeReport(ctx, resolveReportPeriod(kind, date));

  it('counts completed work on the Kolkata calendar: completion by approval, or by closing when there is no approval', async () => {
    const repository = buildWork();
    const completed = async (kind: ReportPeriodKind, date: string) =>
      (await report(repository, founderCtx, kind, date)).workProgress.summary.completed;

    expect(await completed('day', '2026-11-09')).toBe(0);
    expect(await completed('day', '2026-11-10')).toBe(2);
    expect(await completed('day', '2026-11-11')).toBe(1);
    expect(await completed('week', '2026-11-13')).toBe(3);
    expect(await completed('week', '2026-11-16')).toBe(0);
    expect(await completed('week', '2026-11-08')).toBe(0);
    expect(await completed('month', '2026-11-20')).toBe(3);
    expect(await completed('month', '2026-12-01')).toBe(0);
    expect(await completed('month', '2026-10-31')).toBe(0);
  });

  it('counts created and submitted work in their own periods', async () => {
    const repository = buildWork();
    const month = (await report(repository, founderCtx, 'month', '2026-11-14')).workProgress.summary;
    expect(month).toMatchObject({ created: 3, completed: 3, submittedForReview: 1 });
    expect((await report(repository, founderCtx, 'month', '2026-10-14')).workProgress.summary).toMatchObject({
      created: 4,
      completed: 0,
      submittedForReview: 0,
    });
    expect((await report(repository, founderCtx, 'week', '2026-11-14')).workProgress.summary.submittedForReview).toBe(0);
    expect((await report(repository, founderCtx, 'week', '2026-11-16')).workProgress.summary.submittedForReview).toBe(1);
  });

  it('reports overdue and due-soon work as at now, with the breakdowns and the overdue list', async () => {
    const repository = buildWork();
    const result = (await report(repository, founderCtx, 'month', '2026-11-14')).workProgress;

    expect(result.summary).toMatchObject({ overdueNow: 1, dueNext7Days: 1 });
    expect(result.byService).toEqual([
      { serviceName: 'GST Compliance', created: 3, completed: 3, openNow: 1, overdueNow: 0 },
      { serviceName: 'Internal Audit', created: 0, completed: 0, openNow: 1, overdueNow: 1 },
      { serviceName: 'Statutory Audit', created: 0, completed: 0, openNow: 1, overdueNow: 0 },
    ]);
    expect(result.byOwner).toEqual([
      { ownerName: 'Ananya Rao', created: 0, completed: 0, openNow: 1, overdueNow: 0 },
      { ownerName: 'Priya Desai', created: 0, completed: 0, openNow: 1, overdueNow: 1 },
      { ownerName: 'Rohan Mehta', created: 3, completed: 3, openNow: 1, overdueNow: 0 },
    ]);
    expect(result.overdueList).toEqual([
      {
        assignmentCode: 'AS-099004',
        title: template.title,
        clientName: 'Aster Foods',
        ownerName: 'Priya Desai',
        dueDate: '2026-11-12',
        daysOverdue: 2,
      },
    ]);
  });

  it('lists at most 25 overdue assignments, the most overdue first', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      assignment(`AS-098${String(index).padStart(3, '0')}`, {
        status: 'in_progress',
        dueAt: new Date(Date.UTC(2026, 10, 13, 6, 30) - index * 3600000).toISOString(),
      }),
    );
    const repository = new InMemoryCrmRepository({ ...createDemoSeed(NOW), assignments: many }, { now: () => NOW });
    const list = (await report(repository, founderCtx, 'day', '2026-11-14')).workProgress.overdueList;
    expect(list).toHaveLength(25);
    expect(list[0]?.assignmentCode).toBe('AS-098029');
    expect(list[24]?.assignmentCode).toBe('AS-098005');
  });

  it('gives leadership a row per active employee and everyone else only their own row', async () => {
    const repository = buildWork();
    const founderRows = (await report(repository, founderCtx, 'week', '2026-11-13')).teamActivity;
    expect(founderRows.map((row) => [row.name, row.role])).toEqual([
      ['S. Narayanan', 'founder'],
      ['Priya Desai', 'manager'],
      ['Ananya Rao', 'senior_staff'],
      ['Rohan Mehta', 'staff'],
      ['Neha Kapoor', 'trainee'],
    ]);
    expect(founderRows.find((row) => row.role === 'staff')).toMatchObject({ assignmentsCompleted: 3, submittedForReview: 0 });
    expect((await report(repository, founderCtx, 'week', '2026-11-16')).teamActivity.find((row) => row.role === 'staff')).toMatchObject({
      assignmentsCompleted: 0,
      submittedForReview: 1,
    });

    expect((await report(repository, staffCtx, 'week', '2026-11-13')).teamActivity.map((row) => row.role)).toEqual(['staff']);
    expect((await report(repository, seniorCtx, 'week', '2026-11-13')).teamActivity.map((row) => row.role)).toEqual(['senior_staff']);
  });

  it('keeps personal tasks out of the open counts but counts them when completed', async () => {
    const repository = buildWork();
    const ownRow = (await report(repository, staffCtx, 'week', '2026-11-13')).teamActivity[0]!;
    // One open overdue internal task; the private open task is not counted; the private and the delegated task were completed
    expect(ownRow).toMatchObject({ tasksOpen: 1, tasksOverdue: 1, tasksCompleted: 2, reviewsDone: 0 });
    const leadershipRow = (await report(repository, founderCtx, 'week', '2026-11-13')).teamActivity.find((row) => row.role === 'staff')!;
    expect(leadershipRow).toMatchObject({ tasksOpen: 1, tasksOverdue: 1 });
  });

  it('limits Staff to the assignments they are involved in', async () => {
    const repository = buildWork();
    const result = (await report(repository, staffCtx, 'month', '2026-11-14')).workProgress;
    expect(result.summary).toMatchObject({ overdueNow: 0, dueNext7Days: 0, created: 3, completed: 3 });
    expect(result.byOwner.map((row) => row.ownerName)).toEqual(['Rohan Mehta']);
    expect(result.overdueList).toEqual([]);
  });

  describe('fees and follow-ups', () => {
    let current = NOW;
    const buildFees = () => {
      current = NOW;
      return new InMemoryCrmRepository(
        { ...createDemoSeed(NOW), assignments: workAssignments, workItems: [], invoices: [], paymentReceipts: [] },
        { now: () => current },
      );
    };
    const bill = (number: string, overrides: Partial<RecordVyaparBillCommand>): RecordVyaparBillCommand => ({
      clientId: BLUEPEAK,
      vyaparBillNumber: number,
      billDate: '2026-11-02',
      dueDate: '2026-11-10',
      amountPaise: 1000000,
      description: 'Retainer fee',
      idempotencyKey: `bill-${number}`,
      ...overrides,
    });
    const pay = (invoiceId: string, amountPaise: number, receivedOn: string): RecordPaymentCommand => ({
      invoiceId,
      receivedOn,
      amountPaise,
      method: 'upi',
      idempotencyKey: `pay-${invoiceId}-${receivedOn}`,
    });
    const message = (overrides: Partial<RecordClientMessageCommand> = {}): RecordClientMessageCommand => ({
      clientId: BLUEPEAK,
      recipientName: 'Rahul Shah',
      recipientNumber: '919820012345',
      purpose: 'payment_reminder',
      body: 'Dear Rahul, ',
      idempotencyKey: `msg-${Math.random()}`,
      ...overrides,
    });

    async function withBills() {
      const repository = buildFees();
      const november = await repository.recordVyaparBill(founderCtx, bill('VYP-1', {}));
      const october = await repository.recordVyaparBill(
        founderCtx,
        bill('VYP-2', { billDate: '2026-10-20', dueDate: '2026-12-01', amountPaise: 500000 }),
      );
      await repository.recordPayment(founderCtx, pay(november.id, 300000, '2026-11-12'));
      await repository.recordPayment(founderCtx, pay(october.id, 800000, '2026-11-13')); // 3,00,000 left over as credit
      return repository;
    }

    it('totals bills by issue date, payments by received date, and pending, overdue and credit as at now', async () => {
      const repository = await withBills();
      const row = {
        clientCode: 'CL-001002',
        clientName: 'BluePeak Tech',
        billedPaise: 1000000,
        receivedPaise: 1100000,
        pendingNowPaise: 700000,
        overdueNowPaise: 700000,
        creditPaise: 300000,
      };

      const november = (await report(repository, founderCtx, 'month', '2026-11-14')).fees!;
      expect(november.summary).toEqual({
        billsRecorded: 1,
        billedPaise: 1000000,
        paymentsReceived: 2,
        receivedPaise: 1100000,
        pendingNowPaise: 700000,
        overdueNowPaise: 700000,
        creditHeldPaise: 300000,
      });
      expect(november.byClient).toEqual([row]);

      // October: only the bill issued then; the now-figures and the credit do not depend on the period
      const october = (await report(repository, founderCtx, 'month', '2026-10-14')).fees!;
      expect(october.summary).toMatchObject({ billsRecorded: 1, billedPaise: 500000, paymentsReceived: 0, receivedPaise: 0, pendingNowPaise: 700000 });
      expect(october.byClient).toEqual([{ ...row, billedPaise: 500000, receivedPaise: 0 }]);

      // A week with no bills or payments still shows what is pending and held
      const quiet = (await report(repository, founderCtx, 'week', '2026-11-23')).fees!;
      expect(quiet.summary).toMatchObject({ billsRecorded: 0, paymentsReceived: 0, pendingNowPaise: 700000, creditHeldPaise: 300000 });

      expect((await report(repository, staffCtx, 'month', '2026-11-14')).fees!.byClient).toEqual([row]);
      expect((await report(repository, seniorCtx, 'month', '2026-11-14')).fees).toEqual({
        summary: {
          billsRecorded: 0,
          billedPaise: 0,
          paymentsReceived: 0,
          receivedPaise: 0,
          pendingNowPaise: 0,
          overdueNowPaise: 0,
          creditHeldPaise: 0,
        },
        byClient: [],
      });
    });

    it('lists clients with overdue work or fees and no message in 14 days, most overdue fees first, for the people who look after them', async () => {
      const repository = await withBills();
      const needs = async (ctx: RepositoryContext) => (await report(repository, ctx, 'day', '2026-11-14')).followUps.needsFollowUp;

      expect(await needs(founderCtx)).toEqual([
        { clientCode: 'CL-001002', clientName: 'BluePeak Tech', overdueAssignments: 0, overdueFeesPaise: 700000, lastMessageAt: null },
        { clientCode: 'CL-001001', clientName: 'Aster Foods', overdueAssignments: 1, overdueFeesPaise: 0, lastMessageAt: null },
      ]);
      expect((await needs(staffCtx)).map((row) => row.clientCode)).toEqual(['CL-001002']);
      // Senior Staff look after Aster but are not involved in its overdue assignment, so it is not overdue work they can see
      expect(await needs(seniorCtx)).toEqual([]);
      expect(await needs(traineeCtx)).toEqual([]);

      // A message 20 days ago is too old to count
      current = new Date('2026-10-25T10:00:00.000Z');
      await repository.recordClientMessage(staffCtx, message());
      current = NOW;
      expect((await needs(founderCtx))[0]).toMatchObject({ clientCode: 'CL-001002', lastMessageAt: '2026-10-25T10:00:00.000Z' });

      // A message 4 days ago takes the client off the list
      current = new Date('2026-11-10T10:00:00.000Z');
      await repository.recordClientMessage(staffCtx, message());
      current = NOW;
      expect((await needs(founderCtx)).map((row) => row.clientCode)).toEqual(['CL-001001']);
    });

    it('counts messages by purpose and documents by category for the period only', async () => {
      const repository = await withBills();
      current = new Date('2026-10-25T10:00:00.000Z');
      await repository.recordClientMessage(staffCtx, message({ purpose: 'deadline_reminder' }));
      current = new Date('2026-11-10T10:00:00.000Z');
      await repository.recordClientMessage(staffCtx, message({ purpose: 'payment_reminder' }));
      await repository.recordClientMessage(staffCtx, message({ purpose: 'payment_reminder' }));
      await repository.recordClientMessage(staffCtx, message({ purpose: 'general' }));
      current = new Date('2026-11-11T10:00:00.000Z');
      const doc = await repository.createClientDocument(staffCtx, {
        clientId: BLUEPEAK,
        title: 'Board resolution',
        category: 'agreements',
        financialYearStart: 2026,
        fileName: 'resolution.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        idempotencyKey: 'doc-1',
      });
      await repository.createClientDocument(staffCtx, {
        clientId: BLUEPEAK,
        title: 'Still uploading',
        category: 'kyc',
        fileName: 'kyc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        idempotencyKey: 'doc-2',
      });
      repository.markObjectUploaded(doc.storagePath, 900);
      await repository.confirmClientDocument(staffCtx, { id: doc.id, idempotencyKey: 'confirm-1' });
      current = NOW;

      const november = (await report(repository, founderCtx, 'month', '2026-11-14')).followUps;
      expect(november.messagesByPurpose).toEqual([
        { purpose: 'payment_reminder', count: 2 },
        { purpose: 'general', count: 1 },
      ]);
      // The document still waiting for its upload is not counted
      expect(november.documentsByCategory).toEqual([{ category: 'agreements', count: 1 }]);

      const october = (await report(repository, founderCtx, 'month', '2026-10-14')).followUps;
      expect(october.messagesByPurpose).toEqual([{ purpose: 'deadline_reminder', count: 1 }]);
      expect(october.documentsByCategory).toEqual([]);

      // Senior Staff do not look after BluePeak, so they see none of it
      expect((await report(repository, seniorCtx, 'month', '2026-11-14')).followUps.messagesByPurpose).toEqual([]);
    });
  });

  it('returns an empty report for an unknown actor', async () => {
    const repository = buildWork();
    const result = await report(repository, { actorId: '00000000-0000-4000-a000-0000000000ff' }, 'day', '2026-11-14');
    expect(result.teamActivity).toEqual([]);
    expect(result.workProgress.summary).toEqual({ created: 0, completed: 0, submittedForReview: 0, overdueNow: 0, dueNext7Days: 0 });
    expect(result.followUps).toEqual({ messagesByPurpose: [], documentsByCategory: [], needsFollowUp: [] });
  });
});

describe('InMemoryCrmRepository departments (DEPT-01)', () => {
  const founderCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };
  const seniorCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.senior };
  const staffCtx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.staff };
  const AUDIT_SERVICE = '50000000-0000-4000-a000-000000000002';
  const AUDIT_ASSIGNMENT = '30000000-0000-4000-a000-000000000002';
  const BLUEPEAK = '10000000-0000-4000-a000-000000000002';
  const AUDIT_DEPARTMENT = '60000000-0000-4000-a000-000000000001';

  /** The demo seed with Internal Audit filed under an Audit department that Ananya heads and Rohan belongs to. */
  function build(options: { headIsActive?: boolean; auditIsActive?: boolean } = {}) {
    const seed = createDemoSeed();
    seed.services = (seed.services ?? []).map((service) =>
      service.id === AUDIT_SERVICE ? { ...service, departmentId: AUDIT_DEPARTMENT } : service,
    );
    seed.departments = [
      {
        id: AUDIT_DEPARTMENT,
        name: 'Audit',
        isActive: options.auditIsActive ?? true,
        members: [
          { userId: DEMO_ACTOR_IDS.senior, isHead: true },
          { userId: DEMO_ACTOR_IDS.staff, isHead: false },
          { userId: DEMO_ACTOR_IDS.trainee, isHead: false },
        ],
      },
    ];
    if (options.headIsActive === false) {
      seed.employees = seed.employees.map((e) => (e.id === DEMO_ACTOR_IDS.senior ? { ...e, active: false } : e));
    }
    return new InMemoryCrmRepository(seed);
  }

  it('reads the seeded departments with their members, heads and service ids, active first', async () => {
    const departments = await build().listDepartments(founderCtx);
    expect(departments).toHaveLength(1);
    expect(departments[0]).toMatchObject({
      id: AUDIT_DEPARTMENT,
      name: 'Audit',
      isActive: true,
      serviceIds: [AUDIT_SERVICE],
    });
    expect(departments[0]?.members.map((m) => [m.name, m.role, m.isHead])).toEqual([
      ['Ananya Rao', 'senior_staff', true],
      ['Neha Kapoor', 'trainee', false],
      ['Rohan Mehta', 'staff', false],
    ]);
    expect((await build().listServiceCatalog(founderCtx)).find((s) => s.id === AUDIT_SERVICE)).toMatchObject({
      departmentId: AUDIT_DEPARTMENT,
      departmentName: 'Audit',
    });
  });

  it('lets the head read the clients of their department work, and nobody else gains a client', async () => {
    const repository = build();
    const seniorClients = (await repository.listClients(seniorCtx)).map((c) => c.code);
    expect(seniorClients).toContain('CL-001002');
    expect((await repository.getClient(seniorCtx, BLUEPEAK))?.displayName).toBe('BluePeak Tech');
    expect((await repository.listClientReferences(seniorCtx)).map((c) => c.code)).toContain('CL-001002');
    expect(await repository.getClientReference(seniorCtx, BLUEPEAK)).toMatchObject({ code: 'CL-001002' });

    // A trainee member gains nothing new
    const trainee = await repository.listClients({ actorId: DEMO_ACTOR_IDS.trainee });
    expect(trainee.map((c) => c.code)).toEqual(['CL-001001']);
  });

  it('gives the head the client row only: no full PAN or GSTIN and no edit right', async () => {
    const repository = build();
    const client = (await repository.getClient(seniorCtx, BLUEPEAK))!;
    expect(client.pan).toBeNull();
    expect(client.gstin).toBeNull();
    expect(client.canEdit).toBe(false);
    expect(client.activeAssignmentsCount).toBe(1);
    await expect(
      repository.updateClient(seniorCtx, {
        id: BLUEPEAK,
        notes: 'head edit',
        expectedUpdatedAt: client.updatedAt,
        idempotencyKey: 'head-edit',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repository.createClientContact(seniorCtx, {
        clientId: BLUEPEAK,
        name: 'Someone',
        phone: '9820011002',
        idempotencyKey: 'head-contact',
      }),
    ).rejects.toMatchObject({ status: 403 });
    // Fees, documents and messages still follow "looks after the client"
    expect((await repository.listInvoices(seniorCtx)).filter((i) => i.clientId === BLUEPEAK)).toEqual([]);
    expect(await repository.listClientMessages(seniorCtx, BLUEPEAK)).toEqual([]);
    expect(await repository.listClientDocuments(seniorCtx, BLUEPEAK)).toEqual([]);
  });

  it('counts the department work in the head report, and drops it when the department is retired', async () => {
    const period = resolveReportPeriod('month', '2026-11-14');
    const serviceNames = async (repository: InMemoryCrmRepository, ctx: RepositoryContext) =>
      (await repository.getPracticeReport(ctx, period)).workProgress.byService.map((row) => row.serviceName);

    expect(await serviceNames(build(), seniorCtx)).toContain('Internal Audit');
    expect(await serviceNames(new InMemoryCrmRepository(createDemoSeed()), seniorCtx)).not.toContain('Internal Audit');
    expect(await serviceNames(build({ auditIsActive: false }), seniorCtx)).not.toContain('Internal Audit');
  });

  it('gives nothing to a head of an inactive department, an inactive head or a member who is not a head', async () => {
    const inactiveDepartment = build({ auditIsActive: false });
    expect(await inactiveDepartment.getClient(seniorCtx, BLUEPEAK)).toBeNull();

    const inactiveHead = build({ headIsActive: false });
    expect(await inactiveHead.listClients(seniorCtx)).toEqual([]);

    const member = build();
    expect(await member.getClient({ actorId: DEMO_ACTOR_IDS.trainee }, BLUEPEAK)).toBeNull();
  });

  it('stops the head path when the head flag is removed or the service leaves the department', async () => {
    const repository = build();
    expect(await repository.getClient(seniorCtx, BLUEPEAK)).not.toBeNull();

    await repository.setDepartmentMembers(founderCtx, {
      id: AUDIT_DEPARTMENT,
      members: [{ userId: DEMO_ACTOR_IDS.senior, isHead: false }],
      idempotencyKey: 'demote',
    });
    expect(await repository.getClient(seniorCtx, BLUEPEAK)).toBeNull();

    await repository.setDepartmentMembers(founderCtx, {
      id: AUDIT_DEPARTMENT,
      members: [{ userId: DEMO_ACTOR_IDS.senior, isHead: true }],
      idempotencyKey: 'promote',
    });
    expect(await repository.getClient(seniorCtx, BLUEPEAK)).not.toBeNull();

    const service = (await repository.listServiceCatalog(founderCtx)).find((s) => s.id === AUDIT_SERVICE)!;
    await repository.updateService(founderCtx, {
      id: AUDIT_SERVICE,
      departmentId: null,
      expectedUpdatedAt: service.updatedAt,
      idempotencyKey: 'unfile',
    });
    expect(await repository.getClient(seniorCtx, BLUEPEAK)).toBeNull();
    // The assignment itself is untouched in the store
    expect((await repository.getAssignment(founderCtx, AUDIT_ASSIGNMENT))?.serviceId).toBe(AUDIT_SERVICE);
  });

  it('refuses members who are inactive or trainee heads and leaves the membership as it was', async () => {
    const repository = build();
    const staff = (await repository.getEmployee(founderCtx, DEMO_ACTOR_IDS.staff))!;
    await repository.upsertDevActor({ ...staff, active: false });

    await expect(
      repository.setDepartmentMembers(founderCtx, {
        id: AUDIT_DEPARTMENT,
        members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: false }],
        idempotencyKey: 'inactive',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'referenced_entity_not_found' });
    await expect(
      repository.setDepartmentMembers(founderCtx, {
        id: AUDIT_DEPARTMENT,
        members: [{ userId: DEMO_ACTOR_IDS.trainee, isHead: true }],
        idempotencyKey: 'trainee-head',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'trainee_cannot_head' });
    // An inactive person disappears from the member list; the refused changes left the rest alone
    const [department] = await repository.listDepartments(founderCtx);
    expect(department?.members.map((m) => m.name)).toEqual(['Ananya Rao', 'Neha Kapoor']);
  });

  it('shows a staff head the clients of their department work too', async () => {
    const seed = createDemoSeed();
    seed.services = (seed.services ?? []).map((service) =>
      service.id === '50000000-0000-4000-a000-000000000003' ? { ...service, departmentId: AUDIT_DEPARTMENT } : service,
    );
    seed.departments = [{ id: AUDIT_DEPARTMENT, name: 'TDS', members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: true }] }];
    const repository = new InMemoryCrmRepository(seed);
    // AS-001003 belongs to Sharma Retail (Manager owns, Senior reviews); Staff has no other link to it
    expect((await repository.listClients(staffCtx)).map((c) => c.code)).toContain('CL-001003');
  });
});
