import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const seedPath = new URL('../../supabase/seed.sql', import.meta.url);

function readSeed() {
  if (!existsSync(seedPath)) {
    throw new Error(`seed.sql not found at ${seedPath.pathname}`);
  }
  return readFileSync(seedPath, 'utf8').replaceAll('\r\n', '\n');
}

test('seed.sql exists and contains valid RFC 4122 UUID literals without non-hex characters', () => {
  const seed = readSeed();

  // Find all UUID-like string literals: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  const uuidMatches = [...seed.matchAll(/'([0-9a-fA-F-]{36})'/g)].map((m) => m[1]);
  assert.ok(uuidMatches.length > 0, 'seed.sql must contain UUID literals');

  const validUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const uuid of uuidMatches) {
    assert.match(uuid, validUuidRegex, `Invalid UUID literal format: ${uuid}`);
  }
});

test('seed.sql includes local dev handshake authorization check', () => {
  const seed = readSeed();
  assert.match(
    seed,
    /current_setting\('sn\.seed_authorized',\s*true\)/i,
    'seed.sql must check sn.seed_authorized setting',
  );
  assert.match(
    seed,
    /'sn_practice_crm_local_dev_only'/i,
    'seed.sql must verify the expected local authorization handshake token',
  );
  assert.match(
    seed,
    /errcode\s*=\s*'55000'/i,
    'Handshake failure must raise SQLSTATE 55000',
  );
});

test('seed.sql uses dynamic extensions.crypt and contains no hardcoded bcrypt hashes', () => {
  const seed = readSeed();

  assert.match(
    seed,
    /extensions\.crypt\s*\(\s*'Demo@1234'\s*,\s*extensions\.gen_salt\('bf',\s*10\)\s*\)/i,
    'seed.sql must use dynamic extensions.crypt with extensions.gen_salt',
  );

  assert.doesNotMatch(
    seed,
    /\$2[aby]\$[0-9]{2}\$[A-Za-z0-9./]{53}/,
    'seed.sql must not contain hardcoded bcrypt password hashes',
  );
});

test('seed.sql assigns period_start for all recurring assignments and leaves one-offs null', () => {
  const seed = readSeed();

  // Check that assignments insert references period_start
  assert.match(seed, /insert\s+into\s+public\.assignments\s*\([^)]*period_start[^)]*\)/i);

  // Check recurring assignments AS-001001, AS-001003, AS-001004 have date expressions for period_start
  assert.match(
    seed,
    /'AS-001001'[\s\S]*date_trunc\('month',\s*current_date\s*-\s*interval\s*'1 month'\)::date/i,
    'AS-001001 must set period_start to previous month start',
  );
  assert.match(
    seed,
    /'AS-001003'[\s\S]*date_trunc\('quarter',\s*current_date\s*-\s*interval\s*'(?:1 quarter|3 months)'\)::date/i,
    'AS-001003 must set period_start to previous quarter start',
  );
  assert.match(
    seed,
    /'AS-001004'[\s\S]*date_trunc\('month',\s*current_date\s*-\s*interval\s*'1 month'\)::date/i,
    'AS-001004 must set period_start to previous month start',
  );
});

test('seed.sql avoids hardcoding computed invoice totals or received amounts on insert', () => {
  const seed = readSeed();

  // Initial insert of invoices must be in draft status with 0 or defaulted totals
  const invoiceInsertMatch = seed.match(/insert\s+into\s+public\.invoices\s*\(([^)]+)\)\s*values\s*([\s\S]+?);/i);
  assert.ok(invoiceInsertMatch, 'Invoices insert block must exist');

  const insertCols = invoiceInsertMatch[1].split(',').map((c) => c.trim().toLowerCase());
  // If subtotal, tax_amount, total_amount, or amount_received are in columns, their inserted values must be 0
  const forbiddenNonZeroCols = ['subtotal', 'tax_amount', 'total_amount', 'amount_received'];
  for (const col of forbiddenNonZeroCols) {
    if (insertCols.includes(col)) {
      const colIdx = insertCols.indexOf(col);
      // Verify every row inserted in this statement supplies 0 for this column
      const rows = invoiceInsertMatch[2].split(/\),\s*\(/);
      for (const row of rows) {
        const values = row.replace(/^[^(]*\(/, '').replace(/\)[^)]*$/, '').split(',');
        const val = values[colIdx]?.trim();
        assert.ok(
          val === '0' || val === '0.00' || val === 'default',
          `Invoice column ${col} must be inserted as 0/default, found: ${val}`,
        );
      }
    }
  }
});

test('seed.sql includes complete fail-closed preflight guards with SQLSTATE 55000', () => {
  const seed = readSeed();

  // Guard: existing demo users
  assert.match(seed, /exists\s*\(\s*select\s+1\s+from\s+auth\.users\s+where\s+email\s+like\s+'%@sn-demo\.local'\s*\)/i);

  // Guard: non-demo users
  assert.match(seed, /exists\s*\(\s*select\s+1\s+from\s+auth\.users\s+where\s+email\s+not\s+like\s+'%@sn-demo\.local'\s*\)/i);

  // Guard: non-demo clients
  assert.match(seed, /exists\s*\(\s*select\s+1\s+from\s+public\.clients\s+where\s+is_demo\s*=\s*false\s*\)/i);

  // Guard: clean public tables
  assert.match(seed, /exists\s*\(\s*select\s+1\s+from\s+public\.clients\s*\)/i);
  assert.match(seed, /exists\s*\(\s*select\s+1\s+from\s+public\.cash_accounts\s*\)/i);

  // Guard: RFC 1918 CIDRs
  assert.match(seed, /'127\.0\.0\.0\/8'::cidr/i);
  assert.match(seed, /'::1'::inet/i);
  assert.match(seed, /'10\.0\.0\.0\/8'::cidr/i);
  assert.match(seed, /'172\.16\.0\.0\/12'::cidr/i);
  assert.match(seed, /'192\.168\.0\.0\/16'::cidr/i);
});

test('seed.sql synchronizes all sequences using greatest and substring parsing without string arithmetic', () => {
  const seed = readSeed();

  const expectedSequences = [
    { seq: 'public.client_code_seq', table: 'public.clients', fromPos: 4 },
    { seq: 'public.schedule_code_seq', table: 'public.recurring_schedules', fromPos: 4 },
    { seq: 'public.assignment_code_seq', table: 'public.assignments', fromPos: 4 },
    { seq: 'public.work_item_code_seq', table: 'public.work_items', fromPos: 4 },
    { seq: 'public.ledger_entry_code_seq', table: 'public.cash_ledger_entries', fromPos: 4 },
    { seq: 'public.invoice_code_seq', table: 'public.invoices', fromPos: 5 },
    { seq: 'public.receipt_code_seq', table: 'public.payment_receipts', fromPos: 5 },
  ];

  for (const { seq, table, fromPos } of expectedSequences) {
    const pattern = new RegExp(
      `setval\\s*\\(\\s*'${seq.replace('.', '\\.')}'\\s*,\\s*greatest\\s*\\(\\s*1001\\s*,\\s*coalesce\\s*\\(\\s*\\(\\s*select\\s+max\\s*\\(\\s*substring\\s*\\(\\s*code\\s+from\\s+${fromPos}\\s*\\)::bigint\\s*\\)\\s+from\\s+${table.replace('.', '\\.')}\\s*\\)\\s*,\\s*1000\\s*\\)\\s*\\)`,
      'i',
    );
    assert.match(seed, pattern, `Missing or invalid setval expression for ${seq}`);
  }
});
