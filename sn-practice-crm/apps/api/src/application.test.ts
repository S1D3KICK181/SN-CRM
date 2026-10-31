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
});
