import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Clock,
  FileText,
  Mail,
  Phone,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import type { ClientOperationError } from '../../api/clients-types';
import { MESSAGE_PURPOSE_LABELS } from '../../api/messages-types';
import { useMessageComposer, type MessageComposer } from '../messages/message-composer';
import { normalizeWhatsAppNumber } from '../messages/message-templates';
import { formatClientDate, type ClientDetailViewModel } from './clients-view-model';

export type ClientDrawerTab = 'overview' | 'kyc' | 'schedules' | 'work' | 'billing';

export interface ClientProfileDrawerProps {
  readonly client: ClientDetailViewModel | null;
  readonly loading?: boolean;
  readonly error?: ClientOperationError | null;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  /** Open the edit dialog; shown only when the client says the reader may edit it. */
  readonly onEditClient?: () => void;
  readonly onAddContact?: () => void;
  readonly onEditContact?: (contactId: string) => void;
  readonly onRemoveContact?: (contactId: string) => void;
}

interface DrawerHeaderProps {
  readonly client: ClientDetailViewModel | null;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onEditClient?: () => void;
  /** Start a WhatsApp message for this client; shown only when the reader may message clients. */
  readonly onMessage?: (opener: HTMLElement) => void;
}

/** Starts a General message for the client, with the contacts this drawer is showing right now. */
function startClientMessage(composer: MessageComposer, client: ClientDetailViewModel, opener: HTMLElement): void {
  composer.open(
    {
      clientId: client.id,
      purpose: 'general',
      client: {
        id: client.id,
        displayName: client.displayName,
        // The profile shows "Not provided" for a missing phone; only a real number is offered.
        phone: normalizeWhatsAppNumber(client.phone) ? client.phone : null,
        contacts: client.contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          designation: contact.designation,
          phone: contact.phone,
          whatsapp: contact.whatsapp,
          isPrimary: contact.isPrimary,
        })),
      },
    },
    opener,
  );
}

function DrawerHeader({ client, loading, onClose, onEditClient, onMessage }: DrawerHeaderProps) {
  const headerSubtitle = client
    ? (client.legalName ? `${client.legalName} · ${client.code}` : client.code)
    : (loading ? 'Fetching client details…' : 'Client details');

  return (
    <div className="client-drawer-header">
      <div className="drawer-client-lead">
        <span className="drawer-monogram" aria-hidden="true">
          {client ? client.initials : '…'}
        </span>
        <div>
          <h2 id="client-drawer-title" className="drawer-title-contain">
            {client ? client.displayName : (loading ? 'Loading client…' : 'Client Profile')}
          </h2>
          <p className="drawer-subtitle-contain">{headerSubtitle}</p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {client ? (
          <span className={`status tone-${client.statusTone}`}>
            {client.statusLabel}
          </span>
        ) : null}
        {client && onMessage ? (
          <button className="soft-button" type="button" onClick={(event) => onMessage(event.currentTarget)}>
            Message on WhatsApp
          </button>
        ) : null}
        {client?.canEdit && onEditClient ? (
          <button className="soft-button" type="button" onClick={onEditClient}>
            Edit details
          </button>
        ) : null}
        <button
          className="drawer-close-btn"
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface DrawerTabsProps {
  readonly activeTab: ClientDrawerTab;
  readonly onSelectTab: (tab: ClientDrawerTab) => void;
}

function DrawerTabs({ activeTab, onSelectTab }: DrawerTabsProps) {
  return (
    <nav className="drawer-tabs" role="tablist" aria-label="Client profile tabs">
      <button
        id="tab-overview"
        role="tab"
        aria-selected={activeTab === 'overview'}
        aria-controls="panel-overview"
        className={`drawer-tab ${activeTab === 'overview' ? 'is-active' : ''}`}
        type="button"
        onClick={() => onSelectTab('overview')}
      >
        Overview
      </button>
      <button
        id="tab-kyc"
        role="tab"
        aria-selected={activeTab === 'kyc'}
        aria-controls="panel-kyc"
        className={`drawer-tab ${activeTab === 'kyc' ? 'is-active' : ''}`}
        type="button"
        onClick={() => onSelectTab('kyc')}
      >
        KYC
      </button>
      <button
        id="tab-schedules"
        role="tab"
        aria-selected={activeTab === 'schedules'}
        aria-controls="panel-schedules"
        className={`drawer-tab ${activeTab === 'schedules' ? 'is-active' : ''}`}
        type="button"
        onClick={() => onSelectTab('schedules')}
      >
        Schedules
      </button>
      <button
        id="tab-work"
        role="tab"
        aria-selected={activeTab === 'work'}
        aria-controls="panel-work"
        className={`drawer-tab ${activeTab === 'work' ? 'is-active' : ''}`}
        type="button"
        onClick={() => onSelectTab('work')}
      >
        Work
      </button>
      <button
        id="tab-billing"
        role="tab"
        aria-selected={activeTab === 'billing'}
        aria-controls="panel-billing"
        className={`drawer-tab ${activeTab === 'billing' ? 'is-active' : ''}`}
        type="button"
        onClick={() => onSelectTab('billing')}
      >
        Billing
      </button>
    </nav>
  );
}

function DrawerLoading() {
  return (
    <div
      className="drawer-loading-skeleton"
      aria-busy="true"
      aria-label="Loading client details"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div className="drawer-card skeleton-pulse" style={{ height: 110 }} />
      <div className="drawer-card skeleton-pulse" style={{ height: 90 }} />
      <div className="drawer-card skeleton-pulse" style={{ height: 80 }} />
    </div>
  );
}

interface DrawerErrorProps {
  readonly message: string;
  readonly onRetry?: () => void;
}

function DrawerError({ message, onRetry }: DrawerErrorProps) {
  return (
    <div className="drawer-error-state" role="alert">
      <div className="drawer-error-icon">
        <AlertTriangle size={22} aria-hidden="true" />
      </div>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink-strong)' }}>
        Unable to load client details
      </h3>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', maxWidth: 320 }}>
        {message}
      </p>
      {onRetry ? (
        <button
          className="primary-button"
          type="button"
          onClick={onRetry}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}
        >
          <RotateCcw size={13} aria-hidden="true" /> Try again
        </button>
      ) : null}
    </div>
  );
}

