// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { InvoiceDetailDrawer } from './invoice-detail-drawer';
import type { InvoiceRecord } from '../../data';

afterEach(() => {
  cleanup();
});

const NOTE_ID = 'billing-read-only-note';

function createInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: '70000000-0000-4000-a000-000000000002',
    invoiceNumber: 'INV-0001002',
    clientId: '10000000-0000-4000-a000-000000000001',
    clientCode: 'CL-001001',
    clientName: 'Aster Foods',
    description: 'GST return filing + 1 more',
    invoiceDate: '24/10/2026',
    dueDate: '23/11/2026',
    subtotal: 42000,
    gstAmount: 7560,
    total: 49560,
    amountReceived: 16500,
    balance: 33060,
    status: 'Partially Paid',
    daysOverdue: 0,
    assignmentCode: 'AS-001001',
    notes: 'Quarterly GST compliance, billed in two parts.',
    items: [
      { id: '72000000-0000-4000-a000-000000000002', description: 'GST return filing', quantity: 3, rate: 8000, gstPercent: 18, amount: 24000 },
      { id: '72000000-0000-4000-a000-000000000003', description: 'GST reconciliation review', quantity: 1.5, rate: 12000, gstPercent: 18, amount: 18000 },
    ],
    payments: [
      { receiptNumber: 'RCT-0001001', date: '29/10/2026', amount: 10500, voided: false },
      { receiptNumber: 'RCT-0001002', date: '08/11/2026', amount: 6000, voided: true },
    ],
    ...overrides,
  };
}

function renderDrawer(invoice: InvoiceRecord, onClose = vi.fn()) {
  render(
    <>
      <p id={NOTE_ID}>Read-only for now: raising invoices and recording receipts are not available yet.</p>
      <InvoiceDetailDrawer invoice={invoice} readOnlyNoteId={NOTE_ID} onClose={onClose} />
    </>,
  );
  return { onClose, drawer: screen.getByLabelText('Invoice details') };
}

describe('InvoiceDetailDrawer', () => {
  it('shows the invoice code, client code and name, assignment, dates and notes', () => {
    const { drawer } = renderDrawer(createInvoice());

    expect(within(drawer).getByRole('heading', { level: 2, name: 'INV-0001002' })).toBeTruthy();
    expect(within(drawer).getByText('CL-001001 · Aster Foods')).toBeTruthy();
    expect(within(drawer).getByText('AS-001001')).toBeTruthy();
    expect(within(drawer).getByText('24/10/2026')).toBeTruthy();
    expect(within(drawer).getByText('23/11/2026')).toBeTruthy();
    expect(within(drawer).getByText('Quarterly GST compliance, billed in two parts.')).toBeTruthy();
  });

  it('says Not linked when there is no linked assignment', () => {
    const invoice = createInvoice();
    delete invoice.assignmentCode;
    const { drawer } = renderDrawer(invoice);

    expect(within(drawer).getByText('Not linked')).toBeTruthy();
  });

  it('renders the line items table and the totals', () => {
    const { drawer } = renderDrawer(createInvoice());

    for (const header of ['Description', 'Qty', 'Rate', 'GST %', 'Amount']) {
      expect(within(drawer).getByRole('columnheader', { name: header })).toBeTruthy();
    }
    const row = within(drawer).getByText('GST reconciliation review').closest('tr')!;
    expect(within(row).getByText('1.5')).toBeTruthy();
    expect(within(row).getByText('₹12,000')).toBeTruthy();
    expect(within(row).getByText('18%')).toBeTruthy();
    expect(within(row).getByText('₹18,000')).toBeTruthy();

    expect(within(drawer).getByText('Subtotal:').parentElement?.textContent).toContain('₹42,000');
    expect(within(drawer).getByText('GST:').parentElement?.textContent).toContain('₹7,560');
    expect(within(drawer).getByText('Total:').parentElement?.textContent).toContain('₹49,560');
    expect(within(drawer).getByText('Received:').parentElement?.textContent).toContain('₹16,500');
    expect(within(drawer).getByText('Balance:').parentElement?.textContent).toContain('₹33,060');
  });

  it('lists payments by receipt code and marks voided receipts', () => {
    const { drawer } = renderDrawer(createInvoice());

    expect(within(drawer).getByText('Payments (2)')).toBeTruthy();
    const first = within(drawer).getByText(/RCT-0001001/).closest('.history-card-row') as HTMLElement;
    expect(first.textContent).toContain('₹10,500');
    expect(first.textContent).toContain('29/10/2026');
    expect(within(first).queryByText('Voided')).toBeNull();

    const second = within(drawer).getByText(/RCT-0001002/).closest('.history-card-row') as HTMLElement;
    expect(within(second).getByText('Voided')).toBeTruthy();
  });

  it('says No payments recorded and No line items for an empty draft', () => {
    const { drawer } = renderDrawer(
      createInvoice({
        status: 'Draft',
        items: [],
        payments: [],
        subtotal: 0,
        gstAmount: 0,
        total: 0,
        amountReceived: 0,
        balance: 0,
      }),
    );

    expect(within(drawer).getByText('No payments recorded')).toBeTruthy();
    expect(within(drawer).getByText('No line items')).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: /Record payment/i })).toBeNull();
  });

  it('shows the void reason only for a cancelled invoice', () => {
    const { drawer } = renderDrawer(
      createInvoice({ status: 'Cancelled', voidReason: 'Raised against the wrong client', balance: 0 }),
    );
    expect(within(drawer).getByText('Void Reason')).toBeTruthy();
    expect(within(drawer).getByText('Raised against the wrong client')).toBeTruthy();
    cleanup();

    const { drawer: openDrawer } = renderDrawer(createInvoice({ voidReason: 'Should never show' }));
    expect(within(openDrawer).queryByText('Void Reason')).toBeNull();
  });

  it('keeps Record payment visible but disabled, described by the page note', () => {
    const { drawer } = renderDrawer(createInvoice());

    const button = within(drawer).getByRole('button', { name: /Record payment/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(NOTE_ID);
    expect(document.getElementById(NOTE_ID)).toBeTruthy();
  });

  it('closes from the close icon and the Close button, and never shows a UUID', () => {
    const { onClose, drawer } = renderDrawer(createInvoice());

    expect(drawer.textContent ?? '').not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);

    fireEvent.click(screen.getByLabelText('Close drawer'));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
