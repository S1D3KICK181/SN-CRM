# SN Practice CRM

This glossary defines the practice-management language used by the clean-slate CRM. The legacy Lovable application remains a behavioural reference, but new code uses these terms consistently.

## People and authority

**Founder**:
The sole security administrator and final authority for the practice. The Founder has visibility across every operational and financial area.
_Avoid_: Super admin, owner role

**Manager**:
The practice operator responsible for work allocation, delivery oversight, billing, collections, and office accounts. A Manager reports to the Founder.
_Avoid_: Admin, accounts role

**Senior Staff**:
An experienced delivery employee who owns assigned work and may delegate child work to Staff or Trainees. Senior Staff cannot create a new client obligation.
_Avoid_: Senior, team lead

**Staff**:
A delivery employee who owns assigned work and may delegate child work only to a Trainee. Staff cannot create a new client obligation.
_Avoid_: Executive, associate

**Trainee**:
A supervised employee who completes assigned tasks and personal tasks but cannot delegate work or own practice-level authority.
_Avoid_: Intern, junior

**Reporting Line**:
The single person responsible for an employee's operational supervision. Managers report to the Founder; Senior Staff, Staff, and Trainees report to either the Founder or a Manager.
_Avoid_: Hierarchy level, parent user

## Client work

**Assignment**:
A client deliverable or obligation for which the practice is accountable. Only a Founder or Manager may create, assign, reassign, approve, or close one.
_Avoid_: Job, project, task

**Assignment Owner**:
The employee accountable for progressing an Assignment and coordinating its child work. Delegating a task never changes this ownership.
_Avoid_: Assignee, task owner

**Recurring Schedule**:
A rule that materializes future Assignments at a defined cadence, such as monthly GST filing. Only a Founder or Manager may create or change it.
_Avoid_: Recurring task, repeating assignment

**Delegated Task**:
A bounded piece of an existing Assignment given to a lower-authority employee. It must retain its parent Assignment and cannot transfer final accountability.
_Avoid_: Sub-assignment, reassignment

**Internal Task**:
A non-client office activity, such as arranging physical files, that may be assigned downward without creating an Assignment.
_Avoid_: Assignment, miscellaneous work

**Personal Task**:
A self-created reminder or to-do owned by its creator, optionally linked to a client or Assignment. It cannot be assigned to another person or represent a client obligation.
_Avoid_: Assignment, delegated task

**Work Item**:
The shared planning record used for Delegated Tasks, Internal Tasks, and Personal Tasks. An Assignment is not a Work Item.
_Avoid_: Generic task

## Delivery controls

**Ready for Review**:
The state indicating that an Assignment Owner believes delivery work is complete and requests a Founder or Manager decision.
_Avoid_: Complete, done

**Approval**:
The Founder or Manager decision that delivery evidence satisfies the Assignment. Approval is required before the Assignment can be closed.
_Avoid_: Review, sign-off by staff

**Office Accounts**:
The practice's internal cash ledger, expenses, receipts, and reconciliations, operated by the Manager and visible to the Founder.
_Avoid_: Accounts role, client accounting
