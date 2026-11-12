import type { AssignmentDto, CreateAssignmentInput, CreateRecurringScheduleInput, RecurringScheduleDto } from '@sn/contracts';
import type { AssignmentMilestone, AssignmentRow, RecurringScheduleRecord } from '../data';
import { resolveClientUuid } from './client-compat';
import { DEMO_ACTOR_ID_TO_NAME, NAME_TO_DEMO_ACTOR_ID } from './dev-auth';
import { isValidUuid } from './metadata-safety';
import {
  AssignmentOperationError,
  type AssignmentContractTransition,
  type CreateAssignmentCommand,
  type CreateRecurringScheduleCommand,
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

export class DateValidationError extends Error {
  readonly code = 'INVALID_DATE';
  constructor(message: string) {
    super(message);
    this.name = 'DateValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseDisplayDateToIso(dateStr?: string): string {
  if (!dateStr || dateStr.trim() === '') {
    throw new DateValidationError('Date is required');
  }
  const trimmed = dateStr.trim();
  if (trimmed.toLowerCase() === 'today') {
    throw new DateValidationError('Relative date "today" is not accepted; explicit calendar date required');
  }

  // 1. DD/MM/YYYY
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    if (month < 1 || month > 12) {
      throw new DateValidationError(`Invalid month ${month} in date: ${dateStr}`);
    }
    const maxDays = getDaysInMonth(year, month);
    if (day < 1 || day > maxDays) {
      throw new DateValidationError(`Invalid day ${day} for month ${month}/${year}`);
    }
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).toISOString();
  }

  // 2. YYYY-MM-DD
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (yyyymmdd) {
    const year = Number(yyyymmdd[1]);
    const month = Number(yyyymmdd[2]);
    const day = Number(yyyymmdd[3]);
    if (month < 1 || month > 12) {
      throw new DateValidationError(`Invalid month ${month} in date: ${dateStr}`);
    }
    const maxDays = getDaysInMonth(year, month);
    if (day < 1 || day > maxDays) {
      throw new DateValidationError(`Invalid day ${day} for month ${month}/${year}`);
    }
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0)).toISOString();
  }

  // 3. Full ISO 8601 (e.g. 2026-11-20T12:00:00.000Z)
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (month < 1 || month > 12) {
      throw new DateValidationError(`Invalid month ${month} in date: ${dateStr}`);
    }
    const maxDays = getDaysInMonth(year, month);
    if (day < 1 || day > maxDays) {
      throw new DateValidationError(`Invalid day ${day} for month ${month}/${year}`);
    }
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) {
      throw new DateValidationError(`Invalid ISO date: ${dateStr}`);
    }
    return d.toISOString();
  }

  throw new DateValidationError(`Unrecognized date format: ${dateStr}`);
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

export function formatPersonDisplayName(name: string | undefined | null, id: string | undefined | null): string {
  if (name && typeof name === 'string' && name.trim().length > 0 && !isValidUuid(name.trim())) {
    return name.trim();
  }
  if (id && isValidUuid(id)) {
    return 'Unavailable';
  }
  if (id && DEMO_ACTOR_ID_TO_NAME[id]) {
    return DEMO_ACTOR_ID_TO_NAME[id]!;
  }
  return 'Unavailable';
}

