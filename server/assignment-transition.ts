import { AssignmentStatusSchema, type AssignmentStatus } from "../src/lib/practice-api/contract.ts";
import { PracticeHttpError } from "./errors.ts";

export interface AssignmentState {
  status: string;
  progress: number;
}

export interface AssignmentTransitionRequest {
  nextStatus: AssignmentStatus;
  progress?: number;
}

export interface AssignmentTransitionIntent extends AssignmentTransitionRequest {
  expectedStatus?: AssignmentStatus;
}

export interface ResolvedAssignmentTransition {
  status: AssignmentStatus;
  progress: number;
  actualCompletion: string | null;
}

const TRANSITIONS = {
  New: ["Awaiting Assignment", "Assigned", "On Hold", "Cancelled"],
  "Awaiting Assignment": ["New", "Assigned", "On Hold", "Cancelled"],
  Assigned: [
    "Awaiting Assignment",
    "Awaiting Client Documents",
    "In Progress",
    "On Hold",
    "Cancelled",
  ],
  "Awaiting Client Documents": ["Assigned", "In Progress", "On Hold", "Cancelled"],
  "In Progress": ["Awaiting Client Documents", "Pending Internal Review", "On Hold", "Cancelled"],
  "Pending Internal Review": [
    "In Progress",
    "Correction Required",
    "Awaiting Client Approval",
    "Ready for Filing / Submission",
    "Completed",
    "On Hold",
    "Cancelled",
  ],
  "Correction Required": ["In Progress", "Pending Internal Review", "On Hold", "Cancelled"],
  "Awaiting Client Approval": [
    "In Progress",
    "Correction Required",
    "Ready for Filing / Submission",
    "Completed",
    "On Hold",
    "Cancelled",
  ],
  "Ready for Filing / Submission": [
    "Pending Internal Review",
    "Correction Required",
    "Awaiting Client Approval",
    "Filed / Submitted",
    "Completed",
    "On Hold",
    "Cancelled",
  ],
  "Filed / Submitted": [
    "Correction Required",
    "Ready for Filing / Submission",
    "Completed",
    "On Hold",
    "Cancelled",
  ],
  "On Hold": [
    "Awaiting Assignment",
    "Assigned",
    "Awaiting Client Documents",
    "In Progress",
    "Pending Internal Review",
    "Correction Required",
    "Awaiting Client Approval",
    "Ready for Filing / Submission",
    "Filed / Submitted",
    "Cancelled",
  ],
  Completed: [],
  Cancelled: [],
} as const satisfies Record<AssignmentStatus, readonly AssignmentStatus[]>;

function invalidTransition(currentStatus: string, nextStatus: string, reason: string): never {
  throw new PracticeHttpError(
    409,
    "INVALID_ASSIGNMENT_TRANSITION",
    "The requested assignment transition is not allowed",
    { currentStatus, nextStatus, reason },
  );
}

/**
 * Pure assignment state-machine policy. The completion date is supplied by the
 * caller so the same deterministic rule can run in demo and production.
 */
export function resolveAssignmentTransition(
  current: AssignmentState,
  request: AssignmentTransitionRequest,
  completionDate: string,
): ResolvedAssignmentTransition {
  const parsedCurrent = AssignmentStatusSchema.safeParse(current.status);
  if (!parsedCurrent.success) {
    invalidTransition(current.status, request.nextStatus, "unknown_current_status");
  }
  const currentStatus = parsedCurrent.data;
  if (currentStatus === request.nextStatus) {
    invalidTransition(currentStatus, request.nextStatus, "same_status");
  }
  if (currentStatus === "Completed" || currentStatus === "Cancelled") {
    invalidTransition(currentStatus, request.nextStatus, "terminal_status");
  }
  const allowed = TRANSITIONS[currentStatus] as readonly AssignmentStatus[];
  if (!allowed.includes(request.nextStatus)) {
    invalidTransition(currentStatus, request.nextStatus, "workflow_order");
  }
  if (!Number.isInteger(current.progress) || current.progress < 0 || current.progress > 100) {
    invalidTransition(currentStatus, request.nextStatus, "invalid_current_progress");
  }

  if (request.nextStatus === "Completed") {
    return {
      status: request.nextStatus,
      progress: 100,
      actualCompletion: completionDate,
    };
  }

  const progress = request.progress ?? current.progress;
  if (!Number.isInteger(progress) || progress < 0 || progress >= 100) {
    invalidTransition(
      currentStatus,
      request.nextStatus,
      "non_completed_progress_must_be_below_100",
    );
  }
  return {
    status: request.nextStatus,
    progress,
    actualCompletion: null,
  };
}

/**
 * Performs every transition check possible before an atomic database call. If
 * expectedStatus is omitted, the SQL state machine remains authoritative for
 * status adjacency while this still enforces the progress invariant.
 */
export function validateAssignmentTransitionIntent(intent: AssignmentTransitionIntent): void {
  if (intent.expectedStatus !== undefined) {
    const assumedCurrentProgress = intent.expectedStatus === "Completed" ? 100 : 0;
    resolveAssignmentTransition(
      { status: intent.expectedStatus, progress: assumedCurrentProgress },
      {
        nextStatus: intent.nextStatus,
        ...(intent.progress !== undefined ? { progress: intent.progress } : {}),
      },
      "2000-01-01",
    );
    return;
  }
  if (
    intent.nextStatus !== "Completed" &&
    intent.progress !== undefined &&
    intent.progress >= 100
  ) {
    invalidTransition("unknown", intent.nextStatus, "non_completed_progress_must_be_below_100");
  }
}
