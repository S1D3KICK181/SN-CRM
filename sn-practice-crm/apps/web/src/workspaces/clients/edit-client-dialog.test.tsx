// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { INDIAN_STATES, type ClientDto, type ReportingLineDto } from '@sn/contracts';
import { ClientOperationError } from '../../api/clients-types';
import { DeterministicTestTeamDirectoryAdapter } from '../../api/test-team-directory-adapter';
import { EditClientDialog, type EditClientChanges } from './edit-client-dialog';

afterEach(cleanup);

const OWNER_ID = '00000000-0000-4000-a000-000000000002';
const OTHER_ID = '00000000-0000-4000-a000-000000000003';

const CLIENT: ClientDto = {
  id: 'c1111111-1111-4111-8111-111111111111',
  code: 'CL-000001',
  displayName: 'Aster Foods',
  legalName: 'Aster Foods Private Limited',
  gstinMasked: '27**********1Z5',
  panMasked: '******234F',
  pan: 'ABCDE1234F',
  gstin: '27ABCDE1234F1Z5',
  email: 'contact@asterfoods.in',
  phone: '+91 98200 12345',
  relationshipOwnerId: OWNER_ID,
  relationshipOwnerName: 'Ananya Rao',
  status: 'active',
  notes: 'Key account.',
  entityType: 'private_limited',
  addressLine1: '12 Park Street',
  addressLine2: null,
  city: 'Kolkata',
  state: 'West Bengal',
  pincode: '700016',
  tan: 'ABCD12345E',
  cinLlpin: null,
  udyamNumber: null,
  iec: null,
  incorporationDate: '2015-03-09',
  contacts: [],
  canEdit: true,
  canChangeOwnerOrStatus: true,
  activeAssignmentsCount: 2,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-04-01T09:30:00.000Z',
  updatedAt: '2026-04-15T14:20:00.000Z',
};

const LINES: ReportingLineDto[] = [
  { employee: { id: OWNER_ID, name: 'Ananya Rao', role: 'manager', reportsToId: null }, manager: null },
  { employee: { id: OTHER_ID, name: 'Dev Patel', role: 'senior_staff', reportsToId: OWNER_ID }, manager: null },
];

type Submit = (input: EditClientChanges, key: string) => Promise<void>;

