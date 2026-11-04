-- Seed Dataset for SN Practice CRM Local Development
-- Fail-closed invocation guard: strictly executed via npm run seed:local

do $$
declare
  v_auth_signal text := current_setting('sn.seed_authorized', true);
  v_client_addr inet := inet_client_addr();
begin
  -- 1. Authorization Handshake Check
  if v_auth_signal is distinct from 'sn_practice_crm_local_dev_only' then
    raise exception 'CRITICAL SEED REJECTION: Unauthorized invocation. seed.sql must be executed via npm run seed:local.'
      using errcode = '55000';
  end if;

  -- 2. Reset-Only Emptiness Guard (Fail early if demo data already loaded)
  if exists (select 1 from auth.users where email like '%@sn-demo.local') then
    raise exception 'CRITICAL SEED REJECTION: Database is already seeded. Reset first via npx supabase db reset --local --no-seed.'
      using errcode = '55000';
  end if;

  -- 3. Data-Presence Protection (Abort if non-demo users exist)
  if exists (select 1 from auth.users where email not like '%@sn-demo.local') then
    raise exception 'CRITICAL SEED REJECTION: Non-demo accounts detected in auth.users. Aborting seed.'
      using errcode = '55000';
  end if;

  -- 4. Data-Presence Protection (Abort if non-demo clients exist)
  if exists (select 1 from public.clients where is_demo = false) then
    raise exception 'CRITICAL SEED REJECTION: Non-demo clients detected in public.clients. Aborting seed.'
      using errcode = '55000';
  end if;

  -- 5. Verified-Empty Table State
  if exists (select 1 from public.clients) or exists (select 1 from public.cash_accounts) then
    raise exception 'CRITICAL SEED REJECTION: Database tables are not clean. Reset first via npx supabase db reset --local --no-seed.'
      using errcode = '55000';
  end if;

  -- 6. Network Interface Check (Loopback, Docker bridge, or local socket)
  if v_client_addr is not null and not (
       v_client_addr <<= '127.0.0.0/8'::cidr
    or v_client_addr = '::1'::inet
    or v_client_addr <<= '10.0.0.0/8'::cidr
    or v_client_addr <<= '172.16.0.0/12'::cidr
    or v_client_addr <<= '192.168.0.0/16'::cidr
  ) then
    raise exception 'CRITICAL SEED REJECTION: Seed executed from non-local IP %.', v_client_addr
      using errcode = '55000';
  end if;
end $$;

-- 1. Auth Users (5 personas)
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  phone_change,
  phone_change_token,
  email_change_token_current,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
) values
(
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demo.founder@sn-demo.local',
  extensions.crypt('Demo@1234', extensions.gen_salt('bf', 10)),
  now(),
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "S. Narayanan", "is_demo": true}'::jsonb,
  now(),
  now(),
  false,
  false
),
(
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demo.manager@sn-demo.local',
  extensions.crypt('Demo@1234', extensions.gen_salt('bf', 10)),
  now(),
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Priya Desai", "is_demo": true}'::jsonb,
  now(),
  now(),
  false,
  false
),
(
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demo.senior@sn-demo.local',
  extensions.crypt('Demo@1234', extensions.gen_salt('bf', 10)),
  now(),
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Ananya Rao", "is_demo": true}'::jsonb,
  now(),
  now(),
  false,
  false
),
(
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demo.staff@sn-demo.local',
  extensions.crypt('Demo@1234', extensions.gen_salt('bf', 10)),
  now(),
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Rohan Mehta", "is_demo": true}'::jsonb,
  now(),
  now(),
  false,
  false
),
(
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'demo.trainee@sn-demo.local',
  extensions.crypt('Demo@1234', extensions.gen_salt('bf', 10)),
  now(),
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"full_name": "Neha Kapoor", "is_demo": true}'::jsonb,
  now(),
  now(),
  false,
  false
);

-- 2. Auth Identities (for GoTrue password authentication)
insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
(
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000001',
  '{"sub": "00000000-0000-4000-a000-000000000001", "email": "demo.founder@sn-demo.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000002',
  '{"sub": "00000000-0000-4000-a000-000000000002", "email": "demo.manager@sn-demo.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000003',
  '{"sub": "00000000-0000-4000-a000-000000000003", "email": "demo.senior@sn-demo.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000004',
  '{"sub": "00000000-0000-4000-a000-000000000004", "email": "demo.staff@sn-demo.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
),
(
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000005',
  '{"sub": "00000000-0000-4000-a000-000000000005", "email": "demo.trainee@sn-demo.local"}'::jsonb,
  'email',
  now(),
  now(),
  now()
);

