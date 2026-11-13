import { describe, expect, it } from 'vitest';
import {
  authorize,
  validateReportingLine,
  COMPANY_ROLES,
  type Actor,
  type CompanyRole,
  type EmployeeRef,
} from './authority';

const actor = (role: CompanyRole, id: string = role): Actor => ({ id, role });
const employee = (role: CompanyRole, id: string = role): EmployeeRef => ({ id, role });

describe('practice-level authority', () => {
  it.each(['founder', 'manager'] as const)('allows %s to create an Assignment', (role) => {
    expect(authorize({ action: 'assignment.create', actor: actor(role) })).toEqual({ allowed: true });
  });

  it.each(['senior_staff', 'staff', 'trainee'] as const)('prevents %s from creating an Assignment', (role) => {
    expect(authorize({ action: 'assignment.create', actor: actor(role) }).allowed).toBe(false);
  });

  it('prevents a Trainee from being the primary Assignment Owner', () => {
    expect(authorize({ action: 'assignment.assign', actor: actor('manager'), target: employee('trainee') })).toMatchObject({
      allowed: false,
      code: 'trainee_cannot_own_assignment',
    });
  });

  it('reserves office accounts for the Founder and Manager', () => {
    expect(authorize({ action: 'finance.manage', actor: actor('manager') }).allowed).toBe(true);
    expect(authorize({ action: 'finance.manage', actor: actor('senior_staff') }).allowed).toBe(false);
  });
});
describe('delegation', () => {
  it('allows Senior Staff to delegate owned Assignment work to Staff or Trainee', () => {
    const senior = actor('senior_staff', 'senior-1');
    expect(authorize({ action: 'task.delegate', actor: senior, assignmentOwnerId: senior.id, target: employee('staff') }).allowed).toBe(true);
    expect(authorize({ action: 'task.delegate', actor: senior, assignmentOwnerId: senior.id, target: employee('trainee') }).allowed).toBe(true);
  });

  it('prevents Senior Staff from delegating work on an unrelated Assignment', () => {
    expect(
      authorize({ action: 'task.delegate', actor: actor('senior_staff'), assignmentOwnerId: 'someone-else', target: employee('trainee') }),
    ).toMatchObject({ allowed: false, code: 'not_assignment_owner_or_reviewer' });
  });

  it('allows an explicit Senior Staff reviewer to delegate child work', () => {
    expect(
      authorize({
        action: 'task.delegate',
        actor: actor('senior_staff', 'reviewer-1'),
        assignmentOwnerId: 'owner-1',
        reviewerIds: ['reviewer-1'],
        target: employee('staff'),
      }).allowed,
    ).toBe(true);
  });

  it('allows Staff to delegate owned Assignment work only to a Trainee', () => {
    const staff = actor('staff', 'staff-1');
    expect(authorize({ action: 'task.delegate', actor: staff, assignmentOwnerId: staff.id, target: employee('trainee') }).allowed).toBe(true);
    expect(authorize({ action: 'task.delegate', actor: staff, assignmentOwnerId: staff.id, target: employee('staff') })).toMatchObject({
      allowed: false,
      code: 'invalid_delegate_role',
    });
  });

  it('prevents Trainees from delegating client or internal work', () => {
    expect(
      authorize({ action: 'task.delegate', actor: actor('trainee'), assignmentOwnerId: 'trainee', target: employee('trainee', 'other') }).allowed,
    ).toBe(false);
    expect(authorize({ action: 'task.create_internal', actor: actor('trainee'), target: employee('trainee', 'other') }).allowed).toBe(false);
  });
});
describe('personal work', () => {
  it.each(['founder', 'manager', 'senior_staff', 'staff', 'trainee'] as const)('lets %s create a Personal Task for themselves', (role) => {
    const currentActor = actor(role, `${role}-1`);
    expect(authorize({ action: 'task.create_personal', actor: currentActor, ownerId: currentActor.id })).toEqual({ allowed: true });
  });

  it('does not let a Personal Task become an assignment to somebody else', () => {
    expect(authorize({ action: 'task.create_personal', actor: actor('staff', 'staff-1'), ownerId: 'trainee-1' })).toMatchObject({
      allowed: false,
      code: 'personal_task_must_be_self_owned',
    });
  });
});
describe('reporting lines', () => {
  it('requires a Manager to report to the Founder', () => {
    expect(validateReportingLine(employee('manager'), employee('founder'))).toEqual({ allowed: true });
    expect(validateReportingLine(employee('manager'), employee('manager', 'manager-2')).allowed).toBe(false);
  });

  it.each(['senior_staff', 'staff', 'trainee'] as const)('allows %s to report to Founder or Manager', (role) => {
    expect(validateReportingLine(employee(role), employee('founder')).allowed).toBe(true);
    expect(validateReportingLine(employee(role), employee('manager')).allowed).toBe(true);
  });

  it('rejects self-reporting and peer reporting', () => {
    expect(validateReportingLine(employee('staff', 'person-1'), employee('manager', 'person-1')).allowed).toBe(false);
    expect(validateReportingLine(employee('trainee'), employee('senior_staff')).allowed).toBe(false);
  });

  it('allows a Manager to maintain only lower-role reporting lines', () => {
    expect(
      authorize({
        action: 'team.manage_reporting',
        actor: actor('manager'),
        subject: employee('staff'),
        proposedManager: employee('manager', 'manager-2'),
      }).allowed,
    ).toBe(true);
    expect(
      authorize({
        action: 'team.manage_reporting',
        actor: actor('manager'),
        subject: employee('manager', 'manager-2'),
        proposedManager: employee('founder'),
      }).allowed,
    ).toBe(false);
  });
});
describe('assignment change requests', () => {
  it('allows an assigned reviewer to request changes', () => {
    const reviewer = actor('senior_staff', 'reviewer-1');
    expect(
      authorize({
        action: 'assignment.request_changes',
        actor: reviewer,
        assignmentOwnerId: 'owner-1',
        reviewerIds: ['reviewer-1'],
      }),
    ).toEqual({ allowed: true });
  });

  it('allows leadership (founder/manager) to request changes even if not in reviewerIds', () => {
    expect(
      authorize({
        action: 'assignment.request_changes',
        actor: actor('manager', 'manager-1'),
        assignmentOwnerId: 'owner-1',
        reviewerIds: [],
      }),
    ).toEqual({ allowed: true });
  });

  it('prevents unassigned non-leadership staff from requesting changes', () => {
    expect(
      authorize({
        action: 'assignment.request_changes',
        actor: actor('staff', 'staff-1'),
        assignmentOwnerId: 'owner-1',
        reviewerIds: ['other-reviewer'],
      }),
    ).toMatchObject({ allowed: false, code: 'not_assignment_owner_or_reviewer' });
  });
});

