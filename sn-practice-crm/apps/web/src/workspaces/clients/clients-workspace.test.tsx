// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ClientsWorkspace } from './clients-workspace';
import { DeterministicTestClientsAdapter } from '../../api/test-clients-adapter';
import { ClientOperationError } from '../../api/clients-types';
import type { ClientDto } from '@sn/contracts';

afterEach(() => {
  cleanup();
});

function createClientDto(overrides: Partial<ClientDto> = {}): ClientDto {
  return {
    id: 'c1111111-1111-4111-8111-111111111111',
    code: 'CL-000001',
    displayName: 'Aster Foods',
    legalName: 'Aster Foods Private Limited',
    gstinMasked: '27**********1Z5',
    panMasked: '******1234',
    email: 'contact@asterfoods.in',
    phone: '+91 98200 12345',
    relationshipOwnerId: 'u2222222-2222-4222-8222-222222222222',
    relationshipOwnerName: 'S. Narayanan',
    status: 'active',
    notes: 'Key FMCG client with monthly GST filings.',
    activeAssignmentsCount: 3,
    createdById: 'u1111111-1111-4111-8111-111111111111',
    createdAt: '2026-04-01T09:30:00.000Z',
    updatedAt: '2026-04-15T14:20:00.000Z',
    ...overrides,
  };
}

