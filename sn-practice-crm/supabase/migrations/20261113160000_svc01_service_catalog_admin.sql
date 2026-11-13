-- Migration: 20261113160000_svc01_service_catalog_admin.sql
-- Description: SVC-01 Service names are unique ignoring case and surrounding spaces

begin;

create unique index service_catalog_name_normalized_key
  on public.service_catalog (lower(btrim(name)));

commit;
