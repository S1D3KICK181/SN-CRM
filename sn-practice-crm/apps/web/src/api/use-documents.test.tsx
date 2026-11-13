// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDocumentDto } from '@sn/contracts';
import type { DocumentStorage } from './document-storage';
import { DocumentsOperationError } from './documents-types';
import { DeterministicTestDocumentsAdapter } from './test-documents-adapter';
import { useDocuments } from './use-documents';

const available: ClientDocumentDto = {
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

const pendingRecord: ClientDocumentDto = {
  ...available,
  id: '70000000-0000-4000-a000-000000000002',
  title: 'Notice',
  fileName: 'notice.pdf',
  status: 'pending',
  storagePath: '10000000-0000-4000-a000-000000000001/70000000-0000-4000-a000-000000000002/notice.pdf',
};

function createStorage() {
  const uploadToStorage = vi.fn<DocumentStorage['uploadToStorage']>().mockResolvedValue(undefined);
  const createDownloadUrl = vi.fn<DocumentStorage['createDownloadUrl']>().mockResolvedValue('https://files.example/signed');
  return { storage: { uploadToStorage, createDownloadUrl } satisfies DocumentStorage, uploadToStorage, createDownloadUrl };
}

function uploadInput(file = new File(['%PDF-1.4'], 'notice.pdf', { type: 'application/pdf' })) {
  return {
    clientId: available.clientId,
    title: 'Notice',
    category: 'correspondence' as const,
    financialYearStart: 2025,
    file,
  };
}

function setup(role: Parameters<typeof useDocuments>[0] = 'founder') {
  const port = new DeterministicTestDocumentsAdapter();
  port.setDocumentsResponse(role, [available]);
  port.setCreateResult(pendingRecord);
  port.setConfirmResult({ ...pendingRecord, status: 'available' });
  port.setRemoveResult({ ...available, status: 'removed' });
  const fake = createStorage();
  const hook = renderHook(() => useDocuments(role, { port, storage: fake.storage }));
  return { port, ...fake, ...hook };
}

describe('useDocuments', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('loads the documents for %s', async (role) => {
    const { result, port } = setup(role);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    expect(result.current.documents).toEqual([available]);
    expect(result.current.error).toBeNull();
    expect(port.calls).toEqual([expect.objectContaining({ role })]);
  });

  it('never loads or calls anything for a Trainee', async () => {
    const { result, port, uploadToStorage, createDownloadUrl } = setup('trainee');
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.calls).toHaveLength(0);
    expect(result.current.documents).toEqual([]);
    expect(result.current.loading).toBe(false);
    await expect(result.current.upload(uploadInput(), 'key')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(result.current.download(available)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(result.current.remove(available, 'Wrong client', 'key')).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.mutations).toHaveLength(0);
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  it('does not load while disabled', async () => {
    const port = new DeterministicTestDocumentsAdapter();
    renderHook(() => useDocuments('founder', { port, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.calls).toHaveLength(0);
  });

  it('keeps a sanitized error and retries', async () => {
    const port = new DeterministicTestDocumentsAdapter();
    port.setDefaultError(new DocumentsOperationError({ code: 'network', message: 'raw socket detail' }));
    const { result } = renderHook(() => useDocuments('founder', { port }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain('Unable to reach the server');
    expect(result.current.error?.message).not.toContain('socket');

    port.setDefaultError(undefined);
    port.setDocumentsResponse('founder', [available]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.documents).toEqual([available]));
    expect(result.current.error).toBeNull();
  });

  it('runs the upload in order: create, store, confirm, reload', async () => {
    const { result, port, uploadToStorage } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    const order: string[] = [];
    uploadToStorage.mockImplementation(async () => {
      order.push('store');
    });
    const file = new File(['%PDF-1.4'], 'notice.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.upload(uploadInput(file), 'key-1');
    });

    expect(port.mutations.map((m) => m.kind)).toEqual(['create-document', 'confirm-document']);
    expect(port.mutations[0]).toMatchObject({
      idempotencyKey: 'key-1',
      input: {
        clientId: available.clientId,
        title: 'Notice',
        category: 'correspondence',
        financialYearStart: 2025,
        fileName: 'notice.pdf',
        mimeType: 'application/pdf',
        sizeBytes: file.size,
      },
    });
    expect(uploadToStorage).toHaveBeenCalledWith(pendingRecord.storagePath, file);
    expect(order).toEqual(['store']);
    expect(port.mutations[1]).toMatchObject({ targetId: pendingRecord.id });
    expect(port.mutations[1]?.idempotencyKey).toBe('key-1-confirm');
    // The list is loaded once on mount and once more after the confirm.
    expect(port.calls).toHaveLength(2);
  });

  it('shows nothing new and confirms nothing when the file does not upload, then retries on the same record', async () => {
    const { result, port, uploadToStorage } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    uploadToStorage.mockRejectedValueOnce(new DocumentsOperationError({ code: 'storage', message: 'x' }));
    const file = new File(['%PDF-1.4'], 'notice.pdf', { type: 'application/pdf' });

    let failure: unknown;
    await act(async () => {
      failure = await result.current.upload(uploadInput(file), 'key-1').catch((e: unknown) => e);
    });
    expect(failure).toMatchObject({
      code: 'storage',
      message: 'The file could not be uploaded. Check your connection and try again.',
    });
    expect(port.mutations.map((m) => m.kind)).toEqual(['create-document']);
    expect(port.calls).toHaveLength(1);
    expect(result.current.documents).toEqual([available]);

    await act(async () => {
      await result.current.upload(uploadInput(file), 'key-1');
    });
    const creates = port.mutations.filter((m) => m.kind === 'create-document');
    expect(creates).toHaveLength(2);
    expect(creates.map((m) => m.idempotencyKey)).toEqual(['key-1', 'key-1']);
    expect(uploadToStorage).toHaveBeenCalledTimes(2);
    expect(uploadToStorage.mock.calls.map(([path]) => path)).toEqual([pendingRecord.storagePath, pendingRecord.storagePath]);
    expect(port.mutations.filter((m) => m.kind === 'confirm-document')).toHaveLength(1);
  });

  it('surfaces a failed confirm with its server code and does not reload', async () => {
    const { result, port } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    port.setMutationError(
      'confirm-document',
      new DocumentsOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode: 'upload_missing' }),
    );
    let failure: unknown;
    await act(async () => {
      failure = await result.current.upload(uploadInput(), 'key-1').catch((e: unknown) => e);
    });
    expect(failure).toMatchObject({ serverCode: 'upload_missing' });
    expect((failure as Error).message).not.toContain('raw');
    expect(port.calls).toHaveLength(1);
  });

  it('stops at the create step when the record is refused and stores nothing', async () => {
    const { result, port, uploadToStorage } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    port.setMutationError(
      'create-document',
      new DocumentsOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode: 'file_too_large' }),
    );
    await act(async () => {
      await expect(result.current.upload(uploadInput(), 'key-1')).rejects.toMatchObject({ serverCode: 'file_too_large' });
    });
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(port.mutations.map((m) => m.kind)).toEqual(['create-document']);
  });

  it('records and stores the type for the extension when the browser reports none', async () => {
    const { result, port, uploadToStorage } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    const csv = new File(['a,b'], 'rates.csv', { type: 'application/vnd.ms-excel' });
    await act(async () => {
      await result.current.upload(uploadInput(csv), 'key-1');
    });
    expect(port.mutations[0]).toMatchObject({ input: { fileName: 'rates.csv', mimeType: 'text/csv' } });
    const stored = uploadToStorage.mock.calls[0]?.[1];
    expect(stored?.type).toBe('text/csv');
    expect(stored?.name).toBe('rates.csv');
  });

  it('opens a signed link in a new tab without an opener', async () => {
    const { result, createDownloadUrl } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => {
      await result.current.download(available);
    });
    expect(createDownloadUrl).toHaveBeenCalledWith(available.storagePath);
    expect(open).toHaveBeenCalledWith('https://files.example/signed', '_blank', 'noopener');
  });

  it('fails a download with a storage error and opens nothing', async () => {
    const { result, createDownloadUrl } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    createDownloadUrl.mockRejectedValueOnce(new Error('Object not found'));
    await act(async () => {
      await expect(result.current.download(available)).rejects.toMatchObject({ code: 'storage' });
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('removes with the reason and reloads', async () => {
    const { result, port } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    await act(async () => {
      await result.current.remove(available, 'Uploaded to the wrong client', 'key-r');
    });
    expect(port.mutations).toEqual([
      {
        kind: 'remove-document',
        role: 'founder',
        targetId: available.id,
        input: { reason: 'Uploaded to the wrong client' },
        idempotencyKey: 'key-r',
      },
    ]);
    expect(port.calls).toHaveLength(2);
  });

  it('throws a sanitized error when removing fails', async () => {
    const { result, port } = setup();
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));
    port.setMutationError(
      'remove-document',
      new DocumentsOperationError({ code: 'forbidden', message: 'raw', status: 403 }),
    );
    await act(async () => {
      await expect(result.current.remove(available, 'Reason here', 'k')).rejects.toMatchObject({ code: 'forbidden' });
    });
  });
});
