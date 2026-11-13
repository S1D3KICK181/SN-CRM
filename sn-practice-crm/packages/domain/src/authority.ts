export const COMPANY_ROLES = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'] as const;

export type CompanyRole = (typeof COMPANY_ROLES)[number];

export interface Actor {
  id: string;
  role: CompanyRole;
}

export interface EmployeeRef {
  id: string;
  role: CompanyRole;
}

export type AuthorityDecision =
  | { allowed: true }
  | { allowed: false; code: AuthorityDenialCode; reason: string };

export type AuthorityDenialCode =
  | 'role_not_permitted'
  | 'not_assignment_owner_or_reviewer'
  | 'invalid_delegate_role'
  | 'personal_task_must_be_self_owned'
  | 'invalid_reporting_line'
  | 'trainee_cannot_own_assignment';

export type AuthorityRequest =
  | { action: 'assignment.create' | 'assignment.reassign' | 'schedule.manage' | 'assignment.approve' | 'assignment.close'; actor: Actor }
  | { action: 'assignment.assign'; actor: Actor; target: EmployeeRef }
  | { action: 'assignment.progress' | 'assignment.submit'; actor: Actor; assignmentOwnerId: string; reviewerIds?: readonly string[] }
  | { action: 'assignment.request_changes'; actor: Actor; assignmentOwnerId: string; reviewerIds?: readonly string[] }
  | {
      action: 'task.delegate';
      actor: Actor;
      target: EmployeeRef;
      assignmentOwnerId: string;
      reviewerIds?: readonly string[];
    }
  | { action: 'task.create_internal'; actor: Actor; target: EmployeeRef }
  | { action: 'task.create_personal'; actor: Actor; ownerId: string }
  | {
      action: 'client.read' | 'client.create' | 'billing.read' | 'billing.record_bill' | 'billing.record_payment' | 'billing.void';
      actor: Actor;
    }
  | { action: 'finance.manage' | 'reports.view_practice' | 'team.manage_access' | 'service.manage'; actor: Actor }
  | { action: 'team.manage_reporting'; actor: Actor; subject: EmployeeRef; proposedManager: EmployeeRef | null }
  | {
      action:
        | 'engagement.read'
        | 'engagement.create_draft'
        | 'engagement.revise_draft'
        | 'engagement.activate'
        | 'engagement.amend_active'
        | 'engagement.end';
      actor: Actor;
    };

const ALLOWED: AuthorityDecision = { allowed: true };

function deny(code: AuthorityDenialCode, reason: string): AuthorityDecision {
  return { allowed: false, code, reason };
}

function isLeadership(role: CompanyRole): boolean {
  return role === 'founder' || role === 'manager';
}

function ownsOrReviews(actor: Actor, ownerId: string, reviewerIds: readonly string[] = []): boolean {
  return actor.id === ownerId || reviewerIds.includes(actor.id);
}

export function mayDelegateTo(actorRole: CompanyRole, targetRole: CompanyRole): boolean {
  switch (actorRole) {
    case 'founder':
      return targetRole !== 'founder';
    case 'manager':
      return targetRole === 'senior_staff' || targetRole === 'staff' || targetRole === 'trainee';
    case 'senior_staff':
      return targetRole === 'staff' || targetRole === 'trainee';
    case 'staff':
      return targetRole === 'trainee';
    case 'trainee':
      return false;
  }
}

export function validateReportingLine(subject: EmployeeRef, proposedManager: EmployeeRef | null): AuthorityDecision {
  if (subject.role === 'founder') {
    return proposedManager === null
      ? ALLOWED
      : deny('invalid_reporting_line', 'The Founder cannot report to another employee.');
  }

  if (proposedManager === null || proposedManager.id === subject.id) {
    return deny('invalid_reporting_line', 'Every non-Founder must report to a different employee.');
  }

  if (subject.role === 'manager') {
    return proposedManager.role === 'founder'
      ? ALLOWED
      : deny('invalid_reporting_line', 'A Manager must report to the Founder.');
  }

  return proposedManager.role === 'founder' || proposedManager.role === 'manager'
    ? ALLOWED
    : deny('invalid_reporting_line', 'Senior Staff, Staff, and Trainees must report to a Founder or Manager.');
}

