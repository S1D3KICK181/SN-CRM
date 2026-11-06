import { describe, expect, it } from 'vitest';
import type { AssignmentDto } from '@sn/contracts';
import { HttpAssignmentsAdapter } from './http-adapter';
import {
  mapDtoToAssignmentRow,
  mapStatusTransitionToAction,
  normalizeLifecycleStage,
} from './mapper';
import { AssignmentOperationError } from './types';

function createMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200, requestId = 'req-test-123'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
  });
}

const SAMPLE_DTO: AssignmentDto = {
  id: '30000000-0000-4000-a000-000000000001',
  code: 'AS-001001',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientName: 'Aster Foods Private Limited',
  serviceId: '50000000-0000-4000-a000-000000000001',
  service: 'GST Compliance',
  title: 'GSTR-1 & 3B Compliance · Oct 2026',
  ownerId: '00000000-0000-4000-a000-000000000003',
  reviewerIds: ['00000000-0000-4000-a000-000000000002'],
  status: 'in_progress',
  dueAt: '2026-11-11T12:30:00.000Z',
  recurringScheduleId: '20000000-0000-4000-a000-000000000001',
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-10-29T09:15:00.000Z',
};

describe('HttpAssignmentsAdapter', () => {
  it('maps all five actor roles to exact insecure dev x-demo-user-id headers', async () => {
    const recordedHeaders: Record<string, string | null | undefined> = {};

    const mockFetch = createMockFetch((_url, init) => {
      const headers = new Headers(init?.headers);
      recordedHeaders['lastRole'] = headers.get('x-demo-user-id');
      return jsonResponse({ data: [SAMPLE_DTO], requestId: 'req-actors' });
    });

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });

    await adapter.list('founder');
    expect(recordedHeaders['lastRole']).toBe('00000000-0000-4000-a000-000000000001');

    await adapter.list('manager');
    expect(recordedHeaders['lastRole']).toBe('00000000-0000-4000-a000-000000000002');

    await adapter.list('senior_staff');
    expect(recordedHeaders['lastRole']).toBe('00000000-0000-4000-a000-000000000003');

    await adapter.list('staff');
    expect(recordedHeaders['lastRole']).toBe('00000000-0000-4000-a000-000000000004');

    await adapter.list('trainee');
    expect(recordedHeaders['lastRole']).toBe('00000000-0000-4000-a000-000000000005');
  });

  it('unwraps response envelopes and deterministically maps AssignmentDto to AssignmentRow', async () => {
    const mockFetch = createMockFetch((url) => {
      expect(url).toBe('/api/v1/assignments');
      return jsonResponse({ data: [SAMPLE_DTO], requestId: 'req-map' });
    });

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    const rows = await adapter.list('senior_staff');

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe('30000000-0000-4000-a000-000000000001');
    expect(row.title).toBe('GSTR-1 & 3B Compliance · Oct 2026');
    expect(row.client).toBe('Aster Foods Private Limited');
    expect(row.clientId).toBe('10000000-0000-4000-a000-000000000001');
    expect(row.service).toBe('GST Compliance');
    expect(row.owner).toBe('Ananya Rao');
    expect(row.reviewer).toBe('Priya Desai');
    expect(row.status).toBe('In progress');
    expect(row.progress).toBe(50);
    expect(row.tone).toBe('default');
    expect(row.due).toBe('11/11/2026');
  });

  it('converts create command to contract payload and returns authoritative row', async () => {
    let capturedBody: any = null;
    let capturedUrl = '';
    let capturedMethod = '';

    const mockFetch = createMockFetch((url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? 'GET';
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse({ data: SAMPLE_DTO, requestId: 'req-create' }, 201);
    });

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    const created = await adapter.create('founder', {
      clientId: 'CLI-0001',
      clientName: 'Aster Foods Private Limited',
      title: 'October GST return',
      service: 'GST compliance',
      ownerNameOrId: 'Ananya Rao',
      reviewerNameOrId: 'Priya Desai',
      dueDate: '11/11/2026',
    });

    expect(capturedUrl).toBe('/api/v1/assignments');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody.clientId).toBe('10000000-0000-4000-a000-000000000001');
    expect(capturedBody.clientName).toBeUndefined();
    expect(capturedBody.title).toBe('October GST return');
    expect(capturedBody.service).toBe('GST compliance');
    expect(capturedBody.ownerId).toBe('00000000-0000-4000-a000-000000000003');
    expect(capturedBody.reviewerIds).toEqual(['00000000-0000-4000-a000-000000000002']);
    expect(capturedBody.dueAt).toContain('2026-11-11');
    expect(created.id).toBe('30000000-0000-4000-a000-000000000001');
  });

  it('executes status transition against exact path, body, and actor authority', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: any = null;

    const mockFetch = createMockFetch((url, init) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? 'GET';
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse({
        data: { ...SAMPLE_DTO, status: 'ready_for_review' },
        requestId: 'req-trans',
      });
    });

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    const updated = await adapter.transition('senior_staff', '30000000-0000-4000-a000-000000000001', 'submit');

    expect(capturedUrl).toBe('/api/v1/assignments/30000000-0000-4000-a000-000000000001/transitions');
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ action: 'submit' });
    expect(updated.status).toBe('Pending review');
    expect(updated.tone).toBe('warning');
  });

  it('normalizes HTTP 401 to typed AssignmentOperationError with unauthorized code', async () => {
    const mockFetch = createMockFetch(() =>
      jsonResponse(
        { error: { code: 'demo_session_required', message: 'Choose a demo user' }, requestId: 'req-401' },
        401,
      ),
    );

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AssignmentOperationError);
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('unauthorized');
      expect(opErr.requestId).toBe('req-401');
      expect(opErr.status).toBe(401);
      return true;
    });
  });

  it('normalizes HTTP 403 to forbidden', async () => {
    const mockFetch = createMockFetch(() =>
      jsonResponse(
        { error: { code: 'forbidden', message: 'Authority denied' }, requestId: 'req-403' },
        403,
      ),
    );

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(adapter.list('trainee')).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('forbidden');
      expect(opErr.requestId).toBe('req-403');
      return true;
    });
  });

  it('normalizes HTTP 404 to not_found', async () => {
    const mockFetch = createMockFetch(() =>
      jsonResponse(
        { error: { code: 'not_found', message: 'No assignment found' }, requestId: 'req-404' },
        404,
      ),
    );

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(adapter.transition('founder', 'asg_missing', 'start')).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('not_found');
      expect(opErr.requestId).toBe('req-404');
      return true;
    });
  });

  it('normalizes HTTP 409 to conflict', async () => {
    const mockFetch = createMockFetch(() =>
      jsonResponse(
        { error: { code: 'invalid_state_transition', message: 'Only an open Assignment can be started.' }, requestId: 'req-409' },
        409,
      ),
    );

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(adapter.transition('founder', 'asg_gst_october', 'start')).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('conflict');
      expect(opErr.requestId).toBe('req-409');
      return true;
    });
  });

  it('normalizes HTTP 422 to validation', async () => {
    const mockFetch = createMockFetch(() =>
      jsonResponse(
        { error: { code: 'validation_failed', message: 'Validation failed' }, requestId: 'req-422' },
        422,
      ),
    );

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(
      adapter.create('founder', {
        clientId: 'CLI-0001',
        clientName: 'Aster Foods Private Limited',
        title: '',
        service: '',
        ownerNameOrId: '',
        dueDate: '',
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('validation');
      expect(opErr.requestId).toBe('req-422');
      return true;
    });
  });

  it('normalizes malformed response to unexpected', async () => {
    const mockFetch = createMockFetch(() => new Response('Internal error text', { status: 500 }));

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('unexpected');
      return true;
    });
  });

  it('normalizes network errors to network', async () => {
    const mockFetch = createMockFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    await expect(adapter.list('founder')).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('network');
      return true;
    });
  });

  it('propagates AbortSignal and normalizes to aborted code', async () => {
    const controller = new AbortController();
    const mockFetch = createMockFetch((_url, init) => {
      if (init?.signal?.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      return jsonResponse({ data: [SAMPLE_DTO] });
    });

    const adapter = new HttpAssignmentsAdapter({ fetchFn: mockFetch });
    controller.abort();

    await expect(adapter.list('founder', { signal: controller.signal })).rejects.toSatisfy((err: unknown) => {
      const opErr = err as AssignmentOperationError;
      expect(opErr.code).toBe('aborted');
      return true;
    });
  });

  describe('Finding 4: lifecycle normalization & drawer vocabulary mapping', () => {
    it('maps wire status "assigned" to UI "Awaiting documents"', () => {
      const openDto: AssignmentDto = {
        ...SAMPLE_DTO,
        id: '30000000-0000-4000-a000-000000000099',
        status: 'assigned',
      };
      const row = mapDtoToAssignmentRow(openDto);
      expect(row.status).toBe('Awaiting documents');
      expect(row.progress).toBe(15);
      expect(row.tone).toBe('default');
    });

    it('normalizes lifecycle aliases consistently without string duplication', () => {
      expect(normalizeLifecycleStage('open')).toBe('open');
      expect(normalizeLifecycleStage('Open')).toBe('open');
      expect(normalizeLifecycleStage('Awaiting documents')).toBe('open');

      expect(normalizeLifecycleStage('in_progress')).toBe('in_progress');
      expect(normalizeLifecycleStage('In progress')).toBe('in_progress');
      expect(normalizeLifecycleStage('On track')).toBe('in_progress');

      expect(normalizeLifecycleStage('ready_for_review')).toBe('ready_for_review');
      expect(normalizeLifecycleStage('Pending review')).toBe('ready_for_review');

      expect(normalizeLifecycleStage('completed')).toBe('completed');
      expect(normalizeLifecycleStage('Completed')).toBe('completed');

      expect(normalizeLifecycleStage(undefined)).toBe('unknown');
      expect(normalizeLifecycleStage('nonexistent')).toBe('unknown');
    });

    it('identifies valid contract transitions across alias representations', () => {
      // Wire open / Awaiting documents -> in_progress
      expect(mapStatusTransitionToAction('Awaiting documents', 'In progress')).toBe('start');
      expect(mapStatusTransitionToAction('Open', 'In progress')).toBe('start');
      expect(mapStatusTransitionToAction('Open', 'On track')).toBe('start');

      // In progress -> Pending review
      expect(mapStatusTransitionToAction('In progress', 'Pending review')).toBe('submit');
      expect(mapStatusTransitionToAction('On track', 'Pending review')).toBe('submit');

      // Pending review -> Completed
      expect(mapStatusTransitionToAction('Pending review', 'Completed')).toBe('complete');

      // Completed -> In progress
      expect(mapStatusTransitionToAction('Completed', 'In progress')).toBe('reopen');

      // Same-stage aliases return null (handled locally)
      expect(mapStatusTransitionToAction('Open', 'Awaiting documents')).toBeNull();
      expect(mapStatusTransitionToAction('In progress', 'On track')).toBeNull();

      // Illegal jumps return null
      expect(mapStatusTransitionToAction('Awaiting documents', 'Completed')).toBeNull();
      expect(mapStatusTransitionToAction('Open', 'Completed')).toBeNull();
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
                requestId: 'req-bound-assignments',
              }),
              {
                status: 200,
                headers: {
                  'content-type': 'application/json',
                  'x-request-id': 'req-bound-assignments',
                },
              },
            ),
          );
        } as typeof fetch;

        // Instantiate without fetchFn injection
        const adapter = new HttpAssignmentsAdapter();
        const rows = await adapter.list('founder', { requestId: 'req-asn-bind' });

        expect(rows).toEqual([]);
        expect(capturedUrl).toBe('/api/v1/assignments');
        expect(capturedHeaders?.get('x-demo-user-id')).toBe('00000000-0000-4000-a000-000000000001');
        expect(capturedHeaders?.get('x-request-id')).toBe('req-asn-bind');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
