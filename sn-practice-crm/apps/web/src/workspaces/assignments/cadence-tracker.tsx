import React from 'react';
import { Check, AlertCircle, Minus, Circle } from 'lucide-react';
import type { AssignmentRow, RecurringScheduleRecord } from '../../data';
import { normalizeLifecycleStage } from '../../api/mapper';

export interface CadenceTrackerProps {
  readonly item?: AssignmentRow | RecurringScheduleRecord;
  readonly linkedAssignment?: AssignmentRow;
  readonly status?: string;
  readonly className?: string;
}

export interface MilestoneState {
  readonly id: string;
  readonly label: string;
  readonly statusLabel: string;
  readonly isExempt: boolean;
  readonly isDone: boolean;
  readonly isWarning: boolean;
}

export function deriveCadenceMilestones(props: CadenceTrackerProps): MilestoneState[] {
  const isSchedule = Boolean(
    props.item &&
      !props.linkedAssignment &&
      ('cadence' in props.item || 'nextDueDate' in props.item || 'nextRunDate' in props.item)
  );

  const isAssignmentItem = Boolean(props.linkedAssignment) || Boolean(props.item && !isSchedule) || Boolean(props.status);

  if (isAssignmentItem) {
    const rawStatus =
      props.status ??
      props.linkedAssignment?.status ??
      (props.item && 'status' in props.item ? (props.item as AssignmentRow).status : '');
    const stage = normalizeLifecycleStage(rawStatus);

    switch (stage) {
      case 'draft':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Draft', isDone: false, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
        ];
      case 'open':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Assigned', isDone: true, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
        ];
      case 'in_progress':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Assigned', isDone: true, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'In progress', isDone: true, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
        ];
      case 'ready_for_review':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Assigned', isDone: true, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'Completed', isDone: true, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Ready for review', isDone: true, isWarning: false, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
        ];
      case 'changes_requested':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Assigned', isDone: true, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'In progress', isDone: true, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Changes requested', isDone: false, isWarning: true, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
        ];
      case 'approved':
      case 'completed':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Assigned', isDone: true, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'Completed', isDone: true, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Reviewed', isDone: true, isWarning: false, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Approved', isDone: true, isWarning: false, isExempt: false },
        ];
      case 'cancelled':
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Cancelled', isDone: false, isWarning: true, isExempt: true },
          { id: 'in_progress', label: 'In progress', statusLabel: 'Cancelled', isDone: false, isWarning: false, isExempt: true },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Cancelled', isDone: false, isWarning: false, isExempt: true },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Cancelled', isDone: false, isWarning: false, isExempt: true },
        ];
      default:
        return [
          { id: 'assigned', label: 'Assigned', statusLabel: 'Assigned', isDone: true, isWarning: false, isExempt: false },
          { id: 'in_progress', label: 'In progress', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'ready_for_review', label: 'Ready for review', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
          { id: 'approved', label: 'Approved / Closed', statusLabel: 'Pending', isDone: false, isWarning: false, isExempt: false },
        ];
    }
  }

  // Case 2: Schedule without linked assignment
  const schedule = props.item as RecurringScheduleRecord | undefined;
  const isActive = schedule ? schedule.status === 'Active' : true;
  const nextRun = schedule?.nextRunDate && schedule.nextRunDate !== '—' ? schedule.nextRunDate : 'Pending';

  return [
    {
      id: 'schedule_status',
      label: 'Schedule',
      statusLabel: isActive ? 'Active' : 'Paused',
      isExempt: !isActive,
      isDone: isActive,
      isWarning: false,
    },
    {
      id: 'next_generation',
      label: 'Next Run',
      statusLabel: nextRun,
      isExempt: false,
      isDone: false,
      isWarning: false,
    },
  ];
}

export function CadenceTracker(props: CadenceTrackerProps): React.ReactElement {
  const milestones = deriveCadenceMilestones(props);

  const ariaSummary = milestones
    .map((m) => `${m.label}: ${m.statusLabel}`)
    .join(', ');

  const isScheduleMode = milestones.length === 2 && milestones[0]?.id === 'schedule_status';

  return (
    <div
      role="group"
      aria-label={`${isScheduleMode ? 'Schedule status' : 'Lifecycle stage'}: ${ariaSummary}`}
      className={`cadence-tracker ${props.className ?? ''}`.trim()}
    >
      <span className="sr-only">{`${isScheduleMode ? 'Schedule status' : 'Lifecycle stage'}: ${ariaSummary}`}</span>

      {milestones.map((m, index) => {
        const isLast = index === milestones.length - 1;
        const nextMilestone = milestones[index + 1];
        const connectorActive = m.isDone && (nextMilestone?.isDone || nextMilestone?.isWarning);

        return (
          <React.Fragment key={m.id}>
            {/* Node */}
            {m.isExempt ? (
              <span
                className="cadence-node is-exempt"
                title={`${m.label}: ${m.statusLabel}`}
                aria-label={`${m.label}: ${m.statusLabel}`}
              >
                <Minus size={10} aria-hidden="true" strokeWidth={2.5} />
              </span>
            ) : m.isDone ? (
              <span
                className="cadence-node is-done"
                title={`${m.label}: ${m.statusLabel}`}
                aria-label={`${m.label}: ${m.statusLabel}`}
              >
                <Check size={10} aria-hidden="true" strokeWidth={3} />
              </span>
            ) : m.isWarning ? (
              <span
                className="cadence-node is-warning"
                title={`${m.label}: ${m.statusLabel}`}
                aria-label={`${m.label}: ${m.statusLabel}`}
              >
                <AlertCircle size={10} aria-hidden="true" strokeWidth={2.5} />
              </span>
            ) : (
              <span
                className="cadence-node is-pending"
                title={`${m.label}: ${m.statusLabel}`}
                aria-label={`${m.label}: ${m.statusLabel}`}
              >
                <Circle size={6} aria-hidden="true" strokeWidth={2} />
              </span>
            )}

            {/* Step Connector */}
            {!isLast && (
              <span
                className={`cadence-connector ${connectorActive ? 'is-active' : ''}`}
                aria-hidden="true"
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
