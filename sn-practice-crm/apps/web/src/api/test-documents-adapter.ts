import type { ClientDocumentDto, CreateDocumentInput, RemoveDocumentInput } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { DocumentsOperationError, type DocumentsPort } from './documents-types';

export interface RecordedDocumentsCall {
  role: CompanyRole;
  clientId?: string;
  signal?: AbortSignal;
  requestId?: string;
}

export interface RecordedDocumentsMutation {
  kind: 'create-document' | 'confirm-document' | 'remove-document';
  role: CompanyRole;
  /** Document id for a confirm or removal. */
  targetId?: string;
  input?: CreateDocumentInput | RemoveDocumentInput;
  idempotencyKey: string;
}

export class DeterministicTestDocumentsAdapter implements DocumentsPort {
  private readonly responses = new Map<CompanyRole, ClientDocumentDto[]>();
  private readonly queue: Array<Promise<ClientDocumentDto[]>> = [];
  private defaultError?: Error;
  private createResult?: ClientDocumentDto;
  private confirmResult?: ClientDocumentDto;
  private removeResult?: ClientDocumentDto;
  private readonly mutationErrors = new Map<RecordedDocumentsMutation['kind'], Error>();

  readonly calls: RecordedDocumentsCall[] = [];
  readonly mutations: RecordedDocumentsMutation[] = [];

  setDocumentsResponse(role: CompanyRole, items: ClientDocumentDto[]): void {
    this.responses.set(role, items);
  }

  enqueueDeferredDocuments(promise: Promise<ClientDocumentDto[]>): void {
    this.queue.push(promise);
  }

  setDefaultError(error: Error | undefined): void {
    this.defaultError = error;
  }

  /** Responses returned by the create, confirm and remove calls. */
  setCreateResult(document: ClientDocumentDto | undefined): void {
    this.createResult = document;
  }

  setConfirmResult(document: ClientDocumentDto | undefined): void {
    this.confirmResult = document;
  }

  setRemoveResult(document: ClientDocumentDto | undefined): void {
    this.removeResult = document;
  }

  /** Error thrown by one kind of mutation until cleared. */
  setMutationError(kind: RecordedDocumentsMutation['kind'], error: Error | undefined): void {
    if (error) this.mutationErrors.set(kind, error);
    else this.mutationErrors.delete(kind);
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new DocumentsOperationError({ code: 'aborted', message: 'The documents operation was aborted.' });
    }
  }

  private result(kind: RecordedDocumentsMutation['kind'], configured: ClientDocumentDto | undefined): ClientDocumentDto {
    const error = this.mutationErrors.get(kind);
    if (error) throw error;
    if (!configured) throw new Error(`No ${kind} result configured on the test documents adapter.`);
    return configured;
  }

  async listDocuments(
    role: CompanyRole,
    clientId?: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto[]> {
    this.calls.push({ role, clientId, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    const deferred = this.queue.shift();
    if (deferred) return deferred;

    if (this.defaultError) throw this.defaultError;
    return [...(this.responses.get(role) ?? [])];
  }

  async createDocument(
    role: CompanyRole,
    input: CreateDocumentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'create-document', role, input, idempotencyKey });
    return this.result('create-document', this.createResult);
  }

  async confirmDocument(
    role: CompanyRole,
    documentId: string,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'confirm-document', role, targetId: documentId, idempotencyKey });
    return this.result('confirm-document', this.confirmResult);
  }

  async removeDocument(
    role: CompanyRole,
    documentId: string,
    input: RemoveDocumentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDocumentDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'remove-document', role, targetId: documentId, input, idempotencyKey });
    return this.result('remove-document', this.removeResult);
  }
}
