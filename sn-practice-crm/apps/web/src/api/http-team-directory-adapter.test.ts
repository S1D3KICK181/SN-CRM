import { describe, expect, it, vi } from 'vitest';
import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { HttpTeamDirectoryAdapter } from './http-team-directory-adapter';
import { TeamDirectoryOperationError } from './team-directory-types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

describe('HttpTeamDirectoryAdapter', () => {
  const sampleFounderLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    },
    manager: null,
  };

  const sampleManagerLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000001',
      name: 'S. Narayanan',
      role: 'founder',
      reportsToId: null,
    },
  };

  const sampleSeniorLine: ReportingLineDto = {
    employee: {
      id: '00000000-0000-4000-a000-000000000003',
      name: 'Priya Desai',
      role: 'senior_staff',
      reportsToId: '00000000-0000-4000-a000-000000000002',
    },
    manager: {
      id: '00000000-0000-4000-a000-000000000002',
      name: 'Ananya Rao',
      role: 'manager',
      reportsToId: '00000000-0000-4000-a000-000000000001',
    },
  };

  it('sends correct demo actor role header for all five roles', async () => {
    const roles: CompanyRole[] = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'];

    for (const role of roles) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [sampleFounderLine, sampleManagerLine],
            requestId: 'req-test-1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const adapter = new HttpTeamDirectoryAdapter({ fetchFn });
      const result = await adapter.list(role);

      expect(result).toHaveLength(2);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/reporting-lines');
      expect(init.method).toBe('GET');

      const headers = new Headers(init.headers);
      expect(headers.get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID[role]);
    }
  });

  it('preserves browser fetch receiver binding without illegal invocation errors', async () => {
    const mockWindow = {
      isWindow: true,
      fetch(this: unknown, _input?: RequestInfo | URL, _init?: RequestInit) {
        if (!this || (this as { isWindow?: boolean }).isWindow !== true) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return Promise.resolve(
          new Response(JSON.stringify({ data: [sampleFounderLine], requestId: 'req-fetch-receiver' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    };

    const adapter = new HttpTeamDirectoryAdapter({
      fetchFn: (input, init) => mockWindow.fetch.call(mockWindow, input, init),
    });

    const items = await adapter.list('founder');
    expect(items).toHaveLength(1);
    expect(items[0]!.employee.name).toBe('S. Narayanan');
  });

  it('parses valid reporting lines successfully', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [sampleFounderLine, sampleManagerLine, sampleSeniorLine],
          requestId: 'req-lines-valid',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new HttpTeamDirectoryAdapter({ fetchFn });
    const items = await adapter.list('manager');

    expect(items).toEqual([sampleFounderLine, sampleManagerLine, sampleSeniorLine]);
  });

  it('normalizes HTTP errors into sanitized TeamDirectoryOperationError', async () => {
    const errorCases = [
      { status: 401, expectedCode: 'unauthorized', expectedMessage: 'Session expired. Please sign in again to view the practice team.' },
      { status: 403, expectedCode: 'forbidden', expectedMessage: 'You do not have permission to view the team directory.' },
      { status: 404, expectedCode: 'not_found', expectedMessage: 'The team directory service could not be located.' },
      { status: 500, expectedCode: 'unexpected', expectedMessage: 'An unexpected error occurred while loading the team directory. Please try again.' },
    ];

    for (const ec of errorCases) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'server_failure', message: 'Internal raw stack trace' },
          }),
          { status: ec.status, headers: { 'content-type': 'application/json' } },
        ),
      );

      const adapter = new HttpTeamDirectoryAdapter({ fetchFn });
      let caught!: TeamDirectoryOperationError;

      try {
        await adapter.list('founder');
      } catch (err: unknown) {
        caught = err as TeamDirectoryOperationError;
      }

      expect(caught).toBeInstanceOf(TeamDirectoryOperationError);
      expect(caught.code).toBe(ec.expectedCode);
      expect(caught.status).toBe(ec.status);
      expect(caught.message).toBe(ec.expectedMessage);
      // Raw internal text is never leaked
      expect(caught.message).not.toContain('Internal raw stack trace');
    }
  });

  it('handles network failure with sanitized error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const adapter = new HttpTeamDirectoryAdapter({ fetchFn });

    await expect(adapter.list('founder')).rejects.toMatchObject({
      code: 'network',
      message: 'Unable to reach the server. Please check your network connection and try again.',
    });
  });

  it('handles pre-aborted and in-flight aborted signals', async () => {
    const preController = new AbortController();
    preController.abort();

    const fetchFn = vi.fn();
    const adapter = new HttpTeamDirectoryAdapter({ fetchFn });

    await expect(
      adapter.list('founder', { signal: preController.signal }),
    ).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchFn).not.toHaveBeenCalled();

    const inFlightController = new AbortController();
    const slowFetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          inFlightController.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const adapter2 = new HttpTeamDirectoryAdapter({ fetchFn: slowFetch });
    const listPromise = adapter2.list('founder', { signal: inFlightController.signal });

    inFlightController.abort();

    await expect(listPromise).rejects.toMatchObject({
      code: 'aborted',
    });
  });

  it('rejects corrupt response envelopes and malformed DTOs', async () => {
    const corruptCases = [
      { body: 'not-json', label: 'non-JSON body' },
      { body: JSON.stringify({ noData: true }), label: 'missing data field' },
      { body: JSON.stringify({ data: 'not-array' }), label: 'data is string' },
      { body: JSON.stringify({ data: [{ employee: { id: 'bad-uuid', name: 'A', role: 'staff', reportsToId: null }, manager: null }] }), label: 'bad employee UUID' },
      { body: JSON.stringify({ data: [{ employee: { id: '00000000-0000-4000-a000-000000000001', name: '', role: 'staff', reportsToId: null }, manager: null }] }), label: 'empty name' },
      { body: JSON.stringify({ data: [{ employee: { id: '00000000-0000-4000-a000-000000000001', name: 'A', role: 'invalid_role', reportsToId: null }, manager: null }] }), label: 'invalid role' },
      { body: JSON.stringify({ data: [{ employee: { id: '00000000-0000-4000-a000-000000000001', name: 'A', role: 'staff' }, manager: null }] }), label: 'missing reportsToId property' },
      { body: JSON.stringify({ data: [{ employee: { id: '00000000-0000-4000-a000-000000000001', name: 'A', role: 'staff', reportsToId: null } }] }), label: 'missing manager property' },
      { body: JSON.stringify({ data: [{ employee: { id: '00000000-0000-4000-a000-000000000001', name: 'A', role: 'staff', reportsToId: null }, manager: { id: 'bad-uuid', name: 'B', role: 'manager', reportsToId: null } }] }), label: 'corrupt manager UUID' },
    ];

    for (const cc of corruptCases) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(cc.body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const adapter = new HttpTeamDirectoryAdapter({ fetchFn });
      await expect(adapter.list('founder')).rejects.toMatchObject({
        code: 'unexpected',
        message: 'An unexpected error occurred while loading the team directory. Please try again.',
      });
    }
  });

  it('uses Authorization: Bearer token in production mode and omits x-demo-user-id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [sampleFounderLine], requestId: 'req-prod-auth' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const adapter = new HttpTeamDirectoryAdapter({
      fetchFn,
      getAccessToken: () => 'test-bearer-token-123',
    });

    const items = await adapter.list('founder');
    expect(items).toHaveLength(1);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer test-bearer-token-123');
    expect(headers.has('x-demo-user-id')).toBe(false);
  });

  it('uses authSource to retrieve Bearer token and omits x-demo-user-id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [sampleFounderLine], requestId: 'req-auth-source' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const mockAuthSource = {
      getSession: vi.fn().mockResolvedValue({
        accessToken: 'supabase-jwt-456',
        user: { id: '00000000-0000-4000-a000-000000000001', email: 'test@practice.com' },
      }),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      signInWithPassword: vi.fn(),
    };

    const adapter = new HttpTeamDirectoryAdapter({
      fetchFn,
      authSource: mockAuthSource as any,
    });

    const items = await adapter.list('manager');
    expect(items).toHaveLength(1);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer supabase-jwt-456');
    expect(headers.has('x-demo-user-id')).toBe(false);
  });

  it('fails locally closed with unauthorized when token source resolves null, blank, or throws', async () => {
    const fetchFn = vi.fn();

    // 1. null token
    const adapterNull = new HttpTeamDirectoryAdapter({
      fetchFn,
      getAccessToken: () => null,
    });
    await expect(adapterNull.list('founder')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Session expired. Please sign in again to view the practice team.',
    });
    expect(fetchFn).not.toHaveBeenCalled();

    // 2. blank token
    const adapterBlank = new HttpTeamDirectoryAdapter({
      fetchFn,
      getAccessToken: () => '   ',
    });
    await expect(adapterBlank.list('founder')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Session expired. Please sign in again to view the practice team.',
    });
    expect(fetchFn).not.toHaveBeenCalled();

    // 3. throwing token source
    const adapterThrow = new HttpTeamDirectoryAdapter({
      fetchFn,
      getAccessToken: () => {
        throw new Error('Keychain locked');
      },
    });
    await expect(adapterThrow.list('founder')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Session expired. Please sign in again to view the practice team.',
    });
    expect(fetchFn).not.toHaveBeenCalled();

    // 4. authSource resolves null session
    const adapterAuthNull = new HttpTeamDirectoryAdapter({
      fetchFn,
      authSource: {
        getSession: vi.fn().mockResolvedValue(null),
        onAuthStateChange: vi.fn(),
        refreshSession: vi.fn(),
        signOut: vi.fn(),
        signInWithPassword: vi.fn(),
      },
    });
    await expect(adapterAuthNull.list('founder')).rejects.toMatchObject({
      code: 'unauthorized',
      message: 'Session expired. Please sign in again to view the practice team.',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('aborts cleanly when signal is aborted while token resolution is pending', async () => {
    const fetchFn = vi.fn();
    const controller = new AbortController();

    let resolveToken!: (t: string) => void;
    const tokenPromise = new Promise<string>((res) => {
      resolveToken = res;
    });

    const adapter = new HttpTeamDirectoryAdapter({
      fetchFn,
      getAccessToken: () => tokenPromise,
    });

    const listPromise = adapter.list('founder', { signal: controller.signal });
    controller.abort();
    resolveToken('token-arrived-too-late');

    await expect(listPromise).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