export function mapDtoToAssignmentRow(dto: AssignmentDto): AssignmentRow {
  const ownerName = formatPersonDisplayName(dto.ownerName, dto.ownerId);
  const reviewerName =
    dto.reviewerNames && dto.reviewerNames.length > 0
      ? dto.reviewerNames.map((name, idx) => formatPersonDisplayName(name, dto.reviewerIds?.[idx])).join(', ')
      : dto.reviewerIds && dto.reviewerIds.length > 0
      ? formatPersonDisplayName(undefined, dto.reviewerIds[0])
      : undefined;

  let displayStatus: string;
  let tone: AssignmentRow['tone'] = 'default';

  switch (dto.status) {
    case 'draft':
      displayStatus = 'Draft';
      tone = 'default';
      break;
    case 'assigned':
      displayStatus = 'Assigned';
      tone = 'default';
      break;
    case 'in_progress':
      displayStatus = 'In progress';
      tone = 'default';
      break;
    case 'ready_for_review':
      displayStatus = 'Ready for review';
      tone = 'warning';
      break;
    case 'changes_requested':
      displayStatus = 'Changes requested';
      tone = 'danger';
      break;
    case 'approved':
      displayStatus = 'Approved';
      tone = 'success';
      break;
    case 'closed':
      displayStatus = 'Closed';
      tone = 'success';
      break;
    case 'cancelled':
      displayStatus = 'Cancelled';
      tone = 'default';
      break;
    default:
      displayStatus = dto.status;
      tone = 'default';
      break;
  }

  const progress =
    dto.progressPercent !== undefined && dto.progressPercent !== null
      ? dto.progressPercent
      : 0;

  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    description: dto.description ?? null,
    scope: dto.description ?? undefined,
    client: dto.clientName,
    clientId: dto.clientId,
    service: dto.service,
    serviceId: dto.serviceId,
    due: formatIsoToDisplayDate(dto.dueAt),
    owner: ownerName,
    ownerId: dto.ownerId,
    reviewer: reviewerName,
    reviewerId: dto.reviewerIds && dto.reviewerIds.length > 0 ? dto.reviewerIds[0] : undefined,
    reviewerIds: dto.reviewerIds ? [...dto.reviewerIds] : undefined,
    reviewerNames: dto.reviewerNames ? [...dto.reviewerNames] : undefined,
    recurringScheduleId: dto.recurringScheduleId ?? null,
    engagementId: dto.engagementId ?? null,
    engagementCode: dto.engagementCode ?? null,
    expectedUpdatedAt: dto.updatedAt,
    status: displayStatus,
    progress,
    tone,
    deliveryNotes: dto.deliveryNotes !== undefined ? dto.deliveryNotes : null,
    reviewNotes: dto.reviewNotes !== undefined ? dto.reviewNotes : null,
  };
}

export function mapCommandToCreateInput(command: CreateAssignmentCommand): CreateAssignmentInput {
  const title = command.title?.trim();
  if (!title) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Assignment title is required.',
    });
  }

  const rawClientId = command.clientId?.trim();
  if (!rawClientId) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Client ID is required.',
    });
  }
  const clientId = resolveClientUuid(rawClientId);
  if (!isValidUuid(clientId)) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: `Invalid client UUID: ${rawClientId}`,
    });
  }

  const rawOwner = (command.ownerId ?? command.ownerNameOrId ?? command.owner)?.trim();
  if (!rawOwner) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Assignment in-charge owner is required.',
    });
  }
  const ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;
  if (!isValidUuid(ownerId)) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: `Invalid owner UUID: ${rawOwner}`,
    });
  }

  let reviewerIds: string[] | undefined = undefined;
  const rawReviewer = (command.reviewerId ?? command.reviewerNameOrId ?? command.reviewer)?.trim();
  if (rawReviewer) {
    const revId = NAME_TO_DEMO_ACTOR_ID[rawReviewer] ?? rawReviewer;
    if (!isValidUuid(revId)) {
      throw new AssignmentOperationError({
        code: 'validation',
        message: `Invalid reviewer UUID: ${rawReviewer}`,
      });
    }
    reviewerIds = [revId];
  } else if (command.reviewerIds && command.reviewerIds.length > 0) {
    reviewerIds = command.reviewerIds.map((r: string) => {
      const revId = NAME_TO_DEMO_ACTOR_ID[r] ?? r;
      if (!isValidUuid(revId)) {
        throw new AssignmentOperationError({
          code: 'validation',
          message: `Invalid reviewer UUID: ${r}`,
        });
      }
      return revId;
    });
  }

  const engagementFields = mapEngagementReference(command.engagementId);

  const rawDue = command.dueDate ?? command.due;
  const dueAt = parseDisplayDateToIso(rawDue);
  const description = command.description?.trim() || command.scope?.trim() || undefined;

  const hasServiceId = Boolean(command.serviceId && command.serviceId.trim());
  const hasService = Boolean(command.service && command.service.trim());

  if (hasServiceId) {
    return {
      clientId,
      title,
      description,
      serviceId: command.serviceId!.trim(),
      ownerId,
      reviewerIds,
      dueAt,
      ...engagementFields,
    };
  } else if (hasService) {
    return {
      clientId,
      title,
      description,
      service: command.service!.trim(),
      ownerId,
      reviewerIds,
      dueAt,
      ...engagementFields,
    };
  } else {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Assignment service is required.',
    });
  }
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

