// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import type { ClientDto, InvoiceDto } from '@sn/contracts';
import { BillingWorkspace, type BillingActions } from './billing-workspace';
import type { InvoiceRecord, ReceiptRecord } from '../../data';

afterEach(() => {
  cleanup();
});

const STAFF_BANNER =
  'Showing bills for the clients you look after. You can record payments; the Founder or Manager records and cancels bills.';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const CLIENT_ID = '10000000-0000-4000-a000-000000000001';

function createInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: '70000000-0000-4000-a000-000000000001',
    invoiceNumber: 'INV-0001001',
    clientId: CLIENT_ID,
    clientCode: 'CL-001001',
    clientName: 'Aster Foods',
    description: 'Statutory Audit Fee',
    invoiceDate: '15/10/2026',
    dueDate: '31/10/2026',
    subtotal: 59000,
    gstAmount: 0,
    total: 59000,
    amountReceived: 0,
    balance: 59000,
    balancePaise: 5900000,
    status: 'Pending',
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
    clientId: CLIENT_ID,
    clientName: 'Aster Foods',
    invoiceId: '70000000-0000-4000-a000-000000000001',
    invoiceNumber: 'INV-0001001',
    receiptDate: '20/10/2026',
    amount: 59000,
    amountPaise: 5900000,
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

