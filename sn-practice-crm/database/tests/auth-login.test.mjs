import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const PERSONAS = [
  { role: 'founder', email: 'demo.founder@sn-demo.local', expectedId: '00000000-0000-4000-a000-000000000001' },
  { role: 'manager', email: 'demo.manager@sn-demo.local', expectedId: '00000000-0000-4000-a000-000000000002' },
  { role: 'senior', email: 'demo.senior@sn-demo.local', expectedId: '00000000-0000-4000-a000-000000000003' },
  { role: 'staff', email: 'demo.staff@sn-demo.local', expectedId: '00000000-0000-4000-a000-000000000004' },
  { role: 'trainee', email: 'demo.trainee@sn-demo.local', expectedId: '00000000-0000-4000-a000-000000000005' },
];

const PASSWORD = 'Demo@1234';

for (const persona of PERSONAS) {
  test(`GoTrue authentication: ${persona.role} (${persona.email})`, async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: persona.email,
      password: PASSWORD,
    });

    assert.equal(error, null, `Sign-in failed for ${persona.email}: ${error?.message}`);
    assert.ok(data.session, `Missing session for ${persona.email}`);
    assert.ok(data.session.access_token, `Missing access_token for ${persona.email}`);
    assert.equal(data.user.id, persona.expectedId, `User ID mismatch for ${persona.email}`);
    assert.equal(data.user.email, persona.email, `User email mismatch for ${persona.email}`);
  });
}
