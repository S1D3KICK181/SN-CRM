import { describe, expect, it, vi } from "vitest";
import * as domain from "@sn/domain";
import type {
  AssignmentDto,
  ClientDto,
  CreateAssignmentInput,
  CreateDocumentInput,
  CreateRecurringScheduleInput,
  LedgerEntryDto,
  RecordClientMessageInput,
  RecordPaymentInput,
  RecordVyaparBillInput,
  RecurringScheduleDto,
  ReportingLineDto,
  WorkItemDto,
} from "@sn/contracts";
import { CrmApplication } from "./application";
import { createDemoSeed, DEMO_ACTOR_IDS } from "./demo-seed";
import { InMemoryCrmRepository } from "./in-memory-repository";
import type {
  AssignmentRecord,
  ClientReference,
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmApplicationDependencies,
  EmployeeRecord,
  MutateEngagementCommand,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentReviewersCommand,
  UpdateAssignmentStatusCommand,
  UpdateWorkItemStatusCommand,
} from "./repository";

const ROLE_CASES = [
  ["founder", DEMO_ACTOR_IDS.founder],
  ["manager", DEMO_ACTOR_IDS.manager],
  ["senior_staff", DEMO_ACTOR_IDS.senior],
  ["staff", DEMO_ACTOR_IDS.staff],
  ["trainee", DEMO_ACTOR_IDS.trainee],
] as const;

const CANONICAL_ASSIGNMENT_1 = "30000000-0000-4000-a000-000000000001";
const CANONICAL_ASSIGNMENT_2 = "30000000-0000-4000-a000-000000000002";
const CANONICAL_ASSIGNMENT_3 = "30000000-0000-4000-a000-000000000003";
const CANONICAL_CLIENT_1 = "10000000-0000-4000-a000-000000000001";
const CANONICAL_SERVICE_1 = "50000000-0000-4000-a000-000000000001";
const CANONICAL_WORK_ITEM_1 = "40000000-0000-4000-a000-000000000001";

function createFixture() {
  let id = 0;
  const repository = new InMemoryCrmRepository(createDemoSeed());
  const application = new CrmApplication(repository, {
    now: () => new Date("2026-10-30T12:00:00.000Z"),
    createId: (prefix = "entity") => `00000000-0000-4000-e000-${String(++id).padStart(12, "0")}`,
  });
  return { application, repository };
}

