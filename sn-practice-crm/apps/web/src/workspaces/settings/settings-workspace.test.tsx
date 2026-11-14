// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DepartmentDto, ServiceDto } from '@sn/contracts';
import { DepartmentsOperationError } from '../../api/departments-types';
import { ServiceCatalogOperationError } from '../../api/service-catalog-types';
import type { DepartmentActions, DepartmentsSectionProps } from './departments-section';
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
    departmentId: null,
    departmentName: null,
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
    expect(headers).toEqual([
      'Service',
      'Department',
      'Usual turnaround',
      'Statutory due dates',
      'In use',
      'Status',
      'Actions',
    ]);
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
    // No turnaround and no department both read Not set
    expect(trademark.getAllByText('Not set')).toHaveLength(2);
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
        { name: 'Project Reports', description: null, turnaroundDays: 30, isStatutory: true, departmentId: null },
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
          departmentId: null,
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

describe('SettingsWorkspace services and departments', () => {
  const AUDIT_ID = '60000000-0000-4000-a000-000000000001';
  const GST_DEPARTMENT_ID = '60000000-0000-4000-a000-000000000002';
  const ANANYA = '00000000-0000-4000-a000-000000000003';
  const NEHA = '00000000-0000-4000-a000-000000000005';
  const ROHAN = '00000000-0000-4000-a000-000000000004';

  const AUDIT: DepartmentDto = {
    id: AUDIT_ID,
    name: 'Audit',
    isActive: true,
    members: [
      { userId: ANANYA, name: 'Ananya Rao', role: 'senior_staff', isHead: true },
      { userId: NEHA, name: 'Neha Kapoor', role: 'trainee', isHead: false },
    ],
    serviceIds: ['50000000-0000-4000-a000-000000000002', '50000000-0000-4000-a000-000000000007'],
    createdAt: '2026-11-01T04:30:00.000Z',
    updatedAt: '2026-11-08T04:30:00.000Z',
  };
  const RETIRED: DepartmentDto = {
    id: GST_DEPARTMENT_ID,
    name: 'GST',
    isActive: false,
    members: [],
    serviceIds: [],
    createdAt: '2026-11-01T04:30:00.000Z',
    updatedAt: '2026-11-08T04:30:00.000Z',
  };
  const EMPLOYEES = [
    { id: ANANYA, name: 'Ananya Rao', role: 'senior_staff' as const },
    { id: ROHAN, name: 'Rohan Mehta', role: 'staff' as const },
    { id: NEHA, name: 'Neha Kapoor', role: 'trainee' as const },
  ];

  function departmentsProps(overrides: Partial<DepartmentsSectionProps> = {}) {
    const departmentActions = { createDepartment: vi.fn(), updateDepartment: vi.fn(), setDepartmentMembers: vi.fn() };
    const onRetryDepartments = vi.fn();
    const onDepartmentsChanged = vi.fn();
    const departments: DepartmentsSectionProps = {
      departments: [AUDIT, RETIRED],
      actions: departmentActions as unknown as DepartmentActions,
      employees: EMPLOYEES,
      loading: false,
      hasLiveSnapshot: true,
      error: null,
      onRetry: onRetryDepartments,
      onDepartmentsChanged,
      ...overrides,
    };
    return { departments, departmentActions, onRetryDepartments, onDepartmentsChanged };
  }

  function renderBoth(
    overrides: Partial<DepartmentsSectionProps> = {},
    workspace: Partial<Parameters<typeof SettingsWorkspace>[0]> = {},
  ) {
    const { departments, ...extras } = departmentsProps(overrides);
    return { ...renderWorkspace({ departments, ...workspace }), ...extras };
  }

  // The departments table is the one with a Members column
  const departmentsTable = () =>
    screen
      .getAllByRole('table')
      .find((candidate) => within(candidate).queryByRole('columnheader', { name: 'Members' })) as HTMLElement;
  const departmentRow = (name: string) =>
    within(departmentsTable()).getByText(name, { selector: 'strong' }).closest('tr') as HTMLElement;

  it('shows no Departments section when none is given, so the services stand alone', () => {
    renderWorkspace();
    expect(screen.queryByRole('heading', { name: 'Departments' })).toBeNull();
  });

  it('shows the Departments section below Services with the Add button', () => {
    renderBoth();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('Departments')).toBeGreaterThan(headings.indexOf('Services'));
    expect(screen.getByRole('button', { name: /Add department/ })).toBeTruthy();
  });

  it('shows the department columns, members with heads marked, the service count and the status', () => {
    renderBoth();
    expect(within(departmentsTable()).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Department',
      'Members',
      'Services',
      'Status',
      'Actions',
    ]);

    const audit = within(departmentRow('Audit'));
    expect(audit.getByText('Neha Kapoor')).toBeTruthy();
    expect(audit.getAllByText('Head')).toHaveLength(1);
    expect(audit.getByText('Ananya Rao').parentElement?.textContent).toContain('Head');
    expect(audit.getByText('Neha Kapoor').parentElement?.textContent).not.toContain('Head');
    expect(audit.getByText('2')).toBeTruthy();
    expect(audit.getByText('Active')).toBeTruthy();

    const gst = within(departmentRow('GST'));
    expect(gst.getByText('No members')).toBeTruthy();
    expect(gst.getByText('0')).toBeTruthy();
    expect(gst.getByText('Inactive')).toBeTruthy();
  });

  it('offers Edit and Members on each department, Deactivate on an active one and Reactivate on an inactive one', () => {
    renderBoth();
    const audit = within(departmentRow('Audit'));
    expect(audit.getByRole('button', { name: 'Edit Audit' })).toBeTruthy();
    expect(audit.getByRole('button', { name: 'Members of Audit' })).toBeTruthy();
    expect(audit.getByRole('button', { name: 'Deactivate Audit' })).toBeTruthy();
    expect(audit.queryByRole('button', { name: /Reactivate/ })).toBeNull();
    const gst = within(departmentRow('GST'));
    expect(gst.getByRole('button', { name: 'Reactivate GST' })).toBeTruthy();
    expect(gst.queryByRole('button', { name: /Deactivate/ })).toBeNull();
  });

  it('never shows a raw id', () => {
    renderBoth();
    expect(UUID_PATTERN.test(document.body.textContent ?? '')).toBe(false);
  });

  it('shows the loading state, the first-load error with Retry, and the empty state', () => {
    const loading = renderBoth({ departments: [], loading: true, hasLiveSnapshot: false });
    expect(screen.getByLabelText('Loading departments').getAttribute('aria-busy')).toBe('true');
    loading.unmount();

    const failed = renderBoth({ departments: [], hasLiveSnapshot: false, error: 'Unable to reach the server.' });
    expect(screen.getByText('Unable to load departments')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' }).at(-1)!);
    expect(failed.onRetryDepartments).toHaveBeenCalledTimes(1);
    failed.unmount();

    renderBoth({ departments: [] });
    expect(screen.getByText('No departments yet. Add the departments the firm works in.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add department/ })).toBeTruthy();
  });

  it('keeps the last loaded departments with a refresh warning when a later load fails', () => {
    const { onRetryDepartments } = renderBoth({ error: 'Unable to reach the server.' });
    expect(screen.getByText('Refresh failed. Showing last loaded data.')).toBeTruthy();
    expect(departmentRow('Audit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryDepartments).toHaveBeenCalledTimes(1);
  });

  describe('adding and editing a department', () => {
    it('adds a department, toasts and tells the services', async () => {
      const { departmentActions, onToast, onDepartmentsChanged } = renderBoth();
      departmentActions.createDepartment.mockResolvedValue({ ...AUDIT, name: 'TDS' });
      fireEvent.click(screen.getByRole('button', { name: /Add department/ }));
      const dialog = screen.getByRole('dialog', { name: 'Add department' });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' TDS ' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save department' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(departmentActions.createDepartment).toHaveBeenCalledWith({ name: 'TDS' }, expect.any(String));
      expect(onToast).toHaveBeenCalledWith('Department TDS added.');
      expect(onDepartmentsChanged).toHaveBeenCalledTimes(1);
    });

    it('edits the name with the concurrency token, and loads again when it was changed by someone else', async () => {
      const { departmentActions, onToast, onRetryDepartments } = renderBoth();
      departmentActions.updateDepartment.mockResolvedValueOnce({ ...AUDIT, name: 'Audit and Assurance' });
      fireEvent.click(screen.getByRole('button', { name: 'Edit Audit' }));
      let dialog = screen.getByRole('dialog', { name: 'Edit Audit' });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Audit and Assurance' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save department' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(departmentActions.updateDepartment).toHaveBeenCalledWith(
        AUDIT_ID,
        { name: 'Audit and Assurance', expectedUpdatedAt: AUDIT.updatedAt },
        expect.any(String),
      );
      expect(onToast).toHaveBeenCalledWith('Department Audit and Assurance updated.');

      departmentActions.updateDepartment.mockRejectedValueOnce(
        new DepartmentsOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'stale_department' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Edit Audit' }));
      dialog = screen.getByRole('dialog', { name: 'Edit Audit' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save department' }));
      await waitFor(() =>
        expect(within(dialog).getByRole('alert').textContent).toBe(
          'This department was changed by someone else. Reload and try again.',
        ),
      );
      expect(onRetryDepartments).toHaveBeenCalledTimes(1);
    });

    it('shows the duplicate message and does not announce anything when the save fails', async () => {
      const { departmentActions, onToast, onDepartmentsChanged } = renderBoth();
      departmentActions.createDepartment.mockRejectedValue(
        new DepartmentsOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'duplicate_department' }),
      );
      fireEvent.click(screen.getByRole('button', { name: /Add department/ }));
      const dialog = screen.getByRole('dialog', { name: 'Add department' });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'audit' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save department' }));
      await waitFor(() =>
        expect(within(dialog).getByRole('alert').textContent).toBe('A department named audit already exists.'),
      );
      expect(onToast).not.toHaveBeenCalled();
      expect(onDepartmentsChanged).not.toHaveBeenCalled();
    });
  });

  describe('members', () => {
    it('saves the membership, toasts and tells the services', async () => {
      const { departmentActions, onToast, onDepartmentsChanged } = renderBoth();
      departmentActions.setDepartmentMembers.mockResolvedValue(AUDIT);
      fireEvent.click(screen.getByRole('button', { name: 'Members of Audit' }));
      const dialog = screen.getByRole('dialog', { name: 'Members of Audit' });
      fireEvent.click(within(dialog).getByLabelText(/^Rohan Mehta/));
      fireEvent.click(within(dialog).getByLabelText('Head, Rohan Mehta'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save members' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(departmentActions.setDepartmentMembers).toHaveBeenCalledWith(
        AUDIT_ID,
        {
          members: [
            { userId: ANANYA, isHead: true },
            { userId: NEHA, isHead: false },
            { userId: ROHAN, isHead: true },
          ],
        },
        expect.any(String),
      );
      expect(onToast).toHaveBeenCalledWith('Members of Audit updated.');
      expect(onDepartmentsChanged).toHaveBeenCalledTimes(1);
    });

    it('returns focus to the Members button when the dialog closes', async () => {
      renderBoth();
      const button = screen.getByRole('button', { name: 'Members of Audit' });
      fireEvent.click(button);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(document.activeElement).toBe(button));
    });
  });

  describe('deactivating and reactivating a department', () => {
    it('deactivates straight away, toasts and tells the services', async () => {
      const { departmentActions, onToast, onDepartmentsChanged } = renderBoth();
      departmentActions.updateDepartment.mockResolvedValue({ ...AUDIT, isActive: false });
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate Audit' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Department Audit deactivated.'));
      expect(departmentActions.updateDepartment).toHaveBeenCalledWith(
        AUDIT_ID,
        { isActive: false, expectedUpdatedAt: AUDIT.updatedAt },
        expect.any(String),
      );
      expect(onDepartmentsChanged).toHaveBeenCalledTimes(1);
    });

    it('reactivates, and reuses the key for an unchanged retry after a failure', async () => {
      const { departmentActions, onToast } = renderBoth();
      departmentActions.updateDepartment
        .mockRejectedValueOnce(new DepartmentsOperationError({ code: 'network', message: 'down' }))
        .mockResolvedValueOnce({ ...RETIRED, isActive: true });
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate GST' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Unable to reach the server'));
      expect(onToast).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate GST' }));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Department GST reactivated.'));
      expect(departmentActions.updateDepartment.mock.calls[1]?.[2]).toBe(
        departmentActions.updateDepartment.mock.calls[0]?.[2],
      );
    });
  });

  describe('the Department column and the service dialog', () => {
    const FILED = service({ departmentId: AUDIT_ID, departmentName: 'Audit' });

    it('shows the department name in the service row, or Not set', () => {
      renderBoth({}, { services: [GST, FILED].slice(1) });
      expect(within(row('GST Compliance')).getByText('Audit')).toBeTruthy();
      cleanup();
      renderBoth({}, { services: [GST] });
      expect(within(row('GST Compliance')).getByText('Not set')).toBeTruthy();
    });

    it('offers the active departments and No department in the service dialog, and sends the choice', async () => {
      const { actions } = renderBoth();
      actions.createService.mockResolvedValue(service({ name: 'Tax Audit' }));
      fireEvent.click(screen.getByRole('button', { name: /Add service/ }));
      const dialog = screen.getByRole('dialog', { name: 'Add service' });
      const select = within(dialog).getByLabelText('Department') as HTMLSelectElement;
      expect([...select.options].map((option) => option.textContent)).toEqual(['No department', 'Audit']);
      expect(select.value).toBe('');
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Tax Audit' } });
      fireEvent.change(select, { target: { value: AUDIT_ID } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(actions.createService).toHaveBeenCalledWith(
        { name: 'Tax Audit', description: null, turnaroundDays: null, isStatutory: false, departmentId: AUDIT_ID },
        expect.any(String),
      );
    });

    it('opens an edit with the service department chosen, and can clear it', async () => {
      const { actions } = renderBoth({}, { services: [FILED] });
      actions.updateService.mockResolvedValue(FILED);
      fireEvent.click(screen.getByRole('button', { name: 'Edit GST Compliance' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit GST Compliance' });
      const select = within(dialog).getByLabelText('Department') as HTMLSelectElement;
      expect(select.value).toBe(AUDIT_ID);
      fireEvent.change(select, { target: { value: '' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save service' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(actions.updateService).toHaveBeenCalledWith(
        FILED.id,
        expect.objectContaining({ departmentId: null, expectedUpdatedAt: FILED.updatedAt }),
        expect.any(String),
      );
    });

    it('still lists the service own department when it has been deactivated, marked as inactive', () => {
      const inactiveFiled = service({ departmentId: GST_DEPARTMENT_ID, departmentName: 'GST' });
      renderBoth({}, { services: [inactiveFiled] });
      fireEvent.click(screen.getByRole('button', { name: 'Edit GST Compliance' }));
      const select = within(screen.getByRole('dialog')).getByLabelText('Department') as HTMLSelectElement;
      expect([...select.options].map((option) => option.textContent)).toEqual([
        'No department',
        'Audit',
        'GST (inactive)',
      ]);
      expect(select.value).toBe(GST_DEPARTMENT_ID);
    });
  });
});
