import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Tabs, Field, EmptyState } from "@/components/crm-ui";
import { fmtINR, fmtDate, daysUntil } from "@/lib/format";
import { INVOICE_STATUSES } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
});

type Tab = "all" | "unpaid" | "draft" | "paid";

function BillingPage() {
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("all");
  const queryClient = useQueryClient();

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices"],
    enabled: !!user?.isFinance || !!user?.isManagement,
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices")
        .select("*, clients(name, client_code), invoice_items(*)")
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const list = useMemo(() => {
    const all = invoices ?? [];
    if (tab === "unpaid") return all.filter((i) => ["Unpaid", "Partially Paid", "Overdue"].includes(i.status));
    if (tab === "draft") return all.filter((i) => i.status === "Draft");
    if (tab === "paid") return all.filter((i) => i.status === "Paid");
    return all;
  }, [invoices, tab]);

  const totals = useMemo(() => {
    const all = invoices ?? [];
    const live = all.filter((i) => !["Draft", "Cancelled"].includes(i.status));
    return {
      billed: live.reduce((s, i) => s + i.total, 0),
      received: live.reduce((s, i) => s + (i.amount_received ?? 0), 0),
      outstanding: live.reduce((s, i) => s + (i.total - (i.amount_received ?? 0)), 0),
      overdue: live.filter((i) => i.due_date && daysUntil(i.due_date)! < 0 && i.amount_received < i.total)
        .reduce((s, i) => s + (i.total - (i.amount_received ?? 0)), 0),
    };
  }, [invoices]);

  if (!user?.isFinance && !user?.isManagement) {
    return <EmptyState title="Billing is restricted" hint="Billing information is available to the Founder, Accounts staff and Managers. Ask the admin to permit you if needed." />;
  }

  return (
    <div>
      <PageHeader
        title="Billing & Invoices"
        subtitle="Fees billed to clients"
        actions={<NewInvoiceDialog />}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Billed (live)</div><div className="mt-1 text-xl font-semibold font-display">{fmtINR(totals.billed)}</div></div>
        <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Received</div><div className="mt-1 text-xl font-semibold font-display text-emerald-700">{fmtINR(totals.received)}</div></div>
        <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Outstanding</div><div className="mt-1 text-xl font-semibold font-display">{fmtINR(totals.outstanding)}</div></div>
        <div className="card-stat p-4"><div className="text-xs uppercase text-muted-foreground">Overdue</div><div className={"mt-1 text-xl font-semibold font-display" + (totals.overdue ? " text-destructive" : "")}>{fmtINR(totals.overdue)}</div></div>
      </div>
      <Tabs value={tab} onChange={setTab} options={[
        { value: "all", label: "All" }, { value: "unpaid", label: "Unpaid" }, { value: "draft", label: "Draft" }, { value: "paid", label: "Paid" },
      ]} />
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading invoices…</div>
        : list.length === 0 ? <EmptyState title="No invoices in this view" hint="Raise invoices from the Billing screen after completing work." action={<NewInvoiceDialog inline />} />
        : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5">Invoice</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Total</th><th className="px-4 py-2.5">Received</th>
                <th className="px-4 py-2.5">Balance</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody className="divide-y">
                {list.map((i) => {
                  const late = i.due_date && daysUntil(i.due_date)! < 0 && !["Paid", "Draft", "Cancelled"].includes(i.status);
                  const balance = i.total - (i.amount_received ?? 0);
                  return (
                    <tr key={i.id} className="hover:bg-accent/50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{i.invoice_number}</div>
                        <div className="text-xs text-muted-foreground">{i.description ?? ""}{i.is_demo ? " · Demo" : ""}</div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{(i as any).clients?.name}</td>
                      <td className="px-4 py-2.5">{fmtDate(i.invoice_date)}</td>
                      <td className={"px-4 py-2.5" + (late ? " font-medium text-destructive" : "")}>{fmtDate(i.due_date)}</td>
                      <td className="px-4 py-2.5 font-medium">{fmtINR(i.total)}</td>
                      <td className="px-4 py-2.5">{fmtINR(i.amount_received)}</td>
                      <td className={"px-4 py-2.5" + (balance > 0 && !["Draft", "Cancelled"].includes(i.status) ? " text-destructive" : "")}>{fmtINR(balance)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={late ? "Overdue" : i.status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <ViewInvoiceButton invoice={i} />
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

function ViewInvoiceButton({ invoice }: { invoice: any }) {
  const [open, setOpen] = useState(false);
  const { data: settings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => (await supabase.from("org_settings").select("*").eq("id", 1).single()).data,
  });
  const balance = invoice.total - (invoice.amount_received ?? 0);
  const print = () => {
    const s: any = settings ?? {};
    const rows = (invoice.invoice_items ?? []).map((it: any) =>
      `<tr><td>${it.description}</td><td style="text-align:right">${it.quantity}</td><td style="text-align:right">₹${Number(it.rate).toLocaleString("en-IN")}</td><td style="text-align:right">₹${Number(it.amount).toLocaleString("en-IN")}</td></tr>`).join("");
    const win = window.open("", "_blank", "width=800,height=900");
    win!.document.write(`<!doctype html><html><head><title>${invoice.invoice_number}</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;color:#1a1a2e}h1{color:#1e2a4a}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{text-align:left;background:#f4f5f7}.total{font-weight:bold}.meta{margin-top:8px;color:#555}</style></head><body>
      <h1>${s.firm_name ?? "SN & Associates"}</h1><div class="meta">${s.address ?? ""}<br/>${s.phone ?? ""} · ${s.email ?? ""}</div>
      <h2>Tax Invoice ${invoice.invoice_number}</h2>
      <div class="meta">Date: ${fmtDate(invoice.invoice_date)} · Due: ${fmtDate(invoice.due_date)}<br/>
      Client: ${(invoice as any).clients?.name ?? ""} (${(invoice as any).clients?.client_code ?? ""})<br/>
      For: ${invoice.description ?? "Professional services"}</div>
      <table><thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">Subtotal</td><td style="text-align:right">₹${Number(invoice.subtotal).toLocaleString("en-IN")}</td></tr>
      ${invoice.discount ? `<tr><td colspan="3" style="text-align:right">Discount</td><td style="text-align:right">-₹${Number(invoice.discount).toLocaleString("en-IN")}</td></tr>` : ""}
      ${invoice.tax_amount ? `<tr><td colspan="3" style="text-align:right">${s.tax_label ?? "GST"} (${invoice.tax_rate}%)</td><td style="text-align:right">₹${Number(invoice.tax_amount).toLocaleString("en-IN")}</td></tr>` : ""}
      <tr class="total"><td colspan="3" style="text-align:right">Total</td><td style="text-align:right">₹${Number(invoice.total).toLocaleString("en-IN")}</td></tr>
      <tr><td colspan="3" style="text-align:right">Received</td><td style="text-align:right">₹${Number(invoice.amount_received).toLocaleString("en-IN")}</td></tr>
      <tr class="total"><td colspan="3" style="text-align:right">Balance</td><td style="text-align:right">₹${Number(balance).toLocaleString("en-IN")}</td></tr></tfoot></table>
      <div class="meta" style="margin-top:24px">Bank: ${s.bank_name ?? ""} · A/c ${s.bank_account ?? ""} · IFSC ${s.ifsc ?? ""} · UPI ${s.upi_id ?? ""}</div>
      <div class="meta">This is a computer-generated invoice from SN Practice CRM.</div>
      </body></html>`);
    win!.document.close();
    win!.print();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Printer className="h-3.5 w-3.5" /> View / PDF</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>{invoice.invoice_number}</DialogTitle></DialogHeader>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span>{(invoice as any).clients?.name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Description</span><span className="text-right">{invoice.description}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Date / Due</span><span>{fmtDate(invoice.invoice_date)} / {fmtDate(invoice.due_date)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-medium">{fmtINR(invoice.total)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span>{fmtINR(invoice.amount_received)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Balance</span><span className="font-medium">{fmtINR(balance)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={invoice.status} /></div>
          {invoice.notes && <p className="pt-1 text-xs text-muted-foreground">Notes: {invoice.notes}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={print}>Print / Save PDF</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewInvoiceDialog({ inline }: { inline?: boolean }) {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({ invoice_date: new Date().toISOString().slice(0, 10), tax_rate: 0, discount: 0, items: [{ description: "Professional services", quantity: 1, rate: 0 }] });
  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });
  const { data: settings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => (await supabase.from("org_settings").select("*").eq("id", 1).single()).data,
  });

  const subtotal = form.items.reduce((s: number, it: any) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
  const tax = (subtotal - (Number(form.discount) || 0)) * ((Number(form.tax_rate) || 0) / 100);
  const total = subtotal - (Number(form.discount) || 0) + tax;

  const save = async (asDraft: boolean) => {
    if (!form.client_id) { toast.error("Pick a client"); return; }
    setBusy(true);
    const { data: inv, error } = await supabase.from("invoices").insert({
      client_id: form.client_id, description: form.description ?? null,
      invoice_date: form.invoice_date, due_date: form.due_date || null,
      subtotal, discount: Number(form.discount) || 0, tax_rate: Number(form.tax_rate) || 0,
      tax_amount: tax, total, status: asDraft ? "Draft" : "Unpaid",
      prepared_by: user?.userId ?? null, is_demo: false,
    } as any).select("id").single();
    if (error || !inv) { setBusy(false); toast.error(error?.message ?? "Failed"); return; }
    await supabase.from("invoice_items").insert(form.items.filter((it: any) => it.description?.trim()).map((it: any) => ({
      invoice_id: inv.id, description: it.description, quantity: Number(it.quantity) || 1, rate: Number(it.rate) || 0, amount: (Number(it.quantity) || 1) * (Number(it.rate) || 0), is_demo: false,
    })));
    setBusy(false);
    toast.success(asDraft ? "Invoice saved as draft" : "Invoice raised");
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {inline ? <Button variant="outline" onClick={() => setOpen(true)}>Raise invoice</Button>
        : <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New invoice</Button>}
      <DialogContent className="max-h-[85vh] overflow-y-auto max-w-lg">
        <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Client *">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Select client…</option>
              {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Description (work period / milestone)"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Invoice date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
            <Field label="Due date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.due_date ?? ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Line items</div>
            {form.items.map((it: any, idx: number) => (
              <div key={idx} className="mb-2 grid grid-cols-[1fr_70px_100px] gap-2">
                <input className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Description" value={it.description} onChange={(e) => setForm({ ...form, items: form.items.map((x: any, i: number) => i === idx ? { ...x, description: e.target.value } : x) })} />
                <input type="number" className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Qty" value={it.quantity} onChange={(e) => setForm({ ...form, items: form.items.map((x: any, i: number) => i === idx ? { ...x, quantity: e.target.value } : x) })} />
                <input type="number" className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Rate ₹" value={it.rate} onChange={(e) => setForm({ ...form, items: form.items.map((x: any, i: number) => i === idx ? { ...x, rate: e.target.value } : x) })} />
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, items: [...form.items, { description: "", quantity: 1, rate: 0 }] })}>+ Add line</Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Discount (₹)`}><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></Field>
            <Field label={`${(settings as any)?.tax_label ?? "GST"} rate (%)`}><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} /></Field>
          </div>
          <div className="rounded-md bg-muted/60 p-3 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmtINR(subtotal)}</span></div>
            <div className="flex justify-between"><span>Tax</span><span>{fmtINR(tax)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total</span><span>{fmtINR(total)}</span></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => save(true)} disabled={busy}>Save draft</Button>
          <Button onClick={() => save(false)} disabled={busy}>{busy ? "Saving…" : "Raise invoice"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
