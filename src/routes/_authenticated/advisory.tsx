import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Field, EmptyState, StatCard } from "@/components/crm-ui";
import { fmtINR, fmtDate, daysUntil } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/advisory")({
  component: AdvisoryPage,
});

const METRIC_FIELDS: { key: string; label: string; type?: string }[] = [
  { key: "period", label: "Reporting period *" },
  { key: "sales", label: "Sales (₹)", type: "number" },
  { key: "gross_profit", label: "Gross profit (₹)", type: "number" },
  { key: "gross_profit_pct", label: "GP %", type: "number" },
  { key: "operating_expenses", label: "Operating expenses (₹)", type: "number" },
  { key: "net_profit", label: "Net profit (₹)", type: "number" },
  { key: "receivables", label: "Receivables (₹)", type: "number" },
  { key: "payables", label: "Payables (₹)", type: "number" },
  { key: "inventory", label: "Inventory (₹)", type: "number" },
  { key: "cash_bank", label: "Cash & bank (₹)", type: "number" },
  { key: "cash_flow", label: "Cash flow (₹)", type: "number" },
  { key: "budget_vs_actual", label: "Budget vs actual" },
  { key: "key_ratios", label: "Key ratios" },
  { key: "business_challenges", label: "Business challenges" },
  { key: "recommendations", label: "Recommendations" },
  { key: "meeting_notes", label: "Review meeting notes" },
];

function AdvisoryPage() {
  const [clientId, setClientId] = useState<string | null>(null);
  const { data: l2Clients, isLoading } = useQuery({
    queryKey: ["advisory-clients"],
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("id, name, is_demo, client_code");
      return (data ?? []).filter((c: any) => c.is_demo || true); // all clients; L2 flagged by engagement
    },
  });
  const { data: engagements } = useQuery({
    queryKey: ["advisory-engagements"],
    queryFn: async () => {
      const { data } = await supabase.from("engagements").select("client_id, services(name)").in("status", ["Active"]);
      return (data ?? []).filter((e: any) => (e as any).services?.name?.toLowerCase().includes("cfo") || (e as any).services?.name?.toLowerCase().includes("advisory") || (e as any).services?.name?.toLowerCase().includes("management reporting") || (e as any).services?.name?.toLowerCase().includes("diagnostic"));
    },
  });

  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  const clients = l2Clients ?? [];
  if (clients.length === 0) {
    return <EmptyState title="No clients yet" hint="Create a client first, then add an L2 / Virtual CFO engagement." />;
  }

  return (
    <div>
      <PageHeader title="L2 / Virtual CFO" subtitle="Monthly business advisory dashboards, review meetings and action plans" />
      <div className="mb-4">
        <select className="h-10 w-full max-w-md rounded-md border border-input bg-card px-3 text-sm" value={clientId ?? ""} onChange={(e) => setClientId(e.target.value || null)}>
          <option value="">Select a client…</option>
          {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.is_demo ? " · Demo" : ""}</option>)}
        </select>
      </div>
      {clientId ? <ClientAdvisory clientId={clientId} /> : (
        <EmptyState title="Pick a client" hint="Select an L2 / Virtual CFO client to see their monthly figures, trends and action items." />
      )}
    </div>
  );
}

