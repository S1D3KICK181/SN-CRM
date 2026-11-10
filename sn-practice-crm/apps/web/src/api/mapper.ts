import type { AssignmentDto, CreateAssignmentInput, CreateRecurringScheduleInput, RecurringScheduleDto } from '@sn/contracts';
import type { AssignmentMilestone, AssignmentRow, RecurringScheduleRecord } from '../data';
import { resolveClientUuid } from './client-compat';
import { DEMO_ACTOR_ID_TO_NAME, NAME_TO_DEMO_ACTOR_ID } from './dev-auth';
import type {
  AssignmentContractTransition,
  CreateAssignmentCommand,
  CreateRecurringScheduleCommand,
} from './types';

export function formatIsoToDisplayDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return iso;
  }
}

export function parseDisplayDateToIso(dateStr?: string): string {
  if (!dateStr || dateStr.trim() === '' || dateStr.toLowerCase() === 'today') {
    return new Date().toISOString();
  }
  const trimmed = dateStr.trim();
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]) - 1;
    const year = Number(ddmmyyyy[3]);
    return new Date(Date.UTC(year, month, day, 12, 0, 0)).toISOString();
  }
  try {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {
    // fallback below
  }
  return new Date().toISOString();
}

export function normalizeDisplayDateToIso(dateStr?: string): string {
  if (!dateStr || !dateStr.trim()) return '';
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (match) {
    const dd = match[1]!.padStart(2, '0');
    const mm = match[2]!.padStart(2, '0');
    const yyyy = match[3]!;
    return `${yyyy}-${mm}-${dd}`;
  }
  try {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  } catch {
    // fallback below
  }
  return trimmed;
}

export function mapDtoToAssignmentRow(dto: AssignmentDto): AssignmentRow {
  const ownerName = DEMO_ACTOR_ID_TO_NAME[dto.ownerId] ?? dto.ownerId;
  const reviewerName =
    dto.reviewerIds && dto.reviewerIds.length > 0
      ? (DEMO_ACTOR_ID_TO_NAME[dto.reviewerIds[0]!] ?? dto.reviewerIds[0])
      : undefined;

  let displayStatus = 'Awaiting documents';
  let tone: AssignmentRow['tone'] = 'default';
  let progress = 15;

  switch (dto.status) {
    case 'draft':
      displayStatus = 'Draft';
      tone = 'default';
      progress = 0;
      break;
    case 'assigned':
      displayStatus = 'Awaiting documents';
      tone = 'default';
      progress = 15;
      break;
    case 'in_progress':
      displayStatus = 'In progress';
      tone = 'default';
      progress = 50;
      break;
    case 'ready_for_review':
      displayStatus = 'Pending review';
      tone = 'warning';
      progress = 80;
      break;
    case 'changes_requested':
      displayStatus = 'Changes requested';
      tone = 'danger';
      progress = 60;
      break;
    case 'approved':
      displayStatus = 'Approved';
      tone = 'success';
      progress = 100;
      break;
    case 'closed':
      displayStatus = 'Completed';
      tone = 'success';
      progress = 100;
      break;
    case 'cancelled':
      displayStatus = 'Cancelled';
      tone = 'default';
      progress = 0;
      break;
  }

  const milestones: AssignmentMilestone[] = [
    {
      title: 'Initial document intake & bank statements obtained',
      done: dto.status !== 'draft' && dto.status !== 'assigned' && dto.status !== 'cancelled',
    },
    {
      title: 'Fieldwork verification & ledger scrutiny',
      done: dto.status === 'ready_for_review' || dto.status === 'approved' || dto.status === 'closed',
    },
    {
      title: 'Managerial quality review',
      done: dto.status === 'approved' || dto.status === 'closed',
    },
    {
      title: 'Partner final sign-off & dispatch',
      done: dto.status === 'closed',
    },
  ];

  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    client: dto.clientName,
    clientId: dto.clientId,
    service: dto.service,
    due: formatIsoToDisplayDate(dto.dueAt),
    owner: ownerName,
    ownerId: dto.ownerId,
    reviewer: reviewerName,
    reviewerId: dto.reviewerIds && dto.reviewerIds.length > 0 ? dto.reviewerIds[0] : undefined,
    reviewerIds: dto.reviewerIds ? [...dto.reviewerIds] : undefined,
    expectedUpdatedAt: dto.updatedAt,
    status: displayStatus,
    progress,
    tone,
    scope: 'Standard statutory compliance fieldwork and verification.',
    milestones,
    deliveryNotes: (dto as unknown as { deliveryNotes?: string | null }).deliveryNotes ?? undefined,
    billed: dto.status === 'approved' || dto.status === 'closed',
    bankRecStatus: dto.status === 'approved' || dto.status === 'closed' ? 'Completed' : 'Awaited',
  };
}

