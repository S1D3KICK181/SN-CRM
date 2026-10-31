import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Tabs, Field } from "@/components/crm-ui";
import { fmtINR, fmtDate, fmtDateTime, daysUntil } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CLIENT_STATUSES } from "@/lib/crm";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  component: ClientDetail,
});

type Tab = "overview" | "contacts" | "services" | "work" | "documents" | "comms" | "invoices" | "notes";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" }, { value: "contacts", label: "Contacts" },
  { value: "services", label: "Services" }, { value: "work", label: "Work & tasks" },
  { value: "documents", label: "Documents" }, { value: "comms", label: "Communication" },
  { value: "invoices", label: "Invoices & payments" }, { value: "notes", label: "Notes & activity" },
];

function ClientDetail() {
  const { clientId } = Route.useParams();
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("overview");
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: client } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients")
        .select("*, profiles!clients_primary_staff_fkey(full_name), departments(name)")
        .eq("id", clientId).single();
      if (error) throw error;
      return data as any;
    },
  });

  if (!client) return <div className="py-10 text-center text-sm text-muted-foreground">Loading client…</div>;

  const canEdit = user?.isManagement;

  return (
    <div>
      <PageHeader
        title={client.name}
        subtitle={`${client.client_code} · ${client.client_type}${client.is_demo ? " · Demo data" : ""}`}
        actions={canEdit ? <Button variant="outline" onClick={() => setEditOpen(true)}>Edit client</Button> : undefined}
      />
      <Tabs value={tab} onChange={setTab} options={TABS} />

      {tab === "overview" && <Overview client={client} />}
      {tab === "contacts" && <Contacts clientId={clientId} canEdit={!!canEdit} />}
      {tab === "services" && <Services clientId={clientId} />}
      {tab === "work" && <Work clientId={clientId} />}
      {tab === "documents" && <Documents clientId={clientId} />}
      {tab === "comms" && <Comms clientId={clientId} />}
      {tab === "invoices" && <Invoices clientId={clientId} />}
      {tab === "notes" && <Notes client={client} clientId={clientId} canEdit={!!canEdit} />}

      {editOpen && (
        <EditClientDialog client={client} onClose={() => setEditOpen(false)} onSaved={() => {
          setEditOpen(false);
          queryClient.invalidateQueries({ queryKey: ["client", clientId] });
          queryClient.invalidateQueries({ queryKey: ["clients"] });
        }} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right break-words">{value ?? "—"}</span>
    </div>
  );
}

function Overview({ client }: { client: any }) {
  const outstanding = client._outstanding ?? null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 font-display text-sm font-semibold">Business</h3>
        <Row label="Trade name" value={client.trade_name} />
        <Row label="Industry" value={client.industry} />
        <Row label="Nature of business" value={client.nature_of_business} />
        <Row label="PAN" value={client.pan} />
        <Row label="GSTIN" value={client.gstin} />
        <Row label="Other registrations" value={client.other_registrations} />
        <Row label="Onboarded" value={fmtDate(client.onboarded_on)} />
        <Row label="Source" value={client.source} />
        <Row label="Category" value={client.category} />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 font-display text-sm font-semibold">Engagement</h3>
        <Row label="Status" value={<StatusBadge status={client.status} />} />
        <Row label="Department" value={(client as any).departments?.name} />
        <Row label="Primary staff" value={(client as any).profiles?.full_name} />
        <Row label="Recurring fee" value={client.recurring_fee ? `${fmtINR(client.recurring_fee)} / ${client.billing_frequency}` : "—"} />
        <Row label="Fee terms" value={client.fee_terms} />
        <Row label="Payment due days" value={`${client.payment_due_days} days`} />
        <Row label="Primary contact" value={client.contact_name ? `${client.contact_name}${client.contact_designation ? " · " + client.contact_designation : ""}` : null} />
        <Row label="Mobile / WhatsApp" value={client.mobile} />
        <Row label="Email" value={client.email} />
        <Row label="Address" value={[client.address_line, client.city, client.pin_code].filter(Boolean).join(", ")} />
      </div>
    </div>
  );
}

