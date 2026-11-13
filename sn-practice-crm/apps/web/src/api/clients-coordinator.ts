import type {
  ClientContactDto,
  ClientDto,
  CreateClientContactInput,
  CreateClientInput,
  UpdateClientContactInput,
  UpdateClientInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import {
  ClientOperationError,
  sanitizeClientMutationError,
  sanitizeCreateClientError,
  type ClientsCoordinatorState,
  type ClientsPort,
} from './clients-types';

export interface ClientsCoordinatorOptions {
  port: ClientsPort;
  initialRole?: CompanyRole;
  onError?: (error: ClientOperationError) => void;
  onToast?: (message: string) => void;
}

export class ClientsCoordinator {
  private items: ClientDto[] = [];
  private loading = false;
  private error: ClientOperationError | null = null;
  private currentRole: CompanyRole;
  private hasLiveSnapshot = false;

  private selectedClientId: string | null = null;
  private selectedDetail: ClientDto | null = null;
  private detailLoading = false;
  private detailError: ClientOperationError | null = null;

  private currentGeneration = 0;
  private detailGeneration = 0;
  private createGeneration = 0;
  private listAbortController: AbortController | null = null;
  private detailAbortController: AbortController | null = null;
  private createAbortController: AbortController | null = null;
  private disposed = false;

  private readonly port: ClientsPort;
  private readonly onError?: (error: ClientOperationError) => void;
  private readonly onToast?: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  constructor(options: ClientsCoordinatorOptions) {
    this.port = options.port;
    this.currentRole = options.initialRole ?? 'founder';
    this.onError = options.onError;
    this.onToast = options.onToast;
  }

  getState(): ClientsCoordinatorState {
    return {
      items: this.items,
      loading: this.loading,
      error: this.error,
      role: this.currentRole,
      hasLiveSnapshot: this.hasLiveSnapshot,
      selectedClientId: this.selectedClientId,
      selectedDetail: this.selectedDetail,
      detailLoading: this.detailLoading,
      detailError: this.detailError,
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getPort(): ClientsPort {
    return this.port;
  }

  cancelPending(options: { notify?: boolean } = {}): void {
    const shouldNotify = options.notify ?? true;
    this.currentGeneration++;
    this.detailGeneration++;
    this.createGeneration++;

    if (this.listAbortController) {
      this.listAbortController.abort();
      this.listAbortController = null;
    }
    if (this.detailAbortController) {
      this.detailAbortController.abort();
      this.detailAbortController = null;
    }
    if (this.createAbortController) {
      this.createAbortController.abort();
      this.createAbortController = null;
    }

    const wasLoading = this.loading || this.detailLoading;
    this.loading = false;
    this.detailLoading = false;

    if (shouldNotify && wasLoading && !this.disposed) {
      this.notify();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending({ notify: false });
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      listener();
    }
  }

  async switchRole(nextRole: CompanyRole): Promise<void> {
    if (this.disposed) return;

    const isActualRoleChange = nextRole !== this.currentRole;
    if (isActualRoleChange) {
      this.cancelPending({ notify: false });
      this.currentRole = nextRole;
      this.items = [];
      this.hasLiveSnapshot = false;
      this.error = null;
      this.selectedClientId = null;
      this.selectedDetail = null;
      this.detailLoading = false;
      this.detailError = null;
      this.loading = true;
      this.notify();
    }

    await this.sync();
  }

  async sync(): Promise<void> {
    if (this.disposed) return;

    if (this.listAbortController) {
      this.listAbortController.abort();
    }

    const generation = ++this.currentGeneration;
    const role = this.currentRole;
    const controller = new AbortController();
    this.listAbortController = controller;

    this.loading = true;
    this.error = null;
    this.notify();

    try {
      const serverItems = await this.port.list(role, { signal: controller.signal });

      if (this.disposed || generation !== this.currentGeneration || role !== this.currentRole) {
        return;
      }

      this.items = serverItems;
      this.hasLiveSnapshot = true;
      this.loading = false;
      this.notify();
    } catch (err: unknown) {
      if (this.disposed || generation !== this.currentGeneration || role !== this.currentRole) {
        return;
      }

      this.loading = false;
      const opError =
        err instanceof ClientOperationError
          ? err
          : new ClientOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to fetch clients.',
              cause: err,
            });

      this.error = opError;
      this.onError?.(opError);
      this.onToast?.(opError.message);
      this.notify();
    } finally {
      if (this.listAbortController === controller) {
        this.listAbortController = null;
      }
    }
  }

  async selectClient(id: string): Promise<void> {
    if (this.disposed) return;

    if (this.detailAbortController) {
      this.detailAbortController.abort();
    }

    const generation = ++this.detailGeneration;
    const role = this.currentRole;
    const controller = new AbortController();
    this.detailAbortController = controller;

    this.selectedClientId = id;
    this.selectedDetail = null;
    this.detailLoading = true;
    this.detailError = null;
    this.notify();

    try {
      const client = await this.port.get(role, id, { signal: controller.signal });

      if (
        this.disposed ||
        generation !== this.detailGeneration ||
        role !== this.currentRole ||
        this.selectedClientId !== id
      ) {
        return;
      }

      this.selectedDetail = client;
      this.detailLoading = false;
      this.notify();
    } catch (err: unknown) {
      if (
        this.disposed ||
        generation !== this.detailGeneration ||
        role !== this.currentRole ||
        this.selectedClientId !== id
      ) {
        return;
      }

      this.detailLoading = false;
      const opError =
        err instanceof ClientOperationError
          ? err
          : new ClientOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to fetch client details.',
              cause: err,
            });

      this.detailError = opError;
      this.onError?.(opError);
      this.onToast?.(opError.message);
      this.notify();
    } finally {
      if (this.detailAbortController === controller) {
        this.detailAbortController = null;
      }
    }
  }

  clearSelection(): void {
    if (this.disposed) return;

    this.detailGeneration++;
    if (this.detailAbortController) {
      this.detailAbortController.abort();
      this.detailAbortController = null;
    }

    this.selectedClientId = null;
    this.selectedDetail = null;
    this.detailLoading = false;
    this.detailError = null;
    this.notify();
  }

  async createClient(input: CreateClientInput): Promise<ClientDto | null> {
    if (this.disposed) return null;

    if (this.createAbortController) {
      this.createAbortController.abort();
    }

    const generation = ++this.createGeneration;
    const role = this.currentRole;
    const controller = new AbortController();
    this.createAbortController = controller;

    try {
      const created = await this.port.create(role, input, { signal: controller.signal });

      if (
        this.disposed ||
        generation !== this.createGeneration ||
        role !== this.currentRole ||
        controller.signal.aborted
      ) {
        return null;
      }

      // Invalidate any pre-existing in-flight list request so it cannot overwrite the newly created client
      if (this.listAbortController) {
        this.listAbortController.abort();
        this.listAbortController = null;
      }
      this.currentGeneration++;
      this.loading = false;

      // Prepend & dedupe newly created client
      const existingWithoutCreated = this.items.filter((item) => item.id !== created.id);
      this.items = [created, ...existingWithoutCreated];
      this.hasLiveSnapshot = true;
      this.notify();

      // Guarded non-blocking fresh sync against committed server state
      void this.reconcileAfterCreate(role, created);

      return created;
    } catch (err: unknown) {
      if (
        this.disposed ||
        generation !== this.createGeneration ||
        role !== this.currentRole ||
        controller.signal.aborted
      ) {
        return null;
      }

      const opError = sanitizeCreateClientError(err);

      if (opError.code === 'aborted') {
        return null;
      }

      // Propagate sanitized create errors to the caller for the dialog; do not trigger generic toast
      throw opError;
    } finally {
      if (this.createAbortController === controller) {
        this.createAbortController = null;
      }
    }
  }

  /**
   * Runs one client or contact change. A failure is rethrown as safe, sanitized copy for the dialog.
   * A stale failure reloads the open client in the background so the next try starts from fresh data.
   */
  private async runMutation<T>(run: (role: CompanyRole) => Promise<T>): Promise<T | null> {
    if (this.disposed) return null;
    const role = this.currentRole;
    let result: T;
    try {
      result = await run(role);
    } catch (err: unknown) {
      if (this.disposed || role !== this.currentRole) return null;
      const opError = sanitizeClientMutationError(err);
      if (opError.code === 'aborted') return null;
      if (opError.serverCode === 'stale_client' || opError.serverCode === 'stale_contact') {
        void this.refreshOpenClient();
      }
      throw opError;
    }
    if (this.disposed || role !== this.currentRole) return null;
    await this.refreshOpenClient();
    return result;
  }

  async updateClient(clientId: string, input: UpdateClientInput, idempotencyKey: string): Promise<ClientDto | null> {
    return this.runMutation((role) => this.port.updateClient(role, clientId, input, idempotencyKey));
  }

  async createContact(
    clientId: string,
    input: CreateClientContactInput,
    idempotencyKey: string,
  ): Promise<ClientContactDto | null> {
    return this.runMutation((role) => this.port.createContact(role, clientId, input, idempotencyKey));
  }

  async updateContact(
    contactId: string,
    input: UpdateClientContactInput,
    idempotencyKey: string,
  ): Promise<ClientContactDto | null> {
    return this.runMutation((role) => this.port.updateContact(role, contactId, input, idempotencyKey));
  }

  async deleteContact(contactId: string): Promise<boolean> {
    const done = await this.runMutation(async (role) => {
      await this.port.deleteContact(role, contactId);
      return true;
    });
    return done === true;
  }

  /**
   * Reloads the open client's detail without blanking the drawer, then the list. Neither failure
   * is reported to the caller: the change itself is already saved or already refused.
   */
  async refreshOpenClient(): Promise<void> {
    if (this.disposed) return;
    const openId = this.selectedClientId;
    const role = this.currentRole;
    const tasks: Array<Promise<void>> = [this.sync()];
    if (openId) {
      tasks.push(this.reloadDetailQuietly(role, openId));
    }
    await Promise.all(tasks);
  }

  private async reloadDetailQuietly(role: CompanyRole, id: string): Promise<void> {
    if (this.detailAbortController) {
      this.detailAbortController.abort();
    }
    const generation = ++this.detailGeneration;
    const controller = new AbortController();
    this.detailAbortController = controller;
    try {
      const client = await this.port.get(role, id, { signal: controller.signal });
      if (
        this.disposed ||
        generation !== this.detailGeneration ||
        role !== this.currentRole ||
        this.selectedClientId !== id
      ) {
        return;
      }
      this.selectedDetail = client;
      this.detailLoading = false;
      this.detailError = null;
      this.notify();
    } catch {
      // Keep showing the last loaded detail; the list refresh reports its own failures.
    } finally {
      if (this.detailAbortController === controller) {
        this.detailAbortController = null;
      }
    }
  }

  private async reconcileAfterCreate(role: CompanyRole, created: ClientDto): Promise<void> {
    if (this.disposed || role !== this.currentRole) return;

    const generation = ++this.currentGeneration;
    const controller = new AbortController();
    this.listAbortController = controller;

    try {
      const serverItems = await this.port.list(role, { signal: controller.signal });

      if (
        this.disposed ||
        generation !== this.currentGeneration ||
        role !== this.currentRole ||
        controller.signal.aborted
      ) {
        return;
      }

      // Authoritative committed server list: ensure created client is present
      const containsCreated = serverItems.some((item) => item.id === created.id);
      this.items = containsCreated ? serverItems : [created, ...serverItems];
      this.error = null;
      this.hasLiveSnapshot = true;
      this.loading = false;
      this.notify();
    } catch (err: unknown) {
      if (
        this.disposed ||
        generation !== this.currentGeneration ||
        role !== this.currentRole ||
        controller.signal.aborted
      ) {
        return;
      }

      const opError =
        err instanceof ClientOperationError
          ? err
          : new ClientOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to refresh client list.',
              cause: err,
            });

      if (opError.code === 'aborted') {
        return;
      }

      // Reconciliation failure preserves the created snapshot and uses existing non-destructive refresh error behavior
      this.error = opError;
      this.loading = false;
      this.onError?.(opError);
      this.onToast?.(opError.message || 'Failed to refresh client list.');
      this.notify();
    } finally {
      if (this.listAbortController === controller) {
        this.listAbortController = null;
      }
    }
  }
}
