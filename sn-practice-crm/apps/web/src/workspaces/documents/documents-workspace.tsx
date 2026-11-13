import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, ShieldCheck } from 'lucide-react';
import { DOCUMENT_CATEGORIES, type ClientDocumentDto, type ClientDto, type DocumentCategory } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import {
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_DOWNLOAD_FAILED_MESSAGE,
  financialYearLabel,
  formatFileSize,
  sanitizeDocumentsError,
} from '../../api/documents-types';
import type { UseDocumentsResult } from '../../api/use-documents';
import { Card } from '../../ui/workspace-primitives';
import { formatClientDate } from '../clients/clients-view-model';
import { RemoveDocumentDialog } from './remove-document-dialog';
import { UploadDocumentDialog } from './upload-document-dialog';

export type DocumentsActions = Pick<UseDocumentsResult, 'upload' | 'download' | 'remove'>;

export interface DocumentsWorkspaceProps {
  role: CompanyRole;
  documents: readonly ClientDocumentDto[];
  /** The live clients list, for the filter and the upload dialog. */
  clients: readonly ClientDto[];
  actions: DocumentsActions;
  loading: boolean;
  /** True once the list has loaded at least once, so a later failure keeps showing it. */
  hasLiveSnapshot: boolean;
  error: string | null;
  onRetry: () => void;
  onToast: (message: string) => void;
}

type DialogState = { kind: 'upload' } | { kind: 'remove'; document: ClientDocumentDto };

const smallText = { display: 'block', color: 'var(--ink-muted)', fontSize: 11, overflowWrap: 'anywhere' } as const;

