import type { AssignmentRow } from '../data';

/**
 * Synchronizes the selected assignment in the drawer against the active role's assignments list.
 *
 * Rules:
 * - If no assignment is selected, returns null.
 * - If the currently selected assignment is still present in activeAssignments, returns the live matching row.
 * - If the selected assignment is absent (e.g. after a role switch), returns null to clear/close the drawer.
 */
export function syncDrawerAssignment(
  selected: AssignmentRow | null,
  activeAssignments: AssignmentRow[],
): AssignmentRow | null {
  if (!selected) {
    return null;
  }
  const match = activeAssignments.find((a) => a.id === selected.id);
  return match ?? null;
}

/**
 * Determines the next state for selectedAssignmentForDrawer following an asynchronous save.
 *
 * Rules:
 * - A failed transition (saved is undefined) must NEVER replace drawer state with uncommitted/rejected state.
 * - Only replace selected drawer state on successful server save, and ONLY if it is still the same selected assignment.
 * - If the drawer was closed while save was in-flight (current is null), do not reopen it.
 * - If the drawer moved to another assignment (current.id !== targetId), do not mutate the new assignment.
 */
export function resolveDrawerSave(
  current: AssignmentRow | null,
  saved: AssignmentRow | undefined,
  targetId: string,
): AssignmentRow | null {
  if (!saved) {
    // Failed transition: retain existing committed state, do not set uncommitted/rejected state
    return current;
  }

  // Drawer is closed or has moved to a different assignment
  if (!current || current.id !== targetId) {
    return current;
  }

  // Same selected assignment and successful server save
  return saved;
}
