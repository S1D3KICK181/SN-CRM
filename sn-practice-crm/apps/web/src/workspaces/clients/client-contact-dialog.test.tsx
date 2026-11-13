// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClientContactDto } from '@sn/contracts';
import { ClientOperationError } from '../../api/clients-types';
import {
  ClientContactDialog,
  RemoveContactDialog,
  buildContactChanges,
  type ContactFormInput,
} from './client-contact-dialog';

afterEach(cleanup);

const CONTACT: ClientContactDto = {
  id: 'd1111111-1111-4111-8111-111111111111',
  name: 'Asha Rao',
  designation: 'Finance head',
  email: 'asha@asterfoods.in',
  phone: '+91 98200 11111',
  whatsapp: '+91 98200 11111',
  isPrimary: true,
  notes: 'Prefers mornings.',
  updatedAt: '2026-04-15T14:20:00.000Z',
};

type Submit = (input: ContactFormInput, key: string) => Promise<void>;

function setup(contact: ClientContactDto | null = null, onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<ClientContactDialog contact={contact} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const saveButton = () => screen.getByRole('button', { name: /^(Save contact|Saving…)$/ }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const lastInput = (onSubmit: Submit) => vi.mocked(onSubmit).mock.calls.at(-1)?.[0];

describe('ClientContactDialog', () => {
  it('shows the add title, the fields and plain checkboxes outside the field wrapper', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Add contact' });
    for (const label of ['Name', 'Designation', 'Email', 'Phone', 'WhatsApp number', 'Notes']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    for (const label of ['Same as phone', 'Primary contact']) {
      const checkbox = screen.getByLabelText(label) as HTMLInputElement;
      expect(checkbox.type).toBe('checkbox');
      expect(checkbox.checked).toBe(false);
      expect(checkbox.closest('.field')).toBeNull();
    }
    expect(dialog.textContent).toContain('The main person to reach at this client.');
    expect(screen.getByLabelText('Primary contact').getAttribute('aria-describedby')).toBe('client-contact-primary-hint');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(saveButton().textContent).toBe('Save contact');
  });

  it('shows the edit title with the contact name and the saved values', () => {
    setup(CONTACT);
    expect(screen.getByRole('dialog', { name: 'Edit Asha Rao' })).toBeTruthy();
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value('Name')).toBe('Asha Rao');
    expect(value('Designation')).toBe('Finance head');
    expect(value('Email')).toBe('asha@asterfoods.in');
    expect(value('Phone')).toBe('+91 98200 11111');
    expect(value('WhatsApp number')).toBe('+91 98200 11111');
    expect(value('Notes')).toBe('Prefers mornings.');
    expect((screen.getByLabelText('Primary contact') as HTMLInputElement).checked).toBe(true);
    // The saved WhatsApp number equals the phone, so the link starts on.
    expect((screen.getByLabelText('Same as phone') as HTMLInputElement).checked).toBe(true);
  });

  it.each([
    ['one character', 'A', false],
    ['a blank name', '   ', false],
    ['121 characters', 'x'.repeat(121), false],
    ['2 characters', 'Jo', true],
    ['120 characters', 'x'.repeat(120), true],
  ])('checks the name length: %s', (_label, value, valid) => {
    const { onSubmit } = setup();
    type('Name', value);
    type('Email', 'jo@example.com');
    fireEvent.click(saveButton());
    expect(screen.queryByText('Contact name must be between 2 and 120 characters.') !== null).toBe(!valid);
    expect(vi.mocked(onSubmit).mock.calls.length).toBe(valid ? 1 : 0);
  });

  it('needs at least one of email, phone or WhatsApp', async () => {
    const { onSubmit } = setup();
    type('Name', 'Jo Mehta');
    fireEvent.click(saveButton());
    expect(screen.getByText('Add at least one way to reach this contact.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Please correct the highlighted fields.');
    expect(onSubmit).not.toHaveBeenCalled();

    type('WhatsApp number', '+91 98200 33333');
    expect(screen.queryByText('Add at least one way to reach this contact.')).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['Phone', 'abc123', 'Phone number may contain only digits, spaces, + and -.'],
    ['Phone', '1'.repeat(21), 'Phone number must not exceed 20 characters.'],
    ['WhatsApp number', 'call me', 'WhatsApp number may contain only digits, spaces, + and -.'],
    ['Email', 'nope', 'Invalid email address format.'],
    ['Designation', 'x'.repeat(81), 'Designation must not exceed 80 characters.'],
    ['Notes', 'x'.repeat(301), 'Notes must not exceed 300 characters.'],
  ])('flags %s %j with the server wording', (label, value, message) => {
    const { onSubmit } = setup();
    type('Name', 'Jo Mehta');
    type('Email', 'jo@example.com');
    type(label, value);
    fireEvent.click(saveButton());
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Same as phone copies the phone into WhatsApp, keeps them in step, and releases it when unticked', () => {
    setup();
    type('Phone', '+91 98200 44444');
    fireEvent.click(screen.getByLabelText('Same as phone'));
    const whatsapp = screen.getByLabelText('WhatsApp number') as HTMLInputElement;
    expect(whatsapp.value).toBe('+91 98200 44444');
    expect(whatsapp.disabled).toBe(true);

    type('Phone', '+91 98200 55555');
    expect(whatsapp.value).toBe('+91 98200 55555');

    fireEvent.click(screen.getByLabelText('Same as phone'));
    expect(whatsapp.disabled).toBe(false);
    expect(whatsapp.value).toBe('+91 98200 55555');
    type('Phone', '+91 98200 66666');
    expect(whatsapp.value).toBe('+91 98200 55555');
  });

  it('sends the phone as the WhatsApp number when Same as phone is ticked', async () => {
    const { onSubmit } = setup();
    type('Name', 'Jo Mehta');
    type('Phone', '+91 98200 44444');
    fireEvent.click(screen.getByLabelText('Same as phone'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastInput(onSubmit)).toMatchObject({ phone: '+91 98200 44444', whatsapp: '+91 98200 44444' });
  });

  it('sends the primary choice, and trimmed values with empty ones as null', async () => {
    const { onSubmit, onClose } = setup();
    type('Name', '  Jo Mehta ');
    type('Designation', '  ');
    type('Email', ' jo@example.com ');
    fireEvent.click(screen.getByLabelText('Primary contact'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        name: 'Jo Mehta',
        designation: null,
        email: 'jo@example.com',
        phone: null,
        whatsapp: null,
        isPrimary: true,
        notes: null,
      },
      expect.any(String),
    );
  });

  it('sends isPrimary false when the box is left alone', async () => {
    const { onSubmit } = setup();
    type('Name', 'Jo Mehta');
    type('Phone', '+91 98200 44444');
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastInput(onSubmit)).toMatchObject({ isPrimary: false });
  });

  it('says so and sends nothing when an edit changes nothing', () => {
    const { onSubmit } = setup(CONTACT);
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert').textContent).toBe('There are no changes to save.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables Save and shows Saving… while saving, sending once', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setup(null, onSubmit);
    type('Name', 'Jo Mehta');
    type('Phone', '+91 98200 44444');
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().textContent).toBe('Saving…'));
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('reuses the key on an unchanged retry and mints a new one after an edit', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ClientOperationError({ code: 'network', message: 'down' }));
    setup(null, onSubmit);
    type('Name', 'Jo Mehta');
    type('Phone', '+91 98200 44444');

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);

    type('Designation', 'Accounts');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it('keeps the dialog open with the input and shows the stale message for stale_contact', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ClientOperationError({ code: 'conflict', message: 'raw', status: 409, serverCode: 'stale_contact' }),
    );
    const { onClose } = setup(CONTACT, onSubmit);
    type('Designation', 'Director');
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'This contact was changed by someone else. Reload and try again.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Designation') as HTMLInputElement).value).toBe('Director');
  });

  it('shows the permission message for a 403', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ClientOperationError({ code: 'forbidden', message: 'x', status: 403 }));
    setup(null, onSubmit);
    type('Name', 'Jo Mehta');
    type('Phone', '+91 98200 44444');
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
  });

  it('closes through Cancel, the X and Escape when idle', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('never shows a raw id', () => {
    setup(CONTACT);
    expect(document.body.textContent ?? '').not.toContain(CONTACT.id);
  });
});

