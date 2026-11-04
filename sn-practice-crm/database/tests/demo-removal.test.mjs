import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'Demo@1234';

async function getClientFor(email) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  assert.equal(error, null, `Sign-in failed for ${email}: ${error?.message}`);
  return client;
}

test('Gate 6: Demo data removal, RLS guards, and real record immutability', async () => {
  const managerClient = await getClientFor('demo.manager@sn-demo.local');
  const founderClient = await getClientFor('demo.founder@sn-demo.local');
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Non-founder calling remove_demo_data() is rejected
  const { error: nonFounderErr } = await managerClient.rpc('remove_demo_data');
  assert.ok(nonFounderErr, 'Non-founder must not be permitted to execute remove_demo_data');
  assert.match(
    nonFounderErr.message,
    /Unauthorized: Only the Founder may remove demo data/i,
    'Must fail with 42501 unauthorized',
  );

  // 2. Founder creates a real non-demo client and invoice
  const founderUserId = '00000000-0000-4000-a000-000000000001';
  const { data: realClient, error: clientErr } = await founderClient
    .from('clients')
    .insert({
      display_name: 'Real Enterprise Ltd',
      legal_name: 'Real Enterprise Limited',
      status: 'active',
      created_by: founderUserId,
      is_demo: false,
    })
    .select()
    .single();
  assert.equal(clientErr, null, `Failed to create real client: ${clientErr?.message}`);

  const { data: realInvoice, error: invErr } = await founderClient
    .from('invoices')
    .insert({
      client_id: realClient.id,
      currency: 'INR',
      due_date: '2026-12-31',
      status: 'draft',
      created_by: founderUserId,
      is_demo: false,
    })
    .select()
    .single();
  assert.equal(invErr, null, `Failed to create real invoice: ${invErr?.message}`);

  const { error: itemErr } = await founderClient
    .from('invoice_items')
    .insert({
      invoice_id: realInvoice.id,
      description: 'Professional Consulting Services',
      quantity: 1,
      unit_price: 50000.00,
      tax_rate: 18.00,
      is_demo: false,
    });
  assert.equal(itemErr, null, `Failed to create invoice item: ${itemErr?.message}`);

  // Issue the invoice
  const { error: issueErr } = await founderClient
    .from('invoices')
    .update({ status: 'issued', issued_at: new Date().toISOString() })
    .eq('id', realInvoice.id);
  assert.equal(issueErr, null, `Failed to issue invoice: ${issueErr?.message}`);

  // 3. Attempt direct delete of real invoice -> fails (lacks table delete grant / blocked by trigger)
  const { error: delRealInvErr } = await founderClient
    .from('invoices')
    .delete()
    .eq('id', realInvoice.id);
  assert.ok(delRealInvErr, 'Direct delete of real invoice must fail');
  assert.match(delRealInvErr.message, /permission denied|Financial documents are voided, never deleted/i);

  // Service role also cannot delete financial documents directly without cleanup flag (tested via trigger)
  const { error: adminDelInvErr } = await adminClient
    .from('invoices')
    .delete()
    .eq('id', realInvoice.id);
  assert.ok(adminDelInvErr, 'Direct delete of real invoice via admin must fail trigger');
  assert.match(adminDelInvErr.message, /Financial documents are voided, never deleted/i);

  // 4. Attempt direct delete of demo invoice without cleanup flag -> fails
  const { error: delDemoInvErr } = await founderClient
    .from('invoices')
    .delete()
    .eq('code', 'INV-0001001');
  assert.ok(delDemoInvErr, 'Direct delete of demo invoice without cleanup context must fail');
  assert.match(delDemoInvErr.message, /permission denied|Financial documents are voided, never deleted/i);

  // 5. Attempt direct delete of demo invoice item without cleanup flag -> fails with 23514
  const { error: delDemoItemErr } = await founderClient
    .from('invoice_items')
    .delete()
    .eq('description', 'Statutory GST Compliance · Oct 2026');
  assert.ok(delDemoItemErr, 'Direct delete of demo invoice item without cleanup context must fail');

  // 6. Attempt updating is_demo flag from false to true on real invoice -> fails with 23514
  const { error: tamperErr } = await founderClient
    .from('invoices')
    .update({ is_demo: true })
    .eq('id', realInvoice.id);
  assert.ok(tamperErr, 'Tampering with is_demo flag on real invoice must fail');
  assert.match(tamperErr.message, /The is_demo flag is immutable/i);

  // 6b. Attempt updating is_demo flag from true to false on demo assignment_reviewers by manager -> fails with 23514
  const { error: tamperRevErr } = await managerClient
    .from('assignment_reviewers')
    .update({ is_demo: false })
    .eq('assignment_id', '30000000-0000-4000-a000-000000000001')
    .eq('reviewer_id', '00000000-0000-4000-a000-000000000003');
  assert.ok(tamperRevErr, 'Manager tampering with is_demo flag on assignment_reviewers must fail');
  assert.match(tamperRevErr.message, /The is_demo flag is immutable/i);

  // 7. Founder calls remove_demo_data() RPC
  const { data: cleanupResult, error: cleanupErr } = await founderClient.rpc('remove_demo_data');
  assert.equal(cleanupErr, null, `Founder remove_demo_data failed: ${cleanupErr?.message}`);
  assert.equal(cleanupResult?.ok, true, 'RPC must return ok: true');
  assert.ok(cleanupResult?.deleted, 'RPC must return deleted counts object');
  assert.ok(Array.isArray(cleanupResult?.demo_auth_users), 'RPC must return demo_auth_users array');
  assert.equal(cleanupResult.demo_auth_users.length, 5, 'Must return 5 demo auth users');

  // Verify deleted counts
  assert.equal(cleanupResult.deleted.allocations, 5);
  assert.equal(cleanupResult.deleted.invoice_items, 9);
  assert.equal(cleanupResult.deleted.invoices, 9);
  assert.equal(cleanupResult.deleted.payment_receipts, 5);
  assert.equal(cleanupResult.deleted.cash_ledger_entries, 8);
  assert.equal(cleanupResult.deleted.cash_accounts, 2);
  assert.equal(cleanupResult.deleted.work_items, 6);
  assert.equal(cleanupResult.deleted.assignment_reviewers, 6);
  assert.equal(cleanupResult.deleted.assignments, 6);
  assert.equal(cleanupResult.deleted.recurring_schedules, 9);
  assert.equal(cleanupResult.deleted.service_catalog, 6);
  assert.equal(cleanupResult.deleted.clients, 6);
  assert.equal(cleanupResult.deleted.staff_reporting_lines, 4);
  assert.equal(cleanupResult.deleted.user_roles, 5);

  // 8. Assert all 15 demo business tables now have 0 demo rows; real client & invoice remain intact
  const { count: demoClientsCount } = await adminClient
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('is_demo', true);
  assert.equal(demoClientsCount, 0, 'Zero demo clients should remain');

  const { count: realClientsCount } = await adminClient
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('id', realClient.id);
  assert.equal(realClientsCount, 1, 'Real client must remain intact');

  const { count: demoInvoicesCount } = await adminClient
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('is_demo', true);
  assert.equal(demoInvoicesCount, 0, 'Zero demo invoices should remain');

  const { count: realInvoicesCount } = await adminClient
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('id', realInvoice.id);
  assert.equal(realInvoicesCount, 1, 'Real invoice must remain intact');

  // 9. Permanent non-demo cleanup audit entry exists
  const { data: auditRecords, error: auditErr } = await adminClient
    .from('audit_log')
    .select('*')
    .eq('record_pk', 'demo_dataset');
  assert.equal(auditErr, null);
  assert.equal(auditRecords.length, 1, 'Permanent demo cleanup audit entry must exist');
  assert.equal(auditRecords[0].actor_role, 'founder', 'Cleanup audit actor role must be founder');
  assert.equal(auditRecords[0].is_demo, false, 'Cleanup audit entry must be is_demo = false');
  assert.equal(auditRecords[0].operation, 'DELETE');

  // 10. Delete demo users via GoTrue admin API
  for (const demoUser of cleanupResult.demo_auth_users) {
    if (demoUser.email === 'demo.founder@sn-demo.local') {
      // The demo founder is referenced by realClient and realInvoice (created_by ON DELETE RESTRICT).
      // Verify that deleting the creator is correctly rejected by PostgreSQL FK constraint 23503:
      const { error: founderDelErr } = await adminClient.auth.admin.deleteUser(demoUser.id);
      assert.ok(founderDelErr, 'Deleting demo founder must fail while referenced by real business records');
      assert.match(
        founderDelErr.message,
        /Database error deleting user|violates foreign key constraint/i,
        'Postgres must enforce ON DELETE RESTRICT on clients_created_by_fkey',
      );
    } else {
      // All other demo staff users have zero references remaining; cascade deletes cleanly:
      const { error: userDelErr } = await adminClient.auth.admin.deleteUser(demoUser.id);
      assert.equal(userDelErr, null, `Failed to delete demo user ${demoUser.email}: ${userDelErr?.message}`);
    }
  }

  // All 4 demo staff profiles are deleted; only demo founder profile remains to satisfy real record FK
  const { data: remainingDemoProfiles, error: profErr } = await adminClient
    .from('profiles')
    .select('email, is_demo')
    .eq('is_demo', true);
  assert.equal(profErr, null);
  assert.equal(remainingDemoProfiles.length, 1, 'Only demo founder profile should remain to protect real client FK');
  assert.equal(remainingDemoProfiles[0].email, 'demo.founder@sn-demo.local');
});
