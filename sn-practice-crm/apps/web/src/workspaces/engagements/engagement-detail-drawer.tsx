import { useEffect, useRef } from "react";
import { RotateCcw, X } from "lucide-react";
import type { EngagementDto, EngagementVersionDto } from "@sn/contracts";
import type { EngagementOperationError } from "../../api/engagements-types";
import {
  currentTerms,
  formatIndiaTimestamp,
  formatInrFromPaise,
  formatPeriod,
  humanFeeModel,
  humanEndOutcome,
  missing,
} from "./engagement-view-model";

export interface EngagementDetailDrawerProps {
  engagement: EngagementDto | null;
  versions: readonly EngagementVersionDto[];
  loading?: boolean;
  error?: EngagementOperationError | null;
  activator?: HTMLElement;
  onClose: () => void;
  onRetry?: () => void;
  canRevise?: boolean;
  obscured?: boolean;
  onRevise?: (element: HTMLButtonElement) => void;
  canActivate?: boolean;
  onActivate?: (element: HTMLButtonElement) => void;
  canAmend?: boolean;
  onAmend?: (element: HTMLButtonElement) => void;
}
export function EngagementDetailDrawer({
  engagement,
  versions,
  loading = false,
  error = null,
  activator,
  onClose,
  onRetry,
  canRevise = false,
  obscured = false,
  onRevise,
  canActivate = false,
  onActivate,
  canAmend = false,
  onAmend,
}: EngagementDetailDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const footerCloseRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(activator ?? null);
  const current = currentTerms(versions, engagement?.approvedVersion);
  const showRevise =
    canRevise &&
    !loading &&
    !error &&
    engagement?.status === "draft" &&
    current &&
    Boolean(onRevise);
  const showActivate =
    canActivate &&
    !loading &&
    !error &&
    engagement?.status === "draft" &&
    current &&
    Boolean(onActivate);
  const showAmend =
    canAmend &&
    !loading &&
    !error &&
    engagement?.status === "active" &&
    current &&
    Boolean(onAmend);
  useEffect(() => {
    previousFocus.current = activator ?? previousFocus.current;
    closeRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, [activator]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (obscured) return;
      if (event.key === "Escape" && !obscured) onClose();
      if (event.key === "Tab") {
        if (!event.shiftKey && document.activeElement === footerCloseRef.current) {
          event.preventDefault();
          closeRef.current?.focus();
        } else if (event.shiftKey && document.activeElement === closeRef.current) {
          event.preventDefault();
          footerCloseRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, obscured]);
  return (
    <>
      <div
        className="drawer-backdrop"
        aria-hidden="true"
        data-testid="engagement-drawer-backdrop"
        inert={obscured || undefined}
        onMouseDown={(event) => {
          if (!obscured && event.target === event.currentTarget) onClose();
        }}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="engagement-drawer-title"
        className="client-drawer engagement-drawer"
        aria-hidden={obscured}
        inert={obscured || undefined}
      >
        <div className="client-drawer-header">
          <div>
            <h2 id="engagement-drawer-title" className="drawer-title-contain">
              {engagement?.code ?? (loading ? "Loading engagement…" : "Engagement details")}
            </h2>
            <p className="drawer-subtitle-contain">
              {missing(engagement?.clientName)} · {missing(engagement?.serviceName)}
            </p>
          </div>
          <button
            ref={closeRef}
            className="drawer-close-btn"
            type="button"
            aria-label="Close engagement details"
            onClick={onClose}
            disabled={obscured}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="drawer-content drawer-text-contain">
          {loading && !engagement ? (
            <div
              className="drawer-loading-skeleton"
              aria-busy="true"
              aria-label="Loading engagement details"
            >
              <div className="drawer-card skeleton-pulse engagement-skeleton-card engagement-skeleton-card-short" />
              <div className="drawer-card skeleton-pulse engagement-skeleton-card engagement-skeleton-card-tall" />
            </div>
          ) : error && !engagement ? (
            <div className="drawer-error-state" role="alert">
              <h3>Unable to load engagement details</h3>
              <p>{error.message}</p>
              {onRetry ? (
                <button className="primary-button" type="button" onClick={onRetry}>
                  <RotateCcw size={13} /> Retry
                </button>
              ) : null}
            </div>
          ) : engagement ? (
            <>
              {error ? (
                <div className="workspace-warning-banner engagement-detail-warning" role="status">
                  <span>Could not refresh all details. Showing retained data.</span>
                  {onRetry ? (
                    <button className="soft-button" type="button" onClick={onRetry}>
                      Retry
                    </button>
                  ) : null}
                </div>
              ) : null}
              <section className="drawer-card">
                <h3>Identity &amp; status</h3>
                <p>
                  <strong>{engagement.code}</strong> ·{" "}
                  <span
                    className={`status engagement-status engagement-status-${engagement.status}`}
                  >
                    {engagement.status}
                  </span>
                </p>
                <p>
                  {missing(engagement.clientName)} · {missing(engagement.serviceName)}
                </p>
              </section>
              {showRevise || showActivate || showAmend ? (
                <section className="drawer-card engagement-drawer-action-card">
                  <div className="engagement-drawer-action-group">
                    {showRevise ? (
                      <button
                        className="soft-button"
                        type="button"
                        onClick={(event) => onRevise?.(event.currentTarget)}
                        disabled={obscured}
                      >
                        Revise draft
                      </button>
                    ) : null}
                    {showActivate ? (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={(event) => onActivate?.(event.currentTarget)}
                        disabled={obscured}
                      >
                        Approve &amp; activate
                      </button>
                    ) : null}
                    {showAmend ? (
                      <button
                        className="soft-button"
                        type="button"
                        onClick={(event) => onAmend?.(event.currentTarget)}
                        disabled={obscured}
                      >
                        Amend terms
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <section className="drawer-card">
                <h3>Current terms</h3>
                {current ? (
                  <div className="drawer-grid-2col engagement-detail-grid">
                    <div>
                      <span className="drawer-field-label">Version</span>
                      <p>v{current.versionNumber}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Title</span>
                      <p>{missing(current.title)}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Period</span>
                      <p>{formatPeriod(current.startDate, current.endDate)}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Fee model</span>
                      <p>{humanFeeModel(current.feeModel)}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Fee</span>
                      <p>{formatInrFromPaise(current.agreedFeePaise)}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Billing</span>
                      <p>{missing(current.billingTerms)}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Responsible partner</span>
                      <p>{missing(current.responsiblePartnerName)}</p>
                    </div>
                    <div>
                      <span className="drawer-field-label">Delivery manager</span>
                      <p>{missing(current.deliveryManagerName)}</p>
                    </div>
                    <div className="engagement-detail-grid-wide">
                      <span className="drawer-field-label">Scope</span>
                      <p>{missing(current.scope)}</p>
                    </div>
                    <div className="engagement-detail-grid-wide">
                      <span className="drawer-field-label">Exclusions</span>
                      <p>{missing(current.exclusions)}</p>
                    </div>
                  </div>
                ) : (
                  <p>Terms not provided.</p>
                )}
              </section>
              <section className="drawer-card">
                <h3>Approval &amp; end facts</h3>
                {engagement.approvedAt ? (
                  <p>
                    Approved: {formatIndiaTimestamp(engagement.approvedAt)} · v
                    {engagement.approvedVersion?.versionNumber ?? "—"}
                  </p>
                ) : (
                  <p>Approval: Not approved</p>
                )}
                {engagement.endedAt ? (
                  <p>
                    Ended: {formatIndiaTimestamp(engagement.endedAt)} ·{" "}
                    {humanEndOutcome(engagement.endOutcome)} · {missing(engagement.endReason)}
                  </p>
                ) : (
                  <p>End outcome: Not ended</p>
                )}
              </section>
              <section className="drawer-card">
                <h3>Version history</h3>
                {versions.length ? (
                  <ol className="engagement-version-list">
                    {[...versions]
                      .sort((a, b) => b.versionNumber - a.versionNumber)
                      .map((version) => (
                        <li key={version.id}>
                          <strong>v{version.versionNumber}</strong>
                          <span>{missing(version.title)}</span>
                          <small>
                            {formatPeriod(version.startDate, version.endDate)} ·{" "}
                            {humanFeeModel(version.feeModel)} ·{" "}
                            {formatInrFromPaise(version.agreedFeePaise)} ·{" "}
                            {version.approvedAt ? "Approved" : "Draft"}
                          </small>
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p>No version history is available for this engagement.</p>
                )}
              </section>
            </>
          ) : null}
        </div>
        <div className="drawer-footer">
          <button ref={footerCloseRef} className="soft-button" type="button" onClick={onClose} disabled={obscured}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
