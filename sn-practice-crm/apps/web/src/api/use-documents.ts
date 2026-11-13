import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { ClientDocumentDto, DocumentCategory } from '@sn/contracts';
import { useOptionalSessionActor } from '../shell/session-context';
import { getDefaultDocumentStorage, type DocumentStorage } from './document-storage';
import { HttpDocumentsAdapter } from './http-documents-adapter';
import {
  DocumentsOperationError,
  SAFE_DOCUMENTS_ERROR_MESSAGES,
  allowedMimeType,
  sanitizeDocumentsError,
  type DocumentsPort,
} from './documents-types';

export interface UseDocumentsOptions {
  readonly port?: DocumentsPort;
  readonly storage?: DocumentStorage;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

/** What the upload dialog collects; the file's name, type and size are read from the file itself. */
export interface UploadDocumentInput {
  readonly clientId: string;
  readonly title: string;
  readonly category: DocumentCategory;
  readonly financialYearStart: number | null;
  readonly file: File;
}

export interface UseDocumentsResult {
  readonly documents: ClientDocumentDto[];
  readonly loading: boolean;
  readonly error: DocumentsOperationError | null;
  readonly hasLiveSnapshot: boolean;
  readonly retry: () => void;
  /**
   * Creates the record, uploads the file, confirms it and reloads the list. Throws a sanitized
   * DocumentsOperationError at the first step that fails. Calling again with the same key after a
   * failure reuses the same pending record and upload path.
   */
  readonly upload: (input: UploadDocumentInput, idempotencyKey: string) => Promise<ClientDocumentDto>;
  /** Opens a short-lived signed link to the file in a new tab. */
  readonly download: (document: ClientDocumentDto) => Promise<void>;
  readonly remove: (document: ClientDocumentDto, reason: string, idempotencyKey: string) => Promise<ClientDocumentDto>;
}

interface DocumentsSnapshot {
  readonly port: DocumentsPort;
  readonly role: CompanyRole;
  readonly documents: ClientDocumentDto[];
  readonly loading: boolean;
  readonly error: DocumentsOperationError | null;
  readonly hasLiveSnapshot: boolean;
}

const NO_DOCUMENTS: ClientDocumentDto[] = [];

function mayReadDocuments(role: CompanyRole): boolean {
  return role !== 'trainee';
}

/**
 * Client documents and their changes. Everyone except the Trainee loads (the API returns only the
 * documents each role may see); the Trainee gets an empty list and never triggers a request. Data
 * loaded for one role is never exposed to another (zero-frame suppression on role or port change).
 */
export function useDocuments(role: CompanyRole, options: UseDocumentsOptions = {}): UseDocumentsResult {
  const { enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpDocumentsAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );
  const injectedStorage = options.storage;

  const allowed = enabled && mayReadDocuments(role);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<DocumentsSnapshot | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();

    setSnapshot((previous) => {
      const sameScope = previous !== null && previous.port === port && previous.role === role;
      return {
        port,
        role,
        documents: sameScope ? previous.documents : NO_DOCUMENTS,
        loading: true,
        error: null,
        hasLiveSnapshot: sameScope ? previous.hasLiveSnapshot : false,
      };
    });

    port
      .listDocuments(role, undefined, { signal: controller.signal })
      .then((dtos) => {
        if (controller.signal.aborted) return;
        setSnapshot({ port, role, documents: dtos, loading: false, error: null, hasLiveSnapshot: true });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = sanitizeDocumentsError(err);
        if (error.code === 'aborted') return;
        setSnapshot((previous) => {
          const sameScope = previous !== null && previous.port === port && previous.role === role;
          return {
            port,
            role,
            documents: sameScope ? previous.documents : NO_DOCUMENTS,
            loading: false,
            error,
            hasLiveSnapshot: sameScope && previous.hasLiveSnapshot,
          };
        });
      });

    return () => controller.abort();
  }, [allowed, port, role, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const reload = useCallback(async () => {
    try {
      const dtos = await port.listDocuments(role);
      setSnapshot({ port, role, documents: dtos, loading: false, error: null, hasLiveSnapshot: true });
    } catch {
      // The change itself was saved; fall back to the normal reload so the list catches up.
      setAttempt((value) => value + 1);
    }
  }, [port, role]);

  const forbidden = useCallback(
    () => new DocumentsOperationError({ code: 'forbidden', message: SAFE_DOCUMENTS_ERROR_MESSAGES.forbidden }),
    [],
  );

  const upload = useCallback(
    async (input: UploadDocumentInput, idempotencyKey: string): Promise<ClientDocumentDto> => {
      if (!allowed) throw forbidden();
      const { file } = input;
      const mimeType = allowedMimeType(file.name, file.type);
      if (mimeType === null) {
        throw new DocumentsOperationError({
          code: 'unexpected',
          message: SAFE_DOCUMENTS_ERROR_MESSAGES.unexpected,
          serverCode: 'file_type_not_allowed',
        });
      }
      // Storage is told the same type the record carries, even when the browser reported another one.
      const stored = file.type === mimeType ? file : new File([file], file.name, { type: mimeType });

      let pending: ClientDocumentDto;
      try {
        pending = await port.createDocument(
          role,
          {
            clientId: input.clientId,
            title: input.title,
            category: input.category,
            financialYearStart: input.financialYearStart,
            fileName: file.name,
            mimeType,
            sizeBytes: file.size,
          },
          idempotencyKey,
        );
      } catch (err: unknown) {
        throw sanitizeDocumentsError(err);
      }

      try {
        await (injectedStorage ?? getDefaultDocumentStorage()).uploadToStorage(pending.storagePath, stored);
      } catch {
        throw new DocumentsOperationError({ code: 'storage', message: SAFE_DOCUMENTS_ERROR_MESSAGES.storage });
      }

      let confirmed: ClientDocumentDto;
      try {
        confirmed = await port.confirmDocument(role, pending.id, `${idempotencyKey}-confirm`);
      } catch (err: unknown) {
        throw sanitizeDocumentsError(err);
      }
      await reload();
      return confirmed;
    },
    [allowed, forbidden, port, role, injectedStorage, reload],
  );

  const download = useCallback(
    async (document: ClientDocumentDto): Promise<void> => {
      if (!allowed) throw forbidden();
      let url: string;
      try {
        url = await (injectedStorage ?? getDefaultDocumentStorage()).createDownloadUrl(document.storagePath);
      } catch {
        throw new DocumentsOperationError({ code: 'storage', message: SAFE_DOCUMENTS_ERROR_MESSAGES.storage });
      }
      window.open(url, '_blank', 'noopener');
    },
    [allowed, forbidden, injectedStorage],
  );

  const remove = useCallback(
    async (document: ClientDocumentDto, reason: string, idempotencyKey: string): Promise<ClientDocumentDto> => {
      if (!allowed) throw forbidden();
      let removed: ClientDocumentDto;
      try {
        removed = await port.removeDocument(role, document.id, { reason }, idempotencyKey);
      } catch (err: unknown) {
        throw sanitizeDocumentsError(err);
      }
      await reload();
      return removed;
    },
    [allowed, forbidden, port, role, reload],
  );

  const actions = { retry, upload, download, remove };

  if (!allowed) {
    return { documents: NO_DOCUMENTS, loading: false, error: null, hasLiveSnapshot: false, ...actions };
  }

  // Zero-frame privacy guard: a snapshot that belongs to another role or port is never shown.
  const current = snapshot !== null && snapshot.port === port && snapshot.role === role ? snapshot : null;
  if (!current) {
    return { documents: NO_DOCUMENTS, loading: true, error: null, hasLiveSnapshot: false, ...actions };
  }

  return {
    documents: current.documents,
    loading: current.loading,
    error: current.error,
    hasLiveSnapshot: current.hasLiveSnapshot,
    ...actions,
  };
}
