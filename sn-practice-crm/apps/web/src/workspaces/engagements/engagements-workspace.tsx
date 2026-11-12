import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Plus, RotateCcw, Search } from "lucide-react";
import type { CompanyRole } from "@sn/domain";
import type { ClientDto, EngagementStatus, ReportingLineDto, ServiceCatalogItemDto, SessionActor } from "@sn/contracts";
import { useEngagements } from "../../api/use-engagements";
import { hasEngagementCapability, type EngagementsPort } from "../../api/engagements-types";
import { Card } from "../../ui/workspace-primitives";
import { EngagementDetailDrawer } from "./engagement-detail-drawer";
import { CreateEngagementDraftDialog } from "./create-engagement-draft-dialog";
import type { DraftOption } from "./engagement-draft-form-model";
import { isValidUuid } from "./engagement-draft-form-model";
import {
  computeEngagementStats,
  filterEngagements,
  formatDate,
  formatInrFromPaise,
  formatPeriod,
  humanFeeModel,
  missing,
} from "./engagement-view-model";
export interface EngagementsWorkspaceProps {
  readonly role: CompanyRole;
  readonly port?: EngagementsPort;
  readonly onToast?: (message: string) => void;
  readonly currentActor?: SessionActor;
  readonly clients?: readonly ClientDto[];
  readonly teamLines?: readonly ReportingLineDto[];
  readonly services?: readonly ServiceCatalogItemDto[];
}
export function buildEngagementOptions(currentActor: SessionActor | undefined, clients: readonly ClientDto[] = [], teamLines: readonly ReportingLineDto[] = [], services: readonly ServiceCatalogItemDto[] = []) {
  const unique = (items: readonly DraftOption[]) => [...new Map(items.filter((item) => isValidUuid(item.id)).map((item) => [item.id, item])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const people = new Map(teamLines
    .filter((line) => isValidUuid(line.employee.id))
    .map((line) => [line.employee.id, { id: line.employee.id, label: line.employee.name, role: line.employee.role }]));
  if (currentActor && isValidUuid(currentActor.id)) {
    people.set(currentActor.id, { id: currentActor.id, label: currentActor.name, role: currentActor.role });
  }
  const validPeople = [...people.values()];
  return {
    clients: unique(clients.filter((item) => item.status === 'active').map((item) => ({ id: item.id, label: item.displayName }))),
    services: unique(services.map((item) => ({ id: item.id, label: item.name }))),
    partners: unique(validPeople.filter((person) => person.role === 'founder')),
    managers: unique(validPeople.filter((person) => person.role === 'founder' || person.role === 'manager')),
  };
}
export function EngagementsWorkspace({ role, port, onToast, currentActor, clients = [], teamLines = [], services = [] }: EngagementsWorkspaceProps) {
  const allowed = hasEngagementCapability(role, "read");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | EngagementStatus>("all");
  const [draftOpen, setDraftOpen] = useState(false);
  const draftOpener = useRef<HTMLElement | null>(null);
  const activatorRef = useRef<HTMLElement | null>(null);
  const previousRole = useRef(role);
  const roleMismatch = previousRole.current !== role;
  useLayoutEffect(() => {
    if (!roleMismatch) return;
    previousRole.current = role;
    setSearch("");
    setStatus("all");
    activatorRef.current = null;
    draftOpener.current = null;
    setDraftOpen(false);
  }, [role, roleMismatch]);
  const model = useEngagements(role, { port, onToast, enabled: allowed });
  const canCreateDraft = hasEngagementCapability(role, "createDraft");
  const options = useMemo(() => buildEngagementOptions(currentActor, clients, teamLines, services), [currentActor, clients, teamLines, services]);
  const stats = useMemo(() => computeEngagementStats(model.items), [model.items]);
  const filtered = useMemo(
    () => filterEngagements(model.items, roleMismatch ? "" : search, roleMismatch ? "all" : status),
    [model.items, search, status],
  );
  const initialLoading = model.loading && !model.hasLiveSnapshot;
  const initialError = model.listError && !model.hasLiveSnapshot;
  const stale = model.listError && model.hasLiveSnapshot;
  if (!allowed)
    return (
      <div className="workspace-empty-card" role="status">
        <strong>No permission</strong>
        <p>Engagements are available to founders and managers.</p>
      </div>
    );
  return (
    <div className="engagement-workspace">
      <section className="workspace-stats-grid engagement-stats" aria-label="Engagement metrics">
        {[
          ["Accessible engagements", stats.accessible],
          ["Active", stats.active],
          ["Draft", stats.draft],
          ["Ended", stats.ended],
        ].map(([label, value]) => (
          <article className="workspace-stat-card" key={label}>
            <div className="workspace-stat-info">
              <span>{label}</span>
              {initialLoading ? (
                <span
                  className="skeleton-pulse stat-metric-skeleton"
                  aria-label={`Loading ${label}`}
                />
              ) : initialError ? (
                <strong aria-label={`${label} unavailable`}>—</strong>
              ) : (
                <strong>{value}</strong>
              )}
            </div>
          </article>
        ))}
      </section>
      {stale ? (
        <div className="workspace-warning-banner" role="status">
          <span>
            <AlertTriangle size={15} /> Refresh failed. Showing last loaded data.
          </span>
          <button className="soft-button" type="button" onClick={() => void model.refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="client-toolbar engagement-toolbar">
        <div className="client-search-wrap">
          <Search aria-hidden="true" />
          <input
            className="client-search-input"
            type="search"
            aria-label="Search engagements"
            placeholder="Search code, client, or service…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="client-filter-group">
          {canCreateDraft ? <button className="primary-button" type="button" onClick={(event) => { draftOpener.current = event.currentTarget; setDraftOpen(true); }}><Plus size={15} /> New engagement</button> : null}
          <select
            className="client-select"
            aria-label="Filter engagements by status"
            value={status}
            onChange={(event) => setStatus(event.target.value as "all" | EngagementStatus)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="ended">Ended</option>
          </select>
          <button
            className="soft-button"
            type="button"
            aria-label="Refresh engagement list"
            onClick={() => void model.refresh()}
            disabled={model.loading}
          >
            <RotateCcw size={13} /> Refresh
          </button>
        </div>
      </div>
      <Card
        title="Engagement directory"
        description={
          initialLoading
            ? "Loading engagement records…"
            : initialError
              ? "Unable to load engagements"
              : `${filtered.length} engagement${filtered.length === 1 ? "" : "s"} matching current filter`
        }
        className="table-card"
      >
        {initialLoading ? (
          <div aria-busy="true" aria-label="Loading engagement directory">
            {[1, 2, 3, 4].map((x) => (
              <div className="skeleton-row engagement-skeleton-row" key={x}>
                <span className="skeleton-pulse" />
              </div>
            ))}
          </div>
        ) : initialError ? (
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load engagements</h3>
            <p>{model.listError.message}</p>
            <button className="primary-button" type="button" onClick={() => void model.refresh()}>
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="workspace-empty-card">
            <strong>
              {model.items.length
                ? "No engagements match your filters."
                : "No engagements accessible."}
            </strong>
            <p>
              {model.items.length
                ? "Try clearing search or status."
                : "Engagements visible to this role will appear here."}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Client</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Approved period</th>
                  <th>Approved fee</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const version = item.approvedVersion;
                  return (
                    <tr
                      key={item.id}
                      className="interactive-row engagement-row"
                      tabIndex={0}
                      onClick={(event) => {
                        activatorRef.current = event.currentTarget;
                        void model.selectEngagement(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          activatorRef.current = event.currentTarget;
                          void model.selectEngagement(item.id);
                        }
                      }}
                    >
                      <td>
                        <strong>{item.code}</strong>
                      </td>
                      <td>{missing(item.clientName)}</td>
                      <td>{missing(item.serviceName)}</td>
                      <td>
                        <span
                          className={`status engagement-status engagement-status-${item.status}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td>
                        {version
                          ? formatPeriod(version.startDate, version.endDate)
                          : "Not provided"}
                      </td>
                      <td>
                        {version ? (
                          <>
                            {humanFeeModel(version.feeModel)} ·{" "}
                            {formatInrFromPaise(version.agreedFeePaise)}
                          </>
                        ) : (
                          "Not provided"
                        )}
                      </td>
                      <td>{formatDate(item.updatedAt)}</td>
                      <td>
                        <ChevronRight size={15} aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {model.selectedEngagementId ? (
        <EngagementDetailDrawer
          engagement={model.selectedDetail}
          versions={model.selectedVersions}
          loading={model.detailLoading}
          error={model.detailError}
          activator={activatorRef.current ?? undefined}
          onClose={model.clearSelection}
          onRetry={() => void model.selectEngagement(model.selectedEngagementId!)}
        />
      ) : null}
      <CreateEngagementDraftDialog
        open={draftOpen}
        role={role}
        clients={options.clients}
        services={options.services}
        partners={options.partners}
        managers={options.managers}
        opener={draftOpener.current}
        onClose={() => setDraftOpen(false)}
        onCreate={(input) => model.createDraft(input)}
      />
    </div>
  );
}
