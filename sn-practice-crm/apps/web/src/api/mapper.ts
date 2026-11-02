import type { AssignmentDto, CreateAssignmentInput } from '@sn/contracts';
import type { AssignmentMilestone, AssignmentRow } from '../data';
import { DEMO_ACTOR_ID_TO_NAME, NAME_TO_DEMO_ACTOR_ID } from './dev-auth';
import type {
  AssignmentContractTransition,
  CreateAssignmentCommand,
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
    case 'open':
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
    case 'completed':
      displayStatus = 'Completed';
      tone = 'success';
      progress = 100;
      break;
  }

  const milestones: AssignmentMilestone[] = [
    { title: 'Initial document intake & bank statements obtained', done: dto.status !== 'open' },
    {
      title: 'Fieldwork verification & ledger scrutiny',
      done: dto.status === 'ready_for_review' || dto.status === 'completed',
    },
    {
      title: 'Managerial quality review',
      done: dto.status === 'ready_for_review' || dto.status === 'completed',
    },
    { title: 'Partner final sign-off & dispatch', done: dto.status === 'completed' },
  ];

  return {
    id: dto.id,
    title: dto.title,
    client: dto.clientName,
    clientId: dto.clientId,
    service: dto.service,
    due: formatIsoToDisplayDate(dto.dueAt),
    owner: ownerName,
    reviewer: reviewerName,
    status: displayStatus,
    progress,
    tone,
    scope: 'Standard statutory compliance fieldwork and verification.',
    milestones,
    fee: 25000,
    billed: dto.status === 'completed',
    bankStatementRequired: true,
    bankRecStatus: dto.status === 'completed' ? 'Completed' : 'Awaited',
  };
}

export function mapCommandToCreateInput(command: CreateAssignmentCommand): CreateAssignmentInput {
  const clientName = (command.clientName ?? command.client ?? 'Client').trim();
  let clientId = command.clientId?.trim();
  if (!clientId || !/^[a-zA-Z0-9_-]+$/.test(clientId)) {
    const slug = clientName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24);
    clientId = `cli_${slug || 'client'}`;
  }

  const rawOwner = command.ownerNameOrId ?? command.owner ?? 'usr_senior';
  const ownerId = NAME_TO_DEMO_ACTOR_ID[rawOwner] ?? rawOwner;

  const rawReviewer = command.reviewerNameOrId ?? command.reviewer;
  const reviewerId = rawReviewer ? (NAME_TO_DEMO_ACTOR_ID[rawReviewer] ?? rawReviewer) : 'usr_manager';

  const dueAt = parseDisplayDateToIso(command.dueDate ?? command.due);

  return {
    clientId,
    clientName,
    title: command.title.trim(),
    service: command.service.trim(),
    ownerId,
    reviewerIds: reviewerId ? [reviewerId] : undefined,
    dueAt,
  };
}

export type CanonicalLifecycleStage = 'open' | 'in_progress' | 'ready_for_review' | 'completed' | 'unknown';

export function normalizeLifecycleStage(s?: string): CanonicalLifecycleStage {
  if (!s) return 'unknown';
  const lower = s.toLowerCase().trim();
  if (lower === 'open' || lower === 'awaiting documents') return 'open';
  if (lower === 'in progress' || lower === 'in_progress' || lower === 'on track') return 'in_progress';
  if (lower === 'pending review' || lower === 'ready_for_review' || lower === 'ready for review')
    return 'ready_for_review';
  if (lower === 'completed') return 'completed';
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

  if (current === 'open' && target === 'in_progress') {
    return 'start';
  }
  if ((current === 'open' || current === 'in_progress') && target === 'ready_for_review') {
    return 'submit';
  }
  if (current === 'ready_for_review' && target === 'completed') {
    return 'complete';
  }
  if ((current === 'completed' || current === 'ready_for_review') && target === 'in_progress') {
    return 'reopen';
  }

  return null;
}
