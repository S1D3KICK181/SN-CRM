import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, BriefcaseBusiness, Check, X } from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type {
  EngagementDto,
  EngagementFeeModel,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from '@sn/contracts';
import type { EngagementMutationResult } from '../../api/engagements-types';
import { hasEngagementCapability } from '../../api/engagements-types';
import {
  SAFE_REVISE_ERROR,
  type DraftErrors,
  type DraftOption,
  type EngagementTermsValues,
  prefillEngagementTerms,
  toReviseEngagementDraftInput,
  validateEngagementTerms,
} from './engagement-draft-form-model';

type Props = {
  open: boolean;
  role: CompanyRole;
  engagement: EngagementDto;
  version: EngagementVersionDto;
  partners: readonly DraftOption[];
  managers: readonly DraftOption[];
  opener?: HTMLElement | null;
  onClose: () => void;
  onRevise: (input: ReviseEngagementDraftInput) => Promise<EngagementMutationResult>;
};
const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
export function ReviseEngagementDraftDialog({
  open,
  role,
  engagement,
  version,
  partners,
  managers,
  opener,
  onClose,
  onRevise,
}: Props) {
  const [values, setValues] = useState<EngagementTermsValues>(() => prefillEngagementTerms(version));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const previousOpen = useRef(false);
  const partnerAvailable = partners.some((item) => item.id === version.responsiblePartnerId);
  const managerAvailable = managers.some((item) => item.id === version.deliveryManagerId);
  const unavailable = !partnerAvailable || !managerAvailable;
  useLayoutEffect(() => {
    if (open && !previousOpen.current) {
      setValues(prefillEngagementTerms(version));
      setErrors({});
    }
    previousOpen.current = open;
  }, [open, version]);
  useEffect(() => {
    if (!open) {
      opener?.focus();
      return;
    }
    dialogRef.current?.querySelector<HTMLElement>('#revise-engagement-title')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lock.current) onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (lock.current) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      if (nodes.length && event.shiftKey && index <= 0) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (nodes.length && !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open, onClose, opener]);
  if (!open || !hasEngagementCapability(role, 'reviseDraft')) {
    return null;
  }
  const update = <K extends keyof EngagementTermsValues>(
    key: K,
    value: EngagementTermsValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const errorFor = (key: keyof EngagementTermsValues) => errors[key];
  const props = (key: keyof EngagementTermsValues) => ({
    'aria-invalid': Boolean(errorFor(key)),
    'aria-describedby': errorFor(key) ? `revise-${key}-error` : undefined,
    disabled: pending,
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || unavailable) {
      return;
    }

    const next = validateEngagementTerms(values, { partners, managers });
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() =>
        dialogRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }

    lock.current = true;
    setPending(true);
    try {
      const result = await onRevise(
        toReviseEngagementDraftInput(engagement.id, engagement.updatedAt, values),
      );
      if (result.success) onClose();
      else setErrors({ form: SAFE_REVISE_ERROR });
    } catch {
      setErrors({ form: SAFE_REVISE_ERROR });
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const select = (
    key: 'responsiblePartnerId' | 'deliveryManagerId',
    label: string,
    options: readonly DraftOption[],
  ) => (
    <div className="field">
      <label htmlFor={`revise-engagement-${key}`}>{label}</label>
      <select
        id={`revise-engagement-${key}`}
        value={values[key]}
        onChange={(event) => update(key, event.target.value)}
        {...props(key)}
      >
        <option value="">Select {label.toLowerCase()}…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {errorFor(key) ? (
        <small id={`revise-${key}-error`} className="field-error-text" role="alert">
          {errorFor(key)}
        </small>
      ) : null}
    </div>
  );
  const text = (
    key: 'title' | 'billingTerms' | 'agreedFee' | 'startDate' | 'endDate',
    label: string,
    type = 'text',
  ) => (
    <div className="field">
      <label htmlFor={`revise-engagement-${key}`}>{label}</label>
      <input
        id={`revise-engagement-${key}`}
        type={type}
        value={values[key]}
        onChange={(event) => update(key, event.target.value)}
        {...props(key)}
      />
      {errorFor(key) ? (
        <small id={`revise-${key}-error`} className="field-error-text" role="alert">
          {errorFor(key)}
        </small>
      ) : null}
    </div>
  );
  return (
    <div
      className="dialog-layer revision-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !lock.current) onClose();
      }}
    >
      <div
        className="dialog engagement-draft-dialog revise-engagement-dialog"
        tabIndex={-1}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revise-engagement-dialog-title"
        aria-describedby="revise-engagement-dialog-description"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <BriefcaseBusiness size={18} />
            </div>
            <div>
              <h2 id="revise-engagement-dialog-title">Revise draft engagement</h2>
              <p id="revise-engagement-dialog-description">
                Update the next immutable draft version.
              </p>
            </div>
          </div>
          <button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose} disabled={pending}>
            <X size={18} />
          </button>
        </header>
        <div className="revision-context">
          <strong>{engagement.code}</strong>
          <span>
            {engagement.clientName ?? 'Client unavailable'} · {engagement.serviceName ?? 'Service unavailable'}
          </span>
        </div>
        <form onSubmit={submit}>
          <div className="engagement-dialog-body">
            {Object.keys(errors).length > 0 && !errors.form ? (
              <div className="dialog-validation-summary" role="alert">
                <AlertTriangle size={16} /> Please correct the highlighted fields.
              </div>
            ) : null}
            {errors.form ? (
              <div className="dialog-validation-summary" role="alert">
                {errors.form}
              </div>
            ) : null}
            {unavailable ? (
              <div className="workspace-warning-banner" role="alert">
                The current partner or manager is unavailable in the directory. Refresh the directory before revising.
              </div>
            ) : null}
            <div className="form-grid">
              {text('title', 'Title')}
              <div className="field is-full">
                <label htmlFor="revise-engagement-scope">Scope</label>
                <textarea
                  id="revise-engagement-scope"
                  value={values.scope}
                  onChange={(event) => update('scope', event.target.value)}
                  {...props('scope')}
                />
                {errorFor('scope') ? (
                  <small id="revise-scope-error" className="field-error-text" role="alert">
                    {errorFor('scope')}
                  </small>
                ) : null}
              </div>
              <div className="field is-full">
                <label htmlFor="revise-engagement-exclusions">Exclusions</label>
                <textarea
                  id="revise-engagement-exclusions"
                  value={values.exclusions}
                  onChange={(event) => update('exclusions', event.target.value)}
                  {...props('exclusions')}
                />
              </div>
              {select('responsiblePartnerId', 'Responsible partner', partners)}
              {select('deliveryManagerId', 'Delivery manager', managers)}
              <div className="field">
                <label htmlFor="revise-engagement-feeModel">Fee model</label>
                <select
                  id="revise-engagement-feeModel"
                  value={values.feeModel}
                  onChange={(event) => update('feeModel', event.target.value as EngagementFeeModel)}
                  {...props('feeModel')}
                >
                  <option value="fixed">Fixed</option>
                  <option value="recurring">Recurring</option>
                  <option value="milestone">Milestone</option>
                  <option value="time_based">Time based</option>
                </select>
                {errorFor('feeModel') ? (
                  <small id="revise-feeModel-error" className="field-error-text" role="alert">
                    {errorFor('feeModel')}
                  </small>
                ) : null}
              </div>
              {text('agreedFee', 'Agreed fee (₹)')}
              {text('billingTerms', 'Billing terms')}
              {text('startDate', 'Start date', 'date')}
              {text('endDate', 'End date', 'date')}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending || unavailable}>
              <Check size={15} /> {pending ? 'Saving…' : 'Save revision'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
