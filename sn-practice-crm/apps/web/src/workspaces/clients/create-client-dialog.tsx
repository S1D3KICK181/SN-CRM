import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { ClientDto, CreateClientInput, ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { ROLE_LABELS } from '../../data';
import {
  sanitizeCreateClientError,
  type ClientOperationError,
} from '../../api/clients-types';
import { useTeamDirectory } from '../../api/use-team-directory';
import type {
  TeamDirectoryOperationError,
  TeamDirectoryPort,
} from '../../api/team-directory-types';

export interface CreateClientDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreateClientInput) => Promise<ClientDto | null>;
  readonly role?: CompanyRole;
  readonly teamPort?: TeamDirectoryPort;
  readonly reportingLines?: ReportingLineDto[];
  readonly teamLoading?: boolean;
  readonly teamError?: TeamDirectoryOperationError | null;
  readonly onRetryTeam?: () => void;
}

export type ClientField =
  | 'displayName'
  | 'legalName'
  | 'pan'
  | 'gstin'
  | 'email'
  | 'phone'
  | 'relationshipOwnerId'
  | 'notes';

export interface ClientDraft {
  readonly displayName: string;
  readonly legalName: string;
  readonly pan: string;
  readonly gstin: string;
  readonly email: string;
  readonly phone: string;
  readonly relationshipOwnerId: string;
  readonly notes: string;
}

export type ClientFormErrors = Partial<Record<ClientField, string>>;

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Exact email validator matching the server's installed Zod 3.25.76 email regex.
 * Specifically rejects double-dots (a..b@domain) and leading dots (.user@domain).
 */
const ZOD_EMAIL_REGEX =
  /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;

interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ClientFormErrors;
  readonly firstInvalidField: ClientField | null;
}

function validateClientInput(draft: ClientDraft): ValidationResult {
  const errors: ClientFormErrors = {};
  let firstInvalidField: ClientField | null = null;

  const setFieldError = (field: ClientField, message: string) => {
    errors[field] = message;
    if (!firstInvalidField) {
      firstInvalidField = field;
    }
  };

  const trimmedDisplay = draft.displayName.trim();
  if (!trimmedDisplay) {
    setFieldError('displayName', 'Display name is required.');
  } else if (trimmedDisplay.length < 2 || trimmedDisplay.length > 180) {
    setFieldError('displayName', 'Display name must be between 2 and 180 characters.');
  }

  const trimmedLegal = draft.legalName.trim();
  if (trimmedLegal && trimmedLegal.length > 200) {
    setFieldError('legalName', 'Legal name must not exceed 200 characters.');
  }

  const cleanPan = draft.pan.trim().toUpperCase();
  if (cleanPan && !PAN_REGEX.test(cleanPan)) {
    setFieldError('pan', 'Invalid Indian PAN format (e.g. ABCDE1234F).');
  }

  const cleanGstin = draft.gstin.trim().toUpperCase();
  if (cleanGstin && !GSTIN_REGEX.test(cleanGstin)) {
    setFieldError('gstin', 'Invalid Indian GSTIN format (e.g. 27ABCDE1234F1Z5).');
  }

  if (cleanPan && cleanGstin && !errors.pan && !errors.gstin) {
    const gstinPan = cleanGstin.slice(2, 12);
    if (gstinPan !== cleanPan) {
      setFieldError('gstin', 'GSTIN characters 3–12 must match the provided PAN.');
    }
  }

  const trimmedEmail = draft.email.trim();
  if (trimmedEmail && !ZOD_EMAIL_REGEX.test(trimmedEmail)) {
    setFieldError('email', 'Invalid email address format.');
  }

  const trimmedPhone = draft.phone.trim();
  if (trimmedPhone && (trimmedPhone.length < 7 || trimmedPhone.length > 20)) {
    setFieldError('phone', 'Phone number must be between 7 and 20 characters.');
  }

  const trimmedNotes = draft.notes.trim();
  if (trimmedNotes && trimmedNotes.length > 2000) {
    setFieldError('notes', 'Notes must not exceed 2000 characters.');
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstInvalidField,
  };
}

