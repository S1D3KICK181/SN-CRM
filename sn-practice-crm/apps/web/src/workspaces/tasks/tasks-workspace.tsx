import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronRight,
  ClipboardCheck,
  Files,
  ListChecks,
  Plus,
  RotateCcw,
} from 'lucide-react';
import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type {
  AssignmentRow,
  DelegatedTaskRecord,
  PersonalTaskRecord,
} from '../../data';
import type { PageKey } from '../../shell/navigation';
import { useClients } from '../../api/use-clients';
import { useTeamDirectory } from '../../api/use-team-directory';
import type {
  CreateDelegatedInput,
  CreateInternalInput,
  CreatePersonalInput,
} from '../../api/use-work-items';
import {
  isValidUuid,
  type TaskClientOption,
  type WorkItemOperationError,
} from '../../api/work-items-types';
import { Card, Status } from '../../ui/workspace-primitives';
import { CreateTaskDialog, type TaskComposerMode } from './create-task-dialog';

export function PersonalTasks({
  tasks = [],
  onToggle,
  onAdd,
}: {
  tasks: readonly PersonalTaskRecord[];
  onToggle?: (id: string) => Promise<boolean> | void;
  onAdd?: () => void;
}) {
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(new Set());

  const handleToggleClick = async (taskId: string) => {
    if (!onToggle || togglingIds.has(taskId)) return;
    const res = onToggle(taskId);
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      setTogglingIds((prev) => new Set(prev).add(taskId));
      try {
        await res;
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    }
  };

  return (
    <Card
      title="Personal tasks"
      description="Private planning and reminders"
      action={
        onAdd ? (
          <button className="mini-add" type="button" onClick={onAdd}>
            <Plus aria-hidden="true" /> Add task
          </button>
        ) : (
          <ListChecks aria-hidden="true" />
        )
      }
      className="compact-card"
    >
      <div className="personal-list">
        {tasks.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-muted)',
              padding: '12px 0',
              margin: 0,
            }}
          >
            No personal tasks. Use this space for private reminders and follow-up notes.
          </p>
        ) : (
          tasks.map((task) => {
            const isPending = togglingIds.has(task.id);
            return (
              <label
                className={task.done ? 'personal-row is-done' : 'personal-row'}
                key={task.id}
                style={{
                  cursor: onToggle && !isPending && !task.done ? 'pointer' : 'default',
                  opacity: isPending ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={task.done}
                  disabled={task.done || isPending || !onToggle}
                  aria-busy={isPending}
                  onChange={() => void handleToggleClick(task.id)}
                />
                <span className="custom-check">
                  <Check aria-hidden="true" />
                </span>
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {task.context} · {task.time}
                  </small>
                </span>
              </label>
            );
          })
        )}
      </div>
    </Card>
  );
}

