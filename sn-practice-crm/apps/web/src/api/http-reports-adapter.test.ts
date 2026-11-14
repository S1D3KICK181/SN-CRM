import { describe, expect, it, vi } from 'vitest';
import type { PracticeReportDto } from '@sn/contracts';
import { HttpReportsAdapter, parsePracticeReportDto } from './http-reports-adapter';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

const report: PracticeReportDto = {
  period: { kind: 'week', start: '2026-11-09', endExclusive: '2026-11-16', label: '9–15 Nov 2026' },
  workProgress: {
    summary: { created: 3, completed: 2, submittedForReview: 1, overdueNow: 1, dueNext7Days: 4 },
    byService: [{ serviceName: 'GST Compliance', created: 3, completed: 2, openNow: 5, overdueNow: 1 }],
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
      receivedPaise: 400000,
      pendingNowPaise: 880000,
      overdueNowPaise: 880000,
      creditHeldPaise: 100000,
    },
    byClient: [
      {
        clientCode: 'CL-001002',
        clientName: 'BluePeak Tech',
        billedPaise: 1180000,
        receivedPaise: 400000,
        pendingNowPaise: 880000,
        overdueNowPaise: 880000,
        creditPaise: 100000,
      },
    ],
  },
  followUps: {
    messagesByPurpose: [{ purpose: 'payment_reminder', count: 2 }],
    documentsByCategory: [{ category: 'agreements', count: 1 }],
    needsFollowUp: [
      {
        clientCode: 'CL-001002',
        clientName: 'BluePeak Tech',
        overdueAssignments: 0,
        overdueFeesPaise: 880000,
        lastMessageAt: null,
      },
    ],
  },
};

function okResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, requestId: 'req-rep-1' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterFor(data: unknown, status = 200) {
  const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(okResponse(data, status)));
  return { fetchFn, adapter: new HttpReportsAdapter({ fetchFn }) };
}

describe('HttpReportsAdapter', () => {
  it('reads a report with the period and date in the query and the demo actor header for the role', async () => {
    const { adapter, fetchFn } = adapterFor(report);
    await expect(adapter.getReport('manager', { period: 'week', date: '2026-11-11' })).resolves.toEqual(report);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/reports?period=week&date=2026-11-11');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID.manager);
  });

  it('puts the configured base URL in front of the path', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse(report));
    await new HttpReportsAdapter({ fetchFn, baseUrl: 'http://localhost:8788/' }).getReport('founder', {
      period: 'month',
      date: '2026-11-01',
    });
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('http://localhost:8788/api/v1/reports?period=month&date=2026-11-01');
  });

  it('uses a Bearer token when a token source is configured and never dispatches without one', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse(report));
    await new HttpReportsAdapter({ fetchFn, getAccessToken: () => ' token-1 ' }).getReport('founder', {
      period: 'day',
      date: '2026-11-14',
    });
    const headers = new Headers((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-1');
    expect(headers.get('x-demo-user-id')).toBeNull();

    const blankFetch = vi.fn();
    const blank = new HttpReportsAdapter({ fetchFn: blankFetch, getAccessToken: () => null });
    await expect(blank.getReport('founder', { period: 'day', date: '2026-11-14' })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(blankFetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'unexpected'],
    [500, 'unexpected'],
  ])('maps HTTP %i to %s and keeps only a safe server code', async (status, code) => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'validation_failed', message: 'raw server text' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = new HttpReportsAdapter({ fetchFn });
    const err = await adapter.getReport('founder', { period: 'day', date: '2026-11-14' }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code, status, serverCode: 'validation_failed' });
    expect((err as Error).message).not.toContain('raw server text');
  });

  it('reports a network failure', async () => {
    const adapter = new HttpReportsAdapter({ fetchFn: vi.fn().mockRejectedValue(new TypeError('boom')) });
    await expect(adapter.getReport('founder', { period: 'day', date: '2026-11-14' })).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('rejects an aborted request without dispatching', async () => {
    const { adapter, fetchFn } = adapterFor(report);
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.getReport('founder', { period: 'day', date: '2026-11-14' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects malformed responses', async () => {
    const query = { period: 'day', date: '2026-11-14' } as const;
    await expect(adapterFor([]).adapter.getReport('founder', query)).rejects.toMatchObject({ code: 'unexpected' });
    await expect(
      adapterFor({ ...report, teamActivity: 'nope' }).adapter.getReport('founder', query),
    ).rejects.toMatchObject({ code: 'unexpected' });
    const noEnvelope = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: 'r' }), { status: 200 }));
    await expect(new HttpReportsAdapter({ fetchFn: noEnvelope }).getReport('founder', query)).rejects.toMatchObject({
      code: 'unexpected',
    });
  });
});

describe('parsePracticeReportDto', () => {
  it('parses a full report unchanged', () => {
    expect(parsePracticeReportDto(report)).toEqual(report);
  });

  it('keeps a null fees section', () => {
    expect(parsePracticeReportDto({ ...report, fees: null }).fees).toBeNull();
  });

  it('keeps empty tables', () => {
    const empty = {
      ...report,
      workProgress: { ...report.workProgress, byService: [], byOwner: [], overdueList: [] },
      teamActivity: [],
      fees: { ...report.fees!, byClient: [] },
      followUps: { messagesByPurpose: [], documentsByCategory: [], needsFollowUp: [] },
    };
    expect(parsePracticeReportDto(empty)).toEqual(empty);
  });

  it.each([
    ['an unknown period kind', { period: { ...report.period, kind: 'year' } }],
    ['a period date that is not YYYY-MM-DD', { period: { ...report.period, start: '09/11/2026' } }],
    ['a blank period label', { period: { ...report.period, label: ' ' } }],
    [
      'a negative count',
      { workProgress: { ...report.workProgress, summary: { ...report.workProgress.summary, created: -1 } } },
    ],
    [
      'a fractional amount',
      { fees: { ...report.fees!, summary: { ...report.fees!.summary, billedPaise: 10.5 } } },
    ],
    [
      'an unknown role',
      { teamActivity: [{ ...report.teamActivity[0]!, role: 'intern' }] },
    ],
    [
      'an unknown message purpose',
      { followUps: { ...report.followUps, messagesByPurpose: [{ purpose: 'chat', count: 1 }] } },
    ],
    [
      'an unknown document category',
      { followUps: { ...report.followUps, documentsByCategory: [{ category: 'photos', count: 1 }] } },
    ],
    [
      'a bad last message time',
      {
        followUps: {
          ...report.followUps,
          needsFollowUp: [{ ...report.followUps.needsFollowUp[0]!, lastMessageAt: 'yesterday' }],
        },
      },
    ],
  ])('rejects %s', (_label, patch) => {
    expect(() => parsePracticeReportDto({ ...report, ...patch })).toThrow();
  });

  it('rejects a missing property', () => {
    const { followUps: _omitted, ...rest } = report;
    expect(() => parsePracticeReportDto(rest)).toThrow(/followUps/);
  });
});
