// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PracticeReportDto, ReportPeriodKind } from '@sn/contracts';
import { ReportsOperationError } from './reports-types';
import { DeterministicTestReportsAdapter } from './test-reports-adapter';
import { useReports } from './use-reports';

function reportFor(label: string, kind: ReportPeriodKind = 'week'): PracticeReportDto {
  return {
    period: { kind, start: '2026-11-09', endExclusive: '2026-11-16', label },
    workProgress: {
      summary: { created: 1, completed: 0, submittedForReview: 0, overdueNow: 0, dueNext7Days: 0 },
      byService: [],
      byOwner: [],
      overdueList: [],
      sla: {
        summary: { metInPeriod: 0, lateInPeriod: 0, atRiskNow: 0, breachedNow: 0, noTarget: 0 },
        byService: [],
        byOwner: [],
      },
    },
    teamActivity: [],
    fees: null,
    followUps: { messagesByPurpose: [], documentsByCategory: [], needsFollowUp: [] },
  };
}

const week = reportFor('9–15 Nov 2026');
const nextWeek = reportFor('16–22 Nov 2026');

function setup(role: Parameters<typeof useReports>[0] = 'founder') {
  const port = new DeterministicTestReportsAdapter();
  port.setReport(role, week);
  const hook = renderHook((props: { period: ReportPeriodKind; date: string }) => useReports(role, { ...props, port }), {
    initialProps: { period: 'week' as ReportPeriodKind, date: '2026-11-11' },
  });
  return { port, ...hook };
}

describe('useReports', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('loads the report for %s', async (role) => {
    const port = new DeterministicTestReportsAdapter();
    port.setReport(role, week);
    const { result } = renderHook(() => useReports(role, { period: 'week', date: '2026-11-11', port }));
    expect(result.current.loading).toBe(true);
    expect(result.current.report).toBeNull();
    await waitFor(() => expect(result.current.report).toEqual(week));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(port.calls).toEqual([expect.objectContaining({ role, query: { period: 'week', date: '2026-11-11' } })]);
  });

  it('never loads or calls anything for a Trainee', async () => {
    const port = new DeterministicTestReportsAdapter();
    const { result } = renderHook(() => useReports('trainee', { period: 'week', date: '2026-11-11', port }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.calls).toHaveLength(0);
    expect(result.current).toMatchObject({ report: null, loading: false, error: null });
  });

  it('does not load while disabled', async () => {
    const port = new DeterministicTestReportsAdapter();
    renderHook(() => useReports('founder', { period: 'week', date: '2026-11-11', port, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(port.calls).toHaveLength(0);
  });

  it('loads again for a new period or date and never shows the old report under the new one', async () => {
    const { result, rerender, port } = setup();
    await waitFor(() => expect(result.current.report).toEqual(week));

    let resolveNext: (report: PracticeReportDto) => void = () => undefined;
    port.enqueueDeferredReport(new Promise<PracticeReportDto>((resolve) => (resolveNext = resolve)));
    rerender({ period: 'week', date: '2026-11-18' });
    expect(result.current.report).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveNext(nextWeek);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.report).toEqual(nextWeek));
    expect(port.calls.map((call) => call.query)).toEqual([
      { period: 'week', date: '2026-11-11' },
      { period: 'week', date: '2026-11-18' },
    ]);
  });

  it('ignores a slow answer for a period that is no longer shown', async () => {
    const port = new DeterministicTestReportsAdapter();
    port.setReport('founder', nextWeek);
    let resolveFirst: (report: PracticeReportDto) => void = () => undefined;
    port.enqueueDeferredReport(new Promise<PracticeReportDto>((resolve) => (resolveFirst = resolve)));
    const { result, rerender } = renderHook(
      (props: { date: string }) => useReports('founder', { period: 'week', date: props.date, port }),
      { initialProps: { date: '2026-11-11' } },
    );
    rerender({ date: '2026-11-18' });
    await waitFor(() => expect(result.current.report).toEqual(nextWeek));
    await act(async () => {
      resolveFirst(week);
      await Promise.resolve();
    });
    expect(result.current.report).toEqual(nextWeek);
  });

  it('keeps a sanitized error and retries', async () => {
    const port = new DeterministicTestReportsAdapter();
    port.setDefaultError(new ReportsOperationError({ code: 'network', message: 'raw socket detail' }));
    const { result } = renderHook(() => useReports('founder', { period: 'week', date: '2026-11-11', port }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain('Unable to reach the server');
    expect(result.current.error?.message).not.toContain('socket');
    expect(result.current.report).toBeNull();

    port.setDefaultError(undefined);
    port.setReport('founder', week);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.report).toEqual(week));
    expect(result.current.error).toBeNull();
  });

  it('shows no data to another role after a role change', async () => {
    const port = new DeterministicTestReportsAdapter();
    port.setReport('founder', week);
    port.setReport('staff', nextWeek);
    const { result, rerender } = renderHook(
      ({ role }: { role: 'founder' | 'staff' }) => useReports(role, { period: 'week', date: '2026-11-11', port }),
      { initialProps: { role: 'founder' as 'founder' | 'staff' } },
    );
    await waitFor(() => expect(result.current.report).toEqual(week));
    rerender({ role: 'staff' });
    expect(result.current.report).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.report).toEqual(nextWeek));
  });
});
