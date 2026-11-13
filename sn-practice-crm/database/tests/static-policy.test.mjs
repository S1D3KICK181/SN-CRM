import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migration0001Path = new URL('../../supabase/migrations/20261031060700_practice_core.sql', import.meta.url);
const migration0002Path = new URL('../../supabase/migrations/20261103105200_work_item_reminder.sql', import.meta.url);
const migration0003Path = new URL('../../supabase/migrations/20261103120000_add_demo_support.sql', import.meta.url);
const migration0004Path = new URL('../../supabase/migrations/20261110163000_as01_hardening.sql', import.meta.url);
const migration0005Path = new URL('../../supabase/migrations/20261111113000_eng01_engagement_core.sql', import.meta.url);
const migration0006Path = new URL('../../supabase/migrations/20261111120000_eng01_operation_receipts.sql', import.meta.url);

function readMigration(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path.pathname}`);
  }
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const expectedRoles = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'];
const rlsTables = [
  'assignment_reviewers',
  'assignments',
  'audit_log',
  'cash_accounts',
  'cash_ledger_entries',
  'clients',
  'invoice_items',
  'invoices',
  'payment_allocations',
  'payment_receipts',
  'profiles',
  'recurring_schedules',
  'service_catalog',
  'staff_reporting_lines',
  'user_roles',
  'work_items',
];

const updateableTables = [
  'profiles',
  'user_roles',
  'staff_reporting_lines',
  'clients',
  'service_catalog',
  'recurring_schedules',
  'assignments',
  'assignment_reviewers',
  'work_items',
  'cash_accounts',
  'cash_ledger_entries',
  'invoices',
  'invoice_items',
  'payment_receipts',
  'payment_allocations',
];

function expectSql(source, pattern, message) {
  assert.match(source, pattern, message);
}

function functionBlock(source, name) {
  const marker = `create or replace function public.${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = source.indexOf('$$;', start);
  assert.notEqual(end, -1, `Function ${name} has no closing delimiter`);
  return source.slice(start, end + 3);
}

test('the role vocabulary is exact and ordered', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  const declaration = migration0001.match(/create type public\.app_role as enum \(([\s\S]*?)\);/i);
  assert.ok(declaration, 'Missing app_role enum');
  assert.deepEqual([...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]), expectedRoles);
});

test('RLS is enabled for every exposed business table', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  const enabled = [...migration0001.matchAll(
    /alter table public\.([a-z_]+) enable row level security;/gi,
  )].map((match) => match[1]).sort();
  assert.deepEqual(enabled, rlsTables);

  for (const table of rlsTables) {
    expectSql(
      migration0001,
      new RegExp(`create policy [a-z_]+_select on public\\.${table}\\s+for select to authenticated`, 'i'),
      `Missing authenticated SELECT policy for ${table}`,
    );
  }
});

test('all security-definer functions pin their search path', () => {
  const files = [
    readMigration(migration0001Path, 'Migration 0001'),
    readMigration(migration0002Path, 'Migration 0002'),
    readMigration(migration0003Path, 'Migration 0003'),
    readMigration(migration0004Path, 'Migration 0004'),
    readMigration(migration0005Path, 'Migration 0005'),
  ];

  for (const content of files) {
    const blocks = content
      .split(/(?=create or replace function public\.)/i)
      .filter((block) => /^create or replace function public\./i.test(block));

    const definers = blocks.filter((block) => {
      const end = block.indexOf('$$;');
      return end !== -1 && /security definer/i.test(block.slice(0, end));
    });

    for (const block of definers) {
      const signature = block.match(/^create or replace function public\.([^\s(]+)/i)?.[1];
      assert.match(
        block.slice(0, block.indexOf('$$;')),
        /set search_path = public(?:, auth)?, pg_temp/i,
        `${signature} must pin search_path`,
      );
    }
  }
});

test('reporting and delegation encode the five-role authority model', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  const delegation = functionBlock(migration0001, 'role_may_delegate');
  const staffAuthorityRpc = functionBlock(migration0001, 'set_staff_authority');
  const reportingRpc = functionBlock(migration0001, 'set_reporting_line');
  expectSql(
    migration0001,
    /create unique index one_founder_per_practice[\s\S]*where role = 'founder';/i,
    'The database must permit only one Founder',
  );
  assert.match(delegation, /when 'founder' then p_target_role <> 'founder'/i);
  assert.match(delegation, /when 'manager' then p_target_role in \('senior_staff', 'staff', 'trainee'\)/i);
  assert.match(delegation, /when 'senior_staff' then p_target_role in \('staff', 'trainee'\)/i);
  assert.match(delegation, /when 'staff' then p_target_role = 'trainee'/i);
  assert.match(delegation, /when 'trainee' then false/i);
  assert.match(staffAuthorityRpc, /v_actor is null or not public\.is_founder\(v_actor\)/i);
  assert.match(reportingRpc, /v_actor is null or not public\.can_manage_reporting_line\(p_employee_id\)/i);

  expectSql(
    migration0001,
    /create constraint trigger user_role_reporting_integrity[\s\S]*deferrable initially deferred/i,
    'Role/reporting integrity must be commit-time checked',
  );
  expectSql(
    migration0001,
    /create constraint trigger reporting_line_integrity[\s\S]*deferrable initially deferred/i,
    'Reporting-line integrity must be commit-time checked',
  );
});

test('employee identity and authority rows cannot be transferred in place', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  const profileGuard = functionBlock(migration0001, 'guard_profile_update');
  const roleGuard = functionBlock(migration0001, 'guard_user_role_write');
  const authSync = functionBlock(migration0001, 'handle_new_auth_user');

  assert.match(profileGuard, /Profile identity and Auth-synchronised fields are immutable/i);
  assert.match(roleGuard, /A role belongs to one employee and cannot be transferred/i);
  assert.match(roleGuard, /The Founder role is immutable/i);
  assert.match(
    authSync,
    /char_length\(trim\(coalesce\(new\.raw_user_meta_data ->> 'full_name', ''\)\)\) >= 2/i,
    'Auth profile sync must not violate the two-character display-name constraint',
  );
});

