import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, EmptyState, Field, ConfirmButton } from "@/components/crm-ui";
import { fmtINR, fmtDate } from "@/lib/format";
import { CLIENT_STATUSES, CLIENT_TYPES } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Plus, Download, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients")({
  validateSearch: (s: { q?: string; status?: string }): { q?: string | undefined; status?: string | undefined } => ({ q: s.q, status: s.status }),
  component: ClientsPage,
});

const CSV_HEADER = "name,trade_name,client_type,industry,mobile,email,gstin,pan,city,recurring_fee";

function NewClientDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({ client_type: "Individual", status: "Active", payment_due_days: 15, billing_frequency: "Monthly", recurring_fee: 0 });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name?.trim()) { toast.error("Client name is required"); return; }
    setBusy(true);
    const { error } = await supabase.from("clients").insert({ ...form, recurring_fee: Number(form.recurring_fee) || 0, payment_due_days: Number(form.payment_due_days) || 15 });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Client created");
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    setOpen(false);
    setForm({ client_type: "Individual", status: "Active", payment_due_days: 15, billing_frequency: "Monthly", recurring_fee: 0 });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4" /> New client</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto max-w-2xl">
        <DialogHeader><DialogTitle>New client</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client / business name *" className="sm:col-span-2">
            <input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Trade name"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.trade_name ?? ""} onChange={(e) => set("trade_name", e.target.value)} /></Field>
          <Field label="Client type">
            <Select value={form.client_type} onValueChange={(v) => set("client_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CLIENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Industry"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.industry ?? ""} onChange={(e) => set("industry", e.target.value)} /></Field>
          <Field label="Nature of business"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.nature_of_business ?? ""} onChange={(e) => set("nature_of_business", e.target.value)} /></Field>
          <Field label="Address"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.address_line ?? ""} onChange={(e) => set("address_line", e.target.value)} /></Field>
          <Field label="City"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="PIN code"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.pin_code ?? ""} onChange={(e) => set("pin_code", e.target.value)} /></Field>
          <Field label="Primary contact"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} /></Field>
          <Field label="Designation"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.contact_designation ?? ""} onChange={(e) => set("contact_designation", e.target.value)} /></Field>
          <Field label="Mobile"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.mobile ?? ""} onChange={(e) => set("mobile", e.target.value)} /></Field>
          <Field label="Email"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="PAN"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm uppercase" value={form.pan ?? ""} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
          <Field label="GSTIN"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm uppercase" value={form.gstin ?? ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CLIENT_STATUSES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Recurring fee (₹)"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.recurring_fee ?? 0} onChange={(e) => set("recurring_fee", e.target.value)} /></Field>
          <Field label="Billing frequency">
            <Select value={form.billing_frequency} onValueChange={(v) => set("billing_frequency", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["Monthly", "Quarterly", "Annual", "One-time", "Milestone"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Payment due days"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.payment_due_days ?? 15} onChange={(e) => set("payment_due_days", e.target.value)} /></Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create client"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportClientsDialog() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const rows = useMemo(() => {
    const lines = csv.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return [];
    const header = (lines[0] ?? "").toLowerCase();
    const hasHeader = header.includes("name");
    const dataLines = hasHeader ? lines.slice(1) : lines;
    return dataLines.map((l) => {
      const p = l.split(",").map((s) => s.trim());
      return {
        name: p[0] ?? "", trade_name: p[1] ?? "", client_type: p[2] || "Individual", industry: p[3] ?? "",
        mobile: p[4] ?? "", email: p[5] ?? "", gstin: p[6]?.toUpperCase() ?? "", pan: p[7]?.toUpperCase() ?? "",
        city: p[8] ?? "", recurring_fee: Number(p[9]) || 0,
      };
    }).filter((r) => r.name);
  }, [csv]);

  const downloadTemplate = () => {
    const blob = new Blob([CSV_HEADER + "\nSample Traders,Sample,Proprietorship,Trading,+91 90000 00000,mail@sample.example,32AAAPS0000E1Z7,AAAPS0000E,Kochi,5000\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "clients-import-template.csv"; a.click();
  };

  const doImport = async () => {
    setBusy(true);
    // Duplicate check on name (case-insensitive)
    const { data: existing } = await supabase.from("clients").select("name");
    const names = new Set((existing ?? []).map((c: any) => c.name.toLowerCase()));
    const dupes = rows.filter((r) => names.has(r.name.toLowerCase()));
    const fresh = rows.filter((r) => !names.has(r.name.toLowerCase()));
    if (fresh.length) {
      const { error } = await supabase.from("clients").insert(fresh.map((r) => ({ ...r, is_demo: false })) as any);
      if (error) { setBusy(false); toast.error(error.message); return; }
    }
    setBusy(false);
    toast.success(`Imported ${fresh.length} client(s)` + (dupes.length ? `; skipped ${dupes.length} duplicate(s): ${dupes.map((d) => d.name).join(", ")}` : ""));
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    setOpen(false); setCsv("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Upload className="h-4 w-4" /> Import CSV</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Import clients</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Paste rows from the template below (or upload its content). Columns: {CSV_HEADER}</p>
        <Button variant="outline" size="sm" onClick={downloadTemplate}><Download className="h-4 w-4" /> Download CSV template</Button>
        <textarea className="min-h-32 w-full rounded-md border border-input bg-background p-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Paste CSV here…" />
        {rows.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border text-xs">
            <div className="bg-muted px-2 py-1 font-medium">Preview — {rows.length} row(s)</div>
            {rows.map((r, i) => <div key={i} className="border-t px-2 py-1">{r.name} · {r.client_type} · {r.city ?? "—"}</div>)}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || rows.length === 0}>{busy ? "Importing…" : `Import ${rows.length} row(s)`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientsPage() {
  const { q, status } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useCrmUser();
  const [search, setSearch] = useState(q ?? "");
  const [statusFilter, setStatusFilter] = useState(status ?? "");

  const { data: clients, isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*, profiles!clients_primary_staff_fkey(full_name), departments(name)");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(() => {
    let list = clients ?? [];
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter((c) =>
        [c.name, c.client_code, c.mobile, c.gstin, c.pan, c.email].some((v: any) => v?.toLowerCase?.().includes(t)));
    }
    if (statusFilter) list = list.filter((c) => c.status === statusFilter);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, search, statusFilter]);

  const canCreate = user?.isManagement;

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle={`${filtered.length} client(s)`}
        actions={
          canCreate ? (<>
            <ImportClientsDialog />
            <NewClientDialog />
          </>) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="h-9 w-64 rounded-md border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Search name, phone, GSTIN, PAN, ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CLIENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading clients…</div>
        : filtered.length === 0 ? (
          <EmptyState
            title="No clients found"
            hint={canCreate ? "Create your first client, or import them from a CSV." : "No clients are visible to you yet — you will see clients assigned to you."}
            action={canCreate ? <NewClientDialog /> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Type</th><th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Dept / Staff</th><th className="px-4 py-2.5">Recurring fee</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-accent/50">
                    <td className="px-4 py-2.5">
                      <Link to="/clients/$clientId" params={{ clientId: c.id }} className="font-medium text-primary hover:underline">{c.name}</Link>
                      <div className="text-xs text-muted-foreground">{c.client_code}{c.is_demo ? " · Demo" : ""}</div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.client_type}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.mobile ?? "—"}<div className="text-xs">{c.email ?? ""}</div></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{(c as any).departments?.name ?? "—"}<div className="text-xs">{(c as any).profiles?.full_name ?? "—"}</div></td>
                    <td className="px-4 py-2.5">{c.recurring_fee ? fmtINR(c.recurring_fee) : "—"}<div className="text-xs text-muted-foreground">{c.billing_frequency}</div></td>
                    <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(c.onboarded_on)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
