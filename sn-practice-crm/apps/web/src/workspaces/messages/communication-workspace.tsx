import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, MessageCircle, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { MESSAGE_PURPOSES, type ClientDto, type ClientMessageDto, type MessagePurpose } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { MESSAGE_PURPOSE_LABELS, MESSAGE_STATUS_LABEL } from '../../api/messages-types';
import { Card } from '../../ui/workspace-primitives';
import { formatClientDate } from '../clients/clients-view-model';
import { uploadClientOptions } from '../documents/upload-document-dialog';
import { useMessageComposer } from './message-composer';
import { formatWhatsAppNumber } from './message-templates';

export interface CommunicationWorkspaceProps {
  role: CompanyRole;
  messages: readonly ClientMessageDto[];
  /** The live clients list, for the filter and for choosing who a new message is for. */
  clients: readonly ClientDto[];
  loading: boolean;
  /** True once the list has loaded at least once, so a later failure keeps showing it. */
  hasLiveSnapshot: boolean;
  error: string | null;
  onRetry: () => void;
  /** A client to show messages for when the page opens, such as from a client's profile. */
  initialClientId?: string | null;
}

/** How much of a message the table shows before it is expanded. */
export const MESSAGE_PREVIEW_LENGTH = 120;

const smallText = { display: 'block', color: 'var(--ink-muted)', fontSize: 11, overflowWrap: 'anywhere' } as const;
const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

const kolkataTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatSentTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : kolkataTimeFormatter.format(date);
}

/** The text or the recipient's name contains the query; a query that is only digits also matches the number. */
function matchesSearch(message: ClientMessageDto, query: string): boolean {
  if (message.body.toLowerCase().includes(query) || message.recipientName.toLowerCase().includes(query)) return true;
  const digits = query.replace(/\D/g, '');
  return digits !== '' && /^[\d\s+()-]+$/.test(query) && message.recipientNumber.includes(digits);
}

function messageAbout(message: ClientMessageDto): string {
  return message.assignmentCode ?? message.invoiceLabel ?? '—';
}

function NewMessageDialog({
  clients,
  opener,
  onClose,
  onContinue,
}: {
  clients: readonly ClientDto[];
  opener: HTMLElement | null;
  onClose: () => void;
  onContinue: (clientId: string) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef(opener);
  onCloseRef.current = onClose;
  openerRef.current = opener;

  useEffect(() => {
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#new-message-client')?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(focusable)];
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && event.shiftKey && index <= 0) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (nodes.length && !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const options = uploadClientOptions(clients);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (clientId === '') {
      setError('Choose a client.');
      requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('#new-message-client')?.focus());
      return;
    }
    onContinue(clientId);
  };

  return (
    <div
      className="dialog-layer end-engagement-dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-message-title"
        className="dialog engagement-draft-dialog end-engagement-dialog"
      >
        <header className="dialog-header">
          <div>
            <div className="dialog-icon">
              <MessageCircle size={18} />
            </div>
            <div>
              <h2 id="new-message-title">New message</h2>
              <p>Choose the client this message is for.</p>
            </div>
          </div>
          <button className="dialog-close-btn" type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="engagement-dialog-body end-engagement-fields">
            <div className="field">
              <label htmlFor="new-message-client">Client</label>
              <select
                id="new-message-client"
                value={clientId}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'new-message-client-error' : undefined}
                onChange={(event) => {
                  setClientId(event.target.value);
                  setError(null);
                }}
              >
                <option value="">Choose a client</option>
                {options.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} · {client.displayName}
                  </option>
                ))}
              </select>
              {error ? (
                <small id="new-message-client-error" className="field-error-text">
                  {error}
                </small>
              ) : null}
            </div>
          </div>
          <footer className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              Continue
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

