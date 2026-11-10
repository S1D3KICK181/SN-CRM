// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssignmentDetailDrawer } from './assignment-detail-drawer';
import type { AssignmentRow } from '../../data';

afterEach(() => {
  cleanup();
});

const sampleAssignment: AssignmentRow = {
  id: 'ASN-0001',
  code: 'ASN-0001',
  title: 'GSTR-1 Monthly Return Filing',
  client: 'Aster Foods Private Limited',
  clientId: '10000000-0000-4000-a000-000000000001',
  service: 'GST Compliance',
  due: '11/11/2026',
  owner: 'Priya Desai',
  ownerId: '00000000-0000-4000-a000-000000000002',
  reviewer: 'Ananya Rao',
  reviewerId: '00000000-0000-4000-a000-000000000003',
  reviewerIds: ['00000000-0000-4000-a000-000000000003'],
  status: 'In progress',
  progress: 50,
  tone: 'default',
  bankStatementRequired: true,
  bankRecStatus: 'Awaited',
};

const customTeamMembers = [
  { id: '00000000-0000-4000-a000-000000000001', name: 'S. Narayanan', role: 'founder' as const },
  { id: '00000000-0000-4000-a000-000000000002', name: 'Priya Desai', role: 'manager' as const },
  { id: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff' as const },
  { id: '00000000-0000-4000-a000-000000000004', name: 'Rohan Mehta', role: 'staff' as const },
  { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee' as const },
];

describe('AssignmentDetailDrawer component', () => {
  it('excludes trainees from owner/reviewer selection options', () => {
    render(
      <AssignmentDetailDrawer
        assignment={sampleAssignment}
        leadership={true}
        role="founder"
        initialEditing={true}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    // Trainee should NOT be in the select options
    expect(screen.queryByText(/Neha Kapoor/)).toBeNull();
    // Non-trainees should be present in both owner and reviewer selects
    expect(screen.getAllByText(/Priya Desai/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Rohan Mehta/).length).toBeGreaterThanOrEqual(1);
  });

  it('updates owner and reviewer using valid UUIDs and triggers onUpdateAssignment', () => {
    const handleUpdate = vi.fn();
    const handleToast = vi.fn();

    render(
      <AssignmentDetailDrawer
        assignment={sampleAssignment}
        leadership={true}
        role="founder"
        initialEditing={true}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={handleToast}
        onUpdateAssignment={handleUpdate}
      />,
    );

    const ownerSelect = screen.getByLabelText(/Assigned Staff \(Owner \/ Custodian\)/i);
    // Change owner to Rohan Mehta
    fireEvent.change(ownerSelect, { target: { value: '00000000-0000-4000-a000-000000000004' } });

    const saveButton = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveButton);

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    const updated = handleUpdate.mock.calls[0]![0] as AssignmentRow;
    expect(updated.owner).toBe('Rohan Mehta');
    expect(updated.ownerId).toBe('00000000-0000-4000-a000-000000000004');
    expect(handleToast).toHaveBeenCalledWith('Assignment ASN-0001 details saved');
  });

  it('renders terminal notice banner and disables form controls when status is approved or closed', () => {
    const terminalAssignment: AssignmentRow = {
      ...sampleAssignment,
      status: 'Approved',
    };

    render(
      <AssignmentDetailDrawer
        assignment={terminalAssignment}
        leadership={true}
        role="founder"
        initialEditing={true}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/This assignment is approved\/closed and remains an immutable audit artifact\./i),
    ).toBeDefined();

    const saveButton = screen.getByRole('button', { name: /Save Changes/i });
    expect(saveButton.hasAttribute('disabled')).toBe(true);

    const ownerSelect = screen.getByLabelText(/Assigned Staff \(Owner \/ Custodian\)/i);
    expect(ownerSelect.hasAttribute('disabled')).toBe(true);

    const titleInput = screen.getByLabelText(/Assignment Title/i);
    expect(titleInput.hasAttribute('disabled')).toBe(true);
  });

  it('does not expose editable fee or bank statement requirement controls in edit mode', () => {
    render(
      <AssignmentDetailDrawer
        assignment={sampleAssignment}
        leadership={true}
        role="founder"
        initialEditing={true}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/Agreed Professional Fee/i)).toBeNull();
    expect(screen.queryByLabelText(/Bank Statement & Reconciliation Required/i)).toBeNull();
  });

  it('renders truthful quiet empty state for working papers without unpersisted attach controls', () => {
    render(
      <AssignmentDetailDrawer
        assignment={sampleAssignment}
        leadership={true}
        role="founder"
        initialEditing={false}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    const papersTab = screen.getByRole('button', { name: /^Working Papers$/i });
    fireEvent.click(papersTab);

    expect(screen.getByText(/No linked working papers/i)).toBeDefined();
    expect(screen.queryByPlaceholderText(/New paper name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Attach/i })).toBeNull();
  });

  it('renders honest empty/disabled option when teamMembers is empty', () => {
    render(
      <AssignmentDetailDrawer
        assignment={sampleAssignment}
        leadership={true}
        role="founder"
        initialEditing={true}
        teamMembers={[]}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    expect(screen.getByText(/No eligible staff available/i)).toBeDefined();
    expect(screen.getByText(/No eligible reviewers available/i)).toBeDefined();
  });

  it('displays truthful related settings note in overview mode', () => {
    render(
      <AssignmentDetailDrawer
        assignment={sampleAssignment}
        leadership={true}
        role="founder"
        initialEditing={false}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    const overviewTab = screen.getByRole('button', { name: /Scope & Team/i });
    fireEvent.click(overviewTab);

    expect(screen.getByText(/Professional fees are managed in Billing/i)).toBeDefined();
  });
});
