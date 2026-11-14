-- Migration: 20261114090000_clean01_remove_demo_label.sql
-- Description: CLEAN-01 There is no demo mode. Sample data is ordinary data, so the is_demo label,
--              the tamper guard behind it and the demo-removal routine all go. No row is touched.
--              Every function below is rewritten from its current definition with only the
--              is_demo and demo-cleanup parts removed; every other rule is unchanged.

begin;

-- 1. Functions without the label and without the demo-cleanup bypass
create or replace function public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_record_pk text;
  v_headers jsonb;
  v_request_id text;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  -- 1. Personal work-item privacy redaction (retained verbatim from 0001_practice_core.sql)
  if tg_table_name = 'work_items'
     and coalesce(v_new ->> 'kind', v_old ->> 'kind') = 'personal' then
    if v_old is not null then
      v_old := v_old - 'title' - 'description' - 'completion_note';
    end if;
    if v_new is not null then
      v_new := v_new - 'title' - 'description' - 'completion_note';
    end if;
  end if;

  -- 2. Complete record PK extraction supporting single and composite PKs (retained verbatim)
  v_record_pk := coalesce(
    v_new ->> 'id',
    v_old ->> 'id',
    v_new ->> 'user_id',
    v_old ->> 'user_id',
    v_new ->> 'employee_id',
    v_old ->> 'employee_id',
    nullif(concat_ws(':', v_new ->> 'assignment_id', v_new ->> 'reviewer_id'), ''),
    nullif(concat_ws(':', v_old ->> 'assignment_id', v_old ->> 'reviewer_id'), '')
  );

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_request_id := coalesce(v_headers ->> 'x-request-id', v_headers ->> 'x-correlation-id');
  exception when others then
    v_request_id := null;
  end;

  insert into public.audit_log (
    actor_id,
    actor_role,
    table_name,
    operation,
    record_pk,
    old_row,
    new_row,
    request_id
  ) values (
    auth.uid(),
    public.role_of(auth.uid()),
    tg_table_name,
    tg_op,
    v_record_pk,
    v_old,
    v_new,
    v_request_id
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function public.guard_client_contact_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
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
$function$;

create or replace function public.guard_client_document_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
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
$function$;

create or replace function public.guard_client_message_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.client_contacts cc where cc.id = new.contact_id and cc.client_id = new.client_id
    ) then
      raise exception 'The contact does not belong to this client.' using errcode = '23514';
    end if;
    if new.assignment_id is not null and not exists (
      select 1 from public.assignments a where a.id = new.assignment_id and a.client_id = new.client_id
    ) then
      raise exception 'The linked work does not belong to this client.' using errcode = '23514';
    end if;
    if new.invoice_id is not null and not exists (
      select 1 from public.invoices i where i.id = new.invoice_id and i.client_id = new.client_id
    ) then
      raise exception 'The linked work does not belong to this client.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.contact_id is null and old.contact_id is not null then
    -- the contact was deleted: only the link may go, and only to null
    if new.id is distinct from old.id
       or new.client_id is distinct from old.client_id
       or new.recipient_name is distinct from old.recipient_name
       or new.recipient_number is distinct from old.recipient_number
       or new.channel is distinct from old.channel
       or new.purpose is distinct from old.purpose
       or new.assignment_id is distinct from old.assignment_id
       or new.invoice_id is distinct from old.invoice_id
       or new.body is distinct from old.body
       or new.status is distinct from old.status
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'A recorded message cannot be changed.' using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'A recorded message cannot be changed.' using errcode = '23514';
end;
$function$;

create or replace function public.guard_engagement_version_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_partner_role public.app_role;
  v_manager_role public.app_role;
  v_parent_engagement record;
