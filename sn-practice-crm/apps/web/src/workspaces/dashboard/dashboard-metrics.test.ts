import { describe, expect, it } from 'vitest';
import type {
  AssignmentRow,
  DelegatedTaskRecord,
  InvoiceRecord,
  PersonalTaskRecord,
  ReceiptRecord,
  RecurringScheduleRecord,
} from '../../data';
import {
  buildDepartmentTiles,
  buildMetricTiles,
  computeBilledAndCollected,
  computeComingUp,
  computeFeesSnapshot,
  computeNeedsAttention,
  computeOpenWorkByPerson,
  computePendingByClient,
  computeRecurringSummary,
  countDueToday,
  countOverdue,
  financialYearOf,
  myAssignments,
  openAssignments,
  overdueAssignments,
  taskDueIso,
  type MetricInput,
} from './dashboard-metrics';

const TODAY = '2026-11-13';

function assignment(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: 'a1',
    title: 'October GST',
    client: 'Aster Foods',
    service: 'GST',
    due: '20/11/2026',
    owner: 'Priya Desai',
    ownerId: 'u-priya',
    status: 'In progress',
    progress: 10,
    tone: 'default',
    ...overrides,
  };
}

function sla(status: NonNullable<AssignmentRow['sla']>['status']): NonNullable<AssignmentRow['sla']> {
  return { targetDays: 10, deadline: '2026-11-20', status, workingDaysUsed: 5, workingDaysLeft: 2 };
}

function bill(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'i1',
    invoiceNumber: 'INV-000001',
    clientId: 'c1',
    clientName: 'Aster Foods',
    description: 'Returns',
    invoiceDate: '05/11/2026',
    dueDate: '20/11/2026',
    subtotal: 1000,
    gstAmount: 0,
    total: 1000,
    amountReceived: 0,
    balance: 1000,
    balancePaise: 100000,
    status: 'Pending',
    daysOverdue: 0,
    ...overrides,
  };
}

function payment(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: 'r1',
    receiptNumber: 'RCT-000001',
    clientId: 'c1',
    clientName: 'Aster Foods',
    invoiceId: 'i1',
    invoiceNumber: 'INV-000001',
    receiptDate: '08/11/2026',
    amount: 400,
    amountPaise: 40000,
    paymentMode: 'UPI',
    referenceNumber: '',
    notes: '',
    status: 'Received',
    ...overrides,
  };
}

function schedule(overrides: Partial<RecurringScheduleRecord> = {}): RecurringScheduleRecord {
  return {
    id: 's1',
    title: 'GSTR-3B Monthly',
    category: 'GST',
    clientId: 'c1',
    clientName: 'Aster Foods',
    cadence: 'Monthly',
    defaultOwner: 'Priya Desai',
    nextRunDate: '01/12/2026',
    nextDueDate: '20/12/2026',
    status: 'Active',
    ...overrides,
  };
}

function task(overrides: Partial<DelegatedTaskRecord> = {}): DelegatedTaskRecord {
  return {
    id: 't1',
    kind: 'delegated',
    title: 'Check vouchers',
    parent: 'ASN-1',
    person: 'Neha',
    assignedBy: 'Priya',
    due: 'Today',
    progress: 0,
    status: 'To Do',
    ...overrides,
  };
}

const personal: PersonalTaskRecord = { id: 'p1', title: 'Call', context: 'Personal', time: 'Today', done: false };

function metricInput(overrides: Partial<MetricInput> = {}): MetricInput {
  return {
    role: 'founder',
    actorId: 'u-priya',
    today: TODAY,
    assignments: [],
    personalTasks: [],
    delegatedTasks: [],
    assignedToMe: [],
    reviewableTasks: [],
    invoices: [],
    feesState: 'ready',
    ...overrides,
  };
}

