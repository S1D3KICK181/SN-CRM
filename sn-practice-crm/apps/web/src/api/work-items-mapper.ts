import type {
  CreateWorkItemInput,
  ReportingLineDto,
  WorkItemDto,
  WorkItemKind,
  WorkItemStatus,
} from '@sn/contracts';
import { mayDelegateTo, type CompanyRole } from '@sn/domain';
import {
  type AssignmentRow,
  type DelegatedTaskRecord,
  type DelegatedTaskStatus,
  type PersonalTaskRecord,
  ROLE_LABELS,
} from '../data';
import {
  DEMO_ACTOR_ID_TO_NAME,
  ROLE_TO_DEMO_ACTOR_ID,
} from './dev-auth';
import { isValidUuid } from './metadata-safety';

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

export function getAssignmentDisplayCode(assignment: AssignmentRow): string {
  if (assignment.code?.trim()) {
    return assignment.code.trim();
  }
  if (assignment.id && !isValidUuid(assignment.id)) {
    return assignment.id;
  }
  return 'Linked Assignment';
}

export function resolveParentLabel(
  assignmentId: string | null,
  assignments: readonly AssignmentRow[],
  fallbackPartyName: string | null,
): string {
  if (!assignmentId) {
    return fallbackPartyName || 'General';
  }
  const matched = assignments.find((a) => a.id === assignmentId);
  if (matched) {
    const code = getAssignmentDisplayCode(matched);
    if (code !== 'Linked Assignment') {
      return `${code} · ${matched.title}`;
    }
    return matched.client ? `${matched.title} (${matched.client})` : matched.title;
  }
  const isCodeId = !isValidUuid(assignmentId);
  const displayPrefix = isCodeId ? assignmentId : 'Linked Assignment';

  if (fallbackPartyName?.trim() && !isValidUuid(fallbackPartyName.trim())) {
    return `${displayPrefix} · ${fallbackPartyName.trim()}`;
  }
  return displayPrefix;
}

