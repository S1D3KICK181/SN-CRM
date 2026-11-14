// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DepartmentDto } from '@sn/contracts';
import { DepartmentsOperationError } from '../../api/departments-types';
import {
  DepartmentDialog,
  DepartmentMembersDialog,
  type DepartmentEmployeeOption,
  type DepartmentFormInput,
  type DepartmentMembersInput,
} from './department-dialog';

afterEach(cleanup);

const ANANYA = '00000000-0000-4000-a000-000000000003';
const ROHAN = '00000000-0000-4000-a000-000000000004';
const NEHA = '00000000-0000-4000-a000-000000000005';
const PRIYA = '00000000-0000-4000-a000-000000000002';

const DEPARTMENT: DepartmentDto = {
  id: '60000000-0000-4000-a000-000000000001',
  name: 'Audit',
  isActive: true,
  members: [
    { userId: ANANYA, name: 'Ananya Rao', role: 'senior_staff', isHead: true },
    { userId: NEHA, name: 'Neha Kapoor', role: 'trainee', isHead: false },
  ],
  serviceIds: [],
  createdAt: '2026-11-01T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

const EMPLOYEES: DepartmentEmployeeOption[] = [
  { id: ANANYA, name: 'Ananya Rao', role: 'senior_staff' },
  { id: ROHAN, name: 'Rohan Mehta', role: 'staff' },
  { id: NEHA, name: 'Neha Kapoor', role: 'trainee' },
  { id: PRIYA, name: 'Priya Desai', role: 'manager' },
];

describe('DepartmentDialog', () => {
  type Submit = (input: DepartmentFormInput, key: string) => Promise<void>;

  function setup(department: DepartmentDto | null = null, onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
    const onClose = vi.fn();
    render(<DepartmentDialog open department={department} onClose={onClose} onSubmit={onSubmit} />);
    return { onClose, onSubmit };
  }

  const save = () => screen.getByRole('button', { name: /^(Save department|Saving…)$/ }) as HTMLButtonElement;
  const typeName = (value: string) => fireEvent.change(screen.getByLabelText('Name'), { target: { value } });

  it('renders nothing when closed', () => {
    render(<DepartmentDialog open={false} department={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for the name only, and titles the dialog for adding or editing', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Add department' })).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    cleanup();
    setup(DEPARTMENT);
    expect(screen.getByRole('dialog', { name: 'Edit Audit' })).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Audit');
  });

  it('submits the trimmed name and closes on success', async () => {
    const { onSubmit, onClose } = setup();
    typeName('  Accounts and Registrations ');
    fireEvent.click(save());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Accounts and Registrations' }, expect.any(String));
  });

  it.each(['', ' a ', 'x'.repeat(81)])('refuses the name "%s" without saving', (value) => {
    const { onSubmit } = setup();
    typeName(value);
    fireEvent.click(save());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a department name of 2 to 80 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the duplicate-name message with the typed name and keeps the dialog open', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new DepartmentsOperationError({ code: 'unexpected', message: 'raw', status: 409, serverCode: 'duplicate_department' }));
    const { onClose } = setup(null, onSubmit);
    typeName('Audit');
    fireEvent.click(save());
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('A department named Audit already exists.'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reuses the key for an unchanged retry and mints a new one when the name changes', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new DepartmentsOperationError({ code: 'network', message: 'down' }))
      .mockRejectedValueOnce(new DepartmentsOperationError({ code: 'network', message: 'down' }))
      .mockResolvedValue(undefined);
    setup(null, onSubmit);
    typeName('Audit');
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save().disabled).toBe(false));
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);
    await waitFor(() => expect(save().disabled).toBe(false));
    typeName('Audit and Assurance');
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it('closes on Escape and on Cancel', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('DepartmentMembersDialog', () => {
  type Submit = (input: DepartmentMembersInput, key: string) => Promise<void>;

  function setup(onSubmit: Submit = vi.fn().mockResolvedValue(undefined), department: DepartmentDto | null = DEPARTMENT) {
    const onClose = vi.fn();
    render(
      <DepartmentMembersDialog open department={department} employees={EMPLOYEES} onClose={onClose} onSubmit={onSubmit} />,
    );
    return { onClose, onSubmit };
  }

  const member = (name: string) => screen.getByLabelText(new RegExp(`^${name}`)) as HTMLInputElement;
  const head = (name: string) => screen.queryByLabelText(`Head, ${name}`) as HTMLInputElement | null;
  const save = () => screen.getByRole('button', { name: /^(Save members|Saving…)$/ }) as HTMLButtonElement;

  it('renders nothing when closed or without a department', () => {
    render(
      <DepartmentMembersDialog open={false} department={DEPARTMENT} employees={EMPLOYEES} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    render(
      <DepartmentMembersDialog open department={null} employees={EMPLOYEES} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every active employee by name and role, with the current members checked', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Members of Audit' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Ananya RaoSenior StaffHead',
      'Neha KapoorTraineeTrainees can\'t be heads.Head',
      'Priya DesaiManager',
      'Rohan MehtaStaff',
    ]);
    expect(member('Ananya Rao').checked).toBe(true);
    expect(member('Neha Kapoor').checked).toBe(true);
    expect(member('Priya Desai').checked).toBe(false);
    expect(member('Rohan Mehta').checked).toBe(false);
  });

  it('offers the Head checkbox only to checked people, with the saved heads ticked', () => {
    setup();
    expect(head('Ananya Rao')?.checked).toBe(true);
    expect(head('Priya Desai')).toBeNull();
    expect(head('Rohan Mehta')).toBeNull();
    fireEvent.click(member('Rohan Mehta'));
    expect(head('Rohan Mehta')?.checked).toBe(false);
    expect(head('Rohan Mehta')?.disabled).toBe(false);
  });

  it('disables Head for a trainee and explains why', () => {
    setup();
    const trainee = head('Neha Kapoor')!;
    expect(trainee.disabled).toBe(true);
    expect(trainee.checked).toBe(false);
    expect(trainee.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText("Trainees can't be heads.").id).toBe(trainee.getAttribute('aria-describedby'));
  });

  it('sends the whole membership: allows several heads, and drops a person who is unchecked', async () => {
    const { onSubmit, onClose } = setup();
    fireEvent.click(member('Rohan Mehta'));
    fireEvent.click(head('Rohan Mehta')!);
    fireEvent.click(member('Priya Desai'));
    fireEvent.click(member('Neha Kapoor')); // leaves the department
    fireEvent.click(save());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        members: [
          { userId: ANANYA, isHead: true },
          { userId: PRIYA, isHead: false },
          { userId: ROHAN, isHead: true },
        ],
      },
      expect.any(String),
    );
  });

  it('clears the head flag when a person is unchecked and checked again', async () => {
    const { onSubmit } = setup();
    fireEvent.click(member('Ananya Rao'));
    fireEvent.click(member('Ananya Rao'));
    expect(head('Ananya Rao')?.checked).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      members: [
        { userId: ANANYA, isHead: false },
        { userId: NEHA, isHead: false },
      ],
    });
  });

  it('can empty the department', async () => {
    const { onSubmit } = setup();
    fireEvent.click(member('Ananya Rao'));
    fireEvent.click(member('Neha Kapoor'));
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ members: [] }, expect.any(String)));
  });

  it('keeps a current member who is missing from the employee list, so a save never drops them silently', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <DepartmentMembersDialog
        open
        department={DEPARTMENT}
        employees={[{ id: ROHAN, name: 'Rohan Mehta', role: 'staff' }]}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(member('Ananya Rao').checked).toBe(true);
    fireEvent.click(save());
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { members: [{ userId: ANANYA, isHead: true }, { userId: NEHA, isHead: false }] },
        expect.any(String),
      ),
    );
  });

  it('shows a safe message and stays open when the save fails', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new DepartmentsOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode: 'trainee_cannot_head' }));
    const { onClose } = setup(onSubmit);
    fireEvent.click(save());
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe("Trainees can't be heads."));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never shows a raw id', () => {
    setup();
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(document.body.textContent ?? '')).toBe(
      false,
    );
  });
});