describe('assignment helpers', () => {
  it('treats Approved, Closed and Cancelled as not open', () => {
    const rows = [
      assignment({ id: 'a', status: 'Approved' }),
      assignment({ id: 'b', status: 'Closed' }),
      assignment({ id: 'c', status: 'Cancelled' }),
      assignment({ id: 'd', status: 'Ready for review' }),
    ];
    expect(openAssignments(rows).map((r) => r.id)).toEqual(['d']);
  });

  it('counts overdue and due-today among open work only', () => {
    const rows = [
      assignment({ id: 'a', due: '12/11/2026' }),
      assignment({ id: 'b', due: '13/11/2026' }),
      assignment({ id: 'c', due: '14/11/2026' }),
      assignment({ id: 'd', due: '01/11/2026', status: 'Closed' }),
      assignment({ id: 'e', due: '' }),
    ];
    expect(countOverdue(rows, TODAY)).toBe(1);
    expect(countDueToday(rows, TODAY)).toBe(1);
  });

  it('returns zero for empty input', () => {
    expect(countOverdue([], TODAY)).toBe(0);
    expect(countDueToday([], TODAY)).toBe(0);
  });

  it('finds mine by owner, and by reviewer for Senior Staff only', () => {
    const rows = [
      assignment({ id: 'own', ownerId: 'me' }),
      assignment({ id: 'review', ownerId: 'x', reviewerIds: ['me'] }),
      assignment({ id: 'other', ownerId: 'x' }),
    ];
    expect(myAssignments('senior_staff', rows, 'me').map((r) => r.id)).toEqual(['own', 'review']);
    expect(myAssignments('staff', rows, 'me').map((r) => r.id)).toEqual(['own']);
  });
});

describe('financialYearOf', () => {
  it('runs April to March', () => {
    expect(financialYearOf('2026-11-13')).toMatchObject({ label: '2026–27', start: '2026-04-01', end: '2027-03-31' });
    expect(financialYearOf('2027-02-10')).toMatchObject({ label: '2026–27', start: '2026-04-01' });
    expect(financialYearOf('2026-04-01').label).toBe('2026–27');
    expect(financialYearOf('2026-03-31').label).toBe('2025–26');
  });
});

describe('fees', () => {
  const invoices = [
    bill({ id: 'p', clientId: 'c1', status: 'Pending', balancePaise: 100000 }),
    bill({ id: 'o', clientId: 'c2', clientName: 'BluePeak', status: 'Overdue', balancePaise: 250050, daysOverdue: 40, invoiceDate: '01/10/2026' }),
    bill({ id: 'o2', clientId: 'c2', clientName: 'BluePeak', status: 'Overdue', balancePaise: 50000, daysOverdue: 12, invoiceDate: '01/10/2026' }),
    bill({ id: 'pd', status: 'Paid', balancePaise: 0, total: 500 }),
    bill({ id: 'dr', status: 'Draft', balancePaise: 900000, total: 9000 }),
    bill({ id: 'x', status: 'Cancelled', balancePaise: 900000, total: 9000 }),
  ];

  it('sums pending and overdue balances of the right statuses only', () => {
    const result = computePendingByClient(invoices);
    expect(result.totalPaise).toBe(400050);
    expect(result.overduePaise).toBe(300050);
    expect(result.clients.map((c) => [c.clientName, c.pendingPaise, c.overdueDays])).toEqual([
      ['BluePeak', 300050, 40],
      ['Aster Foods', 100000, 0],
    ]);
  });

  it('computes the monthly snapshot and collection percentage', () => {
    const snapshot = computeFeesSnapshot(invoices, [payment(), payment({ id: 'r2', status: 'Voided' })], TODAY);
    expect(snapshot.billsThisMonth).toBe(2); // pending + paid, dated 05/11
    expect(snapshot.billedThisMonthPaise).toBe(150000);
    expect(snapshot.paymentsThisMonth).toBe(1);
    expect(snapshot.collectedThisMonthPaise).toBe(40000);
    expect(snapshot.pendingClients).toBe(2);
    expect(snapshot.oldestOverdueDays).toBe(40);
    // billed in FY: 1000 + 1000 + 1000 + 500 = 3500; collected 400
    expect(snapshot.collectedPercent).toBe(11);
  });

  it('caps the percentage at 100 and hides it when nothing is billed', () => {
    const big = payment({ amountPaise: 99999900, amount: 999999 });
    expect(computeFeesSnapshot([bill()], [big], TODAY).collectedPercent).toBe(100);
    expect(computeFeesSnapshot([], [], TODAY).collectedPercent).toBeNull();
  });

  it('handles empty input', () => {
    expect(computePendingByClient([])).toEqual({ totalPaise: 0, overduePaise: 0, clients: [] });
    const snapshot = computeFeesSnapshot([], [], TODAY);
    expect(snapshot.pendingPaise).toBe(0);
    expect(snapshot.oldestOverdueDays).toBe(0);
  });

  it('builds one pair per month from April to now', () => {
    const result = computeBilledAndCollected(
      [bill({ invoiceDate: '10/04/2026', total: 200 }), bill({ id: 'n', invoiceDate: '05/11/2026', total: 100 }), bill({ id: 'old', invoiceDate: '10/03/2026', total: 777 })],
      [payment({ receiptDate: '02/11/2026', amountPaise: 5000 })],
      TODAY,
    );
    expect(result.months.map((m) => m.label)).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(result.months[0]?.billedPaise).toBe(20000);
    expect(result.months[7]).toMatchObject({ billedPaise: 10000, collectedPaise: 5000 });
    expect(result.billedPaise).toBe(30000);
    expect(result.billCount).toBe(2);
    expect(result.financialYear.label).toBe('2026–27');
  });

  it('spans into the next calendar year', () => {
    const result = computeBilledAndCollected([], [], '2027-02-01');
    expect(result.months.map((m) => m.label)).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb']);
    expect(result.billCount).toBe(0);
  });
});

