import type { CreateServiceInput, ServiceDto, UpdateServiceInput } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { ServiceCatalogOperationError, type ServiceCatalogPort } from './service-catalog-types';

export interface RecordedServiceCatalogCall {
  role: CompanyRole;
  signal?: AbortSignal;
  requestId?: string;
}

export interface RecordedServiceCatalogMutation {
  kind: 'create-service' | 'update-service';
  role: CompanyRole;
  /** Service id for an update. */
  targetId?: string;
  input: CreateServiceInput | UpdateServiceInput;
  idempotencyKey: string;
}

export class DeterministicTestServiceCatalogAdapter implements ServiceCatalogPort {
  private readonly responses = new Map<CompanyRole, ServiceDto[]>();
  private readonly queue: Array<Promise<ServiceDto[]>> = [];
  private defaultError?: Error;
  private mutationService?: ServiceDto;
  private mutationError?: Error;

  readonly calls: RecordedServiceCatalogCall[] = [];
  readonly mutations: RecordedServiceCatalogMutation[] = [];

  setServicesResponse(role: CompanyRole, items: ServiceDto[]): void {
    this.responses.set(role, items);
  }

  enqueueDeferredServices(promise: Promise<ServiceDto[]>): void {
    this.queue.push(promise);
  }

  setDefaultError(error: Error | undefined): void {
    this.defaultError = error;
  }

  /** Response returned by the create and update calls. */
  setMutationService(service: ServiceDto | undefined): void {
    this.mutationService = service;
  }

  /** Error thrown by every mutation until cleared. */
  setMutationError(error: Error | undefined): void {
    this.mutationError = error;
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new ServiceCatalogOperationError({ code: 'aborted', message: 'The service operation was aborted.' });
    }
  }

  private mutationResult(): ServiceDto {
    if (this.mutationError) throw this.mutationError;
    if (!this.mutationService) throw new Error('No mutation service configured on the test service list adapter.');
    return this.mutationService;
  }

  async listServiceCatalog(role: CompanyRole, options?: PortExecutionOptions): Promise<ServiceDto[]> {
    this.calls.push({ role, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    const deferred = this.queue.shift();
    if (deferred) return deferred;

    if (this.defaultError) throw this.defaultError;
    return [...(this.responses.get(role) ?? [])];
  }

  async createService(
    role: CompanyRole,
    input: CreateServiceInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ServiceDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'create-service', role, input, idempotencyKey });
    return this.mutationResult();
  }

  async updateService(
    role: CompanyRole,
    serviceId: string,
    input: UpdateServiceInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ServiceDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'update-service', role, targetId: serviceId, input, idempotencyKey });
    return this.mutationResult();
  }
}
