import { useRef, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import type { DepartmentDto } from '@sn/contracts';
import type { UseDepartmentsResult } from '../../api/use-departments';
import { departmentSaveErrorMessage, sanitizeDepartmentsError } from '../../api/departments-types';
import { Card } from '../../ui/workspace-primitives';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';
import {
  DepartmentDialog,
  DepartmentMembersDialog,
  type DepartmentEmployeeOption,
  type DepartmentFormInput,
  type DepartmentMembersInput,
} from './department-dialog';

export type DepartmentActions = Pick<
  UseDepartmentsResult,
  'createDepartment' | 'updateDepartment' | 'setDepartmentMembers'
>;

export interface DepartmentsSectionProps {
  departments: readonly DepartmentDto[];
  actions: DepartmentActions;
  /** The active employees offered in the members dialog. */
  employees: readonly DepartmentEmployeeOption[];
  loading: boolean;
  /** True once the list has loaded at least once, so a later failure keeps showing it. */
  hasLiveSnapshot: boolean;
  error: string | null;
  onRetry: () => void;
  /** Called after any department change so the service list shows the new names. */
  onDepartmentsChanged: () => void;
}

type DialogState = { kind: 'add' } | { kind: 'edit'; department: DepartmentDto } | { kind: 'members'; department: DepartmentDto };

function isStaleDepartmentError(err: unknown): boolean {
  return sanitizeDepartmentsError(err).serverCode === 'stale_department';
}

export function DepartmentsSection({
  departments,
  actions,
  employees,
  loading,
  hasLiveSnapshot,
  error,
  onRetry,
  onDepartmentsChanged,
  onToast,
}: DepartmentsSectionProps & { onToast: (message: string) => void }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const toggling = useRef<{ departmentId: string; attempt: SaveAttempt } | null>(null);

  const openDialog = (next: DialogState, from?: HTMLElement) => {
    setActionError(null);
    setOpener(from ?? null);
    setDialog(next);
  };
  const closeDialog = () => setDialog(null);

  const changed = (message: string) => {
    onDepartmentsChanged();
    onToast(message);
  };

  // A stale change means the list on screen is out of date, so load it again for the next try.
  const reloadIfStale = (err: unknown) => {
    if (isStaleDepartmentError(err)) onRetry();
  };

  const saveDepartment = async (input: DepartmentFormInput, key: string) => {
    try {
      if (dialog?.kind === 'edit') {
        const updated = await actions.updateDepartment(
          dialog.department.id,
          { ...input, expectedUpdatedAt: dialog.department.updatedAt },
          key,
        );
        changed(`Department ${updated.name} updated.`);
      } else {
        const created = await actions.createDepartment(input, key);
        changed(`Department ${created.name} added.`);
      }
    } catch (err: unknown) {
      reloadIfStale(err);
      throw err;
    }
  };

  const saveMembers = async (input: DepartmentMembersInput, key: string) => {
    if (dialog?.kind !== 'members') return;
    try {
      const updated = await actions.setDepartmentMembers(dialog.department.id, input, key);
      changed(`Members of ${updated.name} updated.`);
    } catch (err: unknown) {
      reloadIfStale(err);
      throw err;
    }
  };

  const setActive = async (department: DepartmentDto, isActive: boolean) => {
    if (busyId !== null) return;
    const input = { isActive, expectedUpdatedAt: department.updatedAt };
    const previous = toggling.current?.departmentId === department.id ? toggling.current.attempt : null;
    const attempt = nextSaveAttempt(previous, input);
    toggling.current = { departmentId: department.id, attempt };
    setActionError(null);
    setBusyId(department.id);
    try {
      const updated = await actions.updateDepartment(department.id, input, attempt.key);
      toggling.current = null;
      changed(`Department ${updated.name} ${isActive ? 'reactivated' : 'deactivated'}.`);
    } catch (err: unknown) {
      reloadIfStale(err);
      setActionError(departmentSaveErrorMessage(err, department.name));
    } finally {
      setBusyId(null);
    }
  };

  const initialLoading = loading && !hasLiveSnapshot && !error;
  const initialError = Boolean(error) && !hasLiveSnapshot;
  const stale = Boolean(error) && hasLiveSnapshot;

  return (
    <div style={{ marginTop: 18 }}>
      {stale ? (
        <div className="workspace-warning-banner" role="status" style={{ marginBottom: 14 }}>
          <span className="workspace-warning-message">
            <AlertTriangle size={15} /> Refresh failed. Showing last loaded data.
          </span>
          <button className="soft-button" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="workspace-warning-banner" role="alert" style={{ marginBottom: 14 }}>
          <span className="workspace-warning-message">
            <AlertTriangle size={15} /> {actionError}
          </span>
        </div>
      ) : null}

      <Card
        title="Departments"
        description="The departments of the firm. A service belongs to at most one, and a head sees their department's work."
        action={
          <button
            className="primary-button"
            type="button"
            style={{ fontSize: 12, padding: '7px 14px' }}
            onClick={(event) => openDialog({ kind: 'add' }, event.currentTarget)}
          >
            <Plus size={14} /> Add department
          </button>
        }
      >
        {initialLoading ? (
          <div aria-busy="true" aria-label="Loading departments">
            {[1, 2, 3, 4].map((x) => (
              <div className="skeleton-row engagement-skeleton-row" key={x}>
                <span className="skeleton-pulse" />
              </div>
            ))}
          </div>
        ) : initialError ? (
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load departments</h3>
            <p>{error}</p>
            <button className="primary-button" type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : departments.length === 0 ? (
          <div className="workspace-empty-card">
            <strong>No departments yet. Add the departments the firm works in.</strong>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Members</th>
                  <th>Services</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((department) => (
                  <tr key={department.id}>
                    <td>
                      <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{department.name}</strong>
                    </td>
                    <td>
                      {department.members.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No members</span>
                      ) : (
                        <span style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12, rowGap: 2, fontSize: 12 }}>
                          {department.members.map((member) => (
                            <span key={member.userId}>
                              <span>{member.name}</span>
                              {member.isHead ? (
                                <small style={{ marginLeft: 4, color: 'var(--ink-muted)', fontWeight: 700 }}>Head</small>
                              ) : null}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{department.serviceIds.length}</span>
                    </td>
                    <td>
                      {department.isActive ? (
                        <span className="status tone-success">Active</span>
                      ) : (
                        <span className="status" style={{ background: 'var(--canvas)', color: 'var(--ink-muted)' }}>
                          Inactive
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="soft-button"
                          type="button"
                          aria-label={`Edit ${department.name}`}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          disabled={busyId !== null}
                          onClick={(event) => openDialog({ kind: 'edit', department }, event.currentTarget)}
                        >
                          Edit
                        </button>
                        <button
                          className="soft-button"
                          type="button"
                          aria-label={`Members of ${department.name}`}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          disabled={busyId !== null}
                          onClick={(event) => openDialog({ kind: 'members', department }, event.currentTarget)}
                        >
                          Members
                        </button>
                        {department.isActive ? (
                          <button
                            className="soft-button"
                            type="button"
                            aria-label={`Deactivate ${department.name}`}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            disabled={busyId !== null}
                            onClick={() => void setActive(department, false)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="soft-button"
                            type="button"
                            aria-label={`Reactivate ${department.name}`}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            disabled={busyId !== null}
                            onClick={() => void setActive(department, true)}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DepartmentDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        department={dialog?.kind === 'edit' ? dialog.department : null}
        opener={opener}
        onClose={closeDialog}
        onSubmit={saveDepartment}
      />
      <DepartmentMembersDialog
        open={dialog?.kind === 'members'}
        department={dialog?.kind === 'members' ? dialog.department : null}
        employees={employees}
        opener={opener}
        onClose={closeDialog}
        onSubmit={saveMembers}
      />
    </div>
  );
}
