// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CadenceTracker, deriveCadenceMilestones } from './cadence-tracker';
import type { AssignmentRow, RecurringScheduleRecord } from '../../data';

afterEach(() => {
  cleanup();
});

describe('CadenceTracker & deriveCadenceMilestones', () => {
  it('correctly identifies bank exemption when bankStatementRequired is false', () => {
    const row: Partial<AssignmentRow> = {
      bankStatementRequired: false,
      bankRecStatus: 'Not applicable',
      status: 'In progress',
      progress: 50,
    };

    const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
    expect(milestones[0]!.id).toBe('bank_rec');
    expect(milestones[0]!.isExempt).toBe(true);
    expect(milestones[0]!.statusLabel).toBe('Exempt');

    render(<CadenceTracker item={row as AssignmentRow} />);
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toContain('Bank Rec: Exempt');
    expect(screen.getByLabelText('Bank Rec: Exempt')).toBeTruthy();
  });

  it('truthfully marks completed milestones for a filed / approved statutory return', () => {
    const schedule: Partial<RecurringScheduleRecord> = {
      currentStatus: 'Filed',
      status: 'Active',
      bankRecStatus: 'Completed',
    };

    const milestones = deriveCadenceMilestones({ item: schedule as RecurringScheduleRecord });
    expect(milestones.every((m) => m.isDone)).toBe(true);
    expect(milestones[3]!.statusLabel).toBe('Filed');

    render(<CadenceTracker item={schedule as RecurringScheduleRecord} />);
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toContain('Portal Filing: Filed');
    expect(group.getAttribute('aria-label')).toContain('Bank Rec: Reconciled');
  });

  it('renders screen reader fallback text with identical accessibility label', () => {
    const row: Partial<AssignmentRow> = {
      bankStatementRequired: true,
      bankRecStatus: 'Awaited',
      status: 'Awaiting documents',
      progress: 15,
    };

    const { container } = render(<CadenceTracker item={row as AssignmentRow} />);
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe(
      'Compliance stage: Bank Rec: Awaited, Client Docs: Awaited, Computation & Review: Pending, Portal Filing: Pending',
    );
  });

  it('does not fabricate bank rec or computation completion from high progress percentage alone', () => {
    const row: Partial<AssignmentRow> = {
      bankStatementRequired: true,
      bankRecStatus: 'Awaited',
      status: 'Awaiting documents',
      progress: 95, // High percentage must not fabricate domain stages!
    };

    const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
    expect(milestones[0]!.isDone).toBe(false);
    expect(milestones[0]!.statusLabel).toBe('Awaited');
    expect(milestones[1]!.isDone).toBe(false);
    expect(milestones[1]!.statusLabel).toBe('Awaited');
    expect(milestones[2]!.isDone).toBe(false);
    expect(milestones[3]!.isDone).toBe(false);
  });

  it('honors acknowledgment ARN as proof of portal filing', () => {
    const schedule: Partial<RecurringScheduleRecord> = {
      status: 'Active',
      currentStatus: 'Ready to File',
      bankRecStatus: 'Completed',
    };

    const milestones = deriveCadenceMilestones({
      item: schedule as RecurringScheduleRecord,
      arn: 'AA271026001923M',
    });
    expect(milestones[3]!.isDone).toBe(true);
    expect(milestones[3]!.statusLabel).toBe('Filed');
  });

  it('keeps generic active work (in progress, assigned, open) as documents Pending', () => {
    const statuses = ['In progress', 'assigned', 'Scheduled', 'Open'];
    for (const status of statuses) {
      const milestones = deriveCadenceMilestones({
        status,
        progress: 60,
      });
      const docMilestone = milestones.find((m) => m.id === 'client_docs');
      expect(docMilestone?.isDone).toBe(false);
      expect(docMilestone?.isWarning).toBe(false);
      expect(docMilestone?.statusLabel).toBe('Pending');
    }
  });

  it('truthfully marks documents Received from explicit downstream evidence', () => {
    // 1. Ready for review
    const m1 = deriveCadenceMilestones({ status: 'Ready for review' });
    expect(m1.find((m) => m.id === 'client_docs')?.statusLabel).toBe('Received');
    expect(m1.find((m) => m.id === 'client_docs')?.isDone).toBe(true);

    // 2. Ready to file currentStatus
    const m2 = deriveCadenceMilestones({ currentStatus: 'Ready to File' });
    expect(m2.find((m) => m.id === 'client_docs')?.statusLabel).toBe('Received');
    expect(m2.find((m) => m.id === 'client_docs')?.isDone).toBe(true);

    // 3. Filed / Approved
    const m3 = deriveCadenceMilestones({ status: 'Approved' });
    expect(m3.find((m) => m.id === 'client_docs')?.statusLabel).toBe('Received');
    expect(m3.find((m) => m.id === 'client_docs')?.isDone).toBe(true);

    // 4. ARN present
    const m4 = deriveCadenceMilestones({ status: 'In progress', arn: 'ARN-12345' });
    expect(m4.find((m) => m.id === 'client_docs')?.statusLabel).toBe('Received');
    expect(m4.find((m) => m.id === 'client_docs')?.isDone).toBe(true);

    // 5. Explicit Docs Awaited is a warning
    const m5 = deriveCadenceMilestones({ currentStatus: 'Docs Awaited' });
    expect(m5.find((m) => m.id === 'client_docs')?.statusLabel).toBe('Awaited');
    expect(m5.find((m) => m.id === 'client_docs')?.isWarning).toBe(true);
  });

  it('renders distinct accessible glyph nodes with accessible names distinguishable in grayscale', () => {
    const row: Partial<AssignmentRow> = {
      bankStatementRequired: false,
      bankRecStatus: 'Not applicable',
      status: 'Ready for review',
    };

    render(<CadenceTracker item={row as AssignmentRow} />);

    // Exempt node accessible
    expect(screen.getByLabelText('Bank Rec: Exempt')).toBeTruthy();
    // Received node accessible (Client Docs)
    expect(screen.getByLabelText('Client Docs: Received')).toBeTruthy();
    // Ready node accessible (Computation & Review)
    expect(screen.getByLabelText('Computation & Review: Ready')).toBeTruthy();
    // Pending node accessible (Portal Filing)
    expect(screen.getByLabelText('Portal Filing: Ready')).toBeTruthy();
  });
});
