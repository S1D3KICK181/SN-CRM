import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, RotateCcw, Search } from "lucide-react";
import type { CompanyRole } from "@sn/domain";
import type { EngagementStatus } from "@sn/contracts";
import { useEngagements } from "../../api/use-engagements";
import { hasEngagementCapability, type EngagementsPort } from "../../api/engagements-types";
import { Card } from "../../ui/workspace-primitives";
import { EngagementDetailDrawer } from "./engagement-detail-drawer";
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
}
export function EngagementsWorkspace({ role, port, onToast }: EngagementsWorkspaceProps) {
  const allowed = hasEngagementCapability(role, "read");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | EngagementStatus>("all");
  const activatorRef = useRef<HTMLElement | null>(null);
  const previousRole = useRef(role);
  if (previousRole.current !== role) {
    previousRole.current = role;
    setSearch("");
    setStatus("all");
    activatorRef.current = null;
  }
  const model = useEngagements(role, { port, onToast, enabled: allowed });
  const stats = useMemo(() => computeEngagementStats(model.items), [model.items]);
  const filtered = useMemo(
    () => filterEngagements(model.items, search, status),
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
    </div>
  );
}
