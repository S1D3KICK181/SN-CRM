import type { CompanyRole } from '@sn/domain';

export interface SessionActor {
  id: string;
  name: string;
  role: CompanyRole;
  reportsToId: string | null;
}

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}

export interface ApiProblem {
  code: string;
  message: string;
  requestId: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type AssignmentStatus = 'open' | 'in_progress' | 'ready_for_review' | 'completed';

export interface AssignmentDto {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  title: string;
  service: string;
  ownerId: string;
  reviewerIds: string[];
  status: AssignmentStatus;
  dueAt: string;
  recurringScheduleId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssignmentInput {
  clientId: string;
  clientName: string;
  title: string;
  service: string;
  ownerId: string;
  reviewerIds?: string[];
  dueAt: string;
}

export type AssignmentTransition = 'start' | 'submit' | 'complete' | 'reopen';

export interface RecurringScheduleDto {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  service: string;
  cadence: 'monthly' | 'quarterly' | 'annual';
  ownerId: string;
  reviewerIds: string[];
  nextOccurrenceOn: string;
  dueDay: number;
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringScheduleInput {
  clientId: string;
  clientName: string;
  title: string;
  service: string;
  cadence: RecurringScheduleDto['cadence'];
  ownerId: string;
  reviewerIds?: string[];
  nextOccurrenceOn: string;
  dueDay: number;
}

export type WorkItemKind = 'delegated' | 'internal' | 'personal';
export type WorkItemStatus = 'todo' | 'in_progress' | 'ready_for_review' | 'done';

export interface WorkItemDto {
  id: string;
  kind: WorkItemKind;
  title: string;
  notes: string | null;
  assignmentId: string | null;
  relatedClientId: string | null;
  relatedPartyName: string | null;
  assigneeId: string;
  createdById: string;
  status: WorkItemStatus;
  dueAt: string;
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateWorkItemInput =
  | {
      kind: 'delegated';
      title: string;
      notes?: string;
      assignmentId: string;
      assigneeId: string;
      dueAt: string;
      reminderAt?: string;
    }
  | {
      kind: 'internal';
      title: string;
      notes?: string;
      assigneeId: string;
      dueAt: string;
      reminderAt?: string;
    }
  | {
      kind: 'personal';
      title: string;
      notes?: string;
      relatedClientId?: string;
      relatedPartyName?: string;
      dueAt: string;
      reminderAt?: string;
    };

export type WorkItemTransition = 'start' | 'submit' | 'complete' | 'reopen';

export interface ReportingLineDto {
  employee: SessionActor;
  manager: SessionActor | null;
}

export interface UpdateReportingLineInput {
  managerId: string | null;
}

export type LedgerDirection = 'inflow' | 'outflow';
export type LedgerAccount = 'cash' | 'bank';

export interface LedgerEntryDto {
  id: string;
  occurredOn: string;
  account: LedgerAccount;
  direction: LedgerDirection;
  amountPaise: number;
  narration: string;
  reference: string | null;
  recordedById: string;
  createdAt: string;
}

export interface CreateLedgerEntryInput {
  occurredOn: string;
  account: LedgerAccount;
  direction: LedgerDirection;
  amountPaise: number;
  narration: string;
  reference?: string;
}

export interface OfficeAccountsSummaryDto {
  currency: 'INR';
  cashBalancePaise: number;
  bankBalancePaise: number;
  totalInflowsPaise: number;
  totalOutflowsPaise: number;
  recentEntries: LedgerEntryDto[];
}
