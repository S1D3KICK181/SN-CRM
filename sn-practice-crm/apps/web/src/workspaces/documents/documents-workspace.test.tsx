// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClientDocumentDto, ClientDto } from '@sn/contracts';
import { DocumentsOperationError } from '../../api/documents-types';
import { DocumentsWorkspace, type DocumentsActions, type DocumentsWorkspaceProps } from './documents-workspace';

afterEach(cleanup);

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function client(id: string, code: string, displayName: string): ClientDto {
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
  };
}

const ASTER = client('10000000-0000-4000-a000-000000000001', 'CL-000001', 'Aster Foods');
const BOLT = client('10000000-0000-4000-a000-000000000002', 'CL-000002', 'Bolt Traders');

function doc(overrides: Partial<ClientDocumentDto> = {}): ClientDocumentDto {
  return {
    id: '70000000-0000-4000-a000-000000000001',
    clientId: ASTER.id,
    clientCode: 'CL-000001',
    clientName: 'Aster Foods',
    title: 'Balance sheet',
    category: 'financial_statements',
    financialYearStart: 2025,
    fileName: 'balance-sheet.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    status: 'available',
    storagePath: '10000000-0000-4000-a000-000000000001/70000000-0000-4000-a000-000000000001/balance-sheet.pdf',
    uploadedById: '20000000-0000-4000-a000-000000000001',
    uploadedByName: 'Ananya Rao',
    createdAt: '2026-11-10T04:30:00.000Z',
    removedReason: null,
    removedAt: null,
    ...overrides,
  };
}

const BALANCE = doc();
const NOTICE = doc({
  id: '70000000-0000-4000-a000-000000000002',
  clientId: BOLT.id,
  clientCode: 'CL-000002',
  clientName: 'Bolt Traders',
  title: 'GST notice',
  category: 'correspondence',
  financialYearStart: 2024,
  fileName: 'notice-scan.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 3 * 1024 * 1024 + 512 * 1024,
  uploadedByName: 'Rohan Mehta',
  createdAt: '2026-11-12T04:30:00.000Z',
});
const KYC = doc({
  id: '70000000-0000-4000-a000-000000000003',
  title: 'Director KYC',
  category: 'kyc',
  financialYearStart: null,
  fileName: 'kyc.png',
  mimeType: 'image/png',
});

function createActions() {
  return { upload: vi.fn(), download: vi.fn(), remove: vi.fn() };
}

function renderWorkspace(overrides: Partial<DocumentsWorkspaceProps> = {}) {
  const actions = createActions();
  const props: DocumentsWorkspaceProps = {
    role: 'founder',
    documents: [BALANCE, NOTICE, KYC],
    clients: [BOLT, ASTER],
    actions: actions as unknown as DocumentsActions,
    loading: false,
    hasLiveSnapshot: true,
    error: null,
    onRetry: vi.fn(),
    onToast: vi.fn(),
    ...overrides,
  };
  return { ...render(<DocumentsWorkspace {...props} />), actions, onRetry: props.onRetry, onToast: props.onToast };
}

