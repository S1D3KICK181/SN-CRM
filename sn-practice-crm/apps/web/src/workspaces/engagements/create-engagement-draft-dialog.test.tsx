// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreateEngagementDraftInput } from '@sn/contracts';
import { EngagementOperationError, type EngagementMutationResult } from '../../api/engagements-types';
import { CreateEngagementDraftDialog } from './create-engagement-draft-dialog';
const id = '11111111-1111-4111-8111-111111111111'; const props = { open: true, role: 'founder' as const, clients: [{ id, label: 'Client' }], services: [{ id, label: 'Service' }], partners: [{ id, label: 'Founder' }], managers: [{ id, label: 'Manager' }], onClose: vi.fn(), onCreate: vi.fn<(input: CreateEngagementDraftInput) => Promise<EngagementMutationResult>>() };
beforeEach(() => { props.onClose.mockReset(); props.onCreate.mockReset(); props.onCreate.mockResolvedValue({ success: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('create engagement dialog', () => {
  it('focuses first client and retains values on safe failure', async () => { props.onCreate.mockResolvedValue({ success: false, error: new EngagementOperationError({ code: 'validation', message: 'Safe failure' }) }); render(<CreateEngagementDraftDialog {...props} />); expect(document.activeElement).toBe(screen.getByLabelText('Client')); fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retained' } }); fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'Scope' } }); fireEvent.change(screen.getByLabelText('Agreed fee (₹)'), { target: { value: '10' } }); fireEvent.change(screen.getByLabelText('Billing terms'), { target: { value: 'Terms' } }); fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-02-01' } }); fireEvent.change(screen.getByLabelText('Client'), { target: { value: id } }); fireEvent.change(screen.getByLabelText('Service'), { target: { value: id } }); fireEvent.change(screen.getByLabelText('Responsible partner'), { target: { value: id } }); fireEvent.change(screen.getByLabelText('Delivery manager'), { target: { value: id } }); fireEvent.click(screen.getByRole('button', { name: /create draft/i })); await waitFor(() => expect(screen.getByText('Safe failure')).toBeTruthy()); expect(screen.getByDisplayValue('Retained')).toBeTruthy(); });
  it('prevents duplicate submit and uses exact payload', async () => { let resolve!: (value: EngagementMutationResult) => void; props.onCreate.mockReturnValue(new Promise<EngagementMutationResult>((r) => { resolve = r; })); render(<CreateEngagementDraftDialog {...props} />); for (const [label, value] of [['Client', id], ['Service', id], ['Responsible partner', id], ['Delivery manager', id], ['Title', 'Title'], ['Scope', 'Scope'], ['Agreed fee (₹)', '1.05'], ['Billing terms', 'Terms'], ['Start date', '2026-02-01']] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } }); const button = screen.getByRole('button', { name: /create draft/i }); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1)); expect(props.onCreate.mock.calls[0]![0]).toMatchObject({ agreedFeePaise: 105, exclusions: null, endDate: null }); resolve({ success: true }); });
  it('shows the unavailable banner and does not call create', () => { render(<CreateEngagementDraftDialog {...props} clients={[]} />); expect(screen.getByRole('status')).toBeTruthy(); expect((screen.getByRole('button', { name: /create draft/i }) as HTMLButtonElement).disabled).toBe(true); });
  it('shows safe error for an unexpected rejection', async () => { props.onCreate.mockRejectedValue(new Error('raw private error')); render(<CreateEngagementDraftDialog {...props} />); for (const [label, value] of [['Client', id], ['Service', id], ['Responsible partner', id], ['Delivery manager', id], ['Title', 'Title'], ['Scope', 'Scope'], ['Agreed fee (₹)', '1'], ['Billing terms', 'Terms'], ['Start date', '2026-02-01']] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: /create draft/i })); await waitFor(() => expect(screen.getByText(/unable to create/i)).toBeTruthy()); expect(screen.queryByText('raw private error')).toBeNull(); });
  it('closes from Escape, backdrop, X, and Cancel while idle', () => { render(<CreateEngagementDraftDialog {...props} />); fireEvent.keyDown(document, { key: 'Escape' }); expect(props.onClose).toHaveBeenCalledTimes(1); props.onClose.mockClear(); const { container } = render(<CreateEngagementDraftDialog {...props} />); fireEvent.mouseDown(container.firstElementChild!); expect(props.onClose).toHaveBeenCalledTimes(1); });
  it('renders validation summary and focuses the first invalid field', async () => { render(<CreateEngagementDraftDialog {...props} />); fireEvent.click(screen.getByRole('button', { name: /create draft/i })); await waitFor(() => expect(screen.getByText('Please correct the highlighted fields.')).toBeTruthy()); expect(screen.getByLabelText('Client').getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement).toBe(screen.getByLabelText('Client')); });
  it('does not submit stale selected ids', async () => { render(<CreateEngagementDraftDialog {...props} />); fireEvent.change(screen.getByLabelText('Client'), { target: { value: '22222222-2222-4222-8222-222222222222' } }); fireEvent.click(screen.getByRole('button', { name: /create draft/i })); await waitFor(() => expect(screen.getByText('Select a client.')).toBeTruthy()); expect(props.onCreate).not.toHaveBeenCalled(); });
});

