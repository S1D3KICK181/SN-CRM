import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { UserCog, X } from 'lucide-react';
import {
  CLIENT_ENTITY_TYPES,
  CLIENT_STATUSES,
  INDIAN_STATES,
  type ClientDto,
  type ClientEntityType,
  type ClientStatus,
  type IndianState,
  type UpdateClientInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { ROLE_LABELS } from '../../data';
import { clientSaveErrorMessage } from '../../api/clients-types';
import { useTeamDirectory } from '../../api/use-team-directory';
import type { TeamDirectoryPort } from '../../api/team-directory-types';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';
import { ZOD_EMAIL_REGEX } from './create-client-dialog';
import { CLIENT_ENTITY_TYPE_LABELS, toClientStatusDetails } from './clients-view-model';

/** What the form sends: only the changed fields. The workspace-level caller adds nothing to it. */
export type EditClientChanges = UpdateClientInput;

export interface EditClientFormValues {
  displayName: string;
  legalName: string;
  entityType: string;
  relationshipOwnerId: string;
  status: string;
  pan: string;
  gstin: string;
  tan: string;
  cinLlpin: string;
  udyamNumber: string;
  iec: string;
  incorporationDate: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  email: string;
  phone: string;
  notes: string;
}

type FieldKey = keyof EditClientFormValues;
type EditClientErrors = Partial<Record<FieldKey, string>>;

/** The values as they would be sent: trimmed, identifiers upper-cased, empty as null. */
interface NormalizedValues {
  displayName: string;
  entityType: ClientEntityType | null;
  relationshipOwnerId: string | null;
  status: ClientStatus | null;
  state: IndianState | null;
  legalName: string | null;
  pan: string | null;
  gstin: string | null;
  tan: string | null;
  cinLlpin: string | null;
  udyamNumber: string | null;
  iec: string | null;
  incorporationDate: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

type PlainTextKey =
  | 'legalName'
  | 'pan'
  | 'gstin'
  | 'tan'
  | 'cinLlpin'
  | 'udyamNumber'
  | 'iec'
  | 'incorporationDate'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'pincode'
  | 'email'
  | 'phone'
  | 'notes';

const PLAIN_TEXT_KEYS: readonly PlainTextKey[] = [
  'legalName',
  'pan',
  'gstin',
  'tan',
  'cinLlpin',
  'udyamNumber',
  'iec',
  'incorporationDate',
  'addressLine1',
  'addressLine2',
  'city',
  'pincode',
  'email',
  'phone',
  'notes',
];

const UPPERCASE_KEYS: readonly PlainTextKey[] = ['pan', 'gstin', 'tan', 'cinLlpin', 'udyamNumber', 'iec'];

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const TAN_REGEX = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
const LLPIN_REGEX = /^[A-Z]{3}-[0-9]{4}$/;
const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
const IEC_REGEX = /^[A-Z0-9]{10}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

// The wording below is the API's, so a problem reads the same before and after the request.
export const EDIT_CLIENT_MESSAGES = {
  displayName: 'Display name must be between 2 and 180 characters.',
  legalName: 'Legal name must not exceed 200 characters.',
  entityType: 'Choose a valid entity type.',
  pan: 'Enter a valid 10-character PAN, like ABCDE1234F.',
  gstin: 'Enter a valid 15-character GSTIN.',
  gstinPanMismatch: 'The GSTIN does not match the PAN.',
  tan: 'Enter a valid TAN, like ABCD12345E.',
  cinLlpin: 'Enter a valid CIN or LLPIN.',
  udyamNumber: 'Enter a valid Udyam number, like UDYAM-MH-01-0000001.',
  iec: 'Enter a valid 10-character IEC.',
  incorporationDate: 'Must be a valid calendar date in YYYY-MM-DD format.',
  addressLine1: 'Address line 1 must not exceed 200 characters.',
  addressLine2: 'Address line 2 must not exceed 200 characters.',
  city: 'City must not exceed 100 characters.',
  state: 'Choose a state or union territory from the list.',
  pincode: 'Enter a valid 6-digit PIN code.',
  email: 'Invalid email address format.',
  phoneShort: 'Phone number must be at least 7 characters.',
  phoneLong: 'Phone number must not exceed 20 characters.',
  notes: 'Notes must not exceed 2000 characters.',
} as const;

export const NO_CHANGES_MESSAGE = 'There are no changes to save.';
export const OWNER_STATUS_NOTE = 'Only the Founder or Manager can change these.';

function initialValues(client: ClientDto): EditClientFormValues {
  return {
    displayName: client.displayName,
    legalName: client.legalName ?? '',
    entityType: client.entityType ?? '',
    relationshipOwnerId: client.relationshipOwnerId ?? '',
    status: client.status,
    pan: client.pan ?? '',
    gstin: client.gstin ?? '',
    tan: client.tan ?? '',
    cinLlpin: client.cinLlpin ?? '',
    udyamNumber: client.udyamNumber ?? '',
    iec: client.iec ?? '',
    incorporationDate: client.incorporationDate ?? '',
    addressLine1: client.addressLine1 ?? '',
    addressLine2: client.addressLine2 ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
    pincode: client.pincode ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    notes: client.notes ?? '',
  };
}

function normalize(values: EditClientFormValues): NormalizedValues {
  const text = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  const plain = {} as Record<PlainTextKey, string | null>;
  for (const key of PLAIN_TEXT_KEYS) {
    const cleaned = text(values[key]);
    plain[key] = cleaned !== null && UPPERCASE_KEYS.includes(key) ? cleaned.toUpperCase() : cleaned;
  }
  return {
    ...plain,
    displayName: values.displayName.trim(),
    entityType: CLIENT_ENTITY_TYPES.find((candidate) => candidate === values.entityType) ?? null,
    relationshipOwnerId: text(values.relationshipOwnerId),
    status: CLIENT_STATUSES.find((candidate) => candidate === values.status) ?? null,
    state: INDIAN_STATES.find((candidate) => candidate === values.state.trim()) ?? null,
  };
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The fields that differ from the client as loaded; the form can only send these. */
function changedKeys(before: NormalizedValues, after: NormalizedValues): Set<FieldKey> {
  const keys = new Set<FieldKey>();
  const fields: readonly FieldKey[] = [
    'displayName',
    'entityType',
    'relationshipOwnerId',
    'status',
    'state',
    ...PLAIN_TEXT_KEYS,
  ];
  for (const key of fields) {
    if (before[key] !== after[key]) keys.add(key);
  }
  return keys;
}

/**
 * Checks only the fields that changed, as the API does: a value saved earlier is never blocked.
 * The GSTIN is checked against the PAN whenever either one changed.
 */
function validateChanged(
  values: EditClientFormValues,
  next: NormalizedValues,
  changed: ReadonlySet<FieldKey>,
): EditClientErrors {
  const errors: EditClientErrors = {};
  const m = EDIT_CLIENT_MESSAGES;
  const has = (key: FieldKey) => changed.has(key);

  if (has('displayName') && (next.displayName.length < 2 || next.displayName.length > 180)) {
    errors.displayName = m.displayName;
  }
  if (has('legalName') && (next.legalName?.length ?? 0) > 200) errors.legalName = m.legalName;
  if (has('entityType') && values.entityType !== '' && next.entityType === null) errors.entityType = m.entityType;
  if (has('pan') && next.pan !== null && !PAN_REGEX.test(next.pan)) errors.pan = m.pan;
  if (has('gstin') && next.gstin !== null && !GSTIN_REGEX.test(next.gstin)) errors.gstin = m.gstin;
  if (
    (has('pan') || has('gstin')) &&
    !errors.pan &&
    !errors.gstin &&
    next.pan !== null &&
    next.gstin !== null &&
    next.gstin.slice(2, 12) !== next.pan
  ) {
    errors.gstin = m.gstinPanMismatch;
  }
  if (has('tan') && next.tan !== null && !TAN_REGEX.test(next.tan)) errors.tan = m.tan;
  if (has('cinLlpin') && next.cinLlpin !== null && !CIN_REGEX.test(next.cinLlpin) && !LLPIN_REGEX.test(next.cinLlpin)) {
    errors.cinLlpin = m.cinLlpin;
  }
  if (has('udyamNumber') && next.udyamNumber !== null && !UDYAM_REGEX.test(next.udyamNumber)) {
    errors.udyamNumber = m.udyamNumber;
  }
  if (has('iec') && next.iec !== null && !IEC_REGEX.test(next.iec)) errors.iec = m.iec;
  if (has('incorporationDate') && next.incorporationDate !== null && !isRealCalendarDate(next.incorporationDate)) {
    errors.incorporationDate = m.incorporationDate;
  }
  if (has('addressLine1') && (next.addressLine1?.length ?? 0) > 200) errors.addressLine1 = m.addressLine1;
  if (has('addressLine2') && (next.addressLine2?.length ?? 0) > 200) errors.addressLine2 = m.addressLine2;
  if (has('city') && (next.city?.length ?? 0) > 100) errors.city = m.city;
  if (has('state') && values.state.trim() !== '' && next.state === null) errors.state = m.state;
  if (has('pincode') && next.pincode !== null && !PINCODE_REGEX.test(next.pincode)) errors.pincode = m.pincode;
  if (has('email') && next.email !== null && !ZOD_EMAIL_REGEX.test(next.email)) errors.email = m.email;
  if (has('phone') && next.phone !== null) {
    if (next.phone.length < 7) errors.phone = m.phoneShort;
    else if (next.phone.length > 20) errors.phone = m.phoneLong;
  }
  if (has('notes') && (next.notes?.length ?? 0) > 2000) errors.notes = m.notes;
  return errors;
}

/** Builds the request body: only changed fields, null when a field was cleared. */
export function buildClientChanges(client: ClientDto, values: EditClientFormValues): EditClientChanges {
  const before = normalize(initialValues(client));
  const after = normalize(values);
  const changed = changedKeys(before, after);
  type Writable = { -readonly [K in keyof UpdateClientInput]: UpdateClientInput[K] };
  const body: Writable = { expectedUpdatedAt: client.updatedAt };
  if (changed.has('displayName')) body.displayName = after.displayName;
  if (changed.has('entityType')) body.entityType = after.entityType;
  if (changed.has('state')) body.state = after.state;
  if (changed.has('relationshipOwnerId')) body.relationshipOwnerId = after.relationshipOwnerId;
  if (changed.has('status') && after.status !== null) body.status = after.status;
  for (const key of PLAIN_TEXT_KEYS) {
    if (changed.has(key)) body[key] = after[key];
  }
  return body;
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type EditClientDialogProps = {
  /** The client as loaded when the dialog was opened; its updatedAt is the concurrency token. */
  client: ClientDto;
  role: CompanyRole;
  teamPort?: TeamDirectoryPort;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a ClientOperationError when not. */
  onSubmit: (input: EditClientChanges, idempotencyKey: string) => Promise<void>;
};

export function EditClientDialog({ client, role, teamPort, opener, onClose, onSubmit }: EditClientDialogProps) {
  const [values, setValues] = useState<EditClientFormValues>(() => initialValues(client));
  const [errors, setErrors] = useState<EditClientErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  const canChangeOwnerOrStatus = client.canChangeOwnerOrStatus;
  const teamDirectory = useTeamDirectory(role, { port: teamPort, enabled: canChangeOwnerOrStatus });
  const owners = useMemo(() => {
    const map = new Map<string, { id: string; name: string; role: CompanyRole }>();
    for (const line of teamDirectory.lines) {
      if (line.employee.role !== 'trainee') map.set(line.employee.id, line.employee);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [teamDirectory.lines]);

  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#edit-client-displayName')?.focus());
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

  const update = (key: FieldKey, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key] && !((key === 'pan' || key === 'gstin') && (current.pan || current.gstin))) return current;
      const next = { ...current, [key]: undefined };
      if (key === 'pan' || key === 'gstin') {
        next.pan = undefined;
        next.gstin = undefined;
      }
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const before = normalize(initialValues(client));
    const after = normalize(values);
    const changed = changedKeys(before, after);
    // A reader who may not change these never sends them, whatever the form holds.
    if (!canChangeOwnerOrStatus) {
      changed.delete('relationshipOwnerId');
      changed.delete('status');
    }
    const next = validateChanged(values, after, changed);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (changed.size === 0) {
      setFormError(NO_CHANGES_MESSAGE);
      return;
    }
    const input = buildClientChanges(client, canChangeOwnerOrStatus ? values : { ...values, relationshipOwnerId: client.relationshipOwnerId ?? '', status: client.status });
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
  const describedBy = (key: FieldKey, hint?: string) =>
    [hint ? `edit-client-${key}-hint` : null, errors[key] ? `edit-client-${key}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  const fieldError = (key: FieldKey) =>
    errors[key] ? (
      <small id={`edit-client-${key}-error`} className="field-error-text">
        {errors[key]}
      </small>
    ) : null;

  const textField = (
    key: FieldKey,
    label: string,
    options: { hint?: string; type?: 'text' | 'email' | 'tel' | 'date'; upper?: boolean; maxLength?: number } = {},
  ): ReactNode => (
    <div className="field">
      <label htmlFor={`edit-client-${key}`}>{label}</label>
      <input
        id={`edit-client-${key}`}
        type={options.type ?? 'text'}
        value={values[key]}
        maxLength={options.maxLength}
        autoComplete="off"
        spellCheck={options.upper ? false : undefined}
        disabled={pending}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(key, options.hint)}
        onChange={(event) => update(key, options.upper ? event.target.value.toUpperCase() : event.target.value)}
      />
      {options.hint ? <small id={`edit-client-${key}-hint`}>{options.hint}</small> : null}
      {fieldError(key)}
    </div>
  );

  const selectField = (key: FieldKey, label: string, children: ReactNode): ReactNode => (
    <div className="field">
      <label htmlFor={`edit-client-${key}`}>{label}</label>
      <select
        id={`edit-client-${key}`}
        value={values[key]}
        disabled={pending}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(key)}
        onChange={(event) => update(key, event.target.value)}
      >
        {children}
      </select>
      {fieldError(key)}
    </div>
  );

  const group = (title: string, children: ReactNode): ReactNode => (
    <fieldset style={{ margin: 0, padding: 0, border: 0, minWidth: 0, display: 'grid', gap: 12 }}>
      <legend style={{ padding: 0, marginBottom: 8, fontSize: 13, fontWeight: 750, color: 'var(--ink-strong)' }}>{title}</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>{children}</div>
    </fieldset>
  );

  const ownerKnown = owners.some((owner) => owner.id === client.relationshipOwnerId);
  const statusLabel = toClientStatusDetails(client.status).label;

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
        aria-labelledby="edit-client-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
        style={{ width: 'min(820px, calc(100vw - 64px))' }}
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <UserCog size={18} />
            </div>
            <div>
              <h2 id="edit-client-title">Edit {client.displayName}</h2>
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

            {group(
              'Basics',
              <>
                {textField('displayName', 'Display name')}
                {textField('legalName', 'Legal name')}
                {selectField(
                  'entityType',
                  'Entity type',
                  <>
                    <option value="">Not set</option>
                    {CLIENT_ENTITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {CLIENT_ENTITY_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </>,
                )}
                <div />
                {canChangeOwnerOrStatus ? (
                  <>
                    {selectField(
                      'relationshipOwnerId',
                      'Relationship owner',
                      <>
                        <option value="">(Unassigned)</option>
                        {client.relationshipOwnerId && !ownerKnown ? (
                          <option value={client.relationshipOwnerId}>{client.relationshipOwnerName ?? 'Current owner'}</option>
                        ) : null}
                        {owners.map((owner) => (
                          <option key={owner.id} value={owner.id}>
                            {owner.name} ({ROLE_LABELS[owner.role] ?? owner.role})
                          </option>
                        ))}
                      </>,
                    )}
                    {selectField(
                      'status',
                      'Status',
                      <>
                        {CLIENT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {toClientStatusDetails(status).label}
                          </option>
                        ))}
                      </>,
                    )}
                  </>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="edit-client-relationshipOwnerId">Relationship owner</label>
                      <input
                        id="edit-client-relationshipOwnerId"
                        type="text"
                        readOnly
                        value={client.relationshipOwnerName ?? 'Unassigned'}
                        aria-describedby="edit-client-owner-status-note"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="edit-client-status">Status</label>
                      <input
                        id="edit-client-status"
                        type="text"
                        readOnly
                        value={statusLabel}
                        aria-describedby="edit-client-owner-status-note"
                      />
                    </div>
                    <small
                      id="edit-client-owner-status-note"
                      style={{ gridColumn: '1 / -1', color: 'var(--ink-muted)', fontSize: 12, fontWeight: 500 }}
                    >
                      {OWNER_STATUS_NOTE}
                    </small>
                  </>
                )}
              </>,
            )}

            {group(
              'Tax and registrations',
              <>
                {textField('pan', 'PAN', { upper: true, maxLength: 10 })}
                {textField('gstin', 'GSTIN', { upper: true, maxLength: 15 })}
                {textField('tan', 'TAN', { upper: true, maxLength: 10 })}
                {textField('cinLlpin', 'CIN or LLPIN', { upper: true, maxLength: 21 })}
                {textField('udyamNumber', 'Udyam number', { upper: true, maxLength: 19 })}
                {textField('iec', 'IEC', { upper: true, maxLength: 10 })}
                {textField('incorporationDate', 'Date of incorporation or birth', { type: 'date' })}
              </>,
            )}

            {group(
              'Address',
              <>
                {textField('addressLine1', 'Address line 1')}
                {textField('addressLine2', 'Address line 2')}
                {textField('city', 'City')}
                {selectField(
                  'state',
                  'State',
                  <>
                    <option value="">Select a state</option>
                    {values.state !== '' && !INDIAN_STATES.some((state) => state === values.state) ? (
                      <option value={values.state}>{values.state}</option>
                    ) : null}
                    {INDIAN_STATES.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </>,
                )}
                {textField('pincode', 'PIN code', { maxLength: 6 })}
              </>,
            )}

            {group(
              'Contact',
              <>
                {textField('email', 'Email', { type: 'email' })}
                {textField('phone', 'Phone', { type: 'tel' })}
              </>,
            )}

            <div className="field">
              <label htmlFor="edit-client-notes">Notes</label>
              <textarea
                id="edit-client-notes"
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
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