describe('client read authority', () => {
  // Practice-level authority allows all active roles to initiate client reads.
  // Row-level visibility filtering (client_visible) is enforced downstream at the repository/RLS layer.
  it.each(COMPANY_ROLES)('allows %s to request client reads', (role) => {
    expect(authorize({ action: 'client.read', actor: actor(role) })).toEqual({ allowed: true });
  });
});

describe('client creation authority', () => {
  it.each(['founder', 'manager'] as const)('allows %s to create clients', (role) => {
    expect(authorize({ action: 'client.create', actor: actor(role) })).toEqual({ allowed: true });
  });

  it.each(['senior_staff', 'staff', 'trainee'] as const)(
    'denies %s from creating clients with role_not_permitted',
    (role) => {
      expect(authorize({ action: 'client.create', actor: actor(role) })).toEqual({
        allowed: false,
        code: 'role_not_permitted',
        reason: 'Only Founder and Manager may create new clients.',
      });
    },
  );
});

describe('ENG-01 engagement authority matrix across all five roles', () => {
  const actions = [
    'engagement.read',
    'engagement.create_draft',
    'engagement.revise_draft',
    'engagement.activate',
    'engagement.amend_active',
    'engagement.end',
  ] as const;

  // Expected permitted matrix:
  // founder: all 6
  // manager: read, create_draft, revise_draft
  // senior_staff, staff, trainee: none
  const allowedSet = new Set<string>([
    'founder:engagement.read',
    'founder:engagement.create_draft',
    'founder:engagement.revise_draft',
    'founder:engagement.activate',
    'founder:engagement.amend_active',
    'founder:engagement.end',
    'manager:engagement.read',
    'manager:engagement.create_draft',
    'manager:engagement.revise_draft',
  ]);

  const testMatrix = COMPANY_ROLES.flatMap((role) =>
    actions.map((action) => ({
      role,
      action,
      shouldAllow: allowedSet.has(`${role}:${action}`),
    }))
  );

  it.each(testMatrix)(
    'evaluates $role on $action -> shouldAllow: $shouldAllow',
    ({ role, action, shouldAllow }) => {
      const decision = authorize({ action, actor: actor(role) });
      if (shouldAllow) {
        expect(decision).toEqual({ allowed: true });
      } else {
        expect(decision).toMatchObject({
          allowed: false,
          code: 'role_not_permitted',
        });
      }
    },
  );
});

describe('FEE-01a fee record authority', () => {
  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('allows %s to read billing records', (role) => {
    expect(authorize({ action: 'billing.read', actor: actor(role) })).toEqual({ allowed: true });
  });

  it.each(['billing.read', 'billing.record_payment'] as const)('denies a Trainee %s', (action) => {
    expect(authorize({ action, actor: actor('trainee') })).toEqual({
      allowed: false,
      code: 'role_not_permitted',
      reason: 'Fee records are not available to Trainees.',
    });
  });

  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('allows %s to record a payment', (role) => {
    expect(authorize({ action: 'billing.record_payment', actor: actor(role) })).toEqual({ allowed: true });
  });

  it.each(['billing.record_bill', 'billing.void'] as const)('allows the Founder and Manager to use %s', (action) => {
    expect(authorize({ action, actor: actor('founder') })).toEqual({ allowed: true });
    expect(authorize({ action, actor: actor('manager') })).toEqual({ allowed: true });
  });

  it.each(['billing.record_bill', 'billing.void'] as const)('denies Senior Staff, Staff and Trainees %s', (action) => {
    for (const role of ['senior_staff', 'staff', 'trainee'] as const) {
      expect(authorize({ action, actor: actor(role) })).toEqual({
        allowed: false,
        code: 'role_not_permitted',
        reason: 'Only the Founder or Manager may record or cancel Vyapar bills.',
      });
    }
  });
});

describe('SVC-01 service list authority', () => {
  it('allows only the Founder to manage the service list', () => {
    expect(authorize({ action: 'service.manage', actor: actor('founder') })).toEqual({ allowed: true });
  });

  it.each(['manager', 'senior_staff', 'staff', 'trainee'] as const)('denies %s managing the service list', (role) => {
    expect(authorize({ action: 'service.manage', actor: actor(role) })).toEqual({
      allowed: false,
      code: 'role_not_permitted',
      reason: 'Only the Founder may manage the service list.',
    });
  });
});