describe('computeComingUp', () => {
  it('lists overdue first, then by date, capped at six with chips', () => {
    const rows = [
      assignment({ id: '1', title: 'Soon', due: '15/11/2026' }),
      assignment({ id: '2', title: 'Late', due: '10/11/2026' }),
      assignment({ id: '3', title: 'Now', due: '13/11/2026' }),
      assignment({ id: '4', title: 'Far', due: '30/11/2026' }),
      assignment({ id: '5', title: 'Done', due: '01/11/2026', status: 'Closed' }),
      assignment({ id: '6', title: 'A', due: '31/12/2026' }),
      assignment({ id: '7', title: 'B', due: '31/12/2026' }),
      assignment({ id: '8', title: 'C', due: '31/12/2026' }),
    ];
    const { items } = computeComingUp(rows, TODAY);
    expect(items.map((i) => i.title)).toEqual(['Late', 'Now', 'Soon', 'Far', 'A', 'B']);
    expect(items.slice(0, 4).map((i) => [i.dateLabel, i.chip, i.tone])).toEqual([
      ['10/11', 'Overdue', 'danger'],
      ['Today', 'Due today', 'danger'],
      ['15/11', 'Due soon', 'warning'],
      ['30/11', 'Scheduled', 'default'],
    ]);
  });

  it('reports open work that has no date', () => {
    expect(computeComingUp([assignment({ due: '' })], TODAY)).toEqual({ items: [], openCount: 1 });
    expect(computeComingUp([], TODAY)).toEqual({ items: [], openCount: 0 });
  });
});

describe('computeOpenWorkByPerson', () => {
  it('counts open work per owner with relative bars', () => {
    const rows = [
      assignment({ id: '1', owner: 'Priya', ownerId: 'p' }),
      assignment({ id: '2', owner: 'Priya', ownerId: 'p' }),
      assignment({ id: '3', owner: 'Priya', ownerId: 'p' }),
      assignment({ id: '4', owner: 'Rohan', ownerId: 'r' }),
      assignment({ id: '5', owner: 'Rohan', ownerId: 'r', status: 'Closed' }),
    ];
    expect(computeOpenWorkByPerson(rows)).toEqual([
      { key: 'p', name: 'Priya', open: 3, widthPercent: 100 },
      { key: 'r', name: 'Rohan', open: 1, widthPercent: (1 / 3) * 100 },
    ]);
    expect(computeOpenWorkByPerson([])).toEqual([]);
  });

  it('keeps the six busiest owners', () => {
    const rows = Array.from({ length: 8 }, (_, i) => assignment({ id: `a${i}`, owner: `P${i}`, ownerId: `p${i}` }));
    expect(computeOpenWorkByPerson(rows)).toHaveLength(6);
  });

  it('gives each listed member a row even with nothing open, and counts their open work under the same row', () => {
    const rows = [
      assignment({ id: '1', owner: 'Priya', ownerId: 'p' }),
      assignment({ id: '2', owner: 'Outsider', ownerId: 'o' }),
      assignment({ id: '3', owner: 'Priya', ownerId: 'p', status: 'Closed' }),
    ];
    const members = [
      { id: 'p', name: 'Priya' },
      { id: 'r', name: 'Rohan' },
    ];
    expect(computeOpenWorkByPerson(rows, 6, members)).toEqual([
      { key: 'o', name: 'Outsider', open: 1, widthPercent: 100 },
      { key: 'p', name: 'Priya', open: 1, widthPercent: 100 },
      { key: 'r', name: 'Rohan', open: 0, widthPercent: 0 },
    ]);
    expect(computeOpenWorkByPerson([], 6, members).map((p) => [p.name, p.open])).toEqual([
      ['Priya', 0],
      ['Rohan', 0],
    ]);
  });
});

