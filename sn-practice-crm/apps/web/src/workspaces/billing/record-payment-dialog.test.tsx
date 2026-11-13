// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RecordPaymentInput } from '@sn/contracts';
import { BillingOperationError } from '../../api/billing-types';
import type { InvoiceRecord } from '../../data';
import { RecordPaymentDialog } from './record-payment-dialog';

afterEach(cleanup);

const TODAY = '2026-11-13';

const invoice: InvoiceRecord = {
  id: '70000000-0000-4000-a000-000000000002',
  invoiceNumber: 'INV-0001002',
  vyaparBillNumber: 'VYP-140',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientCode: 'CL-001001',
  clientName: 'Aster Foods',
  description: 'Returns',
  invoiceDate: '24/10/2026',
  dueDate: '23/11/2026',
  subtotal: 33060.75,
  gstAmount: 0,
  total: 49560.75,
  amountReceived: 16500,
  balance: 33060.75,
  balancePaise: 3306075,
  status: 'Partly Paid',
  daysOverdue: 0,
};

function setup(onSubmit: (input: RecordPaymentInput, key: string) => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<RecordPaymentDialog open invoice={invoice} today={TODAY} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const submitButton = () => screen.getByRole('button', { name: /^(Record payment|Recording…)$/ }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('RecordPaymentDialog', () => {
  it('renders nothing when closed', () => {
    render(<RecordPaymentDialog open={false} invoice={invoice} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the summary line, defaults and options without any raw id', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    expect(dialog.textContent).toContain('VYP-140 · Aster Foods · ₹33,060.75 pending');
    expect((screen.getByLabelText('Date received') as HTMLInputElement).value).toBe(TODAY);
    expect((screen.getByLabelText('Date received') as HTMLInputElement).max).toBe(TODAY);
    expect((screen.getByLabelText('Cash received (₹)') as HTMLInputElement).value).toBe('33060.75');
    const paidBy = screen.getByLabelText('Paid by') as HTMLSelectElement;
    expect(paidBy.value).toBe('');
    expect([...paidBy.options].map((o) => o.textContent)).toEqual([
      'Choose how it was paid',
      'Bank transfer',
      'UPI',
      'Cash',
      'Cheque',
      'Card',
      'Other',
    ]);
    expect(dialog.textContent).toContain('UTR, cheque or UPI reference.');
    expect(screen.getByLabelText('Notes')).toBeTruthy();
    expect(dialog.textContent ?? '').not.toContain(invoice.id);
  });

  it('shows the validation messages and sends nothing', () => {
    const { onSubmit } = setup();
    type('Date received', '2026-11-14');
    type('Reference', 'r'.repeat(101));
    type('Notes', 'n'.repeat(501));
    fireEvent.click(submitButton());

    for (const message of [
      'The payment date cannot be in the future.',
      'Choose how it was paid.',
      'Use at most 100 characters.',
      'Use at most 500 characters.',
    ]) {
      expect(screen.getByText(message)).toBeTruthy();
    }
    type('Cash received (₹)', '0');
    fireEvent.click(submitButton());
    expect(screen.getByText('Enter an amount above ₹0 with up to 2 decimals.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the full pending amount in exact paise and closes on success', async () => {
    const { onSubmit, onClose } = setup();
    type('Paid by', 'bank_transfer');
    type('Reference', ' UTR123 ');
    fireEvent.click(submitButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        invoiceId: invoice.id,
        receivedOn: TODAY,
        amountPaise: 3306075,
        method: 'bank_transfer',
        reference: 'UTR123',
        notes: null,
      },
      expect.any(String),
    );
  });

  it('disables submit while saving and sends once', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setup(onSubmit);
    type('Paid by', 'cash');
    fireEvent.click(submitButton());

    await waitFor(() => expect(submitButton().textContent).toBe('Recording…'));
    expect(submitButton().disabled).toBe(true);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('reuses the key on an unchanged retry and mints a new one after an edit', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new BillingOperationError({ code: 'network', message: 'down' }));
    setup(onSubmit);
    type('Paid by', 'upi');

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);

    type('Cash received (₹)', '100');
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it.each([
    ['no_credit_available', 'This client has no credit to use.'],
    ['bill_not_open', 'This bill is already paid or cancelled.'],
  ])('keeps the dialog open with the input and shows the %s message', async (serverCode, message) => {
    const onSubmit = vi.fn().mockRejectedValue(
      new BillingOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode }),
    );
    const { onClose } = setup(onSubmit);
    type('Paid by', 'upi');
    type('Cash received (₹)', '500');
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Cash received (₹)') as HTMLInputElement).value).toBe('500');
    expect((screen.getByLabelText('Paid by') as HTMLSelectElement).value).toBe('upi');
  });

  it('shows the permission message for a 403 and never leaks other server text', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new BillingOperationError({ code: 'forbidden', message: 'secret', status: 403 }));
    setup(onSubmit);
    type('Paid by', 'upi');
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
    expect(document.body.textContent).not.toContain('secret');
  });

  it('accepts more cash than is pending, previews the credit and submits the exact paise', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    setup(onSubmit);
    expect(screen.queryByRole('status')).toBeNull();
    type('Cash received (₹)', '34000.50');
    expect(screen.getByRole('status').textContent).toBe(
      '₹33,060.75 pays this bill in full. The extra ₹939.75 is kept as credit for Aster Foods.',
    );
    type('Paid by', 'upi');
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ amountPaise: 3400050 });

    type('Cash received (₹)', '33060.75');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
