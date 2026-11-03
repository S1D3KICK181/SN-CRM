import { describe, expect, it } from 'vitest';
import { createDemoSeed, DEMO_ACTOR_IDS } from './demo-seed';
import { InMemoryCrmRepository } from './in-memory-repository';
import type { EmployeeRecord, RepositoryContext } from './repository';

describe('InMemoryCrmRepository Contract and Isolation', () => {
  const ctx: RepositoryContext = { actorId: DEMO_ACTOR_IDS.founder };

  it('implements DevActorDirectory without requiring repository context', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());

    const actors = await repository.listDevActors();
    expect(actors.length).toBeGreaterThan(0);
    expect(actors.find((a) => a.id === DEMO_ACTOR_IDS.founder)?.role).toBe('founder');

    const single = await repository.resolveDevActor(DEMO_ACTOR_IDS.manager);
    expect(single?.name).toBe('Ananya Rao');

    const missing = await repository.resolveDevActor('usr_nonexistent');
    expect(missing).toBeNull();
  });

  it('strictly requires RepositoryContext on concrete saveEmployee at compile-time and runtime', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const input: EmployeeRecord = {
      id: 'usr_ctx_check',
      name: 'Context Enforcement Employee',
      role: 'staff',
      reportsToId: null,
      active: true,
    };

    // Compile-time / type-level assertion: saveEmployee strictly requires exactly [RepositoryContext, EmployeeRecord]
    type SaveEmployeeParams = Parameters<InMemoryCrmRepository['saveEmployee']>;
    type AssertHasTwoParams = SaveEmployeeParams extends [RepositoryContext, EmployeeRecord]
      ? [RepositoryContext, EmployeeRecord] extends SaveEmployeeParams
        ? true
        : false
      : false;
    const _isStrictTwoParams: AssertHasTwoParams = true;
    expect(_isStrictTwoParams).toBe(true);

    // Typed usage / compile-time assertion: single-argument call is rejected by compiler
    // @ts-expect-error Expected 2 arguments, but got 1: single-argument saveEmployee must be rejected at compile time
    await expect(repository.saveEmployee(input)).rejects.toThrow();

    const saved = await repository.saveEmployee(ctx, input);
    expect(saved.id).toBe(input.id);
  });

  it('saveEmployee clones into storage and returns a detached clone', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const input: EmployeeRecord = {
      id: 'usr_new_test',
      name: 'Original Input Name',
      role: 'staff',
      reportsToId: null,
      active: true,
    };

    const returned = await repository.saveEmployee(ctx, input);

    // 1. Reference inequality: returned !== input
    expect(returned).not.toBe(input);

    // 2. Reference inequality: returned !== entity fetched afterward
    const stored = await repository.getEmployee(ctx, input.id);
    expect(stored).not.toBeNull();
    expect(returned).not.toBe(stored);
    expect(input).not.toBe(stored);

    // 3. Mutating input leaves returned holding original canonical value and stored unchanged
    input.name = 'Mutated Input Name';
    expect(returned.name).toBe('Original Input Name');
    const storedAfterInputMutation = await repository.getEmployee(ctx, input.id);
    expect(storedAfterInputMutation?.name).toBe('Original Input Name');

    // 4. Mutating returned leaves stored state unchanged
    returned.name = 'Mutated Returned Name';
    const storedAfterReturnedMutation = await repository.getEmployee(ctx, input.id);
    expect(storedAfterReturnedMutation?.name).toBe('Original Input Name');
  });

  it('saveAssignment clones into storage and returns a detached clone (including nested reviewerIds)', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const input = {
      id: 'asg_clone_test',
      code: 'ASN-CLONE-0001',
      clientId: 'cli_mehta',
      clientName: 'Mehta Industries',
      title: 'Original Title',
      service: 'Statutory audit',
      ownerId: DEMO_ACTOR_IDS.senior,
      reviewerIds: [DEMO_ACTOR_IDS.manager] as string[],
      status: 'open' as const,
      dueAt: '2026-11-15T12:00:00.000Z',
      recurringScheduleId: null,
      createdById: DEMO_ACTOR_IDS.manager,
      createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
    };

    const returned = await repository.saveAssignment(ctx, input);

    // 1. Reference inequalities: returned !== input and returned !== entity fetched afterward
    expect(returned).not.toBe(input);
    const stored = await repository.getAssignment(ctx, input.id);
    expect(stored).not.toBeNull();
    expect(returned).not.toBe(stored);
    expect(input).not.toBe(stored);

    // 2. Mutating input (including nested reviewerIds) leaves returned and stored unchanged
    input.title = 'Mutated Input Title';
    input.reviewerIds.push('usr_input_intruder');
    expect(returned.title).toBe('Original Title');
    expect(returned.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);
    const stored1 = await repository.getAssignment(ctx, input.id);
    expect(stored1?.title).toBe('Original Title');
    expect(stored1?.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);

    // 3. Mutating returned (including nested reviewerIds) leaves stored state unchanged
    returned.title = 'Mutated Returned Title';
    returned.reviewerIds.push('usr_returned_intruder');
    const stored2 = await repository.getAssignment(ctx, input.id);
    expect(stored2?.title).toBe('Original Title');
    expect(stored2?.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);
  });

  it('saveRecurringSchedule clones into storage and returns a detached clone (including nested reviewerIds)', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const input = {
      id: 'sch_clone_test',
      clientId: 'cli_mehta',
      clientName: 'Mehta Industries',
      title: 'Original Schedule Title',
      service: 'GST compliance',
      cadence: 'monthly' as const,
      ownerId: DEMO_ACTOR_IDS.senior,
      reviewerIds: [DEMO_ACTOR_IDS.manager] as string[],
      nextOccurrenceOn: '2026-11-20',
      dueDay: 20,
      active: true,
      createdById: DEMO_ACTOR_IDS.manager,
      createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
    };

    const returned = await repository.saveRecurringSchedule(ctx, input);

    // 1. Reference inequalities: returned !== input and returned !== entity fetched afterward
    expect(returned).not.toBe(input);
    const stored = await repository.getRecurringSchedule(ctx, input.id);
    expect(stored).not.toBeNull();
    expect(returned).not.toBe(stored);
    expect(input).not.toBe(stored);

    // 2. Mutating input (including nested reviewerIds) leaves returned and stored unchanged
    input.title = 'Mutated Input Title';
    input.reviewerIds.push('usr_input_intruder');
    expect(returned.title).toBe('Original Schedule Title');
    expect(returned.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);
    const stored1 = await repository.getRecurringSchedule(ctx, input.id);
    expect(stored1?.title).toBe('Original Schedule Title');
    expect(stored1?.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);

    // 3. Mutating returned (including nested reviewerIds) leaves stored state unchanged
    returned.title = 'Mutated Returned Title';
    returned.reviewerIds.push('usr_returned_intruder');
    const stored2 = await repository.getRecurringSchedule(ctx, input.id);
    expect(stored2?.title).toBe('Original Schedule Title');
    expect(stored2?.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);
  });

  it('saveWorkItem clones into storage and returns a detached clone', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const input = {
      id: 'wrk_clone_test',
      kind: 'personal' as const,
      title: 'Original Task Title',
      notes: null,
      assignmentId: null,
      relatedClientId: null,
      relatedPartyName: null,
      assigneeId: DEMO_ACTOR_IDS.staff,
      createdById: DEMO_ACTOR_IDS.staff,
      status: 'todo' as const,
      dueAt: '2026-11-10T12:00:00.000Z',
      reminderAt: null,
      createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
    };

    const returned = await repository.saveWorkItem(ctx, input);

    // 1. Reference inequalities: returned !== input and returned !== entity fetched afterward
    expect(returned).not.toBe(input);
    const stored = await repository.getWorkItem(ctx, input.id);
    expect(stored).not.toBeNull();
    expect(returned).not.toBe(stored);
    expect(input).not.toBe(stored);

    // 2. Mutating input leaves returned holding original canonical value and stored unchanged
    input.title = 'Mutated Input Title';
    expect(returned.title).toBe('Original Task Title');
    const stored1 = await repository.getWorkItem(ctx, input.id);
    expect(stored1?.title).toBe('Original Task Title');

    // 3. Mutating returned leaves stored state unchanged
    returned.title = 'Mutated Returned Title';
    const stored2 = await repository.getWorkItem(ctx, input.id);
    expect(stored2?.title).toBe('Original Task Title');
  });

  it('saveLedgerEntry clones into storage and returns a detached clone', async () => {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const input = {
      id: 'led_clone_test',
      occurredOn: '2026-10-30',
      account: 'cash' as const,
      direction: 'inflow' as const,
      amountPaise: 50000,
      narration: 'Original Narration',
      reference: null,
      recordedById: DEMO_ACTOR_IDS.founder,
      createdAt: '2026-10-30T12:00:00.000Z',
    };

    const returned = await repository.saveLedgerEntry(ctx, input);

    // 1. Reference inequalities: returned !== input and returned !== entity listed afterward
    expect(returned).not.toBe(input);
    const all = await repository.listLedgerEntries(ctx);
    const stored = all.find((e) => e.id === input.id);
    expect(stored).toBeDefined();
    expect(returned).not.toBe(stored);
    expect(input).not.toBe(stored);

    // 2. Mutating input leaves returned holding original canonical value and stored unchanged
    input.narration = 'Mutated Narration';
    expect(returned.narration).toBe('Original Narration');
    const all1 = await repository.listLedgerEntries(ctx);
    const stored1 = all1.find((e) => e.id === input.id);
    expect(stored1?.narration).toBe('Original Narration');

    // 3. Mutating returned leaves stored state unchanged
    returned.narration = 'Mutated Returned Narration';
    const all2 = await repository.listLedgerEntries(ctx);
    const stored2 = all2.find((e) => e.id === input.id);
    expect(stored2?.narration).toBe('Original Narration');
  });

  it('mutating seed data after constructor or mutating returned list elements cannot alter repository storage', async () => {
    const seed = createDemoSeed();
    const repository = new InMemoryCrmRepository(seed);

    // 1. Mutate seed data after constructor
    const seedEmployee = seed.employees[0];
    expect(seedEmployee).toBeDefined();
    const seedEmployeeId = seedEmployee!.id;
    const originalEmployeeName = seedEmployee!.name;
    seedEmployee!.name = 'Mutated Post-Constructor Seed Name';

    const seedAssignment = seed.assignments[0];
    expect(seedAssignment).toBeDefined();
    const seedAssignmentId = seedAssignment!.id;
    const originalAssignmentTitle = seedAssignment!.title;
    seedAssignment!.title = 'Mutated Post-Constructor Seed Title';

    const devActor = await repository.resolveDevActor(seedEmployeeId);
    expect(devActor?.name).toBe(originalEmployeeName);

    const assignment = await repository.getAssignment(ctx, seedAssignmentId);
    expect(assignment?.title).toBe(originalAssignmentTitle);

    // 2. Mutate an element from a returned list
    const list = await repository.listAssignments(ctx);
    expect(list.length).toBeGreaterThan(0);
    const firstItem = list[0]!;
    const originalFirstTitle = firstItem.title;
    const originalReviewerCount = firstItem.reviewerIds.length;

    firstItem.title = 'Mutated In-Memory List Item Title';
    firstItem.reviewerIds.push('usr_list_mutation_intruder');

    const fetchedDirectly = await repository.getAssignment(ctx, firstItem.id);
    expect(fetchedDirectly?.title).toBe(originalFirstTitle);
    expect(fetchedDirectly?.reviewerIds.length).toBe(originalReviewerCount);
    expect(fetchedDirectly?.reviewerIds).not.toContain('usr_list_mutation_intruder');

    const fetchedListAgain = await repository.listAssignments(ctx);
    expect(fetchedListAgain[0]?.title).toBe(originalFirstTitle);
    expect(fetchedListAgain[0]?.reviewerIds.length).toBe(originalReviewerCount);
    expect(fetchedListAgain[0]?.reviewerIds).not.toContain('usr_list_mutation_intruder');
  });
});

