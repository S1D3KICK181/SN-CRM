import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Ban, Briefcase, X } from 'lucide-react';
import type { ServiceDto } from '@sn/contracts';
import { serviceSaveErrorMessage } from '../../api/service-catalog-types';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';

/** What the service form saves; the workspace adds the concurrency token for an edit. */
export interface ServiceFormInput {
  readonly name: string;
  readonly description: string | null;
  readonly turnaroundDays: number | null;
  readonly isStatutory: boolean;
}

interface ServiceFormValues {
  name: string;
  description: string;
  turnaroundDays: string;
  isStatutory: boolean;
}

type ServiceFormErrors = Partial<Record<'name' | 'description' | 'turnaroundDays', string>>;

const NAME_MIN = 2;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;
const TURNAROUND_MAX_DAYS = 365;

export const SERVICE_NAME_ERROR = 'Enter a service name of 2 to 120 characters.';
export const SERVICE_DESCRIPTION_ERROR = 'Use at most 500 characters.';
export const SERVICE_TURNAROUND_ERROR = 'Enter whole days from 0 to 365, or leave it empty.';

function initialValues(service: ServiceDto | null): ServiceFormValues {
  if (!service) return { name: '', description: '', turnaroundDays: '', isStatutory: false };
  return {
    name: service.name,
    description: service.description ?? '',
    turnaroundDays: service.turnaroundDays === null ? '' : String(service.turnaroundDays),
    isStatutory: service.isStatutory,
  };
}

function validateServiceForm(values: ServiceFormValues): ServiceFormErrors {
  const errors: ServiceFormErrors = {};
  const nameLength = values.name.trim().length;
  if (nameLength < NAME_MIN || nameLength > NAME_MAX) errors.name = SERVICE_NAME_ERROR;
  if (values.description.trim().length > DESCRIPTION_MAX) errors.description = SERVICE_DESCRIPTION_ERROR;
  const days = values.turnaroundDays.trim();
  if (days !== '' && (!/^\d+$/.test(days) || Number(days) > TURNAROUND_MAX_DAYS)) {
    errors.turnaroundDays = SERVICE_TURNAROUND_ERROR;
  }
  return errors;
}