describe('buildContactChanges', () => {
  const same: ContactFormInput = {
    name: CONTACT.name,
    designation: CONTACT.designation,
    email: CONTACT.email,
    phone: CONTACT.phone,
    whatsapp: CONTACT.whatsapp,
    isPrimary: CONTACT.isPrimary,
    notes: CONTACT.notes,
  };

  it('keeps only the changed fields plus the concurrency token', () => {
    expect(buildContactChanges(CONTACT, { ...same, designation: 'Director', notes: null })).toEqual({
      expectedUpdatedAt: CONTACT.updatedAt,
      designation: 'Director',
      notes: null,
    });
    expect(buildContactChanges(CONTACT, same)).toEqual({ expectedUpdatedAt: CONTACT.updatedAt });
  });
});

describe('RemoveContactDialog', () => {
  function setupRemove(onSubmit: () => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
    const onClose = vi.fn();
    render(<RemoveContactDialog contactName="Asha Rao" clientName="Aster Foods" onClose={onClose} onSubmit={onSubmit} />);
    return { onClose, onSubmit };
  }

  it('asks first, with the title, the body and Keep / Remove contact', () => {
    setupRemove();
    const dialog = screen.getByRole('dialog', { name: 'Remove Asha Rao?' });
    expect(dialog.textContent).toContain("They will be removed from Aster Foods's contact people.");
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove contact' })).toBeTruthy();
  });

  it('Keep closes without sending anything', () => {
    const { onClose, onSubmit } = setupRemove();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Remove contact sends once, shows Removing… and closes on success', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setupRemove(onSubmit);
    fireEvent.click(screen.getByRole('button', { name: 'Remove contact' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Removing…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Removing…' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open with an alert when removing fails, and can be tried again', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new ClientOperationError({ code: 'forbidden', message: 'x', status: 403 }))
      .mockResolvedValueOnce(undefined);
    const { onClose } = setupRemove(onSubmit);
    fireEvent.click(screen.getByRole('button', { name: 'Remove contact' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove contact' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape when idle', () => {
    const { onClose } = setupRemove();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
