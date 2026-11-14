import { describe, expect, it, vi } from 'vitest';
import type { DepartmentDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { HttpDepartmentsAdapter } from './http-departments-adapter';
import { DepartmentsOperationError, departmentSaveErrorMessage } from './departments-types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

const department: DepartmentDto = {
  id: '60000000-0000-4000-a000-000000000001',
  name: 'Audit',
  isActive: true,
  members: [
    { userId: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff', isHead: true },
    { userId: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee', isHead: false },
  ],
  serviceIds: ['50000000-0000-4000-a000-000000000002'],
  createdAt: '2026-11-01T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

function okResponse(data: unknown, status = 200, requestId = 'req-department-1'): Response {
  return new Response(JSON.stringify({ data, requestId }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterFor(data: unknown, status = 200) {
  const fetchFn = vi.fn().mockResolvedValue(okResponse(data, status));
  return { fetchFn, adapter: new HttpDepartmentsAdapter({ fetchFn }) };
}

describe('HttpDepartmentsAdapter', () => {
  it('calls the departments route with the demo actor header for the role', async () => {
    const roles: CompanyRole[] = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'];
    for (const role of roles) {
      const { adapter, fetchFn } = adapterFor([department]);
      await adapter.listDepartments(role);
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/departments');
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID[role]);
    }
  });

  it('uses a Bearer token when a token source is configured and never falls back to the demo header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([department]));
    const adapter = new HttpDepartmentsAdapter({ fetchFn, getAccessToken: () => ' token-123 ' });
    await adapter.listDepartments('founder');
    const headers = new Headers((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-123');
    expect(headers.get('x-demo-user-id')).toBeNull();

    const blankFetch = vi.fn();
    const blank = new HttpDepartmentsAdapter({ fetchFn: blankFetch, getAccessToken: () => null });
    await expect(blank.listDepartments('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(blankFetch).not.toHaveBeenCalled();
  });

  it('parses valid departments unchanged, including one with nothing in it', async () => {
    const empty: DepartmentDto = { ...department, isActive: false, members: [], serviceIds: [] };
    const departments = await adapterFor([department, empty]).adapter.listDepartments('founder');
    expect(departments).toEqual([department, empty]);
  });

  it('rejects a response whose data is not an array and an envelope without data', async () => {
    await expect(adapterFor({ nope: true }).adapter.listDepartments('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'req-1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(new HttpDepartmentsAdapter({ fetchFn }).listDepartments('founder')).rejects.toBeInstanceOf(
      DepartmentsOperationError,
    );
  });

  it.each([
    ['a missing field', (dto: Record<string, unknown>) => { delete dto['isActive']; }],
    ['a non-UUID id', (dto: Record<string, unknown>) => { dto['id'] = 'DEPT-001'; }],
    ['a blank name', (dto: Record<string, unknown>) => { dto['name'] = '  '; }],
    ['members that are not a list', (dto: Record<string, unknown>) => { dto['members'] = {}; }],
    ['a member with an unknown role', (dto: Record<string, unknown>) => {
      dto['members'] = [{ userId: '00000000-0000-4000-a000-000000000003', name: 'A', role: 'janitor', isHead: false }];
    }],
    ['a member with a non-UUID user id', (dto: Record<string, unknown>) => {
      dto['members'] = [{ userId: 'u1', name: 'A', role: 'staff', isHead: false }];
    }],
    ['a member with a string head flag', (dto: Record<string, unknown>) => {
      dto['members'] = [{ userId: '00000000-0000-4000-a000-000000000003', name: 'A', role: 'staff', isHead: 'yes' }];
    }],
    ['service ids that are not UUIDs', (dto: Record<string, unknown>) => { dto['serviceIds'] = ['svc-1']; }],
    ['missing service ids', (dto: Record<string, unknown>) => { delete dto['serviceIds']; }],
    ['a malformed timestamp', (dto: Record<string, unknown>) => { dto['updatedAt'] = 'yesterday'; }],
  ])('rejects a department with %s', async (_name, mutate) => {
    const bad = structuredClone(department) as unknown as Record<string, unknown>;
    mutate(bad);
    await expect(adapterFor([bad]).adapter.listDepartments('founder')).rejects.toMatchObject({ code: 'unexpected' });
  });

  it('normalizes HTTP errors into sanitized errors without leaking server text', async () => {
    const cases = [
      { status: 401, code: 'unauthorized', message: 'Session expired. Please sign in again to manage departments.' },
      { status: 403, code: 'forbidden', message: 'You do not have permission to manage departments.' },
      { status: 404, code: 'not_found', message: 'The department could not be located.' },
      { status: 500, code: 'unexpected', message: 'Something went wrong with the departments. Please try again.' },
    ];
    for (const c of cases) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'server_failure', message: 'Internal raw stack trace' } }), {
          status: c.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const caught = await new HttpDepartmentsAdapter({ fetchFn }).listDepartments('founder').catch((err: unknown) => err);
      expect(caught).toBeInstanceOf(DepartmentsOperationError);
      const error = caught as DepartmentsOperationError;
      expect(error.code).toBe(c.code);
      expect(error.status).toBe(c.status);
      expect(error.serverCode).toBe('server_failure');
      expect(error.message).toBe(c.message);
      expect(error.message).not.toContain('Internal raw stack trace');
    }
  });

  it('handles network failure, pre-aborted and in-flight aborted signals', async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError('Failed to fetch https://secret.example'));
    await expect(new HttpDepartmentsAdapter({ fetchFn: failing }).listDepartments('founder')).rejects.toMatchObject({
      code: 'network',
      message: 'Unable to reach the server. Please check your network connection and try again.',
    });

    const pre = new AbortController();
    pre.abort();
    const fetchFn = vi.fn();
    await expect(
      new HttpDepartmentsAdapter({ fetchFn }).listDepartments('founder', { signal: pre.signal }),
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
    const pending = new HttpDepartmentsAdapter({ fetchFn: slowFetch }).listDepartments('founder', {
      signal: inFlight.signal,
    });
    inFlight.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('prefixes the configured base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([]));
    await new HttpDepartmentsAdapter({ fetchFn, baseUrl: 'http://127.0.0.1:4321/' }).listDepartments('founder');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:4321/api/v1/departments');
  });
});

describe('HttpDepartmentsAdapter mutations', () => {
  it('POSTs a new department with the Idempotency-Key and parses the created department', async () => {
    const { adapter, fetchFn } = adapterFor(department, 201);
    const created = await adapter.createDepartment('founder', { name: 'Audit' }, '  key-1  ');
    expect(created).toEqual(department);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/departments');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('idempotency-key')).toBe('key-1');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Audit' });
  });

  it('PATCHes an existing department by id with the update body', async () => {
    const { adapter, fetchFn } = adapterFor({ ...department, isActive: false });
    const updated = await adapter.updateDepartment(
      'founder',
      department.id,
      { isActive: false, expectedUpdatedAt: department.updatedAt },
      'key-2',
    );
    expect(updated.isActive).toBe(false);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/departments/${department.id}`);
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('key-2');
    expect(JSON.parse(String(init.body))).toEqual({ isActive: false, expectedUpdatedAt: department.updatedAt });
  });

  it('PUTs the whole membership to the members route', async () => {
    const { adapter, fetchFn } = adapterFor(department);
    const members = { members: [{ userId: '00000000-0000-4000-a000-000000000003', isHead: true }] };
    await adapter.setDepartmentMembers('founder', department.id, members, 'key-3');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/departments/${department.id}/members`);
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('key-3');
    expect(JSON.parse(String(init.body))).toEqual(members);
  });

  it('refuses a blank or oversized Idempotency-Key before sending', async () => {
    const { adapter, fetchFn } = adapterFor(department, 201);
    await expect(adapter.createDepartment('founder', { name: 'Audit' }, '   ')).rejects.toMatchObject({ code: 'unexpected' });
    await expect(adapter.createDepartment('founder', { name: 'Audit' }, 'k'.repeat(256))).rejects.toMatchObject({
      code: 'unexpected',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the safe server code on conflicts so the dialog can show its message', async () => {
    for (const [status, code] of [
      [409, 'duplicate_department'],
      [409, 'stale_department'],
      [422, 'trainee_cannot_head'],
    ] as const) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code, message: 'raw server text' } }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const error = await new HttpDepartmentsAdapter({ fetchFn })
        .createDepartment('founder', { name: 'Audit' }, 'key-4')
        .catch((err: unknown) => err);
      expect(error).toBeInstanceOf(DepartmentsOperationError);
      expect(error).toMatchObject({ status, serverCode: code });
      expect((error as Error).message).not.toContain('raw server text');
    }
  });

  it('rejects a malformed created department', async () => {
    const { adapter } = adapterFor({ id: department.id }, 201);
    await expect(adapter.createDepartment('founder', { name: 'Audit' }, 'key-5')).rejects.toMatchObject({
      code: 'unexpected',
    });
  });
});

describe('departmentSaveErrorMessage', () => {
  const failure = (serverCode: string, status: number) =>
    new DepartmentsOperationError({ code: 'unexpected', message: 'raw', status, serverCode });

  it('gives fixed copy for the known conflicts and never reflects server text', () => {
    expect(departmentSaveErrorMessage(failure('duplicate_department', 409), 'Audit')).toBe(
      'A department named Audit already exists.',
    );
    expect(departmentSaveErrorMessage(failure('stale_department', 409), 'Audit')).toBe(
      'This department was changed by someone else. Reload and try again.',
    );
    expect(departmentSaveErrorMessage(failure('trainee_cannot_head', 422), 'Audit')).toBe("Trainees can't be heads.");
    expect(departmentSaveErrorMessage(new DepartmentsOperationError({ code: 'forbidden', message: 'x', status: 403 }), 'Audit')).toBe(
      "You don't have permission to do this.",
    );
    expect(departmentSaveErrorMessage(new Error('socket 10.0.0.5'), 'Audit')).toBe(
      'Something went wrong with the departments. Please try again.',
    );
  });
});