begin
  if tg_op = 'DELETE' then
    raise exception 'Engagement versions cannot be deleted.' using errcode = '42501';
  end if;

  if v_actor is not null then
    v_actor_role := public.role_of(v_actor);
    if v_actor_role not in ('founder', 'manager') then
      raise exception 'Only Founder or Manager may create or revise engagement versions.'
        using errcode = '42501';
    end if;
  end if;

  -- Validate responsible_partner_id must resolve to an active Founder
  v_partner_role := public.role_of(new.responsible_partner_id);
  if v_partner_role is null or v_partner_role <> 'founder' then
    raise exception 'The responsible partner must be an active Founder.'
      using errcode = '23514';
  end if;

  -- Validate delivery_manager_id must resolve to an active management user (founder or manager)
  v_manager_role := public.role_of(new.delivery_manager_id);
  if v_manager_role is null or v_manager_role not in ('founder', 'manager') then
    raise exception 'The delivery manager must be an active Founder or Manager.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;

    -- Verify parent engagement exists and is not ended
    select status into v_parent_engagement
    from public.engagements
    where id = new.engagement_id;

    if not found then
      raise exception 'Parent engagement does not exist.' using errcode = '23503';
    end if;

    if v_parent_engagement.status = 'ended' then
      raise exception 'Cannot create versions on an ended engagement.' using errcode = '23514';
    end if;

    -- Approved fields on insert: only Founder may insert pre-approved version
    if new.approved_at is not null or new.approved_by is not null then
      if v_actor is not null and v_actor_role <> 'founder' then
        raise exception 'Only the Founder may approve an engagement version.'
          using errcode = '42501';
      end if;
      if v_actor is not null then
        new.approved_by := v_actor;
        new.approved_at := now();
      elsif new.approved_by is not null and new.approved_at is null then
        new.approved_at := now();
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Verify parent engagement exists and is not ended
    select status into v_parent_engagement
    from public.engagements
    where id = new.engagement_id;

    if not found then
      raise exception 'Parent engagement does not exist.' using errcode = '23503';
    end if;

    if v_parent_engagement.status = 'ended' then
      raise exception 'Cannot update versions on an ended engagement.' using errcode = '23514';
    end if;

    -- Once approved, version is immutable
    if old.approved_at is not null then
      raise exception 'Approved engagement versions are strictly immutable.'
        using errcode = '23514';
    end if;

    -- Structural immutability on unapproved versions
    if new.engagement_id is distinct from old.engagement_id
       or new.version_number is distinct from old.version_number
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Engagement version identity and provenance are immutable.'
        using errcode = '23514';
    end if;

    -- Approval transition: unapproved -> approved
    if new.approved_at is not null or new.approved_by is not null then
      if v_actor is not null and v_actor_role <> 'founder' then
        raise exception 'Only the Founder may approve an engagement version.'
          using errcode = '42501';
      end if;
      if v_actor is not null then
        new.approved_by := v_actor;
        new.approved_at := now();
      elsif new.approved_by is not null and new.approved_at is null then
        new.approved_at := now();
      end if;
    end if;

    return new;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_engagement_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_client_status public.client_status;
  v_service_active boolean;
  v_approved_ver record;
  v_version_approver_role public.app_role;
