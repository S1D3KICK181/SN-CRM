import { useEffect, useRef, useState, type FormEvent } from "react";
import { Power, X } from "lucide-react";
import type { CompanyRole } from "@sn/domain";
import type {
  EndEngagementInput,
  EngagementDto,
  EngagementEndOutcome,
  EngagementVersionDto,
} from "@sn/contracts";
import {
  hasEngagementCapability,
  type EngagementMutationResult,
} from "../../api/engagements-types";
import { formatPeriod, missing } from "./engagement-view-model";

type Props = {
  open: boolean;
  role: CompanyRole;
  engagement: EngagementDto;
  version: EngagementVersionDto | null;
  opener?: HTMLElement | null;
  onClose: () => void;
  onEnd: (input: EndEngagementInput) => Promise<EngagementMutationResult>;
};
const focusable = "button:not([disabled]), input:not([disabled]), textarea:not([disabled])";
const SAFE_ERROR = "Unable to end this engagement. Please refresh and try again.";
const OUTCOME_ERROR = "Select an outcome.";
const REASON_ERROR = "Enter a reason of at least 2 characters.";
const OUTCOMES: ReadonlyArray<{ value: EngagementEndOutcome; label: string; help: string }> = [
  { value: "completed", label: "Completed", help: "Work was delivered as agreed." },
  { value: "terminated", label: "Terminated", help: "Ended before the work was completed." },
];

export function EndEngagementDialog({
  open,
  role,
  engagement,
  version,
  opener,
  onClose,
  onEnd,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<EngagementEndOutcome | "">("");
  const [reason, setReason] = useState("");
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
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
      setOutcome("");
      setReason("");
      setOutcomeError(null);
      setReasonError(null);
      wasOpen.current = true;
      requestAnimationFrame(() =>
        dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus(),
      );
    }
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

  if (!open || !hasEngagementCapability(role, "end")) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const trimmed = reason.trim();
    const nextReasonError = trimmed.length >= 2 ? null : REASON_ERROR;
    setOutcomeError(outcome ? null : OUTCOME_ERROR);
    setReasonError(nextReasonError);
    if (!outcome || nextReasonError) {
      setError(null);
      if (!outcome) {
        dialogRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
      } else {
        reasonRef.current?.focus();
      }
      return;
    }
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await onEnd({
        engagementId: engagement.id,
        outcome,
        reason: trimmed,
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
      className="dialog-layer end-engagement-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !lock.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-engagement-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <Power size={18} />
            </div>
            <div>
              <h2 id="end-engagement-title">End engagement</h2>
              <p>
                Ending is permanent. Approved terms and history stay on record. Any recurring schedules linked to this engagement stop creating new assignments.
              </p>
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
        <form onSubmit={submit} noValidate>
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
                <dt>Current terms</dt>
                <dd>
                  {version ? `v${version.versionNumber} · ${missing(version.title)}` : missing(null)}
                </dd>
              </div>
              <div>
                <dt>Period</dt>
                <dd>{version ? formatPeriod(version.startDate, version.endDate) : missing(null)}</dd>
              </div>
            </dl>
          </div>
          <div className="end-engagement-fields">
            {error ? (
              <p className="dialog-validation-summary" role="alert">
                {error}
              </p>
            ) : null}
            <fieldset className="end-engagement-outcome">
              <legend>Outcome</legend>
              {OUTCOMES.map((option) => (
                <label className="end-engagement-radio" key={option.value}>
                  <input
                    type="radio"
                    name="end-engagement-outcome"
                    value={option.value}
                    checked={outcome === option.value}
                    disabled={pending}
                    aria-invalid={outcomeError ? true : undefined}
                    aria-describedby={outcomeError ? "end-engagement-outcome-error" : undefined}
                    onChange={() => {
                      setOutcome(option.value);
                      setOutcomeError(null);
                    }}
                  />
                  <strong>{option.label}</strong>
                  <span>{option.help}</span>
                </label>
              ))}
              {outcomeError ? (
                <small id="end-engagement-outcome-error" className="field-error-text">
                  {outcomeError}
                </small>
              ) : null}
            </fieldset>
            <div className="field">
              <label htmlFor="end-engagement-reason">Reason</label>
              <textarea
                id="end-engagement-reason"
                ref={reasonRef}
                rows={3}
                maxLength={500}
                value={reason}
                disabled={pending}
                aria-invalid={reasonError ? true : undefined}
                aria-describedby={
                  reasonError
                    ? "end-engagement-reason-hint end-engagement-reason-error"
                    : "end-engagement-reason-hint"
                }
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
              />
              <small id="end-engagement-reason-hint">
                Recorded permanently in the engagement history.
              </small>
              {reasonError ? (
                <small id="end-engagement-reason-error" className="field-error-text">
                  {reasonError}
                </small>
              ) : null}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button
              className="primary-button engagement-end-confirm"
              type="submit"
              disabled={pending}
            >
              {pending ? "Ending…" : "End engagement"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
