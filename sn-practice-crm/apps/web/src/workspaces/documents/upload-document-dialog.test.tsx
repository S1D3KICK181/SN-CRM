// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DOCUMENT_MAX_BYTES, type ClientDto } from '@sn/contracts';
import { DocumentsOperationError, currentFinancialYearStart, financialYearLabel } from '../../api/documents-types';
import type { UploadDocumentInput } from '../../api/use-documents';
import { UploadDocumentDialog, uploadClientOptions } from './upload-document-dialog';

afterEach(cleanup);

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function client(id: string, code: string, displayName: string, overrides: Partial<ClientDto> = {}): ClientDto {
  return {
    id,
    code,
    displayName,
    legalName: null,
    gstinMasked: null,
    panMasked: null,
    email: null,
    phone: null,
    relationshipOwnerId: null,
    relationshipOwnerName: null,
    status: 'active',
    notes: null,
    activeAssignmentsCount: 0,
    pan: null,
    gstin: null,
    entityType: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    pincode: null,
    tan: null,
    cinLlpin: null,
    udyamNumber: null,
    iec: null,
    incorporationDate: null,
    contacts: [],
    canEdit: true,
    canChangeOwnerOrStatus: false,
    looksAfter: true,
    createdById: '20000000-0000-4000-a000-000000000001',
    createdAt: '2026-10-01T04:30:00.000Z',
    updatedAt: '2026-10-01T04:30:00.000Z',
    ...overrides,
  };
}

const ASTER = client('10000000-0000-4000-a000-000000000001', 'CL-000001', 'Aster Foods');
const BOLT = client('10000000-0000-4000-a000-000000000002', 'CL-000002', 'Bolt Traders');
const CLIENTS = [ASTER, BOLT];

type Submit = (input: UploadDocumentInput, key: string) => Promise<void>;

function setup(onSubmit: Submit = vi.fn().mockResolvedValue(undefined), clients: readonly ClientDto[] = CLIENTS) {
  const onClose = vi.fn();
  render(<UploadDocumentDialog open clients={clients} onClose={onClose} onSubmit={onSubmit} />);
  return { onClose, onSubmit };
}

const uploadButton = () => screen.getByRole('button', { name: /^(Upload|Uploading…)$/ }) as HTMLButtonElement;
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pickFile = (file: File) => fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
const pdf = (name = 'Balance sheet FY25.pdf', content = '%PDF-1.4') => new File([content], name, { type: 'application/pdf' });

function fillValid(file: File = pdf()) {
  choose('Client', ASTER.id);
  pickFile(file);
  choose('Category', 'financial_statements');
}

