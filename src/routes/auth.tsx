import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { isLocalDemoBackend, supabase } from "@/integrations/supabase/client";
import { LOCAL_DEMO_EMAIL, LOCAL_DEMO_PASSWORD } from "@/integrations/supabase/local-demo";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/crm-ui";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) throw redirect({ to: "/" });
  },
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signUp = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: { full_name: fullName },
        },
      });
      if (error) throw error;
      if (data.session === null) {
        setSent(true);
      } else {
        navigate({ to: "/" });
      }
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Sign up failed"));
    } finally {
      setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/", replace: true });
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Sign in failed"));
    } finally {
      setBusy(false);
    }
  };

  const enterLocalDemo = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: LOCAL_DEMO_EMAIL,
        password: LOCAL_DEMO_PASSWORD,
      });
      if (error) throw error;
      navigate({ to: "/", replace: true });
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Could not open the local demo"));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset-password",
      });
      if (error) throw error;
      toast.success("Password reset email sent — check your inbox");
      setMode("signin");
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Could not send reset email"));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || (!password && mode !== "forgot")) return;
    if (mode === "signin") await signIn();
    else if (mode === "signup") await signUp();
    else await forgot();
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="font-display text-xl font-semibold">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
            account, then sign in.
          </p>
          <Button
            variant="outline"
            className="mt-6 w-full"
            onClick={() => {
              setSent(false);
              setMode("signin");
            }}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary font-display text-base font-bold text-primary-foreground">
            SN
          </div>
          <div>
            <div className="font-display text-lg font-semibold text-primary">SN Practice CRM</div>
            <div className="text-xs text-muted-foreground">
              Client, Work, Billing &amp; Collection Management
            </div>
          </div>
        </div>
        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          {mode === "signup" && (
            <Field label="Full name" htmlFor="auth-full-name">
              <input
                id="auth-full-name"
                name="fullName"
                autoComplete="name"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. S. Narayanan"
                required
              />
            </Field>
          )}
          <Field label="Email" htmlFor="auth-email">
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@firm.in"
              required
            />
          </Field>
          {mode !== "forgot" && (
            <Field label="Password" htmlFor="auth-password">
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </Field>
          )}
          <Button className="w-full" size="lg" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </Button>
          {isLocalDemoBackend && mode === "signin" && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                size="lg"
                disabled={busy}
                onClick={enterLocalDemo}
              >
                Enter local demo
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                No online account required. Demo changes stay in this browser.
              </p>
            </>
          )}
          <div className="flex justify-between text-xs text-muted-foreground">
            {mode === "signin" ? (
              <>
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => setMode("signup")}
                >
                  Create an account
                </button>
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => setMode("forgot")}
                >
                  Forgot password?
                </button>
              </>
            ) : (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => setMode("signin")}
              >
                ← Back to sign in
              </button>
            )}
          </div>
        </form>
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          {isLocalDemoBackend
            ? "Local demo mode is enabled; Lovable Cloud data is not being used."
            : "The first account created becomes the Founder. Staff accounts should be created by the Founder in Settings."}
        </p>
      </div>
    </div>
  );
}

import { useNavigate } from "@tanstack/react-router";
