import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../migrations/0001_practice_core.sql', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

const migration0002Path = new URL('../migrations/0002_work_item_reminder.sql', import.meta.url);
function readMigration0002() {
  if (!existsSync(migration0002Path)) {
    throw new Error(`Migration 0002 not found at ${migration0002Path.pathname}`);
  }
  return readFileSync(migration0002Path, 'utf8').replaceAll('\r\n', '\n');
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

function expectSql(pattern, message) {
  assert.match(migration, pattern, message);
}

function functionBlock(name) {
  const marker = `create or replace function public.${name}`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const end = migration.indexOf('$$;', start);
  assert.notEqual(end, -1, `Function ${name} has no closing delimiter`);
  return migration.slice(start, end + 3);
}

test('the role vocabulary is exact and ordered', () => {
  const declaration = migration.match(/create type public\.app_role as enum \(([\s\S]*?)\);/i);
  assert.ok(declaration, 'Missing app_role enum');
  assert.deepEqual([...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]), expectedRoles);
});

test('RLS is enabled for every exposed business table', () => {
  const enabled = [...migration.matchAll(
    /alter table public\.([a-z_]+) enable row level security;/gi,
  )].map((match) => match[1]).sort();
  assert.deepEqual(enabled, rlsTables);

  for (const table of rlsTables) {
    expectSql(
      new RegExp(`create policy [a-z_]+_select on public\\.${table}\\s+for select to authenticated`, 'i'),
      `Missing authenticated SELECT policy for ${table}`,
    );
  }
});

test('all security-definer functions pin their search path', () => {
  const blocks = migration
    .split(/(?=create or replace function public\.)/i)
    .filter((block) => /^create or replace function public\./i.test(block));

  const definers = blocks.filter((block) => {
    const end = block.indexOf('$$;');
    return end !== -1 && /security definer/i.test(block.slice(0, end));
  });
  assert.ok(definers.length > 0, 'Expected security-definer functions');
  for (const block of definers) {
    const signature = block.match(/^create or replace function public\.([^\s(]+)/i)?.[1];
    assert.match(
      block.slice(0, block.indexOf('$$;')),
      /set search_path = public(?:, auth)?, pg_temp/i,
      `${signature} must pin search_path`,
    );
  }
});

test('reporting and delegation encode the five-role authority model', () => {
  const delegation = functionBlock('role_may_delegate');
  const staffAuthorityRpc = functionBlock('set_staff_authority');
  const reportingRpc = functionBlock('set_reporting_line');
  expectSql(
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
    /create constraint trigger user_role_reporting_integrity[\s\S]*deferrable initially deferred/i,
    'Role/reporting integrity must be commit-time checked',
  );
  expectSql(
    /create constraint trigger reporting_line_integrity[\s\S]*deferrable initially deferred/i,
    'Reporting-line integrity must be commit-time checked',
  );
});

test('employee identity and authority rows cannot be transferred in place', () => {
  const profileGuard = functionBlock('guard_profile_update');
  const roleGuard = functionBlock('guard_user_role_write');
  const authSync = functionBlock('handle_new_auth_user');

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
  const assignmentGuard = functionBlock('guard_assignment_write');
  const scheduleGuard = functionBlock('guard_recurring_schedule_write');
  const workGuard = functionBlock('guard_work_item_write');

  assert.match(assignmentGuard, /Only the Founder or Manager may create an Assignment/i);
  assert.match(assignmentGuard, /A Trainee cannot own an Assignment/i);
  assert.match(scheduleGuard, /Only the Founder or Manager may manage Recurring Schedules/i);
  assert.match(workGuard, /A Personal Task must be created for self/i);
  assert.match(workGuard, /A Delegated Task requires a parent Assignment/i);
  assert.match(workGuard, /Internal Tasks may be assigned downward only/i);
  assert.match(workGuard, /Work Item kind, creator, and parent context are immutable/i);
  expectSql(
    /on conflict \(recurring_schedule_id, period_start\)[\s\S]*do nothing/i,
    'Recurring materialization must be idempotent only on its occurrence key',
  );
});

test('finance is management-only, derived, append-and-void, and audited', () => {
  expectSql(
    /create policy cash_ledger_select[\s\S]*using \(public\.is_management\(\)\)/i,
    'Office Accounts must be visible only to Founder and Manager',
  );
  expectSql(
    /raise exception 'Posted financial facts cannot be rewritten; void and post a correction\.'/i,
    'Posted ledger facts must be immutable',
  );
  expectSql(
    /amount_received = v_received,[\s\S]*status = v_next_status/i,
    'Invoice receipt state must be derived by the allocation recompute',
  );
  expectSql(
    /Remove received-payment allocations before voiding this Invoice\./i,
    'A paid allocation must be resolved before invoice voiding',
  );
  expectSql(
    /v_old := v_old - 'title' - 'description' - 'completion_note'/i,
    'Personal-task content must be redacted from audit history',
  );
  expectSql(
    /nullif\(concat_ws\(':', v_old ->> 'assignment_id', v_old ->> 'reviewer_id'\), ''\)/i,
    'Composite audit keys must survive DELETE events',
  );
  expectSql(
    /create trigger prevent_audit_mutation[\s\S]*before update or delete on public\.audit_log/i,
    'Audit history must be immutable',
  );

  for (const table of ['assignments', 'work_items', 'cash_ledger_entries', 'invoices', 'payment_receipts', 'audit_log']) {
    assert.doesNotMatch(
      migration,
      new RegExp(`grant[^;]*delete[^;]*on public\\.${table} to authenticated`, 'i'),
      `${table} must not grant DELETE to authenticated users`,
    );
  }
});

test('dashboard reporting views preserve invoker RLS', () => {
  for (const view of [
    'cash_account_balances',
    'client_outstanding',
    'collections_snapshot',
    'billing_collections_monthly',
  ]) {
    expectSql(
      new RegExp(`create view public\\.${view}\\s+with \\(security_invoker = true\\)`, 'i'),
      `${view} must be a security-invoker view`,
    );
  }
});

test('privileged jobs and derived-value functions are not client executable', () => {
  for (const signature of [
    'public.materialize_due_recurring_assignments(date)',
    'public.recompute_invoice_totals(uuid)',
    'public.recompute_invoice_payment_state(uuid)',
  ]) {
    const escaped = signature.replace(/[().]/g, '\\$&');
    expectSql(
      new RegExp(`revoke all on function ${escaped} from public, anon(?:, authenticated)?;`, 'i'),
      `Missing client EXECUTE revocation for ${signature}`,
    );
  }
  expectSql(
    /grant execute on function public\.materialize_due_recurring_assignments\(date\) to service_role;/i,
    'Only the trusted recurring job should receive materialization EXECUTE',
  );
});

test('migration 0002 defines reminder_at column, named check constraint, and partial index', () => {
  const sql0002 = readMigration0002();

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
  const sql0002 = readMigration0002();

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