describe("CrmApplication authority and workflow rules", () => {
  it.each([
    [
      DEMO_ACTOR_IDS.founder,
      [
        "30000000-0000-4000-a000-000000000001",
        "30000000-0000-4000-a000-000000000004",
        "30000000-0000-4000-a000-000000000002",
        "30000000-0000-4000-a000-000000000003",
        "30000000-0000-4000-a000-000000000006",
        "30000000-0000-4000-a000-000000000005",
      ],
    ],
    [
      DEMO_ACTOR_IDS.manager,
      [
        "30000000-0000-4000-a000-000000000001",
        "30000000-0000-4000-a000-000000000004",
        "30000000-0000-4000-a000-000000000002",
        "30000000-0000-4000-a000-000000000003",
        "30000000-0000-4000-a000-000000000006",
        "30000000-0000-4000-a000-000000000005",
      ],
    ],
    [
      DEMO_ACTOR_IDS.senior,
      [
        "30000000-0000-4000-a000-000000000001",
        "30000000-0000-4000-a000-000000000004",
        "30000000-0000-4000-a000-000000000003",
        "30000000-0000-4000-a000-000000000005",
      ],
    ],
    [
      DEMO_ACTOR_IDS.staff,
      [
        "30000000-0000-4000-a000-000000000004",
        "30000000-0000-4000-a000-000000000002",
      ],
    ],
    [
      DEMO_ACTOR_IDS.trainee,
      [
        "30000000-0000-4000-a000-000000000001",
      ],
    ],
  ] as const)("shows %s only the Assignments in their scope", async (actorId, expectedIds) => {
    const { application } = createFixture();
    const currentActor = await application.requireActor(actorId);

    expect(
      (await application.listAssignments(currentActor)).map((assignment) => assignment.id),
    ).toEqual(expectedIds);
  });

  it("allows only leadership to create a client Assignment and purges clientName input", async () => {
    const { application } = createFixture();
    const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);

    await expect(
      application.createAssignment(staff, {
        clientId: CANONICAL_CLIENT_1,
        title: "Annual return",
        serviceId: CANONICAL_SERVICE_1,
        ownerId: DEMO_ACTOR_IDS.staff,
        dueAt: "2026-12-01T12:30:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });

    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
    const created = await application.createAssignment(manager, {
      clientId: CANONICAL_CLIENT_1,
      title: "Annual return",
      serviceId: CANONICAL_SERVICE_1,
      ownerId: DEMO_ACTOR_IDS.staff,
      reviewerIds: [DEMO_ACTOR_IDS.manager],
      dueAt: "2026-12-01T12:30:00.000Z",
    });
    expect(created).toMatchObject({
      ownerId: DEMO_ACTOR_IDS.staff,
      status: "assigned",
      clientName: "Aster Foods",
    });
  });

  it("enforces downward delegation without changing Assignment ownership", async () => {
    const { application, repository } = createFixture();
    const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);

    const delegated = await application.createWorkItem(staff, {
      kind: "delegated",
      title: "Check challan details",
      assignmentId: CANONICAL_ASSIGNMENT_2,
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-03T12:30:00.000Z",
    });
    expect(delegated).toMatchObject({ kind: "delegated", assigneeId: DEMO_ACTOR_IDS.trainee });
    expect((await repository.getAssignment({ actorId: staff.id }, CANONICAL_ASSIGNMENT_2))?.ownerId).toBe(DEMO_ACTOR_IDS.staff);

    await expect(
      application.createWorkItem(staff, {
        kind: "delegated",
        title: "Review the return",
        assignmentId: CANONICAL_ASSIGNMENT_2,
        assigneeId: DEMO_ACTOR_IDS.senior,
        dueAt: "2026-11-03T12:30:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 403, code: "invalid_delegate_role" });
  });

  it("keeps each role's Personal Tasks private from every other role", async () => {
    const { application } = createFixture();
    const createdByActor = new Map<string, string>();

    for (const [role, actorId] of ROLE_CASES) {
      const currentActor = await application.requireActor(actorId);
      const reminder = await application.createWorkItem(currentActor, {
        kind: "personal",
        title: `${role} private reminder`,
        dueAt: "2026-11-01T05:30:00.000Z",
        reminderAt: "2026-11-01T05:15:00.000Z",
      });
      expect(reminder).toMatchObject({ assigneeId: actorId, createdById: actorId });
      createdByActor.set(actorId, reminder.id);
    }

    for (const [, viewerId] of ROLE_CASES) {
      const viewer = await application.requireActor(viewerId);
      const visibleIds = new Set((await application.listWorkItems(viewer)).map((item) => item.id));
      for (const [, ownerId] of ROLE_CASES) {
        expect(visibleIds.has(createdByActor.get(ownerId)!)).toBe(viewerId === ownerId);
      }
    }
  });

  it.each([
    [DEMO_ACTOR_IDS.founder, true],
    [DEMO_ACTOR_IDS.manager, true],
    [DEMO_ACTOR_IDS.senior, true],
    [DEMO_ACTOR_IDS.staff, false],
    [DEMO_ACTOR_IDS.trainee, true],
  ] as const)("applies delegated-task visibility for %s", async (actorId, expectedVisible) => {
    const { application } = createFixture();
    const currentActor = await application.requireActor(actorId);
    const visibleIds = (await application.listWorkItems(currentActor)).map((item) => item.id);

    expect(visibleIds.includes(CANONICAL_WORK_ITEM_1)).toBe(expectedVisible);
  });

  it.each([
    [DEMO_ACTOR_IDS.founder, true],
    [DEMO_ACTOR_IDS.manager, true],
    [DEMO_ACTOR_IDS.senior, false],
    [DEMO_ACTOR_IDS.staff, true],
    [DEMO_ACTOR_IDS.trainee, false],
  ] as const)("applies Internal Task visibility for %s", async (actorId, expectedVisible) => {
    const { application } = createFixture();
    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
    const item = await application.createWorkItem(manager, {
      kind: "internal",
      title: "Arrange signed files in the records cabinet",
      assigneeId: DEMO_ACTOR_IDS.staff,
      dueAt: "2026-11-02T12:30:00.000Z",
    });
    const currentActor = await application.requireActor(actorId);
    const visibleIds = (await application.listWorkItems(currentActor)).map(
      (workItem) => workItem.id,
    );

    expect(visibleIds.includes(item.id)).toBe(expectedVisible);
  });

  it("requires delegated work to be submitted before its delegator completes it", async () => {
    const { application } = createFixture();
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
    const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

    const item = await application.createWorkItem(senior, {
      kind: "delegated",
      title: "Verify purchase invoices",
      assignmentId: CANONICAL_ASSIGNMENT_1,
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-02T12:30:00.000Z",
    });
    await expect(application.transitionWorkItem(senior, item.id, "complete")).rejects.toMatchObject(
      {
        status: 409,
        code: "invalid_state_transition",
      },
    );
    await application.transitionWorkItem(trainee, item.id, "submit");
    expect(await application.transitionWorkItem(senior, item.id, "complete")).toMatchObject({
      status: "completed",
    });
  });

  it("allows a Manager to maintain lower reporting lines but not leadership reporting lines", async () => {
    const { application } = createFixture();
    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

    const changed = await application.updateReportingLine(
      manager,
      DEMO_ACTOR_IDS.staff,
      DEMO_ACTOR_IDS.founder,
    );
    expect(changed.manager?.id).toBe(DEMO_ACTOR_IDS.founder);
    await expect(
      application.updateReportingLine(manager, DEMO_ACTOR_IDS.manager, DEMO_ACTOR_IDS.founder),
    ).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
  });

  it.each(ROLE_CASES)(
    "%s has the correct reporting-line update authority",
    async (role, actorId) => {
      const { application } = createFixture();
      const currentActor = await application.requireActor(actorId);
      const update = application.updateReportingLine(
        currentActor,
        DEMO_ACTOR_IDS.trainee,
        DEMO_ACTOR_IDS.founder,
      );

      if (role === "founder" || role === "manager") {
        await expect(update).resolves.toMatchObject({
          employee: { id: DEMO_ACTOR_IDS.trainee },
          manager: { id: DEMO_ACTOR_IDS.founder },
        });
      } else {
        await expect(update).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      }
    },
  );

  it.each(ROLE_CASES)(
    "lets %s read the reporting structure without granting edit authority",
    async (_role, actorId) => {
      const { application } = createFixture();
      const currentActor = await application.requireActor(actorId);
      const reportingLines = await application.listReportingLines(currentActor);

      expect(reportingLines).toHaveLength(5);
      expect(
        reportingLines.find((line) => line.employee.id === DEMO_ACTOR_IDS.manager)?.manager?.id,
      ).toBe(DEMO_ACTOR_IDS.founder);
    },
  );

  it("keeps the office ledger under Founder and Manager authority", async () => {
    const { application } = createFixture();
    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

    const entry = await application.createLedgerEntry(manager, {
      occurredOn: "2026-10-30",
      account: "cash",
      direction: "outflow",
      amountPaise: 75000,
      narration: "Courier expenses",
    });
    expect(entry.recordedById).toBe(DEMO_ACTOR_IDS.manager);
    await expect(application.getOfficeAccountsSummary(senior)).rejects.toMatchObject({
      status: 403,
      code: "role_not_permitted",
    });
  });

  it.each(ROLE_CASES)(
    "applies Office Accounts read and write authority to %s",
    async (role, actorId) => {
      const { application } = createFixture();
      const currentActor = await application.requireActor(actorId);
      const mayUseOfficeAccounts = role === "founder" || role === "manager";

      if (mayUseOfficeAccounts) {
        await expect(application.getOfficeAccountsSummary(currentActor)).resolves.toMatchObject({
          currency: "INR",
        });
        await expect(application.listLedgerEntries(currentActor)).resolves.toHaveLength(3);
        await expect(
          application.createLedgerEntry(currentActor, {
            occurredOn: "2026-10-31",
            account: "cash",
            direction: "outflow",
            amountPaise: 50000,
            narration: `${role} permission check`,
          }),
        ).resolves.toMatchObject({ recordedById: actorId });
      } else {
        const denial = { status: 403, code: "role_not_permitted" };
        await expect(application.getOfficeAccountsSummary(currentActor)).rejects.toMatchObject(
          denial,
        );
        await expect(application.listLedgerEntries(currentActor)).rejects.toMatchObject(denial);
        await expect(
          application.createLedgerEntry(currentActor, {
            occurredOn: "2026-10-31",
            account: "cash",
            direction: "outflow",
            amountPaise: 50000,
            narration: `${role} permission check`,
          }),
        ).rejects.toMatchObject(denial);
      }
    },
  );

  it("rejects reopening a completed Assignment as a terminal audit artifact (409)", async () => {
    const { application } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

    // CANONICAL_ASSIGNMENT_1 starts as in_progress (owner is manager, reviewers include senior)
    await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");
    const completed = await application.transitionAssignment(founder, CANONICAL_ASSIGNMENT_1, "complete");
    expect(completed.status).toBe("approved");

    await expect(
      application.transitionAssignment(founder, CANONICAL_ASSIGNMENT_1, "reopen"),
    ).rejects.toMatchObject({
      status: 409,
      code: "invalid_state_transition",
      message: "An approved Assignment is a terminal immutable audit artifact and cannot be reopened.",
    });
  });

  it("allows reopening a submitted Assignment prior to approval (Request changes)", async () => {
    const { application } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

    await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");

    const reopened = await application.transitionAssignment(founder, CANONICAL_ASSIGNMENT_1, "reopen");
    expect(reopened.status).toBe("changes_requested");
  });

  it("rejects reopening a completed Work Item as a terminal audit artifact (409)", async () => {
    const { application } = createFixture();
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
    const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

    const item = await application.createWorkItem(senior, {
      kind: "delegated",
      title: "Verify e-way bills",
      assignmentId: CANONICAL_ASSIGNMENT_1,
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-02T12:30:00.000Z",
    });

    await application.transitionWorkItem(trainee, item.id, "submit");
    const completed = await application.transitionWorkItem(senior, item.id, "complete");
    expect(completed.status).toBe("completed");

    await expect(
      application.transitionWorkItem(senior, item.id, "reopen"),
    ).rejects.toMatchObject({
      status: 409,
      code: "invalid_state_transition",
      message: "A completed Work Item is a terminal immutable audit artifact and cannot be reopened.",
    });
  });

  it("allows reopening a submitted Work Item prior to approval (Request changes)", async () => {
    const { application } = createFixture();
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
    const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

    const item = await application.createWorkItem(senior, {
      kind: "delegated",
      title: "Verify invoice sequences",
      assignmentId: CANONICAL_ASSIGNMENT_1,
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-02T12:30:00.000Z",
    });

    await application.transitionWorkItem(trainee, item.id, "submit");
    const changesRequested = await application.transitionWorkItem(senior, item.id, "reopen");
    expect(changesRequested.status).toBe("changes_requested");
  });

  describe("reminder domain validation", () => {
    it("rejects delegated task creation when reminderAt is after dueAt (422 reminder_after_due_time)", async () => {
      const { application } = createFixture();
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

      await expect(
        application.createWorkItem(senior, {
          kind: "delegated",
          title: "Verify bank statement entries",
          assignmentId: CANONICAL_ASSIGNMENT_1,
          assigneeId: DEMO_ACTOR_IDS.trainee,
          dueAt: "2026-11-02T12:00:00.000Z",
          reminderAt: "2026-11-02T12:00:01.000Z",
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "reminder_after_due_time",
      });
    });

    it("rejects internal task creation when reminderAt is after dueAt (422 reminder_after_due_time)", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

      await expect(
        application.createWorkItem(manager, {
          kind: "internal",
          title: "Quarterly file indexing",
          assigneeId: DEMO_ACTOR_IDS.staff,
          dueAt: "2026-11-02T10:00:00.000Z",
          reminderAt: "2026-11-02T11:00:00.000Z",
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "reminder_after_due_time",
      });
    });

    it("rejects personal task creation when reminderAt is after dueAt across timezones (422 reminder_after_due_time)", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      await expect(
        application.createWorkItem(trainee, {
          kind: "personal",
          title: "Follow up with courier",
          dueAt: "2026-11-01T02:00:00.000Z",
          reminderAt: "2026-11-01T08:00:00+05:30",
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "reminder_after_due_time",
      });
    });

    it("rejects owner reopening a done personal work item as a terminal audit artifact (409)", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const item = await application.createWorkItem(trainee, {
        kind: "personal",
        title: "File quarterly travel expense report",
        dueAt: "2026-11-02T12:30:00.000Z",
      });

      const completed = await application.transitionWorkItem(trainee, item.id, "complete");
      expect(completed.status).toBe("completed");

      await expect(
        application.transitionWorkItem(trainee, item.id, "reopen"),
      ).rejects.toMatchObject({
        status: 409,
        code: "invalid_state_transition",
        message: "A completed Work Item is a terminal immutable audit artifact and cannot be reopened.",
      });
    });

    it("accepts task creation when reminderAt is equal to dueAt or earlier", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const created = await application.createWorkItem(trainee, {
        kind: "personal",
        title: "Submit travel receipts",
        dueAt: "2026-11-01T12:00:00.000Z",
        reminderAt: "2026-11-01T12:00:00.000Z",
      });
      expect(created.reminderAt).toBe("2026-11-01T12:00:00.000Z");
    });

    it("unconditionally rejects task creation when dueAt is invalid, malformed, or impossible calendar even if reminderAt is omitted (422 invalid_timestamp)", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const invalidDueCases = [
        "not-a-date",
        "",
        "2026-02-31T00:00:00Z",
        "2026-04-31T12:00:00Z",
        "2026/11/02",
        "Nov 2, 2026",
        "NaN",
      ];

      for (const dueAt of invalidDueCases) {
        await expect(
          application.createWorkItem(trainee, {
            kind: "personal",
            title: `Task with invalid dueAt ${dueAt}`,
            dueAt,
          }),
        ).rejects.toMatchObject({
          status: 422,
          code: "invalid_timestamp",
          message: "Work item timestamps must be valid ISO date-time strings.",
        });
      }
    });

    it("rejects task creation when reminderAt is explicitly empty string, impossible calendar, non-ISO, or NaN (422 invalid_timestamp)", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const invalidReminderCases = [
        "",
        "2026-02-31T00:00:00Z",
        "2026-04-31T12:00:00Z",
        "2026/11/02",
        "Nov 2, 2026",
        "NaN",
      ];

      for (const reminderAt of invalidReminderCases) {
        await expect(
          application.createWorkItem(trainee, {
            kind: "personal",
            title: `Task with invalid reminderAt ${reminderAt}`,
            dueAt: "2026-11-02T12:00:00.000Z",
            reminderAt,
          }),
        ).rejects.toMatchObject({
          status: 422,
          code: "invalid_timestamp",
          message: "Work item timestamps must be valid ISO date-time strings.",
        });
      }
    });

    it("accepts task creation when reminderAt is omitted or explicit null and persists as null", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const omittedReminder = await application.createWorkItem(trainee, {
        kind: "personal",
        title: "Task with omitted reminder",
        dueAt: "2026-11-02T12:00:00.000Z",
      });
      expect(omittedReminder.reminderAt).toBeNull();

      const nullReminder = await application.createWorkItem(trainee, {
        kind: "personal",
        title: "Task with null reminder",
        dueAt: "2026-11-02T12:00:00.000Z",
        reminderAt: null,
      });
      expect(nullReminder.reminderAt).toBeNull();
    });

    it("rejects invalid timezone offsets accepted by naive ISO regex (+25:00, +05:99, +99:99)", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);
      const invalidOffsets = [
        "2026-11-02T12:30:00+25:00",
        "2026-11-02T12:30:00+05:99",
        "2026-11-02T12:30:00+99:99",
      ];

      for (const invalidOffset of invalidOffsets) {
        await expect(
          application.createWorkItem(trainee, {
            kind: "personal",
            title: `Task with invalid reminderAt offset ${invalidOffset}`,
            dueAt: "2026-11-02T12:00:00.000Z",
            reminderAt: invalidOffset,
          }),
        ).rejects.toMatchObject({
          status: 422,
          code: "invalid_timestamp",
          message: "Work item timestamps must be valid ISO date-time strings.",
        });

        await expect(
          application.createWorkItem(trainee, {
            kind: "personal",
            title: `Task with invalid dueAt offset ${invalidOffset}`,
            dueAt: invalidOffset,
          }),
        ).rejects.toMatchObject({
          status: 422,
          code: "invalid_timestamp",
          message: "Work item timestamps must be valid ISO date-time strings.",
        });
      }
    });

    it("evaluates delegated due-boundary by instant epoch across offsets, not lexical strings", async () => {
      const { application } = createFixture();
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

      const equalItem = await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Delegated task with equal instant in +05:30",
        assignmentId: CANONICAL_ASSIGNMENT_1,
        assigneeId: DEMO_ACTOR_IDS.trainee,
        dueAt: "2026-11-11T18:00:00+05:30",
      });
      expect(equalItem.dueAt).toBe("2026-11-11T18:00:00+05:30");

      const beforeItem = await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Delegated task with earlier instant in +05:30",
        assignmentId: CANONICAL_ASSIGNMENT_1,
        assigneeId: DEMO_ACTOR_IDS.trainee,
        dueAt: "2026-11-11T17:30:00+05:30",
      });
      expect(beforeItem.dueAt).toBe("2026-11-11T17:30:00+05:30");

      await expect(
        application.createWorkItem(senior, {
          kind: "delegated",
          title: "Delegated task with later instant in -06:00",
          assignmentId: CANONICAL_ASSIGNMENT_1,
          assigneeId: DEMO_ACTOR_IDS.trainee,
          dueAt: "2026-11-11T08:00:00-06:00",
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "task_due_after_assignment",
        message: "Delegated work must be due no later than its parent Assignment.",
      });
    });

    it("accepts valid ISO-8601 instants with Z and explicit offsets", async () => {
      const { application } = createFixture();
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const item = await application.createWorkItem(trainee, {
        kind: "personal",
        title: "Cross timezone matching task",
        dueAt: "2026-11-02T18:00:00+05:30",
        reminderAt: "2026-11-02T12:30:00.000Z",
      });
      expect(item.reminderAt).toBe("2026-11-02T12:30:00.000Z");
    });
  });

  describe("Phase 3 Specific Requirements: references, transitions, concurrency, and validation", () => {
    it("rejects unknown client reference with HTTP 422", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

      await expect(
        application.createAssignment(manager, {
          clientId: "10000000-0000-4000-a000-999999999999",
          title: "Unknown client assignment",
          serviceId: CANONICAL_SERVICE_1,
          ownerId: DEMO_ACTOR_IDS.staff,
          dueAt: "2026-12-01T12:00:00.000Z",
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "referenced_entity_not_found",
      });
    });

    it("rejects unknown service reference with HTTP 422", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

      await expect(
        application.createAssignment(manager, {
          clientId: CANONICAL_CLIENT_1,
          title: "Unknown service assignment",
          serviceId: "50000000-0000-4000-a000-999999999999",
          ownerId: DEMO_ACTOR_IDS.staff,
          dueAt: "2026-12-01T12:00:00.000Z",
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "referenced_entity_not_found",
      });
    });

    it("enforces assigned reviewer can execute request_changes on an assignment", async () => {
      const { application } = createFixture();
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

      // CANONICAL_ASSIGNMENT_1: owner is manager, reviewer is senior
      await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");

      // Senior staff is assigned reviewer -> authorized to request changes!
      const result = await application.transitionAssignment(senior, CANONICAL_ASSIGNMENT_1, "request_changes", {
        reviewNotes: "Missing schedule details",
      });
      expect(result.status).toBe("changes_requested");
    });

    it("supports forward paths from changes_requested (start -> in_progress, submit -> ready_for_review)", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

      // Transition to ready_for_review then changes_requested
      await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");
      await application.transitionAssignment(senior, CANONICAL_ASSIGNMENT_1, "request_changes");

      // Forward path 1: start from changes_requested -> in_progress
      const started = await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "start");
      expect(started.status).toBe("in_progress");

      // Submit to ready_for_review again
      await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");
      await application.transitionAssignment(senior, CANONICAL_ASSIGNMENT_1, "request_changes");

      // Forward path 2: direct submit from changes_requested -> ready_for_review
      const submitted = await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");
      expect(submitted.status).toBe("ready_for_review");
    });

    it("enforces explicit status mutations (complete -> approved on assignment, complete -> completed on work item)", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      // Assignment: complete -> approved
      await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit");
      const approved = await application.transitionAssignment(founder, CANONICAL_ASSIGNMENT_1, "complete");
      expect(approved.status).toBe("approved");

      // Work item: complete -> completed
      await application.transitionWorkItem(trainee, CANONICAL_WORK_ITEM_1, "submit");
      const completed = await application.transitionWorkItem(manager, CANONICAL_WORK_ITEM_1, "complete");
      expect(completed.status).toBe("completed");
    });

    it("detects optimistic concurrency conflicts and returns HTTP 409", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

      await expect(
        application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_1, "submit", {
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "concurrency_conflict",
      });
    });

    it("deletes reporting line when supervisorId is null", async () => {
      const { application, repository } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);

      const result = await application.updateReportingLine(founder, DEMO_ACTOR_IDS.staff, null);
      expect(result.manager).toBeNull();

      const staff = await repository.getEmployee({ actorId: founder.id }, DEMO_ACTOR_IDS.staff);
      expect(staff?.reportsToId).toBeNull();
    });
  });

  describe("Slice 1P-Port: fail-closed context, bootstrap isolation, and canonical returns", () => {
    function createTrackingRepository() {
      const callLog: { method: string; actorId?: string; targetId?: string }[] = [];
      const underlying = new InMemoryCrmRepository(createDemoSeed());

      const trackingRepo: CrmApplicationDependencies = {
        async getClient(ctx: RepositoryContext, clientId: string): Promise<ClientDto | null> {
          callLog.push({ method: "getClient", actorId: ctx.actorId, targetId: clientId });
          return underlying.getClient(ctx, clientId);
        },
        async listClients(ctx: RepositoryContext): Promise<ClientDto[]> {
          callLog.push({ method: "listClients", actorId: ctx.actorId });
          return underlying.listClients(ctx);
        },
        async createClient(ctx: RepositoryContext, record: CreateClientRecord): Promise<ClientDto> {
          callLog.push({ method: "createClient", actorId: ctx.actorId, targetId: record.id });
          return underlying.createClient(ctx, record);
        },
        async resolveDevActor(id: string): Promise<EmployeeRecord | null> {
          callLog.push({ method: "resolveDevActor", targetId: id });
          return underlying.resolveDevActor(id);
        },
        async listDevActors(): Promise<EmployeeRecord[]> {
          callLog.push({ method: "listDevActors" });
          return underlying.listDevActors();
        },
        async getClientReference(ctx: RepositoryContext, clientId: string): Promise<ClientReference | null> {
          callLog.push({ method: "getClientReference", actorId: ctx.actorId, targetId: clientId });
          return underlying.getClientReference(ctx, clientId);
        },
        async listClientReferences(ctx: RepositoryContext): Promise<ClientReference[]> {
          callLog.push({ method: "listClientReferences", actorId: ctx.actorId });
          return underlying.listClientReferences(ctx);
        },
        async getServiceReferenceById(ctx: RepositoryContext, serviceId: string): Promise<ServiceReference | null> {
          callLog.push({ method: "getServiceReferenceById", actorId: ctx.actorId, targetId: serviceId });
          return underlying.getServiceReferenceById(ctx, serviceId);
        },
        async getServiceReferenceByName(ctx: RepositoryContext, serviceName: string): Promise<ServiceReference | null> {
          callLog.push({ method: "getServiceReferenceByName", actorId: ctx.actorId, targetId: serviceName });
          return underlying.getServiceReferenceByName(ctx, serviceName);
        },
        async listServiceReferences(ctx: RepositoryContext): Promise<ServiceReference[]> {
          callLog.push({ method: "listServiceReferences", actorId: ctx.actorId });
          return underlying.listServiceReferences(ctx);
        },
        async getEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null> {
          callLog.push({ method: "getEmployee", actorId: ctx.actorId, targetId: id });
          return underlying.getEmployee(ctx, id);
        },
        async listEmployees(ctx: RepositoryContext): Promise<EmployeeRecord[]> {
          callLog.push({ method: "listEmployees", actorId: ctx.actorId });
          return underlying.listEmployees(ctx);
        },
        async updateReportingLine(ctx: RepositoryContext, employeeId: string, supervisorId: string | null): Promise<ReportingLineDto> {
          callLog.push({ method: "updateReportingLine", actorId: ctx.actorId, targetId: employeeId });
          const res = await underlying.updateReportingLine(ctx, employeeId, supervisorId);
          return {
            ...res,
            employee: { ...res.employee, name: "CANONICAL-EMPLOYEE-PERSISTED" },
          };
        },
        async getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentRecord | null> {
          callLog.push({ method: "getAssignment", actorId: ctx.actorId, targetId: id });
          return underlying.getAssignment(ctx, id);
        },
        async listAssignments(ctx: RepositoryContext): Promise<AssignmentRecord[]> {
          callLog.push({ method: "listAssignments", actorId: ctx.actorId });
          return underlying.listAssignments(ctx);
        },
        async createAssignment(ctx: RepositoryContext, record: CreateAssignmentRecord): Promise<AssignmentRecord> {
          callLog.push({ method: "createAssignment", actorId: ctx.actorId, targetId: record.id });
          const saved = await underlying.createAssignment(ctx, record);
          return { ...saved, code: "AS-CANONICAL-001001" };
        },
        async updateAssignmentStatus(ctx: RepositoryContext, command: UpdateAssignmentStatusCommand): Promise<AssignmentRecord> {
          callLog.push({ method: "updateAssignmentStatus", actorId: ctx.actorId, targetId: command.id });
          const saved = await underlying.updateAssignmentStatus(ctx, command);
          return { ...saved, code: "AS-CANONICAL-001001" };
        },
        async updateAssignmentReviewers(ctx: RepositoryContext, command: UpdateAssignmentReviewersCommand): Promise<AssignmentRecord> {
          callLog.push({ method: "updateAssignmentReviewers", actorId: ctx.actorId, targetId: command.id });
          return underlying.updateAssignmentReviewers(ctx, command);
        },
        async updateAssignment(ctx: RepositoryContext, command: any): Promise<AssignmentRecord> {
          callLog.push({ method: "updateAssignment", actorId: ctx.actorId, targetId: command.id });
          return underlying.updateAssignment(ctx, command);
        },
        async materializeDueAssignments(ctx: RepositoryContext, input: any): Promise<any> {
          callLog.push({ method: "materializeDueAssignments", actorId: ctx.actorId });
          return underlying.materializeDueAssignments(ctx, input);
        },
        async getRecurringSchedule(ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null> {
          callLog.push({ method: "getRecurringSchedule", actorId: ctx.actorId, targetId: id });
          return underlying.getRecurringSchedule(ctx, id);
        },
        async listRecurringSchedules(ctx: RepositoryContext): Promise<RecurringScheduleDto[]> {
          callLog.push({ method: "listRecurringSchedules", actorId: ctx.actorId });
          return underlying.listRecurringSchedules(ctx);
        },
        async createRecurringSchedule(ctx: RepositoryContext, schedule: any): Promise<RecurringScheduleDto> {
          callLog.push({ method: "createRecurringSchedule", actorId: ctx.actorId, targetId: schedule.id });
          const saved = await underlying.createRecurringSchedule(ctx, schedule);
          return { ...saved, id: "sch_canonical_substituted_id" };
        },
        async updateRecurringSchedule(ctx: RepositoryContext, id: string, input: any): Promise<RecurringScheduleDto> {
          callLog.push({ method: "updateRecurringSchedule", actorId: ctx.actorId, targetId: id });
          const saved = await underlying.updateRecurringSchedule(ctx, id, input);
          return { ...saved, id: "sch_canonical_substituted_id" };
        },
        async getWorkItem(ctx: RepositoryContext, id: string): Promise<WorkItemDto | null> {
          callLog.push({ method: "getWorkItem", actorId: ctx.actorId, targetId: id });
          return underlying.getWorkItem(ctx, id);
        },
        async listWorkItems(ctx: RepositoryContext): Promise<WorkItemDto[]> {
          callLog.push({ method: "listWorkItems", actorId: ctx.actorId });
          return underlying.listWorkItems(ctx);
        },
        async createWorkItem(ctx: RepositoryContext, item: CreateWorkItemRecord): Promise<WorkItemDto> {
          callLog.push({ method: "createWorkItem", actorId: ctx.actorId, targetId: item.id });
          const saved = await underlying.createWorkItem(ctx, item);
          return { ...saved, notes: "CANONICAL-WORK-ITEM-PERSISTED-NOTE" };
        },
        async updateWorkItemStatus(ctx: RepositoryContext, command: UpdateWorkItemStatusCommand): Promise<WorkItemDto> {
          callLog.push({ method: "updateWorkItemStatus", actorId: ctx.actorId, targetId: command.id });
          const saved = await underlying.updateWorkItemStatus(ctx, command);
          return { ...saved, notes: "CANONICAL-WORK-ITEM-PERSISTED-NOTE" };
        },
        async getOfficeAccountsSummary(ctx: RepositoryContext) {
          callLog.push({ method: "getOfficeAccountsSummary", actorId: ctx.actorId });
          return underlying.getOfficeAccountsSummary(ctx);
        },
        async listLedgerEntries(ctx: RepositoryContext): Promise<LedgerEntryDto[]> {
          callLog.push({ method: "listLedgerEntries", actorId: ctx.actorId });
          return underlying.listLedgerEntries(ctx);
        },
        async createLedgerEntry(ctx: RepositoryContext, entry: any): Promise<LedgerEntryDto> {
          callLog.push({ method: "createLedgerEntry", actorId: ctx.actorId, targetId: entry.id });
          const saved = await underlying.createLedgerEntry(ctx, entry);
          return { ...saved, reference: "REF-CANONICAL-DB-GENERATED" };
        },
        async getEngagement(ctx: RepositoryContext, id: string) {
          throw new Error(`Unexpected engagement repository call: getEngagement(${ctx.actorId}, ${id})`);
        },
        async listInvoices(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: listInvoices(${ctx.actorId})`);
        },
        async listPaymentReceipts(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: listPaymentReceipts(${ctx.actorId})`);
        },
        async recordVyaparBill(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: recordVyaparBill(${ctx.actorId})`);
        },
        async recordPayment(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: recordPayment(${ctx.actorId})`);
        },
        async voidInvoice(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: voidInvoice(${ctx.actorId})`);
        },
        async voidPaymentReceipt(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: voidPaymentReceipt(${ctx.actorId})`);
        },
        async applyCredit(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: applyCredit(${ctx.actorId})`);
        },
        async removeCreditAllocation(ctx: RepositoryContext) {
          throw new Error(`Unexpected billing repository call: removeCreditAllocation(${ctx.actorId})`);
        },
        async listEngagements(ctx: RepositoryContext) {
          throw new Error(`Unexpected engagement repository call: listEngagements(${ctx.actorId})`);
        },
        async listEngagementVersions(ctx: RepositoryContext, engagementId: string) {
          throw new Error(`Unexpected engagement repository call: listEngagementVersions(${ctx.actorId}, ${engagementId})`);
        },
        async mutateEngagement(ctx: RepositoryContext, command: MutateEngagementCommand) {
          throw new Error(`Unexpected engagement repository call: mutateEngagement(${ctx.actorId}, ${command.kind})`);
        },
        async listServiceCatalog(ctx: RepositoryContext) {
          throw new Error(`Unexpected service repository call: listServiceCatalog(${ctx.actorId})`);
        },
        async createService(ctx: RepositoryContext) {
          throw new Error(`Unexpected service repository call: createService(${ctx.actorId})`);
        },
        async updateService(ctx: RepositoryContext) {
          throw new Error(`Unexpected service repository call: updateService(${ctx.actorId})`);
        },
        async listDepartments(ctx: RepositoryContext) {
          // A Senior Staff or Staff reader also checks which departments they head (DEPT-01)
          callLog.push({ method: "listDepartments", actorId: ctx.actorId });
          return underlying.listDepartments(ctx);
        },
        async createDepartment(ctx: RepositoryContext) {
          throw new Error(`Unexpected department repository call: createDepartment(${ctx.actorId})`);
        },
        async updateDepartment(ctx: RepositoryContext) {
          throw new Error(`Unexpected department repository call: updateDepartment(${ctx.actorId})`);
        },
        async setDepartmentMembers(ctx: RepositoryContext) {
          throw new Error(`Unexpected department repository call: setDepartmentMembers(${ctx.actorId})`);
        },
        async updateClient(ctx: RepositoryContext) {
          throw new Error(`Unexpected client repository call: updateClient(${ctx.actorId})`);
        },
        async getClientIdForContact(ctx: RepositoryContext) {
          throw new Error(`Unexpected client repository call: getClientIdForContact(${ctx.actorId})`);
        },
        async createClientContact(ctx: RepositoryContext) {
          throw new Error(`Unexpected client repository call: createClientContact(${ctx.actorId})`);
        },
        async updateClientContact(ctx: RepositoryContext) {
          throw new Error(`Unexpected client repository call: updateClientContact(${ctx.actorId})`);
        },
        async deleteClientContact(ctx: RepositoryContext) {
          throw new Error(`Unexpected client repository call: deleteClientContact(${ctx.actorId})`);
        },
        async listClientDocuments(ctx: RepositoryContext) {
          throw new Error(`Unexpected document repository call: listClientDocuments(${ctx.actorId})`);
        },
        async createClientDocument(ctx: RepositoryContext) {
          throw new Error(`Unexpected document repository call: createClientDocument(${ctx.actorId})`);
        },
        async confirmClientDocument(ctx: RepositoryContext) {
          throw new Error(`Unexpected document repository call: confirmClientDocument(${ctx.actorId})`);
        },
        async removeClientDocument(ctx: RepositoryContext) {
          throw new Error(`Unexpected document repository call: removeClientDocument(${ctx.actorId})`);
        },
        async listClientMessages(ctx: RepositoryContext) {
          throw new Error(`Unexpected message repository call: listClientMessages(${ctx.actorId})`);
        },
        async recordClientMessage(ctx: RepositoryContext) {
          throw new Error(`Unexpected message repository call: recordClientMessage(${ctx.actorId})`);
        },
        async getPracticeReport(ctx: RepositoryContext) {
          throw new Error(`Unexpected report repository call: getPracticeReport(${ctx.actorId})`);
        },
        async listReportAssignments(ctx: RepositoryContext) {
          throw new Error(`Unexpected report repository call: listReportAssignments(${ctx.actorId})`);
        },
      };

      const application = new CrmApplication(trackingRepo, {
        now: () => new Date("2026-10-30T12:00:00.000Z"),
        createId: () => "00000000-0000-4000-e000-000000000099",
      });

      return { trackingRepo, application, callLog };
    }

    it("bootstrap actor listing and resolution use dev directory without calling domain methods", async () => {
      const { application, callLog } = createTrackingRepository();

      const demoActors = await application.listDemoActors();
      expect(demoActors.length).toBeGreaterThan(0);
      expect(callLog).toContainEqual({ method: "listDevActors" });
      expect(callLog.some((c) => c.method === "listEmployees")).toBe(false);

      callLog.length = 0;
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      expect(founder.id).toBe(DEMO_ACTOR_IDS.founder);
      expect(callLog).toContainEqual({ method: "resolveDevActor", targetId: DEMO_ACTOR_IDS.founder });
      expect(callLog.some((c) => c.method === "getEmployee")).toBe(false);
    });

    it("passes initiating actorId on domain reads and writes across all workflows", async () => {
      const { application, callLog } = createTrackingRepository();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      // 1. listAssignments passes initiating actorId
      callLog.length = 0;
      await application.listAssignments(senior);
      expect(callLog).toEqual([
        { method: "listAssignments", actorId: senior.id },
        { method: "listWorkItems", actorId: senior.id },
        { method: "listDepartments", actorId: senior.id },
      ]);
      // Leadership sees every assignment already, so it never asks about departments
      callLog.length = 0;
      await application.listAssignments(founder);
      expect(callLog).toEqual([
        { method: "listAssignments", actorId: founder.id },
        { method: "listWorkItems", actorId: founder.id },
      ]);

      // 2. createAssignment passes manager.id to getEmployee (owner, reviewers), getClientReference, getServiceReferenceById, createAssignment
      callLog.length = 0;
      await application.createAssignment(manager, {
        clientId: CANONICAL_CLIENT_1,
        title: "Q3 Return",
        serviceId: CANONICAL_SERVICE_1,
        ownerId: staff.id,
        reviewerIds: [founder.id],
        dueAt: "2026-11-20T12:00:00.000Z",
      });
      expect(callLog.length).toBeGreaterThanOrEqual(4);
      for (const call of callLog) {
        expect(call.actorId).toBe(manager.id);
      }
      expect(callLog.some((c) => c.method === "createAssignment")).toBe(true);

      // 3. transitionAssignment passes initiating actorId
      callLog.length = 0;
      await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_3, "start");
      expect(callLog).toEqual([
        { method: "getAssignment", actorId: manager.id, targetId: CANONICAL_ASSIGNMENT_3 },
        { method: "updateAssignmentStatus", actorId: manager.id, targetId: CANONICAL_ASSIGNMENT_3 },
      ]);

      // 4. listRecurringSchedules passes initiating actorId
      callLog.length = 0;
      await application.listRecurringSchedules(founder);
      expect(callLog).toEqual([{ method: "listRecurringSchedules", actorId: founder.id }]);

      // 5. createRecurringSchedule passes initiating actorId
      callLog.length = 0;
      await application.createRecurringSchedule(founder, {
        clientId: CANONICAL_CLIENT_1,
        title: "Monthly Audit",
        serviceId: CANONICAL_SERVICE_1,
        cadence: "monthly",
        ownerId: senior.id,
        reviewerIds: [manager.id],
        nextOccurrenceOn: "2026-11-30",
        dueDay: 30,
      });
      for (const call of callLog) {
        expect(call.actorId).toBe(founder.id);
      }
      expect(callLog.some((c) => c.method === "createRecurringSchedule")).toBe(true);

      // 6. updateRecurringSchedule passes initiating actorId
      callLog.length = 0;
      await application.updateRecurringSchedule(founder, "20000000-0000-4000-a000-000000000001", { active: false });
      expect(callLog).toEqual([
        { method: "updateRecurringSchedule", actorId: founder.id, targetId: "20000000-0000-4000-a000-000000000001" },
      ]);

      // 7. listWorkItems passes initiating actorId
      callLog.length = 0;
      await application.listWorkItems(trainee);
      expect(callLog).toEqual([
        { method: "listWorkItems", actorId: trainee.id },
        { method: "listAssignments", actorId: trainee.id },
      ]);

      // 8. createWorkItem passes initiating actorId
      callLog.length = 0;
      await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Reconciliation subtask",
        assignmentId: CANONICAL_ASSIGNMENT_1,
        assigneeId: trainee.id,
        dueAt: "2026-11-10T12:00:00.000Z",
      });
      for (const call of callLog) {
        expect(call.actorId).toBe(senior.id);
      }
      expect(callLog.some((c) => c.method === "createWorkItem")).toBe(true);

      // 9. transitionWorkItem passes initiating actorId
      callLog.length = 0;
      await application.transitionWorkItem(trainee, CANONICAL_WORK_ITEM_1, "submit");
      expect(callLog).toEqual([
        { method: "getWorkItem", actorId: trainee.id, targetId: CANONICAL_WORK_ITEM_1 },
        { method: "updateWorkItemStatus", actorId: trainee.id, targetId: CANONICAL_WORK_ITEM_1 },
      ]);

      // 10. reporting lines
      callLog.length = 0;
      await application.listReportingLines(founder);
      expect(callLog).toEqual([{ method: "listEmployees", actorId: founder.id }]);

      callLog.length = 0;
      await application.updateReportingLine(founder, trainee.id, manager.id);
      expect(callLog.some((c) => c.method === "updateReportingLine")).toBe(true);

      // 11. office accounts & ledger
      callLog.length = 0;
      await application.getOfficeAccountsSummary(manager);
      expect(callLog).toEqual([{ method: "getOfficeAccountsSummary", actorId: manager.id }]);

      callLog.length = 0;
      await application.listLedgerEntries(manager);
      expect(callLog).toEqual([{ method: "listLedgerEntries", actorId: manager.id }]);

      callLog.length = 0;
      await application.createLedgerEntry(founder, {
        occurredOn: "2026-10-30",
        account: "cash",
        direction: "inflow",
        amountPaise: 25000,
        narration: "Direct inflow",
      });
      expect(callLog.some((c) => c.method === "createLedgerEntry")).toBe(true);

      // 12. client reads
      callLog.length = 0;
      await application.listClients(senior);
      expect(callLog).toEqual([{ method: "listClients", actorId: senior.id }]);

      callLog.length = 0;
      await application.getClient(senior, CANONICAL_CLIENT_1);
      expect(callLog).toEqual([{ method: "getClient", actorId: senior.id, targetId: CANONICAL_CLIENT_1 }]);
    });

    it("returns canonical entities returned by save/create methods across all domain families", async () => {
      const { application } = createTrackingRepository();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      // Family 1: createAssignment & updateAssignmentStatus
      const createdAssignment = await application.createAssignment(manager, {
        clientId: CANONICAL_CLIENT_1,
        title: "Canonical Test",
        serviceId: CANONICAL_SERVICE_1,
        ownerId: senior.id,
        reviewerIds: [founder.id],
        dueAt: "2026-11-20T12:00:00.000Z",
      });
      expect(createdAssignment.code).toBe("AS-CANONICAL-001001");

      const transitionedAssignment = await application.transitionAssignment(manager, CANONICAL_ASSIGNMENT_3, "start");
      expect(transitionedAssignment.code).toBe("AS-CANONICAL-001001");

      // Family 2: recurring schedules
      const createdSchedule = await application.createRecurringSchedule(founder, {
        clientId: CANONICAL_CLIENT_1,
        title: "Canonical Schedule",
        serviceId: CANONICAL_SERVICE_1,
        cadence: "monthly",
        ownerId: senior.id,
        reviewerIds: [manager.id],
        nextOccurrenceOn: "2026-11-30",
        dueDay: 30,
      });
      expect(createdSchedule.id).toBe("sch_canonical_substituted_id");

      const updatedSchedule = await application.updateRecurringSchedule(founder, "20000000-0000-4000-a000-000000000001", { active: false });
      expect(updatedSchedule.id).toBe("sch_canonical_substituted_id");

      // Family 3: work items
      const createdWorkItem = await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Canonical Work Item",
        assignmentId: CANONICAL_ASSIGNMENT_1,
        assigneeId: trainee.id,
        dueAt: "2026-11-10T12:00:00.000Z",
      });
      expect(createdWorkItem.notes).toBe("CANONICAL-WORK-ITEM-PERSISTED-NOTE");

      const transitionedWorkItem = await application.transitionWorkItem(trainee, CANONICAL_WORK_ITEM_1, "submit");
      expect(transitionedWorkItem.notes).toBe("CANONICAL-WORK-ITEM-PERSISTED-NOTE");

      // Family 4: reporting lines
      const reportingResult = await application.updateReportingLine(founder, trainee.id, manager.id);
      expect(reportingResult.employee.name).toBe("CANONICAL-EMPLOYEE-PERSISTED");

      // Family 5: ledger
      const createdLedgerEntry = await application.createLedgerEntry(founder, {
        occurredOn: "2026-10-30",
        account: "cash",
        direction: "inflow",
        amountPaise: 10000,
        narration: "Canonical ledger test",
      });
      expect(createdLedgerEntry.reference).toBe("REF-CANONICAL-DB-GENERATED");
    });
  });

  describe("Client Read Operations (CL-03)", () => {
    it("allows all five valid roles to read clients within their visibility scope", async () => {
      const { application } = createFixture();

      const roleScenarios = [
        {
          actorId: DEMO_ACTOR_IDS.founder,
          expectedCount: 6,
          visibleClientId: CANONICAL_CLIENT_1,
          expectedCode: "CL-001001",
        },
        {
          actorId: DEMO_ACTOR_IDS.manager,
          expectedCount: 6,
          visibleClientId: CANONICAL_CLIENT_1,
          expectedCode: "CL-001001",
        },
        {
          actorId: DEMO_ACTOR_IDS.senior,
          expectedCount: 5,
          visibleClientId: CANONICAL_CLIENT_1,
          expectedCode: "CL-001001",
        },
        {
          actorId: DEMO_ACTOR_IDS.staff,
          expectedCount: 2,
          visibleClientId: "10000000-0000-4000-a000-000000000002",
          expectedCode: "CL-001002",
        },
        {
          actorId: DEMO_ACTOR_IDS.trainee,
          expectedCount: 1,
          visibleClientId: CANONICAL_CLIENT_1,
          expectedCode: "CL-001001",
        },
      ];

      for (const scenario of roleScenarios) {
        const actor = await application.requireActor(scenario.actorId);
        const list = await application.listClients(actor);
        expect(list.length).toBe(scenario.expectedCount);

        const detail = await application.getClient(actor, scenario.visibleClientId);
        expect(detail.id).toBe(scenario.visibleClientId);
        expect(detail.code).toBe(scenario.expectedCode);
        expect(detail.panMasked).toMatch(/^\*{6}\d{4}$/);
      }
    });

    it("maps null repository results (both nonexistent and hidden clients) to identical 404 not_found errors", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      const absentId = "10000000-0000-4000-a000-999999999999";
      const hiddenId = "10000000-0000-4000-a000-000000000002"; // BluePeak Tech

      // Nonexistent client for founder
      let nonexistentError: any;
      try {
        await application.getClient(founder, absentId);
      } catch (err) {
        nonexistentError = err;
      }

      // Hidden client for trainee
      let hiddenError: any;
      try {
        await application.getClient(trainee, hiddenId);
      } catch (err) {
        hiddenError = err;
      }

      expect(nonexistentError).toBeDefined();
      expect(hiddenError).toBeDefined();
      expect(nonexistentError.status).toBe(404);
      expect(nonexistentError.code).toBe("not_found");
      expect(nonexistentError.message).toBe("Client was not found.");

      expect(hiddenError.status).toBe(404);
      expect(hiddenError.code).toBe("not_found");
      expect(hiddenError.message).toBe("Client was not found.");
    });

    it("authorizes client.read and fails before repository access for unauthorized actors", async () => {
      let repoCalled = false;
      const fakeRepo: CrmApplicationDependencies = {
        async getClient() {
          repoCalled = true;
          return null;
        },
        async listClients() {
          repoCalled = true;
          return [];
        },
      } as unknown as CrmApplicationDependencies;

      const app = new CrmApplication(fakeRepo);
      const testActor = {
        id: "00000000-0000-4000-a000-000000000005",
        name: "Test Employee",
        role: "trainee" as const,
        reportsToId: null,
      };

      const authorizeSpy = vi.spyOn(domain, "authorize").mockReturnValueOnce({
        allowed: false,
        code: "role_not_permitted",
        reason: "Access denied",
      });

      await expect(app.listClients(testActor)).rejects.toMatchObject({
        status: 403,
        code: "role_not_permitted",
      });
      expect(repoCalled).toBe(false);
      expect(authorizeSpy).toHaveBeenCalledWith({
        action: "client.read",
        actor: { id: testActor.id, role: testActor.role },
      });

      authorizeSpy.mockReturnValueOnce({
        allowed: false,
        code: "role_not_permitted",
        reason: "Access denied",
      });

      await expect(app.getClient(testActor, CANONICAL_CLIENT_1)).rejects.toMatchObject({
        status: 403,
        code: "role_not_permitted",
      });
      expect(repoCalled).toBe(false);

      authorizeSpy.mockRestore();
    });

    it("allows Founder and Manager to create client and returns routine-safe ClientDto with masked IDs", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);

      const client1 = await application.createClient(founder, {
        displayName: "Paramount Logistics",
        legalName: "Paramount Logistics Private Limited",
        pan: "ABCDE1234F",
        gstin: "27ABCDE1234F1Z5",
        email: "accounts@paramount.in",
        phone: "9123456780",
        relationshipOwnerId: DEMO_ACTOR_IDS.manager,
        notes: "Onboarded for annual direct tax compliance",
      });

      expect(client1.id).toBeDefined();
      expect(client1.code).toMatch(/^CL-\d{6}$/);
      expect(client1.displayName).toBe("Paramount Logistics");
      expect(client1.legalName).toBe("Paramount Logistics Private Limited");
      expect(client1.panMasked).toBe("******1234");
      expect(client1.gstinMasked).toBe("27**********1Z5");
      expect(client1.relationshipOwnerId).toBe(DEMO_ACTOR_IDS.manager);
      expect(client1.relationshipOwnerName).toBe("Priya Desai");
      expect(client1.createdById).toBe(founder.id);
      expect(client1.status).toBe("active");
      expect(client1.activeAssignmentsCount).toBe(0);

      // Verify listClients includes the newly created client
      const list = await application.listClients(founder);
      expect(list.some((c) => c.id === client1.id)).toBe(true);

      // Verify Manager can also create client
      const client2 = await application.createClient(manager, {
        displayName: "Zenith Retail Corp",
        pan: "ZXCVB9876Q",
      });
      expect(client2.code).toMatch(/^CL-\d{6}$/);
      expect(client2.createdById).toBe(manager.id);
      expect(client2.panMasked).toBe("******9876");
      expect(client2.gstinMasked).toBeNull();
    });

    it("prevents senior_staff, staff, and trainee from creating clients with 403 role_not_permitted", async () => {
      const { application } = createFixture();
      const nonLeadershipRoles = [
        DEMO_ACTOR_IDS.senior,
        DEMO_ACTOR_IDS.staff,
        DEMO_ACTOR_IDS.trainee,
      ];

      for (const actorId of nonLeadershipRoles) {
        const actor = await application.requireActor(actorId);
        expect(() => application.assertClientCreateAuthority(actor)).toThrowError(
          expect.objectContaining({
            status: 403,
            code: "role_not_permitted",
          }),
        );
        await expect(
          application.createClient(actor, {
            displayName: "Unauthorized New Client",
          }),
        ).rejects.toMatchObject({
          status: 403,
          code: "role_not_permitted",
        });
      }
    });

    it("fails with 404 not_found when relationshipOwnerId references non-existent employee", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);

      await expect(
        application.createClient(founder, {
          displayName: "Ghost Owner Client",
          relationshipOwnerId: "00000000-0000-4000-a000-999999999999",
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: "not_found",
        message: "Employee was not found.",
      });
    });

    it("fails with 422 validation_failed when relationshipOwnerId is a trainee", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);

      await expect(
        application.createClient(founder, {
          displayName: "Trainee Owner Client",
          relationshipOwnerId: DEMO_ACTOR_IDS.trainee,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "validation_failed",
        message: "A Client relationship owner must be active and cannot be a Trainee.",
      });
    });

    it("fails with 422 validation_failed when relationshipOwnerId is an inactive employee", async () => {
      const seed = createDemoSeed();
      const staffEmp = seed.employees.find((e) => e.id === DEMO_ACTOR_IDS.staff);
      if (staffEmp) {
        (staffEmp as { active: boolean }).active = false;
      }
      const repository = new InMemoryCrmRepository(seed);
      const application = new CrmApplication(repository, {
        now: () => new Date("2026-10-30T12:00:00.000Z"),
        createId: () => "00000000-0000-4000-e000-000000000001",
      });
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);

      await expect(
        application.createClient(founder, {
          displayName: "Inactive Owner Client",
          relationshipOwnerId: DEMO_ACTOR_IDS.staff,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "validation_failed",
        message: "A Client relationship owner must be active and cannot be a Trainee.",
      });
    });

    it("allows senior_staff or staff to be assigned as relationship owner", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);

      const clientWithSenior = await application.createClient(founder, {
        displayName: "Senior Owned Client",
        relationshipOwnerId: DEMO_ACTOR_IDS.senior,
      });
      expect(clientWithSenior.relationshipOwnerId).toBe(DEMO_ACTOR_IDS.senior);
      expect(clientWithSenior.relationshipOwnerName).toBe("Ananya Rao");

      const clientWithStaff = await application.createClient(founder, {
        displayName: "Staff Owned Client",
        relationshipOwnerId: DEMO_ACTOR_IDS.staff,
      });
      expect(clientWithStaff.relationshipOwnerId).toBe(DEMO_ACTOR_IDS.staff);
      expect(clientWithStaff.relationshipOwnerName).toBe("Rohan Mehta");
    });
  });

  describe("AS-01 Remediation: Terminal protection and Recurrence clamping", () => {
    it("rejects any core mutation on approved or closed assignments with 409 invalid_state_transition", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);

      // CANONICAL_ASSIGNMENT_1 starts in_progress: submit to ready_for_review, then complete to approved
      const initial = await application.listAssignments(founder);
      const as1 = initial.find((a) => a.id === CANONICAL_ASSIGNMENT_1)!;
      const ready = await application.transitionAssignment(founder, CANONICAL_ASSIGNMENT_1, "submit", {
        expectedUpdatedAt: as1.updatedAt,
      });
      const approved = await application.transitionAssignment(founder, CANONICAL_ASSIGNMENT_1, "complete", {
        expectedUpdatedAt: ready.updatedAt,
      });
      expect(approved.status).toBe("approved");

      // Attempting to mutate title
      await expect(
        application.updateAssignment(founder, CANONICAL_ASSIGNMENT_1, {
          title: "New Title Attempt",
          expectedUpdatedAt: approved.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "invalid_state_transition",
        message: "An approved or closed Assignment is an immutable audit artifact.",
      });

      // Attempting to mutate serviceId
      await expect(
        application.updateAssignment(founder, CANONICAL_ASSIGNMENT_1, {
          serviceId: CANONICAL_SERVICE_1,
          expectedUpdatedAt: approved.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "invalid_state_transition",
      });

      // Attempting to mutate dueAt
      await expect(
        application.updateAssignment(founder, CANONICAL_ASSIGNMENT_1, {
          dueAt: "2026-12-31T18:29:00.000Z",
          expectedUpdatedAt: approved.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "invalid_state_transition",
      });

      // Attempting to mutate deliveryNotes
      await expect(
        application.updateAssignment(founder, CANONICAL_ASSIGNMENT_1, {
          deliveryNotes: "New delivery notes",
          expectedUpdatedAt: approved.updatedAt,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: "invalid_state_transition",
      });
    });

    it("clamps monthly and quarterly recurrence across month ends and leap years", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

      // Create a schedule starting Oct 31, 2026
      const scheduleOct31 = await application.createRecurringSchedule(founder, {
        clientId: CANONICAL_CLIENT_1,
        title: "Month-End Clamped Schedule",
        serviceId: CANONICAL_SERVICE_1,
        cadence: "monthly",
        ownerId: senior.id,
        nextOccurrenceOn: "2026-10-31",
        dueDay: 11,
      });

      const result = await application.generateDueAssignments(founder, {
        throughDate: "2026-12-05",
      });

      // Occurrence 1: 2026-10-31
      // Occurrence 2: 2026-11-30 (clamped from 31 to 30!)
      const occurrences = result.occurrences.filter((o) => o.scheduleId === scheduleOct31.id);
      expect(occurrences).toHaveLength(2);
      expect(occurrences[0]?.occurrenceDate).toBe("2026-10-31");
      expect(occurrences[1]?.occurrenceDate).toBe("2026-11-30");

      // Verify the generated assignment due date matches periodEnd + 11 days
      const assignments = await application.listAssignments(founder);
      const asn2 = assignments.find((a) => a.id === occurrences[1]?.assignmentId);
      expect(asn2?.periodStart).toBe("2026-11-30");
      // Next occurrence after 2026-11-30 is 2026-12-30, so periodEnd is 2026-12-29, dueDate is 2027-01-09
      expect(asn2?.dueAt).toContain("T18:29:00.000Z");

      // Leap year test: Schedule starting Jan 31, 2028 (leap year)
      const leapSchedule = await application.createRecurringSchedule(founder, {
        clientId: CANONICAL_CLIENT_1,
        title: "Leap Year Schedule",
        serviceId: CANONICAL_SERVICE_1,
        cadence: "monthly",
        ownerId: senior.id,
        nextOccurrenceOn: "2028-01-31",
        dueDay: 11,
      });

      const leapResult = await application.generateDueAssignments(founder, {
        throughDate: "2028-03-01",
      });

      const leapOccurrences = leapResult.occurrences.filter((o) => o.scheduleId === leapSchedule.id);
      expect(leapOccurrences).toHaveLength(2);
      expect(leapOccurrences[0]?.occurrenceDate).toBe("2028-01-31");
      expect(leapOccurrences[1]?.occurrenceDate).toBe("2028-02-29"); // Clamped to Feb 29 in leap year!
    });
  });

  describe("ENG-01 application authority and repository dispatch", () => {
    const engagementTerms = (founderId: string, managerId: string) => ({
      title: "Annual compliance engagement",
      scope: "Annual compliance filings",
      responsiblePartnerId: founderId,
      deliveryManagerId: managerId,
      feeModel: "fixed" as const,
      agreedFeePaise: 100000,
      billingTerms: "Due on completion",
      startDate: "2026-11-01",
      endDate: "2027-03-31",
    });
    const draftInput = (founderId: string, managerId: string) => ({
      clientId: CANONICAL_CLIENT_1,
      serviceId: CANONICAL_SERVICE_1,
      ...engagementTerms(founderId, managerId),
    });

    it("allows Founder to read created engagements and maps absent ids to 404", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const created = await application.createEngagementDraft(founder, draftInput(founder.id, manager.id), "founder-read");

      expect((await application.listEngagements(founder)).some((item) => item.id === created.id)).toBe(true);
      expect(await application.getEngagement(founder, created.id)).toMatchObject({ id: created.id, status: "draft" });
      expect(await application.listEngagementVersions(founder, created.id)).toEqual([
        expect.objectContaining({ engagementId: created.id, versionNumber: 1 }),
      ]);
      const absentId = "00000000-0000-4000-e000-999999999999";
      await expect(application.getEngagement(founder, absentId)).rejects.toMatchObject({ status: 404 });
      await expect(application.listEngagementVersions(founder, absentId)).rejects.toMatchObject({ status: 404 });
    });

    it("allows Manager read/create/revise and dispatches route-bound commands", async () => {
      const { application, repository } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const original = repository.mutateEngagement.bind(repository);
      const commands: MutateEngagementCommand[] = [];
      repository.mutateEngagement = async (ctx, command) => { commands.push(command); return original(ctx, command); };

      await expect(application.listEngagements(manager)).resolves.toBeDefined();
      const created = await application.createEngagementDraft(manager, draftInput(founder.id, manager.id), "  manager-create  ");
      const revised = await application.reviseEngagementDraft(manager, created.id, {
        ...engagementTerms(founder.id, manager.id), title: "Revised engagement", expectedUpdatedAt: created.updatedAt,
      }, "  manager-revise  ");

      expect(revised.id).toBe(created.id);
      expect(commands).toEqual([
        expect.objectContaining({ kind: "createDraft", idempotencyKey: "manager-create" }),
        expect.objectContaining({ kind: "reviseDraft", idempotencyKey: "manager-revise", engagementId: created.id }),
      ]);
    });

    it("dispatches the complete Founder lifecycle in order", async () => {
      const { application, repository } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const original = repository.mutateEngagement.bind(repository);
      const commands: MutateEngagementCommand[] = [];
      repository.mutateEngagement = async (ctx, command) => { commands.push(command); return original(ctx, command); };
      const created = await application.createEngagementDraft(founder, draftInput(founder.id, manager.id), "  create  ");
      const revised = await application.reviseEngagementDraft(founder, created.id, { ...engagementTerms(founder.id, manager.id), expectedUpdatedAt: created.updatedAt }, "  revise  ");
      const version = (await application.listEngagementVersions(founder, created.id)).at(-1)!;
      const activated = await application.activateEngagement(founder, created.id, { versionId: version.id, expectedUpdatedAt: revised.updatedAt }, "  activate  ");
      const amended = await application.amendEngagement(founder, created.id, { ...engagementTerms(founder.id, manager.id), title: "Amended engagement", expectedUpdatedAt: activated.updatedAt }, "  amend  ");
      await application.endEngagement(founder, created.id, { outcome: "completed", reason: "Work completed", expectedUpdatedAt: amended.updatedAt }, "  end  ");

      expect(commands.map((command) => command.kind)).toEqual(["createDraft", "reviseDraft", "activate", "amend", "end"]);
      expect(commands).toEqual([
        expect.objectContaining({ idempotencyKey: "create" }),
        expect.objectContaining({ idempotencyKey: "revise", engagementId: created.id }),
        expect.objectContaining({ idempotencyKey: "activate", engagementId: created.id, versionId: version.id }),
        expect.objectContaining({ idempotencyKey: "amend", engagementId: created.id }),
        expect.objectContaining({ idempotencyKey: "end", engagementId: created.id, outcome: "completed", reason: "Work completed" }),
      ]);
    });

    it("denies Manager founder-only mutations before repository mutation", async () => {
      const { application, repository } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const created = await application.createEngagementDraft(founder, draftInput(founder.id, manager.id), "prepare");
      const revised = await application.reviseEngagementDraft(founder, created.id, { ...engagementTerms(founder.id, manager.id), expectedUpdatedAt: created.updatedAt }, "prepare-revise");
      const version = (await application.listEngagementVersions(founder, created.id))[0]!;
      const active = await application.activateEngagement(founder, created.id, { versionId: version.id, expectedUpdatedAt: revised.updatedAt }, "prepare-activate");
      const spy = vi.spyOn(repository, "mutateEngagement");
      await expect(application.activateEngagement(manager, created.id, { versionId: version.id, expectedUpdatedAt: active.updatedAt }, "forbidden-activate")).rejects.toMatchObject({ status: 403 });
      await expect(application.amendEngagement(manager, created.id, { ...engagementTerms(founder.id, manager.id), expectedUpdatedAt: active.updatedAt }, "forbidden-amend")).rejects.toMatchObject({ status: 403 });
      await expect(application.endEngagement(manager, created.id, { outcome: "completed", reason: "forbidden", expectedUpdatedAt: active.updatedAt }, "forbidden-end")).rejects.toMatchObject({ status: 403 });
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ["senior_staff", DEMO_ACTOR_IDS.senior], ["staff", DEMO_ACTOR_IDS.staff], ["trainee", DEMO_ACTOR_IDS.trainee],
    ] as const)("denies %s before engagement repository access", async (_role, actorId) => {
      const { application, repository } = createFixture();
      const actor = await application.requireActor(actorId);
      const listSpy = vi.spyOn(repository, "listEngagements");
      const mutateSpy = vi.spyOn(repository, "mutateEngagement");
      await expect(application.listEngagements(actor)).rejects.toMatchObject({ status: 403 });
      await expect(application.createEngagementDraft(actor, draftInput(DEMO_ACTOR_IDS.founder, DEMO_ACTOR_IDS.manager), "forbidden")).rejects.toMatchObject({ status: 403 });
      expect(listSpy).not.toHaveBeenCalled();
      expect(mutateSpy).not.toHaveBeenCalled();
    });
  });

  describe("BIL-01a billing read authority", () => {
    it.each([
      ["founder", DEMO_ACTOR_IDS.founder], ["manager", DEMO_ACTOR_IDS.manager],
    ] as const)("lets %s list every invoice and payment receipts", async (_role, actorId) => {
      const { application } = createFixture();
      const actor = await application.requireActor(actorId);
      const invoices = await application.listInvoices(actor);
      const receipts = await application.listPaymentReceipts(actor);
      expect(invoices).toHaveLength(4);
      expect(receipts).toHaveLength(2);
    });

    it.each([
      ["trainee", DEMO_ACTOR_IDS.trainee],
    ] as const)("denies %s with 403 before any billing repository access", async (_role, actorId) => {
      const { application, repository } = createFixture();
      const actor = await application.requireActor(actorId);
      const invoicesSpy = vi.spyOn(repository, "listInvoices");
      const receiptsSpy = vi.spyOn(repository, "listPaymentReceipts");
      await expect(application.listInvoices(actor)).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      await expect(application.listPaymentReceipts(actor)).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      expect(invoicesSpy).not.toHaveBeenCalled();
      expect(receiptsSpy).not.toHaveBeenCalled();
    });
  });

  describe("FEE-01a Vyapar bills and payments", () => {
    const CLIENT_1 = "10000000-0000-4000-a000-000000000001"; // relationship owner: manager; staff not involved
    const CLIENT_2 = "10000000-0000-4000-a000-000000000002"; // relationship owner and assignment owner: staff
    const billInput = (overrides: Partial<RecordVyaparBillInput> = {}): RecordVyaparBillInput => ({
      clientId: CLIENT_2,
      vyaparBillNumber: "VYP-201",
      billDate: "2026-10-01",
      dueDate: "2026-10-31",
      amountPaise: 1000000,
      description: "Monthly accounting fee",
      ...overrides,
    });
    const paymentInput = (invoiceId: string, overrides: Partial<RecordPaymentInput> = {}): RecordPaymentInput => ({
      invoiceId,
      receivedOn: "2026-10-20",
      amountPaise: 400000,
      method: "bank_transfer",
      reference: "NEFT-1",
      ...overrides,
    });
    let keyCounter = 0;
    const key = () => `key-${++keyCounter}`;

    async function actorFor(application: CrmApplication, id: string) {
      return application.requireActor(id);
    }

    it("lets the Founder record a bill as an issued, single-line, untaxed invoice", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const bill = await application.recordVyaparBill(founder, billInput({ vyaparBillNumber: "  VYP-201 " }), key());
      expect(bill).toMatchObject({
        vyaparBillNumber: "VYP-201",
        status: "issued",
        clientId: CLIENT_2,
        issueDate: "2026-10-01",
        dueDate: "2026-10-31",
        subtotalPaise: 1000000,
        taxPaise: 0,
        totalPaise: 1000000,
        amountReceivedPaise: 0,
        balancePaise: 1000000,
        assignmentId: null,
        payments: [],
      });
      expect(bill.items).toHaveLength(1);
      expect(bill.items[0]).toMatchObject({ description: "Monthly accounting fee", quantity: 1, unitPricePaise: 1000000, taxRatePercent: 0 });
      expect((await application.listInvoices(founder)).some((invoice) => invoice.id === bill.id)).toBe(true);
    });

    it("replays an identical request without creating a second bill and rejects a different payload on the same key", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const first = await application.recordVyaparBill(founder, billInput(), "same-key");
      const before = (await application.listInvoices(founder)).length;
      const replay = await application.recordVyaparBill(founder, billInput(), "same-key");
      expect(replay).toEqual(first);
      expect((await application.listInvoices(founder)).length).toBe(before);
      await expect(
        application.recordVyaparBill(founder, billInput({ amountPaise: 2000000 }), "same-key"),
      ).rejects.toMatchObject({ status: 409, code: "conflict" });
    });

    it("refuses a future bill date and a due date before the bill date", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      await expect(application.recordVyaparBill(founder, billInput({ billDate: "2026-10-31", dueDate: "2026-11-30" }), key()))
        .rejects.toMatchObject({ status: 422, code: "validation_failed" });
      await expect(application.recordVyaparBill(founder, billInput({ billDate: "2026-10-30", dueDate: "2026-10-29" }), key()))
        .rejects.toMatchObject({ status: 422, code: "validation_failed" });
      // The Kolkata calendar day is used: 12:00 UTC on 30 Oct is still 30 Oct, so today is accepted
      await expect(application.recordVyaparBill(founder, billInput({ billDate: "2026-10-30", dueDate: "2026-10-30" }), key()))
        .resolves.toMatchObject({ issueDate: "2026-10-30" });
    });

    it("returns 404 for a client that does not exist", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      await expect(
        application.recordVyaparBill(founder, billInput({ clientId: "10000000-0000-4000-a000-0000000000ff" }), key()),
      ).rejects.toMatchObject({ status: 404, code: "not_found", message: "Client was not found." });
    });

    it("refuses a duplicate Vyapar number in the same financial year, ignoring case and spaces", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      await application.recordVyaparBill(founder, billInput(), key());
      await expect(
        application.recordVyaparBill(founder, billInput({ clientId: CLIENT_1, vyaparBillNumber: " vyp-201", billDate: "2026-04-01", dueDate: "2026-05-01" }), key()),
      ).rejects.toMatchObject({
        status: 409,
        code: "duplicate_vyapar_bill",
        message: "Vyapar bill vyp-201 is already recorded for 2026–27.",
      });
    });

    it("accepts the same number in the next financial year and after the first bill is cancelled", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const first = await application.recordVyaparBill(founder, billInput({ billDate: "2026-03-31", dueDate: "2026-04-30" }), key());
      // 31 Mar 2026 is in FY 2025-26, 1 Apr 2026 starts FY 2026-27
      await expect(application.recordVyaparBill(founder, billInput({ billDate: "2026-04-01", dueDate: "2026-04-30" }), key()))
        .resolves.toMatchObject({ vyaparBillNumber: "VYP-201" });
      await expect(application.recordVyaparBill(founder, billInput({ billDate: "2026-03-01", dueDate: "2026-04-30" }), key()))
        .rejects.toMatchObject({ status: 409, message: "Vyapar bill VYP-201 is already recorded for 2025–26." });
      await application.voidInvoice(founder, first.id, { reason: "Entered in error" }, key());
      await expect(application.recordVyaparBill(founder, billInput({ billDate: "2026-03-01", dueDate: "2026-04-30" }), key()))
        .resolves.toMatchObject({ status: "issued" });
    });

    it("lets Staff record payments only for clients they look after, moving the bill issued, part paid, paid", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const staff = await actorFor(application, DEMO_ACTOR_IDS.staff);
      const mine = await application.recordVyaparBill(founder, billInput(), key());
      const theirs = await application.recordVyaparBill(founder, billInput({ clientId: CLIENT_1, vyaparBillNumber: "VYP-202" }), key());

      const visible = await application.listInvoices(staff);
      expect(visible.some((invoice) => invoice.id === mine.id)).toBe(true);
      expect(visible.some((invoice) => invoice.id === theirs.id)).toBe(false);
      expect((await application.listPaymentReceipts(staff)).every((receipt) => receipt.clientId !== CLIENT_1)).toBe(true);

      await expect(application.recordPayment(staff, paymentInput(theirs.id), key()))
        .rejects.toMatchObject({ status: 404, message: "Invoice was not found." });

      const part = await application.recordPayment(staff, paymentInput(mine.id, { amountPaise: 400000 }), key());
      expect(part).toMatchObject({
        status: "received",
        clientId: CLIENT_2,
        amountPaise: 400000,
        method: "bank_transfer",
        reference: "NEFT-1",
        notes: null,
        allocatedPaise: 400000,
        unallocatedPaise: 0,
      });
      expect(part.allocations).toEqual([
        { allocationId: expect.any(String), source: "payment", invoiceId: mine.id, invoiceCode: mine.code, amountPaise: 400000 },
      ]);
      let bill = (await application.listInvoices(staff)).find((invoice) => invoice.id === mine.id)!;
      expect(bill).toMatchObject({ status: "part_paid", amountReceivedPaise: 400000, balancePaise: 600000 });

      await application.recordPayment(staff, paymentInput(mine.id, { amountPaise: 600000, reference: "  ", notes: " settled " }), key());
      bill = (await application.listInvoices(staff)).find((invoice) => invoice.id === mine.id)!;
      expect(bill).toMatchObject({ status: "paid", amountReceivedPaise: 1000000, balancePaise: 0 });
      expect(bill.payments).toHaveLength(2);
    });

    it("refuses a payment on a paid, cancelled or draft bill and keeps an overpayment as credit", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const bill = await application.recordVyaparBill(founder, billInput({ amountPaise: 1250050 }), key());
      const over = await application.recordPayment(founder, paymentInput(bill.id, { amountPaise: 1250051 }), key());
      expect(over).toMatchObject({ amountPaise: 1250051, allocatedPaise: 1250050, unallocatedPaise: 1 });
      expect(over.allocations).toHaveLength(1);
      await expect(application.recordPayment(founder, paymentInput(bill.id, { amountPaise: 1 }), key()))
        .rejects.toMatchObject({ status: 422, code: "bill_not_open", message: "This bill is already paid or cancelled." });

      const cancelled = await application.recordVyaparBill(founder, billInput({ vyaparBillNumber: "VYP-203" }), key());
      await application.voidInvoice(founder, cancelled.id, { reason: "Wrong client" }, key());
      await expect(application.recordPayment(founder, paymentInput(cancelled.id), key()))
        .rejects.toMatchObject({ status: 422, code: "bill_not_open" });

      // INV-0001004 is a draft in the demo data
      const draft = (await application.listInvoices(founder)).find((invoice) => invoice.status === "draft")!;
      await expect(application.recordPayment(founder, paymentInput(draft.id), key()))
        .rejects.toMatchObject({ status: 422, code: "bill_not_open" });
    });

    it("refuses a future payment date and an unknown bill", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const bill = await application.recordVyaparBill(founder, billInput(), key());
      await expect(application.recordPayment(founder, paymentInput(bill.id, { receivedOn: "2026-10-31" }), key()))
        .rejects.toMatchObject({ status: 422, code: "validation_failed" });
      await expect(application.recordPayment(founder, paymentInput("70000000-0000-4000-a000-0000000000ff"), key()))
        .rejects.toMatchObject({ status: 404, message: "Invoice was not found." });
    });

    it("replays a payment without a second receipt, and a replay still succeeds after the bill is fully paid", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const bill = await application.recordVyaparBill(founder, billInput(), key());
      const input = paymentInput(bill.id, { amountPaise: 1000000 });
      const first = await application.recordPayment(founder, input, "pay-key");
      const receiptsBefore = (await application.listPaymentReceipts(founder)).length;
      const replay = await application.recordPayment(founder, input, "pay-key");
      expect(replay).toEqual(first);
      expect((await application.listPaymentReceipts(founder)).length).toBe(receiptsBefore);
      await expect(application.recordPayment(founder, { ...input, amountPaise: 999999 }, "pay-key"))
        .rejects.toMatchObject({ status: 409, code: "conflict" });
    });

    it("cancels a payment, returning the bill to part paid or issued, and refuses a second cancel", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const bill = await application.recordVyaparBill(founder, billInput(), key());
      const one = await application.recordPayment(founder, paymentInput(bill.id, { amountPaise: 400000 }), key());
      const two = await application.recordPayment(founder, paymentInput(bill.id, { amountPaise: 600000 }), key());

      const voidedTwo = await application.voidPaymentReceipt(founder, two.id, { reason: " Cheque bounced " }, key());
      expect(voidedTwo).toMatchObject({ status: "voided", voidReason: "Cheque bounced" });
      expect(voidedTwo.voidedAt).toEqual(expect.any(String));
      let current = (await application.listInvoices(founder)).find((invoice) => invoice.id === bill.id)!;
      expect(current).toMatchObject({ status: "part_paid", amountReceivedPaise: 400000 });

      await application.voidPaymentReceipt(founder, one.id, { reason: "Wrong bill" }, key());
      current = (await application.listInvoices(founder)).find((invoice) => invoice.id === bill.id)!;
      expect(current).toMatchObject({ status: "issued", amountReceivedPaise: 0, balancePaise: 1000000 });

      await expect(application.voidPaymentReceipt(founder, one.id, { reason: "Again" }, key()))
        .rejects.toMatchObject({ status: 422, code: "already_voided" });
      await expect(application.voidPaymentReceipt(founder, "71000000-0000-4000-a000-0000000000ff", { reason: "None" }, key()))
        .rejects.toMatchObject({ status: 404 });
    });

    it("refuses to cancel a bill with received payments until those payments are cancelled", async () => {
      const { application } = createFixture();
      const founder = await actorFor(application, DEMO_ACTOR_IDS.founder);
      const bill = await application.recordVyaparBill(founder, billInput(), key());
      const payment = await application.recordPayment(founder, paymentInput(bill.id), key());
      await expect(application.voidInvoice(founder, bill.id, { reason: "Entered twice" }, key()))
        .rejects.toMatchObject({ status: 422, code: "bill_has_payments", message: "Cancel the payments and remove any credit on this bill first." });
      await application.voidPaymentReceipt(founder, payment.id, { reason: "Refunded" }, key());
      const voided = await application.voidInvoice(founder, bill.id, { reason: "Entered twice" }, key());
      expect(voided).toMatchObject({ status: "voided", voidReason: "Entered twice", balancePaise: 0 });
      await expect(application.voidInvoice(founder, bill.id, { reason: "Again" }, key()))
        .rejects.toMatchObject({ status: 422, code: "already_voided" });
      await expect(application.voidInvoice(founder, "70000000-0000-4000-a000-0000000000ff", { reason: "None" }, key()))
        .rejects.toMatchObject({ status: 404, message: "Invoice was not found." });
    });

    it.each([
      ["senior_staff", DEMO_ACTOR_IDS.senior], ["staff", DEMO_ACTOR_IDS.staff], ["trainee", DEMO_ACTOR_IDS.trainee],
    ] as const)("denies %s recording or cancelling bills with 403 before any repository write", async (_role, actorId) => {
      const { application, repository } = createFixture();
      const actor = await actorFor(application, actorId);
      const spies = [
        vi.spyOn(repository, "recordVyaparBill"),
        vi.spyOn(repository, "voidInvoice"),
        vi.spyOn(repository, "voidPaymentReceipt"),
      ];
      await expect(application.recordVyaparBill(actor, billInput(), key())).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      await expect(application.voidInvoice(actor, "70000000-0000-4000-a000-000000000003", { reason: "No" }, key()))
        .rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      await expect(application.voidPaymentReceipt(actor, "71000000-0000-4000-a000-000000000001", { reason: "No" }, key()))
        .rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it("denies a Trainee reading and recording payments with 403", async () => {
      const { application, repository } = createFixture();
      const trainee = await actorFor(application, DEMO_ACTOR_IDS.trainee);
      const spy = vi.spyOn(repository, "recordPayment");
      await expect(application.recordPayment(trainee, paymentInput("70000000-0000-4000-a000-000000000003"), key()))
        .rejects.toMatchObject({ status: 403, code: "role_not_permitted", message: "Fee records are not available to Trainees." });
      expect(spy).not.toHaveBeenCalled();
    });

    it("lets Senior Staff see only the fee-visible clients, including clients they review", async () => {
      const { application } = createFixture();
      const senior = await actorFor(application, DEMO_ACTOR_IDS.senior);
      const invoices = await application.listInvoices(senior);
      // Senior Staff reviews the assignments of clients 1 and 3 and owns neither client 2 nor its assignment
      expect(invoices.map((invoice) => invoice.code).sort()).toEqual(["INV-0001001", "INV-0001002", "INV-0001003"]);
    });
  });

  describe("FEE-02a client credit", () => {
    const CLIENT_1 = "10000000-0000-4000-a000-000000000001"; // has demo credit; Senior Staff reviews it, Staff does not
    const CLIENT_2 = "10000000-0000-4000-a000-000000000002"; // looked after by Staff
    const billInput = (overrides: Partial<RecordVyaparBillInput> = {}): RecordVyaparBillInput => ({
      clientId: CLIENT_2,
      vyaparBillNumber: "VYP-401",
      billDate: "2026-10-01",
      dueDate: "2026-10-31",
      amountPaise: 1000000,
      description: "Monthly accounting fee",
      ...overrides,
    });
    const paymentInput = (invoiceId: string, overrides: Partial<RecordPaymentInput> = {}): RecordPaymentInput => ({
      invoiceId,
      receivedOn: "2026-10-20",
      amountPaise: 400000,
      method: "bank_transfer",
      ...overrides,
    });
    let keyCounter = 0;
    const key = () => `credit-key-${++keyCounter}`;

    // Client 2 overpays a bill of 10,000 with 15,000, leaving 5,000 credit, and has a second open bill
    async function withCredit() {
      const fixture = createFixture();
      const founder = await fixture.application.requireActor(DEMO_ACTOR_IDS.founder);
      const first = await fixture.application.recordVyaparBill(founder, billInput(), key());
      const receipt = await fixture.application.recordPayment(founder, paymentInput(first.id, { amountPaise: 1500000 }), key());
      const second = await fixture.application.recordVyaparBill(founder, billInput({ vyaparBillNumber: "VYP-402", amountPaise: 800000 }), key());
      return { ...fixture, founder, first, receipt, second };
    }

    it("keeps an overpayment as credit that Staff can apply to another bill of a client they look after", async () => {
      const { application, receipt, second } = await withCredit();
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      expect(receipt).toMatchObject({ amountPaise: 1500000, allocatedPaise: 1000000, unallocatedPaise: 500000 });

      const updated = await application.applyCredit(staff, second.id, {}, key());
      expect(updated).toMatchObject({ status: "part_paid", amountReceivedPaise: 500000, balancePaise: 300000 });
      expect(updated.payments).toEqual([
        expect.objectContaining({ receiptId: receipt.id, receiptCode: receipt.code, source: "credit", amountPaise: 500000 }),
      ]);
      expect((await application.listPaymentReceipts(staff)).find((candidate) => candidate.id === receipt.id)).toMatchObject({
        unallocatedPaise: 0,
      });
    });

    it("refuses with no_credit_available once the credit is used, and replays the first result", async () => {
      const { application, founder, second } = await withCredit();
      const applyKey = key();
      const first = await application.applyCredit(founder, second.id, {}, applyKey);
      await expect(application.applyCredit(founder, second.id, {}, key()))
        .rejects.toMatchObject({ status: 422, code: "no_credit_available", message: "This client has no credit to use." });
      expect(await application.applyCredit(founder, second.id, {}, applyKey)).toEqual(first);
    });

    it("refuses credit on a bill that is paid, cancelled or not visible, and on a missing bill", async () => {
      const { application, founder, first, second } = await withCredit();
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      await expect(application.applyCredit(founder, first.id, {}, key()))
        .rejects.toMatchObject({ status: 422, code: "bill_not_open", message: "This bill is already paid or cancelled." });
      await application.voidInvoice(founder, second.id, { reason: "Entered twice" }, key());
      await expect(application.applyCredit(founder, second.id, {}, key())).rejects.toMatchObject({ status: 422, code: "bill_not_open" });
      const others = await application.recordVyaparBill(founder, billInput({ clientId: CLIENT_1, vyaparBillNumber: "VYP-403" }), key());
      await expect(application.applyCredit(staff, others.id, {}, key()))
        .rejects.toMatchObject({ status: 404, message: "Invoice was not found." });
      await expect(application.applyCredit(founder, "70000000-0000-4000-a000-0000000000ff", {}, key()))
        .rejects.toMatchObject({ status: 404, message: "Invoice was not found." });
    });

    it("lets Senior Staff apply the credit of a client they review, but never a Trainee", async () => {
      const { application, founder } = await withCredit();
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);
      const bill = await application.recordVyaparBill(founder, billInput({ clientId: CLIENT_1, vyaparBillNumber: "VYP-404", amountPaise: 300000 }), key());
      await expect(application.applyCredit(trainee, bill.id, {}, key()))
        .rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      // The demo receipt RCT-0001002 holds 4,00,000 of unallocated credit for client 1
      const updated = await application.applyCredit(senior, bill.id, {}, key());
      expect(updated).toMatchObject({ status: "paid", balancePaise: 0 });
      expect(updated.payments[0]).toMatchObject({ receiptCode: "RCT-0001002", source: "credit", amountPaise: 300000 });
    });

    it("applies the client's credit when recording a bill with applyCredit, and not otherwise", async () => {
      const { application, founder } = await withCredit();
      const plain = await application.recordVyaparBill(founder, billInput({ vyaparBillNumber: "VYP-405" }), key());
      expect(plain).toMatchObject({ status: "issued", payments: [] });
      const used = await application.recordVyaparBill(founder, billInput({ vyaparBillNumber: "VYP-406", applyCredit: true }), key());
      expect(used).toMatchObject({ status: "part_paid", amountReceivedPaise: 500000 });
      const none = await application.recordVyaparBill(founder, billInput({ vyaparBillNumber: "VYP-407", applyCredit: true }), key());
      expect(none).toMatchObject({ status: "issued", payments: [] });
    });

    it("removes credit from a bill for the Founder or Manager, returning it to the client", async () => {
      const { application, founder, second } = await withCredit();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const used = await application.applyCredit(founder, second.id, {}, key());
      const allocationId = used.payments[0]!.allocationId;
      const removed = await application.removeCreditAllocation(manager, allocationId, {}, key());
      expect(removed).toMatchObject({ status: "issued", amountReceivedPaise: 0, payments: [] });
      await expect(application.removeCreditAllocation(manager, allocationId, {}, key()))
        .rejects.toMatchObject({ status: 404, message: "Payment allocation was not found." });
      await expect(application.applyCredit(founder, second.id, {}, key())).resolves.toMatchObject({ amountReceivedPaise: 500000 });
    });

    it("refuses to remove a direct payment allocation", async () => {
      const { application, founder, receipt } = await withCredit();
      await expect(application.removeCreditAllocation(founder, receipt.allocations[0]!.allocationId, {}, key()))
        .rejects.toMatchObject({ status: 422, code: "not_credit_allocation", message: "This is a direct payment. Cancel the payment instead." });
    });

    it.each([
      ["senior_staff", DEMO_ACTOR_IDS.senior], ["staff", DEMO_ACTOR_IDS.staff], ["trainee", DEMO_ACTOR_IDS.trainee],
    ] as const)("denies %s removing credit with 403 before any repository write", async (_role, actorId) => {
      const { application, repository } = await withCredit();
      const actor = await application.requireActor(actorId);
      const spy = vi.spyOn(repository, "removeCreditAllocation");
      await expect(application.removeCreditAllocation(actor, "73000000-0000-4000-a000-000000000001", {}, key()))
        .rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      expect(spy).not.toHaveBeenCalled();
    });

    it("requires a valid Idempotency-Key for the credit writes", async () => {
      const { application, founder, second } = await withCredit();
      await expect(application.applyCredit(founder, second.id, {}, " ")).rejects.toMatchObject({ status: 422 });
      await expect(application.removeCreditAllocation(founder, "73000000-0000-4000-a000-000000000001", {}, "")).rejects.toMatchObject({ status: 422 });
    });

    it("puts a bill back to pending when the receipt that gave the credit is cancelled", async () => {
      const { application, founder, receipt, second } = await withCredit();
      await application.applyCredit(founder, second.id, {}, key());
      await application.voidPaymentReceipt(founder, receipt.id, { reason: "Cheque bounced" }, key());
      const bill = (await application.listInvoices(founder)).find((invoice) => invoice.id === second.id)!;
      expect(bill).toMatchObject({ status: "issued", amountReceivedPaise: 0 });
    });

    it("refuses to cancel a bill that has credit on it until the credit is removed", async () => {
      const { application, founder, second } = await withCredit();
      const used = await application.applyCredit(founder, second.id, {}, key());
      await expect(application.voidInvoice(founder, second.id, { reason: "Entered twice" }, key())).rejects.toMatchObject({
        status: 422,
        code: "bill_has_payments",
        message: "Cancel the payments and remove any credit on this bill first.",
      });
      await application.removeCreditAllocation(founder, used.payments[0]!.allocationId, {}, key());
      await expect(application.voidInvoice(founder, second.id, { reason: "Entered twice" }, key())).resolves.toMatchObject({ status: "voided" });
    });
  });

  describe("ENG-02a assignment engagement link", () => {
    const CANONICAL_CLIENT_2 = "10000000-0000-4000-a000-000000000002";
    const terms = {
      title: "Annual compliance engagement",
      scope: "Annual compliance filings",
      responsiblePartnerId: DEMO_ACTOR_IDS.founder,
      deliveryManagerId: DEMO_ACTOR_IDS.manager,
      feeModel: "fixed" as const,
      agreedFeePaise: 100000,
      billingTerms: "Due on completion",
      startDate: "2026-11-01",
      endDate: "2027-03-31",
    };
    const assignmentInput = (engagementId?: string | null): CreateAssignmentInput => ({
      clientId: CANONICAL_CLIENT_1,
      title: "Annual return",
      serviceId: CANONICAL_SERVICE_1,
      ownerId: DEMO_ACTOR_IDS.staff,
      dueAt: "2026-12-01T12:30:00.000Z",
      ...(engagementId === undefined ? {} : { engagementId }),
    });

    async function prepareEngagement(
      application: CrmApplication,
      state: "draft" | "active" | "ended",
      clientId = CANONICAL_CLIENT_1,
    ) {
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const draft = await application.createEngagementDraft(
        founder,
        { clientId, serviceId: CANONICAL_SERVICE_1, ...terms },
        `draft-${state}-${clientId}`,
      );
      if (state === "draft") return draft;
      const version = (await application.listEngagementVersions(founder, draft.id))[0]!;
      const active = await application.activateEngagement(
        founder,
        draft.id,
        { versionId: version.id, expectedUpdatedAt: draft.updatedAt },
        `activate-${state}-${clientId}`,
      );
      if (state === "active") return active;
      return application.endEngagement(
        founder,
        draft.id,
        { outcome: "completed", reason: "Work completed", expectedUpdatedAt: active.updatedAt },
        `end-${state}-${clientId}`,
      );
    }

    it("creates a linked Assignment that returns the engagement id and code", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const engagement = await prepareEngagement(application, "active");

      const created = await application.createAssignment(manager, assignmentInput(engagement.id));
      expect(created).toMatchObject({ engagementId: engagement.id, engagementCode: engagement.code });
      expect(await application.listAssignments(manager)).toContainEqual(
        expect.objectContaining({ id: created.id, engagementId: engagement.id, engagementCode: engagement.code }),
      );
    });

    it("shows the engagement code to an employee involved in the Assignment", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      const engagement = await prepareEngagement(application, "active");
      const created = await application.createAssignment(manager, assignmentInput(engagement.id));

      expect(await application.listAssignments(staff)).toContainEqual(
        expect.objectContaining({ id: created.id, engagementCode: engagement.code }),
      );
    });

    it.each([[undefined], [null]])("gives null link fields when engagementId is %s", async (engagementId) => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const created = await application.createAssignment(manager, assignmentInput(engagementId));
      expect(created).toMatchObject({ engagementId: null, engagementCode: null });
    });

    it("rejects an engagement that belongs to another client with 422 engagement_client_mismatch", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const engagement = await prepareEngagement(application, "active", CANONICAL_CLIENT_2);
      await expect(application.createAssignment(manager, assignmentInput(engagement.id))).rejects.toMatchObject({
        status: 422,
        code: "engagement_client_mismatch",
      });
    });

    it.each([["draft"], ["ended"]] as const)("rejects a %s engagement with 422 engagement_not_active", async (state) => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const engagement = await prepareEngagement(application, state);
      await expect(application.createAssignment(manager, assignmentInput(engagement.id))).rejects.toMatchObject({
        status: 422,
        code: "engagement_not_active",
      });
    });

    it("rejects an unknown engagement with 422 referenced_entity_not_found", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      await expect(
        application.createAssignment(manager, assignmentInput("00000000-0000-4000-e000-999999999999")),
      ).rejects.toMatchObject({ status: 422, code: "referenced_entity_not_found" });
    });

    it("does not create an Assignment when the engagement is rejected", async () => {
      const { application } = createFixture();
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const before = (await application.listAssignments(manager)).length;
      const engagement = await prepareEngagement(application, "draft");
      await expect(application.createAssignment(manager, assignmentInput(engagement.id))).rejects.toBeDefined();
      expect(await application.listAssignments(manager)).toHaveLength(before);
    });

    it("leaves schedule-generated Assignments unlinked", async () => {
      const { application } = createFixture();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      await prepareEngagement(application, "active");
      const schedule = await application.createRecurringSchedule(founder, {
        clientId: CANONICAL_CLIENT_1,
        title: "Linked-free schedule",
        serviceId: CANONICAL_SERVICE_1,
        cadence: "monthly",
        ownerId: DEMO_ACTOR_IDS.senior,
        nextOccurrenceOn: "2026-10-31",
        dueDay: 11,
      });
      const result = await application.generateDueAssignments(founder, { throughDate: "2026-11-05" });
      const generatedIds = result.occurrences.filter((o) => o.scheduleId === schedule.id).map((o) => o.assignmentId);
      expect(generatedIds.length).toBeGreaterThan(0);
      const assignments = await application.listAssignments(founder);
      for (const id of generatedIds) {
        expect(assignments.find((a) => a.id === id)).toMatchObject({ engagementId: null, engagementCode: null });
      }
    });

    describe("ENG-02c schedule engagement link", () => {
      const scheduleInput = (engagementId?: string | null): CreateRecurringScheduleInput => ({
        clientId: CANONICAL_CLIENT_1,
        title: "Linked schedule",
        serviceId: CANONICAL_SERVICE_1,
        cadence: "monthly",
        ownerId: DEMO_ACTOR_IDS.senior,
        nextOccurrenceOn: "2026-10-31",
        dueDay: 11,
        ...(engagementId === undefined ? {} : { engagementId }),
      });

      it("creates a linked schedule that returns the engagement id and code", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const engagement = await prepareEngagement(application, "active");
        const created = await application.createRecurringSchedule(founder, scheduleInput(engagement.id));
        expect(created).toMatchObject({ engagementId: engagement.id, engagementCode: engagement.code });
        expect(await application.listRecurringSchedules(founder)).toContainEqual(
          expect.objectContaining({ id: created.id, engagementId: engagement.id, engagementCode: engagement.code }),
        );
      });

      it.each([[undefined], [null]])("gives null link fields when engagementId is %s", async (engagementId) => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const created = await application.createRecurringSchedule(founder, scheduleInput(engagementId));
        expect(created).toMatchObject({ engagementId: null, engagementCode: null });
      });

      it("rejects an engagement that belongs to another client with 422 engagement_client_mismatch", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const engagement = await prepareEngagement(application, "active", CANONICAL_CLIENT_2);
        await expect(application.createRecurringSchedule(founder, scheduleInput(engagement.id))).rejects.toMatchObject({
          status: 422,
          code: "engagement_client_mismatch",
        });
      });

      it.each([["draft"], ["ended"]] as const)("rejects a %s engagement with 422 engagement_not_active", async (state) => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const engagement = await prepareEngagement(application, state);
        await expect(application.createRecurringSchedule(founder, scheduleInput(engagement.id))).rejects.toMatchObject({
          status: 422,
          code: "engagement_not_active",
        });
      });

      it("rejects an unknown engagement with 422 referenced_entity_not_found", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        await expect(
          application.createRecurringSchedule(founder, scheduleInput("00000000-0000-4000-e000-999999999999")),
        ).rejects.toMatchObject({ status: 422, code: "referenced_entity_not_found" });
      });

      it("gives every generated Assignment the schedule engagement id and code", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const engagement = await prepareEngagement(application, "active");
        const schedule = await application.createRecurringSchedule(founder, scheduleInput(engagement.id));
        const result = await application.generateDueAssignments(founder, { throughDate: "2026-11-05" });
        const generatedIds = result.occurrences.filter((o) => o.scheduleId === schedule.id).map((o) => o.assignmentId);
        expect(generatedIds.length).toBeGreaterThan(0);
        const assignments = await application.listAssignments(founder);
        for (const id of generatedIds) {
          expect(assignments.find((a) => a.id === id)).toMatchObject({
            engagementId: engagement.id,
            engagementCode: engagement.code,
          });
        }
      });

      it("deactivates linked schedules when the engagement ends and leaves unlinked schedules alone", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const engagement = await prepareEngagement(application, "active");
        const linked = await application.createRecurringSchedule(founder, scheduleInput(engagement.id));
        const unlinked = await application.createRecurringSchedule(founder, scheduleInput());
        await application.endEngagement(
          founder,
          engagement.id,
          { outcome: "completed", reason: "Work completed", expectedUpdatedAt: engagement.updatedAt },
          "end-linked-schedules",
        );
        const schedules = await application.listRecurringSchedules(founder);
        expect(schedules.find((s) => s.id === linked.id)).toMatchObject({ active: false });
        expect(schedules.find((s) => s.id === unlinked.id)).toMatchObject({ active: true });

        const result = await application.generateDueAssignments(founder, { throughDate: "2026-11-05" });
        expect(result.occurrences.some((o) => o.scheduleId === linked.id)).toBe(false);
        expect(result.occurrences.some((o) => o.scheduleId === unlinked.id)).toBe(true);
      });

      it("rejects reactivating a schedule whose engagement has ended with 422 engagement_not_active", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const engagement = await prepareEngagement(application, "active");
        const linked = await application.createRecurringSchedule(founder, scheduleInput(engagement.id));
        await application.endEngagement(
          founder,
          engagement.id,
          { outcome: "completed", reason: "Work completed", expectedUpdatedAt: engagement.updatedAt },
          "end-reactivate",
        );
        await expect(application.updateRecurringSchedule(founder, linked.id, { active: true })).rejects.toMatchObject({
          status: 422,
          code: "engagement_not_active",
          message: "This schedule's engagement has ended, so the schedule cannot be restarted.",
        });
      });

      it("returns 404 when reactivating an unknown schedule", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        await expect(
          application.updateRecurringSchedule(founder, "00000000-0000-4000-e000-999999999999", { active: true }),
        ).rejects.toMatchObject({ status: 404 });
      });

      it("still lets an unlinked schedule be paused and restarted", async () => {
        const { application } = createFixture();
        const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
        const created = await application.createRecurringSchedule(founder, scheduleInput());
        await application.updateRecurringSchedule(founder, created.id, { active: false });
        const restarted = await application.updateRecurringSchedule(founder, created.id, { active: true });
        expect(restarted.active).toBe(true);
      });
    });
  });
});

describe("SVC-01 service list management", () => {
  const NON_FOUNDERS = [
    ["manager", DEMO_ACTOR_IDS.manager],
    ["senior_staff", DEMO_ACTOR_IDS.senior],
    ["staff", DEMO_ACTOR_IDS.staff],
    ["trainee", DEMO_ACTOR_IDS.trainee],
  ] as const;

  it("lets the Founder create a service with trimmed fields and a trimmed idempotency key", async () => {
    const { application, repository } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const spy = vi.spyOn(repository, "createService");

    const created = await application.createService(
      founder,
      { name: "  Trademark  ", description: "   ", turnaroundDays: 30, isStatutory: false },
      "  svc-create  ",
    );

    expect(spy).toHaveBeenCalledWith(
      { actorId: founder.id },
      {
        name: "Trademark",
        description: null,
        turnaroundDays: 30,
        isStatutory: false,
        idempotencyKey: "svc-create",
      },
    );
    expect(created).toMatchObject({
      name: "Trademark",
      description: null,
      turnaroundDays: 30,
      isStatutory: false,
      isActive: true,
      usage: { assignments: 0, recurringSchedules: 0, engagements: 0 },
    });
  });

  it("sends only the fields an update changes", async () => {
    const { application, repository } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const created = await application.createService(founder, { name: "ISO" }, "svc-create");
    const spy = vi.spyOn(repository, "updateService");

    await application.updateService(
      founder,
      created.id,
      { isActive: false, expectedUpdatedAt: created.updatedAt },
      "  svc-deactivate  ",
    );

    expect(spy).toHaveBeenCalledWith(
      { actorId: founder.id },
      {
        id: created.id,
        isActive: false,
        expectedUpdatedAt: created.updatedAt,
        idempotencyKey: "svc-deactivate",
      },
    );
  });

  it("refuses a deactivated service for new work but lets existing work keep it", async () => {
    const { application } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
    const service = await application.createService(founder, { name: "Partnership Deed Registration" }, "svc-pdr");
    const assignment = await application.createAssignment(manager, {
      clientId: CANONICAL_CLIENT_1,
      title: "Deed for new partner",
      serviceId: service.id,
      ownerId: DEMO_ACTOR_IDS.staff,
      dueAt: "2026-12-01T12:30:00.000Z",
    });

    await application.updateService(founder, service.id, { isActive: false, expectedUpdatedAt: service.updatedAt }, "svc-pdr-off");

    await expect(
      application.createAssignment(manager, {
        clientId: CANONICAL_CLIENT_1,
        title: "Another deed",
        serviceId: service.id,
        ownerId: DEMO_ACTOR_IDS.staff,
        dueAt: "2026-12-01T12:30:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422, code: "referenced_entity_not_found" });

    // Re-sending the assignment's own (now inactive) service with another change still works.
    const updated = await application.updateAssignment(manager, assignment.id, {
      title: "Deed for new partner (revised)",
      serviceId: service.id,
      expectedUpdatedAt: assignment.updatedAt,
    });
    expect(updated).toMatchObject({ title: "Deed for new partner (revised)", serviceId: service.id });
  });

  it("lists every service for the Founder, active ones first", async () => {
    const { application } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const created = await application.createService(founder, { name: "Aaa first alphabetically" }, "svc-create");
    await application.updateService(founder, created.id, { isActive: false, expectedUpdatedAt: created.updatedAt }, "svc-off");

    const catalog = await application.listServiceCatalog(founder);
    expect(catalog.at(-1)).toMatchObject({ name: "Aaa first alphabetically", isActive: false });
    expect(catalog.slice(0, -1).every((service) => service.isActive)).toBe(true);
  });

  it.each(NON_FOUNDERS)("denies %s every service list route before repository access", async (_role, actorId) => {
    const { application, repository } = createFixture();
    const actor = await application.requireActor(actorId);
    const listSpy = vi.spyOn(repository, "listServiceCatalog");
    const createSpy = vi.spyOn(repository, "createService");
    const updateSpy = vi.spyOn(repository, "updateService");

    const denied = { status: 403, code: "role_not_permitted", message: "Only the Founder may manage the service list." };
    await expect(application.listServiceCatalog(actor)).rejects.toMatchObject(denied);
    await expect(application.createService(actor, { name: "Trademark" }, "k1")).rejects.toMatchObject(denied);
    await expect(
      application.updateService(actor, CANONICAL_SERVICE_1, { isActive: false, expectedUpdatedAt: "2026-10-30T12:00:00.000Z" }, "k2"),
    ).rejects.toMatchObject(denied);
    expect(listSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("keeps the picker list open to every role and active-only", async () => {
    const { application } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);
    const created = await application.createService(founder, { name: "Project Reports" }, "svc-create");
    await application.updateService(founder, created.id, { isActive: false, expectedUpdatedAt: created.updatedAt }, "svc-off");

    const picker = await application.listServices(trainee);
    expect(picker.map((service) => service.name)).not.toContain("Project Reports");
    expect(picker.map((service) => service.name)).toContain("GST Compliance");
  });
});

describe("DEPT-01 departments", () => {
  const INTERNAL_AUDIT = "50000000-0000-4000-a000-000000000002"; // used by assignment ...0002 (Staff owns, Manager reviews)
  const AUDIT_ASSIGNMENT = "30000000-0000-4000-a000-000000000002";
  const BLUEPEAK = "10000000-0000-4000-a000-000000000002"; // the client of that assignment; Staff owns the relationship
  const GST_COMPLIANCE = "50000000-0000-4000-a000-000000000001";
  const NON_FOUNDERS = [
    ["manager", DEMO_ACTOR_IDS.manager],
    ["senior_staff", DEMO_ACTOR_IDS.senior],
    ["staff", DEMO_ACTOR_IDS.staff],
    ["trainee", DEMO_ACTOR_IDS.trainee],
  ] as const;

  async function setup() {
    const { application, repository } = createFixture();
    return {
      application,
      repository,
      founder: await application.requireActor(DEMO_ACTOR_IDS.founder),
      manager: await application.requireActor(DEMO_ACTOR_IDS.manager),
      senior: await application.requireActor(DEMO_ACTOR_IDS.senior),
      staff: await application.requireActor(DEMO_ACTOR_IDS.staff),
      trainee: await application.requireActor(DEMO_ACTOR_IDS.trainee),
    };
  }

  type Fixture = Awaited<ReturnType<typeof setup>>;

  /** Files a service under a department the way the Founder does in Settings. */
  async function fileService(fixture: Fixture, serviceId: string, departmentId: string | null, key: string) {
    const service = (await fixture.application.listServiceCatalog(fixture.founder)).find((s) => s.id === serviceId)!;
    return fixture.application.updateService(
      fixture.founder,
      serviceId,
      { departmentId, expectedUpdatedAt: service.updatedAt },
      key,
    );
  }

  it("lets the Founder create, rename and deactivate a department, trimming the name and the key", async () => {
    const { application, repository, founder } = await setup();
    const spy = vi.spyOn(repository, "createDepartment");

    const created = await application.createDepartment(founder, { name: "  GST  " }, "  dept-create  ");
    expect(spy).toHaveBeenCalledWith({ actorId: founder.id }, { name: "GST", idempotencyKey: "dept-create" });
    expect(created).toMatchObject({ name: "GST", isActive: true, members: [], serviceIds: [] });

    const renamed = await application.updateDepartment(
      founder,
      created.id,
      { name: "  GST and Indirect Tax ", expectedUpdatedAt: created.updatedAt },
      "dept-rename",
    );
    expect(renamed.name).toBe("GST and Indirect Tax");

    const off = await application.updateDepartment(
      founder,
      created.id,
      { isActive: false, expectedUpdatedAt: renamed.updatedAt },
      "dept-off",
    );
    expect(off).toMatchObject({ name: "GST and Indirect Tax", isActive: false });
  });

  it("lists every department for every employee, active ones first", async () => {
    const { application, founder, trainee } = await setup();
    const retired = await application.createDepartment(founder, { name: "Aaa Retired" }, "d1");
    await application.createDepartment(founder, { name: "Zzz Current" }, "d2");
    await application.updateDepartment(founder, retired.id, { isActive: false, expectedUpdatedAt: retired.updatedAt }, "d3");

    const listed = await application.listDepartments(trainee);
    expect(listed.map((department) => department.name)).toEqual(["Zzz Current", "Aaa Retired"]);
    expect(listed.map((department) => department.isActive)).toEqual([true, false]);
  });

  it.each(NON_FOUNDERS)("denies %s every department change before repository access", async (_role, actorId) => {
    const { application, repository } = await setup();
    const actor = await application.requireActor(actorId);
    const createSpy = vi.spyOn(repository, "createDepartment");
    const updateSpy = vi.spyOn(repository, "updateDepartment");
    const membersSpy = vi.spyOn(repository, "setDepartmentMembers");

    const denied = { status: 403, code: "role_not_permitted", message: "Only the Founder may manage departments." };
    await expect(application.createDepartment(actor, { name: "Audit" }, "k1")).rejects.toMatchObject(denied);
    await expect(
      application.updateDepartment(actor, CANONICAL_SERVICE_1, { isActive: false, expectedUpdatedAt: "2026-10-30T12:00:00.000Z" }, "k2"),
    ).rejects.toMatchObject(denied);
    await expect(application.setDepartmentMembers(actor, CANONICAL_SERVICE_1, { members: [] }, "k3")).rejects.toMatchObject(denied);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(membersSpy).not.toHaveBeenCalled();
    // Reading stays open to every employee
    await expect(application.listDepartments(actor)).resolves.toEqual([]);
  });

  it("refuses a duplicate name ignoring case and spaces, and a stale update", async () => {
    const { application, founder } = await setup();
    const audit = await application.createDepartment(founder, { name: "Audit" }, "d1");
    const other = await application.createDepartment(founder, { name: "Accounts and Registrations" }, "d2");

    await expect(application.createDepartment(founder, { name: "  AUDIT " }, "d3")).rejects.toMatchObject({
      status: 409,
      code: "duplicate_department",
      message: "A department named AUDIT already exists.",
    });
    await expect(
      application.updateDepartment(founder, other.id, { name: "audit", expectedUpdatedAt: other.updatedAt }, "d4"),
    ).rejects.toMatchObject({ status: 409, code: "duplicate_department" });
    // A department may change the case of its own name
    await expect(
      application.updateDepartment(founder, audit.id, { name: "AUDIT", expectedUpdatedAt: audit.updatedAt }, "d5"),
    ).resolves.toMatchObject({ name: "AUDIT" });
    await expect(
      application.updateDepartment(founder, audit.id, { isActive: false, expectedUpdatedAt: audit.updatedAt }, "d6"),
    ).rejects.toMatchObject({
      status: 409,
      code: "stale_department",
      message: "This department was changed by someone else. Reload and try again.",
    });
    await expect(
      application.updateDepartment(founder, "00000000-0000-4000-a000-999999999999", { isActive: false, expectedUpdatedAt: audit.updatedAt }, "d7"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("replaces the whole membership, allows several heads and a person in several departments", async () => {
    const { application, founder } = await setup();
    const gst = await application.createDepartment(founder, { name: "GST" }, "d1");
    const audit = await application.createDepartment(founder, { name: "Audit" }, "d2");

    const first = await application.setDepartmentMembers(
      founder,
      gst.id,
      {
        members: [
          { userId: DEMO_ACTOR_IDS.senior, isHead: true },
          { userId: DEMO_ACTOR_IDS.staff, isHead: true },
          { userId: DEMO_ACTOR_IDS.trainee, isHead: false },
        ],
      },
      "m1",
    );
    expect(first.members.map((m) => [m.name, m.role, m.isHead])).toEqual([
      ["Ananya Rao", "senior_staff", true],
      ["Neha Kapoor", "trainee", false],
      ["Rohan Mehta", "staff", true],
    ]);
    await application.setDepartmentMembers(founder, audit.id, { members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: false }] }, "m2");

    const replaced = await application.setDepartmentMembers(
      founder,
      gst.id,
      { members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: false }, { userId: DEMO_ACTOR_IDS.manager, isHead: true }] },
      "m3",
    );
    expect(replaced.members.map((m) => [m.name, m.isHead])).toEqual([
      ["Priya Desai", true],
      ["Rohan Mehta", false],
    ]);
    const listed = await application.listDepartments(founder);
    expect(listed.find((d) => d.id === audit.id)?.members.map((m) => m.name)).toEqual(["Rohan Mehta"]);

    const emptied = await application.setDepartmentMembers(founder, gst.id, { members: [] }, "m4");
    expect(emptied.members).toEqual([]);
  });

  it("refuses a trainee as head, an unknown person and an inactive person, and changes nothing", async () => {
    const { application, repository, founder } = await setup();
    const gst = await application.createDepartment(founder, { name: "GST" }, "d1");
    await application.setDepartmentMembers(founder, gst.id, { members: [{ userId: DEMO_ACTOR_IDS.senior, isHead: true }] }, "m1");

    await expect(
      application.setDepartmentMembers(founder, gst.id, { members: [{ userId: DEMO_ACTOR_IDS.trainee, isHead: true }] }, "m2"),
    ).rejects.toMatchObject({ status: 422, code: "trainee_cannot_head", message: "Trainees can be members but not heads." });
    await expect(
      application.setDepartmentMembers(founder, gst.id, { members: [{ userId: "00000000-0000-4000-a000-999999999999", isHead: false }] }, "m3"),
    ).rejects.toMatchObject({ status: 422, code: "referenced_entity_not_found" });
    const staff = await repository.getEmployee({ actorId: founder.id }, DEMO_ACTOR_IDS.staff);
    await repository.upsertDevActor({ ...staff!, active: false });
    await expect(
      application.setDepartmentMembers(founder, gst.id, { members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: false }] }, "m4"),
    ).rejects.toMatchObject({ status: 422, code: "referenced_entity_not_found" });

    const [unchanged] = await application.listDepartments(founder);
    expect(unchanged?.members.map((m) => [m.name, m.isHead])).toEqual([["Ananya Rao", true]]);
  });

  it("files a service under an active department only, shows its name and keeps it when the department is retired", async () => {
    const { application, founder } = await setup();
    const audit = await application.createDepartment(founder, { name: "Audit" }, "d1");

    const created = await application.createService(founder, { name: "Tax Audit", departmentId: audit.id }, "s1");
    expect(created).toMatchObject({ departmentId: audit.id, departmentName: "Audit" });
    expect((await application.createService(founder, { name: "Loose Service" }, "s2"))).toMatchObject({
      departmentId: null,
      departmentName: null,
    });
    expect((await application.listDepartments(founder))[0]?.serviceIds).toEqual([created.id]);

    await expect(
      application.createService(founder, { name: "Nowhere", departmentId: "00000000-0000-4000-a000-999999999999" }, "s3"),
    ).rejects.toMatchObject({ status: 422, code: "department_not_found" });

    const off = await application.updateDepartment(founder, audit.id, { isActive: false, expectedUpdatedAt: audit.updatedAt }, "d2");
    await expect(
      application.createService(founder, { name: "Late Audit", departmentId: off.id }, "s4"),
    ).rejects.toMatchObject({ status: 422, code: "department_not_found" });
    // Renaming a service that already sits in the retired department still works; moving into it does not
    const renamed = await application.updateService(
      founder,
      created.id,
      { name: "Tax Audit 2", departmentId: audit.id, expectedUpdatedAt: created.updatedAt },
      "s5",
    );
    expect(renamed).toMatchObject({ name: "Tax Audit 2", departmentId: audit.id });
    const gstCompliance = (await application.listServiceCatalog(founder)).find((s) => s.id === CANONICAL_SERVICE_1)!;
    await expect(
      application.updateService(founder, CANONICAL_SERVICE_1, { departmentId: off.id, expectedUpdatedAt: gstCompliance.updatedAt }, "s6"),
    ).rejects.toMatchObject({ status: 422, code: "department_not_found" });

    const cleared = await application.updateService(
      founder,
      created.id,
      { departmentId: null, expectedUpdatedAt: renamed.updatedAt },
      "s7",
    );
    expect(cleared).toMatchObject({ departmentId: null, departmentName: null });
  });

  describe("department heads read their department's work, and nothing else", () => {
    async function headOfAudit(fixture: Fixture, headId: string = DEMO_ACTOR_IDS.senior) {
      const audit = await fixture.application.createDepartment(fixture.founder, { name: "Audit" }, "d-audit");
      await fileService(fixture, INTERNAL_AUDIT, audit.id, "s-audit");
      await fixture.application.setDepartmentMembers(
        fixture.founder,
        audit.id,
        { members: [{ userId: headId, isHead: true }] },
        "m-audit",
      );
      return audit;
    }

    const idsOf = async (fixture: Fixture, actor: Fixture["senior"]) =>
      (await fixture.application.listAssignments(actor)).map((a) => a.id);

    it("shows a head the assignments of their department that they are not involved in, with the client name", async () => {
      const fixture = await setup();
      expect(await idsOf(fixture, fixture.senior)).not.toContain(AUDIT_ASSIGNMENT);
      await expect(fixture.application.getClient(fixture.senior, BLUEPEAK)).rejects.toMatchObject({ status: 404 });

      await headOfAudit(fixture);

      const listed = await fixture.application.listAssignments(fixture.senior);
      expect(listed.find((a) => a.id === AUDIT_ASSIGNMENT)).toMatchObject({ clientName: "BluePeak Tech", service: "Internal Audit" });
      // Everything they saw before is still there
      expect(listed.map((a) => a.id)).toEqual(expect.arrayContaining([
        "30000000-0000-4000-a000-000000000001",
        "30000000-0000-4000-a000-000000000004",
        "30000000-0000-4000-a000-000000000003",
        "30000000-0000-4000-a000-000000000005",
      ]));
      expect(listed).toHaveLength(5);
      expect(await fixture.application.getClient(fixture.senior, BLUEPEAK)).toMatchObject({ displayName: "BluePeak Tech" });
    });

    it("works the same for a Staff head", async () => {
      const fixture = await setup();
      const before = await idsOf(fixture, fixture.staff);
      const audit = await fixture.application.createDepartment(fixture.founder, { name: "GST" }, "d-gst");
      await fileService(fixture, "50000000-0000-4000-a000-000000000003", audit.id, "s-tds");
      await fixture.application.setDepartmentMembers(
        fixture.founder,
        audit.id,
        { members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: true }] },
        "m-gst",
      );
      expect(await idsOf(fixture, fixture.staff)).toEqual(
        expect.arrayContaining([...before, "30000000-0000-4000-a000-000000000003"]),
      );
    });

    it("stops showing the work when the service moves to another department", async () => {
      const fixture = await setup();
      await headOfAudit(fixture);
      expect(await idsOf(fixture, fixture.senior)).toContain(AUDIT_ASSIGNMENT);

      const other = await fixture.application.createDepartment(fixture.founder, { name: "Accounts and Registrations" }, "d-acc");
      await fileService(fixture, INTERNAL_AUDIT, other.id, "s-move");
      expect(await idsOf(fixture, fixture.senior)).not.toContain(AUDIT_ASSIGNMENT);
      await expect(fixture.application.getClient(fixture.senior, BLUEPEAK)).rejects.toMatchObject({ status: 404 });

      await fileService(fixture, INTERNAL_AUDIT, null, "s-unfile");
      expect(await idsOf(fixture, fixture.senior)).not.toContain(AUDIT_ASSIGNMENT);
    });

    it("stops showing the work when the person stops being head, or the department is deactivated", async () => {
      const fixture = await setup();
      const audit = await headOfAudit(fixture);

      await fixture.application.setDepartmentMembers(
        fixture.founder,
        audit.id,
        { members: [{ userId: DEMO_ACTOR_IDS.senior, isHead: false }] },
        "m-demote",
      );
      expect(await idsOf(fixture, fixture.senior)).not.toContain(AUDIT_ASSIGNMENT);

      await fixture.application.setDepartmentMembers(
        fixture.founder,
        audit.id,
        { members: [{ userId: DEMO_ACTOR_IDS.senior, isHead: true }] },
        "m-promote",
      );
      expect(await idsOf(fixture, fixture.senior)).toContain(AUDIT_ASSIGNMENT);

      const current = (await fixture.application.listDepartments(fixture.founder))[0]!;
      await fixture.application.updateDepartment(
        fixture.founder,
        audit.id,
        { isActive: false, expectedUpdatedAt: current.updatedAt },
        "d-off",
      );
      expect(await idsOf(fixture, fixture.senior)).not.toContain(AUDIT_ASSIGNMENT);
      await expect(fixture.application.getClient(fixture.senior, BLUEPEAK)).rejects.toMatchObject({ status: 404 });
    });

    it("gives a plain member and a head of another department nothing", async () => {
      const fixture = await setup();
      const audit = await fixture.application.createDepartment(fixture.founder, { name: "Audit" }, "d-audit");
      await fileService(fixture, INTERNAL_AUDIT, audit.id, "s-audit");
      const gst = await fixture.application.createDepartment(fixture.founder, { name: "GST" }, "d-gst");
      await fileService(fixture, GST_COMPLIANCE, gst.id, "s-gst");
      await fixture.application.setDepartmentMembers(
        fixture.founder,
        audit.id,
        { members: [{ userId: DEMO_ACTOR_IDS.senior, isHead: false }, { userId: DEMO_ACTOR_IDS.trainee, isHead: false }] },
        "m-audit",
      );
      await fixture.application.setDepartmentMembers(
        fixture.founder,
        gst.id,
        { members: [{ userId: DEMO_ACTOR_IDS.staff, isHead: true }] },
        "m-gst",
      );

      expect(await idsOf(fixture, fixture.senior)).not.toContain(AUDIT_ASSIGNMENT);
      expect(await idsOf(fixture, fixture.trainee)).not.toContain(AUDIT_ASSIGNMENT);
      expect(await idsOf(fixture, fixture.staff)).not.toContain("30000000-0000-4000-a000-000000000003");
      await expect(fixture.application.getClient(fixture.senior, BLUEPEAK)).rejects.toMatchObject({ status: 404 });
    });

    it("does not let a head change the assignment or add work to it", async () => {
      const fixture = await setup();
      await headOfAudit(fixture);
      const assignment = (await fixture.application.listAssignments(fixture.senior)).find((a) => a.id === AUDIT_ASSIGNMENT)!;

      await expect(
        fixture.application.transitionAssignment(fixture.senior, AUDIT_ASSIGNMENT, "start", { expectedUpdatedAt: assignment.updatedAt }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        fixture.application.updateAssignment(fixture.senior, AUDIT_ASSIGNMENT, {
          deliveryNotes: "Done",
          expectedUpdatedAt: assignment.updatedAt,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        fixture.application.updateAssignment(fixture.senior, AUDIT_ASSIGNMENT, {
          title: "Renamed by a head",
          expectedUpdatedAt: assignment.updatedAt,
        }),
      ).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      await expect(
        fixture.application.createWorkItem(fixture.senior, {
          kind: "delegated",
          title: "Extra work",
          assignmentId: AUDIT_ASSIGNMENT,
          assigneeId: DEMO_ACTOR_IDS.trainee,
          dueAt: "2026-12-01T12:30:00.000Z",
        }),
      ).rejects.toMatchObject({ status: 403 });
      const unchanged = (await fixture.application.listAssignments(fixture.founder)).find((a) => a.id === AUDIT_ASSIGNMENT);
      expect(unchanged).toMatchObject({ title: assignment.title, status: assignment.status, deliveryNotes: assignment.deliveryNotes });
    });

    it("does not give a head the full PAN or GSTIN, fees, documents or messages of the client", async () => {
      const fixture = await setup();
      await headOfAudit(fixture);

      const client = await fixture.application.getClient(fixture.senior, BLUEPEAK);
      expect(client.pan).toBeNull();
      expect(client.gstin).toBeNull();
      expect(JSON.stringify(client)).not.toContain("AABCB2345B");
      expect(JSON.stringify(client)).not.toContain("27AABCB2345B1Z4");
      expect(client.canEdit).toBe(false);

      // The bill of this client is not theirs to see
      const staffInvoices = await fixture.application.listInvoices(fixture.staff);
      const draft = staffInvoices.find((invoice) => invoice.clientId === BLUEPEAK);
      expect(draft).toBeDefined();
      const headInvoices = await fixture.application.listInvoices(fixture.senior);
      expect(headInvoices.filter((invoice) => invoice.clientId === BLUEPEAK)).toEqual([]);
      expect(await fixture.application.listClientMessages(fixture.senior, BLUEPEAK)).toEqual([]);
      await expect(
        fixture.application.createDocument(
          fixture.senior,
          { clientId: BLUEPEAK, title: "Notes", category: "other", fileName: "notes.pdf", mimeType: "application/pdf", sizeBytes: 100 },
          "doc-1",
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        fixture.application.updateClient(fixture.senior, BLUEPEAK, { notes: "head edit", expectedUpdatedAt: client.updatedAt }, "u1"),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe("CLI-02a client master", () => {
  const ASTER = CANONICAL_CLIENT_1; // owner: Manager; Senior and Trainee are involved through assignments
  const BLUEPEAK = "10000000-0000-4000-a000-000000000002"; // owner: Staff
  const ASTER_PAN = "AABCA1234A";
  const ASTER_GSTIN = "27AABCA1234A1Z5";
  const ASTER_UPDATED_AT = "2026-01-01T00:00:00.000Z";

  async function actors() {
    const { application, repository } = createFixture();
    return {
      application,
      repository,
      founder: await application.requireActor(DEMO_ACTOR_IDS.founder),
      manager: await application.requireActor(DEMO_ACTOR_IDS.manager),
      senior: await application.requireActor(DEMO_ACTOR_IDS.senior),
      staff: await application.requireActor(DEMO_ACTOR_IDS.staff),
      trainee: await application.requireActor(DEMO_ACTOR_IDS.trainee),
    };
  }

  describe("who sees the full PAN and GSTIN", () => {
    it.each([
      ["founder", DEMO_ACTOR_IDS.founder, ASTER],
      ["manager", DEMO_ACTOR_IDS.manager, ASTER],
      ["senior_staff who owns or reviews an assignment of the client", DEMO_ACTOR_IDS.senior, ASTER],
      ["staff who is the relationship owner", DEMO_ACTOR_IDS.staff, BLUEPEAK],
    ])("shows both full values to %s", async (_label, actorId, clientId) => {
      const { application } = createFixture();
      const reader = await application.requireActor(actorId);
      const client = await application.getClient(reader, clientId);
      expect(client.pan).not.toBeNull();
      expect(client.gstin).not.toBeNull();
      expect(client.panMasked).toMatch(/^\*{6}\d{4}$/);
      expect(client.gstinMasked).toMatch(/^27\*{10}/);
    });

    it("hides both full values from a trainee but keeps the masked values", async () => {
      const { application, trainee } = await actors();
      const client = await application.getClient(trainee, ASTER);
      expect(client.pan).toBeNull();
      expect(client.gstin).toBeNull();
      expect(client.panMasked).toBe("******1234");
      expect(client.gstinMasked).toBe("27**********1Z5");
      expect(JSON.stringify(client)).not.toContain(ASTER_PAN);
      expect(JSON.stringify(client)).not.toContain(ASTER_GSTIN);
    });

    it("hides the full values from staff who can see the client only through a personal task", async () => {
      const seed = createDemoSeed();
      seed.workItems = seed.workItems.map((item) =>
        item.id === "40000000-0000-4000-a000-000000000006" ? { ...item, relatedClientId: ASTER } : item,
      );
      const application = new CrmApplication(new InMemoryCrmRepository(seed));
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      const client = await application.getClient(staff, ASTER);
      expect(client.pan).toBeNull();
      expect(client.gstin).toBeNull();
      expect(client.panMasked).toBe("******1234");
      expect(client.canEdit).toBe(false);
    });

    it("tells each reader whether they may edit and whether they may change owner or status", async () => {
      const { application, founder, senior, staff } = await actors();
      expect(await application.getClient(founder, ASTER)).toMatchObject({ canEdit: true, canChangeOwnerOrStatus: true });
      expect(await application.getClient(senior, ASTER)).toMatchObject({ canEdit: false, canChangeOwnerOrStatus: false });
      expect(await application.getClient(staff, BLUEPEAK)).toMatchObject({ canEdit: true, canChangeOwnerOrStatus: false });
    });
  });

  describe("updateClient", () => {
    it("lets the Founder edit every field", async () => {
      const { application, founder } = await actors();
      const updated = await application.updateClient(
        founder,
        ASTER,
        {
          displayName: "Aster Foods Limited",
          legalName: "Aster Foods Limited",
          pan: "AABCA9999Z",
          gstin: "27AABCA9999Z1Z5",
          email: "tax@asterfoods.local",
          phone: "+91 98200 99999",
          relationshipOwnerId: DEMO_ACTOR_IDS.staff,
          status: "on_hold",
          notes: "Moved to quarterly review",
          entityType: "private_limited",
          addressLine1: "12 Marine Drive",
          addressLine2: "Nariman Point",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400021",
          tan: "MUMA12345B",
          cinLlpin: "U12345MH2020PTC123456",
          udyamNumber: "UDYAM-MH-01-0000001",
          iec: "ABCDE12345",
          incorporationDate: "2015-04-01",
          expectedUpdatedAt: ASTER_UPDATED_AT,
        },
        "edit-all",
      );

      expect(updated).toMatchObject({
        displayName: "Aster Foods Limited",
        legalName: "Aster Foods Limited",
        pan: "AABCA9999Z",
        gstin: "27AABCA9999Z1Z5",
        panMasked: "******9999",
        email: "tax@asterfoods.local",
        phone: "+91 98200 99999",
        relationshipOwnerId: DEMO_ACTOR_IDS.staff,
        relationshipOwnerName: "Rohan Mehta",
        status: "on_hold",
        notes: "Moved to quarterly review",
        entityType: "private_limited",
        addressLine1: "12 Marine Drive",
        addressLine2: "Nariman Point",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400021",
        tan: "MUMA12345B",
        cinLlpin: "U12345MH2020PTC123456",
        udyamNumber: "UDYAM-MH-01-0000001",
        iec: "ABCDE12345",
        incorporationDate: "2015-04-01",
      });
      expect(updated.updatedAt).not.toBe(ASTER_UPDATED_AT);
    });

    it("normalizes identifiers to upper case, turns blanks into null, and leaves omitted fields alone", async () => {
      const { application, founder } = await actors();
      const updated = await application.updateClient(
        founder,
        ASTER,
        { tan: " muma12345b ", notes: "   ", expectedUpdatedAt: ASTER_UPDATED_AT },
        "normalize",
      );
      expect(updated.tan).toBe("MUMA12345B");
      expect(updated.notes).toBeNull();
      expect(updated.pan).toBe(ASTER_PAN);
      expect(updated.displayName).toBe("Aster Foods");
    });

    it("lets the relationship owner edit details but not the owner or status", async () => {
      const { application, staff } = await actors();
      const edited = await application.updateClient(
        staff,
        BLUEPEAK,
        { email: "ops@bluepeak.local", city: "Pune", state: "Maharashtra", expectedUpdatedAt: ASTER_UPDATED_AT },
        "owner-edit",
      );
      expect(edited).toMatchObject({ email: "ops@bluepeak.local", city: "Pune", canEdit: true, canChangeOwnerOrStatus: false });

      const denied = { status: 403, code: "role_not_permitted" };
      await expect(
        application.updateClient(staff, BLUEPEAK, { relationshipOwnerId: DEMO_ACTOR_IDS.senior, expectedUpdatedAt: edited.updatedAt }, "owner-change"),
      ).rejects.toMatchObject(denied);
      await expect(
        application.updateClient(staff, BLUEPEAK, { status: "archived", expectedUpdatedAt: edited.updatedAt }, "status-change"),
      ).rejects.toMatchObject(denied);

      // Sending the current owner and status back unchanged is not a change
      await expect(
        application.updateClient(
          staff,
          BLUEPEAK,
          { relationshipOwnerId: edited.relationshipOwnerId, status: edited.status, notes: "Same", expectedUpdatedAt: edited.updatedAt },
          "unchanged",
        ),
      ).resolves.toMatchObject({ notes: "Same" });
    });

    it("refuses staff who can see the client but do not own it, and hides it from those who cannot see it", async () => {
      const { application, senior, trainee, staff } = await actors();
      const edit = { notes: "Not mine", expectedUpdatedAt: ASTER_UPDATED_AT };
      await expect(application.updateClient(senior, ASTER, edit, "k1")).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      await expect(application.updateClient(trainee, ASTER, edit, "k2")).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });
      // Staff cannot see Aster at all
      await expect(application.updateClient(staff, ASTER, edit, "k3")).rejects.toMatchObject({ status: 404, code: "not_found" });
    });

    it("refuses a stale edit with the plain stale_client message", async () => {
      const { application, founder } = await actors();
      await expect(
        application.updateClient(founder, ASTER, { notes: "Late", expectedUpdatedAt: "2025-12-31T00:00:00.000Z" }, "stale"),
      ).rejects.toMatchObject({
        status: 409,
        code: "stale_client",
        message: "This client was changed by someone else. Reload and try again.",
      });
    });

    it("refuses a relationship owner who is a trainee or inactive", async () => {
      const { application, founder } = await actors();
      await expect(
        application.updateClient(founder, ASTER, { relationshipOwnerId: DEMO_ACTOR_IDS.trainee, expectedUpdatedAt: ASTER_UPDATED_AT }, "trainee-owner"),
      ).rejects.toMatchObject({ status: 422, message: "A Client relationship owner must be active and cannot be a Trainee." });
    });

    it.each([
      ["PAN", { pan: "ABCDE12345" }, "Enter a valid 10-character PAN, like ABCDE1234F."],
      ["GSTIN", { gstin: "27ABCDE1234F1Y5" }, "Enter a valid 15-character GSTIN."],
      ["TAN", { tan: "ABC12345DE" }, "Enter a valid TAN, like ABCD12345E."],
      ["CIN or LLPIN", { cinLlpin: "X12345" }, "Enter a valid CIN or LLPIN."],
      ["Udyam number", { udyamNumber: "UDYAM-1-2-3" }, "Enter a valid Udyam number, like UDYAM-MH-01-0000001."],
      ["IEC", { iec: "SHORT" }, "Enter a valid 10-character IEC."],
      ["PIN code", { pincode: "012345" }, "Enter a valid 6-digit PIN code."],
    ])("refuses an invalid %s with a plain message", async (_label, change, message) => {
      const { application, founder } = await actors();
      await expect(
        application.updateClient(founder, ASTER, { ...change, expectedUpdatedAt: ASTER_UPDATED_AT }, "invalid"),
      ).rejects.toMatchObject({ status: 422, code: "validation_failed", message });
    });

    it("accepts a CIN, an LLPIN, and clearing an identifier", async () => {
      const { application, founder } = await actors();
      const withLlpin = await application.updateClient(
        founder,
        ASTER,
        { cinLlpin: "aab-1234", expectedUpdatedAt: ASTER_UPDATED_AT },
        "llpin",
      );
      expect(withLlpin.cinLlpin).toBe("AAB-1234");
      const cleared = await application.updateClient(
        founder,
        ASTER,
        { cinLlpin: null, expectedUpdatedAt: withLlpin.updatedAt },
        "clear",
      );
      expect(cleared.cinLlpin).toBeNull();
    });

    it("refuses a state outside the list of Indian states and union territories", async () => {
      const { application, founder } = await actors();
      await expect(
        application.updateClient(founder, ASTER, { state: "Atlantis" as "Goa", expectedUpdatedAt: ASTER_UPDATED_AT }, "state"),
      ).rejects.toMatchObject({ status: 422, code: "validation_failed" });
    });

    it("refuses a GSTIN whose embedded PAN differs, without echoing either value", async () => {
      const { application, founder } = await actors();
      const error = await application
        .updateClient(founder, ASTER, { gstin: "27ZZZZZ9999Z1Z5", expectedUpdatedAt: ASTER_UPDATED_AT }, "mismatch")
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ status: 422, code: "validation_failed", message: "The GSTIN does not match the PAN." });
      expect(JSON.stringify({ message: (error as Error).message, details: (error as { details?: unknown }).details })).not.toMatch(
        /ZZZZZ9999Z|AABCA1234A/,
      );

      // A new PAN against the stored GSTIN is refused the same way
      await expect(
        application.updateClient(founder, ASTER, { pan: "ABCDE1234F", expectedUpdatedAt: ASTER_UPDATED_AT }, "mismatch-2"),
      ).rejects.toMatchObject({ status: 422, message: "The GSTIN does not match the PAN." });

      // Changing both together to a matching pair works
      await expect(
        application.updateClient(
          founder,
          ASTER,
          { pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5", expectedUpdatedAt: ASTER_UPDATED_AT },
          "match",
        ),
      ).resolves.toMatchObject({ pan: "ABCDE1234F", gstin: "27ABCDE1234F1Z5" });
    });

    it("replays an idempotent edit without a second change, and refuses a reused key with another payload", async () => {
      const { application, founder } = await actors();
      const first = await application.updateClient(founder, ASTER, { notes: "Once", expectedUpdatedAt: ASTER_UPDATED_AT }, "same-key");
      const replay = await application.updateClient(founder, ASTER, { notes: "Once", expectedUpdatedAt: ASTER_UPDATED_AT }, "same-key");
      expect(replay).toEqual(first);
      await expect(
        application.updateClient(founder, ASTER, { notes: "Twice", expectedUpdatedAt: ASTER_UPDATED_AT }, "same-key"),
      ).rejects.toMatchObject({ status: 409, code: "conflict" });
    });
  });

  describe("createClient with the new details", () => {
    it("stores entity type, address, registrations, and date of incorporation", async () => {
      const { application, founder } = await actors();
      const created = await application.createClient(founder, {
        displayName: "Horizon Traders",
        entityType: "partnership",
        addressLine1: "4 Station Road",
        city: "Nagpur",
        state: "Maharashtra",
        pincode: "440001",
        tan: "NAGH12345C",
        udyamNumber: "UDYAM-MH-20-0001234",
        iec: "0123456789",
        incorporationDate: "2010-06-15",
      });
      expect(created).toMatchObject({
        entityType: "partnership",
        city: "Nagpur",
        pincode: "440001",
        iec: "0123456789",
        incorporationDate: "2010-06-15",
        contacts: [],
        canEdit: true,
      });
    });

    it("refuses an invalid PIN code", async () => {
      const { application, founder } = await actors();
      await expect(application.createClient(founder, { displayName: "Bad Pin", pincode: "12" })).rejects.toMatchObject({
        status: 422,
        message: "Enter a valid 6-digit PIN code.",
      });
    });
  });

  describe("contacts", () => {
    const priya = { name: "Priya Nair", designation: "Finance Head", email: "priya@asterfoods.local", phone: "+91 98200 55555" };

    it("adds, edits and deletes contacts, listing the primary first and then by name", async () => {
      const { application, founder } = await actors();
      const zed = await application.createClientContact(founder, ASTER, { name: "Zed Khan", whatsapp: "98200 11111" }, "c1");
      const amit = await application.createClientContact(founder, ASTER, { name: "Amit Shah", email: "amit@asterfoods.local" }, "c2");
      const main = await application.createClientContact(founder, ASTER, { ...priya, isPrimary: true }, "c3");

      let client = await application.getClient(founder, ASTER);
      expect(client.contacts.map((contact) => contact.name)).toEqual(["Priya Nair", "Amit Shah", "Zed Khan"]);
      expect(main).toMatchObject({ isPrimary: true, designation: "Finance Head", notes: null });

      const edited = await application.updateClientContact(
        founder,
        zed.id,
        { designation: "Auditor", notes: "Call after 4 pm", expectedUpdatedAt: zed.updatedAt },
        "c4",
      );
      expect(edited).toMatchObject({ designation: "Auditor", notes: "Call after 4 pm", whatsapp: "98200 11111" });

      await application.deleteClientContact(founder, amit.id);
      client = await application.getClient(founder, ASTER);
      expect(client.contacts.map((contact) => contact.name)).toEqual(["Priya Nair", "Zed Khan"]);
      await expect(application.deleteClientContact(founder, amit.id)).rejects.toMatchObject({ status: 404 });
    });

    it("keeps one primary contact per client", async () => {
      const { application, founder } = await actors();
      const first = await application.createClientContact(founder, ASTER, { ...priya, isPrimary: true }, "p1");
      const second = await application.createClientContact(founder, ASTER, { name: "Amit Shah", phone: "98200 22222", isPrimary: true }, "p2");
      let client = await application.getClient(founder, ASTER);
      expect(client.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.name)).toEqual(["Amit Shah"]);

      await application.updateClientContact(founder, first.id, { isPrimary: true, expectedUpdatedAt: first.updatedAt }, "p3");
      client = await application.getClient(founder, ASTER);
      expect(client.contacts.filter((contact) => contact.isPrimary).map((contact) => contact.name)).toEqual(["Priya Nair"]);
      expect(client.contacts.find((contact) => contact.id === second.id)?.isPrimary).toBe(false);
    });

    it("needs a name of 2 to 120 characters and at least one way to reach the contact", async () => {
      const { application, founder } = await actors();
      await expect(application.createClientContact(founder, ASTER, { name: "P", email: "p@asterfoods.local" }, "v1")).rejects.toMatchObject({
        status: 422,
        message: "Contact name must be between 2 and 120 characters.",
      });
      await expect(application.createClientContact(founder, ASTER, { name: "Priya Nair" }, "v2")).rejects.toMatchObject({
        status: 422,
        message: "Add at least one way to reach this contact.",
      });
      const contact = await application.createClientContact(founder, ASTER, { name: "Priya Nair", phone: "98200 33333" }, "v3");
      // Removing the only way to reach the contact is refused too
      await expect(
        application.updateClientContact(founder, contact.id, { phone: null, expectedUpdatedAt: contact.updatedAt }, "v4"),
      ).rejects.toMatchObject({ status: 422, message: "Add at least one way to reach this contact." });
      await expect(
        application.createClientContact(founder, ASTER, { name: "Priya Nair", phone: "call me" }, "v5"),
      ).rejects.toMatchObject({ status: 422, code: "validation_failed" });
    });

    it("refuses a stale contact edit with the plain stale_contact message", async () => {
      const { application, founder } = await actors();
      const contact = await application.createClientContact(founder, ASTER, priya, "s1");
      await application.updateClientContact(founder, contact.id, { notes: "First", expectedUpdatedAt: contact.updatedAt }, "s2");
      await expect(
        application.updateClientContact(founder, contact.id, { notes: "Second", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, "s3"),
      ).rejects.toMatchObject({
        status: 409,
        code: "stale_contact",
        message: "This contact was changed by someone else. Reload and try again.",
      });
    });

    it("replays an idempotent add as one contact", async () => {
      const { application, founder } = await actors();
      const first = await application.createClientContact(founder, ASTER, priya, "r1");
      const replay = await application.createClientContact(founder, ASTER, priya, "r1");
      expect(replay).toEqual(first);
      expect((await application.getClient(founder, ASTER)).contacts).toHaveLength(1);
      await expect(
        application.createClientContact(founder, ASTER, { ...priya, name: "Someone Else" }, "r1"),
      ).rejects.toMatchObject({ status: 409, code: "conflict" });
    });

    it("lets the relationship owner manage contacts and refuses everyone else who can see the client", async () => {
      const { application, founder, staff, senior, trainee } = await actors();
      const ownerContact = await application.createClientContact(staff, BLUEPEAK, priya, "o1");
      await application.updateClientContact(staff, ownerContact.id, { designation: "CFO", expectedUpdatedAt: ownerContact.updatedAt }, "o2");

      const asterContact = await application.createClientContact(founder, ASTER, priya, "o3");
      const denied = { status: 403, code: "role_not_permitted" };
      await expect(application.createClientContact(senior, ASTER, priya, "o4")).rejects.toMatchObject(denied);
      await expect(
        application.updateClientContact(senior, asterContact.id, { designation: "X", expectedUpdatedAt: asterContact.updatedAt }, "o5"),
      ).rejects.toMatchObject(denied);
      await expect(application.deleteClientContact(trainee, asterContact.id)).rejects.toMatchObject(denied);

      // Staff cannot see Aster, so its contacts do not exist for them
      await expect(application.createClientContact(staff, ASTER, priya, "o6")).rejects.toMatchObject({ status: 404 });
      await expect(application.deleteClientContact(staff, asterContact.id)).rejects.toMatchObject({ status: 404 });

      await application.deleteClientContact(staff, ownerContact.id);
      expect((await application.getClient(staff, BLUEPEAK)).contacts).toEqual([]);
    });
  });
});

describe("DOC-01a client documents", () => {
  const ASTER = CANONICAL_CLIENT_1; // looked after by the Founder, Manager and Senior Staff, not by Staff
  const BLUEPEAK = "10000000-0000-4000-a000-000000000002"; // owner: Staff; Senior Staff does not look after it
  let keyCounter = 0;
  const key = () => `doc-key-${++keyCounter}`;

  async function documentFixture() {
    const { application, repository } = createFixture();
    return {
      application,
      repository,
      founder: await application.requireActor(DEMO_ACTOR_IDS.founder),
      manager: await application.requireActor(DEMO_ACTOR_IDS.manager),
      senior: await application.requireActor(DEMO_ACTOR_IDS.senior),
      staff: await application.requireActor(DEMO_ACTOR_IDS.staff),
      trainee: await application.requireActor(DEMO_ACTOR_IDS.trainee),
    };
  }

  const documentInput = (overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput => ({
    clientId: BLUEPEAK,
    title: "PAN card",
    category: "kyc",
    financialYearStart: null,
    fileName: "pan card (1).pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    ...overrides,
  });

  it("creates a pending document with a safe storage path and keeps it out of the list until confirmed", async () => {
    const { application, staff } = await documentFixture();
    const created = await application.createDocument(staff, documentInput({ financialYearStart: 2026 }), key());
    expect(created).toMatchObject({
      clientId: BLUEPEAK,
      clientCode: "CL-001002",
      clientName: "BluePeak Tech",
      title: "PAN card",
      category: "kyc",
      financialYearStart: 2026,
      fileName: "pan card (1).pdf",
      status: "pending",
      uploadedById: staff.id,
      removedReason: null,
      removedAt: null,
    });
    expect(created.uploadedByName).toBe(staff.name);
    expect(created.storagePath).toBe(`clients/${BLUEPEAK}/${created.id}/pan_card__1_.pdf`);
    expect(await application.listDocuments(staff)).toEqual([]);
  });

  it("confirms only after the file is in Storage and stores the real size", async () => {
    const { application, repository, staff } = await documentFixture();
    const created = await application.createDocument(staff, documentInput(), key());

    await expect(application.confirmDocument(staff, created.id, key())).rejects.toMatchObject({
      status: 422,
      code: "upload_missing",
      message: "The file has not finished uploading. Try again.",
    });

    repository.markObjectUploaded(created.storagePath, 4096);
    const confirmed = await application.confirmDocument(staff, created.id, key());
    expect(confirmed).toMatchObject({ id: created.id, status: "available", sizeBytes: 4096 });
    expect((await application.listDocuments(staff)).map((document) => document.id)).toEqual([created.id]);
  });

  it("refuses an uploaded object that is over the limit", async () => {
    const { application, repository, staff } = await documentFixture();
    const created = await application.createDocument(staff, documentInput(), key());
    repository.markObjectUploaded(created.storagePath, 26214401);
    await expect(application.confirmDocument(staff, created.id, key())).rejects.toMatchObject({
      status: 422,
      code: "file_too_large",
      message: "The file is larger than 25 MB.",
    });
  });

  it("refuses a file over 25 MB or of a type that is not allowed before touching the repository", async () => {
    const { application, repository, staff } = await documentFixture();
    const spy = vi.spyOn(repository, "createClientDocument");
    await expect(application.createDocument(staff, documentInput({ sizeBytes: 26214401 }), key())).rejects.toMatchObject({
      status: 422,
      code: "file_too_large",
      message: "The file is larger than 25 MB.",
    });
    const notAllowed = {
      status: 422,
      code: "file_type_not_allowed",
      message: "Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.",
    };
    await expect(
      application.createDocument(staff, documentInput({ fileName: "setup.exe", mimeType: "application/x-msdownload" }), key()),
    ).rejects.toMatchObject(notAllowed);
    // The extension must match the mime type
    await expect(application.createDocument(staff, documentInput({ fileName: "scan.png" }), key())).rejects.toMatchObject(notAllowed);
    await expect(application.createDocument(staff, documentInput({ fileName: "scan" }), key())).rejects.toMatchObject(notAllowed);
    expect(spy).not.toHaveBeenCalled();

    // Upper-case extensions and the two JPEG spellings are accepted
    await application.createDocument(staff, documentInput({ fileName: "SCAN.JPEG", mimeType: "image/jpeg" }), key());
    await application.createDocument(staff, documentInput({ fileName: "scan.jpg", mimeType: "image/jpeg" }), key());
  });

  it("validates the title, category, financial year and file name", async () => {
    const { application, staff } = await documentFixture();
    const invalid = { status: 422, code: "validation_failed" };
    await expect(application.createDocument(staff, documentInput({ title: "A" }), key())).rejects.toMatchObject(invalid);
    await expect(
      application.createDocument(staff, documentInput({ category: "photos" as unknown as CreateDocumentInput["category"] }), key()),
    ).rejects.toMatchObject(invalid);
    await expect(application.createDocument(staff, documentInput({ financialYearStart: 1999 }), key())).rejects.toMatchObject(invalid);
    await expect(application.createDocument(staff, documentInput({ fileName: "../pan.pdf" }), key())).rejects.toMatchObject(invalid);
    await expect(application.createDocument(staff, documentInput({ sizeBytes: 0 }), key())).rejects.toMatchObject(invalid);
  });

  it("lets only the people who look after the client upload and see its documents", async () => {
    const { application, repository, founder, senior, staff, trainee } = await documentFixture();

    // Staff looks after BluePeak; Senior Staff does not
    const created = await application.createDocument(staff, documentInput(), key());
    repository.markObjectUploaded(created.storagePath, 100);
    await application.confirmDocument(staff, created.id, key());
    await expect(application.createDocument(senior, documentInput(), key())).rejects.toMatchObject({ status: 404 });
    await expect(application.createDocument(trainee, documentInput(), key())).rejects.toMatchObject({ status: 404 });

    // Senior Staff reviews an Aster assignment; Staff does not look after Aster
    const asterDocument = await application.createDocument(senior, documentInput({ clientId: ASTER, title: "Agreement" }), key());
    repository.markObjectUploaded(asterDocument.storagePath, 100);
    await application.confirmDocument(senior, asterDocument.id, key());
    await expect(application.createDocument(staff, documentInput({ clientId: ASTER }), key())).rejects.toMatchObject({
      status: 404,
      message: "Client was not found.",
    });

    expect((await application.listDocuments(founder)).map((document) => document.id).sort()).toEqual(
      [created.id, asterDocument.id].sort(),
    );
    expect((await application.listDocuments(staff)).map((document) => document.id)).toEqual([created.id]);
    expect((await application.listDocuments(senior)).map((document) => document.id)).toEqual([asterDocument.id]);
    expect(await application.listDocuments(trainee)).toEqual([]);
    expect((await application.listDocuments(founder, ASTER)).map((document) => document.id)).toEqual([asterDocument.id]);
    await expect(application.listDocuments(founder, "not-a-uuid")).rejects.toMatchObject({ status: 422 });
  });

  it("lists the newest documents first", async () => {
    const { application, repository, founder } = await documentFixture();
    const first = await application.createDocument(founder, documentInput({ title: "First" }), key());
    const second = await application.createDocument(founder, documentInput({ title: "Second" }), key());
    for (const document of [first, second]) {
      repository.markObjectUploaded(document.storagePath, 10);
      await application.confirmDocument(founder, document.id, key());
    }
    expect((await application.listDocuments(founder)).map((document) => document.title)).toEqual(["Second", "First"]);
  });

  it("lets only the uploader confirm, and only a pending document", async () => {
    const { application, repository, founder, staff } = await documentFixture();
    const created = await application.createDocument(staff, documentInput(), key());
    repository.markObjectUploaded(created.storagePath, 10);
    await expect(application.confirmDocument(founder, created.id, key())).rejects.toMatchObject({ status: 403 });
    await application.confirmDocument(staff, created.id, key());
    await expect(application.confirmDocument(staff, created.id, key())).rejects.toMatchObject({
      status: 409,
      code: "invalid_state_transition",
    });
    await expect(application.confirmDocument(staff, "72000000-0000-4000-a000-0000000000ff", key())).rejects.toMatchObject({
      status: 404,
      message: "Document was not found.",
    });
  });

  it("replays create and confirm for the same key and rejects the key for a different payload", async () => {
    const { application, repository, staff } = await documentFixture();
    const createKey = key();
    const created = await application.createDocument(staff, documentInput(), createKey);
    expect(await application.createDocument(staff, documentInput(), createKey)).toEqual(created);
    await expect(application.createDocument(staff, documentInput({ title: "Other" }), createKey)).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });

    repository.markObjectUploaded(created.storagePath, 10);
    const confirmKey = key();
    const confirmed = await application.confirmDocument(staff, created.id, confirmKey);
    expect(await application.confirmDocument(staff, created.id, confirmKey)).toEqual(confirmed);
  });

  it("lets staff on the client and management remove a document, refuses trainees, and keeps the record", async () => {
    const { application, repository, manager, founder, staff } = await documentFixture();
    const created = await application.createDocument(staff, documentInput(), key());
    repository.markObjectUploaded(created.storagePath, 10);
    await application.confirmDocument(staff, created.id, key());

    const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);
    const spy = vi.spyOn(repository, "removeClientDocument");
    await expect(application.removeDocument(trainee, created.id, { reason: "Wrong file" }, key())).rejects.toMatchObject({
      status: 403,
      code: "role_not_permitted",
      message: "Trainees cannot remove documents.",
    });
    expect(spy).not.toHaveBeenCalled();
    await expect(application.removeDocument(manager, created.id, { reason: "No" }, key())).rejects.toMatchObject({
      status: 422,
      code: "validation_failed",
    });

    const removeKey = key();
    const removed = await application.removeDocument(manager, created.id, { reason: "  Wrong file  " }, removeKey);
    expect(removed).toMatchObject({ id: created.id, status: "removed", removedReason: "Wrong file" });
    expect(removed.removedAt).not.toBeNull();
    expect(await application.removeDocument(manager, created.id, { reason: "Wrong file" }, removeKey)).toEqual(removed);
    await expect(application.removeDocument(founder, created.id, { reason: "Again" }, key())).rejects.toMatchObject({
      status: 422,
      code: "already_removed",
    });
    expect(await application.listDocuments(founder)).toEqual([]);
    expect(await application.listDocuments(staff)).toEqual([]);

    // Staff who look after the client can remove a document themselves.
    const second = await application.createDocument(staff, documentInput(), key());
    repository.markObjectUploaded(second.storagePath, 10);
    await application.confirmDocument(staff, second.id, key());
    const byStaff = await application.removeDocument(staff, second.id, { reason: "Duplicate upload" }, key());
    expect(byStaff).toMatchObject({ id: second.id, status: "removed", removedReason: "Duplicate upload" });
  });

  it("refuses to remove a document that is still waiting for its upload", async () => {
    const { application, founder, staff } = await documentFixture();
    const created = await application.createDocument(staff, documentInput(), key());
    await expect(application.removeDocument(founder, created.id, { reason: "Not needed" }, key())).rejects.toMatchObject({
      status: 409,
      code: "invalid_state_transition",
    });
  });
});

describe("MSG-01 client messages", () => {
  const ASTER = CANONICAL_CLIENT_1; // looked after by the Founder, Manager and Senior Staff, not by Staff
  const BLUEPEAK = "10000000-0000-4000-a000-000000000002"; // owner: Staff; Senior Staff does not look after it
  const ASTER_BILL = "70000000-0000-4000-a000-000000000001";
  const ASTER_ASSIGNMENT = "30000000-0000-4000-a000-000000000001";
  const BLUEPEAK_ASSIGNMENT = "30000000-0000-4000-a000-000000000002";
  let keyCounter = 0;
  const key = () => `msg-key-${++keyCounter}`;

  async function messageFixture() {
    const { application, repository } = createFixture();
    return {
      application,
      repository,
      founder: await application.requireActor(DEMO_ACTOR_IDS.founder),
      manager: await application.requireActor(DEMO_ACTOR_IDS.manager),
      senior: await application.requireActor(DEMO_ACTOR_IDS.senior),
      staff: await application.requireActor(DEMO_ACTOR_IDS.staff),
      trainee: await application.requireActor(DEMO_ACTOR_IDS.trainee),
    };
  }

  const messageInput = (overrides: Partial<RecordClientMessageInput> = {}): RecordClientMessageInput => ({
    clientId: BLUEPEAK,
    recipientName: "Rahul Shah",
    recipientNumber: "98200 12345",
    purpose: "general",
    body: "Dear Rahul, please share the bank statements.",
    ...overrides,
  });

  it("records a message and lists it newest first for the people who look after the client", async () => {
    const { application, founder, manager, senior, staff } = await messageFixture();
    const first = await application.recordClientMessage(
      staff,
      messageInput({ purpose: "deadline_reminder", assignmentId: BLUEPEAK_ASSIGNMENT }),
      key(),
    );
    expect(first).toMatchObject({
      clientId: BLUEPEAK,
      clientCode: "CL-001002",
      clientName: "BluePeak Tech",
      recipientName: "Rahul Shah",
      recipientNumber: "919820012345",
      channel: "whatsapp",
      purpose: "deadline_reminder",
      assignmentCode: "AS-001002",
      invoiceLabel: null,
      status: "opened",
      sentById: staff.id,
      sentByName: staff.name,
    });
    const second = await application.recordClientMessage(
      manager,
      messageInput({ purpose: "payment_reminder", body: "A gentle reminder." }),
      key(),
    );
    const aster = await application.recordClientMessage(
      senior,
      messageInput({ clientId: ASTER, purpose: "payment_reminder", invoiceId: ASTER_BILL }),
      key(),
    );
    expect(aster.invoiceLabel).toBe("VYP-118");

    expect((await application.listClientMessages(founder)).map((message) => message.id).sort()).toEqual(
      [first.id, second.id, aster.id].sort(),
    );
    expect((await application.listClientMessages(staff)).map((message) => message.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await application.listClientMessages(senior)).map((message) => message.id)).toEqual([aster.id]);
    expect((await application.listClientMessages(founder, ASTER)).map((message) => message.id)).toEqual([aster.id]);
    await expect(application.listClientMessages(founder, "not-a-uuid")).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a trainee before touching the repository, and shows a trainee no messages", async () => {
    const { application, repository, staff, trainee } = await messageFixture();
    await application.recordClientMessage(staff, messageInput(), key());
    const spy = vi.spyOn(repository, "recordClientMessage");
    await expect(application.recordClientMessage(trainee, messageInput(), key())).rejects.toMatchObject({
      status: 403,
      code: "role_not_permitted",
      message: "Trainees cannot message clients.",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(await application.listClientMessages(trainee)).toEqual([]);
  });

  it("keeps other staff out of clients they do not look after", async () => {
    const { application, senior, staff } = await messageFixture();
    await expect(application.recordClientMessage(senior, messageInput(), key())).rejects.toMatchObject({
      status: 404,
      message: "Client was not found.",
    });
    await expect(
      application.recordClientMessage(staff, messageInput({ clientId: ASTER }), key()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("normalises the number to digits with the country code", async () => {
    const { application, staff } = await messageFixture();
    const record = async (recipientNumber: string) =>
      (await application.recordClientMessage(staff, messageInput({ recipientNumber }), key())).recipientNumber;
    expect(await record("98200 12345")).toBe("919820012345");
    expect(await record("+91 98200-12345")).toBe("919820012345");
    expect(await record("6000000000")).toBe("916000000000");
    expect(await record("919820012345")).toBe("919820012345");
    expect(await record("+44 7911 123456")).toBe("447911123456");
    expect(await record("+1 (415) 555-2671")).toBe("14155552671");
  });

  it("refuses a number that is neither a 10-digit mobile number nor carries a country code", async () => {
    const { application, repository, staff } = await messageFixture();
    const spy = vi.spyOn(repository, "recordClientMessage");
    const refused = {
      status: 422,
      code: "validation_failed",
      message: "Enter a WhatsApp number with 10 digits, or with the country code.",
    };
    for (const recipientNumber of ["12345", "5820012345", "98200 1234", "1234567890123456", "no number", "   "]) {
      await expect(
        application.recordClientMessage(staff, messageInput({ recipientNumber }), key()),
      ).rejects.toMatchObject(refused);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates the body, the recipient name, the purpose and the identifiers", async () => {
    const { application, staff } = await messageFixture();
    const invalid = { status: 422, code: "validation_failed" };
    await expect(application.recordClientMessage(staff, messageInput({ body: "" }), key())).rejects.toMatchObject({
      ...invalid,
      message: "The message must be between 1 and 2000 characters.",
    });
    await expect(application.recordClientMessage(staff, messageInput({ body: "   " }), key())).rejects.toMatchObject(invalid);
    await expect(
      application.recordClientMessage(staff, messageInput({ body: "x".repeat(2001) }), key()),
    ).rejects.toMatchObject(invalid);
    await application.recordClientMessage(staff, messageInput({ body: "x".repeat(2000) }), key());
    await expect(application.recordClientMessage(staff, messageInput({ recipientName: "" }), key())).rejects.toMatchObject(invalid);
    await expect(
      application.recordClientMessage(staff, messageInput({ recipientName: "n".repeat(121) }), key()),
    ).rejects.toMatchObject(invalid);
    await expect(
      application.recordClientMessage(staff, messageInput({ purpose: "chat" as unknown as RecordClientMessageInput["purpose"] }), key()),
    ).rejects.toMatchObject(invalid);
    await expect(application.recordClientMessage(staff, messageInput({ clientId: "nope" }), key())).rejects.toMatchObject(invalid);
    await expect(application.recordClientMessage(staff, messageInput({ contactId: "nope" }), key())).rejects.toMatchObject(invalid);
  });

  it("refuses an assignment, bill or contact that belongs to another client", async () => {
    const { application, staff } = await messageFixture();
    const linked = { status: 422, message: "The linked work does not belong to this client." };
    await expect(
      application.recordClientMessage(staff, messageInput({ assignmentId: ASTER_ASSIGNMENT }), key()),
    ).rejects.toMatchObject(linked);
    await expect(
      application.recordClientMessage(staff, messageInput({ invoiceId: ASTER_BILL }), key()),
    ).rejects.toMatchObject(linked);
    await expect(
      application.recordClientMessage(staff, messageInput({ contactId: "74000000-0000-4000-a000-0000000000ff" }), key()),
    ).rejects.toMatchObject({ status: 422, message: "The contact does not belong to this client." });
  });

  it("replays a write for the same key and rejects the key for a different payload", async () => {
    const { application, staff } = await messageFixture();
    const replayKey = key();
    const first = await application.recordClientMessage(staff, messageInput(), replayKey);
    expect(await application.recordClientMessage(staff, messageInput(), replayKey)).toEqual(first);
    // The same number written another way is the same payload
    expect(
      await application.recordClientMessage(staff, messageInput({ recipientNumber: "+919820012345" }), replayKey),
    ).toEqual(first);
    expect(await application.listClientMessages(staff)).toHaveLength(1);
    await expect(
      application.recordClientMessage(staff, messageInput({ body: "Other text" }), replayKey),
    ).rejects.toMatchObject({ status: 409, code: "conflict" });
  });
});

describe("REP-01 reports", () => {
  async function reportFixture(now = "2026-10-30T12:00:00.000Z") {
    const repository = new InMemoryCrmRepository(createDemoSeed());
    const application = new CrmApplication(repository, { now: () => new Date(now) });
    return {
      application,
      repository,
      founder: await application.requireActor(DEMO_ACTOR_IDS.founder),
      manager: await application.requireActor(DEMO_ACTOR_IDS.manager),
      senior: await application.requireActor(DEMO_ACTOR_IDS.senior),
      staff: await application.requireActor(DEMO_ACTOR_IDS.staff),
      trainee: await application.requireActor(DEMO_ACTOR_IDS.trainee),
    };
  }

  it("gives the Founder and Manager every employee row and everyone else only their own", async () => {
    const { application, founder, manager, senior, staff } = await reportFixture();
    expect((await application.getPracticeReport(founder, { period: "week" })).teamActivity).toHaveLength(5);
    expect((await application.getPracticeReport(manager, { period: "week" })).teamActivity).toHaveLength(5);
    expect((await application.getPracticeReport(senior, { period: "week" })).teamActivity.map((row) => row.role)).toEqual(["senior_staff"]);
    expect((await application.getPracticeReport(staff, { period: "week" })).teamActivity.map((row) => row.role)).toEqual(["staff"]);
  });

  it("limits Staff to their own assignments and gives every role that can see bills a fees section", async () => {
    const { application, founder, manager, senior, staff } = await reportFixture();
    const owners = async (actor: typeof founder) =>
      (await application.getPracticeReport(actor, { period: "month" })).workProgress.byOwner.map((row) => row.ownerName);
    expect((await owners(founder)).length).toBeGreaterThan(1);
    expect(await owners(staff)).toEqual(["Rohan Mehta"]);
    for (const actor of [founder, manager, senior, staff]) {
      expect((await application.getPracticeReport(actor, { period: "month" })).fees).not.toBeNull();
    }
  });

  it("refuses a Trainee before reading the query or the repository", async () => {
    const { application, repository, trainee } = await reportFixture();
    const spy = vi.spyOn(repository, "getPracticeReport");
    await expect(application.getPracticeReport(trainee, { period: "day" })).rejects.toMatchObject({
      status: 403,
      code: "role_not_permitted",
      message: "Trainees do not have reports.",
    });
    await expect(application.getPracticeReport(trainee, { period: "century" })).rejects.toMatchObject({ status: 403 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("resolves the period from the date, and defaults to today in Kolkata", async () => {
    const { application, founder } = await reportFixture();
    expect((await application.getPracticeReport(founder, { period: "day" })).period).toEqual({
      kind: "day",
      start: "2026-10-30",
      endExclusive: "2026-10-31",
      label: "30 Oct 2026",
    });
    expect((await application.getPracticeReport(founder, { period: "week", date: "2026-11-01" })).period).toEqual({
      kind: "week",
      start: "2026-10-26",
      endExclusive: "2026-11-02",
      label: "26 Oct – 1 Nov 2026",
    });
    expect((await application.getPracticeReport(founder, { period: "month", date: "2026-02-15" })).period).toEqual({
      kind: "month",
      start: "2026-02-01",
      endExclusive: "2026-03-01",
      label: "February 2026",
    });

    // 20:00 UTC on 30 October is already 31 October in Kolkata
    const late = await reportFixture("2026-10-30T20:00:00.000Z");
    expect((await late.application.getPracticeReport(late.founder, { period: "day" })).period.start).toBe("2026-10-31");
  });

  it.each([
    [{}, "period must be day, week or month."],
    [{ period: "year" }, "period must be day, week or month."],
    [{ period: "day", date: "30/10/2026" }, "Must be YYYY-MM-DD"],
    [{ period: "day", date: "2026-02-30" }, "Must be a valid calendar date in YYYY-MM-DD format."],
    [{ period: "day", date: "" }, "Must be YYYY-MM-DD"],
  ])("rejects the invalid query %j", async (query, message) => {
    const { application, founder } = await reportFixture();
    await expect(application.getPracticeReport(founder, query)).rejects.toMatchObject({
      status: 422,
      code: "validation_failed",
      message,
    });
  });
});

describe("SLA-01 turnaround tracking", () => {
  const GST = "50000000-0000-4000-a000-000000000001";
  const AUDIT = "50000000-0000-4000-a000-000000000002";
  const TDS = "50000000-0000-4000-a000-000000000003";

  // GST has a usual turnaround of 5 working days, TDS of 2, and Internal Audit has none.
  async function slaFixture() {
    let nowValue = "2026-10-30T12:00:00.000Z"; // a Friday
    const now = () => new Date(nowValue);
    const seed = createDemoSeed();
    seed.assignments = [];
    seed.services = [
      { id: GST, name: "GST Compliance", turnaroundDays: 5 },
      { id: AUDIT, name: "Internal Audit" },
      { id: TDS, name: "Tax Compliance (TDS)", turnaroundDays: 2 },
    ];
    const repository = new InMemoryCrmRepository(seed, { now });
    const application = new CrmApplication(repository, { now });
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
    const create = (serviceId: string, ownerId: string, title: string) =>
      application.createAssignment(founder, {
        clientId: CANONICAL_CLIENT_1,
        title,
        serviceId,
        ownerId,
        reviewerIds: [DEMO_ACTOR_IDS.manager],
        dueAt: "2026-12-01T12:30:00.000Z",
      });
    return {
      application,
      founder,
      staff,
      senior,
      create,
      setNow: (value: string) => {
        nowValue = value;
      },
    };
  }

  it("gives a new assignment the service turnaround as its target, counted in working days", async () => {
    const { create } = await slaFixture();
    // Fri 30 Oct, then Sat 31, Mon 2, Tue 3, Wed 4 and Thu 5 November
    expect((await create(GST, DEMO_ACTOR_IDS.staff, "GSTR-1")).sla).toEqual({
      targetDays: 5,
      deadline: "2026-11-05",
      status: "on_track",
      workingDaysUsed: 0,
      workingDaysLeft: 5,
    });
  });

  it("has no SLA when the service has no turnaround", async () => {
    const { create } = await slaFixture();
    expect((await create(AUDIT, DEMO_ACTOR_IDS.staff, "Audit")).sla).toBeNull();
  });

  it("moves a running assignment through at risk to breached as the application clock advances", async () => {
    const { application, founder, create, setNow } = await slaFixture();
    const created = await create(GST, DEMO_ACTOR_IDS.staff, "GSTR-1");
    const statusOn = async (now: string) => {
      setNow(now);
      return (await application.listAssignments(founder)).find((row) => row.id === created.id)?.sla;
    };
    expect(await statusOn("2026-11-02T12:00:00.000Z")).toMatchObject({ status: "on_track", workingDaysUsed: 2, workingDaysLeft: 3 });
    expect(await statusOn("2026-11-03T12:00:00.000Z")).toMatchObject({ status: "at_risk", workingDaysUsed: 3, workingDaysLeft: 2 });
    expect(await statusOn("2026-11-04T12:00:00.000Z")).toMatchObject({ status: "at_risk", workingDaysLeft: 1 });
    expect(await statusOn("2026-11-05T12:00:00.000Z")).toMatchObject({ status: "at_risk", workingDaysLeft: 0 });
    expect(await statusOn("2026-11-06T12:00:00.000Z")).toMatchObject({ status: "breached", workingDaysLeft: 0 });
  });

  it("stops the clock when the work is submitted for review", async () => {
    const { application, staff, create, setNow } = await slaFixture();
    const created = await create(GST, DEMO_ACTOR_IDS.staff, "GSTR-1");
    setNow("2026-11-04T12:00:00.000Z");
    const submitted = await application.transitionAssignment(staff, created.id, "submit");
    expect(submitted.sla).toEqual({ targetDays: 5, deadline: "2026-11-05", status: "met", workingDaysUsed: 4, workingDaysLeft: 0 });

    // The stopped clock no longer moves
    setNow("2026-12-20T12:00:00.000Z");
    expect((await application.listAssignments(staff)).find((row) => row.id === created.id)?.sla).toEqual(submitted.sla);
  });

  it("marks work submitted after the deadline as late", async () => {
    const { application, staff, create, setNow } = await slaFixture();
    const created = await create(GST, DEMO_ACTOR_IDS.staff, "GSTR-1");
    setNow("2026-11-09T12:00:00.000Z");
    const submitted = await application.transitionAssignment(staff, created.id, "submit");
    expect(submitted.sla).toMatchObject({ status: "late", workingDaysUsed: 8, workingDaysLeft: 0 });
  });

  it("reports SLA met, late, at risk, breached and no target by service and by person", async () => {
    const { application, founder, staff, create, setNow } = await slaFixture();
    const a = await create(GST, DEMO_ACTOR_IDS.staff, "A, GST for Staff");
    await create(GST, DEMO_ACTOR_IDS.senior, "B, GST for Senior");
    const c = await create(TDS, DEMO_ACTOR_IDS.staff, "C, TDS for Staff");
    await create(AUDIT, DEMO_ACTOR_IDS.staff, "D, no turnaround");

    setNow("2026-11-02T12:00:00.000Z"); // C's deadline day
    await application.transitionAssignment(staff, c.id, "submit");
    setNow("2026-11-06T12:00:00.000Z"); // A and B are past 5 November
    await application.transitionAssignment(staff, a.id, "submit");

    const sla = (await application.getPracticeReport(founder, { period: "month", date: "2026-11-06" })).workProgress.sla;
    expect(sla.summary).toEqual({ metInPeriod: 1, lateInPeriod: 1, atRiskNow: 0, breachedNow: 1, noTarget: 1 });
    expect(sla.byService).toEqual([
      { serviceName: "GST Compliance", targetDays: 5, met: 0, late: 1, atRiskNow: 0, breachedNow: 1 },
      { serviceName: "Tax Compliance (TDS)", targetDays: 2, met: 1, late: 0, atRiskNow: 0, breachedNow: 0 },
    ]);
    expect(sla.byOwner).toEqual([
      { ownerName: "Ananya Rao", met: 0, late: 0, atRiskNow: 0, breachedNow: 1 },
      { ownerName: "Rohan Mehta", met: 1, late: 1, atRiskNow: 0, breachedNow: 0 },
    ]);

    // Work stopped in November does not count in October, but running work is always counted as at now
    const october = (await application.getPracticeReport(founder, { period: "month", date: "2026-10-15" })).workProgress.sla;
    expect(october.summary).toMatchObject({ metInPeriod: 0, lateInPeriod: 0, breachedNow: 1 });
  });

  it("counts only the assignments the person can see in their report", async () => {
    const { application, staff, create, setNow } = await slaFixture();
    await create(GST, DEMO_ACTOR_IDS.staff, "A, GST for Staff");
    await create(GST, DEMO_ACTOR_IDS.senior, "B, GST for Senior");
    setNow("2026-11-06T12:00:00.000Z");
    const sla = (await application.getPracticeReport(staff, { period: "month", date: "2026-11-06" })).workProgress.sla;
    expect(sla.summary.breachedNow).toBe(1);
    expect(sla.byOwner.map((row) => row.ownerName)).toEqual(["Rohan Mehta"]);
  });
});
