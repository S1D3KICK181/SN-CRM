import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ASSIGNMENT_STATUSES,
  WORK_ITEM_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  WORK_ITEM_TRANSITIONS,
  type AssignmentDto,
  type WorkItemDto,
  type CreateAssignmentInput,
  type CreateRecurringScheduleInput,
} from './index';

describe('Contracts Single Status Truth & Runtime Tuples', () => {
  it('exports ASSIGNMENT_STATUSES matching exactly 8 PostgreSQL enum states', () => {
    expect(ASSIGNMENT_STATUSES).toHaveLength(8);
    expect(ASSIGNMENT_STATUSES).toEqual([
      'draft',
      'assigned',
      'in_progress',
      'ready_for_review',
      'changes_requested',
      'approved',
      'closed',
      'cancelled',
    ]);
  });

  it('exports WORK_ITEM_STATUSES matching exactly 7 PostgreSQL enum states', () => {
    expect(WORK_ITEM_STATUSES).toHaveLength(7);
    expect(WORK_ITEM_STATUSES).toEqual([
      'todo',
      'in_progress',
      'blocked',
      'ready_for_review',
      'changes_requested',
      'completed',
      'cancelled',
    ]);
  });

  it('exports ASSIGNMENT_TRANSITIONS matching active 5 transitions', () => {
    expect(ASSIGNMENT_TRANSITIONS).toHaveLength(5);
    expect(ASSIGNMENT_TRANSITIONS).toEqual([
      'start',
      'submit',
      'complete',
      'request_changes',
      'reopen',
    ]);
  });

  it('exports WORK_ITEM_TRANSITIONS matching active 5 transitions', () => {
    expect(WORK_ITEM_TRANSITIONS).toHaveLength(5);
    expect(WORK_ITEM_TRANSITIONS).toEqual([
      'start',
      'submit',
      'complete',
      'request_changes',
      'reopen',
    ]);
  });

  it('verifies DTO and Input type shapes at compile time', () => {
    expectTypeOf<WorkItemDto>().toHaveProperty('code').toBeString();
    expectTypeOf<AssignmentDto>().toHaveProperty('serviceId').toBeString();
    expectTypeOf<CreateAssignmentInput>().not.toHaveProperty('clientName');
    expectTypeOf<CreateRecurringScheduleInput>().not.toHaveProperty('clientName');
  });
});
