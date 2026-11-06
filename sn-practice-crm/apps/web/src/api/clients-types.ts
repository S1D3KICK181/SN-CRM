import type { CompanyRole } from '@sn/domain';
import type { ClientDto } from '@sn/contracts';
import type { PortExecutionOptions } from './types';

export type ClientErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface ClientOperationErrorOptions {
  code: ClientErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class ClientOperationError extends Error {
  readonly code: ClientErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: ClientOperationErrorOptions) {
    super(options.message);
    this.name = 'ClientOperationError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
    this.serverCode = options.serverCode;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

/**
 * Stateless ClientsPort interface.
 * Role must be passed explicitly on every invocation; no ambient mutable role state.
 */
export interface ClientsPort {
  list(role: CompanyRole, options?: PortExecutionOptions): Promise<ClientDto[]>;
  get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<ClientDto>;
}

export interface ClientsCoordinatorState {
  readonly items: ClientDto[];
  readonly loading: boolean;
  readonly error: ClientOperationError | null;
  readonly role: CompanyRole;
  readonly hasLiveSnapshot: boolean;
  readonly selectedClientId: string | null;
  readonly selectedDetail: ClientDto | null;
  readonly detailLoading: boolean;
  readonly detailError: ClientOperationError | null;
}