export function TaskQueue({
  tasks = [],
  onStartTask,
  onSubmitForReview,
  onToast,
  onNavigate,
}: {
  tasks: readonly DelegatedTaskRecord[];
  onStartTask?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  onSubmitForReview?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  onToast: (message: string) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const [startingIds, setStartingIds] = useState<ReadonlySet<string>>(new Set());
  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(new Set());

  const handleStart = async (task: DelegatedTaskRecord) => {
    if (!onStartTask || startingIds.has(task.id) || submittingIds.has(task.id)) return;
    const res = onStartTask(task);
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      setStartingIds((prev) => new Set(prev).add(task.id));
      try {
        await res;
      } finally {
        setStartingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    }
  };

  const handleSubmit = async (task: DelegatedTaskRecord) => {
    if (!onSubmitForReview || startingIds.has(task.id) || submittingIds.has(task.id)) return;
    const res = onSubmitForReview(task);
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      setSubmittingIds((prev) => new Set(prev).add(task.id));
      try {
        await res;
      } finally {
        setSubmittingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    }
  };

  return (
    <Card
      title="My task queue"
      description="Delegated work ordered by due time"
      action={
        <button
          className="text-button"
          type="button"
          onClick={() =>
            onNavigate ? onNavigate('My Tasks') : onToast('All trainee tasks displayed')
          }
        >
          View all <ChevronRight aria-hidden="true" />
        </button>
      }
      className="task-queue"
    >
      <div className="queue-list">
        {tasks.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-muted)',
              padding: '16px 14px',
              margin: 0,
            }}
          >
            Your task queue is clear. All assigned work has been completed or submitted.
          </p>
        ) : (
          tasks.map((task, index) => {
            const isStarting = startingIds.has(task.id);
            const isSubmitting = submittingIds.has(task.id);
            const isPending = isStarting || isSubmitting;
            return (
              <div
                className="queue-row"
                key={task.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="queue-priority">{index + 1}</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{task.title}</strong>
                      {task.kind === 'internal' ? (
                        <Status tone="default">Office</Status>
                      ) : null}
                    </div>
                    <small style={{ display: 'block', color: 'var(--ink-muted)' }}>
                      {task.parent} · Assigned by {task.assignedBy}
                    </small>
                    {task.instructions ? (
                      <p
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-muted)',
                          margin: '4px 0 0',
                        }}
                      >
                        {task.instructions}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}>
                    <Status
                      tone={
                        task.status === 'Completed'
                          ? 'success'
                          : task.status === 'Pending Review'
                          ? 'warning'
                          : 'default'
                      }
                    >
                      {task.status || `${task.progress}%`}
                    </Status>
                    <small style={{ display: 'block' }}>{task.due}</small>
                  </div>
                  {task.status === 'To Do' && onStartTask ? (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={isPending}
                      aria-busy={isStarting}
                      style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
                      onClick={() => void handleStart(task)}
                    >
                      {isStarting ? 'Starting...' : 'Start task'}
                    </button>
                  ) : null}
                  {task.status === 'In Progress' && onSubmitForReview ? (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={isPending}
                      aria-busy={isSubmitting}
                      style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
                      onClick={() => void handleSubmit(task)}
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit for review'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

export function DelegatedWork({
  tasks = [],
  role,
  onAdd,
  onAddInternal,
  className = '',
}: {
  tasks: readonly DelegatedTaskRecord[];
  role?: CompanyRole;
  onAdd?: () => void;
  onAddInternal?: () => void;
  className?: string;
}) {
  const isTrainee = role === 'trainee';
  const canAddOffice = !isTrainee && Boolean(onAddInternal);

  return (
    <Card
      title="Delegated work"
      description="Sub-tasks and office operations delegated to employees"
      action={
        !isTrainee && onAdd ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="mini-add" type="button" onClick={onAdd}>
              <Plus aria-hidden="true" /> Sub-task
            </button>
            {canAddOffice ? (
              <button className="mini-add" type="button" onClick={onAddInternal}>
                <Plus aria-hidden="true" /> Office task
              </button>
            ) : null}
          </div>
        ) : undefined
      }
      className={`compact-card ${className}`.trim()}
    >
      <div className="list-stack task-list">
        {tasks.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-muted)',
              padding: '12px 0',
              margin: 0,
            }}
          >
            No active sub-tasks delegated to employees.
          </p>
        ) : (
          tasks.map((task) => (
            <div
              className="task-row"
              key={task.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>
                <strong>{task.title}</strong>
                <small>{task.parent}</small>
              </span>
              <span style={{ textAlign: 'right' }}>
                <Status
                  tone={
                    task.status === 'Completed'
                      ? 'success'
                      : task.status === 'Pending Review'
                      ? 'warning'
                      : 'default'
                  }
                >
                  {task.status || 'In Progress'}
                </Status>
                <small style={{ display: 'block' }}>
                  {task.person} · {task.due}
                </small>
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

export function ReviewQueue({
  delegatedTasks = [],
  onApprove,
  onReopen,
  onToast: _onToast,
  className = '',
}: {
  delegatedTasks?: readonly DelegatedTaskRecord[];
  onApprove?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  onReopen?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  onToast?: (msg: string) => void;
  className?: string;
}) {
  const [approvingIds, setApprovingIds] = useState<ReadonlySet<string>>(new Set());
  const [reopeningIds, setReopeningIds] = useState<ReadonlySet<string>>(new Set());
  const pending = delegatedTasks.filter((t) => t.status === 'Pending Review');

  const handleApproveClick = async (task: DelegatedTaskRecord) => {
    if (!onApprove || approvingIds.has(task.id) || reopeningIds.has(task.id)) return;
    const res = onApprove(task);
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      setApprovingIds((prev) => new Set(prev).add(task.id));
      try {
        await res;
      } finally {
        setApprovingIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    }
  };

  const handleReopenClick = async (task: DelegatedTaskRecord) => {
    if (!onReopen || approvingIds.has(task.id) || reopeningIds.has(task.id)) return;
    const res = onReopen(task);
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      setReopeningIds((prev) => new Set(prev).add(task.id));
      try {
        await res;
      } finally {
        setReopeningIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    }
  };

  return (
    <Card
      title="Review queue"
      description="Delegated work awaiting your decision"
      action={<ClipboardCheck aria-hidden="true" />}
      className={`compact-card ${className}`.trim()}
    >
      <div className="review-score">
        <span>
          <strong>{pending.length}</strong> ready to review
        </span>
        <small>{pending.length === 0 ? 'Queue clear' : 'Awaiting sign-off'}</small>
      </div>
      <div className="mini-list">
        {pending.length === 0 ? (
          <p
            style={{
              fontSize: 12,
              color: 'var(--ink-muted)',
              padding: '8px 0',
              margin: 0,
            }}
          >
            All delegated sub-tasks verified.
          </p>
        ) : (
          pending.map((t) => {
            const isApproving = approvingIds.has(t.id);
            const isReopening = reopeningIds.has(t.id);
            const isBusy = isApproving || isReopening;
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span>
                  <i className="dot-warning" />
                  {t.title} <b>{t.person}</b>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {onApprove ? (
                    <button
                      className="soft-button"
                      type="button"
                      disabled={isBusy}
                      aria-busy={isApproving}
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => void handleApproveClick(t)}
                    >
                      {isApproving ? 'Approving...' : 'Approve'}
                    </button>
                  ) : null}
                  {onReopen ? (
                    <button
                      className="soft-button"
                      type="button"
                      disabled={isBusy}
                      aria-busy={isReopening}
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => void handleReopenClick(t)}
                    >
                      {isReopening ? 'Requesting...' : 'Request changes'}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

function TasksWorkspaceSkeleton() {
  return (
    <div
      className="dashboard-grid tasks-workspace-grid"
      data-testid="tasks-loading-skeleton"
    >
      <Card title="Personal tasks" description="Loading reminders..." className="compact-card">
        <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>
          <div
            className="skeleton-pulse"
            style={{ height: 42, background: 'var(--canvas)', borderRadius: 6 }}
          />
          <div
            className="skeleton-pulse"
            style={{ height: 42, background: 'var(--canvas)', borderRadius: 6 }}
          />
        </div>
      </Card>
      <Card title="My task queue" description="Loading tasks..." className="task-queue">
        <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>
          <div
            className="skeleton-pulse"
            style={{ height: 50, background: 'var(--canvas)', borderRadius: 6 }}
          />
          <div
            className="skeleton-pulse"
            style={{ height: 50, background: 'var(--canvas)', borderRadius: 6 }}
          />
        </div>
      </Card>
      <Card title="Delegated work" description="Loading delegations..." className="compact-card">
        <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>
          <div
            className="skeleton-pulse"
            style={{ height: 42, background: 'var(--canvas)', borderRadius: 6 }}
          />
        </div>
      </Card>
      <Card title="Review queue" description="Loading review items..." className="compact-card">
        <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>
          <div
            className="skeleton-pulse"
            style={{ height: 42, background: 'var(--canvas)', borderRadius: 6 }}
          />
        </div>
      </Card>
    </div>
  );
}

export interface TasksWorkspaceModel {
  readonly personalTasks?: readonly PersonalTaskRecord[];
  readonly assignedToMe?: readonly DelegatedTaskRecord[];
  readonly delegatedTasks?: readonly DelegatedTaskRecord[];
  readonly reviewableTasks?: readonly DelegatedTaskRecord[];
  readonly loading?: boolean;
  readonly error?: WorkItemOperationError | null;
  readonly hasLiveSnapshot?: boolean;
}

export interface TasksWorkspaceActions {
  readonly onTogglePersonalTask?: (id: string) => Promise<boolean> | void;
  readonly onStartTask?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  readonly onSubmitTaskForReview?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  readonly onApproveDelegatedTask?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  readonly onReopenDelegatedTask?: (task: DelegatedTaskRecord) => Promise<boolean> | void;
  readonly onRefresh?: () => Promise<void>;
  readonly onCreatePersonal?: (input: CreatePersonalInput) => Promise<boolean>;
  readonly onCreateDelegated?: (input: CreateDelegatedInput) => Promise<boolean>;
  readonly onCreateInternal?: (input: CreateInternalInput) => Promise<boolean>;
}

export interface TasksWorkspaceProps {
  readonly role: CompanyRole;
  readonly assignments?: readonly AssignmentRow[];
  readonly clients?: readonly TaskClientOption[];
  readonly currentActor?: { id?: string; name?: string; role?: CompanyRole };
  readonly teamLines?: readonly ReportingLineDto[];
  readonly onToast?: (message: string) => void;
  readonly onCompose?: (mode: TaskComposerMode) => void;
  readonly activeDialog?: TaskComposerMode | null;
  readonly onCloseDialog?: () => void;
  readonly model?: TasksWorkspaceModel;
  readonly actions?: TasksWorkspaceActions;
}

export function TasksWorkspace({
  role,
  assignments = [],
  clients: externalClients,
  currentActor,
  teamLines: externalTeamLines,
  onToast,
  onCompose,
  activeDialog,
  onCloseDialog,
  model,
  actions,
}: TasksWorkspaceProps) {
  // Fetch live team lines from TM-01 directory if not injected
  const { lines: directoryLines } = useTeamDirectory(role);
  const activeReportingLines = externalTeamLines ?? directoryLines;

  // Fetch live clients mapped to minimal TaskClientOption with valid UUIDs
  const { items: directoryClients } = useClients(role);
  const clientOptions = useMemo<TaskClientOption[]>(() => {
    if (externalClients && externalClients.length > 0) {
      return externalClients.filter((c) => isValidUuid(c.id));
    }
    return directoryClients
      .filter((c) => isValidUuid(c.id))
      .map((c) => ({
        id: c.id,
        name: c.displayName,
        type: c.legalName && c.legalName !== c.displayName ? c.legalName : undefined,
      }));
  }, [externalClients, directoryClients]);

  // Model from single root state owner
  const personalTasks = model?.personalTasks ?? [];
  const assignedToMe = model?.assignedToMe ?? [];
  const delegatedTasks = model?.delegatedTasks ?? [];
  const reviewableTasks = model?.reviewableTasks ?? [];
  const loading = model?.loading ?? false;
  const error = model?.error ?? null;
  const hasLiveSnapshot = model?.hasLiveSnapshot ?? true;

  // Actions from single root state owner
  const handleToggle = actions?.onTogglePersonalTask;
  const handleStart = actions?.onStartTask;
  const handleSubmit = actions?.onSubmitTaskForReview;
  const handleApprove = actions?.onApproveDelegatedTask;
  const handleReopen = actions?.onReopenDelegatedTask;
  const handleRefresh = actions?.onRefresh;
  const handleCreatePersonal = actions?.onCreatePersonal;
  const handleCreateDelegated = actions?.onCreateDelegated;
  const handleCreateInternal = actions?.onCreateInternal;

  // Local dialog mode management
  const [localDialog, setLocalDialog] = useState<TaskComposerMode | null>(null);
  const effectiveDialog = activeDialog !== undefined ? activeDialog : localDialog;

  const handleOpenDialog = (mode: TaskComposerMode) => {
    if (onCompose) {
      onCompose(mode);
    }
    setLocalDialog(mode);
  };

  const handleCloseDialog = () => {
    if (onCloseDialog) {
      onCloseDialog();
    }
    setLocalDialog(null);
  };

  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    if (retrying || !handleRefresh) return;
    const res = handleRefresh();
    if (res && typeof (res as Promise<unknown>).then === 'function') {
      setRetrying(true);
      try {
        await res;
      } finally {
        setRetrying(false);
      }
    }
  };

  const isLeadership = role === 'founder' || role === 'manager';
  const isSenior = role === 'senior_staff';
  const showReviewQueue = isLeadership || isSenior || reviewableTasks.length > 0;

  if (loading && !hasLiveSnapshot) {
    return <TasksWorkspaceSkeleton />;
  }

  return (
    <>
      {error ? (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 16px',
            marginBottom: 16,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger)',
            borderRadius: '8px',
            color: 'var(--danger)',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{error.message}</span>
          </div>
          {handleRefresh ? (
            <button
              className="soft-button"
              type="button"
              disabled={retrying}
              aria-busy={retrying}
              style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
              onClick={() => void handleRetry()}
            >
              <RotateCcw size={12} style={{ marginRight: 4 }} aria-hidden="true" />
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="dashboard-grid tasks-workspace-grid">
        <PersonalTasks
          tasks={personalTasks}
          onToggle={handleToggle}
          onAdd={() => handleOpenDialog('personal')}
        />

        <TaskQueue
          tasks={assignedToMe}
          onStartTask={handleStart}
          onSubmitForReview={handleSubmit}
          onToast={onToast ?? (() => {})}
        />

        {role !== 'trainee' ? (
          <DelegatedWork
            tasks={delegatedTasks}
            role={role}
            onAdd={() => handleOpenDialog('delegated')}
            onAddInternal={() => handleOpenDialog('internal')}
            className={!showReviewQueue ? 'is-full-width' : ''}
          />
        ) : null}

        {showReviewQueue ? (
          <ReviewQueue
            delegatedTasks={reviewableTasks}
            onApprove={handleApprove}
            onReopen={handleReopen}
            onToast={onToast ?? (() => {})}
          />
        ) : null}
      </div>

      {effectiveDialog ? (
        <CreateTaskDialog
          isOpen={Boolean(effectiveDialog)}
          mode={effectiveDialog}
          role={role}
          assignments={assignments}
          clients={clientOptions}
          reportingLines={activeReportingLines}
          currentActorId={currentActor?.id}
          currentActorName={currentActor?.name}
          onClose={handleCloseDialog}
          onCreatePersonal={handleCreatePersonal}
          onCreateDelegated={handleCreateDelegated}
          onCreateInternal={handleCreateInternal}
          onToast={onToast}
        />
      ) : null}
    </>
  );
}
