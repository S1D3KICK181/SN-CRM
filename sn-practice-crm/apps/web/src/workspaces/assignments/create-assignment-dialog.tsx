import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { AlertCircle, CalendarClock, Layers, Plus, X } from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type {
  CreateAssignmentCommand,
  CreateRecurringScheduleCommand,
} from '../../api/types';

export interface DialogClientOption {
  readonly id: string;
  readonly name: string;
}

export interface DialogStaffOption {
  readonly id: string;
  readonly name: string;
  readonly role: CompanyRole;
}

export interface CreateAssignmentDialogProps {
  readonly isOpen: boolean;
  readonly role: CompanyRole;
  readonly clients?: readonly DialogClientOption[];
  readonly teamMembers?: readonly DialogStaffOption[];
  readonly onClose: () => void;
  readonly onCreateAssignment: (command: CreateAssignmentCommand) => Promise<boolean>;
  readonly onCreateSchedule?: (command: CreateRecurringScheduleCommand) => Promise<boolean>;
  readonly onToast?: (message: string) => void;
}

const SERVICES = [
  'GST Compliance',
  'Internal Audit',
  'Tax Compliance (TDS)',
  'Bookkeeping & Accounts',
  'Statutory Audit',
  'Direct Tax Advisory',
];

export function CreateAssignmentDialog({
  isOpen,
  role,
  clients = [],
  teamMembers = [],
  onClose,
  onCreateAssignment,
  onCreateSchedule,
  onToast: _onToast,
}: CreateAssignmentDialogProps): React.ReactElement | null {
  const isLeadership = role === 'founder' || role === 'manager';
  const [tab, setTab] = useState<'assignment' | 'schedule'>('assignment');
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Form Fields
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [service, setService] = useState('GST Compliance');
  const [ownerId, setOwnerId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Recurring Schedule Specific Fields
  const [cadence, setCadence] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [dueDay, setDueDay] = useState('11');
  const [nextOccurrenceOn, setNextOccurrenceOn] = useState('');

  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLSelectElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Filter out trainees: Trainees MUST NOT own assignments or schedules
  const eligibleOwners = useMemo(() => {
    return teamMembers.filter((m) => m.role !== 'trainee');
  }, [teamMembers]);

  // Reviewers must be leadership or senior staff
  const eligibleReviewers = useMemo(() => {
    return teamMembers.filter((m) => m.role === 'founder' || m.role === 'manager' || m.role === 'senior_staff');
  }, [teamMembers]);

  // Capture trigger element for focus restoration, set defaults, and handle initial focus
  useEffect(() => {
    if (isOpen) {
      restoreFocusRef.current = (document.activeElement as HTMLElement) || null;
      setDialogError(null);
      setSubmitting(false);
      setTab('assignment');
      setClientId(clients[0]?.id ?? '');
      setTitle('');
      setService('GST Compliance');
      setOwnerId(eligibleOwners[1]?.id ?? eligibleOwners[0]?.id ?? '');
      setReviewerId(eligibleReviewers[0]?.id ?? '');

      const today = new Date();
      const nextWeek = new Date(today.getTime() + 7 * 86400000);
      const yyyy = nextWeek.getFullYear();
      const mm = String(nextWeek.getMonth() + 1).padStart(2, '0');
      const dd = String(nextWeek.getDate()).padStart(2, '0');
      setDueDate(`${yyyy}-${mm}-${dd}`);

      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
      setNextOccurrenceOn(nextMonthStr);

      const timer = window.setTimeout(() => {
        initialFocusRef.current?.focus();
      }, 50);

      return () => {
        window.clearTimeout(timer);
        if (restoreFocusRef.current && typeof restoreFocusRef.current.focus === 'function') {
          restoreFocusRef.current.focus();
        }
      };
    }
    return undefined;
  }, [isOpen, clients, eligibleOwners, eligibleReviewers]);

  // Global Escape and Tab focus-trap listener
  useEffect(() => {
    if (!isOpen) return;

    function handleGlobalKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [isOpen, submitting, onClose]);

  if (!isOpen || !isLeadership) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setDialogError(null);

    if (!clientId) {
      setDialogError('Please select a client.');
      return;
    }

    if (!title.trim()) {
      setDialogError('Title is required.');
      return;
    }

    if (!ownerId) {
      setDialogError('An assignment in-charge owner is required.');
      return;
    }

    // Verify chosen owner is not a trainee
    const chosenOwner = teamMembers.find((m) => m.id === ownerId);
    if (chosenOwner?.role === 'trainee') {
      setDialogError('Trainee cannot be assigned as assignment owner.');
      return;
    }

    setSubmitting(true);

    try {
      const selectedClient = clients.find((c) => c.id === clientId);

      if (tab === 'assignment') {
        const success = await onCreateAssignment({
          clientId,
          clientName: selectedClient?.name,
          title: title.trim(),
          service,
          ownerNameOrId: ownerId,
          reviewerNameOrId: reviewerId || undefined,
          dueDate: dueDate || undefined,
        });

        if (success) {
          onClose();
        } else {
          setDialogError('Failed to create assignment. Please try again.');
        }
      } else {
        if (!onCreateSchedule) {
          setDialogError('Recurring schedule creation is unavailable.');
          return;
        }

        const success = await onCreateSchedule({
          clientId,
          clientName: selectedClient?.name,
          title: title.trim(),
          service,
          cadence,
          ownerId,
          dueDay: Number(dueDay) || 11,
          nextOccurrenceOn: nextOccurrenceOn || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        });

        if (success) {
          onClose();
        } else {
          setDialogError('Failed to create recurring schedule. Please try again.');
        }
      }
    } catch (err: unknown) {
      setDialogError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="presentation"
      className="dialog-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-assignment-title"
        aria-describedby="create-assignment-description"
        className="dialog"
      >
        <div className="dialog-header">
          <div>
            <span className="dialog-icon">
              {tab === 'assignment' ? (
                <Layers aria-hidden="true" />
              ) : (
                <CalendarClock aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 id="create-assignment-title">
                {tab === 'assignment' ? 'New One-Off Assignment' : 'New Recurring Schedule Template'}
              </h2>
              <p id="create-assignment-description">
                {tab === 'assignment'
                  ? 'Create a practice-level engagement with designated custody and review gates.'
                  : 'Establish a statutory cadence rule that automatically materializes recurring work.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close dialog"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {/* Mode Switcher for Leadership */}
        {isLeadership && onCreateSchedule ? (
          <div
            className="work-mode-switcher"
            style={{ margin: '0 24px 16px', borderBottom: '1px solid var(--border)' }}
          >
            <button
              type="button"
              className={`work-tab-btn ${tab === 'assignment' ? 'is-active' : ''}`}
              onClick={() => {
                setTab('assignment');
                setDialogError(null);
              }}
              disabled={submitting}
            >
              <Layers size={14} aria-hidden="true" />
              One-Off Assignment
            </button>
            <button
              type="button"
              className={`work-tab-btn ${tab === 'schedule' ? 'is-active' : ''}`}
              onClick={() => {
                setTab('schedule');
                setDialogError(null);
              }}
              disabled={submitting}
            >
              <CalendarClock size={14} aria-hidden="true" />
              Recurring Schedule
            </button>
          </div>
        ) : null}

        {dialogError ? (
          <div
            role="alert"
            className="field-error-banner"
            style={{
              margin: '0 24px 16px',
              padding: '10px 14px',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--danger)',
              fontSize: '12px',
            }}
          >
            <AlertCircle size={16} aria-hidden="true" />
            <span>{dialogError}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} aria-busy={submitting}>
          <div className="form-grid">
            {/* Client Selection */}
            <div className="field is-full">
              <label htmlFor="assign-client">
                <span>Client Entity *</span>
              </label>
              <select
                id="assign-client"
                ref={initialFocusRef}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                required
                disabled={submitting || clients.length === 0}
              >
                {clients.length > 0 ? (
                  clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>No clients available</option>
                )}
              </select>
            </div>

            {/* Title */}
            <div className="field is-full">
              <label htmlFor="assign-title">
                <span>Engagement Title *</span>
              </label>
              <input
                id="assign-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  tab === 'assignment'
                    ? 'e.g. FY 2026-27 Q2 Internal Audit'
                    : 'e.g. Monthly GSTR-1 & GSTR-3B Filing'
                }
                required
                disabled={submitting}
              />
            </div>

            {/* Service Practice Area */}
            <div className="field">
              <label htmlFor="assign-service">
                <span>Service Practice Area</span>
              </label>
              <select
                id="assign-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
                disabled={submitting}
              >
                {SERVICES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* In-Charge Owner (Trainees excluded) */}
            <div className="field">
              <label htmlFor="assign-owner">
                <span>In-Charge Owner *</span>
              </label>
              <select
                id="assign-owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                required
                disabled={submitting || eligibleOwners.length === 0}
              >
                {eligibleOwners.length > 0 ? (
                  eligibleOwners.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>No eligible staff available</option>
                )}
              </select>
            </div>

            {/* Tab Specific Fields */}
            {tab === 'assignment' ? (
              <>
                {/* Sign-off Reviewer for One-off */}
                <div className="field">
                  <label htmlFor="assign-reviewer">
                    <span>Sign-off Reviewer</span>
                  </label>
                  <select
                    id="assign-reviewer"
                    value={reviewerId}
                    onChange={(e) => setReviewerId(e.target.value)}
                    disabled={submitting || eligibleReviewers.length === 0}
                  >
                    <option value="">(None designated)</option>
                    {eligibleReviewers.length > 0 ? (
                      eligibleReviewers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.name}
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>No eligible reviewers available</option>
                    )}
                  </select>
                </div>

                {/* Target Due Date */}
                <div className="field">
                  <label htmlFor="assign-due">
                    <span>Target Due Date</span>
                  </label>
                  <input
                    id="assign-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Recurring Cadence */}
                <div className="field">
                  <label htmlFor="sched-cadence">
                    <span>Cadence</span>
                  </label>
                  <select
                    id="sched-cadence"
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value as 'monthly' | 'quarterly' | 'annual')}
                    disabled={submitting}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>

                {/* Statutory Due Offset Days */}
                <div className="field">
                  <label htmlFor="sched-dueday">
                    <span>Due Day (days after period end)</span>
                  </label>
                  <input
                    id="sched-dueday"
                    type="number"
                    min="1"
                    max="31"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    disabled={submitting}
                  />
                </div>

                {/* First Occurrence Date */}
                <div className="field is-full">
                  <label htmlFor="sched-nextrun">
                    <span>First Occurrence Start Date</span>
                  </label>
                  <input
                    id="sched-nextrun"
                    type="date"
                    value={nextOccurrenceOn}
                    onChange={(e) => setNextOccurrenceOn(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </>
            )}
          </div>

          <div className="dialog-footer">
            <button
              type="button"
              className="soft-button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={submitting}
            >
              <Plus size={16} aria-hidden="true" />
              <span>
                {submitting
                  ? 'Creating…'
                  : tab === 'assignment'
                    ? 'Create Assignment'
                    : 'Create Schedule'}
              </span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