describe('buildDepartmentTiles', () => {
  it('counts open, due today, overdue and waiting for review over the given assignments only', () => {
    const rows = [
      assignment({ id: '1', due: '13/11/2026', sla: sla('breached') }),
      assignment({ id: '2', due: '10/11/2026', status: 'Ready for review' }),
      assignment({ id: '3', due: '01/11/2026', sla: sla('at_risk') }),
      assignment({ id: '4', due: '01/11/2026', status: 'Approved' }),
      assignment({ id: '5', due: '20/11/2026', status: 'Ready for review' }),
    ];
    expect(buildDepartmentTiles(rows, TODAY)).toEqual([
      { label: 'Open assignments', value: '4', note: '2 in progress', tone: 'default' },
      { label: 'Due today', value: '1', note: '2 overdue', tone: 'danger' },
      { label: 'Overdue', value: '2', note: 'Past their due date', tone: 'danger' },
      { label: 'Waiting for review', value: '2', note: 'Founder or Manager action', tone: 'warning' },
      { label: 'At risk / breached', value: '1 / 1', note: 'Of open work with a target', tone: 'danger' },
    ]);
  });

  it('stays calm when nothing needs action', () => {
    expect(buildDepartmentTiles([assignment({ due: '20/11/2026' })], TODAY)).toEqual([
      { label: 'Open assignments', value: '1', note: '1 in progress', tone: 'default' },
      { label: 'Due today', value: '0', note: 'None overdue', tone: 'default' },
      { label: 'Overdue', value: '0', note: 'Past their due date', tone: 'default' },
      { label: 'Waiting for review', value: '0', note: 'Founder or Manager action', tone: 'default' },
      { label: 'At risk / breached', value: '0 / 0', note: 'Of open work with a target', tone: 'default' },
    ]);
    expect(buildDepartmentTiles([], TODAY).map((tile) => tile.value)).toEqual(['0', '0', '0', '0', '0 / 0']);
  });
});

describe('overdueAssignments', () => {
  it('lists open work past its due date, earliest first, and leaves closed and undated work out', () => {
    const rows = [
      assignment({ id: 'late', due: '10/11/2026', title: 'B' }),
      assignment({ id: 'later', due: '01/11/2026', title: 'A' }),
      assignment({ id: 'today', due: '13/11/2026' }),
      assignment({ id: 'done', due: '01/11/2026', status: 'Approved' }),
      assignment({ id: 'undated', due: '' }),
    ];
    expect(overdueAssignments(rows, TODAY).map((a) => a.id)).toEqual(['later', 'late']);
  });
});

describe('computeRecurringSummary', () => {
  it('counts active and paused, top categories and the soonest next due date', () => {
    const summary = computeRecurringSummary([
      schedule({ id: '1', category: 'GST', nextDueDate: '20/12/2026', title: 'Later' }),
      schedule({ id: '2', category: 'GST', nextDueDate: '11/12/2026', title: 'Sooner' }),
      schedule({ id: '3', category: 'TDS', status: 'Needs attention', nextDueDate: '15/12/2026' }),
      schedule({ id: '4', category: 'Payroll', status: 'Paused', nextDueDate: '01/12/2026', title: 'Paused one' }),
    ]);
    expect(summary).toMatchObject({ total: 4, active: 3, paused: 1 });
    expect(summary.categories).toEqual([
      { category: 'GST', active: 2 },
      { category: 'TDS', active: 1 },
    ]);
    expect(summary.next).toEqual({ dueDisplay: '11/12/2026', title: 'Sooner' });
  });

  it('handles no schedules and no usable date', () => {
    expect(computeRecurringSummary([])).toMatchObject({ total: 0, active: 0, paused: 0, next: null });
    expect(computeRecurringSummary([schedule({ nextDueDate: '—' })]).next).toBeNull();
  });
});

