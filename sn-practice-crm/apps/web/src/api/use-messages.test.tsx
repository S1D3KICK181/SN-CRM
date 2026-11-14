// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessageDto, RecordClientMessageInput } from '@sn/contracts';
import { MessagesOperationError } from './messages-types';
import { DeterministicTestMessagesAdapter } from './test-messages-adapter';
import { useClientMessages } from './use-messages';

const existing: ClientMessageDto = {
  id: '75000000-0000-4000-a000-000000000001',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientCode: 'CL-000001',
  clientName: 'Aster Foods',
  contactId: null,
  recipientName: 'Rahul Shah',
  recipientNumber: '919820012345',
  channel: 'whatsapp',
  purpose: 'general',
  assignmentId: null,
  assignmentCode: null,
  invoiceId: null,
  invoiceLabel: null,
  body: 'Dear Rahul, ',
  status: 'opened',
  sentById: '20000000-0000-4000-a000-000000000001',
  sentByName: 'Ananya Rao',
  createdAt: '2026-11-13T10:30:00.000Z',
};

const recorded: ClientMessageDto = { ...existing, id: '75000000-0000-4000-a000-000000000002', body: 'Dear Sir/Madam, ' };

const input: RecordClientMessageInput = {
  clientId: existing.clientId,
  recipientName: 'Rahul Shah',
  recipientNumber: '98200 12345',
  purpose: 'general',
  body: 'Dear Sir/Madam, ',
};

function setup(role: Parameters<typeof useClientMessages>[0] = 'founder') {
  const port = new DeterministicTestMessagesAdapter();
  port.setMessagesResponse(role, [existing]);
  port.setRecordResult(recorded);
  const hook = renderHook(() => useClientMessages(role, { port }));
  return { port, ...hook };
}

describe('useClientMessages', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('loads the messages for %s', async (role) => {
    const { result, port } = setup(role);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    expect(result.current.messages).toEqual([existing]);
    expect(result.current.error).toBeNull();
    expect(port.calls).toEqual([expect.objectContaining({ role })]);
  });

  it('never loads or calls anything for a Trainee', async () => {
    const { result, port } = setup('trainee');
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.calls).toHaveLength(0);
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
    await expect(result.current.record(input, 'key')).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.mutations).toHaveLength(0);
  });

  it('does not load while disabled', async () => {
    const port = new DeterministicTestMessagesAdapter();
    renderHook(() => useClientMessages('founder', { port, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.calls).toHaveLength(0);
  });

  it('keeps a sanitized error and retries', async () => {
    const port = new DeterministicTestMessagesAdapter();
    port.setDefaultError(new MessagesOperationError({ code: 'network', message: 'raw socket detail' }));
    const { result } = renderHook(() => useClientMessages('founder', { port }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain('Unable to reach the server');
    expect(result.current.error?.message).not.toContain('socket');

    port.setDefaultError(undefined);
    port.setMessagesResponse('founder', [existing]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.messages).toEqual([existing]));
    expect(result.current.error).toBeNull();
  });

  it('records with the key and reloads the list', async () => {
    const { result, port } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    port.setMessagesResponse('founder', [recorded, existing]);

    let returned: ClientMessageDto | undefined;
    await act(async () => {
      returned = await result.current.record(input, 'key-1');
    });

    expect(returned).toEqual(recorded);
    expect(port.mutations).toEqual([{ role: 'founder', input, idempotencyKey: 'key-1' }]);
    // The list is loaded once on mount and once more after recording.
    expect(port.calls).toHaveLength(2);
    expect(result.current.messages).toEqual([recorded, existing]);
  });

  it('throws a sanitized error when recording fails and does not reload', async () => {
    const { result, port } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    port.setRecordError(
      new MessagesOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode: 'validation_failed' }),
    );
    let failure: unknown;
    await act(async () => {
      failure = await result.current.record(input, 'key-1').catch((e: unknown) => e);
    });
    expect(failure).toMatchObject({ serverCode: 'validation_failed' });
    expect((failure as Error).message).not.toContain('raw');
    expect(port.calls).toHaveLength(1);
    expect(result.current.messages).toEqual([existing]);
  });

  it('shows no data to another role after a role change', async () => {
    const port = new DeterministicTestMessagesAdapter();
    port.setMessagesResponse('founder', [existing]);
    let resolveStaff: (items: ClientMessageDto[]) => void = () => undefined;
    port.setMessagesResponse('staff', []);
    const { result, rerender } = renderHook(({ role }) => useClientMessages(role, { port }), {
      initialProps: { role: 'founder' as 'founder' | 'staff' },
    });
    await waitFor(() => expect(result.current.messages).toEqual([existing]));
    port.enqueueDeferredMessages(new Promise<ClientMessageDto[]>((resolve) => (resolveStaff = resolve)));
    rerender({ role: 'staff' });
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      resolveStaff([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toEqual([]);
  });
});
