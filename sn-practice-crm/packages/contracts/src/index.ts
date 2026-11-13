import type { CompanyRole } from '@sn/domain';

// --- Session & Identity ---

export interface SessionActor {
  readonly id: string; // RFC 4122 UUID
  readonly name: string;
  readonly role: CompanyRole;
  readonly reportsToId: string | null; // RFC 4122 UUID of supervisor
}

export interface ApiEnvelope<T> {
  readonly data: T;
  readonly requestId: string;
}

export interface ApiProblem {
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
}

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
  readonly requestId: string;
}

// --- Assignment Domain ---

export const ASSIGNMENT_STATUSES = [
  'draft',
  'assigned',
  'in_progress',
  'ready_for_review',
  'changes_requested',
  'approved',
  'closed',
  'cancelled',
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_TRANSITIONS = [
  'start',
  'submit',
  'complete',
  'request_changes',
  'reopen',
] as const;
export type AssignmentTransition = (typeof ASSIGNMENT_TRANSITIONS)[number];

export interface AssignmentDto {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // Output-only: AS-xxxxxx
  readonly clientId: string; // RFC 4122 UUID references public.clients(id)
  readonly clientName: string; // Denormalized display name
  readonly serviceId: string; // RFC 4122 UUID references public.service_catalog(id)
  readonly service: string; // Denormalized display name
  readonly title: string;
  readonly description: string | null;
  readonly ownerId: string; // RFC 4122 UUID references public.profiles(user_id)
  readonly ownerName: string; // Denormalized display name
  readonly reviewerIds: readonly string[]; // RFC 4122 UUIDs references assignment_reviewers
  readonly reviewerNames: readonly string[]; // Denormalized display names
  readonly status: AssignmentStatus;
  readonly dueAt: string; // ISO-8601 UTC
  readonly recurringScheduleId: string | null;
  readonly engagementId: string | null; // RFC 4122 UUID references public.engagements(id); set at creation only
  readonly engagementCode: string | null; // Output-only: ENG-xxxxxx, filled by the database from the engagement
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly progressPercent: number; // DB-backed field: 0..100
  readonly deliveryNotes: string | null; // DB-backed field
  readonly reviewNotes: string | null; // DB-backed field
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
  readonly startedAt?: string | null;
  readonly submittedAt?: string | null;
  readonly approvedAt?: string | null;
  readonly approvedById?: string | null;
  readonly closedAt?: string | null;
  readonly closedById?: string | null;
}

export type ServiceReferenceInput =
  | { readonly serviceId: string; readonly service?: never }
  | { readonly service: string; readonly serviceId?: never };

export type CreateAssignmentInput = {
  readonly clientId: string; // RFC 4122 UUID only (clientName completely purged)
  readonly title: string;
  readonly description?: string | null;
  readonly ownerId: string; // RFC 4122 UUID
  readonly reviewerIds?: readonly string[]; // RFC 4122 UUIDs
  readonly dueAt: string; // ISO-8601 UTC
  readonly recurringScheduleId?: string | null;
  readonly engagementId?: string | null; // RFC 4122 UUID of an active engagement for the same client
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
} & ServiceReferenceInput;

export interface UpdateAssignmentInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly serviceId?: string;
  readonly ownerId?: string;
  readonly reviewerIds?: readonly string[];
  readonly dueAt?: string; // ISO-8601 UTC
  readonly deliveryNotes?: string | null;
  readonly reviewNotes?: string | null;
  readonly progressPercent?: number;
  readonly expectedUpdatedAt: string; // Required optimistic concurrency token
}

export interface AssignmentTransitionInput {
  readonly action: AssignmentTransition;
  readonly expectedUpdatedAt: string; // Required optimistic concurrency token
  readonly deliveryNotes?: string | null;
  readonly reviewNotes?: string | null;
  readonly progressPercent?: number;
}

// --- Work Item Domain ---

export type WorkItemKind = 'delegated' | 'internal' | 'personal';

export const WORK_ITEM_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'ready_for_review',
  'changes_requested',
  'completed',
  'cancelled',
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_TRANSITIONS = [
  'start',
  'submit',
  'complete',
  'request_changes',
  'reopen',
] as const;
export type WorkItemTransition = (typeof WORK_ITEM_TRANSITIONS)[number];