export function CreateClientDialog({
  isOpen,
  onClose,
  onSubmit,
  role,
  teamPort,
  reportingLines,
  teamLoading,
  teamError,
  onRetryTeam,
}: CreateClientDialogProps) {
  const [draft, setDraft] = useState<ClientDraft>({
    displayName: '',
    legalName: '',
    pan: '',
    gstin: '',
    email: '',
    phone: '',
    relationshipOwnerId: '',
    notes: '',
  });

  const teamDirectory = useTeamDirectory(role ?? 'founder', {
    port: teamPort,
    enabled: isOpen && !reportingLines,
  });

  const lines = reportingLines ?? teamDirectory.lines;
  const isTeamLoading =
    teamLoading ?? (reportingLines ? false : teamDirectory.loading && !teamDirectory.hasLiveSnapshot);
  const teamErrorState = teamError ?? (reportingLines ? null : teamDirectory.error);
  const retryTeam = onRetryTeam ?? (() => void teamDirectory.refresh());

  const eligibleEmployees = useMemo(() => {
    const map = new Map<string, { id: string; name: string; role: CompanyRole }>();
    for (const line of lines) {
      if (line.employee.role !== 'trainee') {
        map.set(line.employee.id, line.employee);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [lines]);

  const [errors, setErrors] = useState<ClientFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [supportReference, setSupportReference] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);
  const dialogRef = useRef<HTMLDivElement>(null);

  const displayNameRef = useRef<HTMLInputElement>(null);
  const legalNameRef = useRef<HTMLInputElement>(null);
  const panRef = useRef<HTMLInputElement>(null);
  const gstinRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const relationshipOwnerRef = useRef<HTMLSelectElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Auto-focus display name upon opening
  useEffect(() => {
    if (isOpen) {
      displayNameRef.current?.focus();
    }
  }, [isOpen]);

  // Handle global Escape key when not submitting
  useEffect(() => {
    if (!isOpen) return;

    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmittingRef.current) {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, onClose]);

  // Tab containment trapping inside dialog
  const handleDialogKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;

    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    const focusable = dialogEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isSubmittingRef.current) {
      onClose();
    }
  };

  const updateDraft = (field: ClientField, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    if (errors[field] || (field === 'pan' && errors.gstin) || (field === 'gstin' && errors.pan)) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        if (field === 'pan' || field === 'gstin') {
          delete next.pan;
          delete next.gstin;
        }
        return next;
      });
    }
  };

  const focusField = (field: ClientField | null) => {
    if (field === 'displayName') displayNameRef.current?.focus();
    else if (field === 'legalName') legalNameRef.current?.focus();
    else if (field === 'pan') panRef.current?.focus();
    else if (field === 'gstin') gstinRef.current?.focus();
    else if (field === 'email') emailRef.current?.focus();
    else if (field === 'phone') phoneRef.current?.focus();
    else if (field === 'relationshipOwnerId') relationshipOwnerRef.current?.focus();
    else if (field === 'notes') notesRef.current?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    setServerError(null);
    setSupportReference(null);

    const validation = validateClientInput(draft);
    if (!validation.valid) {
      setErrors(validation.errors);
      focusField(validation.firstInvalidField);
      return;
    }

    setErrors({});
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const payload: CreateClientInput = {
      displayName: draft.displayName.trim(),
      legalName: draft.legalName.trim() || null,
      pan: draft.pan.trim().toUpperCase() || null,
      gstin: draft.gstin.trim().toUpperCase() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      relationshipOwnerId: draft.relationshipOwnerId ? draft.relationshipOwnerId : null,
      notes: draft.notes.trim() || null,
    };

    try {
      const created = await onSubmit(payload);
      if (!isMountedRef.current) return;

      if (!created) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;

      isSubmittingRef.current = false;
      setIsSubmitting(false);

      const sanitized: ClientOperationError = sanitizeCreateClientError(err);
      if (sanitized.code !== 'aborted') {
        setServerError(sanitized.message);
        setSupportReference(sanitized.requestId ?? null);
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="dialog-layer create-client-dialog-layer"
      onClick={handleBackdropClick}
      data-testid="create-client-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-client-dialog-title"
        aria-describedby="create-client-dialog-description"
        onKeyDown={handleDialogKeyDown}
        className="dialog create-client-dialog"
        tabIndex={-1}
      >
        <div className="dialog-header">
          <div className="create-client-dialog-title-group">
            <h2 id="create-client-dialog-title">Add client</h2>
            <p id="create-client-dialog-description">
              Create a verified client entity in the practice directory with statutory identifiers.
            </p>
          </div>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {serverError ? (
            <div
              className="form-banner-error"
              role="alert"
              data-testid="create-client-server-error"
            >
              <AlertCircle size={16} aria-hidden="true" className="form-banner-icon" />
              <div className="form-banner-copy">
                <span>{serverError}</span>
                {supportReference ? (
                  <small className="form-banner-reference">
                    Support reference: {supportReference}
                  </small>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="form-grid">
            <label className="field is-full" htmlFor="create-client-display-name">
              <span className="field-label-text">Display name *</span>
              <input
                ref={displayNameRef}
                id="create-client-display-name"
                name="displayName"
                type="text"
                autoComplete="organization"
                value={draft.displayName}
                onChange={(e) => updateDraft('displayName', e.target.value)}
                disabled={isSubmitting}
                aria-required="true"
                aria-invalid={errors.displayName ? 'true' : undefined}
                aria-describedby={
                  errors.displayName
                    ? 'create-client-display-name-error'
                    : 'create-client-display-name-hint'
                }
              />
              <small id="create-client-display-name-hint">
                Primary business name shown across directories, tasks, and billing
              </small>
              {errors.displayName ? (
                <span
                  id="create-client-display-name-error"
                  className="field-error-text"
                  role="alert"
                >
                  {errors.displayName}
                </span>
              ) : null}
            </label>

            <label className="field is-full" htmlFor="create-client-legal-name">
              <span className="field-label-text">Legal registered name</span>
              <input
                ref={legalNameRef}
                id="create-client-legal-name"
                name="legalName"
                type="text"
                autoComplete="off"
                value={draft.legalName}
                onChange={(e) => updateDraft('legalName', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={errors.legalName ? 'true' : undefined}
                aria-describedby={
                  errors.legalName
                    ? 'create-client-legal-name-error'
                    : 'create-client-legal-name-hint'
                }
              />
              <small id="create-client-legal-name-hint">
                Official entity name as per MCA / registration certificates (if different)
              </small>
              {errors.legalName ? (
                <span
                  id="create-client-legal-name-error"
                  className="field-error-text"
                  role="alert"
                >
                  {errors.legalName}
                </span>
              ) : null}
            </label>

            <label className="field" htmlFor="create-client-pan">
              <span className="field-label-text">Income tax PAN</span>
              <input
                ref={panRef}
                id="create-client-pan"
                name="pan"
                type="text"
                autoComplete="off"
                value={draft.pan}
                onChange={(e) => updateDraft('pan', e.target.value.toUpperCase())}
                disabled={isSubmitting}
                maxLength={10}
                autoCapitalize="characters"
                spellCheck="false"
                aria-invalid={errors.pan ? 'true' : undefined}
                aria-describedby={
                  errors.pan ? 'create-client-pan-error' : 'create-client-pan-hint'
                }
              />
              <small id="create-client-pan-hint">10 characters (e.g. ABCDE1234F)</small>
              {errors.pan ? (
                <span id="create-client-pan-error" className="field-error-text" role="alert">
                  {errors.pan}
                </span>
              ) : null}
            </label>

            <label className="field" htmlFor="create-client-gstin">
              <span className="field-label-text">GSTIN</span>
              <input
                ref={gstinRef}
                id="create-client-gstin"
                name="gstin"
                type="text"
                autoComplete="off"
                value={draft.gstin}
                onChange={(e) => updateDraft('gstin', e.target.value.toUpperCase())}
                disabled={isSubmitting}
                maxLength={15}
                autoCapitalize="characters"
                spellCheck="false"
                aria-invalid={errors.gstin ? 'true' : undefined}
                aria-describedby={
                  errors.gstin ? 'create-client-gstin-error' : 'create-client-gstin-hint'
                }
              />
              <small id="create-client-gstin-hint">15 characters (e.g. 27ABCDE1234F1Z5)</small>
              {errors.gstin ? (
                <span id="create-client-gstin-error" className="field-error-text" role="alert">
                  {errors.gstin}
                </span>
              ) : null}
            </label>

            <label className="field" htmlFor="create-client-email">
              <span className="field-label-text">Primary email</span>
              <input
                ref={emailRef}
                id="create-client-email"
                name="email"
                type="email"
                autoComplete="email"
                value={draft.email}
                onChange={(e) => updateDraft('email', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'create-client-email-error' : undefined}
              />
              {errors.email ? (
                <span id="create-client-email-error" className="field-error-text" role="alert">
                  {errors.email}
                </span>
              ) : null}
            </label>

            <label className="field" htmlFor="create-client-phone">
              <span className="field-label-text">Phone</span>
              <input
                ref={phoneRef}
                id="create-client-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                value={draft.phone}
                onChange={(e) => updateDraft('phone', e.target.value)}
                disabled={isSubmitting}
                aria-invalid={errors.phone ? 'true' : undefined}
                aria-describedby={errors.phone ? 'create-client-phone-error' : undefined}
              />
              {errors.phone ? (
                <span id="create-client-phone-error" className="field-error-text" role="alert">
                  {errors.phone}
                </span>
              ) : null}
            </label>

            <div className="field is-full">
              <label className="field-label-text" htmlFor="create-client-relationship-owner">
                Client Relationship Owner
              </label>
              <select
                ref={relationshipOwnerRef}
                id="create-client-relationship-owner"
                name="relationshipOwnerId"
                value={draft.relationshipOwnerId}
                onChange={(e) => updateDraft('relationshipOwnerId', e.target.value)}
                disabled={isSubmitting}
                aria-describedby="create-client-relationship-owner-hint"
              >
                <option value="">(Unassigned)</option>
                {eligibleEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({ROLE_LABELS[emp.role] ?? emp.role})
                  </option>
                ))}
              </select>
              <div id="create-client-relationship-owner-hint" className="field-status-hint">
                {isTeamLoading ? (
                  <span className="team-select-status" role="status" aria-live="polite">
                    Loading practice team…
                  </span>
                ) : teamErrorState ? (
                  <span className="team-select-status team-select-error" role="alert" aria-live="polite">
                    Unable to load team list.{' '}
                    <button
                      type="button"
                      className="inline-retry-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        retryTeam();
                      }}
                      disabled={isSubmitting}
                    >
                      Retry
                    </button>
                  </span>
                ) : eligibleEmployees.length === 0 ? (
                  <span className="team-select-status" role="status" aria-live="polite">
                    No eligible Employees available
                  </span>
                ) : (
                  <span id="create-client-relationship-owner-help">
                    Primary internal contact for the client entity. Assignment ownership remains separate.
                  </span>
                )}
              </div>
            </div>

            <label className="field is-full" htmlFor="create-client-notes">
              <span className="field-label-text">Notes and special instructions</span>
              <textarea
                ref={notesRef}
                id="create-client-notes"
                name="notes"
                autoComplete="off"
                value={draft.notes}
                onChange={(e) => updateDraft('notes', e.target.value)}
                disabled={isSubmitting}
                rows={3}
                aria-invalid={errors.notes ? 'true' : undefined}
                aria-describedby={errors.notes ? 'create-client-notes-error' : undefined}
              />
              {errors.notes ? (
                <span id="create-client-notes-error" className="field-error-text" role="alert">
                  {errors.notes}
                </span>
              ) : null}
            </label>
          </div>

          <div className="dialog-footer">
            <button
              type="button"
              className="soft-button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={isSubmitting}
              data-testid="create-client-submit-btn"
            >
              {isSubmitting ? 'Creating…' : 'Create client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
