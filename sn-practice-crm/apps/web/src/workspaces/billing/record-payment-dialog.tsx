import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ReceiptIndianRupee, X } from 'lucide-react';
import type { PaymentMethod, RecordPaymentInput } from '@sn/contracts';
import { formatINR, type InvoiceRecord } from '../../data';
import {
  billingSaveErrorMessage,
  billLabel,
  initialPaymentValues,
  nextSaveAttempt,
  PAYMENT_METHOD_OPTIONS,
  paymentCreditPreview,
  todayInKolkata,
  toRecordPaymentInput,
  validatePaymentForm,
  type PaymentFormErrors,
  type PaymentFormValues,
  type SaveAttempt,
} from './billing-form-model';

type Props = {
  open: boolean;
  invoice: InvoiceRecord;
  /** Today as YYYY-MM-DD in Asia/Kolkata; only tests pass this. */
  today?: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a BillingOperationError when not. */
  onSubmit: (input: RecordPaymentInput, idempotencyKey: string) => Promise<void>;
};

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function RecordPaymentDialog({ open, invoice, today: todayOverride, opener, onClose, onSubmit }: Props) {
  const [today, setToday] = useState(() => todayOverride ?? todayInKolkata());
  const [values, setValues] = useState<PaymentFormValues>(() => initialPaymentValues(today, invoice.balancePaise));
  const [errors, setErrors] = useState<PaymentFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  const pendingPaiseRef = useRef(invoice.balancePaise);
  onCloseRef.current = onClose;
  openerRef.current = opener;
  pendingPaiseRef.current = invoice.balancePaise;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const fresh = todayOverride ?? todayInKolkata();
      setToday(fresh);
      setValues(initialPaymentValues(fresh, pendingPaiseRef.current));
      setErrors({});
      setFormError(null);
      attempt.current = null;
    }
  }, [open, todayOverride]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#payment-receivedOn')?.focus());
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

  const update = (key: keyof PaymentFormValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const next = validatePaymentForm(values, { today });
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input = toRecordPaymentInput(invoice.id, values);
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(billingSaveErrorMessage(err));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  const creditPreview = paymentCreditPreview(values.amount, invoice.balancePaise, invoice.clientName);
  const hasFieldErrors = Object.values(errors).some(Boolean);
  const describedBy = (key: keyof PaymentFormValues, hint: boolean) =>
    [hint ? `payment-${key}-hint` : null, errors[key] ? `payment-${key}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const fieldError = (key: keyof PaymentFormValues) =>
    errors[key] ? (
      <small id={`payment-${key}-error`} className="field-error-text">
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
        aria-labelledby="record-payment-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <ReceiptIndianRupee size={18} />
            </div>
            <div>
              <h2 id="record-payment-title">Record payment</h2>
              <p>
                {billLabel(invoice)} · {invoice.clientName} · {formatINR(invoice.balancePaise / 100)} pending
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
            ) : hasFieldErrors ? (
              <p className="dialog-validation-summary" role="alert">
                Please correct the highlighted fields.
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="payment-receivedOn">Date received</label>
              <input
                id="payment-receivedOn"
                type="date"
                max={today}
                value={values.receivedOn}
                disabled={pending}
                aria-invalid={errors.receivedOn ? true : undefined}
                aria-describedby={describedBy('receivedOn', false)}
                onChange={(event) => update('receivedOn', event.target.value)}
              />
              {fieldError('receivedOn')}
            </div>
            <div className="field">
              <label htmlFor="payment-amount">Cash received (₹)</label>
              <input
                id="payment-amount"
                type="text"
                inputMode="decimal"
                value={values.amount}
                disabled={pending}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={describedBy('amount', Boolean(creditPreview))}
                onChange={(event) => update('amount', event.target.value)}
              />
              {creditPreview ? (
                <small id="payment-amount-hint" role="status">
                  {creditPreview}
                </small>
              ) : null}
              {fieldError('amount')}
            </div>
            <div className="field">
              <label htmlFor="payment-method">Paid by</label>
              <select
                id="payment-method"
                value={values.method}
                disabled={pending}
                aria-invalid={errors.method ? true : undefined}
                aria-describedby={describedBy('method', false)}
                onChange={(event) => update('method', event.target.value as PaymentMethod | '')}
              >
                <option value="">Choose how it was paid</option>
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldError('method')}
            </div>
            <div className="field">
              <label htmlFor="payment-reference">Reference</label>
              <input
                id="payment-reference"
                type="text"
                value={values.reference}
                disabled={pending}
                aria-invalid={errors.reference ? true : undefined}
                aria-describedby={describedBy('reference', true)}
                onChange={(event) => update('reference', event.target.value)}
              />
              <small id="payment-reference-hint">UTR, cheque or UPI reference.</small>
              {fieldError('reference')}
            </div>
            <div className="field">
              <label htmlFor="payment-notes">Notes</label>
              <textarea
                id="payment-notes"
                rows={3}
                value={values.notes}
                disabled={pending}
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby={describedBy('notes', false)}
                onChange={(event) => update('notes', event.target.value)}
              />
              {fieldError('notes')}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Recording…' : 'Record payment'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
