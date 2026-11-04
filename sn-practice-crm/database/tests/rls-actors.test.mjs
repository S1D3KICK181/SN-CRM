import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const PASSWORD = 'Demo@1234';

async function getClientFor(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  assert.equal(error, null, `Sign-in failed for ${email}: ${error?.message}`);
  return client;
}

test('RLS actor matrix: founder has 100% visibility', async () => {
  const client = await getClientFor('demo.founder@sn-demo.local');

  const { data: clients, error: cErr } = await client.from('clients').select('id');
  assert.equal(cErr, null);
  assert.equal(clients.length, 6, 'Founder must see all 6 clients');

  const { data: assignments, error: aErr } = await client.from('assignments').select('id');
  assert.equal(aErr, null);
  assert.equal(assignments.length, 6, 'Founder must see all 6 assignments');

  const { data: invoices, error: iErr } = await client.from('invoices').select('id');
  assert.equal(iErr, null);
  assert.equal(invoices.length, 9, 'Founder must see all 9 invoices');

  const { data: ledger, error: lErr } = await client.from('cash_ledger_entries').select('id');
  assert.equal(lErr, null);
  assert.equal(ledger.length, 8, 'Founder must see all 8 ledger entries');
});

test('RLS actor matrix: manager has full management visibility', async () => {
  const client = await getClientFor('demo.manager@sn-demo.local');

  const { data: clients, error: cErr } = await client.from('clients').select('id');
  assert.equal(cErr, null);
  assert.equal(clients.length, 6, 'Manager must see all 6 clients');

  const { data: assignments, error: aErr } = await client.from('assignments').select('id');
  assert.equal(aErr, null);
  assert.equal(assignments.length, 6, 'Manager must see all 6 assignments');

  const { data: invoices, error: iErr } = await client.from('invoices').select('id');
  assert.equal(iErr, null);
  assert.equal(invoices.length, 9, 'Manager must see all 9 invoices');

  const { data: ledger, error: lErr } = await client.from('cash_ledger_entries').select('id');
  assert.equal(lErr, null);
  assert.equal(ledger.length, 8, 'Manager must see all 8 ledger entries');
});

test('RLS actor matrix: senior staff has no finance visibility, sees assigned/reviewed assignments', async () => {
  const client = await getClientFor('demo.senior@sn-demo.local');

  const { data: ledger, error: lErr } = await client.from('cash_ledger_entries').select('id');
  assert.equal(lErr, null);
  assert.equal(ledger.length, 0, 'Senior staff must not see cash ledger entries');

  const { data: invoices, error: iErr } = await client.from('invoices').select('id');
  assert.equal(iErr, null);
  assert.equal(invoices.length, 0, 'Senior staff must not see invoices (management only)');

  const { data: assignments, error: aErr } = await client.from('assignments').select('code');
  assert.equal(aErr, null);
  assert.ok(assignments.length >= 4, `Senior staff should see their involved assignments, got ${assignments.length}`);
});

test('RLS actor matrix: staff has no finance visibility, sees owned assignments', async () => {
  const client = await getClientFor('demo.staff@sn-demo.local');

  const { data: ledger, error: lErr } = await client.from('cash_ledger_entries').select('id');
  assert.equal(lErr, null);
  assert.equal(ledger.length, 0, 'Staff must not see cash ledger entries');

  const { data: invoices, error: iErr } = await client.from('invoices').select('id');
  assert.equal(iErr, null);
  assert.equal(invoices.length, 0, 'Staff must not see invoices');

  const { data: assignments, error: aErr } = await client.from('assignments').select('code');
  assert.equal(aErr, null);
  assert.ok(assignments.length >= 2, `Staff should see their assigned work, got ${assignments.length}`);
});

test('RLS actor matrix: trainee sees only client with involved assignments, zero invoice/ledger visibility, and only delegated work items', async () => {
  const client = await getClientFor('demo.trainee@sn-demo.local');

  const { data: clients, error: cErr } = await client.from('clients').select('id, legal_name');
  assert.equal(cErr, null);
  assert.equal(clients.length, 1, 'Trainee must see only the 1 client with an assignment containing their work items');
  assert.equal(clients[0].id, '10000000-0000-4000-a000-000000000001', 'Visible client must be Aster Foods');

  const { data: invoices, error: iErr } = await client.from('invoices').select('id');
  assert.equal(iErr, null);
  assert.equal(invoices.length, 0, 'Trainee must see 0 invoices');

  const { data: ledger, error: lErr } = await client.from('cash_ledger_entries').select('id');
  assert.equal(lErr, null);
  assert.equal(ledger.length, 0, 'Trainee must see 0 cash ledger entries');

  const { data: workItems, error: wErr } = await client.from('work_items').select('code');
  assert.equal(wErr, null);
  assert.equal(workItems.length, 2, 'Trainee must see exactly their 2 delegated work items');
  const codes = workItems.map((w) => w.code).sort();
  assert.deepEqual(codes, ['WI-001001', 'WI-001002']);
});
