import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, BriefcaseBusiness, Check, X } from "lucide-react";
import type { CompanyRole } from "@sn/domain";
import type {
  AmendActiveEngagementInput,
  EngagementDto,
  EngagementFeeModel,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from "@sn/contracts";
import type { EngagementMutationResult } from "../../api/engagements-types";
import { hasEngagementCapability } from "../../api/engagements-types";
import {
  SAFE_AMEND_ERROR,
  SAFE_REVISE_ERROR,
  type DraftErrors,
  type DraftOption,
  type EngagementTermsValues,
  prefillEngagementTerms,
  toAmendActiveEngagementInput,
  toReviseEngagementDraftInput,
  validateEngagementTerms,
} from "./engagement-draft-form-model";

type CommonProps = {
  open: boolean;
  role: CompanyRole;
  engagement: EngagementDto;
  version: EngagementVersionDto;
  partners: readonly DraftOption[];
  managers: readonly DraftOption[];
  opener?: HTMLElement | null;
  onClose: () => void;
};
type Props = CommonProps &
  (
    | {
        mode: "reviseDraft";
        onSave: (input: ReviseEngagementDraftInput) => Promise<EngagementMutationResult>;
      }
    | {
        mode: "amendActive";
        onSave: (input: AmendActiveEngagementInput) => Promise<EngagementMutationResult>;
      }
  );
const focusable =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

export function EngagementTermsDialog(props: Props) {
  const { open, role, engagement, version, partners, managers, opener, onClose, mode } = props;
  const [values, setValues] = useState<EngagementTermsValues>(() =>
    prefillEngagementTerms(version),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const wasOpen = useRef(false);
  const openInstance = useRef(false);
  const closeRef = useRef(onClose);
  const openerRef = useRef(opener);
  closeRef.current = onClose;
  openerRef.current = opener;
  const amend = mode === "amendActive";
  const allowed = hasEngagementCapability(role, amend ? "amend" : "reviseDraft");
  const unavailable =
    !partners.some((item) => item.id === version.responsiblePartnerId) ||
    !managers.some((item) => item.id === version.deliveryManagerId);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setValues(prefillEngagementTerms(version));
      setErrors({});
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (openInstance.current) {
        openerRef.current?.focus();
        openInstance.current = false;
      }
      return;
    }
    openInstance.current = true;
    dialogRef.current?.querySelector<HTMLElement>("#engagement-terms-title")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!locked.current) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      if (locked.current) {
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
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  useEffect(
    () => () => {
      if (openInstance.current) openerRef.current?.focus();
    },
    [],
  );
  if (!open || !allowed) return null;

  const update = <K extends keyof EngagementTermsValues>(key: K, value: EngagementTermsValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const errorFor = (key: keyof EngagementTermsValues) => errors[key];
  const fieldProps = (key: keyof EngagementTermsValues) => ({
    "aria-invalid": Boolean(errorFor(key)),
    "aria-describedby": errorFor(key) ? `engagement-terms-${key}-error` : undefined,
    disabled: pending,
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current || unavailable) return;
    const next = validateEngagementTerms(values, { partners, managers });
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() =>
        dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    locked.current = true;
    setPending(true);
    try {
      const result = amend
        ? await props.onSave(
            toAmendActiveEngagementInput(engagement.id, engagement.updatedAt, values),
          )
        : await props.onSave(
            toReviseEngagementDraftInput(engagement.id, engagement.updatedAt, values),
          );
      if (result.success) closeRef.current();
      else setErrors({ form: amend ? SAFE_AMEND_ERROR : SAFE_REVISE_ERROR });
    } catch {
      setErrors({ form: amend ? SAFE_AMEND_ERROR : SAFE_REVISE_ERROR });
    } finally {
      locked.current = false;
      setPending(false);
    }
  };
  const textField = (
    key: "title" | "agreedFee" | "billingTerms" | "startDate" | "endDate",
    label: string,
    type = "text",
  ) => (
    <div className="field">
      <label htmlFor={`engagement-terms-${key}`}>{label}</label>
      <input
        id={`engagement-terms-${key}`}
        type={type}
        value={values[key]}
        onChange={(event) => update(key, event.target.value)}
        {...fieldProps(key)}
      />
      {errorFor(key) ? (
        <small id={`engagement-terms-${key}-error`} className="field-error-text" role="alert">
          {errorFor(key)}
        </small>
      ) : null}
    </div>
  );
  const selectField = (
    key: "responsiblePartnerId" | "deliveryManagerId",
    label: string,
    options: readonly DraftOption[],
  ) => (
    <div className="field">
      <label htmlFor={`engagement-terms-${key}`}>{label}</label>
      <select
        id={`engagement-terms-${key}`}
        value={values[key]}
        onChange={(event) => update(key, event.target.value)}
        {...fieldProps(key)}
      >
        <option value="">Select {label.toLowerCase()}\u2026</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {errorFor(key) ? (
        <small id={`engagement-terms-${key}-error`} className="field-error-text" role="alert">
          {errorFor(key)}
        </small>
      ) : null}
    </div>
  );
  return (
    <div
      className="dialog-layer engagement-terms-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked.current) closeRef.current();
      }}
    >
      <div
        className="dialog engagement-draft-dialog engagement-terms-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="engagement-terms-dialog-title"
        aria-describedby="engagement-terms-dialog-description"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <BriefcaseBusiness size={18} />
            </div>
            <div>
              <h2 id="engagement-terms-dialog-title">
                {amend ? "Approve amendment" : "Revise draft engagement"}
              </h2>
              <p id="engagement-terms-dialog-description">
                {amend
                  ? "Create and immediately approve a new immutable version while the engagement remains active."
                  : "Update the next immutable draft version."}
              </p>
            </div>
          </div>
          <button
            className="dialog-close-btn"
            type="button"
            aria-label="Close"
            onClick={() => closeRef.current()}
            disabled={pending}
          >
            <X size={18} />
          </button>
        </header>
        <div className="engagement-terms-context">
          <strong>{engagement.code}</strong>
          <span>
            {engagement.clientName ?? "Client unavailable"} {"\u00b7"}{" "}
            {engagement.serviceName ?? "Service unavailable"} {"\u00b7"} current v
            {version.versionNumber}
            {amend ? (
              <>
                {" "}
                {"\u00b7"} next v{version.versionNumber + 1}
              </>
            ) : null}
          </span>
        </div>
        <form onSubmit={submit}>
          <div className="engagement-dialog-body">
            {Object.keys(errors).length ? (
              <div className="dialog-validation-summary" role="alert">
                {errors.form ? (
                  errors.form
                ) : (
                  <>
                    <AlertTriangle size={16} /> Please correct the highlighted fields.
                  </>
                )}
              </div>
            ) : null}
            {unavailable ? (
              <div className="workspace-warning-banner" role="alert">
                The current partner or manager is unavailable in the directory. Refresh the
                directory before saving.
              </div>
            ) : null}
            {amend ? (
              <p className="engagement-amend-note">Prior approved terms remain immutable.</p>
            ) : null}
            <div className="form-grid">
              {textField("title", "Title")}
              <div className="field is-full">
                <label htmlFor="engagement-terms-scope">Scope</label>
                <textarea
                  id="engagement-terms-scope"
                  value={values.scope}
                  onChange={(event) => update("scope", event.target.value)}
                  {...fieldProps("scope")}
                />
                {errorFor("scope") ? (
                  <small
                    id="engagement-terms-scope-error"
                    className="field-error-text"
                    role="alert"
                  >
                    {errorFor("scope")}
                  </small>
                ) : null}
              </div>
              <div className="field is-full">
                <label htmlFor="engagement-terms-exclusions">Exclusions</label>
                <textarea
                  id="engagement-terms-exclusions"
                  value={values.exclusions}
                  onChange={(event) => update("exclusions", event.target.value)}
                  {...fieldProps("exclusions")}
                />
              </div>
              {selectField("responsiblePartnerId", "Responsible partner", partners)}
              {selectField("deliveryManagerId", "Delivery manager", managers)}
              <div className="field">
                <label htmlFor="engagement-terms-feeModel">Fee model</label>
                <select
                  id="engagement-terms-feeModel"
                  value={values.feeModel}
                  onChange={(event) => update("feeModel", event.target.value as EngagementFeeModel)}
                  {...fieldProps("feeModel")}
                >
                  <option value="fixed">Fixed</option>
                  <option value="recurring">Recurring</option>
                  <option value="milestone">Milestone</option>
                  <option value="time_based">Time based</option>
                </select>
              </div>
              {textField("agreedFee", "Agreed fee (\u20b9)")}
              {textField("billingTerms", "Billing terms")}
              {textField("startDate", "Start date", "date")}
              {textField("endDate", "End date", "date")}
            </div>
          </div>
          <footer className="dialog-footer">
            <button
              className="soft-button"
              type="button"
              onClick={() => closeRef.current()}
              disabled={pending}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending || unavailable}>
              <Check size={15} />{" "}
              {pending
                ? amend
                  ? "Approving\u2026"
                  : "Saving\u2026"
                : amend
                  ? "Approve amendment"
                  : "Save revision"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
