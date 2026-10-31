import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Field, EmptyState, Tabs, ConfirmButton } from "@/components/crm-ui";
import { fmtINR, fmtDate, daysUntil } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, PhoneCall } from "lucide-react";

export const Route = createFileRoute("/_authenticated/receipts")({
  component: ReceiptsPage,
});

type Tab = "receivables" | "receipts" | "ageing" | "weekly";

function ReceiptsPage() {
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("receivables");
  if (!user?.isFinance && !user?.isManagement) {
    return <EmptyState title="Collections are restricted" hint="Receivables are available to the Founder, Accounts staff and Managers." />;
  }
  return (
    <div>
      <PageHeader title="Receipts & Collections" subtitle="Outstanding fees, receipts and follow-ups" />
      <Tabs value={tab} onChange={setTab} options={[
        { value: "receivables", label: "Receivables" }, { value: "receipts", label: "Receipts" },
        { value: "ageing", label: "Ageing" }, { value: "weekly", label: "Weekly collection report" },
      ]} />
      {tab === "receivables" && <Receivables />}
      {tab === "receipts" && <Receipts />}
      {tab === "ageing" && <Ageing />}
      {tab === "weekly" && <WeeklyReport />}
    </div>
  );
}

function useInvoiceData() {
  return useQuery({
    queryKey: ["receivables"],
    queryFn: async () => {
      const [{ data: invoices }, { data: followups }] = await Promise.all([
        supabase.from("invoices").select("*, clients(name, client_code, mobile, whatsapp)").neq("status", "Draft").neq("status", "Cancelled").order("due_date"),
        supabase.from("collection_followups").select("*, profiles(full_name)"),
      ]);
      return { invoices: invoices ?? [], followups: followups ?? [] };
    },
  });
}

