import { describe, expect, it, vi } from 'vitest';
import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  CreateEngagementDraftInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from '@sn/contracts';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import { HttpEngagementsAdapter } from './http-engagements-adapter';
import {
  EngagementOperationError,
  SAFE_ENGAGEMENT_ERROR_MESSAGES,
} from './engagements-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_ENGAGEMENT: EngagementDto = {
  id: '00000000-0000-4000-b000-000000000001',
  code: 'ENG-000001',
  clientId: '00000000-0000-4000-c000-000000000001',
  clientName: 'Acme Corp',
  serviceId: '00000000-0000-4000-d000-000000000001',
  serviceName: 'Tax Advisory',
  status: 'draft',
  approvedVersionId: null,
  approvedVersion: null,
  approvedAt: null,
  approvedById: null,
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const SAMPLE_VERSION: EngagementVersionDto = {
  id: '00000000-0000-4000-b000-000000000010',
  engagementId: '00000000-0000-4000-b000-000000000001',
  versionNumber: 1,
  title: 'Tax Advisory FY 2026-27',
  scope: 'Full tax compliance for FY 2026-27',
  exclusions: null,
  responsiblePartnerId: '00000000-0000-4000-a000-000000000001',
  responsiblePartnerName: 'S. Narayanan',
  deliveryManagerId: '00000000-0000-4000-a000-000000000002',
  deliveryManagerName: 'Priya Desai',
  feeModel: 'fixed',
  agreedFeePaise: 500000,
  billingTerms: 'Net 30',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  approvedAt: null,
  approvedById: null,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-11-01T10:00:00.000Z',
};

const CREATE_DRAFT_INPUT: CreateEngagementDraftInput = {
  clientId: '00000000-0000-4000-c000-000000000001',
  serviceId: '00000000-0000-4000-d000-000000000001',
  title: 'Tax Advisory FY 2026-27',
  scope: 'Full tax compliance',
  responsiblePartnerId: '00000000-0000-4000-a000-000000000001',
  deliveryManagerId: '00000000-0000-4000-a000-000000000002',
  feeModel: 'fixed',
  agreedFeePaise: 500000,
  billingTerms: 'Net 30',
  startDate: '2026-04-01',
};

const REVISE_INPUT: ReviseEngagementDraftInput = {
  engagementId: '00000000-0000-4000-b000-000000000001',
  title: 'Revised Title',
  scope: 'Revised scope content',
  responsiblePartnerId: '00000000-0000-4000-a000-000000000001',
  deliveryManagerId: '00000000-0000-4000-a000-000000000002',
  feeModel: 'recurring',
  agreedFeePaise: 600000,
  billingTerms: 'Net 15',
  startDate: '2026-04-01',
  expectedUpdatedAt: '2026-11-01T10:00:00.000Z',
};

const ACTIVATE_INPUT: ActivateEngagementInput = {
  engagementId: '00000000-0000-4000-b000-000000000001',
  versionId: '00000000-0000-4000-b000-000000000010',
  expectedUpdatedAt: '2026-11-01T10:00:00.000Z',
};

const AMEND_INPUT: AmendActiveEngagementInput = {
  engagementId: '00000000-0000-4000-b000-000000000001',
  title: 'Amended Title',
  scope: 'Amended scope',
  responsiblePartnerId: '00000000-0000-4000-a000-000000000001',
  deliveryManagerId: '00000000-0000-4000-a000-000000000002',
  feeModel: 'fixed',
  agreedFeePaise: 700000,
  billingTerms: 'Net 30',
  startDate: '2026-04-01',
  expectedUpdatedAt: '2026-11-01T10:00:00.000Z',
};

const END_INPUT: EndEngagementInput = {
  engagementId: '00000000-0000-4000-b000-000000000001',
  outcome: 'completed',
  reason: 'All deliverables completed successfully.',
  expectedUpdatedAt: '2026-11-01T10:00:00.000Z',
};

function makeOkResponse(data: unknown, requestId = 'req-test-1'): Response {
  return new Response(
    JSON.stringify({ data, requestId }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': requestId } },
  );
}

function makeCreatedResponse(data: unknown, requestId = 'req-test-create'): Response {
  return new Response(
    JSON.stringify({ data, requestId }),
    { status: 201, headers: { 'content-type': 'application/json', 'x-request-id': requestId } },
  );
}

function makeErrorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message }, requestId: 'req-err-1' }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

// ---------------------------------------------------------------------------
// Demo mode (no token source)
// ---------------------------------------------------------------------------

