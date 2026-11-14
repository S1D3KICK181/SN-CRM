// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PracticeReportDto } from '@sn/contracts';
import { ReportsOperationError } from '../../api/reports-types';
import { DeterministicTestReportsAdapter } from '../../api/test-reports-adapter';
import { downloadCsv } from './csv';
import { ReportsWorkspace } from './reports-workspace';

vi.mock('./csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./csv')>();
  return { ...actual, downloadCsv: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const TODAY = '2026-11-14'; // a Saturday

const report: PracticeReportDto = {
  period: { kind: 'week', start: '2026-11-09', endExclusive: '2026-11-16', label: '9–15 Nov 2026' },
  workProgress: {
    summary: { created: 3, completed: 2, submittedForReview: 1, overdueNow: 4, dueNext7Days: 6 },
    byService: [
      { serviceName: 'GST Compliance', created: 3, completed: 2, openNow: 5, overdueNow: 1 },
      { serviceName: 'Statutory Audit, FY 2025-26', created: 0, completed: 0, openNow: 1, overdueNow: 0 },
    ],
    byOwner: [{ ownerName: 'Rohan Mehta', created: 3, completed: 2, openNow: 5, overdueNow: 1 }],
    overdueList: [
      {
        assignmentCode: 'AS-001004',
        title: 'Monthly Bookkeeping & Closing',
        clientName: 'Kedia Holdings',
        ownerName: 'Rohan Mehta',
        dueDate: '2026-11-12',
        daysOverdue: 2,
      },
    ],
  },
  teamActivity: [
    {
      name: 'Priya Desai',
      role: 'manager',
      assignmentsCompleted: 1,
      submittedForReview: 0,
      tasksCompleted: 2,
      tasksOpen: 1,
      tasksOverdue: 0,
      reviewsDone: 3,
    },
    {
      name: 'Rohan Mehta',
      role: 'staff',
      assignmentsCompleted: 2,
      submittedForReview: 1,
      tasksCompleted: 4,
      tasksOpen: 3,
      tasksOverdue: 1,
      reviewsDone: 0,
    },
  ],
  fees: {
    summary: {
      billsRecorded: 2,
      billedPaise: 1180000,
      paymentsReceived: 1,
      receivedPaise: 400050,
      pendingNowPaise: 880000,
      overdueNowPaise: 880000,
      creditHeldPaise: 100000,
    },
    byClient: [
      {
        clientCode: 'CL-001002',
        clientName: 'BluePeak Tech',
        billedPaise: 1180000,
        receivedPaise: 400050,
        pendingNowPaise: 880000,
        overdueNowPaise: 880000,
        creditPaise: 100000,
      },
    ],
  },
  followUps: {
    messagesByPurpose: [
      { purpose: 'payment_reminder', count: 2 },
      { purpose: 'general', count: 1 },
    ],
    documentsByCategory: [{ category: 'agreements', count: 1 }],
    needsFollowUp: [
      {
        clientCode: 'CL-001002',
        clientName: 'BluePeak Tech',
        overdueAssignments: 0,
        overdueFeesPaise: 880000,
        lastMessageAt: null,
      },
      {
        clientCode: 'CL-001001',
        clientName: 'Aster Foods',
        overdueAssignments: 1,
        overdueFeesPaise: 0,
        lastMessageAt: '2026-10-25T10:00:00.000Z',
      },
    ],
  },
};

const emptyReport: PracticeReportDto = {
  period: { kind: 'day', start: '2026-11-14', endExclusive: '2026-11-15', label: '14 Nov 2026' },
  workProgress: {
    summary: { created: 0, completed: 0, submittedForReview: 0, overdueNow: 0, dueNext7Days: 0 },
    byService: [],
    byOwner: [],
    overdueList: [],
  },
  teamActivity: [],
  fees: {
    summary: {
      billsRecorded: 0,
      billedPaise: 0,
      paymentsReceived: 0,
      receivedPaise: 0,
      pendingNowPaise: 0,
      overdueNowPaise: 0,
      creditHeldPaise: 0,
    },
    byClient: [],
  },
  followUps: { messagesByPurpose: [], documentsByCategory: [], needsFollowUp: [] },
};

function setup(role: Parameters<typeof ReportsWorkspace>[0]['role'] = 'founder', data: PracticeReportDto = report) {
  const port = new DeterministicTestReportsAdapter();
  port.setReport(role, data);
  const view = render(<ReportsWorkspace role={role} port={port} today={TODAY} />);
  return { port, ...view };
}

async function loaded(role: Parameters<typeof ReportsWorkspace>[0]['role'] = 'founder', data: PracticeReportDto = report) {
  const result = setup(role, data);
  await screen.findByRole('tablist', { name: 'Reports' });
  return result;
}

const section = (name: string) => screen.getByRole('region', { name });

describe('ReportsWorkspace header', () => {
  it('opens on this week with the period label, the as-of-now note and the period controls', async () => {
    const { port } = await loaded();
    expect(port.calls).toEqual([expect.objectContaining({ role: 'founder', query: { period: 'week', date: TODAY } })]);
    expect(screen.getByText('9–15 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Open, overdue, pending and credit figures are as of now.')).toBeTruthy();
    const period = screen.getByRole('group', { name: 'Period' });
    expect(within(period).getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(period).getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(period).getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByLabelText('Report date') as HTMLInputElement).value).toBe(TODAY);
    expect((screen.getByLabelText('Report date') as HTMLInputElement).max).toBe(TODAY);
  });

  it('shows the staff note to Senior Staff and Staff only', async () => {
    for (const role of ['senior_staff', 'staff'] as const) {
      await loaded(role);
      expect(screen.getByText('Showing your own work and the clients you look after.')).toBeTruthy();
      cleanup();
    }
    for (const role of ['founder', 'manager'] as const) {
      await loaded(role);
      expect(screen.queryByText('Showing your own work and the clients you look after.')).toBeNull();
      cleanup();
    }
  });

  it('shows a Trainee no report and makes no request', async () => {
    const { port } = setup('trainee');
    expect(screen.getByText('Reports are restricted')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Period' })).toBeNull();
    expect(port.calls).toHaveLength(0);
  });

  it('loads the day, week or month the reader picks', async () => {
    const { port } = await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'day', date: TODAY }));
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('true');
    await screen.findByRole('tablist', { name: 'Reports' });
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'month', date: TODAY }));
  });

  it('moves to the previous and next period and disables Next at the current one', async () => {
    const { port } = await loaded();
    const next = screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    // Monday 9 November is in the current week, so the previous week starts on Monday 2 November
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'week', date: '2026-11-02' }));
    expect((screen.getByLabelText('Report date') as HTMLInputElement).value).toBe('2026-11-02');
    await screen.findByRole('tablist', { name: 'Reports' });
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'week', date: '2026-11-09' }));
    await screen.findByRole('tablist', { name: 'Reports' });
    expect((screen.getByRole('button', { name: /Next/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('steps by a day and by a month, across a month and a year edge', async () => {
    const { port } = await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await screen.findByRole('tablist', { name: 'Reports' });
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'day', date: '2026-11-13' }));
    await screen.findByRole('tablist', { name: 'Reports' });

    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await screen.findByRole('tablist', { name: 'Reports' });
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'month', date: '2026-10-01' }));
  });

  it('crosses a year edge going back by a month', async () => {
    const port = new DeterministicTestReportsAdapter();
    port.setReport('founder', report);
    render(<ReportsWorkspace role="founder" port={port} today="2027-01-10" />);
    await screen.findByRole('tablist', { name: 'Reports' });
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await screen.findByRole('tablist', { name: 'Reports' });
    fireEvent.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'month', date: '2026-12-01' }));
  });

  it('loads the date chosen in the date picker and never a future date', async () => {
    const { port } = await loaded();
    const picker = screen.getByLabelText('Report date') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '2026-11-03' } });
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'week', date: '2026-11-03' }));
    await screen.findByRole('tablist', { name: 'Reports' });

    fireEvent.change(picker, { target: { value: '2026-12-25' } });
    await waitFor(() => expect(port.calls.at(-1)?.query).toEqual({ period: 'week', date: TODAY }));
    expect((screen.getByLabelText('Report date') as HTMLInputElement).value).toBe(TODAY);
  });

  it('shows a loading state and no figures until the report arrives', async () => {
    const port = new DeterministicTestReportsAdapter();
    let resolve: (value: PracticeReportDto) => void = () => undefined;
    port.enqueueDeferredReport(new Promise<PracticeReportDto>((done) => (resolve = done)));
    render(<ReportsWorkspace role="founder" port={port} today={TODAY} />);
    expect(screen.getByLabelText('Loading report')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    resolve(report);
    await screen.findByRole('tablist', { name: 'Reports' });
    expect(screen.queryByLabelText('Loading report')).toBeNull();
  });

  it('shows a safe error with Retry, then the report', async () => {
    const port = new DeterministicTestReportsAdapter();
    port.setDefaultError(new ReportsOperationError({ code: 'network', message: 'raw socket detail' }));
    render(<ReportsWorkspace role="founder" port={port} today={TODAY} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Unable to load the report');
    expect(alert.textContent).toContain('Unable to reach the server');
    expect(alert.textContent).not.toContain('socket');

    port.setDefaultError(undefined);
    port.setReport('founder', report);
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await screen.findByRole('tablist', { name: 'Reports' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ReportsWorkspace tabs', () => {
  it('offers the four reports, opening on Work progress', async () => {
    await loaded();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Work progress', 'Team activity', 'Fees and collections', 'Client follow-ups']);
    expect(screen.getByRole('tab', { name: 'Work progress' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('reports-tab-work');
  });

  it('hides Fees and collections when the report has no fees section', async () => {
    await loaded('founder', { ...report, fees: null });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Work progress',
      'Team activity',
      'Client follow-ups',
    ]);
  });

  it('shows the work progress tiles and its three tables', async () => {
    await loaded();
    const tiles = within(screen.getByLabelText('Work progress summary'));
    expect(tiles.getByText('Created').closest('article')?.textContent).toContain('3');
    expect(tiles.getByText('Overdue now').closest('article')?.className).toContain('tone-danger');
    expect(tiles.getByText('Overdue now').closest('article')?.textContent).toContain('4');
    expect(tiles.getByText('Due in the next 7 days').closest('article')?.textContent).toContain('6');
    expect(tiles.getByText('Submitted for review')).toBeTruthy();
    expect(tiles.getByText('Completed')).toBeTruthy();

    const service = within(section('By service'));
    expect(service.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Service',
      'Created',
      'Completed',
      'Open now',
      'Overdue now',
    ]);
    expect(service.getByText('GST Compliance')).toBeTruthy();
    expect(service.getByText('Statutory Audit, FY 2025-26')).toBeTruthy();

    const person = within(section('By person'));
    expect(person.getByText('Rohan Mehta')).toBeTruthy();

    const overdue = within(section('Overdue assignments'));
    const row = overdue.getByText('AS-001004').closest('tr') as HTMLElement;
    expect(within(row).getByText('Monthly Bookkeeping & Closing')).toBeTruthy();
    expect(within(row).getByText('Kedia Holdings')).toBeTruthy();
    expect(within(row).getByText('12/11/2026')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
  });

  it('does not tone the overdue tile when nothing is overdue', async () => {
    await loaded('founder', emptyReport);
    const tile = within(screen.getByLabelText('Work progress summary')).getByText('Overdue now').closest('article');
    expect(tile?.className).not.toContain('tone-danger');
  });

  it('shows the team activity tiles and table with role names', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('tab', { name: 'Team activity' }));
    const tiles = within(screen.getByLabelText('Team activity summary'));
    expect(tiles.getByText('Assignments completed').closest('article')?.textContent).toContain('3');
    expect(tiles.getByText('Tasks completed').closest('article')?.textContent).toContain('6');
    expect(tiles.getByText('Reviews done').closest('article')?.textContent).toContain('3');

    const table = within(section('Team activity'));
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Name',
      'Role',
      'Assignments completed',
      'Submitted for review',
      'Tasks completed',
      'Tasks open',
      'Tasks overdue',
      'Reviews done',
    ]);
    const priya = table.getByText('Priya Desai').closest('tr') as HTMLElement;
    expect(within(priya).getByText('Manager')).toBeTruthy();
    const rohan = table.getByText('Rohan Mehta').closest('tr') as HTMLElement;
    expect(within(rohan).getByText('Staff')).toBeTruthy();
  });

  it('shows the fees tiles with rupees and the client table', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('tab', { name: 'Fees and collections' }));
    const tiles = within(screen.getByLabelText('Fees and collections summary'));
    expect(tiles.getAllByRole('article')).toHaveLength(7);
    expect(tiles.getByText('Billed').closest('article')?.textContent).toContain('₹11,800');
    expect(tiles.getByText('Received').closest('article')?.textContent).toContain('₹4,000.50');
    expect(tiles.getByText('Pending now').closest('article')?.textContent).toContain('₹8,800');
    expect(tiles.getByText('Overdue now').closest('article')?.className).toContain('tone-danger');
    expect(tiles.getByText('Credit held').closest('article')?.textContent).toContain('₹1,000');
    expect(tiles.getByText('Bills recorded').closest('article')?.textContent).toContain('2');

    const table = within(section('By client'));
    const row = table.getByText('BluePeak Tech').closest('tr') as HTMLElement;
    expect(within(row).getByText('CL-001002')).toBeTruthy();
    expect(within(row).getByText('₹4,000.50')).toBeTruthy();
    expect(within(row).getAllByText('₹8,800')).toHaveLength(2);
  });

  it('shows the follow-ups with purposes, categories, dates and Never', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('tab', { name: 'Client follow-ups' }));
    const tiles = within(screen.getByLabelText('Client follow-ups summary'));
    expect(tiles.getByText('Messages sent').closest('article')?.textContent).toContain('3');
    expect(tiles.getByText('Documents added').closest('article')?.textContent).toContain('1');
    expect(tiles.getByText('Clients needing follow-up').closest('article')?.textContent).toContain('2');

    const messages = within(section('Messages by purpose'));
    expect(messages.getByText('Payment reminder').closest('tr')?.textContent).toContain('2');
    expect(messages.getByText('General message')).toBeTruthy();
    const documents = within(section('Documents by category'));
    expect(documents.getByText('Agreements')).toBeTruthy();

    const needs = within(section('Clients needing follow-up'));
    expect(needs.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Code',
      'Client',
      'Overdue assignments',
      'Overdue fees',
      'Last message',
    ]);
    expect((needs.getByText('BluePeak Tech').closest('tr') as HTMLElement).textContent).toContain('Never');
    expect((needs.getByText('Aster Foods').closest('tr') as HTMLElement).textContent).toContain('25/10/2026');
  });

  it('says Nothing in this period for an empty table', async () => {
    await loaded('founder', emptyReport);
    expect(within(section('By service')).getByText('Nothing in this period.')).toBeTruthy();
    expect(within(section('By person')).getByText('Nothing in this period.')).toBeTruthy();
    expect(within(section('Overdue assignments')).getByText('Nothing in this period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Team activity' }));
    expect(within(section('Team activity')).getByText('Nothing in this period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Fees and collections' }));
    expect(within(section('By client')).getByText('Nothing in this period.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Client follow-ups' }));
    for (const name of ['Messages by purpose', 'Documents by category', 'Clients needing follow-up']) {
      expect(within(section(name)).getByText('Nothing in this period.')).toBeTruthy();
    }
  });

  it('never shows a raw id anywhere', async () => {
    const { container } = await loaded();
    for (const name of ['Team activity', 'Fees and collections', 'Client follow-ups']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(container.textContent).not.toMatch(UUID_PATTERN);
    }
  });
});

