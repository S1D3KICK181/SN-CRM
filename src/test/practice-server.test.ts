import type { AddressInfo } from "node:net";

import {
  PracticeOperationEnvelopeSchema,
  PracticeQueryEnvelopeSchema,
} from "../lib/practice-api/contract.ts";
import type { PracticeServerConfig } from "../../server/config.ts";
import { resolveAssignmentTransition } from "../../server/assignment-transition.ts";
import { buildDashboardDto, type DashboardDataSet } from "../../server/dashboard.ts";
import { PracticeHttpError } from "../../server/errors.ts";
import { createPracticeHttpServer } from "../../server/http.ts";
import { PracticeKernel } from "../../server/kernel.ts";
import { executeSupabaseOperation, operationRequestHash } from "../../server/operations.ts";
import { createSupabaseDashboardRepository } from "../../server/repositories/supabase-dashboard.ts";
import { authenticateSupabaseActor, type SupabaseRuntimeConfig } from "../../server/supabase.ts";

function demoConfig(overrides: Partial<PracticeServerConfig> = {}): PracticeServerConfig {
  return {
    mode: "demo",
    host: "127.0.0.1",
    port: 8787,
    bodyLimitBytes: 1_048_576,
    allowedOrigins: new Set(["http://localhost:5173", "http://127.0.0.1:4173"]),
    demoAsOfDate: "2026-10-30",
    shutdownTimeoutMs: 1_000,
    ...overrides,
  };
}

function demoContext(token: string | null = "local-demo-token") {
  return { accessToken: token, requestId: "test-request" };
}

describe("assignment transition policy", () => {
  const completionDate = "2026-10-30";

  it.each([
    ["In Progress", "Pending Internal Review"],
    ["Pending Internal Review", "Correction Required"],
    ["Correction Required", "In Progress"],
    ["Pending Internal Review", "Awaiting Client Approval"],
    ["Ready for Filing / Submission", "Filed / Submitted"],
    ["On Hold", "In Progress"],
  ] as const)("allows realistic workflow movement from %s to %s", (status, nextStatus) => {
    expect(
      resolveAssignmentTransition(
        { status, progress: 60 },
        { nextStatus, progress: 70 },
        completionDate,
      ),
    ).toEqual({ status: nextStatus, progress: 70, actualCompletion: null });
  });

  it("forces completed work to 100 percent and records the completion date", () => {
    expect(
      resolveAssignmentTransition(
        { status: "Awaiting Client Approval", progress: 74 },
        { nextStatus: "Completed", progress: 10 },
        completionDate,
      ),
    ).toEqual({
      status: "Completed",
      progress: 100,
      actualCompletion: completionDate,
    });
  });

  it.each([
    ["self transition", "In Progress", "In Progress", 50],
    ["completed is terminal", "Completed", "On Hold", 100],
    ["cancelled is terminal", "Cancelled", "New", 20],
    ["workflow stage cannot be skipped", "New", "Completed", 0],
    ["only completed work can be at 100", "In Progress", "On Hold", 100],
  ] as const)("rejects %s", (_case, status, nextStatus, progress) => {
    expect(() =>
      resolveAssignmentTransition(
        { status, progress: status === "Completed" ? 100 : 50 },
        { nextStatus, progress },
        completionDate,
      ),
    ).toThrowError(
      expect.objectContaining({
        status: 409,
        code: "INVALID_ASSIGNMENT_TRANSITION",
      }),
    );
  });
});

describe("practice dashboard aggregation", () => {
  it("groups collections from payment receipt dates, not invoice cumulative receipts", () => {
    const data: DashboardDataSet = {
      assignments: [],
      invoices: [
        {
          id: "invoice-1",
          clientId: "client-1",
          clientName: "Example Client",
          invoiceDate: "2026-10-01",
          dueDate: "2026-10-20",
          total: 1_000,
          amountReceived: 900,
          status: "Partially Paid",
        },
      ],
      payments: [
        { id: "old-payment", receiptDate: "2026-09-10", amount: 800 },
        { id: "current-payment", receiptDate: "2026-10-10", amount: 100 },
      ],
      allocations: [
        { paymentId: "old-payment", invoiceId: "invoice-1", amount: 800 },
        { paymentId: "current-payment", invoiceId: "invoice-1", amount: 100 },
      ],
    };

    const dashboard = buildDashboardDto(data, { months: 3 }, "2026-10-30");

    expect(dashboard.collectionsSnapshot.collectedThisMonth).toBe(100);
    expect(dashboard.billingAndCollections.at(-1)).toMatchObject({
      month: "2026-10",
      billed: 1_000,
      collected: 100,
    });
  });
});

