// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DepartmentDto } from '@sn/contracts';
import type { AssignmentRow } from '../../data';
import { DashboardViewSwitch, DepartmentDashboard } from './department-dashboard';
import { MY_DASHBOARD_VIEW } from './department-view';

afterEach(cleanup);

const TODAY = '2026-11-13';
const AUDIT_SERVICE = '50000000-0000-4000-a000-000000000002';
const ANANYA = '00000000-0000-4000-a000-000000000003';
const ROHAN = '00000000-0000-4000-a000-000000000004';
const PRIYA = '00000000-0000-4000-a000-000000000002';

function row(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: 'a1',
    title: 'Internal audit fieldwork',
    client: 'BluePeak Tech',
    service: 'Internal Audit',
    serviceId: AUDIT_SERVICE,
    due: '20/11/2026',
    owner: 'Rohan Mehta',
    ownerId: ROHAN,
    status: 'In progress',
    progress: 10,
    tone: 'default',
    ...overrides,
  };
}

const AUDIT: DepartmentDto = {
  id: '60000000-0000-4000-a000-000000000001',
  name: 'Audit',
  isActive: true,
  members: [
    { userId: ANANYA, name: 'Ananya Rao', role: 'senior_staff', isHead: true },
    { userId: ROHAN, name: 'Rohan Mehta', role: 'staff', isHead: false },
  ],
  serviceIds: [AUDIT_SERVICE],
  createdAt: '2026-11-01T04:30:00.000Z',
  updatedAt: '2026-11-01T04:30:00.000Z',
};
const GST: DepartmentDto = { ...AUDIT, id: '60000000-0000-4000-a000-000000000002', name: 'GST', members: [], serviceIds: [] };

function renderDashboard(rows: AssignmentRow[], department: DepartmentDto = AUDIT, canEdit = false) {
  const onSelectAssignment = vi.fn();
  render(
    <DepartmentDashboard
      department={department}
      assignments={rows}
      today={TODAY}
      canEdit={canEdit}
      onToast={vi.fn()}
      onSelectAssignment={onSelectAssignment}
    />,
  );
  return { onSelectAssignment };
}

const tile = (label: string) => within(screen.getByLabelText('Operational summary')).getByText(label).closest('article') as HTMLElement;

