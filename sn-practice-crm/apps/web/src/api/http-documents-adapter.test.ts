import { describe, expect, it, vi } from 'vitest';
import type { ClientDocumentDto } from '@sn/contracts';
import { HttpDocumentsAdapter, parseClientDocumentDto } from './http-documents-adapter';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

const document: ClientDocumentDto = {
  id: '70000000-0000-4000-a000-000000000001',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientCode: 'CL-000001',
  clientName: 'Aster Foods',
  title: 'Balance sheet',
  category: 'financial_statements',
  financialYearStart: 2025,
  fileName: 'balance-sheet.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  status: 'available',
  storagePath: '10000000-0000-4000-a000-000000000001/70000000-0000-4000-a000-000000000001/balance-sheet.pdf',
  uploadedById: '20000000-0000-4000-a000-000000000001',
  uploadedByName: 'Ananya Rao',
  createdAt: '2026-11-10T04:30:00.000Z',
  removedReason: null,
  removedAt: null,
};

function okResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: 'req-doc-1' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterFor(data: unknown, status = 200) {
  const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(okResponse(data, status)));
  return { fetchFn, adapter: new HttpDocumentsAdapter({ fetchFn }) };
}

describe('HttpDocumentsAdapter', () => {
  it('lists documents with the demo actor header for the role', async () => {
    const { adapter, fetchFn } = adapterFor([document]);
    await expect(adapter.listDocuments('manager')).resolves.toEqual([document]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/documents');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID.manager);
  });

  it('passes the client filter as an encoded query', async () => {
    const { adapter, fetchFn } = adapterFor([]);
    await adapter.listDocuments('founder', document.clientId);
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(`/api/v1/documents?clientId=${document.clientId}`);
  });

  it('uses a Bearer token when a token source is configured and never dispatches without one', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([]));
    await new HttpDocumentsAdapter({ fetchFn, getAccessToken: () => ' token-1 ' }).listDocuments('founder');
    const headers = new Headers((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('x-demo-user-id')).toBeNull();

    const blankFetch = vi.fn();
    const blank = new HttpDocumentsAdapter({ fetchFn: blankFetch, getAccessToken: () => null });
    await expect(blank.listDocuments('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(blankFetch).not.toHaveBeenCalled();
  });

  it('creates a pending record with the key and the input as the JSON body', async () => {
    const { adapter, fetchFn } = adapterFor({ ...document, status: 'pending' }, 201);
    const input = {
      clientId: document.clientId,
      title: 'Balance sheet',
      category: 'financial_statements' as const,
      financialYearStart: 2025,
      fileName: 'balance-sheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    };
    const created = await adapter.createDocument('staff', input, 'key-create');
    expect(created.status).toBe('pending');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/documents');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('key-create');
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it('confirms with an empty JSON body and removes with the reason', async () => {
    const { adapter, fetchFn } = adapterFor(document);
    await adapter.confirmDocument('staff', document.id, 'key-confirm');
    const [confirmUrl, confirmInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(confirmUrl).toBe(`/api/v1/documents/${document.id}/confirm`);
    expect(confirmInit.body).toBe('{}');
    expect(new Headers(confirmInit.headers).get('idempotency-key')).toBe('key-confirm');

    await adapter.removeDocument('founder', document.id, { reason: 'Uploaded to the wrong client' }, 'key-remove');
    const [removeUrl, removeInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(removeUrl).toBe(`/api/v1/documents/${document.id}/remove`);
    expect(JSON.parse(String(removeInit.body))).toEqual({ reason: 'Uploaded to the wrong client' });
  });

  it('refuses a blank idempotency key before any request', async () => {
    const { adapter, fetchFn } = adapterFor(document);
    await expect(adapter.confirmDocument('staff', document.id, '   ')).rejects.toMatchObject({ code: 'unexpected' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'unexpected'],
  ])('maps HTTP %i to %s and keeps only a safe server code', async (status, code) => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'file_too_large', message: 'raw server text' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new HttpDocumentsAdapter({ fetchFn });
    const err = await adapter.listDocuments('founder').catch((e: unknown) => e);
    expect(err).toMatchObject({ code, status, serverCode: 'file_too_large' });
    expect((err as Error).message).not.toContain('raw server text');
  });

  it('reports a network failure', async () => {
    const adapter = new HttpDocumentsAdapter({ fetchFn: vi.fn().mockRejectedValue(new TypeError('boom')) });
    await expect(adapter.listDocuments('founder')).rejects.toMatchObject({ code: 'network' });
  });

  it('rejects an aborted request without dispatching', async () => {
    const { adapter, fetchFn } = adapterFor([]);
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.listDocuments('founder', undefined, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects malformed responses', async () => {
    await expect(adapterFor({ not: 'an array' }).adapter.listDocuments('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    await expect(adapterFor([{ ...document, id: 'not-a-uuid' }]).adapter.listDocuments('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    const noEnvelope = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: 'r' }), { status: 200 }));
    await expect(new HttpDocumentsAdapter({ fetchFn: noEnvelope }).listDocuments('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
  });
});

describe('parseClientDocumentDto', () => {
  it('parses a valid document unchanged, including one with nothing optional set', () => {
    expect(parseClientDocumentDto(document)).toEqual(document);
    const bare = { ...document, financialYearStart: null };
    expect(parseClientDocumentDto(bare)).toEqual(bare);
  });

  it.each([
    ['an unknown category', { category: 'photos' }],
    ['an unknown status', { status: 'archived' }],
    ['a negative size', { sizeBytes: -1 }],
    ['a year that is not a number', { financialYearStart: '2025' }],
    ['a blank title', { title: '  ' }],
    ['a bad timestamp', { createdAt: 'yesterday' }],
    ['a bad removed timestamp', { removedAt: 'yesterday' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseClientDocumentDto({ ...document, ...patch })).toThrow();
  });

  it('rejects a missing property', () => {
    const { storagePath: _omitted, ...rest } = document;
    expect(() => parseClientDocumentDto(rest)).toThrow(/storagePath/);
  });
});