-- Note: public.profiles are automatically created by handle_new_auth_user() with is_demo = true.

-- 3. User Roles (5 personas)
insert into public.user_roles (user_id, role, assigned_by, is_demo) values
('00000000-0000-4000-a000-000000000001', 'founder', '00000000-0000-4000-a000-000000000001', true),
('00000000-0000-4000-a000-000000000002', 'manager', '00000000-0000-4000-a000-000000000001', true),
('00000000-0000-4000-a000-000000000003', 'senior_staff', '00000000-0000-4000-a000-000000000001', true),
('00000000-0000-4000-a000-000000000004', 'staff', '00000000-0000-4000-a000-000000000001', true),
('00000000-0000-4000-a000-000000000005', 'trainee', '00000000-0000-4000-a000-000000000001', true);

-- 4. Staff Reporting Lines (4 lines)
insert into public.staff_reporting_lines (employee_id, supervisor_id, is_demo) values
('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', true),
('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000002', true),
('00000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000002', true),
('00000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000002', true);

-- 5. Clients (6 clients)
insert into public.clients (
  id,
  code,
  display_name,
  legal_name,
  gstin,
  pan,
  email,
  phone,
  relationship_owner_id,
  status,
  created_by,
  is_demo
) values
(
  '10000000-0000-4000-a000-000000000001',
  'CL-001001',
  'Aster Foods',
  'Aster Foods Private Limited',
  '27AABCA1234A1Z5',
  'AABCA1234A',
  'accounts@asterfoods.local',
  '+91 98200 11001',
  '00000000-0000-4000-a000-000000000002',
  'active',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '10000000-0000-4000-a000-000000000002',
  'CL-001002',
  'BluePeak Tech',
  'BluePeak Technologies LLP',
  '27AABCB2345B1Z4',
  'AABCB2345B',
  'finance@bluepeak.local',
  '+91 98200 11002',
  '00000000-0000-4000-a000-000000000004',
  'active',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '10000000-0000-4000-a000-000000000003',
  'CL-001003',
  'Sharma Retail',
  'Sharma Retail Enterprises',
  '27AABCS3456C1Z3',
  'AABCS3456C',
  'tax@sharmaretail.local',
  '+91 98200 11003',
  '00000000-0000-4000-a000-000000000002',
  'active',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '10000000-0000-4000-a000-000000000004',
  'CL-001004',
  'Kedia Holdings',
  'Kedia Holdings Private Limited',
  '27AABCK4567D1Z2',
  'AABCK4567D',
  'cfo@kediaholdings.local',
  '+91 98200 11004',
  '00000000-0000-4000-a000-000000000004',
  'active',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '10000000-0000-4000-a000-000000000005',
  'CL-001005',
  'Northstar Exports',
  'Northstar Exports Incorporated',
  '27AABCN5678E1Z1',
  'AABCN5678E',
  'accounts@northstar.local',
  '+91 98200 11005',
  '00000000-0000-4000-a000-000000000003',
  'active',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '10000000-0000-4000-a000-000000000006',
  'CL-001006',
  'Apex Logistics',
  'Apex Logistics Private Limited',
  '27AABCA6789F1Z0',
  'AABCA6789F',
  'billing@apexlogistics.local',
  '+91 98200 11006',
  '00000000-0000-4000-a000-000000000003',
  'active',
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 6. Service Catalog (6 services)
insert into public.service_catalog (
  id,
  name,
  description,
  default_duration_days,
  is_statutory,
  is_active,
  created_by,
  is_demo
) values
(
  '50000000-0000-4000-a000-000000000001',
  'GST Compliance',
  'Monthly and quarterly Goods and Services Tax filings and reconciliations',
  10,
  true,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '50000000-0000-4000-a000-000000000002',
  'Internal Audit',
  'Quarterly internal controls evaluation and risk assessment review',
  30,
  false,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '50000000-0000-4000-a000-000000000003',
  'Tax Compliance (TDS)',
  'Quarterly Tax Deducted at Source computation, deposit, and return filing',
  15,
  true,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '50000000-0000-4000-a000-000000000004',
  'Bookkeeping & Accounts',
  'Monthly transaction posting, ledger closing, and financial preparation',
  12,
  false,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '50000000-0000-4000-a000-000000000005',
  'Statutory Audit',
  'Annual statutory financial audit and independent audit report preparation',
  45,
  true,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '50000000-0000-4000-a000-000000000006',
  'Direct Tax Advisory',
  'Corporate and personal income tax advisory, scrutiny representation, and planning',
  20,
  false,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 7. Recurring Schedules (9 schedules)
insert into public.recurring_schedules (
  id,
  code,
  client_id,
  service_id,
  title,
  cadence,
  interval_months,
  due_offset_days,
  start_date,
  next_occurrence_date,
  default_owner_id,
  priority,
  is_active,
  created_by,
  is_demo
) values
(
  '20000000-0000-4000-a000-000000000001',
  'RS-001001',
  '10000000-0000-4000-a000-000000000001',
  '50000000-0000-4000-a000-000000000001',
  'Monthly GST Compliance - Aster Foods',
  'monthly',
  1,
  20,
  current_date - 180,
  current_date + 15,
  '00000000-0000-4000-a000-000000000002',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000002',
  'RS-001002',
  '10000000-0000-4000-a000-000000000002',
  '50000000-0000-4000-a000-000000000003',
  'Quarterly TDS Filing - BluePeak Tech',
  'quarterly',
  3,
  31,
  current_date - 180,
  current_date + 25,
  '00000000-0000-4000-a000-000000000004',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000003',
  'RS-001003',
  '10000000-0000-4000-a000-000000000004',
  '50000000-0000-4000-a000-000000000004',
  'Monthly Bookkeeping - Kedia Holdings',
  'monthly',
  1,
  10,
  current_date - 180,
  current_date + 10,
  '00000000-0000-4000-a000-000000000004',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000004',
  'RS-001004',
  '10000000-0000-4000-a000-000000000005',
  '50000000-0000-4000-a000-000000000001',
  'Monthly GST Compliance - Northstar Exports',
  'monthly',
  1,
  20,
  current_date - 180,
  current_date + 15,
  '00000000-0000-4000-a000-000000000003',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000005',
  'RS-001005',
  '10000000-0000-4000-a000-000000000003',
  '50000000-0000-4000-a000-000000000003',
  'Quarterly TDS Return - Sharma Retail',
  'quarterly',
  3,
  31,
  current_date - 180,
  current_date + 25,
  '00000000-0000-4000-a000-000000000002',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000006',
  'RS-001006',
  '10000000-0000-4000-a000-000000000006',
  '50000000-0000-4000-a000-000000000004',
  'Monthly Accounts - Apex Logistics',
  'monthly',
  1,
  15,
  current_date - 180,
  current_date + 12,
  '00000000-0000-4000-a000-000000000003',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000007',
  'RS-001007',
  '10000000-0000-4000-a000-000000000001',
  '50000000-0000-4000-a000-000000000003',
  'Quarterly TDS Return - Aster Foods',
  'quarterly',
  3,
  31,
  current_date - 180,
  current_date + 25,
  '00000000-0000-4000-a000-000000000002',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000008',
  'RS-001008',
  '10000000-0000-4000-a000-000000000002',
  '50000000-0000-4000-a000-000000000001',
  'Monthly GST Compliance - BluePeak Tech',
  'monthly',
  1,
  20,
  current_date - 180,
  current_date + 15,
  '00000000-0000-4000-a000-000000000004',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '20000000-0000-4000-a000-000000000009',
  'RS-001009',
  '10000000-0000-4000-a000-000000000004',
  '50000000-0000-4000-a000-000000000003',
  'Quarterly TDS Return - Kedia Holdings',
  'quarterly',
  3,
  31,
  current_date - 180,
  current_date + 25,
  '00000000-0000-4000-a000-000000000004',
  'normal',
  true,
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 8. Assignments (6 assignments)
insert into public.assignments (
  id,
  code,
  client_id,
  service_id,
  recurring_schedule_id,
  title,
  owner_id,
  status,
  priority,
  period_start,
  period_end,
  due_at,
  created_by,
  is_demo
) values
(
  '30000000-0000-4000-a000-000000000001',
  'AS-001001',
  '10000000-0000-4000-a000-000000000001',
  '50000000-0000-4000-a000-000000000001',
  '20000000-0000-4000-a000-000000000001',
  'GSTR-1 & 3B Compliance · Oct 2026',
  '00000000-0000-4000-a000-000000000002',
  'in_progress',
  'high',
  date_trunc('month', current_date - interval '1 month')::date,
  (date_trunc('month', current_date) - interval '1 day')::date,
  current_date + interval '5 days' + time '18:00',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '30000000-0000-4000-a000-000000000002',
  'AS-001002',
  '10000000-0000-4000-a000-000000000002',
  '50000000-0000-4000-a000-000000000002',
  null,
  'Q2 Internal Audit & Controls Assessment',
  '00000000-0000-4000-a000-000000000004',
  'ready_for_review',
  'normal',
  null,
  null,
  current_date + interval '8 days' + time '18:00',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '30000000-0000-4000-a000-000000000003',
  'AS-001003',
  '10000000-0000-4000-a000-000000000003',
  '50000000-0000-4000-a000-000000000003',
  '20000000-0000-4000-a000-000000000005',
  'TDS Return Filing · Q2 FY 2026-27',
  '00000000-0000-4000-a000-000000000002',
  'assigned',
  'normal',
  date_trunc('quarter', current_date - interval '3 months')::date,
  (date_trunc('quarter', current_date) - interval '1 day')::date,
  current_date + interval '12 days' + time '18:00',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '30000000-0000-4000-a000-000000000004',
  'AS-001004',
  '10000000-0000-4000-a000-000000000004',
  '50000000-0000-4000-a000-000000000004',
  '20000000-0000-4000-a000-000000000003',
  'Monthly Bookkeeping & Closing · Oct 2026',
  '00000000-0000-4000-a000-000000000004',
  'in_progress',
  'normal',
  date_trunc('month', current_date - interval '1 month')::date,
  (date_trunc('month', current_date) - interval '1 day')::date,
  current_date + interval '6 days' + time '18:00',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '30000000-0000-4000-a000-000000000005',
  'AS-001005',
  '10000000-0000-4000-a000-000000000005',
  '50000000-0000-4000-a000-000000000005',
  null,
  'Statutory Audit FY 2025-26',
  '00000000-0000-4000-a000-000000000003',
  'assigned',
  'urgent',
  null,
  null,
  current_date + interval '20 days' + time '18:00',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '30000000-0000-4000-a000-000000000006',
  'AS-001006',
  '10000000-0000-4000-a000-000000000006',
  '50000000-0000-4000-a000-000000000006',
  null,
  'Income Tax Scrutiny Assessment Representation',
  '00000000-0000-4000-a000-000000000002',
  'in_progress',
  'high',
  null,
  null,
  current_date + interval '15 days' + time '18:00',
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 9. Assignment Reviewers (6 reviewers)
insert into public.assignment_reviewers (
  assignment_id,
  reviewer_id,
  assigned_by,
  is_demo
) values
('30000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', true),
('30000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000001', true),
('30000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', true),
('30000000-0000-4000-a000-000000000004', '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000001', true),
('30000000-0000-4000-a000-000000000005', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', true),
('30000000-0000-4000-a000-000000000006', '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000001', true);

-- 10. Work Items (6 items)
insert into public.work_items (
  id,
  code,
  kind,
  assignment_id,
  context_client_id,
  title,
  assignee_id,
  created_by,
  status,
  priority,
  due_at,
  reminder_at,
  completed_at,
  completion_note,
  is_demo
) values
(
  '40000000-0000-4000-a000-000000000001',
  'WI-001001',
  'delegated',
  '30000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  'GSTR-2B Input Tax Credit reconciliation',
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000002',
  'in_progress',
  'high',
  current_date + time '18:00',
  current_date + time '10:00',
  null,
  null,
  true
),
(
  '40000000-0000-4000-a000-000000000002',
  'WI-001002',
  'delegated',
  '30000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  'Draft outward supply summary table',
  '00000000-0000-4000-a000-000000000005',
  '00000000-0000-4000-a000-000000000002',
  'todo',
  'normal',
  current_date + interval '1 day' + time '18:00',
  current_date + interval '1 day' + time '09:00',
  null,
  null,
  true
),
(
  '40000000-0000-4000-a000-000000000003',
  'WI-001003',
  'delegated',
  '30000000-0000-4000-a000-000000000002',
  '10000000-0000-4000-a000-000000000002',
  'Procurement audit sample verification',
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000002',
  'ready_for_review',
  'normal',
  current_date + interval '2 days' + time '18:00',
  null,
  null,
  null,
  true
),
(
  '40000000-0000-4000-a000-000000000004',
  'WI-001004',
  'personal',
  null,
  null,
  'Update professional indemnity insurance policy',
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000002',
  'todo',
  'low',
  current_date + time '11:30',
  null,
  null,
  null,
  true
),
(
  '40000000-0000-4000-a000-000000000005',
  'WI-001005',
  'personal',
  null,
  null,
  'Review ICAI continuing education compliance',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000003',
  'todo',
  'normal',
  current_date + time '15:00',
  null,
  null,
  null,
  true
),
(
  '40000000-0000-4000-a000-000000000006',
  'WI-001006',
  'personal',
  null,
  null,
  'Organize tax department physical files',
  '00000000-0000-4000-a000-000000000004',
  '00000000-0000-4000-a000-000000000004',
  'completed',
  'normal',
  current_date - interval '1 day' + time '17:00',
  null,
  current_date - interval '1 day' + time '17:15',
  'Filing reorganized and tagged by client FY.',
  true
);

-- 11. Cash Accounts (2 accounts)
insert into public.cash_accounts (
  id,
  name,
  kind,
  opening_balance,
  opening_balance_on,
  is_active,
  created_by,
  is_demo
) values
(
  '60000000-0000-4000-a000-000000000001',
  'HDFC Current Account',
  'bank',
  125000.00,
  current_date - 90,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '60000000-0000-4000-a000-000000000002',
  'Office Petty Cash',
  'cash',
  36300.00,
  current_date - 90,
  true,
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 12. Invoices Phase 1: Insert 9 empty invoices in draft status
insert into public.invoices (
  id,
  code,
  client_id,
  issue_date,
  due_date,
  currency,
  subtotal_amount,
  tax_amount,
  total_amount,
  amount_received,
  status,
  created_by,
  is_demo
) values
(
  '70000000-0000-4000-a000-000000000001',
  'INV-0001001',
  '10000000-0000-4000-a000-000000000002',
  current_date - 75,
  current_date - 62,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000002',
  'INV-0001002',
  '10000000-0000-4000-a000-000000000001',
  current_date - 45,
  current_date - 18,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000003',
  'INV-0001003',
  '10000000-0000-4000-a000-000000000003',
  current_date - 45,
  current_date - 18,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000004',
  'INV-0001004',
  '10000000-0000-4000-a000-000000000004',
  current_date - 20,
  current_date + 5,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000005',
  'INV-0001005',
  '10000000-0000-4000-a000-000000000005',
  current_date - 30,
  current_date - 9,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000006',
  'INV-0001006',
  '10000000-0000-4000-a000-000000000006',
  current_date - 40,
  current_date - 25,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000007',
  'INV-0001007',
  '10000000-0000-4000-a000-000000000001',
  current_date - 20,
  current_date - 5,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000008',
  'INV-0001008',
  '10000000-0000-4000-a000-000000000002',
  current_date - 5,
  current_date + 12,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '70000000-0000-4000-a000-000000000009',
  'INV-0001009',
  '10000000-0000-4000-a000-000000000003',
  current_date,
  current_date + 15,
  'INR',
  0.00,
  0.00,
  0.00,
  0.00,
  'draft',
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 13. Invoices Phase 2: Insert 9 invoice items (triggers recompute totals automatically)
insert into public.invoice_items (
  id,
  invoice_id,
  description,
  quantity,
  unit_price,
  tax_rate,
  sort_order,
  is_demo
) values
(
  '71000000-0000-4000-a000-000000000001',
  '70000000-0000-4000-a000-000000000001',
  'Internal Audit & Controls Review · Q1',
  1,
  75000.00,
  18.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000002',
  '70000000-0000-4000-a000-000000000002',
  'Statutory GST Compliance · Sep 2026',
  1,
  14500.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000003',
  '70000000-0000-4000-a000-000000000003',
  'TDS Return Filing & Advisory · Q1',
  1,
  15000.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000004',
  '70000000-0000-4000-a000-000000000004',
  'Monthly Bookkeeping & Financial Reporting',
  1,
  20000.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000005',
  '70000000-0000-4000-a000-000000000005',
  'Statutory Audit Interim Retainer',
  1,
  35000.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000006',
  '70000000-0000-4000-a000-000000000006',
  'IT Scrutiny Assessment Representation',
  1,
  75000.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000007',
  '70000000-0000-4000-a000-000000000007',
  'Statutory GST Compliance · Oct 2026',
  1,
  14500.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000008',
  '70000000-0000-4000-a000-000000000008',
  'Direct Tax Advisory & Tax Planning',
  1,
  35000.00,
  0.00,
  1,
  true
),
(
  '71000000-0000-4000-a000-000000000009',
  '70000000-0000-4000-a000-000000000009',
  'TDS Return Filing & Advisory · Q2',
  1,
  15000.00,
  0.00,
  1,
  true
);

-- 14. Invoices Phase 3: Transition INV-0001001 to INV-0001008 to status 'issued'
update public.invoices set status = 'issued', issued_at = current_date - 75 + time '10:00' where code = 'INV-0001001';
update public.invoices set status = 'issued', issued_at = current_date - 45 + time '10:00' where code = 'INV-0001002';
update public.invoices set status = 'issued', issued_at = current_date - 45 + time '10:00' where code = 'INV-0001003';
update public.invoices set status = 'issued', issued_at = current_date - 20 + time '10:00' where code = 'INV-0001004';
update public.invoices set status = 'issued', issued_at = current_date - 30 + time '10:00' where code = 'INV-0001005';
update public.invoices set status = 'issued', issued_at = current_date - 40 + time '10:00' where code = 'INV-0001006';
update public.invoices set status = 'issued', issued_at = current_date - 20 + time '10:00' where code = 'INV-0001007';
update public.invoices set status = 'issued', issued_at = current_date - 5 + time '10:00' where code = 'INV-0001008';
-- INV-0001009 remains draft

-- 15. Cash Ledger Entries Phase 4: Insert 8 entries (5 bank receipts, 1 petty cash wdl, 2 expenses)
insert into public.cash_ledger_entries (
  id,
  code,
  account_id,
  entry_date,
  direction,
  amount,
  category,
  narration,
  reference,
  status,
  created_by,
  is_demo
) values
(
  '80000000-0000-4000-a000-000000000001',
  'LE-0001001',
  '60000000-0000-4000-a000-000000000001',
  current_date - 18,
  'receipt',
  14500.00,
  'Client Fees',
  'Payment received from Aster Foods - Inv INV-0001002',
  'NEFT-AST-01002',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000002',
  'LE-0001002',
  '60000000-0000-4000-a000-000000000001',
  current_date - 18,
  'receipt',
  15000.00,
  'Client Fees',
  'Payment received from Sharma Retail - Inv INV-0001003',
  'UPI-SHR-01003',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000003',
  'LE-0001003',
  '60000000-0000-4000-a000-000000000001',
  current_date - 3,
  'receipt',
  13250.00,
  'Client Fees',
  'Part-payment received from Kedia Holdings - Inv INV-0001004',
  'RTGS-KED-01004',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000004',
  'LE-0001004',
  '60000000-0000-4000-a000-000000000001',
  current_date - 8,
  'receipt',
  23000.00,
  'Client Fees',
  'Part-payment received from Northstar Exports - Inv INV-0001005',
  'NEFT-NOR-01005',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000005',
  'LE-0001005',
  '60000000-0000-4000-a000-000000000001',
  current_date - 25,
  'receipt',
  75000.00,
  'Client Fees',
  'Payment received from Apex Logistics - Inv INV-0001006',
  'RTGS-APX-01006',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000006',
  'LE-0001006',
  '60000000-0000-4000-a000-000000000002',
  current_date - 10,
  'receipt',
  10000.00,
  'Cash Transfer',
  'Cash withdrawal from bank for petty cash float',
  'CHQ-WDL-1006',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000007',
  'LE-0001007',
  '60000000-0000-4000-a000-000000000002',
  current_date - 7,
  'payment',
  2340.00,
  'Office Expenses',
  'Office stationery & filing supplies',
  'VCH-STN-1007',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '80000000-0000-4000-a000-000000000008',
  'LE-0001008',
  '60000000-0000-4000-a000-000000000002',
  current_date - 2,
  'payment',
  1280.00,
  'Travel & Conveyance',
  'Travel reimbursement · Rohan Mehta',
  'VCH-TRV-1008',
  'posted',
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 16. Payment Receipts Phase 5: Insert 5 receipts linked to ledger entries
insert into public.payment_receipts (
  id,
  code,
  client_id,
  ledger_entry_id,
  received_on,
  amount,
  method,
  reference,
  status,
  created_by,
  is_demo
) values
(
  '90000000-0000-4000-a000-000000000001',
  'RCT-0001001',
  '10000000-0000-4000-a000-000000000001',
  '80000000-0000-4000-a000-000000000001',
  current_date - 18,
  14500.00,
  'bank_transfer',
  'NEFT-AST-01002',
  'received',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '90000000-0000-4000-a000-000000000002',
  'RCT-0001002',
  '10000000-0000-4000-a000-000000000003',
  '80000000-0000-4000-a000-000000000002',
  current_date - 18,
  15000.00,
  'upi',
  'UPI-SHR-01003',
  'received',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '90000000-0000-4000-a000-000000000003',
  'RCT-0001003',
  '10000000-0000-4000-a000-000000000004',
  '80000000-0000-4000-a000-000000000003',
  current_date - 3,
  13250.00,
  'bank_transfer',
  'RTGS-KED-01004',
  'received',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '90000000-0000-4000-a000-000000000004',
  'RCT-0001004',
  '10000000-0000-4000-a000-000000000005',
  '80000000-0000-4000-a000-000000000004',
  current_date - 8,
  23000.00,
  'bank_transfer',
  'NEFT-NOR-01005',
  'received',
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '90000000-0000-4000-a000-000000000005',
  'RCT-0001005',
  '10000000-0000-4000-a000-000000000006',
  '80000000-0000-4000-a000-000000000005',
  current_date - 25,
  75000.00,
  'bank_transfer',
  'RTGS-APX-01006',
  'received',
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 17. Payment Allocations Phase 6: Insert 5 allocations (triggers derive invoice amount_received & status)
insert into public.payment_allocations (
  id,
  receipt_id,
  invoice_id,
  amount,
  created_by,
  is_demo
) values
(
  '91000000-0000-4000-a000-000000000001',
  '90000000-0000-4000-a000-000000000001',
  '70000000-0000-4000-a000-000000000002',
  14500.00,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '91000000-0000-4000-a000-000000000002',
  '90000000-0000-4000-a000-000000000002',
  '70000000-0000-4000-a000-000000000003',
  15000.00,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '91000000-0000-4000-a000-000000000003',
  '90000000-0000-4000-a000-000000000003',
  '70000000-0000-4000-a000-000000000004',
  13250.00,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '91000000-0000-4000-a000-000000000004',
  '90000000-0000-4000-a000-000000000004',
  '70000000-0000-4000-a000-000000000005',
  23000.00,
  '00000000-0000-4000-a000-000000000001',
  true
),
(
  '91000000-0000-4000-a000-000000000005',
  '90000000-0000-4000-a000-000000000005',
  '70000000-0000-4000-a000-000000000006',
  75000.00,
  '00000000-0000-4000-a000-000000000001',
  true
);

-- 18. Exact Sequence Synchronization (Zero Off-by-One)
select setval('public.client_code_seq', greatest(1001, coalesce((select max(substring(code from 4)::bigint) from public.clients), 1000)));
select setval('public.schedule_code_seq', greatest(1001, coalesce((select max(substring(code from 4)::bigint) from public.recurring_schedules), 1000)));
select setval('public.assignment_code_seq', greatest(1001, coalesce((select max(substring(code from 4)::bigint) from public.assignments), 1000)));
select setval('public.work_item_code_seq', greatest(1001, coalesce((select max(substring(code from 4)::bigint) from public.work_items), 1000)));
select setval('public.ledger_entry_code_seq', greatest(1001, coalesce((select max(substring(code from 4)::bigint) from public.cash_ledger_entries), 1000)));
select setval('public.invoice_code_seq', greatest(1001, coalesce((select max(substring(code from 5)::bigint) from public.invoices), 1000)));
select setval('public.receipt_code_seq', greatest(1001, coalesce((select max(substring(code from 5)::bigint) from public.payment_receipts), 1000)));
