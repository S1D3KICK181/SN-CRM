import { randomUUID } from "node:crypto";

import type {
  DashboardDto,
  OperationReceipt,
  PracticeOperationEnvelope,
  PracticeQueryEnvelope,
} from "../src/lib/practice-api/contract.ts";
import { DashboardDtoSchema, OperationReceiptSchema } from "../src/lib/practice-api/contract.ts";
import { resolveAssignmentTransition } from "./assignment-transition.ts";
import type { PracticeServerConfig } from "./config.ts";
import { buildDashboardDto } from "./dashboard.ts";
import { PracticeHttpError } from "./errors.ts";
import { executeSupabaseOperation, operationRequestHash } from "./operations.ts";
import { DEMO_ACCESS_TOKEN, createDemoDashboardRepository } from "./repositories/demo-dashboard.ts";
import { createSupabaseDashboardRepository } from "./repositories/supabase-dashboard.ts";
import { authenticateSupabaseActor } from "./supabase.ts";

export interface PracticeRequestContext {
  accessToken: string | null;
  requestId: string;
  signal?: AbortSignal;
}

interface DemoAssignmentOverride {
  status: string;
  progress: number;
  version: number;
}

interface DemoReceiptRecord {
  hash: string;
  receipt?: OperationReceipt;
  error?: PracticeHttpError;
}

function indiaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = values["year"];
  const month = values["month"];
  const day = values["day"];
  if (!year || !month || !day) throw new Error("Could not format the India calendar date");
  return year + "-" + month + "-" + day;
}

function requireToken(context: PracticeRequestContext): string {
  if (!context.accessToken) {
    throw new PracticeHttpError(401, "UNAUTHENTICATED", "A bearer token is required");
  }
  return context.accessToken;
}

function assertDemoToken(context: PracticeRequestContext): void {
  if (requireToken(context) !== DEMO_ACCESS_TOKEN) {
    throw new PracticeHttpError(401, "UNAUTHENTICATED", "The demo bearer token is invalid");
  }
}

function cloneError(error: PracticeHttpError, replayed: boolean): PracticeHttpError {
  const details =
    error.details && typeof error.details === "object"
      ? { ...(error.details as Record<string, unknown>), replayed }
      : { replayed };
  return new PracticeHttpError(error.status, error.code, error.message, details);
}

export class PracticeKernel {
  readonly #config: PracticeServerConfig;
  readonly #demoOverrides = new Map<string, DemoAssignmentOverride>();
  readonly #demoReceipts = new Map<string, DemoReceiptRecord>();

  constructor(config: PracticeServerConfig) {
    this.#config = config;
  }

