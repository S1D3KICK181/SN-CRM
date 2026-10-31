<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md — SN Practice CRM

## Stack decisions
- TanStack Start + Lovable Cloud (Supabase). All data access is client-side `supabase` from `@/integrations/supabase/client`; row-level security is the permission layer.
- Roles live in `public.user_roles` (enum `app_role`), never on profiles. Helper SQL functions (`is_founder`, `is_management`, `is_finance_or_manager`, `client_visible`, `assignment_involvement`) are security-definer and used by every RLS policy — extend them, don't bypass them.
- Privileged operations (create staff user, change roles, remove demo data) go through `src/lib/admin-fns.ts` server functions: they verify `is_founder` via `context.supabase.rpc` BEFORE loading `supabaseAdmin` inside the handler.
- Auto-generated codes (client, assignment, task, invoice, receipt) come from DB triggers + sequences; the UI never invents them. Invoice prefix is configurable in `org_settings`.
- `payment_allocations` trigger recomputes invoice `amount_received`/`status`; never update those columns directly — insert/update allocations and let the trigger do it.
- Demo data carries `is_demo = true` on every row and lives under the six named demo clients + `*@sn-demo.local` staff accounts; Settings → Remove demo data deletes only flagged rows.

## UI conventions
- Routes live under `src/routes/_authenticated/` (pathless layout gates them, `ssr: false`). `/auth` and `/reset-password` are public.
- Formats: ₹ (en-IN), DD/MM/YYYY, FY 2026–27, Asia/Kolkata — helpers in `src/lib/format.ts`.
- Colors only via semantic tokens in `src/styles.css` (navy `--primary`, red accent `--signal`); no hardcoded color classes in components.
- Sidebar navigation per role is defined once in `src/lib/crm.ts` (`NAV_SECTIONS`); RLS remains the real gate.
