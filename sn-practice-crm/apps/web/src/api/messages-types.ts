import type { CompanyRole } from '@sn/domain';
import type { ClientMessageDto, MessagePurpose, RecordClientMessageInput } from '@sn/contracts';
import type { PortExecutionOptions } from './types';
import { sanitizeRequestId, sanitizeServerCode } from './metadata-safety';

export type MessagesErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'network'
  | 'aborted'
  | 'unexpected';

export interface MessagesOperationErrorOptions {
  code: MessagesErrorCode;
  message: string;
  requestId?: string;
  status?: number;
  serverCode?: string;
  cause?: unknown;
}

export class MessagesOperationError extends Error {
  readonly code: MessagesErrorCode;
  readonly requestId?: string;
  readonly status?: number;
  readonly serverCode?: string;

  constructor(options: MessagesOperationErrorOptions) {
    super(options.message);
    this.name = 'MessagesOperationError';
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
 * Whitelisted, user-safe error copy for the messages seam.
 * Arbitrary server/proxy error strings are discarded to prevent reflection attacks.
 */
export const SAFE_MESSAGES_ERROR_MESSAGES: Readonly<Record<MessagesErrorCode, string>> = {
  unauthorized: 'Session expired. Please sign in again to use messages.',
  forbidden: "You don't have permission to do this.",
  not_found: 'The client could not be found.',
  network: 'Unable to reach the server. Please check your network connection and try again.',
  aborted: 'The messages request was cancelled.',
  unexpected: 'Something went wrong with messages. Please try again.',
};

export const GENERIC_SAFE_MESSAGES_ERROR = SAFE_MESSAGES_ERROR_MESSAGES.unexpected;

/** Copy for the server codes the message routes return. */
const SERVER_CODE_MESSAGES: Readonly<Record<string, string>> = {
  validation_failed: 'The message could not be recorded. Check the number and the text, then try again.',
};

/** Sanitizes any error caught during message operations. Discards causes and unverified server text. */
export function sanitizeMessagesError(err: unknown): MessagesOperationError {
  if (err instanceof MessagesOperationError) {
    return new MessagesOperationError({
      code: err.code,
      message: SAFE_MESSAGES_ERROR_MESSAGES[err.code] ?? GENERIC_SAFE_MESSAGES_ERROR,
      status: err.status,
      serverCode: sanitizeServerCode(err.serverCode),
      requestId: sanitizeRequestId(err.requestId),
    });
  }

  return new MessagesOperationError({ code: 'unexpected', message: GENERIC_SAFE_MESSAGES_ERROR });
}

/** User-facing copy for a message that could not be recorded. Never reflects raw server text. */
export function messageErrorMessage(err: unknown): string {
  const safe = sanitizeMessagesError(err);
  if (safe.serverCode && Object.prototype.hasOwnProperty.call(SERVER_CODE_MESSAGES, safe.serverCode)) {
    return SERVER_CODE_MESSAGES[safe.serverCode] ?? safe.message;
  }
  if (safe.code === 'forbidden' || safe.status === 403) return SAFE_MESSAGES_ERROR_MESSAGES.forbidden;
  return safe.message;
}

export interface MessagesPort {
  /** Lists the messages the reader may see, newest first, optionally for one client. */
  listMessages(role: CompanyRole, clientId?: string, options?: PortExecutionOptions): Promise<ClientMessageDto[]>;
  /** Records a message that is being opened in WhatsApp. */
  recordMessage(
    role: CompanyRole,
    input: RecordClientMessageInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientMessageDto>;
}

// ---------------------------------------------------------------------------
// Labels shared by the dialog and the Communication page
// ---------------------------------------------------------------------------

export const MESSAGE_PURPOSE_LABELS: Readonly<Record<MessagePurpose, string>> = {
  document_request: 'Document request',
  deadline_reminder: 'Deadline reminder',
  payment_reminder: 'Payment reminder',
  general: 'General message',
};

export const MESSAGE_STATUS_LABEL = 'Opened in WhatsApp';
