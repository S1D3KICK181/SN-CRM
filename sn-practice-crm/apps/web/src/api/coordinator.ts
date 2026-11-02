import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow } from '../data';
import { mergeCreateResult, mergeTransitionResult } from './domain-merge';
import { mapStatusTransitionToAction, normalizeLifecycleStage } from './mapper';
import {
  AssignmentOperationError,
  type AssignmentsPort,
  type CreateAssignmentCommand,
} from './types';

export interface CoordinatorState {
  assignments: AssignmentRow[];
  loading: boolean;
  error: AssignmentOperationError | null;
  role: CompanyRole;
  hasLiveSnapshot: boolean;
}

export interface ClientFieldCascadePayload {
  id: string;
  name: string;
  tradeName?: string;
  bankStatementRequired?: boolean;
}

export interface AssignmentsCoordinatorOptions {
  initialRows: AssignmentRow[];
  port: AssignmentsPort;
  initialRole?: CompanyRole;
  onError?: (error: AssignmentOperationError) => void;
  onToast?: (message: string) => void;
}

export class AssignmentsCoordinator {
  private assignments: AssignmentRow[];
  private loading = false;
  private error: AssignmentOperationError | null = null;
  private currentRole: CompanyRole;
  private hasLiveSnapshot = false;

  private currentGeneration = 0;
  private listAbortController: AbortController | null = null;
  private readonly activeWriteControllers = new Set<AbortController>();
  private disposed = false;

  private readonly port: AssignmentsPort;
  private readonly onError?: (error: AssignmentOperationError) => void;
  private readonly onToast?: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  constructor(options: AssignmentsCoordinatorOptions) {
    this.assignments = [...options.initialRows];
    this.port = options.port;
    this.currentRole = options.initialRole ?? 'founder';
    this.onError = options.onError;
    this.onToast = options.onToast;
  }

  getState(): CoordinatorState {
    return {
      assignments: this.assignments,
      loading: this.loading,
      error: this.error,
      role: this.currentRole,
      hasLiveSnapshot: this.hasLiveSnapshot,
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Aborts active in-flight list and write requests, and increments the generation guard
   * to invalidate late callbacks, without permanently disposing the coordinator.
   */
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

    const wasLoading = this.loading;
    this.loading = false;

    if (shouldNotify && wasLoading && !this.disposed) {
      this.notify();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
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
    if (this.disposed) {
      return;
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Cascades updated client properties (e.g. bank statement requirement)
   * to all assignments linked to the client.
   */
  cascadeClientFields(client: ClientFieldCascadePayload): void {
    if (this.disposed) return;
    const targetId = client.id;
    const targetName = client.name.trim().toLowerCase();
    const targetTrade = client.tradeName?.trim().toLowerCase();

    let mutated = false;
    this.assignments = this.assignments.map((assignment) => {
      const matchId = Boolean(assignment.clientId && assignment.clientId === targetId);
      const clientLower = assignment.client.trim().toLowerCase();
      const matchName = clientLower === targetName;
      const matchTrade = Boolean(targetTrade && clientLower === targetTrade);

      if (matchId || matchName || matchTrade) {
        mutated = true;
        const nextBankRec =
          client.bankStatementRequired === false
            ? 'Not applicable'
            : assignment.bankRecStatus;
        return {
          ...assignment,
          bankStatementRequired: client.bankStatementRequired,
          bankRecStatus: nextBankRec,
        };
      }
      return assignment;
    });

    if (mutated) {
      this.notify();
    }
  }

  /**
   * Marks a specific assignment as billed following invoice creation.
   */
  markAssignmentBilled(assignmentId: string): void {
    if (this.disposed) return;
    let mutated = false;
    this.assignments = this.assignments.map((assignment) => {
      if (assignment.id === assignmentId) {
        if (assignment.billed) {
          return assignment;
        }
        mutated = true;
        return { ...assignment, billed: true };
      }
      return assignment;
    });

    if (mutated) {
      this.notify();
    }
  }

  /**
   * Switches the active role.
   * On an actual role change, cancels in-flight work and synchronously clears the previous
   * role's rows before starting the new request, preventing cross-role leaks.
   */
  async switchRole(nextRole: CompanyRole): Promise<void> {
    if (this.disposed) {
      return;
    }

    const isActualRoleChange = nextRole !== this.currentRole;
    if (isActualRoleChange) {
      this.cancelPending({ notify: false });
      this.currentRole = nextRole;
      this.assignments = [];
      this.hasLiveSnapshot = false;
      this.error = null;
      this.notify();
    }

    await this.sync();
  }

  /**
   * Fetches the role-scoped live assignments snapshot from the API.
   * On first success, replaces initial rows with the live snapshot.
   * On failure, preserves previous snapshot and reports an explicit error.
   */
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
      const serverRows = await this.port.list(role, { signal: controller.signal });

      // Guard: discard if disposed or generation or role changed while fetching
      if (this.disposed || generation !== this.currentGeneration || role !== this.currentRole) {
        return;
      }

      this.assignments = serverRows;
      this.hasLiveSnapshot = true;
      this.loading = false;
      this.notify();
    } catch (err: unknown) {
      // Discard aborted, stale generation, or disposed errors
      if (this.disposed || generation !== this.currentGeneration || role !== this.currentRole) {
        return;
      }

      this.loading = false;
      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to fetch live assignments.',
              cause: err,
            });

      if (opError.code === 'aborted') {
        this.notify();
        return;
      }

      this.error = opError;
      // Preserve previous snapshot, never clear data or claim false fallback
      this.notify();
      this.onError?.(opError);
      this.onToast?.(`Live assignment sync failed: ${opError.message}`);
    } finally {
      if (this.listAbortController === controller) {
        this.listAbortController = null;
      }
    }
  }

