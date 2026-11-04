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
      name: 'Aster Foods Private Limited',
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
      clientName: 'Aster Foods Private Limited',
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
      clientName: 'BluePeak Technologies LLP',
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
