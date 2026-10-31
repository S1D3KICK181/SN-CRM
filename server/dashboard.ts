import type {
  AssignmentDueState,
  DashboardDto,
  DashboardGetInput,
} from "../src/lib/practice-api/contract.ts";

export interface DashboardAssignmentRow {
  id: string;
  assignmentCode: string;
  title: string;
  clientId: string;
  clientName: string;
  serviceName: string | null;
  ownerName: string | null;
  status: string;
  priority: string;
  progress: number;
  version: number;
  internalDue: string | null;
  statutoryDue: string | null;
  blocker: string | null;
}

export interface DashboardInvoiceRow {
  id: string;
  clientId: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string | null;
  total: number;
  amountReceived: number;
  status: string;
}

export interface DashboardPaymentRow {
  id: string;
  receiptDate: string;
  amount: number;
}

export interface DashboardAllocationRow {
  paymentId: string;
  invoiceId: string;
  amount: number;
}

export interface DashboardDataSet {
  assignments: DashboardAssignmentRow[];
  invoices: DashboardInvoiceRow[];
  payments: DashboardPaymentRow[];
  allocations: DashboardAllocationRow[];
}

export interface DashboardRepository {
  load(signal?: AbortSignal): Promise<DashboardDataSet>;
}

const CLOSED_ASSIGNMENT_STATUSES = new Set(["Completed", "Cancelled"]);
const PENDING_REVIEW_STATUSES = new Set(["Pending Internal Review", "Awaiting Client Approval"]);
const EXCLUDED_INVOICE_STATUSES = new Set(["Draft", "Cancelled"]);
const MONTH_LABEL = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function monthSequence(asOfDate: string, count: number) {
  const asOf = parseIsoDate(asOfDate);
  const points: Array<{ month: string; label: string; billed: number; collected: number }> = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - offset, 1));
    points.push({
      month: date.toISOString().slice(0, 7),
      label: MONTH_LABEL.format(date),
      billed: 0,
      collected: 0,
    });
  }
  return points;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function outstanding(invoice: DashboardInvoiceRow): number {
  return roundMoney(Math.max(0, invoice.total - invoice.amountReceived));
}

function assignmentDueState(dueDate: string | null, asOfDate: string): AssignmentDueState {
  if (!dueDate) return "no_due";
  if (dueDate < asOfDate) return "overdue";
  if (dueDate === asOfDate) return "due_today";
  if (dueDate <= addDays(asOfDate, 7)) return "due_soon";
  return "scheduled";
}

function priorityRank(priority: string): number {
  return ({ Urgent: 0, High: 1, Medium: 2, Low: 3 } as Record<string, number>)[priority] ?? 4;
}

