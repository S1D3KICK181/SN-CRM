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
import { AssignmentOperationError } from '../../api/types';

type DialogMode = 'assignment' | 'personal' | 'delegated' | 'client' | 'schedule' | null;

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
  const [serviceFilter, setServiceFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Paused' | 'Open Work'>('All');
  const [search, setSearch] = useState('');
  const [selectedSchedule, setSelectedSchedule] = useState<RecurringScheduleRecord | null>(null);

  const availableServices = useMemo(() => {
    const set = new Set<string>();
    for (const s of schedules) {
      const srv = s.service || s.category;
      if (srv && typeof srv === 'string') {
        set.add(srv);
      }
    }
    return ['All', ...Array.from(set).sort()];
  }, [schedules]);

  const person = ROLE_PEOPLE[role];
  const leadership = role === 'founder' || role === 'manager';
  const myAssignedStaffName = person.name;

  const isNonTerminalAssignment = (a: AssignmentRow) => {
    const s = (a.status || '').toLowerCase().trim();
    return s !== 'approved' && s !== 'completed' && s !== 'closed' && s !== 'cancelled';
  };

  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      // 1. Staff filtering: staff only see their assigned clients unless leadership
      if (!leadership) {
        if (s.defaultOwner !== myAssignedStaffName) return false;
      } else if (staffFilter !== 'All') {
        if (s.defaultOwner !== staffFilter) return false;
      }

      // 2. Service filtering
      if (serviceFilter !== 'All') {
        const srv = s.service || s.category;
        if (srv !== serviceFilter) return false;
      }

      // 3. Status filtering
      if (statusFilter === 'Active') {
        if (s.status !== 'Active') return false;
      } else if (statusFilter === 'Paused') {
        if (s.status !== 'Paused') return false;
      } else if (statusFilter === 'Open Work') {
        const linked = assignments.filter((a) => a.recurringScheduleId === s.id);
        if (!linked.some(isNonTerminalAssignment)) return false;
      }

      // 4. Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          s.title.toLowerCase().includes(q) ||
          s.clientName.toLowerCase().includes(q) ||
          s.defaultOwner.toLowerCase().includes(q) ||
          (s.statutoryDueDay && s.statutoryDueDay.toLowerCase().includes(q)) ||
          ((s.service || s.category || '').toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [schedules, assignments, leadership, myAssignedStaffName, staffFilter, serviceFilter, statusFilter, search]);

  const scopedSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (!leadership) {
        if (s.defaultOwner !== myAssignedStaffName) return false;
      } else if (staffFilter !== 'All') {
        if (s.defaultOwner !== staffFilter) return false;
      }
      if (serviceFilter !== 'All') {
        const srv = s.service || s.category;
        if (srv !== serviceFilter) return false;
      }
      return true;
    });
  }, [schedules, leadership, myAssignedStaffName, staffFilter, serviceFilter]);

  const tally = useMemo(() => {
    let all = 0;
    let active = 0;
    let paused = 0;
    let openWork = 0;

    for (const s of scopedSchedules) {
      all += 1;
      if (s.status === 'Active') {
        active += 1;
      } else if (s.status === 'Paused') {
        paused += 1;
      }
      const linked = assignments.filter((a) => a.recurringScheduleId === s.id);
      if (linked.some(isNonTerminalAssignment)) {
        openWork += 1;
      }
    }
    return { all, active, paused, openWork };
  }, [scopedSchedules, assignments]);

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
              { key: 'Active', label: 'Active', count: tally.active },
              { key: 'Paused', label: 'Paused', count: tally.paused },
              { key: 'Open Work', label: 'Open Work', count: tally.openWork },
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

            <div className="cadence-tabs" aria-label="Filter by Service">
              {availableServices.map((srv) => (
                <button
                  key={srv}
                  className={`cadence-pill ${serviceFilter === srv ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setServiceFilter(srv)}
                >
                  {srv === 'Bookkeeping' ? 'Books & Accounts' : srv}
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
            description="Standing compliance schedules assigned to staff · Generated per statutory cadence cycle"
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
                        const linked = assignments.filter((a) => a.recurringScheduleId === schedule.id);
                        const latestAssignment = linked[0];
                        const displayLatestCode = latestAssignment?.code && !isValidUuid(latestAssignment.code)
                          ? latestAssignment.code
                          : latestAssignment && !isValidUuid(latestAssignment.id)
                          ? latestAssignment.id
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
                                  <span className={`category-tag cat-${(schedule.service || schedule.category).toLowerCase().replace(/[^a-z]/g, '')}`}>
                                    {schedule.service || schedule.category}
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
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <CadenceTracker item={schedule} linkedAssignment={latestAssignment} />
                                <span style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.2 }}>
                                  {latestAssignment
                                    ? displayLatestCode
                                      ? `${displayLatestCode}: ${latestAssignment.status}`
                                      : latestAssignment.status
                                    : 'No generated assignment yet'}
                                </span>
                              </div>
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
                                View Schedule
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
          assignments={assignments}
          onClose={() => setSelectedSchedule(null)}
          onToast={onToast}
          onUpdateSchedule={onUpdateSchedule}
          onSelectLinkedAssignment={onSelectAssignment}
        />
      ) : null}
    </div>
  );
}

function ScheduleDetailDrawer({
  schedule,
  leadership,
  role,
  assignments = [],
  onClose,
  onToast,
  onUpdateSchedule,
  onSelectLinkedAssignment,
}: {
  schedule: RecurringScheduleRecord;
  leadership: boolean;
  role?: CompanyRole;
  assignments?: AssignmentRow[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
  onSelectLinkedAssignment?: (a: AssignmentRow) => void;
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

  const [tab, setTab] = useState<'overview' | 'assignments'>('overview');
  const [isActive, setIsActive] = useState(schedule.status === 'Active');
  const [nextRunDate, setNextRunDate] = useState(() => {
    return schedule.nextRunDate || '';
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const linkedAssignments = useMemo(() => {
    return assignments.filter((a) => a.recurringScheduleId === schedule.id);
  }, [assignments, schedule.id]);

  const latestLinkedAssignment = linkedAssignments[0];

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
    } catch (err: unknown) {
      // The server refused the change, so show the schedule's real state again.
      setIsActive(schedule.status === 'Active');
      onToast(
        err instanceof AssignmentOperationError && err.serverCode === 'engagement_not_active'
          ? "This schedule's engagement has ended, so the schedule cannot be restarted."
          : err instanceof Error
            ? err.message
            : 'Failed to update schedule settings.',
      );
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
            <span className="drawer-monogram">{(schedule.service || schedule.category || 'SC').substring(0, 2).toUpperCase()}</span>
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
            className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('overview')}
          >
            Overview &amp; Settings
          </button>
          <button
            className={`drawer-tab ${tab === 'assignments' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('assignments')}
          >
            Linked Assignments ({linkedAssignments.length})
          </button>
        </nav>

        <div className="drawer-content">
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
                  <span className="drawer-label">Service</span>
                  <span className="drawer-val">{schedule.service || schedule.category}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Engagement</span>
                  <span className="drawer-val">{schedule.engagementCode ?? 'Not linked'}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Cadence</span>
                  <span className="drawer-val">{schedule.cadence}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Statutory Due Window</span>
                  <span className="drawer-val">{schedule.statutoryDueDay || 'Standard cycle'}</span>
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
                <div className="drawer-item">
                  <span className="drawer-label">Latest Assignment</span>
                  <span className="drawer-val">
                    {latestLinkedAssignment
                      ? `${latestLinkedAssignment.title} (${latestLinkedAssignment.status})`
                      : 'No generated assignment yet'}
                  </span>
                </div>
                <div className="drawer-item full-width">
                  <span className="drawer-label">Client Legal Entity</span>
                  <span className="drawer-val">{schedule.clientName}{displayClientCode ? ` (${displayClientCode})` : ''}</span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'assignments' ? (
            <div>
              {linkedAssignments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--ink-muted)' }}>
                  <CalendarClock size={28} style={{ opacity: 0.6, margin: '0 auto 8px', display: 'block' }} />
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    No generated assignment yet
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                    Assignments are automatically generated on each compliance cycle.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 4px' }}>
                    Practice assignments materialized from this recurring compliance schedule:
                  </p>
                  {linkedAssignments.map((asg) => {
                    const displayAsgCode = asg.code && !isValidUuid(asg.code)
                      ? asg.code
                      : !isValidUuid(asg.id)
                      ? asg.id
                      : undefined;
                    return (
                      <div
                        key={asg.id}
                        className="history-card-row"
                        onClick={() => {
                          if (onSelectLinkedAssignment) {
                            onClose();
                            onSelectLinkedAssignment(asg);
                          }
                        }}
                        style={{ cursor: onSelectLinkedAssignment ? 'pointer' : 'default' }}
                      >
                        <div>
                          <strong>{asg.title}</strong>
                          <small>
                            {[displayAsgCode, asg.due ? `Due ${asg.due}` : undefined, asg.owner ? `Owner: ${asg.owner}` : undefined]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </div>
                        <Status tone={asg.tone}>{asg.status}</Status>
                      </div>
                    );
                  })}
                </div>
              )}
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
          <button className="soft-button" type="button" onClick={onClose} disabled={isSubmitting}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