export interface WorkItemDto {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // Output-only: WI-xxxxxx
  readonly kind: WorkItemKind;
  readonly title: string;
  readonly notes: string | null;
  readonly assignmentId: string | null; // RFC 4122 UUID
  readonly relatedClientId: string | null; // RFC 4122 UUID
  readonly relatedPartyName: string | null;
  readonly assigneeId: string; // RFC 4122 UUID references public.profiles(user_id)
  readonly createdById: string; // RFC 4122 UUID references public.profiles(user_id)
  readonly status: WorkItemStatus;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
  readonly dueAt: string; // ISO-8601 UTC
  readonly reminderAt: string | null; // ISO-8601 UTC
  readonly progressPercent?: number;
  readonly completionNote?: string | null;
  readonly completedAt?: string | null;
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

export type CreateWorkItemInput =
  | {
      readonly kind: 'delegated';
      readonly title: string;
      readonly notes?: string | null;
      readonly assignmentId: string; // RFC 4122 UUID
      readonly assigneeId: string; // RFC 4122 UUID
      readonly dueAt: string;
      readonly reminderAt?: string | null;
      readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
    }
  | {
      readonly kind: 'internal';
      readonly title: string;
      readonly notes?: string | null;
      readonly assigneeId: string; // RFC 4122 UUID
      readonly dueAt: string;
      readonly reminderAt?: string | null;
      readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
    }
  | {
      readonly kind: 'personal';
      readonly title: string;
      readonly notes?: string | null;
      readonly relatedClientId?: string | null; // RFC 4122 UUID
      readonly relatedPartyName?: string | null;
      readonly dueAt: string;
      readonly reminderAt?: string | null;
      readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
    };

// --- Reporting Lines Domain ---

export interface ReportingLineDto {
  readonly employee: SessionActor;
  readonly manager: SessionActor | null;
}

export interface UpdateReportingLineInput {
  readonly managerId: string | null; // RFC 4122 UUID or null to remove
}

// --- Recurring Schedules Domain ---

export interface RecurringScheduleDto {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // RS-xxxxxx
  readonly clientId: string; // RFC 4122 UUID
  readonly clientName: string; // Denormalized display name
  readonly serviceId: string; // RFC 4122 UUID
  readonly service: string;
  readonly title: string;
  readonly cadence: 'monthly' | 'quarterly' | 'annual';
  readonly ownerId: string; // RFC 4122 UUID
  readonly ownerName: string; // Denormalized display name
  readonly reviewerIds: readonly string[]; // RFC 4122 UUIDs
  readonly reviewerNames: readonly string[]; // Denormalized display names
  readonly nextOccurrenceOn: string; // YYYY-MM-DD
  readonly dueDay: number;
  readonly engagementId: string | null; // RFC 4122 UUID references public.engagements(id); set at creation only
  readonly engagementCode: string | null; // Output-only: ENG-xxxxxx, filled by the database from the engagement
  readonly active: boolean;
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

export interface ServiceCatalogItemDto {
  readonly id: string;
  readonly name: string;
}

export interface CreateRecurringScheduleInput {
  readonly clientId: string; // RFC 4122 UUID only (clientName purged)
  readonly serviceId?: string;
  readonly service?: string;
  readonly title: string;
  readonly cadence: 'monthly' | 'quarterly' | 'annual';
  readonly ownerId: string;
  readonly reviewerIds?: readonly string[];
  readonly nextOccurrenceOn: string;
  readonly dueDay: number;
  readonly engagementId?: string | null; // RFC 4122 UUID of an active engagement for the same client
}

export interface UpdateRecurringScheduleInput {
  readonly active?: boolean;
  readonly nextOccurrenceOn?: string;
}

export interface GenerateDueAssignmentsInput {
  readonly throughDate?: string; // ISO date YYYY-MM-DD
}

export interface GenerateDueAssignmentsResult {
  readonly generatedCount: number;
  readonly occurrences: ReadonlyArray<{
    scheduleId: string;
    assignmentId: string;
    occurrenceDate: string;
  }>;
}

// --- Office Accounts & Ledger Domain ---

export type LedgerDirection = 'inflow' | 'outflow';
export type LedgerAccount = 'cash' | 'bank';

export interface LedgerEntryDto {
  readonly id: string; // RFC 4122 UUID
  readonly occurredOn: string; // YYYY-MM-DD
  readonly account: LedgerAccount;
  readonly direction: LedgerDirection;
  readonly amountPaise: number;
  readonly narration: string;
  readonly reference: string | null;
  readonly recordedById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
}

export interface CreateLedgerEntryInput {
  readonly occurredOn: string;
  readonly account: LedgerAccount;
  readonly direction: LedgerDirection;
  readonly amountPaise: number;
  readonly narration: string;
  readonly reference?: string | null;
}

export interface OfficeAccountsSummaryDto {
  readonly currency: 'INR';
  readonly cashBalancePaise: number;
  readonly bankBalancePaise: number;
  readonly totalInflowsPaise: number;
  readonly totalOutflowsPaise: number;
  readonly recentEntries: readonly LedgerEntryDto[];
}

// --- Client Domain ---

export const CLIENT_STATUSES = ['active', 'on_hold', 'archived'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface CreateClientInput {
  readonly displayName: string;
  readonly legalName?: string | null;
  readonly pan?: string | null;
  readonly gstin?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly relationshipOwnerId?: string | null; // RFC 4122 UUID references public.profiles(user_id)
  readonly notes?: string | null;
}

export interface ClientDto {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // Output-only: CL-xxxxxx
  readonly displayName: string;
  readonly legalName: string | null;
  /**
   * Routine-read safe masked GSTIN (e.g. '27**********1Z5'). Raw plaintext GSTIN
   * embeds the complete 10-character PAN; routine reads mask this derivation surface.
   * Statutory raw GSTIN reveal requires a future audited access path.
   */
  readonly gstinMasked: string | null;
  /**
   * Routine-read safe masked PAN (e.g. '******1234'). Raw plaintext PAN must
   * never appear in this DTO; sensitive unmasked reveal requires dedicated audit.
   */
  readonly panMasked: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly relationshipOwnerId: string | null; // RFC 4122 UUID references public.profiles(user_id)
  readonly relationshipOwnerName: string | null; // Read-model join; null when no owner
  readonly status: ClientStatus;
  readonly notes: string | null;
  readonly activeAssignmentsCount: number; // Server-derived read-model value
  readonly createdById: string; // RFC 4122 UUID references public.profiles(user_id)
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

// --- Engagement Domain (ENG-01) ---

export const ENGAGEMENT_STATUSES = ['draft', 'active', 'ended'] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_FEE_MODELS = ['fixed', 'recurring', 'milestone', 'time_based'] as const;
export type EngagementFeeModel = (typeof ENGAGEMENT_FEE_MODELS)[number];

export const ENGAGEMENT_END_OUTCOMES = ['completed', 'terminated'] as const;
export type EngagementEndOutcome = (typeof ENGAGEMENT_END_OUTCOMES)[number];

export interface EngagementVersionDto {
  readonly id: string; // RFC 4122 UUID
  readonly engagementId: string; // RFC 4122 UUID
  readonly versionNumber: number; // Positive integer >= 1
  readonly title: string;
  readonly scope: string;
  readonly exclusions: string | null;
  readonly responsiblePartnerId: string; // RFC 4122 UUID references Founder
  readonly responsiblePartnerName?: string; // Denormalized display name
  readonly deliveryManagerId: string; // RFC 4122 UUID references Manager / Founder
  readonly deliveryManagerName?: string; // Denormalized display name
  readonly feeModel: EngagementFeeModel;
  readonly agreedFeePaise: number; // Integer paise >= 0
  readonly billingTerms: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string | null; // YYYY-MM-DD
  readonly approvedAt: string | null; // ISO-8601 UTC
  readonly approvedById: string | null; // RFC 4122 UUID
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
}

export interface EngagementDto {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // Output-only: ENG-xxxxxx
  readonly clientId: string; // RFC 4122 UUID
  readonly clientName?: string; // Denormalized display name
  readonly serviceId: string; // RFC 4122 UUID (required)
  readonly serviceName?: string | null; // Denormalized display name
  readonly status: EngagementStatus;
  readonly approvedVersionId: string | null; // RFC 4122 UUID
  readonly approvedVersion?: EngagementVersionDto | null;
  readonly approvedAt: string | null; // ISO-8601 UTC
  readonly approvedById: string | null; // RFC 4122 UUID
  readonly endedAt: string | null; // ISO-8601 UTC
  readonly endedById: string | null; // RFC 4122 UUID
  readonly endOutcome: EngagementEndOutcome | null;
  readonly endReason: string | null;
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
}

export interface CreateEngagementDraftInput {
  readonly clientId: string; // RFC 4122 UUID
  readonly serviceId: string; // RFC 4122 UUID (required)
  readonly title: string;
  readonly scope: string;
  readonly exclusions?: string | null;
  readonly responsiblePartnerId: string; // RFC 4122 UUID (must resolve to active Founder)
  readonly deliveryManagerId: string; // RFC 4122 UUID (must resolve to active management user)
  readonly feeModel: EngagementFeeModel;
  readonly agreedFeePaise: number; // Integer paise >= 0
  readonly billingTerms: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate?: string | null; // YYYY-MM-DD
}

export interface ReviseEngagementDraftInput {
  readonly engagementId: string; // RFC 4122 UUID
  readonly title: string;
  readonly scope: string;
  readonly exclusions?: string | null;
  readonly responsiblePartnerId: string; // RFC 4122 UUID
  readonly deliveryManagerId: string; // RFC 4122 UUID
  readonly feeModel: EngagementFeeModel;
  readonly agreedFeePaise: number; // Integer paise >= 0
  readonly billingTerms: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate?: string | null; // YYYY-MM-DD
  readonly expectedUpdatedAt: string; // Required optimistic concurrency token
}

export interface ActivateEngagementInput {
  readonly engagementId: string; // RFC 4122 UUID
  readonly versionId: string; // RFC 4122 UUID
  readonly expectedUpdatedAt: string; // Required optimistic concurrency token
}

export interface AmendActiveEngagementInput {
  readonly engagementId: string; // RFC 4122 UUID
  readonly title: string;
  readonly scope: string;
  readonly exclusions?: string | null;
  readonly responsiblePartnerId: string; // RFC 4122 UUID
  readonly deliveryManagerId: string; // RFC 4122 UUID
  readonly feeModel: EngagementFeeModel;
  readonly agreedFeePaise: number; // Integer paise >= 0
  readonly billingTerms: string;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate?: string | null; // YYYY-MM-DD
  readonly expectedUpdatedAt: string; // Required optimistic concurrency token
}

export interface EndEngagementInput {
  readonly engagementId: string; // RFC 4122 UUID
  readonly outcome: EngagementEndOutcome;
  readonly reason: string; // Required non-empty end reason
  readonly expectedUpdatedAt: string; // Required optimistic concurrency token
}

export const ENGAGEMENT_OPERATIONS = {
  createDraft: 'engagement.createDraft',
  reviseDraft: 'engagement.reviseDraft',
  activate: 'engagement.activate',
  amend: 'engagement.amend',
  end: 'engagement.end',
} as const;
export type EngagementOperation = (typeof ENGAGEMENT_OPERATIONS)[keyof typeof ENGAGEMENT_OPERATIONS];

// --- Internal Helper Predicates & Error Collector ---

function isIsoUtcString(val: string): boolean {
  if (typeof val !== 'string') return false;
  const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
  if (!isoUtcPattern.test(val)) return false;
  const d = new Date(val);
  if (isNaN(d.getTime())) return false;
  // Ensure calendar date validity matches parsed UTC components
  const [datePart, timePart] = val.slice(0, -1).split('T');
  if (!datePart || !timePart) return false;
  const [yStr, mStr, dStr] = datePart.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const day = Number(dStr);
  if (d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== m || d.getUTCDate() !== day) {
    return false;
  }
  return true;
}

function isIsoDateString(val: string): boolean {
  if (typeof val !== 'string') return false;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(val)) return false;
  const [yStr, mStr, dStr] = val.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
}

function isUuid(val: string): boolean {
  if (typeof val !== 'string') return false;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(val);
}

function isIntegerPaise(val: unknown): val is number {
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0;
}

function collectEngagementTermsErrors(obj: Record<string, unknown>, errors: string[]): void {
  if (typeof obj['title'] !== 'string' || obj['title'].trim().length < 2 || obj['title'].trim().length > 180) {
    errors.push('title must be between 2 and 180 characters');
  }
  if (typeof obj['scope'] !== 'string' || obj['scope'].trim().length < 2) {
    errors.push('scope must be at least 2 characters');
  }
  if (obj['exclusions'] !== undefined && obj['exclusions'] !== null && typeof obj['exclusions'] !== 'string') {
    errors.push('exclusions must be a string or null when provided');
  }
  if (!isUuid(String(obj['responsiblePartnerId']))) errors.push('responsiblePartnerId must be a valid UUID');
  if (!isUuid(String(obj['deliveryManagerId']))) errors.push('deliveryManagerId must be a valid UUID');
  if (!ENGAGEMENT_FEE_MODELS.includes(obj['feeModel'] as EngagementFeeModel)) {
    errors.push(`feeModel must be one of: ${ENGAGEMENT_FEE_MODELS.join(', ')}`);
  }
  if (!isIntegerPaise(obj['agreedFeePaise'])) {
    errors.push('agreedFeePaise must be a non-negative safe integer');
  }
  if (typeof obj['billingTerms'] !== 'string' || obj['billingTerms'].trim().length < 2) {
    errors.push('billingTerms must be at least 2 characters');
  }
  if (!isIsoDateString(String(obj['startDate']))) {
    errors.push('startDate must be in YYYY-MM-DD format');
  }
  if (obj['endDate'] !== undefined && obj['endDate'] !== null) {
    if (!isIsoDateString(String(obj['endDate']))) {
      errors.push('endDate must be in YYYY-MM-DD format');
    } else if (String(obj['startDate']) > String(obj['endDate'])) {
      errors.push('endDate cannot precede startDate');
    }
  }
}

// --- Contract Validation Functions ---

export function validateCreateEngagementDraftInput(input: unknown): { success: true; data: CreateEngagementDraftInput } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Input must be a non-null object'] };
  }
  const obj = input as Record<string, unknown>;

