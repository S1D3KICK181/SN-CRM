import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Field, EmptyState, StatCard, ConfirmButton } from "@/components/crm-ui";
import { fmtDate, daysUntil } from "@/lib/format";
import { RISK_CATEGORIES, FINDING_STATUSES } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/internal-audit")({
  component: AuditPage,
});

function AuditPage() {
  const { user } = useCrmUser();
  if (!user?.isManagement) {
    return <EmptyState title="Internal Audit is confidential" hint="Audit engagements and findings are visible to the Founder and Department Heads only." />;
  }
  return <AuditContent />;
}

function AuditContent() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ status: "Open" });

  const { data: engagements, isLoading } = useQuery({
    queryKey: ["audit-engagements"],
    queryFn: async () => {
      const { data } = await supabase.from("audit_engagements")
        .select("*, clients(name, client_code), audit_findings(*)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });

  const openFindings = (engagements ?? []).flatMap((e: any) => e.audit_findings ?? []).filter((f: any) => f.status !== "Closed" && f.status !== "Verified");
  const overdueActions = openFindings.filter((f: any) => f.target_date && daysUntil(f.target_date)! < 0);

  const save = async () => {
    if (!form.client_id || !form.audit_period) { toast.error("Client and audit period are required"); return; }
    const { error } = await supabase.from("audit_engagements").insert({ ...form, is_demo: false });
    if (error) { toast.error(error.message); return; }
    toast.success("Audit engagement created");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["audit-engagements"] });
  };

  return (
    <div>
      <PageHeader title="Internal Audit" subtitle="Audit engagements, findings and corrective actions" actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New audit engagement</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open findings" value={openFindings.length} />
        <StatCard label="Overdue actions" value={overdueActions.length} tone={overdueActions.length ? "danger" : "default"} />
        <StatCard label="High/Critical" value={openFindings.filter((f: any) => ["High", "Critical"].includes(f.risk_category)).length} />
        <StatCard label="Active engagements" value={(engagements ?? []).filter((e: any) => e.status !== "Completed").length} />
      </div>
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (engagements ?? []).length === 0 ? (
        <EmptyState title="No audit engagements" hint="Create the first audit engagement for a client." />
      ) : (
        <div className="space-y-4">
          {(engagements ?? []).map((e: any) => (
            <div key={e.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-display text-sm font-semibold">{(e as any).clients?.name} — {e.audit_period}{e.is_demo ? " · Demo" : ""}</div>
                  <div className="text-xs text-muted-foreground">Team: {e.team ?? "—"} · Visits: {e.visit_dates ?? "—"} · Report: {e.report_version ?? "—"}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Scope: {e.scope ?? "—"} · Areas: {e.areas_reviewed ?? "—"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={e.status} onChange={async (ev) => {
                    await supabase.from("audit_engagements").update({ status: ev.target.value }).eq("id", e.id);
                    queryClient.invalidateQueries({ queryKey: ["audit-engagements"] });
                  }}>
                    {["Open", "In Progress", "Completed", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3">
                <FindingsPanel engagement={e} />
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New audit engagement</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Client *">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">Select client…</option>
                {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Audit period *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="e.g. Q3 FY 2026-27" value={form.audit_period ?? ""} onChange={(e) => setForm({ ...form, audit_period: e.target.value })} /></Field>
            <Field label="Scope"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.scope ?? ""} onChange={(e) => setForm({ ...form, scope: e.target.value })} /></Field>
            <Field label="Team"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.team ?? ""} onChange={(e) => setForm({ ...form, team: e.target.value })} /></Field>
            <Field label="Visit dates"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.visit_dates ?? ""} onChange={(e) => setForm({ ...form, visit_dates: e.target.value })} /></Field>
            <Field label="Areas reviewed"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.areas_reviewed ?? ""} onChange={(e) => setForm({ ...form, areas_reviewed: e.target.value })} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FindingsPanel({ engagement }: { engagement: any }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ risk_category: "Medium", status: "Open" });
  const findings = engagement.audit_findings ?? [];

  const save = async () => {
    if (!form.title) { toast.error("Finding title is required"); return; }
    const { error } = await supabase.from("audit_findings").insert({ ...form, engagement_id: engagement.id, is_demo: false });
    if (error) { toast.error(error.message); return; }
    toast.success("Finding added");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["audit-engagements"] });
  };

  const update = async (f: any, values: any) => {
    await supabase.from("audit_findings").update({
      ...values,
      closed_at: values.status === "Closed" ? new Date().toISOString() : null,
    }).eq("id", f.id);
    queryClient.invalidateQueries({ queryKey: ["audit-engagements"] });
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Findings ({findings.filter((f: any) => f.status !== "Closed").length} open)</span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add finding</Button>
      </div>
      {findings.length === 0 ? <p className="text-sm text-muted-foreground">No findings recorded.</p> : (
        <div className="space-y-2">
          {findings.map((f: any) => {
            const late = f.target_date && daysUntil(f.target_date)! < 0 && f.status !== "Closed";
            return (
              <div key={f.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={f.risk_category} />
                    <span className="font-medium">{f.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={"text-xs" + (late ? " text-destructive" : " text-muted-foreground")}>Target: {fmtDate(f.target_date)}{late ? " (overdue)" : ""}</span>
                    <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={f.status} onChange={(e) => update(f, { status: e.target.value })}>
                      {FINDING_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                {f.description && <p className="mt-1 text-muted-foreground">{f.description}</p>}
                <div className="mt-1 text-xs text-muted-foreground">
                  {f.recommendation && <>Recommendation: {f.recommendation}. </>}
                  {f.management_response && <>Response: {f.management_response}. </>}
                  {f.responsible_person && <>Owner: {f.responsible_person}. </>}
                  {f.reference && <>Ref: {f.reference}</>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add finding</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Finding title *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Risk category">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.risk_category} onChange={(e) => setForm({ ...form, risk_category: e.target.value })}>
                  {RISK_CATEGORIES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Evidence reference"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.reference ?? ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            </div>
            <Field label="Recommendation"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.recommendation ?? ""} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Responsible person"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.responsible_person ?? ""} onChange={(e) => setForm({ ...form, responsible_person: e.target.value })} /></Field>
              <Field label="Target date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.target_date ?? ""} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Add finding</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
