import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FilePlus2, X } from 'lucide-react';
import type { ClientDto, RecordVyaparBillInput } from '@sn/contracts';
import { formatINR } from '../../data';
import {
  addDaysToIsoDate,
  billingSaveErrorMessage,
  DUE_DAYS_DEFAULT,
  initialBillValues,
  nextSaveAttempt,
  todayInKolkata,
  toRecordBillInput,
  validateBillForm,
  type BillFormErrors,
  type BillFormValues,
  type SaveAttempt,
} from './billing-form-model';

type Props = {
  open: boolean;
  clients: readonly ClientDto[];
  /** Credit each client holds in paise, keyed by client id (see creditByClient). */
  creditByClient?: ReadonlyMap<string, number>;
  /** Today as YYYY-MM-DD in Asia/Kolkata; only tests pass this. */
  today?: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a BillingOperationError when not. */
  onSubmit: (input: RecordVyaparBillInput, idempotencyKey: string) => Promise<void>;
};

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

export function RecordVyaparBillDialog({
  open,
  clients,
  creditByClient,
  today: todayOverride,
  opener,
  onClose,
  onSubmit,
}: Props) {
  const [today, setToday] = useState(() => todayOverride ?? todayInKolkata());
  const [values, setValues] = useState<BillFormValues>(() => initialBillValues(today));
  const [useCredit, setUseCredit] = useState(true);
  const [errors, setErrors] = useState<BillFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const dueEdited = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  const options = useMemo(
    () =>
      clients
        .filter((client) => client.status === 'active')
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((client) => ({ id: client.id, label: `${client.code} · ${client.displayName}` })),
    [clients],
  );

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const fresh = todayOverride ?? todayInKolkata();
      setToday(fresh);
      setValues(initialBillValues(fresh));
      setUseCredit(true);
      setErrors({});
      setFormError(null);
      dueEdited.current = false;
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
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#bill-clientId')?.focus());
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

  const clientCreditPaise = values.clientId ? (creditByClient?.get(values.clientId) ?? 0) : 0;

  const update =(key: keyof BillFormValues, value: string) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === 'billDate' && !dueEdited.current) next.dueDate = addDaysToIsoDate(value, DUE_DAYS_DEFAULT);
      return next;
    });
    if (key === 'clientId') setUseCredit(true);
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const next = validateBillForm(values, today);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input = toRecordBillInput(values, clientCreditPaise > 0 ? useCredit : undefined);
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

  const hasFieldErrors = Object.values(errors).some(Boolean);
  const describedBy = (key: keyof BillFormValues, hint: boolean) =>
    [hint ? `bill-${key}-hint` : null, errors[key] ? `bill-${key}-error` : null].filter(Boolean).join(' ') || undefined;
  const fieldError = (key: keyof BillFormValues) =>
    errors[key] ? (
      <small id={`bill-${key}-error`} className="field-error-text">
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
        aria-labelledby="record-bill-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <FilePlus2 size={18} />
            </div>
            <div>
              <h2 id="record-bill-title">Record Vyapar bill</h2>
              <p>Enter the bill exactly as raised in Vyapar. The CRM does not create the bill itself.</p>
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
              <label htmlFor="bill-clientId">Client</label>
              <select
                id="bill-clientId"
                value={values.clientId}
                disabled={pending}
                aria-invalid={errors.clientId ? true : undefined}
                aria-describedby={describedBy('clientId', false)}
                onChange={(event) => update('clientId', event.target.value)}
              >
                <option value="">Select client…</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldError('clientId')}
            </div>
            {clientCreditPaise > 0 ? (
              <div style={{ margin: '-4px 0 4px' }}>
                {/* Not a .field: its input rules would stretch the checkbox to full width. */}
                <label
                  htmlFor="bill-applyCredit"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                >
                  <input
                    id="bill-applyCredit"
                    type="checkbox"
                    checked={useCredit}
                    disabled={pending}
                    onChange={(event) => setUseCredit(event.target.checked)}
                    style={{ width: 16, height: 16, margin: 0, flex: 'none', accentColor: 'var(--brand)' }}
                  />
                  Use {formatINR(clientCreditPaise / 100)} credit against this bill
                </label>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="bill-vyaparBillNumber">Vyapar bill number</label>
              <input
                id="bill-vyaparBillNumber"
                type="text"
                value={values.vyaparBillNumber}
                disabled={pending}
                aria-invalid={errors.vyaparBillNumber ? true : undefined}
                aria-describedby={describedBy('vyaparBillNumber', true)}
                onChange={(event) => update('vyaparBillNumber', event.target.value)}
              />
              <small id="bill-vyaparBillNumber-hint">As shown on the Vyapar bill, for example VYP-140.</small>
              {fieldError('vyaparBillNumber')}
            </div>
            <div className="field">
              <label htmlFor="bill-billDate">Bill date</label>
              <input
                id="bill-billDate"
                type="date"
                max={today}
                value={values.billDate}
                disabled={pending}
                aria-invalid={errors.billDate ? true : undefined}
                aria-describedby={describedBy('billDate', false)}
                onChange={(event) => update('billDate', event.target.value)}
              />
              {fieldError('billDate')}
            </div>
            <div className="field">
              <label htmlFor="bill-dueDate">Due date</label>
              <input
                id="bill-dueDate"
                type="date"
                value={values.dueDate}
                disabled={pending}
                aria-invalid={errors.dueDate ? true : undefined}
                aria-describedby={describedBy('dueDate', true)}
                onChange={(event) => {
                  dueEdited.current = true;
                  update('dueDate', event.target.value);
                }}
              />
              <small id="bill-dueDate-hint">Defaults to 15 days after the bill date.</small>
              {fieldError('dueDate')}
            </div>
            <div className="field">
              <label htmlFor="bill-amount">Fee amount (₹)</label>
              <input
                id="bill-amount"
                type="text"
                inputMode="decimal"
                value={values.amount}
                disabled={pending}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={describedBy('amount', false)}
                onChange={(event) => update('amount', event.target.value)}
              />
              {fieldError('amount')}
            </div>
            <div className="field">
              <label htmlFor="bill-description">What was billed</label>
              <textarea
                id="bill-description"
                rows={3}
                maxLength={300}
                value={values.description}
                disabled={pending}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={describedBy('description', true)}
                onChange={(event) => update('description', event.target.value)}
              />
              <small id="bill-description-hint">For example: GST returns for October 2026.</small>
              {fieldError('description')}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Recording…' : 'Record bill'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
