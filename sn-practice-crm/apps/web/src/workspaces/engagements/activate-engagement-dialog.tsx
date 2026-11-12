import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import type { CompanyRole } from "@sn/domain";
import type { ActivateEngagementInput, EngagementDto, EngagementVersionDto } from "@sn/contracts";
import {
  hasEngagementCapability,
  type EngagementMutationResult,
} from "../../api/engagements-types";
import { formatInrFromPaise, formatPeriod, humanFeeModel, missing } from "./engagement-view-model";

type Props = {
  open: boolean;
  role: CompanyRole;
  engagement: EngagementDto;
  version: EngagementVersionDto;
  opener?: HTMLElement | null;
  onClose: () => void;
  onActivate: (input: ActivateEngagementInput) => Promise<EngagementMutationResult>;
};
const focusable = "button:not([disabled])";
const SAFE_ERROR = "Unable to approve this engagement. Please refresh and try again.";

export function ActivateEngagementDialog({
  open,
  role,
  engagement,
  version,
  opener,
  onClose,
  onActivate,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const wasOpen = useRef(false);
  const openerRef = useRef(opener);
  const onCloseRef = useRef(onClose);
  openerRef.current = opener;
  onCloseRef.current = onClose;

  useEffect(() => {
    return () => {
      if (wasOpen.current) openerRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      setError(null);
      wasOpen.current = true;
    }
    requestAnimationFrame(() =>
      dialogRef.current?.querySelector<HTMLButtonElement>("[data-safe-action]")?.focus(),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!lock.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      if (lock.current) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && event.shiftKey && index <= 0) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (nodes.length && !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open || !hasEngagementCapability(role, "activate")) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onActivate({
        engagementId: engagement.id,
        versionId: version.id,
        expectedUpdatedAt: engagement.updatedAt,
      });
      if (result.success) onClose();
      else setError(SAFE_ERROR);
    } catch {
      setError(SAFE_ERROR);
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <div
      className="dialog-layer activation-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !lock.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approve-engagement-title"
        className="dialog engagement-draft-dialog activation-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 id="approve-engagement-title">Approve engagement</h2>
              <p>Confirm the latest immutable draft version.</p>
            </div>
          </div>
          <button
            className="dialog-close-btn"
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={pending}
          >
            <X size={18} />
          </button>
        </header>
        <div className="activation-summary">
          <p>
            <strong>{engagement.code}</strong> · {missing(engagement.clientName)}
          </p>
          <dl>
            <div>
              <dt>Service</dt>
              <dd>{missing(engagement.serviceName)}</dd>
            </div>
            <div>
              <dt>Version / title</dt>
              <dd>
                v{version.versionNumber} · {missing(version.title)}
              </dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{missing(version.scope)}</dd>
            </div>
            <div>
              <dt>Period</dt>
              <dd>{formatPeriod(version.startDate, version.endDate)}</dd>
            </div>
            <div>
              <dt>Fee</dt>
              <dd>
                {humanFeeModel(version.feeModel)} · {formatInrFromPaise(version.agreedFeePaise)}
              </dd>
            </div>
            <div>
              <dt>Responsible partner</dt>
              <dd>{missing(version.responsiblePartnerName)}</dd>
            </div>
            <div>
              <dt>Delivery manager</dt>
              <dd>{missing(version.deliveryManagerName)}</dd>
            </div>
          </dl>
          <p className="activation-note">
            This version becomes the approved active terms. Prior versions remain immutable.
          </p>
        </div>
        {error ? (
          <p className="dialog-validation-summary" role="alert">
            {error}
          </p>
        ) : null}
        <form onSubmit={submit}>
          <footer className="dialog-footer">
            <button
              data-safe-action
              className="soft-button"
              type="button"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              <Check size={15} /> {pending ? "Approving…" : "Approve & activate"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