  if (!isUuid(String(obj['clientId']))) errors.push('clientId must be a valid UUID');
  if (!isUuid(String(obj['serviceId']))) {
    errors.push('serviceId must be a valid UUID');
  }
  collectEngagementTermsErrors(obj, errors);

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: input as CreateEngagementDraftInput };
}

export function validateReviseEngagementDraftInput(input: unknown): { success: true; data: ReviseEngagementDraftInput } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Input must be a non-null object'] };
  }
  const obj = input as Record<string, unknown>;

  if (!isUuid(String(obj['engagementId']))) errors.push('engagementId must be a valid UUID');
  collectEngagementTermsErrors(obj, errors);
  if (!isIsoUtcString(String(obj['expectedUpdatedAt']))) {
    errors.push('expectedUpdatedAt must be an ISO-8601 UTC timestamp');
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: input as ReviseEngagementDraftInput };
}

export function validateActivateEngagementInput(input: unknown): { success: true; data: ActivateEngagementInput } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Input must be a non-null object'] };
  }
  const obj = input as Record<string, unknown>;

  if (!isUuid(String(obj['engagementId']))) errors.push('engagementId must be a valid UUID');
  if (!isUuid(String(obj['versionId']))) errors.push('versionId must be a valid UUID');
  if (!isIsoUtcString(String(obj['expectedUpdatedAt']))) {
    errors.push('expectedUpdatedAt must be an ISO-8601 UTC timestamp');
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: input as ActivateEngagementInput };
}

