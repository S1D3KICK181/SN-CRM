import type { CompanyRole } from '@sn/domain';
import {
  DOCUMENT_ALLOWED_TYPES,
  type ClientDocumentDto,
  type CreateDocumentInput,
  type DocumentCategory,
  type RemoveDocumentInput,
} from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type DocumentsErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'storage'
  | 'unexpected';

export interface DocumentsOperationErrorOptions {
  code: DocumentsErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class DocumentsOperationError extends Error {
  readonly code: DocumentsErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: DocumentsOperationErrorOptions) {
    super(options.message);
    this.name = 'DocumentsOperationError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
    this.serverCode = options.serverCode;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export const DOCUMENT_STORAGE_FAILED_MESSAGE =
  'The file could not be uploaded. Check your connection and try again.';
export const DOCUMENT_DOWNLOAD_FAILED_MESSAGE = 'The file could not be opened. Please try again.';

/**
 * Whitelisted, user-safe error copy for the documents seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_DOCUMENTS_ERROR_MESSAGES: Readonly<Record<DocumentsErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to use documents.',
  forbidden: "You don't have permission to do this.",
  not_found: 'The client or document could not be found.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The documents request was cancelled.',
  storage: DOCUMENT_STORAGE_FAILED_MESSAGE,
  unexpected: 'Something went wrong with documents. Please try again.',
};

export const GENERIC_SAFE_DOCUMENTS_ERROR = SAFE_DOCUMENTS_ERROR_MESSAGES.unexpected;

/** Copy for the server codes the documents routes return. */
const SERVER_CODE_MESSAGES: Readonly<Record<string, string>> = {
  file_too_large: 'The file is larger than 25 MB.',
  file_type_not_allowed: 'Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.',
  upload_missing: 'The file did not finish uploading. Try again.',
  already_removed: 'This document is already removed.',
};

/** Sanitizes any error caught during documents operations. Discards causes and unverified server text. */
export function sanitizeDocumentsError(err: unknown): DocumentsOperationError {
  if (err instanceof DocumentsOperationError) {
    return new DocumentsOperationError({
      code: err.code,
      message: SAFE_DOCUMENTS_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_DOCUMENTS_ERROR,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new DocumentsOperationError({ code: 'unexpected', message: GENERIC_SAFE_DOCUMENTS_ERROR });
}

/** User-facing copy for a failed upload or removal. Never reflects raw server text. */
export function documentErrorMessage(err: unknown): string {
  const safe = sanitizeDocumentsError(err);
  if (safe.serverCode && Object.prototype.hasOwnProperty.call(SERVER_CODE_MESSAGES, safe.serverCode)) {
    return SERVER_CODE_MESSAGES[safe.serverCode] ?? safe.message;
  }
  if (safe.code === 'forbidden' || safe.status === 403) return SAFE_DOCUMENTS_ERROR_MESSAGES.forbidden;
  return safe.message;
}

export interface DocumentsPort {
  /** Lists the available documents the reader may see, optionally for one client. */
  listDocuments(role: CompanyRole, clientId?: string, options?: PortExecutionOptions): Promise<ClientDocumentDto[]>;
  /** Creates a pending record; the file is uploaded to the returned storagePath afterwards. */
  createDocument(
    role: CompanyRole,
    input: CreateDocumentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto>;
  confirmDocument(
    role: CompanyRole,
    documentId: string,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto>;
  removeDocument(
    role: CompanyRole,
    documentId: string,
    input: RemoveDocumentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto>;
}

// ---------------------------------------------------------------------------
// Labels and formatting shared by the page and its dialogs
// ---------------------------------------------------------------------------

export const DOCUMENT_CATEGORY_LABELS: Readonly<Record<DocumentCategory, string>> = {
  kyc: 'KYC',
  financial_statements: 'Financial statements',
  returns_filed: 'Returns filed',
  acknowledgements: 'Acknowledgements',
  agreements: 'Agreements',
  correspondence: 'Correspondence',
  other: 'Other',
};

/** "2025–26" for the financial year that starts in 2025. */
export function financialYearLabel(start: number): string {
  return `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The financial year (April to March) that contains the given date. */
export function currentFinancialYearStart(now: Date = new Date()): number {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

/** "12 KB" or "1.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Lower-case extension without the dot, or '' when the name has none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).trim().toLowerCase();
}

/**
 * The mime type to record for a file. The browser's own type is kept when it matches the extension;
 * otherwise (for example a CSV reported as an Excel file, or no type at all) the type for the extension.
 * Returns null when the extension is not an allowed one.
 */
export function allowedMimeType(fileName: string, browserType: string): string | null {
  const extension = fileExtension(fileName);
  if (extension === '') return null;
  const entries = Object.entries(DOCUMENT_ALLOWED_TYPES) as Array<[string, readonly string[]]>;
  const matching = entries.filter(([, extensions]) => extensions.includes(extension));
  if (matching.length === 0) return null;
  const same = matching.find(([mime]) => mime === browserType);
  return (same ?? matching[0])?.[0] ?? null;
}

/** The extensions for the file input's accept attribute, such as ".pdf,.jpg". */
export const DOCUMENT_ACCEPT = Object.values(DOCUMENT_ALLOWED_TYPES)
  .flatMap((extensions) => extensions as readonly string[])
  .map((extension) => `.${extension}`)
  .join(',');
