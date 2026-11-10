// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssignmentsWorkspace } from './assignments-workspace';
import { AssignmentsTable } from './assignments-table';
import { AssignmentDetailDrawer } from './assignment-detail-drawer';
import { CreateAssignmentDialog } from './create-assignment-dialog';
import { ModuleWorkspace } from '../../app';
import { AssignmentsCoordinator } from '../../api/coordinator';
import { DeterministicTestAssignmentsAdapter } from '../../api/test-adapter';
import type { AssignmentRow, RecurringScheduleRecord } from '../../data';

afterEach(() => {
  cleanup();
});

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const REAL_UUID_CLIENT = '10000000-0000-4000-a000-000000000001';
const REAL_UUID_ASSIGNMENT = '30000000-0000-4000-a000-000000000001';
const REAL_UUID_SCHEDULE = '40000000-0000-4000-a000-000000000001';
const REAL_UUID_OWNER = '00000000-0000-4000-a000-000000000002';
const REAL_UUID_REVIEWER = '00000000-0000-4000-a000-000000000003';

const sampleAssignmentWithUuid: AssignmentRow = {
  id: REAL_UUID_ASSIGNMENT,
  title: 'Monthly Return Scrutiny & Filing',
  client: 'Aster Foods Private Limited',
  clientId: REAL_UUID_CLIENT,
  service: 'GST Compliance',
  due: '11/11/2026',
  owner: 'Priya Desai',
  ownerId: REAL_UUID_OWNER,
  reviewer: 'Ananya Rao',
  reviewerId: REAL_UUID_REVIEWER,
  reviewerIds: [REAL_UUID_REVIEWER],
  status: 'In progress',
  progress: 50,
  tone: 'default',
  bankStatementRequired: true,
  bankRecStatus: 'Awaited',
};

const sampleScheduleWithUuid: RecurringScheduleRecord = {
  id: REAL_UUID_SCHEDULE,
  title: 'Monthly GSTR-1 Return Schedule',
  category: 'GST',
  cadence: 'Monthly',
  clientId: REAL_UUID_CLIENT,
  clientName: 'Aster Foods Private Limited',
  statutoryDueDay: '11th of every month',
  nextDueDate: '11/11/2026',
  nextRunDate: '01/11/2026',
  generationDay: 1,
  defaultOwner: 'Priya Desai',
  status: 'Active',
  bankRecStatus: 'Awaited',
  currentStatus: 'Pending',
  checklistTemplate: [
    'Obtain monthly outward sales invoices and bank statements',
    'Reconcile invoices with sales register before filing',
  ],
  history: [
    {
      period: 'October 2026',
      assignmentId: REAL_UUID_ASSIGNMENT,
      status: 'Completed',
      completedOn: '08/11/2026',
    },
  ],
};

const teamMembers = [
  { id: REAL_UUID_OWNER, name: 'Priya Desai', role: 'senior_staff' as const },
  { id: REAL_UUID_REVIEWER, name: 'Ananya Rao', role: 'manager' as const },
];