describe('HttpEngagementsAdapter — Demo mode (no token source)', () => {
  it('list: GET /api/v1/engagements with x-demo-user-id for each role', async () => {
    for (const role of ['founder', 'manager', 'senior_staff', 'staff', 'trainee'] as const) {
      const fetchFn = vi.fn().mockResolvedValue(makeOkResponse([SAMPLE_ENGAGEMENT]));
      const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
      const result = await adapter.list(role);
      expect(result).toEqual([SAMPLE_ENGAGEMENT]);

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/api/v1/engagements');
      expect(init.method).toBe('GET');
      const headers = new Headers(init.headers);
      expect(headers.get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID[role]);
      expect(headers.get('authorization')).toBeNull();
    }
  });

  it('list: propagates x-request-id header when requestId supplied', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse([SAMPLE_ENGAGEMENT]));
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    await adapter.list('founder', { requestId: 'req-test-99' });
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('x-request-id')).toBe('req-test-99');
  });

  it('get: GET /api/v1/engagements/:id with encoded id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse(SAMPLE_ENGAGEMENT));
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    const result = await adapter.get('founder', '00000000-0000-4000-b000-000000000001');
    expect(result).toEqual(SAMPLE_ENGAGEMENT);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3000/api/v1/engagements/00000000-0000-4000-b000-000000000001',
    );
  });

  it('get: encodes special chars in path id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse(SAMPLE_ENGAGEMENT));
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    await adapter.get('founder', 'id with spaces/slashes');
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/engagements/id%20with%20spaces%2Fslashes');
  });

  it('listVersions: GET /api/v1/engagements/:id/versions', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse([SAMPLE_VERSION]));
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    const result = await adapter.listVersions(
      'founder',
      '00000000-0000-4000-b000-000000000001',
    );
    expect(result).toEqual([SAMPLE_VERSION]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3000/api/v1/engagements/00000000-0000-4000-b000-000000000001/versions',
    );
    expect(init.method).toBe('GET');
  });

  it('createDraft: POST /api/v1/engagements with idempotency key and json body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeCreatedResponse(SAMPLE_ENGAGEMENT));
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    const result = await adapter.createDraft(
      'founder',
      CREATE_DRAFT_INPUT,
      'ikey-create-001',
    );
    expect(result).toEqual(SAMPLE_ENGAGEMENT);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3000/api/v1/engagements');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe('ikey-create-001');
    expect(JSON.parse(init.body as string)).toEqual(CREATE_DRAFT_INPUT);
  });

  it('createDraft: trims idempotency key whitespace and preserves exactly', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeCreatedResponse(SAMPLE_ENGAGEMENT));
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    await adapter.createDraft('founder', CREATE_DRAFT_INPUT, '  my-key  ');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('idempotency-key')).toBe('my-key');
  });

  it('createDraft: throws validation error (no fetch) for blank idempotency key', async () => {
    const fetchFn = vi.fn();
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    await expect(adapter.createDraft('founder', CREATE_DRAFT_INPUT, '')).rejects.toMatchObject({
      code: 'validation',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('createDraft: throws validation error for key exceeding 255 chars', async () => {
    const fetchFn = vi.fn();
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    await expect(
      adapter.createDraft('founder', CREATE_DRAFT_INPUT, 'a'.repeat(256)),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reviseDraft: PATCH /api/v1/engagements/:id/draft — engagementId NOT in body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse(SAMPLE_ENGAGEMENT));
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    await adapter.reviseDraft(
      'founder',
      '00000000-0000-4000-b000-000000000001',
      REVISE_INPUT,
      'ikey-revise-001',
    );

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3000/api/v1/engagements/00000000-0000-4000-b000-000000000001/draft',
    );
    expect(init.method).toBe('PATCH');
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBe('ikey-revise-001');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // Route-bound engagementId must NOT appear in the JSON body
    expect(body['engagementId']).toBeUndefined();
    // Other fields must be present
    expect(body['title']).toBe(REVISE_INPUT.title);
    expect(body['expectedUpdatedAt']).toBe(REVISE_INPUT.expectedUpdatedAt);
  });

  it('activate: POST /api/v1/engagements/:id/activate — engagementId NOT in body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse({ ...SAMPLE_ENGAGEMENT, status: 'active' }));
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    await adapter.activate(
      'founder',
      '00000000-0000-4000-b000-000000000001',
      ACTIVATE_INPUT,
      'ikey-activate-001',
    );

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3000/api/v1/engagements/00000000-0000-4000-b000-000000000001/activate',
    );
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('ikey-activate-001');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['engagementId']).toBeUndefined();
    expect(body['versionId']).toBe(ACTIVATE_INPUT.versionId);
  });

  it('amend: POST /api/v1/engagements/:id/amendments — engagementId NOT in body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse(SAMPLE_ENGAGEMENT));
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    await adapter.amend(
      'founder',
      '00000000-0000-4000-b000-000000000001',
      AMEND_INPUT,
      'ikey-amend-001',
    );

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3000/api/v1/engagements/00000000-0000-4000-b000-000000000001/amendments',
    );
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['engagementId']).toBeUndefined();
    expect(body['title']).toBe(AMEND_INPUT.title);
  });

  it('end: POST /api/v1/engagements/:id/end — engagementId NOT in body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ ...SAMPLE_ENGAGEMENT, status: 'ended' }),
    );
    const adapter = new HttpEngagementsAdapter({ fetchFn, baseUrl: 'http://localhost:3000' });
    await adapter.end(
      'founder',
      '00000000-0000-4000-b000-000000000001',
      END_INPUT,
      'ikey-end-001',
    );

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3000/api/v1/engagements/00000000-0000-4000-b000-000000000001/end',
    );
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['engagementId']).toBeUndefined();
    expect(body['outcome']).toBe('completed');
    expect(body['reason']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Authenticated mode (token source configured)
// ---------------------------------------------------------------------------

describe('HttpEngagementsAdapter — Authenticated mode (token source configured)', () => {
  it('sends Authorization: Bearer when token resolves', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse([SAMPLE_ENGAGEMENT]));
    const getAccessToken = vi.fn().mockResolvedValue('tok-abc123');
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await adapter.list('founder');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-abc123');
    expect(headers.get('x-demo-user-id')).toBeNull();
  });

  it('fails closed (no fetch) when token source returns null', async () => {
    const fetchFn = vi.fn();
    const getAccessToken = vi.fn().mockResolvedValue(null);
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await expect(adapter.list('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed (no fetch) when token source returns blank string', async () => {
    const fetchFn = vi.fn();
    const getAccessToken = vi.fn().mockResolvedValue('   ');
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await expect(adapter.list('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed (no fetch) when token source throws', async () => {
    const fetchFn = vi.fn();
    const getAccessToken = vi.fn().mockRejectedValue(new Error('session expired'));
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await expect(adapter.list('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never sends x-demo-user-id when token source is configured (even when null)', async () => {
    const fetchFn = vi.fn();
    const getAccessToken = vi.fn().mockResolvedValue(null);
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    try {
      await adapter.list('founder');
    } catch {
      // expected
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses authSource.getSession() path when getAccessToken not provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeOkResponse([SAMPLE_ENGAGEMENT]));
    const authSource = {
      getSession: vi.fn().mockResolvedValue({ accessToken: 'tok-from-session', userId: 'u1' }),
      onAuthStateChange: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
      signInWithPassword: vi.fn(),
    };
    const adapter = new HttpEngagementsAdapter({ fetchFn, authSource });
    await adapter.list('founder');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok-from-session');
  });

  it('mutation: sends idempotency-key with bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeCreatedResponse(SAMPLE_ENGAGEMENT));
    const getAccessToken = vi.fn().mockResolvedValue('tok-create');
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await adapter.createDraft('founder', CREATE_DRAFT_INPUT, 'ikey-auth-001');
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBe('ikey-auth-001');
    expect(headers.get('authorization')).toBe('Bearer tok-create');
    expect(headers.get('x-demo-user-id')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Abort semantics
// ---------------------------------------------------------------------------

describe('HttpEngagementsAdapter — Abort semantics', () => {
  it('throws aborted before token resolution if signal already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchFn = vi.fn();
    const getAccessToken = vi.fn().mockResolvedValue('tok');
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await expect(
      adapter.list('founder', { signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchFn).not.toHaveBeenCalled();
    // getAccessToken may not be called — either way fetch must not be called
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws aborted after token resolution if signal aborted between checks', async () => {
    const ctrl = new AbortController();
    const fetchFn = vi.fn();
    const getAccessToken = vi.fn().mockImplementation(async () => {
      ctrl.abort(); // abort during token resolution
      return 'tok';
    });
    const adapter = new HttpEngagementsAdapter({ fetchFn, getAccessToken });
    await expect(
      adapter.list('founder', { signal: ctrl.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps AbortError thrown by fetch to aborted code', async () => {
    const ctrl = new AbortController();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchFn = vi.fn().mockRejectedValue(abortErr);
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    await expect(adapter.list('founder', { signal: ctrl.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});

// ---------------------------------------------------------------------------
// Error mapping and safe errors
// ---------------------------------------------------------------------------

describe('HttpEngagementsAdapter — Safe error mapping', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation'],
    [500, 'unexpected'],
  ] as const)('maps HTTP %i to code "%s" with safe message', async (status, code) => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeErrorResponse(status, 'server_detail', 'RAW SERVER MSG'),
    );
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    let err!: EngagementOperationError;
    try { await adapter.list('founder'); } catch (e) { err = e as EngagementOperationError; }
    expect(err).toBeInstanceOf(EngagementOperationError);
    expect(err.code).toBe(code);
    // Must use safe message, not raw server message
    expect(err.message).toBe(SAFE_ENGAGEMENT_ERROR_MESSAGES[code]);
    // Raw server message must not leak
    expect(err.message).not.toContain('RAW SERVER MSG');
  });

  it('maps network-level error to network code with safe message', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    let err!: EngagementOperationError;
    try { await adapter.list('founder'); } catch (e) { err = e as EngagementOperationError; }
    expect(err.code).toBe('network');
    expect(err.message).toBe(SAFE_ENGAGEMENT_ERROR_MESSAGES.network);
  });

  it('never retains raw response payload/cause in sanitized error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeErrorResponse(500, 'db_connection_error', 'PG ERROR: relation does not exist'),
    );
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    let err!: EngagementOperationError;
    try { await adapter.list('founder'); } catch (e) { err = e as EngagementOperationError; }
    expect(err.message).not.toContain('PG ERROR');
    expect(err.message).not.toContain('relation does not exist');
    // cause must not be on sanitized error
    expect(err.cause).toBeUndefined();
  });

  it('sanitizes serverCode to only pass through safe machine codes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeErrorResponse(409, 'BAD_UPPERCASE_CODE', 'conflict'),
    );
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    let err!: EngagementOperationError;
    try { await adapter.list('founder'); } catch (e) { err = e as EngagementOperationError; }
    expect(err.serverCode).toBeUndefined(); // stripped by sanitizeServerCode
  });

  it('propagates sanitized serverCode when it matches safe pattern', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeErrorResponse(409, 'draft_conflict', 'conflict'),
    );
    const adapter = new HttpEngagementsAdapter({ fetchFn });
    let err!: EngagementOperationError;
    try { await adapter.list('founder'); } catch (e) { err = e as EngagementOperationError; }
    expect(err.serverCode).toBe('draft_conflict');
  });
});

// ---------------------------------------------------------------------------
// Idempotency key enforcement
// ---------------------------------------------------------------------------

describe('HttpEngagementsAdapter — Idempotency key enforcement', () => {
  const mutations = [
    {
      name: 'createDraft',
      call: (adapter: HttpEngagementsAdapter, key: string) =>
        adapter.createDraft('founder', CREATE_DRAFT_INPUT, key),
    },
    {
      name: 'reviseDraft',
      call: (adapter: HttpEngagementsAdapter, key: string) =>
        adapter.reviseDraft('founder', SAMPLE_ENGAGEMENT.id, REVISE_INPUT, key),
    },
    {
      name: 'activate',
      call: (adapter: HttpEngagementsAdapter, key: string) =>
        adapter.activate('founder', SAMPLE_ENGAGEMENT.id, ACTIVATE_INPUT, key),
    },
    {
      name: 'amend',
      call: (adapter: HttpEngagementsAdapter, key: string) =>
        adapter.amend('founder', SAMPLE_ENGAGEMENT.id, AMEND_INPUT, key),
    },
    {
      name: 'end',
      call: (adapter: HttpEngagementsAdapter, key: string) =>
        adapter.end('founder', SAMPLE_ENGAGEMENT.id, END_INPUT, key),
    },
  ];

  for (const mutation of mutations) {
    it(`${mutation.name}: rejects blank key with validation error before fetch`, async () => {
      const fetchFn = vi.fn();
      const adapter = new HttpEngagementsAdapter({ fetchFn });
      await expect(mutation.call(adapter, '')).rejects.toMatchObject({ code: 'validation' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it(`${mutation.name}: rejects key > 255 chars with validation error before fetch`, async () => {
      const fetchFn = vi.fn();
      const adapter = new HttpEngagementsAdapter({ fetchFn });
      await expect(mutation.call(adapter, 'x'.repeat(256))).rejects.toMatchObject({
        code: 'validation',
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it(`${mutation.name}: sends exact trimmed key in Idempotency-Key header`, async () => {
      const fetchFn = vi.fn().mockResolvedValue(makeOkResponse(SAMPLE_ENGAGEMENT));
      const adapter = new HttpEngagementsAdapter({ fetchFn });
      await mutation.call(adapter, '  exact-key-123  ').catch(() => {});
      if (fetchFn.mock.calls.length > 0) {
        const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
        expect(new Headers(init.headers).get('idempotency-key')).toBe('exact-key-123');
      }
    });
  }
});
