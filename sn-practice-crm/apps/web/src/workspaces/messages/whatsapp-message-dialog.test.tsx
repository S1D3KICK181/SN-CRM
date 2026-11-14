// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RecordClientMessageInput } from '@sn/contracts';
import { MessagesOperationError } from '../../api/messages-types';
import {
  WhatsAppMessageDialog,
  recipientOptions,
  type MessageClientInfo,
  type MessageComposeSetup,
} from './whatsapp-message-dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CLIENT: MessageClientInfo = {
  id: '10000000-0000-4000-a000-000000000001',
  displayName: 'Aster Foods',
  phone: '+91 98200 11001',
  contacts: [
    {
      id: '74000000-0000-4000-a000-000000000001',
      name: 'Rahul Shah',
      designation: 'Accounts Manager',
      phone: '98200 99999',
      whatsapp: '98200 12345',
      isPrimary: true,
    },
    {
      id: '74000000-0000-4000-a000-000000000002',
      name: 'Meera Iyer',
      designation: null,
      phone: '98200 55555',
      whatsapp: null,
      isPrimary: false,
    },
    {
      id: '74000000-0000-4000-a000-000000000003',
      name: 'No Number',
      designation: 'Clerk',
      phone: null,
      whatsapp: null,
      isPrimary: false,
    },
  ],
};

const ASSIGNMENT = {
  id: '30000000-0000-4000-a000-000000000001',
  code: 'AS-001001',
  title: 'GSTR-1 & 3B Compliance · Oct 2026',
  dueOn: '11/11/2026',
};

const BILL = {
  id: '70000000-0000-4000-a000-000000000002',
  label: 'VYP-140',
  billDate: '24/10/2026',
  dueDate: '23/11/2026',
  pendingPaise: 3306000,
  overdue: false,
};

type RecordFn = (input: RecordClientMessageInput, key: string) => Promise<void>;

function setup(setupOverrides: Partial<MessageComposeSetup> = {}, onRecord: RecordFn = vi.fn<RecordFn>().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const onToast = vi.fn();
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const messageSetup: MessageComposeSetup = { client: CLIENT, purpose: 'general', ...setupOverrides };
  render(<WhatsAppMessageDialog open setup={messageSetup} onClose={onClose} onRecord={onRecord} onToast={onToast} />);
  return { onClose, onToast, onRecord: vi.mocked(onRecord), open };
}

const body = () => screen.getByLabelText('Message') as HTMLTextAreaElement;
const openButton = () => screen.getByRole('button', { name: /^(Open in WhatsApp|Opening…)$/ }) as HTMLButtonElement;
const recipient = () => screen.getByLabelText('Send to') as HTMLSelectElement;
const purpose = () => screen.getByLabelText('Purpose') as HTMLSelectElement;
const type = (value: string) => fireEvent.change(body(), { target: { value } });

describe('recipientOptions', () => {
  it('lists the contacts with a number, primary first, then the client phone', () => {
    expect(recipientOptions(CLIENT).map((option) => option.label)).toEqual([
      'Rahul Shah · Accounts Manager · +91 98200 12345',
      'Meera Iyer · +91 98200 55555',
      'Aster Foods · Client phone · +91 98200 11001',
    ]);
  });

  it('uses the WhatsApp number before the phone', () => {
    expect(recipientOptions(CLIENT)[0]?.number).toBe('98200 12345');
    expect(recipientOptions(CLIENT)[1]?.number).toBe('98200 55555');
  });
});

