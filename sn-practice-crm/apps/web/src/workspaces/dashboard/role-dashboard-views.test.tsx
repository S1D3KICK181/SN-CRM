// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CompanyRole } from '@sn/domain';
import type { DepartmentDto } from '@sn/contracts';
import { RoleDashboard } from '../../app';
import type { AssignmentRow } from '../../data';

const ANANYA = '00000000-0000-4000-a000-000000000003';
const ROHAN = '00000000-0000-4000-a000-000000000004';
const NEHA = '00000000-0000-4000-a000-000000000005';
const FOUNDER = '00000000-0000-4000-a000-000000000001';
const AUDIT_SERVICE = '50000000-0000-4000-a000-000000000002';
const GST_SERVICE = '50000000-0000-4000-a000-000000000001';

function department(id: string, name: string, overrides: Partial<DepartmentDto> = {}): DepartmentDto {
  return {
    id,
    name,
    isActive: true,
    members: [],
    serviceIds: [],
    createdAt: '2026-11-01T04:30:00.000Z',
    updatedAt: '2026-11-01T04:30:00.000Z',
    ...overrides,
  };
}

const AUDIT = department('60000000-0000-4000-a000-000000000001', 'Audit', {
  members: [
    { userId: ANANYA, name: 'Ananya Rao', role: 'senior_staff', isHead: true },
    { userId: ROHAN, name: 'Rohan Mehta', role: 'staff', isHead: false },
    { userId: NEHA, name: 'Neha Kapoor', role: 'trainee', isHead: false },
  ],
  serviceIds: [AUDIT_SERVICE],
});
const GST = department('60000000-0000-4000-a000-000000000002', 'GST', {
  members: [{ userId: ROHAN, name: 'Rohan Mehta', role: 'staff', isHead: true }],
  serviceIds: [GST_SERVICE],
});
const EMPTY = department('60000000-0000-4000-a000-000000000003', 'Accounts and Registrations');
const RETIRED = department('60000000-0000-4000-a000-000000000004', 'Old', { isActive: false });

const ASSIGNMENTS: AssignmentRow[] = [
  {
    id: 'a-audit',
    title: 'Internal audit fieldwork',
    client: 'BluePeak Tech',
    service: 'Internal Audit',
    serviceId: AUDIT_SERVICE,
    due: '01/01/2020',
    owner: 'Rohan Mehta',
    ownerId: ROHAN,
    status: 'In progress',
    progress: 20,
    tone: 'default',
  },
  {
    id: 'a-gst',
    title: 'GSTR-1 filing',
    client: 'Aster Foods',
    service: 'GST Compliance',
    serviceId: GST_SERVICE,
    due: '01/01/2020',
    owner: 'Rohan Mehta',
    ownerId: ROHAN,
    status: 'In progress',
    progress: 20,
    tone: 'default',
  },
];

// Node's own experimental localStorage hides the jsdom one, so give the tests a plain in-memory storage
const data = new Map<string, string>();
const storage: Storage = {
  get length() {
    return data.size;
  },
  clear: () => data.clear(),
  getItem: (key) => data.get(key) ?? null,
  key: (index) => [...data.keys()][index] ?? null,
  removeItem: (key) => void data.delete(key),
  setItem: (key, value) => void data.set(key, String(value)),
};

beforeEach(() => {
  data.clear();
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'localStorage');
});

function renderDashboard(role: CompanyRole, actorId: string, departments: DepartmentDto[]) {
  const onSelectAssignment = vi.fn();
  const view = render(
    <RoleDashboard
      role={role}
      actorId={actorId}
      actorName="Test Person"
      departments={departments}
      assignments={ASSIGNMENTS}
      schedules={[]}
      invoices={[]}
      receipts={[]}
      personalTasks={[]}
      delegatedTasks={[]}
      onCompose={vi.fn()}
      onToast={vi.fn()}
      onSelectAssignment={onSelectAssignment}
      onTogglePersonalTask={vi.fn()}
    />,
  );
  return { ...view, onSelectAssignment };
}

const switchButtons = () => {
  const group = screen.queryByRole('group', { name: 'Dashboard view' });
  return group ? within(group).getAllByRole('button').map((button) => button.textContent) : null;
};