describe("demo practice kernel", () => {
  it("returns the deterministic five-module dashboard only for the demo token", async () => {
    const kernel = new PracticeKernel(demoConfig());
    const query = PracticeQueryEnvelopeSchema.parse({ type: "dashboard.get" });

    const dashboard = await kernel.query(query, demoContext());

    expect(dashboard.headline).toEqual({
      dueToday: 1,
      openAssignments: 2,
      pendingReview: 1,
      outstandingFees: 103_000,
      overdueFees: 14_500,
    });
    expect(dashboard.collectionsSnapshot).toMatchObject({
      billedThisMonth: 118_000,
      collectedThisMonth: 15_000,
      dueNext7Days: 88_500,
      unallocatedReceipts: 0,
    });
    expect(dashboard.topClientOutstanding).toHaveLength(2);
    expect(dashboard.billingAndCollections).toHaveLength(6);
    expect(dashboard.openAssignments).toHaveLength(2);

    await expect(kernel.query(query, demoContext("wrong-token"))).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("uses versions and idempotency receipts for assignment transitions", async () => {
    const kernel = new PracticeKernel(demoConfig());
    const operation = PracticeOperationEnvelopeSchema.parse({
      type: "assignment.transition",
      input: {
        assignmentId: "assignment-1",
        expectedVersion: 1,
        expectedStatus: "In Progress",
        nextStatus: "Pending Internal Review",
        progress: 90,
      },
    });

    const first = await kernel.operate(operation, "transition-1", demoContext());
    const replay = await kernel.operate(operation, "transition-1", demoContext());
    const dashboard = await kernel.query(
      PracticeQueryEnvelopeSchema.parse({ type: "dashboard.get" }),
      demoContext(),
    );

    expect(first).toMatchObject({
      state: "completed",
      replayed: false,
      result: {
        assignment: {
          id: "assignment-1",
          version: 2,
          status: "Pending Internal Review",
          progress: 90,
        },
      },
    });
    expect(replay.operationId).toBe(first.operationId);
    expect(replay.replayed).toBe(true);
    expect(dashboard.openAssignments.find((item) => item.id === "assignment-1")).toMatchObject({
      version: 2,
      status: "Pending Internal Review",
      progress: 90,
    });

    const changedRequest = PracticeOperationEnvelopeSchema.parse({
      type: "assignment.transition",
      input: {
        ...operation.input,
        nextStatus: "Completed",
      },
    });
    await expect(
      kernel.operate(changedRequest, "transition-1", demoContext()),
    ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("applies the shared transition policy in demo operations", async () => {
    const kernel = new PracticeKernel(demoConfig());
    const invalid = PracticeOperationEnvelopeSchema.parse({
      type: "assignment.transition",
      input: {
        assignmentId: "assignment-1",
        expectedVersion: 1,
        nextStatus: "Pending Internal Review",
        progress: 100,
      },
    });
    await expect(kernel.operate(invalid, "invalid-progress", demoContext())).rejects.toMatchObject({
      status: 409,
      code: "INVALID_ASSIGNMENT_TRANSITION",
    });

    const complete = PracticeOperationEnvelopeSchema.parse({
      type: "assignment.transition",
      input: {
        assignmentId: "assignment-2",
        expectedVersion: 3,
        expectedStatus: "Pending Internal Review",
        nextStatus: "Completed",
        progress: 12,
      },
    });
    await expect(
      kernel.operate(complete, "complete-assignment", demoContext()),
    ).resolves.toMatchObject({
      result: {
        assignment: {
          id: "assignment-2",
          status: "Completed",
          progress: 100,
          version: 4,
        },
      },
    });
  });

  it("hashes semantically identical operation objects consistently", () => {
    const first = PracticeOperationEnvelopeSchema.parse({
      type: "assignment.transition",
      input: {
        assignmentId: "assignment-1",
        expectedVersion: 1,
        nextStatus: "Completed",
      },
    });
    const reordered = PracticeOperationEnvelopeSchema.parse({
      input: {
        nextStatus: "Completed",
        expectedVersion: 1,
        assignmentId: "assignment-1",
      },
      type: "assignment.transition",
    });
    expect(operationRequestHash(first)).toBe(operationRequestHash(reordered));
  });
});

describe("Supabase atomic operations", () => {
  const operation = PracticeOperationEnvelopeSchema.parse({
    type: "assignment.transition",
    input: {
      assignmentId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 3,
      expectedStatus: "In Progress",
      nextStatus: "Pending Internal Review",
      progress: 80,
      reason: "Ready for manager review",
    },
  });

  it("uses the user-scoped atomic RPC and maps its durable receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        operation_id: "22222222-2222-4222-8222-222222222222",
        operation_type: "assignment.transition",
        state: "completed",
        replayed: false,
        result: {
          assignment: {
            id: operation.input.assignmentId,
            status: operation.input.nextStatus,
            progress: 80,
            version: 4,
          },
        },
        error: null,
        created_at: "2026-10-30T08:00:00.000Z",
        completed_at: "2026-10-30T08:00:00.100Z",
      },
      error: null,
    });

    const receipt = await executeSupabaseOperation({
      userClient: { rpc } as never,
      idempotencyKey: "review-assignment-1",
      operation,
      requestId: "browser-request-42",
    });

    expect(receipt).toMatchObject({
      operationId: "22222222-2222-4222-8222-222222222222",
      state: "completed",
      replayed: false,
      result: { assignment: { version: 4 } },
    });
    expect(rpc).toHaveBeenCalledWith(
      "transition_assignment_operation",
      expect.objectContaining({
        _idempotency_key: "review-assignment-1",
        _assignment_id: operation.input.assignmentId,
        _expected_version: 3,
        _expected_status: "In Progress",
        _next_status: "Pending Internal Review",
        _progress: 80,
        _request_id: "browser-request-42",
        _reason: "Ready for manager review",
        _request_hash: operationRequestHash(operation),
        _correlation_id: expect.any(String),
      }),
    );
  });

  it("surfaces a replayed business failure without hiding its operation ID", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        operation_id: "33333333-3333-4333-8333-333333333333",
        operation_type: "assignment.transition",
        state: "failed",
        replayed: true,
        result: null,
        error: {
          status: 409,
          code: "ASSIGNMENT_VERSION_CONFLICT",
          message: "The assignment changed since it was loaded",
        },
        created_at: "2026-10-30T08:00:00.000Z",
        completed_at: "2026-10-30T08:00:00.100Z",
      },
      error: null,
    });

    await expect(
      executeSupabaseOperation({
        userClient: { rpc } as never,
        idempotencyKey: "review-assignment-1",
        operation,
        requestId: "browser-request-42",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ASSIGNMENT_VERSION_CONFLICT",
      details: {
        operationId: "33333333-3333-4333-8333-333333333333",
        replayed: true,
      },
    });
  });
});

