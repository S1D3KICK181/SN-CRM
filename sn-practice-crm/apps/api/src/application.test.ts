import { describe, expect, it } from "vitest";
import type {
  AssignmentDto,
  LedgerEntryDto,
  RecurringScheduleDto,
  WorkItemDto,
} from "@sn/contracts";
import { CrmApplication } from "./application";
import { createDemoSeed, DEMO_ACTOR_IDS } from "./demo-seed";
import { InMemoryCrmRepository } from "./in-memory-repository";
import type {
  CrmApplicationDependencies,
  EmployeeRecord,
  RepositoryContext,
} from "./repository";

const ROLE_CASES = [
  ["founder", DEMO_ACTOR_IDS.founder],
  ["manager", DEMO_ACTOR_IDS.manager],
  ["senior_staff", DEMO_ACTOR_IDS.senior],
  ["staff", DEMO_ACTOR_IDS.staff],
  ["trainee", DEMO_ACTOR_IDS.trainee],
] as const;

function createFixture() {
  let id = 0;
  const repository = new InMemoryCrmRepository(createDemoSeed());
  const application = new CrmApplication(repository, {
    now: () => new Date("2026-10-30T12:00:00.000Z"),
    createId: (prefix) => `${prefix}_test_${++id}`,
  });
  return { application, repository };
}