describe('WhatsAppMessageDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <WhatsAppMessageDialog open={false} setup={null} onClose={vi.fn()} onRecord={vi.fn()} onToast={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title and the client, and lists the people to send to with the primary contact chosen', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Message on WhatsApp' });
    expect(dialog.textContent).toContain('Aster Foods');
    expect(within(recipient()).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Rahul Shah · Accounts Manager · +91 98200 12345',
      'Meera Iyer · +91 98200 55555',
      'Aster Foods · Client phone · +91 98200 11001',
      'Another number',
    ]);
    expect(recipient().value).toBe('contact:74000000-0000-4000-a000-000000000001');
    expect(screen.queryByLabelText('WhatsApp number')).toBeNull();
    expect(
      within(purpose()).getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Document request', 'Deadline reminder', 'Payment reminder', 'General message']);
    expect(body().value).toBe('Dear Rahul, ');
  });

  it('shows the linked assignment, or the linked bill', () => {
    setup({ assignment: ASSIGNMENT, purpose: 'deadline_reminder' });
    expect(screen.getByRole('dialog').textContent).toContain('AS-001001 · GSTR-1 & 3B Compliance · Oct 2026');
    expect(body().value).toBe(
      'Dear Rahul, a reminder from SN & Associates: GSTR-1 & 3B Compliance · Oct 2026 is due on 11/11/2026. Please share any pending information so we can complete it on time. Thank you.',
    );
    cleanup();
    setup({ bill: BILL, purpose: 'payment_reminder' });
    expect(screen.getByRole('dialog').textContent).toContain('Bill VYP-140');
    expect(body().value).toBe(
      'Dear Rahul, a gentle reminder from SN & Associates: ₹33,060 is pending on bill VYP-140 dated 24/10/2026. Kindly arrange the payment at your convenience. Thank you.',
    );
  });

  it('counts the characters out of 2000 as the text changes', () => {
    setup();
    expect(screen.getByText('12 / 2000')).toBeTruthy();
    type('Dear Rahul, hello');
    expect(screen.getByText('17 / 2000')).toBeTruthy();
  });

  it('greets Sir/Madam for the client phone and for another number, and follows the person chosen', () => {
    setup();
    fireEvent.change(recipient(), { target: { value: 'contact:74000000-0000-4000-a000-000000000002' } });
    expect(body().value).toBe('Dear Meera, ');
    fireEvent.change(recipient(), { target: { value: 'client' } });
    expect(body().value).toBe('Dear Sir/Madam, ');
    fireEvent.change(recipient(), { target: { value: 'other' } });
    expect(body().value).toBe('Dear Sir/Madam, ');
  });

  it('leaves the text alone when the person changes after the user edited it', () => {
    setup();
    type('My own words');
    fireEvent.change(recipient(), { target: { value: 'client' } });
    expect(body().value).toBe('My own words');
    expect(screen.queryByText('Replace your text with the new draft?')).toBeNull();
  });

  it('asks for a number when another number is chosen, and refuses one that is not valid', async () => {
    const { onRecord, open } = setup();
    fireEvent.change(recipient(), { target: { value: 'other' } });
    const number = screen.getByLabelText('WhatsApp number');
    fireEvent.change(number, { target: { value: '12345' } });
    fireEvent.click(openButton());
    expect(screen.getByText('Enter a WhatsApp number with 10 digits, or with the country code.')).toBeTruthy();
    expect(number.getAttribute('aria-invalid')).toBe('true');
    expect(onRecord).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('records the message for another number under the client name, then opens WhatsApp', async () => {
    const { onRecord, open, onClose, onToast } = setup({ purpose: 'general' });
    fireEvent.change(recipient(), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '+91 98765-43210' } });
    type('Dear Sir/Madam, hello');
    fireEvent.click(openButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onRecord).toHaveBeenCalledWith(
      {
        clientId: CLIENT.id,
        recipientName: 'Aster Foods',
        recipientNumber: '919876543210',
        purpose: 'general',
        body: 'Dear Sir/Madam, hello',
      },
      expect.any(String),
    );
    expect(open).toHaveBeenCalledWith('https://wa.me/919876543210?text=Dear%20Sir%2FMadam%2C%20hello', '_blank', 'noopener');
    expect(onToast).toHaveBeenCalledWith('WhatsApp opened for Aster Foods. Press Send in WhatsApp to deliver it.');
  });

  it('records the contact and the linked work, and records before it opens WhatsApp', async () => {
    const order: string[] = [];
    const onRecord = vi.fn<RecordFn>().mockImplementation(async () => {
      order.push('record');
    });
    const { open, onClose } = setup({ assignment: ASSIGNMENT, purpose: 'deadline_reminder' }, onRecord);
    open.mockImplementation(() => {
      order.push('open');
      return null;
    });
    onClose.mockImplementation(() => order.push('close'));
    fireEvent.click(openButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['record', 'open', 'close']);
    expect(onRecord.mock.calls[0]?.[0]).toEqual({
      clientId: CLIENT.id,
      contactId: '74000000-0000-4000-a000-000000000001',
      recipientName: 'Rahul Shah',
      recipientNumber: '919820012345',
      purpose: 'deadline_reminder',
      assignmentId: ASSIGNMENT.id,
      body: body().value,
    });
  });

  it('records the bill it is about', async () => {
    const { onRecord, onClose } = setup({ bill: BILL, purpose: 'payment_reminder' });
    fireEvent.click(openButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onRecord.mock.calls[0]?.[0]).toMatchObject({ invoiceId: BILL.id, purpose: 'payment_reminder' });
  });

  it('refuses an empty text and a text over 2000 characters', () => {
    const { onRecord } = setup();
    type('   ');
    fireEvent.click(openButton());
    expect(screen.getByText('The message must be between 1 and 2000 characters.')).toBeTruthy();
    expect(body().getAttribute('aria-invalid')).toBe('true');
    type('x'.repeat(2001));
    fireEvent.click(openButton());
    expect(screen.getByText('The message must be between 1 and 2000 characters.')).toBeTruthy();
    expect(onRecord).not.toHaveBeenCalled();
    type('x'.repeat(2000));
    expect(screen.getByText('2000 / 2000')).toBeTruthy();
  });

  it('rebuilds the text when the purpose changes and the user has not edited it', () => {
    setup({ assignment: ASSIGNMENT });
    fireEvent.change(purpose(), { target: { value: 'document_request' } });
    expect(body().value).toBe(
      'Dear Rahul, this is a reminder from SN & Associates. Please share the documents needed for GSTR-1 & 3B Compliance · Oct 2026 at the earliest. Thank you.',
    );
    expect(screen.queryByText('Replace your text with the new draft?')).toBeNull();
  });

  it('asks before replacing a text the user edited, and replaces it on Yes', () => {
    setup({ assignment: ASSIGNMENT });
    type('My own words');
    fireEvent.change(purpose(), { target: { value: 'deadline_reminder' } });
    expect(screen.getByText('Replace your text with the new draft?')).toBeTruthy();
    expect(body().value).toBe('My own words');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(body().value).toContain('is due on 11/11/2026');
    expect(screen.queryByText('Replace your text with the new draft?')).toBeNull();
    // The new draft is untouched text again, so the next purpose rebuilds without asking
    fireEvent.change(purpose(), { target: { value: 'document_request' } });
    expect(screen.queryByText('Replace your text with the new draft?')).toBeNull();
    expect(body().value).toContain('documents needed for');
  });

  it('keeps the user text on Keep mine and still sends the new purpose', async () => {
    const { onRecord, onClose } = setup({ assignment: ASSIGNMENT });
    type('My own words');
    fireEvent.change(purpose(), { target: { value: 'deadline_reminder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(body().value).toBe('My own words');
    expect(screen.queryByText('Replace your text with the new draft?')).toBeNull();
    fireEvent.click(openButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRecord.mock.calls[0]?.[0]).toMatchObject({ purpose: 'deadline_reminder', body: 'My own words' });
  });

  it('copies the text and says so without recording anything', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { onRecord, onToast, open } = setup();
    type('Dear Rahul, hello');
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }));
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Message copied.'));
    expect(writeText).toHaveBeenCalledWith('Dear Rahul, hello');
    expect(onRecord).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('says so when the text cannot be copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const { onToast } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The text could not be copied. Select it and copy it by hand.');
    expect(onToast).not.toHaveBeenCalled();
  });

  it('shows the error, stays open and does not open WhatsApp when recording fails, then reuses the key on an unchanged retry', async () => {
    const onRecord = vi
      .fn<RecordFn>()
      .mockRejectedValueOnce(new MessagesOperationError({ code: 'network', message: 'raw socket detail' }))
      .mockResolvedValue(undefined);
    const { open, onClose, onToast } = setup({}, onRecord);
    fireEvent.click(openButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Unable to reach the server');
    expect(screen.getByRole('alert').textContent).not.toContain('socket');
    expect(open).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();

    fireEvent.click(openButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledTimes(2);
    expect(onRecord.mock.calls[1]?.[1]).toBe(onRecord.mock.calls[0]?.[1]);
  });

  it('uses a new key when the text changed after a failure', async () => {
    const onRecord = vi
      .fn<RecordFn>()
      .mockRejectedValueOnce(new MessagesOperationError({ code: 'network', message: 'x' }))
      .mockResolvedValue(undefined);
    const { onClose } = setup({}, onRecord);
    fireEvent.click(openButton());
    await screen.findByRole('alert');
    type('Dear Rahul, a different text');
    fireEvent.click(openButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onRecord.mock.calls[1]?.[1]).not.toBe(onRecord.mock.calls[0]?.[1]);
  });

  it('says to add a contact when there is nobody with a number, and still allows another number', () => {
    setup({ client: { ...CLIENT, phone: null, contacts: [CLIENT.contacts[2]!] } });
    expect(screen.getByText('Add a contact with a WhatsApp number first.')).toBeTruthy();
    expect(within(recipient()).getAllByRole('option').map((option) => option.textContent)).toEqual(['Another number']);
    expect(screen.getByLabelText('WhatsApp number')).toBeTruthy();
  });

  it('closes on Escape and on Cancel, but not while recording', async () => {
    let finish: () => void = () => undefined;
    const onRecord = vi.fn<RecordFn>().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { onClose } = setup({}, onRecord);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(openButton());
    await waitFor(() => expect(openButton().disabled).toBe(true));
    expect(openButton().textContent).toBe('Opening…');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
  });
});
