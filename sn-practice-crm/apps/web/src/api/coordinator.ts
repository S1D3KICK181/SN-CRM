import type { CompanyRole } from '@sn/domain';
import type { AssignmentRow, RecurringScheduleRecord } from '../data';
import { mergeCreateResult, mergeTransitionResult } from './domain-merge';
import {
  mapAssignmentRowToUpdatePatch,
  mapStatusTransitionToAction,
  normalizeLifecycleStage,
  parseDisplayDateToIso,
} from './mapper';
import { NAME_TO_DEMO_ACTOR_ID } from './dev-auth';
import { isValidUuid } from './metadata-safety';
import {
  AssignmentOperationError,
  type AssignmentsPort,
  type CreateAssignmentCommand,
  type CreateRecurringScheduleCommand,
  type GenerateDueAssignmentsResult,
  type UpdateRecurringSchedulePatch,
} from './types';

export interface CoordinatorState {
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  loading: boolean;
  error: AssignmentOperationError | null;
  role: CompanyRole;
  hasLiveSnapshot: boolean;
  isGeneratingDue?: boolean;
}

export interface ClientFieldCascadePayload {
  id: string;
  name: string;
  tradeName?: string;
  bankStatementRequired?: boolean;
}

export interface AssignmentsCoordinatorOptions {
  initialRows?: AssignmentRow[];
  initialSchedules?: RecurringScheduleRecord[];
  port: AssignmentsPort;
  initialRole?: CompanyRole;
  onError?: (error: AssignmentOperationError) => void;
  onToast?: (message: string) => void;
}

function formatEntityIdentity(entity: { id: string; code?: string }): string | undefined {
  if (entity.code && !isValidUuid(entity.code)) return entity.code;
  if (!isValidUuid(entity.id)) return entity.id;
  return undefined;
}

export class AssignmentsCoordinator {
  private assignments: AssignmentRow[];
  private schedules: RecurringScheduleRecord[];
  private loading = false;
  private isGeneratingDue = false;
  private error: AssignmentOperationError | null = null;
  private currentRole: CompanyRole;
  private hasLiveSnapshot = false;

  private currentGeneration = 0;
  private listAbortController: AbortController | null = null;
  private readonly activeWriteControllers = new Set<AbortController>();
  private disposed = false;

  private port: AssignmentsPort;
  private readonly onError?: (error: AssignmentOperationError) => void;
  private readonly onToast?: (message: string) => void;
  private readonly listeners = new Set<() => void>();

  constructor(options: AssignmentsCoordinatorOptions) {
    this.assignments = options.initialRows ? [...options.initialRows] : [];
    this.schedules = options.initialSchedules ? [...options.initialSchedules] : [];
    this.port = options.port;
    this.currentRole = options.initialRole ?? 'founder';
    this.onError = options.onError;
    this.onToast = options.onToast;
  }

  getState(): CoordinatorState {
    return {
      assignments: this.assignments,
      schedules: this.schedules,
      loading: this.loading,
      error: this.error,
      role: this.currentRole,
      hasLiveSnapshot: this.hasLiveSnapshot,
      isGeneratingDue: this.isGeneratingDue,
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
      this.schedules = [];
      this.hasLiveSnapshot = false;
      this.error = null;
      this.notify();
    }

    await this.sync();
  }

