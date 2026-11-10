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
});
