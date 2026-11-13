// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentsOperationError } from '../../api/documents-types';
import { RemoveDocumentDialog } from './remove-document-dialog';

afterEach(cleanup);

type Submit = (reason: string, key: string) => Promise<void>;

function setup(onSubmit: Submit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<RemoveDocumentDialog open documentTitle="Balance sheet" onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const removeButton = () => screen.getByRole('button', { name: /^(Remove document|Removing…)$/ }) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(screen.getByLabelText('Reason'), { target: { value } });

describe('RemoveDocumentDialog', () => {
  it('renders nothing when closed', () => {
    render(<RemoveDocumentDialog open={false} documentTitle="X" onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title, the explanation and the two buttons', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Remove Balance sheet?' });
    expect(dialog.textContent).toContain(
      'It will no longer appear in the documents list. The file is kept on record and can be recovered by the Founder if needed.',
    );
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
    expect(removeButton().textContent).toBe('Remove document');
  });

  it.each([
    ['empty', ''],
    ['two characters', 'ab'],
    ['blank', '    '],
    ['501 characters', 'x'.repeat(501)],
  ])('refuses a reason that is %s', (_label, value) => {
    const { onSubmit } = setup();
    type(value);
    fireEvent.click(removeButton());
    expect(screen.getByText('Give a reason of at least 3 characters.')).toBeTruthy();
    expect(screen.getByLabelText('Reason').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason and closes', async () => {
    const { onSubmit, onClose } = setup();
    type('  Wrong client  ');
    fireEvent.click(removeButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('Wrong client', expect.any(String));
  });

  it('accepts 3 and 500 characters', async () => {
    const { onSubmit } = setup();
    type('abc');
    fireEvent.click(removeButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    type('x'.repeat(500));
    fireEvent.click(removeButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });

  it('shows the server copy in an alert, stays open, and reuses the key on an unchanged retry', async () => {
    const onSubmit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(
        new DocumentsOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode: 'already_removed' }),
      )
      .mockResolvedValue(undefined);
    const { onClose } = setup(onSubmit);
    type('Wrong client');
    fireEvent.click(removeButton());
    expect((await screen.findByRole('alert')).textContent).toBe('This document is already removed.');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(removeButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[1]?.[1]).toBe(onSubmit.mock.calls[0]?.[1]);
  });

  it('closes with Keep it', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