begin
  if tg_op = 'DELETE' then
    raise exception 'Engagements cannot be deleted.' using errcode = '42501';
  end if;

  if v_actor is not null then
    v_actor_role := public.role_of(v_actor);
    if v_actor_role not in ('founder', 'manager') then
      raise exception 'Only Founder or Manager may access engagements.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.created_by := v_actor;
    end if;

    -- Every normal engagement INSERT must begin in draft
    if new.status <> 'draft' then
      raise exception 'Every new engagement must be created in draft status.'
        using errcode = '23514';
    end if;

    -- Draft insert must have all approval/end metadata null
    if new.approved_version_id is not null
       or new.approved_at is not null
       or new.approved_by is not null
       or new.ended_at is not null
       or new.ended_by is not null
       or new.end_outcome is not null
       or new.end_reason is not null then
      raise exception 'Draft engagement must not have approval or ending metadata.'
        using errcode = '23514';
    end if;

    -- Verify client exists and is active on draft INSERT
    select status into v_client_status
    from public.clients
    where id = new.client_id;

    if not found then
      raise exception 'Client does not exist.' using errcode = '23503';
    end if;

    if v_client_status <> 'active' then
      raise exception 'Client must be active for engagement creation.'
        using errcode = '23514';
    end if;

    -- Verify service exists and is active on draft INSERT
    select is_active into v_service_active
    from public.service_catalog
    where id = new.service_id;

    if not found then
      raise exception 'Service does not exist in catalog.' using errcode = '23503';
    end if;

    if not v_service_active then
      raise exception 'Service must be active in catalog for engagement creation.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Immutability of identity, service, and provenance
    if new.code is distinct from old.code
       or new.client_id is distinct from old.client_id
       or new.service_id is distinct from old.service_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Engagement identity, client, service, and provenance are immutable.'
        using errcode = '23514';
    end if;

    -- Ended engagements are terminal and immutable
    if old.status = 'ended' then
      raise exception 'Ended engagements are terminal and immutable.'
        using errcode = '23514';
    end if;

    -- Status transitions
    if new.status <> old.status then
      -- Valid transitions: draft -> active, active -> ended
      if old.status = 'draft' and new.status = 'active' then
        if v_actor is not null and v_actor_role <> 'founder' then
          raise exception 'Only the Founder may activate an engagement.'
            using errcode = '42501';
        end if;

        -- Recheck active client on activation
        select status into v_client_status
        from public.clients
        where id = new.client_id;

        if not found or v_client_status <> 'active' then
          raise exception 'Client must be active for engagement activation.'
            using errcode = '23514';
        end if;

        -- Recheck active service on activation
        select is_active into v_service_active
        from public.service_catalog
        where id = new.service_id;

        if not found or not v_service_active then
          raise exception 'Service must be active in catalog for engagement activation.'
            using errcode = '23514';
        end if;

        -- Validate selected approved_version_id
        if new.approved_version_id is null then
          raise exception 'An approved version is required to activate an engagement.'
            using errcode = '23514';
        end if;

        select id, engagement_id, approved_at, approved_by into v_approved_ver
        from public.engagement_versions
        where id = new.approved_version_id;

        if not found then
          raise exception 'Approved version does not exist.' using errcode = '23503';
        end if;

        if v_approved_ver.engagement_id <> new.id then
          raise exception 'Approved version must belong to this engagement.' using errcode = '23514';
        end if;

        if v_approved_ver.approved_at is null or v_approved_ver.approved_by is null then
          raise exception 'Version must be approved before engagement activation.' using errcode = '23514';
        end if;

        v_version_approver_role := public.role_of(v_approved_ver.approved_by);
        if v_version_approver_role is null or v_version_approver_role <> 'founder' then
          raise exception 'Version approver must resolve to an active Founder.' using errcode = '23514';
        end if;

        -- Copy approval metadata from the approved version; do not trust caller-supplied values
        new.approved_at := v_approved_ver.approved_at;
        new.approved_by := v_approved_ver.approved_by;

      elsif old.status = 'active' and new.status = 'ended' then
        if v_actor is not null and v_actor_role <> 'founder' then
          raise exception 'Only the Founder may end an engagement.'
            using errcode = '42501';
        end if;

        -- Ending may not simultaneously change approved_version_id or approval metadata
        if new.approved_version_id is distinct from old.approved_version_id
           or new.approved_at is distinct from old.approved_at
           or new.approved_by is distinct from old.approved_by then
          raise exception 'Ending an engagement cannot change approved version or approval metadata.'
            using errcode = '23514';
        end if;

        if v_actor is not null then
          new.ended_at := now();
          new.ended_by := v_actor;
        else
          if new.ended_at is null then
            new.ended_at := now();
          end if;
        end if;

        if new.end_outcome is null or new.end_reason is null or char_length(trim(new.end_reason)) < 2 then
          raise exception 'An end outcome and reason are required to end an engagement.'
            using errcode = '23514';
        end if;

      else
        raise exception 'Invalid engagement status transition: % to %', old.status, new.status
          using errcode = '23514';
      end if;

    else
      -- Status does not change
      if old.status = 'active' then
        -- Amendment of approved_version_id on an active engagement
        if new.approved_version_id is distinct from old.approved_version_id then
          if v_actor is not null and v_actor_role <> 'founder' then
            raise exception 'Only the Founder may approve an amendment on an active engagement.'
              using errcode = '42501';
          end if;

          if new.approved_version_id is null then
            raise exception 'Active engagement must have an approved version.'
              using errcode = '23514';
          end if;

          select id, engagement_id, approved_at, approved_by into v_approved_ver
          from public.engagement_versions
          where id = new.approved_version_id;

          if not found then
            raise exception 'Approved version does not exist.' using errcode = '23503';
          end if;

          if v_approved_ver.engagement_id <> new.id then
            raise exception 'Approved version must belong to this engagement.' using errcode = '23514';
          end if;

          if v_approved_ver.approved_at is null or v_approved_ver.approved_by is null then
            raise exception 'Version must be approved before amending active engagement.' using errcode = '23514';
          end if;

          v_version_approver_role := public.role_of(v_approved_ver.approved_by);
          if v_version_approver_role is null or v_version_approver_role <> 'founder' then
            raise exception 'Version approver must resolve to an active Founder.' using errcode = '23514';
          end if;

          -- Copy approval metadata from the new approved version
          new.approved_at := v_approved_ver.approved_at;
          new.approved_by := v_approved_ver.approved_by;

        else
          -- If approved_version_id does not change, approved_at and approved_by are immutable
          if new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
            raise exception 'Approval metadata is immutable when approved version does not change.'
              using errcode = '23514';
          end if;
        end if;

        -- On active engagement, ended metadata must remain null
        if new.ended_at is not null or new.ended_by is not null or new.end_outcome is not null or new.end_reason is not null then
          raise exception 'Active engagement cannot have ending metadata.' using errcode = '23514';
        end if;

      elsif old.status = 'draft' then
        -- In draft state, approval and ending metadata must remain null
        if new.approved_version_id is not null
           or new.approved_at is not null
           or new.approved_by is not null
           or new.ended_at is not null
           or new.ended_by is not null
           or new.end_outcome is not null
           or new.end_reason is not null then
          raise exception 'Draft engagement must not have approval or ending metadata.'
            using errcode = '23514';
        end if;
      end if;

    end if;

    return new;
  end if;

  return new;
