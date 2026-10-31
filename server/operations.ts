import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  OperationReceipt,
  PracticeOperationEnvelope,
} from "../src/lib/practice-api/contract.ts";
import { validateAssignmentTransitionIntent } from "./assignment-transition.ts";
import { PracticeHttpError } from "./errors.ts";

const RpcFailureSchema = z
  .object({
    status: z.number().int(),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

const RpcReceiptSchema = z
  .object({
    operation_id: z.string().uuid(),
    operation_type: z.literal("assignment.transition"),
    state: z.enum(["completed", "failed"]),
    replayed: z.boolean(),
    result: z.unknown().nullable().optional(),
    error: RpcFailureSchema.nullable().optional(),
    created_at: z.string().datetime(),
    completed_at: z.string().datetime().nullable(),
  })
  .strict();

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(record)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key]))
      .join(",") +
    "}"
  );
}

export function operationRequestHash(operation: PracticeOperationEnvelope): string {
  return createHash("sha256").update(canonicalJson(operation)).digest("hex");
}

function operationDataSourceError(message: string): PracticeHttpError {
  return new PracticeHttpError(
    502,
    "DATA_SOURCE_ERROR",
    "The practice data source could not complete the operation",
    { source: "transition_assignment_operation", message },
  );
}

export async function executeSupabaseOperation(options: {
  userClient: SupabaseClient;
  idempotencyKey: string;
  operation: PracticeOperationEnvelope;
  requestId: string;
  signal?: AbortSignal;
}): Promise<OperationReceipt> {
  const input = options.operation.input;
  validateAssignmentTransitionIntent({
    nextStatus: input.nextStatus,
    ...(input.expectedStatus !== undefined ? { expectedStatus: input.expectedStatus } : {}),
    ...(input.progress !== undefined ? { progress: input.progress } : {}),
  });

  let rpc = options.userClient.rpc("transition_assignment_operation", {
    _idempotency_key: options.idempotencyKey,
    _request_hash: operationRequestHash(options.operation),
    _assignment_id: input.assignmentId,
    _expected_version: input.expectedVersion,
    _expected_status: input.expectedStatus ?? null,
    _next_status: input.nextStatus,
    _progress: input.progress ?? null,
    _correlation_id: randomUUID(),
    _request_id: options.requestId,
    _reason: input.reason ?? null,
  });
  if (options.signal) rpc = rpc.abortSignal(options.signal);
  const response = await rpc;
  if (response.error) {
    if (response.error.code === "PGRST202") {
      throw new PracticeHttpError(
        503,
        "OPERATIONS_NOT_CONFIGURED",
        "The assignment operation RPC has not been installed",
      );
    }
    throw operationDataSourceError(response.error.message);
  }

  const parsed = RpcReceiptSchema.safeParse(response.data);
  if (!parsed.success) {
    throw operationDataSourceError("The operation RPC returned an invalid receipt");
  }
  const rpcReceipt = parsed.data;
  if (rpcReceipt.state === "failed") {
    const failure = rpcReceipt.error;
    if (!failure) {
      throw operationDataSourceError("The failed operation receipt did not include an error");
    }
    const status = failure.status >= 400 && failure.status < 500 ? failure.status : 409;
    throw new PracticeHttpError(status, failure.code, failure.message, {
      operationId: rpcReceipt.operation_id,
      replayed: rpcReceipt.replayed,
      ...(failure.details !== undefined ? { failure: failure.details } : {}),
    });
  }

  return {
    operationId: rpcReceipt.operation_id,
    type: rpcReceipt.operation_type,
    state: rpcReceipt.state,
    replayed: rpcReceipt.replayed,
    ...(rpcReceipt.result !== undefined && rpcReceipt.result !== null
      ? { result: rpcReceipt.result }
      : {}),
    createdAt: rpcReceipt.created_at,
    completedAt: rpcReceipt.completed_at,
  };
}
