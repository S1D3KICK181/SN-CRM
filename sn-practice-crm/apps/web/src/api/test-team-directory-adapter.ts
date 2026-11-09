import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import {
  TeamDirectoryOperationError,
  type TeamDirectoryPort,
} from './team-directory-types';

export interface RecordedTeamDirectoryCall {
  role: CompanyRole;
  signal?: AbortSignal;
  requestId?: string;
}

export class DeterministicTestTeamDirectoryAdapter implements TeamDirectoryPort {
  private readonly listResponses = new Map<CompanyRole, ReportingLineDto[]>();
  private readonly deferredLists = new Map<CompanyRole, Promise<ReportingLineDto[]>>();
  private readonly listQueue: Array<{ role?: CompanyRole; promise: Promise<ReportingLineDto[]> }> = [];
  private readonly listErrors = new Map<CompanyRole, Error>();
  private defaultListError?: Error;

  private ignoreAbortSignals = false;

  readonly calls: RecordedTeamDirectoryCall[] = [];

  setIgnoreAbortSignals(ignore: boolean): void {
    this.ignoreAbortSignals = ignore;
  }

  setReportingLinesResponse(role: CompanyRole, items: ReportingLineDto[]): void {
    this.listResponses.set(role, items);
  }

  setDeferredList(role: CompanyRole, promise: Promise<ReportingLineDto[]>): void {
    this.deferredLists.set(role, promise);
  }

  enqueueDeferredList(promise: Promise<ReportingLineDto[]>, role?: CompanyRole): void {
    this.listQueue.push({ role, promise });
  }

  setListError(role: CompanyRole, error: Error): void {
    this.listErrors.set(role, error);
  }

  clearListError(role?: CompanyRole): void {
    if (role) {
      this.listErrors.delete(role);
    } else {
      this.listErrors.clear();
      this.defaultListError = undefined;
    }
  }

  setDefaultListError(error: Error): void {
    this.defaultListError = error;
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<ReportingLineDto[]> {
    this.calls.push({
      role,
      signal: options?.signal,
      requestId: options?.requestId,
    });

    if (!this.ignoreAbortSignals && options?.signal?.aborted) {
      throw new TeamDirectoryOperationError({
        code: 'aborted',
        message: 'The team directory operation was aborted.',
      });
    }

    const queueIndex = this.listQueue.findIndex((entry) => !entry.role || entry.role === role);
    let deferredPromise: Promise<ReportingLineDto[]> | undefined;
    if (queueIndex >= 0) {
      deferredPromise = this.listQueue.splice(queueIndex, 1)[0]!.promise;
    } else {
      deferredPromise = this.deferredLists.get(role);
    }

    if (deferredPromise) {
      if (!this.ignoreAbortSignals && options?.signal) {
        return Promise.race([
          deferredPromise,
          new Promise<ReportingLineDto[]>((_, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(
                new TeamDirectoryOperationError({
                  code: 'aborted',
                  message: 'The team directory operation was aborted.',
                }),
              );
            });
          }),
        ]);
      }
      return deferredPromise;
    }

    const error = this.listErrors.get(role) ?? this.defaultListError;
    if (error) {
      throw error;
    }

    const response = this.listResponses.get(role);
    if (response) {
      return [...response];
    }

    return [];
  }
}
