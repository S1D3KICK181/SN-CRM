import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, Field, EmptyState, StatusBadge, Tabs } from "@/components/crm-ui";
import { fmtINR, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tax-money")({
  component: TaxMoneyPage,
});

type Tab = "records" | "reconciliation";

function TaxMoneyPage() {
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("records");
  if (!user?.isFinance && !user?.isManagement) {
    return <EmptyState title="Client tax money is restricted" hint="Available to the Founder, Accounts staff and Managers." />;
  }
  return (
    <div>
      <PageHeader
        title="Client Tax Money"
        subtitle="Money received from clients for statutory payments — tracked separately from professional fees and never counted as income"
      />
      <Tabs value={tab} onChange={setTab} options={[{ value: "records", label: "Records" }, { value: "reconciliation", label: "Reconciliation" }]} />
      {tab === "records" ? <Records /> : <Reconciliation />}
    </div>
  );
}

function useTaxMoney() {
  return useQuery({
    queryKey: ["tax-money"],
    queryFn: async () => {
      const { data, error } = await supabase.from("client_tax_money")
        .select("*, clients(name), profiles(full_name)")
        .order("received_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function Records() {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const { data: rows, isLoading } = useTaxMoney();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ purpose: "GST", status: "Received" });
  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });

  const save = async () => {
    if (!form.client_id) { toast.error("Pick a client"); return; }
    const { error } = await supabase.from("client_tax_money").insert({
      ...form, amount_received: Number(form.amount_received) || 0, amount_paid: Number(form.amount_paid) || 0,
      responsible: form.responsible || user?.userId, is_demo: false,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Tax money record added");
    setOpen(false);
    queryClient.invalidateQueries({ queryKey: ["tax-money"] });
  };

  const markPaid = async (r: any) => {
    const amount = window.prompt(`Amount paid to authority (₹) for ${r.tax_period ?? "this period"}:`, String(r.amount_received - r.amount_paid));
    if (amount === null) return;
    await supabase.from("client_tax_money").update({
      amount_paid: r.amount_paid + Number(amount || 0),
      paid_on: new Date().toISOString().slice(0, 10),
      status: r.amount_paid + Number(amount || 0) >= r.amount_received ? "Reconciled" : "Partially paid",
    }).eq("id", r.id);
    toast.success("Payment to authority recorded");
    queryClient.invalidateQueries({ queryKey: ["tax-money"] });
  };

  return (
    <div>
      <Button className="mb-4" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record tax money</Button>
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        : (rows ?? []).length === 0 ? <EmptyState title="No records yet" hint="Record money received from clients for GST or income-tax payments." /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Purpose</th><th className="px-4 py-2.5">Period</th>
                <th className="px-4 py-2.5">Received</th><th className="px-4 py-2.5">Paid to authority</th><th className="px-4 py-2.5">Balance held</th>
                <th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody className="divide-y">
                {(rows ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-accent/50">
                    <td className="px-4 py-2.5">{(r as any).clients?.name}{(r as any).clients?.is_demo ? " · Demo" : ""}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.purpose}</td>
                    <td className="px-4 py-2.5">{r.tax_period ?? "—"}</td>
                    <td className="px-4 py-2.5">{fmtINR(r.amount_received)}<div className="text-xs text-muted-foreground">{fmtDate(r.received_on)}</div></td>
                    <td className="px-4 py-2.5">{fmtINR(r.amount_paid)}<div className="text-xs text-muted-foreground">{r.paid_on ? fmtDate(r.paid_on) : "not yet paid"}</div></td>
                    <td className={"px-4 py-2.5 font-medium" + (r.amount_received - r.amount_paid > 0 ? " text-destructive" : "")}>{fmtINR(r.amount_received - r.amount_paid)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 text-right">
                      {r.amount_received > r.amount_paid && (
                        <Button size="sm" variant="outline" onClick={() => markPaid(r)}>Record payment</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="mt-3 text-xs text-muted-foreground">The app never makes tax payments itself — staff record challan details after paying through the portal or bank.</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record client tax money</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Client *">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">Select client…</option>
                {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Purpose">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
                  {["GST", "Income Tax", "Other"].map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Tax period"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="e.g. October 2026" value={form.tax_period ?? ""} onChange={(e) => setForm({ ...form, tax_period: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount received (₹)"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.amount_received ?? ""} onChange={(e) => setForm({ ...form, amount_received: e.target.value })} /></Field>
              <Field label="Date received"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.received_on ?? ""} onChange={(e) => setForm({ ...form, received_on: e.target.value })} /></Field>
            </div>
            <Field label="Reference / notes"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Reconciliation() {
  const { data: rows, isLoading } = useTaxMoney();
  const grouped = useMemo(() => {
    const map: Record<string, any> = {};
    for (const r of rows ?? []) {
      const key = `${(r as any).clients?.name ?? "—"}|${r.purpose}|${r.tax_period ?? "—"}`;
      map[key] ??= { client: (r as any).clients?.name, purpose: r.purpose, period: r.tax_period, received: 0, paid: 0 };
      map[key].received += r.amount_received;
      map[key].paid += r.amount_paid;
    }
    return Object.values(map);
  }, [rows]);
  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[680px] text-sm">
        <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Purpose</th><th className="px-4 py-2.5">Period</th>
          <th className="px-4 py-2.5">Received from client</th><th className="px-4 py-2.5">Paid to authority</th><th className="px-4 py-2.5">Pending</th>
        </tr></thead>
        <tbody className="divide-y">
          {grouped.map((g: any, i: number) => (
            <tr key={i}>
              <td className="px-4 py-2.5">{g.client}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{g.purpose}</td>
              <td className="px-4 py-2.5">{g.period}</td>
              <td className="px-4 py-2.5">{fmtINR(g.received)}</td>
              <td className="px-4 py-2.5">{fmtINR(g.paid)}</td>
              <td className={"px-4 py-2.5 font-medium" + (g.received - g.paid > 0 ? " text-destructive" : "")}>{fmtINR(g.received - g.paid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
