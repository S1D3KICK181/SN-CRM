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
import type { ClientDetailViewModel } from './clients-view-model';

export type ClientDrawerTab = 'overview' | 'kyc' | 'schedules' | 'work' | 'billing';

export interface ClientProfileDrawerProps {
  readonly client: ClientDetailViewModel | null;
  readonly loading?: boolean;
  readonly error?: ClientOperationError | null;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
}

interface DrawerHeaderProps {
  readonly client: ClientDetailViewModel | null;
  readonly loading: boolean;
  readonly onClose: () => void;
}

function DrawerHeader({ client, loading, onClose }: DrawerHeaderProps) {
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

function OverviewTabPanel({ client }: { readonly client: ClientDetailViewModel }) {
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
            Routine Statutory Read View
          </strong>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
          Routine views expose masked identifiers only.
        </p>
      </div>

      <div className="drawer-card" style={{ padding: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)' }}>
          Tax Identifiers
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span className="drawer-field-label">Masked Permanent Account Number (PAN)</span>
            <div style={{ marginTop: 4 }}>
              <span className="tax-id-chip">{client.panMasked}</span>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">Masked Goods &amp; Services Tax Identification Number (GSTIN)</span>
            <div style={{ marginTop: 4 }}>
              <span className="tax-id-chip">{client.gstinMasked}</span>
            </div>
          </div>
          <div>
            <span className="drawer-field-label">Corporate / Direct Tax (CIN, TAN)</span>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
              Not available in this view
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
}: ClientProfileDrawerProps) {
  const [tab, setTab] = useState<ClientDrawerTab>('overview');
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
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
        <DrawerHeader client={client} loading={loading} onClose={onClose} />

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
              {tab === 'overview' && <OverviewTabPanel client={client} />}
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
