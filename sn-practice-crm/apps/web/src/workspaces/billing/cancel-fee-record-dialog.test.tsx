// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BillingOperationError } from '../../api/billing-types';
import { CancelFeeRecordDialog } from './cancel-fee-record-dialog';

afterEach(cleanup);

type Submit = (reason: string, key: string) => Promise<void>;

function setupBill(onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<CancelFeeRecordDialog open kind="bill" label="VYP-140" onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}
function setupPayment(onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <CancelFeeRecordDialog open kind="payment" label="RCT-0001001" amountPaise={1050000} onClose={onClose} onSubmit={onSubmit} />,
  );
  return { onClose, onSubmit };
}

const confirm = (name: string) => screen.getByRole('button', { name: new RegExp(`^(${name}|Cancelling…)$`) }) as HTMLButtonElement;
const reason = (value: string) => fireEvent.change(screen.getByLabelText('Reason'), { target: { value } });

describe('CancelFeeRecordDialog', () => {
  it('renders nothing when closed', () => {
    render(<CancelFeeRecordDialog open={false} kind="bill" label="VYP-140" onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses the bill title, body and buttons', () => {
    setupBill();
    const dialog = screen.getByRole('dialog', { name: 'Cancel bill VYP-140' });
    expect(dialog.textContent).toContain(
      'The bill stays on record as Cancelled and stops counting as pending. This cannot be undone.',
    );
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
    expect(confirm('Cancel bill').className).toContain('engagement-end-confirm');
  });

  it('uses the payment title, the amount in the body and buttons', () => {
    setupPayment();
    const dialog = screen.getByRole('dialog', { name: 'Cancel payment RCT-0001001' });
    expect(dialog.textContent).toContain(
      "The payment stays on record as Cancelled, and the bill's pending amount goes back up by ₹10,500. This cannot be undone.",
    );
    expect(confirm('Cancel payment')).toBeTruthy();
  });

  it('needs a reason of at least 3 characters', () => {
    const { onSubmit } = setupBill();
    reason(' ab ');
    fireEvent.click(confirm('Cancel bill'));
    expect(screen.getByText('Give a reason of at least 3 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Reason').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
    reason('abc');
    expect(screen.queryByText('Give a reason of at least 3 characters.')).toBeNull();
  });

  it('submits the trimmed reason and closes on success', async () => {
    const { onSubmit, onClose } = setupBill();
    reason('  Raised twice  ');
    fireEvent.click(confirm('Cancel bill'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('Raised twice', expect.any(String));
  });

  it('disables the confirm button while saving and sends once', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setupPayment(onSubmit);
    reason('Cheque bounced');
    fireEvent.click(confirm('Cancel payment'));

    await waitFor(() => expect(confirm('Cancel payment').disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Keep it' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('reuses the key on an unchanged retry and mints a new one after the reason changes', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new BillingOperationError({ code: 'network', message: 'down' }));
    setupBill(onSubmit);
    reason('Raised twice');
    fireEvent.click(confirm('Cancel bill'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(confirm('Cancel bill'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);

    reason('Raised twice by mistake');
    fireEvent.click(confirm('Cancel bill'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it.each([
    ['bill_has_payments', 'Cancel the payments on this bill first.'],
    ['already_voided', 'This record is already cancelled.'],
  ])('keeps the dialog open with the reason and shows the %s message', async (serverCode, message) => {
    const onSubmit = vi.fn().mockRejectedValue(
      new BillingOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode }),
    );
    const { onClose } = setupBill(onSubmit);
    reason('Raised twice');
    fireEvent.click(confirm('Cancel bill'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe('Raised twice');
  });

  it('shows the permission message for a 403', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new BillingOperationError({ code: 'forbidden', message: 'x', status: 403 }));
    setupBill(onSubmit);
    reason('Raised twice');
    fireEvent.click(confirm('Cancel bill'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
  });

  it('closes through Keep it and Escape when idle', () => {
    const { onClose } = setupBill();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
