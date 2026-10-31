import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Field } from "@/components/crm-ui";
import { fmtDate, fmtDateTime, fmtINR, daysUntil } from "@/lib/format";
import { ASSIGNMENT_STATUSES, PRIORITIES, DOC_STATUSES } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, Circle, Send, MessageSquarePlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/assignments/$assignmentId")({
  component: AssignmentDetail,
});

function AssignmentDetail() {
  const { assignmentId } = Route.useParams();
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [newDoc, setNewDoc] = useState("");
  const [newCheck, setNewCheck] = useState("");
  const [waOpen, setWaOpen] = useState(false);

  const { data: a, isLoading } = useQuery({
    queryKey: ["assignment", assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_assignments")
        .select("*, clients(*), services(name, code), profiles!work_assignments_assigned_staff_fkey(full_name, id)")
        .eq("id", assignmentId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: stages } = useQuery({
    queryKey: ["assignment-stages", assignmentId],
    queryFn: async () => (await supabase.from("assignment_stages").select("*").eq("assignment_id", assignmentId).order("position")).data ?? [],
  });
  const { data: checklist } = useQuery({
    queryKey: ["assignment-checklist", assignmentId],
    queryFn: async () => (await supabase.from("checklist_items").select("*").eq("assignment_id", assignmentId).order("created_at")).data ?? [],
  });
  const { data: docs } = useQuery({
    queryKey: ["assignment-docs", assignmentId],
    queryFn: async () => (await supabase.from("document_items").select("*").eq("assignment_id", assignmentId).order("created_at")).data ?? [],
  });
  const { data: comments } = useQuery({
    queryKey: ["assignment-comments", assignmentId],
    queryFn: async () => {
      const { data } = await supabase.from("assignment_comments").select("*, profiles(full_name)").eq("assignment_id", assignmentId).order("created_at");
      return data ?? [];
    },
  });

  if (isLoading || !a) return <div className="py-10 text-center text-sm text-muted-foreground">Loading work…</div>;
  const client = (a as any).clients ?? {};
  const involved = user && (a.assigned_staff === user.userId || a.reviewer === user.userId || user.isManagement);
  const doneCount = (checklist ?? []).filter((c: any) => c.done).length;
  const progress = (checklist ?? []).length ? Math.round((doneCount / checklist!.length) * 100) : a.progress;

  const patch = async (values: any) => {
    const { error } = await supabase.from("work_assignments").update(values).eq("id", assignmentId);
    if (error) { toast.error(error.message); return; }
    queryClient.invalidateQueries({ queryKey: ["assignment", assignmentId] });
    queryClient.invalidateQueries({ queryKey: ["assignments"] });
  };

  const toggleStage = async (stage: any) => {
    await supabase.from("assignment_stages").update({
      completed: !stage.completed,
      completed_at: !stage.completed ? new Date().toISOString() : null,
      completed_by: user?.userId ?? null,
    }).eq("id", stage.id);
    const nextStage = stage.completed ? stage.position : Math.min(stage.position + 1, stages?.length ?? 1);
    patch({ workflow_stage: nextStage });
    queryClient.invalidateQueries({ queryKey: ["assignment-stages", assignmentId] });
  };

  const toggleCheck = async (item: any) => {
    await supabase.from("checklist_items").update({
      done: !item.done, done_by: user?.userId ?? null, done_at: !item.done ? new Date().toISOString() : null,
    }).eq("id", item.id);
    queryClient.invalidateQueries({ queryKey: ["assignment-checklist", assignmentId] });
    if (!item.done) patch({ progress });
  };

  const addCheck = async () => {
    if (!newCheck.trim()) return;
    await supabase.from("checklist_items").insert({ assignment_id: assignmentId, title: newCheck.trim() });
    setNewCheck("");
    queryClient.invalidateQueries({ queryKey: ["assignment-checklist", assignmentId] });
  };

  const setDocStatus = async (doc: any, status: string) => {
    await supabase.from("document_items").update({
      status,
      received_on: ["Received", "Accepted", "Under Review"].includes(status) ? new Date().toISOString().slice(0, 10) : null,
    }).eq("id", doc.id);
    queryClient.invalidateQueries({ queryKey: ["assignment-docs", assignmentId] });
    toast.success(`Document marked ${status}`);
  };

  const addDoc = async () => {
    if (!newDoc.trim()) return;
    await supabase.from("document_items").insert({ client_id: a.client_id, assignment_id: assignmentId, name: newDoc.trim(), status: "Requested", requested_on: new Date().toISOString().slice(0, 10) });
    setNewDoc("");
    queryClient.invalidateQueries({ queryKey: ["assignment-docs", assignmentId] });
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    await supabase.from("assignment_comments").insert({ assignment_id: assignmentId, author_id: user?.userId ?? null, body: comment.trim() });
    setComment("");
    queryClient.invalidateQueries({ queryKey: ["assignment-comments", assignmentId] });
  };

  const missingDocs = (docs ?? []).filter((d: any) => ["Requested", "Partially Received", "Correction Required"].includes(d.status)).map((d: any) => d.name);
  const waNumber = (client.whatsapp ?? client.mobile ?? "").replace(/[^0-9]/g, "");
  const waMessage = `Dear ${client.name ?? "Client"}, to complete your ${(a as any).services?.name ?? "work"} for ${a.work_period ?? ""}, please provide the following documents: ${missingDocs.join("; ") || "—"}. Kindly share them by ${fmtDate(a.internal_due)}. For assistance, please contact ${user?.fullName}. — SN & Associates`;

  const du = daysUntil(a.statutory_due ?? a.internal_due);

  return (
    <div>
      <PageHeader
        title={`${a.assignment_code} · ${a.title}`}
        subtitle={`${client.name ?? ""} · ${(a as any).services?.name ?? ""} · Period: ${a.work_period ?? "—"}`}
        actions={<>
          <Link to="/clients/$clientId" params={{ clientId: a.client_id }} className="text-sm text-primary hover:underline">Client profile →</Link>
          {missingDocs.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setWaOpen(true)}><Send className="h-4 w-4" /> WhatsApp document request</Button>
          )}
        </>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Workflow stages */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Workflow — {(a as any).services?.name}</h3>
              <span className="text-xs text-muted-foreground">Stage {a.workflow_stage} of {stages?.length ?? "?"}</span>
            </div>
            <div className="space-y-1">
              {(stages ?? []).map((s: any) => (
                <button key={s.id} onClick={() => involved && toggleStage(s)} disabled={!involved}
                  className={"flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent " + (involved ? "" : "cursor-default")}>
                  {s.completed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className={s.completed ? "text-muted-foreground line-through" : ""}>
                    <span className="mr-2 font-mono text-xs">{String(s.position).padStart(2, "0")}</span>{s.title}
                    {s.completed_at && <span className="ml-2 text-xs text-muted-foreground">({fmtDateTime(s.completed_at)})</span>}
                  </span>
                </button>
              ))}
              {(stages ?? []).length === 0 && <p className="text-sm text-muted-foreground">No workflow stages — this service has no template linked.</p>}
            </div>
          </div>

          {/* Checklist */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Checklist ({doneCount}/{(checklist ?? []).length})</h3>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="space-y-1">
              {(checklist ?? []).map((c: any) => (
                <button key={c.id} onClick={() => involved && toggleCheck(c)} disabled={!involved} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                  {c.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className={c.done ? "text-muted-foreground line-through" : ""}>{c.title}</span>
                </button>
              ))}
            </div>
            {involved && (
              <div className="mt-3 flex gap-2">
                <input className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" placeholder="Add checklist item…" value={newCheck} onChange={(e) => setNewCheck(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCheck()} />
                <Button size="sm" variant="outline" onClick={addCheck}>Add</Button>
              </div>
            )}
          </div>

          {/* Documents */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 font-display text-sm font-semibold">Document checklist</h3>
            <div className="divide-y">
              {(docs ?? []).map((d: any) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.notes ?? ""} {d.received_on && `· received ${fmtDate(d.received_on)}`}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={d.status} />
                    {involved && (
                      <select className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={d.status} onChange={(e) => setDocStatus(d, e.target.value)}>
                        {DOC_STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              ))}
              {(docs ?? []).length === 0 && <p className="py-2 text-sm text-muted-foreground">No document items for this work.</p>}
            </div>
            {involved && (
              <div className="mt-3 flex gap-2">
                <input className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" placeholder="Request a new document…" value={newDoc} onChange={(e) => setNewDoc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDoc()} />
                <Button size="sm" variant="outline" onClick={addDoc}>Request</Button>
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 font-display text-sm font-semibold">Comments &amp; follow-ups</h3>
            <div className="space-y-2">
              {(comments ?? []).map((c: any) => (
                <div key={c.id} className="rounded-md bg-muted/60 p-2.5 text-sm">
                  <div className="flex justify-between text-xs text-muted-foreground"><span className="font-medium text-foreground">{(c as any).profiles?.full_name ?? "—"}</span><span>{fmtDateTime(c.created_at)}</span></div>
                  <p className="mt-1">{c.body}</p>
                </div>
              ))}
              {(comments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <input className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" placeholder="Add a comment or blocker note…" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComment()} />
              <Button size="sm" variant="outline" onClick={addComment}><MessageSquarePlus className="h-4 w-4" /> Post</Button>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 font-display text-sm font-semibold">Status</h3>
            <div className="space-y-3">
              <Field label="Work status">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={a.status} disabled={!involved} onChange={(e) => patch({ status: e.target.value, actual_completion: e.target.value === "Completed" ? new Date().toISOString().slice(0, 10) : null })}>
                  {ASSIGNMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={a.priority} disabled={!involved} onChange={(e) => patch({ priority: e.target.value })}>
                  {PRIORITIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Internal target date">
                <input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={a.internal_due ?? ""} disabled={!involved} onChange={(e) => patch({ internal_due: e.target.value || null })} />
              </Field>
              <Field label="Statutory / client deadline">
                <input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={a.statutory_due ?? ""} disabled={!involved} onChange={(e) => patch({ statutory_due: e.target.value || null })} />
              </Field>
              <Field label="Blocker / reason for delay">
                <input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={a.blocker ?? ""} disabled={!involved} onChange={(e) => patch({ blocker: e.target.value || null })} />
              </Field>
              <Field label="Next follow-up date">
                <input type="date" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={a.follow_up_on ?? ""} disabled={!involved} onChange={(e) => patch({ follow_up_on: e.target.value || null })} />
              </Field>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 text-sm">
            <h3 className="mb-2 font-display text-sm font-semibold">Details</h3>
            <div className="space-y-1.5 text-muted-foreground">
              <div>Assigned staff: <span className="text-foreground">{(a as any).profiles?.full_name ?? "Unassigned"}</span></div>
              <div>Assigned on: <span className="text-foreground">{fmtDate(a.assigned_on)}</span></div>
              <div>Deadline: <span className={du !== null && du < 0 && !["Completed", "Cancelled"].includes(a.status) ? "text-destructive" : "text-foreground"}>{fmtDate(a.statutory_due ?? a.internal_due)}{du !== null && du < 0 ? ` (${-du} days late)` : ""}</span></div>
              <div>Agreed fee: <span className="text-foreground">{fmtINR(a.agreed_fee)}</span></div>
              <div>Progress: <span className="text-foreground">{progress}%</span></div>
              <div>Completed: <span className="text-foreground">{fmtDate(a.actual_completion)}</span></div>
              {a.is_demo && <div className="text-xs">Demo record</div>}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>WhatsApp document request</DialogTitle></DialogHeader>
          <Field label="Message (preview)">
            <textarea readOnly className="min-h-40 w-full rounded-md border border-input bg-muted/50 p-3 text-sm" value={waMessage} />
          </Field>
          <p className="text-xs text-muted-foreground">This opens WhatsApp with the message pre-filled. The system records it as "Opened for Sending" — delivery is confirmed only by the provider, which is not connected.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              if (waNumber) {
                window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(waMessage)}`, "_blank");
              } else {
                toast.error("No WhatsApp number on this client");
                return;
              }
              await supabase.from("comm_logs").insert({
                client_id: a.client_id, assignment_id: assignmentId, message_type: "Document request",
                content: waMessage, channel: "WhatsApp", status: "Opened for Sending", created_by: user?.userId ?? null,
                next_follow_up: a.internal_due,
              });
              queryClient.invalidateQueries({ queryKey: ["comm-logs"] });
              setWaOpen(false);
              toast.success("Logged as Opened for Sending");
            }}>Open WhatsApp &amp; log</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
