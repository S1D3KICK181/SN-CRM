// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BillingOperationError } from '../../api/billing-types';
import { InvoiceDetailDrawer } from './invoice-detail-drawer';
import type { InvoiceRecord } from '../../data';

afterEach(() => {
  cleanup();
});

function createInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: '70000000-0000-4000-a000-000000000002',
    invoiceNumber: 'INV-0001002',
    vyaparBillNumber: 'VYP-140',
    clientId: '10000000-0000-4000-a000-000000000001',
    clientCode: 'CL-001001',
    clientName: 'Aster Foods',
    description: 'GST return filing + 1 more',
    invoiceDate: '24/10/2026',
    dueDate: '23/11/2026',
    subtotal: 49560,
    gstAmount: 0,
    total: 49560,
    amountReceived: 16500,
    balance: 33060,
    balancePaise: 3306000,
    status: 'Partly Paid',
    daysOverdue: 0,
    assignmentCode: 'AS-001001',
    notes: 'Quarterly return work, billed in two parts.',
    items: [
      { id: '72000000-0000-4000-a000-000000000002', description: 'GST return filing', quantity: 3, rate: 8000, gstPercent: 0, amount: 24000 },
      { id: '72000000-0000-4000-a000-000000000003', description: 'Reconciliation review', quantity: 1.5, rate: 12000, gstPercent: 0, amount: 18000 },
    ],
    payments: [
      { allocationId: '74000000-0000-4000-a000-000000000001', source: 'payment', receiptId: '73000000-0000-4000-a000-000000000001', receiptNumber: 'RCT-0001001', date: '29/10/2026', amount: 10500, amountPaise: 1050000, voided: false },
      { allocationId: '74000000-0000-4000-a000-000000000002', source: 'payment', receiptId: '73000000-0000-4000-a000-000000000002', receiptNumber: 'RCT-0001002', date: '08/11/2026', amount: 6000, amountPaise: 600000, voided: true },
    ],
    ...overrides,
  };
}

function renderDrawer(
  invoice: InvoiceRecord,
  overrides: Partial<Parameters<typeof InvoiceDetailDrawer>[0]> = {},
) {
  const props = {
    invoice,
    canCancel: true,
    canRecordPayment: true,
    onRecordPayment: vi.fn(),
    onCancelBill: vi.fn(),
    onCancelPayment: vi.fn(),
    creditPaise: 0,
    onUseCredit: vi.fn().mockResolvedValue(undefined),
    onRemoveCredit: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<InvoiceDetailDrawer {...props} />);
  return { ...props, drawer: screen.getByLabelText('Invoice details') };
}

