import type { CompanyRole } from '@sn/domain';
import { normalizeDisplayDateToIso } from '../../api/mapper';
import type {
  AssignmentRow,
  AssignmentTone,
  DelegatedTaskRecord,
  InvoiceRecord,
  PersonalTaskRecord,
  ReceiptRecord,
  RecurringScheduleRecord,
} from '../../data';
import { formatINR } from '../../data';
import { addDaysToIsoDate, billLabel } from '../billing/billing-form-model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const CLOSED_ASSIGNMENT_STATUSES: readonly string[] = ['Approved', 'Closed', 'Cancelled'];
const PENDING_BILL_STATUSES: readonly string[] = ['Pending', 'Partly Paid', 'Overdue'];
const NOT_BILLED_STATUSES: readonly string[] = ['Draft', 'Cancelled'];

/** Whether the fee figures are ready, still loading, or could not be loaded. */
export type FeesState = 'ready' | 'loading' | 'error';

export interface MetricTile {
  label: string;
  value: string;
  note: string;
  tone: AssignmentTone;
}

/* ---------- dates ---------- */

/** A display (DD/MM/YYYY) or ISO date as YYYY-MM-DD, or '' when it is not a date. */
export function toIsoDate(value: string | undefined | null): string {
  if (!value) return '';
  const iso = normalizeDisplayDateToIso(value);
  return ISO_DATE.test(iso) ? iso : '';
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/** YYYY-MM-DD as DD/MM/YYYY. */
export function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** YYYY-MM-DD as DD/MM. */
export function isoToDayMonth(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export interface FinancialYear {
  /** First calendar year, e.g. 2026 for FY 2026–27. */
  startYear: number;
  /** e.g. `2026–27`. */
  label: string;
  /** First day, April 1st, as YYYY-MM-DD. */
  start: string;
  /** Last day, March 31st, as YYYY-MM-DD. */
  end: string;
}

/** The April to March financial year that contains `today`. */
export function financialYearOf(today: string): FinancialYear {
  const [y, m] = today.split('-').map(Number);
  const year = y ?? 0;
  const startYear = (m ?? 1) >= 4 ? year : year - 1;
  return {
    startYear,
    label: `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

function inRange(iso: string, start: string, end: string): boolean {
  return iso !== '' && iso >= start && iso <= end;
}

/* ---------- assignments ---------- */

export function isOpenAssignment(assignment: Pick<AssignmentRow, 'status'>): boolean {
  return !CLOSED_ASSIGNMENT_STATUSES.includes(assignment.status);
}

export function openAssignments(assignments: readonly AssignmentRow[]): AssignmentRow[] {
  return assignments.filter(isOpenAssignment);
}

/** Open assignments the signed-in person owns; Senior Staff also those they review. */
export function myAssignments(
  role: CompanyRole,
  assignments: readonly AssignmentRow[],
  actorId: string,
): AssignmentRow[] {
  return assignments.filter((assignment) => {
    if (assignment.ownerId === actorId) return true;
    return role === 'senior_staff' && (assignment.reviewerIds ?? []).includes(actorId);
  });
}

function assignmentDue(assignment: AssignmentRow): string {
  return toIsoDate(assignment.due);
}

export function countOverdue(assignments: readonly AssignmentRow[], today: string): number {
  return openAssignments(assignments).filter((a) => {
    const due = assignmentDue(a);
    return due !== '' && due < today;
  }).length;
}

export function countDueToday(assignments: readonly AssignmentRow[], today: string): number {
  return openAssignments(assignments).filter((a) => assignmentDue(a) === today).length;
}

function countByStatus(assignments: readonly AssignmentRow[], status: string): number {
  return openAssignments(assignments).filter((a) => a.status === status).length;
}

/* ---------- work items ---------- */

function isOpenTask(task: Pick<DelegatedTaskRecord, 'status'>): boolean {
  return task.status !== 'Completed';
}

/** Delegated task due labels are `Today`, `Tomorrow` or DD/MM/YYYY. */
export function taskDueIso(due: string, today: string): string {
  if (due === 'Today') return today;
  if (due === 'Tomorrow') return addDaysToIsoDate(today, 1);
  return toIsoDate(due);
}

/* ---------- billing ---------- */

function paiseOfRupees(amount: number): number {
  return Math.round(amount * 100);
}

export function formatPaise(paise: number): string {
  return formatINR(paise / 100);
}

function isPendingBill(invoice: InvoiceRecord): boolean {
  return PENDING_BILL_STATUSES.includes(invoice.status);
}

function isBilled(invoice: InvoiceRecord): boolean {
  return !NOT_BILLED_STATUSES.includes(invoice.status);
}

function isReceived(receipt: ReceiptRecord): boolean {
  return receipt.status === 'Received';
}

export function pendingPaise(invoices: readonly InvoiceRecord[]): number {
  return invoices.filter(isPendingBill).reduce((sum, i) => sum + i.balancePaise, 0);
}

export function overduePaise(invoices: readonly InvoiceRecord[]): number {
  return invoices.filter((i) => i.status === 'Overdue').reduce((sum, i) => sum + i.balancePaise, 0);
}

export interface FeesSnapshot {
  billedThisMonthPaise: number;
  billsThisMonth: number;
  collectedThisMonthPaise: number;
  paymentsThisMonth: number;
  pendingPaise: number;
  pendingClients: number;
  overduePaise: number;
  /** Days past due on the oldest overdue bill; 0 when nothing is overdue. */
  oldestOverdueDays: number;
  /** Collected ÷ billed this financial year as a whole percent capped at 100; null when nothing is billed. */
  collectedPercent: number | null;
}

export function computeFeesSnapshot(
  invoices: readonly InvoiceRecord[],
  receipts: readonly ReceiptRecord[],
  today: string,
): FeesSnapshot {
  const year = financialYearOf(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = `${today.slice(0, 7)}-31`;
  const billed = invoices.filter(isBilled);
  const received = receipts.filter(isReceived);

  const billsThisMonth = billed.filter((i) => inRange(toIsoDate(i.invoiceDate), monthStart, monthEnd));
  const paymentsThisMonth = received.filter((r) => inRange(toIsoDate(r.receiptDate), monthStart, monthEnd));
  const pending = invoices.filter(isPendingBill);
  const overdue = invoices.filter((i) => i.status === 'Overdue');

  const billedYear = billed
    .filter((i) => inRange(toIsoDate(i.invoiceDate), year.start, year.end))
    .reduce((sum, i) => sum + paiseOfRupees(i.total), 0);
  const collectedYear = received
    .filter((r) => inRange(toIsoDate(r.receiptDate), year.start, year.end))
    .reduce((sum, r) => sum + r.amountPaise, 0);

  return {
    billedThisMonthPaise: billsThisMonth.reduce((sum, i) => sum + paiseOfRupees(i.total), 0),
    billsThisMonth: billsThisMonth.length,
    collectedThisMonthPaise: paymentsThisMonth.reduce((sum, r) => sum + r.amountPaise, 0),
    paymentsThisMonth: paymentsThisMonth.length,
    pendingPaise: pendingPaise(invoices),
    pendingClients: new Set(pending.map((i) => i.clientId)).size,
    overduePaise: overduePaise(invoices),
    oldestOverdueDays: overdue.reduce((max, i) => Math.max(max, i.daysOverdue), 0),
    collectedPercent: billedYear > 0 ? Math.min(100, Math.round((collectedYear / billedYear) * 100)) : null,
  };
}

export interface MonthlyFees {
  /** Apr, May, … */
  label: string;
  billedPaise: number;
  collectedPaise: number;
}

export interface BilledAndCollected {
  financialYear: FinancialYear;
  billedPaise: number;
  collectedPaise: number;
  /** Bills recorded in this financial year. */
  billCount: number;
  /** One entry per month from April to the current month. */
  months: MonthlyFees[];
}

export function computeBilledAndCollected(
  invoices: readonly InvoiceRecord[],
  receipts: readonly ReceiptRecord[],
  today: string,
): BilledAndCollected {
  const financialYear = financialYearOf(today);
  const [ty, tm] = today.split('-').map(Number);
  const monthsElapsed = ((ty ?? 0) - financialYear.startYear) * 12 + ((tm ?? 4) - 4) + 1;

  const months: MonthlyFees[] = [];
  const keys: string[] = [];
  for (let offset = 0; offset < monthsElapsed; offset += 1) {
    const monthIndex = (3 + offset) % 12;
    const year = financialYear.startYear + Math.floor((3 + offset) / 12);
    keys.push(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
    months.push({ label: MONTH_LABELS[monthIndex] ?? '', billedPaise: 0, collectedPaise: 0 });
  }

  let billCount = 0;
  for (const invoice of invoices.filter(isBilled)) {
    const date = toIsoDate(invoice.invoiceDate);
    const slot = months[keys.indexOf(date.slice(0, 7))];
    if (!slot || !inRange(date, financialYear.start, financialYear.end)) continue;
    slot.billedPaise += paiseOfRupees(invoice.total);
    billCount += 1;
  }
  for (const receipt of receipts.filter(isReceived)) {
    const date = toIsoDate(receipt.receiptDate);
    const slot = months[keys.indexOf(date.slice(0, 7))];
    if (!slot || !inRange(date, financialYear.start, financialYear.end)) continue;
    slot.collectedPaise += receipt.amountPaise;
  }

  return {
    financialYear,
    billedPaise: months.reduce((sum, m) => sum + m.billedPaise, 0),
    collectedPaise: months.reduce((sum, m) => sum + m.collectedPaise, 0),
    billCount,
    months,
  };
}

export interface ClientPending {
  clientId: string;
  clientName: string;
  pendingPaise: number;
  /** Days past due on the client's oldest overdue bill; 0 when none is overdue. */
  overdueDays: number;
}

export interface PendingByClient {
  totalPaise: number;
  overduePaise: number;
  /** Every client with pending fees, largest first. */
  clients: ClientPending[];
}

export function computePendingByClient(invoices: readonly InvoiceRecord[]): PendingByClient {
  const byClient = new Map<string, ClientPending>();
  for (const invoice of invoices.filter(isPendingBill)) {
    const entry = byClient.get(invoice.clientId) ?? {
      clientId: invoice.clientId,
      clientName: invoice.clientName,
      pendingPaise: 0,
      overdueDays: 0,
    };
    entry.pendingPaise += invoice.balancePaise;
    if (invoice.status === 'Overdue') entry.overdueDays = Math.max(entry.overdueDays, invoice.daysOverdue);
    byClient.set(invoice.clientId, entry);
  }
  const clients = [...byClient.values()].sort(
    (a, b) => b.pendingPaise - a.pendingPaise || a.clientName.localeCompare(b.clientName),
  );
  return { totalPaise: pendingPaise(invoices), overduePaise: overduePaise(invoices), clients };
}

/* ---------- Coming up ---------- */

export interface ComingUpItem {
  id: string;
  /** `Today` or DD/MM. */
  dateLabel: string;
  title: string;
  client: string;
  chip: 'Overdue' | 'Due today' | 'Due soon' | 'Scheduled';
  tone: AssignmentTone;
}

export interface ComingUp {
  items: ComingUpItem[];
  /** Open assignments, with or without a due date. */
  openCount: number;
}

export function computeComingUp(assignments: readonly AssignmentRow[], today: string, limit = 6): ComingUp {
  const open = openAssignments(assignments);
  const dated = open
    .map((assignment) => ({ assignment, due: assignmentDue(assignment) }))
    .filter((entry) => entry.due !== '')
    .sort((a, b) => a.due.localeCompare(b.due) || a.assignment.title.localeCompare(b.assignment.title));

  const items = dated.slice(0, limit).map(({ assignment, due }): ComingUpItem => {
    const away = daysBetween(today, due);
    const chip: ComingUpItem['chip'] =
      away < 0 ? 'Overdue' : away === 0 ? 'Due today' : away <= 3 ? 'Due soon' : 'Scheduled';
    const tone: AssignmentTone = away <= 0 ? 'danger' : away <= 3 ? 'warning' : 'default';
    return {
      id: assignment.id,
      dateLabel: due === today ? 'Today' : isoToDayMonth(due),
      title: assignment.title,
      client: assignment.client,
      chip,
      tone,
    };
  });
  return { items, openCount: open.length };
}

/* ---------- Open work by person ---------- */

export interface PersonLoad {
  key: string;
  name: string;
  open: number;
  /** Bar width as a percent of the largest count. */
  widthPercent: number;
}

/**
 * Open assignments each person owns, most first. `members` are people who always get a row, even with
 * nothing open (a department's members); without them only owners of open work appear.
 */
export function computeOpenWorkByPerson(
  assignments: readonly AssignmentRow[],
  limit = 6,
  members: readonly { id: string; name: string }[] = [],
): PersonLoad[] {
  const counts = new Map<string, { name: string; open: number }>();
  for (const member of members) counts.set(member.id, { name: member.name, open: 0 });
  for (const assignment of openAssignments(assignments)) {
    const key = assignment.ownerId ?? assignment.owner;
    const entry = counts.get(key) ?? { name: assignment.owner, open: 0 };
    entry.open += 1;
    counts.set(key, entry);
  }
  const people = [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
    .slice(0, limit);
  const largest = people.reduce((max, p) => Math.max(max, p.open), 0);
  return people.map((p) => ({ ...p, widthPercent: largest > 0 ? (p.open / largest) * 100 : 0 }));
}

/* ---------- Recurring schedules ---------- */

export interface RecurringSummary {
  total: number;
  active: number;
  paused: number;
  /** Top categories by active schedule count. */
  categories: Array<{ category: string; active: number }>;
  /** Soonest next due date among active schedules. */
  next: { dueDisplay: string; title: string } | null;
}

export function computeRecurringSummary(
  schedules: readonly RecurringScheduleRecord[],
  categoryLimit = 4,
): RecurringSummary {
  const active = schedules.filter((s) => s.status !== 'Paused');
  const counts = new Map<string, number>();
  for (const schedule of active) {
    counts.set(schedule.category, (counts.get(schedule.category) ?? 0) + 1);
  }
  const categories = [...counts.entries()]
    .map(([category, count]) => ({ category, active: count }))
    .sort((a, b) => b.active - a.active || a.category.localeCompare(b.category))
    .slice(0, categoryLimit);

  const dated = active
    .map((schedule) => ({ schedule, due: toIsoDate(schedule.nextDueDate) }))
    .filter((entry) => entry.due !== '')
    .sort((a, b) => a.due.localeCompare(b.due));
  const first = dated[0];

  return {
    total: schedules.length,
    active: active.length,
    paused: schedules.length - active.length,
    categories,
    next: first ? { dueDisplay: isoToDisplay(first.due), title: first.schedule.title } : null,
  };
}

/* ---------- Needs attention ---------- */

export interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  chip: string;
  tone: AssignmentTone;
}

export interface NeedsAttention {
  /** Every item, in order: overdue work, returned work, overdue fees. */
  all: AttentionItem[];
}

export function computeNeedsAttention(
  assignments: readonly AssignmentRow[],
  invoices: readonly InvoiceRecord[],
  today: string,
): NeedsAttention {
  const overdue = openAssignments(assignments)
    .map((assignment) => ({ assignment, due: assignmentDue(assignment) }))
    .filter((entry) => entry.due !== '' && entry.due < today)
    .sort((a, b) => a.due.localeCompare(b.due));
  const overdueIds = new Set(overdue.map((entry) => entry.assignment.id));
  const returned = openAssignments(assignments).filter(
    (a) => a.status === 'Changes requested' && !overdueIds.has(a.id),
  );
  const overdueBills = invoices
    .filter((i) => i.status === 'Overdue')
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    all: [
      ...overdue.map(({ assignment, due }): AttentionItem => ({
        key: `overdue-${assignment.id}`,
        title: assignment.title,
        detail: assignment.client,
        chip: `${daysBetween(due, today)}d overdue`,
        tone: 'danger',
      })),
      ...returned.map((assignment): AttentionItem => ({
        key: `changes-${assignment.id}`,
        title: assignment.title,
        detail: assignment.client,
        chip: 'Changes requested',
        tone: 'warning',
      })),
      ...overdueBills.map((invoice): AttentionItem => ({
        key: `bill-${invoice.id}`,
        title: invoice.clientName,
        detail: billLabel(invoice),
        chip: formatPaise(invoice.balancePaise),
        tone: 'danger',
      })),
    ],
  };
}

/* ---------- metric strip ---------- */

export interface MetricInput {
  role: CompanyRole;
  actorId: string;
  today: string;
  assignments: readonly AssignmentRow[];
  personalTasks: readonly PersonalTaskRecord[];
  delegatedTasks: readonly DelegatedTaskRecord[];
  assignedToMe: readonly DelegatedTaskRecord[];
  reviewableTasks: readonly DelegatedTaskRecord[];
  invoices: readonly InvoiceRecord[];
  feesState: FeesState;
}

function countTone(count: number, tone: AssignmentTone): AssignmentTone {
  return count > 0 ? tone : 'default';
}

function inProgressNote(count: number): string {
  return `${count} in progress`;
}

function feeTile(invoices: readonly InvoiceRecord[], feesState: FeesState): MetricTile {
  if (feesState === 'loading') return { label: 'Pending fees', value: '—', note: 'Loading fees…', tone: 'default' };
  if (feesState === 'error') {
    return { label: 'Pending fees', value: '—', note: 'Fees could not be loaded', tone: 'default' };
  }
  const overdue = overduePaise(invoices);
  return {
    label: 'Pending fees',
    value: formatPaise(pendingPaise(invoices)),
    note: `${formatPaise(overdue)} overdue`,
    tone: countTone(overdue, 'danger'),
  };
}

/** Open work with a turnaround target that is at risk or past its SLA deadline. */
function slaTile(assignments: readonly AssignmentRow[]): MetricTile {
  const running = openAssignments(assignments).map((a) => a.sla?.status);
  const atRisk = running.filter((status) => status === 'at_risk').length;
  const breached = running.filter((status) => status === 'breached').length;
  return {
    label: 'At risk / breached',
    value: `${atRisk} / ${breached}`,
    note: 'Of open work with a target',
    tone: breached > 0 ? 'danger' : countTone(atRisk, 'warning'),
  };
}

function dueTodayTile(dueToday: number, overdue: number, note: string): MetricTile {
  return {
    label: 'Due today',
    value: String(dueToday),
    note,
    tone: countTone(dueToday + overdue, 'danger'),
  };
}

function personalTiles(tasks: readonly PersonalTaskRecord[]): MetricTile {
  const done = tasks.filter((t) => t.done).length;
  return { label: 'Personal tasks', value: String(tasks.length - done), note: `${done} done`, tone: 'default' };
}

/** The four tiles of a department view, counted over that department's assignments only. */
export function buildDepartmentTiles(assignments: readonly AssignmentRow[], today: string): MetricTile[] {
  const open = openAssignments(assignments);
  const overdue = countOverdue(assignments, today);
  const review = countByStatus(assignments, 'Ready for review');
  return [
    {
      label: 'Open assignments',
      value: String(open.length),
      note: inProgressNote(open.filter((a) => a.status === 'In progress').length),
      tone: 'default',
    },
    dueTodayTile(
      countDueToday(assignments, today),
      overdue,
      overdue > 0 ? `${overdue} overdue` : 'None overdue',
    ),
    {
      label: 'Overdue',
      value: String(overdue),
      note: 'Past their due date',
      tone: countTone(overdue, 'danger'),
    },
    {
      label: 'Waiting for review',
      value: String(review),
      note: 'Founder or Manager action',
      tone: countTone(review, 'warning'),
    },
    slaTile(assignments),
  ];
}

/** Open assignments past their due date, the earliest due first. */
export function overdueAssignments(assignments: readonly AssignmentRow[], today: string): AssignmentRow[] {
  return openAssignments(assignments)
    .map((assignment) => ({ assignment, due: assignmentDue(assignment) }))
    .filter((entry) => entry.due !== '' && entry.due < today)
    .sort((a, b) => a.due.localeCompare(b.due) || a.assignment.title.localeCompare(b.assignment.title))
    .map((entry) => entry.assignment);
}

export function buildMetricTiles(input: MetricInput): MetricTile[] {
  const { role, actorId, today, assignments, invoices, feesState } = input;

  if (role === 'founder' || role === 'manager') {
    const overdueCount = countOverdue(assignments, today);
    const dueTodayTileValue = dueTodayTile(
      countDueToday(assignments, today),
      overdueCount,
      overdueCount > 0 ? `${overdueCount} overdue` : 'None overdue',
    );
    const review = countByStatus(assignments, 'Ready for review');
    const reviewTile: MetricTile = {
      label: 'Waiting for review',
      value: String(review),
      note: 'Founder or Manager action',
      tone: countTone(review, 'warning'),
    };
    if (role === 'manager') {
      const changes = countByStatus(assignments, 'Changes requested');
      return [
        dueTodayTileValue,
        reviewTile,
        {
          label: 'Changes requested',
          value: String(changes),
          note: 'Back with the preparer',
          tone: countTone(changes, 'warning'),
        },
        feeTile(invoices, feesState),
        slaTile(assignments),
      ];
    }
    const open = openAssignments(assignments);
    return [
      dueTodayTileValue,
      {
        label: 'Open assignments',
        value: String(open.length),
        note: inProgressNote(open.filter((a) => a.status === 'In progress').length),
        tone: 'default',
      },
      reviewTile,
      feeTile(invoices, feesState),
      slaTile(assignments),
    ];
  }

  if (role === 'trainee') {
    const open = input.assignedToMe.filter(isOpenTask);
    const dueIso = open.map((task) => taskDueIso(task.due, today));
    const dueToday = dueIso.filter((due) => due === today).length;
    const overdue = dueIso.filter((due) => due !== '' && due < today).length;
    const submitted = input.assignedToMe.filter((t) => t.status === 'Pending Review').length;
    return [
      {
        label: 'Assigned to me',
        value: String(open.length),
        note: inProgressNote(open.filter((t) => t.status === 'In Progress').length),
        tone: 'default',
      },
      dueTodayTile(dueToday, overdue, `${overdue} overdue`),
      {
        label: 'Submitted for review',
        value: String(submitted),
        note: 'Waiting for a reviewer',
        tone: countTone(submitted, 'warning'),
      },
      personalTiles(input.personalTasks),
    ];
  }

  const mine = openAssignments(myAssignments(role, assignments, actorId));
  const dueToday = countDueToday(mine, today);
  const overdue = countOverdue(mine, today);
  const myAssignmentsTile: MetricTile = {
    label: 'My assignments',
    value: String(mine.length),
    note: `${dueToday} due today`,
    tone: 'default',
  };
  const overdueTile: MetricTile = {
    label: 'Overdue',
    value: String(overdue),
    note: 'Past their due date',
    tone: countTone(overdue, 'danger'),
  };
  const delegatedOpen = input.delegatedTasks.filter(isOpenTask);

  if (role === 'senior_staff') {
    const waiting = input.reviewableTasks.length;
    return [
      myAssignmentsTile,
      overdueTile,
      {
        label: 'Waiting for my review',
        value: String(waiting),
        note: 'Delegated work submitted',
        tone: countTone(waiting, 'warning'),
      },
      {
        label: 'Delegated tasks',
        value: String(delegatedOpen.length),
        note: inProgressNote(delegatedOpen.filter((t) => t.status === 'In Progress').length),
        tone: 'default',
      },
      slaTile(mine),
    ];
  }

  return [
    myAssignmentsTile,
    overdueTile,
    { label: 'With others', value: String(delegatedOpen.length), note: 'Delegated by me', tone: 'default' },
    personalTiles(input.personalTasks),
    slaTile(mine),
  ];
}
