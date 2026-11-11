import { describe, expect, it } from "vitest";
import type { EngagementDto, EngagementVersionDto } from "@sn/contracts";
import { TestEngagementsAdapter } from "./test-engagements-adapter";
import { EngagementOperationError } from "./engagements-types";

const BASE_ENG: EngagementDto = {
  id: "00000000-0000-4000-b000-000000000001",
  code: "ENG-000001",
  clientId: "00000000-0000-4000-c000-000000000001",
  serviceId: "00000000-0000-4000-d000-000000000001",
  status: "draft",
  approvedVersionId: null,
  approvedVersion: null,
  approvedAt: null,
  approvedById: null,
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: "00000000-0000-4000-a000-000000000001",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const ACTIVE_ENG: EngagementDto = {
  ...BASE_ENG,
  id: "00000000-0000-4000-b000-000000000002",
  code: "ENG-000002",
  status: "active",
  approvedVersionId: "00000000-0000-4000-b000-000000000010",
  approvedAt: "2026-11-01T12:00:00.000Z",
  approvedById: "00000000-0000-4000-a000-000000000001",
};

const REVISE_INPUT = {
  engagementId: BASE_ENG.id,
  title: "Revised Title",
  scope: "Revised scope content here",
  responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
  deliveryManagerId: "00000000-0000-4000-a000-000000000002",
  feeModel: "fixed" as const,
  agreedFeePaise: 500000,
  billingTerms: "Net 30",
  startDate: "2026-04-01",
  expectedUpdatedAt: "2026-11-01T10:00:00.000Z",
};

const DRAFT_VERSION: EngagementVersionDto = {
  id: "00000000-0000-4000-b000-000000000010",
  engagementId: BASE_ENG.id,
  versionNumber: 1,
  title: "Draft version",
  scope: "Draft scope",
  exclusions: null,
  responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
  deliveryManagerId: "00000000-0000-4000-a000-000000000002",
  feeModel: "fixed",
  agreedFeePaise: 500000,
  billingTerms: "Net 30",
  startDate: "2026-04-01",
  endDate: null,
  approvedAt: null,
  approvedById: null,
  createdById: BASE_ENG.createdById,
  createdAt: BASE_ENG.createdAt,
};

describe("TestEngagementsAdapter", () => {
  describe("list", () => {
    it("returns seeded items for founder", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      const result = await adapter.list("founder");
      expect(result).toEqual([BASE_ENG]);
    });

    it("returns seeded items for manager", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      const result = await adapter.list("manager");
      expect(result).toEqual([BASE_ENG]);
    });

    it("returns empty array when no items seeded", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const result = await adapter.list("founder");
      expect(result).toEqual([]);
    });

    it("throws forbidden for senior_staff", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await expect(adapter.list("senior_staff")).rejects.toMatchObject({ code: "forbidden" });
    });

    it("throws forbidden for staff", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.list("staff")).rejects.toMatchObject({ code: "forbidden" });
    });

    it("throws forbidden for trainee", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.list("trainee")).rejects.toMatchObject({ code: "forbidden" });
    });

    it("throws aborted when signal is already aborted", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await expect(adapter.list("founder", { signal: ctrl.signal })).rejects.toMatchObject({
        code: "aborted",
      });
    });
  });

  describe("get", () => {
    it("returns a specific engagement by id", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG, ACTIVE_ENG]);
      const result = await adapter.get("founder", BASE_ENG.id);
      expect(result).toEqual(BASE_ENG);
    });

    it("throws not_found for unknown id", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.get("founder", "unknown-id")).rejects.toMatchObject({
        code: "not_found",
      });
    });

    it("throws forbidden for staff", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await expect(adapter.get("staff", BASE_ENG.id)).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("listVersions", () => {
    it("returns versions for a seeded engagement", async () => {
      const v1 = {
        id: "00000000-0000-4000-b000-000000000010",
        engagementId: BASE_ENG.id,
        versionNumber: 1,
        title: "v1",
        scope: "scope v1",
        exclusions: null,
        responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
        deliveryManagerId: "00000000-0000-4000-a000-000000000002",
        feeModel: "fixed" as const,
        agreedFeePaise: 500000,
        billingTerms: "Net 30",
        startDate: "2026-04-01",
        endDate: null,
        approvedAt: null,
        approvedById: null,
        createdById: "00000000-0000-4000-a000-000000000001",
        createdAt: "2026-11-01T10:00:00.000Z",
      };
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG], new Map([[BASE_ENG.id, [v1]]]));
      const versions = await adapter.listVersions("founder", BASE_ENG.id);
      expect(versions).toEqual([v1]);
    });

    it("throws not_found for unknown engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.listVersions("founder", "unknown")).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("createDraft", () => {
    const input = {
      clientId: "00000000-0000-4000-c000-000000000001",
      serviceId: "00000000-0000-4000-d000-000000000001",
      title: "New Draft",
      scope: "Full scope",
      responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
      deliveryManagerId: "00000000-0000-4000-a000-000000000002",
      feeModel: "fixed" as const,
      agreedFeePaise: 500000,
      billingTerms: "Net 30",
      startDate: "2026-04-01",
    };

    it("creates and returns a new draft engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const result = await adapter.createDraft("founder", input, "ikey-001");
      expect(result.status).toBe("draft");
      expect(result.id).toBeTruthy();
      expect(result.code).toMatch(/^ENG-/);
      expect(adapter.getAll()).toHaveLength(1);
    });

    it("allows manager to create draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const result = await adapter.createDraft("manager", input, "ikey-002");
      expect(result.status).toBe("draft");
    });

    it("throws forbidden for senior_staff", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.createDraft("senior_staff", input, "ikey-003")).rejects.toMatchObject({
        code: "forbidden",
      });
    });

    it("throws validation error for blank idempotency key", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.createDraft("founder", input, "")).rejects.toMatchObject({
        code: "validation",
      });
    });

    it("throws validation error for key exceeding 255 chars", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(adapter.createDraft("founder", input, "a".repeat(256))).rejects.toMatchObject({
        code: "validation",
      });
    });

    it("throws aborted when signal aborted", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(
        adapter.createDraft("founder", input, "ikey-004", { signal: ctrl.signal }),
      ).rejects.toMatchObject({ code: "aborted" });
    });
  });

  describe("reviseDraft", () => {
    it("allows founder to revise a draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await adapter.reviseDraft("founder", BASE_ENG.id, REVISE_INPUT, "ikey-rev-001");
      const versions = await adapter.listVersions("founder", BASE_ENG.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]!.title).toBe("Revised Title");
    });

    it("allows manager to revise a draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      const result = await adapter.reviseDraft(
        "manager",
        BASE_ENG.id,
        REVISE_INPUT,
        "ikey-rev-002",
      );
      expect(result).toBeDefined();
    });

    it("throws forbidden for senior_staff trying to revise", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await expect(
        adapter.reviseDraft("senior_staff", BASE_ENG.id, REVISE_INPUT, "ikey-rev-003"),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("throws not_found when engagement does not exist", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(
        adapter.reviseDraft("founder", "unknown", REVISE_INPUT, "ikey-rev-004"),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("throws conflict when engagement is not draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]);
      await expect(
        adapter.reviseDraft(
          "founder",
          ACTIVE_ENG.id,
          { ...REVISE_INPUT, engagementId: ACTIVE_ENG.id },
          "ikey-rev-005",
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    });
  });

  describe("activate", () => {
    const activateInput = {
      engagementId: BASE_ENG.id,
      versionId: "00000000-0000-4000-b000-000000000010",
      expectedUpdatedAt: BASE_ENG.updatedAt,
    };

    it("allows founder to activate a draft", async () => {
      const adapter = new TestEngagementsAdapter().seed(
        [BASE_ENG],
        new Map([[BASE_ENG.id, [DRAFT_VERSION]]]),
      );
      const result = await adapter.activate("founder", BASE_ENG.id, activateInput, "ikey-act-001");
      expect(result.status).toBe("active");
      expect(result.approvedVersionId).toBe(activateInput.versionId);
    });

    it("throws forbidden for manager trying to activate", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await expect(
        adapter.activate("manager", BASE_ENG.id, activateInput, "ikey-act-002"),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("throws validation error for blank idempotency key", async () => {
      const adapter = new TestEngagementsAdapter().seed([BASE_ENG]);
      await expect(
        adapter.activate("founder", BASE_ENG.id, activateInput, ""),
      ).rejects.toMatchObject({
        code: "validation",
      });
    });
  });

  describe("amend", () => {
    const amendInput = {
      engagementId: ACTIVE_ENG.id,
      title: "Amended Title",
      scope: "Amended scope content",
      responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
      deliveryManagerId: "00000000-0000-4000-a000-000000000002",
      feeModel: "fixed" as const,
      agreedFeePaise: 600000,
      billingTerms: "Net 15",
      startDate: "2026-04-01",
      expectedUpdatedAt: ACTIVE_ENG.updatedAt,
    };

    it("allows founder to amend active engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]);
      await adapter.amend("founder", ACTIVE_ENG.id, amendInput, "ikey-amend-001");
      const versions = await adapter.listVersions("founder", ACTIVE_ENG.id);
      expect(versions).toHaveLength(1);
    });

    it("throws forbidden for manager trying to amend", async () => {
      const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]);
      await expect(
        adapter.amend("manager", ACTIVE_ENG.id, amendInput, "ikey-amend-002"),
      ).rejects.toMatchObject({ code: "forbidden" });
    });
  });

  describe("end", () => {
    const endInput = {
      engagementId: ACTIVE_ENG.id,
      outcome: "completed" as const,
      reason: "All deliverables completed.",
      expectedUpdatedAt: ACTIVE_ENG.updatedAt,
    };

    it("allows founder to end an active engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]);
      const result = await adapter.end("founder", ACTIVE_ENG.id, endInput, "ikey-end-001");
      expect(result.status).toBe("ended");
      expect(result.endOutcome).toBe("completed");
    });

    it("throws forbidden for manager trying to end", async () => {
      const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]);
      await expect(
        adapter.end("manager", ACTIVE_ENG.id, endInput, "ikey-end-002"),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("throws not_found for unknown engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await expect(
        adapter.end("founder", "unknown-id", endInput, "ikey-end-003"),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("throws aborted when signal aborted before resolution", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]);
      await expect(
        adapter.end("founder", ACTIVE_ENG.id, endInput, "ikey-end-004", { signal: ctrl.signal }),
      ).rejects.toMatchObject({ code: "aborted" });
    });
  });

  describe("error type", () => {
    it("all thrown errors are EngagementOperationError", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const err = await adapter.list("staff").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EngagementOperationError);
    });
  });

  describe("remediation proofs", () => {
    const createInput = {
      clientId: BASE_ENG.clientId,
      serviceId: BASE_ENG.serviceId,
      title: "Created",
      scope: "Scope",
      responsiblePartnerId: BASE_ENG.createdById,
      deliveryManagerId: BASE_ENG.createdById,
      feeModel: "fixed" as const,
      agreedFeePaise: 500000,
      billingTerms: "Net 30",
      startDate: "2026-04-01",
    };
    const activateInput = {
      engagementId: BASE_ENG.id,
      versionId: DRAFT_VERSION.id,
      expectedUpdatedAt: BASE_ENG.updatedAt,
    };
    const amendInput = {
      engagementId: ACTIVE_ENG.id,
      title: "Amended",
      scope: "Amended scope",
      responsiblePartnerId: BASE_ENG.createdById,
      deliveryManagerId: BASE_ENG.createdById,
      feeModel: "fixed" as const,
      agreedFeePaise: 600000,
      billingTerms: "Net 15",
      startDate: "2026-04-01",
      expectedUpdatedAt: ACTIVE_ENG.updatedAt,
    };
    const endInput = {
      engagementId: ACTIVE_ENG.id,
      outcome: "completed" as const,
      reason: "done",
      expectedUpdatedAt: ACTIVE_ENG.updatedAt,
    };
    it("replays same-key same-payload create with one engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const first = await adapter.createDraft("founder", createInput, "replay");
      const second = await adapter.createDraft("founder", createInput, "replay");

      expect(second).toEqual(first);
      expect(adapter.getAll()).toHaveLength(1);
    });
    it("conflicts on same key with changed payload without a second mutation", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      await adapter.createDraft("founder", createInput, "conflict");

      await expect(
        adapter.createDraft("founder", { ...createInput, title: "Changed" }, "conflict"),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(adapter.getAll()).toHaveLength(1);
    });
    it("isolates create receipts by role", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const founder = await adapter.createDraft("founder", createInput, "role-key");
      const manager = await adapter.createDraft("manager", createInput, "role-key");

      expect(manager.id).not.toBe(founder.id);
      expect(adapter.getAll()).toHaveLength(2);
    });
    it("creates initial version one from input", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const item = await adapter.createDraft("founder", createInput, "version-one");
      const versions = await adapter.listVersions("founder", item.id);

      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        versionNumber: 1,
        title: createInput.title,
      });
    });
    it.each(["revise", "activate", "amend", "end"] as const)("rejects stale expectedUpdatedAt for %s", async (operation) => { const adapter = new TestEngagementsAdapter().seed([operation === "amend" || operation === "end" ? ACTIVE_ENG : BASE_ENG], new Map([[BASE_ENG.id, [DRAFT_VERSION]]])); const stale = "2000-01-01T00:00:00.000Z"; if (operation === "revise") await expect(adapter.reviseDraft("founder", BASE_ENG.id, { ...REVISE_INPUT, expectedUpdatedAt: stale }, "stale")).rejects.toMatchObject({ code: "conflict" }); else if (operation === "activate") await expect(adapter.activate("founder", BASE_ENG.id, { ...activateInput, expectedUpdatedAt: stale }, "stale")).rejects.toMatchObject({ code: "conflict" }); else if (operation === "amend") await expect(adapter.amend("founder", ACTIVE_ENG.id, { ...amendInput, expectedUpdatedAt: stale }, "stale")).rejects.toMatchObject({ code: "conflict" }); else await expect(adapter.end("founder", ACTIVE_ENG.id, { ...endInput, expectedUpdatedAt: stale }, "stale")).rejects.toMatchObject({ code: "conflict" }); });
    it("rejects absent activation version and records approval metadata for existing version", async () => { const adapter = new TestEngagementsAdapter().seed([BASE_ENG], new Map([[BASE_ENG.id, [DRAFT_VERSION]]])); await expect(adapter.activate("founder", BASE_ENG.id, { ...activateInput, versionId: "missing" }, "missing-version")).rejects.toMatchObject({ code: "validation" }); const result = await adapter.activate("founder", BASE_ENG.id, activateInput, "approval"); expect(result.approvedVersionId).toBe(DRAFT_VERSION.id); expect(result.approvedVersion?.id).toBe(DRAFT_VERSION.id); expect(result.approvedAt).toBeTruthy(); expect(result.approvedById).toBeTruthy(); });
    it("amend appends an approved version", async () => { const adapter = new TestEngagementsAdapter().seed([ACTIVE_ENG]); const result = await adapter.amend("founder", ACTIVE_ENG.id, amendInput, "append"); const versions = await adapter.listVersions("founder", ACTIVE_ENG.id); expect(versions).toHaveLength(1); expect(result.approvedVersionId).toBe(versions[0]!.id); expect(result.approvedVersion).toEqual(versions[0]); });
    it("rejects ending a non-active engagement", async () => { const adapter = new TestEngagementsAdapter().seed([BASE_ENG]); await expect(adapter.end("founder", BASE_ENG.id, endInput, "not-active")).rejects.toMatchObject({ code: "conflict" }); });
    it("seed reset reproduces ids timestamps and clears receipts", async () => { const adapter = new TestEngagementsAdapter().seed([]); const first = await adapter.createDraft("founder", createInput, "reset"); adapter.seed([]); const second = await adapter.createDraft("founder", createInput, "reset"); expect(second).toEqual(first); });
    it("aborting immediately after invocation applies no mutation", async () => { const adapter = new TestEngagementsAdapter().seed([]); const ctrl = new AbortController(); const promise = adapter.createDraft("founder", createInput, "immediate", { signal: ctrl.signal }); ctrl.abort(); await expect(promise).rejects.toMatchObject({ code: "aborted" }); expect(adapter.getAll()).toHaveLength(0); });
  });
});
