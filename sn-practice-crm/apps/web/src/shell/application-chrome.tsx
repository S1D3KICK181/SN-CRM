import type { ReactNode } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  Plus,
  Search,
} from 'lucide-react';
import type { SessionActor } from '@sn/contracts';
import { COMPANY_ROLES, type CompanyRole } from '@sn/domain';
import { ROLE_LABELS } from '../data';
import { getNavigationForRole, type PageKey } from './navigation';

interface ApplicationChromeProps {
  actor: SessionActor;
  activePage: PageKey;
  toast: string | null;
  onSignOut: () => Promise<void> | void;
  onNavigate: (page: PageKey) => void;
  onQuickAdd: () => void;
  onToast: (message: string) => void;
  children: ReactNode;
  overlays?: ReactNode;
}

export function ApplicationChrome({
  actor,
  activePage,
  toast,
  onSignOut,
  onNavigate,
  onQuickAdd,
  onToast,
  children,
  overlays,
}: ApplicationChromeProps) {
  const role = actor.role;
  const initials = actor.name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'SN';

  return (
    <div className="app-shell">
      <Sidebar role={role} actor={actor} initials={initials} activePage={activePage} onNavigate={onNavigate} />
      <div className="main-column">
        <div className="preview-banner verified-session-strip">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
            <strong>Verified:</strong> {actor.name} ({ROLE_LABELS[role]})
          </span>
          <button
            type="button"
            onClick={() => void onSignOut()}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--ink)',
            }}
          >
            Sign out
          </button>
        </div>
        <Topbar activePage={activePage} initials={initials} onQuickAdd={onQuickAdd} onToast={onToast} />
        <main className="main-content">
          {children}
        </main>
      </div>
      {overlays}
      {toast ? (
        <div className="toast" role="status">
          <CheckCircle2 aria-hidden="true" />
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Sidebar({
  role,
  actor,
  initials,
  activePage,
  onNavigate,
}: {
  role: CompanyRole;
  actor: SessionActor;
  initials: string;
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <button className="brand" type="button" onClick={() => onNavigate('Dashboard')}>
        <span className="brand-mark">SN</span>
        <span className="brand-copy">
          <strong>SN Practice CRM</strong>
          <small>SN &amp; Associates</small>
        </span>
      </button>
      <div className="sidebar-divider" />
      <nav className="nav-scroll">
        {getNavigationForRole(role).map((group) => (
          <div className="nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const selected = activePage === item.label;
              return (
                <button
                  className={selected ? 'nav-item is-active' : 'nav-item'}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => onNavigate(item.label)}
                  key={item.label}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="profile-card" type="button">
          <span className="avatar">{initials}</span>
          <span className="profile-copy">
            <strong>{actor.name}</strong>
            <small>{ROLE_LABELS[role]}</small>
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  activePage,
  initials,
  onQuickAdd,
  onToast,
}: {
  activePage: PageKey;
  initials: string;
  onQuickAdd: () => void;
  onToast: (message: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>Workspace / {activePage}</span>
        <strong>{activePage === 'Dashboard' ? 'Main dashboard' : activePage}</strong>
      </div>
      <div className="topbar-actions">
        <label className="search-control">
          <Search aria-hidden="true" />
          <span className="sr-only">Search the practice</span>
          <input placeholder="Search clients, PAN, GSTIN…" onKeyDown={(event) => event.key === 'Enter' && onToast('Search is ready for API wiring')} />
        </label>
        <button className="icon-button has-indicator" type="button" aria-label="Notifications" onClick={() => onToast('Three items need attention')}>
          <Bell aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="Create new item" onClick={onQuickAdd}>
          <Plus aria-hidden="true" />
        </button>
        <span className="user-avatar" aria-hidden="true">
          {initials}
        </span>
      </div>
    </header>
  );
}