end;
$function$;

create or replace function public.guard_invoice_item_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_invoice_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  v_status public.invoice_status;
begin
  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may edit Invoice Items.' using errcode = '42501';
  end if;
  select i.status into v_status from public.invoices i where i.id = v_invoice_id;
  if v_status is null then
    raise exception 'Invoice not found.' using errcode = '23503';
  end if;
  if v_status <> 'draft' then
    raise exception 'Invoice Items are immutable after issue; void and reissue instead.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.invoice_id is distinct from old.invoice_id then
      raise exception 'An Invoice Item cannot be moved between Invoices.' using errcode = '23514';
    end if;
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

create or replace function public.guard_recurring_schedule_reviewer_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_reviewer_role public.app_role;
begin
  if tg_op = 'DELETE' then
    if v_actor is not null and not public.is_management(v_actor) then
      raise exception 'Only the Founder or Manager may remove recurring schedule reviewers.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if v_actor is not null and not public.is_management(v_actor) then
    raise exception 'Only the Founder or Manager may appoint recurring schedule reviewers.'
      using errcode = '42501';
  end if;

  v_reviewer_role := public.role_of(new.reviewer_id);
  if v_reviewer_role not in ('founder', 'manager', 'senior_staff') then
    raise exception 'A recurring schedule reviewer must be Founder, Manager, or Senior Staff.'
      using errcode = '23514';
  end if;

  if new.assigned_by is null and v_actor is not null then
    new.assigned_by := v_actor;
  end if;
  return new;
end;
$function$;

create or replace function public.guard_user_role_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and not public.is_founder(v_actor) then
    raise exception 'Only the Founder may create or change staff roles.'
      using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'founder' then
    raise exception 'The Founder role is immutable. Transfer requires a controlled migration.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'A role belongs to one employee and cannot be transferred.'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and new.role = 'trainee' and old.role <> 'trainee' then
    if exists (
      select 1 from public.assignments a
      where a.owner_id = old.user_id and a.status not in ('closed', 'cancelled')
    ) or exists (
      select 1 from public.recurring_schedules rs
      where rs.default_owner_id = old.user_id and rs.is_active
    ) or exists (
      select 1 from public.clients c
      where c.relationship_owner_id = old.user_id and c.status <> 'archived'
    ) then
      raise exception 'Reassign active client responsibility before changing this employee to Trainee.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.role not in ('founder', 'manager', 'senior_staff')
     and exists (
       select 1 from public.assignment_reviewers ar where ar.reviewer_id = old.user_id
     ) then
    raise exception 'Remove Assignment reviewer duties before changing to this role.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.assigned_by is null and v_actor is not null then
    new.assigned_by := v_actor;
  end if;
  new.assigned_at := case when tg_op = 'INSERT' then now() else old.assigned_at end;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_previous_flag text := current_setting('app.profile_sync', true);
