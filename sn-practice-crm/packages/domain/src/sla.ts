import type { SlaDto } from '@sn/contracts';

// SLA rules (SLA-01). The target is the service's usual turnaround, counted in working days
// (Monday to Saturday; Sundays are skipped, public holidays are not excluded). The clock starts on the
// Asia/Kolkata date the assignment was created and stops when the work is submitted for review.

const DAY_MS = 86_400_000;

/** Work that has left the owner's hands: submitted, approved or closed. */
const STOPPED_STATUSES: readonly string[] = ['ready_for_review', 'approved', 'closed'];

/** An instant as its Asia/Kolkata calendar date, YYYY-MM-DD. */
export function kolkataDateOf(instant: string | Date): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function toDayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function fromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

// Day 0 of the epoch (1970-01-01) was a Thursday, so a day number of 3 modulo 7 is a Sunday.
function isSunday(day: number): boolean {
  return (((day + 4) % 7) + 7) % 7 === 0;
}

/** The date `days` working days after `startDate`. Day 1 is the next working day; Sundays are skipped. */
export function addWorkingDays(startDate: string, days: number): string {
  let day = toDayNumber(startDate);
  let counted = 0;
  while (counted < days) {
    day += 1;
    if (!isSunday(day)) counted += 1;
  }
  return fromDayNumber(day);
}

/** Working days strictly after `fromDate`, up to and including `toDate`. 0 when `toDate` is not after `fromDate`. */
export function workingDaysBetween(fromDate: string, toDate: string): number {
  const from = toDayNumber(fromDate);
  const to = toDayNumber(toDate);
  let counted = 0;
  for (let day = from + 1; day <= to; day += 1) {
    if (!isSunday(day)) counted += 1;
  }
  return counted;
}

/** When the SLA clock stopped, or null while it is still running. */
export function slaStoppedAt(input: {
  status: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  closedAt?: string | null;
}): string | null {
  if (!STOPPED_STATUSES.includes(input.status)) return null;
  return input.submittedAt ?? input.approvedAt ?? input.closedAt ?? null;
}

export interface SlaInput {
  createdAt: string;
  stoppedAt: string | null;
  targetDays: number | null;
  cancelled: boolean;
  now: Date;
}

/** An assignment with no target, or a cancelled one, has no SLA. */
export function computeSla(input: SlaInput): SlaDto | null {
  if (input.targetDays === null || input.cancelled) return null;
  const targetDays = input.targetDays;
  const createdDate = kolkataDateOf(input.createdAt);
  const deadline = addWorkingDays(createdDate, targetDays);

  if (input.stoppedAt !== null) {
    const stoppedDate = kolkataDateOf(input.stoppedAt);
    return {
      targetDays,
      deadline,
      status: stoppedDate <= deadline ? 'met' : 'late',
      workingDaysUsed: workingDaysBetween(createdDate, stoppedDate),
      workingDaysLeft: 0,
    };
  }

  const today = kolkataDateOf(input.now);
  const workingDaysLeft = workingDaysBetween(today, deadline);
  return {
    targetDays,
    deadline,
    status: today > deadline ? 'breached' : workingDaysLeft <= 2 ? 'at_risk' : 'on_track',
    workingDaysUsed: workingDaysBetween(createdDate, today),
    workingDaysLeft,
  };
}
