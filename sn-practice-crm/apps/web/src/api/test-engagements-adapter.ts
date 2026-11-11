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
import type { PortExecutionOptions } from "./types";
import {
  EngagementOperationError,
  hasEngagementCapability,
  validateIdempotencyKey,
  type EngagementsPort,
} from "./engagements-types";

interface Receipt {
  operation: string;
  payload: string;
  result: EngagementDto;
}
const OWNER_ID = "00000000-0000-4000-a000-000000000001";
const EPOCH = Date.parse("2027-01-01T00:00:00.000Z");
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

export class TestEngagementsAdapter implements EngagementsPort {
  private engagements = new Map<string, EngagementDto>();
  private versions = new Map<string, EngagementVersionDto[]>();
  private receipts = new Map<string, Receipt>();
  private nextCode = 1;
  private nextId = 1;
  private clockTick = 0;

  seed(items: EngagementDto[], seededVersions?: Map<string, EngagementVersionDto[]>): this {
    this.engagements.clear();
    this.versions.clear();
    this.receipts.clear();
    this.nextCode = 1;
    this.nextId = 1;
    this.clockTick = 0;
    for (const item of items) {
      this.engagements.set(item.id, item);
      this.versions.set(item.id, []);
      this.nextCode = Math.max(this.nextCode, Number(item.code.match(/(\d+)$/)?.[1] ?? 0) + 1);
      this.nextId = Math.max(this.nextId, Number.parseInt(item.id.slice(-12), 16) + 1);
    }
    for (const [id, versions] of seededVersions ?? []) {
      this.versions.set(id, versions);
      for (const version of versions)
        this.nextId = Math.max(this.nextId, Number.parseInt(version.id.slice(-12), 16) + 1);
    }
    return this;
  }
  getAll(): EngagementDto[] {
    return [...this.engagements.values()];
  }
  private abort(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted)
      throw new EngagementOperationError({
        code: "aborted",
        message: "The engagement operation was cancelled.",
        requestId: options.requestId,
      });
  }
  private capability(
    role: CompanyRole,
    capability: Parameters<typeof hasEngagementCapability>[1],
    options?: PortExecutionOptions,
  ): void {
    if (!hasEngagementCapability(role, capability))
      throw new EngagementOperationError({
        code: "forbidden",
        message: `Role "${role}" does not have "${capability}" capability on engagements.`,
        requestId: options?.requestId,
      });
  }
  private key(raw: string, options?: PortExecutionOptions): string {
    const key = validateIdempotencyKey(raw);
    if (!key)
      throw new EngagementOperationError({
        code: "validation",
        message: "Idempotency-Key is required.",
        requestId: options?.requestId,
      });
    return key;
  }
  private now(): string {
    return new Date(EPOCH + this.clockTick++ * 1000).toISOString();
  }
  private id(): string {
    let id = "";
    do {
      const numericId = this.nextId++;
      id = `00000000-0000-4000-8000-${numericId.toString(16).padStart(12, "0")}`;
    } while (
      this.engagements.has(id) ||
      [...this.versions.values()].some((versions) => versions.some((version) => version.id === id))
    );
    return id;
  }
  private receipt(
    role: CompanyRole,
    key: string,
    operation: string,
    payload: unknown,
  ): EngagementDto | null {
    const old = this.receipts.get(`${role}:${key}`);
    if (!old) return null;
    if (old.operation !== operation || old.payload !== stable(payload))
      throw new EngagementOperationError({
        code: "conflict",
        message: "Idempotency key was reused for a different operation.",
      });
    return old.result;
  }
  private save(
    role: CompanyRole,
    key: string,
    operation: string,
    payload: unknown,
    result: EngagementDto,
  ): EngagementDto {
    this.receipts.set(`${role}:${key}`, { operation, payload: stable(payload), result });
    return result;
  }
  private version(
    id: string,
    input: CreateEngagementDraftInput | ReviseEngagementDraftInput | AmendActiveEngagementInput,
    approved: boolean,
  ): EngagementVersionDto {
    const createdAt = this.now();
    return {
      id: this.id(),
      engagementId: id,
      versionNumber: (this.versions.get(id)?.length ?? 0) + 1,
      title: input.title,
      scope: input.scope,
      exclusions: input.exclusions ?? null,
      responsiblePartnerId: input.responsiblePartnerId,
      deliveryManagerId: input.deliveryManagerId,
      feeModel: input.feeModel,
      agreedFeePaise: input.agreedFeePaise,
      billingTerms: input.billingTerms,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      approvedAt: approved ? createdAt : null,
      approvedById: approved ? OWNER_ID : null,
      createdById: OWNER_ID,
      createdAt,
    };
  }
  private check(
    item: EngagementDto | undefined,
    input: { expectedUpdatedAt: string },
    status: EngagementDto["status"],
  ): EngagementDto {
    if (!item) throw new EngagementOperationError({ code: "not_found", message: "Not found" });
    if (item.status !== status || item.updatedAt !== input.expectedUpdatedAt)
      throw new EngagementOperationError({
        code: "conflict",
        message: "Engagement was modified concurrently.",
      });
    return item;
  }
  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<EngagementDto[]> {
    this.abort(options);
    this.capability(role, "read", options);
    await Promise.resolve();
    this.abort(options);
    return this.getAll();
  }
  async get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<EngagementDto> {
    this.abort(options);
    this.capability(role, "read", options);
    const item = this.engagements.get(id);
    if (!item) throw new EngagementOperationError({ code: "not_found", message: "Not found" });
    await Promise.resolve();
    this.abort(options);
    return item;
  }
  async listVersions(
    role: CompanyRole,
    id: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementVersionDto[]> {
    this.abort(options);
    this.capability(role, "read", options);
    if (!this.engagements.has(id))
      throw new EngagementOperationError({ code: "not_found", message: "Not found" });
    await Promise.resolve();
    this.abort(options);
    return this.versions.get(id) ?? [];
  }
  async createDraft(
    role: CompanyRole,
    input: CreateEngagementDraftInput,
    rawKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    this.abort(options);
    this.capability(role, "createDraft", options);
    const key = this.key(rawKey, options);
    const replay = this.receipt(role, key, "createDraft", input);
    if (replay) return replay;
    await Promise.resolve();
    this.abort(options);
    const now = this.now();
    const id = this.id();
    const item: EngagementDto = {
      id,
      code: `ENG-${String(this.nextCode++).padStart(6, "0")}`,
      clientId: input.clientId,
      serviceId: input.serviceId,
      status: "draft",
      approvedVersionId: null,
      approvedVersion: null,
      approvedAt: null,
      approvedById: null,
      endedAt: null,
      endedById: null,
      endOutcome: null,
      endReason: null,
      createdById: OWNER_ID,
      createdAt: now,
      updatedAt: now,
    };
    this.engagements.set(id, item);
    this.versions.set(id, [this.version(id, input, false)]);
    return this.save(role, key, "createDraft", input, item);
  }
  async reviseDraft(
    role: CompanyRole,
    id: string,
    input: ReviseEngagementDraftInput,
    rawKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    return this.revise(role, id, input, rawKey, options);
  }
  private async revise(
    role: CompanyRole,
    id: string,
    input: ReviseEngagementDraftInput,
    rawKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    this.abort(options);
    this.capability(role, "reviseDraft", options);
    const key = this.key(rawKey, options);
    const payload = { id, input };
    const replay = this.receipt(role, key, "reviseDraft", payload);
    if (replay) return replay;
    const old = this.check(this.engagements.get(id), input, "draft");
    await Promise.resolve();
    this.abort(options);
    const item = { ...old, updatedAt: this.now() };
    this.engagements.set(id, item);
    this.versions.set(id, [...(this.versions.get(id) ?? []), this.version(id, input, false)]);
    return this.save(role, key, "reviseDraft", payload, item);
  }
  async activate(
    role: CompanyRole,
    id: string,
    input: ActivateEngagementInput,
    rawKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    this.abort(options);
    this.capability(role, "activate", options);
    const key = this.key(rawKey, options);
    const payload = { id, input };
    const replay = this.receipt(role, key, "activate", payload);
    if (replay) return replay;
    const old = this.check(this.engagements.get(id), input, "draft");
    const version = (this.versions.get(id) ?? []).find((entry) => entry.id === input.versionId);
    if (!version)
      throw new EngagementOperationError({ code: "validation", message: "Version not found" });
    await Promise.resolve();
    this.abort(options);
    const now = this.now();
    const approved = { ...version, approvedAt: now, approvedById: OWNER_ID };
    const item: EngagementDto = {
      ...old,
      status: "active",
      approvedVersionId: version.id,
      approvedVersion: approved,
      approvedAt: now,
      approvedById: OWNER_ID,
      updatedAt: now,
    };
    this.versions.set(
      id,
      (this.versions.get(id) ?? []).map((entry) => (entry.id === version.id ? approved : entry)),
    );
    this.engagements.set(id, item);
    return this.save(role, key, "activate", payload, item);
  }
  async amend(
    role: CompanyRole,
    id: string,
    input: AmendActiveEngagementInput,
    rawKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    this.abort(options);
    this.capability(role, "amend", options);
    const key = this.key(rawKey, options);
    const payload = { id, input };
    const replay = this.receipt(role, key, "amend", payload);
    if (replay) return replay;
    const old = this.check(this.engagements.get(id), input, "active");
    await Promise.resolve();
    this.abort(options);
    const version = this.version(id, input, true);
    const item: EngagementDto = {
      ...old,
      approvedVersionId: version.id,
      approvedVersion: version,
      approvedAt: version.approvedAt,
      approvedById: OWNER_ID,
      updatedAt: version.createdAt,
    };
    this.versions.set(id, [...(this.versions.get(id) ?? []), version]);
    this.engagements.set(id, item);
    return this.save(role, key, "amend", payload, item);
  }
  async end(
    role: CompanyRole,
    id: string,
    input: EndEngagementInput,
    rawKey: string,
    options?: PortExecutionOptions,
  ): Promise<EngagementDto> {
    this.abort(options);
    this.capability(role, "end", options);
    const key = this.key(rawKey, options);
    const payload = { id, input };
    const replay = this.receipt(role, key, "end", payload);
    if (replay) return replay;
    const old = this.check(this.engagements.get(id), input, "active");
    await Promise.resolve();
    this.abort(options);
    const now = this.now();
    const item: EngagementDto = {
      ...old,
      status: "ended",
      endedAt: now,
      endedById: OWNER_ID,
      endOutcome: input.outcome,
      endReason: input.reason,
      updatedAt: now,
    };
    this.engagements.set(id, item);
    return this.save(role, key, "end", payload, item);
  }
}