begin
  perform set_config('app.profile_sync', 'on', true);

  insert into public.profiles (user_id, full_name, email)
  values (
    new.id,
    coalesce(
      case when char_length(trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then trim(new.raw_user_meta_data ->> 'full_name') end,
      case when char_length(trim(split_part(coalesce(new.email, ''), '@', 1))) >= 2
        then trim(split_part(new.email, '@', 1)) end,
      'New employee'
    ),
    coalesce(new.email, new.id::text || '@pending.local')
  )
  on conflict (user_id) do update
  set
    full_name = excluded.full_name,
    email = excluded.email;

  perform set_config('app.profile_sync', coalesce(v_previous_flag, ''), true);
  return new;
end;
$function$;

create or replace function public.materialize_due_recurring_assignments(p_through_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(schedule_id uuid, assignment_id uuid, occurrence_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
declare
  v_schedule record;
  v_occurrence date;
  v_period_end date;
  v_due_date date;
  v_assignment_id uuid;
begin
  for v_schedule in
    select rs.*
    from public.recurring_schedules rs
    where rs.is_active
      and rs.next_occurrence_date <= p_through_date
      and (rs.end_date is null or rs.next_occurrence_date <= rs.end_date)
      and (
        rs.engagement_id is null
        or exists (
          select 1 from public.engagements e
          where e.id = rs.engagement_id and e.status = 'active'
        )
      )
    order by rs.next_occurrence_date, rs.id
    for update
  loop
    v_occurrence := v_schedule.next_occurrence_date;

    while v_occurrence <= p_through_date
      and (v_schedule.end_date is null or v_occurrence <= v_schedule.end_date)
    loop
      v_period_end := (
        v_occurrence + make_interval(months => v_schedule.interval_months) - interval '1 day'
      )::date;
      v_due_date := v_period_end + v_schedule.due_offset_days;
      v_assignment_id := null;

      insert into public.assignments (
        client_id,
        service_id,
        recurring_schedule_id,
        engagement_id,
        title,
        description,
        owner_id,
        status,
        priority,
        period_start,
        period_end,
        due_at,
        created_by
      ) values (
        v_schedule.client_id,
        v_schedule.service_id,
        v_schedule.id,
        v_schedule.engagement_id,
        v_schedule.title,
        v_schedule.description,
        v_schedule.default_owner_id,
        'assigned',
        v_schedule.priority,
        v_occurrence,
        v_period_end,
        (v_due_date + time '23:59:00') at time zone 'Asia/Kolkata',
        v_schedule.created_by
      )
      on conflict (recurring_schedule_id, period_start)
        where recurring_schedule_id is not null
      do nothing
      returning id into v_assignment_id;

      if v_assignment_id is not null then
        -- Copy reviewers from recurring schedule to generated assignment
        insert into public.assignment_reviewers (
          assignment_id,
          reviewer_id,
          assigned_by,
          assigned_at
        )
        select
          v_assignment_id,
          rsr.reviewer_id,
          rsr.assigned_by,
          now()
        from public.recurring_schedule_reviewers rsr
        where rsr.recurring_schedule_id = v_schedule.id
        on conflict (assignment_id, reviewer_id) do nothing;

        schedule_id := v_schedule.id;
        assignment_id := v_assignment_id;
        occurrence_date := v_occurrence;
        return next;
      end if;

      v_occurrence := (
        v_occurrence + make_interval(months => v_schedule.interval_months)
      )::date;
    end loop;

    update public.recurring_schedules
    set next_occurrence_date = v_occurrence,
        is_active = case
          when v_schedule.end_date is not null and v_occurrence > v_schedule.end_date then false
          else true
        end,
        updated_at = now()
    where id = v_schedule.id;
  end loop;
end;
$function$;

create or replace function public.prevent_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'The audit trail is immutable.' using errcode = '23514';
end;
$function$;

create or replace function public.prevent_cash_ledger_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'Ledger Entries are append-and-void records and cannot be deleted.' using errcode = '23514';
end;
$function$;

create or replace function public.prevent_financial_document_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  raise exception 'Financial documents are voided, never deleted.' using errcode = '23514';
end;
$function$;

-- 2. The tamper guard, the removal routine and the settings they relied on
drop trigger if exists prevent_demo_flag_tampering on public.assignment_reviewers;
drop trigger if exists prevent_demo_flag_tampering on public.assignments;
drop trigger if exists prevent_demo_flag_tampering on public.cash_accounts;
drop trigger if exists prevent_demo_flag_tampering on public.cash_ledger_entries;
drop trigger if exists prevent_demo_flag_tampering on public.client_contacts;
drop trigger if exists prevent_demo_flag_tampering on public.client_documents;
drop trigger if exists prevent_demo_flag_tampering on public.client_messages;
drop trigger if exists prevent_demo_flag_tampering on public.clients;
drop trigger if exists prevent_demo_flag_tampering on public.engagement_versions;
drop trigger if exists prevent_demo_flag_tampering on public.engagements;
drop trigger if exists prevent_demo_flag_tampering on public.invoice_items;
drop trigger if exists prevent_demo_flag_tampering on public.invoices;
drop trigger if exists prevent_demo_flag_tampering on public.operation_receipts;
drop trigger if exists prevent_demo_flag_tampering on public.payment_allocations;
drop trigger if exists prevent_demo_flag_tampering on public.payment_receipts;
drop trigger if exists prevent_demo_flag_tampering on public.profiles;
drop trigger if exists prevent_demo_flag_tampering on public.recurring_schedule_reviewers;
drop trigger if exists prevent_demo_flag_tampering on public.recurring_schedules;
drop trigger if exists prevent_demo_flag_tampering on public.service_catalog;
drop trigger if exists prevent_demo_flag_tampering on public.staff_reporting_lines;
drop trigger if exists prevent_demo_flag_tampering on public.user_roles;
drop trigger if exists prevent_demo_flag_tampering on public.work_items;

drop function if exists public.prevent_demo_flag_tampering();
drop function if exists public.remove_demo_data();

-- 3. No index, check constraint or policy mentions is_demo (checked against the catalog); the columns go
alter table public.assignment_reviewers drop column is_demo;
alter table public.assignments drop column is_demo;
alter table public.audit_log drop column is_demo;
alter table public.cash_accounts drop column is_demo;
alter table public.cash_ledger_entries drop column is_demo;
alter table public.client_contacts drop column is_demo;
alter table public.client_documents drop column is_demo;
alter table public.client_messages drop column is_demo;
alter table public.clients drop column is_demo;
alter table public.engagement_versions drop column is_demo;
alter table public.engagements drop column is_demo;
alter table public.invoice_items drop column is_demo;
alter table public.invoices drop column is_demo;
alter table public.operation_receipts drop column is_demo;
alter table public.payment_allocations drop column is_demo;
alter table public.payment_receipts drop column is_demo;
alter table public.profiles drop column is_demo;
alter table public.recurring_schedule_reviewers drop column is_demo;
alter table public.recurring_schedules drop column is_demo;
alter table public.service_catalog drop column is_demo;
alter table public.staff_reporting_lines drop column is_demo;
alter table public.user_roles drop column is_demo;
alter table public.work_items drop column is_demo;

-- 4. Nothing may remain
do $$
declare
  v_found text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into v_found
  from information_schema.columns
  where table_schema = 'public' and column_name = 'is_demo';
  if v_found is not null then
    raise exception 'is_demo columns remain: %', v_found;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_found
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.prosrc ilike '%is_demo%' or p.prosrc ilike '%demo_cleanup%');
  if v_found is not null then
    raise exception 'functions still mention the demo label or demo cleanup: %', v_found;
  end if;

  if has_column_privilege('authenticated', 'public.clients', 'pan', 'select')
     or has_column_privilege('authenticated', 'public.clients', 'gstin', 'select') then
    raise exception 'pan and gstin must stay ungranted on public.clients';
  end if;
end;
$$;

commit;
