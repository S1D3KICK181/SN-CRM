// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DelegatedTaskRecord, PersonalTaskRecord } from '../../data';
import { DelegatedWork, PersonalTasks, ReviewQueue, TaskQueue } from '../../app';

afterEach(() => {
  cleanup();
});

const TODO_TASK: DelegatedTaskRecord = {
  id: 'wrk_todo_1',
  kind: 'delegated',
  title: 'Check vendor purchase vouchers',
  parent: 'ASN-0001 · October GST',
  parentAssignmentId: 'ASN-0001',
  person: 'Rohan Mehta',
  assigneeId: 'usr_staff',
  assignedBy: 'Priya Desai',
  createdById: 'usr_senior',
  due: 'Tomorrow',
  progress: 0,
  status: 'To Do',
  tone: 'default',
  instructions: 'Verify tax invoice copies against register',
};

const IN_PROGRESS_TASK: DelegatedTaskRecord = {
  id: 'wrk_prog_1',
  kind: 'delegated',
  title: 'Vouch petty cash expenses',
  parent: 'ASN-0002 · Q2 Audit',
  parentAssignmentId: 'ASN-0002',
  person: 'Rohan Mehta',
  assigneeId: 'usr_staff',
  assignedBy: 'Priya Desai',
  createdById: 'usr_senior',
  due: 'Today',
  progress: 50,
  status: 'In Progress',
  tone: 'default',
};

const PENDING_REVIEW_TASK: DelegatedTaskRecord = {
  id: 'wrk_review_1',
  kind: 'delegated',
  title: 'Draft fixed asset reconciliation',
  parent: 'ASN-0002 · Q2 Audit',
  parentAssignmentId: 'ASN-0002',
  person: 'Rohan Mehta',
  assigneeId: 'usr_staff',
  assignedBy: 'Priya Desai',
  createdById: 'usr_senior',
  due: 'Today',
  progress: 90,
  status: 'Pending Review',
  tone: 'warning',
};

const COMPLETED_TASK: DelegatedTaskRecord = {
  id: 'wrk_done_1',
  kind: 'delegated',
  title: 'Download October GSTR-2B JSON',
  parent: 'ASN-0001 · October GST',
  parentAssignmentId: 'ASN-0001',
  person: 'Neha Kapoor',
  assigneeId: 'usr_trainee',
  assignedBy: 'Priya Desai',
  createdById: 'usr_senior',
  due: 'Yesterday',
  progress: 100,
  status: 'Completed',
  tone: 'success',
};

