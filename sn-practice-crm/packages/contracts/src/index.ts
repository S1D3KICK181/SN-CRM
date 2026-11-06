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
  readonly ownerId: string; // RFC 4122 UUID references public.profiles(user_id)
  readonly reviewerIds: readonly string[]; // RFC 4122 UUIDs references assignment_reviewers
  readonly status: AssignmentStatus;
  readonly dueAt: string; // ISO-8601 UTC
  readonly recurringScheduleId: string | null;
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
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
  readonly ownerId: string; // RFC 4122 UUID
  readonly reviewerIds?: readonly string[]; // RFC 4122 UUIDs
  readonly dueAt: string; // ISO-8601 UTC
  readonly recurringScheduleId?: string | null;
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  readonly priority?: 'low' | 'normal' | 'high' | 'urgent';
} & ServiceReferenceInput;

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
  readonly reviewerIds: readonly string[]; // RFC 4122 UUIDs
  readonly nextOccurrenceOn: string; // YYYY-MM-DD
  readonly dueDay: number;
  readonly active: boolean;
  readonly createdById: string; // RFC 4122 UUID
  readonly createdAt: string; // ISO-8601 UTC
  readonly updatedAt: string; // ISO-8601 UTC
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
}

export interface UpdateRecurringScheduleInput {
  readonly active?: boolean;
  readonly nextOccurrenceOn?: string;
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

export interface ClientDto {
  readonly id: string; // RFC 4122 UUID
  readonly code: string; // Output-only: CL-xxxxxx
  readonly displayName: string;
  readonly legalName: string | null;
  readonly gstin: string | null;
  readonly pan: string | null;
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
