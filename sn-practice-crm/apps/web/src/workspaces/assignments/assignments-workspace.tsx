import { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  FileText,
  Lock,
  Plus,
  ReceiptIndianRupee,
  Search,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import { Card, MoreButton, Status } from '../../ui/workspace-primitives';
import {
  ASSIGNMENTS,
  ROLE_LABELS,
  ROLE_PEOPLE,
  type AssignmentRow,
  type RecurringScheduleRecord,
} from '../../data';
import { AssignmentsTable } from './assignments-table';

type DialogMode = 'assignment' | 'personal' | 'delegated' | 'client' | 'schedule' | 'invoice' | 'receipt' | null;

export function AssignmentsWorkspace({
  role,
  schedules,
  assignments,
  onToast,
  onCompose,
  onUpdateSchedule,
  onUpdateAssignment,
  onSelectAssignment,
}: {
  role: CompanyRole;
  schedules: RecurringScheduleRecord[];
  assignments: AssignmentRow[];
  onToast: (message: string) => void;
  onCompose: (mode: DialogMode) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
}) {
  const [activeTab, setActiveTab] = useState<'compliance' | 'oneoff'>('compliance');
  const [staffFilter, setStaffFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | 'GST' | 'TDS' | 'Bookkeeping'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Bank Rec Needed' | 'Docs Awaited' | 'Ready to File' | 'Filed'>('All');
  const [search, setSearch] = useState('');
  const [selectedSchedule, setSelectedSchedule] = useState<RecurringScheduleRecord | null>(null);

  const person = ROLE_PEOPLE[role];
  const leadership = role === 'founder' || role === 'manager';
  const myAssignedStaffName = person.name;

  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      // 1. Staff filtering: staff only see their assigned clients unless leadership
      if (!leadership) {
        if (s.defaultOwner !== myAssignedStaffName) return false;
      } else if (staffFilter !== 'All') {
        if (s.defaultOwner !== staffFilter) return false;
      }

      // 2. Category filtering
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;

      // 3. Status filtering
      if (statusFilter === 'Bank Rec Needed') {
        if (s.bankRecStatus !== 'Awaited' && s.bankRecStatus !== 'In progress') return false;
      } else if (statusFilter === 'Docs Awaited') {
        if (s.currentStatus !== 'Docs Awaited') return false;
      } else if (statusFilter === 'Ready to File') {
        if (s.currentStatus !== 'Ready to File') return false;
      } else if (statusFilter === 'Filed') {
        if (s.currentStatus !== 'Filed') return false;
      }

      // 4. Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          s.title.toLowerCase().includes(q) ||
          s.clientName.toLowerCase().includes(q) ||
          s.defaultOwner.toLowerCase().includes(q) ||
          s.statutoryDueDay.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [schedules, leadership, myAssignedStaffName, staffFilter, categoryFilter, statusFilter, search]);

  const distinctClientCount = useMemo(() => {
    const ids = new Set(filteredSchedules.map((s) => s.clientId));
    return ids.size;
  }, [filteredSchedules]);

  const pendingGstCount = useMemo(() => {
    return filteredSchedules.filter((s) => s.category === 'GST' && s.currentStatus !== 'Filed').length;
  }, [filteredSchedules]);

  const pendingTdsCount = useMemo(() => {
    return filteredSchedules.filter((s) => s.category === 'TDS' && s.currentStatus !== 'Filed').length;
  }, [filteredSchedules]);

  const bankRecsPendingCount = useMemo(() => {
    return filteredSchedules.filter((s) => s.bankRecStatus === 'In progress' || s.bankRecStatus === 'Awaited').length;
  }, [filteredSchedules]);

  return (
    <div className="assignments-workspace" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* View Switcher: Monthly Compliance Tracker vs One-Off Assignments */}
      <div className="work-mode-switcher">
        <button
          type="button"
          className={`work-tab-btn ${activeTab === 'compliance' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('compliance')}
        >
          <CalendarClock size={16} />
          Monthly Compliance Tracker
          <span className="tab-badge">{filteredSchedules.length} obligations</span>
        </button>
        <button
          type="button"
          className={`work-tab-btn ${activeTab === 'oneoff' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('oneoff')}
        >
          <BriefcaseBusiness size={16} />
          One-Off &amp; Project Assignments
          <span className="tab-badge">{ASSIGNMENTS.length} active</span>
        </button>
      </div>

      {activeTab === 'compliance' ? (
        <>
          {/* Staff Scope Bar */}
          <div className="staff-scope-bar">
            <div className="staff-scope-info">
              <UsersRound size={16} />
              {!leadership ? (
                <span>
                  Showing compliance obligations for clients assigned to <strong>{myAssignedStaffName}</strong> ({ROLE_LABELS[role]})
                </span>
              ) : (
                <span>
                  Practice Compliance Desk · Scope: <strong>{staffFilter === 'All' ? 'All Practice Clients' : staffFilter}</strong>
                </span>
              )}
            </div>

            {leadership ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Filter by Staff:</span>
                <select
                  className="staff-scope-select"
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                >
                  <option value="All">All Staff (Entire Practice)</option>
                  <option value="Priya Desai">Priya Desai (Senior Staff)</option>
                  <option value="Rohan Mehta">Rohan Mehta (Staff)</option>
                  <option value="Ananya Rao">Ananya Rao (Manager)</option>
                  <option value="S. Narayanan">S. Narayanan (Founder)</option>
                </select>
              </div>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                {distinctClientCount} clients in your care
              </span>
            )}
          </div>

          {/* Horizon KPI Metric Cards */}
          <section className="workspace-stats-grid">
            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Assigned Clients</span>
                <strong>{distinctClientCount}</strong>
                <small>Under active compliance</small>
              </div>
              <span className="workspace-stat-icon">
                <Building2 aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Pending GST Returns</span>
                <strong>{pendingGstCount}</strong>
                <small>Due on 11th &amp; 20th</small>
              </div>
              <span className="workspace-stat-icon stat-warning">
                <FileText aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>TDS &amp; Challans Due</span>
                <strong>{pendingTdsCount}</strong>
                <small>Due on 7th &amp; 31st</small>
              </div>
              <span className="workspace-stat-icon stat-gold">
                <ReceiptIndianRupee aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Bank Rec Pending</span>
                <strong>{bankRecsPendingCount}</strong>
                <small>Required before GST filing</small>
              </div>
              <span className="workspace-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
                <WalletCards aria-hidden="true" />
              </span>
            </article>
          </section>

          {/* Search & Domain Filter Pills */}
          <div className="client-toolbar">
            <div className="client-search-wrap">
              <Search aria-hidden="true" />
              <input
                className="client-search-input"
                type="search"
                placeholder="Search by client, schedule title, due date, owner…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="cadence-tabs">
              {(['All', 'GST', 'TDS', 'Bookkeeping'] as const).map((cat) => (
                <button
                  key={cat}
                  className={`cadence-pill ${categoryFilter === cat ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat === 'Bookkeeping' ? 'Bank Rec & Books' : cat}
                </button>
              ))}
            </div>

            <div className="cadence-tabs">
              {(['All', 'Bank Rec Needed', 'Docs Awaited', 'Ready to File', 'Filed'] as const).map((st) => (
                <button
                  key={st}
                  className={`cadence-pill ${statusFilter === st ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  style={{ fontSize: 11 }}
                >
                  {st}
                </button>
              ))}
            </div>

            {leadership ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => onCompose('schedule')}
              >
                <Plus aria-hidden="true" /> Add schedule
              </button>
            ) : null}
          </div>

          {/* Horizon Compliance Table */}
          <Card
            title={!leadership ? `My Assigned Clients Compliance (${filteredSchedules.length})` : `Practice Compliance Matrix (${filteredSchedules.length})`}
            description="Standing compliance schedules assigned to staff · Bank reconciliation is verified as part of monthly GST"
            action={<MoreButton />}
            className="table-card"
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Target Client</th>
                    <th>Compliance Obligation</th>
                    <th>Staff In-Charge</th>
                    <th>Statutory Due Date</th>
                    <th>Bank Reconciliation</th>
                    <th>Filing Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                        No compliance schedules match your current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredSchedules.map((schedule) => (
                      <tr
                        key={schedule.id}
                        onClick={() => setSelectedSchedule(schedule)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>
                              {schedule.clientName}
                            </strong>
                            <span className="client-id-chip" style={{ width: 'fit-content' }}>
                              {schedule.clientId}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <strong style={{ color: 'var(--ink-strong)' }}>{schedule.title}</strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`category-tag cat-${schedule.category.toLowerCase().replace(/[^a-z]/g, '')}`}>
                                {schedule.category}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                                {schedule.cadence}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span className="user-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                              {schedule.defaultOwner.substring(0, 2).toUpperCase()}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-strong)' }}>
                              {schedule.defaultOwner}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="due-chip">
                            <CalendarClock size={12} />
                            {schedule.nextDueDate}
                          </span>
                        </td>
                        <td>
                          <span className={`bank-rec-chip ${
                            schedule.bankRecStatus === 'Completed'
                              ? 'is-done'
                              : schedule.bankRecStatus === 'In progress'
                              ? 'is-progress'
                              : schedule.bankRecStatus === 'Awaited'
                              ? 'is-awaited'
                              : 'is-na'
                          }`}>
                            {schedule.bankRecStatus === 'Completed' && '✓ Reconciled'}
                            {schedule.bankRecStatus === 'In progress' && '⏳ In Progress'}
                            {schedule.bankRecStatus === 'Awaited' && '⚠️ Statement Awaited'}
                            {schedule.bankRecStatus === 'Not applicable' && 'N/A (No Bank)'}
                          </span>
                        </td>
                        <td>
                          <span className={`filing-chip ${
                            schedule.currentStatus === 'Ready to File'
                              ? 'is-ready'
                              : schedule.currentStatus === 'Docs Awaited'
                              ? 'is-awaited'
                              : schedule.currentStatus === 'Bank Statement Received' || schedule.currentStatus === 'Filed'
                              ? 'is-done'
                              : 'is-pending'
                          }`}>
                            {schedule.currentStatus || 'Pending'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="soft-button"
                            type="button"
                            style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSchedule(schedule);
                            }}
                          >
                            View Checklist ({schedule.bankRecStatus === 'Not applicable' ? schedule.checklistTemplate.filter(s => !s.toLowerCase().includes('bank') && !s.toLowerCase().includes('reconciliation')).length : schedule.checklistTemplate.length})
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <AssignmentsTable
          title={leadership ? 'All open practice assignments' : 'Assignments visible to me'}
          rows={assignments}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          canEdit={leadership}
        />
      )}

      {/* Slide-over Schedule Detail Drawer */}
      {selectedSchedule ? (
        <ScheduleDetailDrawer
          schedule={selectedSchedule}
          leadership={leadership}
          role={role}
          onClose={() => setSelectedSchedule(null)}
          onToast={onToast}
          onUpdateSchedule={onUpdateSchedule}
        />
      ) : null}
    </div>
  );
}

function ScheduleDetailDrawer({
  schedule,
  leadership,
  role,
  onClose,
  onToast,
  onUpdateSchedule,
}: {
  schedule: RecurringScheduleRecord;
  leadership: boolean;
  role?: CompanyRole;
  onClose: () => void;
  onToast: (msg: string) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
}) {
  const currentPersonName = role ? ROLE_PEOPLE[role]?.name : '';
  const isAssignedCustodian = Boolean(
    currentPersonName &&
    (schedule.defaultOwner.toLowerCase().includes(currentPersonName.toLowerCase()) ||
     currentPersonName.toLowerCase().includes(schedule.defaultOwner.toLowerCase()))
  );
  const [tab, setTab] = useState<'checklist' | 'overview' | 'history'>('checklist');
  const [bankRecStatus, setBankRecStatus] = useState(schedule.bankRecStatus || 'Awaited');
  const [currentStatus, setCurrentStatus] = useState(schedule.currentStatus || 'Pending');
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({
    0: schedule.bankRecStatus === 'Completed',
  });
  const [arn, setArn] = useState('');

  const hasBank = schedule.bankRecStatus !== 'Not applicable' && bankRecStatus !== 'Not applicable';

  const workflowChecklist = useMemo(() => {
    if (hasBank) return schedule.checklistTemplate;
    return schedule.checklistTemplate.filter(
      (step) => !step.toLowerCase().includes('bank') && !step.toLowerCase().includes('reconciliation')
    );
  }, [schedule.checklistTemplate, hasBank]);

  function toggleStep(idx: number) {
    if (!isAssignedCustodian) return;
    setCheckedSteps((prev) => {
      const next = { ...prev, [idx]: !prev[idx] };
      if (hasBank && idx === 0 && next[0] && schedule.category === 'GST') {
        setBankRecStatus('Completed');
      }
      return next;
    });
  }

  function handleSave() {
    if (!isAssignedCustodian) return;
    const updated: RecurringScheduleRecord = {
      ...schedule,
      bankRecStatus,
      currentStatus,
    };
    onUpdateSchedule(updated);
    onClose();
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Recurring schedule details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{schedule.category.substring(0, 2).toUpperCase()}</span>
            <div>
              <h2>{schedule.title}</h2>
              <p>{schedule.clientName} · {schedule.cadence} Cycle</p>
            </div>
          </div>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="drawer-tabs">
          <button
            className={`drawer-tab ${tab === 'checklist' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('checklist')}
          >
            Workflow Checklist ({workflowChecklist.length})
          </button>
          <button
            className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            className={`drawer-tab ${tab === 'history' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('history')}
          >
            Generated History ({schedule.history.length})
          </button>
        </nav>

        <div className="drawer-content">
          {tab === 'checklist' ? (
            <div className="checklist-step-box">
              {!isAssignedCustodian ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--canvas)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 8, fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 14 }}>
                  <Lock size={14} color="var(--ink-muted)" />
                  <span>
                    Checklist steps, bank reconciliation, and filing progress can only be updated by the assigned custodian (<strong>{schedule.defaultOwner}</strong>).
                  </span>
                </div>
              ) : null}

              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 10px' }}>
                {!hasBank
                  ? 'Banking excluded: Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are not part of this return workflow.'
                  : 'Complete each prerequisite step. Bank statement receipt is verified before filing GST returns:'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {workflowChecklist.map((step, idx) => (
                  <div
                    key={idx}
                    className={`checklist-interactive-row ${checkedSteps[idx] ? 'is-completed' : ''}`}
                    style={{
                      cursor: isAssignedCustodian ? 'pointer' : 'not-allowed',
                      opacity: isAssignedCustodian ? 1 : 0.85,
                    }}
                    onClick={isAssignedCustodian ? () => toggleStep(idx) : undefined}
                  >
                    <div className="checklist-checkbox">
                      {checkedSteps[idx] ? <Check size={12} /> : null}
                    </div>
                    <span className="checklist-step-text" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>

              {/* Status Controls */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {hasBank ? (
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Bank Reconciliation Status
                    </span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {(['Completed', 'In progress', 'Awaited'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!isAssignedCustodian}
                          onClick={() => {
                            if (!isAssignedCustodian) return;
                            setBankRecStatus(st);
                            if (st === 'Completed') {
                              setCheckedSteps((prev) => ({ ...prev, 0: true }));
                            }
                          }}
                          className={`work-tab-btn ${bankRecStatus === st ? 'is-active' : ''}`}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            cursor: isAssignedCustodian ? 'pointer' : 'not-allowed',
                            opacity: isAssignedCustodian ? 1 : 0.7,
                          }}
                        >
                          {st === 'Completed' && '✓ Reconciled'}
                          {st === 'In progress' && '⏳ In Progress'}
                          {st === 'Awaited' && '⚠️ Statement Awaited'}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      <Building2 size={13} color="var(--ink-muted)" />
                      <span>Banking Excluded from GST Workflow</span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>
                      Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are not required or tracked for this return filing.
                    </p>
                  </div>
                )}

                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Filing Progress Status
                  </span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {(hasBank
                      ? ['Pending', 'Docs Awaited', 'Bank Statement Received', 'Ready to File', 'Filed'] as const
                      : ['Pending', 'Docs Awaited', 'Ready to File', 'Filed'] as const
                    ).map((fs) => (
                      <button
                        key={fs}
                        type="button"
                        disabled={!isAssignedCustodian}
                        onClick={() => isAssignedCustodian && setCurrentStatus(fs)}
                        className={`work-tab-btn ${currentStatus === fs ? 'is-active' : ''}`}
                        style={{
                          fontSize: 11,
                          padding: '4px 10px',
                          cursor: isAssignedCustodian ? 'pointer' : 'not-allowed',
                          opacity: isAssignedCustodian ? 1 : 0.7,
                        }}
                      >
                        {fs}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Portal Filing Proof / Acknowledgment ARN
                  </span>
                  <input
                    value={arn}
                    readOnly={!isAssignedCustodian}
                    onChange={(e) => setArn(e.target.value)}
                    placeholder="e.g. AA271026001923M (GSTN ARN / Challan BSR)"
                    style={{
                      width: '100%',
                      marginTop: 6,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      background: isAssignedCustodian ? 'var(--surface)' : 'var(--canvas)',
                      cursor: isAssignedCustodian ? 'text' : 'not-allowed',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'overview' ? (
            <>
              {schedule.exceptionReason ? (
                <div className="drawer-card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
                  <h4 style={{ color: 'var(--danger)' }}>Compliance Exception</h4>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                    {schedule.exceptionReason}
                  </p>
                </div>
              ) : null}

              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Schedule ID</span>
                  <span className="drawer-val">{schedule.id}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Category</span>
                  <span className="drawer-val">{schedule.category}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Cadence</span>
                  <span className="drawer-val">{schedule.cadence}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Generation Day</span>
                  <span className="drawer-val">Day {schedule.generationDay} of cycle</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Statutory Due Date</span>
                  <span className="drawer-val">{schedule.statutoryDueDay}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Default Assignment Owner</span>
                  <span className="drawer-val">{schedule.defaultOwner}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Next Automated Run</span>
                  <span className="drawer-val">{schedule.nextRunDate}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Target Due Date</span>
                  <span className="drawer-val">{schedule.nextDueDate}</span>
                </div>
                <div className="drawer-item full-width">
                  <span className="drawer-label">Client Legal Entity</span>
                  <span className="drawer-val">{schedule.clientName} ({schedule.clientId})</span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'history' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 4px' }}>
                Past assignments generated from this recurring compliance schedule:
              </p>
              {schedule.history.map((h) => (
                <div key={h.period} className="history-card-row">
                  <div>
                    <strong>{h.period}</strong>
                    <small>Assignment Ref: {h.assignmentId} {h.completedOn ? `· Completed on ${h.completedOn}` : ''}</small>
                  </div>
                  <Status tone={h.status === 'Completed' ? 'success' : h.status === 'In progress' ? 'default' : 'warning'}>
                    {h.status}
                  </Status>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="drawer-footer">
          {isAssignedCustodian ? (
            <button
              className="primary-button"
              type="button"
              onClick={handleSave}
            >
              <CheckCircle2 size={14} /> Save progress &amp; update status
            </button>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', background: 'var(--surface-muted)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <Lock size={13} />
              <span>Workflow &amp; filing progress locked to assigned custodian ({schedule.defaultOwner})</span>
            </div>
          )}
          <button className="soft-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
