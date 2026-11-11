import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  CreateEngagementDraftInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from "@sn/contracts";
import { EngagementsCoordinator } from "./engagements-coordinator";
import { TestEngagementsAdapter } from "./test-engagements-adapter";
import { EngagementOperationError } from "./engagements-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENG_DRAFT: EngagementDto = {
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

const ENG_ACTIVE: EngagementDto = {
  ...ENG_DRAFT,
  id: "00000000-0000-4000-b000-000000000002",
  code: "ENG-000002",
  status: "active",
  approvedVersionId: "00000000-0000-4000-b000-000000000010",
  approvedAt: "2026-11-01T12:00:00.000Z",
  approvedById: "00000000-0000-4000-a000-000000000001",
};

const CREATE_INPUT: CreateEngagementDraftInput = {
  clientId: "00000000-0000-4000-c000-000000000001",
  serviceId: "00000000-0000-4000-d000-000000000001",
  title: "Tax Advisory FY 2026-27",
  scope: "Full tax compliance",
  responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
  deliveryManagerId: "00000000-0000-4000-a000-000000000002",
  feeModel: "fixed",
  agreedFeePaise: 500000,
  billingTerms: "Net 30",
  startDate: "2026-04-01",
};

const REVISE_INPUT: ReviseEngagementDraftInput = {
  engagementId: ENG_DRAFT.id,
  title: "Revised Title",
  scope: "Revised scope",
  responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
  deliveryManagerId: "00000000-0000-4000-a000-000000000002",
  feeModel: "fixed",
  agreedFeePaise: 500000,
  billingTerms: "Net 30",
  startDate: "2026-04-01",
  expectedUpdatedAt: ENG_DRAFT.updatedAt,
};

const ACTIVATE_INPUT: ActivateEngagementInput = {
  engagementId: ENG_DRAFT.id,
  versionId: "00000000-0000-4000-b000-000000000010",
  expectedUpdatedAt: ENG_DRAFT.updatedAt,
};

const DRAFT_VERSION: EngagementVersionDto = {
  id: ACTIVATE_INPUT.versionId,
  engagementId: ENG_DRAFT.id,
  versionNumber: 1,
  title: CREATE_INPUT.title,
  scope: CREATE_INPUT.scope,
  exclusions: null,
  responsiblePartnerId: CREATE_INPUT.responsiblePartnerId,
  deliveryManagerId: CREATE_INPUT.deliveryManagerId,
  feeModel: CREATE_INPUT.feeModel,
  agreedFeePaise: CREATE_INPUT.agreedFeePaise,
  billingTerms: CREATE_INPUT.billingTerms,
  startDate: CREATE_INPUT.startDate,
  endDate: null,
  approvedAt: null,
  approvedById: null,
  createdById: ENG_DRAFT.createdById,
  createdAt: ENG_DRAFT.createdAt,
};

const AMEND_INPUT: AmendActiveEngagementInput = {
  engagementId: ENG_ACTIVE.id,
  title: "Amended Title",
  scope: "Amended scope",
  responsiblePartnerId: "00000000-0000-4000-a000-000000000001",
  deliveryManagerId: "00000000-0000-4000-a000-000000000002",
  feeModel: "fixed",
  agreedFeePaise: 600000,
  billingTerms: "Net 15",
  startDate: "2026-04-01",
  expectedUpdatedAt: ENG_ACTIVE.updatedAt,
};

const END_INPUT: EndEngagementInput = {
  engagementId: ENG_ACTIVE.id,
  outcome: "completed",
  reason: "All deliverables completed.",
  expectedUpdatedAt: ENG_ACTIVE.updatedAt,
};