describe('UploadDocumentDialog', () => {
  it('renders nothing when closed', () => {
    render(<UploadDocumentDialog open={false} clients={CLIENTS} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title, the fields, the file hint and the buttons', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Upload document' });
    for (const label of ['Client', 'Title', 'Category', 'Financial year', 'File']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(dialog.textContent).toContain('PDF, JPG, PNG, Excel, CSV or Word, up to 25 MB.');
    const input = screen.getByLabelText('File') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('.pdf');
    expect(input.accept).toContain('.docx');
    expect(input.getAttribute('aria-describedby')).toBe('document-file-hint');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(uploadButton().textContent).toBe('Upload');
  });

  it('lists the clients as code and name, never an id', () => {
    setup();
    const options = [...(screen.getByLabelText('Client') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Choose a client', 'CL-000001 · Aster Foods', 'CL-000002 · Bolt Traders']);
    expect(document.body.textContent).not.toMatch(UUID_PATTERN);
  });

  it('offers the categories by label', () => {
    setup();
    const options = [...(screen.getByLabelText('Category') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual([
      'Choose a category',
      'KYC',
      'Financial statements',
      'Returns filed',
      'Acknowledgements',
      'Agreements',
      'Correspondence',
      'Other',
    ]);
  });

  it('offers the current financial year and seven before it, plus a choice for none', () => {
    setup();
    const options = [...(screen.getByLabelText('Financial year') as HTMLSelectElement).options];
    const current = currentFinancialYearStart();
    expect(options).toHaveLength(9);
    expect(options[0]?.value).toBe('');
    expect(options[1]?.textContent).toBe(financialYearLabel(current));
    expect(options[8]?.textContent).toBe(financialYearLabel(current - 7));
  });

  it('puts the file name without its extension in the title, and keeps a title the user typed', () => {
    setup();
    pickFile(pdf('Balance sheet FY25.pdf'));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Balance sheet FY25');

    // A later file replaces a title that was only the earlier file name.
    pickFile(pdf('Notice.pdf'));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Notice');

    choose('Title', 'My own title');
    pickFile(pdf('Another.pdf'));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('My own title');
  });

  it('does not overwrite a title typed before the file is chosen', () => {
    setup();
    choose('Title', 'Typed first');
    pickFile(pdf('Late file.pdf'));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Typed first');
  });

  it('shows every message on an empty submit and sends nothing', () => {
    const { onSubmit } = setup();
    fireEvent.click(uploadButton());
    expect(screen.getByText('Choose a file to upload.')).toBeTruthy();
    expect(screen.getByText('Enter a title of 2 to 160 characters.')).toBeTruthy();
    expect(screen.getByText('Choose a category.')).toBeTruthy();
    expect(screen.getByText('Choose a client.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Please correct the highlighted fields.');
    expect(screen.getByLabelText('File').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses an empty file', () => {
    const { onSubmit } = setup();
    fillValid(new File([], 'empty.pdf', { type: 'application/pdf' }));
    fireEvent.click(uploadButton());
    expect(screen.getByText('The file is empty.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a file over 25 MB and accepts one of exactly 25 MB', async () => {
    const { onSubmit } = setup();
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: DOCUMENT_MAX_BYTES + 1 });
    fillValid(big);
    fireEvent.click(uploadButton());
    expect(screen.getByText('The file is larger than 25 MB.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    const exact = new File(['x'], 'exact.pdf', { type: 'application/pdf' });
    Object.defineProperty(exact, 'size', { value: DOCUMENT_MAX_BYTES });
    pickFile(exact);
    fireEvent.click(uploadButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('refuses a file of another type', () => {
    const { onSubmit } = setup();
    fillValid(new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' }));
    fireEvent.click(uploadButton());
    expect(screen.getByText('Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a file with no extension', () => {
    setup();
    fillValid(new File(['x'], 'README', { type: 'application/pdf' }));
    fireEvent.click(uploadButton());
    expect(screen.getByText('Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.')).toBeTruthy();
  });

  it.each([
    ['one character', 'X', false],
    ['a blank title', '   ', false],
    ['161 characters', 'x'.repeat(161), false],
    ['2 characters', 'ID', true],
    ['160 characters', 'x'.repeat(160), true],
  ])('checks the title length: %s', async (_label, value, valid) => {
    const { onSubmit } = setup();
    fillValid();
    choose('Title', value);
    fireEvent.click(uploadButton());
    if (valid) {
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    } else {
      expect(screen.getByText('Enter a title of 2 to 160 characters.')).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it('refuses a missing category', () => {
    const { onSubmit } = setup();
    choose('Client', ASTER.id);
    pickFile(pdf());
    fireEvent.click(uploadButton());
    expect(screen.getByText('Choose a category.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends the trimmed values, the year and the file, then closes', async () => {
    const { onSubmit, onClose } = setup();
    const file = pdf();
    fillValid(file);
    choose('Title', '  Balance sheet 2025  ');
    choose('Financial year', '2025');
    fireEvent.click(uploadButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      {
        clientId: ASTER.id,
        title: 'Balance sheet 2025',
        category: 'financial_statements',
        financialYearStart: 2025,
        file,
      },
      expect.any(String),
    );
  });

  it('sends no financial year when none is chosen', async () => {
    const { onSubmit } = setup();
    fillValid();
    fireEvent.click(uploadButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(onSubmit).mock.calls[0]?.[0].financialYearStart).toBeNull();
  });

  it('shows Uploading… with the file name while saving and blocks a second submit', async () => {
    let resolve: () => void = () => undefined;
    const onSubmit = vi.fn<Submit>(() => new Promise<void>((r) => (resolve = r)));
    const { onClose } = setup(onSubmit);
    fillValid(pdf('Notice.pdf'));
    fireEvent.click(uploadButton());

    await waitFor(() => expect(uploadButton().textContent).toBe('Uploading…'));
    expect(uploadButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Uploading Notice.pdf…');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form') as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['file_too_large', 'The file is larger than 25 MB.'],
    ['file_type_not_allowed', 'Only PDF, JPG, PNG, Excel, CSV and Word files can be uploaded.'],
    ['upload_missing', 'The file did not finish uploading. Try again.'],
  ])('shows the copy for the server code %s', async (serverCode, message) => {
    const onSubmit = vi
      .fn<Submit>()
      .mockRejectedValue(new DocumentsOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode }));
    const { onClose } = setup(onSubmit);
    fillValid();
    fireEvent.click(uploadButton());
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(onClose).not.toHaveBeenCalled();
    expect(uploadButton().disabled).toBe(false);
  });

  it('shows the storage copy when the file could not be stored', async () => {
    const onSubmit = vi.fn<Submit>().mockRejectedValue(new DocumentsOperationError({ code: 'storage', message: 'raw' }));
    setup(onSubmit);
    fillValid();
    fireEvent.click(uploadButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The file could not be uploaded. Check your connection and try again.',
    );
  });

  it('shows the permission copy for a 403 and a not-found copy for a 404', async () => {
    const onSubmit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new DocumentsOperationError({ code: 'forbidden', message: 'raw', status: 403 }))
      .mockRejectedValueOnce(new DocumentsOperationError({ code: 'not_found', message: 'raw', status: 404 }));
    setup(onSubmit);
    fillValid();
    fireEvent.click(uploadButton());
    expect((await screen.findByRole('alert')).textContent).toBe("You don't have permission to do this.");
    fireEvent.click(uploadButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The client or document could not be found.'));
  });

  it('reuses the key on an unchanged retry and mints a new one when a field changed', async () => {
    const onSubmit = vi
      .fn<Submit>()
      .mockRejectedValueOnce(new DocumentsOperationError({ code: 'storage', message: 'raw' }))
      .mockRejectedValueOnce(new DocumentsOperationError({ code: 'storage', message: 'raw' }))
      .mockResolvedValue(undefined);
    setup(onSubmit);
    fillValid();
    fireEvent.click(uploadButton());
    await screen.findByRole('alert');
    fireEvent.click(uploadButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    const first = onSubmit.mock.calls[0]?.[1];
    expect(onSubmit.mock.calls[1]?.[1]).toBe(first);

    await waitFor(() => expect(uploadButton().disabled).toBe(false));
    choose('Title', 'A different title');
    fireEvent.click(uploadButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2]?.[1]).not.toBe(first);
  });

  it('closes on Cancel and on Escape', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('uploadClientOptions', () => {
  it('offers the clients the reader looks after, and falls back to the whole list', () => {
    const own = client('10000000-0000-4000-a000-000000000003', 'CL-000003', 'Own', { canEdit: true, looksAfter: true });
    const other = client('10000000-0000-4000-a000-000000000004', 'CL-000004', 'Other', { canEdit: false, looksAfter: false });
    const seen = client('10000000-0000-4000-a000-000000000005', 'CL-000005', 'Seen', { canEdit: false, looksAfter: true });
    // A department head can read this client, even edit-free, but does not look after it: no uploads.
    const headOnly = client('10000000-0000-4000-a000-000000000006', 'CL-000006', 'Read only', { canEdit: false, looksAfter: false });
    expect(uploadClientOptions([own, other, seen, headOnly])).toEqual([own, seen]);
    expect(uploadClientOptions([other])).toEqual([other]);
    expect(uploadClientOptions([])).toEqual([]);
  });
});
