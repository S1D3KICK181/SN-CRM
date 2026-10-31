import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, EmptyState } from "@/components/crm-ui";
import { ManagementDashboard } from "@/components/dashboard/management-dashboard";
import { fmtINR, fmtDate, daysUntil, fyLabel } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

export interface Assignment {
  id: string;
  assignment_code: string;
  title: string;
  status: string;
  priority: string;
  client_id: string;
  work_period: string | null;
  internal_due: string | null;
  statutory_due: string | null;
  progress: number;
  assigned_staff: string | null;
  blocker: string | null;
  is_demo: boolean;
  follow_up_on: string | null;
  clients?: { name: string; client_code: string } | null;
  services?: { name: string } | null;
  profiles?: { full_name: string } | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  total: number;
  amount_received: number;
  status: string;
  invoice_date: string;
  due_date: string | null;
  clients?: { name: string } | null;
}

interface DashboardTask {
  id: string;
  task_code: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  progress: number;
  is_demo: boolean;
}

interface LedgerMetric {
  label: string;
  value: ReactNode;
  sub?: string | undefined;
  to: string;
  tone?: "danger" | undefined;
}

function MetricLedger({
  title,
  description,
  metrics,
  compact = false,
}: {
  title: string;
  description: string;
  metrics: LedgerMetric[];
  compact?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-border">
      <div className="bg-card px-4 py-3">
        <h2 className="font-display text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div
        className={compact ? "grid grid-cols-2 gap-px" : "grid grid-cols-2 gap-px sm:grid-cols-4"}
      >
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            to={metric.to}
            className="control-motion min-w-0 bg-card p-4 hover:bg-accent/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div
              className={
                metric.tone === "danger"
                  ? "text-xs font-medium text-destructive"
                  : "text-xs font-medium text-muted-foreground"
              }
            >
              {metric.label}
            </div>
            <div
              className={
                metric.tone === "danger"
                  ? "mt-1 truncate font-display text-xl font-semibold tabular-nums text-destructive"
                  : "mt-1 truncate font-display text-xl font-semibold tabular-nums text-foreground"
              }
            >
              {metric.value}
            </div>
            {metric.sub && (
              <div className="mt-1 truncate text-xs text-muted-foreground">{metric.sub}</div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

function useDashData() {
  const { user } = useCrmUser();
  return useQuery({
    queryKey: ["dashboard"],
    enabled: !!user,
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      const ms = monthStart.toISOString().slice(0, 10);

      const [assignments, clients, engagements, invoices, myTasks, docPending] = await Promise.all([
        supabase
          .from("work_assignments")
          .select(
            "id, assignment_code, title, status, priority, client_id, work_period, internal_due, statutory_due, progress, assigned_staff, blocker, is_demo, follow_up_on, clients(name, client_code), services(name), profiles!work_assignments_assigned_staff_fkey(full_name)",
          ),
        supabase.from("clients").select("id, status, name"),
        supabase.from("engagements").select("id, status"),
        supabase
          .from("invoices")
          .select(
            "id, invoice_number, client_id, total, amount_received, status, invoice_date, due_date, clients(name)",
          ),
        user!.userId
          ? supabase
              .from("tasks")
              .select("id, task_code, title, status, priority, due_date, progress, is_demo")
              .eq("assignee", user!.userId)
          : Promise.resolve({ data: [] }),
        supabase
          .from("document_items")
          .select("id, status")
          .in("status", ["Requested", "Partially Received"]),
      ]);
      return {
        assignments: (assignments.data ?? []) as Assignment[],
        clients: clients.data ?? [],
        engagements: engagements.data ?? [],
        invoices: (invoices.data ?? []) as Invoice[],
        myTasks: myTasks.data ?? [],
        docPendingCount: (docPending.data ?? []).length,
      };
    },
  });
}

function FounderDashboard() {
  const { data, isLoading } = useDashData();
  if (isLoading || !data)
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">Loading dashboard…</div>
    );

  const open = data.assignments.filter((a) => !["Completed", "Cancelled"].includes(a.status));
  const dueIn = (d: number) =>
    open.filter((a) => {
      const du = daysUntil(a.statutory_due ?? a.internal_due);
      return du !== null && du >= 0 && du <= d;
    }).length;
  const overdue = open.filter((a) => {
    const du = daysUntil(a.statutory_due ?? a.internal_due);
    return du !== null && du < 0;
  });
  const monthStart = new Date();
  monthStart.setDate(1);
  const ms = monthStart.toISOString().slice(0, 10);
  const invoicesThisMonth = data.invoices.filter(
    (i) => i.invoice_date >= ms && i.status !== "Draft",
  );
  const collectedThisMonth = data.invoices
    .filter((i) => i.status !== "Draft")
    .reduce((s, i) => s + (i.amount_received ?? 0), 0);
  const outstanding = data.invoices
    .filter((i) => !["Paid", "Draft", "Cancelled"].includes(i.status))
    .reduce((s, i) => s + (i.total - i.amount_received), 0);
  const overdueReceivables = data.invoices
    .filter(
      (i) =>
        ["Unpaid", "Partially Paid", "Overdue"].includes(i.status) &&
        i.due_date &&
        daysUntil(i.due_date)! < 0,
    )
    .reduce((s, i) => s + (i.total - i.amount_received), 0);

  // Department workload
  const deptCount: Record<string, { open: number; done: number }> = {};
  for (const a of data.assignments) {
    const key = a.services?.name ?? "Other";
    deptCount[key] ??= { open: 0, done: 0 };
    if (a.status === "Completed") deptCount[key].done++;
    else deptCount[key].open++;
  }
  const topDepts = Object.entries(deptCount)
    .sort((x, y) => y[1].open - x[1].open)
    .slice(0, 6);
  const clientOutstanding = Object.values(
    data.invoices
      .filter((i) => !["Paid", "Draft", "Cancelled"].includes(i.status))
      .reduce(
        (acc, i) => {
          const name = i.clients?.name ?? "—";
          acc[name] ??= { name, due: 0 };
          acc[name].due += i.total - i.amount_received;
          return acc;
        },
        {} as Record<string, { name: string; due: number }>,
      ),
  )
    .sort((a, b) => b.due - a.due)
    .slice(0, 6);

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <MetricLedger
          title="Practice operations"
          description="Client work and statutory deadlines"
          metrics={[
            {
              label: "Active clients",
              value: data.clients.filter((c) => c.status === "Active").length,
              to: "/clients",
            },
            {
              label: "Active engagements",
              value: data.engagements.filter((e) => e.status === "Active").length,
              to: "/services",
            },
            { label: "Open work", value: open.length, to: "/assignments" },
            { label: "Due today", value: dueIn(0), to: "/assignments" },
            { label: "Due next 7 days", value: dueIn(7), to: "/assignments" },
            {
              label: "Overdue work",
              value: overdue.length,
              to: "/assignments",
              tone: overdue.length ? "danger" : undefined,
            },
            {
              label: "Awaiting client docs",
              value: data.assignments.filter((a) => a.status === "Awaiting Client Documents")
                .length,
              to: "/assignments",
            },
            {
              label: "Pending review",
              value: data.assignments.filter((a) =>
                ["Pending Internal Review", "Awaiting Client Approval"].includes(a.status),
              ).length,
              to: "/assignments",
            },
          ]}
        />
        <MetricLedger
          title="Billing & collections"
          description="Fees billed and money due"
          compact
          metrics={[
            {
              label: "Invoices this month",
              value: fmtINR(invoicesThisMonth.reduce((s, i) => s + i.total, 0)),
              sub: `${invoicesThisMonth.length} invoices`,
              to: "/billing",
            },
            {
              label: "Collected",
              value: fmtINR(collectedThisMonth),
              sub: "All recorded receipts",
              to: "/receipts",
            },
            { label: "Outstanding fees", value: fmtINR(outstanding), to: "/receipts" },
            {
              label: "Overdue receivables",
              value: fmtINR(overdueReceivables),
              to: "/receipts",
              tone: overdueReceivables > 0 ? "danger" : undefined,
            },
          ]}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Service workload</h2>
          {topDepts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assignments yet.</p>
          ) : (
            <div className="space-y-2.5">
              {topDepts.map(([name, v]) => {
                const total = v.open + v.done;
                return (
                  <div key={name}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate pr-2 text-foreground">{name}</span>
                      <span className="text-muted-foreground">
                        {v.open} open · {v.done} done
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${total ? (v.done / total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Top client outstanding</h2>
          {clientOutstanding.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding. All settled.</p>
          ) : (
            <div className="space-y-1">
              {clientOutstanding.map((c) => (
                <div key={c.name} className="flex items-center justify-between py-1.5 text-sm">
                  <span>{c.name}</span>
                  <span className="font-medium text-destructive">{fmtINR(c.due)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <WorkNeedingAttention assignments={data.assignments} />
    </>
  );
}

function WorkNeedingAttention({ assignments }: { assignments: Assignment[] }) {
  const attention = assignments
    .filter((a) => !["Completed", "Cancelled"].includes(a.status))
    .filter((a) => {
      const du = daysUntil(a.statutory_due ?? a.internal_due);
      return (du !== null && du <= 7) || a.blocker;
    })
    .sort(
      (a, b) =>
        (daysUntil(a.statutory_due ?? a.internal_due) ?? 99) -
        (daysUntil(b.statutory_due ?? b.internal_due) ?? 99),
    )
    .slice(0, 8);

  return (
    <div className="mt-6 rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">
          Work needing attention (next 7 days / blocked)
        </h2>
        <Link to="/assignments" className="text-xs font-medium text-primary hover:underline">
          View all →
        </Link>
      </div>
      {attention.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing urgent. Good week ahead.</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-ui="attention-table" className="w-full min-w-[640px] text-sm">
            <thead>
              <tr
                data-taste-skill-ignore="real-table-rule"
                className="taste-skill-ignore border-b text-left text-xs font-medium text-muted-foreground"
              >
                <th className="pb-2 pr-3">Work</th>
                <th className="pb-2 pr-3">Client</th>
                <th className="pb-2 pr-3">Due</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2">Blocker</th>
              </tr>
            </thead>
            <tbody data-taste-skill-ignore="real-table-rows" className="divide-y">
              {attention.map((a) => {
                const du = daysUntil(a.statutory_due ?? a.internal_due);
                return (
                  <tr key={a.id} className="align-top">
                    <td className="py-2 pr-3">
                      <Link
                        to="/assignments/$assignmentId"
                        params={{ assignmentId: a.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {a.assignment_code} · {a.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{a.clients?.name}</td>
                    <td className="py-2 pr-3">
                      <span className={du !== null && du < 0 ? "font-medium text-destructive" : ""}>
                        {fmtDate(a.statutory_due ?? a.internal_due)}
                      </span>
                      {du !== null && du < 0 && (
                        <span className="ml-1 text-xs text-destructive">({-du}d late)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="py-2 max-w-[220px] text-xs text-muted-foreground">
                      {a.blocker ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StaffDashboard() {
  const { data, isLoading } = useDashData();
  const { user } = useCrmUser();
  if (isLoading || !data)
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">Loading dashboard…</div>
    );

  const mine = data.myTasks as DashboardTask[];
  const today = mine.filter((t) => daysUntil(t.due_date) === 0 && t.status !== "Completed");
  const week = mine.filter((t) => {
    const d = daysUntil(t.due_date);
    return d !== null && d > 0 && d <= 7 && t.status !== "Completed";
  });
  const late = mine.filter(
    (t) => daysUntil(t.due_date)! < 0 && !["Completed", "Cancelled"].includes(t.status),
  );
  const pendingReview = mine.filter((t) => t.status === "Pending Review");
  const done = mine.filter((t) => t.status === "Completed");

  const myOpenAssignments = data.assignments.filter(
    (a) => a.assigned_staff === user!.userId && !["Completed", "Cancelled"].includes(a.status),
  );

  return (
    <>
      <MetricLedger
        title="My workload"
        description="What needs attention across your assigned work"
        metrics={[
          { label: "Due today", value: today.length, to: "/my-tasks" },
          { label: "Due this week", value: week.length, to: "/my-tasks" },
          {
            label: "Overdue",
            value: late.length,
            to: "/my-tasks",
            tone: late.length ? "danger" : undefined,
          },
          {
            label: "Awaiting client docs",
            value: myOpenAssignments.filter((a) => a.status === "Awaiting Client Documents").length,
            to: "/my-tasks",
          },
          { label: "Pending review", value: pendingReview.length, to: "/my-tasks" },
          { label: "Completed", value: done.length, to: "/my-tasks" },
        ]}
      />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">My open work</h2>
          {myOpenAssignments.length === 0 ? (
            <EmptyState title="No open work assigned" hint="Your manager will assign work here." />
          ) : (
            <div className="space-y-1">
              {myOpenAssignments.slice(0, 6).map((a) => (
                <Link
                  key={a.id}
                  to="/assignments/$assignmentId"
                  params={{ assignmentId: a.id }}
                  className="control-motion -mx-2 flex min-h-10 items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 truncate pr-3">
                    {a.assignment_code} · {a.title}
                  </span>
                  <StatusBadge status={a.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Upcoming client follow-ups</h2>
          <UpcomingFollowUps
            assignments={data.assignments.filter((a) => a.assigned_staff === user!.userId)}
          />
        </div>
      </div>
      <WorkNeedingAttention assignments={myOpenAssignments} />
    </>
  );
}

function UpcomingFollowUps({ assignments }: { assignments: Assignment[] }) {
  const items = assignments
    .filter((a) => a.follow_up_on)
    .sort((a, b) => a.follow_up_on!.localeCompare(b.follow_up_on!))
    .slice(0, 6);
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No follow-ups scheduled.</p>;
  return (
    <div className="space-y-1">
      {items.map((a) => (
        <div key={a.id} className="flex min-h-10 items-center justify-between py-2 text-sm">
          <Link
            to="/assignments/$assignmentId"
            params={{ assignmentId: a.id }}
            className="min-w-0 truncate pr-3 text-primary hover:underline"
          >
            {a.title}
          </Link>
          <span className="shrink-0 text-muted-foreground">{fmtDate(a.follow_up_on)}</span>
        </div>
      ))}
    </div>
  );
}

function Dashboard() {
  const { user, loading } = useCrmUser();
  if (loading || !user)
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;

  const subtitle = `${fyLabel()} · Asia/Kolkata · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`;

  if (user.isManagement) {
    return <ManagementDashboard firstName={user.fullName} subtitle={subtitle} />;
  }

  return (
    <div>
      <PageHeader title={`Good day, ${user.fullName.split(" ")[0]}`} subtitle={subtitle} />
      <StaffDashboard />
    </div>
  );
}
