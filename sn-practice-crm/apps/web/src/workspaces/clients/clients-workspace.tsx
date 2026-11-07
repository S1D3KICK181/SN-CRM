import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Files,
  Plus,
  RotateCcw,
  Search,
  UserCheck,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type { ClientStatus } from '@sn/contracts';
import { useClients } from '../../api/use-clients';
import type { ClientsPort } from '../../api/clients-types';
import { Card } from '../../ui/workspace-primitives';
import { ClientProfileDrawer } from './client-profile-drawer';
import { CreateClientDialog } from './create-client-dialog';
import {
  computeClientDirectoryStats,
  matchesClientSearch,
  toClientDetailViewModel,
  toClientListItemViewModel,
} from './clients-view-model';

export interface ClientsWorkspaceProps {
  readonly role: CompanyRole;
  readonly port?: ClientsPort;
  readonly onToast?: (message: string) => void;
}

export function ClientsWorkspace({
  role,
  port,
  onToast,
}: ClientsWorkspaceProps) {
  const {
    items,
    loading,
    error,
    hasLiveSnapshot,
    selectedClientId,
    selectedDetail,
    detailLoading,
    detailError,
    selectClient,
    clearSelection,
    refresh,
    createClient,
  } = useClients(role, { port, onToast });

  const canCreateClient = role === 'founder' || role === 'manager';
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const addClientBtnRef = useRef<HTMLButtonElement>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all');

  // Synchronously reset local search, filter, and open dialog on role transition
  const [prevRole, setPrevRole] = useState(role);
  if (prevRole !== role) {
    setPrevRole(role);
    setSearch('');
    setStatusFilter('all');
    setIsCreateOpen(false);
  }

  const stats = useMemo(() => computeClientDirectoryStats(items), [items]);

  const filtered = useMemo(() => {
    return items.filter((client) => {
      const matchSearch = matchesClientSearch(client, search);
      const matchStatus = statusFilter === 'all' || client.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [items, search, statusFilter]);

  const isInitialLoading = loading && !hasLiveSnapshot;
  const isInitialError = error !== null && !hasLiveSnapshot;
  const isRefreshError = error !== null && hasLiveSnapshot;

  const cardDescription = isInitialLoading
    ? 'Loading client records…'
    : isInitialError
    ? 'Unable to load clients'
    : `${filtered.length} client${filtered.length === 1 ? '' : 's'} matching current filter · Click row to open profile drawer`;

  return (
    <div className="client-workspace">
      {/* Role-scoped directory metrics */}
      <section className="workspace-stats-grid" aria-label="Client directory metrics">
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Accessible Clients</span>
            {isInitialLoading ? (
              <span className="skeleton-pulse stat-metric-skeleton" aria-label="Loading Accessible Clients" />
            ) : isInitialError ? (
              <span className="stat-unavailable" aria-label="Accessible Clients unavailable">—</span>
            ) : (
              <strong>{stats.accessibleClients}</strong>
            )}
            <small>
              {isInitialLoading ? 'Loading…' : isInitialError ? 'Unavailable' : `${stats.activeClients} active in current role scope`}
            </small>
          </div>
          <span className="workspace-stat-icon">
            <Building2 aria-hidden="true" />
          </span>
        </article>

        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Active Clients</span>
            {isInitialLoading ? (
              <span className="skeleton-pulse stat-metric-skeleton" aria-label="Loading Active Clients" />
            ) : isInitialError ? (
              <span className="stat-unavailable" aria-label="Active Clients unavailable">—</span>
            ) : (
              <strong>{stats.activeClients}</strong>
            )}
            <small>
              {isInitialLoading ? 'Loading…' : isInitialError ? 'Unavailable' : 'Active client engagements'}
            </small>
          </div>
          <span className="workspace-stat-icon stat-success">
            <CheckCircle2 aria-hidden="true" />
          </span>
        </article>

        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Active Assignments</span>
            {isInitialLoading ? (
              <span className="skeleton-pulse stat-metric-skeleton" aria-label="Loading Active Assignments" />
            ) : isInitialError ? (
              <span className="stat-unavailable" aria-label="Active Assignments unavailable">—</span>
            ) : (
              <strong>{stats.activeAssignments}</strong>
            )}
            <small>
              {isInitialLoading ? 'Loading…' : isInitialError ? 'Unavailable' : 'Across accessible clients'}
            </small>
          </div>
          <span className="workspace-stat-icon stat-warning">
            <Files aria-hidden="true" />
          </span>
        </article>

        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Assigned Relationships</span>
            {isInitialLoading ? (
              <span className="skeleton-pulse stat-metric-skeleton" aria-label="Loading Assigned Relationships" />
            ) : isInitialError ? (
              <span className="stat-unavailable" aria-label="Assigned Relationships unavailable">—</span>
            ) : (
              <strong>{stats.relationshipManaged}</strong>
            )}
            <small>
              {isInitialLoading ? 'Loading…' : isInitialError ? 'Unavailable' : 'With assigned relationship owner'}
            </small>
          </div>
          <span className="workspace-stat-icon stat-gold">
            <UserCheck aria-hidden="true" />
          </span>
        </article>
      </section>

      {/* Non-destructive refresh warning banner */}
      {isRefreshError ? (
        <div className="workspace-warning-banner" role="status">
          <div className="workspace-warning-message">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>Failed to refresh client list. Showing last loaded data.</span>
          </div>
          <button
            className="soft-button"
            type="button"
            onClick={() => void refresh()}
            style={{ fontSize: 11, padding: '3px 10px', height: 'auto' }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Toolbar: Search, Status Filter, Refresh */}
      <div className="client-toolbar">
        <div className="client-search-wrap">
          <Search aria-hidden="true" />
          <input
            className="client-search-input"
            type="search"
            placeholder="Search by client name, code, or masked tax ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search clients"
          />
        </div>
        <div className="client-filter-group">
          <select
            className="client-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ClientStatus)}
            aria-label="Filter by client status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="archived">Archived</option>
          </select>
          <button
            className="soft-button"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh client list"
            style={{
              height: 38,
              padding: '0 12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RotateCcw
              size={13}
              aria-hidden="true"
              style={{
                animation: loading ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span>Refresh</span>
          </button>
          {canCreateClient ? (
            <button
              ref={addClientBtnRef}
              className="primary-button client-add-btn"
              type="button"
              onClick={() => setIsCreateOpen(true)}
              aria-label="Add client"
            >
              <Plus size={14} aria-hidden="true" />
              <span>Add client</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Client directory table */}
      <Card
        title="Client directory"
        description={cardDescription}
        className="table-card"
      >
        {isInitialLoading ? (
          <div className="table-scroll" aria-busy="true" aria-label="Loading client directory">
            <table>
              <thead>
                <tr>
                  <th>Client / Code</th>
                  <th>Status</th>
                  <th>Masked Tax IDs</th>
                  <th>Relationship Owner</th>
                  <th>Active Work</th>
                  <th>Contact</th>
                  <th>Profile</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((idx) => (
                  <tr key={idx} className="skeleton-row">
                    <td>
                      <div className="skeleton-pulse" style={{ height: 16, width: 140, marginBottom: 4 }} />
                      <div className="skeleton-pulse" style={{ height: 12, width: 90 }} />
                    </td>
                    <td>
                      <div className="skeleton-pulse" style={{ height: 20, width: 60, borderRadius: 6 }} />
                    </td>
                    <td>
                      <div className="skeleton-pulse" style={{ height: 14, width: 80, marginBottom: 3 }} />
                      <div className="skeleton-pulse" style={{ height: 14, width: 110 }} />
                    </td>
                    <td>
                      <div className="skeleton-pulse" style={{ height: 14, width: 100 }} />
                    </td>
                    <td>
                      <div className="skeleton-pulse" style={{ height: 20, width: 50, borderRadius: 6 }} />
                    </td>
                    <td>
                      <div className="skeleton-pulse" style={{ height: 12, width: 120, marginBottom: 3 }} />
                      <div className="skeleton-pulse" style={{ height: 12, width: 90 }} />
                    </td>
                    <td>
                      <div className="skeleton-pulse" style={{ height: 24, width: 50, borderRadius: 6 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : isInitialError ? (
          <div className="workspace-error-card" role="alert">
            <div className="workspace-error-icon">
              <AlertTriangle size={22} aria-hidden="true" />
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink-strong)' }}>
              Unable to load clients
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', maxWidth: 360 }}>
              {error.message || 'An error occurred while loading client records.'}
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => void refresh()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}
            >
              <RotateCcw size={13} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="workspace-empty-card">
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)' }}>
              {items.length === 0
                ? 'No clients accessible for this role.'
                : 'No clients match your filter criteria.'}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>
              {items.length === 0
                ? 'Clients visible to this role will appear here.'
                : 'Try adjusting your search terms or clearing status filters.'}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Client / Code</th>
                  <th>Status</th>
                  <th>Masked Tax IDs</th>
                  <th>Relationship Owner</th>
                  <th>Active Work</th>
                  <th>Contact</th>
                  <th>Profile</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((client) => {
                  const vm = toClientListItemViewModel(client);
                  return (
                    <tr
                      key={vm.id}
                      className="interactive-row"
                      onClick={() => void selectClient(vm.id)}
                    >
                      <td>
                        <div className="client-text-wrap">
                          <strong>{vm.displayName}</strong>
                          <small className="table-secondary">{vm.subtitle}</small>
                        </div>
                      </td>
                      <td>
                        <span className={`status tone-${vm.statusTone}`}>{vm.statusLabel}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span className="tax-id-chip">{vm.panMasked}</span>
                          <span className="tax-id-chip" style={{ color: 'var(--ink-muted)' }}>
                            {vm.gstinMasked}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className="client-text-wrap">{vm.relationshipOwnerName}</span>
                      </td>
                      <td>
                        <span className="status tone-default">
                          {vm.activeAssignmentsLabel}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span className="client-text-wrap" style={{ fontSize: 11, color: 'var(--ink)' }}>{vm.email}</span>
                          <span className="client-text-wrap" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{vm.phone}</span>
                        </div>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void selectClient(vm.id);
                          }}
                        >
                          View <ChevronRight aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail Drawer */}
      {selectedClientId ? (
        <ClientProfileDrawer
          client={selectedDetail ? toClientDetailViewModel(selectedDetail) : null}
          loading={detailLoading}
          error={detailError}
          onClose={clearSelection}
          onRetry={() => void selectClient(selectedClientId)}
        />
      ) : null}

      {/* Create Client Dialog */}
      {isCreateOpen && canCreateClient ? (
        <CreateClientDialog
          isOpen={isCreateOpen}
          onClose={() => {
            setIsCreateOpen(false);
            addClientBtnRef.current?.focus();
          }}
          onSubmit={async (input) => {
            const created = await createClient(input);
            if (created) {
              onToast?.(`Client "${created.displayName}" created successfully.`);
              setIsCreateOpen(false);
              addClientBtnRef.current?.focus();
            }
            return created;
          }}
        />
      ) : null}
    </div>
  );
}
