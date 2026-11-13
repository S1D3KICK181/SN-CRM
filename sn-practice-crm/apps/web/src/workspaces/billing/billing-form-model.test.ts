import { describe, expect, it } from 'vitest';
import { BillingOperationError } from '../../api/billing-types';
import type { ReceiptRecord } from '../../data';
import {
  addDaysToIsoDate,
  billingSaveErrorMessage,
  billLabel,
  creditByClient,
  creditUsedWarning,
  paymentCreditPreview,
  canRecordPayment,
  initialBillValues,
  initialPaymentValues,
  nextSaveAttempt,
  todayInKolkata,
  toRecordBillInput,
  toRecordPaymentInput,
  validateBillForm,
  validatePaymentForm,
  validateReason,
  type BillFormValues,
  type PaymentFormValues,
} from './billing-form-model';

const TODAY = '2026-11-13';
const CLIENT = '10000000-0000-4000-a000-000000000001';

const validBill: BillFormValues = {
  clientId: CLIENT,
  vyaparBillNumber: ' VYP-140 ',
  billDate: '2026-11-01',
  dueDate: '2026-11-16',
  amount: '2500.5',
  description: '  Returns for October  ',
};
const validPayment: PaymentFormValues = {
  receivedOn: TODAY,
  amount: '1000',
  method: 'upi',
  reference: ' UPI-1 ',
  notes: '',
};

describe('dates', () => {
  it('reads today in Asia/Kolkata, not UTC', () => {
    // 20:00 UTC on 12 Nov is already 13 Nov 01:30 in India.
    expect(todayInKolkata(new Date('2026-11-12T20:00:00Z'))).toBe('2026-11-13');
    expect(todayInKolkata(new Date('2026-11-12T10:00:00Z'))).toBe('2026-11-12');
  });

  it('adds calendar days across month and year ends and rejects bad dates', () => {
    expect(addDaysToIsoDate('2026-11-13', 15)).toBe('2026-11-28');
    expect(addDaysToIsoDate('2026-12-25', 15)).toBe('2027-01-09');
    expect(addDaysToIsoDate('2026-02-30', 15)).toBe('');
    expect(addDaysToIsoDate('', 15)).toBe('');
  });
});

describe('bill labels and eligibility', () => {
  it('prefers the Vyapar number and falls back to the CRM code', () => {
    expect(billLabel({ vyaparBillNumber: 'VYP-1', invoiceNumber: 'INV-1' })).toBe('VYP-1');
    expect(billLabel({ invoiceNumber: 'INV-1' })).toBe('INV-1');
  });

  it('allows payments only on Pending, Partly Paid and Overdue', () => {
    for (const status of ['Pending', 'Partly Paid', 'Overdue'] as const) expect(canRecordPayment({ status })).toBe(true);
    for (const status of ['Paid', 'Draft', 'Cancelled'] as const) expect(canRecordPayment({ status })).toBe(false);
  });
});

describe('record bill form', () => {
  it('defaults to today and 15 days later', () => {
    expect(initialBillValues(TODAY)).toMatchObject({ billDate: TODAY, dueDate: '2026-11-28', clientId: '' });
  });

  it('accepts a valid bill and builds the payload in paise', () => {
    expect(validateBillForm(validBill, TODAY)).toEqual({});
    expect(toRecordBillInput(validBill)).toEqual({
      clientId: CLIENT,
      vyaparBillNumber: 'VYP-140',
      billDate: '2026-11-01',
      dueDate: '2026-11-16',
      amountPaise: 250050,
      description: 'Returns for October',
    });
  });

  it('returns each validation message', () => {
    const errors = validateBillForm(
      { clientId: '', vyaparBillNumber: '  ', billDate: '', dueDate: '', amount: '0', description: 'x' },
      TODAY,
    );
    expect(errors).toMatchObject({
      clientId: 'Choose a client.',
      vyaparBillNumber: 'Enter the Vyapar bill number.',
      billDate: 'Enter the bill date.',
      amount: 'Enter an amount above ₹0 with up to 2 decimals.',
      description: 'Describe what was billed in 2 to 300 characters.',
    });
    expect(validateBillForm({ ...validBill, vyaparBillNumber: 'x'.repeat(31) }, TODAY).vyaparBillNumber).toBe(
      'Use at most 30 characters.',
    );
    expect(validateBillForm({ ...validBill, billDate: '2026-11-14', dueDate: '2026-11-30' }, TODAY).billDate).toBe(
      'The bill date cannot be in the future.',
    );
    expect(validateBillForm({ ...validBill, dueDate: '2026-10-31' }, TODAY).dueDate).toBe(
      'The due date cannot be before the bill date.',
    );
    expect(validateBillForm({ ...validBill, amount: '10.123' }, TODAY).amount).toBe(
      'Enter an amount above ₹0 with up to 2 decimals.',
    );
    expect(validateBillForm({ ...validBill, description: 'y'.repeat(301) }, TODAY).description).toBe(
      'Describe what was billed in 2 to 300 characters.',
    );
  });
});

