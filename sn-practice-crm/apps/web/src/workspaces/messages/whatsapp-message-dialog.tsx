import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { MESSAGE_PURPOSES, type MessagePurpose, type RecordClientMessageInput } from '@sn/contracts';
import { MESSAGE_PURPOSE_LABELS, messageErrorMessage } from '../../api/messages-types';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';
import {
  MESSAGE_BODY_ERROR,
  MESSAGE_BODY_MAX,
  WHATSAPP_NUMBER_ERROR,
  buildMessageDraft,
  formatWhatsAppNumber,
  normalizeWhatsAppNumber,
  whatsAppLink,
} from './message-templates';

/** A contact person of the client, as much of it as the dialog needs. */
export interface MessageRecipientContact {
  readonly id: string;
  readonly name: string;
  readonly designation: string | null;
  readonly phone: string | null;
  readonly whatsapp: string | null;
  readonly isPrimary: boolean;
}

export interface MessageClientInfo {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string | null;
  /** Primary contact first. */
  readonly contacts: readonly MessageRecipientContact[];
}

export interface MessageAssignmentLink {
  readonly id: string;
  readonly code: string | null;
  readonly title: string;
  /** DD/MM/YYYY */
  readonly dueOn: string | null;
}

export interface MessageBillLink {
  readonly id: string;
  /** The Vyapar bill number, or the CRM code. */
  readonly label: string;
  /** DD/MM/YYYY */
  readonly billDate: string;
  /** DD/MM/YYYY */
  readonly dueDate: string;
  readonly pendingPaise: number;
  readonly overdue: boolean;
}

export interface MessageComposeSetup {
  readonly client: MessageClientInfo;
  readonly purpose: MessagePurpose;
  readonly assignment?: MessageAssignmentLink | null;
  readonly bill?: MessageBillLink | null;
}

interface RecipientOption {
  readonly value: string;
  readonly label: string;
  readonly name: string;
  readonly contactId: string | null;
  /** The person's first-name source for the greeting; null for the client's own phone. */
  readonly greetingFrom: string | null;
  readonly number: string;
}

const OTHER_VALUE = 'other';
const NO_RECIPIENT_MESSAGE = 'Add a contact with a WhatsApp number first.';
const COPY_FAILED_MESSAGE = 'The text could not be copied. Select it and copy it by hand.';

