// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CreateAssignmentDialog } from './create-assignment-dialog';

afterEach(() => {
  cleanup();
});

describe('CreateAssignmentDialog', () => {
  const staff = [
    { id: '00000000-0000-4000-a000-000000000001', name: 'S. Narayanan', role: 'founder' as const },
    { id: '00000000-0000-4000-a000-000000000002', name: 'Priya Desai', role: 'manager' as const },
    { id: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff' as const },
    { id: '00000000-0000-4000-a000-000000000004', name: 'Rohan Mehta', role: 'staff' as const },
    { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee' as const },
  ];

  const clients = [
    { id: '10000000-0000-4000-a000-000000000001', name: 'Aster Foods Private Limited' },
    { id: '10000000-0000-4000-a000-000000000002', name: 'BluePeak Technologies' },
  ];

  const services = [
    { id: '20000000-0000-4000-a000-000000000001', name: 'GST Compliance' },
    { id: '20000000-0000-4000-a000-000000000002', name: 'Income Tax Return' },
  ];

  it('renders with established vanilla CSS classes and semantic structure', () => {
    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        onClose={vi.fn()}
        onCreateAssignment={vi.fn()}
      />,
    );

    expect(container.querySelector('.dialog-layer')).not.toBeNull();
    expect(container.querySelector('.dialog')).not.toBeNull();
    expect(container.querySelector('.dialog-header')).not.toBeNull();
    expect(container.querySelector('.dialog-icon')).not.toBeNull();
    expect(container.querySelector('.form-grid')).not.toBeNull();
    expect(container.querySelector('.field')).not.toBeNull();
    expect(container.querySelector('.dialog-footer')).not.toBeNull();
    expect(container.querySelector('.primary-button')).not.toBeNull();
    expect(container.querySelector('.soft-button')).not.toBeNull();
  });

  it('excludes Trainees from In-Charge Owner options and uses real UUID values', () => {
    render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        onClose={vi.fn()}
        onCreateAssignment={vi.fn()}
      />,
    );

    const ownerSelect = screen.getByLabelText(/In-Charge Owner/i) as HTMLSelectElement;
    const optionTexts = Array.from(ownerSelect.options).map((o) => o.textContent);
    const optionValues = Array.from(ownerSelect.options).map((o) => o.value);

    expect(optionTexts).toContain('Priya Desai');
    expect(optionTexts).toContain('Rohan Mehta');
    expect(optionTexts).not.toContain('Neha Kapoor');

    // Values crossing transport must be UUIDs, not display names
    expect(optionValues).toContain('00000000-0000-4000-a000-000000000002');
    expect(optionValues).not.toContain('Priya Desai');
  });

  it('submits one-off assignment successfully passing UUIDs across transport', async () => {
    const onCreateAssignment = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        services={services}
        onClose={onClose}
        onCreateAssignment={onCreateAssignment}
      />,
    );

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'FY 2026-27 Audit' } });

    const dueInput = screen.getByLabelText(/Target Due Date/i);
    fireEvent.change(dueInput, { target: { value: '2026-11-20' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onCreateAssignment).toHaveBeenCalledTimes(1);
    });

    const callArg = onCreateAssignment.mock.calls[0]![0];
    expect(callArg.title).toBe('FY 2026-27 Audit');
    expect(callArg.clientId).toBe('10000000-0000-4000-a000-000000000001');
    expect(callArg.ownerNameOrId).toBe('00000000-0000-4000-a000-000000000002');
    expect(callArg.dueDate).toBe('2026-11-20');
    expect(onClose).toHaveBeenCalled();
  });

  it('submits recurring schedule in leadership mode without reviewer field', async () => {
    const onCreateSchedule = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();

    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="manager"
        clients={clients}
        teamMembers={staff}
        services={services}
        onClose={onClose}
        onCreateAssignment={vi.fn()}
        onCreateSchedule={onCreateSchedule}
      />,
    );

    // Switch to Recurring Schedule tab
    const scheduleTab = screen.getByRole('button', { name: /Recurring Schedule/i });
    fireEvent.click(scheduleTab);

    // Reviewer field must NOT exist for recurring schedule templates
    expect(screen.queryByLabelText(/Sign-off Reviewer/i)).toBeNull();

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'TDS Monthly Filing' } });

    const offsetInput = screen.getByLabelText(/Due offset/i);
    fireEvent.change(offsetInput, { target: { value: '20' } });

    const nextRunInput = screen.getByLabelText(/First Occurrence/i);
    fireEvent.change(nextRunInput, { target: { value: '2026-12-01' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(onCreateSchedule).toHaveBeenCalledTimes(1);
    });

    const callArg = onCreateSchedule.mock.calls[0]![0];
    expect(callArg.title).toBe('TDS Monthly Filing');
    expect(callArg.cadence).toBe('monthly');
    expect(callArg.clientId).toBe('10000000-0000-4000-a000-000000000001');
    expect(callArg.ownerId).toBe('00000000-0000-4000-a000-000000000002');
    expect(callArg.dueDay).toBe(20);
    expect(callArg.nextOccurrenceOn).toBe('2026-12-01');
    expect(callArg.reviewerIds).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks assignment submission when target due date is missing', async () => {
    const onCreateAssignment = vi.fn();
    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        services={services}
        onClose={vi.fn()}
        onCreateAssignment={onCreateAssignment}
      />,
    );

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'Assignment Missing Due Date' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(onCreateAssignment).not.toHaveBeenCalled();
    expect(screen.getByText(/Target due date is required/i)).toBeDefined();
  });

  it('blocks schedule submission when first occurrence date is missing', async () => {
    const onCreateSchedule = vi.fn();
    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        services={services}
        onClose={vi.fn()}
        onCreateAssignment={vi.fn()}
        onCreateSchedule={onCreateSchedule}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Recurring Schedule/i }));

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'Schedule Missing Next Date' } });

    const offsetInput = screen.getByLabelText(/Due offset/i);
    fireEvent.change(offsetInput, { target: { value: '15' } });

    const form = container.querySelector('form')!;
    fireEvent.submit(form);

    expect(onCreateSchedule).not.toHaveBeenCalled();
    expect(screen.getByText(/First occurrence start date is required/i)).toBeDefined();
  });

  it('blocks schedule submission when due offset is blank or outside 1..31', async () => {
    const onCreateSchedule = vi.fn();
    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        services={services}
        onClose={vi.fn()}
        onCreateAssignment={vi.fn()}
        onCreateSchedule={onCreateSchedule}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Recurring Schedule/i }));

    const titleInput = screen.getByLabelText(/Title/i);
    fireEvent.change(titleInput, { target: { value: 'Schedule Invalid Offset' } });

    const nextRunInput = screen.getByLabelText(/First Occurrence/i);
    fireEvent.change(nextRunInput, { target: { value: '2026-12-01' } });

    const form = container.querySelector('form')!;

    // Test blank offset
    fireEvent.submit(form);
    expect(onCreateSchedule).not.toHaveBeenCalled();
    expect(screen.getByText(/Due offset is required/i)).toBeDefined();

    // Test offset > 31
    const offsetInput = screen.getByLabelText(/Due offset/i);
    fireEvent.change(offsetInput, { target: { value: '35' } });
    fireEvent.submit(form);
    expect(onCreateSchedule).not.toHaveBeenCalled();
    expect(screen.getByText(/Due offset must be an integer between 1 and 31 days/i)).toBeDefined();

    // Test offset < 1
    fireEvent.change(offsetInput, { target: { value: '0' } });
    fireEvent.submit(form);
    expect(onCreateSchedule).not.toHaveBeenCalled();
    expect(screen.getByText(/Due offset must be an integer between 1 and 31 days/i)).toBeDefined();
  });

  it('closes dialog on Escape key and manages accessibility attributes', async () => {
    const onClose = vi.fn();

    const { container } = render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        onClose={onClose}
        onCreateAssignment={vi.fn()}
      />,
    );

    const dialog = container.querySelector('section.dialog');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('create-assignment-title');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('opens from a real trigger, dismisses on Cancel or Escape, and restores focus to initiating trigger', async () => {
    function Host() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="open-trigger" type="button" onClick={() => setOpen(true)}>
            Open Dialog
          </button>
          <CreateAssignmentDialog
            isOpen={open}
            role="founder"
            clients={clients}
            teamMembers={staff}
            onClose={() => setOpen(false)}
            onCreateAssignment={vi.fn()}
          />
        </div>
      );
    }

    render(<Host />);
    const trigger = screen.getByTestId('open-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeDefined();

    // Dismiss dialog via Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(document.activeElement).toBe(trigger);
  });

  it('does not render an Agreed Fee input in CreateAssignmentDialog', () => {
    render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        onClose={vi.fn()}
        onCreateAssignment={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/Agreed Professional Fee/i)).toBeNull();
  });

  it('renders honest empty/disabled states when clients and teamMembers are empty', () => {
    render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={[]}
        teamMembers={[]}
        onClose={vi.fn()}
        onCreateAssignment={vi.fn()}
      />,
    );

    expect(screen.getByText(/No clients available/i)).toBeDefined();
    expect(screen.getByText(/No eligible staff available/i)).toBeDefined();
    expect(screen.getByText(/No eligible reviewers available/i)).toBeDefined();
  });

  it('blocks creation and shows error when service catalog is empty', () => {
    const onCreateAssignment = vi.fn();
    render(
      <CreateAssignmentDialog
        isOpen={true}
        role="founder"
        clients={clients}
        teamMembers={staff}
        services={[]}
        onClose={vi.fn()}
        onCreateAssignment={onCreateAssignment}
      />,
    );

    expect(screen.getByText(/Service catalog unavailable/i)).toBeDefined();
    const submitBtn = screen.getByRole('button', { name: /Create Assignment/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
    expect(onCreateAssignment).not.toHaveBeenCalled();
  });

  describe('engagement link', () => {
    const engagements = [
      {
        id: '50000000-0000-4000-a000-000000000001',
        code: 'ENG-000404',
        clientId: '10000000-0000-4000-a000-000000000001',
        title: 'Annual GST retainer',
      },
      {
        id: '50000000-0000-4000-a000-000000000002',
        code: 'ENG-000405',
        clientId: '10000000-0000-4000-a000-000000000002',
        title: 'Statutory audit',
      },
    ];

    function renderDialog(extra: Partial<React.ComponentProps<typeof CreateAssignmentDialog>> = {}) {
      const onCreateAssignment = vi.fn().mockResolvedValue(true);
      const utils = render(
        <CreateAssignmentDialog
          isOpen={true}
          role="founder"
          clients={clients}
          teamMembers={staff}
          services={services}
          engagements={engagements}
          onClose={vi.fn()}
          onCreateAssignment={onCreateAssignment}
          onCreateSchedule={vi.fn()}
          {...extra}
        />,
      );
      return { ...utils, onCreateAssignment };
    }

    function fillAndSubmit(container: HTMLElement) {
      fireEvent.change(screen.getByLabelText(/Assignment Title/i), { target: { value: 'Q2 filing' } });
      fireEvent.change(screen.getByLabelText(/Target Due Date/i), { target: { value: '2026-11-20' } });
      fireEvent.submit(container.querySelector('form')!);
    }

    it('shows the field on the One-Off tab and hides it on the Recurring Schedule tab', () => {
      renderDialog();
      expect(screen.getByLabelText('Engagement')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /Recurring Schedule/i }));
      expect(screen.queryByLabelText('Engagement')).toBeNull();
    });

    it('lists only the selected client engagements as code and title, without UUIDs', () => {
      renderDialog();
      const select = screen.getByLabelText('Engagement') as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        'No engagement',
        'ENG-000404 · Annual GST retainer',
      ]);
      expect(select.value).toBe('');
      expect(select.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });

    it('resets the selection and swaps options when the client changes', () => {
      renderDialog();
      const select = screen.getByLabelText('Engagement') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: '50000000-0000-4000-a000-000000000001' } });
      expect(select.value).toBe('50000000-0000-4000-a000-000000000001');

      fireEvent.change(screen.getByLabelText(/Client Entity/i), {
        target: { value: '10000000-0000-4000-a000-000000000002' },
      });
      expect(select.value).toBe('');
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        'No engagement',
        'ENG-000405 · Statutory audit',
      ]);
    });

    it('submits the selected engagementId', async () => {
      const { container, onCreateAssignment } = renderDialog();
      fireEvent.change(screen.getByLabelText('Engagement'), {
        target: { value: '50000000-0000-4000-a000-000000000001' },
      });
      fillAndSubmit(container);
      await waitFor(() => expect(onCreateAssignment).toHaveBeenCalledTimes(1));
      expect(onCreateAssignment.mock.calls[0]![0].engagementId).toBe(
        '50000000-0000-4000-a000-000000000001',
      );
    });

    it('omits engagementId when none is selected', async () => {
      const { container, onCreateAssignment } = renderDialog();
      fillAndSubmit(container);
      await waitFor(() => expect(onCreateAssignment).toHaveBeenCalledTimes(1));
      expect('engagementId' in onCreateAssignment.mock.calls[0]![0]).toBe(false);
    });

    it('disables the select with a hint when the client has no active engagement', () => {
      renderDialog({ engagements: [] });
      expect((screen.getByLabelText('Engagement') as HTMLSelectElement).disabled).toBe(true);
      expect(screen.getByText('This client has no active engagement.')).toBeDefined();
    });

    it('shows the optional hint when the client has engagements', () => {
      renderDialog();
      expect(
        screen.getByText('Optional. Links this work to the agreed scope and fee. Cannot be changed later.'),
      ).toBeDefined();
    });

    it('shows the unavailable hint when engagements could not be loaded', () => {
      renderDialog({ engagements: [], engagementsUnavailable: true });
      expect(
        screen.getByText('Engagements could not be loaded. You can still create the assignment without one.'),
      ).toBeDefined();
    });

    it('shows a loading hint and disables the select while engagements load', () => {
      renderDialog({ engagementsLoading: true });
      expect(screen.getByText('Loading engagements…')).toBeDefined();
      expect(screen.queryByText('This client has no active engagement.')).toBeNull();
      expect((screen.getByLabelText('Engagement') as HTMLSelectElement).disabled).toBe(true);
    });

    it('uses the Assignment Title label and the one-off description', () => {
      renderDialog();
      expect(screen.getByLabelText(/Assignment Title/i)).toBeDefined();
      expect(screen.queryByText(/Engagement Title/i)).toBeNull();
      expect(
        screen.getByText('Create a one-off assignment with an owner, reviewer and due date.'),
      ).toBeDefined();
    });
  });
});
