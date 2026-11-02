import type {
  CreateWorkItemInput,
  WorkItemDto,
  WorkItemTransition,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import {
  WorkItemOperationError,
  type WorkItemsCoordinatorState,
  type WorkItemsPort,
} from './work-items-types';

export interface WorkItemsCoordinatorOptions {
  port: WorkItemsPort;
  initialRole?: CompanyRole;
  onError?: (error: WorkItemOperationError) => void;
  onToast?: (message: string) => void;
}

function computeCreateKey(input: CreateWorkItemInput): string {
  if (input.kind === 'delegated') {
    return `delegated:${input.title}:${input.dueAt}:${input.assignmentId}:${input.assigneeId}:${input.reminderAt ?? ''}`;
  }
  if (input.kind === 'personal') {
    return `personal:${input.title}:${input.dueAt}:${input.relatedClientId ?? ''}:${input.relatedPartyName ?? ''}:${input.reminderAt ?? ''}`;
  }
  return `${input.kind}:${input.title}:${input.dueAt}:${input.assigneeId}:${input.reminderAt ?? ''}`;
}

export class WorkItemsCoordinator {
  private items: WorkItemDto[] = [];
  private loading = false;
  private error: WorkItemOperationError | null = null;
  private currentRole: CompanyRole;
  private hasLiveSnapshot = false;

  private currentGeneration = 0;
  private listAbortController: AbortController | null = null;
  private readonly activeWriteControllers = new Set<AbortController>();
  private readonly activeTransitions = new Set<string>();
  private readonly activeCreates = new Set<string>();
  private disposed = false;

  private readonly port: WorkItemsPort;
  private readonly onError?: (error: WorkItemOperationError) => void;
  private readonly onToast?: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  constructor(options: WorkItemsCoordinatorOptions) {
    this.port = options.port;
    this.currentRole = options.initialRole ?? 'founder';
    this.onError = options.onError;
    this.onToast = options.onToast;
  }

  getState(): WorkItemsCoordinatorState {
    return {
      items: this.items,
      loading: this.loading,
      error: this.error,
      role: this.currentRole,
      hasLiveSnapshot: this.hasLiveSnapshot,
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  cancelPending(options: { notify?: boolean } = {}): void {
    const shouldNotify = options.notify ?? true;
    this.currentGeneration++;
    if (this.listAbortController) {
      this.listAbortController.abort();
      this.listAbortController = null;
    }

    for (const controller of this.activeWriteControllers) {
      controller.abort();
    }
    this.activeWriteControllers.clear();
    this.activeTransitions.clear();
    this.activeCreates.clear();

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
      this.notify();
    }

    await this.sync();
  }

  async sync(): Promise<void> {
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
        err instanceof WorkItemOperationError
          ? err
          : new WorkItemOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to fetch work items.',
              cause: err,
            });

      if (opError.code === 'aborted') {
        this.notify();
        return;
      }

      this.error = opError;
      this.notify();
      this.onError?.(opError);
      this.onToast?.(`Live work items sync failed: ${opError.message}`);
    } finally {
      if (this.listAbortController === controller) {
        this.listAbortController = null;
      }
    }
  }

  async handleCreateWorkItem(
    input: CreateWorkItemInput,
  ): Promise<{ success: boolean; item?: WorkItemDto; error?: WorkItemOperationError }> {
    if (this.disposed) {
      return {
        success: false,
        error: new WorkItemOperationError({
          code: 'aborted',
          message: 'Coordinator is disposed.',
        }),
      };
    }

    const createKey = computeCreateKey(input);
    if (this.activeCreates.has(createKey)) {
      const err = new WorkItemOperationError({
        code: 'conflict',
        message: 'A create operation for this work item is already in flight.',
      });
      return { success: false, error: err };
    }
    this.activeCreates.add(createKey);

    const writeGen = this.currentGeneration;
    const writeRole = this.currentRole;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);

    try {
      const serverItem = await this.port.create(writeRole, input, {
        signal: controller.signal,
      });

      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new WorkItemOperationError({
            code: 'aborted',
            message: 'Create operation discarded due to role switch or disposal.',
          }),
        };
      }

      const exists = this.items.some((i) => i.id === serverItem.id);
      if (!exists) {
        this.items = [serverItem, ...this.items];
      }
      this.notify();
      this.onToast?.(
        serverItem.kind === 'personal'
          ? 'Personal task scheduled'
          : `Work item "${serverItem.title}" created`,
      );
      return { success: true, item: serverItem };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new WorkItemOperationError({
            code: 'aborted',
            message: 'Create operation discarded.',
          }),
        };
      }

      const opError =
        err instanceof WorkItemOperationError
          ? err
          : new WorkItemOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to create work item.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to create work item: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeCreates.delete(createKey);
      this.activeWriteControllers.delete(controller);
    }
  }

  async handleTransitionWorkItem(
    id: string,
    action: WorkItemTransition,
  ): Promise<{ success: boolean; item?: WorkItemDto; error?: WorkItemOperationError }> {
    if (this.disposed) {
      return {
        success: false,
        error: new WorkItemOperationError({
          code: 'aborted',
          message: 'Coordinator is disposed.',
        }),
      };
    }

    const existing = this.items.find((i) => i.id === id);
    if (!existing) {
      const err = new WorkItemOperationError({
        code: 'not_found',
        message: `Work item with id "${id}" not found.`,
      });
      this.onError?.(err);
      return { success: false, error: err };
    }

    if (this.activeTransitions.has(id)) {
      const err = new WorkItemOperationError({
        code: 'conflict',
        message: `A transition for work item "${id}" is already in flight.`,
      });
      return { success: false, error: err };
    }
    this.activeTransitions.add(id);

    const writeGen = this.currentGeneration;
    const writeRole = this.currentRole;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);

    try {
      const serverItem = await this.port.transition(writeRole, id, action, {
        signal: controller.signal,
      });

      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new WorkItemOperationError({
            code: 'aborted',
            message: 'Transition discarded due to role switch or disposal.',
          }),
        };
      }

      // Re-read current item after await; do not resurrect a removed/stale row
      const currentItem = this.items.find((i) => i.id === id);
      if (!currentItem) {
        return {
          success: false,
          error: new WorkItemOperationError({
            code: 'not_found',
            message: `Work item with id "${id}" not found.`,
          }),
        };
      }

      this.items = this.items.map((i) => (i.id === id ? serverItem : i));
      this.notify();
      this.onToast?.(`Updated work item "${serverItem.title}"`);
      return { success: true, item: serverItem };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new WorkItemOperationError({
            code: 'aborted',
            message: 'Transition discarded.',
          }),
        };
      }

      const opError =
        err instanceof WorkItemOperationError
          ? err
          : new WorkItemOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to transition work item.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to transition work item: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeTransitions.delete(id);
      this.activeWriteControllers.delete(controller);
    }
  }
}
