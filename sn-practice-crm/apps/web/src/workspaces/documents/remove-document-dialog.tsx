import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Trash2, X } from 'lucide-react';
import { documentErrorMessage } from '../../api/documents-types';
import { nextSaveAttempt, validateReason, type SaveAttempt } from '../billing/billing-form-model';

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type RemoveDocumentDialogProps = {
  open: boolean;
  documentTitle: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when removed; rejects with a DocumentsOperationError when not. */
  onSubmit: (reason: string, idempotencyKey: string) => Promise<void>;
};

export function RemoveDocumentDialog({ open, documentTitle, opener, onClose, onSubmit }: RemoveDocumentDialogProps) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setReason('');
      setReasonError(null);
      setFormError(null);
      attempt.current = null;
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
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#remove-document-reason')?.focus());
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const problem = validateReason(reason);
    setReasonError(problem);
    if (problem) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#remove-document-reason')?.focus());
      return;
    }
    const trimmed = reason.trim();
    attempt.current = nextSaveAttempt(attempt.current, { reason: trimmed });
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(trimmed, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(documentErrorMessage(err));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

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
        aria-labelledby="remove-document-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <Trash2 size={18} />
            </div>
            <div>
              <h2 id="remove-document-title">Remove {documentTitle}?</h2>
              <p>
                It will no longer appear in the documents list. The file is kept on record and can be recovered by the
                Founder if needed.
              </p>
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
            ) : null}
            <div className="field">
              <label htmlFor="remove-document-reason">Reason</label>
              <textarea
                id="remove-document-reason"
                rows={3}
                value={reason}
                disabled={pending}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? 'remove-document-reason-error' : undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
              />
              {reasonError ? (
                <small id="remove-document-reason-error" className="field-error-text">
                  {reasonError}
                </small>
              ) : null}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Keep it
            </button>
            <button className="primary-button engagement-end-confirm" type="submit" disabled={pending}>
              {pending ? 'Removing…' : 'Remove document'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