describe('ReportsWorkspace CSV downloads', () => {
  const download = vi.mocked(downloadCsv);

  it('gives every table a Download CSV button', async () => {
    await loaded();
    expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('tab', { name: 'Team activity' }));
    expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Fees and collections' }));
    expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Client follow-ups' }));
    expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(3);
  });

  it('downloads the work by service table, quoting a name with a comma, named for the first day of the week', async () => {
    await loaded();
    fireEvent.click(within(section('By service')).getByRole('button', { name: 'Download CSV' }));
    expect(download).toHaveBeenCalledTimes(1);
    const [fileName, csv] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe('work-by-service_2026-11-09.csv');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(
      'Service,Created,Completed,Open now,Overdue now\r\n' +
        'GST Compliance,3,2,5,1\r\n' +
        '"Statutory Audit, FY 2025-26",0,0,1,0\r\n',
    );
  });

  it('downloads the overdue assignments with DD/MM/YYYY dates', async () => {
    await loaded();
    fireEvent.click(within(section('Overdue assignments')).getByRole('button', { name: 'Download CSV' }));
    const [fileName, csv] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe('work-overdue-assignments_2026-11-09.csv');
    expect(csv.slice(1)).toBe(
      'Assignment,Title,Client,Owner,Due date,Days overdue\r\n' +
        'AS-001004,Monthly Bookkeeping & Closing,Kedia Holdings,Rohan Mehta,12/11/2026,2\r\n',
    );
  });

  it('downloads money as plain rupees with two decimals, named for the month', async () => {
    await loaded('founder', { ...report, period: { kind: 'month', start: '2026-11-01', endExclusive: '2026-12-01', label: 'November 2026' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Fees and collections' }));
    fireEvent.click(within(section('By client')).getByRole('button', { name: 'Download CSV' }));
    const [fileName, csv] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe('fees-by-client_2026-11.csv');
    expect(csv.slice(1)).toBe(
      'Code,Client,Billed,Received,Pending now,Overdue now,Credit held\r\n' +
        'CL-001002,BluePeak Tech,11800.00,4000.50,8800.00,8800.00,1000.00\r\n',
    );
  });

  it('downloads the team and follow-up tables with the on-screen labels', async () => {
    await loaded();
    fireEvent.click(screen.getByRole('tab', { name: 'Team activity' }));
    fireEvent.click(within(section('Team activity')).getByRole('button', { name: 'Download CSV' }));
    expect((download.mock.calls[0] as [string, string])[0]).toBe('team-activity_2026-11-09.csv');
    expect((download.mock.calls[0] as [string, string])[1].slice(1)).toBe(
      'Name,Role,Assignments completed,Submitted for review,Tasks completed,Tasks open,Tasks overdue,Reviews done\r\n' +
        'Priya Desai,Manager,1,0,2,1,0,3\r\n' +
        'Rohan Mehta,Staff,2,1,4,3,1,0\r\n',
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Client follow-ups' }));
    fireEvent.click(within(section('Clients needing follow-up')).getByRole('button', { name: 'Download CSV' }));
    expect((download.mock.calls[1] as [string, string])[0]).toBe('followups-clients-needing-follow-up_2026-11-09.csv');
    expect((download.mock.calls[1] as [string, string])[1].slice(1)).toBe(
      'Code,Client,Overdue assignments,Overdue fees,Last message\r\n' +
        'CL-001002,BluePeak Tech,0,8800.00,Never\r\n' +
        'CL-001001,Aster Foods,1,0.00,25/10/2026\r\n',
    );

    fireEvent.click(within(section('Messages by purpose')).getByRole('button', { name: 'Download CSV' }));
    expect((download.mock.calls[2] as [string, string])[1].slice(1)).toBe(
      'Purpose,Messages\r\nPayment reminder,2\r\nGeneral message,1\r\n',
    );
  });

  it('downloads an empty table as just its header row', async () => {
    await loaded('founder', emptyReport);
    fireEvent.click(within(section('By service')).getByRole('button', { name: 'Download CSV' }));
    const [fileName, csv] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe('work-by-service_2026-11-14.csv');
    expect(csv.slice(1)).toBe('Service,Created,Completed,Open now,Overdue now\r\n');
  });
});
