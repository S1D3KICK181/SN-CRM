import type postgres from 'postgres';
import { DOCUMENT_MAX_BYTES } from '@sn/contracts';
import type {
  AssignmentDto,
  ClientContactDto,
  ClientDocumentDto,
  ClientDto,
  ClientEntityType,
  ClientMessageDto,
  ClientStatus,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  EngagementDto,
  EngagementVersionDto,
  GenerateDueAssignmentsResult,
  InvoiceDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
  PaymentAllocationDto,
  PaymentReceiptDto,
  RecurringScheduleDto,
  ReportingLineDto,
  ServiceDto,
  UpdateRecurringScheduleInput,
  WorkItemDto,
} from '@sn/contracts';
import { DEV_ACTOR_ALIASES } from './auth';
import { PostgresTransactionRunner, type SqlClient } from './db';
import { ApiError, notFound } from './errors';
import { isProductionEnvironment } from './http';
import { computeRequestHash } from './idempotency';
import type {
  ApplyCreditCommand,
  ClientReference,
  ConfirmDocumentCommand,
  CreateAssignmentRecord,
  CreateClientContactCommand,
  CreateClientRecord,
  CreateDocumentCommand,
  CreateServiceCommand,
  CreateWorkItemRecord,
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
  MutateEngagementCommand,
  RecordClientMessageCommand,
  RecordPaymentCommand,
  RecordVyaparBillCommand,
  RemoveCreditAllocationCommand,
  RemoveDocumentCommand,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentCommand,
  UpdateAssignmentReviewersCommand,
  UpdateAssignmentStatusCommand,
  UpdateClientCommand,
  UpdateClientContactCommand,
  UpdateServiceCommand,
  UpdateWorkItemStatusCommand,
  VoidFeeRecordCommand,
} from './repository';
import {
  alreadyRemoved,
  alreadyVoided,
  billHasPayments,
  billNotOpen,
  contactNotOfClient,
  documentNotConfirmable,
  documentNotRemovable,
  documentStoragePath,
  duplicateService,
  duplicateVyaparBill,
  fileTooLarge,
  financialYearStart,
  linkedWorkNotOfClient,
  noCreditAvailable,
  notCreditAllocation,
  staleClient,
  staleContact,
  staleService,
  uploadMissing,
} from './repository';

function sanitizeDatabaseError(error: unknown): never {
  if (error instanceof ApiError) throw error;

  const pgErr = error as { code?: string; message?: string };
  if (pgErr?.code) {
    if (pgErr.code === '42501') {
      throw new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
    }
    if (pgErr.code === '23514') {
      const msg = pgErr.message ?? '';
      if (msg.includes('check constraint') || msg.includes('violates check constraint')) {
        throw new ApiError(422, 'validation_failed', 'Request failed database validation constraints.');
      }
      throw new ApiError(422, 'validation_failed', msg || 'Business rule validation failed.');
    }
    if (pgErr.code === '23502') {
      throw new ApiError(422, 'validation_failed', 'Request failed database validation constraints.');
    }
    if (pgErr.code === '23503') {
      throw new ApiError(422, 'referenced_entity_not_found', 'The referenced entity does not exist.');
    }
    if (pgErr.code === '23505') {
      throw new ApiError(409, 'conflict', 'A record with this identifier already exists.');
    }
    if (pgErr.code === '08000' || pgErr.code === 'ECONNREFUSED') {
      throw new ApiError(503, 'database_unavailable', 'Database service is temporarily unavailable.');
    }
  }

  throw error;
}

function toIsoString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  return new Date(String(val)).toISOString();
}

