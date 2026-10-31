import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DashboardAllocationRow,
  DashboardAssignmentRow,
  DashboardDataSet,
  DashboardInvoiceRow,
  DashboardPaymentRow,
  DashboardRepository,
} from "../dashboard.ts";
import { PracticeHttpError } from "../errors.ts";

type Relation<T> = T | T[] | null;

interface NamedRelation {
  name: string | null;
}

interface OwnerRelation {
  full_name: string | null;
}

interface AssignmentRecord {
  id: string;
  assignment_code: string;
  title: string;
  client_id: string;
  status: string;
  priority: string;
  progress: number | string;
  version: number | string | null;
  internal_due: string | null;
  statutory_due: string | null;
  blocker: string | null;
  client: Relation<NamedRelation>;
  service: Relation<NamedRelation>;
  owner: Relation<OwnerRelation>;
}

interface InvoiceRecord {
  id: string;
  client_id: string;
  invoice_date: string;
  due_date: string | null;
  total: number | string;
  amount_received: number | string;
  status: string;
  client: Relation<NamedRelation>;
}

interface PaymentRecord {
  id: string;
  receipt_date: string;
  amount: number | string;
}

interface AllocationRecord {
  payment_id: string;
  invoice_id: string;
  amount: number | string;
}

interface QueryError {
  message: string;
}

interface PageResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

interface PageQuery<T> extends PromiseLike<PageResult<T>> {
  range(from: number, to: number): PageQuery<T>;
  abortSignal(signal: AbortSignal): PageQuery<T>;
}

function first<T>(relation: Relation<T>): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation;
}

function number(value: number | string | null | undefined, field: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    throw new PracticeHttpError(
      502,
      "INVALID_DATA_SOURCE_VALUE",
      "The practice data source returned an invalid numeric value",
      { field },
    );
  }
  return parsed;
}

function queryFailure(source: string, message: string): PracticeHttpError {
  return new PracticeHttpError(
    502,
    "DATA_SOURCE_ERROR",
    "The practice data source could not complete the dashboard query",
    { source, message },
  );
}

async function fetchAll<T>(
  source: string,
  buildQuery: () => PageQuery<T>,
  signal?: AbortSignal,
): Promise<T[]> {
  const pageSize = 1_000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = buildQuery().range(from, from + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    if (result.error) throw queryFailure(source, result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function createSupabaseDashboardRepository(client: SupabaseClient): DashboardRepository {
  return {
    async load(signal): Promise<DashboardDataSet> {
      const [assignments, invoices, payments, allocations] = await Promise.all([
        fetchAll<AssignmentRecord>(
          "work_assignments",
          () =>
            client
              .from("work_assignments")
              .select(
                [
                  "id",
                  "assignment_code",
                  "title",
                  "client_id",
                  "status",
                  "priority",
                  "progress",
                  "version",
                  "internal_due",
                  "statutory_due",
                  "blocker",
                  "client:clients!work_assignments_client_id_fkey(name)",
                  "service:services!work_assignments_service_id_fkey(name)",
                  "owner:profiles!work_assignments_assigned_staff_fkey(full_name)",
                ].join(","),
              )
              .order("id", { ascending: true }) as unknown as PageQuery<AssignmentRecord>,
          signal,
        ),
        fetchAll<InvoiceRecord>(
          "invoices",
          () =>
            client
              .from("invoices")
              .select(
                [
                  "id",
                  "client_id",
                  "invoice_date",
                  "due_date",
                  "total",
                  "amount_received",
                  "status",
                  "client:clients!invoices_client_id_fkey(name)",
                ].join(","),
              )
              .order("id", { ascending: true }) as unknown as PageQuery<InvoiceRecord>,
          signal,
        ),
        fetchAll<PaymentRecord>(
          "payments",
          () =>
            client
              .from("payments")
              .select("id,receipt_date,amount")
              .order("id", { ascending: true }) as unknown as PageQuery<PaymentRecord>,
          signal,
        ),
        fetchAll<AllocationRecord>(
          "payment_allocations",
          () =>
            client
              .from("payment_allocations")
              .select("payment_id,invoice_id,amount")
              .order("id", { ascending: true }) as unknown as PageQuery<AllocationRecord>,
          signal,
        ),
      ]);

      return {
        assignments: assignments.map((row): DashboardAssignmentRow => ({
          id: row.id,
          assignmentCode: row.assignment_code,
          title: row.title,
          clientId: row.client_id,
          clientName: first(row.client)?.name || "Unknown client",
          serviceName: first(row.service)?.name ?? null,
          ownerName: first(row.owner)?.full_name ?? null,
          status: row.status,
          priority: row.priority,
          progress: number(row.progress, "work_assignments.progress"),
          version: number(row.version || 1, "work_assignments.version"),
          internalDue: row.internal_due,
          statutoryDue: row.statutory_due,
          blocker: row.blocker,
        })),
        invoices: invoices.map((row): DashboardInvoiceRow => ({
          id: row.id,
          clientId: row.client_id,
          clientName: first(row.client)?.name || "Unknown client",
          invoiceDate: row.invoice_date,
          dueDate: row.due_date,
          total: number(row.total, "invoices.total"),
          amountReceived: number(row.amount_received, "invoices.amount_received"),
          status: row.status,
        })),
        payments: payments.map((row): DashboardPaymentRow => ({
          id: row.id,
          receiptDate: row.receipt_date,
          amount: number(row.amount, "payments.amount"),
        })),
        allocations: allocations.map((row): DashboardAllocationRow => ({
          paymentId: row.payment_id,
          invoiceId: row.invoice_id,
          amount: number(row.amount, "payment_allocations.amount"),
        })),
      };
    },
  };
}
