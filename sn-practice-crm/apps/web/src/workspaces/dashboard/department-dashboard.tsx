import type { DepartmentDto } from '@sn/contracts';
import type { AssignmentRow } from '../../data';
import type { PageKey } from '../../shell/navigation';
import { Card } from '../../ui/workspace-primitives';
import { AssignmentsTable } from '../assignments/assignments-table';
import { ComingUpCard, DashboardMetricStrip, OpenWorkByPersonCard } from './dashboard-cards';
import { buildDepartmentTiles, overdueAssignments } from './dashboard-metrics';
import { assignmentsOfDepartment, MY_DASHBOARD_VIEW } from './department-view';

/** The switch at the top of the dashboard; shown only to people who have department views. */
export function DashboardViewSwitch({
  departments,
  view,
  onChange,
}: {
  departments: readonly DepartmentDto[];
  view: string;
  onChange: (view: string) => void;
}) {
  const options = [{ id: MY_DASHBOARD_VIEW, label: 'My dashboard' }, ...departments.map((d) => ({ id: d.id, label: d.name }))];
  return (
    <div className="segmented" role="group" aria-label="Dashboard view" style={{ width: 'fit-content', marginBottom: 18 }}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === view ? 'is-active' : undefined}
          aria-pressed={option.id === view}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One department's work, built from the live assignments and the department's services. */
export function DepartmentDashboard({
  department,
  assignments,
  today,
  canEdit,
  onToast,
  onSelectAssignment,
  onNavigate,
}: {
  department: DepartmentDto;
  assignments: readonly AssignmentRow[];
  today: string;
  canEdit: boolean;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  if (department.serviceIds.length === 0) {
    return (
      <div className="workspace-empty-card">
        <strong>No services are linked to this department yet. Link them in Settings → Services.</strong>
      </div>
    );
  }

  const own = assignmentsOfDepartment(assignments, department);
  const overdue = overdueAssignments(own, today);
  return (
    <div className="dashboard-stack">
      <DashboardMetricStrip tiles={buildDepartmentTiles(own, today)} />
      <div className="dashboard-grid operations-top">
        <ComingUpCard assignments={own} today={today} />
        <OpenWorkByPersonCard
          assignments={own}
          members={department.members.map((member) => ({ id: member.userId, name: member.name }))}
        />
      </div>
      {overdue.length > 0 ? (
        <AssignmentsTable
          title="Overdue assignments"
          rows={overdue}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
          canEdit={canEdit}
        />
      ) : (
        <Card title="Overdue assignments" description="Open work past its due date" className="compact-card">
          <p className="dashboard-empty">No overdue assignments.</p>
        </Card>
      )}
    </div>
  );
}
