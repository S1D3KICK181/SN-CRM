import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migration0001Path = new URL('../../supabase/migrations/20261031060700_practice_core.sql', import.meta.url);
const migration0002Path = new URL('../../supabase/migrations/20261103105200_work_item_reminder.sql', import.meta.url);
const migration0003Path = new URL('../../supabase/migrations/20261103120000_add_demo_support.sql', import.meta.url);

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
