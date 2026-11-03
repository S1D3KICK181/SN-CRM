import { describe, expect, it } from "vitest";
import { CrmApplication } from "./application";
import { createDemoSeed, DEMO_ACTOR_IDS } from "./demo-seed";
import { InMemoryCrmRepository } from "./in-memory-repository";

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
    expect((await repository.getAssignment("asg_tds_q2"))?.ownerId).toBe(DEMO_ACTOR_IDS.staff);

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
});
