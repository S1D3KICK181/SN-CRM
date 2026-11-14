// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ServiceDto } from '@sn/contracts';
import { ServiceCatalogOperationError } from '../../api/service-catalog-types';
import { DeactivateServiceDialog, ServiceDialog, type ServiceFormInput } from './service-dialog';

afterEach(cleanup);

const SERVICE: ServiceDto = {
  id: '50000000-0000-4000-a000-000000000001',
  name: 'GST Compliance',
  description: 'Monthly and annual GST returns',
  turnaroundDays: 7,
  isStatutory: true,
  isActive: true,
  departmentId: null,
  departmentName: null,
  usage: { assignments: 4, recurringSchedules: 2, engagements: 0 },
  createdAt: '2026-10-01T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

type Submit = (input: ServiceFormInput, key: string) => Promise<void>;

function setup(service: ServiceDto | null = null, onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<ServiceDialog open service={service} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const saveButton = () => screen.getByRole('button', { name: /^(Save service|Saving…)$/ }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ServiceDialog', () => {
  it('renders nothing when closed', () => {
    render(<ServiceDialog open={false} service={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers No department and the active departments, and submits the chosen one or null', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const department = (id: string, name: string, isActive: boolean) => ({
      id,
      name,
      isActive,
      members: [],
      serviceIds: [],
      createdAt: '2026-11-01T04:30:00.000Z',
      updatedAt: '2026-11-01T04:30:00.000Z',
    });
    render(
      <ServiceDialog
        open
        service={null}
        departments={[
          department('60000000-0000-4000-a000-000000000001', 'Audit', true),
          department('60000000-0000-4000-a000-000000000002', 'GST', false),
        ]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const select = screen.getByLabelText('Department') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['No department', 'Audit']);
    type('Name', 'Tax Audit');
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: 'Tax Audit', departmentId: null });
  });

  it('shows the add title, the fields, the hints and a plain checkbox outside the field wrapper', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Add service' });
    for (const label of ['Name', 'Description', 'Usual turnaround (days)', 'Has statutory due dates']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(dialog.textContent).toContain('Used later to flag work that runs late.');
    expect(dialog.textContent).toContain('For filings with government due dates, like GST and income tax returns.');
    const checkbox = screen.getByLabelText('Has statutory due dates') as HTMLInputElement;
    expect(checkbox.type).toBe('checkbox');
    expect(checkbox.checked).toBe(false);
    expect(checkbox.closest('.field')).toBeNull();
    expect(checkbox.getAttribute('aria-describedby')).toBe('service-isStatutory-hint');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(saveButton().textContent).toBe('Save service');
  });

  it('shows the edit title with the service name and fills in the saved values', () => {
    setup(SERVICE);
    expect(screen.getByRole('dialog', { name: 'Edit GST Compliance' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('GST Compliance');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Monthly and annual GST returns');
    expect((screen.getByLabelText('Usual turnaround (days)') as HTMLInputElement).value).toBe('7');
    expect((screen.getByLabelText('Has statutory due dates') as HTMLInputElement).checked).toBe(true);
  });

  it('shows the name message on an empty submit and sends nothing', () => {
    const { onSubmit } = setup();
    fireEvent.click(saveButton());
    expect(screen.getByText('Enter a service name of 2 to 120 characters.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Please correct the highlighted fields.');
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['one character', 'X', false],
    ['a blank name', '   ', false],
    ['121 characters', 'x'.repeat(121), false],
    ['2 characters', 'ISO', true],
    ['120 characters', 'x'.repeat(120), true],
  ])('checks the name length: %s', (_label, value, valid) => {
    const { onSubmit } = setup();
    type('Name', value);
    fireEvent.click(saveButton());
    expect(screen.queryByText('Enter a service name of 2 to 120 characters.') !== null).toBe(!valid);
    expect(vi.mocked(onSubmit).mock.calls.length).toBe(valid ? 1 : 0);
  });

  it('flags a description over 500 characters', () => {
    const { onSubmit } = setup();
    type('Name', 'Trademark');
    type('Description', 'x'.repeat(501));
    fireEvent.click(saveButton());
    expect(screen.getByText('Use at most 500 characters.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    type('Description', 'x'.repeat(500));
    fireEvent.click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each(['-1', '1.5', 'abc', '366', '1e2'])('flags turnaround %s', (value) => {
    const { onSubmit } = setup();
    type('Name', 'Trademark');
    type('Usual turnaround (days)', value);
    fireEvent.click(saveButton());
    expect(screen.getByText('Enter whole days from 0 to 365, or leave it empty.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['0', 0],
    ['365', 365],
    [' 30 ', 30],
    ['', null],
  ])('accepts turnaround %j', async (value, expected) => {
    const { onSubmit } = setup();
    type('Name', 'Trademark');
    type('Usual turnaround (days)', value);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(onSubmit).mock.calls[0]?.[0].turnaroundDays).toBe(expected);
  });

  it('submits trimmed values, an empty description as null, and closes on success', async () => {
    const { onSubmit, onClose } = setup();
    type('Name', '  Trademark ');
    type('Description', '   ');
    fireEvent.click(screen.getByLabelText('Has statutory due dates'));
    fireEvent.click(saveButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      { name: 'Trademark', description: null, turnaroundDays: null, isStatutory: true, departmentId: null },
      expect.any(String),
    );
  });

  it('disables the save button and shows Saving… while saving, sending once', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setup(null, onSubmit);
    type('Name', 'Trademark');
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
    const onSubmit = vi.fn().mockRejectedValue(new ServiceCatalogOperationError({ code: 'network', message: 'down' }));
    setup(null, onSubmit);
    type('Name', 'Trademark');

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);

    type('Name', 'Trademark Services');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it('keeps the dialog open with the input and shows the duplicate message with the typed name', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'duplicate_service' }),
    );
    const { onClose } = setup(null, onSubmit);
    type('Name', '  gst compliance ');
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('A service named gst compliance already exists.'),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('  gst compliance ');
    expect(saveButton().disabled).toBe(false);
  });

  it('shows the stale message for stale_service and the permission message for a 403', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(
        new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'stale_service' }),
      )
      .mockRejectedValueOnce(new ServiceCatalogOperationError({ code: 'forbidden', message: 'x', status: 403 }));
    setup(SERVICE, onSubmit);
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'This service was changed by someone else. Reload and try again.',
      ),
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
  });

  it('starts fresh each time it opens', () => {
    const view = render(<ServiceDialog open service={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    type('Name', 'Trademark');
    view.rerender(<ServiceDialog open={false} service={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    view.rerender(<ServiceDialog open service={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('closes through Cancel, the X and Escape when idle', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('never shows a raw id', () => {
    setup(SERVICE);
    expect(document.body.textContent ?? '').not.toContain(SERVICE.id);
  });
});

describe('DeactivateServiceDialog', () => {
  function setupConfirm(onSubmit: (key: string) => Promise<void> = vi.fn().mockResolvedValue(undefined)) {
    const onClose = vi.fn();
    render(<DeactivateServiceDialog open serviceName="Trademark" onClose={onClose} onSubmit={onSubmit} />);
    return { onClose, onSubmit };
  }

  it('renders nothing when closed', () => {
    render(<DeactivateServiceDialog open={false} serviceName="Trademark" onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks first, with the title, the explanation and Keep it / Deactivate', () => {
    setupConfirm();
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Trademark?' });
    expect(dialog.textContent).toContain(
      'It will no longer be offered for new work. Existing assignments and schedules keep it, and you can reactivate it at any time.',
    );
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeTruthy();
  });

  it('Keep it closes without sending anything', () => {
    const { onClose, onSubmit } = setupConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Deactivate sends once with a key, shows Deactivating… and closes on success', async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { onClose } = setupConfirm(onSubmit);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Deactivating…' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Deactivating…' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(expect.any(String));
    expect(onClose).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the dialog open on failure, reusing the key for the retry', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(
        new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'stale_service' }),
      )
      .mockResolvedValueOnce(undefined);
    const { onClose } = setupConfirm(onSubmit);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'This service was changed by someone else. Reload and try again.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[1]?.[0]).toBe(onSubmit.mock.calls[0]?.[0]);
  });

  it('shows the permission message for a 403', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ServiceCatalogOperationError({ code: 'forbidden', message: 'x', status: 403 }));
    setupConfirm(onSubmit);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
  });
});