describe('computeNeedsAttention', () => {
  it('orders overdue work, returned work, then overdue bills', () => {
    const { all } = computeNeedsAttention(
      [
        assignment({ id: '1', title: 'Returned', status: 'Changes requested', due: '30/11/2026' }),
        assignment({ id: '2', title: 'Late', due: '10/11/2026' }),
        assignment({ id: '3', title: 'Late and returned', status: 'Changes requested', due: '01/11/2026' }),
      ],
      [bill({ id: 'b', status: 'Overdue', balancePaise: 250000, vyaparBillNumber: 'VYP-9', clientName: 'BluePeak' })],
      TODAY,
    );
    expect(all.map((i) => [i.title, i.detail, i.chip])).toEqual([
      ['Late and returned', 'Aster Foods', '12d overdue'],
      ['Late', 'Aster Foods', '3d overdue'],
      ['Returned', 'Aster Foods', 'Changes requested'],
      ['BluePeak', 'VYP-9', '₹2,500'],
    ]);
  });

  it('is empty when there is nothing to flag', () => {
    expect(computeNeedsAttention([], [], TODAY).all).toEqual([]);
  });
});

describe('taskDueIso', () => {
  it('understands Today, Tomorrow and DD/MM/YYYY', () => {
    expect(taskDueIso('Today', TODAY)).toBe(TODAY);
    expect(taskDueIso('Tomorrow', TODAY)).toBe('2026-11-14');
    expect(taskDueIso('05/11/2026', TODAY)).toBe('2026-11-05');
    expect(taskDueIso('soon', TODAY)).toBe('');
  });
});

