import { describe, expect, it } from 'vitest';
import type { WorkItemDto } from '@sn/contracts';
import type { AssignmentRow } from '../data';
import {
  deriveWorkItemViewGroups,
  formatIsoToKolkataDisplay,
  formatWorkItemDue,
  formatWorkItemTime,
  getAssignmentDisplayCode,
  getDelegationTargets,
  getEligibleDelegationTargets,
  getParentAssignmentOptions,
  mapDtoToDelegatedTaskRecord,
  mapDtoToPersonalTaskRecord,
  mapWorkItemStatusToView,
  parseDisplayDateToKolkataIso,
  resolveParentLabel,
  validateDelegatedDeadline,
} from './work-items-mapper';

const FIXED_CLOCK = new Date('2026-11-02T06:30:00.000Z'); // 12:00 PM on 02/11/2026 in Asia/Kolkata (+05:30)

const SAMPLE_ASSIGNMENT_1: AssignmentRow = {
  id: 'ASN-0001',
  title: 'October GST Return',
  client: 'Aster Foods Private Limited',
  clientId: 'CLI-0001',
  service: 'GST Compliance',
  due: '11/11/2026',
  owner: 'Priya Desai',
  reviewer: 'Ananya Rao',
  status: 'In progress',
  progress: 72,
  tone: 'default',
};

const SAMPLE_ASSIGNMENT_2: AssignmentRow = {
  id: 'ASN-0002',
  title: 'Q2 Internal Audit',
  client: 'BluePeak Technologies LLP',
  clientId: 'CLI-0002',
  service: 'Internal Audit',
  due: '06/11/2026',
  owner: 'Rohan Mehta',
  reviewer: 'Priya Desai',
  status: 'Pending review',
  progress: 84,
  tone: 'warning',
};

