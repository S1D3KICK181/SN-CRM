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
  describe('AssignmentRow canonical lifecycle tracking', () => {
    it('tracks initial "open" / "assigned" stage truthfully', () => {
      const row: Partial<AssignmentRow> = {
        status: 'Awaiting documents',
        progress: 15,
      };

      const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
      expect(milestones).toHaveLength(4);
      expect(milestones[0]!.label).toBe('Assigned');
      expect(milestones[0]!.isDone).toBe(true);

      expect(milestones[1]!.label).toBe('In progress');
      expect(milestones[1]!.isDone).toBe(false);

      expect(milestones[2]!.label).toBe('Ready for review');
      expect(milestones[2]!.isDone).toBe(false);

      expect(milestones[3]!.label).toBe('Approved / Closed');
      expect(milestones[3]!.isDone).toBe(false);
    });

    it('tracks "in progress" stage truthfully', () => {
      const row: Partial<AssignmentRow> = {
        status: 'In progress',
        progress: 50,
      };

      const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
      expect(milestones[0]!.isDone).toBe(true);
      expect(milestones[1]!.isDone).toBe(true);
      expect(milestones[1]!.statusLabel).toBe('In progress');
      expect(milestones[2]!.isDone).toBe(false);
      expect(milestones[3]!.isDone).toBe(false);
    });

    it('tracks "ready for review" / "pending review" stage truthfully', () => {
      const row: Partial<AssignmentRow> = {
        status: 'Pending review',
        progress: 80,
      };

      const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
      expect(milestones[0]!.isDone).toBe(true);
      expect(milestones[1]!.isDone).toBe(true);
      expect(milestones[2]!.isDone).toBe(true);
      expect(milestones[2]!.statusLabel).toBe('Ready for review');
      expect(milestones[3]!.isDone).toBe(false);
    });

    it('tracks "changes requested" with accessible warning state on review node', () => {
      const row: Partial<AssignmentRow> = {
        status: 'Changes requested',
        progress: 60,
      };

      const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
      expect(milestones[0]!.isDone).toBe(true);
      expect(milestones[1]!.isDone).toBe(true);
      expect(milestones[2]!.isDone).toBe(false);
      expect(milestones[2]!.isWarning).toBe(true);
      expect(milestones[2]!.statusLabel).toBe('Changes requested');
      expect(milestones[3]!.isDone).toBe(false);
    });

    it('tracks "approved" or "closed" terminal lifecycle as all done', () => {
      const row: Partial<AssignmentRow> = {
        status: 'Approved',
        progress: 100,
      };

      const milestones = deriveCadenceMilestones({ item: row as AssignmentRow });
      expect(milestones.every((m) => m.isDone)).toBe(true);
      expect(milestones[3]!.statusLabel).toBe('Approved');

      render(<CadenceTracker item={row as AssignmentRow} />);
      const group = screen.getByRole('group');
      expect(group.getAttribute('aria-label')).toContain('Lifecycle stage: Assigned: Assigned, In progress: Completed, Ready for review: Reviewed, Approved / Closed: Approved');
    });

    it('renders accessible screen-reader text matching aria-label', () => {
      const row: Partial<AssignmentRow> = {
        status: 'In progress',
      };

      const { container } = render(<CadenceTracker item={row as AssignmentRow} />);
      const srOnly = container.querySelector('.sr-only');
      expect(srOnly?.textContent).toBe('Lifecycle stage: Assigned: Assigned, In progress: In progress, Ready for review: Pending, Approved / Closed: Pending');
    });
  });

  describe('RecurringScheduleRecord mode (without linked assignment)', () => {
    it('renders neutral Active schedule status and next run date', () => {
      const schedule: Partial<RecurringScheduleRecord> = {
        status: 'Active',
        nextRunDate: '01/12/2026',
      };

      const milestones = deriveCadenceMilestones({ item: schedule as RecurringScheduleRecord });
      expect(milestones).toHaveLength(2);
      expect(milestones[0]!.label).toBe('Schedule');
      expect(milestones[0]!.statusLabel).toBe('Active');
      expect(milestones[0]!.isDone).toBe(true);
      expect(milestones[0]!.isExempt).toBe(false);

      expect(milestones[1]!.label).toBe('Next Run');
      expect(milestones[1]!.statusLabel).toBe('01/12/2026');
      expect(milestones[1]!.isDone).toBe(false);

      render(<CadenceTracker item={schedule as RecurringScheduleRecord} />);
      const group = screen.getByRole('group');
      expect(group.getAttribute('aria-label')).toBe('Schedule status: Schedule: Active, Next Run: 01/12/2026');
    });

    it('renders neutral Paused schedule status with exempt node', () => {
      const schedule: Partial<RecurringScheduleRecord> = {
        status: 'Paused',
        nextRunDate: '—',
      };

      const milestones = deriveCadenceMilestones({ item: schedule as RecurringScheduleRecord });
      expect(milestones[0]!.label).toBe('Schedule');
      expect(milestones[0]!.statusLabel).toBe('Paused');
      expect(milestones[0]!.isExempt).toBe(true);
      expect(milestones[0]!.isDone).toBe(false);

      expect(milestones[1]!.statusLabel).toBe('Pending');
    });

    it('tracks linked assignment lifecycle when provided alongside schedule', () => {
      const schedule: Partial<RecurringScheduleRecord> = {
        status: 'Active',
        nextRunDate: '01/12/2026',
      };
      const linkedAssignment: Partial<AssignmentRow> = {
        status: 'Pending review',
        progress: 80,
      };

      const milestones = deriveCadenceMilestones({
        item: schedule as RecurringScheduleRecord,
        linkedAssignment: linkedAssignment as AssignmentRow,
      });

      // Tracking linked assignment lifecycle instead of schedule fallback
      expect(milestones).toHaveLength(4);
      expect(milestones[0]!.label).toBe('Assigned');
      expect(milestones[2]!.label).toBe('Ready for review');
      expect(milestones[2]!.isDone).toBe(true);
    });
  });
});
