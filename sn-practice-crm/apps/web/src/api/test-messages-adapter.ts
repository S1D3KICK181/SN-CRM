import type { ClientMessageDto, RecordClientMessageInput } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { MessagesOperationError, type MessagesPort } from './messages-types';

export interface RecordedMessagesCall {
  role: CompanyRole;
  clientId?: string;
  signal?: AbortSignal;
  requestId?: string;
}

export interface RecordedMessagesMutation {
  role: CompanyRole;
  input: RecordClientMessageInput;
  idempotencyKey: string;
}

export class DeterministicTestMessagesAdapter implements MessagesPort {
  private readonly responses = new Map<CompanyRole, ClientMessageDto[]>();
  private readonly queue: Array<Promise<ClientMessageDto[]>> = [];
  private defaultError?: Error;
  private recordResult?: ClientMessageDto;
  private recordError?: Error;

  readonly calls: RecordedMessagesCall[] = [];
  readonly mutations: RecordedMessagesMutation[] = [];

  setMessagesResponse(role: CompanyRole, items: ClientMessageDto[]): void {
    this.responses.set(role, items);
  }

  enqueueDeferredMessages(promise: Promise<ClientMessageDto[]>): void {
    this.queue.push(promise);
  }

  setDefaultError(error: Error | undefined): void {
    this.defaultError = error;
  }

  /** Response returned by the record call. */
  setRecordResult(message: ClientMessageDto | undefined): void {
    this.recordResult = message;
  }

  /** Error thrown by the record call until cleared. */
  setRecordError(error: Error | undefined): void {
    this.recordError = error;
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new MessagesOperationError({ code: 'aborted', message: 'The messages operation was aborted.' });
    }
  }

  async listMessages(
    role: CompanyRole,
    clientId?: string,
    options?: PortExecutionOptions,
  ): Promise<ClientMessageDto[]> {
    this.calls.push({ role, clientId, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    const deferred = this.queue.shift();
    if (deferred) return deferred;

    if (this.defaultError) throw this.defaultError;
    return [...(this.responses.get(role) ?? [])];
  }

  async recordMessage(
    role: CompanyRole,
    input: RecordClientMessageInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientMessageDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ role, input, idempotencyKey });
    if (this.recordError) throw this.recordError;
    if (!this.recordResult) throw new Error('No record result configured on the test messages adapter.');
    return this.recordResult;
  }
}
