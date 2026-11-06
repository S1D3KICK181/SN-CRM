import type { ClientDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import {
  ClientOperationError,
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
  private listAbortController: AbortController | null = null;
  private detailAbortController: AbortController | null = null;
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

    if (this.listAbortController) {
      this.listAbortController.abort();
      this.listAbortController = null;
    }
    if (this.detailAbortController) {
      this.detailAbortController.abort();
      this.detailAbortController = null;
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
}