describe('work-items-mapper', () => {
  describe('status and tone wire mapping', () => {
    it('maps todo -> "To Do", 0%, default tone', () => {
      const view = mapWorkItemStatusToView('todo');
      expect(view).toEqual({
        status: 'To Do',
        progress: 0,
        tone: 'default',
      });
    });

    it('maps in_progress -> "In Progress", 50%, default tone', () => {
      const view = mapWorkItemStatusToView('in_progress');
      expect(view).toEqual({
        status: 'In Progress',
        progress: 50,
        tone: 'default',
      });
    });

    it('maps ready_for_review -> "Pending Review", 90%, warning tone', () => {
      const view = mapWorkItemStatusToView('ready_for_review');
      expect(view).toEqual({
        status: 'Pending Review',
        progress: 90,
        tone: 'warning',
      });
    });

    it('maps completed -> "Completed", 100%, success tone', () => {
      const view = mapWorkItemStatusToView('completed');
      expect(view).toEqual({
        status: 'Completed',
        progress: 100,
        tone: 'success',
      });
    });
  });

  describe('Asia/Kolkata (+05:30) date/time parsing and formatting', () => {
    it('correctly handles date boundary conversion at 20:00 UTC (+05:30 shifts day to next morning)', () => {
      // 20:00 UTC on 02/11/2026 is 01:30 AM on 03/11/2026 in India (+05:30)
      const utcIso = '2026-11-02T20:00:00.000Z';
      const formattedDate = formatIsoToKolkataDisplay(utcIso);
      expect(formattedDate).toBe('03/11/2026');

      // Due display relative to FIXED_CLOCK (which is 02/11/2026 noon)
      const dueLabel = formatWorkItemDue(utcIso, FIXED_CLOCK);
      expect(dueLabel).toBe('Tomorrow');

      const timeLabel = formatWorkItemTime(utcIso, FIXED_CLOCK);
      expect(timeLabel).toBe('Tomorrow · 01:30');
    });

    it('parses "Today" with default end-of-day 18:00 IST into valid UTC ISO', () => {
      const parsed = parseDisplayDateToKolkataIso('Today', FIXED_CLOCK);
      // 18:00 IST on 02/11/2026 is 12:30 UTC
      expect(parsed).toBe('2026-11-02T12:30:00.000Z');
    });

    it('parses "Tomorrow" with default end-of-day 18:00 IST into valid UTC ISO', () => {
      const parsed = parseDisplayDateToKolkataIso('Tomorrow', FIXED_CLOCK);
      // 18:00 IST on 03/11/2026 is 12:30 UTC
      expect(parsed).toBe('2026-11-03T12:30:00.000Z');
    });

    it('parses "Today · 15:30" and "Today 15:30" accurately', () => {
      const parsed = parseDisplayDateToKolkataIso('Today · 15:30', FIXED_CLOCK);
      // 15:30 IST is 10:00 UTC
      expect(parsed).toBe('2026-11-02T10:00:00.000Z');
    });

    it('parses explicit DD/MM/YYYY with optional time', () => {
      const parsedWithTime = parseDisplayDateToKolkataIso('15/11/2026 14:00', FIXED_CLOCK);
      // 14:00 IST is 08:30 UTC
      expect(parsedWithTime).toBe('2026-11-15T08:30:00.000Z');

      const parsedDateOnly = parseDisplayDateToKolkataIso('15/11/2026', FIXED_CLOCK);
      // 18:00 IST default is 12:30 UTC
      expect(parsedDateOnly).toBe('2026-11-15T12:30:00.000Z');
    });

    it('throws actionable error on invalid dates without silently changing them', () => {
      expect(() => parseDisplayDateToKolkataIso('invalid-date', FIXED_CLOCK)).toThrow(
        /Invalid date format/i,
      );
      expect(() => parseDisplayDateToKolkataIso('32/13/2026', FIXED_CLOCK)).toThrow(
        /Invalid date/i,
      );
    });

    it('treats slash, hyphen, and dot separators as DD-MM-YYYY under Indian conventions, preventing US month/day transposition', () => {
      // 05-11-2026 and 05.11.2026 must resolve to 5 November 2026 (12:30 UTC), NEVER US May 11 (2026-05-11)
      const slashResult = parseDisplayDateToKolkataIso('05/11/2026', FIXED_CLOCK);
      const hyphenResult = parseDisplayDateToKolkataIso('05-11-2026', FIXED_CLOCK);
      const dotResult = parseDisplayDateToKolkataIso('05.11.2026', FIXED_CLOCK);

      expect(slashResult).toBe('2026-11-05T12:30:00.000Z');
      expect(hyphenResult).toBe('2026-11-05T12:30:00.000Z');
      expect(dotResult).toBe('2026-11-05T12:30:00.000Z');

      // Crucial: assert it is NOT May 11
      expect(hyphenResult).not.toContain('2026-05-11');
      expect(dotResult).not.toContain('2026-05-11');
    });

    it('supports DD-MM-YYYY and DD-MM with day > 12 across slash, hyphen, and dot', () => {
      expect(parseDisplayDateToKolkataIso('25-11-2026', FIXED_CLOCK)).toBe('2026-11-25T12:30:00.000Z');
      expect(parseDisplayDateToKolkataIso('25.11.2026', FIXED_CLOCK)).toBe('2026-11-25T12:30:00.000Z');
      expect(parseDisplayDateToKolkataIso('25/11/2026', FIXED_CLOCK)).toBe('2026-11-25T12:30:00.000Z');

      // Without year (defaults to reference clock year 2026)
      expect(parseDisplayDateToKolkataIso('25-11', FIXED_CLOCK)).toBe('2026-11-25T12:30:00.000Z');
      expect(parseDisplayDateToKolkataIso('25.11', FIXED_CLOCK)).toBe('2026-11-25T12:30:00.000Z');
      expect(parseDisplayDateToKolkataIso('05-11', FIXED_CLOCK)).toBe('2026-11-05T12:30:00.000Z');
    });

    it('rejects mixed/ambiguous separators with actionable error', () => {
      expect(() => parseDisplayDateToKolkataIso('05/11-2026', FIXED_CLOCK)).toThrow(/Invalid date format/i);
      expect(() => parseDisplayDateToKolkataIso('05-11/2026', FIXED_CLOCK)).toThrow(/Invalid date format/i);
      expect(() => parseDisplayDateToKolkataIso('05.11-2026', FIXED_CLOCK)).toThrow(/Invalid date format/i);
      expect(() => parseDisplayDateToKolkataIso('05/11.2026', FIXED_CLOCK)).toThrow(/Invalid date format/i);
    });

    it('validates leap years and calendar bounds without silent coercion', () => {
      // 2026 is not a leap year -> 29/02/2026 must throw
      expect(() => parseDisplayDateToKolkataIso('29-02-2026', FIXED_CLOCK)).toThrow(/Invalid date day 29 for month 2/i);
      // 31st of April does not exist
      expect(() => parseDisplayDateToKolkataIso('31/04/2026', FIXED_CLOCK)).toThrow(/Invalid date day 31 for month 4/i);
      // Day 0
      expect(() => parseDisplayDateToKolkataIso('00/11/2026', FIXED_CLOCK)).toThrow(/Invalid date day 0/i);
      // Month 13
      expect(() => parseDisplayDateToKolkataIso('15/13/2026', FIXED_CLOCK)).toThrow(/Invalid date month: 13/i);

      // 2028 IS a leap year -> 29/02/2028 is valid
      expect(parseDisplayDateToKolkataIso('29/02/2028', FIXED_CLOCK)).toBe('2028-02-29T12:30:00.000Z');
    });

    it('accepts explicit ISO/RFC3339 timestamps and dates but rejects arbitrary browser date strings', () => {
      // Full UTC ISO
      expect(parseDisplayDateToKolkataIso('2026-11-05T12:30:00.000Z')).toBe('2026-11-05T12:30:00.000Z');
      // ISO with IST offset
      expect(parseDisplayDateToKolkataIso('2026-11-05T18:00:00+05:30')).toBe('2026-11-05T12:30:00.000Z');
      // ISO date-only
      expect(parseDisplayDateToKolkataIso('2026-11-05')).toBe('2026-11-05T12:30:00.000Z');

      // Arbitrary English / browser date strings must be rejected (no silent browser parsing)
      expect(() => parseDisplayDateToKolkataIso('Nov 5 2026', FIXED_CLOCK)).toThrow(/Invalid date format/i);
      expect(() => parseDisplayDateToKolkataIso('November 5, 2026', FIXED_CLOCK)).toThrow(/Invalid date format/i);
      expect(() => parseDisplayDateToKolkataIso('2026/11/05', FIXED_CLOCK)).toThrow(/Invalid date format/i);

      // ISO with invalid calendar date must not roll over (no silent coercion)
      expect(() => parseDisplayDateToKolkataIso('2026-02-30T10:00:00Z')).toThrow(/Invalid date/i);
    });
  });

  describe('deadline validation against parent assignment', () => {
    it('accepts subtask due on or before parent assignment due date', () => {
      const parentDue = '2026-11-11T12:30:00.000Z'; // 11/11/2026 18:00 IST
      const subtaskDueSame = '2026-11-11T12:30:00.000Z';
      const subtaskDueEarlier = '2026-11-05T12:30:00.000Z';

      expect(validateDelegatedDeadline(subtaskDueSame, parentDue)).toBeNull();
      expect(validateDelegatedDeadline(subtaskDueEarlier, parentDue)).toBeNull();
    });

    it('rejects subtask due after parent assignment with exact normalized message', () => {
      const parentDue = '2026-11-11T12:30:00.000Z'; // 11/11/2026 18:00 IST
      const subtaskDueAfter = '2026-11-12T12:30:00.000Z';

      const validationError = validateDelegatedDeadline(subtaskDueAfter, parentDue);
      expect(validationError).toBe(
        'The sub-task completion deadline cannot be later than its parent Assignment deadline (11/11/2026). Please adjust the target completion date.',
      );
    });
  });

  describe('pure selectors and dynamic parent assignment label', () => {
    const rawDelegatedDto: WorkItemDto = {
      id: 'wrk_001',
      code: 'WI-001001',
      kind: 'delegated',
      title: 'Verify purchase ledger',
      notes: 'Check tax invoices',
      assignmentId: 'ASN-0001',
      relatedClientId: 'CLI-0001',
      relatedPartyName: 'Aster Foods Private Limited',
      assigneeId: '00000000-0000-4000-a000-000000000005',
      createdById: '00000000-0000-4000-a000-000000000003',
      status: 'in_progress',
      dueAt: '2026-11-03T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    it('dynamically computes parent label when assignments list updates', () => {
      // 1. Initial render without assignment loaded
      const recordBefore = mapDtoToDelegatedTaskRecord(rawDelegatedDto, []);
      expect(recordBefore.parent).toBe('ASN-0001 · Aster Foods Private Limited');

      // 2. Render with assignment loaded
      const recordAfter = mapDtoToDelegatedTaskRecord(rawDelegatedDto, [SAMPLE_ASSIGNMENT_1]);
      expect(recordAfter.parent).toBe('ASN-0001 · October GST Return');

      // 3. Render when assignment title changes
      const updatedAssignment = { ...SAMPLE_ASSIGNMENT_1, title: 'October GST Return (Final)' };
      const recordUpdated = mapDtoToDelegatedTaskRecord(rawDelegatedDto, [updatedAssignment]);
      expect(recordUpdated.parent).toBe('ASN-0001 · October GST Return (Final)');
    });

    it('derives stable IDs and view properties on DelegatedTaskRecord', () => {
      const record = mapDtoToDelegatedTaskRecord(rawDelegatedDto, [SAMPLE_ASSIGNMENT_1]);
      expect(record.id).toBe('wrk_001');
      expect(record.code).toBe('WI-001001');
      expect(record.parentAssignmentId).toBe('ASN-0001');
      expect(record.assigneeId).toBe('00000000-0000-4000-a000-000000000005');
      expect(record.createdById).toBe('00000000-0000-4000-a000-000000000003');
      expect(record.person).toBe('Neha Kapoor');
      expect(record.assignedBy).toBe('Ananya Rao');
      expect(record.status).toBe('In Progress');
      expect(record.progress).toBe(50);
      expect(record.tone).toBe('default');
    });

    it('derives PersonalTaskRecord with correct context and done state', () => {
      const rawPersonalPending: WorkItemDto = {
        id: 'wrk_p01',
        code: 'WI-001002',
        kind: 'personal',
        title: 'Call auditor',
        notes: null,
        assignmentId: null,
        relatedClientId: null,
        relatedPartyName: 'Aster Foods',
        assigneeId: '00000000-0000-4000-a000-000000000004',
        createdById: '00000000-0000-4000-a000-000000000004',
        status: 'todo',
        dueAt: '2026-11-02T10:00:00.000Z',
        reminderAt: null,
        createdAt: '2026-11-01T04:00:00.000Z',
        updatedAt: '2026-11-01T04:00:00.000Z',
      };

      const recordPending = mapDtoToPersonalTaskRecord(rawPersonalPending, 'staff', FIXED_CLOCK);
      expect(recordPending.done).toBe(false);
      expect(recordPending.code).toBe('WI-001002');
      expect(recordPending.context).toBe('Aster Foods');
      expect(recordPending.ownerRole).toBe('staff');

      const rawPersonalDone: WorkItemDto = {
        ...rawPersonalPending,
        status: 'completed',
      };
      const recordDone = mapDtoToPersonalTaskRecord(rawPersonalDone, 'staff', FIXED_CLOCK);
      expect(recordDone.done).toBe(true);
    });
  });

  describe('role view groups derived by actor IDs', () => {
    const itemAssignedToSenior: WorkItemDto = {
      id: 'wrk_s1',
      code: 'WI-001001',
      kind: 'delegated',
      title: 'Review balance sheet',
      notes: null,
      assignmentId: 'ASN-0002',
      relatedClientId: 'CLI-0002',
      relatedPartyName: 'BluePeak',
      assigneeId: '00000000-0000-4000-a000-000000000003',
      createdById: '00000000-0000-4000-a000-000000000002',
      status: 'ready_for_review',
      dueAt: '2026-11-04T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    const itemDelegatedBySeniorToStaff: WorkItemDto = {
      id: 'wrk_s2',
      code: 'WI-001002',
      kind: 'delegated',
      title: 'Draft tax audit annexures',
      notes: null,
      assignmentId: 'ASN-0001',
      relatedClientId: 'CLI-0001',
      relatedPartyName: 'Aster Foods',
      assigneeId: '00000000-0000-4000-a000-000000000004',
      createdById: '00000000-0000-4000-a000-000000000003',
      status: 'ready_for_review',
      dueAt: '2026-11-05T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    const itemDelegatedByManagerToStaff: WorkItemDto = {
      id: 'wrk_s3',
      code: 'WI-001003',
      kind: 'delegated',
      title: 'Vouch invoices',
      notes: null,
      assignmentId: 'ASN-0002',
      relatedClientId: 'CLI-0002',
      relatedPartyName: 'BluePeak',
      assigneeId: '00000000-0000-4000-a000-000000000004',
      createdById: '00000000-0000-4000-a000-000000000002',
      status: 'ready_for_review',
      dueAt: '2026-11-05T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    const seniorPersonal: WorkItemDto = {
      id: 'wrk_p_senior',
      code: 'WI-001004',
      kind: 'personal',
      title: 'Senior private reminder',
      notes: null,
      assignmentId: null,
      relatedClientId: null,
      relatedPartyName: 'Personal',
      assigneeId: '00000000-0000-4000-a000-000000000003',
      createdById: '00000000-0000-4000-a000-000000000003',
      status: 'todo',
      dueAt: '2026-11-02T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    const staffPersonal: WorkItemDto = {
      id: 'wrk_p_staff',
      code: 'WI-001005',
      kind: 'personal',
      title: 'Staff private note',
      notes: null,
      assignmentId: null,
      relatedClientId: null,
      relatedPartyName: 'Personal',
      assigneeId: '00000000-0000-4000-a000-000000000004',
      createdById: '00000000-0000-4000-a000-000000000004',
      status: 'todo',
      dueAt: '2026-11-02T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    const allDtos = [
      itemAssignedToSenior,
      itemDelegatedBySeniorToStaff,
      itemDelegatedByManagerToStaff,
      seniorPersonal,
      staffPersonal,
    ];

    it('senior staff sees assignedToMe, delegatedByMe, and only reviewable items they created', () => {
      const groups = deriveWorkItemViewGroups(allDtos, [SAMPLE_ASSIGNMENT_1, SAMPLE_ASSIGNMENT_2], 'senior_staff');

      expect(groups.personalTasks.map((t) => t.id)).toEqual(['wrk_p_senior']);
      expect(groups.assignedToMe.map((t) => t.id)).toEqual(['wrk_s1']);
      expect(groups.delegatedByMe.map((t) => t.id)).toEqual(['wrk_s2']);
      // Reviewable: Senior created wrk_s2, but NOT wrk_s3 (created by manager)
      expect(groups.reviewableTasks.map((t) => t.id)).toEqual(['wrk_s2']);
      // visibleDelegatedWork for senior staff is delegatedByMe
      expect(groups.visibleDelegatedWork.map((t) => t.id)).toEqual(['wrk_s2']);
    });

    it('founder sees all reviewable items and all delegated items returned by server', () => {
      const groups = deriveWorkItemViewGroups(allDtos, [SAMPLE_ASSIGNMENT_1, SAMPLE_ASSIGNMENT_2], 'founder');

      expect(groups.personalTasks).toHaveLength(0); // None for founder in this list
      expect(groups.reviewableTasks.map((t) => t.id)).toEqual(['wrk_s1', 'wrk_s2', 'wrk_s3']);
      expect(groups.visibleDelegatedWork.map((t) => t.id)).toEqual(['wrk_s1', 'wrk_s2', 'wrk_s3']);
    });

    it('trainee has zero reviewable tasks and no delegatedByMe tasks', () => {
      const groups = deriveWorkItemViewGroups(allDtos, [SAMPLE_ASSIGNMENT_1, SAMPLE_ASSIGNMENT_2], 'trainee');
      expect(groups.reviewableTasks).toHaveLength(0);
      expect(groups.delegatedByMe).toHaveLength(0);
      expect(groups.visibleDelegatedWork).toHaveLength(0);
    });
  });

  describe('hierarchy options', () => {
    it('returns strict target hierarchy for delegation', () => {
      expect(getDelegationTargets('founder').map((t) => t.role)).toEqual([
        'manager',
        'senior_staff',
        'staff',
        'trainee',
      ]);
      expect(getDelegationTargets('manager').map((t) => t.role)).toEqual([
        'senior_staff',
        'staff',
        'trainee',
      ]);
      expect(getDelegationTargets('senior_staff').map((t) => t.role)).toEqual(['staff', 'trainee']);
      expect(getDelegationTargets('staff').map((t) => t.role)).toEqual(['trainee']);
      expect(getDelegationTargets('trainee')).toEqual([]);
    });

    it('returns canonical UUIDs and correct persona names for delegation targets', () => {
      const targets = getDelegationTargets('founder');
      expect(targets).toEqual([
        { id: '00000000-0000-4000-a000-000000000002', name: 'Priya Desai', role: 'manager', label: 'Priya Desai — Manager' },
        { id: '00000000-0000-4000-a000-000000000003', name: 'Ananya Rao', role: 'senior_staff', label: 'Ananya Rao — Senior Staff' },
        { id: '00000000-0000-4000-a000-000000000004', name: 'Rohan Mehta', role: 'staff', label: 'Rohan Mehta — Staff' },
        { id: '00000000-0000-4000-a000-000000000005', name: 'Neha Kapoor', role: 'trainee', label: 'Neha Kapoor — Trainee' },
      ]);
    });

    it('returns parent assignment options filtered by role authority', () => {
      const assignments = [SAMPLE_ASSIGNMENT_1, SAMPLE_ASSIGNMENT_2];

      // Founder & Manager see all
      expect(getParentAssignmentOptions('founder', assignments)).toEqual(assignments);
      expect(getParentAssignmentOptions('manager', assignments)).toEqual(assignments);

      // Senior staff (Ananya Rao): reviews ASN-0001 -> sees ASN-0001
      expect(getParentAssignmentOptions('senior_staff', assignments)).toEqual([SAMPLE_ASSIGNMENT_1]);

      // Staff (Rohan Mehta): owns ASN-0002 -> sees only ASN-0002
      expect(getParentAssignmentOptions('staff', assignments)).toEqual([SAMPLE_ASSIGNMENT_2]);

      // Trainee: none
      expect(getParentAssignmentOptions('trainee', assignments)).toEqual([]);
    });
  });

  describe('Slice 1C: Internal Office Task Mapping and View Grouping', () => {
    const internalDto: WorkItemDto = {
      id: 'wrk_int_01',
      code: 'WI-001006',
      kind: 'internal',
      title: 'File November purchase bills in the blue cardboard file',
      notes: 'Cabinet A, shelf 2',
      assignmentId: null,
      relatedClientId: null,
      relatedPartyName: null,
      assigneeId: '00000000-0000-4000-a000-000000000004',
      createdById: '00000000-0000-4000-a000-000000000002',
      status: 'todo',
      dueAt: '2026-11-03T12:30:00.000Z',
      reminderAt: null,
      createdAt: '2026-11-02T04:00:00.000Z',
      updatedAt: '2026-11-02T04:00:00.000Z',
    };

    it('maps internal WorkItemDto to DelegatedTaskRecord with kind="internal", parent="Internal Office Work", and parentAssignmentId=undefined (no "General" fallback)', () => {
      const record = mapDtoToDelegatedTaskRecord(internalDto, [SAMPLE_ASSIGNMENT_1]);
      expect(record.kind).toBe('internal');
      expect(record.parent).toBe('Internal Office Work');
      expect(record.parentAssignmentId).toBeUndefined();
      expect(record.instructions).toBe('Cabinet A, shelf 2');
      expect(record.status).toBe('To Do');
    });

    it('routes internal task to assignedToMe when assigneeId matches current actor', () => {
      const groups = deriveWorkItemViewGroups([internalDto], [SAMPLE_ASSIGNMENT_1], 'staff');
      expect(groups.assignedToMe.map((t) => t.id)).toEqual(['wrk_int_01']);
      expect(groups.assignedToMe[0]?.parent).toBe('Internal Office Work');
      expect(groups.assignedToMe[0]?.kind).toBe('internal');
    });

    it('routes internal task to delegatedByMe when createdById matches current actor', () => {
      const groups = deriveWorkItemViewGroups([internalDto], [SAMPLE_ASSIGNMENT_1], 'manager');
      expect(groups.delegatedByMe.map((t) => t.id)).toEqual(['wrk_int_01']);
      expect(groups.delegatedByMe[0]?.parent).toBe('Internal Office Work');
      expect(groups.delegatedByMe[0]?.kind).toBe('internal');
    });

    it('routes ready_for_review internal task to reviewableTasks for leadership (founder/manager) regardless of creator', () => {
      const readyInternal: WorkItemDto = {
        ...internalDto,
        id: 'wrk_int_ready',
        code: 'WI-001007',
        status: 'ready_for_review',
        createdById: '00000000-0000-4000-a000-000000000003',
      };
      const founderGroups = deriveWorkItemViewGroups([readyInternal], [], 'founder');
      const managerGroups = deriveWorkItemViewGroups([readyInternal], [], 'manager');
      expect(founderGroups.reviewableTasks.map((t) => t.id)).toEqual(['wrk_int_ready']);
      expect(founderGroups.visibleDelegatedWork.map((t) => t.id)).toEqual(['wrk_int_ready']);
      expect(managerGroups.reviewableTasks.map((t) => t.id)).toEqual(['wrk_int_ready']);
    });

    it('routes ready_for_review internal task to reviewableTasks for Senior Staff or Staff ONLY when they are the creator', () => {
      const seniorCreated: WorkItemDto = {
        ...internalDto,
        id: 'wrk_senior_cr',
        code: 'WI-001008',
        status: 'ready_for_review',
        createdById: '00000000-0000-4000-a000-000000000003',
        assigneeId: '00000000-0000-4000-a000-000000000004',
      };
      const managerCreated: WorkItemDto = {
        ...internalDto,
        id: 'wrk_mgr_cr',
        code: 'WI-001009',
        status: 'ready_for_review',
        createdById: '00000000-0000-4000-a000-000000000002',
        assigneeId: '00000000-0000-4000-a000-000000000004',
      };

      // Senior staff created wrk_senior_cr, but did NOT create wrk_mgr_cr
      const seniorGroups = deriveWorkItemViewGroups([seniorCreated, managerCreated], [], 'senior_staff');
      expect(seniorGroups.reviewableTasks.map((t) => t.id)).toEqual(['wrk_senior_cr']);
      expect(seniorGroups.visibleDelegatedWork.map((t) => t.id)).toEqual(['wrk_senior_cr']);

      // Staff created neither -> 0 reviewable
      const staffGroups = deriveWorkItemViewGroups([seniorCreated, managerCreated], [], 'staff');
      expect(staffGroups.reviewableTasks).toHaveLength(0);
    });

    it('isolates trainee: trainee sees assigned internal tasks in assignedToMe, but has zero reviewableTasks or visibleDelegatedWork', () => {
      const traineeAssigned: WorkItemDto = {
        ...internalDto,
        id: 'wrk_trainee_int',
        code: 'WI-001010',
        assigneeId: '00000000-0000-4000-a000-000000000005',
        createdById: '00000000-0000-4000-a000-000000000004',
        status: 'ready_for_review',
      };
      const traineeGroups = deriveWorkItemViewGroups([traineeAssigned], [], 'trainee');
      expect(traineeGroups.assignedToMe.map((t) => t.id)).toEqual(['wrk_trainee_int']);
      expect(traineeGroups.reviewableTasks).toHaveLength(0);
      expect(traineeGroups.visibleDelegatedWork).toHaveLength(0);
      expect(traineeGroups.delegatedByMe).toHaveLength(0);
    });
  });

  describe('Live Eligible Delegation Targets & Real Employee Name Mapping', () => {
    const liveLines = [
      {
        employee: { id: 'emp_founder', name: 'S. Narayanan', role: 'founder' as const, reportsToId: null },
        manager: null,
      },
      {
        employee: { id: 'emp_mgr', name: 'Priya Desai', role: 'manager' as const, reportsToId: 'emp_founder' },
        manager: { id: 'emp_founder', name: 'S. Narayanan', role: 'founder' as const, reportsToId: null },
      },
      {
        employee: { id: 'emp_snr', name: 'Ananya Rao', role: 'senior_staff' as const, reportsToId: 'emp_mgr' },
        manager: { id: 'emp_mgr', name: 'Priya Desai', role: 'manager' as const, reportsToId: 'emp_founder' },
      },
      {
        employee: { id: 'emp_stf', name: 'Rohan Mehta', role: 'staff' as const, reportsToId: 'emp_mgr' },
        manager: { id: 'emp_mgr', name: 'Priya Desai', role: 'manager' as const, reportsToId: 'emp_founder' },
      },
      {
        employee: { id: 'emp_trn', name: 'Neha Kapoor', role: 'trainee' as const, reportsToId: 'emp_stf' },
        manager: { id: 'emp_stf', name: 'Rohan Mehta', role: 'staff' as const, reportsToId: 'emp_mgr' },
      },
    ];

    it('filters live targets by strict role authority, excludes self, and sorts deterministically by name', () => {
      // Senior Staff can delegate to Staff and Trainee; excludes self (emp_snr)
      const seniorTargets = getEligibleDelegationTargets(
        { id: 'emp_snr', role: 'senior_staff' },
        liveLines,
      );
      expect(seniorTargets.map((t) => t.name)).toEqual(['Neha Kapoor', 'Rohan Mehta']);
      expect(seniorTargets.map((t) => t.id)).toEqual(['emp_trn', 'emp_stf']);

      // Staff can delegate ONLY to Trainee; excludes self (emp_stf)
      const staffTargets = getEligibleDelegationTargets(
        { id: 'emp_stf', role: 'staff' },
        liveLines,
      );
      expect(staffTargets.map((t) => t.name)).toEqual(['Neha Kapoor']);
      expect(staffTargets.map((t) => t.id)).toEqual(['emp_trn']);

      // Trainee cannot delegate to anyone
      const traineeTargets = getEligibleDelegationTargets(
        { id: 'emp_trn', role: 'trainee' },
        liveLines,
      );
      expect(traineeTargets).toEqual([]);

      // Manager can delegate to Senior Staff, Staff, Trainee; excludes self (emp_mgr)
      const managerTargets = getEligibleDelegationTargets(
        { id: 'emp_mgr', role: 'manager' },
        liveLines,
      );
      expect(managerTargets.map((t) => t.name)).toEqual(['Ananya Rao', 'Neha Kapoor', 'Rohan Mehta']);
    });

    it('resolves live employee names dynamically via employeeNameMap', () => {
      const nameMap = new Map<string, string>([
        ['emp_stf', 'Rohan Mehta (Live)'],
        ['emp_snr', 'Ananya Rao (Live)'],
      ]);

      const liveDto: WorkItemDto = {
        id: 'wrk_live_01',
        code: 'WI-002001',
        kind: 'delegated',
        title: 'Live GST cross-check',
        notes: null,
        assignmentId: 'ASN-0001',
        relatedClientId: 'cli_01',
        relatedPartyName: 'Aster Foods',
        assigneeId: 'emp_stf',
        createdById: 'emp_snr',
        status: 'todo',
        dueAt: '2026-11-04T12:30:00.000Z',
        reminderAt: null,
        createdAt: '2026-11-01T04:00:00.000Z',
        updatedAt: '2026-11-01T04:00:00.000Z',
      };

      const record = mapDtoToDelegatedTaskRecord(
        liveDto,
        [SAMPLE_ASSIGNMENT_1],
        'staff',
        undefined,
        nameMap,
      );

      expect(record.person).toBe('Rohan Mehta (Live)');
      expect(record.assignedBy).toBe('Ananya Rao (Live)');
    });

    it('excludes self by both id and case-insensitive name in getEligibleDelegationTargets', () => {
      // Exclude by name only
      const targetsByName = getEligibleDelegationTargets(
        { name: 'rohan mehta', role: 'staff' },
        liveLines,
      );
      expect(targetsByName.some((t) => t.name.toLowerCase() === 'rohan mehta')).toBe(false);
      expect(targetsByName.map((t) => t.name)).toEqual(['Neha Kapoor']);

      // Exclude by ID only
      const targetsById = getEligibleDelegationTargets(
        { id: 'emp_stf', role: 'staff' },
        liveLines,
      );
      expect(targetsById.some((t) => t.id === 'emp_stf')).toBe(false);
      expect(targetsById.map((t) => t.id)).toEqual(['emp_trn']);
    });

    it('filters parent assignments by currentActor.name in live mode', () => {
      const allAssignments: AssignmentRow[] = [
        SAMPLE_ASSIGNMENT_1, // owner: Priya Desai, reviewer: Ananya Rao
        SAMPLE_ASSIGNMENT_2, // owner: Rohan Mehta, reviewer: Priya Desai
        {
          id: 'ASN-0003',
          title: 'Special Tax Audit',
          client: 'Omega Corp',
          clientId: 'CLI-0003',
          service: 'Tax Audit',
          due: '15/11/2026',
          owner: 'Suresh Kumar',
          reviewer: 'Vikram Singh',
          status: 'In progress',
          progress: 10,
          tone: 'default',
        },
      ];

      // Staff (Rohan Mehta) sees only assignments where he is owner or reviewer
      const staffOptions = getParentAssignmentOptions('staff', allAssignments, {
        name: 'rohan mehta',
      });
      expect(staffOptions.map((a) => a.id)).toEqual(['ASN-0002']);

      // Senior Staff (Priya Desai) is owner of ASN-0001 and reviewer of ASN-0002
      const seniorOptions = getParentAssignmentOptions('senior_staff', allAssignments, {
        name: 'Priya Desai',
      });
      expect(seniorOptions.map((a) => a.id)).toEqual(['ASN-0001', 'ASN-0002']);

      // Leadership (Founder / Manager) sees all assignments
      const founderOptions = getParentAssignmentOptions('founder', allAssignments, {
        name: 'Aarav Mehta',
      });
      expect(founderOptions.length).toBe(3);

      // Trainee sees zero parent assignment options
      const traineeOptions = getParentAssignmentOptions('trainee', allAssignments, {
        name: 'Neha Kapoor',
      });
      expect(traineeOptions).toEqual([]);
    });
  });

  describe('assignment display identity and UUID leak prevention', () => {
    const REAL_UUID_1 = '30000000-0000-4000-a000-000000000001';
    const REAL_UUID_UNLISTED = '30000000-0000-4000-a000-000000000099';
    const CLIENT_UUID = '10000000-0000-4000-a000-000000000001';

    const liveAssignmentWithCode: AssignmentRow = {
      id: REAL_UUID_1,
      code: 'ASN-000123',
      title: 'October GSTR-1 & 3B Filing',
      client: 'Aster Foods Private Limited',
      clientId: CLIENT_UUID,
      service: 'GST Compliance',
      due: '11/11/2026',
      owner: 'Rohan Mehta',
      status: 'In progress',
      progress: 50,
      tone: 'default',
    };

    const liveAssignmentWithoutCode: AssignmentRow = {
      id: '30000000-0000-4000-a000-000000000002',
      title: 'Statutory Audit FY 2025-26',
      client: 'Northstar Exports',
      clientId: '10000000-0000-4000-a000-000000000002',
      service: 'Statutory Audit',
      due: '24/11/2026',
      owner: 'Priya Desai',
      status: 'In progress',
      progress: 20,
      tone: 'default',
    };

    it('getAssignmentDisplayCode prefers code, then non-UUID id, and never returns a UUID', () => {
      expect(getAssignmentDisplayCode(liveAssignmentWithCode)).toBe('ASN-000123');
      expect(getAssignmentDisplayCode(SAMPLE_ASSIGNMENT_1)).toBe('ASN-0001');
      expect(getAssignmentDisplayCode(liveAssignmentWithoutCode)).toBe('Linked Assignment');
      expect(getAssignmentDisplayCode(liveAssignmentWithoutCode)).not.toContain('30000000-0000-4000-a000');
    });

    it('resolveParentLabel renders human code and title, never exposing raw UUID', () => {
      const parentWithCode = resolveParentLabel(REAL_UUID_1, [liveAssignmentWithCode], 'Aster Foods');
      expect(parentWithCode).toBe('ASN-000123 · October GSTR-1 & 3B Filing');
      expect(parentWithCode).not.toContain(REAL_UUID_1);

      const parentDemo = resolveParentLabel('ASN-0001', [SAMPLE_ASSIGNMENT_1], null);
      expect(parentDemo).toBe('ASN-0001 · October GST Return');

      const parentWithoutCode = resolveParentLabel(
        '30000000-0000-4000-a000-000000000002',
        [liveAssignmentWithoutCode],
        'Northstar Exports',
      );
      expect(parentWithoutCode).toBe('Statutory Audit FY 2025-26 (Northstar Exports)');
      expect(parentWithoutCode).not.toContain('30000000-0000-4000-a000-000000000002');
    });

    it('resolveParentLabel protects unlisted assignment IDs with safe copy and never echoes UUID', () => {
      const parentUnlistedWithParty = resolveParentLabel(REAL_UUID_UNLISTED, [liveAssignmentWithCode], 'Kedia Holdings');
      expect(parentUnlistedWithParty).toBe('Linked Assignment · Kedia Holdings');
      expect(parentUnlistedWithParty).not.toContain(REAL_UUID_UNLISTED);

      const parentUnlistedNoParty = resolveParentLabel(REAL_UUID_UNLISTED, [liveAssignmentWithCode], null);
      expect(parentUnlistedNoParty).toBe('Linked Assignment');
      expect(parentUnlistedNoParty).not.toContain(REAL_UUID_UNLISTED);
    });

    it('mapDtoToDelegatedTaskRecord produces parent label without UUID', () => {
      const dto: WorkItemDto = {
        id: 'wrk_uuid_test',
        code: 'WI-000999',
        kind: 'delegated',
        title: 'Verify purchase registers',
        notes: null,
        assignmentId: REAL_UUID_1,
        relatedClientId: CLIENT_UUID,
        relatedPartyName: 'Aster Foods Private Limited',
        assigneeId: '00000000-0000-4000-a000-000000000004',
        createdById: '00000000-0000-4000-a000-000000000001',
        status: 'todo',
        dueAt: '2026-11-10T12:30:00.000Z',
        reminderAt: null,
        createdAt: '2026-11-09T04:00:00.000Z',
        updatedAt: '2026-11-09T04:00:00.000Z',
      };

      const record = mapDtoToDelegatedTaskRecord(dto, [liveAssignmentWithCode]);
      expect(record.parent).toBe('ASN-000123 · October GSTR-1 & 3B Filing');
      expect(record.parent).not.toContain(REAL_UUID_1);
      expect(record.parent).not.toContain(CLIENT_UUID);
    });

    it('mapDtoToPersonalTaskRecord derives human context and never leaks raw assignment or client UUID', () => {
      // 1. Linked to loaded assignment with human code
      const dtoWithLoadedAsn: WorkItemDto = {
        id: 'wrk_p_loaded',
        code: 'WI-001010',
        kind: 'personal',
        title: 'Check portal status',
        notes: null,
        assignmentId: REAL_UUID_1,
        relatedClientId: null,
        relatedPartyName: null,
        assigneeId: '00000000-0000-4000-a000-000000000001',
        createdById: '00000000-0000-4000-a000-000000000001',
        status: 'todo',
        dueAt: '2026-11-09T12:30:00.000Z',
        reminderAt: null,
        createdAt: '2026-11-09T04:00:00.000Z',
        updatedAt: '2026-11-09T04:00:00.000Z',
      };
      const recordLoaded = mapDtoToPersonalTaskRecord(dtoWithLoadedAsn, 'founder', FIXED_CLOCK, [liveAssignmentWithCode]);
      expect(recordLoaded.context).toBe('ASN-000123');
      expect(recordLoaded.context).not.toContain(REAL_UUID_1);

      // 2. Linked to unlisted assignment UUID without party name
      const dtoWithUnlistedAsn: WorkItemDto = {
        ...dtoWithLoadedAsn,
        id: 'wrk_p_unlisted',
        assignmentId: REAL_UUID_UNLISTED,
      };
      const recordUnlisted = mapDtoToPersonalTaskRecord(dtoWithUnlistedAsn, 'founder', FIXED_CLOCK, [liveAssignmentWithCode]);
      expect(recordUnlisted.context).toBe('Linked Assignment');
      expect(recordUnlisted.context).not.toContain(REAL_UUID_UNLISTED);

      // 3. Only relatedClientId (UUID) present
      const dtoClientOnly: WorkItemDto = {
        ...dtoWithLoadedAsn,
        id: 'wrk_p_client',
        assignmentId: null,
        relatedClientId: CLIENT_UUID,
        relatedPartyName: null,
      };
      const recordClient = mapDtoToPersonalTaskRecord(dtoClientOnly, 'founder', FIXED_CLOCK);
      expect(recordClient.context).toBe('Client Task');
      expect(recordClient.context).not.toContain(CLIENT_UUID);

      // 4. Defensive against raw UUID in relatedPartyName
      const dtoUuidPartyName: WorkItemDto = {
        ...dtoWithLoadedAsn,
        id: 'wrk_p_uuid_party',
        assignmentId: null,
        relatedClientId: null,
        relatedPartyName: CLIENT_UUID,
      };
      const recordUuidParty = mapDtoToPersonalTaskRecord(dtoUuidPartyName, 'founder', FIXED_CLOCK);
      expect(recordUuidParty.context).toBe('Personal');
      expect(recordUuidParty.context).not.toContain(CLIENT_UUID);
    });
  });
});
