import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from './types';
import { parseSessionEnvelope, SessionClient } from './session-client';

describe('SessionClient HTTP Transport', () => {
  const validActor = {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'Suresh Narayanan',
    role: 'founder',
    reportsToId: null,
  };

  const validEnvelope = {
    data: validActor,
    requestId: 'req-12345',
  };

  it('TC-SC-01: Attaches Authorization: Bearer <token>, x-request-id, Accept: application/json, and credentials: "omit"', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify(validEnvelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const client = new SessionClient({
      baseUrl: 'http://localhost:8788',
      fetchFn: mockFetch as any,
      createRequestId: () => 'req-fixed-id',
    });

    const actor = await client.getSession('test-access-token');
    expect(actor).toEqual(validActor);
    expect(capturedUrl).toBe('http://localhost:8788/api/v1/session');
    expect(capturedInit?.method).toBe('GET');
    expect(capturedInit?.credentials).toBe('omit');
    expect(capturedInit?.cache).toBe('no-store');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer test-access-token');
    expect(headers['x-request-id']).toBe('req-fixed-id');
    expect(headers['accept']).toBe('application/json');
  });

  it('TC-SC-02: Never emits x-demo-user-id header under any circumstance', async () => {
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify(validEnvelope), { status: 200 });
    });

    const client = new SessionClient({ fetchFn: mockFetch as any });
    await client.getSession('test-token');

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('x-demo-user-id');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('x-demo-user-id');
  });

  it('TC-SC-03: Throws 401 without network request if token is null, empty string, or whitespace', async () => {
    const mockFetch = vi.fn();
    const client = new SessionClient({ fetchFn: mockFetch as any });

    await expect(client.getSession('')).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    });
    await expect(client.getSession('   ')).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    });
    await expect(client.getSession(null as any)).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('TC-SC-04: Allows empty string base URL and relative paths (e.g. "", "/api")', () => {
    expect(() => new SessionClient({ baseUrl: '' })).not.toThrow();
    expect(() => new SessionClient({ baseUrl: '/api' })).not.toThrow();
    expect(() => new SessionClient({ baseUrl: '/crm/api/' })).not.toThrow();
  });

  it('TC-SC-05: Allows https://api.example.com and loopback http://localhost:8788, http://127.0.0.1:8788', () => {
    expect(() => new SessionClient({ baseUrl: 'https://api.example.com' })).not.toThrow();
    expect(() => new SessionClient({ baseUrl: 'http://localhost:8788' })).not.toThrow();
    expect(() => new SessionClient({ baseUrl: 'http://127.0.0.1:8788' })).not.toThrow();
    expect(() => new SessionClient({ baseUrl: 'http://[::1]:8788' })).not.toThrow();
  });

  it('TC-SC-06: Rejects remote non-loopback HTTP URLs (e.g. http://insecure.example.com)', () => {
    expect(() => new SessionClient({ baseUrl: 'http://insecure.example.com' })).toThrowError(ApiClientError);
    try {
      new SessionClient({ baseUrl: 'http://insecure.example.com' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).code).toBe('insecure_base_url');
    }
  });

  it('TC-SC-07: Rejects base URLs containing credentials, query parameters, or hashes', () => {
    expect(() => new SessionClient({ baseUrl: 'http://user:pass@localhost:8788' })).toThrowError(ApiClientError);
    expect(() => new SessionClient({ baseUrl: 'http://localhost:8788?param=1' })).toThrowError(ApiClientError);
    expect(() => new SessionClient({ baseUrl: 'http://localhost:8788#frag' })).toThrowError(ApiClientError);
  });

  it('TC-SC-08: Parses 200 OK valid ApiEnvelope<SessionActor> and returns verified actor', () => {
    const actor = parseSessionEnvelope({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Manoj Kumar',
        role: 'manager',
        reportsToId: '00000000-0000-4000-a000-000000000001',
      },
      requestId: 'req-ok',
    });
    expect(actor).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Manoj Kumar',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    });
  });

  it('TC-SC-09: Throws 502 "invalid_response" on malformed JSON or schema violation', () => {
    expect(() => parseSessionEnvelope(null)).toThrowError(ApiClientError);
    expect(() => parseSessionEnvelope({})).toThrowError(ApiClientError);
    expect(() => parseSessionEnvelope({ data: null, requestId: 'r1' })).toThrowError(ApiClientError);
    // Invalid UUID
    expect(() => parseSessionEnvelope({ data: { id: 'not-a-uuid', name: 'A', role: 'admin' }, requestId: 'r1' })).toThrowError(ApiClientError);
    // Empty name
    expect(() => parseSessionEnvelope({ data: { id: '00000000-0000-4000-a000-000000000001', name: '   ', role: 'admin' }, requestId: 'r1' })).toThrowError(ApiClientError);
    // Invalid role
    expect(() => parseSessionEnvelope({ data: { id: '00000000-0000-4000-a000-000000000001', name: 'A', role: 'superadmin' }, requestId: 'r1' })).toThrowError(ApiClientError);
    // Invalid reportsToId
    expect(() => parseSessionEnvelope({ data: { id: '00000000-0000-4000-a000-000000000001', name: 'A', role: 'founder', reportsToId: 'bad-uuid' }, requestId: 'r1' })).toThrowError(ApiClientError);
  });

  it('TC-SC-10: Parses 401 with code "invalid_token" from server error envelope', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'invalid_token', message: 'JWT expired' },
          requestId: 'req-err-401',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
    );

    const client = new SessionClient({ fetchFn: mockFetch as any });
    await expect(client.getSession('expired-token')).rejects.toMatchObject({
      code: 'invalid_token',
      status: 401,
      message: 'JWT expired',
    });
  });

  it('TC-SC-11: Parses 403 with code "forbidden" from server error envelope', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'forbidden', message: 'Employee profile is inactive' },
          requestId: 'req-err-403',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const client = new SessionClient({ fetchFn: mockFetch as any });
    await expect(client.getSession('inactive-token')).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
      message: 'Employee profile is inactive',
    });
  });

  it('TC-SC-12: Maps network/fetch exceptions to ApiClientError({ code: "network_error", status: 0 })', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
    const client = new SessionClient({ fetchFn: mockFetch as any });

    await expect(client.getSession('valid-token')).rejects.toMatchObject({
      code: 'network_error',
      status: 0,
      message: 'Failed to fetch',
    });
  });

  it('TC-SC-13: Respects AbortSignal and throws abort error', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const mockFetch = vi.fn().mockRejectedValue(abortErr);

    const client = new SessionClient({ fetchFn: mockFetch as any });
    const controller = new AbortController();
    controller.abort();

    await expect(client.getSession('valid-token', controller.signal)).rejects.toThrow('The operation was aborted');
  });
});