interface ClientActions {
  readonly onEditClient?: () => void;
  readonly onAddContact?: () => void;
  readonly onEditContact?: (contactId: string) => void;
  readonly onRemoveContact?: (contactId: string) => void;
}

function DetailField({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <span className="drawer-field-label">{label}</span>
      <div className="drawer-field-val drawer-text-contain">{value}</div>
    </div>
  );
}

function IdentityCard({ client }: { readonly client: ClientDetailViewModel }) {
  return (
    <div className="drawer-card" style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
        Identity and registrations
      </h4>
      <div className="drawer-grid-2col">
        <DetailField label="Entity type" value={client.entityTypeLabel} />
        <DetailField label="Date of incorporation or birth" value={client.incorporationDateLabel} />
        <DetailField label="PAN" value={client.panLabel} />
        <DetailField label="GSTIN" value={client.gstinLabel} />
        <DetailField label="TAN" value={client.tanLabel} />
        <DetailField label="CIN / LLPIN" value={client.cinLlpinLabel} />
        <DetailField label="Udyam number" value={client.udyamLabel} />
        <DetailField label="IEC" value={client.iecLabel} />
      </div>
    </div>
  );
}

function AddressCard({ client }: { readonly client: ClientDetailViewModel }) {
  return (
    <div className="drawer-card" style={{ padding: 16 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>Address</h4>
      {client.addressLines.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>No address added</p>
      ) : (
        <div className="drawer-text-contain" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--ink)' }}>
          {client.addressLines.map((line, index) => (
            <span key={index}>{line}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactPeopleCard({
  client,
  onAddContact,
  onEditContact,
  onRemoveContact,
}: { readonly client: ClientDetailViewModel } & ClientActions) {
  return (
    <div className="drawer-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>Contact people</h4>
        {client.canEdit && onAddContact ? (
          <button className="soft-button" type="button" onClick={onAddContact}>
            Add contact
          </button>
        ) : null}
      </div>
      {client.contacts.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>No contact people yet.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {client.contacts.map((contact) => (
            <li key={contact.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div className="drawer-text-contain" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--ink)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <strong>{contact.name}</strong>
                  {contact.isPrimary ? <span className="status tone-default">Primary</span> : null}
                </span>
                {contact.designation ? <span style={{ color: 'var(--ink-muted)' }}>{contact.designation}</span> : null}
                {contact.email ? <span>{contact.email}</span> : null}
                {contact.phone ? <span>Phone: {contact.phone}</span> : null}
                {contact.whatsapp ? <span>WhatsApp: {contact.whatsapp}</span> : null}
              </div>
              {client.canEdit ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <button
                    className="text-button"
                    type="button"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() => onEditContact?.(contact.id)}
                  >
                    Edit
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    aria-label={`Remove ${contact.name}`}
                    onClick={() => onRemoveContact?.(contact.id)}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How much of a message the drawer shows. */
const MESSAGE_SNIPPET_LENGTH = 80;

function MessagesCard({ client, composer }: { readonly client: ClientDetailViewModel; readonly composer: MessageComposer }) {
  const recent = composer.recentFor(client.id, 5);
  return (
    <div className="drawer-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>Messages</h4>
        <button className="text-button" type="button" onClick={() => composer.showAll(client.id)}>
          See all messages
        </button>
      </div>
      {recent.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)' }}>No messages yet.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recent.map((message) => (
            <li
              key={message.id}
              className="drawer-text-contain"
              style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--ink)' }}
            >
              <span>
                <strong>{MESSAGE_PURPOSE_LABELS[message.purpose]}</strong> · {message.recipientName} ·{' '}
                {formatClientDate(message.createdAt)}
              </span>
              <span style={{ color: 'var(--ink-muted)' }}>
                {message.body.length > MESSAGE_SNIPPET_LENGTH
                  ? `${message.body.slice(0, MESSAGE_SNIPPET_LENGTH)}…`
                  : message.body}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OverviewTabPanel({
  client,
  composer,
  ...actions
}: { readonly client: ClientDetailViewModel; readonly composer: MessageComposer | null } & ClientActions) {
  return (
    <div
      id="panel-overview"
      role="tabpanel"
      aria-labelledby="tab-overview"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div className="drawer-card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
          Entity &amp; Relationship
        </h4>
        <div className="drawer-grid-2col">
          <div>
            <span className="drawer-field-label">Client Code</span>
            <div className="drawer-field-val">
              <strong>{client.code}</strong>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">Status</span>
            <div style={{ marginTop: 2 }}>
              <span className={`status tone-${client.statusTone}`}>{client.statusLabel}</span>
            </div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <span className="drawer-field-label">Display Name</span>
            <div className="drawer-field-val drawer-text-contain">
              <strong>{client.displayName}</strong>
            </div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <span className="drawer-field-label">Legal Entity Name</span>
            <div className="drawer-field-val drawer-text-contain">
              {client.legalName ?? 'Not provided'}
            </div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <span className="drawer-field-label">Relationship Owner</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--ink)', marginTop: 2 }}>
              <UserCheck size={14} color="var(--ink-muted)" aria-hidden="true" />
              <span className="drawer-text-contain">{client.relationshipOwnerName}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="drawer-card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
          Contact Information
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={14} color="var(--ink-muted)" aria-hidden="true" />
            <span className="drawer-text-contain" style={{ fontSize: 12, color: 'var(--ink)' }}>{client.email}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Phone size={14} color="var(--ink-muted)" aria-hidden="true" />
            <span className="drawer-text-contain" style={{ fontSize: 12, color: 'var(--ink)' }}>{client.phone}</span>
          </div>
        </div>
      </div>

      <IdentityCard client={client} />
      <AddressCard client={client} />
      <ContactPeopleCard client={client} {...actions} />
      {composer ? <MessagesCard client={client} composer={composer} /> : null}

      <div className="drawer-card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
          System Timestamps
        </h4>
        <div className="drawer-grid-2col">
          <div>
            <span className="drawer-field-label">Created</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', marginTop: 2 }}>
              <Clock size={13} color="var(--ink-muted)" aria-hidden="true" />
              <span>{client.createdAtLabel}</span>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">Last Updated</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)', marginTop: 2 }}>
              <Clock size={13} color="var(--ink-muted)" aria-hidden="true" />
              <span>{client.updatedAtLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="drawer-card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
          Engagement Notes
        </h4>
        <p className="drawer-notes-content drawer-text-contain">
          {client.notesLabel}
        </p>
      </div>
    </div>
  );
}

function KycTabPanel({ client }: { readonly client: ClientDetailViewModel }) {
  return (
    <div
      id="panel-kyc"
      role="tabpanel"
      aria-labelledby="tab-kyc"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div className="drawer-notice-box">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <ShieldCheck size={14} color="var(--brand)" aria-hidden="true" />
          <strong style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Who sees full numbers
          </strong>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
          Full PAN and GSTIN are shown to the Founder, the Manager and the staff who look after this client. Everyone else sees them masked.
        </p>
      </div>

      <div className="drawer-card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
          Tax Identifiers
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span className="drawer-field-label">Permanent Account Number (PAN)</span>
            <div style={{ marginTop: 4 }}>
              <span className="tax-id-chip">{client.panLabel}</span>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">Goods &amp; Services Tax Identification Number (GSTIN)</span>
            <div style={{ marginTop: 4 }}>
              <span className="tax-id-chip">{client.gstinLabel}</span>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">TAN</span>
            <div style={{ marginTop: 4 }}>
              <span className="tax-id-chip">{client.tanLabel}</span>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">CIN / LLPIN</span>
            <div style={{ marginTop: 4 }}>
              <span className="tax-id-chip">{client.cinLlpinLabel}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActiveWorkTabPanel({ client }: { readonly client: ClientDetailViewModel }) {
  return (
    <div
      id="panel-work"
      role="tabpanel"
      aria-labelledby="tab-work"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div className="drawer-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={15} color="var(--brand)" aria-hidden="true" />
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
              Active Engagements
            </h4>
          </div>
          <span className="status tone-default">
            {client.activeAssignmentsLabel}
          </span>
        </div>
        <div className="drawer-notice-box">
          <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
            Detailed assignment records and historical engagement logs are not available in this view.
          </p>
        </div>
      </div>
    </div>
  );
}

interface UnsupportedTabPanelProps {
  readonly id: string;
  readonly tabId: string;
  readonly title: string;
  readonly icon: typeof Building2;
}

function UnsupportedTabPanel({ id, tabId, title, icon: Icon }: UnsupportedTabPanelProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={tabId}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div className="drawer-card drawer-unsupported-box">
        <Icon size={28} className="drawer-unsupported-icon" aria-hidden="true" />
        <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: 'var(--ink-strong)' }}>
          {title}
        </h4>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: 'var(--ink-muted)' }}>
          {title} are not available in this view.
        </p>
      </div>
    </div>
  );
}

export function ClientProfileDrawer({
  client,
  loading = false,
  error = null,
  onClose,
  onRetry,
  onEditClient,
  onAddContact,
  onEditContact,
  onRemoveContact,
}: ClientProfileDrawerProps) {
  const [tab, setTab] = useState<ClientDrawerTab>('overview');
  const drawerRef = useRef<HTMLElement>(null);
  // Only people who may message clients get the button and the Messages section.
  const messageComposer = useMessageComposer();
  // A department head who can only read this client gets neither (the server would refuse the message).
  const composer =
    messageComposer?.canMessage && client && messageComposer.canMessageClient(client.id) ? messageComposer : null;

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // A dialog opened over the drawer handles its own Escape and marks the event as handled.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} data-testid="drawer-backdrop" />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-drawer-title"
        tabIndex={-1}
        className="client-drawer"
      >
        <DrawerHeader
          client={client}
          loading={loading}
          onClose={onClose}
          onEditClient={onEditClient}
          onMessage={composer && client ? (opener) => startClientMessage(composer, client, opener) : undefined}
        />

        {client ? (
          <DrawerTabs activeTab={tab} onSelectTab={setTab} />
        ) : null}

        <div className="drawer-content" tabIndex={0}>
          {loading && !client ? (
            <DrawerLoading />
          ) : error && !client ? (
            <DrawerError
              message={error.message || 'An unexpected error occurred while fetching client details.'}
              onRetry={onRetry}
            />
          ) : client ? (
            <>
              {tab === 'overview' && (
                <OverviewTabPanel
                  client={client}
                  composer={composer}
                  onAddContact={onAddContact}
                  onEditContact={onEditContact}
                  onRemoveContact={onRemoveContact}
                />
              )}
              {tab === 'kyc' && <KycTabPanel client={client} />}
              {tab === 'schedules' && (
                <UnsupportedTabPanel
                  id="panel-schedules"
                  tabId="tab-schedules"
                  title="Compliance schedules"
                  icon={CalendarClock}
                />
              )}
              {tab === 'work' && <ActiveWorkTabPanel client={client} />}
              {tab === 'billing' && (
                <UnsupportedTabPanel
                  id="panel-billing"
                  tabId="tab-billing"
                  title="Billing & ledgers"
                  icon={Building2}
                />
              )}
            </>
          ) : null}
        </div>

        <div className="drawer-footer">
          <button className="soft-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
