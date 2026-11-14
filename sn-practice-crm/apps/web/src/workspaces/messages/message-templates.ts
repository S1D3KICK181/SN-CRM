import type { MessagePurpose } from '@sn/contracts';
import { formatINR } from '../../data';

export const FIRM_NAME = 'SN & Associates';
export const MESSAGE_BODY_MAX = 2000;
export const WHATSAPP_NUMBER_ERROR = 'Enter a WhatsApp number with 10 digits, or with the country code.';
export const MESSAGE_BODY_ERROR = 'The message must be between 1 and 2000 characters.';

/**
 * Keeps the digits of a number. A 10-digit Indian mobile number (starting 6 to 9) gets the 91 prefix;
 * anything else must already be 11 to 15 digits including the country code. Returns null otherwise.
 * Mirrors the API, which is the one that decides.
 */
export function normalizeWhatsAppNumber(value: string): string | null {
  // Mirrors the server: 098200 12345 and 0091 98200 12345 both mean +91 98200 12345.
  const digits = value.replace(/\D/g, '').replace(/^00(?=91[6-9]\d{9}$)/, '').replace(/^0(?=[6-9]\d{9}$)/, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  return /^\d{11,15}$/.test(digits) ? digits : null;
}

/** "+91 98200 12345" for an Indian number, "+<digits>" for any other. A value that is not a number is returned as typed. */
export function formatWhatsAppNumber(value: string): string {
  const digits = normalizeWhatsAppNumber(value);
  if (digits === null) return value.trim();
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return `+${digits}`;
}

/** The click-to-chat link that opens WhatsApp with the text ready for the user to send. */
export function whatsAppLink(number: string, body: string): string {
  const digits = normalizeWhatsAppNumber(number) ?? number.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

/** The contact's first name, or "Sir/Madam" when no name is known. */
export function greetingName(contactName: string | null | undefined): string {
  const first = contactName?.trim().split(/\s+/)[0];
  return first ? first : 'Sir/Madam';
}

export interface MessageDraftContext {
  /** The contact's full name; null or blank when the person is not a known contact. */
  readonly contactName?: string | null;
  /** The linked assignment's title, and its due date as DD/MM/YYYY. */
  readonly assignmentTitle?: string | null;
  readonly assignmentDueOn?: string | null;
  /** The linked bill: its Vyapar number, its date and due date as DD/MM/YYYY, and what is pending in paise. */
  readonly billNumber?: string | null;
  readonly billDate?: string | null;
  readonly billDueDate?: string | null;
  readonly billPendingPaise?: number | null;
  readonly billOverdue?: boolean;
}

/**
 * The default text for a purpose, which the user may edit before sending. A reminder with no linked
 * work to name starts as the greeting alone, so the user writes the rest.
 */
export function buildMessageDraft(purpose: MessagePurpose, context: MessageDraftContext = {}): string {
  const greeting = `Dear ${greetingName(context.contactName)}, `;

  switch (purpose) {
    case 'document_request': {
      const what = context.assignmentTitle ? `the documents needed for ${context.assignmentTitle}` : 'the documents we requested';
      return `${greeting}this is a reminder from ${FIRM_NAME}. Please share ${what} at the earliest. Thank you.`;
    }
    case 'deadline_reminder': {
      if (!context.assignmentTitle || !context.assignmentDueOn) return greeting;
      return `${greeting}a reminder from ${FIRM_NAME}: ${context.assignmentTitle} is due on ${context.assignmentDueOn}. Please share any pending information so we can complete it on time. Thank you.`;
    }
    case 'payment_reminder': {
      const { billNumber, billDate, billDueDate, billPendingPaise } = context;
      if (!billNumber || !billDate || billPendingPaise === null || billPendingPaise === undefined) return greeting;
      const overdue = context.billOverdue && billDueDate ? ` It was due on ${billDueDate}.` : '';
      return `${greeting}a gentle reminder from ${FIRM_NAME}: ${formatINR(billPendingPaise / 100)} is pending on bill ${billNumber} dated ${billDate}.${overdue} Kindly arrange the payment at your convenience. Thank you.`;
    }
    case 'general':
      return greeting;
  }
}