export function authorize(request: AuthorityRequest): AuthorityDecision {
  const { actor } = request;

  switch (request.action) {
    case 'assignment.create':
    case 'assignment.reassign':
    case 'schedule.manage':
    case 'assignment.approve':
    case 'assignment.close':
    case 'finance.manage':
    case 'reports.view_practice':
      return isLeadership(actor.role)
        ? ALLOWED
        : deny('role_not_permitted', 'This action is reserved for the Founder or Manager.');

    case 'assignment.assign':
      if (!isLeadership(actor.role)) {
        return deny('role_not_permitted', 'Only the Founder or Manager may assign an Assignment owner.');
      }
      return request.target.role === 'trainee'
        ? deny('trainee_cannot_own_assignment', 'A Trainee receives Work Items, not primary ownership of an Assignment.')
        : ALLOWED;

    case 'assignment.progress':
      return isLeadership(actor.role) || ownsOrReviews(actor, request.assignmentOwnerId, request.reviewerIds)
        ? ALLOWED
        : deny('not_assignment_owner_or_reviewer', 'Only practice leadership, the Assignment Owner, or an explicit reviewer may update progress.');

    case 'assignment.submit':
      if (actor.role === 'trainee') {
        return deny('role_not_permitted', 'A Trainee cannot own or submit an Assignment.');
      }
      return isLeadership(actor.role) || actor.id === request.assignmentOwnerId
        ? ALLOWED
        : deny('not_assignment_owner_or_reviewer', 'Only the Assignment Owner may submit it for review.');

    case 'assignment.request_changes':
      return isLeadership(actor.role) || (request.reviewerIds && request.reviewerIds.includes(actor.id))
        ? ALLOWED
        : deny('not_assignment_owner_or_reviewer', 'Only practice leadership or an assigned reviewer may request changes on an assignment.');

    case 'task.delegate':
      if (!isLeadership(actor.role) && !ownsOrReviews(actor, request.assignmentOwnerId, request.reviewerIds)) {
        return deny('not_assignment_owner_or_reviewer', 'Child work may be delegated only by leadership, the Assignment Owner, or an explicit reviewer.');
      }
      return mayDelegateTo(actor.role, request.target.role)
        ? ALLOWED
        : deny('invalid_delegate_role', 'The selected employee is outside this role’s delegation authority.');

    case 'task.create_internal':
      return mayDelegateTo(actor.role, request.target.role)
        ? ALLOWED
        : deny('invalid_delegate_role', 'Internal work may only be assigned downward within the role hierarchy.');

    case 'task.create_personal':
      return actor.id === request.ownerId
        ? ALLOWED
        : deny('personal_task_must_be_self_owned', 'A Personal Task must be created for and owned by the same employee.');

    case 'client.read':
      // Practice-level read authority: all authenticated roles may request clients.
      // Individual client row visibility is enforced downstream at the repository/RLS layer.
      return ALLOWED;

    case 'client.create':
      return isLeadership(actor.role)
        ? ALLOWED
        : deny('role_not_permitted', 'Only Founder and Manager may create new clients.');

    case 'billing.read':
    case 'billing.record_payment':
      // Row scope for Senior Staff and Staff (fee-visible clients) is enforced by RLS.
      return actor.role === 'trainee'
        ? deny('role_not_permitted', 'Fee records are not available to Trainees.')
        : ALLOWED;

    case 'billing.record_bill':
    case 'billing.void':
      return isLeadership(actor.role)
        ? ALLOWED
        : deny('role_not_permitted', 'Only the Founder or Manager may record or cancel Vyapar bills.');

    case 'team.manage_access':
      return actor.role === 'founder'
        ? ALLOWED
        : deny('role_not_permitted', 'Only the Founder may create staff access or change roles.');

    case 'service.manage':
      return actor.role === 'founder'
        ? ALLOWED
        : deny('role_not_permitted', 'Only the Founder may manage the service list.');

    case 'team.manage_reporting': {
      if (actor.role !== 'founder' && actor.role !== 'manager') {
        return deny('role_not_permitted', 'Only the Founder or Manager may maintain reporting lines.');
      }
      if (actor.role === 'manager' && (request.subject.role === 'founder' || request.subject.role === 'manager')) {
        return deny('role_not_permitted', 'A Manager may maintain reporting lines only for Senior Staff, Staff, and Trainees.');
      }
      if (request.proposedManager === null) {
        return ALLOWED;
      }
      return validateReportingLine(request.subject, request.proposedManager);
    }

    case 'engagement.read':
    case 'engagement.create_draft':
    case 'engagement.revise_draft':
      return isLeadership(actor.role)
        ? ALLOWED
        : deny('role_not_permitted', 'Engagement preparation and reading are reserved for the Founder or Manager.');

    case 'engagement.activate':
    case 'engagement.amend_active':
    case 'engagement.end':
      return actor.role === 'founder'
        ? ALLOWED
        : deny('role_not_permitted', 'Engagement activation, approved amendments, and ending are reserved solely for the Founder.');
  }
}