export function validateAmendActiveEngagementInput(input: unknown): { success: true; data: AmendActiveEngagementInput } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Input must be a non-null object'] };
  }
  const obj = input as Record<string, unknown>;

  if (!isUuid(String(obj['engagementId']))) errors.push('engagementId must be a valid UUID');
  collectEngagementTermsErrors(obj, errors);
  if (!isIsoUtcString(String(obj['expectedUpdatedAt']))) {
    errors.push('expectedUpdatedAt must be an ISO-8601 UTC timestamp');
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: input as AmendActiveEngagementInput };
}

export function validateEndEngagementInput(input: unknown): { success: true; data: EndEngagementInput } | { success: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['Input must be a non-null object'] };
  }
  const obj = input as Record<string, unknown>;

  if (!isUuid(String(obj['engagementId']))) errors.push('engagementId must be a valid UUID');
  if (!ENGAGEMENT_END_OUTCOMES.includes(obj['outcome'] as EngagementEndOutcome)) {
    errors.push(`outcome must be one of: ${ENGAGEMENT_END_OUTCOMES.join(', ')}`);
  }
  if (typeof obj['reason'] !== 'string' || obj['reason'].trim().length < 2) {
    errors.push('reason is required and must be at least 2 characters');
  } else if (obj['reason'].trim().length > 500) {
    errors.push('reason cannot exceed 500 characters');
  }
  if (!isIsoUtcString(String(obj['expectedUpdatedAt']))) {
    errors.push('expectedUpdatedAt must be an ISO-8601 UTC timestamp');
  }

  if (errors.length > 0) return { success: false, errors };
  return { success: true, data: input as EndEngagementInput };
}

