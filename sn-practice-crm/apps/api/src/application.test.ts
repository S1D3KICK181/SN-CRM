import { describe, expect, it, vi } from "vitest";
import * as domain from "@sn/domain";
import type {
  AssignmentDto,
  ClientDto,
  CreateAssignmentInput,
  CreateRecurringScheduleInput,
  LedgerEntryDto,
  RecurringScheduleDto,
  ReportingLineDto,
  WorkItemDto,
} from "@sn/contracts";
import { CrmApplication } from "./application";
import { createDemoSeed, DEMO_ACTOR_IDS } from "./demo-seed";
import { InMemoryCrmRepository } from "./in-memory-repository";
import type {
  ClientReference,
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmApplicationDependencies,
  EmployeeRecord,
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
        async getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto | null> {
          callLog.push({ method: "getAssignment", actorId: ctx.actorId, targetId: id });
          return underlying.getAssignment(ctx, id);
        },
        async listAssignments(ctx: RepositoryContext): Promise<AssignmentDto[]> {
          callLog.push({ method: "listAssignments", actorId: ctx.actorId });
          return underlying.listAssignments(ctx);
        },
        async createAssignment(ctx: RepositoryContext, record: CreateAssignmentRecord): Promise<AssignmentDto> {
          callLog.push({ method: "createAssignment", actorId: ctx.actorId, targetId: record.id });
          const saved = await underlying.createAssignment(ctx, record);
          return { ...saved, code: "AS-CANONICAL-001001" };
        },
        async updateAssignmentStatus(ctx: RepositoryContext, command: UpdateAssignmentStatusCommand): Promise<AssignmentDto> {
          callLog.push({ method: "updateAssignmentStatus", actorId: ctx.actorId, targetId: command.id });
          const saved = await underlying.updateAssignmentStatus(ctx, command);
          return { ...saved, code: "AS-CANONICAL-001001" };
        },
        async updateAssignmentReviewers(ctx: RepositoryContext, command: UpdateAssignmentReviewersCommand): Promise<AssignmentDto> {
          callLog.push({ method: "updateAssignmentReviewers", actorId: ctx.actorId, targetId: command.id });
          return underlying.updateAssignmentReviewers(ctx, command);
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
});
