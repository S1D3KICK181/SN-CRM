import { useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { PageHeader, StatusBadge } from "@/components/crm-ui";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { fmtINR } from "@/lib/format";
import { getPracticeDashboard, PracticeApiError } from "@/lib/practice-api/client";
import type { AssignmentDueState, DashboardDto } from "@/lib/practice-api/contract";

const RANGE_OPTIONS = [3, 6, 12] as const;

const CHART_CONFIG = {
  billed: {
    label: "Billed",
    color: "var(--dashboard-chart-billed)",
  },
  collected: {
    label: "Collected",
    color: "var(--dashboard-chart-collected)",
  },
} satisfies ChartConfig;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-focus focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-canvas";

function formatCount(value: number): string {
  return value.toLocaleString("en-IN");
}

function formatIsoDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatRefreshTime(value: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatAxisMoney(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function PanelHeader({
  id,
  title,
  description,
  action,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-dashboard-line px-5 py-2.5">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-[0.9375rem] font-semibold text-dashboard-ink">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-5 text-dashboard-muted">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function TextAction({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`dashboard-pressable inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-dashboard-accent hover:bg-dashboard-accent-soft ${focusRing}`}
    >
      {children}
      <ArrowUpRight aria-hidden="true" className="ml-1 h-3.5 w-3.5" strokeWidth={1.8} />
    </Link>
  );
}

function HeadlineStrip({ headline }: { headline: DashboardDto["headline"] }) {
  const items = [
    {
      label: "Due today",
      value: formatCount(headline.dueToday),
      sub: headline.dueToday ? "Action needed today" : "Clear for today",
      to: "/assignments",
      tone: headline.dueToday ? "text-dashboard-warning" : "text-dashboard-positive",
    },
    {
      label: "Open assignments",
      value: formatCount(headline.openAssignments),
      sub: "Across the practice",
      to: "/assignments",
      tone: "text-dashboard-positive",
    },
    {
      label: "Pending review",
      value: formatCount(headline.pendingReview),
      sub: headline.pendingReview ? "Partner action" : "Review queue clear",
      to: "/assignments",
      tone: headline.pendingReview ? "text-dashboard-warning" : "text-dashboard-positive",
    },
    {
      label: "Outstanding fees",
      value: fmtINR(headline.outstandingFees),
      sub: `${fmtINR(headline.overdueFees)} overdue`,
      to: "/receipts",
      tone: headline.overdueFees ? "text-dashboard-negative" : "text-dashboard-positive",
    },
  ] as const;

  return (
    <section aria-label="Practice snapshot" className="grid grid-cols-4 gap-4">
      {items.map((item) => (
        <Link
          key={item.label}
          to={item.to}
          className={`dashboard-panel dashboard-pressable group min-w-0 px-5 py-2.5 hover:border-dashboard-accent-border ${focusRing}`}
        >
          <p className="text-xs font-medium text-dashboard-muted">{item.label}</p>
          <p className="mt-2 truncate font-display text-[1.45rem] font-semibold leading-none tracking-[-0.025em] text-dashboard-ink tabular-nums">
            {item.value}
          </p>
          <p className={`mt-2 truncate text-[0.6875rem] font-semibold ${item.tone}`}>{item.sub}</p>
        </Link>
      ))}
    </section>
  );
}

function CollectionsSnapshot({ snapshot }: { snapshot: DashboardDto["collectionsSnapshot"] }) {
  const items = [
    {
      label: "Billed this month",
      value: fmtINR(snapshot.billedThisMonth),
      sub: "Month to date",
      to: "/billing",
      tone: "text-dashboard-ink",
    },
    {
      label: "Collected this month",
      value: fmtINR(snapshot.collectedThisMonth),
      sub: "Month to date",
      to: "/receipts",
      tone: "text-dashboard-positive",
    },
    {
      label: "Outstanding fees",
      value: fmtINR(snapshot.outstandingFees),
      sub: `${formatCount(snapshot.openInvoiceCount)} open invoices`,
      to: "/receipts",
      tone: "text-dashboard-ink",
    },
    {
      label: "Overdue fees",
      value: fmtINR(snapshot.overdueFees),
      sub: `${formatCount(snapshot.overdueInvoiceCount)} overdue invoices`,
      to: "/receipts",
      tone: snapshot.overdueFees ? "text-dashboard-negative" : "text-dashboard-positive",
    },
    {
      label: "Due next 7 days",
      value: fmtINR(snapshot.dueNext7Days),
      sub: "Expected shortly",
      to: "/receipts",
      tone: "text-dashboard-warning",
    },
    {
      label: "Unallocated receipts",
      value: fmtINR(snapshot.unallocatedReceipts),
      sub: snapshot.unallocatedReceipts ? "Needs allocation" : "Fully reconciled",
      to: "/receipts",
      tone: snapshot.unallocatedReceipts ? "text-dashboard-warning" : "text-dashboard-positive",
    },
  ] as const;

  return (
    <section
      className="dashboard-panel overflow-hidden"
      aria-labelledby="collections-snapshot-title"
    >
      <PanelHeader
        id="collections-snapshot-title"
        title="Collections snapshot"
        description="What moved, what is due, and what still needs reconciliation."
        action={<TextAction to="/receipts">Open receipts</TextAction>}
      />
      <div className="grid grid-cols-3 bg-dashboard-line gap-px">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className={`dashboard-pressable min-w-0 bg-dashboard-panel px-4 py-2.5 hover:bg-dashboard-panel-hover ${focusRing}`}
          >
            <p className="truncate text-[0.6875rem] font-medium text-dashboard-muted">
              {item.label}
            </p>
            <p className={`mt-1.5 truncate text-sm font-semibold tabular-nums ${item.tone}`}>
              {item.value}
            </p>
            <p className="mt-1 truncate text-[0.6875rem] text-dashboard-subtle">{item.sub}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TopClientOutstanding({ clients }: { clients: DashboardDto["topClientOutstanding"] }) {
  return (
    <section className="dashboard-panel overflow-hidden" aria-labelledby="top-client-title">
      <PanelHeader
        id="top-client-title"
        title="Top client outstanding"
        description="Largest open balances, ranked by exposure."
        action={<TextAction to="/clients">View clients</TextAction>}
      />
      {clients.length === 0 ? (
        <ModuleEmpty
          title="No client balances outstanding"
          description="Open client balances will appear here as invoices are issued."
        />
      ) : (
        <ol className="divide-y divide-dashboard-line px-2 py-1">
          {clients.slice(0, 6).map((client, index) => (
            <li key={client.clientId}>
              <Link
                to="/clients/$clientId"
                params={{ clientId: client.clientId }}
                className={`dashboard-pressable grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-3 py-3 hover:bg-dashboard-panel-hover ${focusRing}`}
                aria-label={`${client.clientName}, ${fmtINR(client.outstanding)} outstanding`}
              >
                <span className="text-[0.6875rem] font-semibold text-dashboard-subtle tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-dashboard-ink">
                    {client.clientName}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.6875rem] text-dashboard-muted">
                    {formatCount(client.invoiceCount)} open{" "}
                    {client.invoiceCount === 1 ? "invoice" : "invoices"}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold text-dashboard-ink tabular-nums">
                    {fmtINR(client.outstanding)}
                  </span>
                  <span
                    className={`mt-0.5 block text-[0.6875rem] font-medium tabular-nums ${client.overdue ? "text-dashboard-negative" : "text-dashboard-positive"}`}
                  >
                    {client.overdue ? `${fmtINR(client.overdue)} overdue` : "On schedule"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function BillingAndCollections({
  points,
  months,
  onMonthsChange,
  busy,
}: {
  points: DashboardDto["billingAndCollections"];
  months: (typeof RANGE_OPTIONS)[number];
  onMonthsChange: (value: (typeof RANGE_OPTIONS)[number]) => void;
  busy: boolean;
}) {
  return (
    <section
      className="dashboard-panel overflow-hidden"
      aria-labelledby="billing-collections-title"
    >
      <PanelHeader
        id="billing-collections-title"
        title="Billing & collections"
        description="Monthly fees raised against cash collected."
        action={
          <div className="flex items-center gap-3">
            <RangeControl value={months} onChange={onMonthsChange} busy={busy} />
            <div className="flex items-center gap-3 text-[0.6875rem] font-medium text-dashboard-muted">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full bg-dashboard-chart-billed"
                  aria-hidden="true"
                />
                Billed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full bg-dashboard-chart-collected"
                  aria-hidden="true"
                />
                Collected
              </span>
            </div>
            <TextAction to="/billing">Open billing</TextAction>
          </div>
        }
      />
      {points.length === 0 ? (
        <ModuleEmpty
          title="No billing history yet"
          description="The trend will appear after the first invoice or receipt is recorded."
        />
      ) : (
        <>
          <div className="px-4 pb-1 pt-3">
            <ChartContainer
              config={CHART_CONFIG}
              className="h-28 w-full aspect-auto"
              role="img"
              aria-label="Line chart comparing monthly billed and collected fees"
            >
              <LineChart
                data={points}
                margin={{ top: 6, right: 14, bottom: 0, left: 4 }}
                accessibilityLayer
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--dashboard-chart-grid)"
                  strokeDasharray="3 5"
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={12}
                  minTickGap={24}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tickMargin={10}
                  tickFormatter={formatAxisMoney}
                  width={66}
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--dashboard-chart-cursor)", strokeDasharray: "3 3" }}
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      formatter={(value, name) => (
                        <div className="flex min-w-[10rem] items-center justify-between gap-4">
                          <span className="text-dashboard-muted">
                            {CHART_CONFIG[name as keyof typeof CHART_CONFIG]?.label ?? name}
                          </span>
                          <span className="font-semibold text-dashboard-ink tabular-nums">
                            {fmtINR(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Line
                  type="linear"
                  dataKey="billed"
                  stroke="var(--color-billed)"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4, fill: "var(--color-billed)", strokeWidth: 0 }}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="collected"
                  stroke="var(--color-collected)"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4, fill: "var(--color-collected)", strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </div>
          <details className="group border-t border-dashboard-line px-5 py-2.5 text-xs">
            <summary
              className={`dashboard-pressable w-fit cursor-pointer rounded-md font-semibold text-dashboard-accent ${focusRing}`}
            >
              View chart data as a table
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left">
                <caption className="sr-only">Monthly billing and collections figures</caption>
                <thead className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-dashboard-subtle">
                  <tr className="border-b border-dashboard-line">
                    <th className="pb-2 pr-4">Month</th>
                    <th className="pb-2 pr-4 text-right">Billed</th>
                    <th className="pb-2 text-right">Collected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dashboard-line">
                  {points.map((point) => (
                    <tr key={point.month}>
                      <td className="py-2 pr-4">
                        <Link
                          to="/billing"
                          className={`font-medium text-dashboard-accent hover:underline ${focusRing}`}
                        >
                          {point.label}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-right text-dashboard-ink tabular-nums">
                        {fmtINR(point.billed)}
                      </td>
                      <td className="py-2 text-right text-dashboard-ink tabular-nums">
                        {fmtINR(point.collected)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

const dueStateLabels: Record<AssignmentDueState, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  due_soon: "Due soon",
  scheduled: "Scheduled",
  no_due: "No due date",
};

const dueStateClasses: Record<AssignmentDueState, string> = {
  overdue: "text-dashboard-negative",
  due_today: "text-dashboard-warning",
  due_soon: "text-dashboard-warning",
  scheduled: "text-dashboard-muted",
  no_due: "text-dashboard-subtle",
};

function AllOpenAssignments({ assignments }: { assignments: DashboardDto["openAssignments"] }) {
  return (
    <section className="dashboard-panel overflow-hidden" aria-labelledby="open-assignments-title">
      <PanelHeader
        id="open-assignments-title"
        title="All open assignments"
        description="Live delivery queue across clients, owners, reviews, and deadlines."
        action={<TextAction to="/assignments">Open assignment board</TextAction>}
      />
      {assignments.length === 0 ? (
        <ModuleEmpty
          title="No open assignments"
          description="New client work will appear here as assignments are created."
        />
      ) : (
        <div className="max-h-[34rem] overflow-auto scrollbar-thin">
          <table className="w-full table-fixed text-left text-xs">
            <caption className="sr-only">All open practice assignments</caption>
            <colgroup>
              <col className="w-[25%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[16%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-dashboard-table-head text-[0.6875rem] font-semibold uppercase tracking-[0.055em] text-dashboard-subtle">
              <tr className="border-b border-dashboard-line">
                <th className="px-5 py-3">Assignment</th>
                <th className="px-3 py-3">Client</th>
                <th className="px-3 py-3">Service</th>
                <th className="px-3 py-3">Owner</th>
                <th className="px-3 py-3">Due</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-5 py-3 text-right">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dashboard-line">
              {assignments.map((assignment) => (
                <tr key={assignment.id} className="group hover:bg-dashboard-panel-hover">
                  <td className="px-5 py-3.5">
                    <Link
                      to="/assignments/$assignmentId"
                      params={{ assignmentId: assignment.id }}
                      className={`block max-w-[18rem] rounded-md ${focusRing}`}
                    >
                      <span className="block truncate font-semibold text-dashboard-ink group-hover:text-dashboard-accent">
                        {assignment.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[0.6875rem] text-dashboard-subtle">
                        {assignment.assignmentCode}
                        {assignment.blocker ? ` · Blocked: ${assignment.blocker}` : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3.5">
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: assignment.clientId }}
                      className={`inline-block max-w-[12rem] truncate rounded-md font-medium text-dashboard-ink hover:text-dashboard-accent ${focusRing}`}
                    >
                      {assignment.clientName}
                    </Link>
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-3.5 text-dashboard-muted">
                    {assignment.serviceName ?? "—"}
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-3.5 text-dashboard-muted">
                    {assignment.ownerName ?? "Unassigned"}
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="block font-medium text-dashboard-ink tabular-nums">
                      {assignment.dueDate ? formatIsoDate(assignment.dueDate) : "—"}
                    </span>
                    <span
                      className={`mt-0.5 block text-[0.6875rem] font-medium ${dueStateClasses[assignment.dueState]}`}
                    >
                      {dueStateLabels[assignment.dueState]}
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusBadge status={assignment.status} className="max-w-full truncate" />
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="ml-auto flex w-full min-w-0 items-center justify-end gap-1.5">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-dashboard-progress-track"
                        role="progressbar"
                        aria-label={`${assignment.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={assignment.progress}
                      >
                        <div
                          className="h-full rounded-full bg-dashboard-progress-fill"
                          style={{ width: `${assignment.progress}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-semibold text-dashboard-muted tabular-nums">
                        {assignment.progress}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModuleEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-semibold text-dashboard-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-dashboard-muted">{description}</p>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div aria-label="Loading management dashboard" aria-busy="true" className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="dashboard-panel h-[7.25rem] p-5">
            <div className="h-3 w-24 animate-pulse rounded bg-dashboard-skeleton motion-reduce:animate-none" />
            <div className="mt-4 h-6 w-20 animate-pulse rounded bg-dashboard-skeleton motion-reduce:animate-none" />
            <div className="mt-3 h-2.5 w-28 animate-pulse rounded bg-dashboard-skeleton motion-reduce:animate-none" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <div className="dashboard-panel h-[18rem] animate-pulse bg-dashboard-skeleton-soft motion-reduce:animate-none" />
        <div className="dashboard-panel h-[18rem] animate-pulse bg-dashboard-skeleton-soft motion-reduce:animate-none" />
      </div>
      <div className="dashboard-panel h-[24rem] animate-pulse bg-dashboard-skeleton-soft motion-reduce:animate-none" />
      <div className="dashboard-panel h-[26rem] animate-pulse bg-dashboard-skeleton-soft motion-reduce:animate-none" />
    </div>
  );
}

function DashboardError({ error, retry }: { error: Error; retry: () => void }) {
  const requestId = error instanceof PracticeApiError ? error.requestId : undefined;
  return (
    <section
      className="dashboard-panel border-dashboard-negative-border px-6 py-12 text-center"
      role="alert"
    >
      <p className="font-display text-lg font-semibold text-dashboard-ink">
        Management data is unavailable
      </p>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-dashboard-muted">
        {error.message || "The practice server did not return dashboard data."}
      </p>
      {requestId ? (
        <p className="mt-1 text-[0.6875rem] text-dashboard-subtle">Request ID: {requestId}</p>
      ) : null}
      <button
        type="button"
        onClick={retry}
        className={`dashboard-pressable mt-5 min-h-10 rounded-xl bg-dashboard-accent px-4 text-sm font-semibold text-dashboard-accent-foreground hover:bg-dashboard-accent-hover ${focusRing}`}
      >
        Try again
      </button>
    </section>
  );
}

function RangeControl({
  value,
  onChange,
  busy,
}: {
  value: (typeof RANGE_OPTIONS)[number];
  onChange: (value: (typeof RANGE_OPTIONS)[number]) => void;
  busy: boolean;
}) {
  return (
    <div
      className="inline-flex items-center rounded-xl border border-dashboard-line bg-dashboard-panel p-1"
      aria-label="Billing chart range"
    >
      {RANGE_OPTIONS.map((months) => (
        <button
          key={months}
          type="button"
          onClick={() => onChange(months)}
          aria-pressed={value === months}
          disabled={busy && value === months}
          className={`dashboard-pressable min-h-8 rounded-lg px-3 text-xs font-semibold ${focusRing} ${
            value === months
              ? "bg-dashboard-accent text-dashboard-accent-foreground"
              : "text-dashboard-muted hover:bg-dashboard-panel-hover hover:text-dashboard-ink"
          }`}
        >
          {months}M
        </button>
      ))}
    </div>
  );
}

export function ManagementDashboard({
  firstName,
  subtitle,
}: {
  firstName: string;
  subtitle: string;
}) {
  const [months, setMonths] = useState<(typeof RANGE_OPTIONS)[number]>(6);
  const dashboard = useQuery({
    queryKey: ["practice-dashboard", months],
    queryFn: ({ signal }) => getPracticeDashboard({ months }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: (attempt, error) =>
      attempt < 1 && !(error instanceof PracticeApiError && error.status === 401),
  });

  const refreshLabel = dashboard.data
    ? `As of ${formatIsoDate(dashboard.data.asOfDate)} · ${
        dashboard.isFetching
          ? "updating…"
          : `refreshed ${formatRefreshTime(dashboard.dataUpdatedAt)}`
      }`
    : "Loading live practice data…";

  return (
    <div className="dashboard-enter min-w-0 text-dashboard-ink">
      <PageHeader
        compact
        title={`Good day, ${firstName}`}
        subtitle={subtitle}
        actions={
          <p className="text-xs text-dashboard-muted" aria-live="polite">
            {refreshLabel}
          </p>
        }
      />

      {dashboard.isPending ? (
        <DashboardLoading />
      ) : dashboard.isError ? (
        <DashboardError
          error={dashboard.error instanceof Error ? dashboard.error : new Error("Unknown error")}
          retry={() => void dashboard.refetch()}
        />
      ) : (
        <div className="space-y-4">
          <HeadlineStrip headline={dashboard.data.headline} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
            <CollectionsSnapshot snapshot={dashboard.data.collectionsSnapshot} />
            <TopClientOutstanding clients={dashboard.data.topClientOutstanding} />
          </div>
          <BillingAndCollections
            points={dashboard.data.billingAndCollections}
            months={months}
            onMonthsChange={setMonths}
            busy={dashboard.isFetching}
          />
          <AllOpenAssignments assignments={dashboard.data.openAssignments} />
        </div>
      )}
    </div>
  );
}
