// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ClientDto, ClientMessageDto } from '@sn/contracts';
import { CommunicationWorkspace, type CommunicationWorkspaceProps } from './communication-workspace';
import { MessageComposerContextProvider, type MessageComposer } from './message-composer';

afterEach(cleanup);

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function client(id: string, code: string, displayName: string, canEdit = true): ClientDto {
  return {
    id,
    code,
    displayName,
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
    canEdit,
    canChangeOwnerOrStatus: false,
    createdById: '20000000-0000-4000-a000-000000000001',
    createdAt: '2026-10-01T04:30:00.000Z',
    updatedAt: '2026-10-01T04:30:00.000Z',
  };
}

const ASTER = client('10000000-0000-4000-a000-000000000001', 'CL-000001', 'Aster Foods');
const BOLT = client('10000000-0000-4000-a000-000000000002', 'CL-000002', 'Bolt Traders');

function message(overrides: Partial<ClientMessageDto> = {}): ClientMessageDto {
  return {
    id: '75000000-0000-4000-a000-000000000001',
    clientId: ASTER.id,
    clientCode: 'CL-000001',
    clientName: 'Aster Foods',
    contactId: '74000000-0000-4000-a000-000000000001',
    recipientName: 'Rahul Shah',
    recipientNumber: '919820012345',
    channel: 'whatsapp',
    purpose: 'payment_reminder',
    assignmentId: null,
    assignmentCode: null,
    invoiceId: '70000000-0000-4000-a000-000000000001',
    invoiceLabel: 'VYP-118',
    body: 'Dear Rahul, a gentle reminder about bill VYP-118.',
    status: 'opened',
    sentById: '20000000-0000-4000-a000-000000000002',
    sentByName: 'Ananya Rao',
    createdAt: '2026-11-13T10:30:00.000Z',
    ...overrides,
  };
}

const PAYMENT = message();
const DEADLINE = message({
  id: '75000000-0000-4000-a000-000000000002',
  clientId: BOLT.id,
  clientCode: 'CL-000002',
  clientName: 'Bolt Traders',
  contactId: null,
  recipientName: 'Meera Iyer',
  recipientNumber: '919876543210',
  purpose: 'deadline_reminder',
  invoiceId: null,
  invoiceLabel: null,
  assignmentId: '30000000-0000-4000-a000-000000000002',
  assignmentCode: 'AS-001002',
  body: 'Dear Meera, GSTR-3B is due on 20/11/2026.',
  createdAt: '2026-11-12T08:00:00.000Z',
});

