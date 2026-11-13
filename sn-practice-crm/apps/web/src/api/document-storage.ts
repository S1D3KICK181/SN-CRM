import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAuthAdapter } from './auth/supabase-client';
import { DocumentsOperationError } from './documents-types';

export const DOCUMENT_BUCKET = 'client-documents';
/** How long a download link stays valid. */
export const DOWNLOAD_URL_SECONDS = 60;

/** The private file store behind client documents. Tests inject a fake. */
export interface DocumentStorage {
  /**
   * Uploads the file to its pending path. Resolves when the file is stored, including when the
   * same path already holds an object (a retry of an upload that had got through).
   */
  uploadToStorage(path: string, file: File): Promise<void>;
  /** A short-lived link to the stored file. */
  createDownloadUrl(path: string): Promise<string>;
}

function storageStatus(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const record = error as Record<string, unknown>;
  const status = record['statusCode'] ?? record['status'];
  return typeof status === 'string' || typeof status === 'number' ? String(status) : '';
}

function isAlreadyExists(error: unknown): boolean {
  if (storageStatus(error) === '409') return true;
  const message = error instanceof Error ? error.message : '';
  return /already exists|duplicate/i.test(message);
}

export function createSupabaseDocumentStorage(client: SupabaseClient): DocumentStorage {
  return {
    async uploadToStorage(path, file) {
      const bucket = client.storage.from(DOCUMENT_BUCKET);
      let failure: unknown = null;
      try {
        const { error } = await bucket.upload(path, file, { upsert: false, contentType: file.type });
        failure = error;
      } catch (err: unknown) {
        failure = err;
      }
      if (failure && !isAlreadyExists(failure)) {
        throw new DocumentsOperationError({
          code: 'storage',
          message: 'The file could not be uploaded.',
          cause: failure,
        });
      }
    },

    async createDownloadUrl(path) {
      let failure: unknown = null;
      let url: string | null = null;
      try {
        const { data, error } = await client.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, DOWNLOAD_URL_SECONDS);
        failure = error;
        url = data?.signedUrl ?? null;
      } catch (err: unknown) {
        failure = err;
      }
      if (failure || !url) {
        throw new DocumentsOperationError({
          code: 'storage',
          message: 'The file could not be opened.',
          cause: failure ?? undefined,
        });
      }
      return url;
    },
  };
}

let defaultStorage: DocumentStorage | null = null;

/** The storage used by the app. Built on first use, so a missing Supabase setting only fails an actual upload or download. */
export function getDefaultDocumentStorage(): DocumentStorage {
  if (!defaultStorage) {
    defaultStorage = createSupabaseDocumentStorage(getSupabaseAuthAdapter().getClient());
  }
  return defaultStorage;
}