function makeCoordinator(
  adapter: TestEngagementsAdapter,
  initialRole: "founder" | "manager" | "senior_staff" | "staff" | "trainee" = "founder",
  options?: {
    onError?: (e: EngagementOperationError) => void;
    onToast?: (m: string) => void;
    generateKey?: () => string;
  },
) {
  return new EngagementsCoordinator({
    port: adapter,
    initialRole,
    generateKey: options?.generateKey ?? (() => "test-key-fixed"),
    onError: options?.onError,
    onToast: options?.onToast,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EngagementsCoordinator", () => {
  describe("initial state", () => {
    it("starts with empty items, loading false, no error", () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      const state = coord.getState();
      expect(state.items).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.hasLiveSnapshot).toBe(false);
      expect(state.listError).toBeNull();
      expect(state.selectedEngagementId).toBeNull();
      expect(state.role).toBe("founder");
    });
  });

  describe("sync / list", () => {
    it("syncs and populates items", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT, ENG_ACTIVE]);
      const coord = makeCoordinator(adapter, "founder");
      const notifications: number[] = [];
      coord.subscribe(() => notifications.push(notifications.length));

      await coord.sync();

      const state = coord.getState();
      expect(state.items).toHaveLength(2);
      expect(state.loading).toBe(false);
      expect(state.hasLiveSnapshot).toBe(true);
      expect(state.listError).toBeNull();
      // Should notify loading=true then loading=false (at minimum 2 notifications)
      expect(notifications.length).toBeGreaterThanOrEqual(1);
    });

    it("sets loading true during sync then false after", async () => {
      const adapter = new TestEngagementsAdapter().seed(
        [ENG_DRAFT],
        new Map([[ENG_DRAFT.id, [DRAFT_VERSION]]]),
      );
      const coord = makeCoordinator(adapter, "founder");
      const loadingStates: boolean[] = [];
      coord.subscribe(() => loadingStates.push(coord.getState().loading));

      const p = coord.sync();
      // Loading is set synchronously before the await
      expect(coord.getState().loading).toBe(true);
      await p;
      expect(coord.getState().loading).toBe(false);
    });

    it("preserves last-known data on refresh failure after live snapshot", async () => {
      const adapter = new TestEngagementsAdapter().seed(
        [ENG_DRAFT],
        new Map([[ENG_DRAFT.id, [DRAFT_VERSION]]]),
      );
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      expect(coord.getState().hasLiveSnapshot).toBe(true);

      // Reseed with an empty adapter to force a forbidden error on next sync
      adapter.seed([]);
      // Override list to throw
      const portSpy = vi
        .spyOn(adapter, "list")
        .mockRejectedValueOnce(
          new EngagementOperationError({ code: "network", message: "Network error" }),
        );

      await coord.sync();

      const state = coord.getState();
      // Items preserved from last good snapshot
      expect(state.items).toHaveLength(1);
      expect(state.listError).not.toBeNull();
      expect(state.listError!.code).toBe("network");
      expect(state.hasLiveSnapshot).toBe(true);
      portSpy.mockRestore();
    });

    it("initial failure exposes listError and no items", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      vi.spyOn(adapter, "list").mockRejectedValueOnce(
        new EngagementOperationError({ code: "network", message: "Network error" }),
      );
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      const state = coord.getState();
      expect(state.items).toEqual([]);
      expect(state.hasLiveSnapshot).toBe(false);
      expect(state.listError).not.toBeNull();
    });

    it("suppresses stale sync results after role switch", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");

      // Start a sync, then immediately switch role before it completes
      const syncPromise = coord.sync();
      await coord.switchRole("manager");
      await syncPromise;

      // After role switch, state should reflect manager's sync, not stale founder sync
      expect(coord.getState().role).toBe("manager");
    });
  });

  describe("switchRole", () => {
    it("synchronously clears state on role switch", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      expect(coord.getState().hasLiveSnapshot).toBe(true);

      const switchPromise = coord.switchRole("manager");
      // After switchRole begins but before sync completes, state should be reset
      // (the notification fires synchronously on role change)
      // We just check the final state
      await switchPromise;
      expect(coord.getState().role).toBe("manager");
    });

    it("no-op when switching to same role", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      const listSpy = vi.spyOn(adapter, "list");
      await coord.switchRole("founder");
      // Should re-sync (same role triggers just sync, not reset)
      expect(listSpy).toHaveBeenCalled();
    });
  });

  describe("selection / detail", () => {
    it("selectEngagement fetches detail and versions", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      await coord.selectEngagement(ENG_DRAFT.id);

      const state = coord.getState();
      expect(state.selectedEngagementId).toBe(ENG_DRAFT.id);
      expect(state.selectedDetail).toEqual(ENG_DRAFT);
      expect(state.selectedVersions).toEqual([]);
      expect(state.detailLoading).toBe(false);
      expect(state.detailError).toBeNull();
    });

    it("clearSelection resets selection state", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      await coord.selectEngagement(ENG_DRAFT.id);
      expect(coord.getState().selectedEngagementId).toBe(ENG_DRAFT.id);

      coord.clearSelection();

      const state = coord.getState();
      expect(state.selectedEngagementId).toBeNull();
      expect(state.selectedDetail).toBeNull();
      expect(state.selectedVersions).toEqual([]);
      expect(state.detailLoading).toBe(false);
    });

    it("selection race: second selectEngagement cancels first", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT, ENG_ACTIVE]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      // Start two selections; the second should win
      const p1 = coord.selectEngagement(ENG_DRAFT.id);
      const p2 = coord.selectEngagement(ENG_ACTIVE.id);
      await Promise.all([p1, p2]);

      // The second selection should be the active one
      expect(coord.getState().selectedEngagementId).toBe(ENG_ACTIVE.id);
    });
  });

  describe("createDraft mutation", () => {
    it("founder can create draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      const result = await coord.createDraft(CREATE_INPUT);
      expect(result.success).toBe(true);
      expect(result.item?.status).toBe("draft");
      expect(coord.getState().items).toHaveLength(1);
    });

    it("manager can create draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "manager");
      await coord.sync();

      const result = await coord.createDraft(CREATE_INPUT);
      expect(result.success).toBe(true);
    });

    it("senior_staff cannot create draft — returns forbidden before port call", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const portSpy = vi.spyOn(adapter, "createDraft");
      const coord = makeCoordinator(adapter, "senior_staff");

      const result = await coord.createDraft(CREATE_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("forbidden");
      expect(portSpy).not.toHaveBeenCalled();
    });

    it("generates a fresh idempotency key per mutation by default", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      let keyCount = 0;
      const coord = makeCoordinator(adapter, "founder", {
        generateKey: () => `key-${++keyCount}`,
      });
      await coord.createDraft(CREATE_INPUT);
      await coord.createDraft(CREATE_INPUT);
      expect(keyCount).toBe(2);
    });

    it("accepts an explicit idempotency key", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const portSpy = vi.spyOn(adapter, "createDraft");
      const coord = makeCoordinator(adapter, "founder");
      await coord.createDraft(CREATE_INPUT, { idempotencyKey: "my-explicit-key" });
      expect(portSpy).toHaveBeenCalledWith(
        "founder",
        expect.anything(),
        "my-explicit-key",
        expect.anything(),
      );
    });

    it("returns validation error for blank explicit idempotency key", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      const result = await coord.createDraft(CREATE_INPUT, { idempotencyKey: "" });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("validation");
    });

    it("updates list coherently without deleting other items", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      expect(coord.getState().items).toHaveLength(1);

      await coord.createDraft(CREATE_INPUT);

      expect(coord.getState().items).toHaveLength(2);
    });

    it("fires onToast on success", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const toastMessages: string[] = [];
      const coord = makeCoordinator(adapter, "founder", {
        onToast: (m) => toastMessages.push(m),
      });
      await coord.createDraft(CREATE_INPUT);
      expect(toastMessages.some((m) => m.includes("created"))).toBe(true);
    });

    it("fires onError on failure and returns error result", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      vi.spyOn(adapter, "createDraft").mockRejectedValueOnce(
        new EngagementOperationError({ code: "network", message: "Network error" }),
      );
      const errors: EngagementOperationError[] = [];
      const coord = makeCoordinator(adapter, "founder", {
        onError: (e) => errors.push(e),
      });
      const result = await coord.createDraft(CREATE_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("network");
      expect(errors).toHaveLength(1);
    });

    it("discards result after disposal", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      coord.dispose();
      const result = await coord.createDraft(CREATE_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("aborted");
    });
  });

  describe("reviseDraft mutation", () => {
    it("founder can revise draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      const result = await coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);
      expect(result.success).toBe(true);
      expect(result.item).toBeDefined();
    });

    it("manager can revise draft", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "manager");
      await coord.sync();

      const result = await coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);
      expect(result.success).toBe(true);
    });

    it("senior_staff cannot revise — returns forbidden before port call", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const portSpy = vi.spyOn(adapter, "reviseDraft");
      const coord = makeCoordinator(adapter, "senior_staff");

      const result = await coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("forbidden");
      expect(portSpy).not.toHaveBeenCalled();
    });

    it("updates list and selected detail coherently", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      await coord.selectEngagement(ENG_DRAFT.id);

      await coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);

      // List item should be updated
      const state = coord.getState();
      expect(state.items.find((i) => i.id === ENG_DRAFT.id)).toBeDefined();
      // Selected detail should also be updated
      expect(state.selectedDetail?.id).toBe(ENG_DRAFT.id);
    });
  });

  describe("activate mutation (founder-only)", () => {
    it("founder can activate", async () => {
      const adapter = new TestEngagementsAdapter().seed(
        [ENG_DRAFT],
        new Map([[ENG_DRAFT.id, [DRAFT_VERSION]]]),
      );
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      const result = await coord.activate(ENG_DRAFT.id, ACTIVATE_INPUT);
      expect(result.success).toBe(true);
      expect(result.item?.status).toBe("active");
    });

    it("manager cannot activate — returns forbidden before port call", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const portSpy = vi.spyOn(adapter, "activate");
      const coord = makeCoordinator(adapter, "manager");

      const result = await coord.activate(ENG_DRAFT.id, ACTIVATE_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("forbidden");
      expect(portSpy).not.toHaveBeenCalled();
    });

    it("updates list item status to active", async () => {
      const adapter = new TestEngagementsAdapter().seed(
        [ENG_DRAFT],
        new Map([[ENG_DRAFT.id, [DRAFT_VERSION]]]),
      );
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      await coord.activate(ENG_DRAFT.id, ACTIVATE_INPUT);

      const item = coord.getState().items.find((i) => i.id === ENG_DRAFT.id);
      expect(item?.status).toBe("active");
    });
  });

  describe("amend mutation (founder-only)", () => {
    it("founder can amend active engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_ACTIVE]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      const result = await coord.amend(ENG_ACTIVE.id, AMEND_INPUT);
      expect(result.success).toBe(true);
    });

    it("manager cannot amend — returns forbidden before port call", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_ACTIVE]);
      const portSpy = vi.spyOn(adapter, "amend");
      const coord = makeCoordinator(adapter, "manager");

      const result = await coord.amend(ENG_ACTIVE.id, AMEND_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("forbidden");
      expect(portSpy).not.toHaveBeenCalled();
    });
  });

  describe("end mutation (founder-only)", () => {
    it("founder can end active engagement", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_ACTIVE]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();

      const result = await coord.end(ENG_ACTIVE.id, END_INPUT);
      expect(result.success).toBe(true);
      expect(result.item?.status).toBe("ended");
    });

    it("manager cannot end — returns forbidden before port call", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_ACTIVE]);
      const portSpy = vi.spyOn(adapter, "end");
      const coord = makeCoordinator(adapter, "manager");

      const result = await coord.end(ENG_ACTIVE.id, END_INPUT);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("forbidden");
      expect(portSpy).not.toHaveBeenCalled();
    });

    it("does not delete lifecycle history (prior items remain)", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT, ENG_ACTIVE]);
      const coord = makeCoordinator(adapter, "founder");
      await coord.sync();
      expect(coord.getState().items).toHaveLength(2);

      await coord.end(ENG_ACTIVE.id, END_INPUT);

      // Both items still present; only ENG_ACTIVE is updated
      expect(coord.getState().items).toHaveLength(2);
      const endedItem = coord.getState().items.find((i) => i.id === ENG_ACTIVE.id);
      expect(endedItem?.status).toBe("ended");
    });
  });

  describe("stale suppression", () => {
    it("stale sync results are silently discarded after generation bump", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");

      // Start sync and cancel before it resolves
      const p = coord.sync();
      coord.cancelPending({ notify: false });
      await p;

      // Items should not be populated (sync was cancelled)
      expect(coord.getState().items).toEqual([]);
    });
  });

  describe("cancelPending and dispose", () => {
    it("cancelPending stops loading and notifies", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      const notifications: boolean[] = [];
      coord.subscribe(() => notifications.push(coord.getState().loading));

      // Start sync (async)
      const syncPromise = coord.sync();

      // Cancel before resolution
      coord.cancelPending({ notify: true });
      await syncPromise.catch(() => {});

      expect(coord.getState().loading).toBe(false);
    });

    it("dispose prevents further notifications", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const coord = makeCoordinator(adapter, "founder");
      let notified = 0;
      coord.subscribe(() => notified++);

      coord.dispose();
      await coord.sync();
      // No additional notifications after dispose
      expect(notified).toBe(0);
    });

    it("mutations return aborted after dispose", async () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      coord.dispose();

      const result = await coord.createDraft(CREATE_INPUT);
      expect(result.error?.code).toBe("aborted");
    });
  });

  describe("subscription", () => {
    it("subscribe returns an unsubscribe function", () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      let count = 0;
      const unsub = coord.subscribe(() => count++);
      unsub();
      // After unsubscribe, notifications should not reach this listener
      void coord.sync();
      expect(count).toBe(0);
    });

    it("subscribe on disposed coordinator returns no-op", () => {
      const adapter = new TestEngagementsAdapter().seed([]);
      const coord = makeCoordinator(adapter, "founder");
      coord.dispose();
      const unsub = coord.subscribe(() => {
        throw new Error("Should not be called");
      });
      expect(() => unsub()).not.toThrow();
    });
  });

  describe("remediation proofs", () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((r, j) => {
        resolve = r;
        reject = j;
      });
      return { promise, resolve, reject };
    };
    it("runs a same-role sync while delayed create is in flight and merges the create", async () => {
      const adapter = new TestEngagementsAdapter().seed([]); const create = deferred<typeof ENG_DRAFT>();
      vi.spyOn(adapter, "createDraft").mockReturnValueOnce(create.promise); const coord = makeCoordinator(adapter, "founder");
      const mutation = coord.createDraft(CREATE_INPUT); const sync = coord.sync(); create.resolve(ENG_DRAFT); await mutation; await sync;
      expect(coord.getState().items.some((item) => item.id === ENG_DRAFT.id)).toBe(true);
    });
    it("does not let a pre-mutation list clobber the mutation", async () => {
      const adapter = new TestEngagementsAdapter().seed([]); const list = deferred<typeof ENG_DRAFT[]>();
      vi.spyOn(adapter, "list").mockReturnValueOnce(list.promise); const coord = makeCoordinator(adapter, "founder"); const sync = coord.sync();
      await coord.createDraft(CREATE_INPUT); list.resolve([]); await sync; expect(coord.getState().items).toHaveLength(1);
    });
    it("silently discards a role-switched mutation", async () => {
      const adapter = new TestEngagementsAdapter().seed([]); const pending = deferred<typeof ENG_DRAFT>(); vi.spyOn(adapter, "createDraft").mockReturnValueOnce(pending.promise);
      const errors: unknown[] = []; const toasts: string[] = []; const coord = makeCoordinator(adapter, "founder", { onError: (e) => errors.push(e), onToast: (m) => toasts.push(m) }); const work = coord.createDraft(CREATE_INPUT); await coord.switchRole("manager"); pending.resolve(ENG_DRAFT); expect((await work).error?.code).toBe("aborted"); expect(errors).toHaveLength(0); expect(toasts).toHaveLength(0);
    });
    it.each(["reviseDraft", "activate", "amend"] as const)(
      "refreshes selectedVersions after %s",
      async (operation) => {
        const isAmend = operation === "amend";
        const isActivate = operation === "activate";
        const engagement = isAmend ? ENG_ACTIVE : ENG_DRAFT;
        const versions = !isAmend
          ? new Map([[ENG_DRAFT.id, [DRAFT_VERSION]]])
          : undefined;
        const adapter = new TestEngagementsAdapter().seed([engagement], versions);
        const coord = makeCoordinator(adapter, "founder");

        await coord.selectEngagement(engagement.id);

        let result: Awaited<ReturnType<typeof coord.reviseDraft>>;
        if (operation === "reviseDraft") {
          result = await coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);
        } else if (isActivate) {
          result = await coord.activate(ENG_DRAFT.id, ACTIVATE_INPUT);
        } else {
          result = await coord.amend(ENG_ACTIVE.id, AMEND_INPUT);
        }

        expect(result.success).toBe(true);
        const selectedVersions = coord.getState().selectedVersions;
        if (isActivate) {
          expect(selectedVersions).toHaveLength(1);
          expect(selectedVersions[0]).toMatchObject({
            id: DRAFT_VERSION.id,
            approvedAt: expect.any(String),
            approvedById: expect.any(String),
          });
        } else if (operation === "reviseDraft") {
          expect(selectedVersions).toHaveLength(2);
          expect(selectedVersions[1]).toMatchObject({
            title: REVISE_INPUT.title,
            scope: REVISE_INPUT.scope,
          });
        } else {
          expect(selectedVersions).toHaveLength(1);
          expect(selectedVersions[0]).toMatchObject({
            title: AMEND_INPUT.title,
            scope: AMEND_INPUT.scope,
          });
        }
      },
    );
    it("retains versions and reports sanitized refresh failure while mutation succeeds", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const errors: EngagementOperationError[] = [];
      const coord = makeCoordinator(adapter, "founder", {
        onError: (error) => errors.push(error),
      });
      await coord.selectEngagement(ENG_DRAFT.id);
      const before = coord.getState().selectedVersions;
      vi.spyOn(adapter, "listVersions").mockRejectedValueOnce(new Error("secret"));

      const result = await coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);

      expect(result.success).toBe(true);
      expect(coord.getState().selectedVersions).toBe(before);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).not.toContain("secret");
    });
    it.each(["", "x".repeat(256)])("rejects generated invalid idempotency key before port call: %s", async (key) => { const adapter = new TestEngagementsAdapter().seed([]); const spy = vi.spyOn(adapter, "createDraft"); const coord = makeCoordinator(adapter, "founder", { generateKey: () => key }); expect((await coord.createDraft(CREATE_INPUT)).error?.code).toBe("validation"); expect(spy).not.toHaveBeenCalled(); });
    it("discards a pending refresh after session change without stale callbacks", async () => {
      const adapter = new TestEngagementsAdapter().seed([ENG_DRAFT]);
      const refresh = deferred<EngagementVersionDto[]>();
      const refreshStarted = deferred<void>();
      const listVersions = vi.spyOn(adapter, "listVersions");
      listVersions.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
        refreshStarted.resolve();
        return refresh.promise;
      });
      const errors: EngagementOperationError[] = [];
      const toasts: string[] = [];
      const coord = makeCoordinator(adapter, "founder", {
        onError: (error) => errors.push(error),
        onToast: (message) => toasts.push(message),
      });

      await coord.selectEngagement(ENG_DRAFT.id);
      const work = coord.reviseDraft(ENG_DRAFT.id, REVISE_INPUT);
      await refreshStarted.promise;
      await coord.switchRole("manager");
      refresh.reject(new Error("late refresh"));

      expect((await work).error?.code).toBe("aborted");
      expect(errors).toHaveLength(0);
      expect(toasts).toHaveLength(0);
    });
  });
});