describe('InvoiceDetailDrawer', () => {
  it('shows the Vyapar bill number, CRM ref, client, assignment, dates and notes', () => {
    const { drawer } = renderDrawer(createInvoice());

    expect(within(drawer).getByRole('heading', { level: 2, name: 'VYP-140' })).toBeTruthy();
    expect(within(drawer).getByText('CRM ref INV-0001002')).toBeTruthy();
    expect(within(drawer).getByText('CL-001001 · Aster Foods')).toBeTruthy();
    expect(within(drawer).getByText('AS-001001')).toBeTruthy();
    expect(within(drawer).getByText('24/10/2026')).toBeTruthy();
    expect(within(drawer).getByText('23/11/2026')).toBeTruthy();
    expect(within(drawer).getByText('Quarterly return work, billed in two parts.')).toBeTruthy();
  });

  it('falls back to the CRM code when the bill has no Vyapar number', () => {
    const invoice = createInvoice();
    delete invoice.vyaparBillNumber;
    const { drawer } = renderDrawer(invoice);

    expect(within(drawer).getByRole('heading', { level: 2, name: 'INV-0001002' })).toBeTruthy();
    expect(within(drawer).queryByText(/CRM ref/)).toBeNull();
  });

  it('says Not linked when there is no linked assignment', () => {
    const invoice = createInvoice();
    delete invoice.assignmentCode;
    const { drawer } = renderDrawer(invoice);

    expect(within(drawer).getByText('Not linked')).toBeTruthy();
  });

  it('renders the line items without a tax column and shows Fee, Received and Pending only', () => {
    const { drawer } = renderDrawer(createInvoice());

    for (const header of ['Description', 'Qty', 'Rate', 'Amount']) {
      expect(within(drawer).getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(within(drawer).getAllByRole('columnheader')).toHaveLength(4);
    const row = within(drawer).getByText('Reconciliation review').closest('tr')!;
    expect(within(row).getByText('1.5')).toBeTruthy();
    expect(within(row).getByText('₹12,000')).toBeTruthy();
    expect(within(row).getByText('₹18,000')).toBeTruthy();

    expect(within(drawer).getByText('Fee:').parentElement?.textContent).toContain('₹49,560');
    expect(within(drawer).getByText('Received:').parentElement?.textContent).toContain('₹16,500');
    expect(within(drawer).getByText('Pending:').parentElement?.textContent).toContain('₹33,060');
    expect(within(drawer).queryByText('Subtotal:')).toBeNull();
    expect(within(drawer).queryByText('Total:')).toBeNull();
    expect(within(drawer).queryByText('Balance:')).toBeNull();
    expect(drawer.textContent ?? '').not.toMatch(/GST:|GST %/);
  });

  it('lists payments by receipt code and marks voided receipts', () => {
    const { drawer } = renderDrawer(createInvoice());

    expect(within(drawer).getByText('Payments (2)')).toBeTruthy();
    const first = within(drawer).getByText(/RCT-0001001/).closest('.history-card-row') as HTMLElement;
    expect(first.textContent).toContain('₹10,500');
    expect(first.textContent).toContain('29/10/2026');
    expect(within(first).queryByText('Cancelled')).toBeNull();

    const second = within(drawer).getByText(/RCT-0001002/).closest('.history-card-row') as HTMLElement;
    expect(within(second).getByText('Cancelled')).toBeTruthy();
    expect(within(second).queryByRole('button', { name: /Cancel payment/ })).toBeNull();
  });

  it('says No payments recorded and No line items for an empty draft', () => {
    const { drawer } = renderDrawer(
      createInvoice({ status: 'Draft', items: [], payments: [], total: 0, amountReceived: 0, balance: 0, balancePaise: 0 }),
    );

    expect(within(drawer).getByText('No payments recorded')).toBeTruthy();
    expect(within(drawer).getByText('No line items')).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: /Record payment/i })).toBeNull();
  });

  it('shows the void reason only for a cancelled invoice and offers no Cancel bill for it', () => {
    const { drawer } = renderDrawer(
      createInvoice({ status: 'Cancelled', voidReason: 'Raised against the wrong client', balance: 0, balancePaise: 0, payments: [] }),
    );
    expect(within(drawer).getByText('Cancellation reason')).toBeTruthy();
    expect(within(drawer).getByText('Raised against the wrong client')).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Cancel bill' })).toBeNull();
    cleanup();

    const { drawer: openDrawer } = renderDrawer(createInvoice({ voidReason: 'Should never show' }));
    expect(within(openDrawer).queryByText('Cancellation reason')).toBeNull();
  });

  it('opens Record payment for an open bill', () => {
    const { drawer, onRecordPayment } = renderDrawer(createInvoice());

    const button = within(drawer).getByRole('button', { name: 'Record payment' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onRecordPayment).toHaveBeenCalledWith(button);
  });

  it('hides Record payment when the role cannot record or the bill is not open', () => {
    const { drawer } = renderDrawer(createInvoice(), { canRecordPayment: false });
    expect(within(drawer).queryByRole('button', { name: 'Record payment' })).toBeNull();
    cleanup();

    const paid = renderDrawer(createInvoice({ status: 'Paid', balance: 0, balancePaise: 0 }));
    expect(within(paid.drawer).queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('disables Cancel bill with a note while the bill has received payments', () => {
    const { drawer, onCancelBill } = renderDrawer(createInvoice());

    const button = within(drawer).getByRole('button', { name: 'Cancel bill' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const note = within(drawer).getByText('Cancel the payments and remove any credit on this bill first.');
    expect(button.getAttribute('aria-describedby')).toBe(note.id);
    fireEvent.click(button);
    expect(onCancelBill).not.toHaveBeenCalled();
  });

  it('enables Cancel bill when there are no received payments', () => {
    const { drawer, onCancelBill } = renderDrawer(
      createInvoice({ status: 'Pending', payments: [], amountReceived: 0, balance: 49560, balancePaise: 4956000 }),
    );

    const button = within(drawer).getByRole('button', { name: 'Cancel bill' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(within(drawer).queryByText('Cancel the payments and remove any credit on this bill first.')).toBeNull();
    fireEvent.click(button);
    expect(onCancelBill).toHaveBeenCalledWith(button);
  });

  it('offers Cancel payment on each received payment only, for people who can cancel', () => {
    const { drawer, onCancelPayment } = renderDrawer(createInvoice());

    const buttons = within(drawer).getAllByRole('button', { name: /Cancel payment/ });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onCancelPayment).toHaveBeenCalledWith(
      expect.objectContaining({ receiptNumber: 'RCT-0001001', amountPaise: 1050000 }),
      buttons[0],
    );
    cleanup();

    const staff = renderDrawer(createInvoice(), { canCancel: false });
    expect(within(staff.drawer).queryByRole('button', { name: /Cancel payment/ })).toBeNull();
    expect(within(staff.drawer).queryByRole('button', { name: 'Cancel bill' })).toBeNull();
  });

  it('closes from the close icon and the Close button, and never shows a UUID', () => {
    const { onClose, drawer } = renderDrawer(createInvoice());

    expect(drawer.textContent ?? '').not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

    fireEvent.click(screen.getByLabelText('Close drawer'));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  describe('client credit', () => {
    const creditPayment = {
      allocationId: '74000000-0000-4000-a000-0000000000c1',
      source: 'credit' as const,
      receiptId: '73000000-0000-4000-a000-000000000009',
      receiptNumber: 'RCT-0001009',
      date: '10/11/2026',
      amount: 3000,
      amountPaise: 300000,
      voided: false,
    };

    it('offers Use credit on an open bill when the client has credit and the user can record payments', async () => {
      const onUseCredit = vi.fn().mockResolvedValue(undefined);
      const { drawer } = renderDrawer(createInvoice(), { creditPaise: 500000, onUseCredit });

      expect(within(drawer).getByText('Aster Foods has ₹5,000 credit.')).toBeTruthy();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Use credit' }));
      await waitFor(() => expect(onUseCredit).toHaveBeenCalledTimes(1));
      expect(typeof onUseCredit.mock.calls[0]?.[0]).toBe('string');
    });

    it('hides Use credit with no credit, on a closed bill, or when the user cannot record payments', () => {
      const none = renderDrawer(createInvoice(), { creditPaise: 0 });
      expect(within(none.drawer).queryByText(/credit\./)).toBeNull();
      expect(within(none.drawer).queryByRole('button', { name: 'Use credit' })).toBeNull();
      cleanup();

      const paid = renderDrawer(createInvoice({ status: 'Paid', balance: 0, balancePaise: 0 }), { creditPaise: 500000 });
      expect(within(paid.drawer).queryByRole('button', { name: 'Use credit' })).toBeNull();
      cleanup();

      const cannot = renderDrawer(createInvoice(), { creditPaise: 500000, canRecordPayment: false });
      expect(within(cannot.drawer).queryByRole('button', { name: 'Use credit' })).toBeNull();
    });

    it('shows a server error from Use credit and reuses the key on a retry, then mints a new one after success', async () => {
      const onUseCredit = vi
        .fn()
        .mockRejectedValueOnce(
          new BillingOperationError({ code: 'unexpected', message: 'x', status: 422, serverCode: 'no_credit_available' }),
        )
        .mockResolvedValue(undefined);
      const { drawer } = renderDrawer(createInvoice(), { creditPaise: 500000, onUseCredit });

      fireEvent.click(within(drawer).getByRole('button', { name: 'Use credit' }));
      expect((await within(drawer).findByRole('alert')).textContent).toBe('This client has no credit to use.');
      fireEvent.click(within(drawer).getByRole('button', { name: 'Use credit' }));
      await waitFor(() => expect(onUseCredit).toHaveBeenCalledTimes(2));
      expect(onUseCredit.mock.calls[1]?.[0]).toBe(onUseCredit.mock.calls[0]?.[0]);
      await waitFor(() => expect(within(drawer).queryByRole('alert')).toBeNull());

      fireEvent.click(within(drawer).getByRole('button', { name: 'Use credit' }));
      await waitFor(() => expect(onUseCredit).toHaveBeenCalledTimes(3));
      expect(onUseCredit.mock.calls[2]?.[0]).not.toBe(onUseCredit.mock.calls[0]?.[0]);
    });

    it('lists a credit entry as Credit from the receipt and lets only people who can cancel remove it', async () => {
      const invoice = createInvoice({ payments: [creditPayment] });
      const onRemoveCredit = vi.fn().mockResolvedValue(undefined);
      const { drawer } = renderDrawer(invoice, { onRemoveCredit });

      expect(within(drawer).getByText('Credit from RCT-0001009 · ₹3,000')).toBeTruthy();
      expect(within(drawer).queryByRole('button', { name: /Cancel payment/ })).toBeNull();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Remove credit from RCT-0001009' }));
      await waitFor(() => expect(onRemoveCredit).toHaveBeenCalledTimes(1));
      expect(onRemoveCredit.mock.calls[0]?.[0]).toMatchObject({ allocationId: '74000000-0000-4000-a000-0000000000c1' });
      cleanup();

      const staff = renderDrawer(invoice, { canCancel: false });
      expect(within(staff.drawer).getByText('Credit from RCT-0001009 · ₹3,000')).toBeTruthy();
      expect(within(staff.drawer).queryByRole('button', { name: /Remove credit/ })).toBeNull();
    });

    it('does not offer Remove credit on payment entries', () => {
      const { drawer } = renderDrawer(createInvoice());
      expect(within(drawer).queryByRole('button', { name: /Remove credit/ })).toBeNull();
    });
  });
});
