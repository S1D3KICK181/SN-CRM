import type { ReactNode } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { COMPANY_ROLES, type CompanyRole } from '@sn/domain';
import { ROLE_LABELS, ROLE_PEOPLE } from '../data';
import { getNavigationForRole, type PageKey } from './navigation';

interface ApplicationChromeProps {
  role: CompanyRole;
  activePage: PageKey;
  toast: string | null;
  onRoleChange: (role: CompanyRole) => void;
  onNavigate: (page: PageKey) => void;
  onQuickAdd: () => void;
  onToast: (message: string) => void;
  children: ReactNode;
  overlays?: ReactNode;
}

export function ApplicationChrome({
  role,
  activePage,
  toast,
  onRoleChange,
  onNavigate,
  onQuickAdd,
  onToast,
  children,
  overlays,
}: ApplicationChromeProps) {
  const person = ROLE_PEOPLE[role];

  return (
    <div className="app-shell">
      <Sidebar role={role} activePage={activePage} onNavigate={onNavigate} />
      <div className="main-column">
        <div className="preview-banner">
          <span>
            <Sparkles aria-hidden="true" />
            <strong>Clean-slate preview</strong> · permission-aware demo data
          </span>
          <label>
            Preview as
            <select value={role} onChange={(event) => onRoleChange(event.target.value as CompanyRole)}>
              {COMPANY_ROLES.map((item) => (
                <option value={item} key={item}>
                  {ROLE_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Topbar activePage={activePage} person={person} onQuickAdd={onQuickAdd} onToast={onToast} />
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
  activePage,
  onNavigate,
}: {
  role: CompanyRole;
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
}) {
  const person = ROLE_PEOPLE[role];
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
          <span className="avatar">{person.initials}</span>
          <span className="profile-copy">
            <strong>{person.name}</strong>
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
  person,
  onQuickAdd,
  onToast,
}: {
  activePage: PageKey;
  person: { initials: string };
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
          {person.initials}
        </span>
      </div>
    </header>
  );
}
