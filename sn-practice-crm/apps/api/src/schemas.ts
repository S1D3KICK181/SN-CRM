import { z } from 'zod';
import {
  ASSIGNMENT_TRANSITIONS,
  CLIENT_ENTITY_TYPES,
  CLIENT_STATUSES,
  DOCUMENT_CATEGORIES,
  ENGAGEMENT_END_OUTCOMES,
  ENGAGEMENT_FEE_MODELS,
  INDIAN_STATES,
  MESSAGE_PURPOSES,
  PAYMENT_METHODS,
  REPORT_PERIOD_KINDS,
  WORK_ITEM_TRANSITIONS,
} from '@sn/contracts';
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

// --- Vyapar bills and payments (FEE-01a) ---

const MAX_FEE_AMOUNT_PAISE = 99_999_999_999_900;
const feeAmountPaise = z.number().int().min(1).max(MAX_FEE_AMOUNT_PAISE);

export const recordVyaparBillSchema = z
  .object({
    clientId: entityUuid,
    vyaparBillNumber: z.string().trim().min(1).max(30),
    billDate: localDate,
    dueDate: localDate,
    amountPaise: feeAmountPaise,
    description: z.string().trim().min(2).max(300),
    applyCredit: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.dueDate >= value.billDate, {
    message: 'dueDate cannot precede billDate',
    path: ['dueDate'],
  });

export const recordPaymentSchema = z
  .object({
    invoiceId: entityUuid,
    receivedOn: localDate,
    amountPaise: feeAmountPaise,
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const voidFeeRecordSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

// --- Client documents (DOC-01a) ---
// File size and type are checked by the application so they return their own error codes.

export const createDocumentSchema = z
  .object({
    clientId: entityUuid,
    title,
    category: z.enum(DOCUMENT_CATEGORIES),
    financialYearStart: z.number().int().min(2000).max(2100).nullable().optional(),
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes('/') && !value.includes('\\'), {
        message: 'The file name cannot contain a slash or backslash.',
      }),
    mimeType: z.string().trim().min(1).max(200),
    sizeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const confirmDocumentSchema = z.object({}).strict();

export const removeDocumentSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

// --- Client messages (MSG-01) ---

export const WHATSAPP_NUMBER_MESSAGE = 'Enter a WhatsApp number with 10 digits, or with the country code.';

/**
 * Keeps the digits of a number. A 10-digit Indian mobile number (starting 6 to 9) gets the 91 prefix;
 * anything else must already be 11 to 15 digits including the country code. Returns null otherwise.
 */
export function normalizeWhatsAppNumber(value: string): string | null {
  // A trunk prefix is not part of the number: 098200 12345 and 0091 98200 12345 both mean +91 98200 12345.
  const digits = value.replace(/\D/g, '').replace(/^00(?=91[6-9]\d{9}$)/, '').replace(/^0(?=[6-9]\d{9}$)/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  return /^\d{11,15}$/.test(digits) ? digits : null;
}

export const recordClientMessageSchema = z
  .object({
    clientId: entityUuid,
    contactId: entityUuid.nullable().optional(),
    recipientName: z.string().trim().min(1).max(120),
    recipientNumber: z.string().trim().min(1, WHATSAPP_NUMBER_MESSAGE).max(40, WHATSAPP_NUMBER_MESSAGE),
    purpose: z.enum(MESSAGE_PURPOSES),
    assignmentId: entityUuid.nullable().optional(),
    invoiceId: entityUuid.nullable().optional(),
    body: z
      .string()
      .max(2000, 'The message must be between 1 and 2000 characters.')
      .refine((value) => value.trim().length > 0, { message: 'The message must be between 1 and 2000 characters.' }),
  })
  .strict();

// --- Client credit (FEE-02a) ---

// --- Reports (REP-01) ---

export const reportQuerySchema = z
  .object({
    period: z.enum(REPORT_PERIOD_KINDS, { errorMap: () => ({ message: 'period must be day, week or month.' }) }),
    date: localDate.optional(),
  })
  .strict();

export const applyCreditSchema =z.object({}).strict();
export const removeCreditSchema = z.object({}).strict();

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function sanitizeNullableString(val: unknown): unknown {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return val;
}

const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const LLPIN_REGEX = /^[A-Z]{3}-[0-9]{4}$/;
const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
const IEC_REGEX = /^[A-Z0-9]{10}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const CONTACT_PHONE_REGEX = /^[0-9 +-]+$/;

function sanitizeKeepUndefinedUpper(val: unknown): unknown {
  const cleaned = sanitizeNullableString(val);
  return typeof cleaned === 'string' ? cleaned.toUpperCase() : cleaned;
}

function optionalText(max: number, message: string) {
  return z.preprocess(sanitizeNullableString, z.string().max(max, message).nullable().optional());
}

function optionalIdentifier(pattern: RegExp, message: string) {
  return z.preprocess(
    sanitizeKeepUndefinedUpper,
    z.string({ invalid_type_error: message }).regex(pattern, message).nullable().optional(),
  );
}

const PAN_MESSAGE = 'Enter a valid 10-character PAN, like ABCDE1234F.';
const GSTIN_MESSAGE = 'Enter a valid 15-character GSTIN.';
const GSTIN_PAN_MISMATCH_MESSAGE = 'The GSTIN does not match the PAN.';

// Fields shared by creating and editing a client. Every field keeps undefined as undefined, so an
// edit can tell "leave it alone" (omitted) from "clear it" (null).
const clientDetailFields = {
  legalName: optionalText(200, 'Legal name must not exceed 200 characters.'),
  pan: optionalIdentifier(PAN_REGEX, PAN_MESSAGE),
  gstin: optionalIdentifier(GSTIN_REGEX, GSTIN_MESSAGE),
  email: z.preprocess(
    sanitizeNullableString,
    z.string().email('Invalid email address format.').nullable().optional(),
  ),
  phone: z.preprocess(
    sanitizeNullableString,
    z
      .string()
      .min(7, 'Phone number must be at least 7 characters.')
      .max(20, 'Phone number must not exceed 20 characters.')
      .nullable()
      .optional(),
  ),
  notes: optionalText(2000, 'Notes must not exceed 2000 characters.'),
  entityType: z.preprocess(
    sanitizeNullableString,
    z.enum(CLIENT_ENTITY_TYPES, { errorMap: () => ({ message: 'Choose a valid entity type.' }) }).nullable().optional(),
  ),
  addressLine1: optionalText(200, 'Address line 1 must not exceed 200 characters.'),
  addressLine2: optionalText(200, 'Address line 2 must not exceed 200 characters.'),
  city: optionalText(100, 'City must not exceed 100 characters.'),
  state: z.preprocess(
    sanitizeNullableString,
    z
      .enum(INDIAN_STATES, { errorMap: () => ({ message: 'Choose a state or union territory from the list.' }) })
      .nullable()
      .optional(),
  ),
  pincode: z.preprocess(
    sanitizeNullableString,
    z
      .string({ invalid_type_error: 'Enter a valid 6-digit PIN code.' })
      .regex(PINCODE_REGEX, 'Enter a valid 6-digit PIN code.')
      .nullable()
      .optional(),
  ),
  tan: optionalIdentifier(TAN_REGEX, 'Enter a valid TAN, like ABCD12345E.'),
  cinLlpin: z.preprocess(
    sanitizeKeepUndefinedUpper,
    z
      .string({ invalid_type_error: 'Enter a valid CIN or LLPIN.' })
      .refine((value) => CIN_REGEX.test(value) || LLPIN_REGEX.test(value), 'Enter a valid CIN or LLPIN.')
      .nullable()
      .optional(),
  ),
  udyamNumber: optionalIdentifier(UDYAM_REGEX, 'Enter a valid Udyam number, like UDYAM-MH-01-0000001.'),
  iec: optionalIdentifier(IEC_REGEX, 'Enter a valid 10-character IEC.'),
  incorporationDate: z.preprocess(sanitizeNullableString, localDate.nullable().optional()),
};

const clientDisplayName = z
  .string({ required_error: 'Display name is required.' })
  .trim()
  .min(2, 'Display name must be between 2 and 180 characters.')
  .max(180, 'Display name must be between 2 and 180 characters.');

const gstinMatchesPan = (data: { pan?: string | null | undefined; gstin?: string | null | undefined }): boolean =>
  !data.pan || !data.gstin || data.gstin.slice(2, 12) === data.pan;

export const createClientSchema = z
  .object({
    displayName: clientDisplayName,
    ...clientDetailFields,
    relationshipOwnerId: z.preprocess(sanitizeNullableString, entityUuid.nullable().optional()),
  })
  .strict()
  .refine(gstinMatchesPan, { message: GSTIN_PAN_MISMATCH_MESSAGE, path: ['gstin'] });

export const updateClientSchema = z
  .object({
    displayName: clientDisplayName.optional(),
    ...clientDetailFields,
    relationshipOwnerId: z.preprocess(sanitizeNullableString, entityUuid.nullable().optional()),
    status: z.enum(CLIENT_STATUSES).optional(),
    expectedUpdatedAt: isoInstantSchema,
  })
  .strict()
  .refine(gstinMatchesPan, { message: GSTIN_PAN_MISMATCH_MESSAGE, path: ['gstin'] });

const contactReachable = (data: {
  email?: string | null | undefined;
  phone?: string | null | undefined;
  whatsapp?: string | null | undefined;
}): boolean => Boolean(data.email || data.phone || data.whatsapp);

export const CONTACT_UNREACHABLE_MESSAGE = 'Add at least one way to reach this contact.';

const contactPhone = (label: string) =>
  z.preprocess(
    sanitizeNullableString,
    z
      .string()
      .max(20, `${label} must not exceed 20 characters.`)
      .regex(CONTACT_PHONE_REGEX, `${label} may contain only digits, spaces, + and -.`)
      .nullable()
      .optional(),
  );

const clientContactFields = {
  designation: optionalText(80, 'Designation must not exceed 80 characters.'),
  email: z.preprocess(
    sanitizeNullableString,
    z
      .string()
      .max(254, 'Email must not exceed 254 characters.')
      .email('Invalid email address format.')
      .nullable()
      .optional(),
  ),
  phone: contactPhone('Phone number'),
  whatsapp: contactPhone('WhatsApp number'),
  isPrimary: z.boolean().optional(),
  notes: optionalText(300, 'Notes must not exceed 300 characters.'),
};

const contactName = z
  .string({ required_error: 'Contact name is required.' })
  .trim()
  .min(2, 'Contact name must be between 2 and 120 characters.')
  .max(120, 'Contact name must be between 2 and 120 characters.');

export const createClientContactSchema = z
  .object({ name: contactName, ...clientContactFields })
  .strict()
  .refine(contactReachable, { message: CONTACT_UNREACHABLE_MESSAGE, path: ['email'] });

export const updateClientContactSchema = z
  .object({ name: contactName.optional(), ...clientContactFields, expectedUpdatedAt: isoInstantSchema })
  .strict();

/** Runs a request through a schema for callers that do not come through HTTP; the first problem is the message. */
export function validateInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(
      422,
      'validation_failed',
      parsed.error.issues[0]?.message ?? 'The request did not pass validation.',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}

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
    engagementId: entityUuid.nullable().optional(),
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

// --- Service list management (SVC-01) ---

const serviceName = z.string().trim().min(2).max(120);
const serviceDescription = z.string().trim().max(500).nullable();
const serviceTurnaroundDays = z.number().int().min(0).max(365).nullable();

export const createServiceSchema = z
  .object({
    name: serviceName,
    description: serviceDescription.optional(),
    turnaroundDays: serviceTurnaroundDays.optional(),
    isStatutory: z.boolean().optional(),
    departmentId: entityUuid.nullable().optional(),
  })
  .strict();

export const updateServiceSchema = z
  .object({
    name: serviceName.optional(),
    description: serviceDescription.optional(),
    turnaroundDays: serviceTurnaroundDays.optional(),
    isStatutory: z.boolean().optional(),
    isActive: z.boolean().optional(),
    departmentId: entityUuid.nullable().optional(),
    expectedUpdatedAt: isoInstantSchema,
  })
  .strict();

// --- Departments (DEPT-01) ---

const departmentName = z.string().trim().min(2).max(80);

export const createDepartmentSchema = z.object({ name: departmentName }).strict();

export const updateDepartmentSchema = z
  .object({
    name: departmentName.optional(),
    isActive: z.boolean().optional(),
    expectedUpdatedAt: isoInstantSchema,
  })
  .strict();

export const setDepartmentMembersSchema = z
  .object({
    members: z
      .array(z.object({ userId: entityUuid, isHead: z.boolean() }).strict())
      .max(200)
      .refine((members) => new Set(members.map((member) => member.userId)).size === members.length, {
        message: 'A person can be listed only once.',
      }),
  })
  .strict();
