import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { UserMinus, UserPlus, X } from 'lucide-react';
import type { ClientContactDto, UpdateClientContactInput } from '@sn/contracts';
import { clientSaveErrorMessage } from '../../api/clients-types';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';
import { ZOD_EMAIL_REGEX } from './create-client-dialog';

/** What the contact form saves; null clears an optional field. */
export interface ContactFormInput {
  readonly name: string;
  readonly designation: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly whatsapp: string | null;
  readonly isPrimary: boolean;
  readonly notes: string | null;
}

interface ContactFormValues {
  name: string;
  designation: string;
  email: string;
  phone: string;
  whatsapp: string;
  isPrimary: boolean;
  notes: string;
}

type TextKey = 'name' | 'designation' | 'email' | 'phone' | 'whatsapp' | 'notes';
type ContactErrors = Partial<Record<TextKey, string>>;

const CONTACT_PHONE_REGEX = /^[0-9 +-]+$/;

// The wording below is the API's, so a problem reads the same before and after the request.
export const CONTACT_MESSAGES = {
  name: 'Contact name must be between 2 and 120 characters.',
  designation: 'Designation must not exceed 80 characters.',
  emailLong: 'Email must not exceed 254 characters.',
  email: 'Invalid email address format.',
  phoneLong: 'Phone number must not exceed 20 characters.',
  phoneShape: 'Phone number may contain only digits, spaces, + and -.',
  whatsappLong: 'WhatsApp number must not exceed 20 characters.',
  whatsappShape: 'WhatsApp number may contain only digits, spaces, + and -.',
  notes: 'Notes must not exceed 300 characters.',
  unreachable: 'Add at least one way to reach this contact.',
} as const;

export const CONTACT_NO_CHANGES_MESSAGE = 'There are no changes to save.';

function initialValues(contact: ClientContactDto | null): ContactFormValues {
  if (!contact) {
    return { name: '', designation: '', email: '', phone: '', whatsapp: '', isPrimary: false, notes: '' };
  }
  return {
    name: contact.name,
    designation: contact.designation ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    whatsapp: contact.whatsapp ?? '',
    isPrimary: contact.isPrimary,
    notes: contact.notes ?? '',
  };
}

function toInput(values: ContactFormValues): ContactFormInput {
  const text = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    name: values.name.trim(),
    designation: text(values.designation),
    email: text(values.email),
    phone: text(values.phone),
    whatsapp: text(values.whatsapp),
    isPrimary: values.isPrimary,
    notes: text(values.notes),
  };
}

function validateContact(input: ContactFormInput): ContactErrors {
  const errors: ContactErrors = {};
  const m = CONTACT_MESSAGES;
  if (input.name.length < 2 || input.name.length > 120) errors.name = m.name;
  if ((input.designation?.length ?? 0) > 80) errors.designation = m.designation;
  if (input.email !== null) {
    if (input.email.length > 254) errors.email = m.emailLong;
    else if (!ZOD_EMAIL_REGEX.test(input.email)) errors.email = m.email;
  }
  if (input.phone !== null) {
    if (input.phone.length > 20) errors.phone = m.phoneLong;
    else if (!CONTACT_PHONE_REGEX.test(input.phone)) errors.phone = m.phoneShape;
  }
  if (input.whatsapp !== null) {
    if (input.whatsapp.length > 20) errors.whatsapp = m.whatsappLong;
    else if (!CONTACT_PHONE_REGEX.test(input.whatsapp)) errors.whatsapp = m.whatsappShape;
  }
  if ((input.notes?.length ?? 0) > 300) errors.notes = m.notes;
  if (!errors.email && !input.email && !input.phone && !input.whatsapp) errors.email = m.unreachable;
  return errors;
}

/** Only the fields that differ from the saved contact, plus the concurrency token. */
export function buildContactChanges(contact: ClientContactDto, input: ContactFormInput): UpdateClientContactInput {
  type Writable = { -readonly [K in keyof UpdateClientContactInput]: UpdateClientContactInput[K] };
  const body: Writable = { expectedUpdatedAt: contact.updatedAt };
  if (input.name !== contact.name) body.name = input.name;
  if (input.designation !== contact.designation) body.designation = input.designation;
  if (input.email !== contact.email) body.email = input.email;
  if (input.phone !== contact.phone) body.phone = input.phone;
  if (input.whatsapp !== contact.whatsapp) body.whatsapp = input.whatsapp;
  if (input.isPrimary !== contact.isPrimary) body.isPrimary = input.isPrimary;
  if (input.notes !== contact.notes) body.notes = input.notes;
  return body;
}