// --- Billing (BIL-01a, read-only) ---

export const INVOICE_STATUSES = ['draft', 'issued', 'part_paid', 'paid', 'voided'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque', 'upi', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentReceiptStatus = 'received' | 'voided';
export type PaymentAllocationSource = 'payment' | 'credit';

export interface InvoiceItemDto {
  readonly id: string;
  readonly description: string;
  readonly quantity: number; // numeric(12,3), e.g. 1 or 1.5
  readonly unitPricePaise: number;
  readonly taxRatePercent: number; // numeric(5,2), e.g. 18
  readonly lineSubtotalPaise: number;
  readonly lineTaxPaise: number;
  readonly lineTotalPaise: number;
}

/** One allocation onto an invoice. */
export interface InvoicePaymentDto {
  readonly allocationId: string;
  readonly source: PaymentAllocationSource;
  readonly receiptId: string;
  readonly receiptCode: string;
  readonly receivedOn: string; // YYYY-MM-DD
  readonly amountPaise: number;
  readonly receiptStatus: PaymentReceiptStatus;
}

export interface InvoiceDto {
  readonly id: string;
  readonly code: string;
  readonly vyaparBillNumber: string | null;
  readonly clientId: string;
  readonly clientCode: string;
  readonly clientName: string;
  readonly assignmentId: string | null;
  readonly assignmentCode: string | null;
  readonly issueDate: string; // YYYY-MM-DD
  readonly dueDate: string; // YYYY-MM-DD
  readonly currency: 'INR';
  readonly subtotalPaise: number;
  readonly taxPaise: number;
  readonly totalPaise: number;
  readonly amountReceivedPaise: number;
  readonly balancePaise: number; // server-computed
  readonly daysOverdue: number; // server-computed
  readonly status: InvoiceStatus;
  readonly notes: string | null;
  readonly issuedAt: string | null;
  readonly voidReason: string | null;
  readonly voidedAt: string | null;
  readonly items: readonly InvoiceItemDto[];
  readonly payments: readonly InvoicePaymentDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentAllocationDto {
  readonly allocationId: string;
  readonly source: PaymentAllocationSource;
  readonly invoiceId: string;
  readonly invoiceCode: string;
  readonly amountPaise: number;
}

export interface PaymentReceiptDto {
  readonly id: string;
  readonly code: string;
  readonly clientId: string;
  readonly clientCode: string;
  readonly clientName: string;
  readonly receivedOn: string; // YYYY-MM-DD
  readonly amountPaise: number;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly status: PaymentReceiptStatus;
  readonly voidReason: string | null;
  readonly voidedAt: string | null;
  readonly allocatedPaise: number;
  readonly unallocatedPaise: number; // amountPaise - allocatedPaise
  readonly allocations: readonly PaymentAllocationDto[];
  readonly createdAt: string;
}

// --- Vyapar bills and payments (FEE-01a) ---

export interface RecordVyaparBillInput {
  readonly clientId: string; // RFC 4122 UUID
  readonly vyaparBillNumber: string; // 1-30 chars, unique per financial year
  readonly billDate: string; // YYYY-MM-DD
  readonly dueDate: string; // YYYY-MM-DD
  readonly amountPaise: number; // positive safe integer
  readonly description: string;
  readonly applyCredit?: boolean; // use the client's credit on the new bill (default false)
}

export interface RecordPaymentInput {
  readonly invoiceId: string; // RFC 4122 UUID of the Vyapar bill
  readonly receivedOn: string; // YYYY-MM-DD
  readonly amountPaise: number; // positive safe integer
  readonly method: PaymentMethod;
  readonly reference?: string | null;
  readonly notes?: string | null;
}

export interface VoidFeeRecordInput {
  readonly reason: string;
}

// --- Client credit (FEE-02a) ---

export type ApplyCreditInput = Record<string, never>;