describe('ClientsWorkspace', () => {
  describe('Metric Truth across lifecycle states', () => {
    it('renders nonnumeric loading skeletons for all stat cards before snapshot resolves', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      let resolveList: (items: ClientDto[]) => void = () => {};
      const deferredPromise = new Promise<ClientDto[]>((resolve) => {
        resolveList = resolve;
      });
      adapter.setDeferredList('founder', deferredPromise);

      render(<ClientsWorkspace role="founder" port={adapter} />);

      // Nonnumeric loading metric skeletons with accessible labels must be shown
      expect(screen.getByLabelText('Loading Accessible Clients')).toBeTruthy();
      expect(screen.getByLabelText('Loading Active Clients')).toBeTruthy();
      expect(screen.getByLabelText('Loading Active Assignments')).toBeTruthy();
      expect(screen.getByLabelText('Loading Assigned Relationships')).toBeTruthy();

      // Zeroes must NOT be displayed during initial loading
      const statGrid = screen.getByLabelText('Client directory metrics');
      expect(statGrid.textContent).not.toContain('0');

      // Table skeleton
      expect(screen.getByLabelText('Loading client directory')).toBeTruthy();

      // Resolve snapshot
      resolveList([createClientDto()]);

      await waitFor(() => {
        expect(screen.getByText('Aster Foods')).toBeTruthy();
      });
      expect(screen.queryByLabelText('Loading client directory')).toBeNull();
    });

    it('renders nonnumeric unavailable indicators for all stat cards on initial fetch failure', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.enqueueDeferredList(
        Promise.reject(new ClientOperationError({
          code: 'network',
          message: 'Failed to connect to clients service.',
        })),
        'founder'
      );

      render(<ClientsWorkspace role="founder" port={adapter} />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeTruthy();
      });

      // Stat cards must show unavailable indicators, not zeroes
      expect(screen.getByLabelText('Accessible Clients unavailable')).toBeTruthy();
      expect(screen.getByLabelText('Active Clients unavailable')).toBeTruthy();
      expect(screen.getByLabelText('Active Assignments unavailable')).toBeTruthy();
      expect(screen.getByLabelText('Assigned Relationships unavailable')).toBeTruthy();

      const statGrid = screen.getByLabelText('Client directory metrics');
      expect(statGrid.textContent).not.toContain('0');
      expect(screen.getAllByText('Unavailable').length).toBe(4);
    });

    it('renders numeric zeroes only after a successful empty snapshot', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('staff', []);

      render(<ClientsWorkspace role="staff" port={adapter} />);

      await waitFor(() => {
        expect(screen.getByText('No clients accessible for this role.')).toBeTruthy();
      });

      // Supporting copy must follow exact spec
      expect(screen.getByText('Clients visible to this role will appear here.')).toBeTruthy();

      // Numeric zeroes are now valid and truthful
      const statGrid = screen.getByLabelText('Client directory metrics');
      expect(statGrid.textContent).toContain('Accessible Clients0');
      expect(statGrid.textContent).toContain('Active Clients0');
      expect(statGrid.textContent).toContain('Active Assignments0');
      expect(statGrid.textContent).toContain('Assigned Relationships0');
    });
  });

  it('renders live client rows faithfully from the port seam', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    const clientA = createClientDto({
      id: 'c1',
      code: 'CL-000001',
      displayName: 'Aster Foods',
      legalName: 'Aster Foods Private Limited',
      panMasked: '******1234',
      gstinMasked: '27**********1Z5',
      relationshipOwnerName: 'S. Narayanan',
      activeAssignmentsCount: 2,
      email: 'aster@example.com',
      phone: '+91 98200 11111',
    });
    const clientB = createClientDto({
      id: 'c2',
      code: 'CL-000002',
      displayName: 'Beta Logistics',
      legalName: null,
      panMasked: null,
      gstinMasked: null,
      relationshipOwnerName: null,
      activeAssignmentsCount: 0,
      email: null,
      phone: null,
      status: 'on_hold',
    });

    adapter.setListResponse('founder', [clientA, clientB]);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
      expect(screen.getByText('Beta Logistics')).toBeTruthy();
    });

    // Check Client A fields
    expect(screen.getByText('Aster Foods Private Limited')).toBeTruthy();
    expect(screen.getByText('******1234')).toBeTruthy();
    expect(screen.getByText('27**********1Z5')).toBeTruthy();
    expect(screen.getByText('S. Narayanan')).toBeTruthy();
    expect(screen.getByText('2 active')).toBeTruthy();
    expect(screen.getByText('aster@example.com')).toBeTruthy();

    // Check Client B truthful null fallbacks
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('0 active')).toBeTruthy();
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(1);

    // Assert more options action is omitted
    expect(screen.queryByLabelText('More options')).toBeNull();
  });

  it('computes and renders honest directory metrics derived purely from live items', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    const items = [
      createClientDto({ id: 'c1', displayName: 'Alpha Corp', status: 'active', activeAssignmentsCount: 4, relationshipOwnerName: 'Owner 1' }),
      createClientDto({ id: 'c2', displayName: 'Beta Corp', status: 'active', activeAssignmentsCount: 2, relationshipOwnerName: null }),
      createClientDto({ id: 'c3', displayName: 'Gamma Corp', status: 'on_hold', activeAssignmentsCount: 1, relationshipOwnerName: 'Owner 2' }),
    ];
    adapter.setListResponse('founder', items);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Corp')).toBeTruthy();
      expect(screen.getByText('Beta Corp')).toBeTruthy();
      expect(screen.getByText('Gamma Corp')).toBeTruthy();
    });

    const articles = screen.getAllByRole('article');
    expect(articles[0]?.textContent).toContain('Accessible Clients3');
    expect(articles[1]?.textContent).toContain('Active Clients2');
    expect(articles[2]?.textContent).toContain('Active Assignments7');
    expect(articles[3]?.textContent).toContain('Assigned Relationships2');

    // Verify mock numbers are not present
    expect(screen.queryByText('48')).toBeNull();
    expect(screen.queryByText('₹1,21,750')).toBeNull();
    expect(screen.queryByText('12')).toBeNull();
  });

  it('filters clients by search query and status dropdown', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    const client1 = createClientDto({
      id: 'c1',
      code: 'CL-000001',
      displayName: 'Aster Foods',
      panMasked: '******1234',
      status: 'active',
    });
    const client2 = createClientDto({
      id: 'c2',
      code: 'CL-000002',
      displayName: 'Beta Logistics',
      panMasked: '******5678',
      status: 'on_hold',
    });
    const client3 = createClientDto({
      id: 'c3',
      code: 'CL-000003',
      displayName: 'Gamma Retail',
      panMasked: '******9999',
      status: 'archived',
    });
    adapter.setListResponse('founder', [client1, client2, client3]);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
      expect(screen.getByText('Beta Logistics')).toBeTruthy();
      expect(screen.getByText('Gamma Retail')).toBeTruthy();
    });

    // Filter by search query (displayName)
    const searchInput = screen.getByLabelText('Search clients');
    fireEvent.change(searchInput, { target: { value: 'Beta' } });

    expect(screen.queryByText('Aster Foods')).toBeNull();
    expect(screen.getByText('Beta Logistics')).toBeTruthy();
    expect(screen.queryByText('Gamma Retail')).toBeNull();

    // Filter by code
    fireEvent.change(searchInput, { target: { value: 'CL-000003' } });
    expect(screen.queryByText('Aster Foods')).toBeNull();
    expect(screen.queryByText('Beta Logistics')).toBeNull();
    expect(screen.getByText('Gamma Retail')).toBeTruthy();

    // Filter by masked tax ID fragment
    fireEvent.change(searchInput, { target: { value: '1234' } });
    expect(screen.getByText('Aster Foods')).toBeTruthy();
    expect(screen.queryByText('Beta Logistics')).toBeNull();
    expect(screen.queryByText('Gamma Retail')).toBeNull();

    // Clear search and filter by status
    fireEvent.change(searchInput, { target: { value: '' } });
    const statusSelect = screen.getByLabelText('Filter by client status');
    fireEvent.change(statusSelect, { target: { value: 'on_hold' } });

    expect(screen.queryByText('Aster Foods')).toBeNull();
    expect(screen.getByText('Beta Logistics')).toBeTruthy();
    expect(screen.queryByText('Gamma Retail')).toBeNull();

    // Filter with no match
    fireEvent.change(searchInput, { target: { value: 'NoMatchExpected' } });
    expect(screen.getByText('No clients match your filter criteria.')).toBeTruthy();
  });

  it('renders inline error alert with retry button on initial load failure', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    adapter.enqueueDeferredList(
      Promise.reject(new ClientOperationError({
        code: 'network',
        message: 'Failed to connect to clients service.',
      })),
      'founder'
    );
    adapter.setListResponse('founder', [createClientDto()]);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(alert.textContent).toContain('Unable to load clients');
      expect(alert.textContent).toContain('Failed to connect to clients service.');
    });

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows non-destructive refresh error banner when refresh fails after successful snapshot', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    const initialClient = createClientDto();
    adapter.setListResponse('founder', [initialClient]);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
    });

    // Enqueue an error for the next list call
    adapter.enqueueDeferredList(
      Promise.reject(new ClientOperationError({
        code: 'network',
        message: 'Network drop during refresh.',
      })),
      'founder'
    );

    const refreshBtn = screen.getByLabelText('Refresh client list');
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeTruthy();
      expect(screen.getByText('Failed to refresh client list. Showing last loaded data.')).toBeTruthy();
    });

    // Preserves existing visible data
    expect(screen.getByText('Aster Foods')).toBeTruthy();
  });

  it('opens and closes client detail drawer on row click and view button click', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    const client = createClientDto({ id: 'c1', displayName: 'Aster Foods' });
    adapter.setListResponse('founder', [client]);
    adapter.setGetResponse('c1', client);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
    });

    // Drawer is closed initially
    expect(screen.queryByRole('dialog')).toBeNull();

    // Click "View" button
    const viewBtn = screen.getByRole('button', { name: /view/i });
    fireEvent.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    // Close drawer
    const closeBtn = screen.getByLabelText('Close drawer');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('strictly excludes unsupported create and edit controls from the workspace surface', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    adapter.setListResponse('founder', [createClientDto()]);

    render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
    });

    // No "+ Add client" button
    expect(screen.queryByRole('button', { name: /add client/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new client/i })).toBeNull();

    // No edit buttons in table rows
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('proves genuine zero-frame role data isolation with deferred list and filter reset', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    const founderClient = createClientDto({ id: 'c1', displayName: 'Founder Client Account' });
    const staffClient = createClientDto({ id: 'c2', displayName: 'Staff Assigned Client' });

    adapter.setListResponse('founder', [founderClient]);
    adapter.setGetResponse('c1', founderClient);

    let resolveStaffList!: (items: ClientDto[]) => void;
    const staffDeferred = new Promise<ClientDto[]>((resolve) => {
      resolveStaffList = resolve;
    });
    adapter.setDeferredList('staff', staffDeferred);

    const { rerender } = render(<ClientsWorkspace role="founder" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Founder Client Account')).toBeTruthy();
    });

    // Set local search and open detail drawer under founder
    const searchInput = screen.getByLabelText('Search clients') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'Founder' } });
    expect(searchInput.value).toBe('Founder');

    const viewBtn = screen.getByRole('button', { name: /view/i });
    fireEvent.click(viewBtn);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    // Switch role to staff
    rerender(<ClientsWorkspace role="staff" port={adapter} />);

    // IMMEDIATELY: synchronously before staff list resolves:
    // 1. Founder row must be absent
    expect(screen.queryByText('Founder Client Account')).toBeNull();
    // 2. Founder detail drawer must be closed/absent
    expect(screen.queryByRole('dialog')).toBeNull();
    // 3. Loading-safe UI must appear
    expect(screen.getByLabelText('Loading client directory')).toBeTruthy();
    // 4. Local search and status filter must be reset
    expect(searchInput.value).toBe('');
    const statusSelect = screen.getByLabelText('Filter by client status') as HTMLSelectElement;
    expect(statusSelect.value).toBe('all');

    // Resolve deferred staff list
    resolveStaffList([staffClient]);

    // Now await staff data
    await waitFor(() => {
      expect(screen.getByText('Staff Assigned Client')).toBeTruthy();
    });
    expect(screen.queryByText('Founder Client Account')).toBeNull();
    expect(screen.queryByLabelText('Loading client directory')).toBeNull();
  });
});
