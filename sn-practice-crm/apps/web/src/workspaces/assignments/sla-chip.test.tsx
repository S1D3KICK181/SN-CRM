// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SlaDto } from '@sn/contracts';
import type { AssignmentRow } from '../../data';
import { AssignmentDetailDrawer } from './assignment-detail-drawer';
import { AssignmentsTable } from './assignments-table';
import { SlaChip, formatSlaDeadline, slaChipModel, slaDetailText } from './sla-chip';

afterEach(() => {
  cleanup();
});

const sla = (overrides: Partial<SlaDto> = {}): SlaDto => ({
  targetDays: 10,
  deadline: '2026-11-26',
  status: 'on_track',
  workingDaysUsed: 6,
  workingDaysLeft: 4,
  ...overrides,
});

const row = (overrides: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: 'ASN-0001',
  code: 'ASN-0001',
  title: 'GSTR-1 Monthly Return Filing',
  client: 'Aster Foods Private Limited',
  service: 'GST Compliance',
  due: '30/11/2026',
  owner: 'Priya Desai',
  ownerId: '00000000-0000-4000-a000-000000000002',
  status: 'In progress',
  progress: 50,
  tone: 'default',
  ...overrides,
});

describe('slaChipModel', () => {
  it.each([
    [sla({ status: 'on_track' }), 'On track', 'default', false],
    [sla({ status: 'at_risk', workingDaysLeft: 2 }), 'At risk · 2d left', 'warning', false],
    [sla({ status: 'at_risk', workingDaysLeft: 0 }), 'At risk · 0d left', 'warning', false],
    [sla({ status: 'breached', workingDaysLeft: 0 }), 'Breached', 'danger', false],
    [sla({ status: 'met', workingDaysLeft: 0 }), 'Met', 'success', false],
    [sla({ status: 'late', workingDaysLeft: 0 }), 'Late', 'danger', true],
    [null, 'No target', 'default', true],
    [undefined, 'No target', 'default', true],
  ] as const)('words and tones %j', (input, label, tone, muted) => {
    expect(slaChipModel(input)).toEqual({ label, tone, muted });
  });

  it('draws the chip with the status classes, muted when it is', () => {
    const { container, rerender } = render(<SlaChip sla={sla({ status: 'late' })} />);
    expect(container.querySelector('span')?.className).toBe('status tone-danger is-muted');
    rerender(<SlaChip sla={sla({ status: 'at_risk' })} />);
    expect(container.querySelector('span')?.className).toBe('status tone-warning');
  });
});

describe('SLA wording', () => {
  it('writes the deadline as DD/MM/YYYY', () => {
    expect(formatSlaDeadline('2026-11-26')).toBe('26/11/2026');
  });

  it('describes running work with its target, deadline and days', () => {
    expect(slaDetailText(sla())).toBe('Target 10 working days · deadline 26/11/2026 · 6 used, 4 left');
  });

  it('describes stopped work by the day it was submitted', () => {
    expect(slaDetailText(sla({ status: 'met', workingDaysUsed: 8, workingDaysLeft: 0 }))).toBe('Submitted on day 8 of 10');
    expect(slaDetailText(sla({ status: 'late', workingDaysUsed: 12, workingDaysLeft: 0 }))).toBe('Submitted on day 12 of 10');
  });
});

describe('AssignmentsTable SLA column', () => {
  it('shows an SLA chip for each row and a dash for cancelled work', () => {
    render(
      <AssignmentsTable
        title="Assignments"
        onToast={vi.fn()}
        rows={[
          row({ id: 'a', title: 'On track one', sla: sla() }),
          row({ id: 'b', title: 'Risky one', sla: sla({ status: 'at_risk', workingDaysLeft: 1 }) }),
          row({ id: 'c', title: 'No target one', sla: null }),
          row({ id: 'd', title: 'Cancelled one', status: 'Cancelled', sla: null }),
        ]}
      />,
    );
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toContain('SLA');
    const cells = (title: string) => (screen.getByText(title).closest('tr') as HTMLElement).querySelectorAll('td');
    expect(cells('On track one')[4]?.textContent).toBe('On track');
    expect(cells('Risky one')[4]?.textContent).toBe('At risk · 1d left');
    expect(cells('No target one')[4]?.textContent).toBe('No target');
    expect(cells('Cancelled one')[4]?.textContent).toBe('—');
  });
});

describe('AssignmentDetailDrawer SLA line', () => {
  const open = (assignment: AssignmentRow) => {
    render(
      <AssignmentDetailDrawer
        assignment={assignment}
        leadership={true}
        role="founder"
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Scope & Team/ }));
    return within(screen.getByText('SLA').closest('.drawer-item') as HTMLElement);
  };

  it('shows the target, deadline, days used and left, and the status', () => {
    const line = open(row({ sla: sla() }));
    expect(line.getByText(/Target 10 working days · deadline 26\/11\/2026 · 6 used, 4 left/)).toBeTruthy();
    expect(line.getByText('On track')).toBeTruthy();
  });

  it('shows submitted work by its day and whether it met the target', () => {
    const line = open(row({ status: 'Ready for review', sla: sla({ status: 'met', workingDaysUsed: 8, workingDaysLeft: 0 }) }));
    expect(line.getByText(/Submitted on day 8 of 10/)).toBeTruthy();
    expect(line.getByText('Met')).toBeTruthy();
  });

  it('says where to set a turnaround when the service has none, without a link', () => {
    const line = open(row({ sla: null }));
    expect(
      line.getByText('No target set for GST Compliance. Set a usual turnaround in Settings → Services.'),
    ).toBeTruthy();
    expect(line.queryByRole('link')).toBeNull();
  });

  it('leaves the SLA line out for cancelled work', () => {
    render(
      <AssignmentDetailDrawer
        assignment={row({ status: 'Cancelled', sla: null })}
        leadership={true}
        role="founder"
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Scope & Team/ }));
    expect(screen.queryByText('SLA')).toBeNull();
  });
});