test('Assignment, recurrence, and Work Item invariants are enforced below the UI', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  const assignmentGuard = functionBlock(migration0001, 'guard_assignment_write');
  const scheduleGuard = functionBlock(migration0001, 'guard_recurring_schedule_write');
  const workGuard = functionBlock(migration0001, 'guard_work_item_write');

  assert.match(assignmentGuard, /Only the Founder or Manager may create an Assignment/i);
  assert.match(assignmentGuard, /A Trainee cannot own an Assignment/i);
  assert.match(scheduleGuard, /Only the Founder or Manager may manage Recurring Schedules/i);
  assert.match(workGuard, /A Personal Task must be created for self/i);
  assert.match(workGuard, /A Delegated Task requires a parent Assignment/i);
  assert.match(workGuard, /Internal Tasks may be assigned downward only/i);
  assert.match(workGuard, /Work Item kind, creator, and parent context are immutable/i);
  expectSql(
    migration0001,
    /on conflict \(recurring_schedule_id, period_start\)[\s\S]*do nothing/i,
    'Recurring materialization must be idempotent only on its occurrence key',
  );
});

test('finance is management-only, derived, append-and-void, and audited', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  expectSql(
    migration0001,
    /create policy cash_ledger_select[\s\S]*using \(public\.is_management\(\)\)/i,
    'Office Accounts must be visible only to Founder and Manager',
  );
  expectSql(
    migration0001,
    /raise exception 'Posted financial facts cannot be rewritten; void and post a correction\.'/i,
    'Posted ledger facts must be immutable',
  );
  expectSql(
    migration0001,
    /amount_received = v_received,[\s\S]*status = v_next_status/i,
    'Invoice receipt state must be derived by the allocation recompute',
  );
  expectSql(
    migration0001,
    /Remove received-payment allocations before voiding this Invoice\./i,
    'A paid allocation must be resolved before invoice voiding',
  );
  expectSql(
    migration0001,
    /v_old := v_old - 'title' - 'description' - 'completion_note'/i,
    'Personal-task content must be redacted from audit history',
  );
  expectSql(
    migration0001,
    /nullif\(concat_ws\(':', v_old ->> 'assignment_id', v_old ->> 'reviewer_id'\), ''\)/i,
    'Composite audit keys must survive DELETE events',
  );
  expectSql(
    migration0001,
    /create trigger prevent_audit_mutation[\s\S]*before update or delete on public\.audit_log/i,
    'Audit history must be immutable',
  );

  for (const table of ['assignments', 'work_items', 'cash_ledger_entries', 'invoices', 'payment_receipts', 'audit_log']) {
    assert.doesNotMatch(
      migration0001,
      new RegExp(`grant[^;]*delete[^;]*on public\\.${table} to authenticated`, 'i'),
      `${table} must not grant DELETE to authenticated users`,
    );
  }
});

test('dashboard reporting views preserve invoker RLS', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  for (const view of [
    'cash_account_balances',
    'client_outstanding',
    'collections_snapshot',
    'billing_collections_monthly',
  ]) {
    expectSql(
      migration0001,
      new RegExp(`create view public\\.${view}\\s+with \\(security_invoker = true\\)`, 'i'),
      `${view} must be a security-invoker view`,
    );
  }
});

test('privileged jobs and derived-value functions are not client executable', () => {
  const migration0001 = readMigration(migration0001Path, 'Migration 0001');
  for (const signature of [
    'public.materialize_due_recurring_assignments(date)',
    'public.recompute_invoice_totals(uuid)',
    'public.recompute_invoice_payment_state(uuid)',
  ]) {
    const escaped = signature.replace(/[().]/g, '\\$&');
    expectSql(
      migration0001,
      new RegExp(`revoke all on function ${escaped} from public, anon(?:, authenticated)?;`, 'i'),
      `Missing client EXECUTE revocation for ${signature}`,
    );
  }
  expectSql(
    migration0001,
    /grant execute on function public\.materialize_due_recurring_assignments\(date\) to service_role;/i,
    'Only the trusted recurring job should receive materialization EXECUTE',
  );
});

test('migration 0002 defines reminder_at column, named check constraint, and partial index', () => {
  const sql0002 = readMigration(migration0002Path, 'Migration 0002');

  assert.match(
    sql0002,
    /alter\s+table\s+public\.work_items\s+add\s+column\s+if\s+not\s+exists\s+reminder_at\s+timestamptz;/i,
    '0002 must add reminder_at timestamptz to public.work_items',
  );

  assert.match(
    sql0002,
    /add\s+constraint\s+work_items_reminder_before_or_at_due\s+check\s*\(\s*reminder_at\s+is\s+null\s+or\s+due_at\s+is\s+null\s+or\s+reminder_at\s*<=\s*due_at\s*\)/i,
    '0002 must add named check constraint work_items_reminder_before_or_at_due with whitespace flexibility',
  );

  assert.match(
    sql0002,
    /create\s+index\s+if\s+not\s+exists\s+work_items_reminder_open_idx\s+on\s+public\.work_items\s*\(reminder_at\)\s+where\s+status\s+not\s+in\s*\('completed',\s*'cancelled'\)\s+and\s+archived_at\s+is\s+null\s+and\s+reminder_at\s+is\s+not\s+null;/i,
    '0002 must create partial index work_items_reminder_open_idx on reminder_at for open active items',
  );

  assert.match(
    sql0002,
    /comment\s+on\s+column\s+public\.work_items\.reminder_at\s+is\s+'Scheduled notification timestamp for the work item\. Must be on or before due_at\.'/i,
    '0002 must add column comment on reminder_at',
  );
});

test('migration 0002 enforces terminal immutability on reminder_at via trigger', () => {
  const sql0002 = readMigration(migration0002Path, 'Migration 0002');

  assert.match(
    sql0002,
    /create\s+or\s+replace\s+function\s+public\.guard_work_item_reminder_immutability\(\)/i,
    '0002 must define guard_work_item_reminder_immutability function',
  );

  assert.match(
    sql0002,
    /security\s+definer[\s\S]*set\s+search_path\s*=\s*public,\s*pg_temp/i,
    'guard_work_item_reminder_immutability must be security definer with pinned search_path',
  );

  assert.match(
    sql0002,
    /old\.status\s+in\s*\('completed',\s*'cancelled'\)[\s\S]*new\.reminder_at\s+is\s+distinct\s+from\s+old\.reminder_at/i,
    'guard_work_item_reminder_immutability must check old status is completed or cancelled and reminder_at changed',
  );

  assert.match(
    sql0002,
    /raise\s+exception\s+'Completed and cancelled Work Items are immutable except for archiving\.'[\s\S]*using\s+errcode\s*=\s*'23514'/i,
    'guard_work_item_reminder_immutability must match 0001 error semantics and errcode 23514',
  );

  assert.match(
    sql0002,
    /create\s+trigger\s+guard_work_item_reminder_immutability[\s\S]*before\s+update\s+of\s+reminder_at\s+on\s+public\.work_items[\s\S]*for\s+each\s+row\s+execute\s+function\s+public\.guard_work_item_reminder_immutability\(\)/i,
    '0002 must create guard_work_item_reminder_immutability trigger before update of reminder_at',
  );
});

