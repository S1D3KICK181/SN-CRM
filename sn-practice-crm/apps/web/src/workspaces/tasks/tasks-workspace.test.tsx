// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DelegatedWork,
  PersonalTasks,
  ReviewQueue,
  TaskQueue,
  TasksWorkspace,
} from './tasks-workspace';
import { CreateTaskDialog } from './create-task-dialog';
import type { DelegatedTaskRecord, PersonalTaskRecord } from '../../data';
import { WorkItemOperationError } from '../../api/work-items-types';

afterEach(() => {
  cleanup();
});

const SAMPLE_PERSONAL_TASK: PersonalTaskRecord = {
  id: 'tsk_p_01',
  code: 'WI-000101',
  title: 'Call client accountant',
  context: 'Aster Foods',
  time: 'Today · 16:00',
  done: false,
};

const SAMPLE_ASSIGNED_TASK: DelegatedTaskRecord = {
  id: 'tsk_d_01',
  code: 'WI-000102',
  kind: 'delegated',
  title: 'Check vendor purchase vouchers',
  parent: 'ASN-0001 · October GST',
  parentAssignmentId: 'ASN-0001',
  person: 'Rohan Mehta',
  assigneeId: 'usr_staff',
  assignedBy: 'Priya Desai',
  createdById: 'usr_manager',
  due: 'Tomorrow',
  progress: 0,
  status: 'To Do',
  tone: 'default',
};

const SAMPLE_REVIEWABLE_TASK: DelegatedTaskRecord = {
  id: 'tsk_d_02',
  code: 'WI-000103',
  kind: 'delegated',
  title: 'Draft fixed asset reconciliation',
  parent: 'ASN-0002 · Q2 Audit',
  parentAssignmentId: 'ASN-0002',
  person: 'Rohan Mehta',
  assigneeId: 'usr_staff',
  assignedBy: 'Priya Desai',
  createdById: 'usr_manager',
  due: 'Today',
  progress: 90,
  status: 'Pending Review',
  tone: 'warning',
};

