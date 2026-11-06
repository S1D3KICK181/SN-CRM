import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { CrmApplication } from './application';
import { createDemoSeed, DEMO_ACTOR_IDS } from './demo-seed';
import { createApiServer, resolveAllowedOrigins, resolveAuthConfig } from './http';
import { InMemoryCrmRepository } from './in-memory-repository';

const runningServers: Server[] = [];

const CANONICAL_ASSIGNMENT_1 = '30000000-0000-4000-a000-000000000001';
const CANONICAL_CLIENT_1 = '10000000-0000-4000-a000-000000000001';

async function startServer(options?: { allowDevActorHeader?: boolean }): Promise<string> {
  let id = 0;
  const application = new CrmApplication(new InMemoryCrmRepository(createDemoSeed()), {
    now: () => new Date('2026-10-30T12:00:00.000Z'),
    createId: (prefix = 'entity') => `00000000-0000-4000-e000-${String(++id).padStart(12, '0')}`,
  });
  const server = createApiServer(application, {
    logger: { error: () => undefined },
    createRequestId: () => 'req-generated',
    ...(options?.allowDevActorHeader !== undefined
      ? { allowDevActorHeader: options.allowDevActorHeader }
      : { allowDevActorHeader: true }),
  });
  runningServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    runningServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe('HTTP API', () => {
  it('returns a request id in both headers and the success envelope', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': 'req-client-42' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-client-42');
    expect(body).toMatchObject({ data: { status: 'ok' }, requestId: 'req-client-42' });
  });

  it('requires an explicit demo identity for protected endpoints', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/v1/assignments`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: 'demo_session_required',
        message: 'Choose a demo user and send its id in the x-demo-user-id header.',
      },
      requestId: 'req-generated',
    });
  });

  it('creates a Personal Task for the selected user, never a client-supplied assignee', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/v1/work-items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
      },
      body: JSON.stringify({
        kind: 'personal',
        title: 'Call client about missing bank statement',
        relatedPartyName: 'Kapoor & Sons',
        dueAt: '2026-11-02T06:30:00.000Z',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      kind: 'personal',
      assigneeId: DEMO_ACTOR_IDS.trainee,
      createdById: DEMO_ACTOR_IDS.trainee,
    });
  });

  it('returns structured validation failures', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/v1/office-accounts/entries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-demo-user-id': DEMO_ACTOR_IDS.manager,
      },
      body: JSON.stringify({ amountPaise: -50 }),
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.length).toBeGreaterThan(1);
  });

  it('denies browser origins outside the local allow-list', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`, { headers: { origin: 'https://untrusted.example' } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(body.error.code).toBe('cors_origin_denied');
  });

  it('allows the configured local preview origin to complete a browser preflight', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/v1/assignments`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:4321',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-demo-user-id',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:4321');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-demo-user-id');
  });

  describe('Fail-Closed Development Auth Gate', () => {
    it('throws a fatal configuration error when NODE_ENV=production and ALLOW_DEV_ACTOR_HEADER=true', () => {
      expect(() =>
        resolveAuthConfig({
          NODE_ENV: 'production',
          ALLOW_DEV_ACTOR_HEADER: 'true',
        }),
      ).toThrowError(/FATAL CONFIGURATION ERROR: ALLOW_DEV_ACTOR_HEADER cannot be enabled when NODE_ENV is production\./);
    });

    it('treats NODE_ENV case-insensitively and trims whitespace when rejecting dev auth in production', () => {
      for (const nodeEnv of ['Production', 'PRODUCTION', '  production  ', '  Production \t']) {
        expect(() =>
          resolveAuthConfig({
            NODE_ENV: nodeEnv,
            ALLOW_DEV_ACTOR_HEADER: 'true',
          }),
        ).toThrowError(
          /FATAL CONFIGURATION ERROR: ALLOW_DEV_ACTOR_HEADER cannot be enabled when NODE_ENV is production\./,
        );
      }
    });

    it('fails closed when ALLOW_DEV_ACTOR_HEADER is absent or false regardless of NODE_ENV', () => {
      expect(resolveAuthConfig({})).toEqual({ allowDevActorHeader: false });
      expect(resolveAuthConfig({ NODE_ENV: 'production' })).toEqual({ allowDevActorHeader: false });
      expect(resolveAuthConfig({ ALLOW_DEV_ACTOR_HEADER: 'false' })).toEqual({ allowDevActorHeader: false });
      expect(resolveAuthConfig({ ALLOW_DEV_ACTOR_HEADER: 'some_other_value' })).toEqual({ allowDevActorHeader: false });
    });

    it('enables dev auth only when ALLOW_DEV_ACTOR_HEADER is explicitly true and NODE_ENV is not production', () => {
      expect(resolveAuthConfig({ ALLOW_DEV_ACTOR_HEADER: 'true' })).toEqual({ allowDevActorHeader: true });
      expect(resolveAuthConfig({ NODE_ENV: 'development', ALLOW_DEV_ACTOR_HEADER: 'true' })).toEqual({
        allowDevActorHeader: true,
      });
      expect(resolveAuthConfig({ NODE_ENV: 'test', ALLOW_DEV_ACTOR_HEADER: 'true' })).toEqual({
        allowDevActorHeader: true,
      });
    });

    it('rejects demo actor discovery and protected requests with 401 dev_auth_disabled when disabled', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: false });

      // Demo actor discovery rejected without exposing persona data
      const actorsRes = await fetch(`${baseUrl}/api/v1/demo/actors`);
      expect(actorsRes.status).toBe(401);
      const actorsBody = await actorsRes.json();
      expect(actorsBody).toMatchObject({
        error: { code: 'dev_auth_disabled' },
      });

      // Protected endpoint with header rejected
      const protectedRes = await fetch(`${baseUrl}/api/v1/assignments`, {
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder },
      });
      expect(protectedRes.status).toBe(401);
      const protectedBody = await protectedRes.json();
      expect(protectedBody).toMatchObject({
        error: { code: 'dev_auth_disabled' },
      });

      // Health still succeeds
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);

      // Preflight still succeeds
      const preflightRes = await fetch(`${baseUrl}/api/v1/assignments`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://127.0.0.1:4321',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-demo-user-id',
        },
      });
      expect(preflightRes.status).toBe(204);
    });

    it('defaults createApiServer to allowDevActorHeader: false when options are omitted', async () => {
      const application = new CrmApplication(new InMemoryCrmRepository(createDemoSeed()), {
        now: () => new Date('2026-10-30T12:00:00.000Z'),
        createId: (prefix) => `${prefix}_default_test`,
      });
      // createApiServer with no options -> default/omitted must be false
      const server = createApiServer(application);
      runningServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const res = await fetch(`${baseUrl}/api/v1/assignments`, {
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: 'dev_auth_disabled' },
      });
    });
  });

  describe('HTTP Terminal Lifecycle & Reminders', () => {
    it('returns 409 when attempting to reopen a completed Assignment via HTTP', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      // CANONICAL_ASSIGNMENT_1: submit as manager -> complete as founder
      await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({ action: 'submit' }),
      });

      await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'complete' }),
      });

      // Try to reopen completed assignment
      const reopenRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'reopen' }),
      });

      expect(reopenRes.status).toBe(409);
      const body = await reopenRes.json();
      expect(body).toMatchObject({
        error: {
          code: 'invalid_state_transition',
          message: 'An approved Assignment is a terminal immutable audit artifact and cannot be reopened.',
        },
      });
    });

    it('returns 200 and changes_requested when reopening a submitted Assignment prior to approval (Request changes)', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      // CANONICAL_ASSIGNMENT_1 starts in_progress -> submit
      await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({ action: 'submit' }),
      });

      // Reopen prior to approval
      const reopenRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'reopen' }),
      });

      expect(reopenRes.status).toBe(200);
      const body = await reopenRes.json();
      expect(body.data).toMatchObject({
        id: CANONICAL_ASSIGNMENT_1,
        status: 'changes_requested',
      });
    });

    it('returns 409 when attempting to reopen a completed Work Item via HTTP', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      // Create a delegated work item
      const createRes = await fetch(`${baseUrl}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.senior,
        },
        body: JSON.stringify({
          kind: 'delegated',
          title: 'Verify GSTR-3B tax payment',
          assignmentId: CANONICAL_ASSIGNMENT_1,
          assigneeId: DEMO_ACTOR_IDS.trainee,
          dueAt: '2026-11-02T12:00:00.000Z',
        }),
      });
      const { data: created } = await createRes.json();

      // Submit as trainee
      await fetch(`${baseUrl}/api/v1/work-items/${created.id}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
        },
        body: JSON.stringify({ action: 'submit' }),
      });

      // Complete as senior
      await fetch(`${baseUrl}/api/v1/work-items/${created.id}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.senior,
        },
        body: JSON.stringify({ action: 'complete' }),
      });

      // Reopen as senior -> 409
      const reopenRes = await fetch(`${baseUrl}/api/v1/work-items/${created.id}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.senior,
        },
        body: JSON.stringify({ action: 'reopen' }),
      });

      expect(reopenRes.status).toBe(409);
      const body = await reopenRes.json();
      expect(body).toMatchObject({
        error: {
          code: 'invalid_state_transition',
          message: 'A completed Work Item is a terminal immutable audit artifact and cannot be reopened.',
        },
      });
    });

    it('returns 200 and changes_requested when reopening a submitted Work Item prior to approval (Request changes)', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      const createRes = await fetch(`${baseUrl}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.senior,
        },
        body: JSON.stringify({
          kind: 'delegated',
          title: 'Recheck ledger postings',
          assignmentId: CANONICAL_ASSIGNMENT_1,
          assigneeId: DEMO_ACTOR_IDS.trainee,
          dueAt: '2026-11-02T12:00:00.000Z',
        }),
      });
      const { data: created } = await createRes.json();

      // Submit as trainee
      await fetch(`${baseUrl}/api/v1/work-items/${created.id}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
        },
        body: JSON.stringify({ action: 'submit' }),
      });

      // Reopen (Request changes) as senior
      const reopenRes = await fetch(`${baseUrl}/api/v1/work-items/${created.id}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.senior,
        },
        body: JSON.stringify({ action: 'reopen' }),
      });

      expect(reopenRes.status).toBe(200);
      const body = await reopenRes.json();
      expect(body.data).toMatchObject({
        id: created.id,
        status: 'changes_requested',
      });
    });

    it('rejects non-UUID route parameters with 422 invalid_identifier', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      const res = await fetch(`${baseUrl}/api/v1/assignments/not-a-uuid/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'start' }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: 'invalid_identifier' },
      });
    });

    it('returns 422 reminder_after_due_time when creating a work item with reminderAt > dueAt via HTTP', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      const res = await fetch(`${baseUrl}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({
          kind: 'internal',
          title: 'Prepare audit folder',
          assigneeId: DEMO_ACTOR_IDS.staff,
          dueAt: '2026-11-05T10:00:00.000Z',
          reminderAt: '2026-11-05T10:30:00.000Z',
        }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: 'reminder_after_due_time' },
      });
    });

    it('accepts explicit null for reminderAt when creating a work item via HTTP and persists as null', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      const res = await fetch(`${baseUrl}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
        },
        body: JSON.stringify({
          kind: 'personal',
          title: 'Call vendor for invoice',
          dueAt: '2026-11-02T12:00:00.000Z',
          reminderAt: null,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toMatchObject({
        kind: 'personal',
        reminderAt: null,
      });
    });

    it('rejects empty string reminderAt with 422 validation_failed via HTTP', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      const res = await fetch(`${baseUrl}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
        },
        body: JSON.stringify({
          kind: 'personal',
          title: 'Call vendor for invoice',
          dueAt: '2026-11-02T12:00:00.000Z',
          reminderAt: '',
        }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: 'validation_failed' },
      });
    });

    it('rejects impossible calendar date for dueAt with 422 validation_failed via HTTP', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });

      const res = await fetch(`${baseUrl}/api/v1/work-items`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
        },
        body: JSON.stringify({
          kind: 'personal',
          title: 'Call vendor for invoice',
          dueAt: '2026-02-31T12:00:00.000Z',
        }),
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: 'validation_failed' },
      });
    });

    it('rejects invalid timezone offsets (+25:00, +05:99, +99:99) for dueAt and reminderAt with 422 validation_failed via HTTP', async () => {
      const baseUrl = await startServer({ allowDevActorHeader: true });
      const invalidOffsets = [
        '2026-11-02T12:30:00+25:00',
        '2026-11-02T12:30:00+05:99',
        '2026-11-02T12:30:00+99:99',
      ];

      for (const offset of invalidOffsets) {
        // Test as dueAt
        const dueRes = await fetch(`${baseUrl}/api/v1/work-items`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
          },
          body: JSON.stringify({
            kind: 'personal',
            title: 'Call vendor for invoice',
            dueAt: offset,
          }),
        });
        expect(dueRes.status).toBe(422);
        const dueBody = await dueRes.json();
        expect(dueBody).toMatchObject({
          error: { code: 'validation_failed' },
        });

        // Test as reminderAt
        const reminderRes = await fetch(`${baseUrl}/api/v1/work-items`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
          },
          body: JSON.stringify({
            kind: 'personal',
            title: 'Call vendor for invoice',
            dueAt: '2026-11-02T12:00:00.000Z',
            reminderAt: offset,
          }),
        });
        expect(reminderRes.status).toBe(422);
        const reminderBody = await reminderRes.json();
        expect(reminderBody).toMatchObject({
          error: { code: 'validation_failed' },
        });
      }
    });

    it('includes authorization in CORS allow-headers on OPTIONS preflight', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/session`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      });

      expect(res.status).toBe(204);
      const allowHeaders = res.headers.get('access-control-allow-headers');
      expect(allowHeaders).toContain('authorization');
    });

    it('authenticates via Bearer token when allowDevActorHeader is false', async () => {
      const jwtSecret = 'test-secret-at-least-32-characters-long';
      let id = 0;
      const application = new CrmApplication(new InMemoryCrmRepository(createDemoSeed()), {
        now: () => new Date('2026-10-30T12:00:00.000Z'),
        createId: () => `00000000-0000-4000-e000-${String(++id).padStart(12, '0')}`,
      });
      const server = createApiServer(application, {
        logger: { error: () => undefined },
        allowDevActorHeader: false,
        jwtSecret,
      });
      runningServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const secret = new TextEncoder().encode(jwtSecret);
      const token = await new SignJWT({ aud: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(DEMO_ACTOR_IDS.founder)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      const res = await fetch(`${baseUrl}/api/v1/session`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toMatchObject({
        id: DEMO_ACTOR_IDS.founder,
        role: 'founder',
      });
    });

    it('validates production HTTPS origins and fails closed on invalid/missing origins', () => {
      // Valid production origins
      const valid = resolveAllowedOrigins({
        NODE_ENV: 'production',
        CORS_ALLOWED_ORIGINS: 'https://app.sn-practice.com, https://admin.sn-practice.com',
      });
      expect(valid).toEqual(['https://app.sn-practice.com', 'https://admin.sn-practice.com']);

      // Fails closed if missing in production
      expect(() =>
        resolveAllowedOrigins({
          NODE_ENV: 'production',
          CORS_ALLOWED_ORIGINS: '',
        }),
      ).toThrow('CORS_ALLOWED_ORIGINS must be set');

      // Fails closed if non-HTTPS in production
      expect(() =>
        resolveAllowedOrigins({
          NODE_ENV: 'production',
          CORS_ALLOWED_ORIGINS: 'http://insecure.example.com',
        }),
      ).toThrow('Production CORS origin must use https:');
    });

    it('TC-CORS-01: includes Vite dev 4310 and preview 4311 in default local allowed origins', () => {
      const origins = resolveAllowedOrigins({});
      expect(origins).toContain('http://localhost:4310');
      expect(origins).toContain('http://127.0.0.1:4310');
      expect(origins).toContain('http://localhost:4311');
      expect(origins).toContain('http://127.0.0.1:4311');
    });
  });

  describe('Client Read HTTP Endpoints (CL-03)', () => {
    it('requires authentication on GET /api/v1/clients and /api/v1/clients/:id', async () => {
      const baseUrl = await startServer();

      // Missing auth header on collection
      const listRes = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { 'x-request-id': 'req-unauth-list' },
      });
      expect(listRes.status).toBe(401);
      expect(listRes.headers.get('x-request-id')).toBe('req-unauth-list');
      const listBody = await listRes.json();
      expect(listBody).toEqual({
        error: {
          code: 'demo_session_required',
          message: 'Choose a demo user and send its id in the x-demo-user-id header.',
        },
        requestId: 'req-unauth-list',
      });

      // Missing auth header on single item
      const itemRes = await fetch(`${baseUrl}/api/v1/clients/${CANONICAL_CLIENT_1}`, {
        headers: { 'x-request-id': 'req-unauth-item' },
      });
      expect(itemRes.status).toBe(401);
      expect(itemRes.headers.get('x-request-id')).toBe('req-unauth-item');
      const itemBody = await itemRes.json();
      expect(itemBody).toEqual({
        error: {
          code: 'demo_session_required',
          message: 'Choose a demo user and send its id in the x-demo-user-id header.',
        },
        requestId: 'req-unauth-item',
      });

      // Invalid / unknown demo user header
      const invalidUserRes = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { 'x-demo-user-id': 'unknown-user', 'x-request-id': 'req-invalid-user' },
      });
      expect(invalidUserRes.status).toBe(401);
      const invalidUserBody = await invalidUserRes.json();
      expect(invalidUserBody.error.code).toBe('invalid_demo_session');
      expect(invalidUserBody.requestId).toBe('req-invalid-user');
    });

    it('returns 422 invalid_identifier for non-UUID route parameters', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients/not-a-valid-uuid`, {
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'x-request-id': 'req-invalid-uuid',
        },
      });
      expect(res.status).toBe(422);
      expect(res.headers.get('x-request-id')).toBe('req-invalid-uuid');
      const body = await res.json();
      expect(body).toEqual({
        error: {
          code: 'invalid_identifier',
          message: 'The route parameter must be a valid RFC 4122 UUID.',
        },
        requestId: 'req-invalid-uuid',
      });
    });

    it('returns 422 invalid_identifier for malformed URI percent-escape route parameters', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients/%FF`, {
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'x-request-id': 'req-malformed-escape',
        },
      });
      expect(res.status).toBe(422);
      expect(res.headers.get('x-request-id')).toBe('req-malformed-escape');
      const body = await res.json();
      expect(body).toEqual({
        error: {
          code: 'invalid_identifier',
          message: 'The route parameter must be a valid RFC 4122 UUID.',
        },
        requestId: 'req-malformed-escape',
      });
    });

    it('returns caller-visible clients list for founder (6), staff (2), and trainee (1)', async () => {
      const baseUrl = await startServer();

      // Founder sees all 6 clients
      const founderRes = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'x-request-id': 'req-founder-clients',
        },
      });
      expect(founderRes.status).toBe(200);
      expect(founderRes.headers.get('x-request-id')).toBe('req-founder-clients');
      const founderBody = await founderRes.json();
      expect(founderBody.requestId).toBe('req-founder-clients');
      expect(founderBody.data.length).toBe(6);
      expect(founderBody.data[0]).toMatchObject({
        id: CANONICAL_CLIENT_1,
        code: 'CL-001001',
        displayName: 'Aster Foods',
        gstinMasked: '27**********1Z5',
        panMasked: '******1234',
        status: 'active',
      });
      expect(founderBody.data[0]).not.toHaveProperty('pan');
      expect(founderBody.data[0]).not.toHaveProperty('gstin');

      const ALL_DEMO_RAW_PANS = [
        'AABCA1234A',
        'AABCB2345B',
        'AABCS3456C',
        'AABCK4567D',
        'AABCN5678E',
        'AABCA6789F',
      ] as const;
      const ALL_DEMO_RAW_GSTINS = [
        '27AABCA1234A1Z5',
        '27AABCB2345B1Z4',
        '27AABCS3456C1Z3',
        '27AABCK4567D1Z2',
        '27AABCN5678E1Z1',
        '27AABCA6789F1Z0',
      ] as const;

      const serializedFounderBody = JSON.stringify(founderBody);
      for (const rawPan of ALL_DEMO_RAW_PANS) {
        expect(serializedFounderBody).not.toContain(rawPan);
      }
      for (const rawGstin of ALL_DEMO_RAW_GSTINS) {
        expect(serializedFounderBody).not.toContain(rawGstin);
      }
      expect(serializedFounderBody).not.toContain('"pan":');
      expect(serializedFounderBody).not.toContain('"gstin":');

      // Staff sees 2 clients
      const staffRes = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.staff },
      });
      expect(staffRes.status).toBe(200);
      const staffBody = await staffRes.json();
      expect(staffBody.data.map((c: any) => c.code)).toEqual(['CL-001002', 'CL-001004']);

      // Trainee sees 1 client (Aster Foods)
      const traineeRes = await fetch(`${baseUrl}/api/v1/clients`, {
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.trainee },
      });
      expect(traineeRes.status).toBe(200);
      const traineeBody = await traineeRes.json();
      expect(traineeBody.data.map((c: any) => c.code)).toEqual(['CL-001001']);
    });

    it('returns visible client detail with 200 and expected DTO envelope', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients/${CANONICAL_CLIENT_1}`, {
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'x-request-id': 'req-detail-aster',
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toBe('req-detail-aster');
      const body = await res.json();
      expect(body.requestId).toBe('req-detail-aster');
      expect(body.data).toMatchObject({
        id: CANONICAL_CLIENT_1,
        code: 'CL-001001',
        displayName: 'Aster Foods',
        legalName: 'Aster Foods Private Limited',
        gstinMasked: '27**********1Z5',
        panMasked: '******1234',
        status: 'active',
        activeAssignmentsCount: 1,
      });
      expect(body.data).not.toHaveProperty('pan');
      expect(body.data).not.toHaveProperty('gstin');
      const serializedDetail = JSON.stringify(body);
      expect(serializedDetail).not.toContain('AABCA1234A');
      expect(serializedDetail).not.toContain('27AABCA1234A1Z5');
      expect(serializedDetail).not.toContain('"pan":');
      expect(serializedDetail).not.toContain('"gstin":');
    });

    it('ensures hidden and nonexistent clients are externally indistinguishable (identical 404 shape)', async () => {
      const baseUrl = await startServer();
      const absentId = '10000000-0000-4000-a000-999999999999';
      const hiddenId = '10000000-0000-4000-a000-000000000002'; // BluePeak Tech (hidden for trainee)

      // Trainee requests absent client
      const absentRes = await fetch(`${baseUrl}/api/v1/clients/${absentId}`, {
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
          'x-request-id': 'req-absent-client',
        },
      });
      expect(absentRes.status).toBe(404);
      expect(absentRes.headers.get('x-request-id')).toBe('req-absent-client');
      const absentBody = await absentRes.json();

      // Trainee requests hidden client
      const hiddenRes = await fetch(`${baseUrl}/api/v1/clients/${hiddenId}`, {
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.trainee,
          'x-request-id': 'req-hidden-client',
        },
      });
      expect(hiddenRes.status).toBe(404);
      expect(hiddenRes.headers.get('x-request-id')).toBe('req-hidden-client');
      const hiddenBody = await hiddenRes.json();

      // Both must have identical error code, message, and shape (never revealing existence)
      expect(absentBody.error).toEqual({
        code: 'not_found',
        message: 'Client was not found.',
      });
      expect(hiddenBody.error).toEqual({
        code: 'not_found',
        message: 'Client was not found.',
      });
      expect(hiddenBody.error).toEqual(absentBody.error);
    });
  });
});
