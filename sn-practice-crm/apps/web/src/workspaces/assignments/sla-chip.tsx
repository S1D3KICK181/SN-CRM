import type { SlaDto } from '@sn/contracts';
import type { AssignmentTone } from '../../data';

interface SlaChipModel {
  label: string;
  tone: AssignmentTone;
  muted: boolean;
}

/** The chip for an assignment's SLA: its words, colour tone, and whether it is shown muted. */
export function slaChipModel(sla: SlaDto | null | undefined): SlaChipModel {
  if (!sla) return { label: 'No target', tone: 'default', muted: true };
  switch (sla.status) {
    case 'at_risk':
      return { label: `At risk · ${sla.workingDaysLeft}d left`, tone: 'warning', muted: false };
    case 'breached':
      return { label: 'Breached', tone: 'danger', muted: false };
    case 'met':
      return { label: 'Met', tone: 'success', muted: false };
    case 'late':
      return { label: 'Late', tone: 'danger', muted: true };
    default:
      return { label: 'On track', tone: 'default', muted: false };
  }
}

export function SlaChip({ sla }: { sla: SlaDto | null | undefined }) {
  const { label, tone, muted } = slaChipModel(sla);
  return <span className={`status tone-${tone}${muted ? ' is-muted' : ''}`}>{label}</span>;
}

/** 2026-11-26 as 26/11/2026. */
export function formatSlaDeadline(deadline: string): string {
  return deadline.split('-').reverse().join('/');
}

/** The words before the chip on the drawer's SLA line, for work that has a target. */
export function slaDetailText(sla: SlaDto): string {
  if (sla.status === 'met' || sla.status === 'late') {
    return `Submitted on day ${sla.workingDaysUsed} of ${sla.targetDays}`;
  }
  return `Target ${sla.targetDays} working days · deadline ${formatSlaDeadline(sla.deadline)} · ${sla.workingDaysUsed} used, ${sla.workingDaysLeft} left`;
}
