import { authorize, type Actor, type AuthorityRequest, type CompanyRole } from '@sn/domain';
import {
  DOCUMENT_ALLOWED_TYPES,
  DOCUMENT_MAX_BYTES,
} from '@sn/contracts';
import type {
  AssignmentDto,
  AssignmentStatus,
  AssignmentTransition,
  ClientContactDto,
  ClientDocumentDto,
  ClientDto,
  CreateAssignmentInput,
  CreateClientContactInput,
  CreateClientInput,
  CreateDocumentInput,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  CreateServiceInput,
  CreateWorkItemInput,
  ActivateEngagementInput,
  AmendActiveEngagementInput,
  ApplyCreditInput,
  CreateEngagementDraftInput,
  EndEngagementInput,
  ReviseEngagementDraftInput,
  EngagementDto,
  EngagementVersionDto,
  GenerateDueAssignmentsInput,
  GenerateDueAssignmentsResult,
  InvoiceDto,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  PaymentReceiptDto,
  RecordPaymentInput,
  RecordVyaparBillInput,
  RecurringScheduleDto,
  RemoveDocumentInput,
  ReportingLineDto,
  ServiceCatalogItemDto,
  ServiceDto,
  SessionActor,
  UpdateAssignmentInput,
  UpdateClientContactInput,
  UpdateClientInput,
  UpdateRecurringScheduleInput,
  UpdateServiceInput,
  VoidFeeRecordInput,
  WorkItemDto,
  WorkItemStatus,
  WorkItemTransition,
} from '@sn/contracts';
import { ApiError, forbidden, notFound } from './errors';
import type {
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmApplicationDependencies,
  EmployeeRecord,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentCommand,
} from './repository';
import { fileTooLarge, fileTypeNotAllowed, kolkataToday } from './repository';
import {
  CONTACT_UNREACHABLE_MESSAGE,
  createClientContactSchema,
  createClientSchema,
  createDocumentSchema,
  entityUuid,
  parseIsoInstant,
  updateClientContactSchema,
  removeDocumentSchema,
  updateClientSchema,
  validateInput,
} from './schemas';

export interface ApplicationOptions {
  now?: () => Date;
  createId?: (prefix?: string) => string;
}

function isLeadership(role: CompanyRole): boolean {
  return role === 'founder' || role === 'manager';
}

function asActor(employee: SessionActor): Actor {
  return { id: employee.id, role: employee.role };
}

function asSession(employee: EmployeeRecord): SessionActor {
  const { active: _active, ...session } = employee;
  return session;
}

