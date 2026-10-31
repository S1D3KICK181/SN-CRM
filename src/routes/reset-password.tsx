import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/crm-ui";

export const Route = createFileRoute("/reset-password")({
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/auth" });
  },
  component: ResetPassword,
});

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate({ to: "/" }), 1200);
    } catch (err: any) {
      toast.error(err.message ?? "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-display text-xl font-semibold">Set a new password</h1>
        {done ? (
          <p className="text-sm text-emerald-700">Password updated. Redirecting…</p>
        ) : (
          <>
            <Field label="New password">
              <input type="password" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </Field>
            <Button className="w-full" disabled={busy}>{busy ? "Updating…" : "Update password"}</Button>
          </>
        )}
      </form>
    </div>
  );
}