describe('DashboardViewSwitch', () => {
  it('offers My dashboard first, then one option per department, with the current view pressed', () => {
    render(<DashboardViewSwitch departments={[AUDIT, GST]} view={AUDIT.id} onChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Dashboard view' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['My dashboard', 'Audit', 'GST']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(buttons[1]?.className).toContain('is-active');
  });

  it('reports the chosen view: a department id, or the personal dashboard', () => {
    const onChange = vi.fn();
    render(<DashboardViewSwitch departments={[AUDIT]} view={MY_DASHBOARD_VIEW} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Audit' }));
    expect(onChange).toHaveBeenLastCalledWith(AUDIT.id);
    fireEvent.click(screen.getByRole('button', { name: 'My dashboard' }));
    expect(onChange).toHaveBeenLastCalledWith(MY_DASHBOARD_VIEW);
  });
});

describe('DepartmentDashboard', () => {
  it('shows the empty state, and nothing else, when no service is linked to the department', () => {
    renderDashboard([row()], GST);
    expect(screen.getByText('No services are linked to this department yet. Link them in Settings → Services.')).toBeTruthy();
    expect(screen.queryByLabelText('Operational summary')).toBeNull();
    expect(screen.queryByText('Coming up')).toBeNull();
  });

  it('shows the four tiles counted over the department work only', () => {
    renderDashboard([
      row({ id: '1', due: '13/11/2026' }),
      row({ id: '2', due: '10/11/2026', status: 'Ready for review' }),
      row({
        id: '3',
        due: '01/11/2026',
        sla: { targetDays: 5, deadline: '2026-11-20', status: 'at_risk', workingDaysUsed: 4, workingDaysLeft: 1 },
      }),
      // Not this department's work: another service, and a row with no service
      row({ id: '4', serviceId: '50000000-0000-4000-a000-000000000009', due: '01/11/2026' }),
      row({ id: '5', serviceId: undefined, due: '01/11/2026' }),
    ]);
    expect(within(screen.getByLabelText('Operational summary')).getAllByRole('article').map((a) => a.querySelector('span')?.textContent)).toEqual([
      'Open assignments',
      'Due today',
      'Overdue',
      'Waiting for review',
      'At risk / breached',
    ]);
    expect(tile('Open assignments').querySelector('strong')?.textContent).toBe('3');
    expect(tile('Due today').querySelector('strong')?.textContent).toBe('1');
    expect(tile('Overdue').querySelector('strong')?.textContent).toBe('2');
    expect(tile('Waiting for review').querySelector('strong')?.textContent).toBe('1');
    expect(tile('At risk / breached').querySelector('strong')?.textContent).toBe('1 / 0');
  });

  it('shows Coming up from the department work', () => {
    renderDashboard([
      row({ id: '1', title: 'Fieldwork for BluePeak', due: '15/11/2026' }),
      row({ id: '2', title: 'Someone else', serviceId: '50000000-0000-4000-a000-000000000009', due: '14/11/2026' }),
    ]);
    const coming = screen.getByText('Coming up').closest('section, article, div') as HTMLElement;
    expect(screen.getByText('Fieldwork for BluePeak')).toBeTruthy();
    expect(screen.queryByText('Someone else')).toBeNull();
    expect(coming).toBeTruthy();
  });

  it('shows open work by person for the members, even with nothing open, plus any owner of department work', () => {
    renderDashboard([
      row({ id: '1' }),
      row({ id: '2' }),
      row({ id: '3', owner: 'Priya Desai', ownerId: PRIYA }),
    ]);
    const card = screen.getByText('Open work by person').closest('section, article, div') as HTMLElement;
    void card;
    const rows = [...document.querySelectorAll('.capacity-row')].map((r) => r.textContent);
    expect(rows).toEqual(['Rohan Mehta2 open', 'Priya Desai1 open', 'Ananya Rao0 open']);
  });

  it('lists the overdue assignments, earliest first, and opens one when clicked', () => {
    const { onSelectAssignment } = renderDashboard([
      row({ id: 'late', title: 'Late audit', due: '10/11/2026' }),
      row({ id: 'later', title: 'Later audit', due: '01/11/2026' }),
      row({ id: 'fine', title: 'On time', due: '20/11/2026' }),
    ]);
    const table = screen.getByRole('table');
    const titles = [...table.querySelectorAll('.assignment-link strong')].map((title) => title.textContent);
    expect(titles).toEqual(['Later audit', 'Late audit']);
    expect(within(table).queryByText('On time')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Overdue assignments' })).toBeTruthy();
    fireEvent.click(within(table).getAllByRole('button', { name: /Later audit/ })[0]!);
    expect(onSelectAssignment).toHaveBeenCalledWith(expect.objectContaining({ id: 'later' }));
  });

  it('says so when nothing is overdue', () => {
    renderDashboard([row({ due: '20/11/2026' })]);
    expect(screen.getByRole('heading', { name: 'Overdue assignments' })).toBeTruthy();
    expect(screen.getByText('No overdue assignments.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers the edit pencil only to people who may edit', () => {
    renderDashboard([row({ due: '01/11/2026' })], AUDIT, false);
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    cleanup();
    renderDashboard([row({ due: '01/11/2026' })], AUDIT, true);
    expect(screen.getAllByRole('button', { name: /^Edit / }).length).toBeGreaterThan(0);
  });

  it('never shows a raw id', () => {
    renderDashboard([row({ due: '01/11/2026' })]);
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(document.body.textContent ?? '')).toBe(
      false,
    );
  });
});