function setup(overrides: Partial<CommunicationWorkspaceProps> = {}, composerOverrides: Partial<MessageComposer> = {}) {
  const composer: MessageComposer = {
    canMessage: true,
    open: vi.fn(),
    recentFor: () => [],
    showAll: vi.fn(),
    ...composerOverrides,
  };
  const props: CommunicationWorkspaceProps = {
    role: 'founder',
    messages: [PAYMENT, DEADLINE],
    clients: [ASTER, BOLT],
    loading: false,
    hasLiveSnapshot: true,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const view = render(
    <MessageComposerContextProvider value={composer}>
      <CommunicationWorkspace {...props} />
    </MessageComposerContextProvider>,
  );
  return { composer, props, ...view };
}

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('CommunicationWorkspace', () => {
  it('shows the card with its description and the new message button', () => {
    setup();
    expect(screen.getByText('Client messages')).toBeTruthy();
    expect(screen.getByText('Every WhatsApp message sent from the CRM, newest first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /New message/ })).toBeTruthy();
  });

  it('lists each message in the order given, with who sent it, the recipient, the work and the status', () => {
    setup();
    const [first, second] = rows();
    expect(first?.textContent).toContain('13/11/2026 · 4:00 pm');
    expect(first?.textContent).toContain('Ananya Rao');
    expect(first?.textContent).toContain('Aster Foods');
    expect(first?.textContent).toContain('CL-000001');
    expect(first?.textContent).toContain('Rahul Shah');
    expect(first?.textContent).toContain('+91 98200 12345');
    expect(first?.textContent).toContain('Payment reminder');
    expect(first?.textContent).toContain('VYP-118');
    expect(first?.textContent).toContain('Dear Rahul, a gentle reminder about bill VYP-118.');
    expect(first?.textContent).toContain('Opened in WhatsApp');
    expect(second?.textContent).toContain('Deadline reminder');
    expect(second?.textContent).toContain('AS-001002');
  });

  it('shows a dash when a message is about no work', () => {
    setup({ messages: [message({ invoiceId: null, invoiceLabel: null, purpose: 'general' })] });
    const cells = within(rows()[0]!).getAllByRole('cell');
    expect(cells[4]?.textContent).toBe('—');
  });

  it('never shows a raw identifier', () => {
    const { container } = setup();
    expect(container.textContent).not.toMatch(UUID_PATTERN);
  });

  it('shows the first 120 characters of a long message and expands it', () => {
    const long = `Dear Rahul, ${'a'.repeat(200)}END`;
    setup({ messages: [message({ body: long })] });
    const row = rows()[0]!;
    expect(row.textContent).toContain(`${long.slice(0, 120)}…`);
    expect(row.textContent).not.toContain('END');
    const toggle = within(row).getByRole('button', { name: 'Show all of the message to Rahul Shah' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(row.textContent).toContain('END');
    expect(within(row).getByRole('button', { name: 'Show less of the message to Rahul Shah' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(row).getByRole('button', { name: 'Show less of the message to Rahul Shah' }));
    expect(row.textContent).not.toContain('END');
  });

  it('has no expand control for a message of 120 characters or fewer', () => {
    setup({ messages: [message({ body: 'x'.repeat(120) })] });
    expect(within(rows()[0]!).queryByRole('button')).toBeNull();
  });

  it('filters by client, by purpose and by a search over the text and the recipient', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Filter by client'), { target: { value: BOLT.id } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Bolt Traders');
    fireEvent.change(screen.getByLabelText('Filter by client'), { target: { value: 'all' } });

    fireEvent.change(screen.getByLabelText('Filter by purpose'), { target: { value: 'payment_reminder' } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Aster Foods');
    fireEvent.change(screen.getByLabelText('Filter by purpose'), { target: { value: 'all' } });

    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'gstr-3b' } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'rahul' } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Aster Foods');
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: '98765' } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('Bolt Traders');
    fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No messages match these filters.')).toBeTruthy();
  });

  it('starts on the client it was opened for, and follows a new one', () => {
    const { rerender, props, composer } = setup({ initialClientId: BOLT.id });
    expect((screen.getByLabelText('Filter by client') as HTMLSelectElement).value).toBe(BOLT.id);
    expect(rows()).toHaveLength(1);
    rerender(
      <MessageComposerContextProvider value={composer}>
        <CommunicationWorkspace {...props} initialClientId={null} />
      </MessageComposerContextProvider>,
    );
    expect((screen.getByLabelText('Filter by client') as HTMLSelectElement).value).toBe('all');
    expect(rows()).toHaveLength(2);
  });

  it('offers a client in the filter even when the directory does not list it', () => {
    setup({ clients: [], initialClientId: BOLT.id });
    expect((screen.getByLabelText('Filter by client') as HTMLSelectElement).value).toBe(BOLT.id);
    expect(rows()).toHaveLength(1);
  });

  it('shows the empty state when there are no messages at all', () => {
    setup({ messages: [] });
    expect(screen.getByText('No messages yet. Start one from a client, an assignment or a bill.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the trainee card and no list, no button and no request to start a message', () => {
    const { composer } = setup({ role: 'trainee' }, { canMessage: false });
    expect(
      screen.getByText('Client messages are available to the Founder, the Manager and the staff who look after each client.'),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /New message/ })).toBeNull();
    expect(composer.open).not.toHaveBeenCalled();
  });

  it('hides the new message button when there is no composer', () => {
    render(
      <CommunicationWorkspace
        role="founder"
        messages={[]}
        clients={[ASTER]}
        loading={false}
        hasLiveSnapshot
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /New message/ })).toBeNull();
  });

  it('asks for the client first, then starts a general message for that client', () => {
    const { composer } = setup();
    const button = screen.getByRole('button', { name: /New message/ });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'New message' });
    expect(within(dialog).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Choose a client',
      'CL-000001 · Aster Foods',
      'CL-000002 · Bolt Traders',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByText('Choose a client.')).toBeTruthy();
    expect(composer.open).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Client'), { target: { value: BOLT.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(composer.open).toHaveBeenCalledWith({ clientId: BOLT.id, purpose: 'general' }, button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the client choice on Cancel and Escape without starting a message', () => {
    const { composer } = setup();
    fireEvent.click(screen.getByRole('button', { name: /New message/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /New message/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(composer.open).not.toHaveBeenCalled();
  });

  it('shows skeleton rows while the first load runs, and an error card with Retry when it fails', () => {
    const { onRetry } = setup({ loading: true, hasLiveSnapshot: false }).props;
    expect(screen.getByLabelText('Loading messages')).toBeTruthy();
    cleanup();

    const retry = vi.fn();
    setup({ error: 'Unable to reach the server.', hasLiveSnapshot: false, onRetry: retry });
    expect(screen.getByRole('alert').textContent).toContain('Unable to load messages');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('keeps the list and warns when a later refresh fails', () => {
    const { props } = setup({ error: 'Unable to reach the server.', hasLiveSnapshot: true });
    expect(screen.getByRole('status').textContent).toContain('Refresh failed. Showing last loaded data.');
    expect(rows()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });
});
