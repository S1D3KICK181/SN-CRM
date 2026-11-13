-- Migration: 20261113183000_cli02_identifier_privileges.sql
-- Description: CLI-02a The raw PAN and GSTIN are no longer readable straight from public.clients.
--              Every read goes through client_identifiers(), which masks them and reveals the
--              full values only to readers who look after the client.

begin;

-- 1. Masking, identical to apps/api/src/client-privacy.ts
create or replace function public.mask_pan(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when t is null or t = '' then null
    when t ~ '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$' then '******' || substr(t, 6, 4)
    else repeat('*', 10)
  end
  from (select regexp_replace(p_raw, '^\s+|\s+$', '', 'g') as t) s;
$$;

create or replace function public.mask_gstin(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when t is null or t = '' then null
    when t ~ '^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]$'
      then substr(t, 1, 2) || repeat('*', 10) || upper(substr(t, 13))
    else repeat('*', 15)
  end
  from (select regexp_replace(p_raw, '^\s+|\s+$', '', 'g') as t) s;
$$;

-- 2. The only read path for the identifiers: no row unless the client is visible,
--    full values only when the reader looks after the client
create or replace function public.client_identifiers(p_client_id uuid)
returns table (pan_masked text, gstin_masked text, pan text, gstin text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.mask_pan(c.pan),
    public.mask_gstin(c.gstin),
    case when public.looks_after_client(c.id) then nullif(c.pan, '') end,
    case when public.looks_after_client(c.id) then nullif(c.gstin, '') end
  from public.clients c
  where c.id = p_client_id
    and public.client_visible(p_client_id);
$$;

revoke all on function public.mask_pan(text) from public, anon;
revoke all on function public.mask_gstin(text) from public, anon;
revoke all on function public.client_identifiers(uuid) from public, anon;
grant execute on function public.mask_pan(text) to authenticated;
grant execute on function public.mask_gstin(text) to authenticated;
grant execute on function public.client_identifiers(uuid) to authenticated;

-- 3. Column privileges: everything except pan and gstin stays readable; writes are unchanged
revoke select on public.clients from authenticated;
grant select (
  id, code, display_name, legal_name, email, phone, relationship_owner_id, status, notes,
  created_by, created_at, updated_at, is_demo,
  entity_type, address_line1, address_line2, city, state, pincode,
  tan, cin_llpin, udyam_number, iec, incorporation_date
) on public.clients to authenticated;

commit;
