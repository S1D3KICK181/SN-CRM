import type { ReportingLineDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import {
  TeamDirectoryOperationError,
  sanitizeTeamDirectoryError,
  type TeamDirectoryPort,
  type TeamDirectoryState,
} from './team-directory-types';

export interface TeamDirectoryCoordinatorOptions {
  port: TeamDirectoryPort;
  initialRole: CompanyRole;
  onToast?: (message: string) => void;
  onError?: (error: TeamDirectoryOperationError) => void;
}

export class TeamDirectoryCoordinator {
  private readonly port: TeamDirectoryPort;
  private currentRole: CompanyRole;
  private readonly onToast?: (message: string) => void;
  private readonly onError?: (error: TeamDirectoryOperationError) => void;

  private items: ReportingLineDto[] = [];
  private loading = false;
  private error: TeamDirectoryOperationError | null = null;
  private hasLiveSnapshot = false;

  private currentGeneration = 0;
  private listAbortController: AbortController | null = null;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(options: TeamDirectoryCoordinatorOptions) {
    this.port = options.port;
    this.currentRole = options.initialRole;
    this.onToast = options.onToast;
    this.onError = options.onError;
  }

  getState(): TeamDirectoryState {
    return {
      items: this.items,
      loading: this.loading,
      error: this.error,
      role: this.currentRole,
      hasLiveSnapshot: this.hasLiveSnapshot,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Suppress listener errors to protect coordination
      }
    }
  }

  async setRole(role: CompanyRole): Promise<void> {
    if (this.disposed) return;
    if (role === this.currentRole) return;

    this.currentRole = role;

    if (this.listAbortController) {
      this.listAbortController.abort();
      this.listAbortController = null;
    }

    // Zero-frame role reset: synchronously clear stale role data
    this.items = [];
    this.hasLiveSnapshot = false;
    this.error = null;
    this.loading = true;
    this.notify();

    await this.sync();
  }

  async switchRole(role: CompanyRole): Promise<void> {
    if (this.disposed) return;
    if (role !== this.currentRole) {
      await this.setRole(role);
    } else {
      await this.sync();
    }
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
        err instanceof TeamDirectoryOperationError
          ? sanitizeTeamDirectoryError(err)
          : sanitizeTeamDirectoryError(
              new TeamDirectoryOperationError({
                code: 'unexpected',
                message: err instanceof Error ? err.message : 'Failed to fetch team directory.',
                cause: err,
              }),
            );

      if (opError.code === 'aborted') {
        return;
      }

      this.error = opError;
      this.onError?.(opError);
      if (this.hasLiveSnapshot) {
        this.onToast?.(opError.message);
      }
      this.notify();
    } finally {
      if (this.listAbortController === controller) {
        this.listAbortController = null;
      }
    }
  }

  cancelPending(options: { notify?: boolean } = {}): void {
    const shouldNotify = options.notify ?? true;
    ++this.currentGeneration;
    if (this.listAbortController) {
      this.listAbortController.abort();
      this.listAbortController = null;
    }
    const wasLoading = this.loading;
    this.loading = false;
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
}
