import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ClientDto, ClientMessageDto, MessagePurpose } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { UseMessagesResult } from '../../api/use-messages';
import {
  WhatsAppMessageDialog,
  type MessageAssignmentLink,
  type MessageBillLink,
  type MessageClientInfo,
  type MessageComposeSetup,
} from './whatsapp-message-dialog';

export interface MessageComposeRequest {
  readonly clientId: string;
  readonly purpose: MessagePurpose;
  readonly assignment?: MessageAssignmentLink | null;
  readonly bill?: MessageBillLink | null;
  /** Fresher client details than the directory holds, such as the contacts a profile drawer is showing. */
  readonly client?: MessageClientInfo;
}

/** What a screen needs to start a message and to show a client's recent ones. */
export interface MessageComposer {
  /** False for a Trainee, who may not message clients. */
  readonly canMessage: boolean;
  readonly open: (request: MessageComposeRequest, opener?: HTMLElement | null) => void;
  /** The newest messages for one client, newest first. */
  readonly recentFor: (clientId: string, limit?: number) => readonly ClientMessageDto[];
  /** Goes to the Communication page with this client chosen. */
  readonly showAll: (clientId: string) => void;
}

const MessageComposerContext = createContext<MessageComposer | null>(null);

export const MessageComposerContextProvider = MessageComposerContext.Provider;

/** The composer, or null when the screen is shown without one (the entry points then stay hidden). */
export function useMessageComposer(): MessageComposer | null {
  return useContext(MessageComposerContext);
}

function clientInfoFrom(client: ClientDto): MessageClientInfo {
  return {
    id: client.id,
    displayName: client.displayName,
    phone: client.phone,
    contacts: client.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      designation: contact.designation,
      phone: contact.phone,
      whatsapp: contact.whatsapp,
      isPrimary: contact.isPrimary,
    })),
  };
}

export interface MessageComposerProviderProps {
  readonly role: CompanyRole;
  /** The live client directory, for the contacts and the client's name. */
  readonly clients: readonly ClientDto[];
  readonly messages: readonly ClientMessageDto[];
  readonly record: UseMessagesResult['record'];
  readonly onShowAll: (clientId: string) => void;
  readonly onToast: (message: string) => void;
  readonly children: ReactNode;
}

/** Holds the one WhatsApp message dialog and lets any screen below it start a message. */
export function MessageComposerProvider({
  role,
  clients,
  messages,
  record,
  onShowAll,
  onToast,
  children,
}: MessageComposerProviderProps) {
  const [active, setActive] = useState<{ setup: MessageComposeSetup; opener: HTMLElement | null } | null>(null);
  const canMessage = role !== 'trainee';

  const open = useCallback(
    (request: MessageComposeRequest, opener?: HTMLElement | null) => {
      if (!canMessage) return;
      const directoryClient = clients.find((client) => client.id === request.clientId);
      const client = request.client ?? (directoryClient ? clientInfoFrom(directoryClient) : null);
      if (!client) {
        onToast('The client could not be found.');
        return;
      }
      setActive({
        setup: { client, purpose: request.purpose, assignment: request.assignment ?? null, bill: request.bill ?? null },
        opener: opener ?? null,
      });
    },
    [canMessage, clients, onToast],
  );

  const recentFor = useCallback(
    (clientId: string, limit = 5) => messages.filter((message) => message.clientId === clientId).slice(0, limit),
    [messages],
  );

  const composer = useMemo<MessageComposer>(
    () => ({ canMessage, open, recentFor, showAll: onShowAll }),
    [canMessage, open, recentFor, onShowAll],
  );

  return (
    <MessageComposerContext.Provider value={composer}>
      {children}
      <WhatsAppMessageDialog
        open={active !== null}
        setup={active?.setup ?? null}
        opener={active?.opener ?? null}
        onClose={() => setActive(null)}
        onRecord={async (input, key) => {
          await record(input, key);
        }}
        onToast={onToast}
      />
    </MessageComposerContext.Provider>
  );
}