function Contacts({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const { data: contacts } = useQuery({
    queryKey: ["client-contacts", clientId],
    queryFn: async () => (await supabase.from("client_contacts").select("*").eq("client_id", clientId)).data ?? [],
  });
  const add = async () => {
    if (!form.name) { toast.error("Name is required"); return; }
    const { error } = await supabase.from("client_contacts").insert({ ...form, client_id: clientId });
    if (error) { toast.error(error.message); return; }
    toast.success("Contact added"); setOpen(false); setForm({});
    queryClient.invalidateQueries({ queryKey: ["client-contacts", clientId] });
  };
  const { data: branches } = useQuery({
    queryKey: ["client-branches", clientId],
    queryFn: async () => (await supabase.from("client_branches").select("*").eq("client_id", clientId)).data ?? [],
  });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold">Contacts</h3>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add contact</Button>}
        </div>
        {(contacts ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No additional contacts.</p> : (
          <div className="divide-y">
            {(contacts ?? []).map((c: any) => (
              <div key={c.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium">{c.name}</span> {c.is_primary && <span className="ml-1 text-xs text-primary">(primary)</span>}
                  <div className="text-xs text-muted-foreground">{c.designation ?? ""}</div>
                </div>
                <div className="text-muted-foreground">{c.phone ?? "—"} · {c.email ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 font-display text-sm font-semibold">Branches / GST registrations</h3>
        {(branches ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No branches recorded.</p> : (
          <div className="divide-y">
            {(branches ?? []).map((b: any) => (
              <div key={b.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <div><span className="font-medium">{b.branch_name}</span><div className="text-xs text-muted-foreground">{b.address ?? ""}</div></div>
                <div className="text-muted-foreground">GSTIN: {b.gstin ?? "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add contact</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Name *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Designation"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.designation ?? ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
            <Field label="Phone"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={add}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Services({ clientId }: { clientId: string }) {
  const { data: engagements } = useQuery({
    queryKey: ["client-engagements", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("engagements")
        .select("*, services(name, code)").eq("client_id", clientId);
      return data ?? [];
    },
  });
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 font-display text-sm font-semibold">Service engagements</h3>
      {(engagements ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No engagements yet — add one from Services &amp; Engagements.</p> : (
        <div className="divide-y">
          {(engagements ?? []).map((e: any) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-medium">{(e as any).services?.name}</span>
                <div className="text-xs text-muted-foreground">{e.engagement_code} · since {fmtDate(e.start_date)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span>{fmtINR(e.agreed_fee)} / {e.billing_frequency}</span>
                <StatusBadge status={e.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Work({ clientId }: { clientId: string }) {
  const { data: assignments } = useQuery({
    queryKey: ["client-work", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("work_assignments")
        .select("*, services(name)").eq("client_id", clientId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  const list = assignments ?? [];
  return list.length === 0 ? (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No work assignments for this client yet.</div>
  ) : (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <th className="px-4 py-2.5">Work</th><th className="px-4 py-2.5">Service</th><th className="px-4 py-2.5">Period</th>
          <th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Progress</th><th className="px-4 py-2.5">Status</th>
        </tr></thead>
        <tbody className="divide-y">
          {list.map((a: any) => (
            <tr key={a.id} className="hover:bg-accent/50">
              <td className="px-4 py-2.5"><Link to="/assignments/$assignmentId" params={{ assignmentId: a.id }} className="font-medium text-primary hover:underline">{a.assignment_code} · {a.title}</Link></td>
              <td className="px-4 py-2.5 text-muted-foreground">{(a as any).services?.name}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{a.work_period}</td>
              <td className="px-4 py-2.5">{fmtDate(a.statutory_due ?? a.internal_due)}</td>
              <td className="px-4 py-2.5">{a.progress}%</td>
              <td className="px-4 py-2.5"><StatusBadge status={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Documents({ clientId }: { clientId: string }) {
  const { data: docs } = useQuery({
    queryKey: ["client-documents", clientId],
    queryFn: async () => (await supabase.from("document_items").select("*").eq("client_id", clientId).order("created_at", { ascending: false })).data ?? [],
  });
  const list = docs ?? [];
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      {list.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No document checklist items.</div> : (
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2.5">Document</th><th className="px-4 py-2.5">Period</th><th className="px-4 py-2.5">Requested</th><th className="px-4 py-2.5">Received</th><th className="px-4 py-2.5">Status</th>
          </tr></thead>
          <tbody className="divide-y">
            {list.map((d: any) => (
              <tr key={d.id}>
                <td className="px-4 py-2.5 font-medium">{d.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{d.period ?? "—"}</td>
                <td className="px-4 py-2.5">{fmtDate(d.requested_on)}</td>
                <td className="px-4 py-2.5">{fmtDate(d.received_on)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Comms({ clientId }: { clientId: string }) {
  const { data: logs } = useQuery({
    queryKey: ["client-comms", clientId],
    queryFn: async () => (await supabase.from("comm_logs").select("*").eq("client_id", clientId).order("created_at", { ascending: false })).data ?? [],
  });
  const list = logs ?? [];
  return list.length === 0 ? (
    <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">No communication history yet.</div>
  ) : (
    <div className="space-y-2">
      {list.map((l: any) => (
        <div key={l.id} className="rounded-lg border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{l.message_type}</span>
            <span className="text-xs text-muted-foreground">{fmtDateTime(l.created_at)} · {l.channel}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{l.content}</p>
          <div className="mt-1"><StatusBadge status={l.status} /></div>
        </div>
      ))}
    </div>
  );
}

function Invoices({ clientId }: { clientId: string }) {
  const { data: invoices } = useQuery({
    queryKey: ["client-invoices", clientId],
    queryFn: async () => (await supabase.from("invoices").select("*").eq("client_id", clientId).order("invoice_date", { ascending: false })).data ?? [],
  });
  const list = invoices ?? [];
  const outstanding = list.filter((i: any) => !["Paid", "Draft", "Cancelled"].includes(i.status)).reduce((s: number, i: any) => s + (i.total - i.amount_received), 0);
  return (
    <div>
      <p className="mb-3 text-sm">Outstanding fees: <span className="font-semibold">{fmtINR(outstanding)}</span></p>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        {list.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No invoices yet.</div> : (
          <table className="w-full min-w-[680px] text-sm">
            <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <th className="px-4 py-2.5">Invoice</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Total</th><th className="px-4 py-2.5">Received</th><th className="px-4 py-2.5">Status</th>
            </tr></thead>
            <tbody className="divide-y">
              {list.map((i: any) => {
                const late = !!i.due_date && (daysUntil(i.due_date) ?? 0) < 0 && !["Paid", "Draft", "Cancelled"].includes(i.status);
                return (
                  <tr key={i.id}>
                    <td className="px-4 py-2.5 font-medium">{i.invoice_number}<div className="text-xs text-muted-foreground">{i.description}</div></td>
                    <td className="px-4 py-2.5">{fmtDate(i.invoice_date)}</td>
                    <td className={"px-4 py-2.5" + (late ? " text-destructive" : "")}>{fmtDate(i.due_date)}</td>
                    <td className="px-4 py-2.5">{fmtINR(i.total)}</td>
                    <td className="px-4 py-2.5">{fmtINR(i.amount_received)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={i.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Notes({ client, clientId, canEdit }: { client: any; clientId: string; canEdit: boolean }) {
  const [notes, setNotes] = useState(client.notes ?? "");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const save = async () => {
    setBusy(true);
    await supabase.from("clients").update({ notes }).eq("id", clientId);
    setBusy(false);
    toast.success("Notes saved");
    queryClient.invalidateQueries({ queryKey: ["client", clientId] });
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-2 font-display text-sm font-semibold">Client notes</h3>
      <textarea
        className="min-h-32 w-full rounded-md border border-input bg-background p-3 text-sm"
        value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit}
        placeholder="Internal notes about this client…"
      />
      {canEdit && <Button className="mt-2" size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save notes"}</Button>}
      {!canEdit && <p className="mt-2 text-xs text-muted-foreground">Only managers can edit notes.</p>}
    </div>
  );
}

function EditClientDialog({ client, onClose, onSaved }: { client: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>(client);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    const { id, client_code, is_demo, created_at, updated_at, profiles, departments, _outstanding, ...rest } = form;
    const { error } = await supabase.from("clients").update({ ...rest, recurring_fee: Number(rest.recurring_fee) || 0, payment_due_days: Number(rest.payment_due_days) || 15 }).eq("id", id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Client updated");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto max-w-2xl">
        <DialogHeader><DialogTitle>Edit client</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client name" className="sm:col-span-2"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Status">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.status ?? "Active"} onChange={(e) => set("status", e.target.value)}>
              {CLIENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Recurring fee (₹)"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.recurring_fee ?? 0} onChange={(e) => set("recurring_fee", e.target.value)} /></Field>
          <Field label="Billing frequency">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.billing_frequency ?? "Monthly"} onChange={(e) => set("billing_frequency", e.target.value)}>
              {["Monthly", "Quarterly", "Annual", "One-time", "Milestone"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Payment due days"><input type="number" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.payment_due_days ?? 15} onChange={(e) => set("payment_due_days", e.target.value)} /></Field>
          <Field label="Fee terms" className="sm:col-span-2"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.fee_terms ?? ""} onChange={(e) => set("fee_terms", e.target.value)} /></Field>
          <Field label="Notes" className="sm:col-span-2"><textarea className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