/**
 * Computes the statutory next due date from nextOccurrenceOn and dueDay offset.
 *
 * Rule:
 * Next due = (day before nextOccurrenceOn) + dueDay offset using UTC date-only arithmetic.
 * Correctly accounts for month rollovers, leap years, and year-boundary rollovers.
 */
export function computeRecurringNextDueDate(
  nextOccurrenceOn: string | undefined | null,
  dueOffsetDays: number,
): string {
  if (!nextOccurrenceOn || !nextOccurrenceOn.trim()) {
    return '—';
  }
  const trimmed = nextOccurrenceOn.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  let year: number;
  let monthIndex: number;
  let day: number;

  if (match) {
    year = Number(match[1]);
    monthIndex = Number(match[2]) - 1;
    day = Number(match[3]);
  } else {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return '—';
    year = d.getUTCFullYear();
    monthIndex = d.getUTCMonth();
    day = d.getUTCDate();
  }

  // Next due = (day before nextOccurrenceOn) + dueDay offset using UTC date-only arithmetic
  const dt = new Date(Date.UTC(year, monthIndex, day - 1 + dueOffsetDays, 0, 0, 0, 0));
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Optional engagement link shared by the assignment and schedule create commands: trimmed, a valid UUID is
// passed through, blank is omitted, anything else is a validation error.
function mapEngagementReference(engagementId: string | null | undefined): { engagementId?: string } {
  const raw = engagementId?.trim();
  if (raw && !isValidUuid(raw)) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Invalid engagement reference.',
    });
  }
  return raw ? { engagementId: raw } : {};
}

export function mapDtoToRecurringScheduleRecord(dto: RecurringScheduleDto): RecurringScheduleRecord {
  const cadenceDisplay =
    dto.cadence === 'monthly'
      ? 'Monthly'
      : dto.cadence === 'quarterly'
      ? 'Quarterly'
      : 'Annual';

  const defaultOwner = formatPersonDisplayName(dto.ownerName, dto.ownerId);

  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    service: dto.service,
    category: dto.service as any,
    clientId: dto.clientId,
    clientName: dto.clientName,
    cadence: cadenceDisplay,
    statutoryDueDay: `${dto.dueDay} days after period end`,
    defaultOwner,
    nextRunDate: dto.nextOccurrenceOn ? formatIsoToDisplayDate(dto.nextOccurrenceOn) : '—',
    nextDueDate: computeRecurringNextDueDate(dto.nextOccurrenceOn, dto.dueDay),
    engagementId: dto.engagementId ?? null,
    engagementCode: dto.engagementCode ?? null,
    status: (dto.active ? 'Active' : 'Paused') as RecurringScheduleRecord['status'],
  };
}

export function mapAssignmentRowToUpdatePatch(
  updated: AssignmentRow,
  existing?: AssignmentRow,
): import('./types').UpdateAssignmentPatch {
  let title: string | undefined;
  let description: string | null | undefined;
  let serviceId: string | undefined;
  let dueAt: string | undefined;
  let deliveryNotes: string | null | undefined;
  let reviewNotes: string | null | undefined;
  let progressPercent: number | undefined;
  let ownerId: string | undefined;
  let reviewerIds: string[] | undefined;

  if (!existing || updated.title !== existing.title) {
    title = updated.title.trim();
  }
  if (!existing || updated.description !== existing.description) {
    if (updated.description !== undefined) {
      description = updated.description !== null && updated.description.trim().length > 0
        ? updated.description.trim()
        : null;
    }
  }
  if (!existing || updated.serviceId !== existing.serviceId) {
    serviceId = updated.serviceId;
  }
  if (!existing || updated.due !== existing.due) {
    dueAt = parseDisplayDateToIso(updated.due);
  }
  if (!existing || updated.deliveryNotes !== existing.deliveryNotes) {
    deliveryNotes = updated.deliveryNotes !== undefined ? (updated.deliveryNotes?.trim() || null) : undefined;
  }
  if (!existing || updated.reviewNotes !== existing.reviewNotes) {
    reviewNotes = updated.reviewNotes !== undefined ? (updated.reviewNotes?.trim() || null) : undefined;
  }
  if (!existing || updated.progress !== existing.progress) {
    progressPercent = updated.progress;
  }
  if (!existing || updated.owner !== existing.owner) {
    const rawOwner = updated.owner;
    ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;
  }
  if (!existing || updated.reviewer !== existing.reviewer) {
    if (updated.reviewer && updated.reviewer !== 'Not designated') {
      const reviewerId = NAME_TO_DEMO_ACTOR_ID[updated.reviewer] ?? updated.reviewer;
      reviewerIds = [reviewerId];
    } else {
      reviewerIds = [];
    }
  }

  const rawExpected = updated.expectedUpdatedAt ?? existing?.expectedUpdatedAt;
  const expectedUpdatedAt = rawExpected?.trim();
  if (!expectedUpdatedAt) {
    throw new AssignmentOperationError({
      code: 'conflict',
      message: 'Missing optimistic concurrency token for assignment update.',
    });
  }

  return {
    title,
    description,
    serviceId,
    dueAt,
    deliveryNotes,
    reviewNotes,
    progressPercent,
    ownerId,
    reviewerIds,
    expectedUpdatedAt,
  };
}