export function CommunicationWorkspace({
  role,
  messages,
  clients,
  loading,
  hasLiveSnapshot,
  error,
  onRetry,
  initialClientId = null,
}: CommunicationWorkspaceProps) {
  const composer = useMessageComposer();
  const [clientFilter, setClientFilter] = useState(initialClientId ?? 'all');
  const [purposeFilter, setPurposeFilter] = useState<'all' | MessagePurpose>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [choosingClient, setChoosingClient] = useState<{ opener: HTMLElement | null } | null>(null);

  // Arriving from a client's profile chooses that client; arriving any other way shows everyone.
  useEffect(() => {
    setClientFilter(initialClientId ?? 'all');
  }, [initialClientId]);

  const clientOptions = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; name: string }>();
    for (const client of clients) byId.set(client.id, { id: client.id, code: client.code, name: client.displayName });
    for (const message of messages) {
      if (!byId.has(message.clientId)) byId.set(message.clientId, { id: message.clientId, code: message.clientCode, name: message.clientName });
    }
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [clients, messages]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return messages.filter((message) => {
      if (clientFilter !== 'all' && message.clientId !== clientFilter) return false;
      if (purposeFilter !== 'all' && message.purpose !== purposeFilter) return false;
      if (query && !matchesSearch(message, query)) return false;
      return true;
    });
  }, [messages, clientFilter, purposeFilter, search]);

  if (role === 'trainee') {
    return (
      <Card title="Client messages are restricted">
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
          <ShieldCheck size={48} color="var(--brand)" style={{ margin: '0 auto 16px', opacity: 0.7 }} />
          <p style={{ maxWidth: 460, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>
            Client messages are available to the Founder, the Manager and the staff who look after each client.
          </p>
        </div>
      </Card>
    );
  }

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const hasData = messages.length > 0;
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

      <Card
        title="Client messages"
        description="Every WhatsApp message sent from the CRM, newest first."
        action={
          composer?.canMessage ? (
            <button
              className="primary-button"
              type="button"
              style={{ fontSize: 12, padding: '7px 14px' }}
              onClick={(event) => setChoosingClient({ opener: event.currentTarget })}
            >
              <Plus size={14} /> New message
            </button>
          ) : null
        }
      >
        {initialLoading ? (
          <div aria-busy="true" aria-label="Loading messages">
            {[1, 2, 3, 4].map((x) => (
              <div className="skeleton-row engagement-skeleton-row" key={x}>
                <span className="skeleton-pulse" />
              </div>
            ))}
          </div>
        ) : initialError ? (
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load messages</h3>
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
                  placeholder="Search by message or recipient…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search messages"
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
                      {client.code} · {client.name}
                    </option>
                  ))}
                </select>
                <select
                  className="client-select"
                  value={purposeFilter}
                  onChange={(event) => {
                    const match = MESSAGE_PURPOSES.find((purpose) => purpose === event.target.value);
                    setPurposeFilter(match ?? 'all');
                  }}
                  aria-label="Filter by purpose"
                >
                  <option value="all">All purposes</option>
                  {MESSAGE_PURPOSES.map((purpose) => (
                    <option key={purpose} value={purpose}>
                      {MESSAGE_PURPOSE_LABELS[purpose]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="workspace-empty-card">
                <strong>
                  {hasData
                    ? 'No messages match these filters.'
                    : 'No messages yet. Start one from a client, an assignment or a bill.'}
                </strong>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Sent</th>
                      <th>Client</th>
                      <th>To</th>
                      <th>Purpose</th>
                      <th>About</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((message) => {
                      const long = message.body.length > MESSAGE_PREVIEW_LENGTH;
                      const open = expanded.has(message.id);
                      return (
                        <tr key={message.id}>
                          <td>
                            <span style={{ fontSize: 12 }}>
                              {formatClientDate(message.createdAt)} · {formatSentTime(message.createdAt)}
                            </span>
                            <small style={smallText}>{message.sentByName}</small>
                          </td>
                          <td>
                            <span style={{ fontSize: 12 }}>{message.clientName}</span>
                            <small style={smallText}>{message.clientCode}</small>
                          </td>
                          <td>
                            <span style={{ fontSize: 12 }}>{message.recipientName}</span>
                            <small style={smallText}>{formatWhatsAppNumber(message.recipientNumber)}</small>
                          </td>
                          <td>
                            <span style={{ fontSize: 12 }}>{MESSAGE_PURPOSE_LABELS[message.purpose]}</span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12 }}>{messageAbout(message)}</span>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {long && !open ? `${message.body.slice(0, MESSAGE_PREVIEW_LENGTH)}…` : message.body}
                            </span>
                            {long ? (
                              <button
                                className="text-button"
                                type="button"
                                aria-expanded={open}
                                aria-label={`${open ? 'Show less of' : 'Show all of'} the message to ${message.recipientName}`}
                                style={{ marginLeft: 6, fontSize: 11 }}
                                onClick={() => toggleExpanded(message.id)}
                              >
                                {open ? 'Show less' : 'Show more'}
                              </button>
                            ) : null}
                            <div style={{ marginTop: 4 }}>
                              <span className="status tone-default">{MESSAGE_STATUS_LABEL}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      {choosingClient ? (
        <NewMessageDialog
          clients={clients}
          opener={choosingClient.opener}
          onClose={() => {
            choosingClient.opener?.focus();
            setChoosingClient(null);
          }}
          onContinue={(clientId) => {
            composer?.open({ clientId, purpose: 'general' }, choosingClient.opener);
            setChoosingClient(null);
          }}
        />
      ) : null}
    </div>
  );
}
