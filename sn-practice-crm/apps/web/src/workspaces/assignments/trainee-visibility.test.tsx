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
});
