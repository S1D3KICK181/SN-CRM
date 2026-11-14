-- Migration: 20261114130000_dept01_masked_ids_for_heads.sql
-- Description: A department head can read the client rows of their department's work (DEPT-01), but
--   client_identifiers() still required client_visible(), so a head saw no PAN/GSTIN at all and the
--   screen showed "Not added" even when a PAN exists. Masked values now follow can_read_client();
--   full values still require looks_after_client(), unchanged.

begin;

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
    and public.can_read_client(p_client_id);
$$;

revoke all on function public.client_identifiers(uuid) from public, anon;
grant execute on function public.client_identifiers(uuid) to authenticated;

commit;
