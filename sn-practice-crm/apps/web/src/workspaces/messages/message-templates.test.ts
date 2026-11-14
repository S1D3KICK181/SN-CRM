import { describe, expect, it } from 'vitest';
import {
  buildMessageDraft,
  formatWhatsAppNumber,
  greetingName,
  normalizeWhatsAppNumber,
  whatsAppLink,
} from './message-templates';

describe('normalizeWhatsAppNumber', () => {
  it.each([
    ['98200 12345', '919820012345'],
    ['+91 98200-12345', '919820012345'],
    ['6000000000', '916000000000'],
    ['919820012345', '919820012345'],
    ['+44 7911 123456', '447911123456'],
    ['+1 (415) 555-2671', '14155552671'],
    ['098200 12345', '919820012345'],
    ['0091 98200 12345', '919820012345'],
  ])('turns %s into %s', (typed, expected) => {
    expect(normalizeWhatsAppNumber(typed)).toBe(expected);
  });

  it.each(['', 'no number', '12345', '5820012345', '98200 1234', '1234567890123456'])('refuses %s', (typed) => {
    expect(normalizeWhatsAppNumber(typed)).toBeNull();
  });
});

describe('formatWhatsAppNumber', () => {
  it('groups an Indian number and prefixes any other with a plus', () => {
    expect(formatWhatsAppNumber('9820012345')).toBe('+91 98200 12345');
    expect(formatWhatsAppNumber('+91 98200 12345')).toBe('+91 98200 12345');
    expect(formatWhatsAppNumber('447911123456')).toBe('+447911123456');
  });

  it('returns a value that is not a number as typed', () => {
    expect(formatWhatsAppNumber(' 12345 ')).toBe('12345');
  });
});

describe('whatsAppLink', () => {
  it('builds a click-to-chat link with the encoded text', () => {
    expect(whatsAppLink('98200 12345', 'Dear Sir/Madam, pay ₹1,200 & relax?')).toBe(
      'https://wa.me/919820012345?text=Dear%20Sir%2FMadam%2C%20pay%20%E2%82%B91%2C200%20%26%20relax%3F',
    );
  });

  it('uses the digits of a number that was already normalised', () => {
    expect(whatsAppLink('919820012345', 'Hi')).toBe('https://wa.me/919820012345?text=Hi');
  });
});

describe('greetingName', () => {
  it('uses the first name, or Sir/Madam when none is known', () => {
    expect(greetingName('Rahul Shah')).toBe('Rahul');
    expect(greetingName('  Rahul ')).toBe('Rahul');
    expect(greetingName('Priya')).toBe('Priya');
    expect(greetingName(null)).toBe('Sir/Madam');
    expect(greetingName(undefined)).toBe('Sir/Madam');
    expect(greetingName('   ')).toBe('Sir/Madam');
  });
});

describe('buildMessageDraft', () => {
  it('asks for the documents of a named assignment', () => {
    expect(
      buildMessageDraft('document_request', { contactName: 'Rahul Shah', assignmentTitle: 'GSTR-1 & 3B Compliance · Oct 2026' }),
    ).toBe(
      'Dear Rahul, this is a reminder from SN & Associates. Please share the documents needed for GSTR-1 & 3B Compliance · Oct 2026 at the earliest. Thank you.',
    );
  });

  it('asks for the documents we requested when no assignment is linked', () => {
    expect(buildMessageDraft('document_request', {})).toBe(
      'Dear Sir/Madam, this is a reminder from SN & Associates. Please share the documents we requested at the earliest. Thank you.',
    );
  });

  it('reminds of a deadline with the due date', () => {
    expect(
      buildMessageDraft('deadline_reminder', {
        contactName: 'Rahul Shah',
        assignmentTitle: 'GSTR-1 & 3B Compliance · Oct 2026',
        assignmentDueOn: '11/11/2026',
      }),
    ).toBe(
      'Dear Rahul, a reminder from SN & Associates: GSTR-1 & 3B Compliance · Oct 2026 is due on 11/11/2026. Please share any pending information so we can complete it on time. Thank you.',
    );
  });

  it('reminds of a payment with the amount pending in en-IN format', () => {
    expect(
      buildMessageDraft('payment_reminder', {
        contactName: 'Rahul Shah',
        billNumber: 'VYP-140',
        billDate: '24/10/2026',
        billDueDate: '23/11/2026',
        billPendingPaise: 3306000,
        billOverdue: false,
      }),
    ).toBe(
      'Dear Rahul, a gentle reminder from SN & Associates: ₹33,060 is pending on bill VYP-140 dated 24/10/2026. Kindly arrange the payment at your convenience. Thank you.',
    );
  });

  it('keeps paise in the amount and says when an overdue bill was due', () => {
    expect(
      buildMessageDraft('payment_reminder', {
        billNumber: 'VYP-141',
        billDate: '01/09/2026',
        billDueDate: '16/09/2026',
        billPendingPaise: 12345050,
        billOverdue: true,
      }),
    ).toBe(
      'Dear Sir/Madam, a gentle reminder from SN & Associates: ₹1,23,450.50 is pending on bill VYP-141 dated 01/09/2026. It was due on 16/09/2026. Kindly arrange the payment at your convenience. Thank you.',
    );
  });

  it('starts a general message as the greeting alone', () => {
    expect(buildMessageDraft('general', { contactName: 'Rahul Shah' })).toBe('Dear Rahul, ');
    expect(buildMessageDraft('general')).toBe('Dear Sir/Madam, ');
  });

  it('starts a reminder with no linked work as the greeting alone, for the user to finish', () => {
    expect(buildMessageDraft('deadline_reminder', { contactName: 'Rahul Shah' })).toBe('Dear Rahul, ');
    expect(buildMessageDraft('payment_reminder', {})).toBe('Dear Sir/Madam, ');
  });

  it('never mentions tax', () => {
    const drafts = [
      buildMessageDraft('document_request', { assignmentTitle: 'Return' }),
      buildMessageDraft('deadline_reminder', { assignmentTitle: 'Return', assignmentDueOn: '11/11/2026' }),
      buildMessageDraft('payment_reminder', { billNumber: 'B1', billDate: '01/01/2026', billPendingPaise: 100, billOverdue: true, billDueDate: '10/01/2026' }),
    ];
    for (const draft of drafts) expect(draft).not.toMatch(/\b(gst|tax)\b/i);
  });
});