  async query(
    query: PracticeQueryEnvelope,
    context: PracticeRequestContext,
  ): Promise<DashboardDto> {
    if (query.type !== "dashboard.get") {
      throw new PracticeHttpError(400, "UNSUPPORTED_QUERY", "The query type is not supported");
    }

    if (this.#config.mode === "demo") {
      assertDemoToken(context);
      const data = await createDemoDashboardRepository().load(context.signal);
      data.assignments = data.assignments.map((assignment) => {
        const override = this.#demoOverrides.get(assignment.id);
        return override ? { ...assignment, ...override } : assignment;
      });
      return DashboardDtoSchema.parse(
        buildDashboardDto(data, query.input ?? {}, this.#config.demoAsOfDate),
      );
    }

    const accessToken = requireToken(context);
    const supabaseConfig = this.#config.supabase;
    if (!supabaseConfig) {
      throw new PracticeHttpError(500, "INVALID_CONFIGURATION", "Supabase mode is not configured");
    }
    const { client } = await authenticateSupabaseActor(supabaseConfig, accessToken);
    const repository = createSupabaseDashboardRepository(client);
    const data = await repository.load(context.signal);
    return DashboardDtoSchema.parse(buildDashboardDto(data, query.input ?? {}, indiaDate()));
  }

  async operate(
    operation: PracticeOperationEnvelope,
    idempotencyKey: string,
    context: PracticeRequestContext,
  ): Promise<OperationReceipt> {
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new PracticeHttpError(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key must contain between 1 and 200 characters",
      );
    }
    if (operation.type !== "assignment.transition") {
      throw new PracticeHttpError(
        400,
        "UNSUPPORTED_OPERATION",
        "The operation type is not supported",
      );
    }

    if (this.#config.mode === "demo") {
      assertDemoToken(context);
      return this.#operateDemo(operation, idempotencyKey);
    }

    const accessToken = requireToken(context);
    const supabaseConfig = this.#config.supabase;
    if (!supabaseConfig) {
      throw new PracticeHttpError(500, "INVALID_CONFIGURATION", "Supabase mode is not configured");
    }
    const authenticated = await authenticateSupabaseActor(supabaseConfig, accessToken);
    const receipt = await executeSupabaseOperation({
      userClient: authenticated.client,
      idempotencyKey,
      operation,
      requestId: context.requestId,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    return OperationReceiptSchema.parse(receipt);
  }

  async #operateDemo(
    operation: PracticeOperationEnvelope,
    idempotencyKey: string,
  ): Promise<OperationReceipt> {
    const hash = operationRequestHash(operation);
    const existing = this.#demoReceipts.get(idempotencyKey);
    if (existing) {
      if (existing.hash !== hash) {
        throw new PracticeHttpError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was already used for a different request",
        );
      }
      if (existing.error) throw cloneError(existing.error, true);
      return OperationReceiptSchema.parse({ ...existing.receipt, replayed: true });
    }

    const operationId = randomUUID();
    const createdAt = new Date().toISOString();
    try {
      const input = operation.input;
      const data = await createDemoDashboardRepository().load();
      const source = data.assignments.find((assignment) => assignment.id === input.assignmentId);
      if (!source) {
        throw new PracticeHttpError(
          404,
          "ASSIGNMENT_NOT_FOUND",
          "The assignment was not found or is not accessible",
        );
      }
      const current = this.#demoOverrides.get(source.id) ?? {
        status: source.status,
        progress: source.progress,
        version: source.version,
      };
      if (
        current.version !== input.expectedVersion ||
        (input.expectedStatus !== undefined && current.status !== input.expectedStatus)
      ) {
        throw new PracticeHttpError(
          409,
          "ASSIGNMENT_VERSION_CONFLICT",
          "The assignment changed since it was loaded",
          {
            expectedVersion: input.expectedVersion,
            currentVersion: current.version,
            currentStatus: current.status,
          },
        );
      }
      const transition = resolveAssignmentTransition(
        { status: current.status, progress: current.progress },
        {
          nextStatus: input.nextStatus,
          ...(input.progress !== undefined ? { progress: input.progress } : {}),
        },
        this.#config.demoAsOfDate,
      );
      const next = {
        status: transition.status,
        progress: transition.progress,
        version: current.version + 1,
      };
      this.#demoOverrides.set(source.id, next);
      const receipt = OperationReceiptSchema.parse({
        operationId,
        type: operation.type,
        state: "completed",
        replayed: false,
        result: { assignment: { id: source.id, ...next } },
        createdAt,
        completedAt: new Date().toISOString(),
      });
      this.#demoReceipts.set(idempotencyKey, { hash, receipt });
      return receipt;
    } catch (error) {
      if (error instanceof PracticeHttpError) {
        const stored = cloneError(
          new PracticeHttpError(error.status, error.code, error.message, {
            ...(error.details && typeof error.details === "object"
              ? (error.details as Record<string, unknown>)
              : {}),
            operationId,
          }),
          false,
        );
        this.#demoReceipts.set(idempotencyKey, { hash, error: stored });
        throw stored;
      }
      throw error;
    }
  }
}
