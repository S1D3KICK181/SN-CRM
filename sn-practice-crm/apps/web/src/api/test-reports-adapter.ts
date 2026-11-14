import type { PracticeReportDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { ReportsOperationError, type ReportQuery, type ReportsPort } from './reports-types';

export interface RecordedReportsCall {
  role: CompanyRole;
  query: ReportQuery;
  signal?: AbortSignal;
  requestId?: string;
}

export class DeterministicTestReportsAdapter implements ReportsPort {
  private readonly responses = new Map<CompanyRole, PracticeReportDto>();
  private readonly queue: Array<Promise<PracticeReportDto>> = [];
  private defaultError?: Error;

  readonly calls: RecordedReportsCall[] = [];

  setReport(role: CompanyRole, report: PracticeReportDto): void {
    this.responses.set(role, report);
  }

  enqueueDeferredReport(promise: Promise<PracticeReportDto>): void {
    this.queue.push(promise);
  }

  setDefaultError(error: Error | undefined): void {
    this.defaultError = error;
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new ReportsOperationError({ code: 'aborted', message: 'The reports operation was aborted.' });
    }
  }

  async getReport(role: CompanyRole, query: ReportQuery, options?: PortExecutionOptions): Promise<PracticeReportDto> {
    this.calls.push({ role, query, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    const deferred = this.queue.shift();
    if (deferred) return deferred;

    if (this.defaultError) throw this.defaultError;
    const report = this.responses.get(role);
    if (!report) throw new Error(`No report configured on the test reports adapter for ${role}.`);
    return report;
  }
}
