import { describe, expect, it, vi } from 'vitest';
import type { ServiceDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { HttpServiceCatalogAdapter } from './http-service-catalog-adapter';
import { ServiceCatalogOperationError } from './service-catalog-types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

const service: ServiceDto = {
  id: '50000000-0000-4000-a000-000000000001',
  name: 'GST Compliance',
  description: 'Monthly and annual GST returns',
  turnaroundDays: 7,
  isStatutory: true,
  isActive: true,
  usage: { assignments: 4, recurringSchedules: 2, engagements: 1 },
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

function okResponse(data: unknown, status = 200, requestId = 'req-service-1'): Response {
  return new Response(JSON.stringify({ data, requestId }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterFor(data: unknown, status = 200) {
  const fetchFn = vi.fn().mockResolvedValue(okResponse(data, status));
  return { fetchFn, adapter: new HttpServiceCatalogAdapter({ fetchFn }) };
}

describe('HttpServiceCatalogAdapter', () => {
  it('calls the service-catalog route with the demo actor header for the role', async () => {
    const roles: CompanyRole[] = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'];
    for (const role of roles) {
      const { adapter, fetchFn } = adapterFor([service]);
      await adapter.listServiceCatalog(role);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/service-catalog');
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID[role]);
    }
  });

  it('uses a Bearer token when a token source is configured and never falls back to the demo header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([service]));
    const adapter = new HttpServiceCatalogAdapter({ fetchFn, getAccessToken: () => ' token-123 ' });
    await adapter.listServiceCatalog('founder');
    const headers = new Headers((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-123');
    expect(headers.get('x-demo-user-id')).toBeNull();

    const blankFetch = vi.fn();
    const blank = new HttpServiceCatalogAdapter({ fetchFn: blankFetch, getAccessToken: () => null });
    await expect(blank.listServiceCatalog('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(blankFetch).not.toHaveBeenCalled();
  });

  it('parses valid services unchanged, including a service with nothing optional set', async () => {
    const bare: ServiceDto = { ...service, description: null, turnaroundDays: null, isStatutory: false, isActive: false };
    const services = await adapterFor([service, bare]).adapter.listServiceCatalog('founder');
    expect(services).toEqual([service, bare]);
  });

  it('rejects a response whose data is not an array and an envelope without data', async () => {
    await expect(adapterFor({ nope: true }).adapter.listServiceCatalog('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'req-1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(new HttpServiceCatalogAdapter({ fetchFn }).listServiceCatalog('founder')).rejects.toBeInstanceOf(
      ServiceCatalogOperationError,
    );
  });

  it.each([
    ['a missing field', (dto: Record<string, unknown>) => { delete dto['isActive']; }],
    ['a non-UUID id', (dto: Record<string, unknown>) => { dto['id'] = 'SVC-001'; }],
    ['a blank name', (dto: Record<string, unknown>) => { dto['name'] = '  '; }],
    ['a fractional turnaround', (dto: Record<string, unknown>) => { dto['turnaroundDays'] = 1.5; }],
    ['a negative turnaround', (dto: Record<string, unknown>) => { dto['turnaroundDays'] = -1; }],
    ['a string statutory flag', (dto: Record<string, unknown>) => { dto['isStatutory'] = 'yes'; }],
    ['a missing usage', (dto: Record<string, unknown>) => { delete dto['usage']; }],
    ['a negative usage count', (dto: Record<string, unknown>) => { dto['usage'] = { assignments: -1, recurringSchedules: 0, engagements: 0 }; }],
    ['a malformed timestamp', (dto: Record<string, unknown>) => { dto['updatedAt'] = 'yesterday'; }],
  ])('rejects a service with %s', async (_name, mutate) => {
    const bad = structuredClone(service) as unknown as Record<string, unknown>;
    mutate(bad);
    await expect(adapterFor([bad]).adapter.listServiceCatalog('founder')).rejects.toMatchObject({ code: 'unexpected' });
  });

  it('normalizes HTTP errors into sanitized errors without leaking server text', async () => {
    const cases = [
      { status: 401, code: 'unauthorized', message: 'Session expired. Please sign in again to manage services.' },
      { status: 403, code: 'forbidden', message: 'You do not have permission to manage services.' },
      { status: 404, code: 'not_found', message: 'The service could not be located.' },
      { status: 500, code: 'unexpected', message: 'Something went wrong with the service list. Please try again.' },
    ];
    for (const c of cases) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'server_failure', message: 'Internal raw stack trace' } }), {
          status: c.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const caught = await new HttpServiceCatalogAdapter({ fetchFn }).listServiceCatalog('founder').catch((err: unknown) => err);
      expect(caught).toBeInstanceOf(ServiceCatalogOperationError);
      const error = caught as ServiceCatalogOperationError;
      expect(error.code).toBe(c.code);
      expect(error.status).toBe(c.status);
      expect(error.serverCode).toBe('server_failure');
      expect(error.message).toBe(c.message);
      expect(error.message).not.toContain('Internal raw stack trace');
    }
  });

  it('handles network failure, pre-aborted and in-flight aborted signals', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('Failed to fetch https://secret.example'));
    await expect(new HttpServiceCatalogAdapter({ fetchFn: failing }).listServiceCatalog('founder')).rejects.toMatchObject({
      code: 'network',
      message: 'Unable to reach the server. Please check your network connection and try again.',
    });

    const pre = new AbortController();
    pre.abort();
    const fetchFn = vi.fn();
    await expect(
      new HttpServiceCatalogAdapter({ fetchFn }).listServiceCatalog('founder', { signal: pre.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchFn).not.toHaveBeenCalled();

    const inFlight = new AbortController();
    const slowFetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          inFlight.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const pending = new HttpServiceCatalogAdapter({ fetchFn: slowFetch }).listServiceCatalog('founder', {
      signal: inFlight.signal,
    });
    inFlight.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('prefixes the configured base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([]));
    await new HttpServiceCatalogAdapter({ fetchFn, baseUrl: 'http://127.0.0.1:4321/' }).listServiceCatalog('founder');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:4321/api/v1/service-catalog');
  });
});

describe('HttpServiceCatalogAdapter mutations', () => {
  it('POSTs a new service with the Idempotency-Key and parses the created service', async () => {
    const { adapter, fetchFn } = adapterFor(service, 201);
    const created = await adapter.createService(
      'founder',
      { name: 'GST Compliance', description: 'Monthly and annual GST returns', turnaroundDays: 7, isStatutory: true },
      '  key-1  ',
    );
    expect(created).toEqual(service);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/service-catalog');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBe('key-1');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'GST Compliance',
      description: 'Monthly and annual GST returns',
      turnaroundDays: 7,
      isStatutory: true,
    });
  });

  it('PATCHes an existing service by id with the update body', async () => {
    const { adapter, fetchFn } = adapterFor({ ...service, isActive: false });
    const updated = await adapter.updateService(
      'founder',
      service.id,
      { isActive: false, expectedUpdatedAt: service.updatedAt },
      'key-2',
    );
    expect(updated.isActive).toBe(false);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/service-catalog/${service.id}`);
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('key-2');
    expect(JSON.parse(String(init.body))).toEqual({ isActive: false, expectedUpdatedAt: service.updatedAt });
  });

  it('refuses a blank or oversized Idempotency-Key before sending', async () => {
    const { adapter, fetchFn } = adapterFor(service, 201);
    await expect(adapter.createService('founder', { name: 'ISO' }, '   ')).rejects.toMatchObject({ code: 'unexpected' });
    await expect(adapter.createService('founder', { name: 'ISO' }, 'k'.repeat(256))).rejects.toMatchObject({
      code: 'unexpected',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the safe server code on 409 conflicts so the dialog can show its message', async () => {
    for (const code of ['duplicate_service', 'stale_service']) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, message: 'raw server text' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const error = await new HttpServiceCatalogAdapter({ fetchFn })
        .createService('founder', { name: 'ISO' }, 'key-3')
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(ServiceCatalogOperationError);
      expect(error).toMatchObject({ status: 409, serverCode: code });
      expect((error as Error).message).not.toContain('raw server text');
    }
  });

  it('rejects a malformed created service', async () => {
    const { adapter } = adapterFor({ id: service.id }, 201);
    await expect(adapter.createService('founder', { name: 'ISO' }, 'key-4')).rejects.toMatchObject({
      code: 'unexpected',
    });
  });
});
