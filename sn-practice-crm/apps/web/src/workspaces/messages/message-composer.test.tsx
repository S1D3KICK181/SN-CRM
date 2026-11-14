// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClientDto, ClientMessageDto } from '@sn/contracts';
import { MessageComposerProvider, useMessageComposer, type MessageComposeRequest } from './message-composer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ASTER: ClientDto = {
  id: '10000000-0000-4000-a000-000000000001',
  code: 'CL-000001',
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
  contacts: [
    {
      id: '74000000-0000-4000-a000-000000000001',
      name: 'Rahul Shah',
      designation: 'Accounts Manager',
      email: null,
      phone: null,
      whatsapp: '98200 12345',
      isPrimary: true,
      notes: null,
      updatedAt: '2026-10-01T04:30:00.000Z',
    },
  ],
  canEdit: true,
  canChangeOwnerOrStatus: false,
  looksAfter: true,
  createdById: '20000000-0000-4000-a000-000000000001',
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-10-01T04:30:00.000Z',
};

function sent(index: number, clientId = ASTER.id): ClientMessageDto {
  return {
    id: `75000000-0000-4000-a000-00000000000${index}`,
    clientId,
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
    body: `Message ${index}`,
    status: 'opened',
    sentById: '20000000-0000-4000-a000-000000000001',
    sentByName: 'Ananya Rao',
    createdAt: '2026-11-13T10:30:00.000Z',
  };
}

function Probe({ request }: { request: MessageComposeRequest }) {
  const composer = useMessageComposer();
  return (
    <>
      <button type="button" onClick={(event) => composer?.open(request, event.currentTarget)}>
        Start
      </button>
      <button type="button" onClick={() => composer?.showAll('10000000-0000-4000-a000-000000000001')}>
        All
      </button>
      <output aria-label="can message">{String(composer?.canMessage)}</output>
      <output aria-label="recent">{composer?.recentFor(ASTER.id, 2).map((message) => message.body).join('|')}</output>
    </>
  );
}

function setup(overrides: { role?: 'founder' | 'trainee'; clients?: readonly ClientDto[]; request?: MessageComposeRequest } = {}) {
  const record = vi.fn().mockResolvedValue(sent(9));
  const onShowAll = vi.fn();
  const onToast = vi.fn();
  render(
    <MessageComposerProvider
      role={overrides.role ?? 'founder'}
      clients={overrides.clients ?? [ASTER]}
      messages={[sent(1), sent(2), sent(3), sent(4, '10000000-0000-4000-a000-000000000002')]}
      record={record}
      onShowAll={onShowAll}
      onToast={onToast}
    >
      <Probe request={overrides.request ?? { clientId: ASTER.id, purpose: 'general' }} />
    </MessageComposerProvider>,
  );
  return { record, onShowAll, onToast };
}

describe('MessageComposerProvider', () => {
  it('opens the dialog for a client from the directory, with its contacts', () => {
    setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByRole('dialog', { name: 'Message on WhatsApp' })).toBeTruthy();
    expect((screen.getByLabelText('Send to') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      'Rahul Shah · Accounts Manager · +91 98200 12345',
    );
  });

  it('prefers the client details a screen passes over the directory', () => {
    setup({
      request: {
        clientId: ASTER.id,
        purpose: 'general',
        client: {
          id: ASTER.id,
          displayName: 'Aster Foods',
          phone: null,
          contacts: [
            { id: '74000000-0000-4000-a000-0000000000aa', name: 'Meera Iyer', designation: null, phone: null, whatsapp: '98765 43210', isPrimary: true },
          ],
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect((screen.getByLabelText('Send to') as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      'Meera Iyer · +91 98765 43210',
    );
  });

  it('says so and opens nothing when the client is unknown', () => {
    const { onToast } = setup({ clients: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onToast).toHaveBeenCalledWith('The client could not be found.');
  });

  it('never opens for a client the reader can see but does not look after', () => {
    const { onToast } = setup({ clients: [{ ...ASTER, looksAfter: false }] });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('never opens for a Trainee and says they cannot message', () => {
    setup({ role: 'trainee' });
    expect(screen.getByLabelText('can message').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives the newest messages of one client, up to the limit', () => {
    setup();
    expect(screen.getByLabelText('recent').textContent).toBe('Message 1|Message 2');
    expect(screen.getByLabelText('can message').textContent).toBe('true');
  });

  it('passes See all messages on to the app', () => {
    const { onShowAll } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onShowAll).toHaveBeenCalledWith(ASTER.id);
  });

  it('records through the hook, opens WhatsApp and closes the dialog', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { record, onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in WhatsApp' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(record).toHaveBeenCalledWith(
      {
        clientId: ASTER.id,
        contactId: '74000000-0000-4000-a000-000000000001',
        recipientName: 'Rahul Shah',
        recipientNumber: '919820012345',
        purpose: 'general',
        body: 'Dear Rahul, ',
      },
      expect.any(String),
    );
    expect(open).toHaveBeenCalledWith('https://wa.me/919820012345?text=Dear%20Rahul%2C%20', '_blank', 'noopener');
    expect(onToast).toHaveBeenCalledWith('WhatsApp opened for Rahul Shah. Press Send in WhatsApp to deliver it.');
  });

  it('returns null without a provider, so entry points can hide', () => {
    function Bare() {
      return <output aria-label="composer">{String(useMessageComposer())}</output>;
    }
    render(<Bare />);
    expect(screen.getByLabelText('composer').textContent).toBe('null');
  });
});
