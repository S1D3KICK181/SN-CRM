import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
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
import { CadenceTracker } from './cadence-tracker';
import { isValidUuid } from '../../api/metadata-safety';

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
  onGenerateDue,
  isGeneratingDue = false,
  isLoading = false,
  error = null,
  onRetry,
}: {
  role: CompanyRole;
  schedules: RecurringScheduleRecord[];
  assignments: AssignmentRow[];
  onToast: (message: string) => void;
  onCompose: (mode: DialogMode) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onGenerateDue?: () => void;
  isGeneratingDue?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
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

  const scopedSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (!leadership) {
        if (s.defaultOwner !== myAssignedStaffName) return false;
      } else if (staffFilter !== 'All') {
        if (s.defaultOwner !== staffFilter) return false;
      }
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;
      return true;
    });
  }, [schedules, leadership, myAssignedStaffName, staffFilter, categoryFilter]);

  const tally = useMemo(() => {
    let all = 0;
    let bankRecNeeded = 0;
    let docsAwaited = 0;
    let readyToFile = 0;
    let filed = 0;

    for (const s of scopedSchedules) {
      all += 1;
      if (s.bankRecStatus === 'Awaited' || s.bankRecStatus === 'In progress') {
        bankRecNeeded += 1;
      }
      if (s.currentStatus === 'Docs Awaited') {
        docsAwaited += 1;
      } else if (s.currentStatus === 'Ready to File') {
        readyToFile += 1;
      } else if (s.currentStatus === 'Filed') {
        filed += 1;
      }
    }
    return { all, bankRecNeeded, docsAwaited, readyToFile, filed };
  }, [scopedSchedules]);

  const distinctClientCount = useMemo(() => {
    const ids = new Set(filteredSchedules.map((s) => s.clientId));
    return ids.size;
  }, [filteredSchedules]);

  return (
    <div className="assignments-workspace">
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
                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Filter by Staff:</span>
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
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                {distinctClientCount} clients in your care
              </span>
            )}
          </div>

          {/* Status Filter Tally Strip */}
          <div
            className="cadence-tally-strip"
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {([
              { key: 'All', label: 'All', count: tally.all },
              { key: 'Bank Rec Needed', label: 'Bank Rec Needed', count: tally.bankRecNeeded },
              { key: 'Docs Awaited', label: 'Docs Awaited', count: tally.docsAwaited },
              { key: 'Ready to File', label: 'Ready to File', count: tally.readyToFile },
              { key: 'Filed', label: 'Filed', count: tally.filed },
            ] as const).map(({ key, label, count }) => (
              <button
                key={key}
                className={`cadence-pill ${statusFilter === key ? 'is-active' : ''}`}
                type="button"
                onClick={() => setStatusFilter(key)}
                style={{
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{label}</span>
                <span
                  style={{
                    fontSize: 12,
                    padding: '1px 6px',
                    borderRadius: 10,
                    background: statusFilter === key ? 'var(--primary)' : 'var(--canvas)',
                    color: statusFilter === key ? 'var(--surface)' : 'var(--ink-muted)',
                    fontWeight: 600,
                  }}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>

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

            {leadership ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {onGenerateDue && (
                  <button
                    className="soft-button"
                    type="button"
                    onClick={onGenerateDue}
                    disabled={isGeneratingDue}
                    style={{ fontSize: 12, padding: '6px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <CalendarClock size={13} />
                    {isGeneratingDue ? 'Generating Due...' : 'Generate due assignments'}
                  </button>
                )}
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onCompose('schedule')}
                >
                  <Plus aria-hidden="true" /> Add schedule
                </button>
              </div>
            ) : null}
          </div>

          {error && (
            <div
              className="field-error-banner"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: 13,
              }}
            >
              <span>{error}</span>
              {onRetry && (
                <button
                  className="soft-button"
                  type="button"
                  onClick={onRetry}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Horizon Compliance Table */}
          <Card
            title={!leadership ? `My Assigned Clients Compliance (${filteredSchedules.length})` : `Practice Compliance Matrix (${filteredSchedules.length})`}
            description="Standing compliance schedules assigned to staff · Bank reconciliation is verified as part of monthly GST"
            action={<MoreButton />}
            className="table-card"
          >
            {isLoading ? (
              <div style={{ display: 'grid', gap: 12, padding: '24px 16px' }} data-testid="schedules-loading-skeleton">
                <div className="skeleton-pulse" style={{ height: 44, background: 'var(--canvas)', borderRadius: 6 }} />
                <div className="skeleton-pulse" style={{ height: 44, background: 'var(--canvas)', borderRadius: 6 }} />
                <div className="skeleton-pulse" style={{ height: 44, background: 'var(--canvas)', borderRadius: 6 }} />
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Target Client</th>
                      <th>Compliance Obligation</th>
                      <th>Staff In-Charge</th>
                      <th>Statutory Due Date</th>
                      <th>Statutory Cadence Horizon</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSchedules.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                          No compliance schedules match your current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredSchedules.map((schedule) => {
                        const displayClientCode = schedule.clientCode && !isValidUuid(schedule.clientCode)
                          ? schedule.clientCode
                          : !isValidUuid(schedule.clientId)
                          ? schedule.clientId
                          : undefined;
                        return (
                          <tr
                            key={schedule.id}
                            onClick={() => setSelectedSchedule(schedule)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <strong
                                  title={schedule.clientName}
                                  style={{
                                    color: 'var(--ink-strong)',
                                    fontSize: 13,
                                    lineHeight: 1.25,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: 220,
                                  }}
                                >
                                  {schedule.clientName}
                                </strong>
                                {displayClientCode ? (
                                  <span className="client-id-chip" style={{ width: 'fit-content' }}>
                                    {displayClientCode}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <strong
                                  title={schedule.title}
                                  style={{
                                    color: 'var(--ink-strong)',
                                    fontSize: 13,
                                    lineHeight: 1.25,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    maxWidth: 260,
                                  }}
                                >
                                  {schedule.title}
                                </strong>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span className={`category-tag cat-${schedule.category.toLowerCase().replace(/[^a-z]/g, '')}`}>
                                    {schedule.category}
                                  </span>
                                  <span style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1 }}>
                                    {schedule.cadence}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="user-avatar" style={{ width: 22, height: 22, fontSize: 12 }}>
                                  {schedule.defaultOwner.substring(0, 2).toUpperCase()}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-strong)', lineHeight: 1.2 }}>
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
                              <CadenceTracker item={schedule} />
                            </td>
                            <td>
                              <button
                                className="soft-button"
                                type="button"
                                style={{ fontSize: 12, padding: '0 10px', height: 26, minHeight: 26, lineHeight: '24px' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSchedule(schedule);
                                }}
                              >
                                View Checklist ({schedule.bankRecStatus === 'Not applicable' ? schedule.checklistTemplate.filter(s => !s.toLowerCase().includes('bank') && !s.toLowerCase().includes('reconciliation')).length : schedule.checklistTemplate.length})
                              </button>
                            </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
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
  const displayClientCode = schedule.clientCode && !isValidUuid(schedule.clientCode)
    ? schedule.clientCode
    : !isValidUuid(schedule.clientId)
    ? schedule.clientId
    : undefined;

  const displayScheduleCode = schedule.code && !isValidUuid(schedule.code)
    ? schedule.code
    : !isValidUuid(schedule.id)
    ? schedule.id
    : undefined;

  const [tab, setTab] = useState<'checklist' | 'overview' | 'history'>('checklist');
  const [isActive, setIsActive] = useState(schedule.status === 'Active');
  const [nextRunDate, setNextRunDate] = useState(() => {
    return schedule.nextRunDate || '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentPersonName = role ? ROLE_PEOPLE[role]?.name : '';
  const isAssignedCustodian = Boolean(
    currentPersonName &&
    (schedule.defaultOwner.toLowerCase().includes(currentPersonName.toLowerCase()) ||
     currentPersonName.toLowerCase().includes(schedule.defaultOwner.toLowerCase()))
  );

  function handleSave() {
    if (!isAssignedCustodian) return;
    const updated: RecurringScheduleRecord = {
      ...schedule,
      bankRecStatus: schedule.bankRecStatus,
      currentStatus: schedule.currentStatus,
    };
    onUpdateSchedule(updated);
    onClose();
  }

  const hasBank = schedule.bankRecStatus !== 'Not applicable';

  const workflowChecklist = useMemo(() => {
    if (hasBank) return schedule.checklistTemplate;
    return schedule.checklistTemplate.filter(
      (step) => !step.toLowerCase().includes('bank') && !step.toLowerCase().includes('reconciliation')
    );
  }, [schedule.checklistTemplate, hasBank]);

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

  async function handleSaveLeadership() {
    if (!leadership || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const updated: RecurringScheduleRecord = {
        ...schedule,
        status: isActive ? 'Active' : 'Paused',
        nextRunDate: nextRunDate || schedule.nextRunDate,
      };
      await onUpdateSchedule(updated);
      onToast(`Schedule settings saved (${isActive ? 'Active' : 'Paused'})`);
      onClose();
    } catch {
      onToast('Failed to update schedule settings.');
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
        aria-label={`Recurring schedule details for ${schedule.title}`}
      >
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{schedule.category.substring(0, 2).toUpperCase()}</span>
            <div>
              <h2>{schedule.title}</h2>
              <p>{schedule.clientName} · {schedule.cadence} Cycle</p>
            </div>
          </div>
          <button className="drawer-close-btn" type="button" onClick={onClose} disabled={isSubmitting} aria-label="Close drawer">
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
            Overview &amp; Settings
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
                    marginBottom: 12,
                  }}
                >
                  <Lock size={14} color="var(--ink-muted)" />
                  <span>
                    Checklist steps, bank reconciliation, and filing progress can only be updated by the assigned custodian ({schedule.defaultOwner}).
                  </span>
                </div>
              ) : null}
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 10px' }}>
                {!hasBank
                  ? 'Banking excluded: Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are excluded from this return workflow.'
                  : 'Statutory workflow checklist template executed on each occurrence:'}
              </p>
              <div className="schedule-checklist-list">
                {workflowChecklist.map((step, idx) => (
                  <div key={idx} className="schedule-checklist-item">
                    <span className="schedule-checklist-bullet" aria-hidden="true" />
                    <span className="schedule-checklist-text">{step}</span>
                  </div>
                ))}
              </div>

              {!hasBank ? (
                <div style={{ marginTop: 16, background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                    <Building2 size={13} color="var(--ink-muted)" />
                    <span>Banking Excluded from Workflow</span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                    Client operates without bank accounts. Bank statement collection and reconciliation are not required or tracked.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'overview' ? (
            <>
              {schedule.exceptionReason ? (
                <div className="drawer-card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)', marginBottom: 12 }}>
                  <h4 style={{ color: 'var(--danger)' }}>Compliance Exception</h4>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                    {schedule.exceptionReason}
                  </p>
                </div>
              ) : null}

              {leadership ? (
                <div className="drawer-card" style={{ padding: 14, marginBottom: 14 }}>
                  <h4 style={{ marginBottom: 10 }}>Schedule Management</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Generation Status</span>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                          {isActive ? 'Active — generates assignments on schedule' : 'Paused — automatic generation suspended'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={isActive ? 'soft-button' : 'primary-button'}
                        onClick={() => setIsActive(!isActive)}
                        style={{ fontSize: 12, padding: '5px 12px' }}
                      >
                        {isActive ? 'Pause Schedule' : 'Activate Schedule'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                        Next Automated Run Date
                      </label>
                      <input
                        type="text"
                        value={nextRunDate}
                        onChange={(e) => setNextRunDate(e.target.value)}
                        placeholder="DD/MM/YYYY or YYYY-MM-DD"
                        style={{
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-control)',
                          border: '1px solid var(--border)',
                          fontSize: 13,
                          background: 'var(--surface)',
                          color: 'var(--ink)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Schedule ID</span>
                  <span className="drawer-val">{displayScheduleCode ?? '—'}</span>
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
                  <span className="drawer-label">Statutory Due Window</span>
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
                  <span className="drawer-val">{schedule.clientName}{displayClientCode ? ` (${displayClientCode})` : ''}</span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'history' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 4px' }}>
                Past assignments generated from this recurring compliance schedule:
              </p>
              {schedule.history.map((h) => {
                const histAsgRef = !isValidUuid(h.assignmentId) ? `Assignment Ref: ${h.assignmentId}` : undefined;
                return (
                  <div key={h.period} className="history-card-row">
                    <div>
                      <strong>{h.period}</strong>
                      <small>
                        {histAsgRef
                          ? `${histAsgRef}${h.completedOn ? ` · Completed on ${h.completedOn}` : ''}`
                          : h.completedOn
                          ? `Completed on ${h.completedOn}`
                          : 'Compliance Period Filing'}
                      </small>
                    </div>
                    <Status tone={h.status === 'Completed' ? 'success' : h.status === 'In progress' ? 'default' : 'warning'}>
                      {h.status}
                    </Status>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="drawer-footer">
          {leadership ? (
            <button
              className="primary-button"
              type="button"
              onClick={handleSaveLeadership}
              disabled={isSubmitting}
            >
              <CheckCircle2 size={14} /> {isSubmitting ? 'Saving...' : 'Save Schedule Settings'}
            </button>
          ) : null}
          {!isAssignedCustodian ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', background: 'var(--surface-muted)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <Lock size={13} />
              <span>Workflow &amp; filing progress locked to assigned custodian ({schedule.defaultOwner})</span>
            </div>
          ) : null}
          <button className="soft-button" type="button" onClick={onClose} disabled={isSubmitting}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
