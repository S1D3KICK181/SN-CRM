import { describe, expect, it, vi } from 'vitest';
import type { ClientMessageDto, RecordClientMessageInput } from '@sn/contracts';
import { HttpMessagesAdapter, parseClientMessageDto } from './http-messages-adapter';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

const message: ClientMessageDto = {
  id: '75000000-0000-4000-a000-000000000001',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientCode: 'CL-000001',
  clientName: 'Aster Foods',
  contactId: '74000000-0000-4000-a000-000000000001',
  recipientName: 'Rahul Shah',
  recipientNumber: '919820012345',
  channel: 'whatsapp',
  purpose: 'payment_reminder',
  assignmentId: null,
  assignmentCode: null,
  invoiceId: '70000000-0000-4000-a000-000000000001',
  invoiceLabel: 'VYP-118',
  body: 'Dear Rahul, a gentle reminder from SN & Associates.',
  status: 'opened',
  sentById: '20000000-0000-4000-a000-000000000001',
  sentByName: 'Ananya Rao',
  createdAt: '2026-11-13T10:30:00.000Z',
};

const input: RecordClientMessageInput = {
  clientId: message.clientId,
  contactId: message.contactId,
  recipientName: 'Rahul Shah',
  recipientNumber: '98200 12345',
  purpose: 'payment_reminder',
  invoiceId: message.invoiceId,
  body: message.body,
};

function okResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: 'req-msg-1' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterFor(data: unknown, status = 200) {
  const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(okResponse(data, status)));
  return { fetchFn, adapter: new HttpMessagesAdapter({ fetchFn }) };
}

describe('HttpMessagesAdapter', () => {
  it('lists messages with the demo actor header for the role', async () => {
    const { adapter, fetchFn } = adapterFor([message]);
    await expect(adapter.listMessages('manager')).resolves.toEqual([message]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/client-messages');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID.manager);
  });

  it('passes the client filter as an encoded query', async () => {
    const { adapter, fetchFn } = adapterFor([]);
    await adapter.listMessages('founder', message.clientId);
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe(`/api/v1/client-messages?clientId=${message.clientId}`);
  });

  it('uses a Bearer token when a token source is configured and never dispatches without one', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([]));
    await new HttpMessagesAdapter({ fetchFn, getAccessToken: () => ' token-1 ' }).listMessages('founder');
    const headers = new Headers((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('x-demo-user-id')).toBeNull();

    const blankFetch = vi.fn();
    const blank = new HttpMessagesAdapter({ fetchFn: blankFetch, getAccessToken: () => null });
    await expect(blank.listMessages('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(blankFetch).not.toHaveBeenCalled();
  });

  it('records a message with the key and the input as the JSON body', async () => {
    const { adapter, fetchFn } = adapterFor(message, 201);
    const recorded = await adapter.recordMessage('staff', input, 'key-record');
    expect(recorded).toEqual(message);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/client-messages');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('idempotency-key')).toBe('key-record');
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it('refuses a blank idempotency key before any request', async () => {
    const { adapter, fetchFn } = adapterFor(message);
    await expect(adapter.recordMessage('staff', input, '   ')).rejects.toMatchObject({ code: 'unexpected' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'unexpected'],
    [500, 'unexpected'],
  ])('maps HTTP %i to %s and keeps only a safe server code', async (status, code) => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'validation_failed', message: 'raw server text' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new HttpMessagesAdapter({ fetchFn });
    const err = await adapter.recordMessage('founder', input, 'k').catch((e: unknown) => e);
    expect(err).toMatchObject({ code, status, serverCode: 'validation_failed' });
    expect((err as Error).message).not.toContain('raw server text');
  });

  it('reports a network failure', async () => {
    const adapter = new HttpMessagesAdapter({ fetchFn: vi.fn().mockRejectedValue(new TypeError('boom')) });
    await expect(adapter.listMessages('founder')).rejects.toMatchObject({ code: 'network' });
  });

  it('rejects an aborted request without dispatching', async () => {
    const { adapter, fetchFn } = adapterFor([]);
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.listMessages('founder', undefined, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects malformed responses', async () => {
    await expect(adapterFor({ not: 'an array' }).adapter.listMessages('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    await expect(adapterFor([{ ...message, id: 'not-a-uuid' }]).adapter.listMessages('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    const noEnvelope = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: 'r' }), { status: 200 }));
    await expect(new HttpMessagesAdapter({ fetchFn: noEnvelope }).listMessages('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
  });
});

describe('parseClientMessageDto', () => {
  it('parses a valid message unchanged, including one with no contact and no linked work', () => {
    expect(parseClientMessageDto(message)).toEqual(message);
    const bare = { ...message, contactId: null, invoiceId: null, invoiceLabel: null };
    expect(parseClientMessageDto(bare)).toEqual(bare);
  });

  it.each([
    ['an unknown purpose', { purpose: 'chat' }],
    ['an unknown status', { status: 'sent' }],
    ['an unknown channel', { channel: 'sms' }],
    ['a blank body', { body: '  ' }],
    ['a contact id that is not a uuid', { contactId: 'abc' }],
    ['a bad timestamp', { createdAt: 'yesterday' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => parseClientMessageDto({ ...message, ...patch })).toThrow();
  });

  it('rejects a missing property', () => {
    const { sentByName: _omitted, ...rest } = message;
    expect(() => parseClientMessageDto(rest)).toThrow(/sentByName/);
  });
});