describe('buildMetricTiles', () => {
  const rows = [
    assignment({ id: '1', due: '12/11/2026', ownerId: 'u-priya', sla: sla('breached') }),
    assignment({ id: '2', due: '13/11/2026', ownerId: 'u-priya', status: 'Ready for review', sla: sla('met') }),
    assignment({
      id: '3',
      due: '20/11/2026',
      ownerId: 'x',
      reviewerIds: ['u-priya'],
      status: 'Changes requested',
      sla: sla('at_risk'),
    }),
    assignment({ id: '4', due: '12/11/2026', ownerId: 'x', status: 'Closed', sla: sla('late') }),
  ];
  const invoices = [bill({ status: 'Overdue', balancePaise: 120000, daysOverdue: 3 }), bill({ id: 'b2', balancePaise: 30000 })];

  it('Founder', () => {
    expect(buildMetricTiles(metricInput({ assignments: rows, invoices }))).toEqual([
      { label: 'Due today', value: '1', note: '1 overdue', tone: 'danger' },
      { label: 'Open assignments', value: '3', note: '1 in progress', tone: 'default' },
      { label: 'Waiting for review', value: '1', note: 'Founder or Manager action', tone: 'warning' },
      { label: 'Pending fees', value: '₹1,500', note: '₹1,200 overdue', tone: 'danger' },
      { label: 'At risk / breached', value: '1 / 1', note: 'Of open work with a target', tone: 'danger' },
    ]);
  });

  it('Founder with nothing at all', () => {
    expect(buildMetricTiles(metricInput())).toEqual([
      { label: 'Due today', value: '0', note: 'None overdue', tone: 'default' },
      { label: 'Open assignments', value: '0', note: '0 in progress', tone: 'default' },
      { label: 'Waiting for review', value: '0', note: 'Founder or Manager action', tone: 'default' },
      { label: 'Pending fees', value: '₹0', note: '₹0 overdue', tone: 'default' },
      { label: 'At risk / breached', value: '0 / 0', note: 'Of open work with a target', tone: 'default' },
    ]);
  });

  it('shows placeholders while fees load or fail', () => {
    const loading = buildMetricTiles(metricInput({ feesState: 'loading' }))[3];
    const failed = buildMetricTiles(metricInput({ role: 'manager', feesState: 'error' }))[3];
    expect(loading).toMatchObject({ value: '—', note: 'Loading fees…' });
    expect(failed).toMatchObject({ value: '—', note: 'Fees could not be loaded' });
  });

  it('Manager', () => {
    const tiles = buildMetricTiles(metricInput({ role: 'manager', assignments: rows, invoices }));
    expect(tiles.map((t) => t.label)).toEqual([
      'Due today',
      'Waiting for review',
      'Changes requested',
      'Pending fees',
      'At risk / breached',
    ]);
    expect(tiles[2]).toEqual({ label: 'Changes requested', value: '1', note: 'Back with the preparer', tone: 'warning' });
  });

  it('Senior Staff counts owned and reviewed work', () => {
    const tiles = buildMetricTiles(
      metricInput({
        role: 'senior_staff',
        assignments: rows,
        delegatedTasks: [task({ status: 'In Progress' }), task({ id: 't2', status: 'Completed' })],
        reviewableTasks: [task({ status: 'Pending Review' })],
      }),
    );
    expect(tiles).toEqual([
      { label: 'My assignments', value: '3', note: '1 due today', tone: 'default' },
      { label: 'Overdue', value: '1', note: 'Past their due date', tone: 'danger' },
      { label: 'Waiting for my review', value: '1', note: 'Delegated work submitted', tone: 'warning' },
      { label: 'Delegated tasks', value: '1', note: '1 in progress', tone: 'default' },
      { label: 'At risk / breached', value: '1 / 1', note: 'Of open work with a target', tone: 'danger' },
    ]);
  });

  it('Staff counts only owned work', () => {
    const tiles = buildMetricTiles(
      metricInput({
        role: 'staff',
        assignments: rows,
        delegatedTasks: [task()],
        personalTasks: [personal, { ...personal, id: 'p2', done: true }],
      }),
    );
    expect(tiles).toEqual([
      { label: 'My assignments', value: '2', note: '1 due today', tone: 'default' },
      { label: 'Overdue', value: '1', note: 'Past their due date', tone: 'danger' },
      { label: 'With others', value: '1', note: 'Delegated by me', tone: 'default' },
      { label: 'Personal tasks', value: '1', note: '1 done', tone: 'default' },
      { label: 'At risk / breached', value: '0 / 1', note: 'Of open work with a target', tone: 'danger' },
    ]);
  });

  it('tones the SLA tile by its worst case, ignoring stopped work and work with no target', () => {
    const tile = (...list: AssignmentRow[]) => buildMetricTiles(metricInput({ assignments: list }))[4];
    expect(tile(assignment({ sla: sla('at_risk') }))).toMatchObject({ value: '1 / 0', tone: 'warning' });
    expect(tile(assignment({ sla: sla('at_risk') }), assignment({ id: 'b', sla: sla('breached') }))).toMatchObject({
      value: '1 / 1',
      tone: 'danger',
    });
    expect(tile(assignment({ sla: sla('on_track') }), assignment({ id: 'b', sla: null }))).toMatchObject({
      value: '0 / 0',
      tone: 'default',
    });
    expect(tile(assignment({ status: 'Ready for review', sla: sla('met') }))).toMatchObject({ value: '0 / 0' });
  });

  it('Trainee', () => {
    const tiles = buildMetricTiles(
      metricInput({
        role: 'trainee',
        assignedToMe: [
          task({ due: 'Today', status: 'In Progress' }),
          task({ id: 't2', due: '10/11/2026' }),
          task({ id: 't3', due: 'Tomorrow', status: 'Pending Review' }),
          task({ id: 't4', due: 'Today', status: 'Completed' }),
        ],
      }),
    );
    expect(tiles).toEqual([
      { label: 'Assigned to me', value: '3', note: '1 in progress', tone: 'default' },
      { label: 'Due today', value: '1', note: '1 overdue', tone: 'danger' },
      { label: 'Submitted for review', value: '1', note: 'Waiting for a reviewer', tone: 'warning' },
      { label: 'Personal tasks', value: '0', note: '0 done', tone: 'default' },
    ]);
  });
});
