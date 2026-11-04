import { z } from 'zod';
import { ASSIGNMENT_TRANSITIONS, WORK_ITEM_TRANSITIONS } from '@sn/contracts';
import { ApiError } from './errors';

export const entityUuid = z.string().uuid();
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

export const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const createAssignmentSchema = z
  .object({
    clientId: entityUuid,
    title,
    serviceId: entityUuid.optional(),
    service: z.string().trim().min(2).max(120).optional(),
    ownerId: entityUuid,
    reviewerIds: z.array(entityUuid).max(5).optional(),
    dueAt: isoInstantSchema,
  })
  .strict()
  .refine(
    (data) => Boolean(data.serviceId) !== Boolean(data.service),
    {
      message: 'Must provide either serviceId or service name, never neither or both.',
      path: ['serviceId'],
    },
  );

export const assignmentTransitionSchema = z
  .object({
    action: z.enum(ASSIGNMENT_TRANSITIONS),
    expectedUpdatedAt: isoInstantSchema.optional(),
    deliveryNotes: z.string().trim().max(2000).optional(),
    reviewNotes: z.string().trim().max(2000).optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const createWorkItemSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('delegated'),
      title,
      notes,
      assignmentId: entityUuid,
      assigneeId: entityUuid,
      dueAt: isoInstantSchema,
      reminderAt: isoInstantSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('internal'),
      title,
      notes,
      assigneeId: entityUuid,
      dueAt: isoInstantSchema,
      reminderAt: isoInstantSchema.nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('personal'),
      title,
      notes,
      relatedClientId: entityUuid.optional(),
      relatedPartyName: z.string().trim().min(2).max(160).optional(),
      dueAt: isoInstantSchema,
      reminderAt: isoInstantSchema.nullable().optional(),
    })
    .strict(),
]);

export const workItemTransitionSchema = z
  .object({
    action: z.enum(WORK_ITEM_TRANSITIONS),
    expectedUpdatedAt: isoInstantSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
    completionNote: z.string().trim().max(2000).optional(),
    progressPercent: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const createRecurringScheduleSchema = z
  .object({
    clientId: entityUuid,
    serviceId: entityUuid.optional(),
    service: z.string().trim().min(2).max(120).optional(),
    title,
    cadence: z.enum(['monthly', 'quarterly', 'annual']),
    ownerId: entityUuid,
    reviewerIds: z.array(entityUuid).max(5).optional(),
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

export const reportingLineSchema = z
  .object({
    managerId: entityUuid.nullable(),
  })
  .strict();

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