function setup(client: ClientDto = CLIENT, onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
  const teamPort = new DeterministicTestTeamDirectoryAdapter();
  teamPort.setReportingLinesResponse('founder', LINES);
  const onClose = vi.fn();
  render(<EditClientDialog client={client} role="founder" teamPort={teamPort} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const saveButton = () => screen.getByRole('button', { name: /^(Save changes|Saving…)$/ }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const lastBody = (onSubmit: Submit) => vi.mocked(onSubmit).mock.calls.at(-1)?.[0];

describe('EditClientDialog', () => {
  it('shows the client name in the title and the groups in the agreed order', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Edit Aster Foods' });
    const legends = Array.from(dialog.querySelectorAll('legend')).map((legend) => legend.textContent);
    expect(legends).toEqual(['Basics', 'Tax and registrations', 'Address', 'Contact']);

    const labels = Array.from(dialog.querySelectorAll('label')).map((label) => label.textContent);
    expect(labels).toEqual([
      'Display name',
      'Legal name',
      'Entity type',
      'Relationship owner',
      'Status',
      'PAN',
      'GSTIN',
      'TAN',
      'CIN or LLPIN',
      'Udyam number',
      'IEC',
      'Date of incorporation or birth',
      'Address line 1',
      'Address line 2',
      'City',
      'State',
      'PIN code',
      'Email',
      'Phone',
      'Notes',
    ]);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(saveButton().textContent).toBe('Save changes');
  });

  it('prefills every field from the client', () => {
    setup();
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    expect(value('Display name')).toBe('Aster Foods');
    expect(value('Legal name')).toBe('Aster Foods Private Limited');
    expect(value('Entity type')).toBe('private_limited');
    expect(value('Status')).toBe('active');
    expect(value('PAN')).toBe('ABCDE1234F');
    expect(value('GSTIN')).toBe('27ABCDE1234F1Z5');
    expect(value('TAN')).toBe('ABCD12345E');
    expect(value('CIN or LLPIN')).toBe('');
    expect(value('Date of incorporation or birth')).toBe('2015-03-09');
    expect(value('Address line 1')).toBe('12 Park Street');
    expect(value('City')).toBe('Kolkata');
    expect(value('State')).toBe('West Bengal');
    expect(value('PIN code')).toBe('700016');
    expect(value('Email')).toBe('contact@asterfoods.in');
    expect(value('Phone')).toBe('+91 98200 12345');
    expect(value('Notes')).toBe('Key account.');
  });

  it('offers Not set and every entity type, and an empty option plus every state', () => {
    setup();
    const entity = screen.getByLabelText('Entity type') as HTMLSelectElement;
    expect(Array.from(entity.options).map((option) => option.textContent)).toEqual([
      'Not set',
      'Individual',
      'HUF',
      'Proprietorship',
      'Partnership firm',
      'LLP',
      'Private limited company',
      'Public limited company',
      'Trust',
      'Society',
      'Other',
    ]);
    const state = screen.getByLabelText('State') as HTMLSelectElement;
    expect(state.options[0]?.value).toBe('');
    expect(Array.from(state.options).slice(1).map((option) => option.value)).toEqual([...INDIAN_STATES]);
  });

  it('lets a Founder or Manager change the relationship owner and status', async () => {
    const { onSubmit } = setup();
    expect(screen.queryByText('Only the Founder or Manager can change these.')).toBeNull();
    await waitFor(() => expect(screen.getByRole('option', { name: /Dev Patel/ })).toBeTruthy());
    type('Relationship owner', OTHER_ID);
    type('Status', 'on_hold');
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastBody(onSubmit)).toEqual({
      expectedUpdatedAt: CLIENT.updatedAt,
      relationshipOwnerId: OTHER_ID,
      status: 'on_hold',
    });
  });

  it('shows the owner and status read-only with a note when canChangeOwnerOrStatus is false', async () => {
    const { onSubmit } = setup({ ...CLIENT, canChangeOwnerOrStatus: false });
    const owner = screen.getByLabelText('Relationship owner') as HTMLInputElement;
    const status = screen.getByLabelText('Status') as HTMLInputElement;
    expect(owner.tagName).toBe('INPUT');
    expect(owner.readOnly).toBe(true);
    expect(owner.value).toBe('Ananya Rao');
    expect(status.readOnly).toBe(true);
    expect(status.value).toBe('Active');
    expect(screen.getByText('Only the Founder or Manager can change these.')).toBeTruthy();

    type('City', 'Howrah');
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastBody(onSubmit)).toEqual({ expectedUpdatedAt: CLIENT.updatedAt, city: 'Howrah' });
  });

  it('sends only the changed fields plus expectedUpdatedAt, trimmed and with identifiers upper-cased', async () => {
    const { onSubmit, onClose } = setup();
    type('Display name', '  Aster Foods India ');
    type('TAN', 'wxyz98765a');
    type('Entity type', 'llp');
    type('State', 'Goa');
    type('Date of incorporation or birth', '2016-01-02');
    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        expectedUpdatedAt: CLIENT.updatedAt,
        displayName: 'Aster Foods India',
        tan: 'WXYZ98765A',
        entityType: 'llp',
        state: 'Goa',
        incorporationDate: '2016-01-02',
      },
      expect.any(String),
    );
  });

  it('sends null for a cleared field', async () => {
    const { onSubmit } = setup();
    type('Legal name', '   ');
    type('Entity type', '');
    type('State', '');
    type('Notes', '');
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastBody(onSubmit)).toEqual({
      expectedUpdatedAt: CLIENT.updatedAt,
      legalName: null,
      entityType: null,
      state: null,
      notes: null,
    });
  });

  it('sends nothing and says so when nothing changed', () => {
    const { onSubmit, onClose } = setup();
    type('Display name', '  Aster Foods ');
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert').textContent).toBe('There are no changes to save.');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['PAN', 'ABC12', 'Enter a valid 10-character PAN, like ABCDE1234F.'],
    ['GSTIN', '27ABCDE1234F', 'Enter a valid 15-character GSTIN.'],
    ['TAN', 'ABC', 'Enter a valid TAN, like ABCD12345E.'],
    ['CIN or LLPIN', 'XYZ', 'Enter a valid CIN or LLPIN.'],
    ['Udyam number', 'UDYAM-1', 'Enter a valid Udyam number, like UDYAM-MH-01-0000001.'],
    ['IEC', 'SHORT', 'Enter a valid 10-character IEC.'],
    ['PIN code', '012345', 'Enter a valid 6-digit PIN code.'],
    ['Email', 'not-an-email', 'Invalid email address format.'],
    ['Phone', '12345', 'Phone number must be at least 7 characters.'],
    ['Phone', '1'.repeat(21), 'Phone number must not exceed 20 characters.'],
    ['Display name', 'A', 'Display name must be between 2 and 180 characters.'],
    ['Display name', 'A'.repeat(181), 'Display name must be between 2 and 180 characters.'],
    ['Legal name', 'L'.repeat(201), 'Legal name must not exceed 200 characters.'],
    ['Address line 1', 'x'.repeat(201), 'Address line 1 must not exceed 200 characters.'],
    ['Address line 2', 'x'.repeat(201), 'Address line 2 must not exceed 200 characters.'],
    ['City', 'x'.repeat(101), 'City must not exceed 100 characters.'],
    ['Notes', 'x'.repeat(2001), 'Notes must not exceed 2000 characters.'],
  ])('flags %s %j with the server wording', (label, value, message) => {
    const { onSubmit } = setup();
    type(label, value);
    fireEvent.click(saveButton());
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByLabelText(label).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Please correct the highlighted fields.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a valid LLPIN and a valid CIN', async () => {
    const { onSubmit } = setup();
    type('CIN or LLPIN', 'aab-1234');
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastBody(onSubmit)).toMatchObject({ cinLlpin: 'AAB-1234' });

    type('CIN or LLPIN', 'U12345MH2015PTC123456');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(lastBody(onSubmit)).toMatchObject({ cinLlpin: 'U12345MH2015PTC123456' });
  });

  it('rejects a GSTIN that does not contain the PAN, whichever one was edited', () => {
    const { onSubmit } = setup();
    type('GSTIN', '27ZZZZZ9999Z1Z5');
    fireEvent.click(saveButton());
    expect(screen.getByText('The GSTIN does not match the PAN.')).toBeTruthy();
    expect(screen.getByLabelText('GSTIN').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();

    // Fixing the GSTIN clears the problem; changing the PAN instead brings the mismatch back.
    type('GSTIN', '27ABCDE1234F1Z5');
    type('PAN', 'PQRST6789U');
    fireEvent.click(saveButton());
    expect(screen.getByText('The GSTIN does not match the PAN.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    type('GSTIN', '27PQRST6789U1Z5');
    fireEvent.click(saveButton());
    expect(screen.queryByText('The GSTIN does not match the PAN.')).toBeNull();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(lastBody(onSubmit)).toMatchObject({ pan: 'PQRST6789U', gstin: '27PQRST6789U1Z5' });
  });

  it('does not block a save over a value that was already on file and was not touched', async () => {
    const { onSubmit } = setup({ ...CLIENT, phone: '123' });
    type('City', 'Howrah');
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(lastBody(onSubmit)).toEqual({ expectedUpdatedAt: CLIENT.updatedAt, city: 'Howrah' });
  });

  it('disables Save and shows Saving… while saving, sending once', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setup(CLIENT, onSubmit);
    type('City', 'Howrah');
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
    setup(CLIENT, onSubmit);
    type('City', 'Howrah');

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);

    type('City', 'Salt Lake');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it('keeps the dialog open with the input and shows the stale message for stale_client', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ClientOperationError({ code: 'conflict', message: 'raw', status: 409, serverCode: 'stale_client' }),
    );
    const { onClose } = setup(CLIENT, onSubmit);
    type('City', 'Howrah');
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'This client was changed by someone else. Reload and try again.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('City') as HTMLInputElement).value).toBe('Howrah');
    expect(saveButton().disabled).toBe(false);
  });

  it('shows the permission message for a 403 and never reflects server text', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new ClientOperationError({ code: 'forbidden', message: 'ABCDE1234F leaked', status: 403 }))
      .mockRejectedValueOnce(new Error('ABCDE1234F leaked'));
    setup(CLIENT, onSubmit);
    type('City', 'Howrah');
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Something went wrong while saving. Please try again.'),
    );
    expect(document.body.textContent ?? '').not.toContain('leaked');
  });

  it('closes through Cancel, the X and Escape when idle', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('never shows a raw id as text', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('option', { name: /Dev Patel/ })).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(CLIENT.id);
    expect(text).not.toContain(OWNER_ID);
    expect(text).not.toContain(OTHER_ID);
  });
});
