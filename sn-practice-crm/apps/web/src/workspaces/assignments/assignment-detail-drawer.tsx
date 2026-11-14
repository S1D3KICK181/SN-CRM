import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Files,
  Lock,
  Pencil,
  ReceiptIndianRupee,
  RotateCcw,
  Send,
  X,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type { ServiceCatalogItemDto } from '@sn/contracts';
import type { DialogStaffOption } from './create-assignment-dialog';
import {
  ROLE_LABELS,
  ROLE_PEOPLE,
  formatINR,
  type AssignmentMilestone,
  type AssignmentRow,
} from '../../data';
import { Field } from '../../ui/workspace-primitives';
import { isValidUuid } from '../../api/metadata-safety';
import { useMessageComposer } from '../messages/message-composer';

export function AssignmentDetailDrawer({
  assignment,
  leadership,
  role,
  onClose,
  onToast,
  onUpdateAssignment,
  onOpenInvoice,
  initialEditing = false,
  teamMembers,
  services,
}: {
  assignment: AssignmentRow;
  leadership: boolean;
  role?: CompanyRole;
  onClose: () => void;
  onToast: (msg: string) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onOpenInvoice?: (asn: AssignmentRow) => void;
  initialEditing?: boolean;
  teamMembers?: readonly DialogStaffOption[];
  services?: readonly ServiceCatalogItemDto[];
}) {
  const canEditAssignment = role === 'founder' || role === 'manager';
  const displayCode =
    assignment.code && !isValidUuid(assignment.code)
      ? assignment.code
      : !isValidUuid(assignment.id)
      ? assignment.id
      : undefined;

  const monogram = useMemo(() => {
    const source = (assignment.client || assignment.title || 'AS').trim();
    const parts = source.split(/\s+/).filter(Boolean);
    const first = parts[0];
    const second = parts[1];
    if (first && second) {
      return (first.charAt(0) + second.charAt(0)).toUpperCase();
    }
    return source.slice(0, 2).toUpperCase() || 'AS';
  }, [assignment.client, assignment.title]);

  const currentPersonName = role ? ROLE_PEOPLE[role]?.name : '';
  const isAssignedCustodian = Boolean(
    currentPersonName &&
      (assignment.owner.toLowerCase().includes(currentPersonName.toLowerCase()) ||
        currentPersonName.toLowerCase().includes(assignment.owner.toLowerCase()))
  );

  const [isEditing, setIsEditing] = useState(initialEditing);
  const [tab, setTab] = useState<'checklist' | 'overview' | 'papers' | 'billing'>('checklist');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [milestones, setMilestones] = useState<AssignmentMilestone[]>(
    assignment.milestones || []
  );

  const visibleMilestones = useMemo(() => {
    return milestones.map((milestone, sourceIndex) => ({
      milestone,
      sourceIndex,
    }));
  }, [milestones]);

  const normalizedStatus = (assignment.status || '').toLowerCase().trim();
  const isTerminal =
    normalizedStatus === 'approved' ||
    normalizedStatus === 'completed' ||
    normalizedStatus === 'closed' ||
    normalizedStatus === 'cancelled';

  // A deadline reminder can be sent for open work whose client the reader may message.
  const messageComposer = useMessageComposer();
  const reminderClientId = assignment.clientId;
  const canSendReminder =
    messageComposer?.canMessage === true &&
    !isTerminal &&
    isValidUuid(assignment.id) &&
    reminderClientId !== undefined &&
    isValidUuid(reminderClientId);

  const staffList = teamMembers ?? [];
  const eligibleStaffOwners = useMemo(() => {
    return staffList.filter((m) => m.role !== 'trainee');
  }, [staffList]);

  const eligibleReviewers = useMemo(() => {
    return staffList.filter((m) => ['founder', 'manager', 'senior_staff'].includes(m.role));
  }, [staffList]);

  // Edit form state
  const [editTitle, setEditTitle] = useState(assignment.title);
  const [editServiceId, setEditServiceId] = useState(assignment.serviceId || '');
  const [editService, setEditService] = useState(assignment.service);
  const [editOwnerId, setEditOwnerId] = useState<string>(() => {
    if (assignment.ownerId) return assignment.ownerId;
    const match = eligibleStaffOwners.find(
      (s) => s.name.toLowerCase() === assignment.owner.toLowerCase()
    );
    return match?.id ?? eligibleStaffOwners[0]?.id ?? '';
  });
  const [editReviewerId, setEditReviewerId] = useState<string>(() => {
    if (assignment.reviewerId) return assignment.reviewerId;
    if (assignment.reviewerIds && assignment.reviewerIds.length > 0 && assignment.reviewerIds[0]) {
      return assignment.reviewerIds[0];
    }
    const match = eligibleReviewers.find(
      (s) => s.name.toLowerCase() === (assignment.reviewer || '').toLowerCase()
    );
    return match?.id ?? '';
  });
  const [editDue, setEditDue] = useState(assignment.due);
  const [editDescription, setEditDescription] = useState(assignment.description ?? assignment.scope ?? '');
  const [editDeliveryNotes, setEditDeliveryNotes] = useState(assignment.deliveryNotes || '');
  const [showChangeNotes, setShowChangeNotes] = useState(false);
  const [changeNotes, setChangeNotes] = useState('');

  useEffect(() => {
    setEditTitle(assignment.title);
    setEditServiceId(assignment.serviceId || '');
    setEditService(assignment.service);
    const currentOwner = eligibleStaffOwners.find(
      (s) => s.id === assignment.ownerId || s.name.toLowerCase() === assignment.owner.toLowerCase()
    );
    setEditOwnerId(currentOwner?.id ?? assignment.ownerId ?? eligibleStaffOwners[0]?.id ?? '');
    const currentReviewer = eligibleReviewers.find(
      (s) =>
        s.id === assignment.reviewerId ||
        (assignment.reviewerIds && assignment.reviewerIds.includes(s.id)) ||
        s.name.toLowerCase() === (assignment.reviewer || '').toLowerCase()
    );
    setEditReviewerId(currentReviewer?.id ?? assignment.reviewerId ?? '');
    setEditDue(assignment.due);
    setEditDescription(assignment.description ?? assignment.scope ?? '');
    setEditDeliveryNotes(assignment.deliveryNotes || '');
    setShowChangeNotes(false);
    setChangeNotes('');
    setIsEditing(initialEditing);
  }, [assignment, initialEditing, eligibleStaffOwners, eligibleReviewers]);

  // Modal Dialog Focus Trap and Keyboard Listener
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;

    const timer = window.setTimeout(() => {
      if (drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          focusable[0]?.focus();
        }
      }
    }, 40);

    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!isSubmitting) {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      previousActive?.focus?.();
    };
  }, [onClose, isSubmitting]);

  function toggleMilestone(index: number) {
    if (!isAssignedCustodian || isTerminal) return;
    setMilestones((prev) => {
      const next = prev.map((m, i) => (i === index ? { ...m, done: !m.done } : m));
      const doneCount = next.filter((m) => m.done).length;
      const nextProgress = Math.round((doneCount / next.length) * 100);
      return next;
    });
  }

  // Fieldwork progress save: updates progress percentage and milestones only (does NOT alter status)
  async function handleSaveProgress() {
    if (!isAssignedCustodian || isTerminal || isSubmitting) return;
    const doneCount = milestones.filter((m) => m.done).length;
    const progress = Math.round((doneCount / milestones.length) * 100);

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const updated: AssignmentRow = {
        ...assignment,
        progress,
        milestones,
      };
      const res = (await onUpdateAssignment(updated)) as unknown;
      if (res === false || (typeof res === 'object' && res !== null && 'success' in res && !(res as { success: boolean }).success)) {
        throw new Error('Failed to save fieldwork progress.');
      }
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save progress.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Lifecycle transition handler (explicit transition action)
  async function handleTransition(
    targetStatus: string,
    label: string,
    transitionOptions?: { deliveryNotes?: string | null; reviewNotes?: string | null },
  ) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const updated: AssignmentRow = {
        ...assignment,
        status: targetStatus,
        ...(transitionOptions?.deliveryNotes !== undefined ? { deliveryNotes: transitionOptions.deliveryNotes } : {}),
        ...(transitionOptions?.reviewNotes !== undefined ? { reviewNotes: transitionOptions.reviewNotes } : {}),
      };
      const res = (await onUpdateAssignment(updated)) as unknown;
      if (res === false || (typeof res === 'object' && res !== null && 'success' in res && !(res as { success: boolean }).success)) {
        throw new Error(`Failed to ${label.toLowerCase()}.`);
      }
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : `Failed to ${label.toLowerCase()}.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Configuration edit save (Title, Service, Owner, Reviewer, Due Date, Delivery Notes, Description)
  async function handleSaveEdit(e?: FormEvent) {
    if (e) e.preventDefault();
    if (isTerminal || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const selectedOwner = eligibleStaffOwners.find((s) => s.id === editOwnerId);
      const selectedReviewer = eligibleReviewers.find((s) => s.id === editReviewerId);
      const selectedService = services?.find((s) => s.id === editServiceId);

      const trimmedDescription = editDescription.trim();
      const nextDescription = trimmedDescription.length > 0 ? trimmedDescription : null;

      const trimmedDeliveryNotes = editDeliveryNotes.trim();
      const nextDeliveryNotes = trimmedDeliveryNotes.length > 0 ? trimmedDeliveryNotes : null;

      const updated: AssignmentRow = {
        ...assignment,
        title: editTitle.trim() || assignment.title,
        description: nextDescription,
        scope: nextDescription ?? undefined,
        serviceId: selectedService?.id ?? assignment.serviceId,
        service: selectedService?.name ?? editService,
        owner: selectedOwner ? selectedOwner.name : assignment.owner,
        ownerId: selectedOwner ? selectedOwner.id : assignment.ownerId,
        reviewer: selectedReviewer ? selectedReviewer.name : 'Not designated',
        reviewerId: selectedReviewer ? selectedReviewer.id : undefined,
        reviewerIds: selectedReviewer ? [selectedReviewer.id] : [],
        reviewerNames: selectedReviewer ? [selectedReviewer.name] : [],
        due: editDue.trim() || assignment.due,
        deliveryNotes: nextDeliveryNotes,
      };

      const res = (await onUpdateAssignment(updated)) as unknown;
      if (res === false || (typeof res === 'object' && res !== null && 'success' in res && !(res as { success: boolean }).success)) {
        throw new Error('Failed to save assignment changes.');
      }
      onToast(`Assignment ${displayCode ? `${displayCode} ` : ''}details saved`);
      setIsEditing(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save assignment changes.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={!isSubmitting ? onClose : undefined} />
      <aside
        ref={drawerRef}
        className="client-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Assignment details for ${assignment.title}`}
      >
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{monogram}</span>
            <div className="drawer-lead-copy">
              {displayCode ? (
                <span className="drawer-kicker">
                  {displayCode} · {assignment.service}
                </span>
              ) : null}
              <h2>{assignment.title}</h2>
              <p>
                {assignment.client}
                {!displayCode ? ` · ${assignment.service}` : ''}
              </p>
              <p>Engagement: {assignment.engagementCode ?? 'Not linked'}</p>
            </div>
          </div>
          <div className="drawer-header-actions">
            {canSendReminder && messageComposer && reminderClientId ? (
              <button
                className="soft-button"
                type="button"
                onClick={(event) =>
                  messageComposer.open(
                    {
                      clientId: reminderClientId,
                      purpose: 'deadline_reminder',
                      assignment: {
                        id: assignment.id,
                        code: displayCode ?? null,
                        title: assignment.title,
                        dueOn: assignment.due || null,
                      },
                    },
                    event.currentTarget,
                  )
                }
                disabled={isSubmitting}
                style={{
                  fontSize: 12,
                  padding: '5px 12px',
                  height: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <Send size={12} /> Send reminder
              </button>
            ) : null}
            {canEditAssignment ? (
              <button
                className="soft-button"
                type="button"
                onClick={() => {
                  setErrorMessage(null);
                  setIsEditing(!isEditing);
                }}
                disabled={isSubmitting}
                style={{
                  fontSize: 12,
                  padding: '5px 12px',
                  height: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                <Pencil size={12} /> {isEditing ? 'Cancel Edit' : 'Edit Assignment'}
              </button>
            ) : null}
            <button
              className="drawer-close-btn"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              aria-label="Close drawer"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        {errorMessage ? (
          <div
            role="alert"
            style={{
              margin: '12px 24px 0',
              padding: '10px 14px',
              background: 'var(--canvas)',
              border: '1px solid var(--signal)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--signal)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        ) : null}

        {!isEditing ? (
          <nav className="drawer-tabs">
            <button
              className={`drawer-tab ${tab === 'checklist' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('checklist')}
            >
              Milestones &amp; Checklist (
              {visibleMilestones.filter(({ milestone: m }) => m.done).length}/
              {visibleMilestones.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('overview')}
            >
              Scope &amp; Team
            </button>
            <button
              className={`drawer-tab ${tab === 'papers' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('papers')}
            >
              Working Papers
            </button>
            <button
              className={`drawer-tab ${tab === 'billing' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('billing')}
            >
              Billing Link
            </button>
          </nav>
        ) : null}

        <div className="drawer-content" style={{ padding: '20px 24px' }}>
          {isEditing ? (
            <form
              id="assignment-edit-form"
              onSubmit={handleSaveEdit}
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {isTerminal && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--surface-muted)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--ink-muted)',
                    fontSize: 12,
                  }}
                >
                  <Lock size={14} />
                  <span>This assignment is approved/closed and remains an immutable audit artifact.</span>
                </div>
              )}
              <div
                style={{
                  background: 'var(--canvas)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: 'var(--brand)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Edit Configuration{displayCode ? ` · ${displayCode}` : ''}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Update title, service catalog assignment, custody, reviewer, and statutory due date. Lifecycle status transitions are managed separately.
                </p>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Assignment Scope &amp; Service</h4>
                <div className="form-grid">
                  <Field label="Assignment Title" full>
                    <input
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      disabled={isTerminal || isSubmitting}
                      placeholder="e.g. GSTR-1 &amp; GSTR-3B Monthly Return Filing"
                    />
                  </Field>
                  <Field label="Client Entity">
                    <input value={assignment.client} readOnly style={{ opacity: 0.8 }} />
                  </Field>
                  <Field label="Practice Service Line">
                    {services && services.length > 0 ? (
                      <select
                        value={editServiceId}
                        onChange={(e) => {
                          const sId = e.target.value;
                          setEditServiceId(sId);
                          const match = services.find((s) => s.id === sId);
                          if (match) setEditService(match.name);
                        }}
                        disabled={isTerminal || isSubmitting}
                      >
                        {services.map((svc) => (
                          <option key={svc.id} value={svc.id}>
                            {svc.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={editService}
                        onChange={(e) => setEditService(e.target.value)}
                        disabled={isTerminal || isSubmitting}
                      />
                    )}
                  </Field>
                  <Field label="Scope / description" full>
                    <textarea
                      rows={2}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      disabled={isTerminal || isSubmitting}
                      placeholder="Describe assignment scope or specific client instructions..."
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                      }}
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Ownership &amp; Statutory Target</h4>
                <div className="form-grid">
                  <Field label="Assigned Staff (Owner / Custodian)">
                    <select
                      value={editOwnerId}
                      onChange={(e) => setEditOwnerId(e.target.value)}
                      disabled={isTerminal || isSubmitting || eligibleStaffOwners.length === 0}
                    >
                      {eligibleStaffOwners.length === 0 ? (
                        <option value="">No eligible staff available</option>
                      ) : (
                        eligibleStaffOwners.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name} · {ROLE_LABELS[staff.role] ?? staff.role}
                          </option>
                        ))
                      )}
                    </select>
                  </Field>
                  <Field label="Sign-off Reviewer (Partner / Manager / Senior Staff)">
                    <select
                      value={editReviewerId}
                      onChange={(e) => setEditReviewerId(e.target.value)}
                      disabled={isTerminal || isSubmitting}
                    >
                      <option value="">Not designated</option>
                      {eligibleReviewers.length === 0 ? (
                        <option value="" disabled>No eligible reviewers available</option>
                      ) : (
                        eligibleReviewers.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name} ({ROLE_LABELS[staff.role] ?? staff.role})
                          </option>
                        ))
                      )}
                    </select>
                  </Field>
                  <Field label="Target Statutory Due Date">
                    <input
                      value={editDue}
                      onChange={(e) => setEditDue(e.target.value)}
                      placeholder="e.g. 11/11/2026 or Today"
                      disabled={isTerminal || isSubmitting}
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Delivery Instructions &amp; Working Notes</h4>
                <div className="form-grid">
                  <Field label="Delivery Instructions / Working Notes" full>
                    <textarea
                      rows={3}
                      value={editDeliveryNotes}
                      onChange={(e) => setEditDeliveryNotes(e.target.value)}
                      disabled={isTerminal || isSubmitting}
                      placeholder="Special instructions, portal credentials note, or client reminders"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                      }}
                    />
                  </Field>
                </div>
              </div>
            </form>
          ) : (
            <>
              {tab === 'checklist' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {!isAssignedCustodian && !isTerminal ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'var(--canvas)',
                        border: '1px solid var(--border)',
                        padding: '10px 14px',
                        borderRadius: 8,
                        fontSize: 12,
                        color: 'var(--ink-secondary)',
                      }}
                    >
                      <Lock size={14} color="var(--ink-muted)" />
                      <span>
                        Fieldwork milestones and delivery progress can only be updated by the assigned custodian (
                        <strong>{assignment.owner}</strong>).
                      </span>
                    </div>
                  ) : null}

                  {/* Lifecycle Action Bar */}
                  <div
                    style={{
                      background: 'var(--surface-muted)',
                      padding: '12px 16px',
                      borderRadius: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--ink-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            fontWeight: 600,
                          }}
                        >
                          Lifecycle Stage
                        </span>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>
                          {assignment.status}
                        </div>
                      </div>
                      <div>
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--ink-muted)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            fontWeight: 600,
                          }}
                        >
                          Fieldwork Completion
                        </span>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: 'var(--ink)',
                            marginTop: 2,
                            textAlign: 'right',
                          }}
                        >
                          {visibleMilestones.length > 0
                            ? `${Math.round((visibleMilestones.filter(({ milestone: m }) => m.done).length / visibleMilestones.length) * 100)}%`
                            : `${assignment.progress}%`}
                        </div>
                      </div>
                    </div>

                    {/* Contextual Lifecycle Transition Controls */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        paddingTop: 8,
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      {/* Custodian: Start Assignment */}
                      {isAssignedCustodian &&
                      (normalizedStatus === 'assigned' ||
                        normalizedStatus === 'awaiting documents' ||
                        normalizedStatus === 'changes requested' ||
                        normalizedStatus === 'changes_requested') ? (
                        <button
                          className="primary-button"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleTransition('In progress', 'Start Assignment')}
                          style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Clock size={13} /> Start Assignment
                        </button>
                      ) : null}

                      {/* Custodian: Submit for Review */}
                      {isAssignedCustodian &&
                      (normalizedStatus === 'in progress' ||
                        normalizedStatus === 'in_progress' ||
                        normalizedStatus === 'assigned' ||
                        normalizedStatus === 'awaiting documents' ||
                        normalizedStatus === 'changes requested' ||
                        normalizedStatus === 'changes_requested') ? (
                        <button
                          className="soft-button"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleTransition('Pending review', 'Submit for Review')}
                          style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Send size={13} /> Submit for Review
                        </button>
                      ) : null}

                      {/* Leadership: Approve */}
                      {leadership &&
                      (normalizedStatus === 'pending review' ||
                        normalizedStatus === 'ready for review' ||
                        normalizedStatus === 'ready_for_review') ? (
                        <button
                          className="primary-button"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleTransition('Approved', 'Approve Assignment')}
                          style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <CheckCircle2 size={13} /> Approve Deliverable
                        </button>
                      ) : null}

                      {/* Leadership: Request Changes */}
                      {leadership &&
                      (normalizedStatus === 'pending review' ||
                        normalizedStatus === 'ready for review' ||
                        normalizedStatus === 'ready_for_review') ? (
                        <button
                          className="soft-button"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setShowChangeNotes((prev) => !prev)}
                          style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <RotateCcw size={13} /> {showChangeNotes ? 'Cancel Notes' : 'Request Changes'}
                        </button>
                      ) : null}

                      {/* Leadership: Close */}
                      {leadership && normalizedStatus === 'approved' ? (
                        <button
                          className="primary-button"
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleTransition('Completed', 'Close Assignment')}
                          style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Check size={13} /> Close Assignment
                        </button>
                      ) : null}
                    </div>

                    {showChangeNotes ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          marginTop: 10,
                          padding: 12,
                          background: 'var(--canvas)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                        }}
                      >
                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                          Review Notes for Assigned Custodian:
                        </label>
                        <textarea
                          rows={2}
                          value={changeNotes}
                          onChange={(e) => setChangeNotes(e.target.value)}
                          placeholder="Specify revisions or missing documentation required..."
                          disabled={isSubmitting}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: 'var(--radius-control)',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--ink)',
                            fontSize: 12,
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="primary-button"
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => {
                              handleTransition('Changes requested', 'Request Changes', {
                                reviewNotes: changeNotes.trim() || 'Changes requested by reviewer.',
                              });
                            }}
                            style={{ fontSize: 12, padding: '6px 12px' }}
                          >
                            Confirm Request Changes
                          </button>
                          <button
                            className="soft-button"
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => setShowChangeNotes(false)}
                            style={{ fontSize: 12, padding: '6px 12px' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                      Engagement Milestones &amp; Verification
                    </span>
                    {visibleMilestones.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--ink-muted)' }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                          No specific milestones recorded for this assignment.
                        </p>
                        <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                          Fieldwork tasks and sub-deliverables are tracked in Work Items.
                        </p>
                      </div>
                    ) : (
                      visibleMilestones.map(({ milestone: m, sourceIndex }, idx) => (
                        <label
                          key={m.title}
                          className={`checklist-interactive-row ${m.done ? 'is-completed' : ''}`}
                          style={{
                            cursor: isAssignedCustodian && !isTerminal ? 'pointer' : 'default',
                            padding: '10px 14px',
                            borderRadius: 8,
                            opacity: isAssignedCustodian && !isTerminal ? 1 : 0.85,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={m.done}
                            disabled={!isAssignedCustodian || isTerminal || isSubmitting}
                            onChange={() => isAssignedCustodian && !isTerminal && toggleMilestone(sourceIndex)}
                            className="checklist-checkbox"
                            style={{ cursor: isAssignedCustodian && !isTerminal ? 'pointer' : 'default' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: m.done ? 500 : 600,
                                textDecoration: m.done ? 'line-through' : 'none',
                              }}
                            >
                              {m.title}
                            </span>
                            <small style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                              {m.done ? 'Verified' : `Step ${idx + 1} pending`}
                            </small>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {tab === 'overview' ? (
                <div className="drawer-grid">
                  <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                    <span className="drawer-label">Scope / Description</span>
                    <span className="drawer-val" style={{ fontWeight: 400, fontSize: 13, lineHeight: 1.5 }}>
                      {assignment.description || assignment.scope || 'Not recorded'}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Assignment Owner</span>
                    <span className="drawer-val">{assignment.owner}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Sign-off Reviewer</span>
                    <span className="drawer-val">{assignment.reviewer || 'Not designated'}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Statutory Target Due Date</span>
                    <span
                      className="drawer-val"
                      style={{ color: assignment.due === 'Today' ? 'var(--signal)' : 'inherit' }}
                    >
                      {assignment.due}
                    </span>
                  </div>
                  <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                    <span className="drawer-label">Delivery Notes</span>
                    <span className="drawer-val" style={{ fontWeight: 400, fontSize: 12 }}>
                      {assignment.deliveryNotes || 'None recorded'}
                    </span>
                  </div>
                  <div
                    className="drawer-item"
                    style={{
                      gridColumn: 'span 2',
                      marginTop: 8,
                      paddingTop: 12,
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <span className="drawer-label">Related Settings</span>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
                      Professional fees, invoicing, and collections are managed in Billing.
                    </p>
                  </div>
                </div>
              ) : null}

              {tab === 'papers' ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '36px 16px',
                    textAlign: 'center',
                    gap: 10,
                  }}
                >
                  <Files size={28} color="var(--ink-muted)" style={{ opacity: 0.6 }} />
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                      No linked working papers
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                      Working papers and statutory evidence files are managed through the client document repository.
                    </p>
                  </div>
                </div>
              ) : null}

              {tab === 'billing' ? (
                <div className="drawer-grid">
                  <div className="drawer-item">
                    <span className="drawer-label">Agreed Professional Fee</span>
                    <span className="drawer-val" style={{ fontSize: 16, fontWeight: 700 }}>
                      {assignment.fee ? formatINR(assignment.fee) : 'Managed in Billing'}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Invoicing Status</span>
                    <span className="drawer-val">
                      {assignment.billed === true ? (
                        <span className="status tone-success">Billed</span>
                      ) : (
                        <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>Managed in Billing</span>
                      )}
                    </span>
                  </div>
                  {assignment.billed === true && assignment.invoiceId ? (
                    <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                      <span className="drawer-label">Linked Tax Invoice</span>
                      <span className="drawer-val" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{assignment.invoiceId}</strong>
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                          (Fee included in practice billing register)
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {assignment.billed !== true && leadership && onOpenInvoice ? (
                    <div
                      className="drawer-item"
                      style={{
                        gridColumn: 'span 2',
                        background: 'var(--surface-muted)',
                        padding: 14,
                        borderRadius: 8,
                      }}
                    >
                      <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 10px' }}>
                        Invoicing and fee allocations are managed centrally in Billing.
                      </p>
                      <button
                        className="soft-button"
                        type="button"
                        onClick={() => {
                          onClose();
                          if (onOpenInvoice) onOpenInvoice(assignment);
                        }}
                        style={{ fontSize: 12, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      >
                        <ReceiptIndianRupee size={14} /> Open Billing
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="drawer-footer">
          {isEditing ? (
            <>
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                form="assignment-edit-form"
                disabled={isTerminal || isSubmitting}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Check size={14} /> {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button className="soft-button" type="button" onClick={onClose} disabled={isSubmitting}>
                Close
              </button>
              {isAssignedCustodian && !isTerminal ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleSaveProgress}
                  disabled={isSubmitting}
                >
                  <Check size={14} /> {isSubmitting ? 'Saving...' : 'Save Fieldwork Progress'}
                </button>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', background: 'var(--surface-muted)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <Lock size={13} />
                  <span>Milestones locked to assigned custodian ({assignment.owner})</span>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
