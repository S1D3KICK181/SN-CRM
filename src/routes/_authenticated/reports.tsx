import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Tabs, EmptyState } from "@/components/crm-ui";
import { fmtINR, fmtDate, daysUntil, fyLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";
import { useCrmUser } from "@/hooks/use-crm-user";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

type Group = "work" | "staff" | "financial" | "management";

function downloadCsv(name: string, rows: any[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function ReportShell({ title, description, head, rows, children }: {
  title: string; description: string; head: string[]; rows: any[][]; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description} · {fyLabel()} · Data as on {fmtDate(new Date())} · Asia/Kolkata</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /> Print</Button>
          <Button size="sm" variant="outline" onClick={() => downloadCsv(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, [head, ...rows])}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>
      {children}
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
          {head.map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="py-4 text-sm text-muted-foreground">No data for this report yet.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="py-2 pr-3">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsPage() {
  const [group, setGroup] = useState<Group>("work");

  const { data, isLoading } = useQuery({
    queryKey: ["reports-data"],
    queryFn: async () => {
      const [assignments, tasks, invoices, payments, taxMoney, audits, advisory] = await Promise.all([
        supabase.from("work_assignments").select("*, clients(name), services(name), profiles!work_assignments_assigned_staff_fkey(full_name)"),
        supabase.from("tasks").select("*, profiles!tasks_assignee_fkey(full_name)"),
        supabase.from("invoices").select("*, clients(name)"),
        supabase.from("payments").select("*, clients(name)"),
        supabase.from("client_tax_money").select("*, clients(name)"),
        supabase.from("audit_engagements").select("*, clients(name), audit_findings(*)"),
        supabase.from("advisory_actions").select("*, clients(name)"),
      ]);
      return {
        assignments: assignments.data ?? [], tasks: tasks.data ?? [],
        invoices: invoices.data ?? [], payments: payments.data ?? [],
        taxMoney: taxMoney.data ?? [], audits: audits.data ?? [], advisory: advisory.data ?? [],
      };
    },
  });

  const d = data;

  return (
    <div>
      <PageHeader title="Reports" subtitle="Printable and exportable reports with filters shown on every report" />
      <Tabs value={group} onChange={setGroup} options={[
        { value: "work", label: "Work" }, { value: "staff", label: "Staff" },
        { value: "financial", label: "Financial" }, { value: "management", label: "Management" },
      ]} />
      {isLoading || !d ? <div className="py-10 text-center text-sm text-muted-foreground">Building reports…</div> : (
        <div className="space-y-4">
          {group === "work" && <>
            <ReportShell title="Overdue work" description="Assignments past their statutory/internal deadline" head={["Work", "Client", "Service", "Staff", "Due", "Days late", "Blocker"]}
              rows={d.assignments.filter((a: any) => !["Completed", "Cancelled"].includes(a.status) && (a.statutory_due || a.internal_due) && daysUntil(a.statutory_due ?? a.internal_due)! < 0)
                .map((a: any) => [`${a.assignment_code} ${a.title}`, a.clients?.name, a.services?.name, a.profiles?.full_name ?? "—", fmtDate(a.statutory_due ?? a.internal_due), -daysUntil(a.statutory_due ?? a.internal_due)!, a.blocker ?? "—"])} />
            <ReportShell title="Work awaiting client documents" description="Assignments blocked on document collection" head={["Work", "Client", "Staff", "Blocker"]}
              rows={d.assignments.filter((a: any) => a.status === "Awaiting Client Documents").map((a: any) => [`${a.assignment_code} ${a.title}`, a.clients?.name, a.profiles?.full_name ?? "—", a.blocker ?? "—"])} />
            <ReportShell title="Completed work — this month" description="Work completed in the current calendar month" head={["Work", "Client", "Staff", "Completed on"]}
              rows={d.assignments.filter((a: any) => a.status === "Completed" && a.actual_completion && a.actual_completion.startsWith(new Date().toISOString().slice(0, 7)))
                .map((a: any) => [`${a.assignment_code} ${a.title}`, a.clients?.name, a.profiles?.full_name ?? "—", fmtDate(a.actual_completion)])} />
            <ReportShell title="Service-wise work status" description="Open vs completed work per service" head={["Service", "Open", "Completed"]}
              rows={Object.entries(d.assignments.reduce((acc: any, a: any) => {
                const k = a.services?.name ?? "Other"; acc[k] ??= { open: 0, done: 0 };
                if (a.status === "Completed") acc[k].done++; else if (a.status !== "Cancelled") acc[k].open++;
                return acc;
              }, {})).map(([k, v]: any) => [k, v.open, v.done])} />
          </>}
          {group === "staff" && <>
            <ReportShell title="Staff-wise work" description="Assigned, completed and overdue work per staff member" head={["Staff", "Assigned", "Completed", "Overdue", "Pending review"]}
              rows={Object.entries(d.assignments.reduce((acc: any, a: any) => {
                const k = a.profiles?.full_name ?? "Unassigned"; acc[k] ??= { assigned: 0, done: 0, overdue: 0, review: 0 };
                acc[k].assigned++;
                if (a.status === "Completed") acc[k].done++;
                else if ((a.statutory_due || a.internal_due) && daysUntil(a.statutory_due ?? a.internal_due)! < 0) acc[k].overdue++;
                if (["Pending Internal Review", "Awaiting Client Approval"].includes(a.status)) acc[k].review++;
                return acc;
              }, {})).map(([k, v]: any) => [k, v.assigned, v.done, v.overdue, v.review])} />
            <ReportShell title="Tasks pending review" description="Tasks awaiting manager/senior review" head={["Task", "Assignee", "Due", "Status"]}
              rows={d.tasks.filter((t: any) => t.status === "Pending Review").map((t: any) => [t.title, t.profiles?.full_name ?? "—", fmtDate(t.due_date), t.status])} />
            <p className="text-xs text-muted-foreground">Note: staff performance should weigh workload, complexity, review status and delay reasons — not task counts alone. Use these reports as conversation starters.</p>
          </>}
          {group === "financial" && <>
            <ReportShell title="Monthly invoices vs collections" description="Billed and received amounts by month" head={["Month", "Invoices raised (₹)", "Collections (₹)"]}
              rows={Object.entries((() => {
                const acc: Record<string, any> = {};
                for (const i of d.invoices) {
                  if (["Draft", "Cancelled"].includes(i.status)) continue;
                  const m = i.invoice_date?.slice(0, 7);
                  if (!m) continue;
                  acc[m] ??= { billed: 0, received: 0 };
                  acc[m].billed += i.total; acc[m].received += i.amount_received;
                }
                return acc;
              })()).sort().map(([m, v]: any) => [m, fmtINR(v.billed), fmtINR(v.received)])} />
            <ReportShell title="Client-wise receivables" description="Outstanding balances per client" head={["Client", "Outstanding (₹)"]}
              rows={Object.entries(d.invoices.filter((i: any) => !["Paid", "Draft", "Cancelled"].includes(i.status)).reduce((acc: any, i: any) => {
                const k = i.clients?.name ?? "—"; acc[k] = (acc[k] ?? 0) + (i.total - i.amount_received); return acc;
              }, {})).filter(([, v]: any) => v > 0).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]: any) => [k, fmtINR(v)])} />
            <ReportShell title="Receivable ageing" description="Outstanding by days overdue" head={["Client", "Invoice", "Due date", "Days overdue", "Balance (₹)"]}
              rows={d.invoices.filter((i: any) => ["Unpaid", "Partially Paid", "Overdue"].includes(i.status) && i.total > i.amount_received)
                .map((i: any) => [i.clients?.name ?? "—", i.invoice_number, fmtDate(i.due_date), i.due_date ? -daysUntil(i.due_date)! : 0, fmtINR(i.total - i.amount_received)])} />
            <ReportShell title="Client tax money — received vs paid" description="Statutory money received from clients and paid to authorities" head={["Client", "Period", "Received (₹)", "Paid (₹)", "Pending (₹)"]}
              rows={d.taxMoney.map((t: any) => [t.clients?.name ?? "—", t.tax_period ?? "—", fmtINR(t.amount_received), fmtINR(t.amount_paid), fmtINR(t.amount_received - t.amount_paid)])} />
          </>}
          {group === "management" && <>
            <ReportShell title="Internal audit findings & action tracker" description="Open findings, risk level and corrective action due dates" head={["Client", "Finding", "Risk", "Status", "Target", "Overdue"]}
              rows={d.audits.flatMap((e: any) => (e.audit_findings ?? []).map((f: any) => [e.clients?.name ?? "—", f.title, f.risk_category, f.status, fmtDate(f.target_date), f.target_date && f.status !== "Closed" && daysUntil(f.target_date)! < 0 ? "Yes" : "No"]))} />
            <ReportShell title="L2 client action items" description="Advisory action plan items per client" head={["Client", "Action", "Owner", "Due", "Status"]}
              rows={d.advisory.map((a: any) => [a.clients?.name ?? "—", a.title, a.owner ?? "—", fmtDate(a.due_date), a.status])} />
          </>}
        </div>
      )}
    </div>
  );
}
