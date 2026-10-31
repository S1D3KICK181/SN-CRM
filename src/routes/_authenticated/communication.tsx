import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Tabs, Field, EmptyState } from "@/components/crm-ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { COMM_STATUSES, MESSAGE_TYPES } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Languages } from "lucide-react";

export const Route = createFileRoute("/_authenticated/communication")({
  component: CommunicationPage,
});

type Tab = "log" | "compose" | "templates";

const PLACEHOLDERS = ["[Client Name]", "[Business Name]", "[Service Name]", "[Period]", "[Missing Documents]", "[Staff Name]", "[Due Date]", "[Invoice Number]", "[Invoice Amount]", "[Outstanding Amount]"];

function CommunicationPage() {
  const { user } = useCrmUser();
  const [tab, setTab] = useState<Tab>("log");
  return (
    <div>
      <PageHeader title="Communication & Reminders" subtitle="WhatsApp-style reminders, message templates and history" />
      <Tabs value={tab} onChange={setTab} options={[
        { value: "log", label: "History" },
        { value: "compose", label: "Compose" },
        { value: "templates", label: "Templates" },
      ]} />
      {tab === "log" && <Log />}
      {tab === "compose" && <Compose />}
      {tab === "templates" && user?.isManagement && <Templates />}
      {tab === "templates" && !user?.isManagement && <EmptyState title="Templates are editable by managers" hint="You can still compose and log messages." />}
    </div>
  );
}

