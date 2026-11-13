// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ServiceDto } from '@sn/contracts';
import { ServiceCatalogOperationError } from '../../api/service-catalog-types';
import { SettingsWorkspace, type ServiceCatalogActions } from './settings-workspace';

afterEach(cleanup);

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function service(overrides: Partial<ServiceDto> = {}): ServiceDto {
  return {
    id: '50000000-0000-4000-a000-000000000001',
    name: 'GST Compliance',
    description: 'Monthly and annual GST returns',
    turnaroundDays: 7,
    isStatutory: true,
    isActive: true,
    usage: { assignments: 4, recurringSchedules: 2, engagements: 0 },
    createdAt: '2026-10-01T04:30:00.000Z',
    updatedAt: '2026-11-08T04:30:00.000Z',
    ...overrides,
  };
}

const GST = service();
const TRADEMARK = service({
  id: '50000000-0000-4000-a000-000000000007',
  name: 'Trademark',
  description: null,
  turnaroundDays: null,
  isStatutory: false,
  usage: { assignments: 0, recurringSchedules: 0, engagements: 0 },
});
const ISO = service({
  id: '50000000-0000-4000-a000-000000000008',
  name: 'ISO',
  description: null,
  turnaroundDays: 1,
  isStatutory: false,
  isActive: false,
  usage: { assignments: 1, recurringSchedules: 1, engagements: 0 },
});

function createActions() {
  return { createService: vi.fn(), updateService: vi.fn() };
}

function renderWorkspace(overrides: Partial<Parameters<typeof SettingsWorkspace>[0]> = {}) {
  const actions = createActions();
  const props = {
    services: [GST, TRADEMARK, ISO],
    actions: actions as unknown as ServiceCatalogActions,
    loading: false,
    hasLiveSnapshot: true,
    error: null,
    onRetry: vi.fn(),
    onToast: vi.fn(),
    onServicesChanged: vi.fn(),
    ...overrides,
  };
  return {
    ...render(<SettingsWorkspace {...props} />),
    actions,
    onRetry: props.onRetry,
    onToast: props.onToast,
    onServicesChanged: props.onServicesChanged,
  };
}

const row = (name: string) => screen.getByText(name, { selector: 'strong' }).closest('tr') as HTMLElement;

