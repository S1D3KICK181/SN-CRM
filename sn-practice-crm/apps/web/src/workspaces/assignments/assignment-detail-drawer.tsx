import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Files,
  Lock,
  Pencil,
  ReceiptIndianRupee,
  X,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
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
}) {
  const canEditAssignment = role === 'founder' || role === 'manager';
  const displayCode = assignment.code && !isValidUuid(assignment.code)
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
  const [status, setStatus] = useState(assignment.status);
  const [milestones, setMilestones] = useState<AssignmentMilestone[]>(
    assignment.milestones || [
      { title: 'Initial document scrutiny and intake', done: true },
      { title: 'Fieldwork verification & ledger scrutiny', done: assignment.progress >= 50 },
      { title: 'Managerial quality review', done: assignment.progress >= 80 },
      { title: 'Partner final sign-off & dispatch', done: assignment.progress === 100 },
    ]
  );
  const visibleMilestones = useMemo(() => {
    const indexed = milestones.map((milestone, sourceIndex) => ({
      milestone,
      sourceIndex,
    }));
    if (assignment.bankStatementRequired === false) {
      return indexed.filter(
        ({ milestone: m }) => !m.title.toLowerCase().includes('bank statement') && !m.title.toLowerCase().includes('bank reconciliation')
      );
    }
    return indexed;
  }, [milestones, assignment.bankStatementRequired]);

  const isTerminal =
    assignment.status.toLowerCase() === 'approved' ||
    assignment.status.toLowerCase() === 'completed' ||
    assignment.status.toLowerCase() === 'closed';

  const staffList = teamMembers ?? [];
  const eligibleStaffOwners = useMemo(() => {
    return staffList.filter((m) => m.role !== 'trainee');
  }, [staffList]);

  const [editTitle, setEditTitle] = useState(assignment.title);
  const [editService, setEditService] = useState(assignment.service);
  const [editOwnerId, setEditOwnerId] = useState<string>(() => {
    if (assignment.ownerId) return assignment.ownerId;
    const match = eligibleStaffOwners.find(
      (s) => s.name.toLowerCase() === assignment.owner.toLowerCase(),
    );
    return match?.id ?? eligibleStaffOwners[0]?.id ?? '';
  });
  const [editReviewerId, setEditReviewerId] = useState<string>(() => {
    if (assignment.reviewerId) return assignment.reviewerId;
    if (assignment.reviewerIds && assignment.reviewerIds.length > 0 && assignment.reviewerIds[0]) {
      return assignment.reviewerIds[0];
    }
    const match = eligibleStaffOwners.find(
      (s) => s.name.toLowerCase() === (assignment.reviewer || '').toLowerCase(),
    );
    return match?.id ?? eligibleStaffOwners[0]?.id ?? '';
  });
  const [editDue, setEditDue] = useState(assignment.due);
  const [editStatus, setEditStatus] = useState(assignment.status);
  const [editScope, setEditScope] = useState(assignment.scope || '');
  const [editDeliveryNotes, setEditDeliveryNotes] = useState(assignment.deliveryNotes || '');

  useEffect(() => {
    setEditTitle(assignment.title);
    setEditService(assignment.service);
    const currentOwner = eligibleStaffOwners.find(
      (s) => s.id === assignment.ownerId || s.name.toLowerCase() === assignment.owner.toLowerCase(),
    );
    setEditOwnerId(currentOwner?.id ?? assignment.ownerId ?? eligibleStaffOwners[0]?.id ?? '');
    const currentReviewer = eligibleStaffOwners.find(
      (s) =>
        s.id === assignment.reviewerId ||
        (assignment.reviewerIds && assignment.reviewerIds.includes(s.id)) ||
        s.name.toLowerCase() === (assignment.reviewer || '').toLowerCase(),
    );
    setEditReviewerId(currentReviewer?.id ?? assignment.reviewerId ?? eligibleStaffOwners[0]?.id ?? '');
    setEditDue(assignment.due);
    setEditStatus(assignment.status);
    setEditScope(assignment.scope || '');
    setEditDeliveryNotes(assignment.deliveryNotes || '');
    setIsEditing(initialEditing);
  }, [assignment, initialEditing, eligibleStaffOwners]);

  function toggleMilestone(index: number) {
    if (!isAssignedCustodian) return;
    setMilestones((prev) => {
      const next = prev.map((m, i) => (i === index ? { ...m, done: !m.done } : m));
      const doneCount = next.filter((m) => m.done).length;
      const nextProgress = Math.round((doneCount / next.length) * 100);
      const nextStatus = nextProgress === 100 ? 'Completed' : nextProgress >= 80 ? 'Pending review' : 'In progress';
      setStatus(nextStatus);
      return next;
    });
  }

  function handleSave() {
    if (!isAssignedCustodian) return;
    const doneCount = milestones.filter((m) => m.done).length;
    const progress = Math.round((doneCount / milestones.length) * 100);
    const updated: AssignmentRow = {
      ...assignment,
      status,
      progress,
      milestones,
      tone: status === 'Completed' ? 'success' : status === 'Pending review' ? 'warning' : 'default',
    };
    onUpdateAssignment(updated);
    onClose();
  }

  function handleSaveEdit(e?: FormEvent) {
    if (e) e.preventDefault();
    if (isTerminal) return;
    const selectedOwner = eligibleStaffOwners.find((s) => s.id === editOwnerId);
    const selectedReviewer = eligibleStaffOwners.find((s) => s.id === editReviewerId);
    const updated: AssignmentRow = {
      ...assignment,
      title: editTitle.trim() || assignment.title,
      service: editService,
      owner: selectedOwner ? selectedOwner.name : assignment.owner,
      ownerId: selectedOwner ? selectedOwner.id : assignment.ownerId,
      reviewer: selectedReviewer ? selectedReviewer.name : assignment.reviewer,
      reviewerId: selectedReviewer ? selectedReviewer.id : assignment.reviewerId,
      reviewerIds: selectedReviewer ? [selectedReviewer.id] : (assignment.reviewerIds ?? []),
      due: editDue.trim() || assignment.due,
      status: editStatus,
      scope: editScope.trim(),
      deliveryNotes: editDeliveryNotes.trim(),
      tone: editStatus === 'Completed' ? 'success' : editStatus === 'Pending review' ? 'warning' : 'default',
    };
    onUpdateAssignment(updated);
    setIsEditing(false);
    const savedLabel = displayCode ? `Assignment ${displayCode}` : `Assignment "${assignment.title}"`;
    onToast(`${savedLabel} details saved`);
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Assignment Details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{monogram}</span>
            <div className="drawer-lead-copy">
              {displayCode ? (
                <span className="drawer-kicker">{displayCode} · {assignment.service}</span>
              ) : null}
              <h2>{assignment.title}</h2>
              <p>{assignment.client}{!displayCode ? ` · ${assignment.service}` : ''}</p>
            </div>
          </div>
          <div className="drawer-header-actions">
            {canEditAssignment ? (
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                style={{ fontSize: 12, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
              >
                <Pencil size={12} /> {isEditing ? 'Cancel Edit' : 'Edit Assignment'}
              </button>
            ) : null}
            <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        {!isEditing ? (
          <nav className="drawer-tabs">
            <button
              className={`drawer-tab ${tab === 'checklist' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('checklist')}
            >
              Milestones &amp; Checklist ({visibleMilestones.filter(({ milestone: m }) => m.done).length}/{visibleMilestones.length})
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
            <form id="assignment-edit-form" onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--canvas)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Edit Assignment{displayCode ? ` · ${displayCode}` : ''}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Update scope, custody, reviewer, statutory due date, and delivery notes.
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
                      disabled={isTerminal}
                      placeholder="e.g. GSTR-1 &amp; GSTR-3B Monthly Return Filing"
                    />
                  </Field>
                  <Field label="Client Entity">
                    <input value={assignment.client} readOnly style={{ opacity: 0.8 }} />
                  </Field>
                  <Field label="Practice Service Line">
                    <select value={editService} onChange={(e) => setEditService(e.target.value)} disabled={isTerminal}>
                      <option value="GST Compliance">GST Compliance</option>
                      <option value="Statutory Audit">Statutory Audit</option>
                      <option value="TDS Compliance">TDS Compliance</option>
                      <option value="Bookkeeping">Bookkeeping &amp; Accounts</option>
                      <option value="ROC Compliance">ROC &amp; Corporate</option>
                      <option value="Advisory">Tax Advisory</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Ownership, Review &amp; Status</h4>
                {isTerminal && (
                  <div
                    className="terminal-notice"
                    style={{
                      background: 'var(--canvas)',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: 'var(--ink-muted)',
                      fontSize: 12,
                      marginBottom: 12,
                    }}
                  >
                    <Lock size={14} />
                    <span>This assignment is approved/closed and remains an immutable audit artifact.</span>
                  </div>
                )}
                <div className="form-grid">
                  <Field label="Assigned Staff (Owner / Custodian)">
                    <select
                      value={editOwnerId}
                      onChange={(e) => setEditOwnerId(e.target.value)}
                      disabled={isTerminal || eligibleStaffOwners.length === 0}
                    >
                      {eligibleStaffOwners.length > 0 ? (
                        eligibleStaffOwners.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name} · {ROLE_LABELS[staff.role] ?? staff.role}
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>No eligible staff available</option>
                      )}
                    </select>
                  </Field>
                  <Field label="Sign-off Reviewer (Partner / Manager)">
                    <select
                      value={editReviewerId}
                      onChange={(e) => setEditReviewerId(e.target.value)}
                      disabled={isTerminal || eligibleStaffOwners.length === 0}
                    >
                      {eligibleStaffOwners.length > 0 ? (
                        eligibleStaffOwners.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {staff.name} ({ROLE_LABELS[staff.role] ?? staff.role})
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>No eligible reviewers available</option>
                      )}
                    </select>
                  </Field>
                  <Field label="Assignment Status">
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} disabled={isTerminal}>
                      <option value="In progress">In progress</option>
                      <option value="Pending review">Pending review</option>
                      <option value="Awaiting documents">Awaiting documents</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </Field>
                  <Field label="Target Statutory Due Date">
                    <input
                      value={editDue}
                      onChange={(e) => setEditDue(e.target.value)}
                      placeholder="e.g. 11/11/2026 or Today"
                      disabled={isTerminal}
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Delivery Instructions &amp; Notes</h4>
                <div className="form-grid">
                  <Field label="Delivery Instructions / Working Notes" full>
                    <textarea
                      rows={3}
                      value={editDeliveryNotes}
                      onChange={(e) => setEditDeliveryNotes(e.target.value)}
                      disabled={isTerminal}
                      placeholder="Special instructions, portal credentials note, or client reminders"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                    />
                  </Field>
                </div>
              </div>
            </form>
          ) : (
            <>
              {tab === 'checklist' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {!isAssignedCustodian ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--canvas)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 8, fontSize: 12, color: 'var(--ink-secondary)' }}>
                      <Lock size={14} color="var(--ink-muted)" />
                      <span>
                        Fieldwork milestones and delivery progress can only be updated by the assigned custodian (<strong>{assignment.owner}</strong>).
                      </span>
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-muted)', padding: '12px 16px', borderRadius: 10 }}>
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Delivery Progress</span>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
                        {Math.round((visibleMilestones.filter(({ milestone: m }) => m.done).length / (visibleMilestones.length || 1)) * 100)}%
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Status:</span>
                      <select
                        className="staff-scope-select"
                        value={status}
                        disabled={!isAssignedCustodian}
                        onChange={(e) => setStatus(e.target.value)}
                        style={{ opacity: isAssignedCustodian ? 1 : 0.7, cursor: isAssignedCustodian ? 'pointer' : 'not-allowed' }}
                      >
                        <option value="In progress">In progress</option>
                        <option value="Pending review">Pending review</option>
                        <option value="Awaiting documents">Awaiting documents</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>Engagement Milestones</span>
                    {visibleMilestones.map(({ milestone: m, sourceIndex }, idx) => (
                      <label
                        key={m.title}
                        className={`checklist-interactive-row ${m.done ? 'is-completed' : ''}`}
                        style={{ cursor: isAssignedCustodian ? 'pointer' : 'not-allowed', padding: '10px 14px', borderRadius: 8, opacity: isAssignedCustodian ? 1 : 0.85 }}
                      >
                        <input
                          type="checkbox"
                          checked={m.done}
                          disabled={!isAssignedCustodian}
                          onChange={() => isAssignedCustodian && toggleMilestone(sourceIndex)}
                          className="checklist-checkbox"
                          style={{ cursor: isAssignedCustodian ? 'pointer' : 'not-allowed' }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: m.done ? 500 : 600, textDecoration: m.done ? 'line-through' : 'none' }}>
                            {m.title}
                          </span>
                          <small style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                            {m.done ? 'Completed and verified' : `Step ${idx + 1} pending`}
                          </small>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === 'overview' ? (
                <div className="drawer-grid">
                  <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                    <span className="drawer-label">Engagement Scope</span>
                    <span className="drawer-val" style={{ fontWeight: 400, fontSize: 13, lineHeight: 1.5 }}>
                      {assignment.scope || 'Full statutory deliverable verification and reporting according to ICAI standards.'}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Assignment Owner</span>
                    <span className="drawer-val">{assignment.owner}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Reviewer / Sign-off</span>
                    <span className="drawer-val">{assignment.reviewer || 'S. Narayanan (Founder)'}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Statutory Target Due Date</span>
                    <span className="drawer-val" style={{ color: assignment.due === 'Today' ? 'var(--signal)' : 'inherit' }}>
                      {assignment.due}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Bank Rec for GST</span>
                    <span className="drawer-val">
                      {assignment.bankStatementRequired === false ? (
                        <span className="category-tag" style={{ background: 'var(--canvas)', color: 'var(--ink-muted)', padding: '2px 8px' }}>
                          Not Applicable (No Bank)
                        </span>
                      ) : (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>Required</span>
                      )}
                    </span>
                  </div>
                  <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                    <span className="drawer-label">Delivery Notes</span>
                    <span className="drawer-val" style={{ fontWeight: 400, fontSize: 12 }}>
                      {assignment.deliveryNotes || 'Standard delivery cycle.'}
                    </span>
                  </div>
                  <div className="drawer-item" style={{ gridColumn: 'span 2', marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <span className="drawer-label">Related Settings</span>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
                      Professional fees are managed in Billing. Document and bank-statement requirements are managed on the Client profile.
                    </p>
                  </div>
                </div>
              ) : null}

              {tab === 'papers' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 16px', textAlign: 'center', gap: 10 }}>
                  <Files size={28} color="var(--ink-muted)" style={{ opacity: 0.6 }} />
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>No linked working papers</p>
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
                      <span className={`status ${assignment.billed ? 'tone-success' : 'tone-warning'}`}>
                        {assignment.billed ? 'Billed' : 'Unbilled'}
                      </span>
                    </span>
                  </div>
                  {assignment.billed && assignment.invoiceId ? (
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
                  {!assignment.billed && leadership ? (
                    <div className="drawer-item" style={{ gridColumn: 'span 2', background: 'var(--surface-muted)', padding: 14, borderRadius: 8 }}>
                      <p style={{ fontSize: 12, color: 'var(--ink)', margin: '0 0 10px' }}>
                        Deliverable is nearing completion. You can raise a Tax Invoice now with standard 18% GST (CGST 9% + SGST 9%).
                      </p>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => {
                          onClose();
                          if (onOpenInvoice) onOpenInvoice(assignment);
                        }}
                      >
                        <ReceiptIndianRupee size={14} /> Raise Tax Invoice for this Assignment
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
              <button className="soft-button" type="button" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                form="assignment-edit-form"
                disabled={isTerminal}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Check size={14} /> Save Changes
              </button>
            </>
          ) : (
            <>
              <button className="soft-button" type="button" onClick={onClose}>
                Close
              </button>
              {isAssignedCustodian ? (
                <button className="primary-button" type="button" onClick={handleSave}>
                  <Check size={14} /> Save progress &amp; update status
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
