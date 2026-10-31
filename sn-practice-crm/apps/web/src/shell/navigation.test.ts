import { describe, expect, it } from 'vitest';
import { COMPANY_ROLES, type CompanyRole } from '@sn/domain';
import { getNavigationForRole, type PageKey } from './navigation';

describe('navigation', () => {
  it('returns the exact ordered pages for founder', () => {
    const pages = getNavigationForRole('founder').flatMap((group) => group.items.map((item) => item.label));
    expect(pages).toEqual<PageKey[]>([
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
    ]);
  });

  it('returns the exact ordered pages for manager', () => {
    const pages = getNavigationForRole('manager').flatMap((group) => group.items.map((item) => item.label));
    expect(pages).toEqual<PageKey[]>([
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
    ]);
  });

  it('returns the exact ordered pages for senior_staff', () => {
    const pages = getNavigationForRole('senior_staff').flatMap((group) => group.items.map((item) => item.label));
    expect(pages).toEqual<PageKey[]>([
      'Dashboard',
      'Clients',
      'Assignments',
      'My Tasks',
      'Documents',
      'Communication',
      'Billing & Collections',
      'Reports',
    ]);
  });

  it('returns the exact ordered pages for staff', () => {
    const pages = getNavigationForRole('staff').flatMap((group) => group.items.map((item) => item.label));
    expect(pages).toEqual<PageKey[]>([
      'Dashboard',
      'Clients',
      'Assignments',
      'My Tasks',
      'Documents',
      'Communication',
      'Billing & Collections',
    ]);
  });

  it('returns the exact ordered pages for trainee', () => {
    const pages = getNavigationForRole('trainee').flatMap((group) => group.items.map((item) => item.label));
    expect(pages).toEqual<PageKey[]>([
      'Dashboard',
      'My Tasks',
      'Documents',
      'Communication',
    ]);
  });

  it.each(COMPANY_ROLES)('asserts no returned navigation group is empty for %s', (role: CompanyRole) => {
    const groups = getNavigationForRole(role);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });
});
