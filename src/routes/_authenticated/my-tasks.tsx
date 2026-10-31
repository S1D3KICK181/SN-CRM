import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Tabs } from "@/components/crm-ui";
import { fmtDate, daysUntil } from "@/lib/format";
import { TASK_STATUSES, PRIORITIES } from "@/lib/crm";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/crm-ui";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-tasks")({
  component: MyTasksPage,
});

type Tab = "today" | "week" | "overdue" | "pending-review" | "completed" | "all";

interface Task {
  id: string; task_code: string; title: string; description: string | null; status: string;
  priority: string; due_date: string | null; progress: number; assignment_id: string | null;
  is_demo: boolean; clients?: { name: string } | null;
}

function NewTaskDialog({ onDone }: { onDone: () => void }) {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ priority: "Medium", status: "Open", assignee: user?.userId });
  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });
  const save = async () => {
    if (!form.title?.trim()) { toast.error("Task title is required"); return; }
    const { error } = await supabase.from("tasks").insert({ ...form });
    if (error) { toast.error(error.message); return; }
    toast.success("Task created");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New task</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Task title *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Due date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.due_date ?? ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          </div>
          <Field label="Client (optional)">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value || null })}>
              <option value="">—</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Create task</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MyTasksPage() {
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("today");
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["my-tasks"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("tasks")
        .select("*, clients(name)")
        .eq("assignee", user!.userId)
        .order("due_date");
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const grouped = useMemo(() => {
    const list = tasks ?? [];
    return {
      today: list.filter((t) => daysUntil(t.due_date) === 0 && t.status !== "Completed"),
      week: list.filter((t) => { const d = daysUntil(t.due_date); return d !== null && d > 0 && d <= 7 && t.status !== "Completed"; }),
      overdue: list.filter((t) => daysUntil(t.due_date)! < 0 && !["Completed", "Cancelled"].includes(t.status)),
      "pending-review": list.filter((t) => t.status === "Pending Review"),
      completed: list.filter((t) => t.status === "Completed"),
      all: list,
    } as Record<Tab, Task[]>;
  }, [tasks]);

  const setStatus = async (t: Task, status: string) => {
    await supabase.from("tasks").update({
      status, progress: status === "Completed" ? 100 : t.progress,
      completed_at: status === "Completed" ? new Date().toISOString() : null,
    }).eq("id", t.id);
    toast.success(`Task marked ${status}`);
    queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
  };

  const TAB_LIST: { value: Tab; label: string; count?: number }[] = [
    { value: "today", label: "Due today", count: grouped.today.length },
    { value: "week", label: "This week", count: grouped.week.length },
    { value: "overdue", label: "Overdue", count: grouped.overdue.length },
    { value: "pending-review", label: "Pending review", count: grouped["pending-review"].length },
    { value: "completed", label: "Completed", count: grouped.completed.length },
    { value: "all", label: "All", count: grouped.all.length },
  ];

  return (
    <div>
      <PageHeader
        title="My Tasks"
        subtitle="Your assigned tasks across all clients and services"
        actions={<NewTaskDialog onDone={() => queryClient.invalidateQueries({ queryKey: ["my-tasks"] })} />}
      />
      <Tabs value={tab} onChange={setTab} options={TAB_LIST} />
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading tasks…</div>
        : grouped[tab].length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
            {tab === "overdue" ? "Nothing overdue. Well done." : "No tasks in this view."}
          </div>
        ) : (
          <div className="space-y-2">
            {grouped[tab].map((t) => {
              const du = daysUntil(t.due_date);
              const late = du !== null && du < 0 && t.status !== "Completed";
              return (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {t.title}
                      <StatusBadge status={t.priority} />
                      {t.is_demo && <span className="text-xs text-muted-foreground">Demo</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {t.task_code} · {(t as any).clients?.name ?? "No client"}
                      {t.assignment_id && <> · <Link to="/assignments/$assignmentId" params={{ assignmentId: t.assignment_id }} className="text-primary hover:underline">open work</Link></>}
                      {t.description ? ` — ${t.description}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={"text-sm " + (late ? "font-medium text-destructive" : "text-muted-foreground")}>{fmtDate(t.due_date)}{late ? ` (${-du!}d late)` : ""}</span>
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={t.status} onChange={(e) => setStatus(t, e.target.value)}>
                      {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
