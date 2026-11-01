// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BillingWorkspace } from './billing-workspace';
import type { ClientRecord, InvoiceRecord, ReceiptRecord } from '../../data';

afterEach(() => {
  cleanup();
});

function createClient(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: 'cli-001',
    name: 'Aster Foods Private Limited',
    tradeName: 'Aster Foods',
    type: 'Private Limited',
    industry: 'Food Processing',
    pan: 'AABCA1234F',
    gstin: '27AABCA1234F1Z5',
    gstScheme: 'Regular',
    city: 'Mumbai',
    state: 'Maharashtra',
    contactName: 'Rajesh Kumar',
    contactDesignation: 'Director',
    phone: '+91 98200 12345',
    email: 'rajesh@asterfoods.in',
    primaryOwner: 'S. Narayanan',
    status: 'Active',
    billingFrequency: 'Monthly',
    recurringFee: '₹25,000',
    outstanding: '₹0',
    outstandingAge: 'Current',
    outstandingTone: 'default',
    activeAssignments: 1,
    pendingDocs: 0,
    onboardedDate: '01/04/2024',
    notes: 'Primary contact available on weekdays.',
    ...overrides,
  };
}

function createInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv-001',
    invoiceNumber: 'SN/2026-27/0001',
    clientId: 'cli-001',
    clientName: 'Aster Foods Private Limited',
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
    ...overrides,
  };
}

function createReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: 'rec-001',
    receiptNumber: 'REC-2026-0001',
    clientId: 'cli-001',
    clientName: 'Aster Foods Private Limited',
    invoiceId: 'inv-001',
    invoiceNumber: 'SN/2026-27/0001',
    receiptDate: '20/10/2026',
    amount: 59000,
    paymentMode: 'NEFT',
    referenceNumber: 'AXISN12345678',
    notes: 'Payment received via NEFT',
    ...overrides,
  };
}

