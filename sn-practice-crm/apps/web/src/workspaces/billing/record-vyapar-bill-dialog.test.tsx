// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClientDto, RecordVyaparBillInput } from '@sn/contracts';
import { BillingOperationError } from '../../api/billing-types';
import { RecordVyaparBillDialog } from './record-vyapar-bill-dialog';

afterEach(cleanup);

const TODAY = '2026-11-13';
const ASTER = '10000000-0000-4000-a000-000000000001';
const BHARAT = '10000000-0000-4000-a000-000000000002';

function client(id: string, code: string, displayName: string, status: ClientDto['status'] = 'active'): ClientDto {
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
    status,
    notes: null,
    activeAssignmentsCount: 0,
    createdById: '00000000-0000-4000-a000-000000000001',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };
}

const clients = [
  client(BHARAT, 'CL-001002', 'Bharat Traders'),
  client(ASTER, 'CL-001001', 'Aster Foods'),
  client('10000000-0000-4000-a000-000000000003', 'CL-001003', 'Archived Co', 'archived'),
];

function setup(onSubmit: (input: RecordVyaparBillInput, key: string) => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<RecordVyaparBillDialog open clients={clients} today={TODAY} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const submitButton = () => screen.getByRole('button', { name: /^(Record bill|Recording…)$/ }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fillValid() {
  type('Client', ASTER);
  type('Vyapar bill number', 'VYP-140');
  type('Fee amount (₹)', '2500');
  type('What was billed', 'Returns for October');
}

describe('RecordVyaparBillDialog', () => {
  it('renders nothing when closed', () => {
    render(<RecordVyaparBillDialog open={false} clients={clients} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title, intro, labels and hints, with a fee amount field and no GST wording', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Record Vyapar bill' });
    const text = dialog.textContent ?? '';
    expect(text).toContain('Enter the bill exactly as raised in Vyapar. The CRM does not create the bill itself.');
    for (const label of ['Client', 'Vyapar bill number', 'Bill date', 'Due date', 'Fee amount (₹)', 'What was billed']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(text).toContain('As shown on the Vyapar bill, for example VYP-140.');
    expect(text).toContain('Defaults to 15 days after the bill date.');
    expect(text).toContain('For example: GST returns for October 2026.');
    expect(text).not.toContain('including GST');
    expect(screen.queryByLabelText(/including GST/)).toBeNull();
  });

  it('lists active clients by name as code · name and never shows an id', () => {
    setup();
    const options = [...(screen.getByLabelText('Client') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Select client…', 'CL-001001 · Aster Foods', 'CL-001002 · Bharat Traders']);
    expect(document.body.textContent ?? '').not.toContain(ASTER);
  });

  it('defaults the bill date to today and the due date to 15 days later, and the due date follows until edited', () => {
    setup();
    expect((screen.getByLabelText('Bill date') as HTMLInputElement).value).toBe(TODAY);
    expect((screen.getByLabelText('Bill date') as HTMLInputElement).max).toBe(TODAY);
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-11-28');

    type('Bill date', '2026-11-01');
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-11-16');

    type('Due date', '2026-12-31');
    type('Bill date', '2026-11-05');
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe('2026-12-31');
  });

  it('shows every validation message on an empty submit and sends nothing', () => {
    const { onSubmit } = setup();
    fireEvent.click(submitButton());
    for (const message of [
      'Choose a client.',
      'Enter the Vyapar bill number.',
      'Enter an amount above ₹0 with up to 2 decimals.',
      'Describe what was billed in 2 to 300 characters.',
    ]) {
      expect(screen.getByText(message)).toBeTruthy();
    }
    expect(screen.getByRole('alert').textContent).toBe('Please correct the highlighted fields.');
    expect(screen.getByLabelText('Client').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('flags a future bill date, a due date before the bill date and an over-long number', () => {
    setup();
    fillValid();
    type('Bill date', '2026-11-14');
    type('Due date', '2026-11-10');
    type('Vyapar bill number', 'x'.repeat(31));
    fireEvent.click(submitButton());
    expect(screen.getByText('The bill date cannot be in the future.')).toBeTruthy();
    expect(screen.getByText('The due date cannot be before the bill date.')).toBeTruthy();
    expect(screen.getByText('Use at most 30 characters.')).toBeTruthy();
  });

  it('submits the payload in paise, closes on success', async () => {
    const { onSubmit, onClose } = setup();
    fillValid();
    type('Fee amount (₹)', '2500.50');
    fireEvent.click(submitButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      {
        clientId: ASTER,
        vyaparBillNumber: 'VYP-140',
        billDate: TODAY,
        dueDate: '2026-11-28',
        amountPaise: 250050,
        description: 'Returns for October',
      },
      expect.any(String),
    );
  });

  it('disables the submit button and shows Recording… while saving, sending once', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setup(onSubmit);
    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() => expect(submitButton().textContent).toBe('Recording…'));
    expect(submitButton().disabled).toBe(true);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('reuses the key on an unchanged retry and mints a new one after an edit', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new BillingOperationError({ code: 'network', message: 'down' }));
    setup(onSubmit);
    fillValid();

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server'));
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);

    type('Fee amount (₹)', '2600');
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    fireEvent.click(submitButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it('keeps the dialog open with the input and shows the server-code message on failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new BillingOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'duplicate_vyapar_bill' }),
    );
    const { onClose } = setup(onSubmit);
    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'This Vyapar bill number is already recorded for this financial year.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Vyapar bill number') as HTMLInputElement).value).toBe('VYP-140');
    expect((screen.getByLabelText('Fee amount (₹)') as HTMLInputElement).value).toBe('2500');
    expect(submitButton().disabled).toBe(false);
  });

  it('shows the permission message for a 403', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new BillingOperationError({ code: 'forbidden', message: 'x', status: 403 }));
    setup(onSubmit);
    fillValid();
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
  });

  it('starts fresh each time it opens', () => {
    const view = render(<RecordVyaparBillDialog open clients={clients} today={TODAY} onClose={vi.fn()} onSubmit={vi.fn()} />);
    type('Vyapar bill number', 'VYP-9');
    view.rerender(<RecordVyaparBillDialog open={false} clients={clients} today={TODAY} onClose={vi.fn()} onSubmit={vi.fn()} />);
    view.rerender(<RecordVyaparBillDialog open clients={clients} today={TODAY} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect((screen.getByLabelText('Vyapar bill number') as HTMLInputElement).value).toBe('');
  });

  it('closes through Cancel, the X and Escape when idle', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