export function mapCommandToCreateInput(command: CreateAssignmentCommand): CreateAssignmentInput {
  const clientName = (command.clientName ?? command.client ?? 'Client').trim();
  const rawClientId =
    command.clientId?.trim() ||
    `cli_${clientName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24)}`;
  const clientId = resolveClientUuid(rawClientId);

  const rawOwner = command.ownerNameOrId ?? command.owner ?? '00000000-0000-4000-a000-000000000003';
  const ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;

  const rawReviewer = command.reviewerNameOrId ?? command.reviewer;
  const reviewerId = rawReviewer
    ? (NAME_TO_DEMO_ACTOR_ID[rawReviewer] ?? rawReviewer)
    : '00000000-0000-4000-a000-000000000002';

  const dueAt = parseDisplayDateToIso(command.dueDate ?? command.due);

  return {
    clientId,
    title: command.title.trim(),
    service: command.service.trim(),
    ownerId,
    reviewerIds: reviewerId ? [reviewerId] : undefined,
    dueAt,
  };
}

export type CanonicalLifecycleStage =
  | 'draft'
  | 'open'
  | 'in_progress'
  | 'ready_for_review'
  | 'changes_requested'
  | 'approved'
  | 'completed'
  | 'cancelled'
  | 'unknown';

export function normalizeLifecycleStage(s?: string): CanonicalLifecycleStage {
  if (!s) return 'unknown';
  const lower = s.toLowerCase().trim();
  if (lower === 'draft') return 'draft';
  if (lower === 'open' || lower === 'assigned' || lower === 'awaiting documents') return 'open';
  if (lower === 'in progress' || lower === 'in_progress' || lower === 'on track') return 'in_progress';
  if (lower === 'pending review' || lower === 'ready_for_review' || lower === 'ready for review')
    return 'ready_for_review';
  if (lower === 'changes requested' || lower === 'changes_requested') return 'changes_requested';
  if (lower === 'approved') return 'approved';
  if (lower === 'completed' || lower === 'closed') return 'completed';
  if (lower === 'cancelled') return 'cancelled';
  return 'unknown';
}

export function mapStatusTransitionToAction(
  currentStatus: string,
  targetStatus: string,
): AssignmentContractTransition | null {
  const current = normalizeLifecycleStage(currentStatus);
  const target = normalizeLifecycleStage(targetStatus);

  if (current === target || target === 'unknown' || current === 'unknown') {
    return null;
  }

  if ((current === 'open' || current === 'changes_requested') && target === 'in_progress') {
    return 'start';
  }
  if (
    (current === 'open' || current === 'in_progress' || current === 'changes_requested') &&
    target === 'ready_for_review'
  ) {
    return 'submit';
  }
  if (current === 'ready_for_review' && (target === 'completed' || target === 'approved')) {
    return 'complete';
  }
  if (target === 'changes_requested') {
    return 'request_changes';
  }
  if ((current === 'completed' || current === 'ready_for_review') && target === 'in_progress') {
    return 'reopen';
  }

  return null;
}

