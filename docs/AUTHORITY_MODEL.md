# Authority model

The CRM separates **practice obligations** from **day-to-day work**. An Assignment commits the practice to client delivery, while Work Items break delivery into controlled actions or help an employee plan their own day.

## Reporting structure

- Founder reports to nobody.
- Manager reports to Founder.
- Senior Staff, Staff, and Trainee each report to either Founder or Manager.
- Every non-Founder has exactly one reporting line; loops and self-reporting are invalid.
- Reporting lines affect supervision and default dashboard scope. They do not replace authorization checks.

## Role authority

| Capability | Founder | Manager | Senior Staff | Staff | Trainee |
| --- | --- | --- | --- | --- | --- |
| Create client Assignment | Yes | Yes | No | No | No |
| Assign or reassign Assignment owner | Yes | Yes | No | No | No |
| Create or change Recurring Schedule | Yes | Yes | No | No | No |
| Submit owned Assignment for review | Yes | Yes | Yes | Yes | No |
| Approve or close Assignment | Yes | Yes | No | No | No |
| Delegate child work on an owned Assignment | Any eligible employee | Any eligible employee | Staff or Trainee | Trainee only | No |
| Create Internal Task for another employee | Any eligible employee | Any eligible employee | Staff or Trainee | Trainee only | No |
| Create Personal Task for self | Yes | Yes | Yes | Yes | Yes |
| Operate office cash ledger and accounts | Full visibility/override | Yes | No | No | No |
| Create users and change roles | Yes | No | No | No | No |
| Manage lower-role reporting lines | Yes | Yes | No | No | No |
| See practice-wide reports | Yes | Yes | No | No | No |

## Non-negotiable invariants

1. A Delegated Task always references its parent Assignment.
2. Delegation never changes the Assignment Owner.
3. Senior Staff may delegate only when they own the parent Assignment or have been explicitly made its reviewer.
4. Staff may delegate only when they own the parent Assignment, and only to a Trainee.
5. A Personal Task is always created for and owned by the same employee.
6. Linking a Personal Task to a client or Assignment provides context only; it does not add scope to the Assignment.
7. Only Founder or Manager can turn new client work into an Assignment or Recurring Schedule.
8. Assignment completion requires Founder or Manager approval; delivery employees submit work as Ready for Review.
9. Manager operates Office Accounts; Founder retains full visibility and override authority.
10. Menu visibility is convenience. The backend policy and database access rules remain the security boundary.

## Safe defaults to validate with the practice

- Only the Founder changes access roles or creates staff accounts. The Manager may maintain reporting lines for Senior Staff, Staff, and Trainees.
- A Trainee receives Work Items, not primary ownership of a client Assignment.
- Senior Staff may review the child tasks they delegated but cannot approve or close the parent Assignment.
- Personal Tasks are private to their owner by default; Founder and Manager can see only aggregate workload metadata unless an escalation or linked Assignment requires access.
