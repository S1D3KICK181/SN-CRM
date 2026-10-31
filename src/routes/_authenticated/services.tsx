import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Tabs, Field } from "@/components/crm-ui";
import { fmtINR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, GitBranch } from "lucide-react";

export const Route = createFileRoute("/_authenticated/services")({
  component: ServicesPage,
});

type Tab = "catalogue" | "engagements" | "workflows";
const TABS: { value: Tab; label: string }[] = [
  { value: "catalogue", label: "Service catalogue" },
  { value: "engagements", label: "Engagements" },
  { value: "workflows", label: "Workflow templates" },
];

function ServicesPage() {
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("catalogue");
  return (
    <div>
      <PageHeader title="Services & Engagements" subtitle="Service catalogue, client engagements and workflow templates" />
      <Tabs value={tab} onChange={setTab} options={TABS} />
      {tab === "catalogue" && <Catalogue canEdit={!!user?.isManagement} />}
      {tab === "engagements" && <Engagements canEdit={!!user?.isManagement} />}
      {tab === "workflows" && <Workflows />}
    </div>
  );
}

function Catalogue({ canEdit }: { canEdit: boolean }) {
  const { data: services, isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const { data } = await supabase.from("services").select("*, departments(name)").eq("is_active", true).order("service_group").order("code");
      return data ?? [];
    },
  });
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({ is_recurring: false, billing_frequency: "One-time", default_fee: 0, is_active: true });
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => (await supabase.from("departments").select("*").eq("is_active", true)).data ?? [],
  });

  const groups = (services ?? []).reduce((acc: any, s: any) => {
    (acc[s.service_group] ??= []).push(s);
    return acc;
  }, {});

  const save = async () => {
    if (!form.name?.trim() || !form.code?.trim()) { toast.error("Code and name are required"); return; }
    const { error } = await supabase.from("services").insert({ ...form, default_fee: Number(form.default_fee) || 0, department_id: form.department_id || null });
    if (error) { toast.error(error.message); return; }
    toast.success("Service added");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["services"] });
  };

  return (
    <div>
      {canEdit && <Button className="mb-4" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add service</Button>}
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading catalogue…</div> :
        Object.keys(groups).length === 0 ? <p className="text-sm text-muted-foreground">No services yet.</p> : (
          <div className="space-y-6">
            {Object.entries(groups).map(([group, list]) => (
              <div key={group}>
                <h3 className="mb-2 font-display text-sm font-semibold text-primary">{group}</h3>
                <div className="overflow-x-auto rounded-lg border border-border bg-card">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="px-4 py-2">Code</th><th className="px-4 py-2">Service</th><th className="px-4 py-2">Department</th>
                      <th className="px-4 py-2">Type</th><th className="px-4 py-2">Default fee</th><th className="px-4 py-2">Timeline</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {(list as any[]).map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-2 font-mono text-xs">{s.code}</td>
                          <td className="px-4 py-2 font-medium">{s.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{(s as any).departments?.name ?? "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{s.is_recurring ? `Recurring · ${s.recurrence_frequency}` : "One-time"}</td>
                          <td className="px-4 py-2">{s.default_fee ? fmtINR(s.default_fee) : "—"}</td>
                          <td className="px-4 py-2 text-muted-foreground">{s.timeline_days ? `${s.timeline_days} days` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add service</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Code *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. CU-02" /></Field>
            <Field label="Service name *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Service group"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.service_group ?? "H. Other / Custom Services"} onChange={(e) => setForm({ ...form, service_group: e.target.value })} /></Field>
            <Field label="Department">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.department_id ?? ""} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">—</option>
                {(departments ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default fee (₹)"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.default_fee ?? 0} onChange={(e) => setForm({ ...form, default_fee: e.target.value })} /></Field>
              <Field label="Billing frequency">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.billing_frequency} onChange={(e) => setForm({ ...form, billing_frequency: e.target.value })}>
                  {["Monthly", "Quarterly", "Annual", "One-time", "Milestone"].map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Suggested timeline (days)"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.timeline_days ?? ""} onChange={(e) => setForm({ ...form, timeline_days: e.target.value })} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Add service</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Engagements({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ status: "Active", billing_frequency: "Monthly" });
  const { data: engagements, isLoading } = useQuery({
    queryKey: ["engagements"],
    queryFn: async () => {
      const { data } = await supabase.from("engagements").select("*, clients(name, client_code), services(name)").order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });
  const { data: services } = useQuery({
    queryKey: ["services-all"],
    queryFn: async () => (await supabase.from("services").select("id, name, default_fee, billing_frequency").eq("is_active", true)).data ?? [],
  });

  const save = async () => {
    if (!form.client_id || !form.service_id) { toast.error("Pick a client and a service"); return; }
    const { error } = await supabase.from("engagements").insert({ ...form, agreed_fee: Number(form.agreed_fee) || 0, start_date: form.start_date || new Date().toISOString().slice(0, 10) });
    if (error) { toast.error(error.message); return; }
    toast.success("Engagement created");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["engagements"] });
  };

  return (
    <div>
      {canEdit && <Button className="mb-4" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New engagement</Button>}
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (engagements ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No engagements yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2.5">Engagement</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Service</th>
              <th className="px-4 py-2.5">Fee</th><th className="px-4 py-2.5">Billing</th><th className="px-4 py-2.5">Status</th>
            </tr></thead>
            <tbody className="divide-y">
              {(engagements ?? []).map((e: any) => (
                <tr key={e.id} className="hover:bg-accent/50">
                  <td className="px-4 py-2.5 font-mono text-xs">{e.engagement_code}</td>
                  <td className="px-4 py-2.5 font-medium">{(e as any).clients?.name}{(e as any).clients?.is_demo ? " · Demo" : ""}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{(e as any).services?.name}</td>
                  <td className="px-4 py-2.5">{fmtINR(e.agreed_fee)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{e.billing_frequency}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New engagement</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Client *">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">Select client…</option>
                {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Service *">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.service_id ?? ""} onChange={(e) => {
                const s = (services ?? []).find((x: any) => x.id === e.target.value);
                setForm({ ...form, service_id: e.target.value, agreed_fee: s?.default_fee ?? 0, billing_frequency: s?.billing_frequency ?? "One-time" });
              }}>
                <option value="">Select service…</option>
                {(services ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Agreed fee (₹)"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.agreed_fee ?? 0} onChange={(ev) => setForm({ ...form, agreed_fee: ev.target.value })} /></Field>
              <Field label="Billing frequency">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.billing_frequency} onChange={(ev) => setForm({ ...form, billing_frequency: ev.target.value })}>
                  {["Monthly", "Quarterly", "Annual", "One-time", "Milestone"].map((f) => <option key={f}>{f}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Fee terms"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.fee_terms ?? ""} onChange={(e) => setForm({ ...form, fee_terms: e.target.value })} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Create engagement</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Workflows() {
  const { data: templates } = useQuery({
    queryKey: ["workflow-templates"],
    queryFn: async () => {
      const [{ data: t }, { data: s }] = await Promise.all([
        supabase.from("workflow_templates").select("*").order("name"),
        supabase.from("workflow_stages").select("*").order("position"),
      ]);
      return (t ?? []).map((x: any) => ({ ...x, stages: (s ?? []).filter((st: any) => st.template_id === x.id) }));
    },
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {(templates ?? []).map((t: any) => (
        <div key={t.id} className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            <h3 className="font-display text-sm font-semibold">{t.name}</h3>
          </div>
          <ol className="space-y-1 text-sm text-muted-foreground">
            {t.stages.map((s: any) => (
              <li key={s.id} className="flex gap-2"><span className="font-mono text-xs">{String(s.position).padStart(2, "0")}</span> {s.title}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