export function mapDtoToRecurringScheduleRecord(dto: RecurringScheduleDto): RecurringScheduleRecord {
  const servLower = (dto.service || dto.title).toLowerCase();
  let category: 'GST' | 'TDS' | 'Bookkeeping' = 'GST';
  if (servLower.includes('tds') || servLower.includes('tax')) {
    category = 'TDS';
  } else if (
    servLower.includes('bookkeeping') ||
    servLower.includes('accounts') ||
    servLower.includes('ledger') ||
    servLower.includes('reconciliation')
  ) {
    category = 'Bookkeeping';
  }

  const cadenceDisplay =
    dto.cadence === 'monthly'
      ? 'Monthly'
      : dto.cadence === 'quarterly'
      ? 'Quarterly'
      : 'Annual';

  const defaultOwner = DEMO_ACTOR_ID_TO_NAME[dto.ownerId] ?? dto.ownerId;

  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    category,
    clientId: dto.clientId,
    clientName: dto.clientName,
    cadence: cadenceDisplay,
    generationDay: 1,
    statutoryDueDay: `${dto.dueDay}th of month`,
    defaultOwner,
    nextRunDate: dto.nextOccurrenceOn ? formatIsoToDisplayDate(dto.nextOccurrenceOn) : '—',
    nextDueDate: dto.nextOccurrenceOn ? formatIsoToDisplayDate(dto.nextOccurrenceOn) : '—',
    status: (dto.active ? 'Active' : 'Paused') as RecurringScheduleRecord['status'],
    bankRecStatus: 'Awaited',
    currentStatus: 'Pending',
    checklistTemplate: [
      `Review statutory compliance for ${dto.title}`,
      `Scrutinize client ledgers and supporting invoices`,
      `Verify computations and prepare filing payload`,
      `Upload and submit via statutory portal`,
    ],
    history: [],
  };
}

export function mapAssignmentRowToUpdatePatch(
  updated: AssignmentRow,
  existing?: AssignmentRow,
): import('./types').UpdateAssignmentPatch {
  let title: string | undefined;
  let dueAt: string | undefined;
  let deliveryNotes: string | null | undefined;
  let ownerId: string | undefined;
  let reviewerIds: string[] | undefined;

  if (!existing || updated.title !== existing.title) {
    title = updated.title.trim();
  }
  if (!existing || updated.due !== existing.due) {
    dueAt = parseDisplayDateToIso(updated.due);
  }
  if (
    !existing ||
    updated.deliveryNotes !== existing.deliveryNotes ||
    updated.scope !== existing.scope
  ) {
    deliveryNotes = (updated.deliveryNotes || updated.scope || '').trim() || null;
  }
  if (!existing || updated.owner !== existing.owner) {
    const rawOwner = updated.owner;
    ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;
  }
  if (!existing || updated.reviewer !== existing.reviewer) {
    if (updated.reviewer) {
      const reviewerId = NAME_TO_DEMO_ACTOR_ID[updated.reviewer] ?? updated.reviewer;
      reviewerIds = [reviewerId];
    } else {
      reviewerIds = [];
    }
  }

  return {
    title,
    dueAt,
    deliveryNotes,
    ownerId,
    reviewerIds,
  };
}

export function mapScheduleCommandToCreateInput(
  command: CreateRecurringScheduleCommand,
): CreateRecurringScheduleInput {
  const rawClientId = command.clientId;
  const clientId = resolveClientUuid(rawClientId);

  const rawOwner = command.ownerNameOrId ?? command.ownerId;
  const ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;

  const cadenceLower = command.cadence.toLowerCase() as 'monthly' | 'quarterly' | 'annual';

  let nextOccurrenceOn = command.nextOccurrenceOn;
  if (nextOccurrenceOn.includes('/')) {
    const parts = nextOccurrenceOn.split('/');
    if (parts.length === 3) {
      nextOccurrenceOn = `${parts[2]}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}`;
    }
  }

  return {
    clientId,
    title: command.title.trim(),
    serviceId: command.serviceId,
    service: command.service ?? 'Statutory Compliance',
    cadence: cadenceLower,
    ownerId,
    reviewerIds: command.reviewerIds,
    nextOccurrenceOn,
    dueDay: Number(command.dueDay) || 11,
  };
}