function requireAuthority(request: AuthorityRequest): void {
  const decision = authorize(request);
  if (!decision.allowed) {
    throw forbidden(decision.code, decision.reason);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function invalidTransition(message: string): never {
  throw new ApiError(409, 'invalid_state_transition', message);
}

function normalizeIdempotencyKey(value: string): string {
  return value.trim();
}

/** A blank description means "no description"; undefined means "leave unchanged". */
function normalizeServiceDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Drops undefined values so an omitted field means "leave unchanged" and the idempotency hash is stable. */
function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export type CreateWorkItemServiceInput = CreateWorkItemInput extends infer T
  ? T extends { kind: string }
    ? Omit<T, 'reminderAt'> & { reminderAt?: string | null }
    : never
  : never;

export class CrmApplication {
  private readonly now: () => Date;
  private readonly createId: (prefix?: string) => string;

  constructor(
    private readonly repository: CrmApplicationDependencies,
    options: ApplicationOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async listDemoActors(): Promise<SessionActor[]> {
    const employees = await this.repository.listDevActors();
    return employees
      .filter((employee) => employee.active)
      .map(asSession)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listInvoices(actor: SessionActor): Promise<InvoiceDto[]> {
    requireAuthority({ action: 'billing.read', actor: asActor(actor) });
    return this.repository.listInvoices({ actorId: actor.id });
  }

  async listPaymentReceipts(actor: SessionActor): Promise<PaymentReceiptDto[]> {
    requireAuthority({ action: 'billing.read', actor: asActor(actor) });
    return this.repository.listPaymentReceipts({ actorId: actor.id });
  }

  // --- Vyapar bills and payments (FEE-01a) ---
  // Authority first, then the date rules that depend on today's date. Rules that depend on stored state
  // (duplicate number, open bill, balance, void state) run in the repository, after the idempotency
  // lookup, so a replay returns the stored result.

  async recordVyaparBill(
    actor: SessionActor,
    input: RecordVyaparBillInput,
    idempotencyKey: string,
  ): Promise<InvoiceDto> {
    requireAuthority({ action: 'billing.record_bill', actor: asActor(actor) });
    if (input.billDate > kolkataToday(this.now())) {
      throw new ApiError(422, 'validation_failed', 'The bill date cannot be in the future.');
    }
    if (input.dueDate < input.billDate) {
      throw new ApiError(422, 'validation_failed', 'The due date cannot be before the bill date.');
    }
    return this.repository.recordVyaparBill(
      { actorId: actor.id },
      {
        clientId: input.clientId,
        vyaparBillNumber: input.vyaparBillNumber.trim(),
        billDate: input.billDate,
        dueDate: input.dueDate,
        amountPaise: input.amountPaise,
        description: input.description.trim(),
        applyCredit: input.applyCredit === true,
        idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      },
    );
  }

  async recordPayment(
    actor: SessionActor,
    input: RecordPaymentInput,
    idempotencyKey: string,
  ): Promise<PaymentReceiptDto> {
    requireAuthority({ action: 'billing.record_payment', actor: asActor(actor) });
    if (input.receivedOn > kolkataToday(this.now())) {
      throw new ApiError(422, 'validation_failed', 'The payment date cannot be in the future.');
    }
    return this.repository.recordPayment(
      { actorId: actor.id },
      {
        invoiceId: input.invoiceId,
        receivedOn: input.receivedOn,
        amountPaise: input.amountPaise,
        method: input.method,
        reference: input.reference?.trim() || null,
        notes: input.notes?.trim() || null,
        idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      },
    );
  }

  async voidInvoice(
    actor: SessionActor,
    invoiceId: string,
    input: VoidFeeRecordInput,
    idempotencyKey: string,
  ): Promise<InvoiceDto> {
    requireAuthority({ action: 'billing.void', actor: asActor(actor) });
    return this.repository.voidInvoice(
      { actorId: actor.id },
      { id: invoiceId, reason: input.reason.trim(), idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  async voidPaymentReceipt(
    actor: SessionActor,
    receiptId: string,
    input: VoidFeeRecordInput,
    idempotencyKey: string,
  ): Promise<PaymentReceiptDto> {
    requireAuthority({ action: 'billing.void', actor: asActor(actor) });
    return this.repository.voidPaymentReceipt(
      { actorId: actor.id },
      { id: receiptId, reason: input.reason.trim(), idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  // --- Client documents (DOC-01a) ---
  // Who may see or upload is decided in Postgres by "looks after the client"; a reader who does not
  // look after a client sees no documents and cannot add one. Only removal needs an authority rule.

  async listDocuments(actor: SessionActor, clientId?: string): Promise<ClientDocumentDto[]> {
    if (clientId !== undefined) {
      validateInput(entityUuid, clientId);
    }
    return this.repository.listClientDocuments({ actorId: actor.id }, clientId);
  }

  async createDocument(
    actor: SessionActor,
    input: CreateDocumentInput,
    idempotencyKey: string,
  ): Promise<ClientDocumentDto> {
    const data = validateInput(createDocumentSchema, input);
    if (data.sizeBytes > DOCUMENT_MAX_BYTES) {
      throw fileTooLarge();
    }
    const extension = data.fileName.includes('.') ? data.fileName.split('.').pop()?.toLowerCase() : undefined;
    const allowedExtensions: readonly string[] | undefined = Object.hasOwn(DOCUMENT_ALLOWED_TYPES, data.mimeType)
      ? DOCUMENT_ALLOWED_TYPES[data.mimeType as keyof typeof DOCUMENT_ALLOWED_TYPES]
      : undefined;
    if (!allowedExtensions || extension === undefined || !allowedExtensions.includes(extension)) {
      throw fileTypeNotAllowed();
    }
    return this.repository.createClientDocument(
      { actorId: actor.id },
      { ...definedOnly(data), idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  async confirmDocument(actor: SessionActor, documentId: string, idempotencyKey: string): Promise<ClientDocumentDto> {
    return this.repository.confirmClientDocument(
      { actorId: actor.id },
      { id: documentId, idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  async removeDocument(
    actor: SessionActor,
    documentId: string,
    input: RemoveDocumentInput,
    idempotencyKey: string,
  ): Promise<ClientDocumentDto> {
    requireAuthority({ action: 'document.remove', actor: asActor(actor) });
    const data = validateInput(removeDocumentSchema, input);
    return this.repository.removeClientDocument(
      { actorId: actor.id },
      { id: documentId, reason: data.reason, idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  // --- Client credit (FEE-02a) ---

  async applyCredit(
    actor: SessionActor,
    invoiceId: string,
    _input: ApplyCreditInput,
    idempotencyKey: string,
  ): Promise<InvoiceDto> {
    requireAuthority({ action: 'billing.record_payment', actor: asActor(actor) });
    return this.repository.applyCredit(
      { actorId: actor.id },
      { invoiceId, idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  async removeCreditAllocation(
    actor: SessionActor,
    allocationId: string,
    _input: ApplyCreditInput,
    idempotencyKey: string,
  ): Promise<InvoiceDto> {
    requireAuthority({ action: 'billing.void', actor: asActor(actor) });
    return this.repository.removeCreditAllocation(
      { actorId: actor.id },
      { allocationId, idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  async listEngagements(actor: SessionActor): Promise<EngagementDto[]> {
    requireAuthority({ action: 'engagement.read', actor: asActor(actor) });
    return this.repository.listEngagements({ actorId: actor.id });
  }

  async getEngagement(actor: SessionActor, engagementId: string): Promise<EngagementDto> {
    requireAuthority({ action: 'engagement.read', actor: asActor(actor) });
    const engagement = await this.repository.getEngagement({ actorId: actor.id }, engagementId);
    if (!engagement) throw notFound('Engagement');
    return engagement;
  }

  async listEngagementVersions(actor: SessionActor, engagementId: string): Promise<EngagementVersionDto[]> {
    requireAuthority({ action: 'engagement.read', actor: asActor(actor) });
    const ctx = { actorId: actor.id };
    if (!(await this.repository.getEngagement(ctx, engagementId))) throw notFound('Engagement');
    return this.repository.listEngagementVersions(ctx, engagementId);
  }

  private async mutateEngagement(
    actor: SessionActor,
    action:
      | 'engagement.create_draft'
      | 'engagement.revise_draft'
      | 'engagement.activate'
      | 'engagement.amend_active'
      | 'engagement.end',
    command: Parameters<CrmApplicationDependencies['mutateEngagement']>[1],
  ): Promise<EngagementDto> {
    requireAuthority({ action, actor: asActor(actor) });
    return this.repository.mutateEngagement(
      { actorId: actor.id },
      { ...command, idempotencyKey: normalizeIdempotencyKey(command.idempotencyKey) },
    );
  }

  createEngagementDraft(
    actor: SessionActor,
    input: CreateEngagementDraftInput,
    idempotencyKey: string,
  ) {
    return this.mutateEngagement(actor, 'engagement.create_draft', {
      kind: 'createDraft', idempotencyKey, ...input,
    });
  }

  reviseEngagementDraft(
    actor: SessionActor,
    engagementId: string,
    body: Omit<ReviseEngagementDraftInput, 'engagementId'>,
    idempotencyKey: string,
  ) {
    return this.mutateEngagement(actor, 'engagement.revise_draft', {
      kind: 'reviseDraft', idempotencyKey, engagementId, ...body,
    });
  }

  activateEngagement(
    actor: SessionActor,
    engagementId: string,
    body: Omit<ActivateEngagementInput, 'engagementId'>,
    idempotencyKey: string,
  ) {
    return this.mutateEngagement(actor, 'engagement.activate', {
      kind: 'activate', idempotencyKey, engagementId, ...body,
    });
  }

  amendEngagement(
    actor: SessionActor,
    engagementId: string,
    body: Omit<AmendActiveEngagementInput, 'engagementId'>,
    idempotencyKey: string,
  ) {
    return this.mutateEngagement(actor, 'engagement.amend_active', {
      kind: 'amend', idempotencyKey, engagementId, ...body,
    });
  }

  endEngagement(
    actor: SessionActor,
    engagementId: string,
    body: Omit<EndEngagementInput, 'engagementId'>,
    idempotencyKey: string,
  ) {
    return this.mutateEngagement(actor, 'engagement.end', {
      kind: 'end', idempotencyKey, engagementId, ...body,
    });
  }

  async requireActor(id: string | undefined): Promise<SessionActor> {
    if (!id) {
      throw new ApiError(401, 'demo_session_required', 'Choose a demo user and send its id in the x-demo-user-id header.');
    }

    const employee = await this.repository.resolveDevActor(id);
    if (!employee?.active) {
      throw new ApiError(401, 'invalid_demo_session', 'The selected demo user does not exist or is inactive.');
    }
    return asSession(employee);
  }

  // --- Clients (Read-Only) ---

  async listClients(actor: SessionActor): Promise<ClientDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'client.read', actor: asActor(actor) });
    return await this.repository.listClients(ctx);
  }

  async getClient(actor: SessionActor, clientId: string): Promise<ClientDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'client.read', actor: asActor(actor) });
    const client = await this.repository.getClient(ctx, clientId);
    if (!client) {
      throw notFound('Client');
    }
    return client;
  }

  assertClientCreateAuthority(actor: SessionActor): void {
    requireAuthority({ action: 'client.create', actor: asActor(actor) });
  }

  async createClient(actor: SessionActor, input: CreateClientInput): Promise<ClientDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    this.assertClientCreateAuthority(actor);
    const data = validateInput(createClientSchema, input);

    let relationshipOwnerId: string | null = null;
    if (data.relationshipOwnerId) {
      relationshipOwnerId = await this.requireValidRelationshipOwner(ctx, data.relationshipOwnerId);
    }

    const timestamp = this.now().toISOString();
    const record: CreateClientRecord = {
      id: this.createId('cli'),
      displayName: data.displayName,
      legalName: data.legalName ?? null,
      pan: data.pan ?? null,
      gstin: data.gstin ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      relationshipOwnerId,
      notes: data.notes ?? null,
      entityType: data.entityType ?? null,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      pincode: data.pincode ?? null,
      tan: data.tan ?? null,
      cinLlpin: data.cinLlpin ?? null,
      udyamNumber: data.udyamNumber ?? null,
      iec: data.iec ?? null,
      incorporationDate: data.incorporationDate ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.createClient(ctx, record);
  }

  private async requireValidRelationshipOwner(ctx: RepositoryContext, ownerId: string): Promise<string> {
    const owner = await this.repository.getEmployee(ctx, ownerId);
    if (!owner) {
      throw notFound('Employee');
    }
    if (!owner.active || owner.role === 'trainee') {
      throw new ApiError(
        422,
        'validation_failed',
        'A Client relationship owner must be active and cannot be a Trainee.',
      );
    }
    return owner.id;
  }

  // --- Client master (CLI-02a) ---

  // The client must be visible to the actor (otherwise it does not exist for them), and the actor
  // must be allowed to edit it: Founder, Manager, or its relationship owner.
  private async requireEditableClient(actor: SessionActor, clientId: string): Promise<ClientDto> {
    const client = await this.repository.getClient({ actorId: actor.id }, clientId);
    if (!client) {
      throw notFound('Client');
    }
    requireAuthority({
      action: 'client.update',
      actor: asActor(actor),
      isRelationshipOwner: client.relationshipOwnerId === actor.id,
    });
    return client;
  }

  async updateClient(
    actor: SessionActor,
    clientId: string,
    input: UpdateClientInput,
    idempotencyKey: string,
  ): Promise<ClientDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const current = await this.requireEditableClient(actor, clientId);
    const data = validateInput(updateClientSchema, input);

    const changesOwner =
      data.relationshipOwnerId !== undefined && data.relationshipOwnerId !== current.relationshipOwnerId;
    const changesStatus = data.status !== undefined && data.status !== current.status;
    if (changesOwner || changesStatus) {
      requireAuthority({ action: 'client.change_owner_or_status', actor: asActor(actor) });
    }
    if (changesOwner && data.relationshipOwnerId) {
      await this.requireValidRelationshipOwner(ctx, data.relationshipOwnerId);
    }

    // An editor always looks after the client, so the stored PAN and GSTIN are visible here.
    if (data.pan !== undefined || data.gstin !== undefined) {
      const pan = data.pan !== undefined ? data.pan : current.pan;
      const gstin = data.gstin !== undefined ? data.gstin : current.gstin;
      if (pan && gstin && gstin.slice(2, 12) !== pan) {
        throw new ApiError(422, 'validation_failed', 'The GSTIN does not match the PAN.');
      }
    }

    return this.repository.updateClient(ctx, {
      ...definedOnly(data),
      id: clientId,
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
    });
  }

  async createClientContact(
    actor: SessionActor,
    clientId: string,
    input: CreateClientContactInput,
    idempotencyKey: string,
  ): Promise<ClientContactDto> {
    await this.requireEditableClient(actor, clientId);
    const data = validateInput(createClientContactSchema, input);
    return this.repository.createClientContact(
      { actorId: actor.id },
      { ...definedOnly(data), clientId, idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  private async requireEditableContact(
    actor: SessionActor,
    contactId: string,
  ): Promise<{ client: ClientDto; contact: ClientContactDto }> {
    const clientId = await this.repository.getClientIdForContact({ actorId: actor.id }, contactId);
    if (!clientId) {
      throw notFound('Contact');
    }
    const client = await this.requireEditableClient(actor, clientId);
    const contact = client.contacts.find((candidate) => candidate.id === contactId);
    if (!contact) {
      throw notFound('Contact');
    }
    return { client, contact };
  }

  async updateClientContact(
    actor: SessionActor,
    contactId: string,
    input: UpdateClientContactInput,
    idempotencyKey: string,
  ): Promise<ClientContactDto> {
    const { contact } = await this.requireEditableContact(actor, contactId);
    const data = validateInput(updateClientContactSchema, input);

    const email = data.email !== undefined ? data.email : contact.email;
    const phone = data.phone !== undefined ? data.phone : contact.phone;
    const whatsapp = data.whatsapp !== undefined ? data.whatsapp : contact.whatsapp;
    if (!email && !phone && !whatsapp) {
      throw new ApiError(422, 'validation_failed', CONTACT_UNREACHABLE_MESSAGE);
    }

    return this.repository.updateClientContact(
      { actorId: actor.id },
      { ...definedOnly(data), id: contactId, idempotencyKey: normalizeIdempotencyKey(idempotencyKey) },
    );
  }

  async deleteClientContact(actor: SessionActor, contactId: string): Promise<void> {
    await this.requireEditableContact(actor, contactId);
    await this.repository.deleteClientContact({ actorId: actor.id }, contactId);
  }

  async listServices(actor: SessionActor): Promise<readonly ServiceCatalogItemDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    return await this.repository.listServiceReferences(ctx);
  }

  // --- Service list management (SVC-01) ---

  async listServiceCatalog(actor: SessionActor): Promise<ServiceDto[]> {
    requireAuthority({ action: 'service.manage', actor: asActor(actor) });
    return this.repository.listServiceCatalog({ actorId: actor.id });
  }

  async createService(
    actor: SessionActor,
    input: CreateServiceInput,
    idempotencyKey: string,
  ): Promise<ServiceDto> {
    requireAuthority({ action: 'service.manage', actor: asActor(actor) });
    return this.repository.createService(
      { actorId: actor.id },
      {
        name: input.name.trim(),
        description: normalizeServiceDescription(input.description) ?? null,
        turnaroundDays: input.turnaroundDays ?? null,
        isStatutory: input.isStatutory === true,
        idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      },
    );
  }

  async updateService(
    actor: SessionActor,
    serviceId: string,
    input: UpdateServiceInput,
    idempotencyKey: string,
  ): Promise<ServiceDto> {
    requireAuthority({ action: 'service.manage', actor: asActor(actor) });
    const description = normalizeServiceDescription(input.description);
    return this.repository.updateService(
      { actorId: actor.id },
      {
        id: serviceId,
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(input.turnaroundDays !== undefined ? { turnaroundDays: input.turnaroundDays } : {}),
        ...(input.isStatutory !== undefined ? { isStatutory: input.isStatutory } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        expectedUpdatedAt: input.expectedUpdatedAt,
        idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      },
    );
  }

  async listAssignments(actor: SessionActor): Promise<AssignmentDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const [assignments, workItems] = await Promise.all([
      this.repository.listAssignments(ctx),
      this.repository.listWorkItems(ctx),
    ]);

    const involvedAssignmentIds = new Set(
      workItems
        .filter((item) => item.assignmentId && (item.assigneeId === actor.id || item.createdById === actor.id))
        .map((item) => item.assignmentId as string),
    );

    return assignments
      .filter(
        (assignment) =>
          isLeadership(actor.role) ||
          assignment.ownerId === actor.id ||
          assignment.reviewerIds.includes(actor.id) ||
          involvedAssignmentIds.has(assignment.id),
      )
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async createAssignment(actor: SessionActor, input: CreateAssignmentInput): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'assignment.create', actor: asActor(actor) });

    const client = await this.repository.getClientReference(ctx, input.clientId);
    if (!client) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced client does not exist.');
    }

    let serviceRef: ServiceReference | null = null;
    if (input.serviceId) {
      serviceRef = await this.repository.getServiceReferenceById(ctx, input.serviceId);
    } else if (input.service) {
      serviceRef = await this.repository.getServiceReferenceByName(ctx, input.service);
    }
    if (!serviceRef) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced service does not exist.');
    }

    const owner = await this.getActiveEmployee(ctx, input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });

    const engagementId = await this.resolveEngagementLink(ctx, input.engagementId, client.id, 'Assignment');

    const reviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds ?? []);
    const timestamp = this.now().toISOString();

    const record: CreateAssignmentRecord = {
      id: this.createId('asg'),
      clientId: client.id,
      clientName: client.name,
      serviceId: serviceRef.id,
      service: serviceRef.name,
      title: input.title,
      description: input.description ?? null,
      ownerId: owner.id,
      reviewerIds,
      status: 'assigned',
      dueAt: input.dueAt,
      recurringScheduleId: input.recurringScheduleId ?? null,
      engagementId,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      priority: input.priority ?? 'normal',
      createdById: actor.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.createAssignment(ctx, record);
  }

  async transitionAssignment(
    actor: SessionActor,
    assignmentId: string,
    transition: AssignmentTransition,
    options?: {
      expectedUpdatedAt?: string;
      deliveryNotes?: string | null;
      reviewNotes?: string | null;
      progressPercent?: number;
    },
  ): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const assignment = await this.getAssignment(ctx, assignmentId);

    const normalizedAction = transition === 'reopen' ? 'request_changes' : transition;

    if (assignment.status === 'approved' || assignment.status === 'closed') {
      throw new ApiError(
        409,
        'invalid_state_transition',
        'An approved Assignment is a terminal immutable audit artifact and cannot be reopened.',
      );
    }

    let nextStatus: AssignmentStatus;
    switch (normalizedAction) {
      case 'start': {
        requireAuthority({
          action: 'assignment.progress',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (assignment.status !== 'assigned' && assignment.status !== 'changes_requested') {
          invalidTransition(`Cannot start assignment in status ${assignment.status}.`);
        }
        nextStatus = 'in_progress';
        break;
      }
      case 'submit': {
        requireAuthority({
          action: 'assignment.submit',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (
          assignment.status !== 'assigned' &&
          assignment.status !== 'in_progress' &&
          assignment.status !== 'changes_requested'
        ) {
          invalidTransition(`Cannot submit assignment in status ${assignment.status}.`);
        }
        nextStatus = 'ready_for_review';
        break;
      }
      case 'complete': {
        requireAuthority({ action: 'assignment.approve', actor: asActor(actor) });
        if (assignment.status !== 'ready_for_review') {
          invalidTransition('An Assignment must be ready for review before leadership completes it.');
        }
        nextStatus = 'approved';
        break;
      }
      case 'request_changes': {
        requireAuthority({
          action: 'assignment.request_changes',
          actor: asActor(actor),
          assignmentOwnerId: assignment.ownerId,
          reviewerIds: assignment.reviewerIds,
        });
        if (assignment.status !== 'ready_for_review' && assignment.status !== 'in_progress') {
          invalidTransition('Only a submitted or in-progress Assignment can have changes requested.');
        }
        nextStatus = 'changes_requested';
        break;
      }
      default:
        invalidTransition(`Unsupported transition action: ${transition}`);
    }

    const expectedUpdatedAt = options?.expectedUpdatedAt ?? assignment.updatedAt;

    return await this.repository.updateAssignmentStatus(ctx, {
      id: assignment.id,
      status: nextStatus,
      expectedUpdatedAt,
      deliveryNotes: options?.deliveryNotes,
      reviewNotes: options?.reviewNotes,
      progressPercent: options?.progressPercent,
    });
  }

  async updateAssignment(
    actor: SessionActor,
    assignmentId: string,
    input: UpdateAssignmentInput,
  ): Promise<AssignmentDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const assignment = await this.getAssignment(ctx, assignmentId);

    const isModifyingLeadershipFields =
      input.title !== undefined ||
      input.description !== undefined ||
      input.serviceId !== undefined ||
      input.ownerId !== undefined ||
      input.reviewerIds !== undefined ||
      input.dueAt !== undefined;

    if (isModifyingLeadershipFields) {
      if (!isLeadership(actor.role)) {
        throw forbidden('role_not_permitted', 'Only Founder and Manager may modify assignment configuration, ownership, or review gates.');
      }
    }

    // Any core mutation is locked once assignment is approved or closed
    if (assignment.status === 'approved' || assignment.status === 'closed') {
      const hasCoreMutation =
        input.title !== undefined ||
        input.description !== undefined ||
        input.serviceId !== undefined ||
        input.ownerId !== undefined ||
        input.reviewerIds !== undefined ||
        input.dueAt !== undefined ||
        input.deliveryNotes !== undefined ||
        input.reviewNotes !== undefined ||
        input.progressPercent !== undefined;

      if (hasCoreMutation) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          'An approved or closed Assignment is an immutable audit artifact.',
        );
      }
    }

    if (!input.expectedUpdatedAt) {
      throw new ApiError(
        409,
        'concurrency_conflict',
        'expectedUpdatedAt is required for optimistic concurrency verification.',
      );
    }

    // If updating delivery notes or progress percent as non-leadership, must be owner or reviewer
    if (input.deliveryNotes !== undefined || input.progressPercent !== undefined) {
      requireAuthority({
        action: 'assignment.progress',
        actor: asActor(actor),
        assignmentOwnerId: assignment.ownerId,
        reviewerIds: assignment.reviewerIds,
      });
    }

    let serviceName = assignment.service;
    // Only a change of service is checked: an assignment keeps its service even after that service is deactivated.
    if (input.serviceId !== undefined && input.serviceId !== assignment.serviceId) {
      const serviceRef = await this.repository.getServiceReferenceById(ctx, input.serviceId);
      if (!serviceRef) {
        throw new ApiError(422, 'referenced_entity_not_found', 'Referenced service does not exist in catalog.');
      }
      serviceName = serviceRef.name;
    }

    let targetOwnerId: string | undefined = undefined;
    if (input.ownerId !== undefined) {
      const owner = await this.getActiveEmployee(ctx, input.ownerId);
      if (owner.role === 'trainee') {
        throw new ApiError(
          422,
          'trainee_cannot_own_assignment',
          'A Trainee receives Work Items, not primary ownership of an Assignment.',
        );
      }
      requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });
      targetOwnerId = owner.id;
    }

    let targetReviewerIds: string[] | undefined = undefined;
    if (input.reviewerIds !== undefined) {
      targetReviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds);
    }

    const command: UpdateAssignmentCommand = {
      id: assignment.id,
      title: input.title,
      description: input.description,
      serviceId: input.serviceId,
      service: serviceName,
      ownerId: targetOwnerId,
      reviewerIds: targetReviewerIds,
      dueAt: input.dueAt,
      deliveryNotes: input.deliveryNotes,
      reviewNotes: input.reviewNotes,
      progressPercent: input.progressPercent,
      expectedUpdatedAt: input.expectedUpdatedAt,
      actorId: actor.id,
    };

    return await this.repository.updateAssignment(ctx, command);
  }

  async listRecurringSchedules(actor: SessionActor): Promise<RecurringScheduleDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const schedules = await this.repository.listRecurringSchedules(ctx);
    return schedules
      .filter(
        (schedule) =>
          isLeadership(actor.role) || schedule.ownerId === actor.id || schedule.reviewerIds.includes(actor.id),
      )
      .sort((left, right) => left.nextOccurrenceOn.localeCompare(right.nextOccurrenceOn));
  }

  async createRecurringSchedule(
    actor: SessionActor,
    input: CreateRecurringScheduleInput,
  ): Promise<RecurringScheduleDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });

    const client = await this.repository.getClientReference(ctx, input.clientId);
    if (!client) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced client does not exist.');
    }

    let serviceRef: ServiceReference | null = null;
    if (input.serviceId) {
      serviceRef = await this.repository.getServiceReferenceById(ctx, input.serviceId);
    } else if (input.service) {
      serviceRef = await this.repository.getServiceReferenceByName(ctx, input.service);
    }
    if (!serviceRef) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced service does not exist in catalog.');
    }
    const serviceId = serviceRef.id;
    const service = serviceRef.name;

    const owner = await this.getActiveEmployee(ctx, input.ownerId);
    requireAuthority({ action: 'assignment.assign', actor: asActor(actor), target: owner });

    const engagementId = await this.resolveEngagementLink(ctx, input.engagementId, client.id, 'Recurring Schedule');

    const reviewerIds = await this.validateReviewerIds(ctx, input.reviewerIds ?? []);

    return await this.repository.createRecurringSchedule(ctx, {
      ...input,
      engagementId,
      id: this.createId('sch'),
      createdById: actor.id,
      clientName: client.name,
      serviceId,
      service,
      reviewerIds,
    });
  }

  async updateRecurringSchedule(
    actor: SessionActor,
    scheduleId: string,
    patch: { active?: boolean; nextOccurrenceOn?: string },
  ): Promise<RecurringScheduleDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    if (patch.active === true) {
      const schedule = await this.repository.getRecurringSchedule(ctx, scheduleId);
      if (!schedule) throw notFound('Recurring schedule');
      if (schedule.engagementId) {
        const engagement = await this.repository.getEngagement(ctx, schedule.engagementId);
        if (engagement?.status !== 'active') {
          throw new ApiError(
            422,
            'engagement_not_active',
            "This schedule's engagement has ended, so the schedule cannot be restarted.",
          );
        }
      }
    }
    return await this.repository.updateRecurringSchedule(ctx, scheduleId, patch);
  }

  async generateDueAssignments(
    actor: SessionActor,
    input?: GenerateDueAssignmentsInput,
  ): Promise<GenerateDueAssignmentsResult> {
    const ctx: RepositoryContext = { actorId: actor.id };
    requireAuthority({ action: 'schedule.manage', actor: asActor(actor) });
    const throughDate = input?.throughDate ?? this.now().toISOString().slice(0, 10);
    return await this.repository.materializeDueAssignments(ctx, throughDate);
  }

  async listWorkItems(actor: SessionActor): Promise<WorkItemDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const [items, assignments] = await Promise.all([
      this.repository.listWorkItems(ctx),
      this.repository.listAssignments(ctx),
    ]);
    const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));

    return items
      .filter((item) => {
        if (item.kind === 'personal') return item.assigneeId === actor.id;
        if (isLeadership(actor.role) || item.assigneeId === actor.id || item.createdById === actor.id) return true;
        const assignment = item.assignmentId ? assignmentsById.get(item.assignmentId) : undefined;
        return assignment?.ownerId === actor.id || assignment?.reviewerIds.includes(actor.id) || false;
      })
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async createWorkItem(
    actor: SessionActor,
    input: CreateWorkItemServiceInput,
  ): Promise<WorkItemDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const dueTime = parseIsoInstant(input.dueAt);
    let assignmentId: string | null = null;
    let relatedClientId: string | null = null;
    let relatedPartyName: string | null = null;
    let assigneeId: string;

    if (input.kind === 'delegated') {
      const [assignment, assignee] = await Promise.all([
        this.getAssignment(ctx, input.assignmentId),
        this.getActiveEmployee(ctx, input.assigneeId),
      ]);
      requireAuthority({
        action: 'task.delegate',
        actor: asActor(actor),
        target: assignee,
        assignmentOwnerId: assignment.ownerId,
        reviewerIds: assignment.reviewerIds,
      });
      const assignmentDueTime = parseIsoInstant(assignment.dueAt);
      if (dueTime > assignmentDueTime) {
        throw new ApiError(422, 'task_due_after_assignment', 'Delegated work must be due no later than its parent Assignment.');
      }
      assignmentId = assignment.id;
      relatedClientId = assignment.clientId;
      relatedPartyName = assignment.clientName;
      assigneeId = assignee.id;
    } else if (input.kind === 'internal') {
      const assignee = await this.getActiveEmployee(ctx, input.assigneeId);
      requireAuthority({ action: 'task.create_internal', actor: asActor(actor), target: assignee });
      assigneeId = assignee.id;
    } else {
      requireAuthority({ action: 'task.create_personal', actor: asActor(actor), ownerId: actor.id });
      assigneeId = actor.id;
      relatedClientId = input.relatedClientId ?? null;
      relatedPartyName = input.relatedPartyName ?? null;
    }

    let reminderAt: string | null = null;
    if (input.reminderAt !== undefined && input.reminderAt !== null) {
      const reminderTime = parseIsoInstant(input.reminderAt);
      if (reminderTime > dueTime) {
        throw new ApiError(422, 'reminder_after_due_time', 'A reminder must occur on or before the task due time.');
      }
      reminderAt = input.reminderAt;
    }

    const timestamp = this.now().toISOString();
    const record: CreateWorkItemRecord = {
      id: this.createId('wrk'),
      kind: input.kind,
      title: input.title,
      notes: input.notes ?? null,
      assignmentId,
      relatedClientId,
      relatedPartyName,
      assigneeId,
      createdById: actor.id,
      status: 'todo',
      dueAt: input.dueAt,
      reminderAt,
      priority: input.priority ?? 'normal',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return await this.repository.createWorkItem(ctx, record);
  }

  async transitionWorkItem(
    actor: SessionActor,
    workItemId: string,
    transition: WorkItemTransition,
    options?: {
      expectedUpdatedAt?: string;
      notes?: string;
      completionNote?: string;
      progressPercent?: number;
    },
  ): Promise<WorkItemDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const item = await this.repository.getWorkItem(ctx, workItemId);
    if (!item) throw notFound('Work Item');
    const actorIsAssignee = item.assigneeId === actor.id;
    const actorCanReview = isLeadership(actor.role) || item.createdById === actor.id;

    const normalizedAction = transition === 'reopen' ? 'request_changes' : transition;

    if (item.status === 'completed') {
      throw new ApiError(
        409,
        'invalid_state_transition',
        'A completed Work Item is a terminal immutable audit artifact and cannot be reopened.',
      );
    }

    let nextStatus: WorkItemStatus;
    switch (normalizedAction) {
      case 'start': {
        if (!actorIsAssignee && !isLeadership(actor.role)) {
          throw forbidden('not_work_item_assignee', 'Only the assignee or practice leadership may start this Work Item.');
        }
        if (item.status !== 'todo' && item.status !== 'changes_requested') {
          invalidTransition('Only a queued or changes_requested Work Item can be started.');
        }
        nextStatus = 'in_progress';
        break;
      }
      case 'submit': {
        if (item.kind === 'personal') invalidTransition('Personal Tasks are completed directly and do not require review.');
        if (!actorIsAssignee) {
          throw forbidden('not_work_item_assignee', 'Only the assignee may submit this Work Item for review.');
        }
        if (item.status !== 'todo' && item.status !== 'in_progress' && item.status !== 'changes_requested') {
          invalidTransition('Only a queued, in-progress, or changes_requested Work Item can be submitted.');
        }
        nextStatus = 'ready_for_review';
        break;
      }
      case 'complete': {
        if (item.kind === 'personal') {
          if (!actorIsAssignee) {
            throw forbidden('not_work_item_owner', 'Only the owner may complete a Personal Task.');
          }
          if (item.status !== 'todo' && item.status !== 'in_progress') {
            invalidTransition('Only a queued or in-progress Personal Task can be completed.');
          }
        } else {
          if (!actorCanReview) {
            throw forbidden('not_work_item_reviewer', 'Only its delegator or practice leadership may approve this Work Item.');
          }
          if (item.status !== 'ready_for_review') {
            invalidTransition('A delegated or internal Work Item must be submitted before it is completed.');
          }
        }
        nextStatus = 'completed';
        break;
      }
      case 'request_changes': {
        if (item.kind === 'personal' ? !actorIsAssignee : !actorCanReview) {
          throw forbidden('not_work_item_reviewer', 'You do not have authority to request changes on this Work Item.');
        }
        if (item.status !== 'ready_for_review') {
          invalidTransition('Only a submitted Work Item can be requested for changes.');
        }
        nextStatus = 'changes_requested';
        break;
      }
      default:
        invalidTransition(`Unsupported transition action: ${transition}`);
    }

    return await this.repository.updateWorkItemStatus(ctx, {
      id: item.id,
      status: nextStatus,
      expectedUpdatedAt: options?.expectedUpdatedAt,
      notes: options?.notes,
      completionNote: options?.completionNote,
      progressPercent: options?.progressPercent,
    });
  }

  async listReportingLines(actor: SessionActor): Promise<ReportingLineDto[]> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const employees = (await this.repository.listEmployees(ctx)).filter((employee) => employee.active);
    const byId = new Map(employees.map((employee) => [employee.id, employee]));
    return employees
      .map((employee) => ({
        employee: asSession(employee),
        manager: employee.reportsToId ? asSession(byId.get(employee.reportsToId)!) : null,
      }))
      .sort((left, right) => left.employee.name.localeCompare(right.employee.name));
  }

  async updateReportingLine(
    actor: SessionActor,
    employeeId: string,
    managerId: string | null,
  ): Promise<ReportingLineDto> {
    const ctx: RepositoryContext = { actorId: actor.id };
    const subject = await this.getActiveEmployee(ctx, employeeId);
    const manager = managerId ? await this.getActiveEmployee(ctx, managerId) : null;
    requireAuthority({
      action: 'team.manage_reporting',
      actor: asActor(actor),
      subject,
      proposedManager: manager,
    });

    return await this.repository.updateReportingLine(ctx, employeeId, manager?.id ?? null);
  }

  async getOfficeAccountsSummary(actor: SessionActor): Promise<OfficeAccountsSummaryDto> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    return await this.repository.getOfficeAccountsSummary(ctx);
  }

  async listLedgerEntries(actor: SessionActor): Promise<LedgerEntryDto[]> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    const entries = await this.repository.listLedgerEntries(ctx);
    return entries.sort(
      (left, right) => right.occurredOn.localeCompare(left.occurredOn) || right.createdAt.localeCompare(left.createdAt),
    );
  }

  async createLedgerEntry(actor: SessionActor, input: CreateLedgerEntryInput): Promise<LedgerEntryDto> {
    this.requireFinanceAuthority(actor);
    const ctx: RepositoryContext = { actorId: actor.id };
    return await this.repository.createLedgerEntry(ctx, {
      ...input,
      id: this.createId('led'),
      recordedById: actor.id,
    });
  }

  private requireFinanceAuthority(actor: SessionActor): void {
    requireAuthority({ action: 'finance.manage', actor: asActor(actor) });
  }

  private async getActiveEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord> {
    const employee = await this.repository.getEmployee(ctx, id);
    if (!employee?.active) throw notFound('Employee');
    return employee;
  }

  private async getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto> {
    const assignment = await this.repository.getAssignment(ctx, id);
    if (!assignment) throw notFound('Assignment');
    return assignment;
  }

  // Shared by Assignment and Recurring Schedule creation: the engagement must exist, belong to the
  // same client and be active. Returns the engagement id to store, or null when no link was asked for.
  private async resolveEngagementLink(
    ctx: RepositoryContext,
    engagementId: string | null | undefined,
    clientId: string,
    subjectLabel: 'Assignment' | 'Recurring Schedule',
  ): Promise<string | null> {
    if (!engagementId) return null;
    const engagement = await this.repository.getEngagement(ctx, engagementId);
    if (!engagement) {
      throw new ApiError(422, 'referenced_entity_not_found', 'Referenced engagement does not exist.');
    }
    if (engagement.clientId !== clientId) {
      throw new ApiError(
        422,
        'engagement_client_mismatch',
        `The engagement belongs to a different client than the ${subjectLabel}.`,
      );
    }
    if (engagement.status !== 'active') {
      throw new ApiError(
        422,
        'engagement_not_active',
        `${subjectLabel === 'Assignment' ? 'An Assignment' : 'A Recurring Schedule'} can only be linked to an active engagement.`,
      );
    }
    return engagement.id;
  }

  private async validateReviewerIds(ctx: RepositoryContext, ids: readonly string[]): Promise<string[]> {
    const reviewerIds = unique(ids);
    const reviewers = await Promise.all(reviewerIds.map((id) => this.getActiveEmployee(ctx, id)));
    const eligibleRoles = new Set(['founder', 'manager', 'senior_staff']);
    const ineligible = reviewers.find((r) => !eligibleRoles.has(r.role));
    if (ineligible) {
      throw new ApiError(
        422,
        'invalid_assignment_reviewer',
        'Only Founder, Manager, or Senior Staff may be assigned as reviewers.',
      );
    }
    return reviewerIds;
  }
}