  /**
   * Fetches the role-scoped live assignments and recurring schedules snapshot from the API.
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
      const [serverRows, serverSchedules] = await Promise.all([
        this.port.list(role, { signal: controller.signal }),
        this.port.listSchedules(role, { signal: controller.signal }),
      ]);

      // Guard: discard if disposed or generation or role changed while fetching
      if (this.disposed || generation !== this.currentGeneration || role !== this.currentRole) {
        return;
      }

      this.assignments = serverRows;
      this.schedules = serverSchedules;
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

      const isAuthError =
        opError.code === 'unauthorized' ||
        opError.code === 'forbidden' ||
        opError.status === 401 ||
        opError.status === 403;
      if (isAuthError) {
        this.assignments = [];
        this.schedules = [];
        this.hasLiveSnapshot = false;
      }

      this.error = opError;
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
      const asgIdentity = formatEntityIdentity(mergedRow);
      this.onToast?.(
        asgIdentity
          ? `Assignment ${asgIdentity} (${mergedRow.title}) created`
          : `Assignment "${mergedRow.title}" created`,
      );
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

  setPort(nextPort: AssignmentsPort): void {
    this.port = nextPort;
  }

  /**
   * Updates an assignment's status and/or core non-status fields.
   * - Non-status changes are dispatched to port.update (PATCH /api/v1/assignments/:id).
   * - Status changes are dispatched to port.transition.
   * - If both non-status and status changed, updates are sequenced safely with refreshed expectedUpdatedAt.
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
    const isStatusChanged =
      existing.status !== updated.status &&
      !(currentStage !== 'unknown' && currentStage === targetStage);

    // Build patch for non-status fields
    let title: string | undefined;
    let serviceId: string | undefined;
    let ownerId: string | undefined;
    let reviewerIds: string[] | undefined;
    let dueAt: string | undefined;
    let deliveryNotes: string | null | undefined;
    let reviewNotes: string | null | undefined;
    let progressPercent: number | undefined;
    let hasNonStatusChanges = false;

    if (updated.title && updated.title !== existing.title) {
      title = updated.title.trim();
      hasNonStatusChanges = true;
    }
    if (updated.serviceId && updated.serviceId !== existing.serviceId) {
      serviceId = updated.serviceId;
      hasNonStatusChanges = true;
    }
    if (updated.ownerId && updated.ownerId !== existing.ownerId) {
      ownerId = updated.ownerId;
      hasNonStatusChanges = true;
    } else if (updated.owner && updated.owner !== existing.owner && NAME_TO_DEMO_ACTOR_ID[updated.owner]) {
      ownerId = NAME_TO_DEMO_ACTOR_ID[updated.owner];
      hasNonStatusChanges = true;
    }
    if (updated.reviewerIds !== undefined && updated.reviewerIds !== existing.reviewerIds) {
      reviewerIds = [...updated.reviewerIds];
      hasNonStatusChanges = true;
    } else if (updated.reviewerId && updated.reviewerId !== existing.reviewerId) {
      reviewerIds = [updated.reviewerId];
      hasNonStatusChanges = true;
    } else if (updated.reviewer !== undefined && updated.reviewer !== existing.reviewer) {
      if (updated.reviewer && updated.reviewer !== 'Not designated' && NAME_TO_DEMO_ACTOR_ID[updated.reviewer]) {
        reviewerIds = [NAME_TO_DEMO_ACTOR_ID[updated.reviewer]!];
      } else {
        reviewerIds = [];
      }
      hasNonStatusChanges = true;
    }
    if (updated.due && updated.due !== existing.due) {
      dueAt = parseDisplayDateToIso(updated.due);
      hasNonStatusChanges = true;
    }
    if (updated.deliveryNotes !== undefined && updated.deliveryNotes !== existing.deliveryNotes) {
      deliveryNotes = updated.deliveryNotes;
      hasNonStatusChanges = true;
    }
    if (updated.reviewNotes !== undefined && updated.reviewNotes !== existing.reviewNotes) {
      reviewNotes = updated.reviewNotes;
      hasNonStatusChanges = true;
    }
    if (updated.progress !== undefined && updated.progress !== existing.progress) {
      progressPercent = updated.progress;
      hasNonStatusChanges = true;
    }

    const expectedUpdatedAt = existing.expectedUpdatedAt ?? new Date().toISOString();

    const patch: import('./types').UpdateAssignmentPatch = {
      ...(title !== undefined ? { title } : {}),
      ...(serviceId !== undefined ? { serviceId } : {}),
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(reviewerIds !== undefined ? { reviewerIds } : {}),
      ...(dueAt !== undefined ? { dueAt } : {}),
      ...(deliveryNotes !== undefined ? { deliveryNotes } : {}),
      ...(reviewNotes !== undefined ? { reviewNotes } : {}),
      ...(progressPercent !== undefined ? { progressPercent } : {}),
      expectedUpdatedAt,
    };

    // Pure local edit (e.g. checkbox state without server-persisted changes)
    if (!isStatusChanged && !hasNonStatusChanges) {
      this.assignments = this.assignments.map((a) => (a.id === updated.id ? updated : a));
      this.notify();
      return { success: true, row: updated, localOnly: true };
    }

    const writeGen = this.currentGeneration;
    const writeRole = this.currentRole;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);

    try {
      let latestServerRow: AssignmentRow | undefined = undefined;

      // Sequence 1: Non-status field patch
      if (hasNonStatusChanges) {
        latestServerRow = await this.port.update(writeRole, updated.id, patch, {
          signal: controller.signal,
        });

        if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
          return {
            success: false,
            error: new AssignmentOperationError({
              code: 'aborted',
              message: 'Update discarded due to role switch or disposal.',
            }),
          };
        }
      }

      // Sequence 2: Status transition (using refreshed expectedUpdatedAt if patch was executed)
      if (isStatusChanged) {
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

        const transitionExpectedUpdatedAt = latestServerRow?.expectedUpdatedAt ?? existing.expectedUpdatedAt;

        latestServerRow = await this.port.transition(
          writeRole,
          updated.id,
          transitionAction,
          { signal: controller.signal, expectedUpdatedAt: transitionExpectedUpdatedAt },
        );

        if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
          return {
            success: false,
            error: new AssignmentOperationError({
              code: 'aborted',
              message: 'Transition discarded due to role switch or disposal.',
            }),
          };
        }
      }

      const currentRow = this.assignments.find((a) => a.id === updated.id);
      if (!currentRow || !latestServerRow) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'not_found',
            message: `Assignment with id "${updated.id}" not found.`,
          }),
        };
      }

      const mergedRow = mergeTransitionResult(existing, updated, latestServerRow, currentRow);
      this.assignments = this.assignments.map((a) => (a.id === mergedRow.id ? mergedRow : a));
      this.notify();
      const asgIdentity = formatEntityIdentity(mergedRow);
      this.onToast?.(
        asgIdentity
          ? `Updated ${asgIdentity} (${mergedRow.title})`
          : `Updated "${mergedRow.title}"`,
      );
      return { success: true, row: mergedRow };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Operation discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to update assignment.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to update assignment: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }

  async handlePatchAssignment(
    id: string,
    patch: import('./types').UpdateAssignmentPatch,
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

    const existing = this.assignments.find((a) => a.id === id);
    if (!existing) {
      const err = new AssignmentOperationError({
        code: 'not_found',
        message: `Assignment with id "${id}" not found.`,
      });
      this.onError?.(err);
      return { success: false, error: err };
    }

    const writeGen = this.currentGeneration;
    const writeRole = this.currentRole;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);

    try {
      const serverRow = await this.port.update(writeRole, id, patch, {
        signal: controller.signal,
      });

      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Update discarded due to role switch or disposal.',
          }),
        };
      }

      this.assignments = this.assignments.map((a) => (a.id === id ? { ...a, ...serverRow } : a));
      this.notify();
      const asgIdentity = formatEntityIdentity(serverRow);
      this.onToast?.(
        asgIdentity
          ? `Updated ${asgIdentity} (${serverRow.title})`
          : `Updated "${serverRow.title}"`,
      );
      return { success: true, row: serverRow };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Update discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to update assignment.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to update assignment: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }

  async handleCreateSchedule(
    command: CreateRecurringScheduleCommand,
  ): Promise<{ success: boolean; schedule?: RecurringScheduleRecord; error?: AssignmentOperationError }> {
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
      const serverSchedule = await this.port.createSchedule(writeRole, command, {
        signal: controller.signal,
      });

      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Create schedule operation discarded due to role switch or disposal.',
          }),
        };
      }

      this.schedules = [serverSchedule, ...this.schedules.filter((s) => s.id !== serverSchedule.id)];
      this.notify();
      const schIdentity = formatEntityIdentity(serverSchedule);
      this.onToast?.(
        schIdentity
          ? `Schedule ${schIdentity} (${serverSchedule.title}) created`
          : `Schedule "${serverSchedule.title}" created`,
      );
      return { success: true, schedule: serverSchedule };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Create schedule operation discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to create recurring schedule.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to create schedule: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }

  async handleUpdateSchedule(
    id: string,
    patch: UpdateRecurringSchedulePatch,
  ): Promise<{ success: boolean; schedule?: RecurringScheduleRecord; error?: AssignmentOperationError }> {
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
      const serverSchedule = await this.port.updateSchedule(writeRole, id, patch, {
        signal: controller.signal,
      });

      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Update schedule operation discarded due to role switch or disposal.',
          }),
        };
      }

      this.schedules = this.schedules.map((s) => (s.id === serverSchedule.id ? serverSchedule : s));
      this.notify();
      const schIdentity = formatEntityIdentity(serverSchedule);
      this.onToast?.(
        schIdentity
          ? `Schedule ${schIdentity} updated`
          : `Schedule "${serverSchedule.title}" updated`,
      );
      return { success: true, schedule: serverSchedule };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Update schedule operation discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to update schedule.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to update schedule: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }

  async generateDueAssignments(
    options?: { throughDate?: string },
  ): Promise<{ success: boolean; result?: GenerateDueAssignmentsResult; error?: AssignmentOperationError }> {
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
    this.isGeneratingDue = true;
    this.notify();

    try {
      const result = await this.port.generateDueAssignments(writeRole, {
        signal: controller.signal,
      });

      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Generate due operation discarded due to role switch or disposal.',
          }),
        };
      }

      if (result.generatedCount > 0) {
        this.onToast?.(`Generated ${result.generatedCount} due compliance assignments.`);
      } else {
        this.onToast?.('All compliance assignments are already up to date.');
      }

      await this.sync();
      return { success: true, result };
    } catch (err: unknown) {
      if (this.disposed || writeGen !== this.currentGeneration || writeRole !== this.currentRole) {
        return {
          success: false,
          error: new AssignmentOperationError({
            code: 'aborted',
            message: 'Generate due operation discarded.',
          }),
        };
      }

      const opError =
        err instanceof AssignmentOperationError
          ? err
          : new AssignmentOperationError({
              code: 'unexpected',
              message: err instanceof Error ? err.message : 'Failed to generate due assignments.',
              cause: err,
            });

      if (opError.code !== 'aborted') {
        this.onError?.(opError);
        this.onToast?.(`Failed to generate due assignments: ${opError.message}`);
      }
      return { success: false, error: opError };
    } finally {
      this.isGeneratingDue = false;
      this.activeWriteControllers.delete(controller);
      this.notify();
    }
  }
}
