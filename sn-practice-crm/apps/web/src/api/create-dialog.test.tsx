// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ComposerDialog } from '../app';
import { CLIENTS } from '../data';

afterEach(() => {
  cleanup();
});

describe('ComposerDialog create-assignment submit lifecycle', () => {
  it('keeps dialog open and preserves entered values on creation failure, disabling button while pending and allowing retry', async () => {
    let callCount = 0;
    let resolveCreation: (value: boolean) => void = () => {};

    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      callCount++;
      return new Promise<boolean>((resolve) => {
        resolveCreation = resolve;
      });
    });

    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(
      <ComposerDialog
        mode="assignment"
        role="founder"
        clients={CLIENTS}
        invoices={[]}
        assignments={[]}
        personalTasks={[]}
        delegatedTasks={[]}
        presetInvoice={null}
        onClose={onClose}
        onCreated={onCreated}
        onClientCreated={vi.fn()}
        onInvoiceCreated={vi.fn()}
        onReceiptCreated={vi.fn()}
        onAssignmentCreated={onAssignmentCreated}
        onPersonalTaskCreated={vi.fn()}
        onDelegatedTaskCreated={vi.fn()}
      />,
    );

    // Verify dialog is open
    expect(screen.getByRole('dialog')).toBeDefined();

    // Fill in custom title and fee
    const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'My Custom Audit Engagement' } });

    const feeInput = screen.getByDisplayValue('35000') as HTMLInputElement;
    fireEvent.change(feeInput, { target: { value: '75000' } });

    const submitButton = screen.getByRole('button', { name: /Create draft/i });
    expect(submitButton).toBeDefined();
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    // Click submit: in-flight request starts
    fireEvent.click(submitButton);

    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);
    // Button is disabled while pending to prevent double-submit
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    // Attempt double click while pending: should not trigger second submit
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);

    // First attempt fails (e.g. network error / 403 Forbidden)
    await act(async () => {
      resolveCreation(false);
      await Promise.resolve();
    });

    // DIALOG MUST REMAIN OPEN on failure!
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeDefined();

    // Button is re-enabled for retry
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);

    // Entered form values remain preserved!
    expect(titleInput.value).toBe('My Custom Audit Engagement');
    expect(feeInput.value).toBe('75000');

    // User retries submission
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(2);
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    // Second attempt succeeds
    await act(async () => {
      resolveCreation(true);
      await Promise.resolve();
    });

    // DIALOG CLOSES ON SUCCESS!
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unmounts during pending submit and settles without setState or unhandled rejection', async () => {
    let resolveCreation: (value: boolean) => void = () => {};
    let rejectCreation: (reason: any) => void = () => {};

    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve, reject) => {
        resolveCreation = resolve;
        rejectCreation = reject;
      });
    });

    const onClose = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { unmount } = render(
        <ComposerDialog
          mode="assignment"
          role="founder"
          clients={CLIENTS}
          invoices={[]}
          assignments={[]}
          personalTasks={[]}
          delegatedTasks={[]}
          presetInvoice={null}
          onClose={onClose}
          onCreated={vi.fn()}
          onClientCreated={vi.fn()}
          onInvoiceCreated={vi.fn()}
          onReceiptCreated={vi.fn()}
          onAssignmentCreated={onAssignmentCreated}
          onPersonalTaskCreated={vi.fn()}
          onDelegatedTaskCreated={vi.fn()}
        />,
      );

      const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'Pending Unmount Engagement' } });

      const submitButton = screen.getByRole('button', { name: /Create draft/i });
      fireEvent.click(submitButton);

      expect(onAssignmentCreated).toHaveBeenCalledTimes(1);

      // Unmount while request is pending
      unmount();

      // Resolve after unmount: must not invoke onClose again, and must not log setState warning
      await act(async () => {
        resolveCreation(true);
        await Promise.resolve();
      });

      expect(onClose).not.toHaveBeenCalled();
      const warningLogged = consoleErrorSpy.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && /unmounted/i.test(arg)),
      );
      expect(warningLogged).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('user cancellation while pending submit settles safely without double close', async () => {
    let resolveCreation: (value: boolean) => void = () => {};

    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve) => {
        resolveCreation = resolve;
      });
    });

    const onClose = vi.fn();

    render(
      <ComposerDialog
        mode="assignment"
        role="founder"
        clients={CLIENTS}
        invoices={[]}
        assignments={[]}
        personalTasks={[]}
        delegatedTasks={[]}
        presetInvoice={null}
        onClose={onClose}
        onCreated={vi.fn()}
        onClientCreated={vi.fn()}
        onInvoiceCreated={vi.fn()}
        onReceiptCreated={vi.fn()}
        onAssignmentCreated={onAssignmentCreated}
        onPersonalTaskCreated={vi.fn()}
        onDelegatedTaskCreated={vi.fn()}
      />,
    );

    const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Pending Cancel Engagement' } });

    const submitButton = screen.getByRole('button', { name: /Create draft/i });
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);

    // User cancels via Cancel button while submit is unresolved
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalledTimes(1);

    // Later the pending request resolves with success
    await act(async () => {
      resolveCreation(true);
      await Promise.resolve();
    });

    // onClose MUST NOT be called a second time!
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exercises open -> close -> reopen lifecycle on unconditional host shape and submits successfully after reopen', async () => {
    let resolveCreation: (value: boolean) => void = () => {};
    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve) => {
        resolveCreation = resolve;
      });
    });

    const onCloseSpy = vi.fn();

    function UnconditionalHost() {
      const [dialog, setDialog] = React.useState<'assignment' | null>(null);

      return (
        <div>
          <button type="button" onClick={() => setDialog('assignment')}>
            Open Assignment
          </button>
          <ComposerDialog
            mode={dialog}
            role="founder"
            clients={CLIENTS}
            invoices={[]}
            assignments={[]}
            personalTasks={[]}
            delegatedTasks={[]}
            presetInvoice={null}
            onClose={() => {
              onCloseSpy();
              setDialog(null);
            }}
            onCreated={vi.fn()}
            onClientCreated={vi.fn()}
            onInvoiceCreated={vi.fn()}
            onReceiptCreated={vi.fn()}
            onAssignmentCreated={onAssignmentCreated}
            onPersonalTaskCreated={vi.fn()}
            onDelegatedTaskCreated={vi.fn()}
          />
        </div>
      );
    }

    render(<UnconditionalHost />);

    // Initially no dialog
    expect(screen.queryByRole('dialog')).toBeNull();

    // 1. Open dialog
    fireEvent.click(screen.getByRole('button', { name: /Open Assignment/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // 2. Close dialog via Cancel
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    // 3. Reopen dialog on the same host
    fireEvent.click(screen.getByRole('button', { name: /Open Assignment/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Reopened Engagement' } });

    const submitButton = screen.getByRole('button', { name: /Create draft/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    // 4. Submit after reopen
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);

    // First attempt on reopen fails: button must not be stuck disabled, dialog must stay open
    await act(async () => {
      resolveCreation(false);
      await Promise.resolve();
    });

    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(submitButton.disabled).toBe(false);

    // Retry submit after failure
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(2);
    expect(submitButton.disabled).toBe(true);

    // Resolve retry successfully
    await act(async () => {
      resolveCreation(true);
      await Promise.resolve();
    });

    // Dialog should have closed after successful retry (one close during reopen)
    expect(onCloseSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('operates reliably under React.StrictMode with double-effect replay', async () => {
    let resolveCreation: (value: boolean) => void = () => {};
    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve) => {
        resolveCreation = resolve;
      });
    });

    const onClose = vi.fn();

    render(
      <React.StrictMode>
        <ComposerDialog
          mode="assignment"
          role="founder"
          clients={CLIENTS}
          invoices={[]}
          assignments={[]}
          personalTasks={[]}
          delegatedTasks={[]}
          presetInvoice={null}
          onClose={onClose}
          onCreated={vi.fn()}
          onClientCreated={vi.fn()}
          onInvoiceCreated={vi.fn()}
          onReceiptCreated={vi.fn()}
          onAssignmentCreated={onAssignmentCreated}
          onPersonalTaskCreated={vi.fn()}
          onDelegatedTaskCreated={vi.fn()}
        />
      </React.StrictMode>,
    );

    expect(screen.getByRole('dialog')).toBeDefined();

    const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'StrictMode Audit Engagement' } });

    const submitButton = screen.getByRole('button', { name: /Create draft/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);

    await act(async () => {
      resolveCreation(true);
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guarantees handleClose is idempotent across escape key and click handlers', () => {
    const onClose = vi.fn();

    render(
      <ComposerDialog
        mode="assignment"
        role="founder"
        clients={CLIENTS}
        invoices={[]}
        assignments={[]}
        personalTasks={[]}
        delegatedTasks={[]}
        presetInvoice={null}
        onClose={onClose}
        onCreated={vi.fn()}
        onClientCreated={vi.fn()}
        onInvoiceCreated={vi.fn()}
        onReceiptCreated={vi.fn()}
        onAssignmentCreated={vi.fn()}
        onPersonalTaskCreated={vi.fn()}
        onDelegatedTaskCreated={vi.fn()}
      />,
    );

    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    const closeIconButton = screen.getByRole('button', { name: /Close/i });

    // Press Escape, then click Cancel, then click Close icon
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(cancelButton);
    fireEvent.click(closeIconButton);

    // Despite multiple dismiss gestures, onClose is fired exactly once
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles conditional mount host shape with React.StrictMode open -> close -> reopen -> submit cycle', async () => {
    let resolveCreation: (value: boolean) => void = () => {};
    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve) => {
        resolveCreation = resolve;
      });
    });

    const onCloseSpy = vi.fn();

    function ConditionalHost() {
      const [dialog, setDialog] = React.useState<'assignment' | null>(null);

      return (
        <React.StrictMode>
          <div>
            <button type="button" onClick={() => setDialog('assignment')}>
              Open Assignment
            </button>
            {dialog ? (
              <ComposerDialog
                key={dialog}
                mode={dialog}
                role="founder"
                clients={CLIENTS}
                invoices={[]}
                assignments={[]}
                personalTasks={[]}
                delegatedTasks={[]}
                presetInvoice={null}
                onClose={() => {
                  onCloseSpy();
                  setDialog(null);
                }}
                onCreated={vi.fn()}
                onClientCreated={vi.fn()}
                onInvoiceCreated={vi.fn()}
                onReceiptCreated={vi.fn()}
                onAssignmentCreated={onAssignmentCreated}
                onPersonalTaskCreated={vi.fn()}
                onDelegatedTaskCreated={vi.fn()}
              />
            ) : null}
          </div>
        </React.StrictMode>
      );
    }

    render(<ConditionalHost />);

    // Initially unmounted
    expect(screen.queryByRole('dialog')).toBeNull();

    // 1. Open
    fireEvent.click(screen.getByRole('button', { name: /Open Assignment/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    // 2. Close via Cancel button
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    // 3. Reopen
    fireEvent.click(screen.getByRole('button', { name: /Open Assignment/i }));
    expect(screen.getByRole('dialog')).toBeDefined();

    const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Conditional Reopen Engagement' } });

    const submitButton = screen.getByRole('button', { name: /Create draft/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    // 4. Submit after reopen
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);

    // Resolve successfully
    await act(async () => {
      resolveCreation(true);
      await Promise.resolve();
    });

    // Exactly one close for reopen session (total 2)
    expect(onCloseSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('delegated sub-task dialog preserves inputs on creation failure, disables button while pending, and closes on success', async () => {
    let resolveDelegation: (ok: boolean) => void = () => {};
    const onDelegatedTaskCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve) => {
        resolveDelegation = resolve;
      });
    });

    const onClose = vi.fn();

    render(
      <ComposerDialog
        mode="delegated"
        role="senior_staff"
        clients={CLIENTS}
        invoices={[]}
        assignments={[
          {
            id: 'ASN-0001',
            title: 'October GST return',
            client: 'Aster Foods Private Limited',
            service: 'GST Compliance',
            due: '11/11/2026',
            owner: 'Priya Desai',
            reviewer: 'Ananya Rao',
            status: 'In progress',
            progress: 70,
            tone: 'default',
          },
        ]}
        personalTasks={[]}
        delegatedTasks={[]}
        presetInvoice={null}
        onClose={onClose}
        onCreated={vi.fn()}
        onClientCreated={vi.fn()}
        onInvoiceCreated={vi.fn()}
        onReceiptCreated={vi.fn()}
        onAssignmentCreated={vi.fn()}
        onPersonalTaskCreated={vi.fn()}
        onDelegatedTaskCreated={onDelegatedTaskCreated}
      />,
    );

    expect(screen.getByRole('dialog')).toBeDefined();

    const titleInput = screen.getByPlaceholderText(/Verify portal sales totals/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Reconcile 2B invoices' } });

    const submitButton = screen.getByRole('button', { name: /Delegate task/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    // Submit
    fireEvent.click(submitButton);
    expect(onDelegatedTaskCreated).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);

    // First attempt fails (e.g. 422 deadline or 403)
    await act(async () => {
      resolveDelegation(false);
      await Promise.resolve();
    });

    // Dialog stays open, values preserved, button re-enabled
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(titleInput.value).toBe('Reconcile 2B invoices');
    expect(submitButton.disabled).toBe(false);

    // Retry
    fireEvent.click(submitButton);
    expect(onDelegatedTaskCreated).toHaveBeenCalledTimes(2);

    // Success
    await act(async () => {
      resolveDelegation(true);
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('personal task dialog preserves inputs on failure, disables button while pending, and closes on success', async () => {
    let resolvePersonal: (ok: boolean) => void = () => {};
    const onPersonalTaskCreated = vi.fn().mockImplementation(() => {
      return new Promise<boolean>((resolve) => {
        resolvePersonal = resolve;
      });
    });

    const onClose = vi.fn();

    render(
      <ComposerDialog
        mode="personal"
        role="staff"
        clients={CLIENTS}
        invoices={[]}
        assignments={[]}
        personalTasks={[]}
        delegatedTasks={[]}
        presetInvoice={null}
        onClose={onClose}
        onCreated={vi.fn()}
        onClientCreated={vi.fn()}
        onInvoiceCreated={vi.fn()}
        onReceiptCreated={vi.fn()}
        onAssignmentCreated={vi.fn()}
        onPersonalTaskCreated={onPersonalTaskCreated}
        onDelegatedTaskCreated={vi.fn()}
      />,
    );

    const titleInput = screen.getByPlaceholderText(/Call Aster Foods accountant/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Call client about TDS certificate' } });

    const submitButton = screen.getByRole('button', { name: /Schedule task/i }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);

    fireEvent.click(submitButton);
    expect(onPersonalTaskCreated).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);

    // Failure
    await act(async () => {
      resolvePersonal(false);
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(titleInput.value).toBe('Call client about TDS certificate');
    expect(submitButton.disabled).toBe(false);

    // Retry succeeds
    fireEvent.click(submitButton);
    expect(onPersonalTaskCreated).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvePersonal(true);
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('assignment dialog stays open when callback resolves undefined, preserves title and fee, enables retry, and closes once on retry success', async () => {
    let resolveCreation: (value: any) => void = () => {};
    const onAssignmentCreated = vi.fn().mockImplementation(() => {
      return new Promise<any>((resolve) => {
        resolveCreation = resolve;
      });
    });

    const onClose = vi.fn();

    render(
      <ComposerDialog
        mode="assignment"
        role="founder"
        clients={CLIENTS}
        invoices={[]}
        assignments={[]}
        personalTasks={[]}
        delegatedTasks={[]}
        presetInvoice={null}
        onClose={onClose}
        onCreated={vi.fn()}
        onClientCreated={vi.fn()}
        onInvoiceCreated={vi.fn()}
        onReceiptCreated={vi.fn()}
        onAssignmentCreated={onAssignmentCreated}
        onPersonalTaskCreated={vi.fn()}
        onDelegatedTaskCreated={vi.fn()}
      />,
    );

    const titleInput = screen.getByPlaceholderText(/Income Tax Return & Tax Audit Report/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'ITR Filing and Scrutiny' } });

    const feeInput = screen.getByDisplayValue('35000') as HTMLInputElement;
    fireEvent.change(feeInput, { target: { value: '50000' } });

    const submitButton = screen.getByRole('button', { name: /Create draft/i }) as HTMLButtonElement;
    fireEvent.click(submitButton);

    expect(onAssignmentCreated).toHaveBeenCalledTimes(1);
    expect(submitButton.disabled).toBe(true);

    // Assignment callback resolves undefined (failure/empty result from data layer)
    await act(async () => {
      resolveCreation(undefined);
      await Promise.resolve();
    });

    // DIALOG MUST STAY OPEN on undefined result!
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeDefined();

    // Entered values remain preserved
    expect(titleInput.value).toBe('ITR Filing and Scrutiny');
    expect(feeInput.value).toBe('50000');

    // Button re-enabled for retry
    expect(submitButton.disabled).toBe(false);

    // User retries submit
    fireEvent.click(submitButton);
    expect(onAssignmentCreated).toHaveBeenCalledTimes(2);
    expect(submitButton.disabled).toBe(true);

    // Retry resolves true (successful save)
    await act(async () => {
      resolveCreation(true);
      await Promise.resolve();
    });

    // Successfully closes exactly once
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('Slice 1C: ComposerDialog mode="internal" (Delegate Office Task)', () => {
    it('renders mode="internal" with title "Delegate Office Task", explanatory copy, downward-authorized assignees, and NO parent assignment selector', () => {
      const onClose = vi.fn();
      render(
        <ComposerDialog
          mode={'internal' as any}
          role="manager"
          clients={CLIENTS}
          invoices={[]}
          assignments={[]}
          personalTasks={[]}
          delegatedTasks={[]}
          presetInvoice={null}
          onClose={onClose}
          onCreated={vi.fn()}
          onClientCreated={vi.fn()}
          onInvoiceCreated={vi.fn()}
          onReceiptCreated={vi.fn()}
          onAssignmentCreated={vi.fn()}
          onPersonalTaskCreated={vi.fn()}
          onDelegatedTaskCreated={vi.fn()}
          {...({ onInternalTaskCreated: vi.fn() } as any)}
        />,
      );

      // Verify Title & Subtitle
      expect(screen.getByText('Delegate Office Task')).toBeDefined();
      expect(
        screen.getByText(/Assign non-client administrative or menial office operations within your downward authority/i),
      ).toBeDefined();

      // Fields: task title input
      const titleInput = screen.getByPlaceholderText(
        /File November purchase bills in the blue cardboard file/i,
      ) as HTMLInputElement;
      expect(titleInput).toBeDefined();
      expect(titleInput.name).toBe('title');

      // Fields: assignee select with downward targets for manager (Senior, Staff, Trainee; no Founder)
      const assigneeSelect = screen.getByRole('combobox') as HTMLSelectElement;
      expect(assigneeSelect.name).toBe('assigneeId');
      const optionTexts = Array.from(assigneeSelect.options).map((o) => o.textContent);
      expect(optionTexts.some((t) => t?.includes('Priya Desai'))).toBe(true);
      expect(optionTexts.some((t) => t?.includes('Rohan Mehta'))).toBe(true);
      expect(optionTexts.some((t) => t?.includes('Neha Kapoor'))).toBe(true);
      expect(optionTexts.some((t) => t?.includes('Narayanan'))).toBe(false);

      // Target completion date
      const dueInput = screen.getByDisplayValue('Tomorrow') as HTMLInputElement;
      expect(dueInput.name).toBe('due');

      // Instructions textarea
      const instructions = screen.getByPlaceholderText(
        /Specific filing instructions, records cabinet, or administrative steps/i,
      ) as HTMLTextAreaElement;
      expect(instructions.name).toBe('instructions');

      // ABSOLUTELY NO parent assignment selector or client selector
      expect(screen.queryByLabelText(/^Parent Assignment/i)).toBeNull();
      expect(screen.queryByLabelText(/^Client/i)).toBeNull();
      expect(document.querySelector('select[name="assignmentId"]')).toBeNull();
      expect(document.querySelector('select[name="clientId"]')).toBeNull();
    });

    it('disables submit button while pending, keeps dialog open and preserves entered values on creation failure, and closes on retry success', async () => {
      let resolveCreation: (value: boolean) => void = () => {};
      const onInternalTaskCreated = vi.fn().mockImplementation(() => {
        return new Promise<boolean>((resolve) => {
          resolveCreation = resolve;
        });
      });
      const onClose = vi.fn();

      render(
        <ComposerDialog
          mode={'internal' as any}
          role="manager"
          clients={CLIENTS}
          invoices={[]}
          assignments={[]}
          personalTasks={[]}
          delegatedTasks={[]}
          presetInvoice={null}
          onClose={onClose}
          onCreated={vi.fn()}
          onClientCreated={vi.fn()}
          onInvoiceCreated={vi.fn()}
          onReceiptCreated={vi.fn()}
          onAssignmentCreated={vi.fn()}
          onPersonalTaskCreated={vi.fn()}
          onDelegatedTaskCreated={vi.fn()}
          {...({ onInternalTaskCreated } as any)}
        />,
      );

      const titleInput = screen.getByPlaceholderText(
        /File November purchase bills in the blue cardboard file/i,
      ) as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'Archive FY25 physical vouchers' } });

      const instructions = screen.getByPlaceholderText(
        /Specific filing instructions, records cabinet, or administrative steps/i,
      ) as HTMLTextAreaElement;
      fireEvent.change(instructions, { target: { value: 'Stack in Box 12 on top shelf' } });

      const submitButton = screen.getByRole('button', { name: /Delegate task/i }) as HTMLButtonElement;
      expect(submitButton.disabled).toBe(false);

      // First submit: pending
      fireEvent.click(submitButton);
      expect(onInternalTaskCreated).toHaveBeenCalledTimes(1);
      expect(submitButton.disabled).toBe(true);

      // Failure
      await act(async () => {
        resolveCreation(false);
        await Promise.resolve();
      });

      // Dialog remains open
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(submitButton.disabled).toBe(false);

      // Values preserved
      expect(titleInput.value).toBe('Archive FY25 physical vouchers');
      expect(instructions.value).toBe('Stack in Box 12 on top shelf');

      // Retry
      fireEvent.click(submitButton);
      expect(onInternalTaskCreated).toHaveBeenCalledTimes(2);
      expect(submitButton.disabled).toBe(true);

      // Success
      await act(async () => {
        resolveCreation(true);
        await Promise.resolve();
      });

      // Closes
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
