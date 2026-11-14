// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DepartmentDto } from '@sn/contracts';
import type { AssignmentRow } from '../../data';
import {
  assignmentsOfDepartment,
  departmentViewOptions,
  MY_DASHBOARD_VIEW,
  readStoredDashboardView,
  resolveDashboardView,
  storeDashboardView,
} from './department-view';

const ANANYA = '00000000-0000-4000-a000-000000000003';
const ROHAN = '00000000-0000-4000-a000-000000000004';
const NEHA = '00000000-0000-4000-a000-000000000005';

function department(id: string, name: string, overrides: Partial<DepartmentDto> = {}): DepartmentDto {
  return {
    id,
    name,
    isActive: true,
    members: [],
    serviceIds: [],
    createdAt: '2026-11-01T04:30:00.000Z',
    updatedAt: '2026-11-01T04:30:00.000Z',
    ...overrides,
  };
}

const AUDIT = department('d-audit', 'Audit', {
  members: [
    { userId: ANANYA, name: 'Ananya Rao', role: 'senior_staff', isHead: true },
    { userId: ROHAN, name: 'Rohan Mehta', role: 'staff', isHead: false },
    { userId: NEHA, name: 'Neha Kapoor', role: 'trainee', isHead: false },
  ],
  serviceIds: ['svc-audit', 'svc-tax-audit'],
});
const GST = department('d-gst', 'GST', {
  members: [{ userId: ROHAN, name: 'Rohan Mehta', role: 'staff', isHead: true }],
  serviceIds: ['svc-gst'],
});
const RETIRED = department('d-old', 'Old', {
  isActive: false,
  members: [{ userId: ANANYA, name: 'Ananya Rao', role: 'senior_staff', isHead: true }],
});
const ALL = [AUDIT, GST, RETIRED];

// Node's own experimental localStorage hides the jsdom one, so give the tests a plain in-memory storage
function memoryStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    ...overrides,
  };
}

const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

function useStorage(storage: Storage | undefined) {
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

beforeEach(() => {
  useStorage(memoryStorage());
});

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor);
  else Reflect.deleteProperty(window, 'localStorage');
});

describe('departmentViewOptions', () => {
  it.each(['founder', 'manager'] as const)('gives the %s every active department', (role) => {
    expect(departmentViewOptions(role, 'someone', ALL).map((d) => d.name)).toEqual(['Audit', 'GST']);
  });

  it('gives a head only the active departments they head', () => {
    expect(departmentViewOptions('senior_staff', ANANYA, ALL).map((d) => d.name)).toEqual(['Audit']);
    expect(departmentViewOptions('staff', ROHAN, ALL).map((d) => d.name)).toEqual(['GST']);
  });

  it('gives a plain member and anyone outside the departments nothing', () => {
    expect(departmentViewOptions('staff', ROHAN, [AUDIT])).toEqual([]);
    expect(departmentViewOptions('senior_staff', '00000000-0000-4000-a000-000000000009', ALL)).toEqual([]);
  });

  it('gives a trainee nothing, even when they are somehow marked head', () => {
    const odd = department('d-odd', 'Odd', { members: [{ userId: NEHA, name: 'Neha Kapoor', role: 'trainee', isHead: true }] });
    expect(departmentViewOptions('trainee', NEHA, [odd])).toEqual([]);
  });

  it('gives nobody a view when there are no departments', () => {
    expect(departmentViewOptions('founder', 'x', [])).toEqual([]);
  });
});

describe('assignmentsOfDepartment', () => {
  const row = (id: string, serviceId?: string): AssignmentRow => ({
    id,
    title: id,
    client: 'Aster Foods',
    service: 'Service',
    ...(serviceId !== undefined ? { serviceId } : {}),
    due: '20/11/2026',
    owner: 'Priya Desai',
    status: 'In progress',
    progress: 0,
    tone: 'default',
  });

  it('keeps the assignments filed under one of the department services', () => {
    const rows = [row('a', 'svc-audit'), row('b', 'svc-gst'), row('c', 'svc-tax-audit'), row('d', 'svc-other'), row('e')];
    expect(assignmentsOfDepartment(rows, AUDIT).map((a) => a.id)).toEqual(['a', 'c']);
    expect(assignmentsOfDepartment(rows, GST).map((a) => a.id)).toEqual(['b']);
    expect(assignmentsOfDepartment(rows, department('d-empty', 'Empty'))).toEqual([]);
  });
});

describe('resolveDashboardView', () => {
  it('uses the chosen department while the person may still open it, otherwise their own dashboard', () => {
    expect(resolveDashboardView('d-audit', [AUDIT, GST])).toBe('d-audit');
    expect(resolveDashboardView('d-gst', [AUDIT])).toBe(MY_DASHBOARD_VIEW);
    expect(resolveDashboardView(null, [AUDIT])).toBe(MY_DASHBOARD_VIEW);
    expect(resolveDashboardView(MY_DASHBOARD_VIEW, [AUDIT])).toBe(MY_DASHBOARD_VIEW);
    expect(resolveDashboardView('d-audit', [])).toBe(MY_DASHBOARD_VIEW);
  });
});

describe('the remembered view', () => {
  it('stores the choice per person and reads it back', () => {
    expect(readStoredDashboardView(ANANYA)).toBeNull();
    storeDashboardView(ANANYA, 'd-audit');
    storeDashboardView(ROHAN, MY_DASHBOARD_VIEW);
    expect(readStoredDashboardView(ANANYA)).toBe('d-audit');
    expect(readStoredDashboardView(ROHAN)).toBe(MY_DASHBOARD_VIEW);
  });

  it('survives storage that throws on read or write', () => {
    useStorage(
      memoryStorage({
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    );
    expect(readStoredDashboardView(ANANYA)).toBeNull();
    expect(() => storeDashboardView(ANANYA, 'd-audit')).not.toThrow();
  });

  it('survives a browser with no storage at all, or one whose accessor throws', () => {
    useStorage(undefined);
    expect(readStoredDashboardView(ANANYA)).toBeNull();
    expect(() => storeDashboardView(ANANYA, 'd-audit')).not.toThrow();
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new Error('SecurityError');
      },
      configurable: true,
    });
    expect(readStoredDashboardView(ANANYA)).toBeNull();
    expect(() => storeDashboardView(ANANYA, 'd-audit')).not.toThrow();
  });
});