describe('TasksWorkspace Unit Tests', () => {
  describe('Loading and Error States', () => {
    it('renders loading skeleton when loading is true and no snapshot exists', () => {
      render(
        <TasksWorkspace
          role="staff"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: true,
            hasLiveSnapshot: false,
          }}
        />,
      );

      expect(screen.getByTestId('tasks-loading-skeleton')).toBeDefined();
    });

    it('renders sanitized error banner with Retry button when error is present', () => {
      const onRefresh = vi.fn();
      render(
        <TasksWorkspace
          role="staff"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
            error: new WorkItemOperationError({
              code: 'network',
              message: 'Unable to reach the server. Please check your network connection and try again.',
            }),
          }}
          actions={{
            onRefresh,
          }}
        />,
      );

      expect(screen.getByRole('alert')).toBeDefined();
      expect(
        screen.getByText(/Unable to reach the server. Please check your network connection and try again./i),
      ).toBeDefined();

      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      fireEvent.click(retryBtn);
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tailored Empty States', () => {
    it('renders helpful empty state copy across cards when tasks are empty', () => {
      render(
        <TasksWorkspace
          role="manager"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
        />,
      );

      expect(
        screen.getByText(/No personal tasks. Use this space for private reminders and follow-up notes./i),
      ).toBeDefined();
      expect(
        screen.getByText(/Your task queue is clear. All assigned work has been completed or submitted./i),
      ).toBeDefined();
      expect(
        screen.getByText(/No active sub-tasks delegated to employees./i),
      ).toBeDefined();
      expect(screen.getByText(/All delegated sub-tasks verified./i)).toBeDefined();
    });
  });

  describe('Role-Based Authority Visibility', () => {
    it('hides DelegatedWork and ReviewQueue for Trainee role', () => {
      render(
        <TasksWorkspace
          role="trainee"
          model={{
            personalTasks: [SAMPLE_PERSONAL_TASK],
            assignedToMe: [SAMPLE_ASSIGNED_TASK],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
        />,
      );

      expect(screen.getByText('Personal tasks')).toBeDefined();
      expect(screen.getByText('My task queue')).toBeDefined();
      expect(screen.queryByText('Delegated work')).toBeNull();
      expect(screen.queryByText('Review queue')).toBeNull();
    });

    it('renders DelegatedWork with both "+ Sub-task" and "+ Office task" for Staff', () => {
      render(
        <TasksWorkspace
          role="staff"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [SAMPLE_ASSIGNED_TASK],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
        />,
      );

      expect(screen.getByText('Delegated work')).toBeDefined();
      expect(screen.getByRole('button', { name: /Sub-task/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Office task/i })).toBeDefined();
    });

    it('renders DelegatedWork with both "+ Sub-task" and "+ Office task" for Manager and Senior Staff', () => {
      render(
        <TasksWorkspace
          role="manager"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [SAMPLE_ASSIGNED_TASK],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
        />,
      );

      expect(screen.getByRole('button', { name: /Sub-task/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Office task/i })).toBeDefined();
    });
  });

  describe('Action Executions', () => {
    it('triggers onTogglePersonalTask when personal task checkbox is toggled', () => {
      const onToggle = vi.fn();
      render(
        <PersonalTasks
          tasks={[SAMPLE_PERSONAL_TASK]}
          onToggle={onToggle}
        />,
      );

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      expect(onToggle).toHaveBeenCalledWith('tsk_p_01');
    });

    it('triggers onStartTask and onSubmitTaskForReview in TaskQueue', () => {
      const onStart = vi.fn();
      const onSubmit = vi.fn();

      const { rerender } = render(
        <TaskQueue
          tasks={[SAMPLE_ASSIGNED_TASK]}
          onStartTask={onStart}
          onSubmitForReview={onSubmit}
          onToast={vi.fn()}
        />,
      );

      const startBtn = screen.getByRole('button', { name: /Start task/i });
      fireEvent.click(startBtn);
      expect(onStart).toHaveBeenCalledWith(SAMPLE_ASSIGNED_TASK);

      const inProgressTask: DelegatedTaskRecord = {
        ...SAMPLE_ASSIGNED_TASK,
        id: 'tsk_in_progress',
        status: 'In Progress',
      };

      rerender(
        <TaskQueue
          tasks={[inProgressTask]}
          onStartTask={onStart}
          onSubmitForReview={onSubmit}
          onToast={vi.fn()}
        />,
      );

      const submitBtn = screen.getByRole('button', { name: /Submit for review/i });
      fireEvent.click(submitBtn);
      expect(onSubmit).toHaveBeenCalledWith(inProgressTask);
    });

    it('triggers onApproveDelegatedTask and onReopenDelegatedTask in ReviewQueue', () => {
      const onApprove = vi.fn();
      const onReopen = vi.fn();

      render(
        <ReviewQueue
          delegatedTasks={[SAMPLE_REVIEWABLE_TASK]}
          onApprove={onApprove}
          onReopen={onReopen}
          onToast={vi.fn()}
        />,
      );

      const approveBtn = screen.getByRole('button', { name: /Approve/i });
      fireEvent.click(approveBtn);
      expect(onApprove).toHaveBeenCalledWith(SAMPLE_REVIEWABLE_TASK);

      const reopenBtn = screen.getByRole('button', { name: /Request changes/i });
      fireEvent.click(reopenBtn);
      expect(onReopen).toHaveBeenCalledWith(SAMPLE_REVIEWABLE_TASK);
    });
  });

  describe('CreateTaskDialog Integration in Workspace', () => {
    it('opens dialog when Add task button is clicked and submits personal task with exact date and time', async () => {
      const onCreatePersonal = vi.fn().mockResolvedValue(true);
      const onToast = vi.fn();

      render(
        <TasksWorkspace
          role="staff"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
          actions={{
            onCreatePersonal,
          }}
          onToast={onToast}
        />,
      );

      const addBtn = screen.getByRole('button', { name: /Add task/i });
      fireEvent.click(addBtn);

      expect(screen.getByText('New personal task')).toBeDefined();

      const titleInput = screen.getByPlaceholderText(/Call Aster Foods accountant/i);
      fireEvent.change(titleInput, { target: { value: 'Call GST auditor' } });

      const submitBtn = screen.getByRole('button', { name: /Schedule task/i });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(onCreatePersonal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Call GST auditor',
          dueTime: '18:00',
        }),
      );
      expect(screen.queryByText('New personal task')).toBeNull();
    });

    it('displays dialog error banner and does not close dialog when task creation returns false', async () => {
      const onCreatePersonal = vi.fn().mockResolvedValue(false);

      render(
        <TasksWorkspace
          role="staff"
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
          actions={{
            onCreatePersonal,
          }}
        />,
      );

      const addBtn = screen.getByRole('button', { name: /Add task/i });
      fireEvent.click(addBtn);

      const titleInput = screen.getByPlaceholderText(/Call Aster Foods accountant/i);
      fireEvent.change(titleInput, { target: { value: 'Valid Title' } });

      const submitBtn = screen.getByRole('button', { name: /Schedule task/i });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(onCreatePersonal).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/Failed to schedule personal task. Please check the entered fields and try again./i),
      ).toBeDefined();
      expect(screen.getByText('New personal task')).toBeDefined();
    });

    it('passes live client UUID to onCreatePersonal when a valid client is selected', async () => {
      const onCreatePersonal = vi.fn().mockResolvedValue(true);
      const LIVE_CLIENT_ID = '11111111-1111-4000-a000-111111111111';

      render(
        <TasksWorkspace
          role="staff"
          clients={[
            { id: LIVE_CLIENT_ID, name: 'Tata Consultancy Services', type: 'Public Limited' },
          ]}
          model={{
            personalTasks: [],
            assignedToMe: [],
            delegatedTasks: [],
            reviewableTasks: [],
            loading: false,
            hasLiveSnapshot: true,
          }}
          actions={{
            onCreatePersonal,
          }}
        />,
      );

      const addBtn = screen.getByRole('button', { name: /Add task/i });
      fireEvent.click(addBtn);

      const titleInput = screen.getByPlaceholderText(/Call Aster Foods accountant/i);
      fireEvent.change(titleInput, { target: { value: 'Prepare audit draft' } });

      const clientSelect = screen.getByLabelText(/Associated client/i);
      fireEvent.change(clientSelect, { target: { value: LIVE_CLIENT_ID } });

      const submitBtn = screen.getByRole('button', { name: /Schedule task/i });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(onCreatePersonal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Prepare audit draft',
          relatedClientId: LIVE_CLIENT_ID,
          relatedPartyName: 'Tata Consultancy Services',
        }),
      );
    });
  });

  describe('Pending state and double-click suppression', () => {
    it('disables TaskQueue action button and shows pending label while promise is in-flight', async () => {
      let resolveStart: (value: boolean) => void = () => {};
      const pendingPromise = new Promise<boolean>((resolve) => {
        resolveStart = resolve;
      });
      const onStartTask = vi.fn().mockReturnValue(pendingPromise);

      render(
        <TaskQueue
          tasks={[SAMPLE_ASSIGNED_TASK]}
          onStartTask={onStartTask}
          onToast={vi.fn()}
        />,
      );

      const startBtn = screen.getByRole('button', { name: /Start task/i });
      fireEvent.click(startBtn);

      // Immediately entering pending state
      expect(onStartTask).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /Starting.../i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Starting.../i }).hasAttribute('disabled')).toBe(true);

      // Subsequent click suppressed while in-flight
      fireEvent.click(screen.getByRole('button', { name: /Starting.../i }));
      expect(onStartTask).toHaveBeenCalledTimes(1);

      // Resolve async operation
      await act(async () => {
        resolveStart(true);
      });

      // Cleared after settlement
      expect(screen.queryByRole('button', { name: /Starting.../i })).toBeNull();
      expect(screen.getByRole('button', { name: /Start task/i })).toBeDefined();
    });

    it('disables ReviewQueue action buttons and shows pending label while promise is in-flight', async () => {
      let resolveApprove: (value: boolean) => void = () => {};
      const pendingPromise = new Promise<boolean>((resolve) => {
        resolveApprove = resolve;
      });
      const onApprove = vi.fn().mockReturnValue(pendingPromise);

      render(
        <ReviewQueue
          delegatedTasks={[SAMPLE_REVIEWABLE_TASK]}
          onApprove={onApprove}
          onReopen={vi.fn()}
          onToast={vi.fn()}
        />,
      );

      const approveBtn = screen.getByRole('button', { name: /Approve/i });
      const reopenBtn = screen.getByRole('button', { name: /Request changes/i });

      fireEvent.click(approveBtn);

      expect(onApprove).toHaveBeenCalledTimes(1);
      // Approving button displays pending copy and is disabled
      const pendingBtn = screen.getByRole('button', { name: /Approving.../i });
      expect(pendingBtn).toBeDefined();
      expect(pendingBtn.hasAttribute('disabled')).toBe(true);

      // Reopen button remains 'Request changes' but is disabled
      expect(reopenBtn.hasAttribute('disabled')).toBe(true);

      // Settle
      await act(async () => {
        resolveApprove(true);
      });

      expect(screen.queryByRole('button', { name: /Approving.../i })).toBeNull();
      expect(screen.getByRole('button', { name: /Approve/i })).toBeDefined();
    });
  });

  describe('Form state retention across option changes in CreateTaskDialog', () => {
    it('preserves user typed title and instructions when options change reference', () => {
      const initialAssignments = [
        {
          id: 'ASN-0001',
          title: 'October GST Return',
          client: 'Aster Foods',
          clientId: 'CLI-0001',
          service: 'GST',
          due: '11/11/2026',
          owner: 'Rohan Mehta',
          reviewer: 'Priya Desai',
          status: 'In progress',
          progress: 50,
          tone: 'default' as const,
        },
      ];

      const initialLines = [
        {
          employee: { id: 'emp_trn', name: 'Neha Kapoor', role: 'trainee' as const, reportsToId: 'emp_stf' },
          manager: { id: 'emp_stf', name: 'Rohan Mehta', role: 'staff' as const, reportsToId: 'emp_mgr' },
        },
      ];

      const { rerender } = render(
        <CreateTaskDialog
          isOpen={true}
          mode="delegated"
          role="staff"
          assignments={initialAssignments}
          reportingLines={initialLines}
          onClose={vi.fn()}
        />,
      );

      const titleInput = screen.getByLabelText(/Sub-task title/i) as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'My custom subtask draft' } });

      const notesInput = screen.getByLabelText(/Instructions & Evidence checklist/i) as HTMLTextAreaElement;
      fireEvent.change(notesInput, { target: { value: 'Important review instructions' } });

      expect(titleInput.value).toBe('My custom subtask draft');
      expect(notesInput.value).toBe('Important review instructions');

      // Rerender with fresh array references but same content (simulating parent re-render)
      rerender(
        <CreateTaskDialog
          isOpen={true}
          mode="delegated"
          role="staff"
          assignments={[...initialAssignments]}
          reportingLines={[...initialLines]}
          onClose={vi.fn()}
        />,
      );

      // Verify values were NOT wiped
      expect(titleInput.value).toBe('My custom subtask draft');
      expect(notesInput.value).toBe('Important review instructions');
    });
  });
});