test('migration 0003 adds is_demo to all 16 public tables with NOT NULL DEFAULT false', () => {
  const sql0003 = readMigration(migration0003Path, 'Migration 0003');

  for (const table of rlsTables) {
    assert.match(
      sql0003,
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+is_demo\\s+boolean\\s+not\\s+null\\s+default\\s+false;`, 'i'),
      `Migration 0003 must add is_demo to ${table}`,
    );
  }
});

test('migration 0003 adds prevent_demo_flag_tampering trigger on all 15 updateable tables', () => {
  const sql0003 = readMigration(migration0003Path, 'Migration 0003');

  const tamperingFunc = functionBlock(sql0003, 'prevent_demo_flag_tampering');
  assert.match(tamperingFunc, /new\.is_demo\s+is\s+distinct\s+from\s+old\.is_demo/i);
  assert.match(tamperingFunc, /The is_demo flag is immutable/i);
  assert.match(tamperingFunc, /errcode\s*=\s*'23514'/i);

  for (const table of updateableTables) {
    assert.match(
      sql0003,
      new RegExp(`create\\s+trigger\\s+prevent_demo_flag_tampering\\s+before\\s+update\\s+on\\s+public\\.${table}`, 'i'),
      `Migration 0003 must attach prevent_demo_flag_tampering before update on ${table}`,
    );
  }
});

test('migration 0003 updates handle_new_auth_user to evaluate is_demo at insert', () => {
  const sql0003 = readMigration(migration0003Path, 'Migration 0003');
  const authSync = functionBlock(sql0003, 'handle_new_auth_user');

  assert.match(authSync, /v_is_demo\s*:=/i);
  assert.match(authSync, /like\s+'%@sn-demo\.local'/i);
  assert.match(authSync, /insert into public\.profiles\s*\([^)]*is_demo[^)]*\)/i);
});

test('migration 0003 cleanup trigger overrides enforce strict triple-authorization without is_founder re-query', () => {
  const sql0003 = readMigration(migration0003Path, 'Migration 0003');

  const triggersToCheck = [
    { name: 'guard_invoice_item_write', func: functionBlock(sql0003, 'guard_invoice_item_write') },
    { name: 'prevent_financial_document_delete', func: functionBlock(sql0003, 'prevent_financial_document_delete') },
    { name: 'prevent_cash_ledger_delete', func: functionBlock(sql0003, 'prevent_cash_ledger_delete') },
    { name: 'guard_user_role_write', func: functionBlock(sql0003, 'guard_user_role_write') },
    { name: 'prevent_audit_mutation', func: functionBlock(sql0003, 'prevent_audit_mutation') },
  ];

  for (const { name, func } of triggersToCheck) {
    assert.match(func, /old\.is_demo\s*=\s*true/i, `${name} must check old.is_demo = true`);
    assert.match(func, /coalesce\(current_setting\('app\.demo_cleanup',\s*true\),\s*''\)\s*=\s*'on'/i, `${name} must check app.demo_cleanup = 'on'`);
    assert.match(func, /coalesce\(current_setting\('app\.demo_cleanup_actor',\s*true\),\s*''\)/i, `${name} must check app.demo_cleanup_actor`);
  }
});

test('migration 0003 audit_row_change preserves personal work item redaction, 8-way PK extraction, and suppresses cleanup', () => {
  const sql0003 = readMigration(migration0003Path, 'Migration 0003');
  const auditFunc = functionBlock(sql0003, 'audit_row_change');

  // Cleanup suppression
  assert.match(auditFunc, /coalesce\(current_setting\('app\.demo_cleanup',\s*true\),\s*''\)\s*=\s*'on'/i);
  assert.match(auditFunc, /return\s+case\s+when\s+tg_op\s*=\s*'DELETE'\s+then\s+old\s+else\s+new\s+end;/i);

  // Personal work item privacy redaction on both OLD and NEW
  assert.match(auditFunc, /v_old\s*:=\s*v_old\s*-\s*'title'\s*-\s*'description'\s*-\s*'completion_note'/i, 'Personal-task content must be redacted on OLD');
  assert.match(auditFunc, /v_new\s*:=\s*v_new\s*-\s*'title'\s*-\s*'description'\s*-\s*'completion_note'/i, 'Personal-task content must be redacted on NEW');

  // Composite & Non-Standard Primary Key Survival
  assert.match(auditFunc, /v_new\s*->>\s*'employee_id'/i, 'staff_reporting_lines employee_id PK must be extracted on NEW');
  assert.match(auditFunc, /v_old\s*->>\s*'employee_id'/i, 'staff_reporting_lines employee_id PK must be extracted on OLD');
  assert.match(auditFunc, /nullif\(concat_ws\(':',\s*v_new\s*->>\s*'assignment_id',\s*v_new\s*->>\s*'reviewer_id'\),\s*''\)/i, 'Composite assignment_reviewers PK on NEW');
  assert.match(auditFunc, /nullif\(concat_ws\(':',\s*v_old\s*->>\s*'assignment_id',\s*v_old\s*->>\s*'reviewer_id'\),\s*''\)/i, 'Composite assignment_reviewers PK on OLD');

  // Propagation of is_demo
  assert.match(auditFunc, /v_is_demo\s*:=/i);
});

test('migration 0003 remove_demo_data enforces founder gate, exact teardown order, and permanent audit entry', () => {
  const sql0003 = readMigration(migration0003Path, 'Migration 0003');
  const removeRpc = functionBlock(sql0003, 'remove_demo_data');

  // Founder security gate & capture
  assert.match(removeRpc, /v_actor\s+is\s+null\s+or\s+not\s+public\.is_founder\(v_actor\)/i);
  assert.match(removeRpc, /v_actor_role\s*:=\s*public\.role_of\(v_actor\);/i);

  // Set transaction-local GUCs
  assert.match(removeRpc, /perform\s+set_config\('app\.demo_cleanup',\s*'on',\s*true\);/i);
  assert.match(removeRpc, /perform\s+set_config\('app\.demo_cleanup_actor',\s*v_actor::text,\s*true\);/i);

  // Deletion order verification
  const auditLogDel = removeRpc.indexOf('delete from public.audit_log where is_demo = true;');
  const userRolesNonFounderDel = removeRpc.indexOf("delete from public.user_roles where is_demo = true and role <> 'founder';");
  const userRolesFounderDel = removeRpc.indexOf("delete from public.user_roles where is_demo = true and role = 'founder';");

  assert.ok(auditLogDel > 0, 'Audit log deletion statement must exist');
  assert.ok(userRolesNonFounderDel > 0, 'Non-founder user role deletion statement must exist');
  assert.ok(userRolesFounderDel > 0, 'Founder user role deletion statement must exist');
  assert.ok(auditLogDel < userRolesNonFounderDel, 'Demo audit rows must be deleted before user roles');
  assert.ok(userRolesNonFounderDel < userRolesFounderDel, 'Non-founder roles must be deleted before founder role');

  // Turn off cleanup before permanent audit record
  const cleanupOff = removeRpc.indexOf("perform set_config('app.demo_cleanup', 'off', true);");
  const auditInsert = removeRpc.indexOf('insert into public.audit_log');
  assert.ok(cleanupOff > 0 && cleanupOff < auditInsert, 'app.demo_cleanup must be turned off before permanent audit insert');
  assert.match(removeRpc, /v_actor_role,\s*'system',\s*'DELETE',\s*'demo_dataset'/i, 'Audit row must use captured v_actor_role');

  // Revoke / grant
  assert.match(sql0003, /revoke\s+all\s+on\s+function\s+public\.remove_demo_data\(\)\s+from\s+public,\s*anon;/i);
  assert.match(sql0003, /grant\s+execute\s+on\s+function\s+public\.remove_demo_data\(\)\s+to\s+authenticated;/i);
});

test('migration 0004 defines recurring_schedule_reviewers with RLS and triggers', () => {
  const sql0004 = readMigration(migration0004Path, 'Migration 0004');
  expectSql(sql0004, /create table if not exists public\.recurring_schedule_reviewers/i, 'Table declaration');
  expectSql(sql0004, /alter table public\.recurring_schedule_reviewers enable row level security;/i, 'RLS enabled');
  expectSql(sql0004, /create policy recurring_schedule_reviewers_select on public\.recurring_schedule_reviewers/i, 'Select policy');
  expectSql(sql0004, /create policy recurring_schedule_reviewers_insert on public\.recurring_schedule_reviewers/i, 'Insert policy');
  expectSql(sql0004, /create policy recurring_schedule_reviewers_delete on public\.recurring_schedule_reviewers/i, 'Delete policy');
  expectSql(sql0004, /create trigger guard_recurring_schedule_reviewer_write/i, 'Guard trigger');
  expectSql(sql0004, /create trigger audit_recurring_schedule_reviewers/i, 'Audit trigger');
  expectSql(sql0004, /create trigger prevent_demo_flag_tampering/i, 'Tampering trigger');
});

test('migration 0004 enforces terminal immutability on approved assignments and reviewers', () => {
  const sql0004 = readMigration(migration0004Path, 'Migration 0004');
  const assignmentGuard = functionBlock(sql0004, 'guard_assignment_write');
  const reviewerGuard = functionBlock(sql0004, 'guard_assignment_reviewer_write');
  assert.match(assignmentGuard, /Approved, closed, and cancelled Assignments are immutable/i);
  assert.match(reviewerGuard, /Cannot modify reviewers on an approved, closed, or cancelled Assignment/i);
});

test('migration 0004 copies schedule reviewers to assignments during recurrence materialization', () => {
  const sql0004 = readMigration(migration0004Path, 'Migration 0004');
  const matFunc = functionBlock(sql0004, 'materialize_due_recurring_assignments');
  assert.match(matFunc, /insert into public\.assignment_reviewers/i);
  assert.match(matFunc, /from public\.recurring_schedule_reviewers rsr/i);
});

test('migration 0004 cleans recurring_schedule_reviewers in remove_demo_data', () => {
  const sql0004 = readMigration(migration0004Path, 'Migration 0004');
  const removeRpc = functionBlock(sql0004, 'remove_demo_data');
  assert.match(removeRpc, /delete from public\.recurring_schedule_reviewers where is_demo = true;/i);
});

test('migration 0005 defines ENG-01 core engagement schema, authority, immutability, and cleanup', () => {
  // 1. Prior migrations must not be edited
  assert.ok(existsSync(migration0001Path));
  assert.ok(existsSync(migration0002Path));
  assert.ok(existsSync(migration0003Path));
  assert.ok(existsSync(migration0004Path));
  assert.ok(existsSync(migration0005Path));

  const sql0005 = readMigration(migration0005Path, 'Migration 0005');

  // 2. Exact enums
  expectSql(sql0005, /create type public\.engagement_status as enum \('draft',\s*'active',\s*'ended'\);/i, 'engagement_status enum');
  expectSql(sql0005, /create type public\.engagement_fee_model as enum \('fixed',\s*'recurring',\s*'milestone',\s*'time_based'\);/i, 'engagement_fee_model enum');
  expectSql(sql0005, /create type public\.engagement_end_outcome as enum \('completed',\s*'terminated'\);/i, 'engagement_end_outcome enum');

  // 3. Code sequence prefix ENG, starts at 1001, revoke anon, grant authenticated
  expectSql(sql0005, /create sequence if not exists public\.engagement_code_seq start with 1001;/i, 'engagement_code_seq starts at 1001');
  expectSql(sql0005, /'ENG-' \|\| lpad\(nextval\('public\.engagement_code_seq'\)::text,\s*6,\s*'0'\)/i, 'ENG code format');
  expectSql(sql0005, /revoke all on public\.engagement_code_seq from anon;/i, 'revoke seq from anon');
  expectSql(sql0005, /grant usage,\s*select on public\.engagement_code_seq to authenticated;/i, 'grant seq to authenticated');

  // 4. Tables and structural constraints: service_id NOT NULL and JS safe integer fee bound
  expectSql(sql0005, /create table public\.engagements\s*\(/i, 'engagements table');
  expectSql(sql0005, /service_id uuid not null references public\.service_catalog\(id\) on delete restrict/i, 'service_id NOT NULL on engagements');
  expectSql(sql0005, /create table public\.engagement_versions\s*\(/i, 'engagement_versions table');
  expectSql(sql0005, /agreed_fee_paise bigint not null check \(agreed_fee_paise between 0 and 9007199254740991\)/i, 'safe-integer SQL fee bound');
  expectSql(sql0005, /unique\s*\(engagement_id,\s*version_number\)/i, 'version uniqueness');
  expectSql(sql0005, /references public\.clients\(id\) on delete restrict/i, 'client foreign key');
  expectSql(sql0005, /foreign key \(approved_version_id\)\s+references public\.engagement_versions\(id\)/i, 'approved_version_id FK');

  // 5. RLS enabled on both tables
  expectSql(sql0005, /alter table public\.engagements enable row level security;/i, 'engagements RLS');
  expectSql(sql0005, /alter table public\.engagement_versions enable row level security;/i, 'engagement_versions RLS');

  // 6. Management-only RLS policies, no DELETE policies
  expectSql(sql0005, /create policy engagements_select on public\.engagements\s+for select to authenticated\s+using \(public\.is_management\(\)\);/i, 'engagements select policy');
  expectSql(sql0005, /create policy engagements_insert on public\.engagements\s+for insert to authenticated\s+with check \(public\.is_management\(\)\);/i, 'engagements insert policy');
  expectSql(sql0005, /create policy engagements_update on public\.engagements\s+for update to authenticated/i, 'engagements update policy');
  assert.doesNotMatch(sql0005, /create policy [a-z_]+ on public\.engagements\s+for delete/i, 'no delete policy on engagements');

  expectSql(sql0005, /create policy engagement_versions_select on public\.engagement_versions\s+for select to authenticated\s+using \(public\.is_management\(\)\);/i, 'engagement_versions select policy');
  expectSql(sql0005, /create policy engagement_versions_insert on public\.engagement_versions\s+for insert to authenticated\s+with check \(public\.is_management\(\)\);/i, 'engagement_versions insert policy');
  expectSql(sql0005, /create policy engagement_versions_update on public\.engagement_versions\s+for update to authenticated/i, 'engagement_versions update policy');
  assert.doesNotMatch(sql0005, /create policy [a-z_]+ on public\.engagement_versions\s+for delete/i, 'no delete policy on engagement_versions');

  // 7. Lifecycle authority and immutability guards
  const engagementGuard = functionBlock(sql0005, 'guard_engagement_write');
  const versionGuard = functionBlock(sql0005, 'guard_engagement_version_write');

  // Draft-only insertion
  assert.match(engagementGuard, /Every new engagement must be created in draft status/i);
  assert.match(engagementGuard, /Draft engagement must not have approval or ending metadata/i);

  // Parent ended blocks version writes
  assert.match(versionGuard, /Cannot create versions on an ended engagement/i);
  assert.match(versionGuard, /Cannot update versions on an ended engagement/i);

  // Approval/ending actor metadata is server-authored
  assert.match(versionGuard, /new\.approved_by := v_actor;/i);
  assert.match(versionGuard, /new\.approved_at := now\(\);/i);
  assert.match(engagementGuard, /new\.ended_at := now\(\);/i);
  assert.match(engagementGuard, /new\.ended_by := v_actor;/i);
  assert.match(engagementGuard, /new\.approved_at := v_approved_ver\.approved_at;/i);
  assert.match(engagementGuard, /new\.approved_by := v_approved_ver\.approved_by;/i);

  // Version must be approved and belong to aggregate before activation/amendment
  assert.match(engagementGuard, /Approved version must belong to this engagement/i);
  assert.match(engagementGuard, /Version must be approved before engagement activation/i);
  assert.match(engagementGuard, /Version approver must resolve to an active Founder/i);

  // Service/client immutability
  assert.match(engagementGuard, /Engagement identity, client, service, and provenance are immutable/i);
  assert.match(versionGuard, /Engagement version identity and provenance are immutable/i);

  // Active client & service checks apply on creation and activation, without blocking ending
  assert.match(engagementGuard, /Client must be active for engagement creation/i);
  assert.match(engagementGuard, /Service must be active in catalog for engagement creation/i);
  assert.match(engagementGuard, /Client must be active for engagement activation/i);
  assert.match(engagementGuard, /Service must be active in catalog for engagement activation/i);

  // Approved versions are immutable
  assert.match(versionGuard, /Approved engagement versions are strictly immutable/i);

  // Founder sole authority for activation, approved amendment, and ending
  assert.match(engagementGuard, /Only the Founder may activate an engagement/i);
  assert.match(engagementGuard, /Only the Founder may approve an amendment on an active engagement/i);
  assert.match(engagementGuard, /Only the Founder may end an engagement/i);
  assert.match(engagementGuard, /An end outcome and reason are required to end an engagement/i);

  // 8. Triggers: updated_at, audit_row_change, prevent_demo_flag_tampering
  expectSql(sql0005, /create trigger set_engagements_updated_at\s+before update on public\.engagements/i, 'set_updated_at trigger');
  expectSql(sql0005, /create trigger audit_engagements\s+after insert or update or delete on public\.engagements/i, 'audit_engagements trigger');
  expectSql(sql0005, /create trigger audit_engagement_versions\s+after insert or update or delete on public\.engagement_versions/i, 'audit_engagement_versions trigger');
  expectSql(sql0005, /create trigger prevent_demo_flag_tampering\s+before update on public\.engagements/i, 'demo flag tamper trigger on engagements');
  expectSql(sql0005, /create trigger prevent_demo_flag_tampering\s+before update on public\.engagement_versions/i, 'demo flag tamper trigger on engagement_versions');

  // 9. remove_demo_data full lifecycle normalization before version and engagement deletes
  const removeRpc = functionBlock(sql0005, 'remove_demo_data');
  const normUpdate = removeRpc.indexOf("status = 'draft'");
  const verDel = removeRpc.indexOf('delete from public.engagement_versions where is_demo = true;');
  const engDel = removeRpc.indexOf('delete from public.engagements where is_demo = true;');
  const srvDel = removeRpc.indexOf('delete from public.service_catalog where is_demo = true;');
  const cliDel = removeRpc.indexOf('delete from public.clients where is_demo = true;');

  assert.ok(normUpdate > 0, 'full lifecycle normalization statement must exist');
  assert.ok(verDel > 0, 'engagement_versions delete statement must exist');
  assert.ok(engDel > 0, 'engagements delete statement must exist');
  assert.ok(normUpdate < verDel, 'full lifecycle normalization must precede engagement_versions delete');
  assert.ok(verDel < engDel, 'engagement_versions must be deleted before engagements');
  assert.ok(engDel < srvDel, 'engagements must be deleted before service_catalog');
  assert.ok(engDel < cliDel, 'engagements must be deleted before clients');
  assert.match(removeRpc, /approved_version_id = null[\s\S]*approved_at = null[\s\S]*ended_at = null/i, 'proves full teardown normalization');

  // 10. Invariant: no engagement_id added to assignments or recurring schedules
  assert.doesNotMatch(sql0005, /alter table\s+public\.assignments\s+add\s+column[^\n]*engagement_id/i, 'no engagement_id on assignments');
  assert.doesNotMatch(sql0005, /alter table\s+public\.recurring_schedules\s+add\s+column[^\n]*engagement_id/i, 'no engagement_id on recurring_schedules');
});

test('migration 0006 defines ENG-01 operation receipts, actor isolation, and cleanup', () => {
  // 1. Prior migrations exist and remain untouched
  assert.ok(existsSync(migration0001Path));
  assert.ok(existsSync(migration0002Path));
  assert.ok(existsSync(migration0003Path));
  assert.ok(existsSync(migration0004Path));
  assert.ok(existsSync(migration0005Path));
  assert.ok(existsSync(migration0006Path));

  const sql0006 = readMigration(migration0006Path, 'Migration 0006');

  // 2. Table creation and exact columns
  expectSql(sql0006, /create table public\.operation_receipts\s*\(/i, 'operation_receipts table');
  expectSql(sql0006, /actor_id uuid not null references public\.profiles\(user_id\) on delete restrict/i, 'actor_id references profiles(user_id)');
  expectSql(sql0006, /char_length\(trim\(idempotency_key\)\) between 1 and 255/i, 'trimmed idempotency_key length check');
  expectSql(sql0006, /char_length\(trim\(operation_type\)\) between 1 and 120/i, 'trimmed operation_type length check');
  expectSql(sql0006, /request_hash text not null check \(request_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i, 'sha256 hex request_hash regex');
  expectSql(sql0006, /result jsonb not null/i, 'result jsonb');
  expectSql(sql0006, /is_demo boolean not null default false/i, 'is_demo boolean default false');
  expectSql(sql0006, /unique\s*\(actor_id,\s*idempotency_key\)/i, 'unique(actor_id, idempotency_key)');

  // 3. RLS enabled
  expectSql(sql0006, /alter table public\.operation_receipts enable row level security;/i, 'RLS enabled on operation_receipts');

  // 4. Management + actor ownership isolation (no cross-actor replay/read)
  expectSql(sql0006, /create policy operation_receipts_select on public\.operation_receipts\s+for select to authenticated\s+using \(public\.is_management\(\) and actor_id = auth\.uid\(\)\);/i, 'select policy');
  expectSql(sql0006, /create policy operation_receipts_insert on public\.operation_receipts\s+for insert to authenticated\s+with check \(public\.is_management\(\) and actor_id = auth\.uid\(\)\);/i, 'insert policy');

  // No update or delete policies
  assert.doesNotMatch(sql0006, /create policy [a-z_]+ on public\.operation_receipts\s+for delete/i, 'no delete policy on operation_receipts');
  assert.doesNotMatch(sql0006, /create policy [a-z_]+ on public\.operation_receipts\s+for update/i, 'no update policy on operation_receipts');

  // 5. Least privilege grants: select, insert only
  expectSql(sql0006, /revoke all on public\.operation_receipts from anon;/i, 'revoke anon');
  expectSql(sql0006, /grant select,\s*insert on public\.operation_receipts to authenticated;/i, 'grant select, insert only');
  assert.doesNotMatch(sql0006, /grant\s+.*update.*on public\.operation_receipts/i, 'no update grant');
  assert.doesNotMatch(sql0006, /grant\s+.*delete.*on public\.operation_receipts/i, 'no delete grant');

  // 6. Triggers: demo tampering and audit
  expectSql(sql0006, /create trigger prevent_demo_flag_tampering\s+before update on public\.operation_receipts/i, 'tampering trigger');
  expectSql(sql0006, /create trigger audit_operation_receipts\s+after insert or update or delete on public\.operation_receipts/i, 'audit trigger');

  // 7. remove_demo_data teardown cleans operation_receipts
  const removeRpc = functionBlock(sql0006, 'remove_demo_data');
  const rcptDel = removeRpc.indexOf('delete from public.operation_receipts where is_demo = true;');
  const engDel = removeRpc.indexOf('delete from public.engagements where is_demo = true;');
  const cliDel = removeRpc.indexOf('delete from public.clients where is_demo = true;');

  assert.ok(rcptDel > 0, 'operation_receipts delete statement must exist');
  assert.ok(rcptDel < cliDel, 'operation_receipts must be deleted before clients');
  assert.ok(rcptDel < engDel, 'operation_receipts must be deleted before engagements');
  assert.match(removeRpc, /'operation_receipts',\s*v_operation_receipts_count/i, 'summary includes operation_receipts');
});

test('migration 0007 links assignments to engagements with a guarded, immutable, DB-derived code', () => {
  const migration0007Path = new URL('../../supabase/migrations/20261112130000_eng02_assignment_engagement_link.sql', import.meta.url);
  const sql0007 = readMigration(migration0007Path, 'Migration 0007');

  // 1. Optional FK with restrict, index, and paired-nullness constraint
  expectSql(sql0007, /add column engagement_id uuid references public\.engagements\(id\) on delete restrict/i, 'nullable restrict FK');
  assert.doesNotMatch(sql0007, /engagement_id uuid[^,]*not null/i, 'engagement_id stays nullable');
  expectSql(sql0007, /add column engagement_code text(?!\s+not null)/i, 'engagement_code nullable text');
  expectSql(sql0007, /create index assignments_engagement_idx on public\.assignments \(engagement_id\);/i, 'engagement index');
  expectSql(sql0007, /constraint assignment_engagement_code_pair check \(\s*\(engagement_id is null\) = \(engagement_code is null\)\s*\)/i, 'code null exactly when id null');

  // 2. Guard function: security definer, pinned search_path, same-client + active + immutable rules
  const guard = functionBlock(sql0007, 'guard_assignment_engagement_link');
  assert.match(guard, /security definer/i);
  assert.match(guard, /set search_path = public, pg_temp/i);
  assert.match(guard, /The Engagement must belong to the same client as the Assignment/i);
  assert.match(guard, /An Assignment can only be linked to an active Engagement/i);
  assert.match(guard, /new\.engagement_code := v_engagement\.code;/i);
  assert.match(guard, /The Assignment engagement link is immutable after creation/i);
  assert.match(guard, /A linked Assignment cannot change client/i);

  // 3. Trigger fires on insert and on update of the guarded columns
  expectSql(
    sql0007,
    /create trigger guard_assignment_engagement_link\s+before insert or update of engagement_id, engagement_code, client_id on public\.assignments\s+for each row execute function public\.guard_assignment_engagement_link\(\);/i,
    'guard trigger',
  );

  // 4. Additive only: schedules and the materializer are untouched
  assert.doesNotMatch(sql0007, /recurring_schedules/i, 'no recurring schedule change');
  assert.doesNotMatch(sql0007, /materialize_due_recurring_assignments/i, 'materializer untouched');
});

test('migration 0008 links recurring schedules to engagements and stops them when the engagement ends', () => {
  const migration0008Path = new URL('../../supabase/migrations/20261113100000_eng02c_schedule_engagement_link.sql', import.meta.url);
  const sql0008 = readMigration(migration0008Path, 'Migration 0008');

  // 1. Optional FK with restrict, index, and paired-nullness constraint
  expectSql(sql0008, /add column engagement_id uuid references public\.engagements\(id\) on delete restrict/i, 'nullable restrict FK');
  assert.doesNotMatch(sql0008, /engagement_id uuid[^,]*not null/i, 'engagement_id stays nullable');
  expectSql(sql0008, /add column engagement_code text(?!\s+not null)/i, 'engagement_code nullable text');
  expectSql(sql0008, /create index recurring_schedules_engagement_idx on public\.recurring_schedules \(engagement_id\);/i, 'engagement index');
  expectSql(sql0008, /constraint recurring_schedule_engagement_code_pair check \(\s*\(engagement_id is null\) = \(engagement_code is null\)\s*\)/i, 'code null exactly when id null');

  // 2. Guard function: security definer, pinned search_path, same-client + active + immutable + no reactivation
  const guard = functionBlock(sql0008, 'guard_recurring_schedule_engagement_link');
  assert.match(guard, /security definer/i);
  assert.match(guard, /set search_path = public, pg_temp/i);
  assert.match(guard, /The Engagement must belong to the same client as the Recurring Schedule/i);
  assert.match(guard, /A Recurring Schedule can only be linked to an active Engagement/i);
  assert.match(guard, /new\.engagement_code := v_engagement\.code;/i);
  assert.match(guard, /The Recurring Schedule engagement link is immutable after creation/i);
  assert.match(guard, /A linked Recurring Schedule cannot change client/i);
  assert.match(guard, /new\.is_active and not old\.is_active and new\.engagement_id is not null/i);
  assert.match(guard, /A Recurring Schedule linked to an ended Engagement cannot be reactivated/i);

  expectSql(
    sql0008,
    /create trigger guard_recurring_schedule_engagement_link\s+before insert or update of engagement_id, engagement_code, client_id, is_active on public\.recurring_schedules\s+for each row execute function public\.guard_recurring_schedule_engagement_link\(\);/i,
    'guard trigger',
  );

  // 3. Ending an engagement deactivates its schedules
  const stop = functionBlock(sql0008, 'stop_engagement_recurring_schedules');
  assert.match(stop, /security definer/i);
  assert.match(stop, /set search_path = public, pg_temp/i);
  assert.match(stop, /set is_active = false/i);
  assert.match(stop, /where engagement_id = new\.id\s+and is_active;/i);
  expectSql(
    sql0008,
    /create trigger stop_engagement_recurring_schedules\s+after update of status on public\.engagements\s+for each row\s+when \(old\.status is distinct from new\.status and new\.status = 'ended'\)\s+execute function public\.stop_engagement_recurring_schedules\(\);/i,
    'stop trigger',
  );

  // 4. Materializer inherits the link and skips schedules whose engagement is not active
  const materializer = functionBlock(sql0008, 'materialize_due_recurring_assignments');
  assert.match(materializer, /rs\.engagement_id is null\s+or exists \(\s*select 1 from public\.engagements e\s+where e\.id = rs\.engagement_id and e\.status = 'active'/i);
  assert.match(materializer, /recurring_schedule_id,\s+engagement_id,\s+title,/i);
  assert.match(materializer, /v_schedule\.id,\s+v_schedule\.engagement_id,\s+v_schedule\.title,/i);
});

test('migration 0009 tracks Vyapar bills with a per-financial-year unique number and fee-visible access', () => {
  const migration0009Path = new URL('../../supabase/migrations/20261113120000_fee01_vyapar_bills.sql', import.meta.url);
  const sql0009 = readMigration(migration0009Path, 'Migration 0009');

  // 1. Nullable Vyapar number, length check, immutable FY expression, partial unique index
  expectSql(sql0009, /add column vyapar_bill_number text;/i, 'nullable vyapar_bill_number');
  assert.doesNotMatch(sql0009, /vyapar_bill_number text not null/i, 'existing rows stay null');
  expectSql(sql0009, /vyapar_bill_number is null or char_length\(btrim\(vyapar_bill_number\)\) between 1 and 30/i, 'length check');
  const fy = functionBlock(sql0009, 'financial_year_start');
  assert.match(fy, /\bimmutable\b/i);
  assert.match(fy, /extract\(month from p_date\) < 4/i);
  expectSql(
    sql0009,
    /create unique index invoices_vyapar_bill_fy_uidx\s+on public\.invoices \(upper\(btrim\(vyapar_bill_number\)\), public\.financial_year_start\(issue_date\)\)\s+where vyapar_bill_number is not null and status <> 'voided';/i,
    'unique per FY, case-insensitive, ignoring voided',
  );

  // 2. Invoice guard: Vyapar number immutable, recompute may pass for staff, management otherwise
  const invoiceGuard = functionBlock(sql0009, 'guard_invoice_write');
  assert.match(invoiceGuard, /security definer/i);
  assert.match(invoiceGuard, /set search_path = public, pg_temp/i);
  assert.match(invoiceGuard, /new\.vyapar_bill_number is distinct from old\.vyapar_bill_number/i);
  assert.match(invoiceGuard, /v_actor is not null and not v_internal_recompute and not public\.is_management\(v_actor\)/i);
  assert.match(invoiceGuard, /A new Invoice must begin as an empty Draft\./i);

  // 3. Fee visibility helpers: security definer, pinned search_path, management or owner/reviewer
  for (const name of ['user_fee_visible', 'fee_visible']) {
    const helper = functionBlock(sql0009, name);
    assert.match(helper, /security definer/i, `${name} is security definer`);
    assert.match(helper, /set search_path = public, pg_temp/i, `${name} pins search_path`);
  }
  const userFee = functionBlock(sql0009, 'user_fee_visible');
  assert.match(userFee, /public\.is_management\(p_user_id\)/i);
  assert.match(userFee, /public\.role_of\(p_user_id\) in \('senior_staff', 'staff'\)/i);
  assert.match(userFee, /c\.relationship_owner_id = p_user_id/i);
  assert.match(userFee, /a\.owner_id = p_user_id/i);
  assert.match(userFee, /ar\.reviewer_id = p_user_id/i);
  assert.match(functionBlock(sql0009, 'fee_visible'), /public\.user_fee_visible\(auth\.uid\(\), p_client_id\)/i);

  // 4. RLS: fee-visible selects, fee-visible receipt/allocation inserts, everything else untouched
  expectSql(sql0009, /create policy invoices_select on public\.invoices\s+for select to authenticated\s+using \(public\.fee_visible\(client_id\)\);/i, 'invoices select');
  expectSql(sql0009, /create policy invoice_items_select on public\.invoice_items[\s\S]*?public\.fee_visible\(i\.client_id\)/i, 'invoice items select via invoice');
  expectSql(sql0009, /create policy payment_receipts_select on public\.payment_receipts\s+for select to authenticated\s+using \(public\.fee_visible\(client_id\)\);/i, 'receipts select');
  expectSql(sql0009, /create policy payment_receipts_insert on public\.payment_receipts\s+for insert to authenticated\s+with check \(public\.fee_visible\(client_id\) and created_by = auth\.uid\(\)\);/i, 'receipts insert');
  expectSql(sql0009, /create policy payment_allocations_select on public\.payment_allocations[\s\S]*?public\.fee_visible\(pr\.client_id\)/i, 'allocations select via receipt');
  expectSql(sql0009, /create policy payment_allocations_insert on public\.payment_allocations[\s\S]*?created_by = auth\.uid\(\)[\s\S]*?public\.fee_visible\(pr\.client_id\)/i, 'allocations insert');
  for (const untouched of ['invoices_insert', 'invoices_update', 'invoice_items_insert', 'invoice_items_update', 'invoice_items_delete', 'payment_receipts_update', 'payment_allocations_update', 'payment_allocations_delete']) {
    assert.doesNotMatch(sql0009, new RegExp(`policy ${untouched} on`, 'i'), `${untouched} stays management-only`);
  }

  // 5. Receipt guard: staff insert only for fee-visible clients, never with a ledger entry; updates management-only
  const receiptGuard = functionBlock(sql0009, 'guard_payment_receipt_write');
  assert.match(receiptGuard, /security definer/i);
  assert.match(receiptGuard, /set search_path = public, pg_temp/i);
  assert.match(receiptGuard, /if tg_op <> 'INSERT' then\s+raise exception 'Only the Founder or Manager may operate payment receipts\.'\s+using errcode = '42501';/i);
  assert.match(receiptGuard, /not public\.user_fee_visible\(v_actor, new\.client_id\)\s+or new\.ledger_entry_id is not null/i);
  assert.match(receiptGuard, /Only the Founder or Manager, or staff looking after this client, may record payments\./i);
  assert.match(receiptGuard, /errcode = '42501'/i);

  // 6. Allocation guard: staff insert for fee-visible receipt client; update and delete management-only
  const allocationGuard = functionBlock(sql0009, 'guard_payment_allocation_write');
  assert.match(allocationGuard, /security definer/i);
  assert.match(allocationGuard, /set search_path = public, pg_temp/i);
  assert.match(allocationGuard, /if tg_op <> 'INSERT' then\s+raise exception 'Only the Founder or Manager may allocate payments\.' using errcode = '42501';/i);
  assert.match(allocationGuard, /public\.user_fee_visible\(v_actor, pr\.client_id\)/i);
  assert.match(allocationGuard, /Payment allocations exceed the Invoice balance\./i);

  // 7. Operation receipts: fee-capable roles, still actor-isolated
  expectSql(
    sql0009,
    /create policy operation_receipts_select on public\.operation_receipts\s+for select to authenticated\s+using \(\s*public\.current_app_role\(\) in \('founder', 'manager', 'senior_staff', 'staff'\)\s+and actor_id = auth\.uid\(\)\s*\);/i,
    'operation receipts select',
  );
  expectSql(
    sql0009,
    /create policy operation_receipts_insert on public\.operation_receipts\s+for insert to authenticated\s+with check \(\s*public\.current_app_role\(\) in \('founder', 'manager', 'senior_staff', 'staff'\)\s+and actor_id = auth\.uid\(\)\s*\);/i,
    'operation receipts insert',
  );
  assert.doesNotMatch(sql0009, /create policy [a-z_]+ on public\.operation_receipts\s+for (update|delete)/i, 'still no update or delete policy');
});

test('migration 0010 adds an immutable allocation source for client credit without new policies', () => {
  const migration0010Path = new URL('../../supabase/migrations/20261113140000_fee02_client_credit.sql', import.meta.url);
  const sql0010 = readMigration(migration0010Path, 'Migration 0010');

  // 1. Source column: not null, defaults to a direct payment, limited to payment or credit
  expectSql(sql0010, /alter table public\.payment_allocations\s+add column source text not null default 'payment';/i, 'source column defaults to payment');
  expectSql(sql0010, /check \(source in \('payment', 'credit'\)\)/i, 'source check constraint');

  // 2. Allocation guard keeps its FEE-01a rules and makes source immutable
  const guard = functionBlock(sql0010, 'guard_payment_allocation_write');
  assert.match(guard, /security definer/i);
  assert.match(guard, /set search_path = public, pg_temp/i);
  assert.match(guard, /if tg_op <> 'INSERT' then\s+raise exception 'Only the Founder or Manager may allocate payments\.' using errcode = '42501';/i);
  assert.match(guard, /public\.user_fee_visible\(v_actor, pr\.client_id\)/i);
  assert.match(guard, /Payment allocations exceed the Receipt amount\./i);
  assert.match(guard, /Payment allocations exceed the Invoice balance\./i);
  assert.match(guard, /new\.source is distinct from old\.source/i);
  assert.match(guard, /Allocation source is immutable\./i);

  // 3. No policy changes: staff insert and management-only delete stay as FEE-01a left them
  assert.doesNotMatch(sql0010, /\b(create|drop|alter) policy\b/i, 'no policy changes');
});

test('migration 0011 makes service names unique ignoring case and spaces without other changes', () => {
  const migration0011Path = new URL('../../supabase/migrations/20261113160000_svc01_service_catalog_admin.sql', import.meta.url);
  const sql0011 = readMigration(migration0011Path, 'Migration 0011');

  expectSql(
    sql0011,
    /create unique index service_catalog_name_normalized_key\s+on public\.service_catalog \(lower\(btrim\(name\)\)\);/i,
    'normalized service name unique index',
  );
  assert.doesNotMatch(sql0011, /\b(create|drop|alter) policy\b/i, 'no policy changes');
  assert.doesNotMatch(sql0011, /\b(create|drop|alter) (table|function|trigger)\b/i, 'no table, function or trigger changes');
});