function Log() {
  const queryClient = useQueryClient();
  const { data: logs, isLoading } = useQuery({
    queryKey: ["comm-logs"],
    queryFn: async () => {
      const { data } = await supabase.from("comm_logs").select("*, clients(name)").order("created_at", { ascending: false }).limit(100);
      return data ?? [];
    },
  });
  const list = logs ?? [];
  return isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
    : list.length === 0 ? <EmptyState title="No messages yet" hint="Compose a reminder to get started." />
    : (
      <div className="space-y-2">
        {list.map((l: any) => (
          <div key={l.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{l.message_type}</span>
                <span className="ml-2 text-muted-foreground">· {(l as any).clients?.name ?? "—"}</span>
                {l.channel === "WhatsApp" && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">WhatsApp</span>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={l.status} />
                <span className="text-xs text-muted-foreground">{fmtDateTime(l.created_at)}</span>
              </div>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{l.content}</p>
            {l.next_follow_up && <div className="mt-1 text-xs text-muted-foreground">Next follow-up: {fmtDate(l.next_follow_up)}</div>}
            <div className="mt-2 flex gap-2">
              {["Draft", "Ready"].includes(l.status) && (
                <Button size="sm" variant="outline" onClick={async () => {
                  await supabase.from("comm_logs").update({ status: "Opened for Sending" }).eq("id", l.id);
                  queryClient.invalidateQueries({ queryKey: ["comm-logs"] });
                }}>Mark opened for sending</Button>
              )}
              {l.status === "Opened for Sending" && (
                <Button size="sm" variant="outline" onClick={async () => {
                  await supabase.from("comm_logs").update({ status: "Cancelled" }).eq("id", l.id);
                  queryClient.invalidateQueries({ queryKey: ["comm-logs"] });
                }}>Cancel</Button>
              )}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          WhatsApp Business API is <strong>not connected</strong>. Messages open manually in WhatsApp and are logged as "Opened for Sending" — the system never claims a message was delivered.
        </p>
      </div>
    );
}

function Compose() {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({ channel: "WhatsApp", message_type: "Document request", language: "en" });
  const [content, setContent] = useState("");

  const { data: clients } = useQuery({
    queryKey: ["clients-all"],
    queryFn: async () => (await supabase.from("clients").select("id, name, mobile, whatsapp").order("name")).data ?? [],
  });
  const { data: templates } = useQuery({
    queryKey: ["comm-templates"],
    queryFn: async () => (await supabase.from("comm_templates").select("*").eq("is_active", true)).data ?? [],
  });

  const client = (clients ?? []).find((c: any) => c.id === form.client_id);
  const tpl = (templates ?? []).find((t: any) => t.id === form.template_id);

  const fillFromTemplate = () => {
    if (!tpl) return;
    const c: any = client ?? {};
    const body = tpl.body
      .replaceAll("[Client Name]", c.name ?? "[Client Name]")
      .replaceAll("[Business Name]", c.name ?? "[Business Name]")
      .replaceAll("[Service Name]", form.service_name ?? "[Service Name]")
      .replaceAll("[Period]", form.period ?? "[Period]")
      .replaceAll("[Missing Documents]", form.missing_documents ?? "[Missing Documents]")
      .replaceAll("[Staff Name]", user?.fullName ?? "[Staff Name]")
      .replaceAll("[Due Date]", form.due_date ? fmtDate(form.due_date) : "[Due Date]")
      .replaceAll("[Invoice Number]", form.invoice_number ?? "[Invoice Number]")
      .replaceAll("[Invoice Amount]", form.invoice_amount ?? "[Invoice Amount]")
      .replaceAll("[Outstanding Amount]", form.outstanding_amount ?? "[Outstanding Amount]");
    setContent(body);
  };

  const send = async () => {
    if (!content.trim() || !form.client_id) { toast.error("Pick a client and write the message"); return; }
    const num = ((client as any)?.whatsapp ?? (client as any)?.mobile ?? "").replace(/[^0-9]/g, "");
    if (form.channel === "WhatsApp" && !num) { toast.error("This client has no WhatsApp/mobile number"); return; }
    if (form.channel === "WhatsApp") {
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(content)}`, "_blank");
    }
    const { error } = await supabase.from("comm_logs").insert({
      client_id: form.client_id, assignment_id: form.assignment_id || null, template_id: tpl?.id ?? null,
      message_type: form.message_type, content, channel: form.channel,
      status: form.channel === "WhatsApp" ? "Opened for Sending" : "Draft",
      created_by: user?.userId ?? null, next_follow_up: form.next_follow_up || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Logged as " + (form.channel === "WhatsApp" ? "Opened for Sending" : "Draft"));
    setContent("");
    queryClient.invalidateQueries({ queryKey: ["comm-logs"] });
  };

  return (
    <div className="max-w-2xl space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client *">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.client_id ?? ""} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">Select client…</option>
            {(clients ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Message type">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.message_type} onChange={(e) => setForm({ ...form, message_type: e.target.value })}>
            {MESSAGE_TYPES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Template">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.template_id ?? ""} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
            <option value="">— none —</option>
            {(templates ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Channel">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
            {["WhatsApp", "Email", "Phone", "Other"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {tpl && (
        <div className="rounded-md bg-muted/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Languages className="h-3.5 w-3.5" /> Fill placeholders to personalise the template</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PLACEHOLDERS.map((p) => {
              const key = p.replace(/[\[\]]/g, "").toLowerCase().replace(/ /g, "_");
              return (
                <input key={p} className="h-9 rounded-md border border-input bg-background px-2 text-xs" placeholder={p}
                  value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              );
            })}
          </div>
          <Button size="sm" variant="outline" className="mt-2" onClick={fillFromTemplate}>Insert filled template</Button>
        </div>
      )}
      <Field label="Message">
        <textarea className="min-h-40 w-full rounded-md border border-input bg-background p-3 text-sm" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write the message, or pick a template above…" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Next follow-up date"><input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.next_follow_up ?? ""} onChange={(e) => setForm({ ...form, next_follow_up: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={async () => {
          if (!content.trim() || !form.client_id) { toast.error("Pick a client and write the message"); return; }
          await supabase.from("comm_logs").insert({ client_id: form.client_id, message_type: form.message_type, content, channel: form.channel, status: "Draft", created_by: user?.userId ?? null });
          toast.success("Saved as draft");
          queryClient.invalidateQueries({ queryKey: ["comm-logs"] });
        }}>Save as draft</Button>
        <Button onClick={send}>{form.channel === "WhatsApp" ? "Open WhatsApp & log" : "Log message"}</Button>
      </div>
    </div>
  );
}

function Templates() {
  const queryClient = useQueryClient();
  const { data: templates } = useQuery({
    queryKey: ["comm-templates"],
    queryFn: async () => (await supabase.from("comm_templates").select("*").order("language")).data ?? [],
  });
  const [edit, setEdit] = useState<any | null>(null);

  const save = async () => {
    await supabase.from("comm_templates").update({ body: edit.body, name: edit.name }).eq("id", edit.id);
    toast.success("Template saved");
    setEdit(null);
    queryClient.invalidateQueries({ queryKey: ["comm-templates"] });
  };

  return (
    <div className="space-y-2">
      {(templates ?? []).map((t: any) => (
        <div key={t.id} className="rounded-lg border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium">{t.name}</span>
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{t.language}</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit({ ...t })}>Edit</Button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{t.body}</p>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Placeholders: {PLACEHOLDERS.join(" · ")}</p>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit template</DialogTitle></DialogHeader>
          {edit && (
            <>
              <Field label="Name"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Body"><textarea className="min-h-40 w-full rounded-md border border-input bg-background p-3 text-sm" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
              <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
