import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Founder-only privileged operations. Role is verified server-side; the
// service-role client is loaded only inside handlers, after the check.

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      email: string;
      password: string;
      fullName: string;
      role: string;
      designation?: string;
      departmentIds?: string[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { data: isFounder } = await context.supabase.rpc("is_founder");
    if (!isFounder) throw new Error("Only the Founder can create users");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    const userId = created.user!.id;

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: data.role as any }, { onConflict: "user_id,role" });
    if (data.designation) {
      await supabaseAdmin
        .from("profiles")
        .update({ designation: data.designation })
        .eq("id", userId);
    }
    for (const deptId of data.departmentIds ?? []) {
      await supabaseAdmin
        .from("user_departments")
        .insert({ user_id: userId, department_id: deptId });
    }
    return { ok: true, userId };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; role: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { data: isFounder } = await context.supabase.rpc("is_founder");
    if (!isFounder) throw new Error("Only the Founder can change roles");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    if (data.role) {
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role as any });
    }
    return { ok: true };
  });

export const setUserDepartments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; departmentIds: string[] }) => input)
  .handler(async ({ data, context }) => {
    const { data: isFounder } = await context.supabase.rpc("is_founder");
    if (!isFounder) throw new Error("Only the Founder can change departments");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_departments").delete().eq("user_id", data.userId);
    for (const deptId of data.departmentIds) {
      await supabaseAdmin
        .from("user_departments")
        .insert({ user_id: data.userId, department_id: deptId });
    }
    return { ok: true };
  });

// Removes every record flagged as demo data, without touching real records
export const removeDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isFounder } = await context.supabase.rpc("is_founder");
    if (!isFounder) throw new Error("Only the Founder can remove demo data");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const demo = await supabaseAdmin.from("clients").select("id").eq("is_demo", true);
    const ids = (demo.data ?? []).map((r: any) => r.id);
    // Cascading deletes handle the dependants
    if (ids.length > 0) {
      await supabaseAdmin.from("clients").delete().in("id", ids);
    }
    for (const table of [
      "advisory_actions",
      "advisory_reports",
      "audit_findings",
      "audit_engagements",
    ]) {
      await (supabaseAdmin.from(table as any) as any).delete().eq("is_demo", true);
    }
    for (const table of ["tasks", "engagements", "comm_logs", "invoices"]) {
      await (supabaseAdmin.from(table as any) as any).delete().eq("is_demo", true);
    }
    await (supabaseAdmin.from("client_tax_money") as any).delete().eq("is_demo", true);
    return { ok: true };
  });

// Founder creates staff accounts; demo users are removable too
export const removeDemoUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isFounder } = await context.supabase.rpc("is_founder");
    if (!isFounder) throw new Error("Only the Founder can remove demo users");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    for (const u of users.users) {
      if (u.email?.endsWith("@sn-demo.local")) {
        await supabaseAdmin.auth.admin.deleteUser(u.id);
      }
    }
    return { ok: true };
  });
