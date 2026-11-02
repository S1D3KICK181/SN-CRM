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
});
