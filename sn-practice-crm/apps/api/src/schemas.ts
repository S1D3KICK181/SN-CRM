import { z } from 'zod';
import { ASSIGNMENT_TRANSITIONS, ENGAGEMENT_END_OUTCOMES, ENGAGEMENT_FEE_MODELS, WORK_ITEM_TRANSITIONS } from '@sn/contracts';
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
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .refine(
    (value) => {
      const parts = value.split('-');
      const y = Number.parseInt(parts[0] ?? '0', 10);
      const m = Number.parseInt(parts[1] ?? '0', 10);
      const d = Number.parseInt(parts[2] ?? '0', 10);
      if (m < 1 || m > 12 || d < 1 || d > 31) return false;
      const date = new Date(Date.UTC(y, m - 1, d));
      return (
        date.getUTCFullYear() === y &&
        date.getUTCMonth() === m - 1 &&
        date.getUTCDate() === d
      );
    },
    { message: 'Must be a valid calendar date in YYYY-MM-DD format.' },
  );

const engagementTerms = {
  title: z.string().trim().min(2).max(180),
  scope: z.string().trim().min(2),
  exclusions: z.string().trim().nullable().optional(),
  responsiblePartnerId: entityUuid,
  deliveryManagerId: entityUuid,
  feeModel: z.enum(ENGAGEMENT_FEE_MODELS),
  agreedFeePaise: z.number().int().nonnegative().safe(),
  billingTerms: z.string().trim().min(2),
  startDate: localDate,
  endDate: localDate.nullable().optional(),
};

const withDateOrder = <T extends z.ZodTypeAny>(schema: T) => schema.refine(
  (value) => value.endDate == null || value.endDate >= value.startDate,
  { message: 'endDate cannot precede startDate', path: ['endDate'] },
);

export const createEngagementDraftSchema = withDateOrder(
  z.object({ clientId: entityUuid, serviceId: entityUuid, ...engagementTerms }).strict(),
);
export const reviseEngagementDraftSchema = withDateOrder(
  z.object({ ...engagementTerms, expectedUpdatedAt: isoInstantSchema }).strict(),
);
export const amendEngagementSchema = withDateOrder(
  z.object({ ...engagementTerms, expectedUpdatedAt: isoInstantSchema }).strict(),
);
export const activateEngagementSchema = z
  .object({ versionId: entityUuid, expectedUpdatedAt: isoInstantSchema })
  .strict();
export const endEngagementSchema = z
  .object({
    outcome: z.enum(ENGAGEMENT_END_OUTCOMES),
    reason: z.string().trim().min(2).max(500),
    expectedUpdatedAt: isoInstantSchema,
  })
  .strict();

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function sanitizeOptionalString(val: unknown): unknown {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return val;
}

function sanitizeNullableString(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return val;
}

function sanitizeOptionalTaxId(val: unknown): unknown {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed.toUpperCase();
  }
  return val;
}

export const createClientSchema = z
  .object({
    displayName: z
      .string({ required_error: 'Display name is required.' })
      .trim()
      .min(2, 'Display name must be between 2 and 180 characters.')
      .max(180, 'Display name must be between 2 and 180 characters.'),
    legalName: z.preprocess(
      sanitizeOptionalString,
      z.string().max(200, 'Legal name must not exceed 200 characters.').nullable().optional(),
    ),
    pan: z.preprocess(
      sanitizeOptionalTaxId,
      z
        .string({ invalid_type_error: 'PAN must be a string.' })
        .regex(PAN_REGEX, 'Invalid Indian PAN format. Expected 5 letters, 4 digits, 1 letter.')
        .nullable()
        .optional(),
    ),
    gstin: z.preprocess(
      sanitizeOptionalTaxId,
      z
        .string({ invalid_type_error: 'GSTIN must be a string.' })
        .regex(
          GSTIN_REGEX,
          'Invalid Indian GSTIN format. Expected 15 characters (2 state digits, 10-character PAN, 1 entity character, Z, 1 checksum digit).',
        )
        .nullable()
        .optional(),
    ),
    email: z.preprocess(
      sanitizeOptionalString,
      z.string().email('Invalid email address format.').nullable().optional(),
    ),
    phone: z.preprocess(
      sanitizeOptionalString,
      z.string().min(7, 'Phone number must be at least 7 characters.').max(20, 'Phone number must not exceed 20 characters.').nullable().optional(),
    ),
    relationshipOwnerId: z.preprocess(
      sanitizeOptionalString,
      entityUuid.nullable().optional(),
    ),
    notes: z.preprocess(
      sanitizeOptionalString,
      z.string().max(2000, 'Notes must not exceed 2000 characters.').nullable().optional(),
    ),
  })
  .strict()
  .refine(
    (data) => {
      if (data.pan && data.gstin) {
        const embeddedPan = data.gstin.slice(2, 12);
        return embeddedPan === data.pan;
      }
      return true;
    },
    {
      message: 'GSTIN characters 3–12 must match the provided PAN.',
      path: ['gstin'],
    },
  );

export const createAssignmentSchema = z
  .object({
    clientId: entityUuid,
    title,
    description: z.preprocess(
      sanitizeNullableString,
      z.string().max(4000, 'Description must not exceed 4000 characters.').nullable().optional(),
    ),
    serviceId: entityUuid.optional(),
    service: z.string().trim().min(2).max(120).optional(),
    ownerId: entityUuid,
    reviewerIds: z.array(entityUuid).max(5).optional(),
    dueAt: isoInstantSchema,
    engagementId: entityUuid.nullable().optional(),
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
    expectedUpdatedAt: isoInstantSchema,
    deliveryNotes: z.preprocess(
      sanitizeNullableString,
      z.string().max(2000, 'Delivery notes must not exceed 2000 characters.').nullable().optional(),
    ),
    reviewNotes: z.preprocess(
      sanitizeNullableString,
      z.string().max(2000, 'Review notes must not exceed 2000 characters.').nullable().optional(),
    ),
    progressPercent: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const updateAssignmentSchema = z
  .object({
    title: title.optional(),
    description: z.preprocess(
      sanitizeNullableString,
      z.string().max(4000, 'Description must not exceed 4000 characters.').nullable().optional(),
    ),
    serviceId: entityUuid.optional(),
    ownerId: entityUuid.optional(),
    reviewerIds: z.array(entityUuid).max(5).optional(),
    dueAt: isoInstantSchema.optional(),
    deliveryNotes: z.preprocess(
      sanitizeNullableString,
      z.string().max(2000, 'Delivery notes must not exceed 2000 characters.').nullable().optional(),
    ),
    reviewNotes: z.preprocess(
      sanitizeNullableString,
      z.string().max(2000, 'Review notes must not exceed 2000 characters.').nullable().optional(),
    ),
    progressPercent: z.number().int().min(0).max(100).optional(),
    expectedUpdatedAt: isoInstantSchema,
  })
  .strict()
  .refine((data) => Object.keys(data).some((k) => k !== 'expectedUpdatedAt'), {
    message: 'At least one field to update is required besides expectedUpdatedAt.',
  });

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

export const generateDueAssignmentsSchema = z
  .object({
    throughDate: localDate.optional(),
  })
  .strict();

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
