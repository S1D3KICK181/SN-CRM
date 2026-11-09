// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClientDto, CreateClientInput, ReportingLineDto } from '@sn/contracts';
import { CreateClientDialog } from './create-client-dialog';
import { ClientOperationError } from '../../api/clients-types';
import { DeterministicTestTeamDirectoryAdapter } from '../../api/test-team-directory-adapter';
import { TeamDirectoryOperationError } from '../../api/team-directory-types';

afterEach(() => {
  cleanup();
});

const SAMPLE_CREATED_CLIENT: ClientDto = {
  id: '90000000-0000-4000-a000-000000000099',
  code: 'CL-001099',
  displayName: 'Zenith Global Advisory',
  legalName: 'Zenith Global Advisory LLP',
  panMasked: '******1234',
  gstinMasked: '27**********1Z5',
  email: 'tax@zenithadvisory.local',
  phone: '+91 98111 22334',
  relationshipOwnerId: null,
  relationshipOwnerName: null,
  status: 'active',
  notes: 'Priority onboarding',
  activeAssignmentsCount: 0,
  createdById: '00000000-0000-4000-a000-000000000001',
  createdAt: '2026-11-06T12:00:00.000Z',
  updatedAt: '2026-11-06T12:00:00.000Z',
};

describe('CreateClientDialog', () => {
  it('does not render when isOpen is false', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={false} onClose={onClose} onSubmit={onSubmit} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders accessible dialog connected with aria-labelledby and aria-describedby', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('create-client-dialog-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('create-client-dialog-description');

    expect(screen.getByText('Add client')).toBeTruthy();
    expect(
      screen.getByText('Create a verified client entity in the practice directory with statutory identifiers.')
    ).toBeTruthy();

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    expect(displayNameInput).toBeTruthy();
    expect(document.activeElement).toBe(displayNameInput);
  });

  it('calls onClose when close icon, cancel button, backdrop, or Escape key is pressed', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    // Close button (X)
    fireEvent.click(screen.getByLabelText('Close dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Cancel button
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    // Backdrop click
    const backdrop = screen.getByTestId('create-client-backdrop');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(3);

    // Clicking inside dialog container does NOT trigger onClose
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('traps Tab and Shift+Tab navigation within dialog elements', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByLabelText('Close dialog');
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    // Focus first focusable element (close button) and press Shift+Tab -> loops to last (submit button)
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submitBtn);

    // Focus last focusable element (submit button) and press Tab -> loops to first (close button)
    submitBtn.focus();
    expect(document.activeElement).toBe(submitBtn);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('validates display name bounds and focuses it on submit failure', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const submitBtn = screen.getByTestId('create-client-submit-btn');
    fireEvent.click(submitBtn);

    expect(onSubmit).not.toHaveBeenCalled();
    const displayNameInput = screen.getByLabelText(/Display name \*/);
    expect(displayNameInput.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(displayNameInput);
    expect(screen.getByText('Display name is required.')).toBeTruthy();

    // 1-character display name
    fireEvent.change(displayNameInput, { target: { value: 'A' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Display name must be between 2 and 180 characters.')).toBeTruthy();

    // > 180 chars
    fireEvent.change(displayNameInput, { target: { value: 'A'.repeat(181) } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Display name must be between 2 and 180 characters.')).toBeTruthy();
  });

  it('validates legal name bounds', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const legalNameInput = screen.getByLabelText(/Legal registered name/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    fireEvent.change(displayNameInput, { target: { value: 'Valid Company' } });
    fireEvent.change(legalNameInput, { target: { value: 'L'.repeat(201) } });
    fireEvent.click(submitBtn);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Legal name must not exceed 200 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(legalNameInput);
  });

  it('validates PAN, GSTIN, and cross-matching between PAN and GSTIN', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const panInput = screen.getByLabelText(/Income tax PAN/);
    const gstinInput = screen.getByLabelText(/GSTIN/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    fireEvent.change(displayNameInput, { target: { value: 'Valid Company' } });

    // Invalid PAN format
    fireEvent.change(panInput, { target: { value: 'INVALIDPAN' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid Indian PAN format/)).toBeTruthy();
    expect(document.activeElement).toBe(panInput);

    // Valid PAN, but invalid GSTIN format
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } });
    fireEvent.change(gstinInput, { target: { value: 'INVALIDGSTIN' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Invalid Indian GSTIN format/)).toBeTruthy();
    expect(document.activeElement).toBe(gstinInput);

    // Valid GSTIN format but mismatched PAN component (characters 3-12)
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } });
    fireEvent.change(gstinInput, { target: { value: '27XYZAB9999K1Z5' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/GSTIN characters 3–12 must match the provided PAN/)).toBeTruthy();
  });

  it('enforces exact server Zod email parity: rejects double-dots and leading dots', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const emailInput = screen.getByLabelText(/Primary email/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    fireEvent.change(displayNameInput, { target: { value: 'Valid Company' } });

    // Server-invalid double-dot email
    fireEvent.change(emailInput, { target: { value: 'a..b@example.com' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid email address format.')).toBeTruthy();
    expect(document.activeElement).toBe(emailInput);

    // Server-invalid leading dot email
    fireEvent.change(emailInput, { target: { value: '.invalid@example.com' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Invalid email address format.')).toBeTruthy();

    // Normal valid address passes validation
    fireEvent.change(emailInput, { target: { value: 'accounts.tax+work@example.com' } });
    onSubmit.mockResolvedValueOnce(SAMPLE_CREATED_CLIENT);
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('validates phone and notes bounds', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const phoneInput = screen.getByLabelText(/Phone/);
    const notesInput = screen.getByLabelText(/Notes and special instructions/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    fireEvent.change(displayNameInput, { target: { value: 'Valid Company' } });

    // Short phone (< 7 chars)
    fireEvent.change(phoneInput, { target: { value: '123' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Phone number must be between 7 and 20 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(phoneInput);

    // Long phone (> 20 chars)
    fireEvent.change(phoneInput, { target: { value: '123456789012345678901' } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Phone number must be between 7 and 20 characters.')).toBeTruthy();

    // Notes > 2000 chars
    fireEvent.change(phoneInput, { target: { value: '+91 98111 22334' } });
    fireEvent.change(notesInput, { target: { value: 'N'.repeat(2001) } });
    fireEvent.click(submitBtn);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Notes must not exceed 2000 characters.')).toBeTruthy();
    expect(document.activeElement).toBe(notesInput);
  });

  it('submits sanitized payload and locks duplicate submission via direct form submit events', async () => {
    const onClose = vi.fn();
    let resolveSubmit!: (c: ClientDto) => void;
    const submitPromise = new Promise<ClientDto>((resolve) => {
      resolveSubmit = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(submitPromise);

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const legalNameInput = screen.getByLabelText(/Legal registered name/);
    const panInput = screen.getByLabelText(/Income tax PAN/);
    const gstinInput = screen.getByLabelText(/GSTIN/);
    const emailInput = screen.getByLabelText(/Primary email/);
    const phoneInput = screen.getByLabelText(/Phone/);
    const notesInput = screen.getByLabelText(/Notes and special instructions/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    const closeBtn = screen.getByLabelText('Close dialog');
    const form = submitBtn.closest('form')!;

    fireEvent.change(displayNameInput, { target: { value: '  Zenith Global Advisory  ' } });
    fireEvent.change(legalNameInput, { target: { value: '  Zenith Global Advisory LLP  ' } });
    fireEvent.change(panInput, { target: { value: 'abcde1234f' } });
    fireEvent.change(gstinInput, { target: { value: '27abcde1234f1z5' } });
    fireEvent.change(emailInput, { target: { value: '  tax@zenithadvisory.local  ' } });
    fireEvent.change(phoneInput, { target: { value: '  +91 98111 22334  ' } });
    fireEvent.change(notesInput, { target: { value: '  Priority onboarding  ' } });

    // Submit via form submit event
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      displayName: 'Zenith Global Advisory',
      legalName: 'Zenith Global Advisory LLP',
      pan: 'ABCDE1234F',
      gstin: '27ABCDE1234F1Z5',
      email: 'tax@zenithadvisory.local',
      phone: '+91 98111 22334',
      relationshipOwnerId: null,
      notes: 'Priority onboarding',
    });

    // While submitting: controls are disabled and text indicates progress
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
    expect(submitBtn.textContent).toContain('Creating…');
    expect(cancelBtn.hasAttribute('disabled')).toBe(true);
    expect(closeBtn.hasAttribute('disabled')).toBe(true);

    // Backdrop click and Escape are ignored while submitting
    const backdrop = screen.getByTestId('create-client-backdrop');
    fireEvent.click(backdrop);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    // Direct duplicate form submission while pending is locked and ignored
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Resolve submission
    resolveSubmit(SAMPLE_CREATED_CLIENT);
  });

  it('sanitizes malicious error reflecting raw tax IDs across message, requestId, serverCode, and cause, and preserves inputs for retry', async () => {
    const onClose = vi.fn();
    const maliciousRawError = new ClientOperationError({
      code: 'conflict',
      status: 409,
      serverCode: '27ABCDE1234F1Z5',
      requestId: 'ABCDE1234F',
      message: 'Client with PAN ABCDE1234F and GSTIN 27ABCDE1234F1Z5 is already registered by owner.',
      cause: new Error('Reflected raw tax identifiers: ABCDE1234F / 27ABCDE1234F1Z5'),
    });
    const onSubmit = vi.fn().mockRejectedValue(maliciousRawError);

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const panInput = screen.getByLabelText(/Income tax PAN/);
    const gstinInput = screen.getByLabelText(/GSTIN/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    fireEvent.change(displayNameInput, { target: { value: 'Conflicting Entity' } });
    fireEvent.change(panInput, { target: { value: 'ABCDE1234F' } });
    fireEvent.change(gstinInput, { target: { value: '27ABCDE1234F1Z5' } });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('create-client-server-error')).toBeTruthy();
    });

    const errorBanner = screen.getByTestId('create-client-server-error');

    // Safe sanitized message must be rendered
    expect(
      screen.getByText('A client record with conflicting identifiers already exists in the directory.')
    ).toBeTruthy();

    // Raw tax ID passed as requestId was stripped; support reference is NOT rendered with raw PAN
    expect(screen.queryByText(/Support reference:/)).toBeNull();

    // ADVERSARIAL PRIVACY CHECK:
    // The rendered error alert banner must NEVER contain the raw reflected PAN or GSTIN
    expect(errorBanner.textContent).not.toContain('ABCDE1234F');
    expect(errorBanner.textContent).not.toContain('27ABCDE1234F1Z5');

    // Inputs preserved for user correction
    expect((displayNameInput as HTMLInputElement).value).toBe('Conflicting Entity');
    expect((panInput as HTMLInputElement).value).toBe('ABCDE1234F');
    expect((gstinInput as HTMLInputElement).value).toBe('27ABCDE1234F1Z5');

    // Controls re-enabled
    expect(submitBtn.hasAttribute('disabled')).toBe(false);
    expect(submitBtn.textContent).toContain('Create client');

    // Can close after failure
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders legitimate support reference in error banner while preserving input', async () => {
    const onClose = vi.fn();
    const legitError = new ClientOperationError({
      code: 'conflict',
      status: 409,
      serverCode: 'client_code_conflict',
      requestId: 'req_adversarial_789',
      message: 'Conflict occurred reflecting ABCDE1234F',
      cause: new Error('Reflected ABCDE1234F'),
    });
    const onSubmit = vi.fn().mockRejectedValue(legitError);

    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    fireEvent.change(displayNameInput, { target: { value: 'Retry Entity' } });

    fireEvent.click(screen.getByTestId('create-client-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-client-server-error')).toBeTruthy();
    });

    const errorBanner = screen.getByTestId('create-client-server-error');
    expect(screen.getByText('Support reference: req_adversarial_789')).toBeTruthy();
    expect(errorBanner.textContent).not.toContain('ABCDE1234F');
  });

  it('renders unambiguous field-label-text and field-error-text classes and inherited dialog-layer backdrop', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />);

    // Backdrop carries both dialog-layer and create-client-dialog-layer
    const backdrop = screen.getByTestId('create-client-backdrop');
    expect(backdrop.classList.contains('dialog-layer')).toBe(true);
    expect(backdrop.classList.contains('create-client-dialog-layer')).toBe(true);

    // All field labels carry field-label-text and NOT field-error-text
    const labelSpans = document.querySelectorAll('.create-client-dialog .field-label-text');
    expect(labelSpans.length).toBeGreaterThanOrEqual(7);
    labelSpans.forEach((span) => {
      expect(span.classList.contains('field-error-text')).toBe(false);
      expect(span.textContent).toBeTruthy();
    });

    // Trigger validation errors
    const submitBtn = screen.getByTestId('create-client-submit-btn');
    fireEvent.click(submitBtn);

    // Error text spans carry field-error-text and NOT field-label-text
    const errorSpans = document.querySelectorAll('.create-client-dialog .field-error-text');
    expect(errorSpans.length).toBeGreaterThanOrEqual(1);
    errorSpans.forEach((span) => {
      expect(span.classList.contains('field-label-text')).toBe(false);
      expect(span.getAttribute('role')).toBe('alert');
    });
  });

  it('guards against async state updates if dialog is unmounted while create is in-flight', async () => {
    let resolveSubmit!: (c: ClientDto) => void;
    const submitPromise = new Promise<ClientDto>((resolve) => {
      resolveSubmit = resolve;
    });
    const onSubmit = vi.fn().mockReturnValue(submitPromise);
    const onClose = vi.fn();

    const { unmount } = render(
      <CreateClientDialog isOpen={true} onClose={onClose} onSubmit={onSubmit} />
    );

    const displayNameInput = screen.getByLabelText(/Display name \*/);
    const submitBtn = screen.getByTestId('create-client-submit-btn');

    fireEvent.change(displayNameInput, { target: { value: 'Unmounting Entity' } });
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    // Unmount while promise is pending (simulating role-switch or modal dismissal)
    unmount();

    // Resolve deferred submission - must complete cleanly without setting unmounted state
    expect(() => {
      resolveSubmit(SAMPLE_CREATED_CLIENT);
    }).not.toThrow();
  });

  describe('relationship-owner selection from live team directory', () => {
    const lineFounder: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000001',
        name: 'S. Narayanan',
        role: 'founder',
        reportsToId: null,
      },
      manager: null,
    };
    const lineManager: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000002',
        name: 'Ananya Rao',
        role: 'manager',
        reportsToId: '00000000-0000-4000-a000-000000000001',
      },
      manager: {
        id: '00000000-0000-4000-a000-000000000001',
        name: 'S. Narayanan',
        role: 'founder',
        reportsToId: null,
      },
    };
    const lineSeniorStaff: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000003',
        name: 'Priya Desai',
        role: 'senior_staff',
        reportsToId: '00000000-0000-4000-a000-000000000002',
      },
      manager: {
        id: '00000000-0000-4000-a000-000000000002',
        name: 'Ananya Rao',
        role: 'manager',
        reportsToId: '00000000-0000-4000-a000-000000000001',
      },
    };
    const lineStaff: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000004',
        name: 'Rohan Mehta',
        role: 'staff',
        reportsToId: '00000000-0000-4000-a000-000000000002',
      },
      manager: {
        id: '00000000-0000-4000-a000-000000000002',
        name: 'Ananya Rao',
        role: 'manager',
        reportsToId: '00000000-0000-4000-a000-000000000001',
      },
    };
    const lineTrainee: ReportingLineDto = {
      employee: {
        id: '00000000-0000-4000-a000-000000000005',
        name: 'Neha Kapoor',
        role: 'trainee',
        reportsToId: '00000000-0000-4000-a000-000000000002',
      },
      manager: {
        id: '00000000-0000-4000-a000-000000000002',
        name: 'Ananya Rao',
        role: 'manager',
        reportsToId: '00000000-0000-4000-a000-000000000001',
      },
    };

    const standardTeamLines = [
      lineFounder,
      lineManager,
      lineSeniorStaff,
      lineStaff,
      lineTrainee,
    ];

    it('defaults relationship owner select to Unassigned and sends relationshipOwnerId: null', async () => {
      const onSubmit = vi.fn().mockResolvedValue(SAMPLE_CREATED_CLIENT);
      const onClose = vi.fn();

      render(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={standardTeamLines}
        />
      );

      const select = screen.getByLabelText(/Client Relationship Owner/i) as HTMLSelectElement;
      expect(select.value).toBe('');

      // Fill required display name and submit
      const displayNameInput = screen.getByLabelText(/Display name \*/);
      fireEvent.change(displayNameInput, { target: { value: 'Acme Advisory' } });

      const submitBtn = screen.getByTestId('create-client-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const payload = onSubmit.mock.calls[0]![0] as CreateClientInput;
      expect(payload.displayName).toBe('Acme Advisory');
      expect(payload.relationshipOwnerId).toBeNull();
    });

    it('populates eligible employees excluding trainees and formats label with name and role', () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={standardTeamLines}
        />
      );

      const select = screen.getByLabelText(/Client Relationship Owner/i) as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll('option'));

      // Check values and text
      expect(options[0]?.value).toBe('');
      expect(options[0]?.textContent).toBe('(Unassigned)');

      const optionTexts = options.map((opt) => opt.textContent);
      expect(optionTexts).toContain('Ananya Rao (Manager)');
      expect(optionTexts).toContain('Priya Desai (Senior Staff)');
      expect(optionTexts).toContain('Rohan Mehta (Staff)');
      expect(optionTexts).toContain('S. Narayanan (Founder)');

      // Trainee is strictly excluded from relationship owner choices
      expect(optionTexts).not.toContain('Neha Kapoor (Trainee)');
      expect(options.some((opt) => opt.value === lineTrainee.employee.id)).toBe(false);

      // Email addresses must never be exposed in option text
      options.forEach((opt) => {
        expect(opt.textContent).not.toContain('@');
      });
    });

    it('submits selected relationshipOwnerId UUID when chosen from dropdown', async () => {
      const onSubmit = vi.fn().mockResolvedValue(SAMPLE_CREATED_CLIENT);
      const onClose = vi.fn();

      render(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={standardTeamLines}
        />
      );

      const select = screen.getByLabelText(/Client Relationship Owner/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: lineManager.employee.id } });
      expect(select.value).toBe(lineManager.employee.id);

      const displayNameInput = screen.getByLabelText(/Display name \*/);
      fireEvent.change(displayNameInput, { target: { value: 'Delta Logistics' } });

      const submitBtn = screen.getByTestId('create-client-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      const payload = onSubmit.mock.calls[0]![0] as CreateClientInput;
      expect(payload.displayName).toBe('Delta Logistics');
      expect(payload.relationshipOwnerId).toBe(lineManager.employee.id);
    });

    it('preserves selected relationshipOwnerId when creation fails on server', async () => {
      const serverError = new ClientOperationError({
        code: 'conflict',
        status: 409,
        message: 'A client with this identifier already exists.',
      });
      const onSubmit = vi.fn().mockRejectedValue(serverError);
      const onClose = vi.fn();

      render(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={standardTeamLines}
        />
      );

      const select = screen.getByLabelText(/Client Relationship Owner/i) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: lineSeniorStaff.employee.id } });

      const displayNameInput = screen.getByLabelText(/Display name \*/);
      fireEvent.change(displayNameInput, { target: { value: 'Conflict Client' } });

      const submitBtn = screen.getByTestId('create-client-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('create-client-server-error')).toBeTruthy();
      });

      // Inputs preserved including relationshipOwnerId
      expect((displayNameInput as HTMLInputElement).value).toBe('Conflict Client');
      expect(select.value).toBe(lineSeniorStaff.employee.id);
    });

    it('handles team directory loading and error state without blocking submission and allows retry', async () => {
      const onRetryTeam = vi.fn();
      const onSubmit = vi.fn().mockResolvedValue(null);
      const onClose = vi.fn();

      const { rerender } = render(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={[]}
          teamLoading={true}
        />
      );

      expect(screen.getByText('Loading practice team…')).toBeTruthy();

      // Form submission can still occur with (Unassigned) while loading
      const displayNameInput = screen.getByLabelText(/Display name \*/);
      fireEvent.change(displayNameInput, { target: { value: 'Epsilon Tech' } });
      const submitBtn = screen.getByTestId('create-client-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });

      // Rerender with error state
      rerender(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={[]}
          teamLoading={false}
          teamError={
            new TeamDirectoryOperationError({
              code: 'network',
              message: 'Failed to load team list',
            })
          }
          onRetryTeam={onRetryTeam}
        />
      );

      expect(screen.getByText(/Unable to load team list\./)).toBeTruthy();
      const retryBtn = screen.getByRole('button', { name: 'Retry' });
      expect(retryBtn).toBeTruthy();

      fireEvent.click(retryBtn);
      expect(onRetryTeam).toHaveBeenCalledTimes(1);
    });

    it('fetches reporting lines through teamPort when reportingLines prop is not provided', async () => {
      const port = new DeterministicTestTeamDirectoryAdapter();
      port.setReportingLinesResponse('founder', [lineFounder, lineStaff]);

      const onSubmit = vi.fn();
      const onClose = vi.fn();

      render(
        <CreateClientDialog
          isOpen={true}
          role="founder"
          teamPort={port}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );

      const select = screen.getByLabelText(/Client Relationship Owner/i) as HTMLSelectElement;

      await waitFor(() => {
        const options = Array.from(select.querySelectorAll('option'));
        expect(options.some((opt) => opt.value === lineStaff.employee.id)).toBe(true);
      });

      const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(optionTexts).toContain('Rohan Mehta (Staff)');
      expect(optionTexts).toContain('S. Narayanan (Founder)');
    });

    it('displays exact canonical label, helper copy separating assignment ownership, and empty state with role=status', () => {
      const onSubmit = vi.fn();
      const onClose = vi.fn();

      const { rerender } = render(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={standardTeamLines}
        />
      );

      // Exact label
      expect(screen.getByText('Client Relationship Owner')).toBeTruthy();

      // Canonical helper copy
      const helper = screen.getByText(
        'Primary internal contact for the client entity. Assignment ownership remains separate.'
      );
      expect(helper).toBeTruthy();
      // Must not contain forbidden "staff member"
      expect(helper.textContent).not.toContain('staff member');

      // Empty state when no eligible employees (only trainee)
      rerender(
        <CreateClientDialog
          isOpen={true}
          onClose={onClose}
          onSubmit={onSubmit}
          reportingLines={[lineTrainee]}
        />
      );

      const emptyStatus = screen.getByText('No eligible Employees available');
      expect(emptyStatus).toBeTruthy();
      expect(emptyStatus.getAttribute('role')).toBe('status');
      expect(emptyStatus.getAttribute('aria-live')).toBe('polite');
    });
  });
});
