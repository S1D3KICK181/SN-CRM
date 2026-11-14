// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ClientProfileDrawer } from './client-profile-drawer';
import { toClientDetailViewModel } from './clients-view-model';
import { ClientOperationError } from '../../api/clients-types';
import { MessageComposerContextProvider, type MessageComposer } from '../messages/message-composer';
import type { ClientDto, ClientMessageDto } from '@sn/contracts';

afterEach(() => {
  cleanup();
});

function createMockDto(overrides: Partial<ClientDto> = {}): ClientDto {
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
    notes: 'Key FMCG account with monthly GST filings.',
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
    createdById: 'u1111111-1111-4111-8111-111111111111',
    createdAt: '2026-04-01T09:30:00.000Z',
    updatedAt: '2026-04-15T14:20:00.000Z',
    ...overrides,
  };
}

describe('ClientProfileDrawer', () => {
  it('renders loading skeleton when loading with no client data, hiding tabs until client exists', () => {
    render(
      <ClientProfileDrawer
        client={null}
        loading={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Loading client…')).toBeTruthy();
    expect(screen.getByLabelText('Loading client details')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Tabs must be hidden until client exists
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders error state with retry button when loading fails', () => {
    const onRetry = vi.fn();
    const error = new ClientOperationError({
      code: 'network',
      message: 'Failed to fetch client record from server.',
    });

    render(
      <ClientProfileDrawer
        client={null}
        loading={false}
        error={error}
        onClose={vi.fn()}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Unable to load client details')).toBeTruthy();
    expect(screen.getByText('Failed to fetch client record from server.')).toBeTruthy();

    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders proper dialog semantics, focuses on open, and closes on Escape key', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);
    const onClose = vi.fn();

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('client-drawer-title');

    // Focus on open
    expect(document.activeElement).toBe(dialog);

    // Escape closes
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders client overview details with accurate fields and formatting', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);
    const onClose = vi.fn();

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={onClose}
      />
    );

    // Header checks
    expect(screen.getByRole('heading', { name: 'Aster Foods', level: 2 })).toBeTruthy();
    expect(screen.getByText('AF')).toBeTruthy();
    expect(screen.getByText(/Aster Foods Private Limited · CL-000001/i)).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);

    // Overview tab fields
    expect(screen.getByText('CL-000001')).toBeTruthy();
    expect(screen.getByText('Aster Foods Private Limited')).toBeTruthy();
    expect(screen.getByText('S. Narayanan')).toBeTruthy();
    expect(screen.getByText('contact@asterfoods.in')).toBeTruthy();
    expect(screen.getByText('+91 98200 12345')).toBeTruthy();
    expect(screen.getByText('01/04/2026')).toBeTruthy();
    expect(screen.getByText('15/04/2026')).toBeTruthy();
    expect(screen.getByText('Key FMCG account with monthly GST filings.')).toBeTruthy();

    // Verify close buttons
    const closeIconBtn = screen.getByLabelText('Close drawer');
    fireEvent.click(closeIconBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    const footerCloseBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(footerCloseBtn);
    expect(onClose).toHaveBeenCalledTimes(2);

    const backdrop = screen.getByTestId('drawer-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('handles absent legal name in header by showing code once, never "code · code"', () => {
    const dto = createMockDto({
      legalName: null,
      email: null,
      phone: null,
      notes: null,
      relationshipOwnerName: null,
    });
    const client = toClientDetailViewModel(dto);

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={vi.fn()}
      />
    );

    // Subtitle must show code once, without middle dot or duplication
    const headerLead = screen.getByRole('heading', { name: 'Aster Foods', level: 2 }).parentElement;
    expect(headerLead?.querySelector('p')?.textContent).toBe('CL-000001');

    // Null fallbacks
    expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('strictly excludes edit, form, and mutation controls', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={vi.fn()}
      />
    );

    // No edit or save buttons
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /compose/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new assignment/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /request docs/i })).toBeNull();

    // No input or select form controls
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('switches tabs with compact visible labels and proper tablist/tab/tabpanel semantics', () => {
    const dto = createMockDto();
    const client = toClientDetailViewModel(dto);

    render(
      <ClientProfileDrawer
        client={client}
        loading={false}
        onClose={vi.fn()}
      />
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeTruthy();

    // Default tab: Overview
    const overviewTab = screen.getByRole('tab', { name: /^overview$/i });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /^overview$/i })).toBeTruthy();

    // Switch to compact KYC tab
    const kycTab = screen.getByRole('tab', { name: /^kyc$/i });
    expect(kycTab.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(kycTab);

    expect(kycTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: /^kyc$/i })).toBeTruthy();
    expect(screen.getByText('******1234')).toBeTruthy();
    expect(screen.getByText('27**********1Z5')).toBeTruthy();
    expect(
      screen.getByText(
        'Full PAN and GSTIN are shown to the Founder, the Manager and the staff who look after this client. Everyone else sees them masked.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Not available in this view')).toBeNull();
    expect(screen.getByText('TAN')).toBeTruthy();

    // Switch to compact Schedules tab
    const schedulesTab = screen.getByRole('tab', { name: /^schedules$/i });
    fireEvent.click(schedulesTab);
    expect(screen.getByText('Compliance schedules are not available in this view.')).toBeTruthy();

    // Switch to compact Work tab
    const workTab = screen.getByRole('tab', { name: /^work$/i });
    fireEvent.click(workTab);
    expect(screen.getByText('3 active')).toBeTruthy();
    expect(screen.getByText('Detailed assignment records and historical engagement logs are not available in this view.')).toBeTruthy();

    // Switch to compact Billing tab
    const billingTab = screen.getByRole('tab', { name: /^billing$/i });
    fireEvent.click(billingTab);
    expect(screen.getByText('Billing & ledgers are not available in this view.')).toBeTruthy();
  });

  it('applies text containment classes for worst-case unbreakable values', () => {
    const unbreakableName = 'Supercalifragilisticexpialidocious_Unbreakable_Corporation_Global_Industries_Limited';
    const unbreakableEmail = 'contact_unbreakable_officer_extremely_long_identifier_address@subdomain.practice.internal';
    const unbreakableNotes = 'Note_without_spaces_1234567890123456789012345678901234567890';
    const dto = createMockDto({
      displayName: unbreakableName,
      legalName: unbreakableName,
      email: unbreakableEmail,
      notes: unbreakableNotes,
    });
    const client = toClientDetailViewModel(dto);

    render(<ClientProfileDrawer client={client} loading={false} onClose={vi.fn()} />);

    const title = screen.getByRole('heading', { level: 2 });
    expect(title.className).toContain('drawer-title-contain');
    expect(title.textContent).toBe(unbreakableName);

    const notesEl = screen.getByText(unbreakableNotes);
    expect(notesEl.className).toContain('drawer-text-contain');
  });

  describe('client master sections', () => {
    const contact = {
      id: 'd1111111-1111-4111-8111-111111111111',
      name: 'Asha Rao',
      designation: 'Finance head',
      email: 'asha@asterfoods.in',
      phone: '+91 98200 11111',
      whatsapp: '+91 98200 22222',
      isPrimary: true,
      notes: null,
      updatedAt: '2026-04-15T14:20:00.000Z',
    };
    const second = {
      ...contact,
      id: 'd2222222-2222-4222-8222-222222222222',
      name: 'Vikram Shah',
      designation: 'Accounts',
      email: 'vikram@asterfoods.in',
      isPrimary: false,
    };
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

    it('shows Not added, No address added and the empty contact state for a bare client', () => {
      render(<ClientProfileDrawer client={toClientDetailViewModel(createMockDto())} onClose={vi.fn()} />);

      expect(screen.getByText('Identity and registrations')).toBeTruthy();
      expect(screen.getByText('Entity type')).toBeTruthy();
      expect(screen.getAllByText('Not added').length).toBeGreaterThanOrEqual(6);
      expect(screen.getByText('Address')).toBeTruthy();
      expect(screen.getByText('No address added')).toBeTruthy();
      expect(screen.getByText('Contact people')).toBeTruthy();
      expect(screen.getByText('No contact people yet.')).toBeTruthy();
    });

    it('shows each registration, the address block and the contact people', () => {
      const dto = createMockDto({
        entityType: 'llp',
        tan: 'ABCD12345E',
        cinLlpin: 'AAB-1234',
        udyamNumber: 'UDYAM-MH-01-0000001',
        iec: 'ABCDE12345',
        incorporationDate: '2015-03-09',
        addressLine1: '12 Park Street',
        addressLine2: 'Second floor',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700016',
        contacts: [contact, second],
      });
      render(<ClientProfileDrawer client={toClientDetailViewModel(dto)} onClose={vi.fn()} />);

      expect(screen.getByText('LLP')).toBeTruthy();
      expect(screen.getByText('ABCD12345E')).toBeTruthy();
      expect(screen.getByText('AAB-1234')).toBeTruthy();
      expect(screen.getByText('UDYAM-MH-01-0000001')).toBeTruthy();
      expect(screen.getByText('ABCDE12345')).toBeTruthy();
      expect(screen.getByText('09/03/2015')).toBeTruthy();

      expect(screen.getByText('12 Park Street')).toBeTruthy();
      expect(screen.getByText('Second floor')).toBeTruthy();
      expect(screen.getByText('Kolkata, West Bengal 700016')).toBeTruthy();
      expect(screen.queryByText('No address added')).toBeNull();

      expect(screen.getByText('Asha Rao')).toBeTruthy();
      expect(screen.getAllByText('Primary')).toHaveLength(1);
      expect(screen.getByText('Finance head')).toBeTruthy();
      expect(screen.getByText('asha@asterfoods.in')).toBeTruthy();
      expect(screen.getAllByText('Phone: +91 98200 11111')).toHaveLength(2);
      expect(screen.getAllByText('WhatsApp: +91 98200 22222')).toHaveLength(2);
      expect(screen.getByText('Vikram Shah')).toBeTruthy();
      expect(screen.queryByText('No contact people yet.')).toBeNull();
    });

    it('shows the full PAN and GSTIN when the client carries them, otherwise the masked values', () => {
      const { unmount } = render(
        <ClientProfileDrawer
          client={toClientDetailViewModel(createMockDto({ pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5' }))}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByText('ABCDE1234F')).toBeTruthy();
      expect(screen.getByText('27ABCDE1234F1Z5')).toBeTruthy();
      expect(screen.queryByText('******1234')).toBeNull();
      unmount();

      render(<ClientProfileDrawer client={toClientDetailViewModel(createMockDto())} onClose={vi.fn()} />);
      expect(screen.getByText('******1234')).toBeTruthy();
      expect(screen.getByText('27**********1Z5')).toBeTruthy();
      expect(document.body.textContent).not.toContain('ABCDE1234F');
    });

    it('hides Edit details, Add contact and the contact Edit and Remove when canEdit is false', () => {
      const client = toClientDetailViewModel(createMockDto({ canEdit: false, contacts: [contact] }));
      render(
        <ClientProfileDrawer
          client={client}
          onClose={vi.fn()}
          onEditClient={vi.fn()}
          onAddContact={vi.fn()}
          onEditContact={vi.fn()}
          onRemoveContact={vi.fn()}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit Asha Rao' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove Asha Rao' })).toBeNull();
      expect(screen.getByText('Asha Rao')).toBeTruthy();
    });

    it('shows the edit actions when canEdit is true and reports which contact was chosen', () => {
      const onEditClient = vi.fn();
      const onAddContact = vi.fn();
      const onEditContact = vi.fn();
      const onRemoveContact = vi.fn();
      const client = toClientDetailViewModel(createMockDto({ canEdit: true, contacts: [contact, second] }));
      render(
        <ClientProfileDrawer
          client={client}
          onClose={vi.fn()}
          onEditClient={onEditClient}
          onAddContact={onAddContact}
          onEditContact={onEditContact}
          onRemoveContact={onRemoveContact}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
      expect(onEditClient).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
      expect(onAddContact).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Edit Vikram Shah' }));
      expect(onEditContact).toHaveBeenCalledWith(second.id);
      fireEvent.click(screen.getByRole('button', { name: 'Remove Asha Rao' }));
      expect(onRemoveContact).toHaveBeenCalledWith(contact.id);
    });

    it('never shows a raw UUID anywhere in the drawer', () => {
      const client = toClientDetailViewModel(
        createMockDto({ canEdit: true, relationshipOwnerName: null, contacts: [contact, second] }),
      );
      render(<ClientProfileDrawer client={client} onClose={vi.fn()} onEditClient={vi.fn()} />);

      expect(UUID.test(document.body.textContent ?? '')).toBe(false);
    });

    it('leaves Escape to a dialog opened over the drawer', () => {
      const onClose = vi.fn();
      render(<ClientProfileDrawer client={toClientDetailViewModel(createMockDto())} onClose={onClose} />);

      const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      handled.preventDefault();
      window.dispatchEvent(handled);
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ClientProfileDrawer messages (MSG-01)', () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const CONTACT = {
    id: '74000000-0000-4000-a000-000000000001',
    name: 'Rahul Shah',
    designation: 'Accounts Manager',
    email: null,
    phone: '98200 99999',
    whatsapp: '98200 12345',
    isPrimary: true,
    notes: null,
    updatedAt: '2026-04-15T14:20:00.000Z',
  };

  function sentMessage(index: number, overrides: Partial<ClientMessageDto> = {}): ClientMessageDto {
    return {
      id: `75000000-0000-4000-a000-00000000000${index}`,
      clientId: 'c1111111-1111-4111-8111-111111111111',
      clientCode: 'CL-000001',
      clientName: 'Aster Foods',
      contactId: null,
      recipientName: 'Rahul Shah',
      recipientNumber: '919820012345',
      channel: 'whatsapp',
      purpose: 'general',
      assignmentId: null,
      assignmentCode: null,
      invoiceId: null,
      invoiceLabel: null,
      body: `Message number ${index}`,
      status: 'opened',
      sentById: '20000000-0000-4000-a000-000000000001',
      sentByName: 'Ananya Rao',
      createdAt: '2026-11-13T10:30:00.000Z',
      ...overrides,
    };
  }

  function renderWithComposer(composerOverrides: Partial<MessageComposer> = {}, dtoOverrides: Partial<ClientDto> = {}) {
    const composer: MessageComposer = {
      canMessage: true,
      open: vi.fn(),
      recentFor: vi.fn().mockReturnValue([]),
      showAll: vi.fn(),
      ...composerOverrides,
    };
    render(
      <MessageComposerContextProvider value={composer}>
        <ClientProfileDrawer
          client={toClientDetailViewModel(createMockDto({ contacts: [CONTACT], ...dtoOverrides }))}
          onClose={vi.fn()}
          onEditClient={vi.fn()}
        />
      </MessageComposerContextProvider>,
    );
    return composer;
  }

  it('shows Message on WhatsApp next to Edit details and starts a General message with the contacts on screen', () => {
    const composer = renderWithComposer({}, { canEdit: true });
    const button = screen.getByRole('button', { name: 'Message on WhatsApp' });
    const edit = screen.getByRole('button', { name: 'Edit details' });
    expect(button.parentElement).toBe(edit.parentElement);
    fireEvent.click(button);
    expect(composer.open).toHaveBeenCalledWith(
      {
        clientId: 'c1111111-1111-4111-8111-111111111111',
        purpose: 'general',
        client: {
          id: 'c1111111-1111-4111-8111-111111111111',
          displayName: 'Aster Foods',
          phone: '+91 98200 12345',
          contacts: [
            {
              id: CONTACT.id,
              name: 'Rahul Shah',
              designation: 'Accounts Manager',
              phone: '98200 99999',
              whatsapp: '98200 12345',
              isPrimary: true,
            },
          ],
        },
      },
      button,
    );
  });

  it('offers no client phone when the profile has none', () => {
    const composer = renderWithComposer({}, { phone: null });
    fireEvent.click(screen.getByRole('button', { name: 'Message on WhatsApp' }));
    expect(vi.mocked(composer.open).mock.calls[0]?.[0].client?.phone).toBeNull();
  });

  it('has no button and no Messages section for someone who may not message clients', () => {
    renderWithComposer({ canMessage: false });
    expect(screen.queryByRole('button', { name: 'Message on WhatsApp' })).toBeNull();
    expect(screen.queryByText('Messages')).toBeNull();
    expect(screen.queryByRole('button', { name: 'See all messages' })).toBeNull();
  });

  it('has no button and no Messages section when the screen has no composer', () => {
    render(<ClientProfileDrawer client={toClientDetailViewModel(createMockDto())} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Message on WhatsApp' })).toBeNull();
    expect(screen.queryByText('Messages')).toBeNull();
  });

  it('shows no button while the client is still loading', () => {
    const composer: MessageComposer = { canMessage: true, open: vi.fn(), recentFor: () => [], showAll: vi.fn() };
    render(
      <MessageComposerContextProvider value={composer}>
        <ClientProfileDrawer client={null} loading onClose={vi.fn()} />
      </MessageComposerContextProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Message on WhatsApp' })).toBeNull();
  });

  it('lists the last 5 messages for the client with the purpose, the person and the date', () => {
    const recentFor = vi.fn().mockReturnValue([
      sentMessage(1, { purpose: 'payment_reminder', recipientName: 'Meera Iyer', body: 'x'.repeat(100) }),
      sentMessage(2),
    ]);
    renderWithComposer({ recentFor });
    expect(recentFor).toHaveBeenCalledWith('c1111111-1111-4111-8111-111111111111', 5);
    const section = screen.getByText('Messages').closest('.drawer-card') as HTMLElement;
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Payment reminder · Meera Iyer · 13/11/2026');
    expect(items[0]?.textContent).toContain(`${'x'.repeat(80)}…`);
    expect(items[1]?.textContent).toContain('General message · Rahul Shah');
    expect(items[1]?.textContent).toContain('Message number 2');
    expect(UUID.test(section.textContent ?? '')).toBe(false);
  });

  it('says there are no messages yet, and takes the reader to all of them', () => {
    const composer = renderWithComposer();
    expect(screen.getByText('No messages yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See all messages' }));
    expect(composer.showAll).toHaveBeenCalledWith('c1111111-1111-4111-8111-111111111111');
  });
});
