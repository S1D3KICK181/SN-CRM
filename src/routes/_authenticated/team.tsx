import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLocalDemoBackend, supabase } from "@/integrations/supabase/client";
import { useCrmUser } from "@/hooks/use-crm-user";
import { PageHeader, StatusBadge, Field, EmptyState } from "@/components/crm-ui";
import { fmtDate } from "@/lib/format";
import { ROLE_LABELS, type AppRole } from "@/lib/crm";
import { createStaffUser, setUserRole, setUserDepartments, removeDemoUsers } from "@/lib/admin-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
});

function TeamPage() {
  const { user } = useCrmUser();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: staff, isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: async () => {
      const [p, r, ud, d] = await Promise.all([
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("user_departments").select("user_id, department_id"),
        supabase.from("departments").select("id, name, is_active").order("name"),
      ]);
      return {
        people: (p.data ?? []).map((x: any) => ({
          ...x,
          roles: (r.data ?? []).filter((rr: any) => rr.user_id === x.id).map((rr: any) => rr.role),
          departments: (ud.data ?? []).filter((u: any) => u.user_id === x.id).map((u: any) => u.department_id),
        })),
        departments: d.data ?? [],
      };
    },
  });

  const { data: workload } = useQuery({
    queryKey: ["team-workload"],
    queryFn: async () => {
      const { data } = await supabase.from("work_assignments").select("assigned_staff, status, statutory_due");
      const map: Record<string, { open: number; overdue: number; done: number }> = {};
      for (const a of data ?? []) {
        if (!a.assigned_staff) continue;
        const cur = map[a.assigned_staff] ?? (map[a.assigned_staff] = { open: 0, overdue: 0, done: 0 });
        if (a.status === "Completed") cur.done++;
        else {
          cur.open++;
          if (a.statutory_due && new Date(a.statutory_due) < new Date()) cur.overdue++;
        }
      }
      return map;
    },
  });

  if (!user?.isManagement) {
    return <EmptyState title="Team & Departments is management-only" hint="Ask the Founder or a Department Head if you need something here." />;
  }

  return (
    <div>
      <PageHeader
        title="Team & Departments"
        subtitle="Staff, roles, departments and current workload"
        actions={user.isFounder ? <Button onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" /> Add staff user</Button> : undefined}
      />

      <div className="mb-6 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2.5">Name</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Departments</th>
            <th className="px-4 py-2.5">Open work</th><th className="px-4 py-2.5">Overdue</th><th className="px-4 py-2.5">Completed</th><th className="px-4 py-2.5">Status</th>
          </tr></thead>
          <tbody className="divide-y">
            {(staff?.people ?? []).map((p: any) => {
              const w = workload?.[p.id] ?? { open: 0, overdue: 0, done: 0 };
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{p.full_name}</div>
                    <div className="text-xs text-muted-foreground">{p.email}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.roles.length === 0 ? <span className="text-xs text-muted-foreground">No role</span> : (
                      user.isFounder ? (
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value={p.roles[0] ?? ""}
                          disabled={busyId === p.id}
                          onChange={async (e) => {
                            setBusyId(p.id);
                            try {
                              if (isLocalDemoBackend) {
                                await supabase.from("user_roles").delete().eq("user_id", p.id);
                                if (e.target.value) await supabase.from("user_roles").insert({ user_id: p.id, role: e.target.value as AppRole });
                              } else {
                                await setUserRole({ data: { userId: p.id, role: e.target.value || null } });
                              }
                            }
                            catch (err: any) { toast.error(err.message); }
                            queryClient.invalidateQueries({ queryKey: ["team"] });
                            setBusyId(null);
                          }}
                        >
                          <option value="">No role</option>
                          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      ) : (
                        <span>{p.roles.map((r: string) => ROLE_LABELS[r as AppRole]).join(", ")}</span>
                      )
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {p.departments.map((id: string) => staff!.departments.find((d: any) => d.id === id)?.name).filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2.5">{w.open}</td>
                  <td className={"px-4 py-2.5" + (w.overdue ? " font-medium text-destructive" : "")}>{w.overdue}</td>
                  <td className="px-4 py-2.5">{w.done}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={p.is_active ? "Active" : "Inactive"} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 font-display text-sm font-semibold">Departments</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(staff?.departments ?? []).map((d: any) => (
          <div key={d.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <div className="font-medium">{d.name}</div>
            <div className="text-xs text-muted-foreground">{(staff?.people ?? []).filter((p: any) => p.departments.includes(d.id)).length} member(s)</div>
          </div>
        ))}
      </div>

      {user.isFounder && !isLocalDemoBackend && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-sm font-semibold">Demo maintenance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Remove the five demo staff accounts (demo.*@sn-demo.local) created for testing. Real users are unaffected.</p>
          <Button variant="destructive" size="sm" className="mt-3" onClick={async () => {
            try { await removeDemoUsers({}); toast.success("Demo staff accounts removed"); queryClient.invalidateQueries({ queryKey: ["team"] }); }
            catch (e: any) { toast.error(e.message); }
          }}>Remove demo staff accounts</Button>
        </div>
      )}

      {addOpen && user.isFounder && (
        <AddStaffDialog
          departments={staff?.departments ?? []}
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); queryClient.invalidateQueries({ queryKey: ["team"] }); }}
        />
      )}
    </div>
  );
}

function AddStaffDialog({ departments, onClose, onSaved }: { departments: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({ role: "staff", departmentIds: [] });
  const [busy, setBusy] = useState(false);
  const toggleDept = (id: string) => {
    setForm((f: any) => ({
      ...f,
      departmentIds: f.departmentIds.includes(id) ? f.departmentIds.filter((x: string) => x !== id) : [...f.departmentIds, id],
    }));
  };
  const save = async () => {
    if (!form.email || !form.password || !form.fullName) { toast.error("Name, email and password are required"); return; }
    setBusy(true);
    try {
      if (isLocalDemoBackend) {
        const userId = crypto.randomUUID();
        await supabase.from("profiles").insert({ id: userId, email: form.email, full_name: form.fullName, designation: form.designation || null, is_active: true });
        await supabase.from("user_roles").insert({ user_id: userId, role: form.role });
        for (const departmentId of form.departmentIds) await supabase.from("user_departments").insert({ user_id: userId, department_id: departmentId });
      } else {
        await createStaffUser({ data: { email: form.email, password: form.password, fullName: form.fullName, role: form.role, designation: form.designation, departmentIds: form.departmentIds } });
      }
      toast.success("Staff user created");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add staff user</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">The account is created immediately active — share the password securely and ask the person to change it after first sign-in.</p>
        <div className="grid gap-3">
          <Field label="Full name *"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.fullName ?? ""} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Email *"><input type="email" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Temporary password *" ><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.password ?? ""} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Role">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).filter(([k]) => k !== "founder").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Designation"><input className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.designation ?? ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></Field>
          <Field label="Departments">
            <div className="space-y-1 rounded-md border border-input bg-background p-2">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.departmentIds.includes(d.id)} onChange={() => toggleDept(d.id)} /> {d.name}
                </label>
              ))}
            </div>
          </Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Creating…" : "Create user"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