function toSafePaise(val: unknown, label: string): number {
  const n = Number(val);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${label} is not a safe integer amount in paise.`);
  }
  return n;
}

function asRecord(val: unknown): Record<string, unknown> {
  return val !== null && typeof val === 'object' ? (val as Record<string, unknown>) : {};
}

function asRecordArray(val: unknown): Record<string, unknown>[] {
  return Array.isArray(val) ? val.map(asRecord) : [];
}

function nullableText(val: unknown): string | null {
  return val !== null && val !== undefined ? String(val) : null;
}

function mapContactRow(row: Record<string, unknown>): ClientContactDto {
  return {
    id: String(row['id']),
    name: String(row['name']),
    designation: nullableText(row['designation']),
    email: nullableText(row['email']),
    phone: nullableText(row['phone']),
    whatsapp: nullableText(row['whatsapp']),
    isPrimary: Boolean(row['is_primary']),
    notes: nullableText(row['notes']),
    updatedAt: toIsoString(row['updated_at']),
  };
}

// The raw pan and gstin columns are not readable by the authenticated role. The masked values and,
// for readers who look after the client, the full values come from client_identifiers().
function mapClientRow(row: Record<string, unknown>, contacts: readonly ClientContactDto[]): ClientDto {
  return {
    id: String(row['id']),
    code: String(row['code']),
    displayName: String(row['display_name']),
    legalName: row['legal_name'] ? String(row['legal_name']) : null,
    gstinMasked: nullableText(row['gstin_masked']),
    panMasked: nullableText(row['pan_masked']),
    pan: nullableText(row['pan_full']),
    gstin: nullableText(row['gstin_full']),
    email: row['email'] ? String(row['email']) : null,
    phone: row['phone'] ? String(row['phone']) : null,
    relationshipOwnerId: row['relationship_owner_id'] ? String(row['relationship_owner_id']) : null,
    relationshipOwnerName: row['relationship_owner_name'] ? String(row['relationship_owner_name']) : null,
    status: String(row['status']) as ClientStatus,
    notes: row['notes'] ? String(row['notes']) : null,
    entityType: nullableText(row['entity_type']) as ClientEntityType | null,
    addressLine1: nullableText(row['address_line1']),
    addressLine2: nullableText(row['address_line2']),
    city: nullableText(row['city']),
    state: nullableText(row['state']),
    pincode: nullableText(row['pincode']),
    tan: nullableText(row['tan']),
    cinLlpin: nullableText(row['cin_llpin']),
    udyamNumber: nullableText(row['udyam_number']),
    iec: nullableText(row['iec']),
    incorporationDate: nullableText(row['incorporation_date']),
    contacts,
    canEdit: row['can_edit'] === true,
    canChangeOwnerOrStatus: row['can_change_owner_or_status'] === true,
    activeAssignmentsCount: Number(row['active_assignments_count'] ?? 0),
    createdById: String(row['created_by']),
    createdAt: toIsoString(row['created_at']),
    updatedAt: toIsoString(row['updated_at']),
  };
}

export class PostgresCrmRepository implements CrmRepository, DevActorDirectory {
  private readonly runner: PostgresTransactionRunner;

  constructor(private readonly sql: SqlClient) {
    this.runner = new PostgresTransactionRunner(sql);
  }

  async close(): Promise<void> {
    if ('end' in this.sql && typeof this.sql.end === 'function') {
      await this.sql.end();
    }
  }

  // --- Clients ---

  private async queryContactDtos(tx: SqlClient, clientIds: readonly string[]): Promise<Map<string, ClientContactDto[]>> {
    const byClient = new Map<string, ClientContactDto[]>();
    if (clientIds.length === 0) return byClient;
    const rows = await tx`
      SELECT id, client_id, name, designation, email, phone, whatsapp, is_primary, notes, updated_at
      FROM public.client_contacts
      WHERE client_id = ANY(${clientIds as string[]}::uuid[])
      ORDER BY is_primary DESC, lower(name) ASC, name ASC, id ASC;
    `;
    for (const row of rows) {
      const clientId = String(row['client_id']);
      const list = byClient.get(clientId) ?? [];
      list.push(mapContactRow(row));
      byClient.set(clientId, list);
    }
    return byClient;
  }

  private async queryClientDtos(tx: SqlClient, clientId?: string): Promise<ClientDto[]> {
    const whereClause = clientId ? tx`WHERE c.id = ${clientId}::uuid` : tx``;
    const rows = await tx`
      SELECT
        c.id,
        c.code,
        c.display_name,
        c.legal_name,
        ci.gstin_masked,
        ci.pan_masked,
        ci.gstin AS gstin_full,
        ci.pan AS pan_full,
        c.email,
        c.phone,
        c.relationship_owner_id,
        p.full_name AS relationship_owner_name,
        c.status,
        c.notes,
        c.entity_type,
        c.address_line1,
        c.address_line2,
        c.city,
        c.state,
        c.pincode,
        c.tan,
        c.cin_llpin,
        c.udyam_number,
        c.iec,
        c.incorporation_date::text AS incorporation_date,
        c.created_by,
        c.created_at,
        c.updated_at,
        public.can_edit_client(c.id) AS can_edit,
        public.is_management() AS can_change_owner_or_status,
        coalesce(
          (
            SELECT count(*)::int
            FROM public.assignments a
            WHERE a.client_id = c.id
              AND a.status NOT IN ('closed', 'cancelled')
          ),
          0
        ) AS active_assignments_count
      FROM public.clients c
      LEFT JOIN public.profiles p ON p.user_id = c.relationship_owner_id
      LEFT JOIN LATERAL public.client_identifiers(c.id) ci ON true
      ${whereClause}
      ORDER BY c.code ASC;
    `;
    const contacts = await this.queryContactDtos(
      tx,
      rows.map((row) => String(row['id'])),
    );
    return rows.map((row) => mapClientRow(row, contacts.get(String(row['id'])) ?? []));
  }

  async getClient(ctx: RepositoryContext, clientId: string): Promise<ClientDto | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const dtos = await this.queryClientDtos(tx, clientId);
        return dtos[0] ?? null;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listClients(ctx: RepositoryContext): Promise<ClientDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        return await this.queryClientDtos(tx);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async createClient(ctx: RepositoryContext, record: CreateClientRecord): Promise<ClientDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        // Live write: omit code to use client_code_seq default, omit is_demo to default false
        await tx`
          INSERT INTO public.clients (
            id, display_name, legal_name, gstin, pan, email, phone,
            relationship_owner_id, notes, status, created_by,
            entity_type, address_line1, address_line2, city, state, pincode,
            tan, cin_llpin, udyam_number, iec, incorporation_date
          ) VALUES (
            ${record.id}::uuid,
            ${record.displayName},
            ${record.legalName ?? null},
            ${record.gstin ?? null},
            ${record.pan ?? null},
            ${record.email ?? null},
            ${record.phone ?? null},
            ${record.relationshipOwnerId ? record.relationshipOwnerId : null}::uuid,
            ${record.notes ?? null},
            'active'::public.client_status,
            ${ctx.actorId}::uuid,
            ${record.entityType ?? null}::text,
            ${record.addressLine1 ?? null}::text,
            ${record.addressLine2 ?? null}::text,
            ${record.city ?? null}::text,
            ${record.state ?? null}::text,
            ${record.pincode ?? null}::text,
            ${record.tan ?? null}::text,
            ${record.cinLlpin ?? null}::text,
            ${record.udyamNumber ?? null}::text,
            ${record.iec ?? null}::text,
            ${record.incorporationDate ?? null}::date
          );
        `;

        const dtos = await this.queryClientDtos(tx, record.id);
        const created = dtos[0];
        if (!created) {
          throw new ApiError(500, 'internal_error', 'Created client could not be retrieved.');
        }
        return created;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Client master (CLI-02a) ---

  private forbiddenOperation(): ApiError {
    return new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
  }

  // The receipt keeps only the client id: a replay re-reads the client for the reader, so a stored
  // result never carries a full PAN or GSTIN.
  async updateClient(ctx: RepositoryContext, command: UpdateClientCommand): Promise<ClientDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const { id } = await this.runIdempotent<{ id: string }>(
          tx,
          ctx,
          idempotencyKey,
          'updateClient',
          payload,
          async () => {
            const visibleRows = await tx`
              SELECT public.can_edit_client(c.id) AS can_edit
              FROM public.clients c
              WHERE c.id = ${command.id}::uuid;
            `;
            const visible = visibleRows[0];
            if (!visible) throw notFound('Client');
            if (visible['can_edit'] !== true) throw this.forbiddenOperation();

            const currentRows = await tx`
              SELECT
                is_demo,
                date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz) AS fresh
              FROM public.clients
              WHERE id = ${command.id}::uuid
              FOR UPDATE;
            `;
            const current = currentRows[0];
            if (!current) throw notFound('Client');
            if (current['fresh'] !== true) throw staleClient();

            const has = (value: unknown): boolean => value !== undefined;
            await tx`
              UPDATE public.clients
              SET ${has(command.pan) ? tx`pan = ${command.pan ?? null}::text,` : tx``}
                  ${has(command.gstin) ? tx`gstin = ${command.gstin ?? null}::text,` : tx``}
                  display_name = CASE WHEN ${has(command.displayName)}::boolean THEN ${command.displayName ?? ''}::text ELSE display_name END,
                  legal_name = CASE WHEN ${has(command.legalName)}::boolean THEN ${command.legalName ?? null}::text ELSE legal_name END,
                  email = CASE WHEN ${has(command.email)}::boolean THEN ${command.email ?? null}::text ELSE email END,
                  phone = CASE WHEN ${has(command.phone)}::boolean THEN ${command.phone ?? null}::text ELSE phone END,
                  relationship_owner_id = CASE WHEN ${has(command.relationshipOwnerId)}::boolean THEN ${command.relationshipOwnerId ?? null}::uuid ELSE relationship_owner_id END,
                  status = CASE WHEN ${has(command.status)}::boolean THEN ${command.status ?? 'active'}::public.client_status ELSE status END,
                  notes = CASE WHEN ${has(command.notes)}::boolean THEN ${command.notes ?? null}::text ELSE notes END,
                  entity_type = CASE WHEN ${has(command.entityType)}::boolean THEN ${command.entityType ?? null}::text ELSE entity_type END,
                  address_line1 = CASE WHEN ${has(command.addressLine1)}::boolean THEN ${command.addressLine1 ?? null}::text ELSE address_line1 END,
                  address_line2 = CASE WHEN ${has(command.addressLine2)}::boolean THEN ${command.addressLine2 ?? null}::text ELSE address_line2 END,
                  city = CASE WHEN ${has(command.city)}::boolean THEN ${command.city ?? null}::text ELSE city END,
                  state = CASE WHEN ${has(command.state)}::boolean THEN ${command.state ?? null}::text ELSE state END,
                  pincode = CASE WHEN ${has(command.pincode)}::boolean THEN ${command.pincode ?? null}::text ELSE pincode END,
                  tan = CASE WHEN ${has(command.tan)}::boolean THEN ${command.tan ?? null}::text ELSE tan END,
                  cin_llpin = CASE WHEN ${has(command.cinLlpin)}::boolean THEN ${command.cinLlpin ?? null}::text ELSE cin_llpin END,
                  udyam_number = CASE WHEN ${has(command.udyamNumber)}::boolean THEN ${command.udyamNumber ?? null}::text ELSE udyam_number END,
                  iec = CASE WHEN ${has(command.iec)}::boolean THEN ${command.iec ?? null}::text ELSE iec END,
                  incorporation_date = CASE WHEN ${has(command.incorporationDate)}::boolean THEN ${command.incorporationDate ?? null}::date ELSE incorporation_date END
              WHERE id = ${command.id}::uuid;
            `;
            return { result: { id: command.id }, isDemo: Boolean(current['is_demo']) };
          },
        );
        const updated = (await this.queryClientDtos(tx, id))[0];
        if (!updated) {
          throw new ApiError(500, 'internal_error', 'Updated client could not be retrieved.');
        }
        return updated;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async getClientIdForContact(ctx: RepositoryContext, contactId: string): Promise<string | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT client_id FROM public.client_contacts WHERE id = ${contactId}::uuid;
        `;
        const row = rows[0];
        return row ? String(row['client_id']) : null;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  private async fetchContactDto(tx: SqlClient, contactId: string): Promise<ClientContactDto> {
    const rows = await tx`
      SELECT id, name, designation, email, phone, whatsapp, is_primary, notes, updated_at
      FROM public.client_contacts
      WHERE id = ${contactId}::uuid;
    `;
    const row = rows[0];
    if (!row) throw new ApiError(500, 'internal_error', 'The contact could not be retrieved.');
    return mapContactRow(row);
  }

  // Checks the client is visible and editable by the actor, then takes its row lock so that
  // changing which contact is primary cannot race with another change to the same client.
  private async lockEditableClient(tx: SqlClient, clientId: string): Promise<boolean> {
    const rows = await tx`
      SELECT is_demo, public.can_edit_client(id) AS can_edit
      FROM public.clients
      WHERE id = ${clientId}::uuid;
    `;
    const client = rows[0];
    if (!client) throw notFound('Client');
    if (client['can_edit'] !== true) throw this.forbiddenOperation();
    await tx`SELECT 1 FROM public.clients WHERE id = ${clientId}::uuid FOR UPDATE;`;
    return Boolean(client['is_demo']);
  }

  async createClientContact(ctx: RepositoryContext, command: CreateClientContactCommand): Promise<ClientContactDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const { id } = await this.runIdempotent<{ id: string }>(
          tx,
          ctx,
          idempotencyKey,
          'createClientContact',
          payload,
          async () => {
            const isDemo = await this.lockEditableClient(tx, command.clientId);
            if (command.isPrimary === true) {
              await tx`
                UPDATE public.client_contacts SET is_primary = false
                WHERE client_id = ${command.clientId}::uuid AND is_primary;
              `;
            }
            const contactId = crypto.randomUUID();
            // is_demo is inherited from the client by the contact's insert trigger
            await tx`
              INSERT INTO public.client_contacts (
                id, client_id, name, designation, email, phone, whatsapp, is_primary, notes, created_by
              ) VALUES (
                ${contactId}::uuid,
                ${command.clientId}::uuid,
                ${command.name},
                ${command.designation ?? null}::text,
                ${command.email ?? null}::text,
                ${command.phone ?? null}::text,
                ${command.whatsapp ?? null}::text,
                ${command.isPrimary === true},
                ${command.notes ?? null}::text,
                ${ctx.actorId}::uuid
              );
            `;
            return { result: { id: contactId }, isDemo };
          },
        );
        return await this.fetchContactDto(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateClientContact(ctx: RepositoryContext, command: UpdateClientContactCommand): Promise<ClientContactDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const { id } = await this.runIdempotent<{ id: string }>(
          tx,
          ctx,
          idempotencyKey,
          'updateClientContact',
          payload,
          async () => {
            const ownerRows = await tx`
              SELECT client_id FROM public.client_contacts WHERE id = ${command.id}::uuid;
            `;
            const owner = ownerRows[0];
            if (!owner) throw notFound('Contact');
            const clientId = String(owner['client_id']);
            const isDemo = await this.lockEditableClient(tx, clientId);

            const currentRows = await tx`
              SELECT
                date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz) AS fresh
              FROM public.client_contacts
              WHERE id = ${command.id}::uuid
              FOR UPDATE;
            `;
            const current = currentRows[0];
            if (!current) throw notFound('Contact');
            if (current['fresh'] !== true) throw staleContact();

            if (command.isPrimary === true) {
              await tx`
                UPDATE public.client_contacts SET is_primary = false
                WHERE client_id = ${clientId}::uuid AND is_primary AND id <> ${command.id}::uuid;
              `;
            }
            const has = (value: unknown): boolean => value !== undefined;
            await tx`
              UPDATE public.client_contacts
              SET name = CASE WHEN ${has(command.name)}::boolean THEN ${command.name ?? ''}::text ELSE name END,
                  designation = CASE WHEN ${has(command.designation)}::boolean THEN ${command.designation ?? null}::text ELSE designation END,
                  email = CASE WHEN ${has(command.email)}::boolean THEN ${command.email ?? null}::text ELSE email END,
                  phone = CASE WHEN ${has(command.phone)}::boolean THEN ${command.phone ?? null}::text ELSE phone END,
                  whatsapp = CASE WHEN ${has(command.whatsapp)}::boolean THEN ${command.whatsapp ?? null}::text ELSE whatsapp END,
                  is_primary = CASE WHEN ${has(command.isPrimary)}::boolean THEN ${command.isPrimary ?? false}::boolean ELSE is_primary END,
                  notes = CASE WHEN ${has(command.notes)}::boolean THEN ${command.notes ?? null}::text ELSE notes END
              WHERE id = ${command.id}::uuid;
            `;
            return { result: { id: command.id }, isDemo };
          },
        );
        return await this.fetchContactDto(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async deleteClientContact(ctx: RepositoryContext, contactId: string): Promise<void> {
    try {
      await this.runner.withUserContext(ctx, async (tx) => {
        const ownerRows = await tx`
          SELECT client_id FROM public.client_contacts WHERE id = ${contactId}::uuid;
        `;
        const owner = ownerRows[0];
        if (!owner) throw notFound('Contact');
        await this.lockEditableClient(tx, String(owner['client_id']));
        await tx`DELETE FROM public.client_contacts WHERE id = ${contactId}::uuid;`;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Reference Lookups ---

  async getClientReference(ctx: RepositoryContext, clientId: string): Promise<ClientReference | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT id, code, display_name
          FROM public.clients
          WHERE id = ${clientId}::uuid;
        `;
        const row = rows[0];
        if (!row) return null;
        return {
          id: String(row['id']),
          code: String(row['code']),
          name: String(row['display_name']),
        };
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listClientReferences(ctx: RepositoryContext): Promise<ClientReference[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT id, code, display_name
          FROM public.clients
          WHERE status = 'active'
          ORDER BY code ASC;
        `;
        return rows.map((row) => ({
          id: String(row['id']),
          code: String(row['code']),
          name: String(row['display_name']),
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async getServiceReferenceById(ctx: RepositoryContext, serviceId: string): Promise<ServiceReference | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT id, name
          FROM public.service_catalog
          WHERE id = ${serviceId}::uuid
            AND is_active = true;
        `;
        const row = rows[0];
        if (!row) return null;
        return {
          id: String(row['id']),
          name: String(row['name']),
        };
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async getServiceReferenceByName(ctx: RepositoryContext, serviceName: string): Promise<ServiceReference | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT id, name
          FROM public.service_catalog
          WHERE lower(btrim(name)) = lower(btrim(${serviceName}))
            AND is_active = true;
        `;
        const row = rows[0];
        if (!row) return null;
        return {
          id: String(row['id']),
          name: String(row['name']),
        };
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listServiceReferences(ctx: RepositoryContext): Promise<ServiceReference[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT id, name
          FROM public.service_catalog
          WHERE is_active = true
          ORDER BY name ASC;
        `;
        return rows.map((row) => ({
          id: String(row['id']),
          name: String(row['name']),
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Service list management (SVC-01) ---

  private async queryServiceDtos(tx: SqlClient, serviceId?: string): Promise<ServiceDto[]> {
    const whereClause = serviceId ? tx`WHERE s.id = ${serviceId}::uuid` : tx``;
    const rows = await tx`
      SELECT
        s.id,
        s.name,
        s.description,
        s.default_duration_days,
        s.is_statutory,
        s.is_active,
        s.created_at,
        s.updated_at,
        (SELECT count(*)::int FROM public.assignments a WHERE a.service_id = s.id) AS assignments_count,
        (SELECT count(*)::int FROM public.recurring_schedules rs WHERE rs.service_id = s.id) AS schedules_count,
        (SELECT count(*)::int FROM public.engagements e WHERE e.service_id = s.id) AS engagements_count
      FROM public.service_catalog s
      ${whereClause}
      ORDER BY s.is_active DESC, lower(s.name) ASC, s.name ASC;
    `;
    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      description: nullableText(row['description']),
      turnaroundDays: row['default_duration_days'] === null ? null : Number(row['default_duration_days']),
      isStatutory: Boolean(row['is_statutory']),
      isActive: Boolean(row['is_active']),
      usage: {
        assignments: Number(row['assignments_count']),
        recurringSchedules: Number(row['schedules_count']),
        engagements: Number(row['engagements_count']),
      },
      createdAt: toIsoString(row['created_at']),
      updatedAt: toIsoString(row['updated_at']),
    }));
  }

  async listServiceCatalog(ctx: RepositoryContext): Promise<ServiceDto[]> {
    try {
      return await this.runner.withUserContext(ctx, (tx) => this.queryServiceDtos(tx));
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  private async serviceNameTaken(tx: SqlClient, name: string, exceptId: string | null): Promise<boolean> {
    const rows = await tx`
      SELECT 1
      FROM public.service_catalog
      WHERE lower(btrim(name)) = lower(btrim(${name}))
        AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
      LIMIT 1;
    `;
    return rows.length > 0;
  }

  async createService(ctx: RepositoryContext, command: CreateServiceCommand): Promise<ServiceDto> {
    const { idempotencyKey, ...payload } = command;
    const name = command.name.trim();
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<ServiceDto>(tx, ctx, idempotencyKey, 'createService', payload, async () => {
          if (await this.serviceNameTaken(tx, name, null)) throw duplicateService(name);

          const serviceId = crypto.randomUUID();
          await tx`
            INSERT INTO public.service_catalog (
              id, name, description, default_duration_days, is_statutory, created_by
            ) VALUES (
              ${serviceId}::uuid,
              ${name},
              ${command.description ?? null},
              ${command.turnaroundDays ?? null}::smallint,
              ${command.isStatutory === true},
              ${ctx.actorId}::uuid
            );
          `;
          const created = (await this.queryServiceDtos(tx, serviceId))[0];
          if (!created) {
            throw new ApiError(500, 'internal_error', 'Created service could not be retrieved.');
          }
          // Services belong to no client, so a new one is never demo data
          return { result: created, isDemo: false };
        }),
      );
    } catch (error) {
      const pgErr = error as { code?: string; constraint_name?: string };
      if (pgErr?.code === '23505' && pgErr.constraint_name?.startsWith('service_catalog_name')) {
        throw duplicateService(name);
      }
      sanitizeDatabaseError(error);
    }
  }

  async updateService(ctx: RepositoryContext, command: UpdateServiceCommand): Promise<ServiceDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<ServiceDto>(tx, ctx, idempotencyKey, 'updateService', payload, async () => {
          const currentRows = await tx`
            SELECT
              is_demo,
              date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz) AS fresh
            FROM public.service_catalog
            WHERE id = ${command.id}::uuid
            FOR UPDATE;
          `;
          const current = currentRows[0];
          if (!current) throw notFound('Service');
          if (current['fresh'] !== true) throw staleService();
          if (command.name !== undefined && (await this.serviceNameTaken(tx, command.name, command.id))) {
            throw duplicateService(command.name);
          }

          await tx`
            UPDATE public.service_catalog
            SET name = CASE WHEN ${command.name !== undefined}::boolean THEN ${command.name ?? ''}::text ELSE name END,
                description = CASE WHEN ${command.description !== undefined}::boolean THEN ${command.description ?? null}::text ELSE description END,
                default_duration_days = CASE WHEN ${command.turnaroundDays !== undefined}::boolean THEN ${command.turnaroundDays ?? null}::smallint ELSE default_duration_days END,
                is_statutory = CASE WHEN ${command.isStatutory !== undefined}::boolean THEN ${command.isStatutory ?? false}::boolean ELSE is_statutory END,
                is_active = CASE WHEN ${command.isActive !== undefined}::boolean THEN ${command.isActive ?? true}::boolean ELSE is_active END
            WHERE id = ${command.id}::uuid;
          `;
          const updated = (await this.queryServiceDtos(tx, command.id))[0];
          if (!updated) {
            throw new ApiError(500, 'internal_error', 'Updated service could not be retrieved.');
          }
          return { result: updated, isDemo: Boolean(current['is_demo']) };
        }),
      );
    } catch (error) {
      const pgErr = error as { code?: string; constraint_name?: string };
      if (
        command.name !== undefined &&
        pgErr?.code === '23505' &&
        pgErr.constraint_name?.startsWith('service_catalog_name')
      ) {
        throw duplicateService(command.name);
      }
      sanitizeDatabaseError(error);
    }
  }

  // --- Identity & Reporting Lines ---

  private async fetchEmployeeRecord(tx: SqlClient, id: string): Promise<EmployeeRecord | null> {
    const rows = await tx`
      SELECT
        p.user_id AS id,
        p.full_name AS name,
        p.email,
        p.is_active AS active,
        public.role_of(p.user_id) AS role,
        srl.supervisor_id AS "reportsToId"
      FROM public.profiles p
      LEFT JOIN public.staff_reporting_lines srl ON srl.employee_id = p.user_id
      WHERE p.user_id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row['id']),
      name: String(row['name']),
      email: String(row['email']),
      active: Boolean(row['active']),
      role: row['role'] as any,
      reportsToId: row['reportsToId'] ? String(row['reportsToId']) : null,
    };
  }

  async getEmployee(ctx: RepositoryContext, id: string): Promise<EmployeeRecord | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        return await this.fetchEmployeeRecord(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listEmployees(ctx: RepositoryContext): Promise<EmployeeRecord[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT
            p.user_id AS id,
            p.full_name AS name,
            p.email,
            p.is_active AS active,
            public.role_of(p.user_id) AS role,
            srl.supervisor_id AS "reportsToId"
          FROM public.profiles p
          LEFT JOIN public.staff_reporting_lines srl ON srl.employee_id = p.user_id
          WHERE p.is_active = true
          ORDER BY p.full_name ASC;
        `;
        return rows.map((row) => ({
          id: String(row['id']),
          name: String(row['name']),
          email: String(row['email']),
          active: Boolean(row['active']),
          role: row['role'] as any,
          reportsToId: row['reportsToId'] ? String(row['reportsToId']) : null,
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateReportingLine(
    ctx: RepositoryContext,
    employeeId: string,
    supervisorId: string | null,
  ): Promise<ReportingLineDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        // Validate target employee
        const employee = await this.fetchEmployeeRecord(tx, employeeId);
        if (!employee) {
          throw new ApiError(404, 'employee_not_found', 'Employee was not found.');
        }

        // Validate supervisor if specified
        let manager: EmployeeRecord | null = null;
        if (supervisorId !== null) {
          manager = await this.fetchEmployeeRecord(tx, supervisorId);
          if (!manager) {
            throw new ApiError(422, 'referenced_entity_not_found', 'Supervisor was not found.');
          }
        }

        if (supervisorId === null) {
          await tx`
            DELETE FROM public.staff_reporting_lines
            WHERE employee_id = ${employeeId}::uuid;
          `;
        } else {
          await tx`
            INSERT INTO public.staff_reporting_lines (employee_id, supervisor_id, assigned_by)
            VALUES (${employeeId}::uuid, ${supervisorId}::uuid, ${ctx.actorId}::uuid)
            ON CONFLICT (employee_id)
            DO UPDATE SET supervisor_id = EXCLUDED.supervisor_id, assigned_by = EXCLUDED.assigned_by, updated_at = now();
          `;
        }

        return {
          employee: {
            id: employee.id,
            name: employee.name,
            role: employee.role,
            reportsToId: supervisorId,
          },
          manager: manager
            ? {
                id: manager.id,
                name: manager.name,
                role: manager.role,
                reportsToId: manager.reportsToId,
              }
            : null,
        };
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- DevActorDirectory ---

  async resolveDevActor(idOrAlias: string): Promise<EmployeeRecord | null> {
    if (isProductionEnvironment(process.env['NODE_ENV'])) {
      return null;
    }
    const resolvedId = DEV_ACTOR_ALIASES[idOrAlias] ?? idOrAlias;
    const rows = await this.sql`
      SELECT
        p.user_id AS id,
        p.full_name AS name,
        p.email,
        p.is_active AS active,
        public.role_of(p.user_id) AS role,
        srl.supervisor_id AS "reportsToId"
      FROM public.profiles p
      LEFT JOIN public.staff_reporting_lines srl ON srl.employee_id = p.user_id
      WHERE p.user_id = ${resolvedId}::uuid
        AND p.is_demo = true
        AND p.is_active = true;
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row['id']),
      name: String(row['name']),
      email: String(row['email']),
      active: Boolean(row['active']),
      role: row['role'] as any,
      reportsToId: row['reportsToId'] ? String(row['reportsToId']) : null,
    };
  }

  async listDevActors(): Promise<EmployeeRecord[]> {
    if (isProductionEnvironment(process.env['NODE_ENV'])) {
      return [];
    }
    const rows = await this.sql`
      SELECT
        p.user_id AS id,
        p.full_name AS name,
        p.email,
        p.is_active AS active,
        public.role_of(p.user_id) AS role,
        srl.supervisor_id AS "reportsToId"
      FROM public.profiles p
      LEFT JOIN public.staff_reporting_lines srl ON srl.employee_id = p.user_id
      WHERE p.is_demo = true
        AND p.is_active = true
      ORDER BY p.full_name ASC;
    `;
    return rows.map((row) => ({
      id: String(row['id']),
      name: String(row['name']),
      email: String(row['email']),
      active: Boolean(row['active']),
      role: row['role'] as any,
      reportsToId: row['reportsToId'] ? String(row['reportsToId']) : null,
    }));
  }

  // --- Assignments ---

  private async fetchAssignmentDto(tx: SqlClient, id: string): Promise<AssignmentDto | null> {
    const rows = await tx`
      SELECT
        a.id, a.code, a.client_id AS "clientId",
        c.display_name AS "clientName",
        a.service_id AS "serviceId", s.name AS "serviceName",
        a.title, a.description AS "description", a.owner_id AS "ownerId",
        coalesce(p.full_name, 'Unassigned') AS "ownerName",
        a.status, a.priority, a.period_start AS "periodStart", a.period_end AS "periodEnd",
        a.due_at AS "dueAt", a.recurring_schedule_id AS "recurringScheduleId",
        a.engagement_id AS "engagementId", a.engagement_code AS "engagementCode",
        a.progress_percent AS "progressPercent",
        a.delivery_notes AS "deliveryNotes",
        a.review_notes AS "reviewNotes",
        a.started_at AS "startedAt", a.submitted_at AS "submittedAt",
        a.approved_at AS "approvedAt", a.approved_by AS "approvedById",
        a.closed_at AS "closedAt", a.closed_by AS "closedById",
        a.created_by AS "createdById", a.created_at AS "createdAt", a.updated_at AS "updatedAt"
      FROM public.assignments a
      JOIN public.clients c ON c.id = a.client_id
      JOIN public.service_catalog s ON s.id = a.service_id
      LEFT JOIN public.profiles p ON p.user_id = a.owner_id
      WHERE a.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

    const reviewerRows = await tx`
      SELECT ar.reviewer_id AS "reviewerId", coalesce(p.full_name, 'Unknown') AS "reviewerName"
      FROM public.assignment_reviewers ar
      LEFT JOIN public.profiles p ON p.user_id = ar.reviewer_id
      WHERE ar.assignment_id = ${id}::uuid
      ORDER BY ar.assigned_at ASC;
    `;

    return {
      id: String(row['id']),
      code: String(row['code']),
      clientId: String(row['clientId']),
      clientName: String(row['clientName']),
      serviceId: String(row['serviceId']),
      service: String(row['serviceName']),
      title: String(row['title']),
      description: row['description'] ? String(row['description']) : null,
      ownerId: String(row['ownerId']),
      ownerName: String(row['ownerName']),
      reviewerIds: reviewerRows.map((r) => String(r['reviewerId'])),
      reviewerNames: reviewerRows.map((r) => String(r['reviewerName'])),
      status: row['status'] as any,
      priority: row['priority'] as any,
      periodStart: row['periodStart'] ? (row['periodStart'] as Date).toISOString().slice(0, 10) : null,
      periodEnd: row['periodEnd'] ? (row['periodEnd'] as Date).toISOString().slice(0, 10) : null,
      dueAt: (row['dueAt'] as Date).toISOString(),
      recurringScheduleId: row['recurringScheduleId'] ? String(row['recurringScheduleId']) : null,
      engagementId: row['engagementId'] ? String(row['engagementId']) : null,
      engagementCode: row['engagementCode'] ? String(row['engagementCode']) : null,
      progressPercent: row['progressPercent'] !== null && row['progressPercent'] !== undefined ? Number(row['progressPercent']) : 0,
      deliveryNotes: row['deliveryNotes'] ? String(row['deliveryNotes']) : null,
      reviewNotes: row['reviewNotes'] ? String(row['reviewNotes']) : null,
      startedAt: row['startedAt'] ? (row['startedAt'] as Date).toISOString() : null,
      submittedAt: row['submittedAt'] ? (row['submittedAt'] as Date).toISOString() : null,
      approvedAt: row['approvedAt'] ? (row['approvedAt'] as Date).toISOString() : null,
      approvedById: row['approvedById'] ? String(row['approvedById']) : null,
      closedAt: row['closedAt'] ? (row['closedAt'] as Date).toISOString() : null,
      closedById: row['closedById'] ? String(row['closedById']) : null,
      createdById: String(row['createdById']),
      createdAt: (row['createdAt'] as Date).toISOString(),
      updatedAt: (row['updatedAt'] as Date).toISOString(),
    };
  }

  async getAssignment(ctx: RepositoryContext, id: string): Promise<AssignmentDto | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        return this.fetchAssignmentDto(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listAssignments(ctx: RepositoryContext): Promise<AssignmentDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT
            a.id, a.code, a.client_id AS "clientId",
            c.display_name AS "clientName",
            a.service_id AS "serviceId", s.name AS "serviceName",
            a.title, a.description AS "description", a.owner_id AS "ownerId",
            coalesce(p.full_name, 'Unassigned') AS "ownerName",
            a.status, a.priority, a.period_start AS "periodStart", a.period_end AS "periodEnd",
            a.due_at AS "dueAt", a.recurring_schedule_id AS "recurringScheduleId",
            a.engagement_id AS "engagementId", a.engagement_code AS "engagementCode",
            a.progress_percent AS "progressPercent",
            a.delivery_notes AS "deliveryNotes",
            a.review_notes AS "reviewNotes",
            a.started_at AS "startedAt", a.submitted_at AS "submittedAt",
            a.approved_at AS "approvedAt", a.approved_by AS "approvedById",
            a.closed_at AS "closedAt", a.closed_by AS "closedById",
            a.created_by AS "createdById", a.created_at AS "createdAt", a.updated_at AS "updatedAt"
          FROM public.assignments a
          JOIN public.clients c ON c.id = a.client_id
          JOIN public.service_catalog s ON s.id = a.service_id
          LEFT JOIN public.profiles p ON p.user_id = a.owner_id
          ORDER BY a.created_at DESC;
        `;

        if (rows.length === 0) return [];
        const assignmentIds = rows.map((r) => r['id']);

        const reviewerRows = await tx`
          SELECT
            ar.assignment_id AS "assignmentId",
            ar.reviewer_id AS "reviewerId",
            coalesce(p.full_name, 'Unknown') AS "reviewerName"
          FROM public.assignment_reviewers ar
          LEFT JOIN public.profiles p ON p.user_id = ar.reviewer_id
          WHERE ar.assignment_id = ANY(${assignmentIds}::uuid[])
          ORDER BY ar.assigned_at ASC;
        `;

        const reviewersByAssignment = new Map<string, string[]>();
        const reviewerNamesByAssignment = new Map<string, string[]>();
        for (const rev of reviewerRows) {
          const aid = String(rev['assignmentId']);
          const list = reviewersByAssignment.get(aid) ?? [];
          list.push(String(rev['reviewerId']));
          reviewersByAssignment.set(aid, list);

          const nameList = reviewerNamesByAssignment.get(aid) ?? [];
          nameList.push(String(rev['reviewerName']));
          reviewerNamesByAssignment.set(aid, nameList);
        }

        return rows.map((row) => ({
          id: String(row['id']),
          code: String(row['code']),
          clientId: String(row['clientId']),
          clientName: String(row['clientName']),
          serviceId: String(row['serviceId']),
          service: String(row['serviceName']),
          title: String(row['title']),
          description: row['description'] ? String(row['description']) : null,
          ownerId: String(row['ownerId']),
          ownerName: String(row['ownerName']),
          reviewerIds: reviewersByAssignment.get(String(row['id'])) ?? [],
          reviewerNames: reviewerNamesByAssignment.get(String(row['id'])) ?? [],
          status: row['status'] as any,
          priority: row['priority'] as any,
          periodStart: row['periodStart'] ? (row['periodStart'] as Date).toISOString().slice(0, 10) : null,
          periodEnd: row['periodEnd'] ? (row['periodEnd'] as Date).toISOString().slice(0, 10) : null,
          dueAt: (row['dueAt'] as Date).toISOString(),
          recurringScheduleId: row['recurringScheduleId'] ? String(row['recurringScheduleId']) : null,
          engagementId: row['engagementId'] ? String(row['engagementId']) : null,
          engagementCode: row['engagementCode'] ? String(row['engagementCode']) : null,
          progressPercent: row['progressPercent'] !== null && row['progressPercent'] !== undefined ? Number(row['progressPercent']) : 0,
          deliveryNotes: row['deliveryNotes'] ? String(row['deliveryNotes']) : null,
          reviewNotes: row['reviewNotes'] ? String(row['reviewNotes']) : null,
          startedAt: row['startedAt'] ? (row['startedAt'] as Date).toISOString() : null,
          submittedAt: row['submittedAt'] ? (row['submittedAt'] as Date).toISOString() : null,
          approvedAt: row['approvedAt'] ? (row['approvedAt'] as Date).toISOString() : null,
          approvedById: row['approvedById'] ? String(row['approvedById']) : null,
          closedAt: row['closedAt'] ? (row['closedAt'] as Date).toISOString() : null,
          closedById: row['closedById'] ? String(row['closedById']) : null,
          createdById: String(row['createdById']),
          createdAt: (row['createdAt'] as Date).toISOString(),
          updatedAt: (row['updatedAt'] as Date).toISOString(),
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async createAssignment(ctx: RepositoryContext, record: CreateAssignmentRecord): Promise<AssignmentDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        // Live write: omit is_demo column completely (PostgreSQL defaults is_demo = false)
        await tx`
          INSERT INTO public.assignments (
            id, client_id, service_id, title, description, owner_id,
            status, priority, period_start, period_end, due_at,
            recurring_schedule_id, engagement_id, created_by
          ) VALUES (
            ${record.id}::uuid, ${record.clientId}::uuid, ${record.serviceId}::uuid,
            ${record.title}, ${record.description ?? null}, ${record.ownerId}::uuid,
            ${record.status}::public.assignment_status,
            ${record.priority ?? 'normal'}::public.work_priority,
            ${record.periodStart ? record.periodStart : null}::date,
            ${record.periodEnd ? record.periodEnd : null}::date,
            ${record.dueAt}::timestamptz,
            ${record.recurringScheduleId ? record.recurringScheduleId : null}::uuid,
            ${record.engagementId ? record.engagementId : null}::uuid,
            ${ctx.actorId}::uuid
          );
        `;

        if (record.reviewerIds && record.reviewerIds.length > 0) {
          await tx`
            INSERT INTO public.assignment_reviewers (assignment_id, reviewer_id, assigned_by)
            SELECT ${record.id}::uuid, unnest(${record.reviewerIds}::uuid[]), ${ctx.actorId}::uuid;
          `;
        }

        const created = await this.fetchAssignmentDto(tx, record.id);
        if (!created) {
          throw new ApiError(500, 'internal_error', 'Created assignment could not be retrieved.');
        }
        return created;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateAssignmentStatus(
    ctx: RepositoryContext,
    command: UpdateAssignmentStatusCommand,
  ): Promise<AssignmentDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        if (!command.expectedUpdatedAt) {
          throw new ApiError(409, 'concurrency_conflict', 'expectedUpdatedAt is required for optimistic concurrency verification.');
        }

        const hasDeliveryNotes = command.deliveryNotes !== undefined;
        const hasReviewNotes = command.reviewNotes !== undefined;
        const hasProgressPercent = command.progressPercent !== undefined;

        const deliveryNotesVal = command.deliveryNotes ?? null;
        const reviewNotesVal = command.reviewNotes ?? null;
        const progressPercentVal = command.progressPercent ?? null;
        const isTerminalApproved = command.status === 'approved' || command.status === 'closed';

        const updateRows = await tx`
          UPDATE public.assignments
          SET status = ${command.status}::public.assignment_status,
              delivery_notes = CASE WHEN ${hasDeliveryNotes} THEN ${deliveryNotesVal} ELSE delivery_notes END,
              review_notes = CASE WHEN ${hasReviewNotes} THEN ${reviewNotesVal} ELSE review_notes END,
              progress_percent = CASE
                WHEN ${hasProgressPercent} THEN ${progressPercentVal}
                WHEN ${isTerminalApproved} THEN 100
                ELSE progress_percent
              END
          WHERE id = ${command.id}::uuid
            AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz)
          RETURNING id, updated_at;
        `;

        if (updateRows.length === 0) {
          const checkRows = await tx`
            SELECT updated_at FROM public.assignments WHERE id = ${command.id}::uuid;
          `;
          if (checkRows.length === 0) {
            throw new ApiError(404, 'not_found', 'Resource was not found.');
          }
          throw new ApiError(
            409,
            'concurrency_conflict',
            'The resource was updated concurrently by another operation.',
          );
        }

        const updated = await this.fetchAssignmentDto(tx, command.id);
        if (!updated) {
          throw new ApiError(404, 'not_found', 'Resource was not found.');
        }
        return updated;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateAssignment(
    ctx: RepositoryContext,
    command: UpdateAssignmentCommand,
  ): Promise<AssignmentDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        if (!command.expectedUpdatedAt) {
          throw new ApiError(409, 'concurrency_conflict', 'expectedUpdatedAt is required for optimistic concurrency verification.');
        }

        const hasTitle = command.title !== undefined;
        const hasDescription = command.description !== undefined;
        const hasServiceId = command.serviceId !== undefined;
        const hasOwnerId = command.ownerId !== undefined;
        const hasDueAt = command.dueAt !== undefined;
        const hasDeliveryNotes = command.deliveryNotes !== undefined;
        const hasReviewNotes = command.reviewNotes !== undefined;
        const hasProgressPercent = command.progressPercent !== undefined;

        const titleVal = command.title ?? null;
        const descriptionVal = command.description ?? null;
        const serviceIdVal = command.serviceId ?? null;
        const ownerIdVal = command.ownerId ?? null;
        const dueAtVal = command.dueAt ?? null;
        const deliveryNotesVal = command.deliveryNotes ?? null;
        const reviewNotesVal = command.reviewNotes ?? null;
        const progressPercentVal = command.progressPercent ?? null;

        const updateRows = await tx`
          UPDATE public.assignments
          SET title = CASE WHEN ${hasTitle} THEN ${titleVal} ELSE title END,
              description = CASE WHEN ${hasDescription} THEN ${descriptionVal} ELSE description END,
              service_id = CASE WHEN ${hasServiceId} THEN ${serviceIdVal}::uuid ELSE service_id END,
              owner_id = CASE WHEN ${hasOwnerId} THEN ${ownerIdVal}::uuid ELSE owner_id END,
              due_at = CASE WHEN ${hasDueAt} THEN ${dueAtVal}::timestamptz ELSE due_at END,
              delivery_notes = CASE WHEN ${hasDeliveryNotes} THEN ${deliveryNotesVal} ELSE delivery_notes END,
              review_notes = CASE WHEN ${hasReviewNotes} THEN ${reviewNotesVal} ELSE review_notes END,
              progress_percent = CASE WHEN ${hasProgressPercent} THEN ${progressPercentVal} ELSE progress_percent END,
              updated_at = now()
          WHERE id = ${command.id}::uuid
            AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz)
          RETURNING id, updated_at;
        `;

        if (updateRows.length === 0) {
          const checkRows = await tx`
            SELECT updated_at FROM public.assignments WHERE id = ${command.id}::uuid;
          `;
          if (checkRows.length === 0) {
            throw new ApiError(404, 'not_found', 'Resource was not found.');
          }
          throw new ApiError(
            409,
            'concurrency_conflict',
            'The resource was updated concurrently by another operation.',
          );
        }

        if (command.reviewerIds !== undefined) {
          await tx`
            DELETE FROM public.assignment_reviewers
            WHERE assignment_id = ${command.id}::uuid;
          `;
          if (command.reviewerIds.length > 0) {
            await tx`
              INSERT INTO public.assignment_reviewers (assignment_id, reviewer_id, assigned_by)
              SELECT ${command.id}::uuid, unnest(${command.reviewerIds}::uuid[]), ${ctx.actorId}::uuid;
            `;
          }
        }

        const updated = await this.fetchAssignmentDto(tx, command.id);
        if (!updated) {
          throw new ApiError(404, 'not_found', 'Resource was not found.');
        }
        return updated;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateAssignmentReviewers(
    ctx: RepositoryContext,
    command: UpdateAssignmentReviewersCommand,
  ): Promise<AssignmentDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        await tx`
          DELETE FROM public.assignment_reviewers
          WHERE assignment_id = ${command.id}::uuid;
        `;

        if (command.reviewerIds.length > 0) {
          await tx`
            INSERT INTO public.assignment_reviewers (assignment_id, reviewer_id, assigned_by)
            SELECT ${command.id}::uuid, unnest(${command.reviewerIds}::uuid[]), ${command.assignedBy}::uuid;
          `;
        }

        const updated = await this.fetchAssignmentDto(tx, command.id);
        if (!updated) {
          throw new ApiError(404, 'not_found', 'Resource was not found.');
        }
        return updated;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Work Items ---

  private async fetchWorkItemDto(tx: SqlClient, id: string): Promise<WorkItemDto | null> {
    const rows = await tx`
      SELECT
        wi.id, wi.code, wi.kind, wi.assignment_id AS "assignmentId",
        wi.context_client_id AS "relatedClientId",
        c.display_name AS "relatedPartyName",
        wi.title, wi.description AS "notes", wi.completion_note AS "completionNote",
        wi.assignee_id AS "assigneeId", wi.created_by AS "createdById",
        wi.status, wi.priority, wi.due_at AS "dueAt", wi.progress_percent AS "progressPercent",
        wi.completed_at AS "completedAt",
        wi.created_at AS "createdAt", wi.updated_at AS "updatedAt"
      FROM public.work_items wi
      LEFT JOIN public.clients c ON c.id = wi.context_client_id
      WHERE wi.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

    return {
      id: String(row['id']),
      code: String(row['code']),
      kind: row['kind'] as any,
      title: String(row['title']),
      notes: row['notes'] ? String(row['notes']) : null,
      assignmentId: row['assignmentId'] ? String(row['assignmentId']) : null,
      relatedClientId: row['relatedClientId'] ? String(row['relatedClientId']) : null,
      relatedPartyName: row['relatedPartyName'] ? String(row['relatedPartyName']) : null,
      assigneeId: String(row['assigneeId']),
      createdById: String(row['createdById']),
      status: row['status'] as any,
      priority: row['priority'] as any,
      dueAt: (row['dueAt'] as Date).toISOString(),
      reminderAt: null,
      progressPercent: row['progressPercent'] !== null ? Number(row['progressPercent']) : undefined,
      completionNote: row['completionNote'] ? String(row['completionNote']) : null,
      completedAt: row['completedAt'] ? (row['completedAt'] as Date).toISOString() : null,
      createdAt: (row['createdAt'] as Date).toISOString(),
      updatedAt: (row['updatedAt'] as Date).toISOString(),
    };
  }

  async getWorkItem(ctx: RepositoryContext, id: string): Promise<WorkItemDto | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        return this.fetchWorkItemDto(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listWorkItems(ctx: RepositoryContext): Promise<WorkItemDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT
            wi.id, wi.code, wi.kind, wi.assignment_id AS "assignmentId",
            wi.context_client_id AS "relatedClientId",
            c.display_name AS "relatedPartyName",
            wi.title, wi.description AS "notes", wi.completion_note AS "completionNote",
            wi.assignee_id AS "assigneeId", wi.created_by AS "createdById",
            wi.status, wi.priority, wi.due_at AS "dueAt", wi.progress_percent AS "progressPercent",
            wi.completed_at AS "completedAt",
            wi.created_at AS "createdAt", wi.updated_at AS "updatedAt"
          FROM public.work_items wi
          LEFT JOIN public.clients c ON c.id = wi.context_client_id
          ORDER BY wi.due_at ASC;
        `;

        return rows.map((row) => ({
          id: String(row['id']),
          code: String(row['code']),
          kind: row['kind'] as any,
          title: String(row['title']),
          notes: row['notes'] ? String(row['notes']) : null,
          assignmentId: row['assignmentId'] ? String(row['assignmentId']) : null,
          relatedClientId: row['relatedClientId'] ? String(row['relatedClientId']) : null,
          relatedPartyName: row['relatedPartyName'] ? String(row['relatedPartyName']) : null,
          assigneeId: String(row['assigneeId']),
          createdById: String(row['createdById']),
          status: row['status'] as any,
          priority: row['priority'] as any,
          dueAt: (row['dueAt'] as Date).toISOString(),
          reminderAt: null,
          progressPercent: row['progressPercent'] !== null ? Number(row['progressPercent']) : undefined,
          completionNote: row['completionNote'] ? String(row['completionNote']) : null,
          completedAt: row['completedAt'] ? (row['completedAt'] as Date).toISOString() : null,
          createdAt: (row['createdAt'] as Date).toISOString(),
          updatedAt: (row['updatedAt'] as Date).toISOString(),
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async createWorkItem(ctx: RepositoryContext, record: CreateWorkItemRecord): Promise<WorkItemDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        // Live write: omit is_demo column completely (PostgreSQL defaults is_demo = false)
        await tx`
          INSERT INTO public.work_items (
            id, kind, assignment_id, context_client_id, title, description,
            assignee_id, created_by, status, priority, due_at, progress_percent
          ) VALUES (
            ${record.id}::uuid,
            ${record.kind}::public.work_item_kind,
            ${record.assignmentId ? record.assignmentId : null}::uuid,
            ${record.relatedClientId ? record.relatedClientId : null}::uuid,
            ${record.title},
            ${record.notes ?? null},
            ${record.assigneeId}::uuid,
            ${record.createdById}::uuid,
            ${record.status}::public.work_item_status,
            ${record.priority ?? 'normal'}::public.work_priority,
            ${record.dueAt}::timestamptz,
            0
          );
        `;

        const created = await this.fetchWorkItemDto(tx, record.id);
        if (!created) {
          throw new ApiError(500, 'internal_error', 'Created work item could not be retrieved.');
        }
        return created;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateWorkItemStatus(
    ctx: RepositoryContext,
    command: UpdateWorkItemStatusCommand,
  ): Promise<WorkItemDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const expectedUpdatedAt = command.expectedUpdatedAt ?? null;
        const completionNote = command.completionNote ?? command.notes ?? null;
        const progressPercent = command.progressPercent !== undefined ? command.progressPercent : null;

        // Trigger guard_work_item_write forbids assignees from updating description or completed_at.
        // Status notes map strictly to completion_note. Trigger owns completed_at.
        const updateRows = await tx`
          UPDATE public.work_items
          SET status = ${command.status}::public.work_item_status,
              completion_note = coalesce(${completionNote}, completion_note),
              progress_percent = coalesce(${progressPercent}, progress_percent)
          WHERE id = ${command.id}::uuid
            AND (${expectedUpdatedAt}::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt}::timestamptz))
          RETURNING id, updated_at;
        `;

        if (updateRows.length === 0) {
          const checkRows = await tx`
            SELECT updated_at FROM public.work_items WHERE id = ${command.id}::uuid;
          `;
          if (checkRows.length === 0) {
            throw new ApiError(404, 'not_found', 'Resource was not found.');
          }
          throw new ApiError(
            409,
            'concurrency_conflict',
            'The resource was updated concurrently by another operation.',
          );
        }

        const updated = await this.fetchWorkItemDto(tx, command.id);
        if (!updated) {
          throw new ApiError(404, 'not_found', 'Resource was not found.');
        }
        return updated;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Honest 501 Gating for Unmigrated Domains ---

  private async fetchRecurringScheduleDto(
    tx: SqlClient,
    id: string,
  ): Promise<RecurringScheduleDto | null> {
    const rows = await tx`
      SELECT
        rs.id,
        rs.code,
        rs.client_id AS "clientId",
        c.display_name AS "clientName",
        rs.service_id AS "serviceId",
        coalesce(sc.name, 'Statutory Service') AS "serviceName",
        rs.title,
        rs.cadence,
        rs.default_owner_id AS "ownerId",
        coalesce(p.full_name, 'Unassigned') AS "ownerName",
        rs.next_occurrence_date AS "nextOccurrenceOn",
        rs.due_offset_days AS "dueDay",
        rs.engagement_id AS "engagementId", rs.engagement_code AS "engagementCode",
        rs.is_active AS "active",
        rs.created_by AS "createdById",
        rs.created_at AS "createdAt",
        rs.updated_at AS "updatedAt"
      FROM public.recurring_schedules rs
      JOIN public.clients c ON c.id = rs.client_id
      LEFT JOIN public.service_catalog sc ON sc.id = rs.service_id
      LEFT JOIN public.profiles p ON p.user_id = rs.default_owner_id
      WHERE rs.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

    const reviewerRows = await tx`
      SELECT rsr.reviewer_id AS "reviewerId", coalesce(p.full_name, 'Unknown') AS "reviewerName"
      FROM public.recurring_schedule_reviewers rsr
      LEFT JOIN public.profiles p ON p.user_id = rsr.reviewer_id
      WHERE rsr.recurring_schedule_id = ${id}::uuid
      ORDER BY rsr.assigned_at ASC;
    `;

    return {
      id: String(row['id']),
      code: String(row['code']),
      clientId: String(row['clientId']),
      clientName: String(row['clientName']),
      serviceId: String(row['serviceId']),
      service: String(row['serviceName']),
      title: String(row['title']),
      cadence: row['cadence'] as any,
      ownerId: String(row['ownerId']),
      ownerName: String(row['ownerName']),
      reviewerIds: reviewerRows.map((r) => String(r['reviewerId'])),
      reviewerNames: reviewerRows.map((r) => String(r['reviewerName'])),
      nextOccurrenceOn: row['nextOccurrenceOn']
        ? (row['nextOccurrenceOn'] as Date).toISOString().slice(0, 10)
        : '',
      dueDay: Number(row['dueDay']),
      engagementId: row['engagementId'] ? String(row['engagementId']) : null,
      engagementCode: row['engagementCode'] ? String(row['engagementCode']) : null,
      active: Boolean(row['active']),
      createdById: String(row['createdById']),
      createdAt: (row['createdAt'] as Date).toISOString(),
      updatedAt: (row['updatedAt'] as Date).toISOString(),
    };
  }

  async getRecurringSchedule(ctx: RepositoryContext, id: string): Promise<RecurringScheduleDto | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        return this.fetchRecurringScheduleDto(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listRecurringSchedules(ctx: RepositoryContext): Promise<RecurringScheduleDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT
            rs.id,
            rs.code,
            rs.client_id AS "clientId",
            c.display_name AS "clientName",
            rs.service_id AS "serviceId",
            coalesce(sc.name, 'Statutory Service') AS "serviceName",
            rs.title,
            rs.cadence,
            rs.default_owner_id AS "ownerId",
            coalesce(p.full_name, 'Unassigned') AS "ownerName",
            rs.next_occurrence_date AS "nextOccurrenceOn",
            rs.due_offset_days AS "dueDay",
            rs.engagement_id AS "engagementId", rs.engagement_code AS "engagementCode",
            rs.is_active AS "active",
            rs.created_by AS "createdById",
            rs.created_at AS "createdAt",
            rs.updated_at AS "updatedAt"
          FROM public.recurring_schedules rs
          JOIN public.clients c ON c.id = rs.client_id
          LEFT JOIN public.service_catalog sc ON sc.id = rs.service_id
          LEFT JOIN public.profiles p ON p.user_id = rs.default_owner_id
          ORDER BY rs.next_occurrence_date ASC, rs.title ASC;
        `;

        if (rows.length === 0) return [];
        const scheduleIds = rows.map((r) => r['id']);

        const reviewerRows = await tx`
          SELECT
            rsr.recurring_schedule_id AS "scheduleId",
            rsr.reviewer_id AS "reviewerId",
            coalesce(p.full_name, 'Unknown') AS "reviewerName"
          FROM public.recurring_schedule_reviewers rsr
          LEFT JOIN public.profiles p ON p.user_id = rsr.reviewer_id
          WHERE rsr.recurring_schedule_id = ANY(${scheduleIds}::uuid[])
          ORDER BY rsr.assigned_at ASC;
        `;

        const reviewersBySchedule = new Map<string, string[]>();
        const reviewerNamesBySchedule = new Map<string, string[]>();
        for (const rev of reviewerRows) {
          const sid = String(rev['scheduleId']);
          const list = reviewersBySchedule.get(sid) ?? [];
          list.push(String(rev['reviewerId']));
          reviewersBySchedule.set(sid, list);

          const nameList = reviewerNamesBySchedule.get(sid) ?? [];
          nameList.push(String(rev['reviewerName']));
          reviewerNamesBySchedule.set(sid, nameList);
        }

        return rows.map((row) => ({
          id: String(row['id']),
          code: String(row['code']),
          clientId: String(row['clientId']),
          clientName: String(row['clientName']),
          serviceId: String(row['serviceId']),
          service: String(row['serviceName']),
          title: String(row['title']),
          cadence: row['cadence'] as any,
          ownerId: String(row['ownerId']),
          ownerName: String(row['ownerName']),
          reviewerIds: reviewersBySchedule.get(String(row['id'])) ?? [],
          reviewerNames: reviewerNamesBySchedule.get(String(row['id'])) ?? [],
          nextOccurrenceOn: row['nextOccurrenceOn']
            ? (row['nextOccurrenceOn'] as Date).toISOString().slice(0, 10)
            : '',
          dueDay: Number(row['dueDay']),
          engagementId: row['engagementId'] ? String(row['engagementId']) : null,
          engagementCode: row['engagementCode'] ? String(row['engagementCode']) : null,
          active: Boolean(row['active']),
          createdById: String(row['createdById']),
          createdAt: (row['createdAt'] as Date).toISOString(),
          updatedAt: (row['updatedAt'] as Date).toISOString(),
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async createRecurringSchedule(
    ctx: RepositoryContext,
    input: CreateRecurringScheduleInput & { id: string; createdById: string; code?: string; clientName: string; service: string },
  ): Promise<RecurringScheduleDto> {
    const intervalMonths =
      input.cadence === 'monthly' ? 1 : input.cadence === 'quarterly' ? 3 : 12;

    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        await tx`
          INSERT INTO public.recurring_schedules (
            id, client_id, service_id, title, cadence, interval_months,
            due_offset_days, start_date, next_occurrence_date,
            default_owner_id, priority, is_active, engagement_id, created_by
          ) VALUES (
            ${input.id}::uuid, ${input.clientId}::uuid,
            ${input.serviceId ? input.serviceId : null}::uuid,
            ${input.title}, ${input.cadence}::public.recurrence_cadence,
            ${intervalMonths}, ${input.dueDay}, ${input.nextOccurrenceOn}::date,
            ${input.nextOccurrenceOn}::date, ${input.ownerId}::uuid,
            'normal'::public.work_priority, true,
            ${input.engagementId ? input.engagementId : null}::uuid, ${ctx.actorId}::uuid
          );
        `;

        if (input.reviewerIds && input.reviewerIds.length > 0) {
          await tx`
            INSERT INTO public.recurring_schedule_reviewers (recurring_schedule_id, reviewer_id, assigned_by)
            SELECT ${input.id}::uuid, unnest(${input.reviewerIds}::uuid[]), ${ctx.actorId}::uuid;
          `;
        }

        const created = await this.fetchRecurringScheduleDto(tx, input.id);
        if (!created) {
          throw new ApiError(500, 'internal_error', 'Created recurring schedule could not be retrieved.');
        }
        return created;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async updateRecurringSchedule(
    ctx: RepositoryContext,
    id: string,
    input: UpdateRecurringScheduleInput,
  ): Promise<RecurringScheduleDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          UPDATE public.recurring_schedules
          SET is_active = coalesce(${input.active !== undefined ? input.active : null}, is_active),
              next_occurrence_date = coalesce(${input.nextOccurrenceOn ? input.nextOccurrenceOn : null}::date, next_occurrence_date),
              updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id;
        `;
        if (rows.length === 0) {
          throw new ApiError(404, 'not_found', 'Recurring schedule was not found.');
        }

        const updated = await this.fetchRecurringScheduleDto(tx, id);
        if (!updated) {
          throw new ApiError(404, 'not_found', 'Recurring schedule was not found.');
        }
        return updated;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async materializeDueAssignments(
    _ctx: RepositoryContext,
    throughDate: string,
  ): Promise<GenerateDueAssignmentsResult> {
    try {
      const rows = await this.sql<Array<{
        schedule_id: string;
        assignment_id: string;
        occurrence_date: string;
      }>>`
        SELECT schedule_id, assignment_id, occurrence_date::text AS occurrence_date
        FROM public.materialize_due_recurring_assignments(${throughDate}::date);
      `;

      return {
        generatedCount: rows.length,
        occurrences: rows.map((r) => ({
          scheduleId: String(r.schedule_id),
          assignmentId: String(r.assignment_id),
          occurrenceDate: String(r.occurrence_date),
        })),
      };
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async getOfficeAccountsSummary(ctx: RepositoryContext): Promise<OfficeAccountsSummaryDto> {
    throw new ApiError(501, 'domain_not_persisted', 'Recurring schedules and ledger persistence are deferred to future slices.');
  }

  async listLedgerEntries(ctx: RepositoryContext): Promise<LedgerEntryDto[]> {
    throw new ApiError(501, 'domain_not_persisted', 'Recurring schedules and ledger persistence are deferred to future slices.');
  }

  async createLedgerEntry(
    ctx: RepositoryContext,
    input: CreateLedgerEntryInput & { id: string; recordedById: string },
  ): Promise<LedgerEntryDto> {
    throw new ApiError(501, 'domain_not_persisted', 'Recurring schedules and ledger persistence are deferred to future slices.');
  }

  // --- Engagements (ENG-01) ---

  private async fetchEngagementVersionDto(tx: SqlClient, id: string): Promise<EngagementVersionDto | null> {
    const rows = await tx`
      SELECT
        ev.id,
        ev.engagement_id AS "engagementId",
        ev.version_number AS "versionNumber",
        ev.title,
        ev.scope,
        ev.exclusions,
        ev.responsible_partner_id AS "responsiblePartnerId",
        p_partner.full_name AS "responsiblePartnerName",
        ev.delivery_manager_id AS "deliveryManagerId",
        p_mgr.full_name AS "deliveryManagerName",
        ev.fee_model AS "feeModel",
        ev.agreed_fee_paise AS "agreedFeePaise",
        ev.billing_terms AS "billingTerms",
        ev.start_date::text AS "startDate",
        ev.end_date::text AS "endDate",
        ev.approved_at AS "approvedAt",
        ev.approved_by AS "approvedById",
        ev.created_by AS "createdById",
        ev.created_at AS "createdAt"
      FROM public.engagement_versions ev
      LEFT JOIN public.profiles p_partner ON p_partner.user_id = ev.responsible_partner_id
      LEFT JOIN public.profiles p_mgr ON p_mgr.user_id = ev.delivery_manager_id
      WHERE ev.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

    return {
      id: String(row['id']),
      engagementId: String(row['engagementId']),
      versionNumber: Number(row['versionNumber']),
      title: String(row['title']),
      scope: String(row['scope']),
      exclusions: row['exclusions'] !== null && row['exclusions'] !== undefined ? String(row['exclusions']) : null,
      responsiblePartnerId: String(row['responsiblePartnerId']),
      responsiblePartnerName: row['responsiblePartnerName'] ? String(row['responsiblePartnerName']) : undefined,
      deliveryManagerId: String(row['deliveryManagerId']),
      deliveryManagerName: row['deliveryManagerName'] ? String(row['deliveryManagerName']) : undefined,
      feeModel: row['feeModel'] as EngagementVersionDto['feeModel'],
      agreedFeePaise: Number(row['agreedFeePaise']),
      billingTerms: String(row['billingTerms']),
      startDate: String(row['startDate']),
      endDate: row['endDate'] !== null && row['endDate'] !== undefined ? String(row['endDate']) : null,
      approvedAt: row['approvedAt'] ? toIsoString(row['approvedAt']) : null,
      approvedById: row['approvedById'] ? String(row['approvedById']) : null,
      createdById: String(row['createdById']),
      createdAt: toIsoString(row['createdAt']),
    };
  }

  private async fetchEngagementDto(tx: SqlClient, id: string): Promise<EngagementDto | null> {
    const rows = await tx`
      SELECT
        e.id,
        e.code,
        e.client_id AS "clientId",
        c.display_name AS "clientName",
        e.service_id AS "serviceId",
        s.name AS "serviceName",
        e.status,
        e.approved_version_id AS "approvedVersionId",
        e.approved_at AS "approvedAt",
        e.approved_by AS "approvedById",
        e.ended_at AS "endedAt",
        e.ended_by AS "endedById",
        e.end_outcome AS "endOutcome",
        e.end_reason AS "endReason",
        e.created_by AS "createdById",
        e.created_at AS "createdAt",
        e.updated_at AS "updatedAt"
      FROM public.engagements e
      JOIN public.clients c ON c.id = e.client_id
      JOIN public.service_catalog s ON s.id = e.service_id
      WHERE e.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

    let approvedVersion: EngagementVersionDto | null = null;
    if (row['approvedVersionId']) {
      approvedVersion = await this.fetchEngagementVersionDto(tx, String(row['approvedVersionId']));
    }

    return {
      id: String(row['id']),
      code: String(row['code']),
      clientId: String(row['clientId']),
      clientName: row['clientName'] ? String(row['clientName']) : undefined,
      serviceId: String(row['serviceId']),
      serviceName: row['serviceName'] ? String(row['serviceName']) : null,
      status: row['status'] as EngagementDto['status'],
      approvedVersionId: row['approvedVersionId'] ? String(row['approvedVersionId']) : null,
      approvedVersion,
      approvedAt: row['approvedAt'] ? toIsoString(row['approvedAt']) : null,
      approvedById: row['approvedById'] ? String(row['approvedById']) : null,
      endedAt: row['endedAt'] ? toIsoString(row['endedAt']) : null,
      endedById: row['endedById'] ? String(row['endedById']) : null,
      endOutcome: row['endOutcome'] ? (row['endOutcome'] as EngagementDto['endOutcome']) : null,
      endReason: row['endReason'] ? String(row['endReason']) : null,
      createdById: String(row['createdById']),
      createdAt: toIsoString(row['createdAt']),
      updatedAt: toIsoString(row['updatedAt']),
    };
  }

  async getEngagement(ctx: RepositoryContext, id: string): Promise<EngagementDto | null> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        return this.fetchEngagementDto(tx, id);
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  private async queryInvoiceDtos(tx: SqlClient, invoiceId?: string): Promise<InvoiceDto[]> {
    const whereClause = invoiceId ? tx`WHERE i.id = ${invoiceId}::uuid` : tx``;
    // One query: items and payments are folded in as json_agg subqueries, so there is no N+1.
    const rows = await tx`
      SELECT
        i.id,
        i.code,
        i.vyapar_bill_number AS "vyaparBillNumber",
        i.client_id AS "clientId",
        c.code AS "clientCode",
        c.display_name AS "clientName",
        i.assignment_id AS "assignmentId",
        a.code AS "assignmentCode",
        i.issue_date::text AS "issueDate",
        i.due_date::text AS "dueDate",
        i.currency,
        round(i.subtotal_amount * 100)::bigint AS "subtotalPaise",
        round(i.tax_amount * 100)::bigint AS "taxPaise",
        round(i.total_amount * 100)::bigint AS "totalPaise",
        round(i.amount_received * 100)::bigint AS "amountReceivedPaise",
        CASE WHEN i.status IN ('issued', 'part_paid', 'paid')
          THEN round((i.total_amount - i.amount_received) * 100)::bigint
          ELSE 0::bigint
        END AS "balancePaise",
        CASE WHEN i.status IN ('issued', 'part_paid')
                   AND i.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
          THEN ((now() AT TIME ZONE 'Asia/Kolkata')::date - i.due_date)
          ELSE 0
        END AS "daysOverdue",
        i.status,
        i.notes,
        i.issued_at AS "issuedAt",
        i.void_reason AS "voidReason",
        i.voided_at AS "voidedAt",
        i.created_at AS "createdAt",
        i.updated_at AS "updatedAt",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', ii.id,
            'description', ii.description,
            'quantity', ii.quantity,
            'unitPricePaise', round(ii.unit_price * 100)::bigint,
            'taxRatePercent', ii.tax_rate,
            'lineSubtotalPaise', round(ii.line_subtotal * 100)::bigint,
            'lineTaxPaise', round(ii.line_tax * 100)::bigint,
            'lineTotalPaise', round(ii.line_total * 100)::bigint
          ) ORDER BY ii.sort_order, ii.id)
          FROM public.invoice_items ii
          WHERE ii.invoice_id = i.id
        ), '[]'::json) AS items,
        COALESCE((
          SELECT json_agg(json_build_object(
            'allocationId', pa.id,
            'source', pa.source,
            'receiptId', pr.id,
            'receiptCode', pr.code,
            'receivedOn', pr.received_on::text,
            'amountPaise', round(pa.amount * 100)::bigint,
            'receiptStatus', pr.status
          ) ORDER BY pr.received_on, pr.code)
          FROM public.payment_allocations pa
          JOIN public.payment_receipts pr ON pr.id = pa.receipt_id
          WHERE pa.invoice_id = i.id
        ), '[]'::json) AS payments
      FROM public.invoices i
      JOIN public.clients c ON c.id = i.client_id
      LEFT JOIN public.assignments a ON a.id = i.assignment_id
      ${whereClause}
      ORDER BY i.issue_date DESC, i.code DESC;
    `;

    return rows.map((row): InvoiceDto => {
      const items: InvoiceItemDto[] = asRecordArray(row['items']).map((item) => ({
        id: String(item['id']),
        description: String(item['description']),
        quantity: Number(item['quantity']),
        unitPricePaise: toSafePaise(item['unitPricePaise'], 'unitPricePaise'),
        taxRatePercent: Number(item['taxRatePercent']),
        lineSubtotalPaise: toSafePaise(item['lineSubtotalPaise'], 'lineSubtotalPaise'),
        lineTaxPaise: toSafePaise(item['lineTaxPaise'], 'lineTaxPaise'),
        lineTotalPaise: toSafePaise(item['lineTotalPaise'], 'lineTotalPaise'),
      }));
      const payments: InvoicePaymentDto[] = asRecordArray(row['payments']).map((payment) => ({
        allocationId: String(payment['allocationId']),
        source: payment['source'] as InvoicePaymentDto['source'],
        receiptId: String(payment['receiptId']),
        receiptCode: String(payment['receiptCode']),
        receivedOn: String(payment['receivedOn']),
        amountPaise: toSafePaise(payment['amountPaise'], 'amountPaise'),
        receiptStatus: payment['receiptStatus'] as InvoicePaymentDto['receiptStatus'],
      }));
      return {
        id: String(row['id']),
        code: String(row['code']),
        vyaparBillNumber: nullableText(row['vyaparBillNumber']),
        clientId: String(row['clientId']),
        clientCode: String(row['clientCode']),
        clientName: String(row['clientName']),
        assignmentId: nullableText(row['assignmentId']),
        assignmentCode: nullableText(row['assignmentCode']),
        issueDate: String(row['issueDate']),
        dueDate: String(row['dueDate']),
        currency: 'INR',
        subtotalPaise: toSafePaise(row['subtotalPaise'], 'subtotalPaise'),
        taxPaise: toSafePaise(row['taxPaise'], 'taxPaise'),
        totalPaise: toSafePaise(row['totalPaise'], 'totalPaise'),
        amountReceivedPaise: toSafePaise(row['amountReceivedPaise'], 'amountReceivedPaise'),
        balancePaise: toSafePaise(row['balancePaise'], 'balancePaise'),
        daysOverdue: Number(row['daysOverdue']),
        status: row['status'] as InvoiceDto['status'],
        notes: nullableText(row['notes']),
        issuedAt: row['issuedAt'] ? toIsoString(row['issuedAt']) : null,
        voidReason: nullableText(row['voidReason']),
        voidedAt: row['voidedAt'] ? toIsoString(row['voidedAt']) : null,
        items,
        payments,
        createdAt: toIsoString(row['createdAt']),
        updatedAt: toIsoString(row['updatedAt']),
      };
    });
  }

  async listInvoices(ctx: RepositoryContext): Promise<InvoiceDto[]> {
    try {
      return await this.runner.withUserContext(ctx, (tx) => this.queryInvoiceDtos(tx));
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  private async queryPaymentReceiptDtos(tx: SqlClient, receiptId?: string): Promise<PaymentReceiptDto[]> {
    const whereClause = receiptId ? tx`WHERE pr.id = ${receiptId}::uuid` : tx``;
    const rows = await tx`
      SELECT
        pr.id,
        pr.code,
        pr.client_id AS "clientId",
        c.code AS "clientCode",
        c.display_name AS "clientName",
        pr.received_on::text AS "receivedOn",
        round(pr.amount * 100)::bigint AS "amountPaise",
        pr.method,
        pr.reference,
        pr.notes,
        pr.status,
        pr.void_reason AS "voidReason",
        pr.voided_at AS "voidedAt",
        round(COALESCE((
          SELECT sum(pa.amount) FROM public.payment_allocations pa WHERE pa.receipt_id = pr.id
        ), 0) * 100)::bigint AS "allocatedPaise",
        COALESCE((
          SELECT json_agg(json_build_object(
            'allocationId', pa.id,
            'source', pa.source,
            'invoiceId', i.id,
            'invoiceCode', i.code,
            'amountPaise', round(pa.amount * 100)::bigint
          ) ORDER BY i.code)
          FROM public.payment_allocations pa
          JOIN public.invoices i ON i.id = pa.invoice_id
          WHERE pa.receipt_id = pr.id
        ), '[]'::json) AS allocations,
        pr.created_at AS "createdAt"
      FROM public.payment_receipts pr
      JOIN public.clients c ON c.id = pr.client_id
      ${whereClause}
      ORDER BY pr.received_on DESC, pr.code DESC;
    `;

    return rows.map((row): PaymentReceiptDto => {
      const amountPaise = toSafePaise(row['amountPaise'], 'amountPaise');
      const allocatedPaise = toSafePaise(row['allocatedPaise'], 'allocatedPaise');
      const allocations: PaymentAllocationDto[] = asRecordArray(row['allocations']).map((allocation) => ({
        allocationId: String(allocation['allocationId']),
        source: allocation['source'] as PaymentAllocationDto['source'],
        invoiceId: String(allocation['invoiceId']),
        invoiceCode: String(allocation['invoiceCode']),
        amountPaise: toSafePaise(allocation['amountPaise'], 'amountPaise'),
      }));
      return {
        id: String(row['id']),
        code: String(row['code']),
        clientId: String(row['clientId']),
        clientCode: String(row['clientCode']),
        clientName: String(row['clientName']),
        receivedOn: String(row['receivedOn']),
        amountPaise,
        method: row['method'] as PaymentReceiptDto['method'],
        reference: nullableText(row['reference']),
        notes: nullableText(row['notes']),
        status: row['status'] as PaymentReceiptDto['status'],
        voidReason: nullableText(row['voidReason']),
        voidedAt: row['voidedAt'] ? toIsoString(row['voidedAt']) : null,
        allocatedPaise,
        unallocatedPaise: amountPaise - allocatedPaise,
        allocations,
        createdAt: toIsoString(row['createdAt']),
      };
    });
  }

  async listPaymentReceipts(ctx: RepositoryContext): Promise<PaymentReceiptDto[]> {
    try {
      return await this.runner.withUserContext(ctx, (tx) => this.queryPaymentReceiptDtos(tx));
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Vyapar bills and payments (FEE-01a) ---

  // Shared idempotency wrapper: advisory lock, request-hash replay, receipt stored in the same
  // transaction as the work. Mirrors mutateEngagement.
  private async runIdempotent<T>(
    tx: postgres.TransactionSql,
    ctx: RepositoryContext,
    idempotencyKey: string,
    operationType: string,
    payload: unknown,
    work: () => Promise<{ result: T; isDemo: boolean }>,
  ): Promise<T> {
    const trimmedKey = idempotencyKey.trim();
    if (trimmedKey.length < 1 || trimmedKey.length > 255) {
      throw new ApiError(422, 'validation_failed', 'idempotencyKey must be between 1 and 255 characters.');
    }

    const lockStr = `${ctx.actorId}:${trimmedKey}`;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${lockStr}))`;

    const requestHash = computeRequestHash(payload);
    const receiptRows = await tx`
      SELECT operation_type, request_hash, result
      FROM public.operation_receipts
      WHERE actor_id = ${ctx.actorId}::uuid
        AND idempotency_key = ${trimmedKey};
    `;
    if (receiptRows.length > 0) {
      const receipt = receiptRows[0]!;
      if (receipt['operation_type'] !== operationType || receipt['request_hash'] !== requestHash) {
        throw new ApiError(
          409,
          'conflict',
          'Idempotency key was previously used with a different operation or payload.',
        );
      }
      return receipt['result'] as T;
    }

    const { result, isDemo } = await work();

    await tx`
      INSERT INTO public.operation_receipts (
        actor_id, idempotency_key, operation_type, request_hash, result, is_demo
      ) VALUES (
        ${ctx.actorId}::uuid,
        ${trimmedKey},
        ${operationType},
        ${requestHash},
        ${tx.json(result as unknown as postgres.JSONValue)},
        ${isDemo}
      );
    `;
    return result;
  }

  async recordVyaparBill(ctx: RepositoryContext, command: RecordVyaparBillCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    const vyaparBillNumber = command.vyaparBillNumber.trim();
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<InvoiceDto>(tx, ctx, idempotencyKey, 'recordVyaparBill', payload, async () => {
          const clientRows = await tx`
            SELECT is_demo FROM public.clients WHERE id = ${command.clientId}::uuid;
          `;
          if (clientRows.length === 0) throw notFound('Client');
          // Records inherit is_demo from their client
          const isDemo = Boolean(clientRows[0]!['is_demo']);

          // Two writes must never spend the same credit, so take the client's credit lock first
          if (command.applyCredit === true) await this.lockClientCredit(tx, command.clientId);

          const duplicates = await tx`
            SELECT 1
            FROM public.invoices
            WHERE upper(btrim(vyapar_bill_number)) = ${vyaparBillNumber.toUpperCase()}
              AND public.financial_year_start(issue_date) = ${financialYearStart(command.billDate)}
              AND status <> 'voided'
            LIMIT 1;
          `;
          if (duplicates.length > 0) throw duplicateVyaparBill(vyaparBillNumber, command.billDate);

          const invoiceId = crypto.randomUUID();
          await tx`
            INSERT INTO public.invoices (
              id, client_id, issue_date, due_date, vyapar_bill_number, created_by, is_demo
            ) VALUES (
              ${invoiceId}::uuid,
              ${command.clientId}::uuid,
              ${command.billDate}::date,
              ${command.dueDate}::date,
              ${vyaparBillNumber},
              ${ctx.actorId}::uuid,
              ${isDemo}
            );
          `;
          await tx`
            INSERT INTO public.invoice_items (
              invoice_id, description, quantity, unit_price, tax_rate, is_demo
            ) VALUES (
              ${invoiceId}::uuid,
              ${command.description.trim()},
              1,
              ${command.amountPaise}::bigint::numeric / 100,
              0,
              ${isDemo}
            );
          `;
          await tx`
            UPDATE public.invoices SET status = 'issued'::public.invoice_status
            WHERE id = ${invoiceId}::uuid;
          `;
          if (command.applyCredit === true) {
            await this.spendClientCredit(tx, ctx, invoiceId, command.clientId, isDemo);
          }

          const created = (await this.queryInvoiceDtos(tx, invoiceId))[0];
          if (!created) {
            throw new ApiError(500, 'internal_error', 'Recorded bill could not be retrieved.');
          }
          return { result: created, isDemo };
        }),
      );
    } catch (error) {
      const pgErr = error as { code?: string; constraint_name?: string };
      if (pgErr?.code === '23505' && pgErr.constraint_name === 'invoices_vyapar_bill_fy_uidx') {
        throw duplicateVyaparBill(vyaparBillNumber, command.billDate);
      }
      sanitizeDatabaseError(error);
    }
  }

  async recordPayment(ctx: RepositoryContext, command: RecordPaymentCommand): Promise<PaymentReceiptDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<PaymentReceiptDto>(tx, ctx, idempotencyKey, 'recordPayment', payload, async () => {
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${command.invoiceId}`}))`;
          const invoiceRows = await tx`
            SELECT
              i.client_id,
              i.status,
              i.is_demo,
              round((i.total_amount - i.amount_received) * 100)::bigint AS balance_paise
            FROM public.invoices i
            WHERE i.id = ${command.invoiceId}::uuid;
          `;
          const invoice = invoiceRows[0];
          if (!invoice) throw notFound('Invoice');
          if (invoice['status'] !== 'issued' && invoice['status'] !== 'part_paid') throw billNotOpen();
          const balancePaise = toSafePaise(invoice['balance_paise'], 'balance_paise');
          // An overpayment is kept: the receipt is for the full amount, the rest stays as client credit
          const allocatedPaise = Math.min(command.amountPaise, balancePaise);

          const isDemo = Boolean(invoice['is_demo']);
          const receiptId = crypto.randomUUID();
          await tx`
            INSERT INTO public.payment_receipts (
              id, client_id, received_on, amount, method, reference, notes, created_by, is_demo
            ) VALUES (
              ${receiptId}::uuid,
              ${String(invoice['client_id'])}::uuid,
              ${command.receivedOn}::date,
              ${command.amountPaise}::bigint::numeric / 100,
              ${command.method}::public.payment_method,
              ${command.reference?.trim() || null},
              ${command.notes?.trim() || null},
              ${ctx.actorId}::uuid,
              ${isDemo}
            );
          `;
          await tx`
            INSERT INTO public.payment_allocations (
              receipt_id, invoice_id, amount, created_by, is_demo
            ) VALUES (
              ${receiptId}::uuid,
              ${command.invoiceId}::uuid,
              ${allocatedPaise}::bigint::numeric / 100,
              ${ctx.actorId}::uuid,
              ${isDemo}
            );
          `;

          const created = (await this.queryPaymentReceiptDtos(tx, receiptId))[0];
          if (!created) {
            throw new ApiError(500, 'internal_error', 'Recorded payment could not be retrieved.');
          }
          return { result: created, isDemo };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async voidInvoice(ctx: RepositoryContext, command: VoidFeeRecordCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<InvoiceDto>(tx, ctx, idempotencyKey, 'voidInvoice', payload, async () => {
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${command.id}`}))`;
          const rows = await tx`
            SELECT status, is_demo, round(amount_received * 100)::bigint AS received_paise
            FROM public.invoices
            WHERE id = ${command.id}::uuid;
          `;
          const invoice = rows[0];
          if (!invoice) throw notFound('Invoice');
          if (invoice['status'] === 'voided') throw alreadyVoided();
          if (toSafePaise(invoice['received_paise'], 'received_paise') > 0) throw billHasPayments();

          const voidedRows = await tx`
            UPDATE public.invoices
            SET status = 'voided'::public.invoice_status,
                void_reason = ${command.reason.trim()}
            WHERE id = ${command.id}::uuid
            RETURNING id;
          `;
          // Row-level security silently skips an update the actor may not make
          if (voidedRows.length === 0) throw new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
          const voided = (await this.queryInvoiceDtos(tx, command.id))[0];
          if (!voided) {
            throw new ApiError(500, 'internal_error', 'Cancelled bill could not be retrieved.');
          }
          return { result: voided, isDemo: Boolean(invoice['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async voidPaymentReceipt(ctx: RepositoryContext, command: VoidFeeRecordCommand): Promise<PaymentReceiptDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<PaymentReceiptDto>(tx, ctx, idempotencyKey, 'voidPaymentReceipt', payload, async () => {
          const rows = await tx`
            SELECT status, is_demo FROM public.payment_receipts WHERE id = ${command.id}::uuid;
          `;
          const receipt = rows[0];
          if (!receipt) throw notFound('Payment receipt');
          if (receipt['status'] === 'voided') throw alreadyVoided();

          // Lock the bills this payment settles, in a stable order, before changing it
          const allocations = await tx`
            SELECT DISTINCT invoice_id FROM public.payment_allocations
            WHERE receipt_id = ${command.id}::uuid
            ORDER BY invoice_id;
          `;
          for (const allocation of allocations) {
            await tx`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${String(allocation['invoice_id'])}`}))`;
          }

          const voidedRows = await tx`
            UPDATE public.payment_receipts
            SET status = 'voided'::public.payment_status,
                void_reason = ${command.reason.trim()}
            WHERE id = ${command.id}::uuid
            RETURNING id;
          `;
          // Row-level security silently skips an update the actor may not make
          if (voidedRows.length === 0) throw new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
          const voided = (await this.queryPaymentReceiptDtos(tx, command.id))[0];
          if (!voided) {
            throw new ApiError(500, 'internal_error', 'Cancelled payment could not be retrieved.');
          }
          return { result: voided, isDemo: Boolean(receipt['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Client credit (FEE-02a) ---

  // --- Client documents (DOC-01a) ---
  // Row-level security limits every read and write to clients the actor looks after; the files
  // themselves are uploaded and downloaded by the browser straight to Storage.

  private async queryDocumentDtos(
    tx: SqlClient,
    filter: { readonly id?: string; readonly clientId?: string; readonly availableOnly?: boolean },
  ): Promise<ClientDocumentDto[]> {
    const rows = await tx`
      SELECT
        d.id,
        d.client_id AS "clientId",
        c.code AS "clientCode",
        c.display_name AS "clientName",
        d.title,
        d.category,
        d.financial_year_start AS "financialYearStart",
        d.file_name AS "fileName",
        d.mime_type AS "mimeType",
        d.size_bytes AS "sizeBytes",
        d.status,
        d.storage_path AS "storagePath",
        d.created_by AS "uploadedById",
        p.full_name AS "uploadedByName",
        d.created_at AS "createdAt",
        d.removed_reason AS "removedReason",
        d.removed_at AS "removedAt"
      FROM public.client_documents d
      JOIN public.clients c ON c.id = d.client_id
      JOIN public.profiles p ON p.user_id = d.created_by
      WHERE (${filter.id ?? null}::uuid IS NULL OR d.id = ${filter.id ?? null}::uuid)
        AND (${filter.clientId ?? null}::uuid IS NULL OR d.client_id = ${filter.clientId ?? null}::uuid)
        AND (${filter.availableOnly === true}::boolean = false OR d.status = 'available')
      ORDER BY d.created_at DESC, d.id DESC;
    `;
    return rows.map((row) => ({
      id: String(row['id']),
      clientId: String(row['clientId']),
      clientCode: String(row['clientCode']),
      clientName: String(row['clientName']),
      title: String(row['title']),
      category: row['category'] as ClientDocumentDto['category'],
      financialYearStart: row['financialYearStart'] === null ? null : Number(row['financialYearStart']),
      fileName: String(row['fileName']),
      mimeType: String(row['mimeType']),
      sizeBytes: toSafePaise(row['sizeBytes'], 'size_bytes'),
      status: row['status'] as ClientDocumentDto['status'],
      storagePath: String(row['storagePath']),
      uploadedById: String(row['uploadedById']),
      uploadedByName: String(row['uploadedByName']),
      createdAt: toIsoString(row['createdAt']),
      removedReason: nullableText(row['removedReason']),
      removedAt: row['removedAt'] === null ? null : toIsoString(row['removedAt']),
    }));
  }

  async listClientDocuments(ctx: RepositoryContext, clientId?: string): Promise<ClientDocumentDto[]> {
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.queryDocumentDtos(tx, { availableOnly: true, ...(clientId !== undefined ? { clientId } : {}) }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async createClientDocument(ctx: RepositoryContext, command: CreateDocumentCommand): Promise<ClientDocumentDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<ClientDocumentDto>(tx, ctx, idempotencyKey, 'createClientDocument', payload, async () => {
          const clientRows = await tx`
            SELECT is_demo, public.looks_after_client(id) AS looks_after
            FROM public.clients
            WHERE id = ${command.clientId}::uuid;
          `;
          const client = clientRows[0];
          if (!client || client['looks_after'] !== true) throw notFound('Client');

          const documentId = crypto.randomUUID();
          const storagePath = documentStoragePath(command.clientId, documentId, command.fileName);
          // is_demo is inherited from the client by the document's insert trigger
          await tx`
            INSERT INTO public.client_documents (
              id, client_id, title, category, financial_year_start, file_name, mime_type,
              size_bytes, storage_path, created_by
            ) VALUES (
              ${documentId}::uuid,
              ${command.clientId}::uuid,
              ${command.title},
              ${command.category},
              ${command.financialYearStart ?? null}::smallint,
              ${command.fileName},
              ${command.mimeType},
              ${command.sizeBytes}::bigint,
              ${storagePath},
              ${ctx.actorId}::uuid
            );
          `;
          const created = (await this.queryDocumentDtos(tx, { id: documentId }))[0];
          if (!created) {
            throw new ApiError(500, 'internal_error', 'Created document could not be retrieved.');
          }
          return { result: created, isDemo: Boolean(client['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async confirmClientDocument(ctx: RepositoryContext, command: ConfirmDocumentCommand): Promise<ClientDocumentDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<ClientDocumentDto>(tx, ctx, idempotencyKey, 'confirmClientDocument', payload, async () => {
          const rows = await tx`
            SELECT status, created_by, is_demo
            FROM public.client_documents
            WHERE id = ${command.id}::uuid
            FOR UPDATE;
          `;
          const document = rows[0];
          if (!document) throw notFound('Document');
          if (String(document['created_by']) !== ctx.actorId) throw this.forbiddenOperation();
          if (document['status'] !== 'pending') throw documentNotConfirmable();

          const sizeRows = await tx`SELECT public.document_object_size(${command.id}::uuid) AS size;`;
          const rawSize = sizeRows[0]?.['size'];
          if (rawSize === null || rawSize === undefined) throw uploadMissing();
          const size = toSafePaise(rawSize, 'size');
          if (size > DOCUMENT_MAX_BYTES) throw fileTooLarge();

          const updated = await tx`
            UPDATE public.client_documents
            SET status = 'available', size_bytes = ${size}::bigint
            WHERE id = ${command.id}::uuid
            RETURNING id;
          `;
          // Row-level security silently skips an update the actor may not make
          if (updated.length === 0) throw this.forbiddenOperation();
          const confirmed = (await this.queryDocumentDtos(tx, { id: command.id }))[0];
          if (!confirmed) {
            throw new ApiError(500, 'internal_error', 'Confirmed document could not be retrieved.');
          }
          return { result: confirmed, isDemo: Boolean(document['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async removeClientDocument(ctx: RepositoryContext, command: RemoveDocumentCommand): Promise<ClientDocumentDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<ClientDocumentDto>(tx, ctx, idempotencyKey, 'removeClientDocument', payload, async () => {
          const rows = await tx`
            SELECT status, is_demo
            FROM public.client_documents
            WHERE id = ${command.id}::uuid
            FOR UPDATE;
          `;
          const document = rows[0];
          if (!document) throw notFound('Document');
          if (document['status'] === 'removed') throw alreadyRemoved();
          if (document['status'] !== 'available') throw documentNotRemovable();

          // The guard trigger records who removed it and when
          const updated = await tx`
            UPDATE public.client_documents
            SET status = 'removed', removed_reason = ${command.reason}
            WHERE id = ${command.id}::uuid
            RETURNING id;
          `;
          if (updated.length === 0) throw this.forbiddenOperation();
          const removed = (await this.queryDocumentDtos(tx, { id: command.id }))[0];
          if (!removed) {
            throw new ApiError(500, 'internal_error', 'Removed document could not be retrieved.');
          }
          return { result: removed, isDemo: Boolean(document['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  // --- Client messages (MSG-01) ---
  // Row-level security limits reads and writes to clients the actor looks after. Messages are
  // append-only; the insert trigger inherits is_demo from the client.

  private async queryMessageDtos(
    tx: SqlClient,
    filter: { readonly id?: string; readonly clientId?: string },
  ): Promise<ClientMessageDto[]> {
    const rows = await tx`
      SELECT
        m.id,
        m.client_id AS "clientId",
        c.code AS "clientCode",
        c.display_name AS "clientName",
        m.contact_id AS "contactId",
        m.recipient_name AS "recipientName",
        m.recipient_number AS "recipientNumber",
        m.channel,
        m.purpose,
        m.assignment_id AS "assignmentId",
        a.code AS "assignmentCode",
        m.invoice_id AS "invoiceId",
        coalesce(i.vyapar_bill_number, i.code) AS "invoiceLabel",
        m.body,
        m.status,
        m.created_by AS "sentById",
        p.full_name AS "sentByName",
        m.created_at AS "createdAt"
      FROM public.client_messages m
      JOIN public.clients c ON c.id = m.client_id
      JOIN public.profiles p ON p.user_id = m.created_by
      LEFT JOIN public.assignments a ON a.id = m.assignment_id
      LEFT JOIN public.invoices i ON i.id = m.invoice_id
      WHERE (${filter.id ?? null}::uuid IS NULL OR m.id = ${filter.id ?? null}::uuid)
        AND (${filter.clientId ?? null}::uuid IS NULL OR m.client_id = ${filter.clientId ?? null}::uuid)
      ORDER BY m.created_at DESC, m.id DESC;
    `;
    return rows.map((row) => ({
      id: String(row['id']),
      clientId: String(row['clientId']),
      clientCode: String(row['clientCode']),
      clientName: String(row['clientName']),
      contactId: nullableText(row['contactId']),
      recipientName: String(row['recipientName']),
      recipientNumber: String(row['recipientNumber']),
      channel: row['channel'] as ClientMessageDto['channel'],
      purpose: row['purpose'] as ClientMessageDto['purpose'],
      assignmentId: nullableText(row['assignmentId']),
      assignmentCode: nullableText(row['assignmentCode']),
      invoiceId: nullableText(row['invoiceId']),
      invoiceLabel: nullableText(row['invoiceLabel']),
      body: String(row['body']),
      status: row['status'] as ClientMessageDto['status'],
      sentById: String(row['sentById']),
      sentByName: String(row['sentByName']),
      createdAt: toIsoString(row['createdAt']),
    }));
  }

  async listClientMessages(ctx: RepositoryContext, clientId?: string): Promise<ClientMessageDto[]> {
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.queryMessageDtos(tx, clientId !== undefined ? { clientId } : {}),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async recordClientMessage(ctx: RepositoryContext, command: RecordClientMessageCommand): Promise<ClientMessageDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<ClientMessageDto>(tx, ctx, idempotencyKey, 'recordClientMessage', payload, async () => {
          const clientRows = await tx`
            SELECT is_demo, public.looks_after_client(id) AS looks_after
            FROM public.clients
            WHERE id = ${command.clientId}::uuid;
          `;
          const client = clientRows[0];
          if (!client || client['looks_after'] !== true) throw notFound('Client');

          if (command.contactId) {
            const rows = await tx`SELECT client_id FROM public.client_contacts WHERE id = ${command.contactId}::uuid;`;
            if (!rows[0] || String(rows[0]['client_id']) !== command.clientId) throw contactNotOfClient();
          }
          if (command.assignmentId) {
            const rows = await tx`SELECT client_id FROM public.assignments WHERE id = ${command.assignmentId}::uuid;`;
            if (!rows[0] || String(rows[0]['client_id']) !== command.clientId) throw linkedWorkNotOfClient();
          }
          if (command.invoiceId) {
            const rows = await tx`SELECT client_id FROM public.invoices WHERE id = ${command.invoiceId}::uuid;`;
            if (!rows[0] || String(rows[0]['client_id']) !== command.clientId) throw linkedWorkNotOfClient();
          }

          const messageId = crypto.randomUUID();
          // is_demo is inherited from the client by the message's insert trigger
          await tx`
            INSERT INTO public.client_messages (
              id, client_id, contact_id, recipient_name, recipient_number, channel, purpose,
              assignment_id, invoice_id, body, status, created_by
            ) VALUES (
              ${messageId}::uuid,
              ${command.clientId}::uuid,
              ${command.contactId ?? null}::uuid,
              ${command.recipientName},
              ${command.recipientNumber},
              'whatsapp',
              ${command.purpose},
              ${command.assignmentId ?? null}::uuid,
              ${command.invoiceId ?? null}::uuid,
              ${command.body},
              'opened',
              ${ctx.actorId}::uuid
            );
          `;
          const created = (await this.queryMessageDtos(tx, { id: messageId }))[0];
          if (!created) {
            throw new ApiError(500, 'internal_error', 'Recorded message could not be retrieved.');
          }
          return { result: created, isDemo: Boolean(client['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  private async lockClientCredit(tx: postgres.TransactionSql, clientId: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`client-credit:${clientId}`}))`;
  }

  // Spends the client's credit on one open bill, oldest receipt first. The caller holds the client
  // credit lock. Returns how many paise were applied.
  private async spendClientCredit(
    tx: postgres.TransactionSql,
    ctx: RepositoryContext,
    invoiceId: string,
    clientId: string,
    isDemo: boolean,
  ): Promise<number> {
    const invoiceRows = await tx`
      SELECT round((i.total_amount - i.amount_received) * 100)::bigint AS pending_paise
      FROM public.invoices i
      WHERE i.id = ${invoiceId}::uuid;
    `;
    let pendingPaise = toSafePaise(invoiceRows[0]?.['pending_paise'] ?? 0, 'pending_paise');
    if (pendingPaise <= 0) return 0;

    const receipts = await tx`
      SELECT
        pr.id,
        round((pr.amount - COALESCE(alloc.total, 0)) * 100)::bigint AS unallocated_paise
      FROM public.payment_receipts pr
      LEFT JOIN LATERAL (
        SELECT sum(pa.amount) AS total FROM public.payment_allocations pa WHERE pa.receipt_id = pr.id
      ) alloc ON true
      WHERE pr.client_id = ${clientId}::uuid
        AND pr.status = 'received'
        AND pr.amount > COALESCE(alloc.total, 0)
        AND NOT EXISTS (
          SELECT 1 FROM public.payment_allocations pa
          WHERE pa.receipt_id = pr.id AND pa.invoice_id = ${invoiceId}::uuid
        )
      ORDER BY pr.received_on, pr.code;
    `;

    let appliedPaise = 0;
    for (const receipt of receipts) {
      if (pendingPaise <= 0) break;
      const takePaise = Math.min(pendingPaise, toSafePaise(receipt['unallocated_paise'], 'unallocated_paise'));
      await tx`
        INSERT INTO public.payment_allocations (
          receipt_id, invoice_id, amount, source, created_by, is_demo
        ) VALUES (
          ${String(receipt['id'])}::uuid,
          ${invoiceId}::uuid,
          ${takePaise}::bigint::numeric / 100,
          'credit',
          ${ctx.actorId}::uuid,
          ${isDemo}
        );
      `;
      pendingPaise -= takePaise;
      appliedPaise += takePaise;
    }
    return appliedPaise;
  }

  async applyCredit(ctx: RepositoryContext, command: ApplyCreditCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<InvoiceDto>(tx, ctx, idempotencyKey, 'applyCredit', payload, async () => {
          const found = await tx`
            SELECT client_id, is_demo FROM public.invoices WHERE id = ${command.invoiceId}::uuid;
          `;
          const invoice = found[0];
          if (!invoice) throw notFound('Invoice');
          const clientId = String(invoice['client_id']);

          // Client credit lock first, then the bill lock; recordPayment and the void paths only take bill locks
          await this.lockClientCredit(tx, clientId);
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${command.invoiceId}`}))`;
          const current = await tx`
            SELECT status FROM public.invoices WHERE id = ${command.invoiceId}::uuid;
          `;
          const status = current[0]?.['status'];
          if (status !== 'issued' && status !== 'part_paid') throw billNotOpen();

          const isDemo = Boolean(invoice['is_demo']);
          const appliedPaise = await this.spendClientCredit(tx, ctx, command.invoiceId, clientId, isDemo);
          if (appliedPaise <= 0) throw noCreditAvailable();

          const updated = (await this.queryInvoiceDtos(tx, command.invoiceId))[0];
          if (!updated) {
            throw new ApiError(500, 'internal_error', 'Bill could not be retrieved after using credit.');
          }
          return { result: updated, isDemo };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async removeCreditAllocation(ctx: RepositoryContext, command: RemoveCreditAllocationCommand): Promise<InvoiceDto> {
    const { idempotencyKey, ...payload } = command;
    try {
      return await this.runner.withUserContext(ctx, (tx) =>
        this.runIdempotent<InvoiceDto>(tx, ctx, idempotencyKey, 'removeCreditAllocation', payload, async () => {
          const found = await tx`
            SELECT pa.source, pa.invoice_id, pa.is_demo, pr.client_id
            FROM public.payment_allocations pa
            JOIN public.payment_receipts pr ON pr.id = pa.receipt_id
            WHERE pa.id = ${command.allocationId}::uuid;
          `;
          const allocation = found[0];
          if (!allocation) throw notFound('Payment allocation');
          if (allocation['source'] !== 'credit') throw notCreditAllocation();
          const invoiceId = String(allocation['invoice_id']);

          await this.lockClientCredit(tx, String(allocation['client_id']));
          await tx`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
          const removed = await tx`
            DELETE FROM public.payment_allocations
            WHERE id = ${command.allocationId}::uuid AND source = 'credit'
            RETURNING id;
          `;
          if (removed.length === 0) {
            // Row-level security silently skips a delete the actor may not make; otherwise it was already removed
            const stillThere = await tx`
              SELECT 1 FROM public.payment_allocations WHERE id = ${command.allocationId}::uuid;
            `;
            if (stillThere.length > 0) {
              throw new ApiError(403, 'forbidden', 'You do not have permission to perform this operation.');
            }
            throw notFound('Payment allocation');
          }

          const updated = (await this.queryInvoiceDtos(tx, invoiceId))[0];
          if (!updated) {
            throw new ApiError(500, 'internal_error', 'Bill could not be retrieved after removing credit.');
          }
          return { result: updated, isDemo: Boolean(allocation['is_demo']) };
        }),
      );
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listEngagements(ctx: RepositoryContext): Promise<EngagementDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        // Single query with LEFT JOIN to approved version — no N+1
        const rows = await tx`
          SELECT
            e.id,
            e.code,
            e.client_id AS "clientId",
            c.display_name AS "clientName",
            e.service_id AS "serviceId",
            s.name AS "serviceName",
            e.status,
            e.approved_version_id AS "approvedVersionId",
            e.approved_at AS "approvedAt",
            e.approved_by AS "approvedById",
            e.ended_at AS "endedAt",
            e.ended_by AS "endedById",
            e.end_outcome AS "endOutcome",
            e.end_reason AS "endReason",
            e.created_by AS "createdById",
            e.created_at AS "createdAt",
            e.updated_at AS "updatedAt",
            ev.id AS "av_id",
            ev.engagement_id AS "av_engagementId",
            ev.version_number AS "av_versionNumber",
            ev.title AS "av_title",
            ev.scope AS "av_scope",
            ev.exclusions AS "av_exclusions",
            ev.responsible_partner_id AS "av_responsiblePartnerId",
            p_partner.full_name AS "av_responsiblePartnerName",
            ev.delivery_manager_id AS "av_deliveryManagerId",
            p_mgr.full_name AS "av_deliveryManagerName",
            ev.fee_model AS "av_feeModel",
            ev.agreed_fee_paise AS "av_agreedFeePaise",
            ev.billing_terms AS "av_billingTerms",
            ev.start_date::text AS "av_startDate",
            ev.end_date::text AS "av_endDate",
            ev.approved_at AS "av_approvedAt",
            ev.approved_by AS "av_approvedById",
            ev.created_by AS "av_createdById",
            ev.created_at AS "av_createdAt"
          FROM public.engagements e
          JOIN public.clients c ON c.id = e.client_id
          JOIN public.service_catalog s ON s.id = e.service_id
          LEFT JOIN public.engagement_versions ev ON ev.id = e.approved_version_id
          LEFT JOIN public.profiles p_partner ON p_partner.user_id = ev.responsible_partner_id
          LEFT JOIN public.profiles p_mgr ON p_mgr.user_id = ev.delivery_manager_id
          ORDER BY e.created_at DESC;
        `;

        return rows.map((row) => {
          let approvedVersion: EngagementVersionDto | null = null;
          if (row['approvedVersionId'] && row['av_id']) {
            approvedVersion = {
              id: String(row['av_id']),
              engagementId: String(row['av_engagementId']),
              versionNumber: Number(row['av_versionNumber']),
              title: String(row['av_title']),
              scope: String(row['av_scope']),
              exclusions: row['av_exclusions'] !== null && row['av_exclusions'] !== undefined ? String(row['av_exclusions']) : null,
              responsiblePartnerId: String(row['av_responsiblePartnerId']),
              responsiblePartnerName: row['av_responsiblePartnerName'] ? String(row['av_responsiblePartnerName']) : undefined,
              deliveryManagerId: String(row['av_deliveryManagerId']),
              deliveryManagerName: row['av_deliveryManagerName'] ? String(row['av_deliveryManagerName']) : undefined,
              feeModel: row['av_feeModel'] as EngagementVersionDto['feeModel'],
              agreedFeePaise: Number(row['av_agreedFeePaise']),
              billingTerms: String(row['av_billingTerms']),
              startDate: String(row['av_startDate']),
              endDate: row['av_endDate'] !== null && row['av_endDate'] !== undefined ? String(row['av_endDate']) : null,
              approvedAt: row['av_approvedAt'] ? toIsoString(row['av_approvedAt']) : null,
              approvedById: row['av_approvedById'] ? String(row['av_approvedById']) : null,
              createdById: String(row['av_createdById']),
              createdAt: toIsoString(row['av_createdAt']),
            };
          }
          return {
            id: String(row['id']),
            code: String(row['code']),
            clientId: String(row['clientId']),
            clientName: row['clientName'] ? String(row['clientName']) : undefined,
            serviceId: String(row['serviceId']),
            serviceName: row['serviceName'] ? String(row['serviceName']) : null,
            status: row['status'] as EngagementDto['status'],
            approvedVersionId: row['approvedVersionId'] ? String(row['approvedVersionId']) : null,
            approvedVersion,
            approvedAt: row['approvedAt'] ? toIsoString(row['approvedAt']) : null,
            approvedById: row['approvedById'] ? String(row['approvedById']) : null,
            endedAt: row['endedAt'] ? toIsoString(row['endedAt']) : null,
            endedById: row['endedById'] ? String(row['endedById']) : null,
            endOutcome: row['endOutcome'] ? (row['endOutcome'] as EngagementDto['endOutcome']) : null,
            endReason: row['endReason'] ? String(row['endReason']) : null,
            createdById: String(row['createdById']),
            createdAt: toIsoString(row['createdAt']),
            updatedAt: toIsoString(row['updatedAt']),
          };
        });
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listEngagementVersions(ctx: RepositoryContext, engagementId: string): Promise<EngagementVersionDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const rows = await tx`
          SELECT
            ev.id,
            ev.engagement_id AS "engagementId",
            ev.version_number AS "versionNumber",
            ev.title,
            ev.scope,
            ev.exclusions,
            ev.responsible_partner_id AS "responsiblePartnerId",
            p_partner.full_name AS "responsiblePartnerName",
            ev.delivery_manager_id AS "deliveryManagerId",
            p_mgr.full_name AS "deliveryManagerName",
            ev.fee_model AS "feeModel",
            ev.agreed_fee_paise AS "agreedFeePaise",
            ev.billing_terms AS "billingTerms",
            ev.start_date::text AS "startDate",
            ev.end_date::text AS "endDate",
            ev.approved_at AS "approvedAt",
            ev.approved_by AS "approvedById",
            ev.created_by AS "createdById",
            ev.created_at AS "createdAt"
          FROM public.engagement_versions ev
          LEFT JOIN public.profiles p_partner ON p_partner.user_id = ev.responsible_partner_id
          LEFT JOIN public.profiles p_mgr ON p_mgr.user_id = ev.delivery_manager_id
          WHERE ev.engagement_id = ${engagementId}::uuid
          ORDER BY ev.version_number ASC;
        `;

        return rows.map((row) => ({
          id: String(row['id']),
          engagementId: String(row['engagementId']),
          versionNumber: Number(row['versionNumber']),
          title: String(row['title']),
          scope: String(row['scope']),
          exclusions: row['exclusions'] !== null && row['exclusions'] !== undefined ? String(row['exclusions']) : null,
          responsiblePartnerId: String(row['responsiblePartnerId']),
          responsiblePartnerName: row['responsiblePartnerName'] ? String(row['responsiblePartnerName']) : undefined,
          deliveryManagerId: String(row['deliveryManagerId']),
          deliveryManagerName: row['deliveryManagerName'] ? String(row['deliveryManagerName']) : undefined,
          feeModel: row['feeModel'] as EngagementVersionDto['feeModel'],
          agreedFeePaise: Number(row['agreedFeePaise']),
          billingTerms: String(row['billingTerms']),
          startDate: String(row['startDate']),
          endDate: row['endDate'] !== null && row['endDate'] !== undefined ? String(row['endDate']) : null,
          approvedAt: row['approvedAt'] ? toIsoString(row['approvedAt']) : null,
          approvedById: row['approvedById'] ? String(row['approvedById']) : null,
          createdById: String(row['createdById']),
          createdAt: toIsoString(row['createdAt']),
        }));
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async mutateEngagement(ctx: RepositoryContext, command: MutateEngagementCommand): Promise<EngagementDto> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        const trimmedKey = command.idempotencyKey.trim();
        if (trimmedKey.length < 1 || trimmedKey.length > 255) {
          throw new ApiError(422, 'validation_failed', 'idempotencyKey must be between 1 and 255 characters.');
        }

        // Transaction-scoped advisory xact lock based on actor + idempotencyKey
        const lockStr = `${ctx.actorId}:${trimmedKey}`;
        await tx`SELECT pg_advisory_xact_lock(hashtext(${lockStr}))`;

        // Strip idempotencyKey for canonical request payload hashing
        const { idempotencyKey: _, ...payload } = command;
        const requestHash = computeRequestHash(payload);

        // Lookup existing receipt
        const receiptRows = await tx`
          SELECT operation_type, request_hash, result
          FROM public.operation_receipts
          WHERE actor_id = ${ctx.actorId}::uuid
            AND idempotency_key = ${trimmedKey};
        `;

        if (receiptRows.length > 0) {
          const receipt = receiptRows[0]!;
          if (receipt['operation_type'] !== command.kind || receipt['request_hash'] !== requestHash) {
            throw new ApiError(
              409,
              'conflict',
              'Idempotency key was previously used with a different operation or payload.',
            );
          }
          return receipt['result'] as EngagementDto;
        }

        let result: EngagementDto;

        switch (command.kind) {
          case 'createDraft': {
            const engId = crypto.randomUUID();
            const verId = crypto.randomUUID();

            // Derive is_demo from the client row — real clients are false, demo clients are true
            const clientDemoRows = await tx`
              SELECT is_demo FROM public.clients WHERE id = ${command.clientId}::uuid;
            `;
            const clientIsDemo = clientDemoRows.length > 0 ? Boolean(clientDemoRows[0]!['is_demo']) : false;

            await tx`
              INSERT INTO public.engagements (
                id, client_id, service_id, status, is_demo
              ) VALUES (
                ${engId}::uuid,
                ${command.clientId}::uuid,
                ${command.serviceId}::uuid,
                'draft'::public.engagement_status,
                ${clientIsDemo}
              );
            `;

            await tx`
              INSERT INTO public.engagement_versions (
                id, engagement_id, version_number, title, scope, exclusions,
                responsible_partner_id, delivery_manager_id, fee_model,
                agreed_fee_paise, billing_terms, start_date, end_date, is_demo
              ) VALUES (
                ${verId}::uuid,
                ${engId}::uuid,
                1,
                ${command.title.trim()},
                ${command.scope.trim()},
                ${command.exclusions ? command.exclusions.trim() : null},
                ${command.responsiblePartnerId}::uuid,
                ${command.deliveryManagerId}::uuid,
                ${command.feeModel}::public.engagement_fee_model,
                ${command.agreedFeePaise},
                ${command.billingTerms.trim()},
                ${command.startDate}::date,
                ${command.endDate ? command.endDate : null}::date,
                ${clientIsDemo}
              );
            `;

            const created = await this.fetchEngagementDto(tx, engId);
            if (!created) {
              throw new ApiError(500, 'internal_error', 'Created engagement could not be retrieved.');
            }
            result = created;
            break;
          }

          case 'reviseDraft': {
            const updateParent = await tx`
              UPDATE public.engagements
              SET updated_at = now()
              WHERE id = ${command.engagementId}::uuid
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz)
              RETURNING id;
            `;

            if (updateParent.length === 0) {
              const checkRows = await tx`
                SELECT updated_at FROM public.engagements WHERE id = ${command.engagementId}::uuid;
              `;
              if (checkRows.length === 0) {
                throw new ApiError(404, 'not_found', 'Engagement was not found.');
              }
              throw new ApiError(
                409,
                'optimistic_lock_conflict',
                'The resource was updated concurrently by another operation.',
              );
            }

            const updateVer = await tx`
              UPDATE public.engagement_versions
              SET title = ${command.title.trim()},
                  scope = ${command.scope.trim()},
                  exclusions = ${command.exclusions ? command.exclusions.trim() : null},
                  responsible_partner_id = ${command.responsiblePartnerId}::uuid,
                  delivery_manager_id = ${command.deliveryManagerId}::uuid,
                  fee_model = ${command.feeModel}::public.engagement_fee_model,
                  agreed_fee_paise = ${command.agreedFeePaise},
                  billing_terms = ${command.billingTerms.trim()},
                  start_date = ${command.startDate}::date,
                  end_date = ${command.endDate ? command.endDate : null}::date
              WHERE engagement_id = ${command.engagementId}::uuid
                AND version_number = 1
                AND approved_at IS NULL
              RETURNING id;
            `;

            if (updateVer.length === 0) {
              throw new ApiError(422, 'validation_failed', 'Draft version could not be updated or was already approved.');
            }

            const updated = await this.fetchEngagementDto(tx, command.engagementId);
            if (!updated) {
              throw new ApiError(404, 'not_found', 'Engagement was not found.');
            }
            result = updated;
            break;
          }

          case 'activate': {
            const approveVer = await tx`
              UPDATE public.engagement_versions
              SET approved_at = now(),
                  approved_by = ${ctx.actorId}::uuid
              WHERE id = ${command.versionId}::uuid
                AND engagement_id = ${command.engagementId}::uuid
              RETURNING id;
            `;

            if (approveVer.length === 0) {
              const verCheck = await tx`
                SELECT id FROM public.engagement_versions WHERE id = ${command.versionId}::uuid;
              `;
              if (verCheck.length === 0) {
                throw new ApiError(404, 'not_found', 'Approved version does not exist.');
              }
              throw new ApiError(422, 'validation_failed', 'Approved version does not belong to this engagement.');
            }

            const updateParent = await tx`
              UPDATE public.engagements
              SET status = 'active'::public.engagement_status,
                  approved_version_id = ${command.versionId}::uuid,
                  updated_at = now()
              WHERE id = ${command.engagementId}::uuid
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz)
              RETURNING id;
            `;

            if (updateParent.length === 0) {
              const checkRows = await tx`
                SELECT updated_at FROM public.engagements WHERE id = ${command.engagementId}::uuid;
              `;
              if (checkRows.length === 0) {
                throw new ApiError(404, 'not_found', 'Engagement was not found.');
              }
              throw new ApiError(
                409,
                'optimistic_lock_conflict',
                'The resource was updated concurrently by another operation.',
              );
            }

            const updated = await this.fetchEngagementDto(tx, command.engagementId);
            if (!updated) {
              throw new ApiError(404, 'not_found', 'Engagement was not found.');
            }
            result = updated;
            break;
          }

          case 'amend': {
            const parentLock = await tx`
              SELECT id, status, is_demo
              FROM public.engagements
              WHERE id = ${command.engagementId}::uuid
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz)
              FOR UPDATE;
            `;

            if (parentLock.length === 0) {
              const checkRows = await tx`
                SELECT updated_at FROM public.engagements WHERE id = ${command.engagementId}::uuid;
              `;
              if (checkRows.length === 0) {
                throw new ApiError(404, 'not_found', 'Engagement was not found.');
              }
              throw new ApiError(
                409,
                'optimistic_lock_conflict',
                'The resource was updated concurrently by another operation.',
              );
            }

            const parentRow = parentLock[0]!;
            if (parentRow['status'] !== 'active') {
              throw new ApiError(422, 'validation_failed', 'Cannot amend an engagement that is not active.');
            }

            const maxVerRows = await tx`
              SELECT coalesce(max(version_number), 0) AS max_v
              FROM public.engagement_versions
              WHERE engagement_id = ${command.engagementId}::uuid;
            `;
            const nextVersionNumber = Number(maxVerRows[0]?.['max_v'] ?? 0) + 1;
            const newVersionId = crypto.randomUUID();

            await tx`
              INSERT INTO public.engagement_versions (
                id, engagement_id, version_number, title, scope, exclusions,
                responsible_partner_id, delivery_manager_id, fee_model,
                agreed_fee_paise, billing_terms, start_date, end_date,
                approved_at, approved_by, is_demo
              ) VALUES (
                ${newVersionId}::uuid,
                ${command.engagementId}::uuid,
                ${nextVersionNumber},
                ${command.title.trim()},
                ${command.scope.trim()},
                ${command.exclusions ? command.exclusions.trim() : null},
                ${command.responsiblePartnerId}::uuid,
                ${command.deliveryManagerId}::uuid,
                ${command.feeModel}::public.engagement_fee_model,
                ${command.agreedFeePaise},
                ${command.billingTerms.trim()},
                ${command.startDate}::date,
                ${command.endDate ? command.endDate : null}::date,
                now(),
                ${ctx.actorId}::uuid,
                ${Boolean(parentRow['is_demo'])}
              );
            `;

            await tx`
              UPDATE public.engagements
              SET approved_version_id = ${newVersionId}::uuid,
                  updated_at = now()
              WHERE id = ${command.engagementId}::uuid;
            `;

            const updated = await this.fetchEngagementDto(tx, command.engagementId);
            if (!updated) {
              throw new ApiError(404, 'not_found', 'Engagement was not found.');
            }
            result = updated;
            break;
          }

          case 'end': {
            const updateRows = await tx`
              UPDATE public.engagements
              SET status = 'ended'::public.engagement_status,
                  end_outcome = ${command.outcome}::public.engagement_end_outcome,
                  end_reason = ${command.reason.trim()},
                  ended_at = now(),
                  ended_by = ${ctx.actorId}::uuid,
                  updated_at = now()
              WHERE id = ${command.engagementId}::uuid
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${command.expectedUpdatedAt}::timestamptz)
              RETURNING id;
            `;

            if (updateRows.length === 0) {
              const checkRows = await tx`
                SELECT updated_at FROM public.engagements WHERE id = ${command.engagementId}::uuid;
              `;
              if (checkRows.length === 0) {
                throw new ApiError(404, 'not_found', 'Engagement was not found.');
              }
              throw new ApiError(
                409,
                'optimistic_lock_conflict',
                'The resource was updated concurrently by another operation.',
              );
            }

            const updated = await this.fetchEngagementDto(tx, command.engagementId);
            if (!updated) {
              throw new ApiError(404, 'not_found', 'Engagement was not found.');
            }
            result = updated;
            break;
          }
        }

        // Atomically store operation receipt within the same transaction
        await tx`
          INSERT INTO public.operation_receipts (
            actor_id, idempotency_key, operation_type, request_hash, result, is_demo
          ) VALUES (
            ${ctx.actorId}::uuid,
            ${trimmedKey},
            ${command.kind},
            ${requestHash},
            ${tx.json(result as unknown as import('postgres').JSONValue)},
            (
              SELECT e.is_demo
              FROM public.engagements e
              WHERE e.id = ${result.id}::uuid
            )
          );
        `;

        return result;
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }
}
