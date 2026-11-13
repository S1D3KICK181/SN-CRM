import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DOCUMENT_BUCKET, DOWNLOAD_URL_SECONDS, createSupabaseDocumentStorage } from './document-storage';

function fakeClient(bucket: { upload?: ReturnType<typeof vi.fn>; createSignedUrl?: ReturnType<typeof vi.fn> }) {
  const from = vi.fn().mockReturnValue(bucket);
  return { client: { storage: { from } } as unknown as SupabaseClient, from };
}

const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });

describe('createSupabaseDocumentStorage', () => {
  it('uploads to the private bucket without overwriting and with the file type', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'p' }, error: null });
    const { client, from } = fakeClient({ upload });
    await createSupabaseDocumentStorage(client).uploadToStorage('client/doc/a.pdf', pdf);
    expect(from).toHaveBeenCalledWith(DOCUMENT_BUCKET);
    expect(upload).toHaveBeenCalledWith('client/doc/a.pdf', pdf, { upsert: false, contentType: 'application/pdf' });
  });

  it.each([
    ['a 409 status', { message: 'x', statusCode: '409' }],
    ['an already exists message', new Error('The resource already exists')],
  ])('treats %s as already uploaded', async (_label, error) => {
    const upload = vi.fn().mockResolvedValue({ data: null, error });
    const { client } = fakeClient({ upload });
    await expect(createSupabaseDocumentStorage(client).uploadToStorage('p', pdf)).resolves.toBeUndefined();
  });

  it('fails with a storage error for any other upload error', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'secret detail', statusCode: '500' } });
    const { client } = fakeClient({ upload });
    await expect(createSupabaseDocumentStorage(client).uploadToStorage('p', pdf)).rejects.toMatchObject({
      code: 'storage',
    });
  });

  it('fails with a storage error when the upload call itself throws', async () => {
    const upload = vi.fn().mockRejectedValue(new TypeError('offline'));
    const { client } = fakeClient({ upload });
    await expect(createSupabaseDocumentStorage(client).uploadToStorage('p', pdf)).rejects.toMatchObject({
      code: 'storage',
    });
  });

  it('creates a signed download link that lasts 60 seconds', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://files.example/signed' }, error: null });
    const { client, from } = fakeClient({ createSignedUrl });
    await expect(createSupabaseDocumentStorage(client).createDownloadUrl('client/doc/a.pdf')).resolves.toBe(
      'https://files.example/signed',
    );
    expect(from).toHaveBeenCalledWith(DOCUMENT_BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith('client/doc/a.pdf', 60);
    expect(DOWNLOAD_URL_SECONDS).toBe(60);
  });

  it('fails with a storage error when no link comes back', async () => {
    const failed = vi.fn().mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    await expect(
      createSupabaseDocumentStorage(fakeClient({ createSignedUrl: failed }).client).createDownloadUrl('p'),
    ).rejects.toMatchObject({ code: 'storage' });
    const empty = vi.fn().mockResolvedValue({ data: { signedUrl: '' }, error: null });
    await expect(
      createSupabaseDocumentStorage(fakeClient({ createSignedUrl: empty }).client).createDownloadUrl('p'),
    ).rejects.toMatchObject({ code: 'storage' });
  });
});
