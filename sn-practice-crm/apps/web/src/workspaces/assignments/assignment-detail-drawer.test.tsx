// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignmentDetailDrawer } from './assignment-detail-drawer';
import type { AssignmentRow } from '../../data';
import { MessageComposerContextProvider, type MessageComposer } from '../messages/message-composer';

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

  it('updates owner and reviewer using valid UUIDs and triggers onUpdateAssignment', async () => {
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

    await waitFor(() => {
      expect(handleUpdate).toHaveBeenCalledTimes(1);
      expect(handleToast).toHaveBeenCalledWith('Assignment ASN-0001 details saved');
    });

    const updated = handleUpdate.mock.calls[0]![0] as AssignmentRow;
    expect(updated.owner).toBe('Rohan Mehta');
    expect(updated.ownerId).toBe('00000000-0000-4000-a000-000000000004');
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

    expect(screen.getByText(/Professional fees, invoicing, and collections are managed in Billing/i)).toBeDefined();
  });

  it('renders neutral "Not recorded" when description is missing and never invents ICAI boilerplate', () => {
    const assignmentWithoutScope: AssignmentRow = {
      ...sampleAssignment,
      description: null,
      scope: undefined,
    };

    render(
      <AssignmentDetailDrawer
        assignment={assignmentWithoutScope}
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

    expect(screen.getByText('Not recorded')).toBeDefined();
    expect(screen.queryByText(/ICAI standards/i)).toBeNull();
    expect(screen.queryByText(/Full statutory deliverable verification/i)).toBeNull();
    // Also confirm no Bank Rec Requirement is rendered in overview
    expect(screen.queryByText(/Bank Rec Requirement/i)).toBeNull();
  });

  it('renders neutral "Managed in Billing" for undefined billing and never displays "Unbilled"', () => {
    const assignmentWithUndefinedBilling: AssignmentRow = {
      ...sampleAssignment,
      billed: undefined,
      invoiceId: undefined,
    };

    render(
      <AssignmentDetailDrawer
        assignment={assignmentWithUndefinedBilling}
        leadership={true}
        role="founder"
        initialEditing={false}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    const billingTab = screen.getByRole('button', { name: /Billing Link/i });
    fireEvent.click(billingTab);

    expect(screen.queryByText('Unbilled')).toBeNull();
    expect(screen.getAllByText(/Managed in Billing/i).length).toBeGreaterThanOrEqual(1);
  });

  it('truthfully renders "Billed" with linked invoice when explicitly billed', () => {
    const billedAssignment: AssignmentRow = {
      ...sampleAssignment,
      billed: true,
      invoiceId: 'INV-2026-0099',
    };

    render(
      <AssignmentDetailDrawer
        assignment={billedAssignment}
        leadership={true}
        role="founder"
        initialEditing={false}
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />,
    );

    const billingTab = screen.getByRole('button', { name: /Billing Link/i });
    fireEvent.click(billingTab);

    expect(screen.getByText('Billed')).toBeDefined();
    expect(screen.getByText('INV-2026-0099')).toBeDefined();
  });

  it('shows the linked engagement code, or Not linked', () => {
    const props = {
      leadership: true,
      role: 'founder' as const,
      teamMembers: customTeamMembers,
      onClose: vi.fn(),
      onToast: vi.fn(),
      onUpdateAssignment: vi.fn(),
    };
    const { unmount } = render(
      <AssignmentDetailDrawer
        {...props}
        assignment={{
          ...sampleAssignment,
          engagementId: '50000000-0000-4000-a000-000000000001',
          engagementCode: 'ENG-000404',
        }}
      />,
    );
    expect(screen.getByText('Engagement: ENG-000404')).toBeDefined();
    unmount();

    render(<AssignmentDetailDrawer {...props} assignment={sampleAssignment} />);
    expect(screen.getByText('Engagement: Not linked')).toBeDefined();
  });
});

describe('AssignmentDetailDrawer send reminder (MSG-01)', () => {
  const liveAssignment: AssignmentRow = {
    ...sampleAssignment,
    id: '30000000-0000-4000-a000-000000000001',
    code: 'AS-001001',
    title: 'GSTR-1 & 3B Compliance · Oct 2026',
  };

  function renderDrawer(assignment: AssignmentRow, composer: MessageComposer | null) {
    const drawer = (
      <AssignmentDetailDrawer
        assignment={assignment}
        leadership={true}
        role="founder"
        teamMembers={customTeamMembers}
        onClose={vi.fn()}
        onToast={vi.fn()}
        onUpdateAssignment={vi.fn()}
      />
    );
    render(composer ? <MessageComposerContextProvider value={composer}>{drawer}</MessageComposerContextProvider> : drawer);
  }

  function stubComposer(overrides: Partial<MessageComposer> = {}): MessageComposer {
    return { canMessage: true, canMessageClient: () => true, open: vi.fn(), recentFor: () => [], showAll: vi.fn(), ...overrides };
  }

  it('opens a deadline reminder with the assignment linked', () => {
    const composer = stubComposer();
    renderDrawer(liveAssignment, composer);
    const button = screen.getByRole('button', { name: /Send reminder/ });
    fireEvent.click(button);
    expect(composer.open).toHaveBeenCalledWith(
      {
        clientId: '10000000-0000-4000-a000-000000000001',
        purpose: 'deadline_reminder',
        assignment: {
          id: '30000000-0000-4000-a000-000000000001',
          code: 'AS-001001',
          title: 'GSTR-1 & 3B Compliance · Oct 2026',
          dueOn: '11/11/2026',
        },
      },
      button,
    );
  });

  it.each(['Approved', 'Completed', 'Closed', 'Cancelled'])('has no Send reminder for a %s assignment', (status) => {
    renderDrawer({ ...liveAssignment, status }, stubComposer());
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });

  it.each(['Draft', 'Assigned', 'In progress', 'Ready for review', 'Changes requested'])(
    'has Send reminder for a %s assignment',
    (status) => {
      renderDrawer({ ...liveAssignment, status }, stubComposer());
      expect(screen.getByRole('button', { name: /Send reminder/ })).toBeTruthy();
    },
  );

  it('has no Send reminder for someone who may not message clients, or without a composer', () => {
    renderDrawer(liveAssignment, stubComposer({ canMessage: false }));
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
    cleanup();
    renderDrawer(liveAssignment, null);
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });

  it('has no Send reminder when the assignment or its client is not a live record', () => {
    renderDrawer({ ...liveAssignment, clientId: 'CLI-0001' }, stubComposer());
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
    cleanup();
    renderDrawer({ ...liveAssignment, clientId: undefined }, stubComposer());
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
    cleanup();
    renderDrawer(sampleAssignment, stubComposer());
    expect(screen.queryByRole('button', { name: /Send reminder/ })).toBeNull();
  });
});
