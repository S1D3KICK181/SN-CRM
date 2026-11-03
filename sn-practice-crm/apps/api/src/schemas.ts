import { z } from 'zod';
import { ApiError } from './errors';

const id = z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const title = z.string().trim().min(2).max(160);
const notes = z.string().trim().max(2000).optional();
export const isoInstantSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) && !Number.isNaN(parsed);
    },
    { message: 'Work item timestamps must be valid ISO date-time strings.' },
  );
const instant = isoInstantSchema;
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function parseIsoInstant(value: unknown): number {
  const result = isoInstantSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(422, 'invalid_timestamp', 'Work item timestamps must be valid ISO date-time strings.');
  }
  const time = Date.parse(result.data);
  if (!Number.isFinite(time) || Number.isNaN(time)) {
    throw new ApiError(422, 'invalid_timestamp', 'Work item timestamps must be valid ISO date-time strings.');
  }
  return time;
}

export const createAssignmentSchema = z
  .object({
    clientId: id,
    clientName: z.string().trim().min(2).max(160),
    title,
    service: z.string().trim().min(2).max(120),
    ownerId: id,
    reviewerIds: z.array(id).max(5).optional(),
    dueAt: instant,
  })
  .strict();

export const assignmentTransitionSchema = z
  .object({ action: z.enum(['start', 'submit', 'complete', 'reopen']) })
  .strict();

export const createRecurringScheduleSchema = z
  .object({
    clientId: id,
    clientName: z.string().trim().min(2).max(160),
    title,
    service: z.string().trim().min(2).max(120),
    cadence: z.enum(['monthly', 'quarterly', 'annual']),
    ownerId: id,
    reviewerIds: z.array(id).max(5).optional(),
    nextOccurrenceOn: localDate,
    dueDay: z.number().int().min(1).max(31),
  })
  .strict();

export const updateRecurringScheduleSchema = z
  .object({
    active: z.boolean().optional(),
    nextOccurrenceOn: localDate.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

const workItemBase = {
  title,
  notes,
  dueAt: instant,
  reminderAt: instant.nullable().optional(),
};

export const createWorkItemSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('delegated'),
      ...workItemBase,
      assignmentId: id,
      assigneeId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('internal'),
      ...workItemBase,
      assigneeId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('personal'),
      ...workItemBase,
      relatedClientId: id.optional(),
      relatedPartyName: z.string().trim().min(2).max(160).optional(),
    })
    .strict(),
]);

export const workItemTransitionSchema = z
  .object({ action: z.enum(['start', 'submit', 'complete', 'reopen']) })
  .strict();

export const reportingLineSchema = z.object({ managerId: id.nullable() }).strict();

export const createLedgerEntrySchema = z
  .object({
    occurredOn: localDate,
    account: z.enum(['cash', 'bank']),
    direction: z.enum(['inflow', 'outflow']),
    amountPaise: z.number().int().positive().max(1_000_000_000_000),
    narration: z.string().trim().min(2).max(240),
    reference: z.string().trim().max(100).optional(),
  })
  .strict();
