import type { PaymentMethod, RecordPaymentInput, RecordVyaparBillInput } from '@sn/contracts';
import { sanitizeBillingError } from '../../api/billing-types';
import { formatINR, type InvoiceRecord } from '../../data';
import { parseRupeeToPaise } from '../engagements/engagement-draft-form-model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar date in Asia/Kolkata as YYYY-MM-DD. */
export function todayInKolkata(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === day;
}

/** Calendar-day arithmetic on a YYYY-MM-DD string. Returns '' for an invalid date. */
export function addDaysToIsoDate(value: string, days: number): string {
  if (!isRealIsoDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

/** The bill number shown to people: the Vyapar number, or the CRM code on older rows. */
export function billLabel(invoice: Pick<InvoiceRecord, 'vyaparBillNumber' | 'invoiceNumber'>): string {
  return invoice.vyaparBillNumber ?? invoice.invoiceNumber;
}

/** Bills that can still take a payment. */
export function canRecordPayment(invoice: Pick<InvoiceRecord, 'status'>): boolean {
  return invoice.status === 'Pending' || invoice.status === 'Partly Paid' || invoice.status === 'Overdue';
}

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export const DUE_DAYS_DEFAULT = 15;
export const AMOUNT_ERROR = 'Enter an amount above ₹0 with up to 2 decimals.';

// ---------------------------------------------------------------------------
// Record Vyapar bill
// ---------------------------------------------------------------------------

export interface BillFormValues {
  clientId: string;
  vyaparBillNumber: string;
  billDate: string;
  dueDate: string;
  amount: string;
  description: string;
}

export type BillFormErrors = Partial<Record<keyof BillFormValues, string>>;

export function initialBillValues(today: string): BillFormValues {
  return {
    clientId: '',
    vyaparBillNumber: '',
    billDate: today,
    dueDate: addDaysToIsoDate(today, DUE_DAYS_DEFAULT),
    amount: '',
    description: '',
  };
}

export function validateBillForm(values: BillFormValues, today: string): BillFormErrors {
  const errors: BillFormErrors = {};
  if (!values.clientId) errors.clientId = 'Choose a client.';
  const number = values.vyaparBillNumber.trim();
  if (number.length === 0) errors.vyaparBillNumber = 'Enter the Vyapar bill number.';
  else if (number.length > 30) errors.vyaparBillNumber = 'Use at most 30 characters.';
  const billDateOk = isRealIsoDate(values.billDate);
  if (!billDateOk) errors.billDate = 'Enter the bill date.';
  else if (values.billDate > today) errors.billDate = 'The bill date cannot be in the future.';
  if (!isRealIsoDate(values.dueDate)) errors.dueDate = 'Enter the due date.';
  else if (billDateOk && values.dueDate < values.billDate) {
    errors.dueDate = 'The due date cannot be before the bill date.';
  }
  const paise = parseRupeeToPaise(values.amount);
  if (paise === null || paise <= 0) errors.amount = AMOUNT_ERROR;
  const description = values.description.trim();
  if (description.length < 2 || description.length > 300) {
    errors.description = 'Describe what was billed in 2 to 300 characters.';
  }
  return errors;
}

/** Call only after validateBillForm returned no errors. */
export function toRecordBillInput(values: BillFormValues): RecordVyaparBillInput {
  const amountPaise = parseRupeeToPaise(values.amount);
  if (amountPaise === null || amountPaise <= 0) throw new Error('invalid bill amount');
  return {
    clientId: values.clientId,
    vyaparBillNumber: values.vyaparBillNumber.trim(),
    billDate: values.billDate,
    dueDate: values.dueDate,
    amountPaise,
    description: values.description.trim(),
  };
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------

export interface PaymentFormValues {
  receivedOn: string;
  amount: string;
  method: PaymentMethod | '';
  reference: string;
  notes: string;
}

export type PaymentFormErrors = Partial<Record<keyof PaymentFormValues, string>>;

/** Exact paise as a plain rupee string, for the amount input default. */
export function paiseToInputString(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

export function initialPaymentValues(today: string, pendingPaise: number): PaymentFormValues {
  return { receivedOn: today, amount: paiseToInputString(pendingPaise), method: '', reference: '', notes: '' };
}

export function validatePaymentForm(
  values: PaymentFormValues,
  options: { today: string; pendingPaise: number },
): PaymentFormErrors {
  const errors: PaymentFormErrors = {};
  if (!isRealIsoDate(values.receivedOn)) errors.receivedOn = 'Enter the date received.';
  else if (values.receivedOn > options.today) errors.receivedOn = 'The payment date cannot be in the future.';
  const paise = parseRupeeToPaise(values.amount);
  if (paise === null || paise <= 0) errors.amount = AMOUNT_ERROR;
  else if (paise > options.pendingPaise) {
    errors.amount = `The amount is more than the ${formatINR(options.pendingPaise / 100)} still pending.`;
  }
  if (!values.method) errors.method = 'Choose how it was paid.';
  if (values.reference.trim().length > 100) errors.reference = 'Use at most 100 characters.';
  if (values.notes.trim().length > 500) errors.notes = 'Use at most 500 characters.';
  return errors;
}

/** Call only after validatePaymentForm returned no errors. */
export function toRecordPaymentInput(invoiceId: string, values: PaymentFormValues): RecordPaymentInput {
  const amountPaise = parseRupeeToPaise(values.amount);
  if (amountPaise === null || amountPaise <= 0 || !values.method) throw new Error('invalid payment');
  return {
    invoiceId,
    receivedOn: values.receivedOn,
    amountPaise,
    method: values.method,
    reference: values.reference.trim() || null,
    notes: values.notes.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Cancel (void) reason
// ---------------------------------------------------------------------------

export const REASON_ERROR = 'Give a reason of at least 3 characters.';

export function validateReason(reason: string): string | null {
  const length = reason.trim().length;
  return length >= 3 && length <= 500 ? null : REASON_ERROR;
}

// ---------------------------------------------------------------------------
// Saving: idempotency key reuse and error copy
// ---------------------------------------------------------------------------

export interface SaveAttempt {
  readonly key: string;
  readonly payload: string;
}

/**
 * Reuse the previous key when the payload is unchanged (a retry after a network failure
 * cannot record twice); mint a new one when the payload changed.
 */
export function nextSaveAttempt(
  previous: SaveAttempt | null,
  payload: unknown,
  makeKey: () => string = () => crypto.randomUUID(),
): SaveAttempt {
  const serialized = JSON.stringify(payload);
  if (previous && previous.payload === serialized) return previous;
  return { key: makeKey(), payload: serialized };
}

const SERVER_CODE_MESSAGES: Readonly<Record<string, string>> = {
  duplicate_vyapar_bill: 'This Vyapar bill number is already recorded for this financial year.',
  payment_exceeds_balance: 'The payment is more than what is still pending on this bill.',
  bill_not_open: 'This bill is already paid or cancelled.',
  bill_has_payments: 'Cancel the payments on this bill first.',
  already_voided: 'This record is already cancelled.',
};

export const FORBIDDEN_MESSAGE = "You don't have permission to do this.";

/** User-facing copy for a failed save. Never reflects raw server text. */
export function billingSaveErrorMessage(err: unknown): string {
  const safe = sanitizeBillingError(err);
  if (safe.serverCode && Object.prototype.hasOwnProperty.call(SERVER_CODE_MESSAGES, safe.serverCode)) {
    return SERVER_CODE_MESSAGES[safe.serverCode] ?? safe.message;
  }
  if (safe.code === 'forbidden' || safe.status === 403) return FORBIDDEN_MESSAGE;
  return safe.message;
}
