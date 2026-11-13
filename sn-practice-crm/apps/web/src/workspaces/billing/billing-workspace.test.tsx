// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { BillingWorkspace } from './billing-workspace';
import type { InvoiceRecord, ReceiptRecord } from '../../data';

afterEach(() => {
  cleanup();
});

const READ_ONLY_NOTE = 'Read-only for now: raising invoices and recording receipts are not available yet.';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function createInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: '70000000-0000-4000-a000-000000000001',
    invoiceNumber: 'INV-0001001',
    clientId: '10000000-0000-4000-a000-000000000001',
    clientCode: 'CL-001001',
    clientName: 'Aster Foods',
    description: 'Statutory Audit Fee',
    invoiceDate: '15/10/2026',
    dueDate: '31/10/2026',
    subtotal: 50000,
    gstAmount: 9000,
    total: 59000,
    amountReceived: 0,
    balance: 59000,
    status: 'Unpaid',
    daysOverdue: 0,
    items: [],
    payments: [],
    ...overrides,
  };
}

function createReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: '71000000-0000-4000-a000-000000000001',
    receiptNumber: 'RCT-0001001',
    clientId: '10000000-0000-4000-a000-000000000001',
    clientName: 'Aster Foods',
    invoiceId: '70000000-0000-4000-a000-000000000001',
    invoiceNumber: 'INV-0001001',
    receiptDate: '20/10/2026',
    amount: 59000,
    paymentMode: 'Bank transfer',
    referenceNumber: 'NEFT-AST-01001',
    notes: 'Payment received',
    status: 'Received',
    allocations: [
      { invoiceId: '70000000-0000-4000-a000-000000000001', invoiceNumber: 'INV-0001001', amount: 59000 },
    ],
    unallocated: 0,
    ...overrides,
  };
}

