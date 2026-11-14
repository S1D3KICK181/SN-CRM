import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Building2, UsersRound, X } from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import type { DepartmentDto } from '@sn/contracts';
import { departmentSaveErrorMessage, DEPARTMENT_TRAINEE_HEAD_MESSAGE } from '../../api/departments-types';
import { ROLE_LABELS } from '../../data';
import { nextSaveAttempt, type SaveAttempt } from '../billing/billing-form-model';

/** What the department form saves; the workspace adds the concurrency token for an edit. */
export interface DepartmentFormInput {
  readonly name: string;
}

type DepartmentFormErrors = Partial<Record<'name', string>>;

const NAME_MIN = 2;
const NAME_MAX = 80;

export const DEPARTMENT_NAME_ERROR = 'Enter a department name of 2 to 80 characters.';

function validateDepartmentForm(name: string): DepartmentFormErrors {
  const length = name.trim().length;
  return length < NAME_MIN || length > NAME_MAX ? { name: DEPARTMENT_NAME_ERROR } : {};
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

type DepartmentDialogProps = {
  open: boolean;
  /** The department being edited; null adds a new one. */
  department: DepartmentDto | null;
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a DepartmentsOperationError when not. */
  onSubmit: (input: DepartmentFormInput, idempotencyKey: string) => Promise<void>;
};

export function DepartmentDialog({ open, department, opener, onClose, onSubmit }: DepartmentDialogProps) {
  const [name, setName] = useState(() => department?.name ?? '');
  const [errors, setErrors] = useState<DepartmentFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setName(department?.name ?? '');
      setErrors({});
      setFormError(null);
      attempt.current = null;
    }
  }, [open, department]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#department-name')?.focus());
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lock.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      if (lock.current) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && event.shiftKey && index <= 0) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (nodes.length && !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const next = validateDepartmentForm(name);
    setErrors(next);
    if (next.name) {
      setFormError(null);
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const input: DepartmentFormInput = { name: name.trim() };
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(departmentSaveErrorMessage(err, input.name));
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
        aria-labelledby="department-dialog-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <Building2 size={18} />
            </div>
            <div>
              <h2 id="department-dialog-title">{department ? `Edit ${department.name}` : 'Add department'}</h2>
            </div>
          </div>
          <button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose} disabled={pending}>
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="engagement-dialog-body end-engagement-fields">
            {formError ? (
              <p className="dialog-validation-summary" role="alert">
                {formError}
              </p>
            ) : errors.name ? (
              <p className="dialog-validation-summary" role="alert">
                Please correct the highlighted fields.
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="department-name">Name</label>
              <input
                id="department-name"
                type="text"
                value={name}
                disabled={pending}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'department-name-error' : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setErrors({});
                }}
              />
              {errors.name ? (
                <small id="department-name-error" className="field-error-text">
                  {errors.name}
                </small>
              ) : null}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save department'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

/** A person who can be put in a department. */
export interface DepartmentEmployeeOption {
  readonly id: string;
  readonly name: string;
  readonly role: CompanyRole;
}

export interface DepartmentMembersInput {
  readonly members: readonly { readonly userId: string; readonly isHead: boolean }[];
}

type MemberChoice = { checked: boolean; isHead: boolean };

type DepartmentMembersDialogProps = {
  open: boolean;
  department: DepartmentDto | null;
  /** The active employees to choose from. */
  employees: readonly DepartmentEmployeeOption[];
  opener?: HTMLElement | null;
  onClose: () => void;
  /** Resolves when saved; rejects with a DepartmentsOperationError when not. */
  onSubmit: (input: DepartmentMembersInput, idempotencyKey: string) => Promise<void>;
};

function initialChoices(department: DepartmentDto | null): Record<string, MemberChoice> {
  const choices: Record<string, MemberChoice> = {};
  for (const member of department?.members ?? []) {
    choices[member.userId] = { checked: true, isHead: member.isHead };
  }
  return choices;
}

export function DepartmentMembersDialog({
  open,
  department,
  employees,
  opener,
  onClose,
  onSubmit,
}: DepartmentMembersDialogProps) {
  const [choices, setChoices] = useState<Record<string, MemberChoice>>(() => initialChoices(department));
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setChoices(initialChoices(department));
      setFormError(null);
      attempt.current = null;
    }
  }, [open, department]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) openerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true;
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('input[type="checkbox"]')?.focus());
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!lock.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      if (lock.current) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && event.shiftKey && index <= 0) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (nodes.length && !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Everyone the person can pick, plus anyone already in the department so a save never drops them silently.
  const people = useMemo<DepartmentEmployeeOption[]>(() => {
    const byId = new Map<string, DepartmentEmployeeOption>();
    for (const employee of employees) byId.set(employee.id, employee);
    for (const member of department?.members ?? []) {
      if (!byId.has(member.userId)) byId.set(member.userId, { id: member.userId, name: member.name, role: member.role });
    }
    return [...byId.values()].sort(
      (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name),
    );
  }, [employees, department]);

  if (!open || !department) return null;

  const choiceOf = (id: string): MemberChoice => choices[id] ?? { checked: false, isHead: false };

  const toggleMember = (id: string, checked: boolean) =>
    setChoices((current) => ({ ...current, [id]: { checked, isHead: checked ? (current[id]?.isHead ?? false) : false } }));
  const toggleHead = (id: string, isHead: boolean) =>
    setChoices((current) => ({ ...current, [id]: { checked: true, isHead } }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const input: DepartmentMembersInput = {
      members: people
        .filter((person) => choiceOf(person.id).checked)
        .map((person) => ({
          userId: person.id,
          isHead: person.role !== 'trainee' && choiceOf(person.id).isHead,
        })),
    };
    attempt.current = nextSaveAttempt(attempt.current, input);
    lock.current = true;
    setPending(true);
    setFormError(null);
    try {
      await onSubmit(input, attempt.current.key);
      onClose();
    } catch (err: unknown) {
      setFormError(departmentSaveErrorMessage(err, department.name));
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
        aria-labelledby="department-members-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <UsersRound size={18} />
            </div>
            <div>
              <h2 id="department-members-title">Members of {department.name}</h2>
            </div>
          </div>
          <button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose} disabled={pending}>
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="engagement-dialog-body end-engagement-fields">
            {formError ? (
              <p className="dialog-validation-summary" role="alert">
                {formError}
              </p>
            ) : null}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {people.map((person) => {
                const choice = choiceOf(person.id);
                const isTrainee = person.role === 'trainee';
                const hintId = `department-member-${person.id}-hint`;
                return (
                  <li
                    key={person.id}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                  >
                    <label
                      htmlFor={`department-member-${person.id}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}
                    >
                      <input
                        id={`department-member-${person.id}`}
                        type="checkbox"
                        checked={choice.checked}
                        disabled={pending}
                        onChange={(event) => toggleMember(person.id, event.target.checked)}
                        style={{ width: 16, height: 16, margin: 0, flex: 'none', accentColor: 'var(--brand)' }}
                      />
                      {person.name}
                      <small style={{ color: 'var(--ink-muted)', fontWeight: 500 }}>{ROLE_LABELS[person.role]}</small>
                    </label>
                    {choice.checked ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {isTrainee ? (
                          <small id={hintId} style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                            {DEPARTMENT_TRAINEE_HEAD_MESSAGE}
                          </small>
                        ) : null}
                        <label
                          htmlFor={`department-head-${person.id}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--ink)', cursor: isTrainee ? 'default' : 'pointer' }}
                        >
                          <input
                            id={`department-head-${person.id}`}
                            type="checkbox"
                            checked={!isTrainee && choice.isHead}
                            disabled={pending || isTrainee}
                            aria-label={`Head, ${person.name}`}
                            aria-describedby={isTrainee ? hintId : undefined}
                            onChange={(event) => toggleHead(person.id, event.target.checked)}
                            style={{ width: 16, height: 16, margin: 0, flex: 'none', accentColor: 'var(--brand)' }}
                          />
                          Head
                        </label>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save members'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
