import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/crm";

export interface CrmUser {
  userId: string;
  email: string;
  fullName: string;
  roles: AppRole[];
  isFounder: boolean;
  isManagement: boolean;
  isFinance: boolean;
}

export function useCrmUser(): { user: CrmUser | null; loading: boolean } {
  const [user, setUser] = useState<CrmUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        if (alive) { setUser(null); setLoading(false); }
        return;
      }
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("full_name, email").eq("id", authUser.id).single(),
        supabase.from("user_roles").select("role").eq("user_id", authUser.id),
      ]);
      const rs = ((roles ?? []).map((r) => r.role)) as AppRole[];
      if (alive) {
        setUser({
          userId: authUser.id,
          email: (profile as any)?.email ?? authUser.email ?? "",
          fullName: (profile as any)?.full_name ?? authUser.email ?? "",
          roles: rs,
          isFounder: rs.includes("founder"),
          isManagement: rs.includes("founder") || rs.includes("manager"),
          isFinance: rs.includes("founder") || rs.includes("accounts"),
        });
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { user, loading };
}
