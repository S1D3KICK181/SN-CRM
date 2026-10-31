import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLocalDemoBackend, supabase } from "@/integrations/supabase/client";
import { removeLocalDemoRecords } from "@/integrations/supabase/local-demo";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, Field, ConfirmButton, EmptyState } from "@/components/crm-ui";
import { removeDemoData } from "@/lib/admin-fns";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => (await supabase.from("org_settings").select("*").eq("id", 1).single()).data,
  });
  const { data: counts } = useQuery({
    queryKey: ["demo-counts"],
    enabled: !!user?.isFounder,
    queryFn: async () => {
      const { count } = await supabase.from("clients").select("id", { count: "exact" }).eq("is_demo", true);
      return { demoClients: count ?? 0 };
    },
  });
  const [form, setForm] = useState<any>(null);
  const current = form ?? settings;
  const isFounder = user?.isFounder;
  const set = (k: string, v: any) => setForm({ ...(current ?? {}), [k]: v });

  const save = async () => {
    const { id, updated_at, ...rest } = current;
    const { error } = await supabase.from("org_settings").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { toast.error(error.message); return; }
    toast.success("Settings saved");
    setForm(null);
    queryClient.invalidateQueries({ queryKey: ["org-settings"] });
  };

  if (!user) return <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <PageHeader title="Settings" subtitle="Firm details, integrations and data management" />
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Firm profile (used on invoices)</h2>
          {current && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Firm name"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.firm_name ?? ""} disabled={!isFounder} onChange={(e) => set("firm_name", e.target.value)} /></Field>
              <Field label="Phone"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.phone ?? ""} disabled={!isFounder} onChange={(e) => set("phone", e.target.value)} /></Field>
              <Field label="Address" className="sm:col-span-2"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.address ?? ""} disabled={!isFounder} onChange={(e) => set("address", e.target.value)} /></Field>
              <Field label="Email"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.email ?? ""} disabled={!isFounder} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Invoice prefix"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.invoice_prefix ?? ""} disabled={!isFounder} onChange={(e) => set("invoice_prefix", e.target.value)} /></Field>
              <Field label="Bank name"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.bank_name ?? ""} disabled={!isFounder} onChange={(e) => set("bank_name", e.target.value)} /></Field>
              <Field label="Bank account"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.bank_account ?? ""} disabled={!isFounder} onChange={(e) => set("bank_account", e.target.value)} /></Field>
              <Field label="IFSC"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.ifsc ?? ""} disabled={!isFounder} onChange={(e) => set("ifsc", e.target.value)} /></Field>
              <Field label="UPI ID"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={current.upi_id ?? ""} disabled={!isFounder} onChange={(e) => set("upi_id", e.target.value)} /></Field>
              {isFounder && <div className="sm:col-span-2"><Button onClick={save}>Save firm details</Button></div>}
              {!isFounder && <p className="text-xs text-muted-foreground sm:col-span-2">Only the Founder can edit firm details.</p>}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 font-display text-sm font-semibold">Integrations</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <div><div className="font-medium">WhatsApp Business API</div><div className="text-xs text-muted-foreground">Automated reminders via an authorised provider</div></div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Not connected</span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <div><div className="font-medium">Email sending</div><div className="text-xs text-muted-foreground">Transactional email to clients</div></div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Not connected</span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
            <div><div className="font-medium">Payment link (gateway)</div><div className="text-xs text-muted-foreground">Collect fees online</div></div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Not connected</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Integration settings are stored securely once configured. Until then, the app will not claim any automated sending or payment collection.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 font-display text-sm font-semibold">Users</h2>
        <p className="text-sm text-muted-foreground">Staff accounts, roles and departments are managed in <a href="/team" className="text-primary underline">Team &amp; Departments</a>. The first account you created is the Founder.</p>
      </div>

      {isFounder && (
        <div className="rounded-lg border border-destructive/30 bg-card p-4">
          <h2 className="mb-1 font-display text-sm font-semibold text-destructive">Demo data</h2>
          <p className="text-sm text-muted-foreground">
            {counts?.demoClients ?? 0} demo client(s) with demo work, invoices and records are currently loaded, clearly labelled "Demo". Removing them deletes only demo records — real clients, invoices and settings are untouched.
          </p>
          <ConfirmButton
            title="Remove all demo data?"
            description="This permanently deletes every record labelled as demo. Real data is not affected."
            onConfirm={async () => {
              try {
                if (isLocalDemoBackend) removeLocalDemoRecords();
                else await removeDemoData({});
                toast.success("Demo data removed");
                queryClient.invalidateQueries();
              }
              catch (e: any) { toast.error(e.message); }
            }}
          >
            <Button variant="destructive"><Trash2 className="h-4 w-4" /> Remove demo data</Button>
          </ConfirmButton>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        <h2 className="mb-2 font-display text-sm font-semibold text-foreground">Data &amp; security</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Role-based permissions are enforced in the database, not only in the interface.</li>
          <li>Client documents are stored in private storage; only signed-in staff with access can open them.</li>
          <li>Deleting clients and invoices requires confirmation; only the Founder can delete them.</li>
          <li>Formats used across the app: ₹, DD/MM/YYYY, FY 2026–27, Asia/Kolkata.</li>
        </ul>
      </div>
    </div>
  );
}
