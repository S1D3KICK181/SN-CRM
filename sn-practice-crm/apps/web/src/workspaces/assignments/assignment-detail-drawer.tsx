import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check,
  Files,
  Lock,
  Pencil,
  Plus,
  ReceiptIndianRupee,
  X,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import {
  ROLE_PEOPLE,
  formatINR,
  type AssignmentMilestone,
  type AssignmentRow,
} from '../../data';
import { Field } from '../../ui/workspace-primitives';

export function AssignmentDetailDrawer({
  assignment,
  leadership,
  role,
  onClose,
  onToast,
  onUpdateAssignment,
  onOpenInvoice,
  initialEditing = false,
}: {
  assignment: AssignmentRow;
  leadership: boolean;
  role?: CompanyRole;
  onClose: () => void;
  onToast: (msg: string) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onOpenInvoice?: (asn: AssignmentRow) => void;
  initialEditing?: boolean;
}) {
  const canEditAssignment = role === 'founder' || role === 'manager';
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
  const [newPaper, setNewPaper] = useState('');
  const [workingPapers, setWorkingPapers] = useState<string[]>([
    `${assignment.client.replace(/\s+/g, '_')}_Working_Papers.xlsx`,
    `Statutory_Verification_Checklist_${assignment.id}.pdf`,
  ]);

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

  const [editTitle, setEditTitle] = useState(assignment.title);
  const [editService, setEditService] = useState(assignment.service);
  const [editOwner, setEditOwner] = useState(assignment.owner);
  const [editReviewer, setEditReviewer] = useState(assignment.reviewer || 'S. Narayanan');
  const [editDue, setEditDue] = useState(assignment.due);
  const [editStatus, setEditStatus] = useState(assignment.status);
  const [editScope, setEditScope] = useState(assignment.scope || '');
  const [editDeliveryNotes, setEditDeliveryNotes] = useState(assignment.deliveryNotes || '');
  const [editFee, setEditFee] = useState<number>(assignment.fee || 25000);
  const [editBankStatementReq, setEditBankStatementReq] = useState<boolean>(assignment.bankStatementRequired !== false);

  useEffect(() => {
    setEditTitle(assignment.title);
    setEditService(assignment.service);
    setEditOwner(assignment.owner);
    setEditReviewer(assignment.reviewer || 'S. Narayanan');
    setEditDue(assignment.due);
    setEditStatus(assignment.status);
    setEditScope(assignment.scope || '');
    setEditDeliveryNotes(assignment.deliveryNotes || '');
    setEditFee(assignment.fee || 25000);
    setEditBankStatementReq(assignment.bankStatementRequired !== false);
    setIsEditing(initialEditing);
  }, [assignment, initialEditing]);

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
    const updated: AssignmentRow = {
      ...assignment,
      title: editTitle.trim() || assignment.title,
      service: editService,
      owner: editOwner,
      reviewer: editReviewer,
      due: editDue.trim() || assignment.due,
      status: editStatus,
      scope: editScope.trim(),
      deliveryNotes: editDeliveryNotes.trim(),
      fee: editFee,
      bankStatementRequired: editBankStatementReq,
      bankRecStatus: editBankStatementReq ? (assignment.bankRecStatus || 'Awaited') : 'Not applicable',
      tone: editStatus === 'Completed' ? 'success' : editStatus === 'Pending review' ? 'warning' : 'default',
    };
    onUpdateAssignment(updated);
    setIsEditing(false);
    onToast(`Assignment ${assignment.id} details saved`);
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Assignment Details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{assignment.id.substring(4)}</span>
            <div>
              <h2>{assignment.title}</h2>
              <p>{assignment.client} · {assignment.service}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canEditAssignment ? (
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                style={{ fontSize: 11, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
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
              Working Papers ({workingPapers.length})
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
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Edit Assignment · {assignment.id}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Update scope, custody, reviewer, statutory due date, fee, and banking requirements.
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
                      placeholder="e.g. GSTR-1 &amp; GSTR-3B Monthly Return Filing"
                    />
                  </Field>
                  <Field label="Client Entity">
                    <input value={assignment.client} readOnly style={{ opacity: 0.8 }} />
                  </Field>
                  <Field label="Practice Service Line">
                    <select value={editService} onChange={(e) => setEditService(e.target.value)}>
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
                <div className="form-grid">
                  <Field label="Assigned Staff (Owner / Custodian)">
                    <select value={editOwner} onChange={(e) => setEditOwner(e.target.value)}>
                      <option value="S. Narayanan">S. Narayanan · Founder</option>
                      <option value="Ananya Rao">Ananya Rao · Manager</option>
                      <option value="Priya Desai">Priya Desai · Senior Staff</option>
                      <option value="Rohan Mehta">Rohan Mehta · Staff</option>
                    </select>
                  </Field>
                  <Field label="Sign-off Reviewer (Partner / Manager)">
                    <select value={editReviewer} onChange={(e) => setEditReviewer(e.target.value)}>
                      <option value="S. Narayanan">S. Narayanan (Founder)</option>
                      <option value="Ananya Rao">Ananya Rao (Manager)</option>
                      <option value="Priya Desai">Priya Desai (Senior Staff)</option>
                    </select>
                  </Field>
                  <Field label="Assignment Status">
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
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
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 6 }}>Banking &amp; Bank Statement Requirement</h4>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
                  For cash-only or retail clients without bank operations, set to "No" so bank statement reconciliation is marked Not Applicable for this filing.
                </p>
                <div className="form-grid">
                  <Field label="Bank Statement &amp; Reconciliation Required for this Filing?" full>
                    <select
                      value={editBankStatementReq ? 'yes' : 'no'}
                      onChange={(e) => setEditBankStatementReq(e.target.value === 'yes')}
                    >
                      <option value="yes">Yes — Mandatory bank statement &amp; reconciliation</option>
                      <option value="no">No — Not Applicable (Client has no bank / cash-only filing)</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Commercials &amp; Notes</h4>
                <div className="form-grid">
                  <Field label="Agreed Professional Fee (₹)">
                    <input
                      type="number"
                      value={editFee}
                      onChange={(e) => setEditFee(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Delivery Instructions / Working Notes" full>
                    <textarea
                      rows={2}
                      value={editDeliveryNotes}
                      onChange={(e) => setEditDeliveryNotes(e.target.value)}
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
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Delivery Progress</span>
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
                          <small style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
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
                </div>
              ) : null}

              {tab === 'papers' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
                    Audit evidence files, working papers, and signed confirmations tied to {assignment.id}.
                  </p>
                  <div className="list-stack">
                    {workingPapers.map((paper) => (
                      <div
                        key={paper}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'var(--surface-muted)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                          <Files size={15} color="var(--brand)" />
                          {paper}
                        </span>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => onToast(`Downloaded ${paper}`)}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="New paper name or document link…"
                      value={newPaper}
                      onChange={(e) => setNewPaper(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        fontSize: 12,
                      }}
                    />
                    <button
                      className="soft-button"
                      type="button"
                      onClick={() => {
                        if (newPaper.trim()) {
                          setWorkingPapers((prev) => [...prev, newPaper.trim()]);
                          setNewPaper('');
                          onToast(`Added working paper reference`);
                        }
                      }}
                    >
                      <Plus size={14} /> Attach
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === 'billing' ? (
                <div className="drawer-grid">
                  <div className="drawer-item">
                    <span className="drawer-label">Agreed Professional Fee</span>
                    <span className="drawer-val" style={{ fontSize: 16, fontWeight: 700 }}>
                      {formatINR(assignment.fee || 25000)}
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
