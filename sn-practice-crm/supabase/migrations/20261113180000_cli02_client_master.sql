-- Migration: 20261113180000_cli02_client_master.sql
-- Description: CLI-02a Client master: entity type, address, other registrations, contact people,
--              editing by the relationship owner, and the "looks after this client" helper

begin;

-- 1. Client details
alter table public.clients
  add column entity_type text,
  add column address_line1 text,
  add column address_line2 text,
  add column city text,
  add column state text,
  add column pincode text,
  add column tan text,
  add column cin_llpin text,
  add column udyam_number text,
  add column iec text,
  add column incorporation_date date;

alter table public.clients
  add constraint clients_entity_type_check check (
    entity_type is null or entity_type in (
      'individual', 'huf', 'proprietorship', 'partnership', 'llp',
      'private_limited', 'public_limited', 'trust', 'society', 'other'
    )
  ),
  add constraint clients_address_line1_length check (address_line1 is null or char_length(address_line1) <= 200),
  add constraint clients_address_line2_length check (address_line2 is null or char_length(address_line2) <= 200),
  add constraint clients_city_length check (city is null or char_length(city) <= 100),
  add constraint clients_state_length check (state is null or char_length(state) <= 60),
  add constraint clients_pincode_format check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  add constraint clients_tan_format check (tan is null or tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$'),
  add constraint clients_cin_llpin_format check (
    cin_llpin is null
    or cin_llpin ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$'
    or cin_llpin ~ '^[A-Z]{3}-[0-9]{4}$'
  ),
  add constraint clients_udyam_number_format check (
    udyam_number is null or udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'
  ),
  add constraint clients_iec_format check (iec is null or iec ~ '^[A-Z0-9]{10}$');

-- 2. Who looks after a client. The same test the fee helpers use, under a neutral name.
create or replace function public.user_looks_after_client(
  p_user_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_management(p_user_id)
    or (
      public.role_of(p_user_id) in ('senior_staff', 'staff')
      and (
        exists (
          select 1 from public.clients c
          where c.id = p_client_id and c.relationship_owner_id = p_user_id
        )
        or exists (
          select 1 from public.assignments a
          where a.client_id = p_client_id
            and (
              a.owner_id = p_user_id
              or exists (
                select 1 from public.assignment_reviewers ar
                where ar.assignment_id = a.id and ar.reviewer_id = p_user_id
              )
            )
        )
      )
    );
$$;

create or replace function public.looks_after_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_looks_after_client(auth.uid(), p_client_id);
$$;

-- Fee visibility is exactly "looks after the client"; behaviour is unchanged.
create or replace function public.user_fee_visible(
  p_user_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_looks_after_client(p_user_id, p_client_id);
$$;

-- 3. Who may edit a client: management, or the client's relationship owner
create or replace function public.user_can_edit_client(
  p_user_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_management(p_user_id)
    or exists (
      select 1 from public.clients c
      where c.id = p_client_id and c.relationship_owner_id = p_user_id
    );
$$;

create or replace function public.can_edit_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.user_can_edit_client(auth.uid(), p_client_id);
$$;

revoke all on function public.user_looks_after_client(uuid, uuid) from public, anon;
revoke all on function public.looks_after_client(uuid) from public, anon;
revoke all on function public.user_can_edit_client(uuid, uuid) from public, anon;
revoke all on function public.can_edit_client(uuid) from public, anon;
grant execute on function public.user_looks_after_client(uuid, uuid) to authenticated;
grant execute on function public.looks_after_client(uuid) to authenticated;
grant execute on function public.user_can_edit_client(uuid, uuid) to authenticated;
grant execute on function public.can_edit_client(uuid) to authenticated;

-- 4. Clients: the relationship owner may update; only management changes owner or status
drop policy clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (public.can_edit_client(id))
  with check (public.can_edit_client(id));

create or replace function public.guard_client_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null and not public.is_management(v_actor) then
      raise exception 'Only the Founder or Manager may change this record.' using errcode = '42501';
    end if;
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    return new;
  end if;

  if v_actor is not null and not public.user_can_edit_client(v_actor, old.id) then
    raise exception 'Only the Founder or Manager may change this record.' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Creator provenance is immutable.' using errcode = '23514';
  end if;
  if new.code is distinct from old.code then
    raise exception 'Client codes are database-generated and immutable.' using errcode = '23514';
  end if;
  if v_actor is not null
     and not public.is_management(v_actor)
     and (
       new.relationship_owner_id is distinct from old.relationship_owner_id
       or new.status is distinct from old.status
     ) then
    raise exception 'Only the Founder or Manager may change the relationship owner or status.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger guard_client_write on public.clients;
create trigger guard_client_write
  before insert or update on public.clients
  for each row execute function public.guard_client_write();

-- 5. Client contact people
create table public.client_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  designation text check (designation is null or char_length(designation) <= 80),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or (char_length(phone) <= 20 and phone ~ '^[0-9 +-]+$')),
  whatsapp text check (whatsapp is null or (char_length(whatsapp) <= 20 and whatsapp ~ '^[0-9 +-]+$')),
  is_primary boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 300),
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false,
  constraint client_contacts_reachable check (
    email is not null or phone is not null or whatsapp is not null
  )
);

create index client_contacts_client_idx on public.client_contacts (client_id);
create unique index client_contacts_one_primary_idx
  on public.client_contacts (client_id)
  where is_primary;

-- A contact belongs to its client's dataset: is_demo is inherited, never supplied.
-- The client and creator never change.
create or replace function public.guard_client_contact_write()
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
    return new;
  end if;

  if new.client_id is distinct from old.client_id then
    raise exception 'A contact cannot move to another client.' using errcode = '23514';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Creator provenance is immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_client_contact_write
  before insert or update on public.client_contacts
  for each row execute function public.guard_client_contact_write();
create trigger prevent_demo_flag_tampering before update on public.client_contacts
  for each row execute function public.prevent_demo_flag_tampering();
create trigger set_client_contacts_updated_at before update on public.client_contacts
  for each row execute function public.set_updated_at();
create trigger audit_client_contacts after insert or update or delete on public.client_contacts
  for each row execute function public.audit_row_change();

alter table public.client_contacts enable row level security;

create policy client_contacts_select on public.client_contacts
  for select to authenticated
  using (public.client_visible(client_id));
create policy client_contacts_insert on public.client_contacts
  for insert to authenticated
  with check (public.can_edit_client(client_id) and created_by = auth.uid());
create policy client_contacts_update on public.client_contacts
  for update to authenticated
  using (public.can_edit_client(client_id))
  with check (public.can_edit_client(client_id));
create policy client_contacts_delete on public.client_contacts
  for delete to authenticated
  using (public.can_edit_client(client_id));

revoke all on table public.client_contacts from public, anon;
grant select, insert, update, delete on public.client_contacts to authenticated;

commit;