describe('SettingsWorkspace services', () => {
  it('shows the title, the description and the Add service button', () => {
    renderWorkspace();
    expect(screen.getByRole('heading', { name: 'Services' })).toBeTruthy();
    expect(
      screen.getByText('The services the firm offers. Every assignment and recurring schedule is filed under one.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add service/ })).toBeTruthy();
  });

  it('shows the columns and one row per service', () => {
    renderWorkspace();
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Service', 'Usual turnaround', 'Statutory due dates', 'In use', 'Status', 'Actions']);
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('shows name with description, turnaround, statutory, use and status in each row', () => {
    renderWorkspace();
    const gst = within(row('GST Compliance'));
    expect(gst.getByText('Monthly and annual GST returns')).toBeTruthy();
    expect(gst.getByText('7 days')).toBeTruthy();
    expect(gst.getByText('Yes')).toBeTruthy();
    expect(gst.getByText('4 assignments · 2 schedules')).toBeTruthy();
    expect(gst.getByText('Active')).toBeTruthy();

    const trademark = within(row('Trademark'));
    expect(trademark.getByText('Not set')).toBeTruthy();
    expect(trademark.getByText('No')).toBeTruthy();
    expect(trademark.getByText('Not used yet')).toBeTruthy();

    const iso = within(row('ISO'));
    expect(iso.getByText('1 day')).toBeTruthy();
    expect(iso.getByText('1 assignment · 1 schedule')).toBeTruthy();
    expect(iso.getByText('Inactive')).toBeTruthy();
  });

  it('counts engagements in the In use column when a service has any', () => {
    renderWorkspace({
      services: [{ ...TRADEMARK, usage: { assignments: 0, recurringSchedules: 0, engagements: 1 } }],
    });
    const trademark = within(row('Trademark'));
    expect(trademark.queryByText('Not used yet')).toBeNull();
    expect(trademark.getByText('0 assignments · 0 schedules · 1 engagement')).toBeTruthy();
  });

  it('offers Deactivate on an active service and Reactivate on an inactive one, each with Edit', () => {
    renderWorkspace();
    expect(within(row('GST Compliance')).getByRole('button', { name: 'Edit GST Compliance' })).toBeTruthy();
    expect(within(row('GST Compliance')).getByRole('button', { name: 'Deactivate GST Compliance' })).toBeTruthy();
    expect(within(row('GST Compliance')).queryByRole('button', { name: /Reactivate/ })).toBeNull();
    expect(within(row('ISO')).getByRole('button', { name: 'Edit ISO' })).toBeTruthy();
    expect(within(row('ISO')).getByRole('button', { name: 'Reactivate ISO' })).toBeTruthy();
    expect(within(row('ISO')).queryByRole('button', { name: /Deactivate/ })).toBeNull();
  });

  it('never shows a raw id', () => {
    renderWorkspace();
    expect(UUID_PATTERN.test(document.body.textContent ?? '')).toBe(false);
  });

  it('shows the loading state while the first load is in flight', () => {
    renderWorkspace({ services: [], loading: true, hasLiveSnapshot: false });
    expect(screen.getByLabelText('Loading services').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the error with Retry when the first load failed', () => {
    const { onRetry } = renderWorkspace({
      services: [],
      hasLiveSnapshot: false,
      error: 'Unable to reach the server. Please check your network connection and try again.',
    });
    expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the last loaded list with a refresh warning when a later load fails', () => {
    const { onRetry } = renderWorkspace({ error: 'Unable to reach the server.' });
    expect(screen.getByRole('status').textContent).toContain('Refresh failed. Showing last loaded data.');
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no services, and still offers Add service', () => {
    renderWorkspace({ services: [] });
    expect(screen.getByText('No services yet. Add the services the firm offers.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /Add service/ })).toBeTruthy();
  });

  describe('adding a service', () => {
    it('opens the dialog, saves, toasts, tells the pickers and closes', async () => {
      const { actions, onToast, onServicesChanged } = renderWorkspace();
      actions.createService.mockResolvedValue(service({ id: '50000000-0000-4000-a000-000000000009', name: 'Project Reports' }));

      fireEvent.click(screen.getByRole('button', { name: /Add service/ }));
      const dialog = screen.getByRole('dialog', { name: 'Add service' });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Project Reports ' } });
      fireEvent.change(within(dialog).getByLabelText('Usual turnaround (days)'), { target: { value: '30' } });
      fireEvent.click(within(dialog).getByLabelText('Has statutory due dates'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(actions.createService).toHaveBeenCalledWith(
        { name: 'Project Reports', description: null, turnaroundDays: 30, isStatutory: true },
        expect.any(String),
      );
      expect(onToast).toHaveBeenCalledWith('Service Project Reports added.');
      expect(onServicesChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps the dialog open and does not announce anything when the save fails', async () => {
      const { actions, onToast, onServicesChanged } = renderWorkspace();
      actions.createService.mockRejectedValue(
        new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'duplicate_service' }),
      );
      fireEvent.click(screen.getByRole('button', { name: /Add service/ }));
      const dialog = screen.getByRole('dialog', { name: 'Add service' });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'trademark' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));

      await waitFor(() =>
        expect(within(dialog).getByRole('alert').textContent).toBe('A service named trademark already exists.'),
      );
      expect(screen.getByRole('dialog', { name: 'Add service' })).toBeTruthy();
      expect(onToast).not.toHaveBeenCalled();
      expect(onServicesChanged).not.toHaveBeenCalled();
    });
  });

  describe('editing a service', () => {
    it('opens with the saved values and sends the update with the concurrency token', async () => {
      const { actions, onToast, onServicesChanged } = renderWorkspace();
      actions.updateService.mockResolvedValue(service({ name: 'GST Returns' }));

      fireEvent.click(screen.getByRole('button', { name: 'Edit GST Compliance' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit GST Compliance' });
      expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('GST Compliance');
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'GST Returns' } });
      fireEvent.change(within(dialog).getByLabelText('Usual turnaround (days)'), { target: { value: '' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(actions.updateService).toHaveBeenCalledWith(
        GST.id,
        {
          name: 'GST Returns',
          description: 'Monthly and annual GST returns',
          turnaroundDays: null,
          isStatutory: true,
          expectedUpdatedAt: GST.updatedAt,
        },
        expect.any(String),
      );
      expect(onToast).toHaveBeenCalledWith('Service GST Returns updated.');
      expect(onServicesChanged).toHaveBeenCalledTimes(1);
    });

    it('loads the list again when the service was changed by someone else', async () => {
      const { actions, onRetry, onToast } = renderWorkspace();
      actions.updateService.mockRejectedValue(
        new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'stale_service' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit GST Compliance' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit GST Compliance' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));

      await waitFor(() =>
        expect(within(dialog).getByRole('alert').textContent).toBe(
          'This service was changed by someone else. Reload and try again.',
        ),
      );
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onToast).not.toHaveBeenCalled();
    });

    it('returns focus to the Edit button when the dialog closes', async () => {
      renderWorkspace();
      const edit = screen.getByRole('button', { name: 'Edit GST Compliance' });
      fireEvent.click(edit);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(document.activeElement).toBe(edit));
    });
  });

  describe('deactivating a service', () => {
    it('asks first and sends nothing until confirmed', async () => {
      const { actions } = renderWorkspace();
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate GST Compliance' }));
      expect(screen.getByRole('dialog', { name: 'Deactivate GST Compliance?' })).toBeTruthy();
      expect(actions.updateService).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(actions.updateService).not.toHaveBeenCalled();
    });

    it('deactivates on confirm, toasts and tells the pickers', async () => {
      const { actions, onToast, onServicesChanged } = renderWorkspace();
      actions.updateService.mockResolvedValue(service({ isActive: false }));
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate GST Compliance' }));
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(actions.updateService).toHaveBeenCalledWith(
        GST.id,
        { isActive: false, expectedUpdatedAt: GST.updatedAt },
        expect.any(String),
      );
      expect(onToast).toHaveBeenCalledWith('Service GST Compliance deactivated.');
      expect(onServicesChanged).toHaveBeenCalledTimes(1);
    });

    it('keeps the confirmation open and shows the message when it fails', async () => {
      const { actions, onToast } = renderWorkspace();
      actions.updateService.mockRejectedValue(new ServiceCatalogOperationError({ code: 'forbidden', message: 'x', status: 403 }));
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate GST Compliance' }));
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("You don't have permission to do this."));
      expect(screen.getByRole('dialog', { name: 'Deactivate GST Compliance?' })).toBeTruthy();
      expect(onToast).not.toHaveBeenCalled();
    });
  });

  describe('reactivating a service', () => {
    it('reactivates straight away without a confirmation', async () => {
      const { actions, onToast, onServicesChanged } = renderWorkspace();
      actions.updateService.mockResolvedValue(service({ ...ISO, isActive: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate ISO' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Service ISO reactivated.'));
      expect(actions.updateService).toHaveBeenCalledWith(
        ISO.id,
        { isActive: true, expectedUpdatedAt: ISO.updatedAt },
        expect.any(String),
      );
      expect(onServicesChanged).toHaveBeenCalledTimes(1);
    });

    it('shows the message when it fails, and reuses the key for an unchanged retry', async () => {
      const { actions, onToast } = renderWorkspace();
      actions.updateService
        .mockRejectedValueOnce(new ServiceCatalogOperationError({ code: 'network', message: 'down' }))
        .mockResolvedValueOnce(service({ ...ISO, isActive: true }));

      fireEvent.click(screen.getByRole('button', { name: 'Reactivate ISO' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server'));
      expect(onToast).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Reactivate ISO' }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Service ISO reactivated.'));
      expect(actions.updateService.mock.calls[1]?.[2]).toBe(actions.updateService.mock.calls[0]?.[2]);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('loads the list again and shows the stale message when the service changed meanwhile', async () => {
      const { actions, onRetry } = renderWorkspace();
      actions.updateService.mockRejectedValue(
        new ServiceCatalogOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'stale_service' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate ISO' }));
      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toContain(
          'This service was changed by someone else. Reload and try again.',
        ),
      );
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