export function buildDashboardDto(
  data: DashboardDataSet,
  input: DashboardGetInput,
  defaultAsOfDate: string,
): DashboardDto {
  const asOfDate = input.asOfDate ?? defaultAsOfDate;
  parseIsoDate(asOfDate);
  const months = input.months ?? 6;
  const currentMonth = monthKey(asOfDate);
  const sevenDaysOut = addDays(asOfDate, 7);

  const openAssignments = data.assignments
    .filter((assignment) => !CLOSED_ASSIGNMENT_STATUSES.has(assignment.status))
    .map((assignment) => {
      const dueDate = assignment.statutoryDue ?? assignment.internalDue;
      return {
        id: assignment.id,
        assignmentCode: assignment.assignmentCode,
        title: assignment.title,
        clientId: assignment.clientId,
        clientName: assignment.clientName,
        serviceName: assignment.serviceName,
        ownerName: assignment.ownerName,
        status: assignment.status,
        priority: assignment.priority,
        progress: assignment.progress,
        version: assignment.version,
        dueDate,
        dueState: assignmentDueState(dueDate, asOfDate),
        blocker: assignment.blocker,
      };
    })
    .sort((a, b) => {
      const dateOrder = (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31");
      return (
        dateOrder ||
        priorityRank(a.priority) - priorityRank(b.priority) ||
        a.title.localeCompare(b.title)
      );
    });

  const activeInvoices = data.invoices.filter(
    (invoice) => invoice.invoiceDate <= asOfDate && !EXCLUDED_INVOICE_STATUSES.has(invoice.status),
  );
  const receivedPayments = data.payments.filter((payment) => payment.receiptDate <= asOfDate);
  const openInvoices = activeInvoices.filter((invoice) => outstanding(invoice) > 0);
  const overdueInvoices = openInvoices.filter(
    (invoice) => invoice.dueDate !== null && invoice.dueDate < asOfDate,
  );
  const dueNextSevenDays = openInvoices.filter(
    (invoice) =>
      invoice.dueDate !== null && invoice.dueDate > asOfDate && invoice.dueDate <= sevenDaysOut,
  );

  const points = monthSequence(asOfDate, months);
  const pointByMonth = new Map(points.map((point) => [point.month, point]));
  for (const invoice of activeInvoices) {
    const point = pointByMonth.get(monthKey(invoice.invoiceDate));
    if (point) point.billed = roundMoney(point.billed + invoice.total);
  }
  // Collections are intentionally grouped from receipts, never from an invoice's
  // cumulative amount_received value. That keeps every receipt in exactly one month.
  for (const payment of receivedPayments) {
    const point = pointByMonth.get(monthKey(payment.receiptDate));
    if (point) point.collected = roundMoney(point.collected + payment.amount);
  }

  const allocatedByPayment = new Map<string, number>();
  for (const allocation of data.allocations) {
    allocatedByPayment.set(
      allocation.paymentId,
      roundMoney((allocatedByPayment.get(allocation.paymentId) ?? 0) + allocation.amount),
    );
  }
  const unallocatedReceipts = receivedPayments.reduce(
    (sum, payment) => sum + Math.max(0, payment.amount - (allocatedByPayment.get(payment.id) ?? 0)),
    0,
  );

  const clients = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      outstanding: number;
      overdue: number;
      invoiceCount: number;
    }
  >();
  for (const invoice of openInvoices) {
    const balance = outstanding(invoice);
    const current = clients.get(invoice.clientId) ?? {
      clientId: invoice.clientId,
      clientName: invoice.clientName,
      outstanding: 0,
      overdue: 0,
      invoiceCount: 0,
    };
    current.outstanding = roundMoney(current.outstanding + balance);
    if (invoice.dueDate !== null && invoice.dueDate < asOfDate) {
      current.overdue = roundMoney(current.overdue + balance);
    }
    current.invoiceCount += 1;
    clients.set(invoice.clientId, current);
  }

  const outstandingFees = roundMoney(
    openInvoices.reduce((sum, invoice) => sum + outstanding(invoice), 0),
  );
  const overdueFees = roundMoney(
    overdueInvoices.reduce((sum, invoice) => sum + outstanding(invoice), 0),
  );

  return {
    asOfDate,
    timezone: "Asia/Kolkata",
    currency: "INR",
    headline: {
      dueToday: openAssignments.filter((assignment) => assignment.dueState === "due_today").length,
      openAssignments: openAssignments.length,
      pendingReview: openAssignments.filter((assignment) =>
        PENDING_REVIEW_STATUSES.has(assignment.status),
      ).length,
      outstandingFees,
      overdueFees,
    },
    collectionsSnapshot: {
      billedThisMonth: roundMoney(
        activeInvoices
          .filter((invoice) => monthKey(invoice.invoiceDate) === currentMonth)
          .reduce((sum, invoice) => sum + invoice.total, 0),
      ),
      collectedThisMonth: roundMoney(
        receivedPayments
          .filter((payment) => monthKey(payment.receiptDate) === currentMonth)
          .reduce((sum, payment) => sum + payment.amount, 0),
      ),
      outstandingFees,
      overdueFees,
      dueNext7Days: roundMoney(
        dueNextSevenDays.reduce((sum, invoice) => sum + outstanding(invoice), 0),
      ),
      unallocatedReceipts: roundMoney(unallocatedReceipts),
      openInvoiceCount: openInvoices.length,
      overdueInvoiceCount: overdueInvoices.length,
    },
    topClientOutstanding: [...clients.values()]
      .sort((a, b) => b.outstanding - a.outstanding || a.clientName.localeCompare(b.clientName))
      .slice(0, 6),
    billingAndCollections: points,
    openAssignments,
  };
}
