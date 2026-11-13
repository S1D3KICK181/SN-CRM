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
const CANONICAL_SERVICE_1 = '50000000-0000-4000-a000-000000000001';

async function getAssignmentUpdatedAt(baseUrl: string, assignmentId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/assignments`, {
    headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder },
  });
  const data = (await res.json()).data;
  const match = data.find((a: any) => a.id === assignmentId);
  return match?.updatedAt ?? '2026-10-29T09:15:00.000Z';
}

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
    expect(response.headers.get('access-control-allow-headers')).toContain('idempotency-key');
  });

  it('distinguishes missing, blank, and oversized Idempotency-Key headers', async () => {
    const baseUrl = await startServer();
    const endpoint = `${baseUrl}/api/v1/engagements`;
    const body = JSON.stringify({});
    const common = { 'content-type': 'application/json', 'x-demo-user-id': DEMO_ACTOR_IDS.founder };

    const missing = await fetch(endpoint, { method: 'POST', headers: common, body });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe('idempotency_key_required');

    const blank = await fetch(endpoint, {
      method: 'POST', headers: { ...common, 'Idempotency-Key': '   ' }, body,
    });
    expect(blank.status).toBe(422);
    expect((await blank.json()).error.code).toBe('invalid_idempotency_key');

    const oversized = await fetch(endpoint, {
      method: 'POST', headers: { ...common, 'Idempotency-Key': 'x'.repeat(256) }, body,
    });
    expect(oversized.status).toBe(422);
    expect((await oversized.json()).error.code).toBe('invalid_idempotency_key');

    const list = await fetch(`${baseUrl}/api/v1/engagements`, {
      headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder },
    });
    expect(list.status).toBe(200);
    expect((await list.json()).data).toEqual([]);
  });

  describe('BIL-01a billing read routes', () => {
    it('returns invoices and payment receipts in the DTO shape for a founder', async () => {
      const baseUrl = await startServer();
      const headers = { 'x-demo-user-id': DEMO_ACTOR_IDS.founder };

      const invoices = await fetch(`${baseUrl}/api/v1/invoices`, { headers });
      expect(invoices.status).toBe(200);
      const invoiceBody = await invoices.json();
      expect(invoiceBody.data).toHaveLength(4);
      expect(invoiceBody.data[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          code: expect.stringMatching(/^INV-/),
          clientCode: expect.stringMatching(/^CL-/),
          clientName: expect.any(String),
          currency: 'INR',
          totalPaise: expect.any(Number),
          balancePaise: expect.any(Number),
          daysOverdue: expect.any(Number),
          items: expect.any(Array),
          payments: expect.any(Array),
        }),
      );

      const receipts = await fetch(`${baseUrl}/api/v1/payment-receipts`, { headers });
      expect(receipts.status).toBe(200);
      const receiptBody = await receipts.json();
      expect(receiptBody.data).toHaveLength(2);
      expect(receiptBody.data[0]).toEqual(
        expect.objectContaining({
          code: expect.stringMatching(/^RCT-/),
          method: expect.any(String),
          amountPaise: expect.any(Number),
          unallocatedPaise: expect.any(Number),
          allocations: expect.any(Array),
        }),
      );
    });

    it('returns 403 for staff on both routes', async () => {
      const baseUrl = await startServer();
      const headers = { 'x-demo-user-id': DEMO_ACTOR_IDS.staff };
      for (const path of ['/api/v1/invoices', '/api/v1/payment-receipts']) {
        const response = await fetch(`${baseUrl}${path}`, { headers });
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe('role_not_permitted');
      }
    });
  });

  describe('ENG-01 authenticated engagement HTTP lifecycle', () => {
    const engagementTerms = (title = 'Annual compliance engagement') => ({
      title,
      scope: 'Annual compliance filings',
      responsiblePartnerId: DEMO_ACTOR_IDS.founder,
      deliveryManagerId: DEMO_ACTOR_IDS.manager,
      feeModel: 'fixed',
      agreedFeePaise: 100000,
      billingTerms: 'Due on completion',
      startDate: '2026-11-01',
      endDate: '2027-03-31',
    });
    const draftBody = (title = 'Annual compliance engagement') => ({
      clientId: CANONICAL_CLIENT_1,
      serviceId: CANONICAL_SERVICE_1,
      ...engagementTerms(title),
    });

    const headers = (actorId: string, key?: string) => ({
      'content-type': 'application/json',
      'x-demo-user-id': actorId,
      ...(key ? { 'Idempotency-Key': key } : {}),
    });

    async function prepareActive(baseUrl: string) {
      const create = await fetch(`${baseUrl}/api/v1/engagements`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.manager, 'prepare-create'), body: JSON.stringify(draftBody()),
      });
      const created = (await create.json()).data;
      const versions = await fetch(`${baseUrl}/api/v1/engagements/${created.id}/versions`, {
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder },
      });
      const versionId = (await versions.json()).data[0].id;
      const activateVersion = async (expectedUpdatedAt: string) => {
        return fetch(`${baseUrl}/api/v1/engagements/${created.id}/activate`, {
          method: 'POST', headers: headers(DEMO_ACTOR_IDS.founder, 'prepare-activate'),
          body: JSON.stringify({ versionId, expectedUpdatedAt }),
        });
      };
      const active = await activateVersion(created.updatedAt);
      return { id: created.id, active: (await active.json()).data, versionId };
    }

    describe('ENG-02a assignment engagement link', () => {
      const assignmentBody = (extra: Record<string, unknown> = {}) => ({
        clientId: CANONICAL_CLIENT_1,
        serviceId: CANONICAL_SERVICE_1,
        title: 'Linked return',
        ownerId: DEMO_ACTOR_IDS.staff,
        dueAt: '2026-12-01T12:30:00.000Z',
        ...extra,
      });
      const postAssignment = (baseUrl: string, body: Record<string, unknown>) =>
        fetch(`${baseUrl}/api/v1/assignments`, {
          method: 'POST', headers: headers(DEMO_ACTOR_IDS.manager), body: JSON.stringify(body),
        });

      it('accepts engagementId and returns engagementId and engagementCode', async () => {
        const baseUrl = await startServer();
        const { id, active } = await prepareActive(baseUrl);
        const res = await postAssignment(baseUrl, assignmentBody({ engagementId: id }));
        expect(res.status).toBe(201);
        expect((await res.json()).data).toMatchObject({ engagementId: id, engagementCode: active.code });
      });

      it('returns null link fields when engagementId is omitted or null', async () => {
        const baseUrl = await startServer();
        for (const extra of [{}, { engagementId: null }]) {
          const res = await postAssignment(baseUrl, assignmentBody(extra));
          expect(res.status).toBe(201);
          expect((await res.json()).data).toMatchObject({ engagementId: null, engagementCode: null });
        }
      });

      it('rejects a non-UUID engagementId with 422 validation_failed', async () => {
        const baseUrl = await startServer();
        const res = await postAssignment(baseUrl, assignmentBody({ engagementId: 'not-a-uuid' }));
        expect(res.status).toBe(422);
        expect((await res.json()).error.code).toBe('validation_failed');
      });

      it('rejects an unknown engagement with 422 referenced_entity_not_found', async () => {
        const baseUrl = await startServer();
        const res = await postAssignment(baseUrl, assignmentBody({ engagementId: '00000000-0000-4000-e000-999999999999' }));
        expect(res.status).toBe(422);
        expect((await res.json()).error.code).toBe('referenced_entity_not_found');
      });
    });

    describe('ENG-02c schedule engagement link', () => {
      const scheduleBody = (extra: Record<string, unknown> = {}) => ({
        clientId: CANONICAL_CLIENT_1,
        serviceId: CANONICAL_SERVICE_1,
        title: 'Linked schedule',
        cadence: 'monthly',
        ownerId: DEMO_ACTOR_IDS.senior,
        nextOccurrenceOn: '2026-10-31',
        dueDay: 11,
        ...extra,
      });
      const postSchedule = (baseUrl: string, body: Record<string, unknown>) =>
        fetch(`${baseUrl}/api/v1/recurring-schedules`, {
          method: 'POST', headers: headers(DEMO_ACTOR_IDS.founder), body: JSON.stringify(body),
        });

      it('accepts engagementId and returns engagementId and engagementCode', async () => {
        const baseUrl = await startServer();
        const { id, active } = await prepareActive(baseUrl);
        const res = await postSchedule(baseUrl, scheduleBody({ engagementId: id }));
        expect(res.status).toBe(201);
        expect((await res.json()).data).toMatchObject({ engagementId: id, engagementCode: active.code });
      });

      it('returns null link fields when engagementId is omitted or null', async () => {
        const baseUrl = await startServer();
        for (const extra of [{}, { engagementId: null }]) {
          const res = await postSchedule(baseUrl, scheduleBody(extra));
          expect(res.status).toBe(201);
          expect((await res.json()).data).toMatchObject({ engagementId: null, engagementCode: null });
        }
      });

      it('rejects a non-UUID engagementId with 422 validation_failed', async () => {
        const baseUrl = await startServer();
        const res = await postSchedule(baseUrl, scheduleBody({ engagementId: 'not-a-uuid' }));
        expect(res.status).toBe(422);
        expect((await res.json()).error.code).toBe('validation_failed');
      });

      it('rejects an unknown engagement with 422 referenced_entity_not_found', async () => {
        const baseUrl = await startServer();
        const res = await postSchedule(baseUrl, scheduleBody({ engagementId: '00000000-0000-4000-e000-999999999999' }));
        expect(res.status).toBe(422);
        expect((await res.json()).error.code).toBe('referenced_entity_not_found');
      });
    });

    it('completes the authenticated eight-route lifecycle with route-bound identities', async () => {
      const baseUrl = await startServer();
      const list = await fetch(`${baseUrl}/api/v1/engagements`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.manager } });
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({ data: expect.any(Array), requestId: 'req-generated' });

      const create = await fetch(`${baseUrl}/api/v1/engagements`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.manager, 'lifecycle-create'), body: JSON.stringify(draftBody()),
      });
      expect(create.status).toBe(201);
      const createdBody = await create.json();
      expect(createdBody).toMatchObject({ data: { status: 'draft' }, requestId: 'req-generated' });
      const id = createdBody.data.id;

      const detail = await fetch(`${baseUrl}/api/v1/engagements/${id}`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.manager } });
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ data: { id, status: 'draft' }, requestId: 'req-generated' });
      const versions = await fetch(`${baseUrl}/api/v1/engagements/${id}/versions`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.manager } });
      expect(versions.status).toBe(200);
      const versionsBody = await versions.json();
      expect(versionsBody).toMatchObject({ data: [expect.objectContaining({ engagementId: id, versionNumber: 1, title: 'Annual compliance engagement' })], requestId: 'req-generated' });

      const revised = await fetch(`${baseUrl}/api/v1/engagements/${id}/draft`, {
        method: 'PATCH', headers: headers(DEMO_ACTOR_IDS.manager, 'lifecycle-revise'),
        body: JSON.stringify({ ...engagementTerms('Revised compliance engagement'), expectedUpdatedAt: createdBody.data.updatedAt }),
      });
      expect(revised.status).toBe(200);
      const revisedBody = await revised.json();
      expect(revisedBody).toMatchObject({ data: { id, status: 'draft' }, requestId: 'req-generated' });

      const revisedVersions = (await (await fetch(`${baseUrl}/api/v1/engagements/${id}/versions`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder } })).json()).data;
      expect(revisedVersions[0]).toMatchObject({ versionNumber: 1, title: 'Revised compliance engagement' });
      const latestVersion = revisedVersions.at(-1);
      const activated = await fetch(`${baseUrl}/api/v1/engagements/${id}/activate`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.founder, 'lifecycle-activate'),
        body: JSON.stringify({ versionId: latestVersion.id, expectedUpdatedAt: revisedBody.data.updatedAt }),
      });
      expect(activated.status).toBe(200);
      const activeBody = await activated.json();
      expect(activeBody).toMatchObject({ data: { id, status: 'active' }, requestId: 'req-generated' });

      const amended = await fetch(`${baseUrl}/api/v1/engagements/${id}/amendments`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.founder, 'lifecycle-amend'),
        body: JSON.stringify({ ...engagementTerms('Amended compliance engagement'), expectedUpdatedAt: activeBody.data.updatedAt }),
      });
      expect(amended.status).toBe(200);
      const amendedBody = await amended.json();
      expect(amendedBody).toMatchObject({ data: { id, status: 'active', approvedVersion: { versionNumber: 2 } }, requestId: 'req-generated' });
      const amendedVersions = await (await fetch(`${baseUrl}/api/v1/engagements/${id}/versions`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder } })).json();
      expect(amendedVersions.data.at(-1)).toMatchObject({ versionNumber: 2, engagementId: id });

      const ended = await fetch(`${baseUrl}/api/v1/engagements/${id}/end`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.founder, 'lifecycle-end'),
        body: JSON.stringify({ outcome: 'completed', reason: 'Work completed', expectedUpdatedAt: amendedBody.data.updatedAt }),
      });
      expect(ended.status).toBe(200);
      expect(await ended.json()).toMatchObject({ data: { id, status: 'ended', endOutcome: 'completed', endReason: 'Work completed' }, requestId: 'req-generated' });
    });

    it('denies Manager founder-only mutations without changing the active engagement', async () => {
      const baseUrl = await startServer();
      const { id, active, versionId } = await prepareActive(baseUrl);
      const requests = [
        [`/activate`, { versionId, expectedUpdatedAt: active.updatedAt }],
        [`/amendments`, { ...engagementTerms('Forbidden amendment'), expectedUpdatedAt: active.updatedAt }],
        [`/end`, { outcome: 'completed', reason: 'Forbidden end', expectedUpdatedAt: active.updatedAt }],
      ] as const;
      for (const [path, body] of requests) {
        const response = await fetch(`${baseUrl}/api/v1/engagements/${id}${path}`, {
          method: 'POST', headers: headers(DEMO_ACTOR_IDS.manager, `forbidden-${path}`), body: JSON.stringify(body),
        });
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe('role_not_permitted');
      }
      const detail = await fetch(`${baseUrl}/api/v1/engagements/${id}`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.manager } });
      expect((await detail.json()).data).toMatchObject({ id, status: 'active', updatedAt: active.updatedAt });
    });

    it('rejects invalid route identifiers and mutation bodies without mutating the engagement', async () => {
      const baseUrl = await startServer();
      const invalidRoute = await fetch(`${baseUrl}/api/v1/engagements/not-a-uuid`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.manager } });
      expect(invalidRoute.status).toBe(422);
      expect((await invalidRoute.json()).error.code).toBe('invalid_identifier');

      const create = await fetch(`${baseUrl}/api/v1/engagements`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.manager, 'validation-create'), body: JSON.stringify(draftBody()),
      });
      const created = (await create.json()).data;
      const invalidBodies = [
        { ...draftBody(), engagementId: created.id },
        { ...draftBody(), agreedFeePaise: -1 },
        { ...draftBody(), endDate: '2026-10-31' },
        { ...draftBody(), extraField: true },
      ];
      for (const [index, body] of invalidBodies.entries()) {
        const response = await fetch(`${baseUrl}/api/v1/engagements`, {
          method: 'POST', headers: headers(DEMO_ACTOR_IDS.manager, `invalid-create-${index}`), body: JSON.stringify(body),
        });
        expect(response.status).toBe(422);
        expect((await response.json()).error.code).toBe('validation_failed');
      }
      const invalidPatch = await fetch(`${baseUrl}/api/v1/engagements/${created.id}/draft`, {
        method: 'PATCH', headers: headers(DEMO_ACTOR_IDS.manager, 'invalid-patch-extra'),
        body: JSON.stringify({ ...engagementTerms('Invalid revised engagement'), expectedUpdatedAt: created.updatedAt, extraField: true }),
      });
      expect(invalidPatch.status).toBe(422);
      expect((await invalidPatch.json()).error.code).toBe('validation_failed');
      const invalidEnd = await fetch(`${baseUrl}/api/v1/engagements/${created.id}/end`, {
        method: 'POST', headers: headers(DEMO_ACTOR_IDS.founder, 'invalid-end'),
        body: JSON.stringify({ outcome: 'unknown', reason: 'Invalid outcome', expectedUpdatedAt: created.updatedAt }),
      });
      expect(invalidEnd.status).toBe(422);
      expect((await invalidEnd.json()).error.code).toBe('validation_failed');
      const detail = await fetch(`${baseUrl}/api/v1/engagements/${created.id}`, { headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.manager } });
      expect((await detail.json()).data).toMatchObject({ id: created.id, status: 'draft', updatedAt: created.updatedAt });
    });
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
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);
      const subRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({ action: 'submit', expectedUpdatedAt: u0 }),
      });
      const u1 = (await subRes.json()).data.updatedAt;

      const compRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'complete', expectedUpdatedAt: u1 }),
      });
      const u2 = (await compRes.json()).data.updatedAt;

      // Try to reopen completed assignment
      const reopenRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'reopen', expectedUpdatedAt: u2 }),
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
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);
      const subRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
        },
        body: JSON.stringify({ action: 'submit', expectedUpdatedAt: u0 }),
      });
      const u1 = (await subRes.json()).data.updatedAt;

      // Reopen prior to approval
      const reopenRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
        },
        body: JSON.stringify({ action: 'reopen', expectedUpdatedAt: u1 }),
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

    it('requires authentication for POST /api/v1/clients', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Unauthenticated Client' }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('demo_session_required');
    });

    it('enforces application/json content-type for POST /api/v1/clients', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'text/plain',
        },
        body: 'displayName=Plain+Text',
      });
      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.error.code).toBe('json_content_type_required');
    });

    it('enforces authorization precedence: non-leadership roles receive 403 role_not_permitted before content-type or body parsing', async () => {
      const baseUrl = await startServer();
      const nonLeadershipRoles = [
        { role: 'senior_staff', id: DEMO_ACTOR_IDS.senior },
        { role: 'staff', id: DEMO_ACTOR_IDS.staff },
        { role: 'trainee', id: DEMO_ACTOR_IDS.trainee },
      ];

      for (const { id } of nonLeadershipRoles) {
        // Case 1: Wrong Content-Type (text/plain) -> 403 role_not_permitted, NOT 415
        const wrongCtRes = await fetch(`${baseUrl}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'x-demo-user-id': id,
            'content-type': 'text/plain',
            'x-request-id': 'req-auth-precedence-ct',
          },
          body: 'Not even JSON',
        });
        expect(wrongCtRes.status).toBe(403);
        expect(wrongCtRes.headers.get('x-request-id')).toBe('req-auth-precedence-ct');
        const wrongCtBody = await wrongCtRes.json();
        expect(wrongCtBody.error.code).toBe('role_not_permitted');
        expect(wrongCtBody.requestId).toBe('req-auth-precedence-ct');

        // Case 2: Malformed JSON body -> 403 role_not_permitted, NOT 400
        const malformedRes = await fetch(`${baseUrl}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'x-demo-user-id': id,
            'content-type': 'application/json',
            'x-request-id': 'req-auth-precedence-malformed',
          },
          body: '{"invalidJson": ',
        });
        expect(malformedRes.status).toBe(403);
        const malformedBody = await malformedRes.json();
        expect(malformedBody.error.code).toBe('role_not_permitted');
        expect(malformedBody.requestId).toBe('req-auth-precedence-malformed');

        // Case 3: Strict schema invalid input ({}) -> 403 role_not_permitted, NOT 422
        const invalidSchemaRes = await fetch(`${baseUrl}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'x-demo-user-id': id,
            'content-type': 'application/json',
            'x-request-id': 'req-auth-precedence-schema',
          },
          body: JSON.stringify({}),
        });
        expect(invalidSchemaRes.status).toBe(403);
        const invalidSchemaBody = await invalidSchemaRes.json();
        expect(invalidSchemaBody.error.code).toBe('role_not_permitted');
        expect(invalidSchemaBody.requestId).toBe('req-auth-precedence-schema');
      }

      // Conversely, Founder still receives normal content-type and parsing errors
      const founderWrongCt = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'text/plain',
        },
        body: 'Not even JSON',
      });
      expect(founderWrongCt.status).toBe(415);
      const founderWrongCtBody = await founderWrongCt.json();
      expect(founderWrongCtBody.error.code).toBe('json_content_type_required');

      const founderMalformed = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: '{"invalidJson": ',
      });
      expect(founderMalformed.status).toBe(400);
      const founderMalformedBody = await founderMalformed.json();
      expect(founderMalformedBody.error.code).toBe('invalid_json');
    });

    it('enforces role matrix: founder and manager succeed with 201; senior_staff, staff, and trainee fail with 403', async () => {
      const baseUrl = await startServer();

      // Founder succeeds
      const founderRes = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
          'x-request-id': 'req-create-founder',
        },
        body: JSON.stringify({
          displayName: 'Founder Created Client',
          pan: 'ABCDE1234F',
          gstin: '27ABCDE1234F1Z5',
          relationshipOwnerId: DEMO_ACTOR_IDS.manager,
        }),
      });
      expect(founderRes.status).toBe(201);
      expect(founderRes.headers.get('x-request-id')).toBe('req-create-founder');
      const founderBody = await founderRes.json();
      expect(founderBody.requestId).toBe('req-create-founder');
      expect(founderBody.data.displayName).toBe('Founder Created Client');
      expect(founderBody.data.code).toMatch(/^CL-\d{6}$/);
      expect(founderBody.data.panMasked).toBe('******1234');
      expect(founderBody.data.gstinMasked).toBe('27**********1Z5');

      // Manager succeeds
      const managerRes = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.manager,
          'content-type': 'application/json',
          'x-request-id': 'req-create-manager',
        },
        body: JSON.stringify({
          displayName: 'Manager Created Client',
        }),
      });
      expect(managerRes.status).toBe(201);
      const managerBody = await managerRes.json();
      expect(managerBody.data.displayName).toBe('Manager Created Client');

      // Senior staff, staff, and trainee are forbidden
      const forbiddenRoles = [
        DEMO_ACTOR_IDS.senior,
        DEMO_ACTOR_IDS.staff,
        DEMO_ACTOR_IDS.trainee,
      ];
      for (const actorId of forbiddenRoles) {
        const deniedRes = await fetch(`${baseUrl}/api/v1/clients`, {
          method: 'POST',
          headers: {
            'x-demo-user-id': actorId,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ displayName: 'Forbidden Role Client' }),
        });
        expect(deniedRes.status).toBe(403);
        const deniedBody = await deniedRes.json();
        expect(deniedBody.error.code).toBe('role_not_permitted');
      }
    });

    it('preserves privacy invariant: normalizes uppercase, masks IDs, and serializes zero raw PAN/GSTIN in response', async () => {
      const baseUrl = await startServer();
      const rawPan = 'XYZAB5678M';
      const rawGstin = '29XYZAB5678M1Z8';

      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        // Send lowercase identifiers
        body: JSON.stringify({
          displayName: 'Secured Identifiers Pvt Ltd',
          legalName: 'Secured Identifiers Private Limited',
          pan: rawPan.toLowerCase(),
          gstin: rawGstin.toLowerCase(),
          email: 'contact@secured.in',
          phone: '9876543210',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.panMasked).toBe('******5678');
      expect(body.data.gstinMasked).toBe('29**********1Z8');

      // Verify serialized JSON payload does NOT contain raw secrets or raw keys
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(rawPan);
      expect(serialized).not.toContain(rawPan.toLowerCase());
      expect(serialized).not.toContain(rawGstin);
      expect(serialized).not.toContain(rawGstin.toLowerCase());
      expect(serialized).not.toContain('"pan":');
      expect(serialized).not.toContain('"gstin":');
    });

    it('rejects unknown and server-owned field injection via strict schema', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Injected Fields Corp',
          id: '00000000-0000-4000-a000-999999999999',
          code: 'CL-999999',
          createdById: '00000000-0000-4000-a000-888888888888',
          createdAt: '2026-01-01T00:00:00Z',
          panMasked: '******1234',
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe('validation_failed');
      const errorText = JSON.stringify(body);
      expect(errorText).toContain('Unrecognized key(s) in object');
    });

    it('validates Indian PAN format and never leaks invalid PAN in error response', async () => {
      const baseUrl = await startServer();
      const badPan = 'BAD_PAN_12345';
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Malformed PAN Client',
          pan: badPan,
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe('validation_failed');
      const errorText = JSON.stringify(body);
      expect(errorText).toContain('Invalid Indian PAN format');
      expect(errorText).not.toContain(badPan);
    });

    it('validates Indian GSTIN format and never leaks invalid GSTIN in error response', async () => {
      const baseUrl = await startServer();
      const badGstin = 'NOT_A_VALID_GSTIN';
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Malformed GSTIN Client',
          gstin: badGstin,
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe('validation_failed');
      const errorText = JSON.stringify(body);
      expect(errorText).toContain('Invalid Indian GSTIN format');
      expect(errorText).not.toContain(badGstin);
    });

    it('rejects PAN/GSTIN mismatch without echoing either identifier in error response', async () => {
      const baseUrl = await startServer();
      const panA = 'ABCDE1234F';
      const gstinB = '27ZZZZZ9999Z1Z5'; // Embedded PAN is ZZZZZ9999Z !== ABCDE1234F

      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Mismatch Identifiers Client',
          pan: panA,
          gstin: gstinB,
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe('validation_failed');
      const errorText = JSON.stringify(body);
      expect(errorText).toContain('GSTIN characters 3–12 must match the provided PAN');
      expect(errorText).not.toContain(panA);
      expect(errorText).not.toContain(gstinB);
    });

    it('handles blank/whitespace optional identifiers cleanly by persisting them as null', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Blank Identifiers Client',
          pan: '   ',
          gstin: '',
          legalName: '   ',
          email: '',
          phone: '   ',
          notes: '',
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.panMasked).toBeNull();
      expect(body.data.gstinMasked).toBeNull();
      expect(body.data.legalName).toBeNull();
      expect(body.data.email).toBeNull();
      expect(body.data.phone).toBeNull();
      expect(body.data.notes).toBeNull();
    });

    it('enforces display name length bounds (min 2, max 180)', async () => {
      const baseUrl = await startServer();

      // Too short (1 char)
      const shortRes = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ displayName: 'A' }),
      });
      expect(shortRes.status).toBe(422);

      // Too long (>180 chars)
      const longRes = await fetch(`${baseUrl}/api/v1/clients`, {
        method: 'POST',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ displayName: 'A'.repeat(181) }),
      });
      expect(longRes.status).toBe(422);
    });
  });

  describe('AS-01: Assignments PATCH and Idempotent Due Generation', () => {
    it('allows Founder/Manager to update assignment title, owner, and reviewers', async () => {
      const baseUrl = await startServer();
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);
      const res = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}`, {
        method: 'PATCH',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Updated GSTR-1 Review Engagement',
          ownerId: DEMO_ACTOR_IDS.senior,
          reviewerIds: [DEMO_ACTOR_IDS.manager],
          expectedUpdatedAt: u0,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.title).toBe('Updated GSTR-1 Review Engagement');
      expect(body.data.ownerId).toBe(DEMO_ACTOR_IDS.senior);
      expect(body.data.reviewerIds).toEqual([DEMO_ACTOR_IDS.manager]);
    });

    it('rejects non-leadership attempts to reassign owner or reviewers with 403', async () => {
      const baseUrl = await startServer();
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);
      const res = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}`, {
        method: 'PATCH',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.staff,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ownerId: DEMO_ACTOR_IDS.staff,
          expectedUpdatedAt: u0,
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('role_not_permitted');
    });

    it('rejects assigning a Trainee as assignment owner with 422 trainee_cannot_own_assignment', async () => {
      const baseUrl = await startServer();
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);
      const res = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}`, {
        method: 'PATCH',
        headers: {
          'x-demo-user-id': DEMO_ACTOR_IDS.founder,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ownerId: DEMO_ACTOR_IDS.trainee,
          expectedUpdatedAt: u0,
        }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe('trainee_cannot_own_assignment');
    });

    it('rejects editing owner on an approved assignment with 409 conflict', async () => {
      const baseUrl = await startServer();
      // First, progress and approve the assignment (CANONICAL_ASSIGNMENT_1 starts in_progress)
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);

      // in_progress -> ready_for_review
      const subRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit', expectedUpdatedAt: u0 }),
      });
      const u1 = (await subRes.json()).data.updatedAt;

      // ready_for_review -> approved
      const compRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', expectedUpdatedAt: u1 }),
      });
      const u2 = (await compRes.json()).data.updatedAt;

      // Now attempt to update owner
      const res = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}`, {
        method: 'PATCH',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ ownerId: DEMO_ACTOR_IDS.staff, expectedUpdatedAt: u2 }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('invalid_state_transition');
    });

    it('rejects updates with mismatched expectedUpdatedAt with 409 conflict', async () => {
      const baseUrl = await startServer();
      const res = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}`, {
        method: 'PATCH',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Concurrent Title',
          expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('concurrency_conflict');
    });

    it('generates due recurring assignments for leadership and enforces idempotency', async () => {
      const baseUrl = await startServer();

      // First create a recurring schedule with nextOccurrenceOn = 2026-10-31
      const schedRes = await fetch(`${baseUrl}/api/v1/recurring-schedules`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: CANONICAL_CLIENT_1,
          serviceId: CANONICAL_SERVICE_1,
          title: 'Recurring GST Filing',
          cadence: 'monthly',
          ownerId: DEMO_ACTOR_IDS.senior,
          nextOccurrenceOn: '2026-10-31',
          dueDay: 11,
        }),
      });
      expect(schedRes.status).toBe(201);

      // Generate due through 2026-11-05
      const genRes1 = await fetch(`${baseUrl}/api/v1/recurring-schedules/generate-due`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ throughDate: '2026-11-05' }),
      });
      expect(genRes1.status).toBe(200);
      const genBody1 = await genRes1.json();
      expect(genBody1.data.generatedCount).toBeGreaterThanOrEqual(1);

      // Repeated execution: idempotent, 0 duplicate occurrences generated
      const genRes2 = await fetch(`${baseUrl}/api/v1/recurring-schedules/generate-due`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ throughDate: '2026-11-05' }),
      });
      expect(genRes2.status).toBe(200);
      const genBody2 = await genRes2.json();
      expect(genBody2.data.generatedCount).toBe(0);
    });

    it('rejects generate-due when called by non-leadership roles with 403', async () => {
      const baseUrl = await startServer();
      for (const roleId of [DEMO_ACTOR_IDS.senior, DEMO_ACTOR_IDS.staff, DEMO_ACTOR_IDS.trainee]) {
        const res = await fetch(`${baseUrl}/api/v1/recurring-schedules/generate-due`, {
          method: 'POST',
          headers: { 'x-demo-user-id': roleId, 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe('role_not_permitted');
      }
    });

    it('rejects invalid non-existent calendar dates like 2026-02-31 with 422 validation_failed', async () => {
      const baseUrl = await startServer();
      const invalidDates = ['2026-02-31', '2026-04-31', '2026-02-29', '2026-13-01', '2026-00-10'];

      for (const badDate of invalidDates) {
        const res = await fetch(`${baseUrl}/api/v1/recurring-schedules`, {
          method: 'POST',
          headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
          body: JSON.stringify({
            clientId: CANONICAL_CLIENT_1,
            serviceId: CANONICAL_SERVICE_1,
            title: 'Invalid Date Schedule',
            cadence: 'monthly',
            ownerId: DEMO_ACTOR_IDS.senior,
            nextOccurrenceOn: badDate,
            dueDay: 11,
          }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error.code).toBe('validation_failed');
      }
    });

    it('rejects core mutations on approved/closed assignments with 409 invalid_state_transition', async () => {
      const baseUrl = await startServer();

      // Progress CANONICAL_ASSIGNMENT_1 to approved (starts in_progress)
      const u0 = await getAssignmentUpdatedAt(baseUrl, CANONICAL_ASSIGNMENT_1);

      const subRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit', expectedUpdatedAt: u0 }),
      });
      const u1 = (await subRes.json()).data.updatedAt;

      const approveRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}/transitions`, {
        method: 'POST',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', expectedUpdatedAt: u1 }),
      });
      expect(approveRes.status).toBe(200);
      const u2 = (await approveRes.json()).data.updatedAt;

      // Now attempt PATCH with core changes
      const patchRes = await fetch(`${baseUrl}/api/v1/assignments/${CANONICAL_ASSIGNMENT_1}`, {
        method: 'PATCH',
        headers: { 'x-demo-user-id': DEMO_ACTOR_IDS.founder, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New Locked Title', expectedUpdatedAt: u2 }),
      });
      expect(patchRes.status).toBe(409);
      const patchBody = await patchRes.json();
      expect(patchBody.error.code).toBe('invalid_state_transition');
      expect(patchBody.error.message).toBe('An approved or closed Assignment is an immutable audit artifact.');
    });
  });
});
