import type {
  AssignmentDto,
  ClientDto,
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
  UpdateRecurringScheduleInput,
  WorkItemDto,
} from '@sn/contracts';
import { DEV_ACTOR_ALIASES } from './auth';
import { PostgresTransactionRunner, type SqlClient } from './db';
import { ApiError } from './errors';
import { maskGstinForRoutineRead, maskPanForRoutineRead } from './client-privacy';
import { isProductionEnvironment } from './http';
import { computeRequestHash } from './idempotency';
import type {
  ClientReference,
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
  MutateEngagementCommand,
  RepositoryContext,
  ServiceReference,
  UpdateAssignmentCommand,
  UpdateAssignmentReviewersCommand,
  UpdateAssignmentStatusCommand,
  UpdateWorkItemStatusCommand,
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

function mapClientRow(row: Record<string, unknown>): ClientDto {
  return {
    id: String(row['id']),
    code: String(row['code']),
    displayName: String(row['display_name']),
    legalName: row['legal_name'] ? String(row['legal_name']) : null,
    gstinMasked: maskGstinForRoutineRead(row['gstin'] ? String(row['gstin']) : null),
    panMasked: maskPanForRoutineRead(row['pan'] ? String(row['pan']) : null),
    email: row['email'] ? String(row['email']) : null,
    phone: row['phone'] ? String(row['phone']) : null,
    relationshipOwnerId: row['relationship_owner_id'] ? String(row['relationship_owner_id']) : null,
    relationshipOwnerName: row['relationship_owner_name'] ? String(row['relationship_owner_name']) : null,
    status: String(row['status']) as ClientStatus,
    notes: row['notes'] ? String(row['notes']) : null,
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

  // --- Clients (Read-Only) ---

  private async queryClientDtos(tx: SqlClient, clientId?: string): Promise<ClientDto[]> {
    const whereClause = clientId ? tx`WHERE c.id = ${clientId}::uuid` : tx``;
    const rows = await tx`
      SELECT
        c.id,
        c.code,
        c.display_name,
        c.legal_name,
        c.gstin,
        c.pan,
        c.email,
        c.phone,
        c.relationship_owner_id,
        p.full_name AS relationship_owner_name,
        c.status,
        c.notes,
        c.created_by,
        c.created_at,
        c.updated_at,
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
      ${whereClause}
      ORDER BY c.code ASC;
    `;
    return rows.map(mapClientRow);
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
            relationship_owner_id, notes, status, created_by
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
            ${ctx.actorId}::uuid
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
          WHERE id = ${serviceId}::uuid;
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
          WHERE name = ${serviceName};
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

  async listInvoices(ctx: RepositoryContext): Promise<InvoiceDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
        // One query: items and payments are folded in as json_agg subqueries, so there is no N+1.
        const rows = await tx`
          SELECT
            i.id,
            i.code,
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
            receiptId: String(payment['receiptId']),
            receiptCode: String(payment['receiptCode']),
            receivedOn: String(payment['receivedOn']),
            amountPaise: toSafePaise(payment['amountPaise'], 'amountPaise'),
            receiptStatus: payment['receiptStatus'] as InvoicePaymentDto['receiptStatus'],
          }));
          return {
            id: String(row['id']),
            code: String(row['code']),
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
      });
    } catch (error) {
      sanitizeDatabaseError(error);
    }
  }

  async listPaymentReceipts(ctx: RepositoryContext): Promise<PaymentReceiptDto[]> {
    try {
      return await this.runner.withUserContext(ctx, async (tx) => {
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
          ORDER BY pr.received_on DESC, pr.code DESC;
        `;

        return rows.map((row): PaymentReceiptDto => {
          const amountPaise = toSafePaise(row['amountPaise'], 'amountPaise');
          const allocatedPaise = toSafePaise(row['allocatedPaise'], 'allocatedPaise');
          const allocations: PaymentAllocationDto[] = asRecordArray(row['allocations']).map((allocation) => ({
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
      });
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
