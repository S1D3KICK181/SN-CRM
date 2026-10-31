import { z } from "zod";

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(isCalendarDate, "Expected a valid calendar date");

export const AssignmentStatusSchema = z.enum([
  "New",
  "Awaiting Assignment",
  "Assigned",
  "Awaiting Client Documents",
  "In Progress",
  "Pending Internal Review",
  "Correction Required",
  "Awaiting Client Approval",
  "Ready for Filing / Submission",
  "Filed / Submitted",
  "Completed",
  "On Hold",
  "Cancelled",
]);

export const DashboardGetInputSchema = z
  .object({
    asOfDate: IsoDateSchema.optional(),
    months: z.number().int().min(3).max(24).optional(),
  })
  .strict();

const DashboardHeadlineSchema = z
  .object({
    dueToday: z.number().int().nonnegative(),
    openAssignments: z.number().int().nonnegative(),
    pendingReview: z.number().int().nonnegative(),
    outstandingFees: z.number().nonnegative(),
    overdueFees: z.number().nonnegative(),
  })
  .strict();

const CollectionsSnapshotSchema = z
  .object({
    billedThisMonth: z.number().nonnegative(),
    collectedThisMonth: z.number().nonnegative(),
    outstandingFees: z.number().nonnegative(),
    overdueFees: z.number().nonnegative(),
    dueNext7Days: z.number().nonnegative(),
    unallocatedReceipts: z.number().nonnegative(),
    openInvoiceCount: z.number().int().nonnegative(),
    overdueInvoiceCount: z.number().int().nonnegative(),
  })
  .strict();

const TopClientOutstandingSchema = z
  .object({
    clientId: z.string().min(1),
    clientName: z.string().min(1),
    outstanding: z.number().nonnegative(),
    overdue: z.number().nonnegative(),
    invoiceCount: z.number().int().nonnegative(),
  })
  .strict();

const BillingCollectionPointSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    label: z.string().min(1),
    billed: z.number().nonnegative(),
    collected: z.number().nonnegative(),
  })
  .strict();

export const AssignmentDueStateSchema = z.enum([
  "overdue",
  "due_today",
  "due_soon",
  "scheduled",
  "no_due",
]);

const OpenAssignmentSchema = z
  .object({
    id: z.string().min(1),
    assignmentCode: z.string().min(1),
    title: z.string().min(1),
    clientId: z.string().min(1),
    clientName: z.string().min(1),
    serviceName: z.string().nullable(),
    ownerName: z.string().nullable(),
    status: z.string().min(1),
    priority: z.string().min(1),
    progress: z.number().min(0).max(100),
    version: z.number().int().positive(),
    dueDate: IsoDateSchema.nullable(),
    dueState: AssignmentDueStateSchema,
    blocker: z.string().nullable(),
  })
  .strict();

export const DashboardDtoSchema = z
  .object({
    asOfDate: IsoDateSchema,
    timezone: z.literal("Asia/Kolkata"),
    currency: z.literal("INR"),
    headline: DashboardHeadlineSchema,
    collectionsSnapshot: CollectionsSnapshotSchema,
    topClientOutstanding: z.array(TopClientOutstandingSchema),
    billingAndCollections: z.array(BillingCollectionPointSchema),
    openAssignments: z.array(OpenAssignmentSchema),
  })
  .strict();

export const DashboardGetQuerySchema = z
  .object({
    type: z.literal("dashboard.get"),
    input: DashboardGetInputSchema.optional(),
  })
  .strict();

export const PracticeQueryEnvelopeSchema = z.discriminatedUnion("type", [DashboardGetQuerySchema]);

export const AssignmentTransitionOperationSchema = z
  .object({
    type: z.literal("assignment.transition"),
    input: z
      .object({
        assignmentId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
        expectedStatus: AssignmentStatusSchema.optional(),
        nextStatus: AssignmentStatusSchema,
        progress: z.number().int().min(0).max(100).optional(),
        reason: z.string().trim().min(1).max(500).optional(),
      })
      .strict(),
  })
  .strict();

export const PracticeOperationEnvelopeSchema = z.discriminatedUnion("type", [
  AssignmentTransitionOperationSchema,
]);

export const OperationReceiptSchema = z
  .object({
    operationId: z.string().uuid(),
    type: z.string().min(1),
    state: z.enum(["completed", "pending_approval", "accepted", "failed"]),
    replayed: z.boolean(),
    result: z.unknown().optional(),
    failure: z
      .object({ code: z.string().min(1), message: z.string().min(1) })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export const PracticeErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        requestId: z.string().min(1),
        details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();

export const DashboardGetResponseSchema = z
  .object({
    data: DashboardDtoSchema,
    meta: z.object({ requestId: z.string().min(1) }).strict(),
  })
  .strict();

export type DashboardGetInput = z.infer<typeof DashboardGetInputSchema>;
export type DashboardDto = z.infer<typeof DashboardDtoSchema>;
export type AssignmentDueState = z.infer<typeof AssignmentDueStateSchema>;
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;
export type PracticeQueryEnvelope = z.infer<typeof PracticeQueryEnvelopeSchema>;
export type PracticeOperationEnvelope = z.infer<typeof PracticeOperationEnvelopeSchema>;
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;
export type PracticeErrorBody = z.infer<typeof PracticeErrorSchema>;
export type DashboardGetResponse = z.infer<typeof DashboardGetResponseSchema>;

export type PracticeQueryResult<T extends PracticeQueryEnvelope> = T["type"] extends "dashboard.get"
  ? DashboardDto
  : never;
