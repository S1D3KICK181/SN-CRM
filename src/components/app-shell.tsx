import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { isLocalDemoBackend, supabase } from "@/integrations/supabase/client";
import { resetLocalDemoData } from "@/integrations/supabase/local-demo";
import { NAV_SECTIONS, ROLE_LABELS, type AppRole } from "@/lib/crm";
import { useCrmUser, type CrmUser } from "@/hooks/use-crm-user";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Search, LogOut, Menu, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: results } = useQuery({
    queryKey: ["global-search", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const term = q.trim();
      const { data } = await supabase
        .from("clients")
        .select("id, name, client_code, client_type, status")
        .or(
          `name.ilike.%${term}%,client_code.ilike.%${term}%,gstin.ilike.%${term}%,pan.ilike.%${term}%,mobile.ilike.%${term}%`,
        )
        .limit(6);
      return data ?? [];
    },
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id="global-client-search"
        name="globalClientSearch"
        type="search"
        aria-label="Search clients"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim().length >= 2) {
            setOpen(false);
            navigate({ to: "/clients", search: { q: q.trim() } });
          }
        }}
        placeholder="Search clients by name, phone, GSTIN, PAN…"
        className="h-11 w-full rounded-full border border-transparent bg-secondary/70 pl-11 pr-4 text-sm text-foreground outline-none transition-[background-color,box-shadow,border-color] duration-200 placeholder:text-muted-foreground focus:border-ring/25 focus:bg-card focus:ring-4 focus:ring-ring/10"
      />
      {open && q.trim().length >= 2 && (results?.length ?? 0) > 0 && (
        <div
          data-ui="search-results"
          className="taste-skill-ignore absolute z-50 mt-2 w-full overflow-hidden rounded-2xl bg-popover p-1.5 shadow-xl ring-1 ring-border/60"
        >
          {results!.map((c) => (
            <button
              key={c.id}
              className="control-motion flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => {
                setOpen(false);
                setQ("");
                navigate({ to: "/clients/$clientId", params: { clientId: c.id } });
              }}
            >
              <span>{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.client_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

async function signOut(
  navigate: ReturnType<typeof useNavigate>,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  await queryClient.cancelQueries();
  queryClient.clear();
  await supabase.auth.signOut();
  navigate({ to: "/auth", replace: true });
}

export function AppShell({ children, user }: { children: React.ReactNode; user: CrmUser }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const allowed: AppRole[] = user.roles.length ? user.roles : (["trainee"] as AppRole[]);

  const nav = NAV_SECTIONS.filter(
    (n) => n.roles === "all" || n.roles.some((r) => allowed.includes(r)),
  );
  const initials =
    user.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "SN";

  const sidebar = (
    <nav
      aria-label="Primary navigation"
      className="flex h-full flex-col gap-1 overflow-y-auto px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] scrollbar-thin"
    >
      <Link
        to="/"
        className="mb-5 flex min-h-16 items-center gap-3 rounded-xl px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setMobileOpen(false)}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-primary font-display text-sm font-extrabold tracking-[-0.03em] text-primary-foreground shadow-[0_8px_18px_hsl(var(--primary)/0.20)]">
          SN
        </div>
        <div>
          <div className="font-display text-[15px] font-bold leading-tight tracking-[-0.02em] text-foreground">
            SN Practice CRM
          </div>
          <div className="mt-1 text-[11px] font-medium text-muted-foreground">
            SN &amp; Associates
          </div>
        </div>
      </Link>
      {nav.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={() => setMobileOpen(false)}
          className={cn(
            "control-motion relative flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to))
              ? "bg-primary/10 font-semibold text-foreground after:absolute after:right-0 after:h-6 after:w-1 after:rounded-full after:bg-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <item.icon
            className={cn(
              "h-[18px] w-[18px] shrink-0",
              (pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to))) &&
                "text-primary",
            )}
          />
          <span>{item.label}</span>
        </Link>
      ))}
      <div className="mt-auto px-3 py-5 text-[11px] leading-relaxed text-muted-foreground">
        Demo records are labelled and removable from Settings.
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside
        data-ui="app-sidebar"
        className="taste-skill-ignore fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-border/70 bg-card lg:block"
      >
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 cursor-default bg-foreground/35"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            data-ui="mobile-navigation"
            aria-label="Mobile navigation"
            className="taste-skill-ignore absolute inset-y-0 left-0 w-[min(20rem,88vw)] border-r border-border bg-card shadow-xl"
          >
            <button
              aria-label="Close navigation"
              className="control-motion absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col bg-background lg:pl-[264px]">
        {isLocalDemoBackend && (
          <div
            data-ui="local-demo-banner"
            className="taste-skill-ignore flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-primary/10 bg-primary/5 px-5 py-2 text-xs text-foreground"
          >
            <span>
              <strong>Local demo:</strong> isolated sample data stays on this machine and is never
              sent to Lovable Cloud.
            </span>
            <button
              className="control-motion shrink-0 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                resetLocalDemoData();
                queryClient.clear();
                window.location.reload();
              }}
            >
              Reset demo data
            </button>
          </div>
        )}
        <header
          data-ui="app-header"
          className="taste-skill-ignore sticky top-0 z-20 flex min-h-[72px] items-center gap-4 border-b border-border/70 bg-card/95 px-6 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-[0_6px_24px_hsl(var(--foreground)/0.025)]"
        >
          <button
            aria-label="Open navigation"
            className="control-motion -ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3 border-l border-border/70 pl-4">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight text-foreground">
                {user.fullName}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {user.roles.length
                  ? user.roles.map((r) => ROLE_LABELS[r]).join(", ")
                  : "No role assigned"}
              </div>
            </div>
            <div
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary"
            >
              {initials}
            </div>
            <Button
              className="rounded-xl"
              variant="outline"
              size="sm"
              onClick={() => signOut(navigate, queryClient)}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] xl:p-8 xl:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}

export function useAppShell() {
  const { user, loading } = useCrmUser();
  return { user, loading };
}
