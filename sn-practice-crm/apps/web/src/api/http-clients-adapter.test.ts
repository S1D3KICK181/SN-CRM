import { describe, expect, it, vi } from 'vitest';
import type { ClientDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { HttpClientsAdapter } from './http-clients-adapter';
import {
  ClientOperationError,
  sanitizeCreateClientError,
  sanitizeRequestId,
  sanitizeServerCode,
} from './clients-types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

describe('HttpClientsAdapter', () => {
  const sampleClientDto: ClientDto = {
    id: '10000000-0000-4000-a000-000000000001',
    code: 'CL-001001',
    displayName: 'Aster Foods',
    legalName: 'Aster Foods Private Limited',
    panMasked: '******1234',
    gstinMasked: '27**********1Z5',
    email: 'accounts@asterfoods.local',
    phone: '+91 98200 12345',
    relationshipOwnerId: '00000000-0000-4000-a000-000000000002',
    relationshipOwnerName: 'Priya Desai',
    status: 'active',
    notes: 'Standing corporate client.',
    activeAssignmentsCount: 1,
    createdById: '00000000-0000-4000-a000-000000000001',
    createdAt: '2026-11-01T04:00:00.000Z',
    updatedAt: '2026-11-01T04:00:00.000Z',
  };

  it('sends correct role header for all five roles', async () => {
    const roles: CompanyRole[] = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'];

    for (const role of roles) {
      let capturedHeaders: Headers | undefined;
      const fetchFn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedHeaders = new Headers(init.headers);
        return new Response(
          JSON.stringify({
            data: [sampleClientDto],
            requestId: 'req_roles',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });

      const adapter = new HttpClientsAdapter({ fetchFn });
      await adapter.list(role);

      expect(capturedHeaders?.get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID[role]);
    }
  });

  describe('signed-in session transport', () => {
    function okListFetch(onHeaders: (headers: Headers) => void) {
      return vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        onHeaders(new Headers(init.headers));
        return new Response(JSON.stringify({ data: [sampleClientDto], requestId: 'req_token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
    }

    it.each([
      ['a synchronous', () => '  jwt-sync  ', 'jwt-sync'],
      ['an async', async () => 'jwt-async', 'jwt-async'],
    ])('sends a Bearer token from %s token source and never the demo header', async (_label, getAccessToken, expected) => {
      let captured: Headers | undefined;
      const fetchFn = okListFetch((headers) => {
        captured = headers;
      });
      const adapter = new HttpClientsAdapter({ fetchFn, getAccessToken });

      const items = await adapter.list('founder');

      expect(items).toEqual([sampleClientDto]);
      expect(captured?.get('authorization')).toBe(`Bearer ${expected}`);
      expect(captured?.get('x-demo-user-id')).toBeNull();
    });

    it.each([
      ['null', () => null],
      ['blank', () => '   '],
      ['throwing', () => {
        throw new Error('refresh failed');
      }],
      ['rejecting', async () => {
        throw new Error('refresh failed');
      }],
    ])('fails closed without dispatching when the token source is %s', async (_label, getAccessToken) => {
      const fetchFn = vi.fn();
      const adapter = new HttpClientsAdapter({ fetchFn, getAccessToken });

      const error = await adapter.list('manager').catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ClientOperationError);
      expect((error as ClientOperationError).code).toBe('unauthorized');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('does not dispatch when aborted while the token resolves', async () => {
      const controller = new AbortController();
      const fetchFn = vi.fn();
      const adapter = new HttpClientsAdapter({
        fetchFn,
        getAccessToken: async () => {
          controller.abort();
          return 'jwt-late';
        },
      });

      const error = await adapter.list('founder', { signal: controller.signal }).catch((err: unknown) => err);

      expect((error as ClientOperationError).code).toBe('aborted');
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  it('lists clients unwrapping envelope and propagating request id', async () => {
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = new Headers(init.headers);
      return new Response(
        JSON.stringify({
          data: [sampleClientDto],
          requestId: 'req_list_clients',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_list_clients' },
        },
      );
    });

    const adapter = new HttpClientsAdapter({ baseUrl: 'http://localhost:4000', fetchFn });
    const items = await adapter.list('founder', { requestId: 'custom-req-id' });

    expect(capturedUrl).toBe('http://localhost:4000/api/v1/clients');
    expect(capturedHeaders?.get('x-request-id')).toBe('custom-req-id');
    expect(items).toEqual([sampleClientDto]);
    expect(items[0]!.panMasked).toBe('******1234');
    expect(items[0]!.gstinMasked).toBe('27**********1Z5');
  });

  it('gets client detail with encoded URI path and unwrap envelope', async () => {
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = new Headers(init.headers);
      return new Response(
        JSON.stringify({
          data: sampleClientDto,
          requestId: 'req_get_client',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_get_client' },
        },
      );
    });

    const adapter = new HttpClientsAdapter({ baseUrl: 'http://localhost:4000', fetchFn });
    const client = await adapter.get('manager', '10000000-0000-4000-a000-000000000001');

    expect(capturedUrl).toBe(
      'http://localhost:4000/api/v1/clients/10000000-0000-4000-a000-000000000001',
    );
    expect(capturedHeaders?.get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID.manager);
    expect(client).toEqual(sampleClientDto);
  });

  it('encodes special characters in get client detail path', async () => {
    let capturedUrl = '';
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          data: sampleClientDto,
          requestId: 'req_encoded',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const adapter = new HttpClientsAdapter({ fetchFn });
    await adapter.get('founder', 'cli/special id?query=1');

    expect(capturedUrl).toBe('/api/v1/clients/cli%2Fspecial%20id%3Fquery%3D1');
  });

  it('maps HTTP 401, 403, 404, 409, 422, and 500 to strongly-typed ClientOperationError', async () => {
    const cases = [
      { status: 401, code: 'unauthorized' },
      { status: 403, code: 'forbidden' },
      { status: 404, code: 'not_found' },
      { status: 409, code: 'conflict' },
      { status: 422, code: 'validation' },
      { status: 500, code: 'unexpected' },
    ] as const;

    for (const { status, code } of cases) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'server_err_code', message: `Server error ${status}` },
            requestId: `req_${status}`,
          }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      await expect(adapter.list('staff')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe(code);
        expect(opErr.status).toBe(status);
        expect(opErr.requestId).toBe(`req_${status}`);
        expect(opErr.serverCode).toBe('server_err_code');
        expect(opErr.message).toBe(`Server error ${status}`);
        return true;
      });
    }
  });

  it('handles non-JSON error body gracefully', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/html', 'x-request-id': 'req_html_error' },
      }),
    );

    const adapter = new HttpClientsAdapter({ fetchFn });
    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ClientOperationError);
      const opErr = err as ClientOperationError;
      expect(opErr.code).toBe('unexpected');
      expect(opErr.status).toBe(502);
      expect(opErr.requestId).toBe('req_html_error');
      expect(opErr.message).toContain('HTTP 502');
      return true;
    });
  });

  it('handles malformed error envelope metadata gracefully without throwing TypeError', async () => {
    const malformedBodies = [
      { error: null, requestId: 12345 },
      { error: 'not-an-object' },
      { error: { message: 12345, code: {} } },
      null,
      [],
    ];

    for (const body of malformedBodies) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json', 'x-request-id': 'req_hdr' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.status).toBe(400);
        expect(opErr.requestId).toBe('req_hdr');
        expect(opErr.message).toContain('HTTP 400');
        return true;
      });
    }
  });

  it('throws unexpected error when response JSON is not valid envelope', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ missingData: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new HttpClientsAdapter({ fetchFn });
    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ClientOperationError);
      const opErr = err as ClientOperationError;
      expect(opErr.code).toBe('unexpected');
      expect(opErr.message).toContain('API envelope');
      return true;
    });
  });

  it('rejects list when data is null or not an array', async () => {
    for (const invalidData of [null, {}, 'not-an-array', 123]) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: invalidData }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.message).toContain('array');
        return true;
      });
    }
  });

  it('rejects detail when data is null, array, or not an object', async () => {
    for (const invalidData of [null, [sampleClientDto], 'not-an-object', 42]) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: invalidData }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      await expect(adapter.get('founder', sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.message).toContain('object');
        return true;
      });
    }
  });

  // FIX 2: Rejection of raw statutory identifiers disguised under masked property names
  it('rejects detail when raw statutory PAN or GSTIN is disguised under panMasked/gstinMasked, and never echoes raw value in error', async () => {
    const rawPanDisguised = {
      ...sampleClientDto,
      panMasked: 'AABCA1234A', // Raw 10-char PAN
    };

    const rawGstinDisguised = {
      ...sampleClientDto,
      gstinMasked: '27AABCA1234A1Z5', // Raw 15-char GSTIN
    };

    for (const disguised of [rawPanDisguised, rawGstinDisguised]) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: disguised }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      await expect(adapter.get('founder', sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        // Crucial security requirement: never echo the raw value in the error message
        expect(opErr.message).not.toContain('AABCA1234A');
        expect(opErr.message).not.toContain('27AABCA1234A1Z5');
        expect(opErr.message).toMatch(/invalid "(panMasked|gstinMasked)" format/);
        return true;
      });
    }
  });

  it('rejects list when any item contains disguised raw statutory PAN or GSTIN', async () => {
    const disguisedList = [
      sampleClientDto,
      {
        ...sampleClientDto,
        id: '10000000-0000-4000-a000-000000000002',
        code: 'CL-001002',
        panMasked: 'AABCB2345B', // Raw PAN
      },
    ];

    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: disguisedList }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new HttpClientsAdapter({ fetchFn });
    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ClientOperationError);
      const opErr = err as ClientOperationError;
      expect(opErr.code).toBe('unexpected');
      expect(opErr.message).not.toContain('AABCB2345B');
      expect(opErr.message).toContain('invalid "panMasked" format');
      return true;
    });
  });

  it('accepts valid fully-masked values (10 asterisks for PAN, 15 asterisks for GSTIN) and nulls', async () => {
    const fullyMaskedClient: ClientDto = {
      ...sampleClientDto,
      panMasked: '**********', // 10 asterisks
      gstinMasked: '***************', // 15 asterisks
    };

    const nullTaxIdClient: ClientDto = {
      ...sampleClientDto,
      panMasked: null,
      gstinMasked: null,
    };

    for (const validDto of [fullyMaskedClient, nullTaxIdClient]) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: validDto }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      const client = await adapter.get('founder', sampleClientDto.id);
      expect(client.panMasked).toBe(validDto.panMasked);
      expect(client.gstinMasked).toBe(validDto.gstinMasked);
    }
  });

  // FIX 3: Semantic ClientDto boundary validation (UUID, code, dates, count)
  it('rejects semantically malformed client fields across all contract classes (table-driven)', async () => {
    const cases = [
      // 1. UUID violations for id, createdById, relationshipOwnerId
      {
        field: 'id',
        patch: { id: 'not-a-uuid' },
        errorMatch: /missing or invalid "id" \(must be RFC 4122 UUID\)/,
      },
      {
        field: 'createdById',
        patch: { createdById: '12345' },
        errorMatch: /missing or invalid "createdById" \(must be RFC 4122 UUID\)/,
      },
      {
        field: 'relationshipOwnerId',
        patch: { relationshipOwnerId: 'invalid-owner-uuid' },
        errorMatch: /invalid "relationshipOwnerId" \(must be RFC 4122 UUID or null\)/,
      },
      // 2. Client code violations (must be CL- + 6 digits)
      {
        field: 'code',
        patch: { code: 'CL-001' }, // Too short
        errorMatch: /missing or invalid "code" \(must match CL-xxxxxx\)/,
      },
      {
        field: 'code',
        patch: { code: 'CLI-001001' }, // Wrong prefix
        errorMatch: /missing or invalid "code" \(must match CL-xxxxxx\)/,
      },
      {
        field: 'code',
        patch: { code: 'CL-abcdef' }, // Alphabetic instead of digits
        errorMatch: /missing or invalid "code" \(must match CL-xxxxxx\)/,
      },
      // 3. ISO-8601 UTC timestamp violations (must end in Z, valid date)
      {
        field: 'createdAt',
        patch: { createdAt: '2026-11-01T04:00:00+05:30' }, // Non-UTC offset
        errorMatch: /invalid "createdAt" \(must be valid ISO-8601 UTC ending in Z\)/,
      },
      {
        field: 'createdAt',
        patch: { createdAt: '2026-02-31T04:00:00.000Z' }, // Impossible calendar date
        errorMatch: /invalid "createdAt" \(must be valid ISO-8601 UTC ending in Z\)/,
      },
      {
        field: 'updatedAt',
        patch: { updatedAt: 'not-a-date' },
        errorMatch: /invalid "updatedAt" \(must be valid ISO-8601 UTC ending in Z\)/,
      },
      // 4. activeAssignmentsCount (must be non-negative integer)
      {
        field: 'activeAssignmentsCount',
        patch: { activeAssignmentsCount: -1 }, // Negative
        errorMatch: /invalid "activeAssignmentsCount" \(must be non-negative integer\)/,
      },
      {
        field: 'activeAssignmentsCount',
        patch: { activeAssignmentsCount: 1.5 }, // Non-integer
        errorMatch: /invalid "activeAssignmentsCount" \(must be non-negative integer\)/,
      },
      {
        field: 'activeAssignmentsCount',
        patch: { activeAssignmentsCount: NaN },
        errorMatch: /invalid "activeAssignmentsCount" \(must be non-negative integer\)/,
      },
    ];

    for (const { patch, errorMatch } of cases) {
      const malformed = { ...sampleClientDto, ...patch };
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: malformed }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      await expect(adapter.get('founder', sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.message).toMatch(errorMatch);
        return true;
      });
    }
  });

  it('safely projects contract fields and never passes through hostile raw statutory properties', async () => {
    const hostileServerObject = {
      ...sampleClientDto,
      pan: 'AABCA1234A', // Raw statutory PAN
      gstin: '27AABCA1234A1Z5', // Raw statutory GSTIN
      internalSuperSecret: 'do-not-leak',
    };

    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: hostileServerObject }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new HttpClientsAdapter({ fetchFn });
    const projected = await adapter.get('founder', sampleClientDto.id);

    // Projected object strictly excludes raw statutory and unrecognized keys
    expect('pan' in projected).toBe(false);
    expect('gstin' in projected).toBe(false);
    expect('internalSuperSecret' in (projected as unknown as Record<string, unknown>)).toBe(false);
    expect(projected.panMasked).toBe('******1234');
    expect(projected.gstinMasked).toBe('27**********1Z5');
  });

  // Separate tests for AbortError and signal.aborted
  it('maps AbortError to "aborted" code when signal is not aborted', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const fetchFn = vi.fn().mockRejectedValue(abortErr);

    const adapter = new HttpClientsAdapter({ fetchFn });

    await expect(adapter.list('staff')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ClientOperationError);
      expect((err as ClientOperationError).code).toBe('aborted');
      return true;
    });
  });

  it('maps to "aborted" code when options.signal is aborted even if fetch throws generic error', async () => {
    const genericErr = new TypeError('Failed to fetch due to connection teardown');
    const fetchFn = vi.fn().mockRejectedValue(genericErr);

    const adapter = new HttpClientsAdapter({ fetchFn });
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.list('staff', { signal: controller.signal })).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        expect((err as ClientOperationError).code).toBe('aborted');
        return true;
      },
    );
  });

  it('maps fetch network failure to "network" code', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const adapter = new HttpClientsAdapter({ fetchFn });

    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ClientOperationError);
      expect((err as ClientOperationError).code).toBe('network');
      return true;
    });
  });

  it('rejects client when required nullable fields are omitted, undefined, or inherited (table-driven)', async () => {
    const requiredNullableFields = [
      'legalName',
      'panMasked',
      'gstinMasked',
      'email',
      'phone',
      'relationshipOwnerId',
      'relationshipOwnerName',
      'notes',
    ] as const;

    for (const field of requiredNullableFields) {
      // 1. Omitted from JSON object (missing own property key)
      const omittedCopy = { ...sampleClientDto };
      delete (omittedCopy as any)[field];

      const fetchOmitted = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: omittedCopy }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter1 = new HttpClientsAdapter({ fetchFn: fetchOmitted });
      await expect(adapter1.get('founder', sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.message).toContain(`missing required property "${field}"`);
        return true;
      });

      // 2. Set to undefined on in-memory object
      const fetchUndefined = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: {
            ...sampleClientDto,
            [field]: undefined,
          },
        }),
      } as unknown as Response);

      const adapter2 = new HttpClientsAdapter({ fetchFn: fetchUndefined });
      await expect(adapter2.get('founder', sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.message).toMatch(
          new RegExp(`(missing required property "${field}"|field "${field}" must be string or null)`),
        );
        return true;
      });

      // 3. Inherited property via prototype chain (must NOT be accepted as satisfying DTO)
      const { [field]: _omittedVal, ...restOfFields } = sampleClientDto;
      const proto = { [field]: null };
      const inheritedObject = Object.create(proto);
      Object.assign(inheritedObject, restOfFields);

      const fetchInherited = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: inheritedObject,
        }),
      } as unknown as Response);

      const adapter3 = new HttpClientsAdapter({ fetchFn: fetchInherited });
      await expect(adapter3.get('founder', sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.message).toContain(`missing required property "${field}"`);
        return true;
      });
    }
  });

  it('rejects hostile runtime role strings like toString and __proto__ locally as unauthorized without executing fetch', async () => {
    const hostileRoles = ['toString', '__proto__', 'valueOf', 'constructor', 'invalid_role'];

    for (const hostileRole of hostileRoles) {
      const fetchFn = vi.fn();
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(adapter.list(hostileRole as any)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unauthorized');
        expect(opErr.message).toContain(`Unknown company role: ${hostileRole}`);
        return true;
      });

      await expect(adapter.get(hostileRole as any, sampleClientDto.id)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unauthorized');
        expect(opErr.message).toContain(`Unknown company role: ${hostileRole}`);
        return true;
      });

      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  describe('caller request ID correlation fallback', () => {
    it('propagates caller requestId on pre-abort', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchFn = vi.fn();
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { signal: controller.signal, requestId: 'req-preabort' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('aborted');
        expect(opErr.requestId).toBe('req-preabort');
        return true;
      });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('propagates caller requestId on AbortError', async () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      const fetchFn = vi.fn().mockRejectedValue(abortErr);
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { requestId: 'req-aborterror' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('aborted');
        expect(opErr.requestId).toBe('req-aborterror');
        return true;
      });
    });

    it('propagates caller requestId on signal-aborted generic fetch error', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchFn = vi.fn().mockRejectedValue(new TypeError('Connection reset'));
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { signal: controller.signal, requestId: 'req-sigabort' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('aborted');
        expect(opErr.requestId).toBe('req-sigabort');
        return true;
      });
    });

    it('propagates caller requestId on network failure', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { requestId: 'req-network' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('network');
        expect(opErr.requestId).toBe('req-network');
        return true;
      });
    });

    it('propagates caller requestId on success envelope validation failure when response lacks header', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ notData: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { requestId: 'req-invalid-env' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.requestId).toBe('req-invalid-env');
        return true;
      });
    });

    it('propagates caller requestId on invalid JSON when response lacks header', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response('not-valid-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { requestId: 'req-invalid-json' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.requestId).toBe('req-invalid-json');
        return true;
      });
    });

    it('propagates caller requestId on non-OK response when response lacks header and body request ID', async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain' },
        }),
      );
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.list('founder', { requestId: 'req-non-ok' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.status).toBe(500);
        expect(opErr.requestId).toBe('req-non-ok');
        return true;
      });
    });

    it('prefers server header/body requestId over caller requestId on failure and success', async () => {
      // 1. Non-OK with body requestId
      const fetchWithBodyId = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'Forbidden' },
            requestId: 'srv-body-id',
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json', 'x-request-id': 'srv-hdr-id' },
          },
        ),
      );
      const adapter1 = new HttpClientsAdapter({ fetchFn: fetchWithBodyId });
      await expect(
        adapter1.list('founder', { requestId: 'caller-override' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        expect((err as ClientOperationError).requestId).toBe('srv-body-id');
        return true;
      });

      // 2. Proves success envelope requestId wins over response-header and caller on post-envelope DTO validation error
      const fetchSuccessEnvelopeWins = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ invalidDto: true }],
            requestId: 'env-id-precedence-wins',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'hdr-id-loses',
            },
          },
        ),
      );

      const adapter2 = new HttpClientsAdapter({ fetchFn: fetchSuccessEnvelopeWins });
      await expect(
        adapter2.list('founder', { requestId: 'caller-id-loses' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.requestId).toBe('env-id-precedence-wins');
        return true;
      });

      // 3. Proves response-header requestId wins over caller requestId when success envelope requestId is absent or invalid
      const fetchHeaderWinsAbsent = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ invalidDto: true }],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'hdr-id-wins-absent',
            },
          },
        ),
      );

      const adapter3 = new HttpClientsAdapter({ fetchFn: fetchHeaderWinsAbsent });
      await expect(
        adapter3.list('founder', { requestId: 'caller-id-loses' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.requestId).toBe('hdr-id-wins-absent');
        return true;
      });

      const fetchHeaderWinsInvalid = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ invalidDto: true }],
            requestId: '   ',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'hdr-id-wins-invalid',
            },
          },
        ),
      );

      const adapter4 = new HttpClientsAdapter({ fetchFn: fetchHeaderWinsInvalid });
      await expect(
        adapter4.list('founder', { requestId: 'caller-id-loses' }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ClientOperationError);
        const opErr = err as ClientOperationError;
        expect(opErr.code).toBe('unexpected');
        expect(opErr.requestId).toBe('hdr-id-wins-invalid');
        return true;
      });
    });

    it('executes default fetch path with globalThis receiver binding avoiding illegal invocation', async () => {
      const originalFetch = globalThis.fetch;
      let capturedUrl = '';
      let capturedHeaders: Headers | undefined;

      try {
        globalThis.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
          if (this !== globalThis) {
            throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
          }
          capturedUrl = String(input);
          capturedHeaders = new Headers(init?.headers);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [],
                requestId: 'req-bound-clients',
              }),
              {
                status: 200,
                headers: {
                  'content-type': 'application/json',
                  'x-request-id': 'req-bound-clients',
                },
              },
            ),
          );
        } as typeof fetch;

        // Instantiate without fetchFn injection
        const adapter = new HttpClientsAdapter();
        const items = await adapter.list('founder', { requestId: 'req-client-bind' });

        expect(items).toEqual([]);
        expect(capturedUrl).toBe('/api/v1/clients');
        expect(capturedHeaders?.get('x-demo-user-id')).toBe('00000000-0000-4000-a000-000000000001');
        expect(capturedHeaders?.get('x-request-id')).toBe('req-client-bind');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('creates client with POST /api/v1/clients and parses 201 ClientDto', async () => {
      let capturedMethod = '';
      let capturedUrl = '';
      let capturedBody = '';
      let capturedHeaders: Headers | undefined;

      const mockClientDto: ClientDto = {
        id: '90000000-0000-4000-a000-000000000099',
        code: 'CL-001099',
        displayName: 'Acme Advisory Services',
        legalName: 'Acme Advisory Services LLP',
        panMasked: '******1234',
        gstinMasked: '27**********1Z5',
        email: null,
        phone: null,
        relationshipOwnerId: null,
        relationshipOwnerName: null,
        status: 'active',
        notes: null,
        activeAssignmentsCount: 0,
        createdById: '00000000-0000-4000-a000-000000000001',
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      };

      const fetchFn = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? '';
        capturedBody = String(init?.body ?? '');
        capturedHeaders = new Headers(init?.headers);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: mockClientDto,
              requestId: 'req-create-success',
            }),
            {
              status: 201,
              headers: {
                'content-type': 'application/json',
                'x-request-id': 'req-create-success',
              },
            },
          ),
        );
      });

      const adapter = new HttpClientsAdapter({ fetchFn });
      const created = await adapter.create(
        'founder',
        {
          displayName: 'Acme Advisory Services',
          legalName: 'Acme Advisory Services LLP',
          pan: 'ABCDE1234F',
          gstin: '27ABCDE1234F1Z5',
          relationshipOwnerId: null,
        },
        { requestId: 'req-create-success' },
      );

      expect(capturedMethod).toBe('POST');
      expect(capturedUrl).toBe('/api/v1/clients');
      expect(capturedHeaders?.get('content-type')).toBe('application/json');
      expect(capturedHeaders?.get('x-demo-user-id')).toBe('00000000-0000-4000-a000-000000000001');
      expect(JSON.parse(capturedBody)).toEqual({
        displayName: 'Acme Advisory Services',
        legalName: 'Acme Advisory Services LLP',
        pan: 'ABCDE1234F',
        gstin: '27ABCDE1234F1Z5',
        relationshipOwnerId: null,
      });

      expect(created.id).toBe('90000000-0000-4000-a000-000000000099');
      expect(created.code).toBe('CL-001099');
      expect(created.displayName).toBe('Acme Advisory Services');
      expect(created.panMasked).toBe('******1234');
      expect(created.gstinMasked).toBe('27**********1Z5');
    });

    it('maps create error responses to sanitized ClientOperationError preserving safe metadata but stripping unsafe copy and causes', async () => {
      const errorCases = [
        {
          status: 401,
          body: { error: { code: 'session_expired', message: 'JWT token expired' }, requestId: 'req-err-401' },
          expectedCode: 'unauthorized',
          expectedMessage: 'Session expired. Please sign in again to continue.',
          expectedServerCode: 'session_expired',
        },
        {
          status: 403,
          body: { error: { code: 'role_not_permitted', message: 'Only Founder and Manager may create new clients.' }, requestId: 'req-err-403' },
          expectedCode: 'forbidden',
          expectedMessage: 'You do not have permission to create client records.',
          expectedServerCode: 'role_not_permitted',
        },
        {
          status: 409,
          body: { error: { code: 'duplicate_entity', message: 'Client already exists.' }, requestId: 'req-err-409' },
          expectedCode: 'conflict',
          expectedMessage: 'A client record with conflicting identifiers already exists in the directory.',
          expectedServerCode: 'duplicate_entity',
        },
        {
          status: 415,
          body: { error: { code: 'unsupported_media_type', message: 'Content-Type must be application/json' }, requestId: 'req-err-415' },
          expectedCode: 'validation',
          expectedMessage: 'The submitted client details could not be validated. Please check the entered fields.',
          expectedServerCode: 'unsupported_media_type',
        },
        {
          status: 422,
          body: { error: { code: 'validation_failed', message: 'Display name too short' }, requestId: 'req-err-422' },
          expectedCode: 'validation',
          expectedMessage: 'The submitted client details could not be validated. Please check the entered fields.',
          expectedServerCode: 'validation_failed',
        },
      ];

      for (const tc of errorCases) {
        const fetchFn = vi.fn().mockResolvedValue(
          new Response(JSON.stringify(tc.body), {
            status: tc.status,
            headers: { 'content-type': 'application/json', 'x-request-id': tc.body.requestId },
          }),
        );
        const adapter = new HttpClientsAdapter({ fetchFn });
        await expect(
          adapter.create('founder', { displayName: 'Test Entity' }),
        ).rejects.toMatchObject({
          code: tc.expectedCode,
          status: tc.status,
          serverCode: tc.expectedServerCode,
          requestId: tc.body.requestId,
          message: tc.expectedMessage,
        });
      }
    });

    it('sanitizes malicious server responses containing raw tax identifiers across message, requestId, serverCode, and cause', async () => {
      const maliciousBody = {
        error: {
          code: '27ABCDE1234F1Z5',
          message: 'Client with PAN ABCDE1234F and GSTIN 27ABCDE1234F1Z5 already registered by owner.',
          cause: 'Database error reflecting PAN ABCDE1234F',
        },
        requestId: 'ABCDE1234F',
      };

      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(maliciousBody), {
          status: 409,
          headers: { 'content-type': 'application/json', 'x-request-id': 'ABCDE1234F' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      let caughtError!: ClientOperationError;

      try {
        await adapter.create('founder', { displayName: 'Adversarial Client' });
      } catch (err: unknown) {
        caughtError = err as ClientOperationError;
      }

      expect(caughtError).toBeInstanceOf(ClientOperationError);
      expect(caughtError.code).toBe('conflict');
      expect(caughtError.status).toBe(409);

      // Raw tax IDs in requestId, serverCode, and message are completely stripped
      expect(caughtError.requestId).toBeUndefined();
      expect(caughtError.serverCode).toBeUndefined();
      expect(caughtError.message).toBe('A client record with conflicting identifiers already exists in the directory.');
      expect(caughtError.message).not.toContain('ABCDE1234F');
      expect(caughtError.message).not.toContain('27ABCDE1234F1Z5');

      // Unsafe cause is discarded
      expect(caughtError.cause).toBeUndefined();
    });

    it('preserves valid machine serverCode and conservative req-* support reference while stripping raw tax IDs', async () => {
      const legitBody = {
        error: {
          code: 'conflict',
          message: 'Conflict occurred',
        },
        requestId: 'req-support-trace-789',
      };

      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(legitBody), {
          status: 409,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-support-trace-789' },
        }),
      );

      const adapter = new HttpClientsAdapter({ fetchFn });
      let caughtError!: ClientOperationError;

      try {
        await adapter.create('founder', { displayName: 'Legit Error Client' });
      } catch (err: unknown) {
        caughtError = err as ClientOperationError;
      }

      expect(caughtError).toBeInstanceOf(ClientOperationError);
      expect(caughtError.code).toBe('conflict');
      expect(caughtError.serverCode).toBe('conflict');
      expect(caughtError.requestId).toBe('req-support-trace-789');
      expect(caughtError.message).toBe('A client record with conflicting identifiers already exists in the directory.');
    });

    it('unit tests metadata sanitization helpers: sanitizeServerCode and sanitizeRequestId', () => {
      // serverCode: conservative lower-snake-case ^[a-z][a-z0-9_]{0,63}$
      expect(sanitizeServerCode('client_code_conflict')).toBe('client_code_conflict');
      expect(sanitizeServerCode('validation')).toBe('validation');
      expect(sanitizeServerCode('already_exists_123')).toBe('already_exists_123');
      expect(sanitizeServerCode('ABCDE1234F')).toBeUndefined();
      expect(sanitizeServerCode('27ABCDE1234F1Z5')).toBeUndefined();
      expect(sanitizeServerCode('Invalid-Code')).toBeUndefined();
      expect(sanitizeServerCode('123_starts_with_digit')).toBeUndefined();
      expect(sanitizeServerCode('a'.repeat(65))).toBeUndefined();
      expect(sanitizeServerCode(undefined)).toBeUndefined();

      // requestId: RFC4122 UUID or req-, req_, req: form up to 80 chars
      expect(sanitizeRequestId('c636f955-c636-4000-a000-000000000001')).toBe('c636f955-c636-4000-a000-000000000001');
      expect(sanitizeRequestId('req-trace-001')).toBe('req-trace-001');
      expect(sanitizeRequestId('req_worker_42')).toBe('req_worker_42');
      expect(sanitizeRequestId('req:gateway-99.beta')).toBe('req:gateway-99.beta');
      expect(sanitizeRequestId('ABCDE1234F')).toBeUndefined();
      expect(sanitizeRequestId('27ABCDE1234F1Z5')).toBeUndefined();
      expect(sanitizeRequestId('arbitrary_id_without_prefix')).toBeUndefined();
      expect(sanitizeRequestId(`req-${'a'.repeat(80)}`)).toBeUndefined();
      expect(sanitizeRequestId(undefined)).toBeUndefined();
    });

    it('handles network failure during create with sanitized network error', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.create('founder', { displayName: 'Offline Client' }),
      ).rejects.toMatchObject({
        code: 'network',
        message: 'Unable to reach the server. Please check your network connection and try again.',
      });
    });

    it('rejects with unexpected error when 201 response contains invalid DTO', async () => {
      const invalid201 = {
        data: { id: 'not-a-uuid', displayName: '' },
        requestId: 'req-corrupt-201',
      };
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalid201), {
          status: 201,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-corrupt-201' },
        }),
      );
      const adapter = new HttpClientsAdapter({ fetchFn });

      await expect(
        adapter.create('founder', { displayName: 'Corrupt DTO Client' }),
      ).rejects.toMatchObject({
        code: 'unexpected',
        status: 201,
        requestId: 'req-corrupt-201',
        message: 'An unexpected error occurred while creating the client. Please try again.',
      });
    });

    it('rejects create operation with aborted error if signal is pre-aborted or in-flight aborted', async () => {
      // Pre-aborted
      const preController = new AbortController();
      preController.abort();

      const adapter = new HttpClientsAdapter({ fetchFn: vi.fn() });
      await expect(
        adapter.create('founder', { displayName: 'Pre-aborted Client' }, { signal: preController.signal }),
      ).rejects.toMatchObject({
        code: 'aborted',
        message: 'Client creation was cancelled.',
      });

      // In-flight abort
      const inFlightController = new AbortController();
      const inFlightFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The user aborted a request.');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const inFlightAdapter = new HttpClientsAdapter({ fetchFn: inFlightFetch });
      const createPromise = inFlightAdapter.create(
        'founder',
        { displayName: 'In-flight Abort Client' },
        { signal: inFlightController.signal },
      );
      inFlightController.abort();

      await expect(createPromise).rejects.toMatchObject({
        code: 'aborted',
        message: 'Client creation was cancelled.',
      });
    });
  });
});