function hasContactChanges(contact: ClientContactDto, input: ContactFormInput): boolean {
  return Object.keys(buildContactChanges(contact, input)).length > 1;
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type ClientContactDialogProps = {
  /** The contact being edited as loaded when the dialog opened; null adds a new one. */
  contact: ClientContactDto | null;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a ClientOperationError when not. */
  onSubmit: (input: ContactFormInput, idempotencyKey: string) => Promise<void>;
};

export function ClientContactDialog({ contact, opener, onClose, onSubmit }: ClientContactDialogProps) {
  const [values, setValues] = useState<ContactFormValues>(() => initialValues(contact));
  const [sameAsPhone, setSameAsPhone] = useState<boolean>(
    () => contact !== null && contact.phone !== null && contact.phone === contact.whatsapp,
  );
  const [errors, setErrors] = useState<ContactErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#client-contact-name')?.focus());
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
    return () => {
      document.removeEventListener('keydown', onKey);
      openerRef.current?.focus();
    };
  }, []);

  const clearError = (key: TextKey) => {
    // Reachability is reported on the email field, so any way of reaching the contact clears it.
    const reach = key === 'phone' || key === 'whatsapp';
    setErrors((current) => (current[key] || (reach && current.email) ? { ...current, [key]: undefined, ...(reach ? { email: undefined } : {}) } : current));
  };

  const update = (key: TextKey, value: string) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === 'phone' && sameAsPhone) next.whatsapp = value;
      return next;
    });
    clearError(key);
    if (key === 'phone' && sameAsPhone) clearError('whatsapp');
  };

  const toggleSameAsPhone = (checked: boolean) => {
    setSameAsPhone(checked);
    if (checked) {
      setValues((current) => ({ ...current, whatsapp: current.phone }));
      clearError('whatsapp');
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const input = toInput(values);
    const next = validateContact(input);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (contact && !hasContactChanges(contact, input)) {
      setFormError(CONTACT_NO_CHANGES_MESSAGE);
      return;
    }
    // The same unchanged form retries with the same key; any edit mints a new one.
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(clientSaveErrorMessage(err));
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  const hasFieldErrors = Object.values(errors).some(Boolean);
  const describedBy = (key: TextKey) => (errors[key] ? `client-contact-${key}-error` : undefined);
  const fieldError = (key: TextKey) =>
    errors[key] ? (
      <small id={`client-contact-${key}-error`} className="field-error-text">
        {errors[key]}
      </small>
    ) : null;

  const textField = (
    key: TextKey,
    label: string,
    options: { type?: 'text' | 'email' | 'tel'; disabled?: boolean } = {},
  ): ReactNode => (
    <div className="field">
      <label htmlFor={`client-contact-${key}`}>{label}</label>
      <input
        id={`client-contact-${key}`}
        type={options.type ?? 'text'}
        value={values[key]}
        autoComplete="off"
        disabled={pending || options.disabled}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(key)}
        onChange={(event) => update(key, event.target.value)}
      />
      {fieldError(key)}
    </div>
  );

  const checkboxStyle = { width: 16, height: 16, margin: 0, flex: 'none', accentColor: 'var(--brand)' } as const;
  const checkboxLabelStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--ink)',
    cursor: 'pointer',
  } as const;

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
        aria-labelledby="client-contact-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <UserPlus size={18} />
            </div>
            <div>
              <h2 id="client-contact-title">{contact ? `Edit ${contact.name}` : 'Add contact'}</h2>
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
            {textField('name', 'Name')}
            {textField('designation', 'Designation')}
            {textField('email', 'Email', { type: 'email' })}
            {textField('phone', 'Phone', { type: 'tel' })}
            {textField('whatsapp', 'WhatsApp number', { type: 'tel', disabled: sameAsPhone })}
            <div>
              {/* Not a .field: its input rules would stretch the checkbox to full width. */}
              <label htmlFor="client-contact-same-as-phone" style={checkboxLabelStyle}>
                <input
                  id="client-contact-same-as-phone"
                  type="checkbox"
                  checked={sameAsPhone}
                  disabled={pending}
                  onChange={(event) => toggleSameAsPhone(event.target.checked)}
                  style={checkboxStyle}
                />
                Same as phone
              </label>
            </div>
            <div>
              <label htmlFor="client-contact-primary" style={checkboxLabelStyle}>
                <input
                  id="client-contact-primary"
                  type="checkbox"
                  checked={values.isPrimary}
                  disabled={pending}
                  aria-describedby="client-contact-primary-hint"
                  onChange={(event) => setValues((current) => ({ ...current, isPrimary: event.target.checked }))}
                  style={checkboxStyle}
                />
                Primary contact
              </label>
              <small
                id="client-contact-primary-hint"
                style={{ display: 'block', margin: '4px 0 0 24px', fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}
              >
                The main person to reach at this client.
              </small>
            </div>
            <div className="field">
              <label htmlFor="client-contact-notes">Notes</label>
              <textarea
                id="client-contact-notes"
                rows={3}
                value={values.notes}
                disabled={pending}
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby={describedBy('notes')}
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
              {pending ? 'Saving…' : 'Save contact'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

type RemoveContactDialogProps = {
  contactName: string;
  clientName: string;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when removed; rejects with a ClientOperationError when not. */
  onSubmit: () => Promise<void>;
};

const confirmFocusable = 'button:not([disabled])';

export function RemoveContactDialog({ contactName, clientName, opener, onClose, onSubmit }: RemoveContactDialogProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useEffect(() => {
    requestAnimationFrame(() => keepRef.current?.focus());
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
    return () => {
      document.removeEventListener('keydown', onKey);
      openerRef.current?.focus();
    };
  }, []);

  const confirm = async () => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err: unknown) {
      setFormError(clientSaveErrorMessage(err));
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
        aria-labelledby="remove-contact-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <UserMinus size={18} />
            </div>
            <div>
              <h2 id="remove-contact-title">Remove {contactName}?</h2>
              <p>They will be removed from {clientName}&apos;s contact people.</p>
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
            Keep
          </button>
          <button className="primary-button engagement-end-confirm" type="button" onClick={confirm} disabled={pending}>
            {pending ? 'Removing…' : 'Remove contact'}
          </button>
        </footer>
      </div>
    </div>
  );
}
