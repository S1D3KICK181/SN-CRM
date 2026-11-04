import type {
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemKind,
  WorkItemStatus,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type {
  AssignmentRow,
  DelegatedTaskRecord,
  DelegatedTaskStatus,
  PersonalTaskRecord,
} from '../data';
import {
  DEMO_ACTOR_ID_TO_NAME,
  ROLE_TO_DEMO_ACTOR_ID,
} from './dev-auth';

export const KOLKATA_OFFSET_MINUTES = 330; // +05:30
export const KOLKATA_OFFSET_MS = KOLKATA_OFFSET_MINUTES * 60 * 1000;

export interface KolkataDateParts {
  year: number;
  month: number; // 1-indexed (1-12)
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function getKolkataDateParts(date: Date): KolkataDateParts {
  const kolkataTime = new Date(date.getTime() + KOLKATA_OFFSET_MS);
  return {
    year: kolkataTime.getUTCFullYear(),
    month: kolkataTime.getUTCMonth() + 1,
    day: kolkataTime.getUTCDate(),
    hours: kolkataTime.getUTCHours(),
    minutes: kolkataTime.getUTCMinutes(),
    seconds: kolkataTime.getUTCSeconds(),
  };
}

export function formatIsoToKolkataDisplay(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const parts = getKolkataDateParts(d);
    const day = String(parts.day).padStart(2, '0');
    const month = String(parts.month).padStart(2, '0');
    return `${day}/${month}/${parts.year}`;
  } catch {
    return iso;
  }
}

function getDaysDifferenceInKolkata(target: Date, base: Date): number {
  const tParts = getKolkataDateParts(target);
  const bParts = getKolkataDateParts(base);

  const targetDayStartUtc = Date.UTC(tParts.year, tParts.month - 1, tParts.day);
  const baseDayStartUtc = Date.UTC(bParts.year, bParts.month - 1, bParts.day);

  return Math.round((targetDayStartUtc - baseDayStartUtc) / (24 * 60 * 60 * 1000));
}

export function formatWorkItemDue(iso: string, clock?: Date | string): string {
  try {
    const target = new Date(iso);
    if (Number.isNaN(target.getTime())) return iso;
    const base = clock ? new Date(clock) : new Date();

    const diffDays = getDaysDifferenceInKolkata(target, base);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return formatIsoToKolkataDisplay(iso);
  } catch {
    return iso;
  }
}

export function formatWorkItemTime(iso: string, clock?: Date | string): string {
  try {
    const target = new Date(iso);
    if (Number.isNaN(target.getTime())) return iso;
    const base = clock ? new Date(clock) : new Date();

    const parts = getKolkataDateParts(target);
    const hours = String(parts.hours).padStart(2, '0');
    const minutes = String(parts.minutes).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const diffDays = getDaysDifferenceInKolkata(target, base);
    if (diffDays === 0) return `Today · ${timeStr}`;
    if (diffDays === 1) return `Tomorrow · ${timeStr}`;
    return `${formatIsoToKolkataDisplay(iso)} · ${timeStr}`;
  } catch {
    return iso;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Pure parser converting user date string in Asia/Kolkata context into authoritative UTC ISO string.
 * Supports:
 * - "Today" / "Tomorrow" with optional time ("Today · 15:30", "Tomorrow 11:00")
 * - "DD/MM/YYYY" or "DD/MM" with optional time
 * - Standard ISO/Date strings
 * Throws on invalid date without silent mutation.
 */
export function parseDisplayDateToKolkataIso(
  input?: string,
  clock?: Date | string,
): string {
  const trimmed = input?.trim();
  if (!trimmed) {
    throw new Error('Date input cannot be empty.');
  }

  const baseDate = clock ? new Date(clock) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error('Invalid reference clock provided.');
  }
  const baseParts = getKolkataDateParts(baseDate);

  // Check explicit full ISO / RFC3339 timestamp with timezone (Z or +/-offset)
  const isoWithTzRegex = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(?:Z|([+-]\d{2}(?::?\d{2})?))$/i;
  const isoMatch = isoWithTzRegex.exec(trimmed);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const mon = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const h = Number(isoMatch[4]);
    const min = Number(isoMatch[5]);
    if (mon < 1 || mon > 12) {
      throw new Error(`Invalid date month: ${mon}`);
    }
    const maxDays = daysInMonth(y, mon);
    if (d < 1 || d > maxDays) {
      throw new Error(`Invalid date day ${d} for month ${mon}`);
    }
    if (h < 0 || h > 23 || min < 0 || min > 59) {
      throw new Error(`Invalid time format in ISO: ${h}:${min}`);
    }
    const parsedDirect = new Date(trimmed);
    if (Number.isNaN(parsedDirect.getTime())) {
      throw new Error(`Invalid date format: "${trimmed}"`);
    }
    return parsedDirect.toISOString();
  }

  // Time pattern: optional "·" or space followed by HH:mm
  const timeRegex = /(?:[·\s]+)(\d{1,2}):(\d{2})$/;
  const timeMatch = timeRegex.exec(trimmed);
  let hours = 18; // default to end of business day IST
  let minutes = 0;
  let datePart = trimmed;

  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time format: ${timeMatch[0]}`);
    }
    datePart = trimmed.slice(0, timeMatch.index).trim();
  }

  const lowerDate = datePart.toLowerCase();

  let targetYear: number;
  let targetMonth: number; // 1-12
  let targetDay: number;

  if (lowerDate === 'today') {
    targetYear = baseParts.year;
    targetMonth = baseParts.month;
    targetDay = baseParts.day;
  } else if (lowerDate === 'tomorrow') {
    const tomorrowUtc = Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + 1);
    const tomDate = new Date(tomorrowUtc);
    targetYear = tomDate.getUTCFullYear();
    targetMonth = tomDate.getUTCMonth() + 1;
    targetDay = tomDate.getUTCDate();
  } else {
    // Check Indian convention: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY or DD/MM, DD-MM, DD.MM
    // Enforces consistent separator via backreference \2
    const ddmmyyyy = /^(\d{1,2})([/\-.])(\d{1,2})(?:\2(\d{4}))?$/.exec(datePart);
    if (ddmmyyyy) {
      targetDay = Number(ddmmyyyy[1]);
      targetMonth = Number(ddmmyyyy[3]);
      targetYear = ddmmyyyy[4] ? Number(ddmmyyyy[4]) : baseParts.year;

      if (targetMonth < 1 || targetMonth > 12) {
        throw new Error(`Invalid date month: ${targetMonth}`);
      }
      const maxDays = daysInMonth(targetYear, targetMonth);
      if (targetDay < 1 || targetDay > maxDays) {
        throw new Error(`Invalid date day ${targetDay} for month ${targetMonth}`);
      }
    } else {
      // Check explicit ISO date format: YYYY-MM-DD
      const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
      if (yyyymmdd) {
        targetYear = Number(yyyymmdd[1]);
        targetMonth = Number(yyyymmdd[2]);
        targetDay = Number(yyyymmdd[3]);
        if (targetMonth < 1 || targetMonth > 12) {
          throw new Error(`Invalid date month: ${targetMonth}`);
        }
        const maxDays = daysInMonth(targetYear, targetMonth);
        if (targetDay < 1 || targetDay > maxDays) {
          throw new Error(`Invalid date day ${targetDay} for month ${targetMonth}`);
        }
      } else {
        throw new Error(`Invalid date format: "${trimmed}"`);
      }
    }
  }

  // Convert (targetYear, targetMonth, targetDay, hours, minutes) in Kolkata time to UTC
  const kolkataEpochMs = Date.UTC(targetYear, targetMonth - 1, targetDay, hours, minutes, 0);
  const utcEpochMs = kolkataEpochMs - KOLKATA_OFFSET_MS;
  return new Date(utcEpochMs).toISOString();
}

export function validateDelegatedDeadline(
  subtaskDueIso: string,
  parentDueIso: string,
): string | null {
  if (subtaskDueIso > parentDueIso) {
    const parentFormatted = formatIsoToKolkataDisplay(parentDueIso);
    return `The sub-task completion deadline cannot be later than its parent Assignment deadline (${parentFormatted}). Please adjust the target completion date.`;
  }
  return null;
}

export interface WorkItemStatusView {
  status: DelegatedTaskStatus;
  progress: number;
  tone: 'default' | 'danger' | 'warning' | 'success';
}

export function mapWorkItemStatusToView(status: WorkItemStatus): WorkItemStatusView {
  switch (status) {
    case 'todo':
      return { status: 'To Do', progress: 0, tone: 'default' };
    case 'in_progress':
      return { status: 'In Progress', progress: 50, tone: 'default' };
    case 'blocked':
      return { status: 'In Progress', progress: 40, tone: 'danger' };
    case 'ready_for_review':
      return { status: 'Pending Review', progress: 90, tone: 'warning' };
    case 'changes_requested':
      return { status: 'In Progress', progress: 60, tone: 'danger' };
    case 'completed':
      return { status: 'Completed', progress: 100, tone: 'success' };
    case 'cancelled':
      return { status: 'Completed', progress: 0, tone: 'default' };
  }
}

function resolveParentLabel(
  assignmentId: string | null,
  assignments: AssignmentRow[],
  fallbackPartyName: string | null,
): string {
  if (!assignmentId) {
    return fallbackPartyName || 'General';
  }
  const matched = assignments.find((a) => a.id === assignmentId);
  if (matched) {
    return `${matched.id} · ${matched.title}`;
  }
  return fallbackPartyName ? `${assignmentId} · ${fallbackPartyName}` : assignmentId;
}

export function mapDtoToDelegatedTaskRecord(
  dto: WorkItemDto,
  assignments: AssignmentRow[],
  role?: CompanyRole,
  clock?: Date | string,
): DelegatedTaskRecord {
  const statusView = mapWorkItemStatusToView(dto.status);
  const person = DEMO_ACTOR_ID_TO_NAME[dto.assigneeId] ?? dto.assigneeId;
  const assignedBy = DEMO_ACTOR_ID_TO_NAME[dto.createdById] ?? dto.createdById;
  const isInternal = dto.kind === 'internal';

  return {
    id: dto.id,
    code: dto.code,
    kind: dto.kind as 'delegated' | 'internal',
    title: dto.title,
    parent: isInternal
      ? 'Internal Office Work'
      : resolveParentLabel(dto.assignmentId, assignments, dto.relatedPartyName),
    parentAssignmentId: isInternal ? undefined : (dto.assignmentId ?? undefined),
    person,
    assigneeId: dto.assigneeId,
    assignedBy,
    createdById: dto.createdById,
    due: formatWorkItemDue(dto.dueAt, clock),
    progress: statusView.progress,
    status: statusView.status,
    tone: statusView.tone,
    instructions: dto.notes ?? undefined,
  };
}

export function mapDtoToPersonalTaskRecord(
  dto: WorkItemDto,
  role?: CompanyRole,
  clock?: Date | string,
): PersonalTaskRecord {
  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    context: dto.relatedPartyName || (dto.assignmentId ? dto.assignmentId : 'Personal'),
    time: formatWorkItemTime(dto.dueAt, clock),
    done: dto.status === 'completed',
    ownerRole: role,
  };
}

export interface WorkItemViewGroups {
  personalTasks: PersonalTaskRecord[];
  assignedToMe: DelegatedTaskRecord[];
  delegatedByMe: DelegatedTaskRecord[];
  reviewableTasks: DelegatedTaskRecord[];
  visibleDelegatedWork: DelegatedTaskRecord[];
}

export function deriveWorkItemViewGroups(
  rawItems: WorkItemDto[],
  assignments: AssignmentRow[],
  role: CompanyRole,
  clock?: Date | string,
): WorkItemViewGroups {
  const currentActorId = ROLE_TO_DEMO_ACTOR_ID[role];
  const isLeadership = role === 'founder' || role === 'manager';

  const personalTasks: PersonalTaskRecord[] = [];
  const assignedToMe: DelegatedTaskRecord[] = [];
  const delegatedByMe: DelegatedTaskRecord[] = [];
  const reviewableTasks: DelegatedTaskRecord[] = [];
  const visibleDelegatedWork: DelegatedTaskRecord[] = [];

  for (const item of rawItems) {
    if (item.kind === 'personal') {
      if (item.assigneeId === currentActorId) {
        personalTasks.push(mapDtoToPersonalTaskRecord(item, role, clock));
      }
      continue;
    }

    if (item.kind === 'delegated' || item.kind === 'internal') {
      const record = mapDtoToDelegatedTaskRecord(item, assignments, role, clock);

      if (item.assigneeId === currentActorId) {
        assignedToMe.push(record);
      }

      if (item.createdById === currentActorId) {
        delegatedByMe.push(record);
      }

      if (item.status === 'ready_for_review') {
        if (isLeadership) {
          reviewableTasks.push(record);
        } else if (role !== 'trainee' && item.createdById === currentActorId) {
          reviewableTasks.push(record);
        }
      }

      if (isLeadership) {
        visibleDelegatedWork.push(record);
      } else if (item.createdById === currentActorId) {
        visibleDelegatedWork.push(record);
      }
    }
  }

  return {
    personalTasks,
    assignedToMe,
    delegatedByMe,
    reviewableTasks,
    visibleDelegatedWork,
  };
}

export interface DelegationTargetOption {
  id: string;
  name: string;
  role: CompanyRole;
  label: string;
}

export function getDelegationTargets(role: CompanyRole): DelegationTargetOption[] {
  switch (role) {
    case 'founder':
      return [
        { id: '00000000-0000-4000-a000-000000000002', name: 'Priya Desai', role: 'manager', label: 'Priya Desai — Manager' },
        { id: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff', label: 'Ananya Rao — Senior Staff' },
        { id: '00000000-0000-4000-a000-000000000004', name: 'Rohan Mehta', role: 'staff', label: 'Rohan Mehta — Staff' },
        { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee', label: 'Neha Kapoor — Trainee' },
      ];
    case 'manager':
      return [
        { id: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff', label: 'Ananya Rao — Senior Staff' },
        { id: '00000000-0000-4000-a000-000000000004', name: 'Rohan Mehta', role: 'staff', label: 'Rohan Mehta — Staff' },
        { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee', label: 'Neha Kapoor — Trainee' },
      ];
    case 'senior_staff':
      return [
        { id: '00000000-0000-4000-a000-000000000004', name: 'Rohan Mehta', role: 'staff', label: 'Rohan Mehta — Staff' },
        { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee', label: 'Neha Kapoor — Trainee' },
      ];
    case 'staff':
      return [
        { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee', label: 'Neha Kapoor — Trainee' },
      ];
    case 'trainee':
      return [];
  }
}

export function getParentAssignmentOptions(
  role: CompanyRole,
  assignments: AssignmentRow[],
): AssignmentRow[] {
  if (role === 'founder' || role === 'manager') {
    return assignments;
  }
  if (role === 'trainee') {
    return [];
  }

  const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
  const actorName = DEMO_ACTOR_ID_TO_NAME[actorId];

  return assignments.filter(
    (assignment) => assignment.owner === actorName || assignment.reviewer === actorName,
  );
}
