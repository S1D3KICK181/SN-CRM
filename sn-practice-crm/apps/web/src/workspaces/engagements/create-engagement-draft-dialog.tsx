import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, BriefcaseBusiness, Check, X } from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type { CreateEngagementDraftInput, EngagementFeeModel } from '@sn/contracts';
import type { EngagementMutationResult } from '../../api/engagements-types';
import { hasEngagementCapability } from '../../api/engagements-types';
import { SAFE_ERROR, type DraftErrors, type DraftOption, type DraftValues, toCreateEngagementDraftInput, validateEngagementDraft } from './engagement-draft-form-model';

type Props = {
  open: boolean;
  role: CompanyRole;
  clients: readonly DraftOption[];
  services: readonly DraftOption[];
  partners: readonly DraftOption[];
  managers: readonly DraftOption[];
  onClose: () => void;
  onCreate: (input: CreateEngagementDraftInput) => Promise<EngagementMutationResult>;
  opener?: HTMLElement | null;
};
const initial: DraftValues = { clientId: '', serviceId: '', title: '', scope: '', exclusions: '', responsiblePartnerId: '', deliveryManagerId: '', feeModel: 'fixed', agreedFee: '', billingTerms: '', startDate: '', endDate: '' };
const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';
export function CreateEngagementDraftDialog({ open, role, clients, services, partners, managers, onClose, onCreate, opener }: Props) {
  const [values, setValues] = useState<DraftValues>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const previousOpen = useRef(false);
  const canCreate = hasEngagementCapability(role, 'createDraft');
  const unavailable = [clients, services, partners, managers].some((items) => items.filter((item) => item.id).length === 0);
  useLayoutEffect(() => {
    if (open && !previousOpen.current) {
      setValues(initial);
      setErrors({});
    }
    previousOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) { opener?.focus(); return; }
    dialogRef.current?.querySelector<HTMLElement>('#engagement-clientId')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!submittingRef.current) onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      if (submittingRef.current) { event.preventDefault(); dialogRef.current.focus(); return; }
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && event.shiftKey && index <= 0) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (nodes.length && !event.shiftKey && index === nodes.length - 1) { event.preventDefault(); nodes[0]?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); opener?.focus(); };
  }, [open, onClose, opener]);
  if (!open || !canCreate) return null;
  const update = <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const errorFor = (key: keyof DraftValues) => errors[key];
  const fieldProps = (key: keyof DraftValues) => ({ 'aria-invalid': Boolean(errorFor(key)), 'aria-describedby': errorFor(key) ? `engagement-${key}-error` : undefined, disabled: submitting });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || unavailable) return;
    const next = validateEngagementDraft(values, { clients, services, partners, managers });
    setErrors(next);
    if (Object.keys(next).length) { requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    submittingRef.current = true; setSubmitting(true); dialogRef.current?.focus();
    try { const result = await onCreate(toCreateEngagementDraftInput(values)); if (result.success) onClose(); else setErrors({ form: result.error?.message || SAFE_ERROR }); }
    catch { setErrors({ form: SAFE_ERROR }); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };
  const select = (key: 'clientId' | 'serviceId' | 'responsiblePartnerId' | 'deliveryManagerId', label: string, options: readonly DraftOption[]) => <div className="field"><label htmlFor={`engagement-${key}`}>{label}</label><select id={`engagement-${key}`} value={values[key]} onChange={(event) => update(key, event.target.value)} {...fieldProps(key)}><option value="">Select {label.toLowerCase()}…</option>{options.filter((option) => option.id).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{errorFor(key) ? <small id={`engagement-${key}-error`} className="field-error-text" role="alert">{errorFor(key)}</small> : null}</div>;
  const text = (key: 'title' | 'agreedFee' | 'billingTerms' | 'startDate' | 'endDate', label: string, type = 'text') => <div className="field"><label htmlFor={`engagement-${key}`}>{label}</label><input id={`engagement-${key}`} type={type} value={values[key]} onChange={(event) => update(key, event.target.value)} {...fieldProps(key)} />{errorFor(key) ? <small id={`engagement-${key}-error`} className="field-error-text" role="alert">{errorFor(key)}</small> : null}</div>;
  return <div className="dialog-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !submittingRef.current) onClose(); }}><div className="dialog engagement-draft-dialog" tabIndex={-1} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="engagement-draft-title" aria-describedby="engagement-draft-description"><header className="dialog-header"><div className="dialog-icon"><BriefcaseBusiness size={18} /></div><div><h2 id="engagement-draft-title">New engagement</h2><p id="engagement-draft-description">Create a draft engagement for review.</p></div><button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose} disabled={submitting}><X size={18} /></button></header><form onSubmit={submit}><div className="engagement-dialog-body">{Object.keys(errors).length > 0 && !errors.form ? <div className="dialog-validation-summary" role="alert"><AlertTriangle size={16} /> Please correct the highlighted fields.</div> : null}{errors.form ? <div className="dialog-validation-summary" role="alert">{errors.form}</div> : null}{unavailable ? <div className="workspace-warning-banner" role="status">Required directory options are unavailable. Try again when the directory has loaded.</div> : null}<div className="form-grid">{select('clientId', 'Client', clients)}{select('serviceId', 'Service', services)}{text('title', 'Title')}<div className="field"><label htmlFor="engagement-scope">Scope</label><textarea id="engagement-scope" value={values.scope} onChange={(event) => update('scope', event.target.value)} {...fieldProps('scope')} />{errorFor('scope') ? <small id="engagement-scope-error" className="field-error-text" role="alert">{errorFor('scope')}</small> : null}</div><div className="field"><label htmlFor="engagement-exclusions">Exclusions</label><textarea id="engagement-exclusions" value={values.exclusions} onChange={(event) => update('exclusions', event.target.value)} {...fieldProps('exclusions')} /></div>{select('responsiblePartnerId', 'Responsible partner', partners)}{select('deliveryManagerId', 'Delivery manager', managers)}<div className="field"><label htmlFor="engagement-feeModel">Fee model</label><select id="engagement-feeModel" value={values.feeModel} onChange={(event) => update('feeModel', event.target.value as EngagementFeeModel)} {...fieldProps('feeModel')}><option value="fixed">Fixed</option><option value="recurring">Recurring</option><option value="milestone">Milestone</option><option value="time_based">Time based</option></select>{errorFor('feeModel') ? <small id="engagement-feeModel-error" className="field-error-text" role="alert">{errorFor('feeModel')}</small> : null}</div>{text('agreedFee', 'Agreed fee (₹)')}{text('billingTerms', 'Billing terms')}{text('startDate', 'Start date', 'date')}{text('endDate', 'End date', 'date')}</div></div><footer className="dialog-footer"><button className="soft-button" type="button" onClick={onClose} disabled={submitting}>Cancel</button><button className="primary-button" type="submit" disabled={submitting || unavailable}><Check size={15} /> {submitting ? 'Creating…' : 'Create draft'}</button></footer></form></div></div>;
}