function toServiceFormInput(values: ServiceFormValues): ServiceFormInput {
  const description = values.description.trim();
  const days = values.turnaroundDays.trim();
  return {
    name: values.name.trim(),
    description: description === '' ? null : description,
    turnaroundDays: days === '' ? null : Number(days),
    isStatutory: values.isStatutory,
  };
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type ServiceDialogProps = {
  open: boolean;
  /** The service being edited; null adds a new one. */
  service: ServiceDto | null;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a ServiceCatalogOperationError when not. */
  onSubmit: (input: ServiceFormInput, idempotencyKey: string) => Promise<void>;
};

export function ServiceDialog({ open, service, opener, onClose, onSubmit }: ServiceDialogProps) {
  const [values, setValues] = useState<ServiceFormValues>(() => initialValues(service));
  const [errors, setErrors] = useState<ServiceFormErrors>({});
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
      setValues(initialValues(service));
      setErrors({});
      setFormError(null);
      attempt.current = null;
    }
  }, [open, service]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#service-name')?.focus());
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

  const update = <K extends keyof ServiceFormValues>(key: K, value: ServiceFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (key !== 'isStatutory') setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const next = validateServiceForm(values);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input = toServiceFormInput(values);
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(serviceSaveErrorMessage(err, input.name));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  const hasFieldErrors = Object.values(errors).some(Boolean);
  const describedBy = (key: 'name' | 'description' | 'turnaroundDays', hint: boolean) =>
    [hint ? `service-${key}-hint` : null, errors[key] ? `service-${key}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const fieldError = (key: 'name' | 'description' | 'turnaroundDays') =>
    errors[key] ? (
      <small id={`service-${key}-error`} className="field-error-text">
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
        aria-labelledby="service-dialog-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <Briefcase size={18} />
            </div>
            <div>
              <h2 id="service-dialog-title">{service ? `Edit ${service.name}` : 'Add service'}</h2>
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
              <label htmlFor="service-name">Name</label>
              <input
                id="service-name"
                type="text"
                value={values.name}
                disabled={pending}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={describedBy('name', false)}
                onChange={(event) => update('name', event.target.value)}
              />
              {fieldError('name')}
            </div>
            <div className="field">
              <label htmlFor="service-description">Description</label>
              <textarea
                id="service-description"
                rows={3}
                value={values.description}
                disabled={pending}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={describedBy('description', false)}
                onChange={(event) => update('description', event.target.value)}
              />
              {fieldError('description')}
            </div>
            <div className="field">
              <label htmlFor="service-turnaroundDays">Usual turnaround (days)</label>
              <input
                id="service-turnaroundDays"
                type="text"
                inputMode="numeric"
                value={values.turnaroundDays}
                disabled={pending}
                aria-invalid={errors.turnaroundDays ? true : undefined}
                aria-describedby={describedBy('turnaroundDays', true)}
                onChange={(event) => update('turnaroundDays', event.target.value)}
              />
              <small id="service-turnaroundDays-hint">Used later to flag work that runs late.</small>
              {fieldError('turnaroundDays')}
            </div>
            <div>
              {/* Not a .field: its input rules would stretch the checkbox to full width. */}
              <label
                htmlFor="service-isStatutory"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
              >
                <input
                  id="service-isStatutory"
                  type="checkbox"
                  checked={values.isStatutory}
                  disabled={pending}
                  aria-describedby="service-isStatutory-hint"
                  onChange={(event) => update('isStatutory', event.target.checked)}
                  style={{ width: 16, height: 16, margin: 0, flex: 'none', accentColor: 'var(--brand)' }}
                />
                Has statutory due dates
              </label>
              <small
                id="service-isStatutory-hint"
                style={{ display: 'block', margin: '4px 0 0 24px', fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}
              >
                For filings with government due dates, like GST and income tax returns.
              </small>
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save service'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

type DeactivateServiceDialogProps = {
  open: boolean;
  serviceName: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when deactivated; rejects with a ServiceCatalogOperationError when not. */
  onSubmit: (idempotencyKey: string) => Promise<void>;
};

const confirmFocusable = 'button:not([disabled])';

export function DeactivateServiceDialog({ open, serviceName, opener, onClose, onSubmit }: DeactivateServiceDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
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
      requestAnimationFrame(() => keepRef.current?.focus());
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
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(confirmFocusable)];
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

  const confirm = async () => {
    if (lock.current) return;
    // Nothing about the request changes between tries, so a retry after a failure reuses the key.
    attempt.current = nextSaveAttempt(attempt.current, { isActive: false });
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(serviceSaveErrorMessage(err, serviceName));
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
        aria-labelledby="deactivate-service-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <Ban size={18} />
            </div>
            <div>
              <h2 id="deactivate-service-title">Deactivate {serviceName}?</h2>
              <p>
                It will no longer be offered for new work. Existing assignments and schedules keep it, and you can
                reactivate it at any time.
              </p>
            </div>
          </div>
          <button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose} disabled={pending}>
            <X size={18} />
          </button>
        </header>
        {formError ? (
          <div className="engagement-dialog-body end-engagement-fields">
            <p className="dialog-validation-summary" role="alert">
              {formError}
            </p>
          </div>
        ) : null}
        <footer className="dialog-footer">
          <button ref={keepRef} className="soft-button" type="button" onClick={onClose} disabled={pending}>
            Keep it
          </button>
          <button className="primary-button engagement-end-confirm" type="button" onClick={confirm} disabled={pending}>
            {pending ? 'Deactivating…' : 'Deactivate'}
          </button>
        </footer>
      </div>
    </div>
  );
}