function renderWorkspace(
  role: Parameters<typeof BillingWorkspace>[0]['role'],
  overrides: Partial<Parameters<typeof BillingWorkspace>[0]> = {},
) {
  const props = {
    role,
    model: { invoices: [], receipts: [] },
    loading: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  return { ...render(<BillingWorkspace {...props} />), onRetry: props.onRetry };
}

describe('BillingWorkspace', () => {
  it.each(['senior_staff', 'staff', 'trainee'] as const)(
    'shows the restricted card for %s and none of the billing data',
    (role) => {
      renderWorkspace(role, {
        model: { invoices: [createInvoice()], receipts: [createReceipt()] },
      });

      expect(screen.getByText('Billing is restricted')).toBeTruthy();
      expect(screen.getByText('Founder and Manager only')).toBeTruthy();
      expect(screen.getByText('Invoices, receipts and collections are visible to the Founder and Manager.')).toBeTruthy();
      expect(screen.queryByText('INV-0001001')).toBeNull();
      expect(screen.queryByText('Fee Invoices & Practice Receivables')).toBeNull();
      expect(screen.queryByText(/Priya Desai|Rohan Mehta/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Raise Invoice/i })).toBeNull();
    },
  );

  it.each(['founder', 'manager'] as const)('renders the live invoice rows for %s', (role) => {
    renderWorkspace(role, {
      model: {
        invoices: [
          createInvoice(),
          createInvoice({
            id: '70000000-0000-4000-a000-000000000002',
            invoiceNumber: 'INV-0001002',
            clientName: 'Sharma Retail',
            clientCode: 'CL-001003',
            status: 'Overdue',
            daysOverdue: 18,
            description: 'TDS return + 1 more',
          }),
        ],
        receipts: [],
      },
    });

    expect(screen.queryByText('Billing is restricted')).toBeNull();
    expect(screen.getByText('Fee Invoices & Practice Receivables')).toBeTruthy();
    expect(screen.getByText('INV-0001001')).toBeTruthy();
    expect(screen.getByText('INV-0001002')).toBeTruthy();
    expect(screen.getByText('Sharma Retail')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText(/\(18d late\)/)).toBeTruthy();
    expect(screen.getByText('Billed to date')).toBeTruthy();
  });

  it('shows a loading state while the first load is in flight', () => {
    renderWorkspace('founder', { loading: true });

    expect(screen.getByLabelText('Loading billing records')).toBeTruthy();
    expect(screen.queryByText('Billed to date')).toBeNull();
  });

  it('shows the error with a Retry button when the first load fails', () => {
    const { onRetry } = renderWorkspace('founder', {
      error: 'An unexpected error occurred while loading billing records. Please try again.',
    });

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Unable to load billing records')).toBeTruthy();
    expect(within(alert).getByText(/unexpected error occurred while loading billing records/i)).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps showing loaded rows with a retry banner when a refresh fails', () => {
    const { onRetry } = renderWorkspace('manager', {
      model: { invoices: [createInvoice()], receipts: [] },
      error: 'Unable to reach the server. Please check your network connection and try again.',
    });

    expect(screen.getByText('INV-0001001')).toBeTruthy();
    expect(screen.getByText(/Showing last loaded data/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps Raise Invoice, Record Receipt and Record payment visible but disabled, all pointing at one note', () => {
    renderWorkspace('founder', {
      model: { invoices: [createInvoice()], receipts: [] },
    });

    const note = screen.getByText(READ_ONLY_NOTE);
    expect(note.id).toBeTruthy();

    const raise = screen.getByRole('button', { name: /Raise Invoice/i }) as HTMLButtonElement;
    const record = screen.getByRole('button', { name: 'Record Receipt' }) as HTMLButtonElement;
    const rowPayment = screen.getByRole('button', { name: /Record payment for INV-0001001/i }) as HTMLButtonElement;

    for (const button of [raise, record, rowPayment]) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBe(note.id);
    }
    expect(screen.getAllByText(READ_ONLY_NOTE)).toHaveLength(1);
  });

  it('filters invoices by search query and status, and transitions across sub-tabs', () => {
    const invoices: InvoiceRecord[] = [
      createInvoice({ id: 'a1', invoiceNumber: 'INV-0000001', clientName: 'Alpha Tech', description: 'Statutory Audit Retainer', status: 'Unpaid', balance: 25000 }),
      createInvoice({ id: 'a2', invoiceNumber: 'INV-0000002', clientName: 'Beta Logistics', description: 'GST Monthly Filing', status: 'Paid', balance: 0, amountReceived: 15000 }),
      createInvoice({ id: 'a3', invoiceNumber: 'INV-0000003', clientName: 'Gamma Retail', description: 'TDS Reconciliation', status: 'Draft', balance: 0 }),
    ];

    renderWorkspace('founder', { model: { invoices, receipts: [] } });

    expect(screen.getByText('INV-0000001')).toBeTruthy();
    expect(screen.getByText('INV-0000002')).toBeTruthy();
    expect(screen.getByText('INV-0000003')).toBeTruthy();

    const searchInput = screen.getByPlaceholderText(/Search invoice or client/i);
    fireEvent.change(searchInput, { target: { value: 'Beta' } });
    expect(screen.queryByText('INV-0000001')).toBeNull();
    expect(screen.getByText('INV-0000002')).toBeTruthy();
    expect(screen.queryByText('INV-0000003')).toBeNull();

    fireEvent.change(searchInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paid' }));
    expect(screen.queryByText('INV-0000001')).toBeNull();
    expect(screen.getByText('INV-0000002')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Ageing & Receivables/i }));
    expect(screen.getByText(/0–30 Days \(Current\)/i)).toBeTruthy();
    // Receivables by client come from the open invoices, not from sample client data.
    expect(screen.getByText('Alpha Tech')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Receipts Register/i }));
    expect(screen.getByText(/No payment receipts recorded for this portfolio yet\./i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Invoices/i }));
    expect(screen.getByRole('columnheader', { name: 'Invoice #' })).toBeTruthy();
  });

  it('lists receipts with method, voided status, every allocated invoice code and unallocated amount', () => {
    const receipts: ReceiptRecord[] = [
      createReceipt({
        id: '71000000-0000-4000-a000-000000000002',
        receiptNumber: 'RCT-0001002',
        amount: 100000,
        paymentMode: 'UPI',
        referenceNumber: '',
        notes: '',
        allocations: [
          { invoiceId: '70000000-0000-4000-a000-000000000001', invoiceNumber: 'INV-0001001', amount: 29500 },
          { invoiceId: '70000000-0000-4000-a000-000000000002', invoiceNumber: 'INV-0001002', amount: 50000 },
        ],
        invoiceNumber: 'INV-0001001',
        unallocated: 20500,
      }),
      createReceipt({
        id: '71000000-0000-4000-a000-000000000003',
        receiptNumber: 'RCT-0001003',
        amount: 750,
        paymentMode: 'Cheque',
        status: 'Voided',
        allocations: [],
        invoiceId: '',
        invoiceNumber: '',
        unallocated: 750,
        notes: 'Cheque bounced',
      }),
    ];

    renderWorkspace('manager', { model: { invoices: [], receipts } });
    fireEvent.click(screen.getByRole('button', { name: /Receipts Register/i }));

    const multi = screen.getByText('RCT-0001002').closest('tr')!;
    expect(within(multi).getByText('INV-0001001')).toBeTruthy();
    expect(within(multi).getByText('INV-0001002')).toBeTruthy();
    expect(within(multi).getByText('UPI')).toBeTruthy();
    expect(within(multi).getByText(/Unallocated/)).toBeTruthy();
    expect(within(multi).getByText(/20,500/)).toBeTruthy();

    const voided = screen.getByText('RCT-0001003').closest('tr')!;
    expect(within(voided).getByText('Voided')).toBeTruthy();
    expect(within(voided).getByText('Cheque')).toBeTruthy();
    expect(within(voided).getByText('Not allocated')).toBeTruthy();
    expect(within(voided).queryByText(/Unallocated/)).toBeNull();
  });

  it('opens the invoice drawer and closes it, without exposing any raw UUID on screen', () => {
    const invoice = createInvoice({
      invoiceNumber: 'INV-0001045',
      assignmentCode: 'AS-001001',
      payments: [{ receiptNumber: 'RCT-0001001', date: '20/10/2026', amount: 10000, voided: false }],
    });
    const { container } = renderWorkspace('founder', {
      model: { invoices: [invoice], receipts: [createReceipt()] },
    });

    expect(screen.queryByLabelText('Invoice details')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View INV-0001045' }));

    expect(screen.getByLabelText('Invoice details')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'INV-0001045' })).toBeTruthy();
    expect(screen.getByText('AS-001001')).toBeTruthy();
    expect(screen.getByText('RCT-0001001 · ₹10,000')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Receipts Register/i }));
    expect(container.textContent ?? '').not.toMatch(UUID_PATTERN);
    expect(document.body.innerHTML.replace(/id="[^"]*"/g, '')).not.toMatch(/aria-label="[^"]*[0-9a-f]{8}-[0-9a-f]{4}-/i);

    fireEvent.click(screen.getByLabelText('Close drawer'));
    expect(screen.queryByLabelText('Invoice details')).toBeNull();
  });

  it('points the drawer Record payment button at the same read-only note', () => {
    renderWorkspace('founder', { model: { invoices: [createInvoice()], receipts: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'View INV-0001001' }));

    const drawer = screen.getByLabelText('Invoice details');
    const button = within(drawer).getByRole('button', { name: /Record payment/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByText(READ_ONLY_NOTE).id);
  });
});
