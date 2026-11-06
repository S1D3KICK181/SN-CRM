import { describe, expect, it, vi } from 'vitest';
import type { CreateWorkItemInput, WorkItemDto } from '@sn/contracts';
import { HttpWorkItemsAdapter } from './http-work-items-adapter';
import { WorkItemOperationError } from './work-items-types';

describe('HttpWorkItemsAdapter', () => {
  const sampleDto: WorkItemDto = {
    id: 'wrk_001',
    code: 'WI-001001',
    kind: 'delegated',
    title: 'Verify TDS challan',
    notes: 'Verify 281 challans',
    assignmentId: 'asg_tds',
    relatedClientId: 'cli_01',
    relatedPartyName: 'Sample Client',
    assigneeId: 'usr_trainee',
    createdById: 'usr_staff',
    status: 'todo',
    dueAt: '2026-11-04T12:30:00.000Z',
    reminderAt: null,
    createdAt: '2026-11-01T04:00:00.000Z',
    updatedAt: '2026-11-01T04:00:00.000Z',
  };

  it('lists work items with explicit role header and unwrap envelope', async () => {
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = new Headers(init.headers);
      return new Response(
        JSON.stringify({
          data: [sampleDto],
          requestId: 'req_list_123',
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_list_123' } },
      );
    });

    const adapter = new HttpWorkItemsAdapter({ baseUrl: 'http://localhost:3000', fetchFn });
    const items = await adapter.list('staff', { requestId: 'req_client_1' });

    expect(capturedUrl).toBe('http://localhost:3000/api/v1/work-items');
    expect(capturedHeaders?.get('x-demo-user-id')).toBe('00000000-0000-4000-a000-000000000004');
    expect(capturedHeaders?.get('x-request-id')).toBe('req_client_1');
    expect(items).toEqual([sampleDto]);
  });

  it('creates work item sending json body and returning created dto', async () => {
    let capturedBody = '';
    let capturedMethod = '';
    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedMethod = init.method ?? 'GET';
      capturedHeaders = new Headers(init.headers);
      capturedBody = init.body as string;
      return new Response(
        JSON.stringify({
          data: sampleDto,
          requestId: 'req_create_456',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const adapter = new HttpWorkItemsAdapter({ baseUrl: 'http://localhost:3000', fetchFn });
    const input: CreateWorkItemInput = {
      kind: 'delegated',
      title: 'Verify TDS challan',
      assignmentId: 'asg_tds',
      assigneeId: 'usr_trainee',
      dueAt: '2026-11-04T12:30:00.000Z',
    };

    const created = await adapter.create('staff', input);
    expect(capturedMethod).toBe('POST');
    expect(capturedHeaders?.get('x-demo-user-id')).toBe('00000000-0000-4000-a000-000000000004');
    expect(capturedHeaders?.get('content-type')).toBe('application/json');
    expect(JSON.parse(capturedBody)).toEqual(input);
    expect(created).toEqual(sampleDto);
  });

  it('transitions work item via POST /api/v1/work-items/:id/transitions', async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const fetchFn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return new Response(
        JSON.stringify({
          data: { ...sampleDto, status: 'in_progress' },
          requestId: 'req_trans_789',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const adapter = new HttpWorkItemsAdapter({ baseUrl: 'http://localhost:3000', fetchFn });
    const updated = await adapter.transition('trainee', 'wrk_001', 'start');

    expect(capturedUrl).toBe('http://localhost:3000/api/v1/work-items/wrk_001/transitions');
    expect(JSON.parse(capturedBody)).toEqual({ action: 'start' });
    expect(updated.status).toBe('in_progress');
  });

  it('maps 401, 403, 404, 409, 422 to strongly-typed WorkItemOperationError', async () => {
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
            error: { code: 'server_code', message: `Server error ${status}` },
            requestId: `req_${status}`,
          }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
      );

      const adapter = new HttpWorkItemsAdapter({ fetchFn });
      await expect(adapter.list('staff')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        const opErr = err as WorkItemOperationError;
        expect(opErr.code).toBe(code);
        expect(opErr.status).toBe(status);
        expect(opErr.requestId).toBe(`req_${status}`);
        expect(opErr.serverCode).toBe('server_code');
        expect(opErr.message).toBe(`Server error ${status}`);
        return true;
      });
    }
  });

  it('maps AbortError or aborted signal to "aborted" code', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    const fetchFn = vi.fn().mockRejectedValue(abortErr);

    const adapter = new HttpWorkItemsAdapter({ fetchFn });
    const controller = new AbortController();
    controller.abort();

    await expect(adapter.list('staff', { signal: controller.signal })).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(WorkItemOperationError);
        expect((err as WorkItemOperationError).code).toBe('aborted');
        return true;
      },
    );
  });

  it('maps fetch network failure to "network" code', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const adapter = new HttpWorkItemsAdapter({ fetchFn });

    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(WorkItemOperationError);
      expect((err as WorkItemOperationError).code).toBe('network');
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
              requestId: 'req-bound-work-items',
            }),
            {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'x-request-id': 'req-bound-work-items',
              },
            },
          ),
        );
      } as typeof fetch;

      // Instantiate without fetchFn injection
      const adapter = new HttpWorkItemsAdapter();
      const items = await adapter.list('staff', { requestId: 'req-work-bind' });

      expect(items).toEqual([]);
      expect(capturedUrl).toBe('/api/v1/work-items');
      expect(capturedHeaders?.get('x-demo-user-id')).toBe('00000000-0000-4000-a000-000000000004');
      expect(capturedHeaders?.get('x-request-id')).toBe('req-work-bind');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