describe('record payment form', () => {
  it('defaults to today and the full pending amount in exact paise', () => {
    expect(initialPaymentValues(TODAY, 3306075)).toEqual({
      receivedOn: TODAY,
      amount: '33060.75',
      method: '',
      reference: '',
      notes: '',
    });
  });

  it('builds the payload, trimming optional text to null when empty', () => {
    const options = { today: TODAY };
    expect(validatePaymentForm(validPayment, options)).toEqual({});
    expect(toRecordPaymentInput('inv-id', validPayment)).toEqual({
      invoiceId: 'inv-id',
      receivedOn: TODAY,
      amountPaise: 100000,
      method: 'upi',
      reference: 'UPI-1',
      notes: null,
    });
  });

  it('returns each validation message', () => {
    const options = { today: TODAY };
    expect(validatePaymentForm({ ...validPayment, receivedOn: '2026-11-14' }, options).receivedOn).toBe(
      'The payment date cannot be in the future.',
    );
    expect(validatePaymentForm({ ...validPayment, amount: '' }, options).amount).toBe(
      'Enter an amount above ₹0 with up to 2 decimals.',
    );
    expect(validatePaymentForm({ ...validPayment, amount: '99999.99' }, options).amount).toBeUndefined();
    expect(validatePaymentForm({ ...validPayment, method: '' }, options).method).toBe('Choose how it was paid.');
    expect(validatePaymentForm({ ...validPayment, reference: 'r'.repeat(101) }, options).reference).toBe(
      'Use at most 100 characters.',
    );
    expect(validatePaymentForm({ ...validPayment, notes: 'n'.repeat(501) }, options).notes).toBe(
      'Use at most 500 characters.',
    );
  });
});

describe('cancel reason', () => {
  it('needs 3 to 500 characters after trimming', () => {
    expect(validateReason('  ab ')).toBe('Give a reason of at least 3 characters.');
    expect(validateReason('abc')).toBeNull();
    expect(validateReason('a'.repeat(501))).toBe('Give a reason of at least 3 characters.');
  });
});