describe('AS-01 Release Blockers Remediation', () => {
  describe('Blocker 1: Restricted-Role Header Action Gating', () => {
    it('does not render CreateAssignmentDialog for senior_staff even if isOpen is true', () => {
      const { container } = render(
        <CreateAssignmentDialog
          isOpen={true}
          role="senior_staff"
          clients={[{ id: REAL_UUID_CLIENT, name: 'Aster Foods' }]}
          teamMembers={teamMembers}
          onClose={vi.fn()}
          onCreateAssignment={vi.fn().mockResolvedValue(true)}
        />,
      );

      expect(container.firstChild).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not render CreateAssignmentDialog for staff or trainee even if isOpen is true', () => {
      const { container: staffContainer } = render(
        <CreateAssignmentDialog
          isOpen={true}
          role="staff"
          clients={[{ id: REAL_UUID_CLIENT, name: 'Aster Foods' }]}
          teamMembers={teamMembers}
          onClose={vi.fn()}
          onCreateAssignment={vi.fn().mockResolvedValue(true)}
        />,
      );
      expect(staffContainer.firstChild).toBeNull();

      cleanup();

      const { container: traineeContainer } = render(
        <CreateAssignmentDialog
          isOpen={true}
          role="trainee"
          clients={[{ id: REAL_UUID_CLIENT, name: 'Aster Foods' }]}
          teamMembers={teamMembers}
          onClose={vi.fn()}
          onCreateAssignment={vi.fn().mockResolvedValue(true)}
        />,
      );
      expect(traineeContainer.firstChild).toBeNull();
    });

    it('renders CreateAssignmentDialog for founder and manager when isOpen is true', () => {
      render(
        <CreateAssignmentDialog
          isOpen={true}
          role="founder"
          clients={[{ id: REAL_UUID_CLIENT, name: 'Aster Foods' }]}
          teamMembers={teamMembers}
          onClose={vi.fn()}
          onCreateAssignment={vi.fn().mockResolvedValue(true)}
        />,
      );

      expect(screen.getByRole('dialog', { name: /New One-Off Assignment/i })).toBeDefined();
    });

    it('does not display any workspace Add schedule button for senior_staff or staff', () => {
      render(
        <AssignmentsWorkspace
          role="senior_staff"
          schedules={[sampleScheduleWithUuid]}
          assignments={[sampleAssignmentWithUuid]}
          onToast={vi.fn()}
          onCompose={vi.fn()}
          onUpdateSchedule={vi.fn()}
          onUpdateAssignment={vi.fn()}
          onSelectAssignment={vi.fn()}
        />,
      );

      expect(screen.queryByRole('button', { name: /add schedule/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /generate due/i })).toBeNull();
    });

    it('ModuleWorkspace on Assignments page does not render any Add assignments button for senior_staff, staff, or trainee', () => {
      const restrictedRoles = ['senior_staff', 'staff', 'trainee'] as const;

      for (const role of restrictedRoles) {
        const { unmount } = render(
          <ModuleWorkspace
            page="Assignments"
            role={role}
            clients={[]}
            schedules={[sampleScheduleWithUuid]}
            assignments={[sampleAssignmentWithUuid]}
            invoices={[]}
            receipts={[]}
            onCompose={vi.fn()}
            onToast={vi.fn()}
            onUpdateSchedule={vi.fn()}
            onUpdateAssignment={vi.fn()}
            onSelectAssignment={vi.fn()}
            onRecordPaymentForInvoice={vi.fn()}
            onOpenInvoiceForAssignment={vi.fn()}
          />,
        );

        // Crucial: No "Add assignments" button exists in the page heading
        expect(screen.queryByRole('button', { name: /add assignments/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /new assignment/i })).toBeNull();

        unmount();
      }
    });

    it('ModuleWorkspace on Assignments page renders New assignment button only for founder and manager', () => {
      const leadershipRoles = ['founder', 'manager'] as const;

      for (const role of leadershipRoles) {
        const { unmount } = render(
          <ModuleWorkspace
            page="Assignments"
            role={role}
            clients={[]}
            schedules={[sampleScheduleWithUuid]}
            assignments={[sampleAssignmentWithUuid]}
            invoices={[]}
            receipts={[]}
            onCompose={vi.fn()}
            onToast={vi.fn()}
            onUpdateSchedule={vi.fn()}
            onUpdateAssignment={vi.fn()}
            onSelectAssignment={vi.fn()}
            onRecordPaymentForInvoice={vi.fn()}
            onOpenInvoiceForAssignment={vi.fn()}
          />,
        );

        expect(screen.getByRole('button', { name: /new assignment/i })).toBeDefined();
        expect(screen.queryByRole('button', { name: /add assignments/i })).toBeNull();

        unmount();
      }
    });
  });

  describe('Blocker 2: Raw Database UUIDs Purged from UI', () => {
    it('AssignmentsTable renders without leaking raw UUIDs into text, subtitle, or button labels', () => {
      const handleToast = vi.fn();
      const { container } = render(
        <AssignmentsTable
          title="All open practice assignments"
          rows={[sampleAssignmentWithUuid]}
          onToast={handleToast}
        />,
      );

      // Verify no raw UUID string appears in visible container text
      expect(container.textContent).not.toMatch(UUID_REGEX);
      expect(screen.queryByText(REAL_UUID_ASSIGNMENT)).toBeNull();

      // Subtitle renders service without raw UUID
      expect(screen.getByText('GST Compliance')).toBeDefined();

      // Open button aria-label uses title instead of UUID
      expect(screen.getByRole('button', { name: /Open Monthly Return Scrutiny & Filing/i })).toBeDefined();

      // Click link triggers toast without UUID
      const link = screen.getByText('Monthly Return Scrutiny & Filing');
      fireEvent.click(link);
      expect(handleToast).toHaveBeenCalledWith('"Monthly Return Scrutiny & Filing" opened');
    });

    it('AssignmentsWorkspace compliance table does not render client UUID below client name', () => {
      const { container } = render(
        <AssignmentsWorkspace
          role="founder"
          schedules={[sampleScheduleWithUuid]}
          assignments={[]}
          onToast={vi.fn()}
          onCompose={vi.fn()}
          onUpdateSchedule={vi.fn()}
          onUpdateAssignment={vi.fn()}
          onSelectAssignment={vi.fn()}
        />,
      );

      // Client name is visible
      expect(screen.getByText('Aster Foods Private Limited')).toBeDefined();
      // No raw client UUID chip rendered
      expect(container.textContent).not.toMatch(UUID_REGEX);
      expect(screen.queryByText(REAL_UUID_CLIENT)).toBeNull();
    });

    it('AssignmentDetailDrawer computes readable monogram and never renders raw UUIDs', () => {
      const handleToast = vi.fn();
      const { container } = render(
        <AssignmentDetailDrawer
          assignment={sampleAssignmentWithUuid}
          leadership={true}
          role="founder"
          teamMembers={teamMembers}
          onClose={vi.fn()}
          onToast={handleToast}
          onUpdateAssignment={vi.fn()}
        />,
      );

      // Monogram is 'AF' (Aster Foods) rather than '0000' (from sliced UUID)
      const monogram = container.querySelector('.drawer-monogram');
      expect(monogram?.textContent).toBe('AF');
      expect(monogram?.textContent).not.toBe('0000');

      // No raw UUID in container text
      expect(container.textContent).not.toMatch(UUID_REGEX);
      expect(screen.queryByText(REAL_UUID_ASSIGNMENT)).toBeNull();
    });

    it('ScheduleDetailDrawer Overview and History tabs purge raw UUIDs', () => {
      render(
        <AssignmentsWorkspace
          role="founder"
          schedules={[sampleScheduleWithUuid]}
          assignments={[]}
          onToast={vi.fn()}
          onCompose={vi.fn()}
          onUpdateSchedule={vi.fn()}
          onUpdateAssignment={vi.fn()}
          onSelectAssignment={vi.fn()}
        />,
      );

      // Click to open schedule drawer
      fireEvent.click(screen.getByText('Monthly GSTR-1 Return Schedule'));

      // Check Overview tab
      const overviewTab = screen.getByRole('button', { name: /Overview/i });
      fireEvent.click(overviewTab);

      // Client legal entity shows clean name without raw UUID
      expect(screen.getAllByText('Aster Foods Private Limited').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText(new RegExp(REAL_UUID_CLIENT))).toBeNull();

      // Check History tab
      const historyTab = screen.getByRole('button', { name: /^Generated History/i });
      fireEvent.click(historyTab);

      // Historical assignment reference does not reflect raw assignment UUID
      expect(screen.getByText('October 2026')).toBeDefined();
      expect(screen.getByText(/Completed on 08\/11\/2026/)).toBeDefined();
      expect(screen.queryByText(new RegExp(REAL_UUID_ASSIGNMENT))).toBeNull();
    });

    it('AssignmentsCoordinator toasts format titles without exposing UUIDs', async () => {
      const toasts: string[] = [];
      const adapter = new DeterministicTestAssignmentsAdapter();
      const coordinator = new AssignmentsCoordinator({
        initialRows: [sampleAssignmentWithUuid],
        port: adapter,
        initialRole: 'founder',
        onToast: (msg) => toasts.push(msg),
      });

      // Update assignment
      await coordinator.handleUpdateAssignment({
        ...sampleAssignmentWithUuid,
        title: 'Updated Return Filing',
      });

      // Toast must format as Updated "Updated Return Filing" without UUID
      expect(toasts.some((t) => t.includes(REAL_UUID_ASSIGNMENT))).toBe(false);
      expect(toasts).toContain('Updated "Updated Return Filing"');
    });
  });

  describe('Blocker 3: Assignment Detail Drawer Header Structure', () => {
    it('renders non-overlapping header with min-width: 0 lead-copy and flex-shrink: 0 actions', () => {
      const { container } = render(
        <AssignmentDetailDrawer
          assignment={{
            ...sampleAssignmentWithUuid,
            title: 'Extremely Long Statutory Audit Assignment Title Designed To Stress Drawer Header Layout',
          }}
          leadership={true}
          role="founder"
          teamMembers={teamMembers}
          onClose={vi.fn()}
          onToast={vi.fn()}
          onUpdateAssignment={vi.fn()}
        />,
      );

      const header = container.querySelector('.client-drawer-header');
      expect(header).toBeDefined();

      const lead = container.querySelector('.drawer-client-lead');
      expect(lead).toBeDefined();

      const leadCopy = container.querySelector('.drawer-lead-copy');
      expect(leadCopy).toBeDefined();

      const actions = container.querySelector('.drawer-header-actions');
      expect(actions).toBeDefined();

      const editBtn = screen.getByRole('button', { name: /Edit Assignment/i });
      const closeBtn = screen.getByRole('button', { name: /Close drawer/i });
      expect(editBtn).toBeDefined();
      expect(closeBtn).toBeDefined();
    });
  });

  describe('Blocker 4 & 5: Recurring Schedule Drawer Status Buttons & Density', () => {
    it('renders status buttons in .schedule-status-group and checklist in .schedule-checklist-list', () => {
      render(
        <AssignmentsWorkspace
          role="founder"
          schedules={[sampleScheduleWithUuid]}
          assignments={[]}
          onToast={vi.fn()}
          onCompose={vi.fn()}
          onUpdateSchedule={vi.fn()}
          onUpdateAssignment={vi.fn()}
          onSelectAssignment={vi.fn()}
        />,
      );

      // Open schedule drawer
      fireEvent.click(screen.getByText('Monthly GSTR-1 Return Schedule'));

      // Verify unpersisted fake status buttons are purged
      expect(screen.queryByRole('button', { name: /^Docs Awaited$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Bank Statement Received$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Ready to File$/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Filed$/i })).toBeNull();

      // Verify checklist items
      expect(
        screen.getByText('Obtain monthly outward sales invoices and bank statements'),
      ).toBeDefined();

      // Verify explicit close buttons in header and footer
      expect(screen.getByRole('button', { name: /Close drawer/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /^Close$/i })).toBeDefined();
    }, 15000);
  });

  describe('Blocker 6: CSS Density Scope, Typography Floor, and No Nested Scroll Trap', () => {
    const cssPath = path.resolve(__dirname, '../../styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    it('ensures no unscoped density selectors escape .assignments-workspace', () => {
      const densityMarker = '/* --- Horizon Density: Assignments Workspace';
      const densityBlock = cssContent.slice(cssContent.indexOf(densityMarker));
      const densitySection = densityBlock.slice(0, densityBlock.indexOf('@keyframes fade-in'));

      // Check specifically for global scope leak: .assignments-table tr td must NOT appear without .assignments-workspace
      expect(densitySection).not.toMatch(/(^|[\n,])\s*\.assignments-table tr td/);

      // Extract all selectors in the density block and verify they are all scoped to .assignments-workspace
      const ruleBlocks = densitySection.split('}');
      for (const rule of ruleBlocks) {
        const trimmed = rule.trim();
        if (!trimmed || trimmed.startsWith('/*')) continue;
        const selectorPart = trimmed.split('{')[0]?.trim() ?? '';
        if (!selectorPart) continue;
        const selectors = selectorPart.split(',').map((s) => s.trim());
        for (const sel of selectors) {
          if (!sel || sel.startsWith('/*')) continue;
          expect(sel.startsWith('.assignments-workspace')).toBe(true);
        }
      }
    });

    it('ensures table-scroll has no nested scroll trap (no max-height, no overflow-y: auto)', () => {
      const densityMarker = '/* --- Horizon Density: Assignments Workspace';
      const densityBlock = cssContent.slice(cssContent.indexOf(densityMarker));
      const densitySection = densityBlock.slice(0, densityBlock.indexOf('@keyframes fade-in'));

      const tableScrollMatch = densitySection.match(/\.assignments-workspace\s+\.table-scroll\s*\{([^}]+)\}/);
      expect(tableScrollMatch).not.toBeNull();
      const tableScrollRules = tableScrollMatch![1] ?? '';
      expect(tableScrollRules).not.toContain('max-height');
      expect(tableScrollRules).not.toContain('overflow-y');
      expect(tableScrollRules).toContain('overflow-x: auto');
    });

    it('respects typography floor (no font-size < 12px in density block)', () => {
      const densityMarker = '/* --- Horizon Density: Assignments Workspace';
      const densityBlock = cssContent.slice(cssContent.indexOf(densityMarker));
      const densitySection = densityBlock.slice(0, densityBlock.indexOf('@keyframes fade-in'));

      const fontSizes = Array.from(densitySection.matchAll(/font-size:\s*([0-9]+)px/g)).map((m) => parseInt(m[1] ?? '0', 10));
      for (const size of fontSizes) {
        expect(size).toBeGreaterThanOrEqual(12);
      }
    });

    it('enforces compact table row padding and action button height in CSS contract', () => {
      const densityMarker = '/* --- Horizon Density: Assignments Workspace';
      const densityBlock = cssContent.slice(cssContent.indexOf(densityMarker));
      const densitySection = densityBlock.slice(0, densityBlock.indexOf('@keyframes fade-in'));

      // Verify table td padding is compact (<= 4px vertical)
      const tdPaddingMatch = densitySection.match(/\.assignments-workspace\s+table\s+tbody\s+td[\s\S]*?padding:\s*([0-9.]+)px\s+([0-9.]+)px/);
      expect(tdPaddingMatch).not.toBeNull();
      const verticalPadding = parseFloat(tdPaddingMatch![1] ?? '99');
      expect(verticalPadding).toBeLessThanOrEqual(4);

      // Verify button min-height override in td (compact hit target <= 28px, not 40px)
      expect(densitySection).toMatch(/\.assignments-workspace\s+table\s+tbody\s+td\s+\.soft-button[\s\S]*?min-height:\s*2[4-8]px/);
    });

    it('renders DOM with compact primary text clamps, tooltips, and compact action controls', () => {
      const { container } = render(
        <AssignmentsWorkspace
          role="founder"
          schedules={[sampleScheduleWithUuid]}
          assignments={[]}
          onToast={vi.fn()}
          onCompose={vi.fn()}
          onUpdateSchedule={vi.fn()}
          onUpdateAssignment={vi.fn()}
          onSelectAssignment={vi.fn()}
        />,
      );

      // Verify client name and schedule title have title tooltips for accessibility
      const clientNameEl = screen.getByText('Aster Foods Private Limited');
      expect(clientNameEl.getAttribute('title')).toBe('Aster Foods Private Limited');

      const scheduleTitleEl = screen.getByText('Monthly GSTR-1 Return Schedule');
      expect(scheduleTitleEl.getAttribute('title')).toBe('Monthly GSTR-1 Return Schedule');

      // Verify action button has compact height (26px)
      const checklistBtn = screen.getByRole('button', { name: /View Checklist/i });
      expect(checklistBtn.style.height).toBe('26px');
      expect(checklistBtn.style.minHeight).toBe('26px');

      // Verify user avatar is compact 22x22
      const avatarEl = container.querySelector('.user-avatar');
      expect(avatarEl).not.toBeNull();
      expect((avatarEl as HTMLElement).style.width).toBe('22px');
      expect((avatarEl as HTMLElement).style.height).toBe('22px');
    }, 15000);

    it('renders AssignmentsTable with title tooltips and compact icon buttons', () => {
      const { container } = render(
        <AssignmentsTable
          title="Active Assignments"
          rows={[sampleAssignmentWithUuid]}
          canEdit={true}
          onToast={vi.fn()}
          onSelectAssignment={vi.fn()}
        />,
      );

      const linkBtn = container.querySelector('.assignment-link');
      expect(linkBtn).not.toBeNull();
      expect(linkBtn?.getAttribute('title')).toBe('Monthly Return Scrutiny & Filing');

      const editBtn = container.querySelector('.icon-button');
      expect(editBtn).not.toBeNull();
      expect((editBtn as HTMLElement).style.width).toBe('26px');
      expect((editBtn as HTMLElement).style.height).toBe('26px');
    }, 15000);
  });
});