const client: ClientDto = {
  id: CLIENT_ID,
  code: 'CL-001001',
  displayName: 'Aster Foods',
  legalName: null,
  gstinMasked: null,
  panMasked: null,
  email: null,
  phone: null,
  relationshipOwnerId: null,
  relationshipOwnerName: null,
  status: 'active',
  notes: null,
  activeAssignmentsCount: 0,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

function createActions(): { [K in keyof BillingActions]: ReturnType<typeof vi.fn> } {
  return {
    recordBill: vi.fn(),
    recordPayment: vi.fn().mockResolvedValue({}),
    voidBill: vi.fn().mockResolvedValue({}),
    voidPayment: vi.fn().mockResolvedValue({}),
  };
}

function renderWorkspace(
  role: Parameters<typeof BillingWorkspace>[0]['role'],
  overrides: Partial<Parameters<typeof BillingWorkspace>[0]> = {},
) {
  const actions = createActions();
  const props = {
    role,
    model: { invoices: [], receipts: [] },
    clients: [client],
    actions: actions as unknown as BillingActions,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    onToast: vi.fn(),
    ...overrides,
  };
  return { ...render(<BillingWorkspace {...props} />), onRetry: props.onRetry, onToast: props.onToast, actions };
}

describe('BillingWorkspace', () => {
  it('shows the restricted card for the trainee and none of the billing data', () => {
    renderWorkspace('trainee', {
      model: { invoices: [createInvoice()], receipts: [createReceipt()] },
    });

    expect(screen.getByText('Billing is restricted')).toBeTruthy();
    expect(screen.getByText('Not available to Trainees')).toBeTruthy();
    expect(screen.queryByText('INV-0001001')).toBeNull();
    expect(screen.queryByText('Vyapar bills and payments')).toBeNull();
    expect(screen.queryByRole('button', { name: /Record Vyapar bill/i })).toBeNull();
    expect(screen.queryByText(STAFF_BANNER)).toBeNull();
  });

  it.each(['senior_staff', 'staff'] as const)(
    'shows %s the scoped banner and Record payment, but no bill recording or cancelling',
    (role) => {
      renderWorkspace(role, { model: { invoices: [createInvoice()], receipts: [] } });

      expect(screen.queryByText('Billing is restricted')).toBeNull();
      expect(screen.getByText(STAFF_BANNER)).toBeTruthy();
      expect(screen.getByText('INV-0001001')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Record Vyapar bill/i })).toBeNull();
      expect(screen.getByRole('button', { name: 'Record payment for INV-0001001' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'View INV-0001001' }));
      const drawer = screen.getByLabelText('Invoice details');
      expect(within(drawer).getByRole('button', { name: 'Record payment' })).toBeTruthy();
      expect(within(drawer).queryByRole('button', { name: /Cancel bill/ })).toBeNull();
      expect(within(drawer).queryByRole('button', { name: /Cancel payment/ })).toBeNull();
    },
  );

  it.each(['founder', 'manager'] as const)('renders the live bill rows for %s without the staff banner', (role) => {
    renderWorkspace(role, {
      model: {
        invoices: [
          createInvoice(),
          createInvoice({
            id: '70000000-0000-4000-a000-000000000002',
            invoiceNumber: 'INV-0001002',
            vyaparBillNumber: 'VYP-140',
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
    expect(screen.queryByText(STAFF_BANNER)).toBeNull();
    expect(screen.getByText('Vyapar bills and payments')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Vyapar bill' })).toBeTruthy();
    // A bill with no Vyapar number shows its CRM code; one with both shows the Vyapar number and a small CRM ref.
    expect(screen.getByText('INV-0001001')).toBeTruthy();
    expect(screen.getByText('VYP-140')).toBeTruthy();
    expect(screen.getByText('CRM ref INV-0001002')).toBeTruthy();
    expect(screen.getByText('Sharma Retail')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    // The status chip and the filter pill both read Pending.
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(screen.getByText(/\(18d late\)/)).toBeTruthy();
    expect(screen.getByText('Billed to date')).toBeTruthy();
    expect(screen.getByText('Fees billed in Vyapar, payments received and what is still pending.')).toBeTruthy();
  });

  it('has no GST or tax wording in the visible billing copy', () => {
    const { container } = renderWorkspace('founder', {
      model: { invoices: [createInvoice()], receipts: [createReceipt()] },
    });
    for (const name of [/Pending by client/, /Payments received/, /^Bills/]) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(container.textContent ?? '').not.toMatch(/\bGST\b|\btax\b/i);
    }
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

  it('offers Record payment only on Pending, Partly Paid and Overdue bills, and none of the old read-only wiring', () => {
    const base = '70000000-0000-4000-a000-00000000000';
    renderWorkspace('founder', {
      model: {
        invoices: [
          createInvoice({ id: `${base}1`, invoiceNumber: 'INV-P', status: 'Pending' }),
          createInvoice({ id: `${base}2`, invoiceNumber: 'INV-Q', status: 'Partly Paid' }),
          createInvoice({ id: `${base}3`, invoiceNumber: 'INV-O', status: 'Overdue', daysOverdue: 3 }),
          createInvoice({ id: `${base}4`, invoiceNumber: 'INV-D', status: 'Paid', balance: 0, balancePaise: 0 }),
          createInvoice({ id: `${base}5`, invoiceNumber: 'INV-X', status: 'Cancelled', balance: 0, balancePaise: 0 }),
          createInvoice({ id: `${base}6`, invoiceNumber: 'INV-F', status: 'Draft', balance: 0, balancePaise: 0 }),
        ],
        receipts: [],
      },
    });

    for (const code of ['INV-P', 'INV-Q', 'INV-O']) {
      expect(screen.getByRole('button', { name: `Record payment for ${code}` })).toBeTruthy();
    }
    for (const code of ['INV-D', 'INV-X', 'INV-F']) {
      expect(screen.queryByRole('button', { name: `Record payment for ${code}` })).toBeNull();
    }
    expect(screen.queryByText(/Read-only for now/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Raise Invoice|Record Receipt/i })).toBeNull();
  });

  it('filters bills by search (Vyapar number too) and status, and moves across sub-tabs', () => {
    const invoices: InvoiceRecord[] = [
      createInvoice({ id: 'a1', invoiceNumber: 'INV-0000001', clientName: 'Alpha Tech', description: 'Statutory Audit Retainer', status: 'Pending', balance: 25000, balancePaise: 2500000 }),
      createInvoice({ id: 'a2', invoiceNumber: 'INV-0000002', vyaparBillNumber: 'VYP-77', clientName: 'Beta Logistics', description: 'Monthly Filing', status: 'Paid', balance: 0, balancePaise: 0, amountReceived: 15000 }),
      createInvoice({ id: 'a3', invoiceNumber: 'INV-0000003', clientName: 'Gamma Retail', description: 'TDS Reconciliation', status: 'Draft', balance: 0, balancePaise: 0 }),
    ];

    renderWorkspace('founder', { model: { invoices, receipts: [] } });

    expect(screen.getByText('INV-0000001')).toBeTruthy();
    expect(screen.getByText('VYP-77')).toBeTruthy();
    expect(screen.getByText('INV-0000003')).toBeTruthy();

    const searchInput = screen.getByPlaceholderText(/Search bill or client/i);
    fireEvent.change(searchInput, { target: { value: 'vyp-77' } });
    expect(screen.queryByText('INV-0000001')).toBeNull();
    expect(screen.getByText('VYP-77')).toBeTruthy();
    expect(screen.queryByText('INV-0000003')).toBeNull();

    fireEvent.change(searchInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Paid' }));
    expect(screen.queryByText('INV-0000001')).toBeNull();
    expect(screen.getByText('VYP-77')).toBeTruthy();

    // The Pending filter means any bill with a balance above zero.
    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    expect(screen.getByText('INV-0000001')).toBeTruthy();
    expect(screen.queryByText('VYP-77')).toBeNull();
    expect(screen.queryByText('INV-0000003')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Pending by client/i }));
    expect(screen.getByText(/0–30 Days \(Current\)/i)).toBeTruthy();
    expect(screen.getByText('Alpha Tech')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Payments received/i }));
    expect(screen.getByText(/No payment receipts recorded for this portfolio yet\./i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Bills/i }));
    expect(screen.getByRole('columnheader', { name: 'Vyapar bill' })).toBeTruthy();
  });

  it('lists receipts with method, voided status, every allocated invoice code and unallocated amount', () => {
    const receipts: ReceiptRecord[] = [
      createReceipt({
        id: '71000000-0000-4000-a000-000000000002',
        receiptNumber: 'RCT-0001002',
        amount: 100000,
        amountPaise: 10000000,
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
        amountPaise: 75000,
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
    fireEvent.click(screen.getByRole('button', { name: /Payments received/i }));

    const multi = screen.getByText('RCT-0001002').closest('tr')!;
    expect(within(multi).getByText('INV-0001001')).toBeTruthy();
    expect(within(multi).getByText('INV-0001002')).toBeTruthy();
    expect(within(multi).getByText('UPI')).toBeTruthy();
    expect(within(multi).getByText(/Unallocated/)).toBeTruthy();
    expect(within(multi).getByText(/20,500/)).toBeTruthy();

    const voided = screen.getByText('RCT-0001003').closest('tr')!;
    expect(within(voided).getByText('Cancelled')).toBeTruthy();
    expect(within(voided).getByText('Cheque')).toBeTruthy();
    expect(within(voided).getByText('Not allocated')).toBeTruthy();
    expect(within(voided).queryByText(/Unallocated/)).toBeNull();
  });

  it('opens the drawer and closes it, without exposing any raw UUID on screen', () => {
    const invoice = createInvoice({
      invoiceNumber: 'INV-0001045',
      assignmentCode: 'AS-001001',
      payments: [
        { receiptId: '73000000-0000-4000-a000-000000000001', receiptNumber: 'RCT-0001001', date: '20/10/2026', amount: 10000, amountPaise: 1000000, voided: false },
      ],
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

    fireEvent.click(screen.getByRole('button', { name: /Payments received/i }));
    expect(container.textContent ?? '').not.toMatch(UUID_PATTERN);
    expect(document.body.innerHTML.replace(/id="[^"]*"/g, '')).not.toMatch(/aria-label="[^"]*[0-9a-f]{8}-[0-9a-f]{4}-/i);

    fireEvent.click(screen.getByLabelText('Close drawer'));
    expect(screen.queryByLabelText('Invoice details')).toBeNull();
  });

  it('shows the founder Record Vyapar bill and the drawer cancel buttons', () => {
    const invoice = createInvoice({
      status: 'Partly Paid',
      payments: [
        { receiptId: '73000000-0000-4000-a000-000000000001', receiptNumber: 'RCT-0001001', date: '20/10/2026', amount: 10000, amountPaise: 1000000, voided: false },
      ],
    });
    renderWorkspace('founder', { model: { invoices: [invoice], receipts: [] } });

    expect(screen.getByRole('button', { name: /Record Vyapar bill/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View INV-0001001' }));
    const drawer = screen.getByLabelText('Invoice details');
    const cancelBill = within(drawer).getByRole('button', { name: 'Cancel bill' }) as HTMLButtonElement;
    expect(cancelBill.disabled).toBe(true);
    expect(within(drawer).getByText('Cancel the payments on this bill first.').id).toBe(
      cancelBill.getAttribute('aria-describedby'),
    );
    expect(within(drawer).getByRole('button', { name: 'Cancel payment RCT-0001001' })).toBeTruthy();
  });

  it('records a payment from a row, toasts, and keeps the drawer state untouched', async () => {
    const { actions, onToast } = renderWorkspace('staff', {
      model: { invoices: [createInvoice({ vyaparBillNumber: 'VYP-140', balance: 1500, balancePaise: 150000 })], receipts: [] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Record payment for VYP-140' }));
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    expect(within(dialog).getByText(/VYP-140 · Aster Foods · ₹1,500 pending/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Paid by'), { target: { value: 'upi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Payment of ₹1,500 recorded on VYP-140.'));
    expect(actions.recordPayment).toHaveBeenCalledTimes(1);
    expect(actions.recordPayment.mock.calls[0]?.[0]).toMatchObject({ amountPaise: 150000, method: 'upi' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancels a payment from the drawer and toasts with the receipt code', async () => {
    const invoice = createInvoice({
      status: 'Partly Paid',
      payments: [
        { receiptId: '73000000-0000-4000-a000-000000000001', receiptNumber: 'RCT-0001001', date: '20/10/2026', amount: 10000, amountPaise: 1000000, voided: false },
      ],
    });
    const { actions, onToast } = renderWorkspace('manager', { model: { invoices: [invoice], receipts: [] } });

    fireEvent.click(screen.getByRole('button', { name: 'View INV-0001001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payment RCT-0001001' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel payment RCT-0001001' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Cheque bounced' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel payment' }));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Payment RCT-0001001 cancelled.'));
    expect(actions.voidPayment.mock.calls[0]?.slice(0, 2)).toEqual([
      '73000000-0000-4000-a000-000000000001',
      { reason: 'Cheque bounced' },
    ]);
    expect(screen.getByLabelText('Invoice details')).toBeTruthy();
  });

  it('cancels a bill from the drawer and toasts', async () => {
    const { actions, onToast } = renderWorkspace('founder', {
      model: { invoices: [createInvoice({ vyaparBillNumber: 'VYP-140' })], receipts: [] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'View VYP-140' }));
    fireEvent.click(within(screen.getByLabelText('Invoice details')).getByRole('button', { name: 'Cancel bill' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel bill VYP-140' });
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Raised twice' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel bill' }));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Bill VYP-140 cancelled.'));
    expect(actions.voidBill.mock.calls[0]?.slice(0, 2)).toEqual([
      '70000000-0000-4000-a000-000000000001',
      { reason: 'Raised twice' },
    ]);
  });

  it('records a Vyapar bill and toasts with the client name', async () => {
    const created = { vyaparBillNumber: 'VYP-141', code: 'INV-0001009', clientName: 'Aster Foods' } as unknown as InvoiceDto;
    const actions = createActions();
    actions.recordBill.mockResolvedValue(created);
    const onToast = vi.fn();
    render(
      <BillingWorkspace
        role="manager"
        model={{ invoices: [], receipts: [] as ReceiptRecord[] }}
        clients={[client]}
        actions={actions as unknown as BillingActions}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onToast={onToast}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Record Vyapar bill/ }));
    const dialog = screen.getByRole('dialog', { name: 'Record Vyapar bill' });
    fireEvent.change(within(dialog).getByLabelText('Client'), { target: { value: CLIENT_ID } });
    fireEvent.change(within(dialog).getByLabelText('Vyapar bill number'), { target: { value: 'VYP-141' } });
    fireEvent.change(within(dialog).getByLabelText('Fee amount (₹)'), { target: { value: '2500' } });
    fireEvent.change(within(dialog).getByLabelText('What was billed'), { target: { value: 'Returns for October' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record bill' }));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Vyapar bill VYP-141 recorded for Aster Foods.'));
    expect(actions.recordBill.mock.calls[0]?.[0]).toMatchObject({ clientId: CLIENT_ID, amountPaise: 250000 });
  });
});
