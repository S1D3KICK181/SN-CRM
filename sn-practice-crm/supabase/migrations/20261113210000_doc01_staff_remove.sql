-- Migration: 20261113210000_doc01_staff_remove.sql
-- Description: Staff who look after a client may remove its documents (user decision 2026-11-13).
--   Removal still needs a reason, keeps the file and record, and is terminal.

begin;

create or replace function public.guard_client_document_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_client_is_demo boolean;
begin
  if tg_op = 'INSERT' then
    select c.is_demo into v_client_is_demo from public.clients c where c.id = new.client_id;
    new.is_demo := coalesce(v_client_is_demo, false);
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.status <> 'pending' then
      raise exception 'A document starts as a pending upload.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.client_id is distinct from old.client_id
     or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.created_by is distinct from old.created_by then
    raise exception 'The client, file and uploader of a document never change.' using errcode = '23514';
  end if;

  if old.status = 'removed' then
    raise exception 'A removed document cannot be changed.' using errcode = '23514';
  end if;

  if new.status = old.status then
    if new.removed_reason is distinct from old.removed_reason
       or new.removed_by is distinct from old.removed_by
       or new.removed_at is distinct from old.removed_at
       or new.size_bytes is distinct from old.size_bytes then
      raise exception 'Removal facts and file size change only with the status.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'available' then
    if v_actor is not null and v_actor <> old.created_by then
      raise exception 'Only the uploader may confirm an upload.' using errcode = '42501';
    end if;
    if new.removed_reason is not null or new.removed_by is not null or new.removed_at is not null then
      raise exception 'Removal facts change only when a document is removed.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'available' and new.status = 'removed' then
    if v_actor is not null and not public.user_looks_after_client(v_actor, old.client_id) then
      raise exception 'Only the Founder, the Manager or staff who look after this client may remove a document.' using errcode = '42501';
    end if;
    if nullif(btrim(new.removed_reason), '') is null then
      raise exception 'A reason is required to remove a document.' using errcode = '23514';
    end if;
    if new.size_bytes is distinct from old.size_bytes then
      raise exception 'File size changes only when an upload is confirmed.' using errcode = '23514';
    end if;
    new.removed_by := coalesce(v_actor, new.removed_by);
    new.removed_at := now();
    return new;
  end if;

  raise exception 'This document status change is not allowed.' using errcode = '23514';
end;
$$;

commit;