  /**
   * Server-authoritative assignment creation.
   * No optimistic insert; inserts once upon success.
   * Guarded against actor/generation changes and disposal.
   */
  async handleCreateAssignment(
    command: CreateAssignmentCommand | AssignmentRow,
  ): Promise<{ success: boolean; row?: AssignmentRow; error?: AssignmentOperationError }> {
    if (this.disposed) {
      return {
        success: false,
        error: new AssignmentOperationError({
          code: 'aborted',
          message: 'Coordinator is disposed.',
        }),
      };
    }

    const writeGen = this.currentGeneration;
    const writeRole = this.currentRole;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);

    try {
      const serverRow = await this.port.create(writeRole, command, {
        signal: controller.signal,
      });

      // Generation & disposal guard on writes: cannot mutate if user switched roles or disposed
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Create operation discarded due to role switch or disposal.',
          }),
        };
      }

      // Merge server-authoritative identity with submitted non-wire fields
      const mergedRow = mergeCreateResult(command, serverRow);
      const exists = this.assignments.some((a) => a.id === mergedRow.id);
      if (!exists) {
        this.assignments = [mergedRow, ...this.assignments];
      }
      this.notify();
      this.onToast?.(`Assignment ${mergedRow.id} (${mergedRow.title}) created`);
      return { success: true, row: mergedRow };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Create operation discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to create assignment.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to create assignment: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }

  /**
   * Server-authoritative assignment update / lifecycle transition.
   * - If id does not exist: returns not_found error, preserves state, notifies onError, no success toast.
   * - If status is unchanged: UI-only edit, remains local.
   * - If status changed: maps to contract transition action and calls API.
   * - State updated only after success; failure preserves state.
   */
  async handleUpdateAssignment(
    updated: AssignmentRow,
  ): Promise<{
    success: boolean;
    row?: AssignmentRow;
    error?: AssignmentOperationError;
    localOnly?: boolean;
  }> {
    if (this.disposed) {
      return {
        success: false,
        error: new AssignmentOperationError({
          code: 'aborted',
          message: 'Coordinator is disposed.',
        }),
      };
    }

    const existing = this.assignments.find((a) => a.id === updated.id);
    if (!existing) {
      const err = new AssignmentOperationError({
        code: 'not_found',
        message: `Assignment with id "${updated.id}" not found.`,
      });
      this.onError?.(err);
      return { success: false, error: err };
    }

    const currentStage = normalizeLifecycleStage(existing.status);
    const targetStage = normalizeLifecycleStage(updated.status);

    // If same status or equivalent alias (e.g. "Open" ↔ "Awaiting documents", "In progress" ↔ "On track"):
    // UI-only edit, remains local
    if (existing.status === updated.status || (currentStage !== 'unknown' && currentStage === targetStage)) {
      this.assignments = this.assignments.map((a) => (a.id === updated.id ? updated : a));
      this.notify();
      this.onToast?.(`Updated ${updated.id} (${updated.title})`);
      return { success: true, row: updated, localOnly: true };
    }

    // Status changed: check if it maps to a valid adjacent contract transition
    const transitionAction = mapStatusTransitionToAction(existing.status, updated.status);
    if (!transitionAction) {
      const err = new AssignmentOperationError({
        code: 'conflict',
        message: `Cannot transition assignment from "${existing.status}" to "${updated.status}".`,
      });
      this.onError?.(err);
      this.onToast?.(`Invalid transition: ${err.message}`);
      return { success: false, error: err };
    }

    const writeGen = this.currentGeneration;
    const writeRole = this.currentRole;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);

    try {
      const serverRow = await this.port.transition(
        writeRole,
        updated.id,
        transitionAction,
        { signal: controller.signal },
      );

      // Generation & disposal guard on writes
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Transition discarded due to role switch or disposal.',
          }),
        };
      }

      // Re-read latest same-row state from this.assignments
      const currentRow = this.assignments.find((a) => a.id === updated.id);
      if (!currentRow) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'not_found',
            message: `Assignment with id "${updated.id}" not found.`,
          }),
        };
      }

      // Merge server-authoritative lifecycle result with latest local fields & drawer edits
      const mergedRow = mergeTransitionResult(existing, updated, serverRow, currentRow);
      this.assignments = this.assignments.map((a) => (a.id === mergedRow.id ? mergedRow : a));
      this.notify();
      this.onToast?.(`Updated ${mergedRow.id} (${mergedRow.title})`);
      return { success: true, row: mergedRow };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Transition discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to transition assignment.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to transition assignment: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }
}
