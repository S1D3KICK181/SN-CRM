// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssignmentsWorkspace } from './assignments-workspace';
import type { AssignmentRow } from '../../data';

afterEach(() => {
  cleanup();
});

describe('Trainee assignments visibility', () => {
  it('renders trainee-visible involved assignments whose owner and reviewer are other people in one-off table', () => {
    const traineeInvolvedRow: AssignmentRow = {
      id: 'ASN-0099',
      title: 'Trainee Involved Statutory Audit',
      client: 'Acme Corp',
      service: 'Statutory Audit',
      due: '15/11/2026',
      owner: 'Priya Desai',
      reviewer: 'Ananya Rao',
      status: 'In progress',
      progress: 40,
      tone: 'default',
    };

    render(
      <AssignmentsWorkspace
        role="trainee"
        schedules={[]}
        assignments={[traineeInvolvedRow]}
        onToast={vi.fn()}
        onCompose={vi.fn()}
        onUpdateSchedule={vi.fn()}
        onUpdateAssignment={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );

    const oneoffTabButton = screen.getByRole('button', { name: /One-Off & Project Assignments/i });
    fireEvent.click(oneoffTabButton);

    expect(screen.getByText('Trainee Involved Statutory Audit')).toBeDefined();
    expect(screen.getByText(/ASN-0099/)).toBeDefined();
  });

  it('renders status tally strip with correct counts and filters schedules on click', () => {
    const schedules = [
      {
        id: 'RS-001',
        title: 'GST Monthly Return',
        category: 'GST' as const,
        cadence: 'Monthly' as const,
        clientId: 'CLI-001',
        clientName: 'Aster Foods',
        statutoryDueDay: '20th',
        nextDueDate: '20/11/2026',
        nextRunDate: '01/11/2026',
        defaultOwner: 'S. Narayanan',
        status: 'Active' as const,
      },
      {
        id: 'RS-002',
        title: 'TDS Quarterly Return',
        category: 'TDS' as const,
        cadence: 'Quarterly' as const,
        clientId: 'CLI-002',
        clientName: 'BluePeak',
        statutoryDueDay: '31st',
        nextDueDate: '31/01/2027',
        nextRunDate: '01/01/2027',
        defaultOwner: 'S. Narayanan',
        status: 'Paused' as const,
      },
    ];

    const assignments: AssignmentRow[] = [
      {
        id: 'ASN-001',
        code: 'ASN-001',
        title: 'GST Oct Filing',
        clientId: 'CLI-001',
        client: 'Aster Foods',
        service: 'GST',
        scope: 'Oct 2026',
        due: '20/11/2026',
        owner: 'Priya Desai',
        reviewer: 'Ananya Rao',
        status: 'In progress',
        progress: 50,
        tone: 'warning',
        recurringScheduleId: 'RS-001',
      },
    ];

    render(
      <AssignmentsWorkspace
        role="founder"
        schedules={schedules}
        assignments={assignments}
        onToast={vi.fn()}
        onCompose={vi.fn()}
        onUpdateSchedule={vi.fn()}
        onUpdateAssignment={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );

    // Tally strip items show server-backed schedule states and open work
    expect(screen.getByRole('button', { name: /Active 1/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Paused 1/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Open Work 1/i })).toBeDefined();

    // Both schedules visible initially under 'All'
    expect(screen.getByText('GST Monthly Return')).toBeDefined();
    expect(screen.getByText('TDS Quarterly Return')).toBeDefined();

    // Click 'Paused' filter pill
    fireEvent.click(screen.getByRole('button', { name: /Paused 1/i }));
    expect(screen.queryByText('GST Monthly Return')).toBeNull();
    expect(screen.getByText('TDS Quarterly Return')).toBeDefined();

    // Click 'Active' filter pill
    fireEvent.click(screen.getByRole('button', { name: /Active 1/i }));
    expect(screen.getByText('GST Monthly Return')).toBeDefined();
    expect(screen.queryByText('TDS Quarterly Return')).toBeNull();

    // Click 'Open Work' filter pill
    fireEvent.click(screen.getByRole('button', { name: /Open Work 1/i }));
    expect(screen.getByText('GST Monthly Return')).toBeDefined();
    expect(screen.queryByText('TDS Quarterly Return')).toBeNull();
  });

  it('renders loading skeleton when isLoading is true and error banner with retry when error is provided', () => {
    const handleRetry = vi.fn();

    const { rerender } = render(
      <AssignmentsWorkspace
        role="founder"
        schedules={[]}
        assignments={[]}
        isLoading={true}
        onToast={vi.fn()}
        onCompose={vi.fn()}
        onUpdateSchedule={vi.fn()}
        onUpdateAssignment={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );

    expect(screen.getByTestId('schedules-loading-skeleton')).toBeDefined();

    // Now render with error
    rerender(
      <AssignmentsWorkspace
        role="founder"
        schedules={[]}
        assignments={[]}
        isLoading={false}
        error="Failed to load compliance matrix from server"
        onRetry={handleRetry}
        onToast={vi.fn()}
        onCompose={vi.fn()}
        onUpdateSchedule={vi.fn()}
        onUpdateAssignment={vi.fn()}
        onSelectAssignment={vi.fn()}
      />,
    );

    expect(screen.getByText('Failed to load compliance matrix from server')).toBeDefined();
    const retryButton = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryButton);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
