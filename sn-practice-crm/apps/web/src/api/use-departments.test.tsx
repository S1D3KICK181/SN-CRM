// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DepartmentDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { DeterministicTestDepartmentsAdapter } from './test-departments-adapter';
import { DepartmentsOperationError } from './departments-types';
import { useDepartments } from './use-departments';

const audit: DepartmentDto = {
  id: '60000000-0000-4000-a000-000000000001',
  name: 'Audit',
  isActive: true,
  members: [{ userId: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff', isHead: true }],
  serviceIds: ['50000000-0000-4000-a000-000000000002'],
  createdAt: '2026-11-01T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

const gst: DepartmentDto = {
  ...audit,
  id: '60000000-0000-4000-a000-000000000002',
  name: 'GST',
  members: [],
  serviceIds: [],
};

describe('useDepartments', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('loads the departments for %s', async (role) => {
    const port = new DeterministicTestDepartmentsAdapter();
    port.setDepartmentsResponse(role, [audit, gst]);

    const { result } = renderHook(() => useDepartments(role, { port }));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.departments).toEqual([audit, gst]);
    expect(port.calls).toEqual([expect.objectContaining({ role })]);
  });

  it('never loads anything for a Trainee, who has no department views', async () => {
    const port = new DeterministicTestDepartmentsAdapter();
    port.setDepartmentsResponse('trainee', [audit]);

    const { result } = renderHook(() => useDepartments('trainee', { port }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(0);
    expect(result.current.departments).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('does not load when disabled', async () => {
    const port = new DeterministicTestDepartmentsAdapter();
    const { result } = renderHook(() => useDepartments('founder', { port, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('suppresses data synchronously when the role drops to Trainee', async () => {
    const port = new DeterministicTestDepartmentsAdapter();
    port.setDepartmentsResponse('founder', [audit]);

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => useDepartments(role, { port }),
      { initialProps: { role: 'founder' as CompanyRole } },
    );
    await waitFor(() => expect(result.current.departments).toHaveLength(1));

    rerender({ role: 'trainee' });
    expect(result.current.departments).toEqual([]);
    expect(result.current.hasLiveSnapshot).toBe(false);
  });

  it('exposes a sanitized error and recovers on retry', async () => {
    const port = new DeterministicTestDepartmentsAdapter();
    port.setDefaultError(new DepartmentsOperationError({ code: 'network', message: 'raw socket text 10.0.0.5' }));

    const { result } = renderHook(() => useDepartments('manager', { port }));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.error?.message).toBe(
      'Unable to reach the server. Please check your network connection and try again.',
    );
    expect(result.current.error?.message).not.toContain('10.0.0.5');

    port.setDefaultError(undefined);
    port.setDepartmentsResponse('manager', [audit]);
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.departments).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it('keeps the last loaded departments when a retry fails', async () => {
    const port = new DeterministicTestDepartmentsAdapter();
    port.setDepartmentsResponse('founder', [audit]);

    const { result } = renderHook(() => useDepartments('founder', { port }));
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

    port.setDefaultError(new DepartmentsOperationError({ code: 'unexpected', message: 'boom' }));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.departments).toHaveLength(1);
    expect(result.current.hasLiveSnapshot).toBe(true);
  });

  it('ignores a stale response that resolves after the role changed', async () => {
    const port = new DeterministicTestDepartmentsAdapter();
    let releaseFounder: (value: DepartmentDto[]) => void = () => undefined;
    port.enqueueDeferredDepartments(new Promise<DepartmentDto[]>((resolve) => { releaseFounder = resolve; }));

    const { result, rerender } = renderHook(
      ({ role }: { role: CompanyRole }) => useDepartments(role, { port }),
      { initialProps: { role: 'founder' as CompanyRole } },
    );
    rerender({ role: 'trainee' });
    await act(async () => {
      releaseFounder([audit]);
    });
    expect(result.current.departments).toEqual([]);
  });
});

describe('useDepartments mutations', () => {
  afterEach(() => {
    cleanup();
  });

  async function setup(role: CompanyRole = 'founder') {
    const port = new DeterministicTestDepartmentsAdapter();
    port.setDepartmentsResponse(role, [audit]);
    port.setMutationDepartment(gst);
    const hook = renderHook(() => useDepartments(role, { port }));
    await waitFor(() => expect(hook.result.current.hasLiveSnapshot).toBe(true));
    return { port, ...hook };
  }

  it('creating a department sends the key and reloads the list', async () => {
    const { port, result } = await setup();
    const before = port.calls.length;
    port.setDepartmentsResponse('founder', [audit, gst]);
    let created: DepartmentDto | undefined;
    await act(async () => {
      created = await result.current.createDepartment({ name: 'GST' }, 'key-1');
    });
    expect(created).toEqual(gst);
    expect(port.mutations).toEqual([
      { kind: 'create-department', role: 'founder', input: { name: 'GST' }, idempotencyKey: 'key-1' },
    ]);
    expect(port.calls.length).toBe(before + 1);
    expect(result.current.departments).toEqual([audit, gst]);
  });

  it('updating a department sends the id, the body and the key, then reloads the list', async () => {
    const { port, result } = await setup();
    const before = port.calls.length;
    const input = { isActive: false, expectedUpdatedAt: audit.updatedAt };
    await act(async () => {
      await result.current.updateDepartment(audit.id, input, 'key-2');
    });
    expect(port.mutations).toEqual([
      { kind: 'update-department', role: 'founder', targetId: audit.id, input, idempotencyKey: 'key-2' },
    ]);
    expect(port.calls.length).toBe(before + 1);
  });

  it('replacing the members sends the whole list and the key, then reloads the list', async () => {
    const { port, result } = await setup();
    const before = port.calls.length;
    const input = { members: [{ userId: '00000000-0000-4000-a000-000000000004', isHead: false }] };
    await act(async () => {
      await result.current.setDepartmentMembers(audit.id, input, 'key-3');
    });
    expect(port.mutations).toEqual([
      { kind: 'set-members', role: 'founder', targetId: audit.id, input, idempotencyKey: 'key-3' },
    ]);
    expect(port.calls.length).toBe(before + 1);
  });

  it('a failed mutation throws a sanitized error and does not reload', async () => {
    const { port, result } = await setup();
    port.setMutationError(
      new DepartmentsOperationError({ code: 'unexpected', message: 'raw stack', status: 409, serverCode: 'duplicate_department' }),
    );
    const before = port.calls.length;
    let caught: unknown;
    await act(async () => {
      caught = await result.current.createDepartment({ name: 'Audit' }, 'key-1').catch((err: unknown) => err);
    });
    expect(caught).toBeInstanceOf(DepartmentsOperationError);
    expect((caught as DepartmentsOperationError).serverCode).toBe('duplicate_department');
    expect((caught as DepartmentsOperationError).message).not.toContain('raw stack');
    expect(port.calls.length).toBe(before);
  });

  it.each(['manager', 'senior_staff', 'staff', 'trainee'] as const)(
    'refuses to change anything for %s without touching the port',
    async (role) => {
      const port = new DeterministicTestDepartmentsAdapter();
      const { result } = renderHook(() => useDepartments(role, { port }));
      const outcomes: unknown[] = [];
      await act(async () => {
        outcomes.push(await result.current.createDepartment({ name: 'GST' }, 'k1').catch((err: unknown) => err));
        outcomes.push(
          await result.current
            .updateDepartment(audit.id, { isActive: false, expectedUpdatedAt: audit.updatedAt }, 'k2')
            .catch((err: unknown) => err),
        );
        outcomes.push(await result.current.setDepartmentMembers(audit.id, { members: [] }, 'k3').catch((err: unknown) => err));
      });
      for (const outcome of outcomes) expect((outcome as DepartmentsOperationError).code).toBe('forbidden');
      expect(port.mutations).toHaveLength(0);
    },
  );
});
