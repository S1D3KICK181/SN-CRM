import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  AlertCircle,
  CalendarClock,
  FileStack,
  UserRoundCheck,
  X,
} from 'lucide-react';
import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../../data';
import {
  formatIsoToKolkataDisplay,
  getEligibleDelegationTargets,
  getKolkataDateParts,
  getParentAssignmentOptions,
  parseDisplayDateToKolkataIso,
  validateDelegatedDeadline,
} from '../../api/work-items-mapper';
import type {
  CreateDelegatedInput,
  CreateInternalInput,
  CreatePersonalInput,
} from '../../api/use-work-items';
import {
  isValidUuid,
  type TaskClientOption,
} from '../../api/work-items-types';

export type TaskComposerMode = 'personal' | 'delegated' | 'internal';

export interface CreateTaskDialogProps {
  readonly isOpen: boolean;
  readonly mode: TaskComposerMode;
  readonly role: CompanyRole;
  readonly assignments?: readonly AssignmentRow[];
  readonly clients?: readonly TaskClientOption[];
  readonly reportingLines?: readonly ReportingLineDto[];
  readonly currentActorId?: string;
  readonly currentActorName?: string;
  readonly onClose: () => void;
  readonly onCreatePersonal?: (input: CreatePersonalInput) => Promise<boolean>;
  readonly onCreateDelegated?: (input: CreateDelegatedInput) => Promise<boolean>;
  readonly onCreateInternal?: (input: CreateInternalInput) => Promise<boolean>;
  readonly onToast?: (message: string) => void;
}

