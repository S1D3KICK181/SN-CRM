// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClientsWorkspace } from './clients-workspace';
import type { ClientRecord } from '../../data';

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

describe('ClientsWorkspace', () => {
  it('filters visible client rows by search query and entity type', () => {
    const clients: ClientRecord[] = [
      createClient({ id: 'cli-1', name: 'Alpha Technologies', tradeName: 'AlphaTech', type: 'Private Limited', pan: 'AAA111111A', gstin: '27AAA111111A1Z1', city: 'Mumbai' }),
      createClient({ id: 'cli-2', name: 'Beta Logistics LLP', tradeName: 'BetaLog', type: 'LLP', pan: 'BBB222222B', gstin: '27BBB222222B1Z2', city: 'Pune' }),
      createClient({ id: 'cli-3', name: 'Gamma Retail', tradeName: 'GammaStore', type: 'Proprietorship', pan: 'CCC333333C', gstin: '27CCC333333C1Z3', city: 'Nagpur' }),
    ];

    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
      updateClient: vi.fn(),
    };

    render(
      <ClientsWorkspace
        role="founder"
        model={{ clients, schedules: [], invoices: [], receipts: [] }}
        actions={actions}
      />
    );

    // Initially all three are visible
    expect(screen.getByText('Alpha Technologies')).toBeTruthy();
    expect(screen.getByText('Beta Logistics LLP')).toBeTruthy();
    expect(screen.getByText('Gamma Retail')).toBeTruthy();

    // Filter by search query
    const searchInput = screen.getByPlaceholderText(/Search by client name/i);
    fireEvent.change(searchInput, { target: { value: 'Beta' } });

    expect(screen.queryByText('Alpha Technologies')).toBeNull();
    expect(screen.getByText('Beta Logistics LLP')).toBeTruthy();
    expect(screen.queryByText('Gamma Retail')).toBeNull();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Filter by entity type
    const typeSelect = screen.getByLabelText(/Filter by entity type/i);
    fireEvent.change(typeSelect, { target: { value: 'Proprietorship' } });

    expect(screen.queryByText('Alpha Technologies')).toBeNull();
    expect(screen.queryByText('Beta Logistics LLP')).toBeNull();
    expect(screen.getByText('Gamma Retail')).toBeTruthy();
  });

  it('allows leadership to invoke compose("client") and hides control from non-leadership', () => {
    const clients: ClientRecord[] = [createClient()];
    const founderActions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
      updateClient: vi.fn(),
    };

    const { rerender } = render(
      <ClientsWorkspace
        role="founder"
        model={{ clients, schedules: [], invoices: [], receipts: [] }}
        actions={founderActions}
      />
    );

    const addButton = screen.getByRole('button', { name: /Add client/i });
    fireEvent.click(addButton);
    expect(founderActions.compose).toHaveBeenCalledTimes(1);
    expect(founderActions.compose).toHaveBeenCalledWith('client');

    // Manager also has access
    const managerActions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
      updateClient: vi.fn(),
    };
    rerender(
      <ClientsWorkspace
        role="manager"
        model={{ clients, schedules: [], invoices: [], receipts: [] }}
        actions={managerActions}
      />
    );
    const managerAddButton = screen.getByRole('button', { name: /Add client/i });
    fireEvent.click(managerAddButton);
    expect(managerActions.compose).toHaveBeenCalledWith('client');

    // Staff cannot see the button
    const staffActions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
      updateClient: vi.fn(),
    };
    rerender(
      <ClientsWorkspace
        role="staff"
        model={{ clients, schedules: [], invoices: [], receipts: [] }}
        actions={staffActions}
      />
    );
    expect(screen.queryByRole('button', { name: /Add client/i })).toBeNull();
  });

  it('opens client profile drawer when clicking a row and closes it via close button', () => {
    const clients: ClientRecord[] = [createClient({ id: 'cli-001', name: 'Aster Foods Private Limited' })];
    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
      updateClient: vi.fn(),
    };

    render(
      <ClientsWorkspace
        role="founder"
        model={{ clients, schedules: [], invoices: [], receipts: [] }}
        actions={actions}
      />
    );

    expect(screen.queryByLabelText('Client details')).toBeNull();

    // Click client row view button
    const viewButton = screen.getByRole('button', { name: /View/i });
    fireEvent.click(viewButton);

    // Drawer is displayed
    const drawer = screen.getByLabelText('Client details');
    expect(drawer).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Aster Foods Private Limited', level: 2 })).toBeTruthy();

    // Close drawer
    const closeBtn = screen.getByLabelText('Close drawer');
    fireEvent.click(closeBtn);

    expect(screen.queryByLabelText('Client details')).toBeNull();
  });

  it('routes drawer intent to compose and routes client edit/save to updateClient', () => {
    const client = createClient({ id: 'cli-001', name: 'Aster Foods Private Limited' });
    const actions = {
      compose: vi.fn(),
      notify: vi.fn(),
      recordPaymentForInvoice: vi.fn(),
      updateClient: vi.fn(),
    };

    render(
      <ClientsWorkspace
        role="founder"
        model={{ clients: [client], schedules: [], invoices: [], receipts: [] }}
        actions={actions}
      />
    );

    // Open drawer
    fireEvent.click(screen.getByRole('button', { name: /View/i }));

    // Test intent route: "New assignment" in drawer footer
    const newAssignmentBtn = screen.getByRole('button', { name: /New assignment/i });
    fireEvent.click(newAssignmentBtn);
    expect(actions.compose).toHaveBeenCalledWith('assignment');
    expect(screen.queryByLabelText('Client details')).toBeNull();

    // Reopen drawer
    fireEvent.click(screen.getByRole('button', { name: /View/i }));

    // Test edit/save route:
    const editBtn = screen.getByRole('button', { name: /Edit Details/i });
    fireEvent.click(editBtn);

    const nameInput = screen.getByLabelText(/Legal Entity Name/i);
    fireEvent.change(nameInput, { target: { value: 'Aster Foods Global Private Limited' } });

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveBtn);

    expect(actions.updateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cli-001',
        name: 'Aster Foods Global Private Limited',
      })
    );
  });
});