describe("CrmApplication authority and workflow rules", () => {
  it.each([
    [DEMO_ACTOR_IDS.founder, ["asg_tds_q2", "asg_gst_october"]],
    [DEMO_ACTOR_IDS.manager, ["asg_tds_q2", "asg_gst_october"]],
    [DEMO_ACTOR_IDS.senior, ["asg_gst_october"]],
    [DEMO_ACTOR_IDS.staff, ["asg_tds_q2"]],
    [DEMO_ACTOR_IDS.trainee, ["asg_gst_october"]],
  ] as const)("shows %s only the Assignments in their scope", async (actorId, expectedIds) => {
    const { application } = createFixture();
    const currentActor = await application.requireActor(actorId);

    expect(
      (await application.listAssignments(currentActor)).map((assignment) => assignment.id),
    ).toEqual(expectedIds);
  });

  it("allows only leadership to create a client Assignment", async () => {
    const { application } = createFixture();
    const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);

    await expect(
      application.createAssignment(staff, {
        clientId: "cli_new",
        clientName: "New Client Pvt Ltd",
        title: "Annual return",
        service: "Company law",
        ownerId: DEMO_ACTOR_IDS.staff,
        dueAt: "2026-12-01T12:30:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 403, code: "role_not_permitted" });

    const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
    const created = await application.createAssignment(manager, {
      clientId: "cli_new",
      clientName: "New Client Pvt Ltd",
      title: "Annual return",
      service: "Company law",
      ownerId: DEMO_ACTOR_IDS.staff,
      reviewerIds: [DEMO_ACTOR_IDS.manager],
      dueAt: "2026-12-01T12:30:00.000Z",
    });
    expect(created).toMatchObject({ ownerId: DEMO_ACTOR_IDS.staff, status: "open" });
  });

  it("enforces downward delegation without changing Assignment ownership", async () => {
    const { application, repository } = createFixture();
    const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);

    const delegated = await application.createWorkItem(staff, {
      kind: "delegated",
      title: "Check challan details",
      assignmentId: "asg_tds_q2",
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-03T12:30:00.000Z",
    });
    expect(delegated).toMatchObject({ kind: "delegated", assigneeId: DEMO_ACTOR_IDS.trainee });
    expect((await repository.getAssignment({ actorId: staff.id }, "asg_tds_q2"))?.ownerId).toBe(DEMO_ACTOR_IDS.staff);

    await expect(
      application.createWorkItem(staff, {
        kind: "delegated",
        title: "Review the return",
        assignmentId: "asg_tds_q2",
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

    expect(visibleIds.includes("wrk_reconcile_gstr2b")).toBe(expectedVisible);
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
      assignmentId: "asg_gst_october",
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
      status: "done",
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
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

    // asg_gst_october starts as in_progress (owner is senior, reviewers include founder)
    // submit -> complete
    await application.transitionAssignment(senior, "asg_gst_october", "submit");
    const completed = await application.transitionAssignment(founder, "asg_gst_october", "complete");
    expect(completed.status).toBe("completed");

    await expect(
      application.transitionAssignment(founder, "asg_gst_october", "reopen"),
    ).rejects.toMatchObject({
      status: 409,
      code: "invalid_state_transition",
      message: "An approved Assignment is a terminal immutable audit artifact and cannot be reopened.",
    });
  });

  it("allows reopening a submitted Assignment prior to approval (Request changes)", async () => {
    const { application } = createFixture();
    const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

    // asg_gst_october starts as in_progress
    await application.transitionAssignment(senior, "asg_gst_october", "submit");

    const reopened = await application.transitionAssignment(founder, "asg_gst_october", "reopen");
    expect(reopened.status).toBe("in_progress");
  });

  it("rejects reopening a completed Work Item as a terminal audit artifact (409)", async () => {
    const { application } = createFixture();
    const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
    const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

    const item = await application.createWorkItem(senior, {
      kind: "delegated",
      title: "Verify e-way bills",
      assignmentId: "asg_gst_october",
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-02T12:30:00.000Z",
    });

    await application.transitionWorkItem(trainee, item.id, "submit");
    const completed = await application.transitionWorkItem(senior, item.id, "complete");
    expect(completed.status).toBe("done");

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
      assignmentId: "asg_gst_october",
      assigneeId: DEMO_ACTOR_IDS.trainee,
      dueAt: "2026-11-02T12:30:00.000Z",
    });

    await application.transitionWorkItem(trainee, item.id, "submit");
    const changesRequested = await application.transitionWorkItem(senior, item.id, "reopen");
    expect(changesRequested.status).toBe("in_progress");
  });

  describe("reminder domain validation", () => {
    it("rejects delegated task creation when reminderAt is after dueAt (422 reminder_after_due_time)", async () => {
      const { application } = createFixture();
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);

      await expect(
        application.createWorkItem(senior, {
          kind: "delegated",
          title: "Verify bank statement entries",
          assignmentId: "asg_gst_october",
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

      // 08:00 +05:30 is 02:30 UTC. dueAt is 02:00 UTC. Reminder is after due!
      // Simple string comparison might fail if not parsed strictly.
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
      expect(completed.status).toBe("done");

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
        // As reminderAt
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

        // As dueAt
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
      // asg_gst_october dueAt is 2026-11-11T12:30:00.000Z (12:30 UTC)

      // 1. Equivalent instant with lexically larger representation (18:00+05:30 == 12:30 UTC, 'T18' > 'T12')
      const equalItem = await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Delegated task with equal instant in +05:30",
        assignmentId: "asg_gst_october",
        assigneeId: DEMO_ACTOR_IDS.trainee,
        dueAt: "2026-11-11T18:00:00+05:30",
      });
      expect(equalItem.dueAt).toBe("2026-11-11T18:00:00+05:30");

      // 2. Before instant with lexically larger representation (17:30+05:30 == 12:00 UTC, 'T17' > 'T12')
      const beforeItem = await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Delegated task with earlier instant in +05:30",
        assignmentId: "asg_gst_october",
        assigneeId: DEMO_ACTOR_IDS.trainee,
        dueAt: "2026-11-11T17:30:00+05:30",
      });
      expect(beforeItem.dueAt).toBe("2026-11-11T17:30:00+05:30");

      // 3. Truly later instant with lexically smaller representation (08:00-06:00 == 14:00 UTC, 'T08' < 'T12')
      await expect(
        application.createWorkItem(senior, {
          kind: "delegated",
          title: "Delegated task with later instant in -06:00",
          assignmentId: "asg_gst_october",
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

  describe("Slice 1P-Port: fail-closed context, bootstrap isolation, and canonical returns", () => {
    function createTrackingRepository() {
      const callLog: { method: string; actorId?: string; targetId?: string }[] = [];
      const underlying = new InMemoryCrmRepository(createDemoSeed());

      const trackingRepo: CrmApplicationDependencies = {
        // DevActorDirectory
        async resolveDevActor(id: string): Promise<EmployeeRecord | null> {
          callLog.push({ method: "resolveDevActor", targetId: id });
          return underlying.resolveDevActor(id);
        },
        async listDevActors(): Promise<EmployeeRecord[]> {
          callLog.push({ method: "listDevActors" });
          return underlying.listDevActors();
        },

        // Domain repository methods
        async getEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null> {
          callLog.push({ method: "getEmployee", actorId: ctx.actorId, targetId: id });
          return underlying.getEmployee(ctx, id);
        },
        async listEmployees(ctx: RepositoryContext): Promise<EmployeeRecord[]> {
          callLog.push({ method: "listEmployees", actorId: ctx.actorId });
          return underlying.listEmployees(ctx);
        },
        async saveEmployee(ctx: RepositoryContext, employee: EmployeeRecord): Promise<EmployeeRecord> {
          callLog.push({ method: "saveEmployee", actorId: ctx.actorId, targetId: employee.id });
          const saved = await underlying.saveEmployee(ctx, employee);
          return { ...saved, name: "CANONICAL-EMPLOYEE-PERSISTED" };
        },

        async getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto | null> {
          callLog.push({ method: "getAssignment", actorId: ctx.actorId, targetId: id });
          return underlying.getAssignment(ctx, id);
        },
        async listAssignments(ctx: RepositoryContext): Promise<AssignmentDto[]> {
          callLog.push({ method: "listAssignments", actorId: ctx.actorId });
          return underlying.listAssignments(ctx);
        },
        async saveAssignment(ctx: RepositoryContext, assignment: AssignmentDto): Promise<AssignmentDto> {
          callLog.push({ method: "saveAssignment", actorId: ctx.actorId, targetId: assignment.id });
          const saved = await underlying.saveAssignment(ctx, assignment);
          return { ...saved, code: "AS-CANONICAL-001001" };
        },

        async getRecurringSchedule(ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null> {
          callLog.push({ method: "getRecurringSchedule", actorId: ctx.actorId, targetId: id });
          return underlying.getRecurringSchedule(ctx, id);
        },
        async listRecurringSchedules(ctx: RepositoryContext): Promise<RecurringScheduleDto[]> {
          callLog.push({ method: "listRecurringSchedules", actorId: ctx.actorId });
          return underlying.listRecurringSchedules(ctx);
        },
        async saveRecurringSchedule(ctx: RepositoryContext, schedule: RecurringScheduleDto): Promise<RecurringScheduleDto> {
          callLog.push({ method: "saveRecurringSchedule", actorId: ctx.actorId, targetId: schedule.id });
          const saved = await underlying.saveRecurringSchedule(ctx, schedule);
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
        async saveWorkItem(ctx: RepositoryContext, item: WorkItemDto): Promise<WorkItemDto> {
          callLog.push({ method: "saveWorkItem", actorId: ctx.actorId, targetId: item.id });
          const saved = await underlying.saveWorkItem(ctx, item);
          return { ...saved, notes: "CANONICAL-WORK-ITEM-PERSISTED-NOTE" };
        },

        async listLedgerEntries(ctx: RepositoryContext): Promise<LedgerEntryDto[]> {
          callLog.push({ method: "listLedgerEntries", actorId: ctx.actorId });
          return underlying.listLedgerEntries(ctx);
        },
        async saveLedgerEntry(ctx: RepositoryContext, entry: LedgerEntryDto): Promise<LedgerEntryDto> {
          callLog.push({ method: "saveLedgerEntry", actorId: ctx.actorId, targetId: entry.id });
          const saved = await underlying.saveLedgerEntry(ctx, entry);
          return { ...saved, reference: "REF-CANONICAL-DB-GENERATED" };
        },
      };

      const application = new CrmApplication(trackingRepo, {
        now: () => new Date("2026-10-30T12:00:00.000Z"),
        createId: (prefix) => `${prefix}_test_fixed`,
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

      // 1. listAssignments passes initiating actorId to both listAssignments and listWorkItems
      callLog.length = 0;
      await application.listAssignments(senior);
      expect(callLog).toEqual([
        { method: "listAssignments", actorId: senior.id },
        { method: "listWorkItems", actorId: senior.id },
      ]);

      // 2. createAssignment passes manager.id to getEmployee (owner, reviewers), listAssignments, and saveAssignment
      callLog.length = 0;
      await application.createAssignment(manager, {
        clientId: "cli_mehta",
        clientName: "Mehta Industries",
        title: "Q3 Return",
        service: "GST compliance",
        ownerId: staff.id,
        reviewerIds: [founder.id],
        dueAt: "2026-11-20T12:00:00.000Z",
      });
      // All calls MUST have actorId: manager.id (never staff.id nor founder.id)
      expect(callLog.length).toBeGreaterThanOrEqual(4);
      for (const call of callLog) {
        expect(call.actorId).toBe(manager.id);
      }
      const reviewerLookupCall = callLog.find(
        (c) => c.method === "getEmployee" && c.targetId === founder.id,
      );
      expect(reviewerLookupCall).toBeDefined();
      expect(reviewerLookupCall?.actorId).toBe(manager.id);
      expect(reviewerLookupCall?.actorId).not.toBe(founder.id);
      expect(callLog.some((c) => c.method === "saveAssignment")).toBe(true);

      // 3. transitionAssignment passes initiating actorId
      callLog.length = 0;
      await application.transitionAssignment(staff, "asg_tds_q2", "start");
      expect(callLog).toEqual([
        { method: "getAssignment", actorId: staff.id, targetId: "asg_tds_q2" },
        { method: "saveAssignment", actorId: staff.id, targetId: "asg_tds_q2" },
      ]);

      // 4. listRecurringSchedules passes initiating actorId
      callLog.length = 0;
      await application.listRecurringSchedules(founder);
      expect(callLog).toEqual([{ method: "listRecurringSchedules", actorId: founder.id }]);

      // 5. createRecurringSchedule passes initiating actorId to all calls
      callLog.length = 0;
      await application.createRecurringSchedule(founder, {
        clientId: "cli_mehta",
        clientName: "Mehta Industries",
        title: "Monthly Audit",
        service: "Statutory audit",
        cadence: "monthly",
        ownerId: senior.id,
        reviewerIds: [manager.id],
        nextOccurrenceOn: "2026-11-30",
        dueDay: 30,
      });
      for (const call of callLog) {
        expect(call.actorId).toBe(founder.id);
      }
      expect(callLog.some((c) => c.method === "saveRecurringSchedule")).toBe(true);

      // 6. updateRecurringSchedule passes initiating actorId to get and save
      callLog.length = 0;
      await application.updateRecurringSchedule(founder, "sch_mehta_gst", { active: false });
      expect(callLog).toEqual([
        { method: "getRecurringSchedule", actorId: founder.id, targetId: "sch_mehta_gst" },
        { method: "saveRecurringSchedule", actorId: founder.id, targetId: "sch_mehta_gst" },
      ]);

      // 7. listWorkItems passes initiating actorId to both listWorkItems and listAssignments
      callLog.length = 0;
      await application.listWorkItems(trainee);
      expect(callLog).toEqual([
        { method: "listWorkItems", actorId: trainee.id },
        { method: "listAssignments", actorId: trainee.id },
      ]);

      // 8. createWorkItem (delegated) passes initiating actorId (senior) to parent assignment read, assignee read, and save
      callLog.length = 0;
      await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Reconciliation subtask",
        assignmentId: "asg_gst_october",
        assigneeId: trainee.id,
        dueAt: "2026-11-10T12:00:00.000Z",
      });
      for (const call of callLog) {
        expect(call.actorId).toBe(senior.id);
      }
      expect(callLog.some((c) => c.method === "saveWorkItem")).toBe(true);

      // 9. transitionWorkItem passes initiating actorId
      callLog.length = 0;
      await application.transitionWorkItem(trainee, "wrk_reconcile_gstr2b", "submit");
      expect(callLog).toEqual([
        { method: "getWorkItem", actorId: trainee.id, targetId: "wrk_reconcile_gstr2b" },
        { method: "saveWorkItem", actorId: trainee.id, targetId: "wrk_reconcile_gstr2b" },
      ]);

      // 10. reporting lines (list and update)
      callLog.length = 0;
      await application.listReportingLines(founder);
      expect(callLog).toEqual([{ method: "listEmployees", actorId: founder.id }]);

      callLog.length = 0;
      await application.updateReportingLine(founder, trainee.id, manager.id);
      for (const call of callLog) {
        expect(call.actorId).toBe(founder.id);
      }
      expect(callLog.some((c) => c.method === "saveEmployee")).toBe(true);

      // 11. office accounts & ledger
      callLog.length = 0;
      await application.getOfficeAccountsSummary(manager);
      expect(callLog).toEqual([{ method: "listLedgerEntries", actorId: manager.id }]);

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
      expect(callLog).toEqual([{ method: "saveLedgerEntry", actorId: founder.id, targetId: "led_test_fixed" }]);
    });

    it("returns canonical entities returned by save methods across all save families", async () => {
      const { application } = createTrackingRepository();
      const founder = await application.requireActor(DEMO_ACTOR_IDS.founder);
      const manager = await application.requireActor(DEMO_ACTOR_IDS.manager);
      const senior = await application.requireActor(DEMO_ACTOR_IDS.senior);
      const staff = await application.requireActor(DEMO_ACTOR_IDS.staff);
      const trainee = await application.requireActor(DEMO_ACTOR_IDS.trainee);

      // Family 1: saveAssignment canonical return (create and transition)
      const createdAssignment = await application.createAssignment(manager, {
        clientId: "cli_mehta",
        clientName: "Mehta Industries",
        title: "Canonical Test",
        service: "GST compliance",
        ownerId: senior.id,
        reviewerIds: [founder.id],
        dueAt: "2026-11-20T12:00:00.000Z",
      });
      expect(createdAssignment.code).toBe("AS-CANONICAL-001001");

      const transitionedAssignment = await application.transitionAssignment(staff, "asg_tds_q2", "start");
      expect(transitionedAssignment.code).toBe("AS-CANONICAL-001001");

      // Family 2: saveRecurringSchedule canonical return (create and update)
      const createdSchedule = await application.createRecurringSchedule(founder, {
        clientId: "cli_mehta",
        clientName: "Mehta Industries",
        title: "Canonical Schedule",
        service: "Statutory audit",
        cadence: "monthly",
        ownerId: senior.id,
        reviewerIds: [manager.id],
        nextOccurrenceOn: "2026-11-30",
        dueDay: 30,
      });
      expect(createdSchedule.id).toBe("sch_canonical_substituted_id");

      const updatedSchedule = await application.updateRecurringSchedule(founder, "sch_mehta_gst", { active: false });
      expect(updatedSchedule.id).toBe("sch_canonical_substituted_id");

      // Family 3: saveWorkItem canonical return (create and transition)
      const createdWorkItem = await application.createWorkItem(senior, {
        kind: "delegated",
        title: "Canonical Work Item",
        assignmentId: "asg_gst_october",
        assigneeId: trainee.id,
        dueAt: "2026-11-10T12:00:00.000Z",
      });
      expect(createdWorkItem.notes).toBe("CANONICAL-WORK-ITEM-PERSISTED-NOTE");

      const transitionedWorkItem = await application.transitionWorkItem(trainee, "wrk_reconcile_gstr2b", "submit");
      expect(transitionedWorkItem.notes).toBe("CANONICAL-WORK-ITEM-PERSISTED-NOTE");

      // Family 4: saveEmployee canonical return (updateReportingLine)
      const reportingResult = await application.updateReportingLine(founder, trainee.id, manager.id);
      expect(reportingResult.employee.name).toBe("CANONICAL-EMPLOYEE-PERSISTED");

      // Family 5: saveLedgerEntry canonical return (createLedgerEntry)
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
});
