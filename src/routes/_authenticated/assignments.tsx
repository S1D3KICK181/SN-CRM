import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, EmptyState } from "@/components/crm-ui";
import { fmtDate, daysUntil, fmtINR } from "@/lib/format";
import { ASSIGNMENT_STATUSES, PRIORITIES } from "@/lib/crm";
import { Link } from "@tanstack/react-router";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/assignments")({
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const { user } = useCrmUser();
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [staff, setStaff] = useState("");
  const [view, setView] = useState<"list" | "board">("list");

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["assignments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_assignments")
        .select("*, clients(name, client_code), services(name), profiles!work_assignments_assigned_staff_fkey(full_name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(() => {
    let list = assignments ?? [];
    if (status) list = list.filter((a) => a.status === status);
    if (priority) list = list.filter((a) => a.priority === priority);
    if (staff === "mine") list = list.filter((a) => a.assigned_staff === user?.userId);
    else if (staff) list = list.filter((a) => a.assigned_staff === staff);
    return list;
  }, [assignments, status, priority, staff, user]);

  const boardGroups = ["New", "Awaiting Client Documents", "In Progress", "Pending Internal Review", "Ready for Filing / Submission", "Completed"];

  return (
    <div>
      <PageHeader
        title="Work Assignments"
        subtitle={`${filtered.length} assignment(s)`}
        actions={
          <div className="flex rounded-lg bg-muted p-1 text-sm">
            <button className={"rounded-md px-3 py-1.5 " + (view === "list" ? "bg-card shadow-sm" : "text-muted-foreground")} onClick={() => setView("list")}>List</button>
            <button className={"rounded-md px-3 py-1.5 " + (view === "board" ? "bg-card shadow-sm" : "text-muted-foreground")} onClick={() => setView("board")}>Board</button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{ASSIGNMENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={priority || "all"} onValueChange={(v) => setPriority(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All priorities" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All priorities</SelectItem>{PRIORITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={staff || "all"} onValueChange={(v) => setStaff(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Everyone" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="mine">Assigned to me</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading assignments…</div>
        : filtered.length === 0 ? <EmptyState title="No assignments match" hint="Adjust filters, or create work from a client engagement." />
        : view === "list" ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5">Work</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5">Staff</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Priority</th>
                <th className="px-4 py-2.5">Progress</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Fee</th>
              </tr></thead>
              <tbody className="divide-y">
                {filtered.map((a) => {
                  const du = daysUntil(a.statutory_due ?? a.internal_due);
                  const late = du !== null && du < 0 && !["Completed", "Cancelled"].includes(a.status);
                  return (
                    <tr key={a.id} className="hover:bg-accent/50">
                      <td className="px-4 py-2.5">
                        <Link to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="font-medium text-primary hover:underline">{a.title}</Link>
                        <div className="text-xs text-muted-foreground">{a.assignment_code}{a.is_demo ? " · Demo" : ""}</div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{(a as any).clients?.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{(a as any).services?.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{(a as any).profiles?.full_name ?? "Unassigned"}</td>
                      <td className={"px-4 py-2.5" + (late ? " font-medium text-destructive" : "")}>{fmtDate(a.statutory_due ?? a.internal_due)}</td>
                      <td className="px-4 py-2.5">{a.priority}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${a.progress}%` }} /></div>
                          <span className="text-xs text-muted-foreground">{a.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{a.agreed_fee ? fmtINR(a.agreed_fee) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {boardGroups.map((g) => {
              const items = filtered.filter((a) => a.status === g);
              return (
                <div key={g} className="w-72 shrink-0 rounded-lg bg-muted/60 p-2">
                  <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g} ({items.length})</div>
                  <div className="space-y-2">
                    {items.map((a) => (
                      <Link key={a.id} to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="block rounded-md border border-border bg-card p-3 text-sm hover:shadow-sm">
                        <div className="font-medium leading-snug">{a.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{(a as any).clients?.name} · {(a as any).profiles?.full_name ?? "Unassigned"}</div>
                        <div className="mt-2 flex items-center justify-between">
                          <StatusBadge status={a.priority} />
                          <span className={"text-xs" + (daysUntil(a.statutory_due ?? a.internal_due)! < 0 ? " text-destructive" : " text-muted-foreground")}>{fmtDate(a.statutory_due ?? a.internal_due)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