describe('BillingWorkspace', () => {
  it('enforces trainee restriction notice while rendering full operational workspace for founder', () => {
    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
    };

    const { unmount } = render(
      <BillingWorkspace
        role="trainee"
        model={{ invoices: [], receipts: [], clients: [] }}
        actions={actions}
      />
    );

    expect(screen.getByText('Restricted Practice Area')).toBeTruthy();
    expect(screen.getByText('Article Assistant Access Restricted')).toBeTruthy();
    expect(screen.queryByText('Fee Invoices & Practice Receivables')).toBeNull();
    expect(screen.queryByText('Billed this FY (2026–27)')).toBeNull();

    unmount();

    render(
      <BillingWorkspace
        role="founder"
        model={{ invoices: [], receipts: [], clients: [] }}
        actions={actions}
      />
    );

    expect(screen.queryByText('Article Assistant Access Restricted')).toBeNull();
    expect(screen.getByText('Fee Invoices & Practice Receivables')).toBeTruthy();
    expect(screen.getByText('Billed this FY (2026–27)')).toBeTruthy();
  });

  it('allows founder to invoke both invoice and receipt compose intents, while staff cannot raise invoice but can record receipt', () => {
    const founderActions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
    };

    const { rerender } = render(
      <BillingWorkspace
        role="founder"
        model={{ invoices: [], receipts: [], clients: [] }}
        actions={founderActions}
      />
    );

    const raiseInvoiceBtn = screen.getByRole('button', { name: /Raise Invoice/i });
    fireEvent.click(raiseInvoiceBtn);
    expect(founderActions.compose).toHaveBeenCalledTimes(1);
    expect(founderActions.compose).toHaveBeenCalledWith('invoice');

    const recordReceiptBtn = screen.getByRole('button', { name: 'Record Receipt' });
    fireEvent.click(recordReceiptBtn);
    expect(founderActions.compose).toHaveBeenCalledTimes(2);
    expect(founderActions.compose).toHaveBeenCalledWith('receipt');

    const staffActions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
    };

    rerender(
      <BillingWorkspace
        role="staff"
        model={{ invoices: [], receipts: [], clients: [] }}
        actions={staffActions}
      />
    );

    expect(screen.queryByRole('button', { name: /Raise Invoice/i })).toBeNull();

    const staffReceiptBtn = screen.getByRole('button', { name: 'Record Receipt' });
    fireEvent.click(staffReceiptBtn);
    expect(staffActions.compose).toHaveBeenCalledTimes(1);
    expect(staffActions.compose).toHaveBeenCalledWith('receipt');
  });

  it('filters invoices by search query and status, and transitions across sub-tabs', () => {
    const invoices: InvoiceRecord[] = [
      createInvoice({
        id: 'inv-1',
        invoiceNumber: 'SN/2026-27/0001',
        clientName: 'Alpha Tech',
        description: 'Statutory Audit Retainer',
        status: 'Unpaid',
        balance: 25000,
      }),
      createInvoice({
        id: 'inv-2',
        invoiceNumber: 'SN/2026-27/0002',
        clientName: 'Beta Logistics',
        description: 'GST Monthly Filing',
        status: 'Paid',
        balance: 0,
        amountReceived: 15000,
      }),
      createInvoice({
        id: 'inv-3',
        invoiceNumber: 'SN/2026-27/0003',
        clientName: 'Gamma Retail',
        description: 'TDS Reconciliation',
        status: 'Draft',
        balance: 5000,
      }),
    ];

    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
    };

    render(
      <BillingWorkspace
        role="founder"
        model={{ invoices, receipts: [], clients: [] }}
        actions={actions}
      />
    );

    // Initial state: all invoices visible in invoices table
    expect(screen.getByText('SN/2026-27/0001')).toBeTruthy();
    expect(screen.getByText('SN/2026-27/0002')).toBeTruthy();
    expect(screen.getByText('SN/2026-27/0003')).toBeTruthy();

    // Filter by search query
    const searchInput = screen.getByPlaceholderText(/Search invoice or client/i);
    fireEvent.change(searchInput, { target: { value: 'Beta' } });

    expect(screen.queryByText('SN/2026-27/0001')).toBeNull();
    expect(screen.getByText('SN/2026-27/0002')).toBeTruthy();
    expect(screen.queryByText('SN/2026-27/0003')).toBeNull();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Filter by status: Paid
    const paidFilterBtn = screen.getByRole('button', { name: 'Paid' });
    fireEvent.click(paidFilterBtn);

    expect(screen.queryByText('SN/2026-27/0001')).toBeNull();
    expect(screen.getByText('SN/2026-27/0002')).toBeTruthy();
    expect(screen.queryByText('SN/2026-27/0003')).toBeNull();

    // Tab transition: Ageing & Receivables
    const ageingTabBtn = screen.getByRole('button', { name: /Ageing & Receivables/i });
    fireEvent.click(ageingTabBtn);
    expect(screen.getByText(/0–30 Days \(Current\)/i)).toBeTruthy();

    // Tab transition: Receipts Register
    const receiptsTabBtn = screen.getByRole('button', { name: /Receipts Register/i });
    fireEvent.click(receiptsTabBtn);
    expect(screen.getByText(/No payment receipts recorded for this portfolio yet\./i)).toBeTruthy();

    // Tab transition back to Invoices
    const invoicesTabBtn = screen.getByRole('button', { name: /^Invoices/i });
    fireEvent.click(invoicesTabBtn);
    expect(screen.getByRole('columnheader', { name: 'Invoice #' })).toBeTruthy();
  });

  it('opens invoice detail drawer with identity details and closes it via close button', () => {
    const invoice = createInvoice({
      id: 'inv-1',
      invoiceNumber: 'SN/2026-27/0045',
      clientName: 'Aster Foods Private Limited',
      invoiceDate: '15/10/2026',
    });

    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
    };

    render(
      <BillingWorkspace
        role="founder"
        model={{ invoices: [invoice], receipts: [], clients: [] }}
        actions={actions}
      />
    );

    expect(screen.queryByLabelText('Invoice details')).toBeNull();

    // Click "View" button in table row
    const viewButton = screen.getByRole('button', { name: 'View' });
    fireEvent.click(viewButton);

    // Drawer is open
    const drawer = screen.getByLabelText('Invoice details');
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'SN/2026-27/0045' })).toBeTruthy();
    expect(screen.getByText(/Aster Foods Private Limited · 15\/10\/2026/)).toBeTruthy();

    // Close drawer via close button
    const closeBtn = screen.getByLabelText('Close drawer');
    fireEvent.click(closeBtn);

    expect(screen.queryByLabelText('Invoice details')).toBeNull();
  });

  it('sends exact invoice on Record Payment and sends exact notify text on PDF export and collection follow-up', () => {
    const invoice = createInvoice({
      id: 'inv-001',
      invoiceNumber: 'SN/2026-27/0001',
      clientId: 'cli-001',
      clientName: 'Aster Foods Private Limited',
      balance: 59000,
    });
    const client = createClient({
      id: 'cli-001',
      name: 'Aster Foods Private Limited',
      contactName: 'Rajesh Kumar',
      outstanding: '₹59,000',
      outstandingTone: 'danger',
    });

    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
    };

    render(
      <BillingWorkspace
        role="founder"
        model={{ invoices: [invoice], receipts: [], clients: [client] }}
        actions={actions}
      />
    );

    // Open drawer
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByLabelText('Invoice details')).toBeTruthy();

    // 1. Record Payment from drawer sends exact invoice and closes drawer
    const recordPaymentBtn = screen.getByRole('button', { name: /Record Payment/i });
    fireEvent.click(recordPaymentBtn);

    expect(actions.recordPaymentForInvoice).toHaveBeenCalledTimes(1);
    expect(actions.recordPaymentForInvoice).toHaveBeenCalledWith(invoice);
    expect(screen.queryByLabelText('Invoice details')).toBeNull();

    // 2. Export PDF from drawer sends exact notify text
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const exportPdfBtn = screen.getByRole('button', { name: /Export PDF/i });
    fireEvent.click(exportPdfBtn);

    expect(actions.notify).toHaveBeenCalledWith('Tax invoice PDF exported for SN/2026-27/0001');

    // Close drawer
    fireEvent.click(screen.getByLabelText('Close drawer'));

    // 3. Collection follow-up from Ageing tab sends exact notify text
    fireEvent.click(screen.getByRole('button', { name: /Ageing & Receivables/i }));
    const followUpBtn = screen.getByRole('button', { name: 'Follow-Up' });
    fireEvent.click(followUpBtn);

    expect(actions.notify).toHaveBeenCalledWith('Collection reminder sent to Rajesh Kumar (Aster Foods Private Limited)');
  });
});
