import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { FileUp, X } from 'lucide-react';
import { DOCUMENT_CATEGORIES, DOCUMENT_MAX_BYTES, type ClientDto, type DocumentCategory } from '@sn/contracts';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_CATEGORY_LABELS,
  allowedMimeType,
  currentFinancialYearStart,
  documentErrorMessage,
  financialYearLabel,
} from '../../api/documents-types';
import type { UploadDocumentInput } from '../../api/use-documents';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';

interface UploadFormValues {
  clientId: string;
  title: string;
  category: '' | DocumentCategory;
  financialYear: string;
  file: File | null;
}

type UploadFormKey = 'clientId' | 'title' | 'category' | 'file';
type UploadFormErrors = Partial<Record<UploadFormKey, string>>;

const TITLE_MIN = 2;
const TITLE_MAX = 160;
/** The current financial year and this many before it are offered. */
const FINANCIAL_YEARS_BACK = 7;

export const DOCUMENT_CLIENT_ERROR = 'Choose a client.';
export const DOCUMENT_TITLE_ERROR = 'Enter a title of 2 to 160 characters.';
export const DOCUMENT_CATEGORY_ERROR = 'Choose a category.';
export const DOCUMENT_NO_FILE_ERROR = 'Choose a file to upload.';
export const DOCUMENT_EMPTY_FILE_ERROR = 'The file is empty.';
export const DOCUMENT_LARGE_FILE_ERROR = 'The file is larger than 25 MB.';
export const DOCUMENT_TYPE_ERROR = 'Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.';

const EMPTY_VALUES: UploadFormValues = { clientId: '', title: '', category: '', financialYear: '', file: null };

function fileError(file: File | null): string | null {
  if (file === null) return DOCUMENT_NO_FILE_ERROR;
  if (file.size === 0) return DOCUMENT_EMPTY_FILE_ERROR;
  if (file.size > DOCUMENT_MAX_BYTES) return DOCUMENT_LARGE_FILE_ERROR;
  if (allowedMimeType(file.name, file.type) === null) return DOCUMENT_TYPE_ERROR;
  return null;
}

export function validateUploadForm(values: UploadFormValues): UploadFormErrors {
  const errors: UploadFormErrors = {};
  if (values.clientId === '') errors.clientId = DOCUMENT_CLIENT_ERROR;
  const titleLength = values.title.trim().length;
  if (titleLength < TITLE_MIN || titleLength > TITLE_MAX) errors.title = DOCUMENT_TITLE_ERROR;
  if (values.category === '') errors.category = DOCUMENT_CATEGORY_ERROR;
  const problem = fileError(values.file);
  if (problem) errors.file = problem;
  return errors;
}

/** The file name without its last extension, used as the starting title. */
function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
}