describe('idempotency key reuse', () => {
  it('reuses the key for an unchanged payload and mints a new one when it changed', () => {
    let n = 0;
    const make = () => `key-${++n}`;
    const first = nextSaveAttempt(null, { a: 1 }, make);
    expect(first.key).toBe('key-1');
    expect(nextSaveAttempt(first, { a: 1 }, make)).toBe(first);
    expect(nextSaveAttempt(first, { a: 2 }, make).key).toBe('key-2');
  });

  it('uses a real UUID by default', () => {
    expect(nextSaveAttempt(null, {}).key).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('save error copy', () => {
  const err = (serverCode?: string, code: BillingOperationError['code'] = 'unexpected', status?: number) =>
    new BillingOperationError({ code, message: 'raw', serverCode, status });

  it.each([
    ['duplicate_vyapar_bill', 'This Vyapar bill number is already recorded for this financial year.'],
    ['no_credit_available', 'This client has no credit to use.'],
    ['not_credit_allocation', 'This is a direct payment. Cancel the payment instead.'],
    ['bill_not_open', 'This bill is already paid or cancelled.'],
    ['bill_has_payments', 'Cancel the payments and remove any credit on this bill first.'],
    ['already_voided', 'This record is already cancelled.'],
  ])('maps %s', (serverCode, message) => {
    expect(billingSaveErrorMessage(err(serverCode, 'unexpected', 409))).toBe(message);
  });

  it('maps 403, falls back to the sanitized generic copy and ignores unknown or prototype codes', () => {
    expect(billingSaveErrorMessage(err(undefined, 'forbidden', 403))).toBe("You don't have permission to do this.");
    expect(billingSaveErrorMessage(err('something_else'))).not.toContain('raw');
    expect(billingSaveErrorMessage(err('constructor'))).not.toContain('function');
    expect(billingSaveErrorMessage(new Error('boom'))).not.toContain('boom');
  });
});

describe('client credit helpers', () => {
  const receipt = (overrides: Partial<ReceiptRecord>): ReceiptRecord => ({
    id: 'r1',
    receiptNumber: 'RCT-1',
    clientId: 'c1',
    clientName: 'Aster Foods',
    invoiceId: '',
    invoiceNumber: '',
    receiptDate: '01/11/2026',
    amount: 0,
    amountPaise: 0,
    paymentMode: 'UPI',
    referenceNumber: '',
    notes: '',
    status: 'Received',
    ...overrides,
  });

  it('adds up the credit kept on Received receipts for each client', () => {
    const credit = creditByClient([
      receipt({ id: 'a', unallocatedPaise: 50000 }),
      receipt({ id: 'b', unallocatedPaise: 25050 }),
      receipt({ id: 'c', clientId: 'c2', unallocatedPaise: 10000 }),
      receipt({ id: 'd', unallocatedPaise: 999900, status: 'Voided' }),
      receipt({ id: 'e', unallocatedPaise: 0 }),
      receipt({ id: 'f' }),
    ]);
    expect(credit.get('c1')).toBe(75050);
    expect(credit.get('c2')).toBe(10000);
    expect(credit.size).toBe(2);
    expect(creditByClient([]).size).toBe(0);
  });

  it('previews the credit only when the cash is more than the pending amount', () => {
    expect(paymentCreditPreview('2000', 150000, 'Aster Foods')).toBe(
      '₹1,500 pays this bill in full. The extra ₹500 is kept as credit for Aster Foods.',
    );
    expect(paymentCreditPreview('1500', 150000, 'Aster Foods')).toBeNull();
    expect(paymentCreditPreview('100', 150000, 'Aster Foods')).toBeNull();
    expect(paymentCreditPreview('abc', 150000, 'Aster Foods')).toBeNull();
  });

  it('warns only about credit allocations and names bills by their Vyapar number', () => {
    const invoices = [
      { id: 'i1', vyaparBillNumber: 'VYP-141', invoiceNumber: 'INV-2' },
      { id: 'i2', invoiceNumber: 'INV-3' },
    ];
    const used = receipt({
      allocations: [
        { allocationId: 'x1', source: 'payment', invoiceId: 'i0', invoiceNumber: 'INV-1', amount: 2000 },
        { allocationId: 'x2', source: 'credit', invoiceId: 'i1', invoiceNumber: 'INV-2', amount: 1000.5 },
        { allocationId: 'x3', source: 'credit', invoiceId: 'i2', invoiceNumber: 'INV-3', amount: 500 },
      ],
    });
    expect(creditUsedWarning(used, invoices)).toBe(
      '₹1,500.50 of this payment is used as credit on VYP-141, INV-3. Those bills will show it as pending again.',
    );
    expect(creditUsedWarning(receipt({ allocations: used.allocations?.slice(0, 1) }), invoices)).toBeNull();
    expect(creditUsedWarning(undefined, invoices)).toBeNull();
  });

  it('adds applyCredit to the bill payload only when it is given', () => {
    expect(toRecordBillInput(validBill)).not.toHaveProperty('applyCredit');
    expect(toRecordBillInput(validBill, true).applyCredit).toBe(true);
    expect(toRecordBillInput(validBill, false).applyCredit).toBe(false);
  });
});
