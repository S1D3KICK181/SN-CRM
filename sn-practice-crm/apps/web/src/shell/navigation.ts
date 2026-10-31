import type { LucideIcon } from 'lucide-react';
import {
  BriefcaseBusiness,
  Building2,
  Files,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  ReceiptIndianRupee,
  Settings2,
  TrendingUp,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';

export type PageKey =
  | 'Dashboard'
  | 'Clients'
  | 'Assignments'
  | 'My Tasks'
  | 'Team'
  | 'Documents'
  | 'Communication'
  | 'Billing & Collections'
  | 'Office Accounts'
  | 'Reports'
  | 'Settings';

interface NavItem {
  label: PageKey;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const ALL_NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard },
      { label: 'Clients', icon: Building2 },
      { label: 'Assignments', icon: BriefcaseBusiness },
      { label: 'My Tasks', icon: ListChecks },
    ],
  },
  {
    label: 'Practice',
    items: [
      { label: 'Team', icon: UsersRound },
      { label: 'Documents', icon: Files },
      { label: 'Communication', icon: MessageSquareText },
      { label: 'Billing & Collections', icon: ReceiptIndianRupee },
      { label: 'Office Accounts', icon: WalletCards },
      { label: 'Reports', icon: TrendingUp },
    ],
  },
  { label: 'System', items: [{ label: 'Settings', icon: Settings2 }] },
];

const ROLE_NAV: Record<CompanyRole, readonly PageKey[]> = {
  founder: [
    'Dashboard',
    'Clients',
    'Assignments',
    'My Tasks',
    'Team',
    'Documents',
    'Communication',
    'Billing & Collections',
    'Office Accounts',
    'Reports',
    'Settings',
  ],
  manager: [
    'Dashboard',
    'Clients',
    'Assignments',
    'My Tasks',
    'Team',
    'Documents',
    'Communication',
    'Billing & Collections',
    'Office Accounts',
    'Reports',
  ],
  senior_staff: [
    'Dashboard',
    'Clients',
    'Assignments',
    'My Tasks',
    'Billing & Collections',
    'Documents',
    'Communication',
    'Reports',
  ],
  staff: [
    'Dashboard',
    'Clients',
    'Assignments',
    'My Tasks',
    'Billing & Collections',
    'Documents',
    'Communication',
  ],
  trainee: ['Dashboard', 'My Tasks', 'Documents', 'Communication'],
};

export const MODULE_DESCRIPTIONS: Record<PageKey, string> = {
  Dashboard: '',
  Clients: 'Client identity, contacts, registrations, service history, documents, and communication in one record.',
  Assignments: 'Continuous monthly compliance schedules and ad-hoc client obligations with ownership, deadlines, and evidence.',
  'My Tasks': 'Personal reminders, delegated work, internal tasks, checklists, and due-time planning.',
  Team: 'Reporting lines, workload, capabilities, departments, and controlled access.',
  Documents: 'Client evidence, versions, requests, expiry dates, and Assignment links.',
  Communication: 'Client calls, emails, notes, reminders, and follow-ups with a complete activity trail.',
  'Billing & Collections': 'Invoices, receipts, allocations, outstanding fees, ageing, and collection follow-ups.',
  'Office Accounts': 'Manager-operated cash ledger, expenses, bank entries, and daily reconciliation.',
  Reports: 'Delivery, compliance, utilization, revenue, collection, and practice-performance reporting.',
  Settings: 'Founder-controlled access, practice configuration, numbering, templates, and audit history.',
};

export function getNavigationForRole(role: CompanyRole): NavGroup[] {
  const allowed = ROLE_NAV[role];
  return ALL_NAV.map((group) => ({ ...group, items: group.items.filter((item) => allowed.includes(item.label)) })).filter(
    (group) => group.items.length > 0,
  );
}