describe("Supabase dashboard repository", () => {
  it("forwards the user bearer token on every RLS-protected read", async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.includes("/auth/v1/user")) {
        return new Response(
          JSON.stringify({
            id: "11111111-1111-4111-8111-111111111111",
            aud: "authenticated",
            role: "authenticated",
            email: "test@example.com",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const config: SupabaseRuntimeConfig = {
      url: "https://example.supabase.co",
      publishableKey: "publishable-key",
      serviceRoleKey: "service-role-must-not-be-used",
      fetch: fakeFetch,
    };

    const authenticated = await authenticateSupabaseActor(config, "user-access-token");
    const dashboardRepository = createSupabaseDashboardRepository(authenticated.client);
    const data = await dashboardRepository.load();

    expect(data).toEqual({
      assignments: [],
      invoices: [],
      payments: [],
      allocations: [],
    });
    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.headers.get("Authorization")).toBe("Bearer user-access-token");
      expect(request.headers.get("apikey")).toBe("publishable-key");
      expect(request.headers.get("Authorization")).not.toContain("service-role");
    }
  });
});

describe("practice HTTP server", () => {
  let runtime: ReturnType<typeof createPracticeHttpServer> | undefined;
  let baseUrl = "";

  beforeEach(async () => {
    runtime = createPracticeHttpServer({
      config: demoConfig({ bodyLimitBytes: 512 }),
      logger: { error: vi.fn() },
    });
    await new Promise<void>((resolve) => {
      runtime!.server.listen(0, "127.0.0.1", resolve);
    });
    const address = runtime.server.address() as AddressInfo;
    baseUrl = "http://127.0.0.1:" + address.port;
  });

  afterEach(async () => {
    if (!runtime) return;
    runtime.abortActiveRequests();
    await new Promise<void>((resolve) => runtime!.server.close(() => resolve()));
    runtime = undefined;
  });

  it("serves health and echoes a safe request ID", async () => {
    const response = await fetch(baseUrl + "/health", {
      headers: { "X-Request-ID": "browser-request-42" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-ID")).toBe("browser-request-42");
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok", mode: "demo" },
      meta: { requestId: "browser-request-42" },
    });
  });

  it("serves the dashboard with structured errors for invalid authentication", async () => {
    const valid = await fetch(baseUrl + "/v1/query", {
      method: "POST",
      headers: {
        Authorization: "Bearer local-demo-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "dashboard.get" }),
    });
    expect(valid.status).toBe(200);
    expect((await valid.json()).data.headline.outstandingFees).toBe(103_000);

    const invalid = await fetch(baseUrl + "/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "dashboard.get" }),
    });
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED", requestId: expect.any(String) },
    });
  });

  it("rejects untrusted origins and oversized bodies", async () => {
    const preflight = await fetch(baseUrl + "/v1/query", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:4173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:4173");

    const cors = await fetch(baseUrl + "/health", {
      headers: { Origin: "https://untrusted.example" },
    });
    expect(cors.status).toBe(403);
    expect(await cors.json()).toMatchObject({ error: { code: "CORS_ORIGIN_DENIED" } });

    const oversized = await fetch(baseUrl + "/v1/query", {
      method: "POST",
      headers: {
        Authorization: "Bearer local-demo-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "dashboard.get", padding: "x".repeat(1_000) }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "REQUEST_TOO_LARGE" } });
  });

  it("rejects impossible calendar dates at the contract boundary", async () => {
    const response = await fetch(baseUrl + "/v1/query", {
      method: "POST",
      headers: {
        Authorization: "Bearer local-demo-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "dashboard.get",
        input: { asOfDate: "2026-02-31" },
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });
});
