import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, X } from 'lucide-react';
import { formatINR } from '../../data';
import {
  billingSaveErrorMessage,
  nextSaveAttempt,
  validateReason,
  type SaveAttempt,
} from './billing-form-model';

type Props = {
  open: boolean;
  /** `bill` cancels a Vyapar bill; `payment` cancels a recorded payment. */
  kind: 'bill' | 'payment';
  /** Vyapar bill number (or CRM code) for a bill; receipt code for a payment. */
  label: string;
  /** Payment amount in paise; shown in the body for a payment. */
  amountPaise?: number;
  /** Extra warning shown above the reason, such as credit from this payment used on other bills. */
  warning?: string | null;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when cancelled; rejects with a BillingOperationError when not. */
  onSubmit: (reason: string, idempotencyKey: string) => Promise<void>;
};

const focusable = 'button:not([disabled]), textarea:not([disabled])';

export function CancelFeeRecordDialog({ open, kind, label, amountPaise, warning, opener, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
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
      requestAnimationFrame(() => reasonRef.current?.focus());
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

  const isBill = kind === 'bill';
  const confirmLabel = isBill ? 'Cancel bill' : 'Cancel payment';
  const body = isBill
    ? 'The bill stays on record as Cancelled and stops counting as pending. This cannot be undone.'
    : `The payment stays on record as Cancelled, and the bill's pending amount goes back up by ${formatINR(
        (amountPaise ?? 0) / 100,
      )}. This cannot be undone.`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const message = validateReason(reason);
    setReasonError(message);
    if (message) {
      setFormError(null);
      reasonRef.current?.focus();
      return;
    }
    const input = { reason: reason.trim() };
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input.reason, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(billingSaveErrorMessage(err));
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
        aria-labelledby="cancel-fee-record-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <Ban size={18} />
            </div>
            <div>
              <h2 id="cancel-fee-record-title">
                {confirmLabel} {label}
              </h2>
              <p>{body}</p>
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
            ) : reasonError ? (
              <p className="dialog-validation-summary" role="alert">
                Please correct the highlighted fields.
              </p>
            ) : null}
            {warning ? (
              <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                {warning}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="cancel-fee-record-reason">Reason</label>
              <textarea
                id="cancel-fee-record-reason"
                ref={reasonRef}
                rows={3}
                maxLength={500}
                value={reason}
                disabled={pending}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={reasonError ? 'cancel-fee-record-reason-error' : undefined}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
              />
              {reasonError ? (
                <small id="cancel-fee-record-reason-error" className="field-error-text">
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
              {pending ? 'Cancelling…' : confirmLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