export function DocumentsWorkspace({
  role,
  documents,
  clients,
  actions,
  loading,
  hasLiveSnapshot,
  error,
  onRetry,
  onToast,
}: DocumentsWorkspaceProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [clientFilter, setClientFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | DocumentCategory>('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Everyone who can see the page looks after these clients, and may remove (Trainees get the restricted card).
  const canRemove = role !== 'trainee';

  const openDialog = (next: DialogState, from?: HTMLElement) => {
    setActionError(null);
    setOpener(from ?? null);
    setDialog(next);
  };
  const closeDialog = () => setDialog(null);

  const clientOptions = useMemo(() => [...clients].sort((a, b) => a.code.localeCompare(b.code)), [clients]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const document of documents) {
      if (document.financialYearStart !== null) years.add(document.financialYearStart);
    }
    return [...years].sort((a, b) => b - a);
  }, [documents]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return documents.filter((document) => {
      if (clientFilter !== 'all' && document.clientId !== clientFilter) return false;
      if (categoryFilter !== 'all' && document.category !== categoryFilter) return false;
      if (yearFilter !== 'all' && String(document.financialYearStart) !== yearFilter) return false;
      if (query && !document.title.toLowerCase().includes(query) && !document.fileName.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [documents, clientFilter, categoryFilter, yearFilter, search]);

  if (role === 'trainee') {
    return (
      <Card title="Documents are restricted">
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
          <ShieldCheck size={48} color="var(--brand)" style={{ margin: '0 auto 16px', opacity: 0.7 }} />
          <p style={{ maxWidth: 460, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>
            Client documents are available to the Founder, the Manager and the staff who look after each client.
          </p>
        </div>
      </Card>
    );
  }

  const download = async (document: ClientDocumentDto) => {
    if (busyId !== null) return;
    setActionError(null);
    setBusyId(document.id);
    try {
      await actions.download(document);
    } catch (err: unknown) {
      setActionError(sanitizeDocumentsError(err).code === 'forbidden' ? "You don't have permission to do this." : DOCUMENT_DOWNLOAD_FAILED_MESSAGE);
    } finally {
      setBusyId(null);
    }
  };

  const hasData = documents.length > 0;
  const initialLoading = loading && !hasLiveSnapshot && !error;
  const initialError = Boolean(error) && !hasLiveSnapshot;
  const stale = Boolean(error) && hasLiveSnapshot;

  return (
    <div>
      {stale ? (
        <div className="workspace-warning-banner" role="status" style={{ marginBottom: 14 }}>
          <span className="workspace-warning-message">
            <AlertTriangle size={15} /> Refresh failed. Showing last loaded data.
          </span>
          <button className="soft-button" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="workspace-warning-banner" role="alert" style={{ marginBottom: 14 }}>
          <span className="workspace-warning-message">
            <AlertTriangle size={15} /> {actionError}
          </span>
        </div>
      ) : null}

      <Card
        title="Client documents"
        description="Files kept privately for each client. Only the Founder, the Manager and the staff who look after a client can open them."
        action={
          <button
            className="primary-button"
            type="button"
            style={{ fontSize: 12, padding: '7px 14px' }}
            onClick={(event) => openDialog({ kind: 'upload' }, event.currentTarget)}
          >
            <Plus size={14} /> Upload document
          </button>
        }
      >
        {initialLoading ? (
          <div aria-busy="true" aria-label="Loading documents">
            {[1, 2, 3, 4].map((x) => (
              <div className="skeleton-row engagement-skeleton-row" key={x}>
                <span className="skeleton-pulse" />
              </div>
            ))}
          </div>
        ) : initialError ? (
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load documents</h3>
            <p>{error}</p>
            <button className="primary-button" type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="client-toolbar" style={{ marginBottom: 14, boxShadow: 'none', padding: 0 }}>
              <div className="client-search-wrap">
                <Search aria-hidden="true" />
                <input
                  className="client-search-input"
                  type="search"
                  placeholder="Search by title or file name…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search documents"
                />
              </div>
              <div className="client-filter-group">
                <select
                  className="client-select"
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                  aria-label="Filter by client"
                >
                  <option value="all">All clients</option>
                  {clientOptions.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.code} · {client.displayName}
                    </option>
                  ))}
                </select>
                <select
                  className="client-select"
                  value={categoryFilter}
                  onChange={(event) => {
                    const match = DOCUMENT_CATEGORIES.find((category) => category === event.target.value);
                    setCategoryFilter(match ?? 'all');
                  }}
                  aria-label="Filter by category"
                >
                  <option value="all">All categories</option>
                  {DOCUMENT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {DOCUMENT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
                <select
                  className="client-select"
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                  aria-label="Filter by financial year"
                >
                  <option value="all">All years</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={String(year)}>
                      {financialYearLabel(year)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="workspace-empty-card">
                <strong>{hasData ? 'No documents match these filters.' : 'No documents yet. Upload the first one.'}</strong>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Client</th>
                      <th>Category</th>
                      <th>Financial year</th>
                      <th>Uploaded</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((document) => (
                      <tr key={document.id}>
                        <td>
                          <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{document.title}</strong>
                          <small style={smallText}>
                            {document.fileName} · {formatFileSize(document.sizeBytes)}
                          </small>
                        </td>
                        <td>
                          <span style={{ fontSize: 12 }}>{document.clientName}</span>
                          <small style={smallText}>{document.clientCode}</small>
                        </td>
                        <td>
                          <span style={{ fontSize: 12 }}>{DOCUMENT_CATEGORY_LABELS[document.category]}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12 }}>
                            {document.financialYearStart === null ? '—' : financialYearLabel(document.financialYearStart)}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12 }}>{formatClientDate(document.createdAt)}</span>
                          <small style={smallText}>{document.uploadedByName}</small>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="soft-button"
                              type="button"
                              aria-label={`Download ${document.title}`}
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              disabled={busyId !== null}
                              onClick={() => void download(document)}
                            >
                              Download
                            </button>
                            {canRemove ? (
                              <button
                                className="soft-button"
                                type="button"
                                aria-label={`Remove ${document.title}`}
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                disabled={busyId !== null}
                                onClick={(event) => openDialog({ kind: 'remove', document }, event.currentTarget)}
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <UploadDocumentDialog
        open={dialog?.kind === 'upload'}
        clients={clients}
        opener={opener}
        onClose={closeDialog}
        onSubmit={async (input, key) => {
          await actions.upload(input, key);
          onToast(`${input.title} uploaded.`);
        }}
      />
      <RemoveDocumentDialog
        open={dialog?.kind === 'remove'}
        documentTitle={dialog?.kind === 'remove' ? dialog.document.title : ''}
        opener={opener}
        onClose={closeDialog}
        onSubmit={async (reason, key) => {
          if (dialog?.kind !== 'remove') return;
          try {
            await actions.remove(dialog.document, reason, key);
            onToast(`${dialog.document.title} removed.`);
          } catch (err: unknown) {
            // Already removed elsewhere: the list on screen is out of date, so load it again.
            if (sanitizeDocumentsError(err).serverCode === 'already_removed') onRetry();
            throw err;
          }
        }}
      />
    </div>
  );
}
