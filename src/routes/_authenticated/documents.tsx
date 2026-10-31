import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatusBadge, Tabs } from "@/components/crm-ui";
import { fmtDate, daysUntil } from "@/lib/format";
import { DOC_STATUSES } from "@/lib/crm";
import { useCrmUser } from "@/hooks/use-crm-user";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
});

type Tab = "pending" | "all";
const TABS: { value: Tab; label: string }[] = [
  { value: "pending", label: "Pending / requested" },
  { value: "all", label: "All documents" },
];

const PENDING = ["Requested", "Partially Received", "Under Review", "Correction Required"];

function DocumentsPage() {
  const [tab, setTab] = useState<Tab>("pending");
  const { user } = useCrmUser();

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase.from("document_items")
        .select("*, clients(name, client_code), profiles(full_name)")
        .order("due_date");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const list = useMemo(() => {
    const all = docs ?? [];
    return tab === "pending" ? all.filter((d) => PENDING.includes(d.status)) : all;
  }, [docs, tab]);

  const counts = useMemo(() => {
    const all = docs ?? [];
    return {
      pending: all.filter((d) => PENDING.includes(d.status)).length,
      all: all.length,
      overdue: all.filter((d) => PENDING.includes(d.status) && d.due_date && daysUntil(d.due_date)! < 0).length,
    };
  }, [docs]);

  const sendReminder = (d: any) => {
    const num = ((d as any).clients?.whatsapp ?? (d as any).clients?.mobile ?? "").replace(/[^0-9]/g, "");
    const msg = `Dear ${(d as any).clients?.name ?? "Client"}, gentle reminder: "${d.name}" for ${d.period ?? "your work"} is still pending. Kindly share it at the earliest. — SN & Associates`;
    if (num) window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  return (
    <div>
      <PageHeader title="Documents" subtitle="Document request and collection tracker across all work" />
      <Tabs
        value={tab} onChange={setTab}
        options={[
          { value: "pending", label: "Pending / requested", count: counts.pending },
          { value: "all", label: "All documents", count: counts.all },
        ]}
      />
      {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading documents…</div>
        : list.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
            {tab === "pending" ? "Nothing pending from clients right now." : "No document checklist items yet — request them from a work assignment."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5">Document</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Period</th>
                <th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Responsible</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody className="divide-y">
                {list.map((d) => {
                  const late = d.due_date && daysUntil(d.due_date)! < 0 && PENDING.includes(d.status);
                  return (
                    <tr key={d.id} className="hover:bg-accent/50">
                      <td className="px-4 py-2.5 font-medium">{d.name}<div className="text-xs text-muted-foreground">{d.notes ?? ""}</div></td>
                      <td className="px-4 py-2.5 text-muted-foreground">{(d as any).clients?.name}{(d as any).clients?.is_demo ? " · Demo" : ""}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{d.period ?? "—"}</td>
                      <td className={"px-4 py-2.5" + (late ? " font-medium text-destructive" : "")}>{fmtDate(d.due_date)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{(d as any).profiles?.full_name ?? "—"}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={d.status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {user?.isManagement && ["Requested", "Partially Received", "Correction Required"].includes(d.status) && (
                          <button onClick={() => sendReminder(d)} className="text-xs font-medium text-primary hover:underline">WhatsApp reminder</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <p className="mt-3 text-xs text-muted-foreground">Statuses available on each item: {DOC_STATUSES.join(" · ")}. Files attached to work are stored privately; client documents are never publicly accessible.</p>
    </div>
  );
}
