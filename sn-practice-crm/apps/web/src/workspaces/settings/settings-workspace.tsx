import { useRef, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import type { ServiceDto } from '@sn/contracts';
import type { UseServiceCatalogResult } from '../../api/use-service-catalog';
import { sanitizeServiceCatalogError, serviceSaveErrorMessage } from '../../api/service-catalog-types';
import { Card } from '../../ui/workspace-primitives';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';
import { DeactivateServiceDialog, ServiceDialog, type ServiceFormInput } from './service-dialog';

export type ServiceCatalogActions = Pick<UseServiceCatalogResult, 'createService' | 'updateService'>;

export interface SettingsWorkspaceProps {
  services: readonly ServiceDto[];
  actions: ServiceCatalogActions;
  loading: boolean;
  /** True once the list has loaded at least once, so a later failure keeps showing it. */
  hasLiveSnapshot: boolean;
  error: string | null;
  onRetry: () => void;
  onToast: (message: string) => void;
  /** Called after any service change so the assignment and schedule pickers load the new list. */
  onServicesChanged: () => void;
}

type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; service: ServiceDto }
  | { kind: 'deactivate'; service: ServiceDto };

function turnaroundLabel(days: number | null): string {
  if (days === null) return 'Not set';
  return days === 1 ? '1 day' : `${days} days`;
}

function inUseLabel(service: ServiceDto): string {
  const { assignments, recurringSchedules, engagements } = service.usage;
  if (assignments === 0 && recurringSchedules === 0 && engagements === 0) return 'Not used yet';
  const assignmentText = `${assignments} ${assignments === 1 ? 'assignment' : 'assignments'}`;
  const scheduleText = `${recurringSchedules} ${recurringSchedules === 1 ? 'schedule' : 'schedules'}`;
  // Engagements are listed only when there are some, so the common case stays short.
  const engagementText = engagements > 0 ? ` · ${engagements} ${engagements === 1 ? 'engagement' : 'engagements'}` : '';
  return `${assignmentText} · ${scheduleText}${engagementText}`;
}

function isStaleServiceError(err: unknown): boolean {
  return sanitizeServiceCatalogError(err).serverCode === 'stale_service';
}

export function SettingsWorkspace({
  services,
  actions,
  loading,
  hasLiveSnapshot,
  error,
  onRetry,
  onToast,
  onServicesChanged,
}: SettingsWorkspaceProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const reactivation = useRef<{ serviceId: string; attempt: SaveAttempt } | null>(null);

  const openDialog = (next: DialogState, from?: HTMLElement) => {
    setActionError(null);
    setOpener(from ?? null);
    setDialog(next);
  };
  const closeDialog = () => setDialog(null);

  const changed = (message: string) => {
    onServicesChanged();
    onToast(message);
  };

  // A stale change means the list on screen is out of date, so load it again for the next try.
  const reloadIfStale = (err: unknown) => {
    if (isStaleServiceError(err)) onRetry();
  };

  const saveService = async (input: ServiceFormInput, key: string) => {
    try {
      if (dialog?.kind === 'edit') {
        const updated = await actions.updateService(
          dialog.service.id,
          { ...input, expectedUpdatedAt: dialog.service.updatedAt },
          key,
        );
        changed(`Service ${updated.name} updated.`);
      } else {
        const created = await actions.createService(input, key);
        changed(`Service ${created.name} added.`);
      }
    } catch (err: unknown) {
      reloadIfStale(err);
      throw err;
    }
  };

  const deactivateService = async (service: ServiceDto, key: string) => {
    try {
      const updated = await actions.updateService(
        service.id,
        { isActive: false, expectedUpdatedAt: service.updatedAt },
        key,
      );
      changed(`Service ${updated.name} deactivated.`);
    } catch (err: unknown) {
      reloadIfStale(err);
      throw err;
    }
  };

  const reactivateService = async (service: ServiceDto) => {
    if (busyId !== null) return;
    const input = { isActive: true, expectedUpdatedAt: service.updatedAt };
    const previous = reactivation.current?.serviceId === service.id ? reactivation.current.attempt : null;
    const attempt = nextSaveAttempt(previous, input);
    reactivation.current = { serviceId: service.id, attempt };
    setActionError(null);
    setBusyId(service.id);
    try {
      const updated = await actions.updateService(service.id, input, attempt.key);
      reactivation.current = null;
      changed(`Service ${updated.name} reactivated.`);
    } catch (err: unknown) {
      reloadIfStale(err);
      setActionError(serviceSaveErrorMessage(err, service.name));
    } finally {
      setBusyId(null);
    }
  };

  const initialLoading = loading && !hasLiveSnapshot && !error;
  const initialError = Boolean(error) && !hasLiveSnapshot;
  const stale = Boolean(error) && hasLiveSnapshot;

  return (
    <div>
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
        title="Services"
        description="The services the firm offers. Every assignment and recurring schedule is filed under one."
        action={
          <button
            className="primary-button"
            type="button"
            style={{ fontSize: 12, padding: '7px 14px' }}
            onClick={(event) => openDialog({ kind: 'add' }, event.currentTarget)}
          >
            <Plus size={14} /> Add service
          </button>
        }
      >
        {initialLoading ? (
          <div aria-busy="true" aria-label="Loading services">
            {[1, 2, 3, 4].map((x) => (
              <div className="skeleton-row engagement-skeleton-row" key={x}>
                <span className="skeleton-pulse" />
              </div>
            ))}
          </div>
        ) : initialError ? (
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load services</h3>
            <p>{error}</p>
            <button className="primary-button" type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : services.length === 0 ? (
          <div className="workspace-empty-card">
            <strong>No services yet. Add the services the firm offers.</strong>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Usual turnaround</th>
                  <th>Statutory due dates</th>
                  <th>In use</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{service.name}</strong>
                      {service.description ? (
                        <small
                          style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 11, maxWidth: 320, overflowWrap: 'anywhere' }}
                        >
                          {service.description}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{turnaroundLabel(service.turnaroundDays)}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{service.isStatutory ? 'Yes' : 'No'}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12 }}>{inUseLabel(service)}</span>
                    </td>
                    <td>
                      {service.isActive ? (
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
                          aria-label={`Edit ${service.name}`}
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          disabled={busyId !== null}
                          onClick={(event) => openDialog({ kind: 'edit', service }, event.currentTarget)}
                        >
                          Edit
                        </button>
                        {service.isActive ? (
                          <button
                            className="soft-button"
                            type="button"
                            aria-label={`Deactivate ${service.name}`}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            disabled={busyId !== null}
                            onClick={(event) => openDialog({ kind: 'deactivate', service }, event.currentTarget)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            className="soft-button"
                            type="button"
                            aria-label={`Reactivate ${service.name}`}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            disabled={busyId !== null}
                            onClick={() => void reactivateService(service)}
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

      <ServiceDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        service={dialog?.kind === 'edit' ? dialog.service : null}
        opener={opener}
        onClose={closeDialog}
        onSubmit={saveService}
      />
      <DeactivateServiceDialog
        open={dialog?.kind === 'deactivate'}
        serviceName={dialog?.kind === 'deactivate' ? dialog.service.name : ''}
        opener={opener}
        onClose={closeDialog}
        onSubmit={(key) => (dialog?.kind === 'deactivate' ? deactivateService(dialog.service, key) : Promise.resolve())}
      />
    </div>
  );
}