/** Clients the user looks after; when none of them can be told apart, every client from the live list. */
export function uploadClientOptions(clients: readonly ClientDto[]): readonly ClientDto[] {
  // Only clients the reader looks after accept uploads; a department head's read-only clients are left out.
  const looked = clients.filter((client) => client.looksAfter);
  return looked.length > 0 ? looked : clients;
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type UploadDocumentDialogProps = {
  open: boolean;
  /** The live clients list. */
  clients: readonly ClientDto[];
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when uploaded; rejects with a DocumentsOperationError when not. */
  onSubmit: (input: UploadDocumentInput, idempotencyKey: string) => Promise<void>;
};

export function UploadDocumentDialog({ open, clients, opener, onClose, onSubmit }: UploadDocumentDialogProps) {
  const [values, setValues] = useState<UploadFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<UploadFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const autoTitle = useRef('');
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setValues(EMPTY_VALUES);
      setErrors({});
      setFormError(null);
      attempt.current = null;
      autoTitle.current = '';
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#document-client')?.focus());
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lock.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      if (lock.current) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && event.shiftKey && index <= 0) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (nodes.length && !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const clientOptions = uploadClientOptions(clients);
  const firstYear = currentFinancialYearStart();
  const years = Array.from({ length: FINANCIAL_YEARS_BACK + 1 }, (_, index) => firstYear - index);

  const update = <K extends keyof UploadFormValues>(key: K, value: UploadFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key !== 'financialYear') setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // The file name stands in as the title until the user types their own.
    const keepsTitle = values.title.trim() !== '' && values.title !== autoTitle.current;
    const title = file && !keepsTitle ? titleFromFileName(file.name) : values.title;
    if (file && !keepsTitle) autoTitle.current = title;
    setValues((current) => ({ ...current, file, title }));
    setErrors((current) => ({ ...current, file: undefined, title: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const next = validateUploadForm(values);
    setErrors(next);
    if (Object.keys(next).length > 0 || values.file === null || values.category === '') {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input: UploadDocumentInput = {
      clientId: values.clientId,
      title: values.title.trim(),
      category: values.category,
      financialYearStart: values.financialYear === '' ? null : Number(values.financialYear),
      file: values.file,
    };
    // Same client, title, category, year and file means the same record and upload path on a retry.
    attempt.current = nextSaveAttempt(attempt.current, {
      ...input,
      file: [input.file.name, input.file.size, input.file.type, input.file.lastModified],
    });
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(documentErrorMessage(err));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  const hasFieldErrors = Object.values(errors).some(Boolean);
  const describedBy = (key: UploadFormKey, hint: boolean) =>
    [hint ? `document-${key}-hint` : null, errors[key] ? `document-${key}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const fieldError = (key: UploadFormKey) =>
    errors[key] ? (
      <small id={`document-${key}-error`} className="field-error-text">
        {errors[key]}
      </small>
    ) : null;

  return (
    <div
      className="dialog-layer end-engagement-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !lock.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-document-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <FileUp size={18} />
            </div>
            <div>
              <h2 id="upload-document-title">Upload document</h2>
            </div>
          </div>
          <button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose} disabled={pending}>
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="engagement-dialog-body end-engagement-fields">
            {formError ? (
              <p className="dialog-validation-summary" role="alert">
                {formError}
              </p>
            ) : hasFieldErrors ? (
              <p className="dialog-validation-summary" role="alert">
                Please correct the highlighted fields.
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="document-client">Client</label>
              <select
                id="document-client"
                value={values.clientId}
                disabled={pending}
                aria-invalid={errors.clientId ? true : undefined}
                aria-describedby={describedBy('clientId', false)}
                onChange={(event) => update('clientId', event.target.value)}
              >
                <option value="">Choose a client</option>
                {clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} · {client.displayName}
                  </option>
                ))}
              </select>
              {fieldError('clientId')}
            </div>
            <div className="field">
              <label htmlFor="document-file">File</label>
              <input
                id="document-file"
                type="file"
                accept={DOCUMENT_ACCEPT}
                disabled={pending}
                aria-invalid={errors.file ? true : undefined}
                aria-describedby={describedBy('file', true)}
                onChange={chooseFile}
              />
              <small id="document-file-hint">PDF, JPG, PNG, Excel, CSV or Word, up to 25 MB.</small>
              {fieldError('file')}
            </div>
            <div className="field">
              <label htmlFor="document-title">Title</label>
              <input
                id="document-title"
                type="text"
                value={values.title}
                disabled={pending}
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={describedBy('title', false)}
                onChange={(event) => update('title', event.target.value)}
              />
              {fieldError('title')}
            </div>
            <div className="field">
              <label htmlFor="document-category">Category</label>
              <select
                id="document-category"
                value={values.category}
                disabled={pending}
                aria-invalid={errors.category ? true : undefined}
                aria-describedby={describedBy('category', false)}
                onChange={(event) => {
                  const match = DOCUMENT_CATEGORIES.find((category) => category === event.target.value);
                  update('category', match ?? '');
                }}
              >
                <option value="">Choose a category</option>
                {DOCUMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {DOCUMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
              {fieldError('category')}
            </div>
            <div className="field">
              <label htmlFor="document-financialYear">Financial year</label>
              <select
                id="document-financialYear"
                value={values.financialYear}
                disabled={pending}
                onChange={(event) => update('financialYear', event.target.value)}
              >
                <option value="">Not for a specific year</option>
                {years.map((year) => (
                  <option key={year} value={String(year)}>
                    {financialYearLabel(year)}
                  </option>
                ))}
              </select>
            </div>
            {pending && values.file ? (
              <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>
                Uploading {values.file.name}…
              </p>
            ) : null}
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Uploading…' : 'Upload'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