export function mapScheduleCommandToCreateInput(
  command: CreateRecurringScheduleCommand,
): CreateRecurringScheduleInput {
  const rawClientId = command.clientId?.trim();
  if (!rawClientId) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Client ID is required for recurring schedule.',
    });
  }
  const clientId = resolveClientUuid(rawClientId);
  if (!isValidUuid(clientId)) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: `Invalid client UUID: ${rawClientId}`,
    });
  }

  const title = command.title?.trim();
  if (!title) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Recurring schedule title is required.',
    });
  }

  const rawOwner = (command.ownerId ?? command.ownerNameOrId)?.trim();
  if (!rawOwner) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Recurring schedule owner is required.',
    });
  }
  const ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;
  if (!isValidUuid(ownerId)) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: `Invalid owner UUID: ${rawOwner}`,
    });
  }

  if (!command.cadence) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Schedule cadence is required.',
    });
  }
  const cadenceLower = command.cadence.toLowerCase() as 'monthly' | 'quarterly' | 'annual';
  if (!['monthly', 'quarterly', 'annual'].includes(cadenceLower)) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: `Invalid cadence: ${command.cadence}`,
    });
  }

  if (!command.nextOccurrenceOn || !command.nextOccurrenceOn.trim()) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'First occurrence start date (nextOccurrenceOn) is required.',
    });
  }

  let rawNext = command.nextOccurrenceOn.trim();
  let nextOccurrenceOn: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawNext)) {
    const [y, m, d] = rawNext.split('-').map(Number);
    if (m! < 1 || m! > 12 || d! < 1 || d! > getDaysInMonth(y!, m!)) {
      throw new DateValidationError(`Invalid date components: ${rawNext}`);
    }
    nextOccurrenceOn = rawNext;
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawNext)) {
    const [d, m, y] = rawNext.split('/').map(Number);
    if (m! < 1 || m! > 12 || d! < 1 || d! > getDaysInMonth(y!, m!)) {
      throw new DateValidationError(`Invalid date components: ${rawNext}`);
    }
    nextOccurrenceOn = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  } else {
    const iso = parseDisplayDateToIso(rawNext);
    nextOccurrenceOn = iso.slice(0, 10);
  }

  const dueDay = Number(command.dueDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Due offset must be an integer between 1 and 31 days after period end.',
    });
  }

  const hasServiceId = Boolean(command.serviceId && command.serviceId.trim());
  const hasService = Boolean(command.service && command.service.trim());
  if (!hasServiceId && !hasService) {
    throw new AssignmentOperationError({
      code: 'validation',
      message: 'Recurring schedule service is required.',
    });
  }

  return {
    clientId,
    title,
    serviceId: command.serviceId?.trim() || undefined,
    service: command.service?.trim() || undefined,
    cadence: cadenceLower,
    ownerId,
    reviewerIds: command.reviewerIds,
    nextOccurrenceOn,
    dueDay,
    ...mapEngagementReference(command.engagementId),
  };
}