describe('the dashboard view switch', () => {
  it.each(['founder', 'manager'] as const)('gives the %s My dashboard plus every active department', (role) => {
    renderDashboard(role, FOUNDER, [AUDIT, GST, EMPTY, RETIRED]);
    expect(switchButtons()).toEqual(['My dashboard', 'Audit', 'GST', 'Accounts and Registrations']);
  });

  it('gives a head only the departments they head', () => {
    renderDashboard('senior_staff', ANANYA, [AUDIT, GST, EMPTY, RETIRED]);
    expect(switchButtons()).toEqual(['My dashboard', 'Audit']);
    cleanup();
    renderDashboard('staff', ROHAN, [AUDIT, GST]);
    expect(switchButtons()).toEqual(['My dashboard', 'GST']);
  });

  it.each([
    ['a plain member', 'staff', ROHAN, [AUDIT]],
    ['a trainee member', 'trainee', NEHA, [AUDIT]],
    ['someone outside every department', 'senior_staff', ANANYA, [GST, EMPTY]],
    ['anyone when there are no departments', 'senior_staff', ANANYA, []],
  ] as const)('shows no switch for %s, who keeps their personal dashboard', (_label, role, actorId, departments) => {
    renderDashboard(role, actorId, [...departments]);
    expect(switchButtons()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Overdue assignments' })).toBeNull();
    expect(screen.getByLabelText('Operational summary')).toBeTruthy();
  });

  it('starts on My dashboard, and the Founder keeps the personal overview there', () => {
    renderDashboard('founder', FOUNDER, [AUDIT, GST]);
    const group = screen.getByRole('group', { name: 'Dashboard view' });
    expect(within(group).getByRole('button', { name: 'My dashboard' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('All open assignments')).toBeTruthy();
  });

  it('opens a department view from the live assignments and remembers the choice for next time', () => {
    const first = renderDashboard('founder', FOUNDER, [AUDIT, GST]);
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));

    expect(screen.getByRole('button', { name: 'Audit' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('All open assignments')).toBeNull();
    const summary = within(screen.getByLabelText('Operational summary'));
    expect(summary.getByText('Open assignments').closest('article')?.querySelector('strong')?.textContent).toBe('1');
    expect(screen.getByRole('heading', { name: 'Overdue assignments' })).toBeTruthy();
    expect(screen.getAllByText('Internal audit fieldwork').length).toBeTruthy();
    expect(screen.queryByText('GSTR-1 filing')).toBeNull();
    expect(data.get(`sn-crm-dashboard-view:${FOUNDER}`)).toBe(AUDIT.id);

    // A fresh visit opens on the last view they chose
    first.unmount();
    renderDashboard('founder', FOUNDER, [AUDIT, GST]);
    expect(screen.getByRole('button', { name: 'Audit' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByText('Internal audit fieldwork').length).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'My dashboard' }));
    expect(screen.getByText('All open assignments')).toBeTruthy();
    expect(data.get(`sn-crm-dashboard-view:${FOUNDER}`)).toBe('my-dashboard');
  });

  it('shows a head their own department work and lets them go back to their personal dashboard', () => {
    renderDashboard('senior_staff', ANANYA, [AUDIT, GST]);
    expect(screen.getByLabelText('Operational summary')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));
    expect(screen.getAllByText('Internal audit fieldwork').length).toBeTruthy();
    expect(screen.queryByText('GSTR-1 filing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'My dashboard' }));
    expect(screen.queryByRole('heading', { name: 'Overdue assignments' })).toBeNull();
  });

  it('falls back to My dashboard when the remembered department is no longer available', () => {
    data.set(`sn-crm-dashboard-view:${ANANYA}`, GST.id);
    renderDashboard('senior_staff', ANANYA, [AUDIT, GST]);
    expect(switchButtons()).toEqual(['My dashboard', 'Audit']);
    expect(screen.getByRole('button', { name: 'My dashboard' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Overdue assignments' })).toBeNull();
  });

  it('keeps one person remembered view from leaking to another on the same browser', () => {
    data.set(`sn-crm-dashboard-view:${FOUNDER}`, AUDIT.id);
    renderDashboard('senior_staff', ANANYA, [AUDIT]);
    expect(screen.getByRole('button', { name: 'My dashboard' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the empty state for a department with no services', () => {
    renderDashboard('manager', FOUNDER, [EMPTY]);
    fireEvent.click(screen.getByRole('button', { name: 'Accounts and Registrations' }));
    expect(screen.getByText('No services are linked to this department yet. Link them in Settings → Services.')).toBeTruthy();
    expect(screen.queryByText('Coming up')).toBeNull();
  });

  it('still works when the browser blocks storage', () => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('SecurityError');
      },
      configurable: true,
    });
    renderDashboard('founder', FOUNDER, [AUDIT]);
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));
    expect(screen.getAllByText('Internal audit fieldwork').length).toBeTruthy();
  });
});
