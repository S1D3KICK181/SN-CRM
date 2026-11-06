import type { ClientDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { ClientOperationError, type ClientsPort } from './clients-types';

export interface RecordedClientCall {
  action: 'list' | 'get';
  role: CompanyRole;
  id?: string;
  signal?: AbortSignal;
  requestId?: string;
}

export class DeterministicTestClientsAdapter implements ClientsPort {
  private readonly listResponses = new Map<CompanyRole, ClientDto[]>();
  private readonly deferredLists = new Map<CompanyRole, Promise<ClientDto[]>>();
  private readonly listQueue: Array<{ role?: CompanyRole; promise: Promise<ClientDto[]> }> = [];
  private readonly listErrors = new Map<CompanyRole, Error>();

  private readonly getResponses = new Map<string, ClientDto>();
  private readonly deferredGets = new Map<string, Promise<ClientDto>>();
  private readonly getQueue: Array<{ id?: string; promise: Promise<ClientDto> }> = [];
  private readonly getErrors = new Map<string, Error>();

  private ignoreAbortSignals = false;

  readonly calls: RecordedClientCall[] = [];

  setIgnoreAbortSignals(ignore: boolean): void {
    this.ignoreAbortSignals = ignore;
  }

  setListResponse(role: CompanyRole, items: ClientDto[]): void {
    this.listResponses.set(role, items);
  }

  setDeferredList(role: CompanyRole, promise: Promise<ClientDto[]>): void {
    this.deferredLists.set(role, promise);
  }

  enqueueDeferredList(promise: Promise<ClientDto[]>, role?: CompanyRole): void {
    this.listQueue.push({ role, promise });
  }

  setListError(role: CompanyRole, error: Error): void {
    this.listErrors.set(role, error);
  }

  setGetResponse(id: string, client: ClientDto): void {
    this.getResponses.set(id, client);
  }

  setDeferredGet(id: string, promise: Promise<ClientDto>): void {
    this.deferredGets.set(id, promise);
  }

  enqueueDeferredGet(promise: Promise<ClientDto>, id?: string): void {
    this.getQueue.push({ id, promise });
  }

  setGetError(id: string, error: Error): void {
    this.getErrors.set(id, error);
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<ClientDto[]> {
    this.calls.push({
      action: 'list',
      role,
      signal: options?.signal,
      requestId: options?.requestId,
    });

    if (!this.ignoreAbortSignals && options?.signal?.aborted) {
      throw new ClientOperationError({
        code: 'aborted',
        message: 'The list operation was aborted.',
      });
    }

    const queueIndex = this.listQueue.findIndex((entry) => !entry.role || entry.role === role);
    let deferredPromise: Promise<ClientDto[]> | undefined;
    if (queueIndex >= 0) {
      deferredPromise = this.listQueue.splice(queueIndex, 1)[0]!.promise;
    } else {
      deferredPromise = this.deferredLists.get(role);
    }

    if (deferredPromise) {
      if (!this.ignoreAbortSignals && options?.signal) {
        return Promise.race([
          deferredPromise,
          new Promise<ClientDto[]>((_, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(
                new ClientOperationError({
                  code: 'aborted',
                  message: 'The list operation was aborted.',
                }),
              );
            });
          }),
        ]);
      }
      return deferredPromise;
    }

    const error = this.listErrors.get(role);
    if (error) {
      throw error;
    }

    const response = this.listResponses.get(role);
    if (response) {
      return [...response];
    }

    return [];
  }

  async get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<ClientDto> {
    this.calls.push({
      action: 'get',
      role,
      id,
      signal: options?.signal,
      requestId: options?.requestId,
    });

    if (!this.ignoreAbortSignals && options?.signal?.aborted) {
      throw new ClientOperationError({
        code: 'aborted',
        message: 'The get operation was aborted.',
      });
    }

    const queueIndex = this.getQueue.findIndex((entry) => !entry.id || entry.id === id);
    let deferredPromise: Promise<ClientDto> | undefined;
    if (queueIndex >= 0) {
      deferredPromise = this.getQueue.splice(queueIndex, 1)[0]!.promise;
    } else {
      deferredPromise = this.deferredGets.get(id);
    }

    if (deferredPromise) {
      if (!this.ignoreAbortSignals && options?.signal) {
        return Promise.race([
          deferredPromise,
          new Promise<ClientDto>((_, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(
                new ClientOperationError({
                  code: 'aborted',
                  message: 'The get operation was aborted.',
                }),
              );
            });
          }),
        ]);
      }
      return deferredPromise;
    }

    const error = this.getErrors.get(id);
    if (error) {
      throw error;
    }

    const response = this.getResponses.get(id);
    if (response) {
      return { ...response };
    }

    throw new ClientOperationError({
      code: 'not_found',
      message: `Client ${id} not found`,
      status: 404,
    });
  }
}