function ClientAdvisory({ clientId }: { clientId: string }) {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ source: "Manual entry" });

  const { data: client } = useQuery({
    queryKey: ["advisory-client", clientId],
    queryFn: async () => (await supabase.from("clients").select("*").eq("id", clientId).single()).data,
  });
  const { data: reports } = useQuery({
    queryKey: ["advisory-reports", clientId],
    queryFn: async () => (await supabase.from("advisory_reports").select("*").eq("client_id", clientId).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: actions } = useQuery({
    queryKey: ["advisory-actions", clientId],
    queryFn: async () => (await supabase.from("advisory_actions").select("*").eq("client_id", clientId).order("due_date")).data ?? [],
  });

  const canManage = user?.isManagement;
  const latest = (reports ?? [])[0];

  const save = async () => {
    if (!form.period) { toast.error("Reporting period is required"); return; }
    const nums = ["sales", "gross_profit", "gross_profit_pct", "operating_expenses", "net_profit", "receivables", "payables", "inventory", "cash_bank", "cash_flow"];
    const payload: any = { client_id: clientId, period: form.period, source: form.source ?? "Manual entry", is_demo: false };
    for (const k of nums) payload[k] = form[k] ? Number(form[k]) : null;
    for (const k of ["budget_vs_actual", "key_ratios", "business_challenges", "recommendations", "meeting_notes"]) payload[k] = form[k] || null;
    const { error } = await supabase.from("advisory_reports").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Monthly figures saved");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["advisory-reports", clientId] });
  };

  const updateAction = async (a: any, values: any) => {
    await supabase.from("advisory_actions").update(values).eq("id", a.id);
    queryClient.invalidateQueries({ queryKey: ["advisory-actions", clientId] });
  };

  const addAction = async () => {
    const title = window.prompt("Action item:");
    if (!title?.trim()) return;
    await supabase.from("advisory_actions").insert({ client_id: clientId, title: title.trim(), owner: "—", status: "Open", is_demo: false });
    queryClient.invalidateQueries({ queryKey: ["advisory-actions", clientId] });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold">{(client as any)?.name} — L2 / Virtual CFO</h2>
            <p className="text-xs text-muted-foreground">Latest period: {latest?.period ?? "no data yet"} · Source: {latest?.source ?? "—"} (figures are manually entered, not derived from assumptions)</p>
          </div>
          {canManage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add monthly figures</Button>}
        </div>
        {latest && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Sales" value={fmtINR(latest.sales)} />
            <StatCard label="Gross profit" value={fmtINR(latest.gross_profit)} sub={latest.gross_profit_pct ? `${latest.gross_profit_pct}%` : undefined} />
            <StatCard label="Net profit" value={fmtINR(latest.net_profit)} />
            <StatCard label="Cash & bank" value={fmtINR(latest.cash_bank)} />
            <StatCard label="Receivables" value={fmtINR(latest.receivables)} />
            <StatCard label="Payables" value={fmtINR(latest.payables)} />
            <StatCard label="Inventory" value={fmtINR(latest.inventory)} />
            <StatCard label="Cash flow" value={fmtINR(latest.cash_flow)} />
          </div>
        )}
      </div>

      {latest && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <h3 className="mb-2 font-display text-sm font-semibold">Latest review notes</h3>
            <p><span className="text-muted-foreground">Challenges:</span> {latest.business_challenges ?? "—"}</p>
            <p className="mt-1"><span className="text-muted-foreground">Recommendations:</span> {latest.recommendations ?? "—"}</p>
            <p className="mt-1"><span className="text-muted-foreground">Meeting notes:</span> {latest.meeting_notes ?? "—"}</p>
            <p className="mt-1"><span className="text-muted-foreground">Budget vs actual:</span> {latest.budget_vs_actual ?? "—"}</p>
            <p className="mt-1"><span className="text-muted-foreground">Key ratios:</span> {latest.key_ratios ?? "—"}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Action plan</h3>
              {canManage && <Button size="sm" variant="outline" onClick={addAction}><Plus className="h-3.5 w-3.5" /> Add action</Button>}
            </div>
            {(actions ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No action items yet.</p> : (
              <div className="divide-y">
                {(actions ?? []).map((a: any) => {
                  const late = a.due_date && daysUntil(a.due_date)! < 0 && a.status !== "Done";
                  return (
                    <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div><div className="font-medium">{a.title}</div><div className="text-xs text-muted-foreground">Owner: {a.owner} · Due: {fmtDate(a.due_date)}{late ? " (overdue)" : ""}{a.notes ? ` · ${a.notes}` : ""}</div></div>
                      {canManage && (
                        <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={a.status} onChange={(e) => updateAction(a, { status: e.target.value })}>
                          {["Open", "In Progress", "Done", "Dropped"].map((s) => <option key={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 font-display text-sm font-semibold">Monthly trend</h3>
        {(reports ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No figures yet.</p> : (
          <div className="flex items-end gap-3 overflow-x-auto pb-2">
            {[...(reports ?? [])].reverse().slice(-8).map((r: any) => {
              const max = Math.max(...(reports ?? []).map((x: any) => x.sales ?? 0), 1);
              return (
                <div key={r.id} className="w-20 text-center">
                  <div className="mx-auto flex h-28 w-full items-end justify-center gap-1">
                    <div className="w-6 rounded-t bg-primary" style={{ height: `${((r.sales ?? 0) / max) * 100}%` }} title={`Sales ${fmtINR(r.sales)}`} />
                    <div className="w-6 rounded-t bg-emerald-500" style={{ height: `${((r.net_profit ?? 0) / max) * 100}%` }} title={`Net profit ${fmtINR(r.net_profit)}`} />
                  </div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">{r.period}</div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Navy = sales, green = net profit. Figures are shown as entered by the team for each period.</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-xl">
          <DialogHeader><DialogTitle>Add monthly figures</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {METRIC_FIELDS.map((m) => (
              <Field key={m.key} label={m.label}>
                <input
                  type={m.type ?? "text"}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form[m.key] ?? ""}
                  onChange={(e) => setForm({ ...form, [m.key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save figures</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
