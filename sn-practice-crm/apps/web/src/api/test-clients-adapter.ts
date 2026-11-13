import type {
  ClientContactDto,
  ClientDto,
  CreateClientContactInput,
  CreateClientInput,
  UpdateClientContactInput,
  UpdateClientInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { ClientOperationError, type ClientsPort } from './clients-types';

export interface RecordedClientCall {
  action: 'list' | 'get' | 'create' | 'updateClient' | 'createContact' | 'updateContact' | 'deleteContact';
  role: CompanyRole;
  id?: string;
  input?: CreateClientInput;
  /** The body of an updateClient, createContact or updateContact call. */
  changes?: UpdateClientInput | CreateClientContactInput | UpdateClientContactInput;
  idempotencyKey?: string;
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

  private readonly createResponses = new Map<CompanyRole, ClientDto>();
  private defaultCreateResponse?: ClientDto;
  private readonly deferredCreates = new Map<CompanyRole, Promise<ClientDto>>();
  private readonly createQueue: Array<{ role?: CompanyRole; promise: Promise<ClientDto> }> = [];
  private readonly createErrors = new Map<CompanyRole, Error>();
  private defaultCreateError?: Error;

  private updateClientResponse?: ClientDto;
  private updateClientError?: Error;
  private contactResponse?: ClientContactDto;
  private contactError?: Error;
  private deleteContactError?: Error;

  private ignoreAbortSignals = false;

  readonly calls: RecordedClientCall[] = [];

  setUpdateClientResponse(client: ClientDto): void {
    this.updateClientResponse = client;
  }

  /** Fails updateClient until cleared with undefined. */
  setUpdateClientError(error: Error | undefined): void {
    this.updateClientError = error;
  }

  setContactResponse(contact: ClientContactDto): void {
    this.contactResponse = contact;
  }

  /** Fails createContact and updateContact until cleared with undefined. */
  setContactError(error: Error | undefined): void {
    this.contactError = error;
  }

  setDeleteContactError(error: Error | undefined): void {
    this.deleteContactError = error;
  }

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

  setCreateResponse(client: ClientDto, role?: CompanyRole): void {
    if (role) {
      this.createResponses.set(role, client);
    } else {
      this.defaultCreateResponse = client;
    }
  }

  setDeferredCreate(promise: Promise<ClientDto>, role?: CompanyRole): void {
    if (role) {
      this.deferredCreates.set(role, promise);
    } else {
      this.createQueue.push({ promise });
    }
  }

  enqueueDeferredCreate(promise: Promise<ClientDto>, role?: CompanyRole): void {
    this.createQueue.push({ role, promise });
  }

  setCreateError(error: Error, role?: CompanyRole): void {
    if (role) {
      this.createErrors.set(role, error);
    } else {
      this.defaultCreateError = error;
    }
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

  async create(
    role: CompanyRole,
    input: CreateClientInput,
    options?: PortExecutionOptions,
  ): Promise<ClientDto> {
    this.calls.push({
      action: 'create',
      role,
      input: { ...input },
      signal: options?.signal,
      requestId: options?.requestId,
    });

    if (!this.ignoreAbortSignals && options?.signal?.aborted) {
      throw new ClientOperationError({
        code: 'aborted',
        message: 'The create operation was aborted.',
      });
    }

    const queueIndex = this.createQueue.findIndex((entry) => !entry.role || entry.role === role);
    let deferredPromise: Promise<ClientDto> | undefined;
    if (queueIndex >= 0) {
      deferredPromise = this.createQueue.splice(queueIndex, 1)[0]!.promise;
    } else {
      deferredPromise = this.deferredCreates.get(role);
    }

    if (deferredPromise) {
      const wrapped = deferredPromise.then((created) => {
        const existingList = this.listResponses.get(role) ?? [];
        this.listResponses.set(role, [created, ...existingList.filter((item: ClientDto) => item.id !== created.id)]);
        return created;
      });

      if (!this.ignoreAbortSignals && options?.signal) {
        return Promise.race([
          wrapped,
          new Promise<ClientDto>((_, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(
                new ClientOperationError({
                  code: 'aborted',
                  message: 'The create operation was aborted.',
                }),
              );
            });
          }),
        ]);
      }
      return wrapped;
    }

    const error = this.createErrors.get(role) ?? this.defaultCreateError;
    if (error) {
      throw error;
    }

    const response = this.createResponses.get(role) ?? this.defaultCreateResponse;
    const fallbackId = '90000000-0000-4000-a000-000000000099';
    const createdResult: ClientDto = response
      ? { ...response }
      : {
          id: fallbackId,
          code: 'CL-001099',
          displayName: input.displayName,
          legalName: input.legalName ?? null,
          panMasked: input.pan ? `******${input.pan.slice(-4)}` : null,
          gstinMasked: input.gstin ? `${input.gstin.slice(0, 2)}**********${input.gstin.slice(-3)}` : null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          relationshipOwnerId: input.relationshipOwnerId ?? null,
          relationshipOwnerName: null,
          status: 'active',
          notes: input.notes ?? null,
          pan: input.pan ?? null,
          gstin: input.gstin ?? null,
          entityType: input.entityType ?? null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          pincode: input.pincode ?? null,
          tan: input.tan ?? null,
          cinLlpin: input.cinLlpin ?? null,
          udyamNumber: input.udyamNumber ?? null,
          iec: input.iec ?? null,
          incorporationDate: input.incorporationDate ?? null,
          contacts: [],
          canEdit: true,
          canChangeOwnerOrStatus: true,
          activeAssignmentsCount: 0,
          createdById: '00000000-0000-4000-a000-000000000001',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

    const existingList = this.listResponses.get(role) ?? [];
    this.listResponses.set(role, [createdResult, ...existingList.filter((item: ClientDto) => item.id !== createdResult.id)]);

    return createdResult;
  }

  async updateClient(
    role: CompanyRole,
    clientId: string,
    input: UpdateClientInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDto> {
    this.calls.push({
      action: 'updateClient',
      role,
      id: clientId,
      changes: { ...input },
      idempotencyKey,
      signal: options?.signal,
      requestId: options?.requestId,
    });
    if (this.updateClientError) throw this.updateClientError;

    const current = this.getResponses.get(clientId);
    if (!this.updateClientResponse && !current) {
      throw new ClientOperationError({ code: 'not_found', message: `Client ${clientId} not found`, status: 404 });
    }
    const { expectedUpdatedAt: _expected, ...fields } = input;
    const updated: ClientDto = this.updateClientResponse ?? {
      ...current!,
      ...fields,
      updatedAt: new Date().toISOString(),
    };
    this.getResponses.set(clientId, updated);
    const existingList = this.listResponses.get(role);
    if (existingList) {
      this.listResponses.set(
        role,
        existingList.map((item) => (item.id === updated.id ? updated : item)),
      );
    }
    return { ...updated };
  }

  async createContact(
    role: CompanyRole,
    clientId: string,
    input: CreateClientContactInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientContactDto> {
    this.calls.push({
      action: 'createContact',
      role,
      id: clientId,
      changes: { ...input },
      idempotencyKey,
      signal: options?.signal,
      requestId: options?.requestId,
    });
    if (this.contactError) throw this.contactError;

    return (
      this.contactResponse ?? {
        id: '90000000-0000-4000-a000-0000000000c1',
        name: input.name,
        designation: input.designation ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        whatsapp: input.whatsapp ?? null,
        isPrimary: input.isPrimary ?? false,
        notes: input.notes ?? null,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  async updateContact(
    role: CompanyRole,
    contactId: string,
    input: UpdateClientContactInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientContactDto> {
    this.calls.push({
      action: 'updateContact',
      role,
      id: contactId,
      changes: { ...input },
      idempotencyKey,
      signal: options?.signal,
      requestId: options?.requestId,
    });
    if (this.contactError) throw this.contactError;

    // Like the API, answer with the whole contact: the stored one with the changes applied.
    const { expectedUpdatedAt: _expected, ...fields } = input;
    let stored: ClientContactDto | undefined;
    for (const client of this.getResponses.values()) {
      stored = stored ?? client.contacts.find((contact) => contact.id === contactId);
    }
    return (
      this.contactResponse ?? {
        id: contactId,
        name: stored?.name ?? 'Contact',
        designation: stored?.designation ?? null,
        email: stored?.email ?? null,
        phone: stored?.phone ?? null,
        whatsapp: stored?.whatsapp ?? null,
        isPrimary: stored?.isPrimary ?? false,
        notes: stored?.notes ?? null,
        ...fields,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  async deleteContact(role: CompanyRole, contactId: string, options?: PortExecutionOptions): Promise<void> {
    this.calls.push({
      action: 'deleteContact',
      role,
      id: contactId,
      signal: options?.signal,
      requestId: options?.requestId,
    });
    if (this.deleteContactError) throw this.deleteContactError;
  }
}