describe('Work Items UI components', () => {
  describe('TaskQueue assigned-to-me lifecycle', () => {
    it('renders task for any persona without hardcoding "Neha Kapoor"', () => {
      render(
        <TaskQueue
          tasks={[TODO_TASK]}
          onToast={vi.fn()}
        />,
      );

      expect(screen.getByText('Check vendor purchase vouchers')).toBeDefined();
      expect(screen.getByText(/ASN-0001 · October GST/i)).toBeDefined();
    });

    it('renders "Start task" for a task in "To Do" status and calls onStartTask', () => {
      const onStartTask = vi.fn();
      render(
        <TaskQueue
          tasks={[TODO_TASK]}
          onStartTask={onStartTask}
          onToast={vi.fn()}
        />,
      );

      const startButton = screen.getByRole('button', { name: /Start task/i });
      expect(startButton).toBeDefined();
      fireEvent.click(startButton);
      expect(onStartTask).toHaveBeenCalledWith(TODO_TASK);
    });

    it('renders "Submit for review" for a task in "In Progress" status and calls onSubmitForReview', () => {
      const onSubmitForReview = vi.fn();
      render(
        <TaskQueue
          tasks={[IN_PROGRESS_TASK]}
          onSubmitForReview={onSubmitForReview}
          onToast={vi.fn()}
        />,
      );

      const submitButton = screen.getByRole('button', { name: /Submit for review/i });
      expect(submitButton).toBeDefined();
      fireEvent.click(submitButton);
      expect(onSubmitForReview).toHaveBeenCalledWith(IN_PROGRESS_TASK);
    });

    it('renders NO action button for tasks in "Pending Review" or "Completed"', () => {
      render(
        <TaskQueue
          tasks={[PENDING_REVIEW_TASK, COMPLETED_TASK]}
          onStartTask={vi.fn()}
          onSubmitForReview={vi.fn()}
          onToast={vi.fn()}
        />,
      );

      expect(screen.queryByRole('button', { name: /Start task/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Submit for review/i })).toBeNull();
    });
  });

  describe('ReviewQueue lifecycle', () => {
    it('renders "Approve" and "Request changes" buttons for ready_for_review items', () => {
      const onApprove = vi.fn();
      const onReopen = vi.fn();

      render(
        <ReviewQueue
          delegatedTasks={[PENDING_REVIEW_TASK]}
          onApprove={onApprove}
          onReopen={onReopen}
          onToast={vi.fn()}
        />,
      );

      expect(screen.getByText('Draft fixed asset reconciliation')).toBeDefined();

      const approveButton = screen.getByRole('button', { name: /Approve/i });
      expect(approveButton).toBeDefined();
      fireEvent.click(approveButton);
      expect(onApprove).toHaveBeenCalledWith(PENDING_REVIEW_TASK);

      const reopenButton = screen.getByRole('button', { name: /Request changes|Reopen/i });
      expect(reopenButton).toBeDefined();
      fireEvent.click(reopenButton);
      expect(onReopen).toHaveBeenCalledWith(PENDING_REVIEW_TASK);
    });
  });

  describe('PersonalTasks checkbox toggle', () => {
    it('calls onToggle with task id on check or uncheck', () => {
      const onToggle = vi.fn();
      const personalTask: PersonalTaskRecord = {
        id: 'TSK-P-01',
        title: 'Review BluePeak findings',
        context: 'BluePeak',
        time: 'Today · 15:00',
        done: false,
      };

      render(
        <PersonalTasks
          tasks={[personalTask]}
          onToggle={onToggle}
        />,
      );

      const checkbox = screen.getByRole('checkbox');
      expect((checkbox as HTMLInputElement).checked).toBe(false);
      fireEvent.click(checkbox);
      expect(onToggle).toHaveBeenCalledWith('TSK-P-01');
    });
  });

  describe('DelegatedWork component', () => {
    it('renders tasks without hardcoded person filters', () => {
      render(
        <DelegatedWork
          tasks={[TODO_TASK, IN_PROGRESS_TASK]}
          onAdd={vi.fn()}
        />,
      );

      expect(screen.getByText('Check vendor purchase vouchers')).toBeDefined();
      expect(screen.getByText('Vouch petty cash expenses')).toBeDefined();
    });
  });

  describe('Slice 1C: Internal Office Tasks UI rendering and actions', () => {
    const INTERNAL_TODO_TASK: DelegatedTaskRecord = {
      id: 'wrk_int_ui_1',
      kind: 'internal',
      title: 'Sort physical vendor vouchers in cabinet A',
      parent: 'Internal Office Work',
      person: 'Rohan Mehta',
      assigneeId: 'usr_staff',
      assignedBy: 'Ananya Rao',
      createdById: 'usr_manager',
      due: 'Tomorrow',
      progress: 0,
      status: 'To Do',
      tone: 'default',
      instructions: 'Sort by date ascending',
    };

    const INTERNAL_IN_PROGRESS_TASK: DelegatedTaskRecord = {
      ...INTERNAL_TODO_TASK,
      id: 'wrk_int_ui_2',
      status: 'In Progress',
      progress: 50,
    };

    const INTERNAL_PENDING_REVIEW_TASK: DelegatedTaskRecord = {
      ...INTERNAL_TODO_TASK,
      id: 'wrk_int_ui_3',
      status: 'Pending Review',
      progress: 90,
      tone: 'warning',
    };

    it('renders internal task in TaskQueue with "Internal Office Work" and "Office" badge', () => {
      render(<TaskQueue tasks={[INTERNAL_TODO_TASK]} onToast={vi.fn()} />);

      expect(screen.getByText('Sort physical vendor vouchers in cabinet A')).toBeDefined();
      expect(screen.getByText(/Internal Office Work/i)).toBeDefined();
      expect(screen.getByText('Office')).toBeDefined();
    });

    it('executes start and submit actions on internal task in TaskQueue', () => {
      const onStartTask = vi.fn();
      const onSubmitForReview = vi.fn();

      const { rerender } = render(
        <TaskQueue
          tasks={[INTERNAL_TODO_TASK]}
          onStartTask={onStartTask}
          onSubmitForReview={onSubmitForReview}
          onToast={vi.fn()}
        />,
      );

      const startBtn = screen.getByRole('button', { name: /Start task/i });
      fireEvent.click(startBtn);
      expect(onStartTask).toHaveBeenCalledWith(INTERNAL_TODO_TASK);

      rerender(
        <TaskQueue
          tasks={[INTERNAL_IN_PROGRESS_TASK]}
          onStartTask={onStartTask}
          onSubmitForReview={onSubmitForReview}
          onToast={vi.fn()}
        />,
      );

      const submitBtn = screen.getByRole('button', { name: /Submit for review/i });
      fireEvent.click(submitBtn);
      expect(onSubmitForReview).toHaveBeenCalledWith(INTERNAL_IN_PROGRESS_TASK);
    });

    it('renders submitted internal task in ReviewQueue and supports Approve and Request changes', () => {
      const onApprove = vi.fn();
      const onReopen = vi.fn();

      render(
        <ReviewQueue
          delegatedTasks={[INTERNAL_PENDING_REVIEW_TASK]}
          onApprove={onApprove}
          onReopen={onReopen}
          onToast={vi.fn()}
        />,
      );

      expect(screen.getByText('Sort physical vendor vouchers in cabinet A')).toBeDefined();

      const approveBtn = screen.getByRole('button', { name: /Approve/i });
      fireEvent.click(approveBtn);
      expect(onApprove).toHaveBeenCalledWith(INTERNAL_PENDING_REVIEW_TASK);

      const requestChangesBtn = screen.getByRole('button', { name: /Request changes/i });
      fireEvent.click(requestChangesBtn);
      expect(onReopen).toHaveBeenCalledWith(INTERNAL_PENDING_REVIEW_TASK);
    });

    it('renders updated DelegatedWork description covering sub-tasks and office operations', () => {
      render(
        <DelegatedWork
          tasks={[INTERNAL_TODO_TASK]}
          onAdd={vi.fn()}
        />,
      );

      expect(
        screen.getByText(/Sub-tasks and office operations delegated to team/i),
      ).toBeDefined();
    });

    it('renders "+ Office task" button in DelegatedWork for non-trainee roles and calls onAddInternal', () => {
      const onAdd = vi.fn();
      const onAddInternal = vi.fn();

      render(
        <DelegatedWork
          tasks={[INTERNAL_TODO_TASK]}
          onAdd={onAdd}
          onAddInternal={onAddInternal}
          role="manager"
        />,
      );

      const subTaskBtn = screen.getByRole('button', { name: /Sub-task/i });
      expect(subTaskBtn).toBeDefined();

      const officeTaskBtn = screen.getByRole('button', { name: /Office task/i });
      expect(officeTaskBtn).toBeDefined();
      fireEvent.click(officeTaskBtn);
      expect(onAddInternal).toHaveBeenCalledTimes(1);
    });

    it('hides "+ Office task" button in DelegatedWork when onAddInternal is omitted or role is trainee', () => {
      const onAdd = vi.fn();

      const { rerender } = render(
        <DelegatedWork
          tasks={[INTERNAL_TODO_TASK]}
          onAdd={onAdd}
        />,
      );

      expect(screen.queryByRole('button', { name: /Office task/i })).toBeNull();

      rerender(
        <DelegatedWork
          tasks={[INTERNAL_TODO_TASK]}
          onAdd={onAdd}
          onAddInternal={vi.fn()}
          role="trainee"
        />,
      );

      expect(screen.queryByRole('button', { name: /Office task/i })).toBeNull();
    });
  });
});