describe('create engagement dialog interactions', () => {
  const fillValidForm = () => {
    for (const [label, value] of [['Client', id], ['Service', id], ['Responsible partner', id], ['Delivery manager', id], ['Title', 'Title'], ['Scope', 'Scope'], ['Agreed fee (₹)', '1'], ['Billing terms', 'Terms'], ['Start date', '2026-02-01']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
  };

  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
    return { promise, resolve };
  };

  it('calls onClose once when the X button is clicked', () => {
    render(<CreateEngagementDraftDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose once when Cancel is clicked', () => {
    render(<CreateEngagementDraftDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows unavailable clients, disables Create, and ignores a click attempt', () => {
    render(<CreateEngagementDraftDialog {...props} clients={[]} />);
    expect(screen.getByRole('status')).toBeTruthy();
    const create = screen.getByRole('button', { name: /create draft/i });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(create);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('wraps idle Tab from Create draft to Close', () => {
    render(<CreateEngagementDraftDialog {...props} />);
    const create = screen.getByRole('button', { name: /create draft/i });
    const close = screen.getByRole('button', { name: 'Close' });
    create.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('wraps idle Shift+Tab from Close to Create draft', () => {
    render(<CreateEngagementDraftDialog {...props} />);
    const close = screen.getByRole('button', { name: 'Close' });
    const create = screen.getByRole('button', { name: /create draft/i });
    close.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(create);
  });

  it('restores the opener focus when the close transition completes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const view = render(<CreateEngagementDraftDialog {...props} opener={opener} />);
    opener.focus();
    view.rerender(<CreateEngagementDraftDialog {...props} open={false} opener={opener} />);
    expect(document.activeElement).toBe(opener);
  });

  it('restores the opener focus when unmounted', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const view = render(<CreateEngagementDraftDialog {...props} opener={opener} />);
    opener.focus();
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it('locks the dialog while create is pending', async () => {
    const pending = deferred<EngagementMutationResult>();
    props.onCreate.mockReturnValue(pending.promise);
    const { container } = render(<CreateEngagementDraftDialog {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    const dialog = screen.getByRole('dialog');
    expect([...dialog.querySelectorAll('input, select, textarea, button')].every((node) => (node as HTMLInputElement).disabled)).toBe(true);
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(container.firstElementChild!);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).not.toHaveBeenCalled();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
    pending.resolve({ success: true });
  });

  it('reports empty submission, describes Client error, and focuses Client', async () => {
    render(<CreateEngagementDraftDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(screen.getByText('Please correct the highlighted fields.')).toBeTruthy());
    const client = screen.getByLabelText('Client');
    expect(client.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(client.getAttribute('aria-describedby')!)).toBeTruthy();
    expect(document.activeElement).toBe(client);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('resets values after a successful close and reopen', async () => {
    const view = render(<CreateEngagementDraftDialog {...props} />);
    fillValidForm();
    fireEvent.change(screen.getByLabelText('Fee model'), { target: { value: 'recurring' } });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    view.rerender(<CreateEngagementDraftDialog {...props} open={false} />);
    view.rerender(<CreateEngagementDraftDialog {...props} open />);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Fee model') as HTMLSelectElement).value).toBe('fixed');
  });

  it('describes an invalid fee model and does not submit', async () => {
    render(<CreateEngagementDraftDialog {...props} />);
    const feeModel = screen.getByLabelText('Fee model') as HTMLSelectElement;
    feeModel.add(new Option('Invalid', 'invalid'));
    fireEvent.change(feeModel, { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(feeModel.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(feeModel.getAttribute('aria-describedby')!)).toBeTruthy();
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});

