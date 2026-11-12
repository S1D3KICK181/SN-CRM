// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentsWorkspace } from './assignments-workspace';
import type { RecurringScheduleRecord } from '../../data';
import { AssignmentOperationError } from '../../api/types';

describe('Schedule drawer engagement line', () => {
  afterEach(() => cleanup());

  const baseSchedule: RecurringScheduleRecord = {
    id: 'RS-000101',
    code: 'RS-000101',
    title: 'Monthly TDS Filing',
    category: 'TDS',
    service: 'TDS Compliance',
    clientId: 'CLI-0001',
    clientName: 'Aster Foods Private Limited',
    cadence: 'Monthly',
    statutoryDueDay: '7th of every month',
    defaultOwner: 'Priya Desai',
    nextRunDate: '01/12/2026',
    nextDueDate: '07/12/2026',
    status: 'Active',
  };

  function openDrawer(schedule: RecurringScheduleRecord) {
    render(
      <AssignmentsWorkspace
        role="founder"
        schedules={[schedule]}
        assignments={[]}
        onToast={vi.fn()}
        onCompose={vi.fn()}
        onUpdateSchedule={vi.fn()}
        onUpdateAssignment={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Monthly TDS Filing'));
  }

  it('shows the engagement code for a linked schedule', () => {
    openDrawer({ ...baseSchedule, engagementId: '50000000-0000-4000-a000-000000000001', engagementCode: 'ENG-000404' });
    expect(screen.getByText('Engagement')).toBeDefined();
    expect(screen.getByText('ENG-000404')).toBeDefined();
    expect(screen.queryByText('Not linked')).toBeNull();
    expect(screen.queryByText(/50000000-0000-4000-a000-000000000001/)).toBeNull();
  });

  it.each([[undefined], [null]])('shows Not linked when engagementCode is %s', (engagementCode) => {
    openDrawer({ ...baseSchedule, engagementCode });
    expect(screen.getByText('Engagement')).toBeDefined();
    expect(screen.getByText('Not linked')).toBeDefined();
  });

  it('explains a refused restart, keeps the drawer open and shows the schedule as paused again', async () => {
    const onToast = vi.fn();
    const onUpdateSchedule = vi.fn().mockRejectedValue(
      new AssignmentOperationError({
        code: 'validation',
        message: 'The assignment or schedule input failed business validation.',
        serverCode: 'engagement_not_active',
      }),
    );
    render(
      <AssignmentsWorkspace
        role="founder"
        schedules={[{ ...baseSchedule, status: 'Paused', engagementId: '50000000-0000-4000-a000-000000000001', engagementCode: 'ENG-000406' }]}
        assignments={[]}
        onToast={onToast}
        onCompose={vi.fn()}
        onUpdateSchedule={onUpdateSchedule}
        onUpdateAssignment={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Monthly TDS Filing'));
    fireEvent.click(screen.getByRole('button', { name: 'Activate Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: /Save Schedule Settings/ }));

    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith("This schedule's engagement has ended, so the schedule cannot be restarted."),
    );
    expect(onToast).not.toHaveBeenCalledWith(expect.stringMatching(/Schedule settings saved/));
    expect(screen.getByRole('dialog', { name: 'Recurring schedule details for Monthly TDS Filing' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Activate Schedule' })).toBeDefined();
  });
});