/** Contacts with a WhatsApp number or phone, then the client's own phone. */
export function recipientOptions(client: MessageClientInfo): RecipientOption[] {
  const options: RecipientOption[] = [];
  for (const contact of client.contacts) {
    const number = contact.whatsapp?.trim() || contact.phone?.trim() || '';
    if (number === '') continue;
    options.push({
      value: `contact:${contact.id}`,
      label: [contact.name, contact.designation, formatWhatsAppNumber(number)].filter(Boolean).join(' · '),
      name: contact.name,
      contactId: contact.id,
      greetingFrom: contact.name,
      number,
    });
  }
  const clientPhone = client.phone?.trim() ?? '';
  if (clientPhone !== '') {
    options.push({
      value: 'client',
      label: [client.displayName, 'Client phone', formatWhatsAppNumber(clientPhone)].join(' · '),
      name: client.displayName,
      contactId: null,
      greetingFrom: null,
      number: clientPhone,
    });
  }
  return options;
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type WhatsAppMessageDialogProps = {
  open: boolean;
  setup: MessageComposeSetup | null;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Records the message. Resolves when recorded; rejects with a MessagesOperationError when not. */
  onRecord: (input: RecordClientMessageInput, idempotencyKey: string) => Promise<void>;
  onToast: (message: string) => void;
};

export function WhatsAppMessageDialog({ open, setup, opener, onClose, onRecord, onToast }: WhatsAppMessageDialogProps) {
  const options = useMemo(() => (setup ? recipientOptions(setup.client) : []), [setup]);
  const [recipient, setRecipient] = useState(OTHER_VALUE);
  const [otherNumber, setOtherNumber] = useState('');
  const [purpose, setPurpose] = useState<MessagePurpose>('general');
  const [body, setBody] = useState('');
  const [bodyEdited, setBodyEdited] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
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

  const draftFor = (nextPurpose: MessagePurpose, option: RecipientOption | undefined): string =>
    buildMessageDraft(nextPurpose, {
      contactName: option?.greetingFrom ?? null,
      assignmentTitle: setup?.assignment?.title ?? null,
      assignmentDueOn: setup?.assignment?.dueOn ?? null,
      billNumber: setup?.bill?.label ?? null,
      billDate: setup?.bill?.billDate ?? null,
      billDueDate: setup?.bill?.dueDate ?? null,
      billPendingPaise: setup?.bill?.pendingPaise ?? null,
      billOverdue: setup?.bill?.overdue ?? false,
    });

  useLayoutEffect(() => {
    if (open && !wasOpen.current && setup) {
      const first = options[0];
      setRecipient(first ? first.value : OTHER_VALUE);
      setOtherNumber('');
      setPurpose(setup.purpose);
      setBody(draftFor(setup.purpose, first));
      setBodyEdited(false);
      setPendingDraft(null);
      setNumberError(null);
      setBodyError(null);
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
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#message-body')?.focus());
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

  if (!open || !setup) return null;

  const selected = options.find((option) => option.value === recipient);
  const noRecipients = options.length === 0;

  const chooseRecipient = (value: string) => {
    setRecipient(value);
    setNumberError(null);
    // A text the user has not touched keeps up with the person it greets; their own words are left alone.
    if (!bodyEdited) {
      setBody(draftFor(purpose, options.find((option) => option.value === value)));
      setPendingDraft(null);
    }
  };

  const choosePurpose = (value: string) => {
    const next = MESSAGE_PURPOSES.find((candidate) => candidate === value);
    if (!next) return;
    setPurpose(next);
    const draft = draftFor(next, selected);
    if (bodyEdited) {
      setPendingDraft(draft);
    } else {
      setBody(draft);
      setPendingDraft(null);
    }
  };

  const currentNumber = (): string => (selected ? selected.number : otherNumber);

  const validate = (): string | null => {
    const digits = normalizeWhatsAppNumber(currentNumber());
    setNumberError(digits === null ? WHATSAPP_NUMBER_ERROR : null);
    const bodyProblem = body.trim().length < 1 || body.length > MESSAGE_BODY_MAX ? MESSAGE_BODY_ERROR : null;
    setBodyError(bodyProblem);
    if (digits === null || bodyProblem) {
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return null;
    }
    return digits;
  };

  const copyText = async () => {
    if (lock.current) return;
    setFormError(null);
    if (body.trim().length === 0) {
      setBodyError(MESSAGE_BODY_ERROR);
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      onToast('Message copied.');
    } catch {
      setFormError(COPY_FAILED_MESSAGE);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const digits = validate();
    if (digits === null) {
      setFormError(null);
      return;
    }
    const recipientName = selected ? selected.name : setup.client.displayName;
    const input: RecordClientMessageInput = {
      clientId: setup.client.id,
      ...(selected?.contactId ? { contactId: selected.contactId } : {}),
      recipientName,
      recipientNumber: digits,
      purpose,
      ...(setup.assignment ? { assignmentId: setup.assignment.id } : {}),
      ...(setup.bill ? { invoiceId: setup.bill.id } : {}),
      body,
    };
    // The same message to the same person means the same record on a retry.
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onRecord(input, attempt.current.key);
    } catch (err: unknown) {
      // Recording failed: WhatsApp stays closed so nothing is sent that is not on the log.
      setFormError(messageErrorMessage(err));
      lock.current = false;
      setPending(false);
      return;
    }
    lock.current = false;
    setPending(false);
    window.open(whatsAppLink(digits, body), '_blank', 'noopener');
    onClose();
    onToast(`WhatsApp opened for ${recipientName}. Press Send in WhatsApp to deliver it.`);
  };

  const linkedWork = setup.assignment
    ? [setup.assignment.code, setup.assignment.title].filter(Boolean).join(' · ')
    : setup.bill
    ? `Bill ${setup.bill.label}`
    : null;

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
        aria-labelledby="whatsapp-message-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <MessageCircle size={18} />
            </div>
            <div>
              <h2 id="whatsapp-message-title">Message on WhatsApp</h2>
              <p>
                {setup.client.displayName}
                {linkedWork ? ` · ${linkedWork}` : ''}
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
              <label htmlFor="message-recipient">Send to</label>
              <select
                id="message-recipient"
                value={recipient}
                disabled={pending}
                aria-invalid={numberError && selected ? true : undefined}
                aria-describedby={noRecipients ? 'message-recipient-hint' : undefined}
                onChange={(event) => chooseRecipient(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value={OTHER_VALUE}>Another number</option>
              </select>
              {noRecipients ? (
                <small id="message-recipient-hint" className="field-error-text">
                  {NO_RECIPIENT_MESSAGE}
                </small>
              ) : null}
              {numberError && selected ? (
                <small id="message-number-error" className="field-error-text">
                  {numberError}
                </small>
              ) : null}
            </div>
            {!selected ? (
              <div className="field">
                <label htmlFor="message-number">WhatsApp number</label>
                <input
                  id="message-number"
                  type="tel"
                  inputMode="tel"
                  value={otherNumber}
                  disabled={pending}
                  aria-invalid={numberError ? true : undefined}
                  aria-describedby={numberError ? 'message-number-error' : undefined}
                  onChange={(event) => {
                    setOtherNumber(event.target.value);
                    setNumberError(null);
                  }}
                />
                {numberError ? (
                  <small id="message-number-error" className="field-error-text">
                    {numberError}
                  </small>
                ) : null}
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="message-purpose">Purpose</label>
              <select
                id="message-purpose"
                value={purpose}
                disabled={pending}
                onChange={(event) => choosePurpose(event.target.value)}
              >
                {MESSAGE_PURPOSES.map((value) => (
                  <option key={value} value={value}>
                    {MESSAGE_PURPOSE_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {pendingDraft !== null ? (
              <div className="drawer-notice-box" role="group" aria-label="Replace your text">
                <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ink)' }}>Replace your text with the new draft?</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="soft-button"
                    type="button"
                    onClick={() => {
                      setBody(pendingDraft);
                      setBodyEdited(false);
                      setPendingDraft(null);
                      setBodyError(null);
                    }}
                  >
                    Yes
                  </button>
                  <button className="soft-button" type="button" onClick={() => setPendingDraft(null)}>
                    Keep mine
                  </button>
                </div>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="message-body">Message</label>
              <textarea
                id="message-body"
                rows={7}
                value={body}
                disabled={pending}
                aria-invalid={bodyError ? true : undefined}
                aria-describedby={['message-body-count', bodyError ? 'message-body-error' : null].filter(Boolean).join(' ')}
                onChange={(event) => {
                  setBody(event.target.value);
                  setBodyEdited(true);
                  setBodyError(null);
                }}
              />
              <small id="message-body-count">
                {body.length} / {MESSAGE_BODY_MAX}
              </small>
              {bodyError ? (
                <small id="message-body-error" className="field-error-text">
                  {bodyError}
                </small>
              ) : null}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="soft-button" type="button" onClick={() => void copyText()} disabled={pending}>
              Copy text
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Opening…' : 'Open in WhatsApp'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
