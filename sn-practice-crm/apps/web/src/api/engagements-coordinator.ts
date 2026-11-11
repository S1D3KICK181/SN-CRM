import type {
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  CreateEngagementDraftInput,
  EndEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from "@sn/contracts";
import type { CompanyRole } from "@sn/domain";
import {
  EngagementOperationError,
  hasEngagementCapability,
  sanitizeEngagementError,
  validateIdempotencyKey,
  type EngagementsPort,
  type EngagementsState,
  type EngagementMutationOptions,
  type EngagementMutationResult,
} from "./engagements-types";

export interface EngagementsCoordinatorOptions {
  port: EngagementsPort;
  initialRole: CompanyRole;
  generateKey?: () => string;
  onError?: (error: EngagementOperationError) => void;
  onToast?: (message: string) => void;
}

export class EngagementsCoordinator {
  private items: EngagementDto[] = [];
  private loading = false;
  private hasLiveSnapshot = false;
  private listError: EngagementOperationError | null = null;
  private selectedEngagementId: string | null = null;
  private selectedDetail: EngagementDto | null = null;
  private selectedVersions: EngagementVersionDto[] = [];
  private detailLoading = false;
  private detailError: EngagementOperationError | null = null;
  private currentRole: CompanyRole;
  private sessionGeneration = 0;
  private listGeneration = 0;
  private detailGeneration = 0;
  private listAbortController: AbortController | null = null;
  private detailAbortController: AbortController | null = null;
  private readonly activeWriteControllers = new Set<AbortController>();
  private disposed = false;
  private readonly port: EngagementsPort;
  private readonly generateKey: () => string;
  private readonly onError?: (error: EngagementOperationError) => void;
  private readonly onToast?: (message: string) => void;
  private readonly listeners = new Set<() => void>();
  constructor(options: EngagementsCoordinatorOptions) {
    this.port = options.port;
    this.currentRole = options.initialRole;
    this.generateKey = options.generateKey ?? (() => crypto.randomUUID());
    this.onError = options.onError;
    this.onToast = options.onToast;
  }
  getState(): EngagementsState {
    return {
      role: this.currentRole,
      items: this.items,
      loading: this.loading,
      hasLiveSnapshot: this.hasLiveSnapshot,
      listError: this.listError,
      selectedEngagementId: this.selectedEngagementId,
      selectedDetail: this.selectedDetail,
      selectedVersions: this.selectedVersions,
      detailLoading: this.detailLoading,
      detailError: this.detailError,
    };
  }
  isDisposed(): boolean {
    return this.disposed;
  }
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
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
      } catch {}
    }
  }
  cancelPending(options: { notify?: boolean } = {}): void {
    this.sessionGeneration++;
    this.listGeneration++;
    this.detailGeneration++;
    this.listAbortController?.abort();
    this.listAbortController = null;
    this.detailAbortController?.abort();
    this.detailAbortController = null;
    for (const controller of this.activeWriteControllers) controller.abort();
    this.activeWriteControllers.clear();
    const was = this.loading || this.detailLoading;
    this.loading = false;
    this.detailLoading = false;
    if ((options.notify ?? true) && was && !this.disposed) this.notify();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending({ notify: false });
    this.listeners.clear();
  }
  async switchRole(role: CompanyRole): Promise<void> {
    if (this.disposed) return;
    if (role !== this.currentRole) {
      this.cancelPending({ notify: false });
      this.currentRole = role;
      this.items = [];
      this.hasLiveSnapshot = false;
      this.listError = null;
      this.selectedEngagementId = null;
      this.selectedDetail = null;
      this.selectedVersions = [];
      this.detailLoading = false;
      this.detailError = null;
      this.notify();
    }
    await this.sync();
  }
  async sync(): Promise<void> {
    if (this.disposed) return;
    this.listAbortController?.abort();
    const generation = ++this.listGeneration;
    const session = this.sessionGeneration;
    const role = this.currentRole;
    const controller = new AbortController();
    this.listAbortController = controller;
    this.loading = true;
    if (!this.hasLiveSnapshot) this.listError = null;
    this.notify();
    try {
      const result = await this.port.list(role, { signal: controller.signal });
      if (
        this.disposed ||
        generation !== this.listGeneration ||
        session !== this.sessionGeneration ||
        role !== this.currentRole
      )
        return;
      this.items = result;
      this.hasLiveSnapshot = true;
      this.loading = false;
      this.listError = null;
      this.notify();
    } catch (error) {
      if (
        this.disposed ||
        generation !== this.listGeneration ||
        session !== this.sessionGeneration ||
        role !== this.currentRole
      )
        return;
      this.loading = false;
      const err = sanitizeEngagementError(error);
      if (err.code === "aborted") return;
      this.listError = err;
      this.onError?.(err);
      if (this.hasLiveSnapshot) this.onToast?.(`Engagement list refresh failed: ${err.message}`);
      this.notify();
    } finally {
      if (this.listAbortController === controller) this.listAbortController = null;
    }
  }
  async selectEngagement(id: string): Promise<void> {
    if (this.disposed) return;
    this.detailAbortController?.abort();
    const generation = ++this.detailGeneration;
    const session = this.sessionGeneration;
    const role = this.currentRole;
    const controller = new AbortController();
    this.detailAbortController = controller;
    this.selectedEngagementId = id;
    this.selectedDetail = null;
    this.selectedVersions = [];
    this.detailLoading = true;
    this.detailError = null;
    this.notify();
    try {
      const [detail, versions] = await Promise.all([
        this.port.get(role, id, { signal: controller.signal }),
        this.port.listVersions(role, id, { signal: controller.signal }),
      ]);
      if (
        this.disposed ||
        generation !== this.detailGeneration ||
        session !== this.sessionGeneration ||
        role !== this.currentRole ||
        this.selectedEngagementId !== id
      )
        return;
      this.selectedDetail = detail;
      this.selectedVersions = versions;
      this.detailLoading = false;
      this.notify();
    } catch (error) {
      if (
        this.disposed ||
        generation !== this.detailGeneration ||
        session !== this.sessionGeneration ||
        role !== this.currentRole ||
        this.selectedEngagementId !== id
      )
        return;
      this.detailLoading = false;
      const err = sanitizeEngagementError(error);
      if (err.code === "aborted") return;
      this.detailError = err;
      this.onError?.(err);
      this.notify();
    } finally {
      if (this.detailAbortController === controller) this.detailAbortController = null;
    }
  }
  clearSelection(): void {
    if (this.disposed) return;
    this.detailGeneration++;
    this.detailAbortController?.abort();
    this.detailAbortController = null;
    const changed = this.selectedEngagementId !== null;
    this.selectedEngagementId = null;
    this.selectedDetail = null;
    this.selectedVersions = [];
    this.detailLoading = false;
    this.detailError = null;
    if (changed) this.notify();
  }
  private key(raw?: string): string | null {
    return validateIdempotencyKey(raw === undefined ? this.generateKey() : raw);
  }
  private merge(item: EngagementDto) {
    this.items = this.items.some((engagement) => engagement.id === item.id)
      ? this.items.map((engagement) => (engagement.id === item.id ? item : engagement))
      : [item, ...this.items];
    if (this.selectedEngagementId === item.id) this.selectedDetail = item;
  }
  private async refreshVersions(
    engagementId: string,
    role: CompanyRole,
    session: number,
    previous: EngagementVersionDto[],
    signal: AbortSignal,
    detailGeneration: number,
  ): Promise<void> {
    try {
      const versions = await this.port.listVersions(role, engagementId, { signal });
      if (
        !this.disposed &&
        session === this.sessionGeneration &&
        role === this.currentRole &&
        this.selectedEngagementId === engagementId &&
        detailGeneration === this.detailGeneration
      ) {
        this.selectedVersions = versions;
        this.detailError = null;
        this.notify();
      }
      return;
    } catch (error) {
      if (
        this.disposed ||
        session !== this.sessionGeneration ||
        role !== this.currentRole ||
        this.selectedEngagementId !== engagementId ||
        detailGeneration !== this.detailGeneration
      )
        return;
      this.selectedVersions = previous;
      const err = sanitizeEngagementError(error);
      if (err.code !== "aborted") {
        this.detailError = err;
        this.onError?.(err);
        this.notify();
      }
      return;
    }
  }
  private mutationStale(session: number, role: CompanyRole): boolean {
    return this.disposed || session !== this.sessionGeneration || role !== this.currentRole;
  }
  private async runMutation(
    config: {
      capability: "createDraft" | "reviseDraft" | "activate" | "amend" | "end";
      engagementId?: string;
      refreshVersions: boolean;
      successMessage: string;
      invoke: (role: CompanyRole, key: string, options: { signal: AbortSignal }) => Promise<EngagementDto>;
    },
    options?: EngagementMutationOptions,
  ): Promise<EngagementMutationResult> {
    if (this.disposed)
      return {
        success: false,
        error: new EngagementOperationError({
          code: "aborted",
          message: "Coordinator is disposed.",
        }),
      };
    const role = this.currentRole;
    if (!hasEngagementCapability(role, config.capability))
      return {
        success: false,
        error: new EngagementOperationError({
          code: "forbidden",
          message: `Role "${role}" cannot perform this engagement operation.`,
        }),
      };
    const key = this.key(options?.idempotencyKey);
    if (!key)
      return {
        success: false,
        error: new EngagementOperationError({
          code: "validation",
          message:
            "Idempotency-Key is required: must be a non-blank string of at most 255 characters.",
        }),
      };
    const session = this.sessionGeneration;
    const detailGeneration = this.detailGeneration;
    const controller = new AbortController();
    this.activeWriteControllers.add(controller);
    const previous = this.selectedVersions;
    try {
      const item = await config.invoke(role, key, { signal: controller.signal });
      if (this.mutationStale(session, role))
        return {
          success: false,
          error: new EngagementOperationError({
            code: "aborted",
            message: "Engagement mutation discarded.",
          }),
        };
      this.listAbortController?.abort();
      this.listAbortController = null;
      this.listGeneration++;
      this.loading = false;
      this.merge(item);
      this.notify();
      if (config.refreshVersions && config.engagementId && this.selectedEngagementId === config.engagementId)
        await this.refreshVersions(config.engagementId, role, session, previous, controller.signal, detailGeneration);
      if (this.mutationStale(session, role))
        return { success: false, error: new EngagementOperationError({ code: "aborted", message: "Engagement mutation discarded." }) };
      this.onToast?.(`Engagement ${config.successMessage}.`);
      return { success: true, item };
    } catch (error) {
      if (this.mutationStale(session, role))
        return {
          success: false,
          error: new EngagementOperationError({
            code: "aborted",
            message: "Engagement mutation discarded.",
          }),
        };
      const err = sanitizeEngagementError(error);
      if (err.code !== "aborted") this.onError?.(err);
      return { success: false, error: err };
    } finally {
      this.activeWriteControllers.delete(controller);
    }
  }
  createDraft(
    input: CreateEngagementDraftInput,
    options?: EngagementMutationOptions,
  ): Promise<EngagementMutationResult> {
    return this.runMutation(
      {
        capability: "createDraft",
        refreshVersions: false,
        successMessage: "draft created",
        invoke: (role, key, invokeOptions) => this.port.createDraft(role, input, key, invokeOptions),
      },
      options,
    );
  }
  reviseDraft(
    engagementId: string,
    input: ReviseEngagementDraftInput,
    options?: EngagementMutationOptions,
  ): Promise<EngagementMutationResult> {
    return this.runMutation(
      {
        capability: "reviseDraft",
        engagementId,
        refreshVersions: true,
        successMessage: "draft revised",
        invoke: (role, key, invokeOptions) => this.port.reviseDraft(role, engagementId, input, key, invokeOptions),
      },
      options,
    );
  }
  activate(
    engagementId: string,
    input: ActivateEngagementInput,
    options?: EngagementMutationOptions,
  ): Promise<EngagementMutationResult> {
    return this.runMutation(
      {
        capability: "activate",
        engagementId,
        refreshVersions: true,
        successMessage: "activated",
        invoke: (role, key, invokeOptions) => this.port.activate(role, engagementId, input, key, invokeOptions),
      },
      options,
    );
  }
  amend(
    engagementId: string,
    input: AmendActiveEngagementInput,
    options?: EngagementMutationOptions,
  ): Promise<EngagementMutationResult> {
    return this.runMutation(
      {
        capability: "amend",
        engagementId,
        refreshVersions: true,
        successMessage: "amended",
        invoke: (role, key, invokeOptions) => this.port.amend(role, engagementId, input, key, invokeOptions),
      },
      options,
    );
  }
  end(
    engagementId: string,
    input: EndEngagementInput,
    options?: EngagementMutationOptions,
  ): Promise<EngagementMutationResult> {
    return this.runMutation(
      {
        capability: "end",
        engagementId,
        refreshVersions: false,
        successMessage: "ended",
        invoke: (role, key, invokeOptions) => this.port.end(role, engagementId, input, key, invokeOptions),
      },
      options,
    );
  }
}
