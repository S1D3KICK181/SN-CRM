import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { PracticeReportDto, ReportPeriodKind } from '@sn/contracts';
import { useOptionalSessionActor } from '../shell/session-context';
import { HttpReportsAdapter } from './http-reports-adapter';
import { sanitizeReportsError, type ReportsOperationError, type ReportsPort } from './reports-types';

export interface UseReportsOptions {
  /** The kind of period to read: a day, a week or a month. */
  readonly period: ReportPeriodKind;
  /** A calendar date (YYYY-MM-DD, Asia/Kolkata) inside the period. */
  readonly date: string;
  readonly port?: ReportsPort;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

export interface UseReportsResult {
  /** The report for exactly this role, period and date; null while it loads or after a failed first load. */
  readonly report: PracticeReportDto | null;
  readonly loading: boolean;
  readonly error: ReportsOperationError | null;
  readonly retry: () => void;
}

interface ReportsSnapshot {
  readonly port: ReportsPort;
  readonly role: CompanyRole;
  readonly period: ReportPeriodKind;
  readonly date: string;
  readonly report: PracticeReportDto | null;
  readonly loading: boolean;
  readonly error: ReportsOperationError | null;
}

function mayReadReports(role: CompanyRole): boolean {
  return role !== 'trainee';
}

/**
 * One report for a role, period and date. The Trainee has no reports and never triggers a request.
 * A report that belongs to another role, port, period or date is never shown (zero-frame suppression),
 * so a figure can never appear under another period's label.
 */
export function useReports(role: CompanyRole, options: UseReportsOptions): UseReportsResult {
  const { period, date, enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpReportsAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );

  const allowed = enabled && mayReadReports(role);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<ReportsSnapshot | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setSnapshot({ port, role, period, date, report: null, loading: true, error: null });

    port
      .getReport(role, { period, date }, { signal: controller.signal })
      .then((report) => {
        if (controller.signal.aborted) return;
        setSnapshot({ port, role, period, date, report, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = sanitizeReportsError(err);
        if (error.code === 'aborted') return;
        setSnapshot({ port, role, period, date, report: null, loading: false, error });
      });

    return () => controller.abort();
  }, [allowed, port, role, period, date, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  if (!allowed) {
    return { report: null, loading: false, error: null, retry };
  }

  const current =
    snapshot !== null &&
    snapshot.port === port &&
    snapshot.role === role &&
    snapshot.period === period &&
    snapshot.date === date
      ? snapshot
      : null;
  if (!current) {
    return { report: null, loading: true, error: null, retry };
  }

  return { report: current.report, loading: current.loading, error: current.error, retry };
}