function getTodayKolkataDateString(): string {
  const parts = getKolkataDateParts(new Date());
  const year = parts.year;
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTomorrowKolkataDateString(): string {
  const parts = getKolkataDateParts(new Date(Date.now() + 86400000));
  const year = parts.year;
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function CreateTaskDialog({
  isOpen,
  mode,
  role,
  assignments = [],
  clients = [],
  reportingLines = [],
  currentActorId,
  currentActorName,
  onClose,
  onCreatePersonal,
  onCreateDelegated,
  onCreateInternal,
  onToast: _onToast,
}: CreateTaskDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [customPartyName, setCustomPartyName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('18:00');
  const [reminderTime, setReminderTime] = useState('');

  const dialogRef = useRef<HTMLElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const prevOpenRef = useRef(false);
  const prevModeRef = useRef<TaskComposerMode | null>(null);

  // Eligible parent assignments (for delegated tasks)
  const parentOptions = useMemo(() => {
    return getParentAssignmentOptions(role, assignments, {
      id: currentActorId,
      name: currentActorName,
    });
  }, [role, assignments, currentActorId, currentActorName]);

  // Eligible subordinates (for delegated and internal tasks)
  const delegationTargets = useMemo(() => {
    return getEligibleDelegationTargets(
      { id: currentActorId, name: currentActorName, role },
      reportingLines,
    );
  }, [currentActorId, currentActorName, role, reportingLines]);

  // Reset user input fields ONLY when dialog opens or when mode changes.
  // Never wipe user inputs when live parentOptions, delegationTargets, or clients refresh in the background!
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    const prevMode = prevModeRef.current;
    prevOpenRef.current = isOpen;
    prevModeRef.current = mode;

    if (!isOpen) return;

    const justOpened = !wasOpen && isOpen;
    const modeChanged = prevMode !== mode;

    if (justOpened || modeChanged) {
      setSubmitting(false);
      setDialogError(null);
      setTitle('');
      setInstructions('');
      setDueTime('18:00');
      setReminderTime('');

      if (mode === 'personal') {
        setDueDate(getTodayKolkataDateString());
        setSelectedClientId('');
        setCustomPartyName('');
      } else if (mode === 'delegated') {
        setDueDate(getTomorrowKolkataDateString());
        setSelectedAssignmentId(parentOptions[0]?.id || '');
        setSelectedAssigneeId(delegationTargets[0]?.id || '');
      } else if (mode === 'internal') {
        setDueDate(getTomorrowKolkataDateString());
        setSelectedAssigneeId(delegationTargets[0]?.id || '');
      }

      // Auto-focus first field
      const timer = window.setTimeout(() => {
        firstInputRef.current?.focus();
      }, 50);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isOpen, mode, parentOptions, delegationTargets]);

  // Reconcile selected assignment ID only when empty or no longer valid
  useEffect(() => {
    if (!isOpen || mode !== 'delegated') return;
    if (!selectedAssignmentId && parentOptions[0]) {
      setSelectedAssignmentId(parentOptions[0].id);
    } else if (selectedAssignmentId && !parentOptions.some((o) => o.id === selectedAssignmentId)) {
      setSelectedAssignmentId(parentOptions[0]?.id || '');
    }
  }, [isOpen, mode, parentOptions, selectedAssignmentId]);

  // Reconcile selected assignee ID only when empty or no longer valid
  useEffect(() => {
    if (!isOpen || (mode !== 'delegated' && mode !== 'internal')) return;
    if (!selectedAssigneeId && delegationTargets[0]) {
      setSelectedAssigneeId(delegationTargets[0].id);
    } else if (selectedAssigneeId && !delegationTargets.some((t) => t.id === selectedAssigneeId)) {
      setSelectedAssigneeId(delegationTargets[0]?.id || '');
    }
  }, [isOpen, mode, delegationTargets, selectedAssigneeId]);

  // Handle ESC key to dismiss
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitting, onClose]);

  if (!isOpen) return null;

  const titles: Record<TaskComposerMode, [string, string]> = {
    personal: [
      'New personal task',
      'Plan a private reminder for yourself without creating practice-level work.',
    ],
    delegated: [
      'Delegate Sub-Task',
      'Break down an existing Assignment into operational verification steps while retaining owner accountability.',
    ],
    internal: [
      'Delegate Office Task',
      'Assign non-client administrative or menial office operations within your downward authority.',
    ],
  };

  const [heading, description] = titles[mode];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setDialogError(null);

    const cleanTitle = title.trim();
    if (cleanTitle.length < 2) {
      setDialogError('Task description must be at least 2 characters long.');
      return;
    }

    const timeCombined = `${dueDate} · ${dueTime || '18:00'}`;

    let dueAtIso: string;
    try {
      dueAtIso = parseDisplayDateToKolkataIso(timeCombined);
    } catch {
      setDialogError('Invalid due date or time format.');
      return;
    }

    let reminderAtIso: string | null = null;
    if (reminderTime.trim()) {
      try {
        const reminderCombined = `${dueDate} · ${reminderTime.trim()}`;
        reminderAtIso = parseDisplayDateToKolkataIso(reminderCombined);
        if (reminderAtIso > dueAtIso) {
          setDialogError('A reminder must occur on or before the task due time.');
          return;
        }
      } catch {
        setDialogError('Invalid reminder time format.');
        return;
      }
    }

    setSubmitting(true);

    try {
      if (mode === 'personal') {
        const selectedClient = clients.find((c) => c.id === selectedClientId);
        const isClientUuid = selectedClientId && isValidUuid(selectedClientId);
        const validClientId = isClientUuid ? selectedClientId : undefined;
        const partyName = selectedClient ? selectedClient.name : customPartyName.trim() || undefined;

        const success = await onCreatePersonal?.({
          title: cleanTitle,
          relatedClientId: validClientId,
          relatedPartyName: partyName,
          dueDate,
          dueTime,
          time: timeCombined,
          reminderAt: reminderAtIso,
        });

        if (success) {
          onClose();
        } else {
          setDialogError('Failed to schedule personal task. Please check the entered fields and try again.');
          setSubmitting(false);
        }
      } else if (mode === 'delegated') {
        if (!selectedAssignmentId) {
          setDialogError('Please select a parent Assignment.');
          setSubmitting(false);
          return;
        }

        if (!selectedAssigneeId) {
          setDialogError('Please select an eligible employee to delegate to.');
          setSubmitting(false);
          return;
        }

        // Pre-validate deadline against parent assignment
        const parentAsn = assignments.find((a) => a.id === selectedAssignmentId);
        if (parentAsn?.due) {
          try {
            const parentDueIso = parseDisplayDateToKolkataIso(parentAsn.due);
            const deadlineErr = validateDelegatedDeadline(dueAtIso, parentDueIso);
            if (deadlineErr) {
              setDialogError(deadlineErr);
              setSubmitting(false);
              return;
            }
          } catch {
            // Allow backend authoritative check
          }
        }

        const success = await onCreateDelegated?.({
          title: cleanTitle,
          assignmentId: selectedAssignmentId,
          assigneeId: selectedAssigneeId,
          dueDate,
          dueTime,
          due: timeCombined,
          instructions: instructions.trim() || undefined,
          reminderAt: reminderAtIso,
        });

        if (success) {
          onClose();
        } else {
          setDialogError('Failed to delegate sub-task. Please check the entered fields and try again.');
          setSubmitting(false);
        }
      } else if (mode === 'internal') {
        if (!selectedAssigneeId) {
          setDialogError('Please select an eligible employee to delegate to.');
          setSubmitting(false);
          return;
        }

        const success = await onCreateInternal?.({
          title: cleanTitle,
          assigneeId: selectedAssigneeId,
          dueDate,
          dueTime,
          due: timeCombined,
          instructions: instructions.trim() || undefined,
          reminderAt: reminderAtIso,
        });

        if (success) {
          onClose();
        } else {
          setDialogError('Failed to delegate office task. Please check the entered fields and try again.');
          setSubmitting(false);
        }
      }
    } catch {
      setDialogError('An unexpected error occurred while scheduling this task. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="dialog-layer"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
      >
        <div className="dialog-header">
          <div>
            <span className="dialog-icon">
              {mode === 'personal' ? (
                <CalendarClock aria-hidden="true" />
              ) : mode === 'delegated' ? (
                <UserRoundCheck aria-hidden="true" />
              ) : (
                <FileStack aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 id="task-dialog-title">{heading}</h2>
              <p>{description}</p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={submitting}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {dialogError ? (
          <div
            className="field-error-banner"
            role="alert"
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

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            {mode === 'personal' ? (
              <>
                <div className="field is-full">
                  <label htmlFor="task-title">
                    <span>Task description</span>
                  </label>
                  <input
                    id="task-title"
                    ref={firstInputRef}
                    name="title"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Call Aster Foods accountant for purchase register"
                  />
                </div>

                <div className="field">
                  <label htmlFor="task-client">
                    <span>Associated client (optional)</span>
                  </label>
                  <select
                    id="task-client"
                    name="clientId"
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                  >
                    <option value="">(No client / Personal)</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.type ? ` (${c.type})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="task-context">
                    <span>Context / Party name</span>
                  </label>
                  <input
                    id="task-context"
                    name="context"
                    value={customPartyName}
                    onChange={(e) => setCustomPartyName(e.target.value)}
                    placeholder={selectedClientId ? 'Linked from selected client' : 'e.g. Bank manager or GST office'}
                    disabled={Boolean(selectedClientId)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="task-due-date">
                    <span>Target Date (IST)</span>
                  </label>
                  <input
                    id="task-due-date"
                    type="date"
                    name="dueDate"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="task-due-time">
                    <span>Target Time (IST)</span>
                  </label>
                  <input
                    id="task-due-time"
                    type="time"
                    name="dueTime"
                    required
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="task-reminder-time">
                    <span>Reminder time (optional)</span>
                  </label>
                  <input
                    id="task-reminder-time"
                    type="time"
                    name="reminderTime"
                    value={reminderTime}
                    onChange={(e) => setReminderTime(e.target.value)}
                    placeholder="e.g. 17:00"
                  />
                </div>
              </>
            ) : mode === 'delegated' ? (
              <>
                <div className="field is-full">
                  <label htmlFor="task-assignment">
                    <span>Parent Assignment</span>
                  </label>
                  <select
                    id="task-assignment"
                    name="assignmentId"
                    required
                    value={selectedAssignmentId}
                    onChange={(e) => setSelectedAssignmentId(e.target.value)}
                  >
                    {parentOptions.length === 0 ? (
                      <option value="" disabled>
                        No active assignments eligible for delegation
                      </option>
                    ) : (
                      parentOptions.map((asn) => {
                        const displayCode =
                          asn.code?.trim() || (!isValidUuid(asn.id) ? asn.id : 'Linked Assignment');
                        const prefix = displayCode !== 'Linked Assignment' ? `${displayCode} · ` : '';
                        return (
                          <option key={asn.id} value={asn.id}>
                            {prefix}{asn.title} ({asn.client}) — Due {asn.due}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>

                <div className="field is-full">
                  <label htmlFor="task-title">
                    <span>Sub-task title</span>
                  </label>
                  <input
                    id="task-title"
                    ref={firstInputRef}
                    name="title"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Verify portal sales totals against books"
                  />
                </div>

                <div className="field is-full">
                  <label htmlFor="task-assignee">
                    <span>Delegate to (Subordinate)</span>
                  </label>
                  <select
                    id="task-assignee"
                    name="assigneeId"
                    required
                    value={selectedAssigneeId}
                    onChange={(e) => setSelectedAssigneeId(e.target.value)}
                  >
                    {delegationTargets.length === 0 ? (
                      <option value="" disabled>
                        No eligible employees in your delegation line
                      </option>
                    ) : (
                      delegationTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="task-due-date">
                    <span>Completion Date (IST)</span>
                  </label>
                  <input
                    id="task-due-date"
                    type="date"
                    name="dueDate"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="task-due-time">
                    <span>Target Time (IST)</span>
                  </label>
                  <input
                    id="task-due-time"
                    type="time"
                    name="dueTime"
                    required
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                  />
                </div>

                <div className="field is-full">
                  <label htmlFor="task-instructions">
                    <span>Instructions & Evidence checklist</span>
                  </label>
                  <textarea
                    id="task-instructions"
                    name="instructions"
                    rows={3}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Expected deliverable output, verification checklist, and evidence requirements"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="field is-full">
                  <label htmlFor="task-title">
                    <span>Office task description</span>
                  </label>
                  <input
                    id="task-title"
                    ref={firstInputRef}
                    name="title"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. File November purchase bills in the blue cardboard file"
                  />
                </div>

                <div className="field is-full">
                  <label htmlFor="task-assignee">
                    <span>Delegate to (Subordinate)</span>
                  </label>
                  <select
                    id="task-assignee"
                    name="assigneeId"
                    required
                    value={selectedAssigneeId}
                    onChange={(e) => setSelectedAssigneeId(e.target.value)}
                  >
                    {delegationTargets.length === 0 ? (
                      <option value="" disabled>
                        No eligible employees in your delegation line
                      </option>
                    ) : (
                      delegationTargets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="task-due-date">
                    <span>Completion Date (IST)</span>
                  </label>
                  <input
                    id="task-due-date"
                    type="date"
                    name="dueDate"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="task-due-time">
                    <span>Target Time (IST)</span>
                  </label>
                  <input
                    id="task-due-time"
                    type="time"
                    name="dueTime"
                    required
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                  />
                </div>

                <div className="field is-full">
                  <label htmlFor="task-instructions">
                    <span>Instructions & Location notes</span>
                  </label>
                  <textarea
                    id="task-instructions"
                    name="instructions"
                    rows={3}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Specific filing instructions, records cabinet, or administrative steps"
                  />
                </div>
              </>
            )}
          </div>

          <div className="dialog-footer">
            <button
              className="soft-button"
              type="button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={
                submitting ||
                (mode === 'delegated' && (!selectedAssignmentId || !selectedAssigneeId)) ||
                (mode === 'internal' && !selectedAssigneeId)
              }
            >
              {submitting
                ? 'Saving...'
                : mode === 'personal'
                ? 'Schedule task'
                : 'Delegate task'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
