import React from 'react';
import { Check, Clock, AlertCircle, Minus, Circle } from 'lucide-react';
import type { AssignmentRow, RecurringScheduleRecord } from '../../data';

export interface CadenceTrackerProps {
  readonly item?: AssignmentRow | RecurringScheduleRecord;
  readonly bankStatementRequired?: boolean;
  readonly bankRecStatus?: string;
  readonly currentStatus?: string;
  readonly status?: string;
  readonly progress?: number;
  readonly arn?: string;
  readonly className?: string;
}

export interface MilestoneState {
  readonly id: 'bank_rec' | 'client_docs' | 'computation' | 'filing';
  readonly label: string;
  readonly statusLabel: string;
  readonly isExempt: boolean;
  readonly isDone: boolean;
  readonly isWarning: boolean;
}

export function deriveCadenceMilestones(props: CadenceTrackerProps): MilestoneState[] {
  const item = props.item;

  // Resolve bank statement requirement
  const bankStatementRequired =
    props.bankStatementRequired !== undefined
      ? props.bankStatementRequired
      : item && 'bankStatementRequired' in item
        ? item.bankStatementRequired
        : true;

  // Resolve bank reconciliation status
  const rawBankRec =
    props.bankRecStatus ??
    item?.bankRecStatus ??
    'Awaited';

  const isBankExempt = bankStatementRequired === false || rawBankRec === 'Not applicable';

  // Resolve general status and current status
  const rawStatus = (props.status ?? item?.status ?? '').toLowerCase().trim();
  const currentStatus = (props.currentStatus ?? (item && 'currentStatus' in item ? item.currentStatus : '') ?? '').toLowerCase().trim();
  const rawArn = props.arn ?? (item && 'arn' in item && typeof (item as { arn?: unknown }).arn === 'string' ? (item as { arn: string }).arn : '');
  const hasArn = Boolean(rawArn && rawArn.trim());

  const isCompletedOrApproved =
    rawStatus === 'completed' ||
    rawStatus === 'approved' ||
    rawStatus === 'closed' ||
    currentStatus === 'filed' ||
    hasArn;

  // 1. Bank Rec Milestone (solely derived from bankStatementRequired & bankRecStatus)
  let bankDone = false;
  let bankWarning = false;
  let bankStatusText = 'Awaited';

  if (isBankExempt) {
    bankStatusText = 'Exempt';
  } else if (rawBankRec.toLowerCase() === 'completed' || rawBankRec.toLowerCase() === 'reconciled') {
    bankDone = true;
    bankStatusText = 'Reconciled';
  } else {
    bankWarning = true;
    bankStatusText = rawBankRec;
  }

  // 2. Client Docs Milestone (default to Pending; explicit downstream evidence proves Received)
  let docsDone = false;
  let docsWarning = false;
  let docsStatusText = 'Pending';

  if (
    currentStatus === 'docs awaited' ||
    rawStatus === 'draft' ||
    rawStatus === 'awaiting documents' ||
    rawStatus === 'awaiting_documents'
  ) {
    docsWarning = true;
    docsStatusText = 'Awaited';
  } else if (
    currentStatus === 'docs received' ||
    currentStatus === 'bank statement received' ||
    currentStatus === 'ready to file' ||
    currentStatus === 'filed' ||
    rawStatus === 'ready for review' ||
    rawStatus === 'ready_for_review' ||
    rawStatus === 'pending review' ||
    rawStatus === 'pending_review' ||
    rawStatus === 'approved' ||
    rawStatus === 'completed' ||
    rawStatus === 'closed' ||
    hasArn
  ) {
    docsDone = true;
    docsStatusText = 'Received';
  } else {
    docsDone = false;
    docsWarning = false;
    docsStatusText = 'Pending';
  }

  // 3. Computation & Review Milestone (solely derived from workflow review/ready/filed states)
  let compDone = false;
  let compStatusText = 'Pending';

  if (
    rawStatus === 'ready for review' ||
    rawStatus === 'ready_for_review' ||
    rawStatus === 'pending review' ||
    rawStatus === 'pending_review' ||
    rawStatus === 'approved' ||
    rawStatus === 'completed' ||
    rawStatus === 'closed' ||
    currentStatus === 'ready to file' ||
    currentStatus === 'filed' ||
    hasArn
  ) {
    compDone = true;
    compStatusText = 'Ready';
  } else if (rawStatus === 'in progress' || rawStatus === 'in_progress' || currentStatus === 'in progress') {
    compDone = false;
    compStatusText = 'In progress';
  }

  // 4. Portal Filing Milestone (solely derived from approved/filed/closed or valid ARN)
  let filingDone = false;
  let filingStatusText = 'Pending';

  if (isCompletedOrApproved) {
    filingDone = true;
    filingStatusText = 'Filed';
  } else if (currentStatus === 'ready to file' || rawStatus === 'ready for review' || rawStatus === 'ready_for_review' || rawStatus === 'pending review' || rawStatus === 'pending_review') {
    filingDone = false;
    filingStatusText = 'Ready';
  }

  return [
    {
      id: 'bank_rec',
      label: 'Bank Rec',
      statusLabel: bankStatusText,
      isExempt: isBankExempt,
      isDone: bankDone,
      isWarning: bankWarning,
    },
    {
      id: 'client_docs',
      label: 'Client Docs',
      statusLabel: docsStatusText,
      isExempt: false,
      isDone: docsDone,
      isWarning: docsWarning,
    },
    {
      id: 'computation',
      label: 'Computation & Review',
      statusLabel: compStatusText,
      isExempt: false,
      isDone: compDone,
      isWarning: false,
    },
    {
      id: 'filing',
      label: 'Portal Filing',
      statusLabel: filingStatusText,
      isExempt: false,
      isDone: filingDone,
      isWarning: false,
    },
  ];
}

export function CadenceTracker(props: CadenceTrackerProps): React.ReactElement {
  const milestones = deriveCadenceMilestones(props);

  const ariaSummary = milestones
    .map((m) => `${m.label}: ${m.statusLabel}`)
    .join(', ');

  return (
    <div
      role="group"
      aria-label={`Compliance stage: ${ariaSummary}`}
      className={`cadence-tracker ${props.className ?? ''}`.trim()}
    >
      <span className="sr-only">{`Compliance stage: ${ariaSummary}`}</span>

      {milestones.map((m, index) => {
        const isLast = index === milestones.length - 1;
        const nextMilestone = milestones[index + 1];
        const connectorActive = m.isDone && (nextMilestone?.isDone || nextMilestone?.isWarning);

        return (
          <React.Fragment key={m.id}>
            {/* Milestone Node */}
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