function Receivables() {
  const { data, isLoading } = useInvoiceData();
  const queryClient = useQueryClient();
  const list = (data?.invoices ?? []).filter((i: any) => i.total > i.amount_received);
  const overdue = list.filter((i: any) => i.due_date && daysUntil(i.due_date)! < 0);

  const newReceiptFor = (invoice: any) => (
    <NewReceiptDialog presetClient={invoice.client_id} presetInvoice={invoice} />
  );

  return (
    <div>
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Total outstanding</div><div className="mt-1 text-xl font-semibold font-display">{fmtINR(list.reduce((s: number, i: any) => s + (i.total - i.amount_received), 0))}</div></div>
            <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Overdue invoices</div><div className={"mt-1 text-xl font-semibold font-display" + (overdue.length ? " text-destructive" : "")}>{overdue.length}</div></div>
            <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Overdue amount</div><div className={"mt-1 text-xl font-semibold font-display" + (overdue.length ? " text-destructive" : "")}>{fmtINR(overdue.reduce((s: number, i: any) => s + (i.total - i.amount_received), 0))}</div></div>
          </div>
          <div className="mb-4"><NewReceiptDialog /></div>
          {list.length === 0 ? <EmptyState title="Nothing outstanding" hint="Every live invoice is fully settled." /> : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[900px] text-sm">
                <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5">Invoice</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Due</th>
                  <th className="px-4 py-2.5">Balance</th><th className="px-4 py-2.5">Follow-up</th><th className="px-4 py-2.5"></th>
                </tr></thead>
                <tbody className="divide-y">
                  {list.map((i: any) => {
                    const fu = (data?.followups ?? []).filter((f: any) => f.invoice_id === i.id).sort((a: any, b: any) => (b.next_follow_up ?? "").localeCompare(a.next_follow_up ?? ""))[0];
                    const late = i.due_date && daysUntil(i.due_date)! < 0;
                    return (
                      <tr key={i.id} className="hover:bg-accent/50">
                        <td className="px-4 py-2.5 font-medium">{i.invoice_number}<div className="text-xs text-muted-foreground">{i.description ?? ""}</div></td>
                        <td className="px-4 py-2.5">{(i as any).clients?.name}{(i as any).clients?.is_demo ? " · Demo" : ""}</td>
                        <td className={"px-4 py-2.5" + (late ? " font-medium text-destructive" : "")}>{fmtDate(i.due_date)}{late ? ` (${-daysUntil(i.due_date)!}d late)` : ""}</td>
                        <td className="px-4 py-2.5 font-medium">{fmtINR(i.total - i.amount_received)}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {fu ? <>Last: {fmtDate(fu.last_follow_up)} · {(fu as any).profiles?.full_name}<br />Next: {fmtDate(fu.next_follow_up)} · {fu.response ?? ""}</> : "No follow-up yet"}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end gap-2">
                            <AddFollowUpDialog invoice={i} onDone={() => queryClient.invalidateQueries({ queryKey: ["receivables"] })} />
                            {newReceiptFor(i)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NewReceiptDialog({ presetClient, presetInvoice }: { presetClient?: string; presetInvoice?: any }) {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({
    receipt_date: new Date().toISOString().slice(0, 10), method: "Bank Transfer",
    client_id: presetClient ?? "", allocations: presetInvoice ? [{ invoice_id: presetInvoice.id, amount: presetInvoice.total - presetInvoice.amount_received }] : [],
  });
  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });
  const { data: openInvoices } = useQuery({
    queryKey: ["open-invoices"],
    enabled: !!form.client_id && !presetInvoice,
    queryFn: async () => {
      const { data } = await supabase.from("invoices").select("id, invoice_number, total, amount_received, clients(name)").neq("status", "Draft").neq("status", "Cancelled");
      return (data ?? []).filter((i: any) => i.client_id === form.client_id && i.total > i.amount_received);
    },
  });

  const balance = Number(form.amount ?? 0) - (form.allocations ?? []).reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.client_id || !amount) { toast.error("Pick a client and enter the amount"); return; }
    const allocated = (form.allocations ?? []).reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
    if (allocated > amount) { toast.error("Allocations exceed the receipt amount"); return; }
    for (const a of form.allocations ?? []) {
      const inv = presetInvoice ?? (openInvoices ?? []).find((i: any) => i.id === a.invoice_id);
      if (inv && Number(a.amount) > inv.total - inv.amount_received) {
        toast.error(`Allocation to ${(inv as any).invoice_number ?? "invoice"} exceeds its balance`); return;
      }
    }
    setBusy(true);
    const { data: pay, error } = await supabase.from("payments").insert({
      client_id: form.client_id, receipt_date: form.receipt_date, amount,
      method: form.method, reference_no: form.reference_no ?? null, bank_account: form.bank_account ?? null,
      recorded_by: user?.userId ?? null, notes: form.notes ?? null, is_demo: false,
    } as any).select("id").single();
    if (error || !pay) { setBusy(false); toast.error(error?.message ?? "Failed"); return; }
    for (const a of form.allocations ?? []) {
      if (Number(a.amount) > 0) {
        await supabase.from("payment_allocations").insert({ payment_id: pay.id, invoice_id: a.invoice_id, amount: Number(a.amount), is_demo: false });
      }
    }
    setBusy(false);
    toast.success("Receipt recorded and allocated");
    queryClient.invalidateQueries({ queryKey: ["receivables"] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["receipts-list"] });
    setOpen(false);
    setForm({ receipt_date: new Date().toISOString().slice(0, 10), method: "Bank Transfer", client_id: presetClient ?? "", allocations: [] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {presetInvoice ? "Record receipt" : "New receipt"}</Button>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record receipt</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Client *">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id} disabled={!!presetClient} onChange={(e) => setForm({ ...form, client_id: e.target.value, allocations: [] })}>
              <option value="">Select client…</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Receipt date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.receipt_date} onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} /></Field>
            <Field label="Amount (₹) *"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Method">
              <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference no."><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.reference_no ?? ""} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></Field>
          </div>
          {form.client_id && (presetInvoice ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="flex justify-between"><span>{presetInvoice.invoice_number} balance</span><span>{fmtINR(presetInvoice.total - presetInvoice.amount_received)}</span></div>
              <input type="number" className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm" placeholder="Allocate ₹" value={form.allocations[0]?.amount ?? ""} onChange={(e) => setForm({ ...form, allocations: [{ invoice_id: presetInvoice.id, amount: e.target.value }] })} />
            </div>
          ) : (openInvoices ?? []).length > 0 && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Allocate to invoices (one receipt can pay many invoices)</div>
              {(openInvoices ?? []).map((i: any) => {
                const alloc = (form.allocations ?? []).find((a: any) => a.invoice_id === i.id);
                return (
                  <div key={i.id} className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-xs">{i.invoice_number} · balance {fmtINR(i.total - i.amount_received)}</span>
                    <input type="number" className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs" placeholder="₹" value={alloc?.amount ?? ""} onChange={(e) => {
                      const others = (form.allocations ?? []).filter((x: any) => x.invoice_id !== i.id);
                      setForm({ ...form, allocations: [...others, { invoice_id: i.id, amount: e.target.value }] });
                    }} />
                  </div>
                );
              })}
            </div>
          ))}
          {Number(form.amount ?? 0) > 0 && (
            <div className="text-sm">Unallocated balance: <span className="font-medium">{fmtINR(balance)}</span> {balance > 0 && <span className="text-xs text-muted-foreground">(kept as advance)</span>}</div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Record receipt"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddFollowUpDialog({ invoice, onDone }: { invoice: any; onDone: () => void }) {
  const { user } = useCrmUser();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ last_follow_up: new Date().toISOString().slice(0, 10), next_follow_up: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) });
  const save = async () => {
    await supabase.from("collection_followups").insert({
      client_id: invoice.client_id, invoice_id: invoice.id, owner: user?.userId ?? null,
      last_follow_up: form.last_follow_up, response: form.response ?? null,
      promised_date: form.promised_date || null, next_follow_up: form.next_follow_up, notes: form.notes ?? null, is_demo: false,
    });
    toast.success("Follow-up recorded");
    setOpen(false); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><PhoneCall className="h-3.5 w-3.5" /> Follow-up</Button>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Collection follow-up — {invoice.invoice_number}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Follow-up date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.last_follow_up} onChange={(e) => setForm({ ...form, last_follow_up: e.target.value })} /></Field>
          <Field label="Client response"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.response ?? ""} onChange={(e) => setForm({ ...form, response: e.target.value })} placeholder="e.g. Will pay on Friday" /></Field>
          <Field label="Promised payment date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.promised_date ?? ""} onChange={(e) => setForm({ ...form, promised_date: e.target.value })} /></Field>
          <Field label="Next follow-up date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.next_follow_up} onChange={(e) => setForm({ ...form, next_follow_up: e.target.value })} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Receipts() {
  const { data, isLoading } = useQuery({
    queryKey: ["receipts-list"],
    queryFn: async () => {
      const [{ data: pays }, { data: allocs }] = await Promise.all([
        supabase.from("payments").select("*, clients(name)").order("receipt_date", { ascending: false }),
        supabase.from("payment_allocations").select("*, invoices(invoice_number)"),
      ]);
      return { pays: pays ?? [], allocs: allocs ?? [] };
    },
  });
  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  const list = data?.pays ?? [];
  if (list.length === 0) return <EmptyState title="No receipts recorded yet" hint="Record the first receipt from the Receivables tab." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <th className="px-4 py-2.5">Receipt</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Date</th>
          <th className="px-4 py-2.5">Amount</th><th className="px-4 py-2.5">Method</th><th className="px-4 py-2.5">Allocated to</th>
        </tr></thead>
        <tbody className="divide-y">
          {list.map((p: any) => {
            const allocs = (data?.allocs ?? []).filter((a: any) => a.payment_id === p.id);
            return (
              <tr key={p.id} className="hover:bg-accent/50">
                <td className="px-4 py-2.5 font-medium">{p.receipt_number}{p.is_demo ? <span className="ml-1 text-xs text-muted-foreground">Demo</span> : null}</td>
                <td className="px-4 py-2.5">{(p as any).clients?.name}</td>
                <td className="px-4 py-2.5">{fmtDate(p.receipt_date)}</td>
                <td className="px-4 py-2.5 font-medium">{fmtINR(p.amount)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{p.method}{p.reference_no ? ` · ${p.reference_no}` : ""}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {allocs.length ? allocs.map((a: any) => `${(a as any).invoices?.invoice_number} (${fmtINR(a.amount)})`).join(", ") : "Advance / unallocated"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Ageing() {
  const { data, isLoading } = useInvoiceData();
  const buckets = useMemo(() => {
    type Key = "Not yet due" | "1–30 days" | "31–60 days" | "61–90 days" | "More than 90 days";
    const b: Record<Key, { count: number; amount: number }> = {
      "Not yet due": { count: 0, amount: 0 }, "1–30 days": { count: 0, amount: 0 },
      "31–60 days": { count: 0, amount: 0 }, "61–90 days": { count: 0, amount: 0 }, "More than 90 days": { count: 0, amount: 0 },
    };
    const add = (k: Key, bal: number) => { b[k].count++; b[k].amount += bal; };
    for (const i of (data?.invoices ?? []) as any[]) {
      const bal = i.total - i.amount_received;
      if (bal <= 0) continue;
      const late = i.due_date ? -daysUntil(i.due_date)! : 0;
      if (late <= 0) add("Not yet due", bal);
      else if (late <= 30) add("1–30 days", bal);
      else if (late <= 60) add("31–60 days", bal);
      else if (late <= 90) add("61–90 days", bal);
      else add("More than 90 days", bal);
    }
    return b;
  }, [data]);
  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {Object.entries(buckets).map(([k, v]) => (
        <div key={k} className={"card-stat p-4" + (k !== "Not yet due" && v.amount > 0 ? " border-destructive/30" : "")}>
          <div className="text-xs uppercase text-muted-foreground">{k}</div>
          <div className={"mt-1 text-lg font-semibold font-display" + (k !== "Not yet due" && v.amount > 0 ? " text-destructive" : "")}>{fmtINR(v.amount)}</div>
          <div className="text-xs text-muted-foreground">{v.count} invoice(s)</div>
        </div>
      ))}
    </div>
  );
}

function WeeklyReport() {
  const { data, isLoading } = useInvoiceData();
  if (isLoading) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  const followups = data?.followups ?? [];
  const withOwner = (followups as any[]).map((f) => ({
    client: (data?.invoices ?? []).find((i: any) => i.id === f.invoice_id)?.clients?.name ?? "—",
    invoice: (data?.invoices ?? []).find((i: any) => i.id === f.invoice_id)?.invoice_number ?? "—",
    balance: (data?.invoices ?? []).find((i: any) => i.id === f.invoice_id) ? ((data?.invoices ?? []).find((i: any) => i.id === f.invoice_id)!.total - (data?.invoices ?? []).find((i: any) => i.id === f.invoice_id)!.amount_received) : 0,
    ...f,
  }));
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold">Weekly collection report — {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</h2>
        <Button variant="outline" size="sm" onClick={() => window.print()}>Print</Button>
      </div>
      {withOwner.length === 0 ? <p className="text-sm text-muted-foreground">No follow-ups recorded this cycle.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="py-2">Client</th><th className="py-2">Invoice</th><th className="py-2">Balance</th>
            <th className="py-2">Owner</th><th className="py-2">Last follow-up</th><th className="py-2">Response</th><th className="py-2">Next</th>
          </tr></thead>
          <tbody className="divide-y">
            {withOwner.map((f: any, idx: number) => (
              <tr key={idx}>
                <td className="py-2">{f.client}{f.is_demo ? " · Demo" : ""}</td>
                <td className="py-2 text-muted-foreground">{f.invoice}</td>
                <td className="py-2 font-medium">{fmtINR(f.balance)}</td>
                <td className="py-2">{(f as any).profiles?.full_name}</td>
                <td className="py-2">{fmtDate(f.last_follow_up)}</td>
                <td className="py-2 text-muted-foreground">{f.response ?? "—"}</td>
                <td className="py-2">{fmtDate(f.next_follow_up)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