export function mapDtoToDelegatedTaskRecord(
  dto: WorkItemDto,
  assignments: AssignmentRow[],
  role?: CompanyRole,
  clock?: Date | string,
  employeeNameMap?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): DelegatedTaskRecord {
  const statusView = mapWorkItemStatusToView(dto.status);

  const resolveName = (id: string): string => {
    if (employeeNameMap instanceof Map) {
      const mapped = employeeNameMap.get(id);
      if (mapped) return mapped;
    } else if (employeeNameMap && typeof employeeNameMap === 'object') {
      const mapped = (employeeNameMap as Record<string, string>)[id];
      if (mapped) return mapped;
    }
    return DEMO_ACTOR_ID_TO_NAME[id] ?? id;
  };

  const person = resolveName(dto.assigneeId);
  const assignedBy = resolveName(dto.createdById);
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
  assignments?: readonly AssignmentRow[],
): PersonalTaskRecord {
  let context = 'Personal';
  if (dto.relatedPartyName?.trim() && !isValidUuid(dto.relatedPartyName.trim())) {
    context = dto.relatedPartyName.trim();
  } else if (dto.assignmentId) {
    const matched = assignments?.find((a) => a.id === dto.assignmentId);
    if (matched) {
      const code = getAssignmentDisplayCode(matched);
      context = code !== 'Linked Assignment' ? code : (matched.client || matched.title || 'Linked Assignment');
    } else if (dto.relatedPartyName?.trim() && !isValidUuid(dto.relatedPartyName.trim())) {
      context = dto.relatedPartyName.trim();
    } else {
      context = 'Linked Assignment';
    }
  } else if (dto.relatedClientId) {
    context = 'Client Task';
  }

  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    context,
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

export interface DeriveWorkItemViewGroupsOptions {
  readonly currentActorId?: string;
  readonly employeeNameMap?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

export function deriveWorkItemViewGroups(
  rawItems: WorkItemDto[],
  assignments: AssignmentRow[],
  role: CompanyRole,
  clock?: Date | string,
  options?: DeriveWorkItemViewGroupsOptions,
): WorkItemViewGroups {
  const currentActorId = options?.currentActorId || ROLE_TO_DEMO_ACTOR_ID[role];
  const isLeadership = role === 'founder' || role === 'manager';

  const personalTasks: PersonalTaskRecord[] = [];
  const assignedToMe: DelegatedTaskRecord[] = [];
  const delegatedByMe: DelegatedTaskRecord[] = [];
  const reviewableTasks: DelegatedTaskRecord[] = [];
  const visibleDelegatedWork: DelegatedTaskRecord[] = [];

  for (const item of rawItems) {
    if (item.kind === 'personal') {
      if (item.assigneeId === currentActorId) {
        personalTasks.push(mapDtoToPersonalTaskRecord(item, role, clock, assignments));
      }
      continue;
    }

    if (item.kind === 'delegated' || item.kind === 'internal') {
      const record = mapDtoToDelegatedTaskRecord(
        item,
        assignments,
        role,
        clock,
        options?.employeeNameMap,
      );

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

export function isEligibleDelegationTargetRole(
  actorRole: CompanyRole,
  targetRole: CompanyRole,
): boolean {
  return mayDelegateTo(actorRole, targetRole);
}

function getDemoDelegationTargets(role: CompanyRole): DelegationTargetOption[] {
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

export function getEligibleDelegationTargets(
  actor: { id?: string; name?: string; role: CompanyRole },
  reportingLines?: readonly ReportingLineDto[],
): DelegationTargetOption[] {
  if (actor.role === 'trainee') {
    return [];
  }

  // If live reporting lines are available, filter and map live active employees
  if (reportingLines && reportingLines.length > 0) {
    const employeeMap = new Map<string, { id: string; name: string; role: CompanyRole }>();

    for (const line of reportingLines) {
      const emp = line.employee;
      if (!emp || !emp.id) continue;
      // Exclude self by ID or case-insensitive name
      if (actor.id && emp.id === actor.id) continue;
      if (actor.name && emp.name.trim().toLowerCase() === actor.name.trim().toLowerCase()) continue;
      // Exclude roles outside delegation authority via authoritative domain rule
      if (!mayDelegateTo(actor.role, emp.role)) continue;
      if (!employeeMap.has(emp.id)) {
        employeeMap.set(emp.id, { id: emp.id, name: emp.name, role: emp.role });
      }
    }

    const uniqueEmployees = Array.from(employeeMap.values());
    uniqueEmployees.sort((a, b) => a.name.localeCompare(b.name));

    return uniqueEmployees.map((emp) => {
      const roleDisplay = ROLE_LABELS[emp.role] ?? emp.role;
      return {
        id: emp.id,
        name: emp.name,
        role: emp.role,
        label: `${emp.name} — ${roleDisplay}`,
      };
    });
  }

  // Demo fallback when no reporting lines are provided (for backwards compatibility / offline tests)
  return getDemoDelegationTargets(actor.role).filter((target) => {
    if (actor.id && target.id === actor.id) return false;
    if (actor.name && target.name.trim().toLowerCase() === actor.name.trim().toLowerCase()) return false;
    return true;
  });
}

export function getDelegationTargets(role: CompanyRole): DelegationTargetOption[] {
  return getEligibleDelegationTargets({ role });
}

export function getParentAssignmentOptions(
  role: CompanyRole,
  assignments: readonly AssignmentRow[],
  currentActor?: { id?: string; name?: string },
): AssignmentRow[] {
  if (role === 'founder' || role === 'manager') {
    return [...assignments];
  }
  if (role === 'trainee') {
    return [];
  }

  const liveActorName = currentActor?.name?.trim();
  if (liveActorName) {
    const targetName = liveActorName.toLowerCase();
    return assignments.filter(
      (assignment) =>
        assignment.owner?.trim().toLowerCase() === targetName ||
        assignment.reviewer?.trim().toLowerCase() === targetName,
    );
  }

  // Demo fallback when no live actor is provided (preview/offline tests)
  const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
  const demoActorName = DEMO_ACTOR_ID_TO_NAME[actorId];
  if (!demoActorName) return [];

  return assignments.filter(
    (assignment) =>
      assignment.owner?.trim().toLowerCase() === demoActorName.toLowerCase() ||
      assignment.reviewer?.trim().toLowerCase() === demoActorName.toLowerCase(),
  );
}
