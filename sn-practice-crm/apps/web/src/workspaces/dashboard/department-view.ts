import type { CompanyRole } from '@sn/domain';
import type { DepartmentDto } from '@sn/contracts';
import type { AssignmentRow } from '../../data';

/** The id of the personal dashboard in the view switch; department views use the department id. */
export const MY_DASHBOARD_VIEW = 'my-dashboard';

/**
 * The departments whose dashboard a person may open: the Founder and Manager see every active
 * department, a head sees the active departments they head, and everyone else has none.
 */
export function departmentViewOptions(
  role: CompanyRole,
  actorId: string,
  departments: readonly DepartmentDto[],
): DepartmentDto[] {
  const active = departments.filter((department) => department.isActive);
  if (role === 'founder' || role === 'manager') return active;
  if (role === 'trainee') return [];
  return active.filter((department) => department.members.some((m) => m.userId === actorId && m.isHead));
}

/** A department's assignments: those filed under one of its services. */
export function assignmentsOfDepartment(
  assignments: readonly AssignmentRow[],
  department: DepartmentDto,
): AssignmentRow[] {
  const serviceIds = new Set(department.serviceIds);
  return assignments.filter((assignment) => assignment.serviceId !== undefined && serviceIds.has(assignment.serviceId));
}

/** The view to show: the chosen one when the person still may open it, otherwise their own dashboard. */
export function resolveDashboardView(chosen: string | null, options: readonly DepartmentDto[]): string {
  return chosen !== null && options.some((department) => department.id === chosen) ? chosen : MY_DASHBOARD_VIEW;
}

const STORAGE_PREFIX = 'sn-crm-dashboard-view:';

/** The last view this person chose, or null when none is saved or the browser blocks storage. */
export function readStoredDashboardView(actorId: string): string | null {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${actorId}`);
  } catch {
    return null;
  }
}

/** Remembers the chosen view; a browser that blocks storage simply forgets it. */
export function storeDashboardView(actorId: string, view: string): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${actorId}`, view);
  } catch {
    // Storage is a convenience only.
  }
}
