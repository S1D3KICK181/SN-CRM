import {
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type { ReportingLineDto } from '@sn/contracts';
import { ROLE_LABELS } from '../../data';
import { useTeamDirectory } from '../../api/use-team-directory';
import type { TeamDirectoryPort } from '../../api/team-directory-types';
import { Card } from '../../ui/workspace-primitives';

export interface TeamWorkspaceProps {
  readonly role: CompanyRole;
  readonly port?: TeamDirectoryPort;
  readonly onToast?: (message: string) => void;
}

/**
 * Derives a 2-character uppercase monogram from an employee name.
 * Handles both Western and Indian conventions (e.g. "S. Narayanan" -> "SN").
 */
export function getEmployeeInitials(name: string): string {
  const parts = name.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '??';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  const firstChar = first.charAt(0);
  const lastChar = last.charAt(0);
  return (firstChar + lastChar).toUpperCase();
}

interface ManagerGroup {
  readonly managerLine: ReportingLineDto;
  readonly reports: ReportingLineDto[];
}

interface EmployeeNodeProps {
  readonly line: ReportingLineDto;
  readonly isRoot?: boolean;
}

function EmployeeNode({ line, isRoot = false }: EmployeeNodeProps) {
  const { employee, manager } = line;
  const initials = getEmployeeInitials(employee.name);
  const roleLabel = ROLE_LABELS[employee.role] ?? employee.role;
  const subtitle = isRoot
    ? roleLabel
    : `${roleLabel}${manager ? ` · reports to ${manager.name}` : ''}`;

  return (
    <div
      className={isRoot ? 'org-founder org-node' : 'org-node'}
      data-testid={`employee-${employee.id}`}
    >
      <span>{initials}</span>
      <strong>{employee.name}</strong>
      <small>{subtitle}</small>
    </div>
  );
}

const ROLE_SENIORITY_ORDER: Record<CompanyRole, number> = {
  founder: 0,
  manager: 1,
  senior_staff: 2,
  staff: 3,
  trainee: 4,
};

function sortReportingLines(a: ReportingLineDto, b: ReportingLineDto): number {
  const rankDiff =
    (ROLE_SENIORITY_ORDER[a.employee.role] ?? 99) -
    (ROLE_SENIORITY_ORDER[b.employee.role] ?? 99);
  if (rankDiff !== 0) return rankDiff;
  const nameDiff = a.employee.name.localeCompare(b.employee.name);
  if (nameDiff !== 0) return nameDiff;
  return a.employee.id.localeCompare(b.employee.id);
}

export function TeamWorkspace({ role, port, onToast }: TeamWorkspaceProps) {
  const {
    lines,
    loading,
    error,
    hasLiveSnapshot,
    refresh,
  } = useTeamDirectory(role, { port, onToast });

  const isInitialLoading = loading && !hasLiveSnapshot;
  const isInitialError = error !== null && !hasLiveSnapshot;
  const isRefreshError = error !== null && hasLiveSnapshot;
  const isEmpty = hasLiveSnapshot && lines.length === 0;

  // 1. Deduplicate by employee.id
  const uniqueLinesMap = new Map<string, ReportingLineDto>();
  for (const line of lines) {
    if (!uniqueLinesMap.has(line.employee.id)) {
      uniqueLinesMap.set(line.employee.id, line);
    }
  }
  const uniqueLines = Array.from(uniqueLinesMap.values());

  // 2. Identify Founder root and candidate Managers
  const founderLine = uniqueLines.find((l) => l.employee.role === 'founder') ?? null;
  const founderId = founderLine?.employee.id ?? null;

  const rawManagerLines = uniqueLines.filter((l) => l.employee.role === 'manager');
  const sortedManagerLines = [...rawManagerLines].sort((a, b) => {
    const nameDiff = a.employee.name.localeCompare(b.employee.name);
    if (nameDiff !== 0) return nameDiff;
    return a.employee.id.localeCompare(b.employee.id);
  });

  const managerIdSet = new Set<string>(sortedManagerLines.map((m) => m.employee.id));

  const isKnownSupervisor = (id: string | null | undefined): boolean => {
    if (!id) return false;
    return id === founderId || managerIdSet.has(id);
  };

  // 3. Resolve authoritative supervisor:
  // employee.reportsToId is authoritative when pointing to a known Founder/Manager;
  // line.manager.id is only a safe fallback when reportsToId is absent or unresolvable.
  const resolveSupervisorId = (line: ReportingLineDto): string | null => {
    if (line.employee.reportsToId && isKnownSupervisor(line.employee.reportsToId)) {
      return line.employee.reportsToId;
    }
    if (line.manager?.id && isKnownSupervisor(line.manager.id)) {
      return line.manager.id;
    }
    return null;
  };

  // 4. Place each employee into exactly one branch
  const managerReportsMap = new Map<string, ReportingLineDto[]>();
  for (const m of sortedManagerLines) {
    managerReportsMap.set(m.employee.id, []);
  }

  const founderDirectNonManagers: ReportingLineDto[] = [];
  const orphanLines: ReportingLineDto[] = [];

  for (const line of uniqueLines) {
    if (founderLine && line.employee.id === founderLine.employee.id) {
      continue;
    }

    if (managerIdSet.has(line.employee.id)) {
      continue;
    }

    const supId = resolveSupervisorId(line);
    if (supId && managerReportsMap.has(supId)) {
      managerReportsMap.get(supId)!.push(line);
    } else if (supId && supId === founderId) {
      founderDirectNonManagers.push(line);
    } else {
      orphanLines.push(line);
    }
  }

  // 5. Deterministically sort each group
  const managerGroups: ManagerGroup[] = sortedManagerLines.map((mLine) => {
    const rawReports = managerReportsMap.get(mLine.employee.id) ?? [];
    const reports = [...rawReports].sort(sortReportingLines);
    return {
      managerLine: mLine,
      reports,
    };
  });

  founderDirectNonManagers.sort(sortReportingLines);
  orphanLines.sort(sortReportingLines);

  return (
    <div className="dashboard-grid team-layout">
      <Card
        title="Reporting structure"
        description="Every non-Founder reports to Founder or Manager"
        action={
          <div className="team-header-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => void refresh()}
              title="Refresh team directory"
              aria-label="Refresh team directory"
              disabled={loading}
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
            <UsersRound aria-hidden="true" />
          </div>
        }
      >
        {isInitialLoading ? (
          <div
            className="org-tree team-tree-loading"
            aria-busy="true"
            aria-label="Loading reporting structure"
            data-testid="team-loading-state"
          >
            <div className="team-skeleton-founder">
              <span className="skeleton-pulse team-skeleton-avatar" />
              <span className="skeleton-pulse team-skeleton-line" />
            </div>
            <div className="team-skeleton-branches">
              <div className="team-skeleton-branch-item">
                <span className="skeleton-pulse team-skeleton-avatar" />
                <span className="skeleton-pulse team-skeleton-line" />
              </div>
              <div className="team-skeleton-branch-item">
                <span className="skeleton-pulse team-skeleton-avatar" />
                <span className="skeleton-pulse team-skeleton-line" />
              </div>
            </div>
          </div>
        ) : isInitialError ? (
          <div
            className="org-tree team-tree-error"
            role="alert"
            data-testid="team-error-state"
          >
            <AlertTriangle size={24} aria-hidden="true" className="team-error-icon" />
            <p className="team-error-message">{error.message}</p>
            <button
              type="button"
              className="soft-button"
              onClick={() => void refresh()}
              data-testid="team-retry-button"
            >
              Retry
            </button>
          </div>
        ) : isEmpty ? (
          <div
            className="org-tree team-tree-empty"
            data-testid="team-empty-state"
          >
            <p>No reporting lines recorded in the employee directory.</p>
            <button
              type="button"
              className="soft-button"
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
        ) : (
          <div
            className="org-tree"
            role="region"
            aria-label="Reporting hierarchy"
            data-testid="team-tree-content"
          >
            {isRefreshError ? (
              <div
                className="team-refresh-warning"
                role="alert"
                data-testid="team-refresh-warning"
              >
                <span>{error.message}</span>
                <button
                  type="button"
                  className="inline-retry-btn"
                  onClick={() => void refresh()}
                >
                  Retry
                </button>
              </div>
            ) : null}

            {founderLine ? (
              <EmployeeNode line={founderLine} isRoot />
            ) : null}

            <ul
              role="list"
              className="org-branches org-branch"
              aria-label="Reporting branches"
              data-testid="org-branches"
            >
              {managerGroups.map(({ managerLine: mLine, reports }) => (
                <li
                  key={mLine.employee.id}
                  className="org-manager-group"
                  data-testid={`manager-branch-${mLine.employee.id}`}
                >
                  <EmployeeNode line={mLine} />
                  {reports.length > 0 ? (
                    <ul
                      role="list"
                      className="org-subbranch"
                      aria-label={`Direct reports to ${mLine.employee.name}`}
                      data-testid={`manager-reports-${mLine.employee.id}`}
                    >
                      {reports.map((rLine) => (
                        <li key={rLine.employee.id} className="org-subbranch-item">
                          <EmployeeNode line={rLine} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}

              {founderDirectNonManagers.length > 0 ? (
                <li
                  className="org-manager-group org-founder-direct-group"
                  data-testid="founder-direct-branch"
                >
                  <div className="org-group-header">Direct to Founder</div>
                  <ul
                    role="list"
                    className="org-subbranch"
                    aria-label="Direct reports to Founder"
                    data-testid="founder-direct-reports"
                  >
                    {founderDirectNonManagers.map((rLine) => (
                      <li key={rLine.employee.id} className="org-subbranch-item">
                        <EmployeeNode line={rLine} />
                      </li>
                    ))}
                  </ul>
                </li>
              ) : null}

              {orphanLines.length > 0 ? (
                <li
                  className="org-manager-group org-orphan-group"
                  data-testid="orphan-branch"
                >
                  <div className="org-group-header">Unassigned Reporting Lines</div>
                  <ul
                    role="list"
                    className="org-subbranch"
                    aria-label="Unassigned reporting lines"
                    data-testid="orphan-reports"
                  >
                    {orphanLines.map((rLine) => (
                      <li key={rLine.employee.id} className="org-subbranch-item">
                        <EmployeeNode line={rLine} />
                      </li>
                    ))}
                  </ul>
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </Card>

      <Card
        title="Authority guardrails"
        description={`Visible while previewing as ${ROLE_LABELS[role]}`}
        action={<ShieldCheck aria-hidden="true" />}
      >
        <div className="authority-list">
          <span>
            <CheckCircle2 aria-hidden="true" />
            Founder and Manager create Assignments
          </span>
          <span>
            <CheckCircle2 aria-hidden="true" />
            Senior Staff delegate to Staff or Trainee
          </span>
          <span>
            <CheckCircle2 aria-hidden="true" />
            Staff delegate only to Trainee
          </span>
          <span>
            <CheckCircle2 aria-hidden="true" />
            Every role creates Personal Tasks for self
          </span>
          <span>
            <CheckCircle2 aria-hidden="true" />
            Manager operates Office Accounts
          </span>
        </div>
      </Card>
    </div>
  );
}