const row = (title: string) => screen.getByText(title, { selector: 'strong' }).closest('tr') as HTMLElement;
const titles = () => screen.queryAllByRole('row').slice(1).map((r) => within(r).getAllByText(/./)[0]?.textContent);
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('DocumentsWorkspace', () => {
  it('shows the card title, the description and the Upload document button', () => {
    renderWorkspace();
    expect(screen.getByRole('heading', { name: 'Client documents' })).toBeTruthy();
    expect(
      screen.getByText(
        'Files kept privately for each client. Only the Founder, the Manager and the staff who look after a client can open them.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upload document/ })).toBeTruthy();
  });

  it('shows each document with its file, client, category, year, date and uploader', () => {
    renderWorkspace();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Document',
      'Client',
      'Category',
      'Financial year',
      'Uploaded',
      'Actions',
    ]);
    const balance = row('Balance sheet');
    expect(balance.textContent).toContain('balance-sheet.pdf · 2 KB');
    expect(balance.textContent).toContain('Aster Foods');
    expect(balance.textContent).toContain('CL-000001');
    expect(balance.textContent).toContain('Financial statements');
    expect(balance.textContent).toContain('2025–26');
    expect(balance.textContent).toContain('10/11/2026');
    expect(balance.textContent).toContain('Ananya Rao');
    expect(row('GST notice').textContent).toContain('notice-scan.jpg · 3.5 MB');
    expect(row('Director KYC').textContent).toContain('—');
    expect(row('Director KYC').textContent).toContain('KYC');
  });

  it('never shows a UUID, in the page or the filters', () => {
    renderWorkspace();
    expect(document.body.textContent).not.toMatch(UUID_PATTERN);
    expect(document.body.innerHTML.match(/aria-label="[^"]*"/g)?.join(' ') ?? '').not.toMatch(UUID_PATTERN);
  });

  it('shows the loading state', () => {
    renderWorkspace({ documents: [], loading: true, hasLiveSnapshot: false });
    expect(screen.getByLabelText('Loading documents')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the error state with Retry', () => {
    const { onRetry } = renderWorkspace({
      documents: [],
      hasLiveSnapshot: false,
      error: 'Unable to reach the server. Please check your network connection and try again.',
    });
    expect(screen.getByRole('alert').textContent).toContain('Unable to load documents');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the list and offers Retry when a refresh fails', () => {
    const { onRetry } = renderWorkspace({ error: 'Something went wrong with documents. Please try again.' });
    expect(screen.getByRole('status').textContent).toContain('Refresh failed. Showing last loaded data.');
    expect(screen.getByText('Balance sheet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state', () => {
    renderWorkspace({ documents: [] });
    expect(screen.getByText('No documents yet. Upload the first one.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  describe('filters and search', () => {
    it('lists the clients as code and name, the categories, and only the years in the list', () => {
      renderWorkspace();
      const options = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.textContent);
      expect(options('Filter by client')).toEqual(['All clients', 'CL-000001 · Aster Foods', 'CL-000002 · Bolt Traders']);
      expect(options('Filter by category')).toEqual([
        'All categories',
        'KYC',
        'Financial statements',
        'Returns filed',
        'Acknowledgements',
        'Agreements',
        'Correspondence',
        'Other',
      ]);
      expect(options('Filter by financial year')).toEqual(['All years', '2025–26', '2024–25']);
    });

    it('filters by client', () => {
      renderWorkspace();
      select('Filter by client', BOLT.id);
      expect(screen.queryByText('Balance sheet')).toBeNull();
      expect(screen.getByText('GST notice')).toBeTruthy();
    });

    it('filters by category', () => {
      renderWorkspace();
      select('Filter by category', 'kyc');
      expect(screen.getByText('Director KYC')).toBeTruthy();
      expect(screen.queryByText('Balance sheet')).toBeNull();
      expect(screen.queryByText('GST notice')).toBeNull();
    });

    it('filters by financial year', () => {
      renderWorkspace();
      select('Filter by financial year', '2024');
      expect(screen.getByText('GST notice')).toBeTruthy();
      expect(screen.queryByText('Balance sheet')).toBeNull();
      expect(screen.queryByText('Director KYC')).toBeNull();
    });

    it('searches the title and the file name, ignoring case', () => {
      renderWorkspace();
      fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'GST' } });
      expect(titles()).toEqual(['GST notice']);
      fireEvent.change(screen.getByLabelText('Search documents'), { target: { value: 'KYC.PNG' } });
      expect(titles()).toEqual(['Director KYC']);
    });

    it('combines the filters and shows the filtered empty state', () => {
      renderWorkspace();
      select('Filter by client', ASTER.id);
      select('Filter by category', 'correspondence');
      expect(screen.getByText('No documents match these filters.')).toBeTruthy();
      expect(screen.queryByText('No documents yet. Upload the first one.')).toBeNull();
      select('Filter by category', 'all');
      expect(screen.getByText('Balance sheet')).toBeTruthy();
    });
  });

  describe('download', () => {
    it('asks for the file of the row clicked', async () => {
      const { actions } = renderWorkspace();
      actions.download.mockResolvedValue(undefined);
      fireEvent.click(within(row('GST notice')).getByRole('button', { name: 'Download GST notice' }));
      await waitFor(() => expect(actions.download).toHaveBeenCalledWith(NOTICE));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows an alert when the file cannot be opened', async () => {
      const { actions } = renderWorkspace();
      actions.download.mockRejectedValue(new DocumentsOperationError({ code: 'storage', message: 'raw' }));
      fireEvent.click(screen.getByRole('button', { name: 'Download Balance sheet' }));
      expect((await screen.findByRole('alert')).textContent).toContain('The file could not be opened. Please try again.');
    });

    it('shows the permission copy for a refused download', async () => {
      const { actions } = renderWorkspace();
      actions.download.mockRejectedValue(new DocumentsOperationError({ code: 'forbidden', message: 'raw', status: 403 }));
      fireEvent.click(screen.getByRole('button', { name: 'Download Balance sheet' }));
      expect((await screen.findByRole('alert')).textContent).toContain("You don't have permission to do this.");
    });
  });

  describe('who can remove', () => {
    // Staff see only the clients they look after, and may remove those clients' documents.
    it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('gives %s Download and Remove', (role) => {
      renderWorkspace({ role });
      expect(screen.getAllByRole('button', { name: /^Download / })).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3);
    });

    it('removes with a reason, toasts, and uses the row clicked', async () => {
      const { actions, onToast } = renderWorkspace();
      actions.remove.mockResolvedValue({ ...NOTICE, status: 'removed' });
      fireEvent.click(screen.getByRole('button', { name: 'Remove GST notice' }));
      expect(screen.getByRole('dialog', { name: 'Remove GST notice?' })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Remove document' }));
      expect(screen.getByText('Give a reason of at least 3 characters.')).toBeTruthy();
      expect(actions.remove).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate upload' } });
      fireEvent.click(screen.getByRole('button', { name: 'Remove document' }));
      await waitFor(() => expect(actions.remove).toHaveBeenCalledWith(NOTICE, 'Duplicate upload', expect.any(String)));
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('GST notice removed.'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('reloads the list when the document was already removed', async () => {
      const { actions, onRetry, onToast } = renderWorkspace();
      actions.remove.mockRejectedValue(
        new DocumentsOperationError({ code: 'unexpected', message: 'raw', status: 422, serverCode: 'already_removed' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Remove Balance sheet' }));
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate upload' } });
      fireEvent.click(screen.getByRole('button', { name: 'Remove document' }));
      expect((await screen.findByRole('alert')).textContent).toBe('This document is already removed.');
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onToast).not.toHaveBeenCalled();
    });

    it('keeps the document when Keep it is chosen', () => {
      const { actions } = renderWorkspace();
      fireEvent.click(screen.getByRole('button', { name: 'Remove Balance sheet' }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(actions.remove).not.toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    it('opens the dialog, uploads, toasts and closes', async () => {
      const { actions, onToast } = renderWorkspace({ role: 'staff' });
      actions.upload.mockResolvedValue(doc());
      fireEvent.click(screen.getByRole('button', { name: /Upload document/ }));
      const dialog = screen.getByRole('dialog', { name: 'Upload document' });
      const file = new File(['%PDF-1.4'], 'Notice.pdf', { type: 'application/pdf' });
      fireEvent.change(within(dialog).getByLabelText('Client'), { target: { value: ASTER.id } });
      fireEvent.change(within(dialog).getByLabelText('File'), { target: { files: [file] } });
      fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'correspondence' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));

      await waitFor(() =>
        expect(actions.upload).toHaveBeenCalledWith(
          { clientId: ASTER.id, title: 'Notice', category: 'correspondence', financialYearStart: null, file },
          expect.any(String),
        ),
      );
      await waitFor(() => expect(onToast).toHaveBeenCalledWith('Notice uploaded.'));
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('does not toast when the upload fails', async () => {
      const { actions, onToast } = renderWorkspace();
      actions.upload.mockRejectedValue(new DocumentsOperationError({ code: 'storage', message: 'raw' }));
      fireEvent.click(screen.getByRole('button', { name: /Upload document/ }));
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Client'), { target: { value: ASTER.id } });
      fireEvent.change(within(dialog).getByLabelText('File'), {
        target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] },
      });
      fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'other' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
      await waitFor(() => expect(within(dialog).getByRole('alert')).toBeTruthy());
      expect(onToast).not.toHaveBeenCalled();
    });
  });

  describe('Trainee', () => {
    it('shows only the restricted card and offers nothing', () => {
      const { actions } = renderWorkspace({ role: 'trainee', documents: [], loading: false, hasLiveSnapshot: false });
      expect(screen.getByRole('heading', { name: 'Documents are restricted' })).toBeTruthy();
      expect(
        screen.getByText(
          'Client documents are available to the Founder, the Manager and the staff who look after each client.',
        ),
      ).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
      expect(actions.upload).not.toHaveBeenCalled();
      expect(actions.download).not.toHaveBeenCalled();
    });
  });
});
