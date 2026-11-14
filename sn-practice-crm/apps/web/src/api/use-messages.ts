import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type { ClientMessageDto, RecordClientMessageInput } from '@sn/contracts';
import { useOptionalSessionActor } from '../shell/session-context';
import { HttpMessagesAdapter } from './http-messages-adapter';
import {
  MessagesOperationError,
  SAFE_MESSAGES_ERROR_MESSAGES,
  sanitizeMessagesError,
  type MessagesPort,
} from './messages-types';

export interface UseMessagesOptions {
  readonly port?: MessagesPort;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

export interface UseMessagesResult {
  readonly messages: ClientMessageDto[];
  readonly loading: boolean;
  readonly error: MessagesOperationError | null;
  readonly hasLiveSnapshot: boolean;
  readonly retry: () => void;
  /**
   * Records a message that is being opened in WhatsApp and reloads the list. Throws a sanitized
   * MessagesOperationError when it fails. Calling again with the same key after a failure
   * cannot record the message twice.
   */
  readonly record: (input: RecordClientMessageInput, idempotencyKey: string) => Promise<ClientMessageDto>;
}

interface MessagesSnapshot {
  readonly port: MessagesPort;
  readonly role: CompanyRole;
  readonly messages: ClientMessageDto[];
  readonly loading: boolean;
  readonly error: MessagesOperationError | null;
  readonly hasLiveSnapshot: boolean;
}

const NO_MESSAGES: ClientMessageDto[] = [];

function mayReadMessages(role: CompanyRole): boolean {
  return role !== 'trainee';
}

/**
 * The client message log and recording. Everyone except the Trainee loads (the API returns only the
 * messages of clients each role looks after); the Trainee gets an empty list and never triggers a
 * request. Data loaded for one role is never exposed to another (zero-frame suppression on role or
 * port change).
 */
export function useClientMessages(role: CompanyRole, options: UseMessagesOptions = {}): UseMessagesResult {
  const { enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpMessagesAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );

  const allowed = enabled && mayReadMessages(role);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<MessagesSnapshot | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();

    setSnapshot((previous) => {
      const sameScope = previous !== null && previous.port === port && previous.role === role;
      return {
        port,
        role,
        messages: sameScope ? previous.messages : NO_MESSAGES,
        loading: true,
        error: null,
        hasLiveSnapshot: sameScope ? previous.hasLiveSnapshot : false,
      };
    });

    port
      .listMessages(role, undefined, { signal: controller.signal })
      .then((dtos) => {
        if (controller.signal.aborted) return;
        setSnapshot({ port, role, messages: dtos, loading: false, error: null, hasLiveSnapshot: true });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = sanitizeMessagesError(err);
        if (error.code === 'aborted') return;
        setSnapshot((previous) => {
          const sameScope = previous !== null && previous.port === port && previous.role === role;
          return {
            port,
            role,
            messages: sameScope ? previous.messages : NO_MESSAGES,
            loading: false,
            error,
            hasLiveSnapshot: sameScope && previous.hasLiveSnapshot,
          };
        });
      });

    return () => controller.abort();
  }, [allowed, port, role, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const reload = useCallback(async () => {
    try {
      const dtos = await port.listMessages(role);
      setSnapshot({ port, role, messages: dtos, loading: false, error: null, hasLiveSnapshot: true });
    } catch {
      // The message itself was recorded; fall back to the normal reload so the list catches up.
      setAttempt((value) => value + 1);
    }
  }, [port, role]);

  const record = useCallback(
    async (input: RecordClientMessageInput, idempotencyKey: string): Promise<ClientMessageDto> => {
      if (!mayReadMessages(role)) {
        throw new MessagesOperationError({ code: 'forbidden', message: SAFE_MESSAGES_ERROR_MESSAGES.forbidden });
      }
      let recorded: ClientMessageDto;
      try {
        recorded = await port.recordMessage(role, input, idempotencyKey);
      } catch (err: unknown) {
        throw sanitizeMessagesError(err);
      }
      await reload();
      return recorded;
    },
    [port, role, reload],
  );

  if (!allowed) {
    return { messages: NO_MESSAGES, loading: false, error: null, hasLiveSnapshot: false, retry, record };
  }

  // Zero-frame privacy guard: a snapshot that belongs to another role or port is never shown.
  const current = snapshot !== null && snapshot.port === port && snapshot.role === role ? snapshot : null;
  if (!current) {
    return { messages: NO_MESSAGES, loading: true, error: null, hasLiveSnapshot: false, retry, record };
  }

  return {
    messages: current.messages,
    loading: current.loading,
    error: current.error,
    hasLiveSnapshot: current.hasLiveSnapshot,
    retry,
    record,
  };
}
