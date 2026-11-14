// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ClientsWorkspace } from './clients-workspace';
import { DeterministicTestClientsAdapter } from '../../api/test-clients-adapter';
import { DeterministicTestTeamDirectoryAdapter } from '../../api/test-team-directory-adapter';
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
    pan: null,
    gstin: null,
    entityType: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    pincode: null,
    tan: null,
    cinLlpin: null,
    udyamNumber: null,
    iec: null,
    incorporationDate: null,
    contacts: [],
    canEdit: false,
    canChangeOwnerOrStatus: false,
    looksAfter: true,
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

  it('strictly excludes unsupported create and edit controls from the workspace surface for non-manager roles', async () => {
    const adapter = new DeterministicTestClientsAdapter();
    adapter.setListResponse('staff', [createClientDto()]);

    render(<ClientsWorkspace role="staff" port={adapter} />);

    await waitFor(() => {
      expect(screen.getByText('Aster Foods')).toBeTruthy();
    });

    // No "+ Add client" button for staff
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

  describe('Client creation workflow and role gating', () => {
    it('displays "+ Add client" button for founder and manager, but omits it for senior_staff, staff, and trainee', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('founder', [createClientDto()]);
      adapter.setListResponse('manager', [createClientDto()]);
      adapter.setListResponse('senior_staff', [createClientDto()]);
      adapter.setListResponse('staff', [createClientDto()]);
      adapter.setListResponse('trainee', [createClientDto()]);

      // Founder: can create
      const { rerender } = render(<ClientsWorkspace role="founder" port={adapter} />);
      expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy();

      // Manager: can create
      rerender(<ClientsWorkspace role="manager" port={adapter} />);
      expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy();

      // Senior staff: cannot create
      rerender(<ClientsWorkspace role="senior_staff" port={adapter} />);
      expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull();

      // Staff: cannot create
      rerender(<ClientsWorkspace role="staff" port={adapter} />);
      expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull();

      // Trainee: cannot create
      rerender(<ClientsWorkspace role="trainee" port={adapter} />);
      expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull();
    });

    it('opens CreateClientDialog and creates client successfully with toast notification and live directory update', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      const initialClient = createClientDto({
        id: 'c1111111-1111-4111-8111-111111111111',
        displayName: 'Existing Client One',
      });
      adapter.setListResponse('founder', [initialClient]);

      const createdClient: ClientDto = {
        id: 'c9999999-9999-4999-8999-999999999999',
        code: 'CL-001099',
        displayName: 'Zenith Advisory Services',
        legalName: 'Zenith Advisory Services LLP',
        panMasked: '******5678',
        gstinMasked: '27**********2Z8',
        email: 'accounts@zenith.local',
        phone: '+91 98111 22334',
        relationshipOwnerId: null,
        relationshipOwnerName: null,
        status: 'active',
        notes: 'Priority onboarding',
        activeAssignmentsCount: 0,
        pan: null,
        gstin: null,
        entityType: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        pincode: null,
        tan: null,
        cinLlpin: null,
        udyamNumber: null,
        iec: null,
        incorporationDate: null,
        contacts: [],
        canEdit: false,
        canChangeOwnerOrStatus: false,
        looksAfter: true,
        createdById: '00000000-0000-4000-a000-000000000001',
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      };
      adapter.setCreateResponse(createdClient);

      const onToast = vi.fn();
      render(<ClientsWorkspace role="founder" port={adapter} onToast={onToast} />);

      await waitFor(() => {
        expect(screen.getByText('Existing Client One')).toBeTruthy();
      });

      // Click "Add client" button
      const addBtn = screen.getByRole('button', { name: 'Add client' });
      fireEvent.click(addBtn);

      // Dialog is open
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Add client' })).toBeTruthy();

      // Fill in form
      const displayNameInput = screen.getByLabelText(/display name \*/i);
      const legalNameInput = screen.getByLabelText(/legal registered name/i);
      const panInput = screen.getByLabelText(/income tax pan/i);
      const gstinInput = screen.getByLabelText(/gstin/i);
      const submitBtn = screen.getByTestId('create-client-submit-btn');

      fireEvent.change(displayNameInput, { target: { value: 'Zenith Advisory Services' } });
      fireEvent.change(legalNameInput, { target: { value: 'Zenith Advisory Services LLP' } });
      fireEvent.change(panInput, { target: { value: 'ABCDE5678F' } });
      fireEvent.change(gstinInput, { target: { value: '27ABCDE5678F2Z8' } });

      // Submit
      fireEvent.click(submitBtn);

      // Dialog closes and toast is emitted exactly once
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      expect(onToast).toHaveBeenCalledTimes(1);
      expect(onToast).toHaveBeenCalledWith('Client "Zenith Advisory Services" created successfully.');

      // Focus restored to trigger button after success
      expect(document.activeElement).toBe(addBtn);

      // Directory table updated with new client prepended
      expect(screen.getByText('Zenith Advisory Services')).toBeTruthy();
      expect(screen.getByText('Zenith Advisory Services LLP')).toBeTruthy();
      expect(screen.getByText('******5678')).toBeTruthy();
      expect(screen.getByText('27**********2Z8')).toBeTruthy();

      // ADVERSARIAL PRIVACY CHECK:
      // Raw PAN and GSTIN must never exist in the DOM outside the unmounted form
      expect(document.body.textContent).not.toContain('ABCDE5678F');
      expect(document.body.textContent).not.toContain('27ABCDE5678F2Z8');

      // Verify adapter recorded create call with relationshipOwnerId: null
      const createCall = adapter.calls.find((c) => c.action === 'create');
      expect(createCall).toBeDefined();
      expect(createCall?.role).toBe('founder');
      expect(createCall?.input?.displayName).toBe('Zenith Advisory Services');
      expect(createCall?.input?.relationshipOwnerId).toBeNull();
    });

    it('propagates teamPort to Add client dialog and submits chosen relationship owner', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('founder', [createClientDto({ id: 'client-1', displayName: 'Existing Client One' })]);
      adapter.setCreateResponse(
        createClientDto({
          id: 'client-2',
          displayName: 'Horizon Advisory',
          relationshipOwnerId: '00000000-0000-4000-a000-000000000002',
          relationshipOwnerName: 'Ananya Rao',
        })
      );

      const teamPort = new DeterministicTestTeamDirectoryAdapter();
      teamPort.setReportingLinesResponse('founder', [
        {
          employee: {
            id: '00000000-0000-4000-a000-000000000002',
            name: 'Ananya Rao',
            role: 'manager',
            reportsToId: null,
          },
          manager: null,
        },
      ]);

      const onToast = vi.fn();
      render(<ClientsWorkspace role="founder" port={adapter} teamPort={teamPort} onToast={onToast} />);

      await waitFor(() => {
        expect(screen.getByText('Existing Client One')).toBeTruthy();
      });

      const addBtn = screen.getByRole('button', { name: 'Add client' });
      fireEvent.click(addBtn);

      const select = screen.getByLabelText(/Client Relationship Owner/i) as HTMLSelectElement;
      await waitFor(() => {
        expect(select.querySelector('option[value="00000000-0000-4000-a000-000000000002"]')).toBeTruthy();
      });

      fireEvent.change(select, { target: { value: '00000000-0000-4000-a000-000000000002' } });

      const displayNameInput = screen.getByLabelText(/display name \*/i);
      fireEvent.change(displayNameInput, { target: { value: 'Horizon Advisory' } });

      const submitBtn = screen.getByTestId('create-client-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      const createCall = adapter.calls.find((c) => c.action === 'create');
      expect(createCall).toBeDefined();
      expect(createCall?.input?.displayName).toBe('Horizon Advisory');
      expect(createCall?.input?.relationshipOwnerId).toBe('00000000-0000-4000-a000-000000000002');
    });

    it('emits exactly one success toast and one refresh error toast on post-create reconciliation failure without duplicating success toast', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('founder', [createClientDto({ id: 'client-1', displayName: 'Existing Client One' })]);
      adapter.setCreateResponse(
        createClientDto({
          id: 'client-2',
          displayName: 'Reconciliation Test Client',
          status: 'active',
        }),
      );

      const onToast = vi.fn();
      render(<ClientsWorkspace role="founder" port={adapter} onToast={onToast} />);

      await waitFor(() => {
        expect(screen.getByText('Existing Client One')).toBeTruthy();
      });

      // Configure next list (reconciliation call) to fail with a network error
      adapter.setListError(
        'founder',
        new ClientOperationError({
          code: 'network',
          message: 'Server connection dropped during refresh.',
        }),
      );

      // Open dialog and submit
      const addBtn = screen.getByRole('button', { name: 'Add client' });
      fireEvent.click(addBtn);

      const displayNameInput = screen.getByLabelText(/display name \*/i);
      fireEvent.change(displayNameInput, { target: { value: 'Reconciliation Test Client' } });

      const submitBtn = screen.getByTestId('create-client-submit-btn');
      fireEvent.click(submitBtn);

      // Dialog closes
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      // Non-destructive refresh warning banner appears
      await waitFor(() => {
        expect(screen.getByText('Failed to refresh client list. Showing last loaded data.')).toBeTruthy();
      });

      // Snapshot is preserved in directory table
      expect(screen.getByText('Reconciliation Test Client')).toBeTruthy();
      expect(screen.getByText('Existing Client One')).toBeTruthy();

      // Toast parity: exactly 1 create success toast and 1 refresh error toast, no duplicated success toast
      expect(onToast).toHaveBeenCalledTimes(2);
      expect(onToast).toHaveBeenCalledWith('Client "Reconciliation Test Client" created successfully.');
      expect(onToast).toHaveBeenCalledWith('Server connection dropped during refresh.');
    });

    it('restores focus to trigger button when dialog is explicitly cancelled', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('founder', [createClientDto()]);

      render(<ClientsWorkspace role="founder" port={adapter} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy();
      });

      const addBtn = screen.getByRole('button', { name: 'Add client' });
      fireEvent.click(addBtn);
      expect(screen.getByRole('dialog')).toBeTruthy();

      // Cancel
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(addBtn);
    });

    it('synchronously closes open dialog if role switches to unauthorized role', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('founder', [createClientDto()]);
      adapter.setListResponse('staff', [createClientDto()]);

      const { rerender } = render(<ClientsWorkspace role="founder" port={adapter} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy();
      });

      // Open dialog under founder
      fireEvent.click(screen.getByRole('button', { name: 'Add client' }));
      expect(screen.getByRole('dialog')).toBeTruthy();

      // Switch role to staff
      rerender(<ClientsWorkspace role="staff" port={adapter} />);

      // Dialog is synchronously closed and button is absent
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull();
    });

    it('suppresses pending create when role switches while create is in-flight', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setIgnoreAbortSignals(true);
      adapter.setListResponse('founder', [createClientDto({ id: 'c1', displayName: 'Founder Client' })]);
      adapter.setListResponse('staff', [createClientDto({ id: 'c2', displayName: 'Staff Client' })]);

      let resolveDeferredCreate!: (c: ClientDto) => void;
      const deferredCreate = new Promise<ClientDto>((resolve) => {
        resolveDeferredCreate = resolve;
      });
      adapter.setDeferredCreate(deferredCreate, 'founder');

      const onToast = vi.fn();
      const { rerender } = render(<ClientsWorkspace role="founder" port={adapter} onToast={onToast} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Add client' }));
      const displayNameInput = screen.getByLabelText(/display name \*/i);
      fireEvent.change(displayNameInput, { target: { value: 'In-flight Client' } });

      fireEvent.click(screen.getByTestId('create-client-submit-btn'));

      // Role switches while create is pending
      rerender(<ClientsWorkspace role="staff" port={adapter} onToast={onToast} />);

      // Modal immediately gone
      expect(screen.queryByRole('dialog')).toBeNull();

      // Resolve stale create
      resolveDeferredCreate(
        createClientDto({ id: 'c99', displayName: 'In-flight Client' }),
      );

      await waitFor(() => {
        expect(screen.getByText('Staff Client')).toBeTruthy();
      });

      // No toast emitted and staff list never contaminated
      expect(onToast).not.toHaveBeenCalled();
      expect(screen.queryByText('In-flight Client')).toBeNull();
    });

    it('preserves dialog and input when creation fails with sanitized server error', async () => {
      const adapter = new DeterministicTestClientsAdapter();
      adapter.setListResponse('founder', [createClientDto()]);
      adapter.setCreateError(
        new ClientOperationError({
          code: 'conflict',
          status: 409,
          serverCode: 'client_code_conflict',
          requestId: 'req_ws_err_555',
          message: 'Client with PAN ABCDE1234F already registered in directory.',
        })
      );

      render(<ClientsWorkspace role="founder" port={adapter} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Add client' }));

      const displayNameInput = screen.getByLabelText(/display name \*/i);
      const submitBtn = screen.getByTestId('create-client-submit-btn');

      fireEvent.change(displayNameInput, { target: { value: 'Duplicate Client' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('create-client-server-error')).toBeTruthy();
      });

      // Sanitized user copy rendered
      expect(
        screen.getByText('A client record with conflicting identifiers already exists in the directory.')
      ).toBeTruthy();

      // Subdued support reference rendered
      expect(screen.getByText('Support reference: req_ws_err_555')).toBeTruthy();

      // Dialog still open, input preserved
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect((displayNameInput as HTMLInputElement).value).toBe('Duplicate Client');
    });
  });

  describe('client master editing', () => {
    const CLIENT_ID = 'c2222222-2222-4222-8222-222222222222';
    const CONTACT_ID = 'd2222222-2222-4222-8222-222222222222';
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const CONTACT = {
      id: CONTACT_ID,
      name: 'Asha Rao',
      designation: 'Finance head',
      email: 'asha@asterfoods.in',
      phone: '+91 98200 11111',
      whatsapp: null,
      isPrimary: true,
      notes: null,
      updatedAt: '2026-04-15T14:20:00.000Z',
    };

    function editable(overrides: Partial<ClientDto> = {}): ClientDto {
      return createClientDto({
        id: CLIENT_ID,
        canEdit: true,
        canChangeOwnerOrStatus: true,
        looksAfter: true,
        contacts: [CONTACT],
        ...overrides,
      });
    }

    async function openDrawer(client: ClientDto, role: 'founder' | 'staff' = 'founder') {
      const port = new DeterministicTestClientsAdapter();
      port.setListResponse(role, [client]);
      port.setGetResponse(client.id, client);
      const teamPort = new DeterministicTestTeamDirectoryAdapter();
      teamPort.setReportingLinesResponse(role, []);
      const onToast = vi.fn();
      render(<ClientsWorkspace role={role} port={port} teamPort={teamPort} onToast={onToast} />);
      await waitFor(() => expect(screen.getByText('Aster Foods')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: /view/i }));
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Aster Foods', level: 2 })).toBeTruthy());
      port.calls.length = 0;
      return { port, onToast };
    }

    it('hides every edit action when the reader may not edit the client', async () => {
      await openDrawer(editable({ canEdit: false, canChangeOwnerOrStatus: false }), 'staff');
      expect(screen.getByText('Asha Rao')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit Asha Rao' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove Asha Rao' })).toBeNull();
    });

    it('edits the client: sends only the change, toasts, closes and shows the new value', async () => {
      const { port, onToast } = await openDrawer(editable());

      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit Aster Foods' });
      fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Pune' } });
      expect(UUID.test(dialog.textContent ?? '')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Aster Foods' })).toBeNull());
      const call = port.calls.find((entry) => entry.action === 'updateClient');
      expect(call).toMatchObject({
        id: CLIENT_ID,
        changes: { city: 'Pune', expectedUpdatedAt: '2026-04-15T14:20:00.000Z' },
      });
      expect(call?.idempotencyKey).toEqual(expect.any(String));
      expect(onToast).toHaveBeenCalledWith('Client Aster Foods updated.');
      await waitFor(() => expect(screen.getByText('Pune')).toBeTruthy());
      // The drawer stays open behind the closed dialog.
      expect(screen.getByRole('heading', { name: 'Aster Foods', level: 2 })).toBeTruthy();
    });

    it('keeps the dialog open on a stale save, shows the message and reloads the client in the background', async () => {
      const { port, onToast } = await openDrawer(editable());
      port.setUpdateClientError(
        new ClientOperationError({ code: 'conflict', message: 'raw', status: 409, serverCode: 'stale_client' }),
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
      fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Pune' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe(
          'This client was changed by someone else. Reload and try again.',
        ),
      );
      expect(screen.getByRole('dialog', { name: 'Edit Aster Foods' })).toBeTruthy();
      await waitFor(() => expect(port.calls.some((call) => call.action === 'get')).toBe(true));
      expect(onToast).not.toHaveBeenCalled();
    });

    it('Escape closes only the dialog on top, not the drawer behind it', async () => {
      await openDrawer(editable());
      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
      fireEvent.keyDown(document, { key: 'Escape' });

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit Aster Foods' })).toBeNull());
      expect(screen.getByRole('dialog', { name: 'Aster Foods' })).toBeTruthy();
    });

    it('adds a contact with a key and a toast', async () => {
      const { port, onToast } = await openDrawer(editable({ contacts: [] }));

      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
      expect(screen.getByRole('dialog', { name: 'Add contact' })).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo Mehta' } });
      fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+91 98200 44444' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Contact Jo Mehta added.'));
      const call = port.calls.find((entry) => entry.action === 'createContact');
      expect(call).toMatchObject({
        id: CLIENT_ID,
        changes: { name: 'Jo Mehta', phone: '+91 98200 44444', isPrimary: false },
      });
      expect(call?.idempotencyKey).toEqual(expect.any(String));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add contact' })).toBeNull());
    });

    it('edits a contact, sending only what changed with its concurrency token', async () => {
      const { port, onToast } = await openDrawer(editable());

      fireEvent.click(screen.getByRole('button', { name: 'Edit Asha Rao' }));
      expect(screen.getByRole('dialog', { name: 'Edit Asha Rao' })).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Designation'), { target: { value: 'Director' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Contact Asha Rao updated.'));
      const call = port.calls.find((entry) => entry.action === 'updateContact');
      expect(call).toMatchObject({
        id: CONTACT_ID,
        changes: { designation: 'Director', expectedUpdatedAt: CONTACT.updatedAt },
      });
      expect(Object.keys(call?.changes ?? {}).sort()).toEqual(['designation', 'expectedUpdatedAt']);
    });

    it('asks before removing a contact, and Keep sends nothing', async () => {
      const { port, onToast } = await openDrawer(editable());

      fireEvent.click(screen.getByRole('button', { name: 'Remove Asha Rao' }));
      const dialog = screen.getByRole('dialog', { name: 'Remove Asha Rao?' });
      expect(dialog.textContent).toContain("They will be removed from Aster Foods's contact people.");
      fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Asha Rao?' })).toBeNull());
      expect(port.calls.some((call) => call.action === 'deleteContact')).toBe(false);
      expect(onToast).not.toHaveBeenCalled();
    });

    it('removes the contact once confirmed, with a toast', async () => {
      const { port, onToast } = await openDrawer(editable());

      fireEvent.click(screen.getByRole('button', { name: 'Remove Asha Rao' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove contact' }));

      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Contact Asha Rao removed.'));
      expect(port.calls.find((call) => call.action === 'deleteContact')).toMatchObject({ id: CONTACT_ID });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Remove Asha Rao?' })).toBeNull());
    });

    it('keeps the removal dialog open with an alert when removing is refused', async () => {
      const { port } = await openDrawer(editable());
      port.setDeleteContactError(new ClientOperationError({ code: 'forbidden', message: 'raw', status: 403 }));

      fireEvent.click(screen.getByRole('button', { name: 'Remove Asha Rao' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove contact' }));

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."),
      );
      expect(screen.getByRole('dialog', { name: 'Remove Asha Rao?' })).toBeTruthy();
    });

    it('never shows a raw UUID with the drawer and a dialog open', async () => {
      await openDrawer(editable());
      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
      expect(UUID.test(document.body.textContent ?? '')).toBe(false);
    });
  });
});
