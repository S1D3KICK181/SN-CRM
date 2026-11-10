import type {
  AssignmentDto,
  ClientDto,
  ClientStatus,
  CreateLedgerEntryInput,
  CreateRecurringScheduleInput,
  GenerateDueAssignmentsResult,
  LedgerEntryDto,
  OfficeAccountsSummaryDto,
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
import type {
  ClientReference,
  CreateAssignmentRecord,
  CreateClientRecord,
  CreateWorkItemRecord,
  CrmRepository,
  DevActorDirectory,
  EmployeeRecord,
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
        a.title, a.owner_id AS "ownerId",
        a.status, a.priority, a.period_start AS "periodStart", a.period_end AS "periodEnd",
        a.due_at AS "dueAt", a.recurring_schedule_id AS "recurringScheduleId",
        a.started_at AS "startedAt", a.submitted_at AS "submittedAt",
        a.approved_at AS "approvedAt", a.approved_by AS "approvedById",
        a.closed_at AS "closedAt", a.closed_by AS "closedById",
        a.created_by AS "createdById", a.created_at AS "createdAt", a.updated_at AS "updatedAt"
      FROM public.assignments a
      JOIN public.clients c ON c.id = a.client_id
      JOIN public.service_catalog s ON s.id = a.service_id
      WHERE a.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

    const reviewerRows = await tx`
      SELECT reviewer_id AS "reviewerId"
      FROM public.assignment_reviewers
      WHERE assignment_id = ${id}::uuid
      ORDER BY assigned_at ASC;
    `;

    return {
      id: String(row['id']),
      code: String(row['code']),
      clientId: String(row['clientId']),
      clientName: String(row['clientName']),
      serviceId: String(row['serviceId']),
      service: String(row['serviceName']),
      title: String(row['title']),
      ownerId: String(row['ownerId']),
      reviewerIds: reviewerRows.map((r) => String(r['reviewerId'])),
      status: row['status'] as any,
      priority: row['priority'] as any,
      periodStart: row['periodStart'] ? (row['periodStart'] as Date).toISOString().slice(0, 10) : null,
      periodEnd: row['periodEnd'] ? (row['periodEnd'] as Date).toISOString().slice(0, 10) : null,
      dueAt: (row['dueAt'] as Date).toISOString(),
      recurringScheduleId: row['recurringScheduleId'] ? String(row['recurringScheduleId']) : null,
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
            a.title, a.owner_id AS "ownerId",
            a.status, a.priority, a.period_start AS "periodStart", a.period_end AS "periodEnd",
            a.due_at AS "dueAt", a.recurring_schedule_id AS "recurringScheduleId",
            a.started_at AS "startedAt", a.submitted_at AS "submittedAt",
            a.approved_at AS "approvedAt", a.approved_by AS "approvedById",
            a.closed_at AS "closedAt", a.closed_by AS "closedById",
            a.created_by AS "createdById", a.created_at AS "createdAt", a.updated_at AS "updatedAt"
          FROM public.assignments a
          JOIN public.clients c ON c.id = a.client_id
          JOIN public.service_catalog s ON s.id = a.service_id
          ORDER BY a.created_at DESC;
        `;

        if (rows.length === 0) return [];
        const assignmentIds = rows.map((r) => r['id']);

        const reviewerRows = await tx`
          SELECT assignment_id AS "assignmentId", reviewer_id AS "reviewerId"
          FROM public.assignment_reviewers
          WHERE assignment_id = ANY(${assignmentIds}::uuid[])
          ORDER BY assigned_at ASC;
        `;

        const reviewersByAssignment = new Map<string, string[]>();
        for (const rev of reviewerRows) {
          const aid = String(rev['assignmentId']);
          const list = reviewersByAssignment.get(aid) ?? [];
          list.push(String(rev['reviewerId']));
          reviewersByAssignment.set(aid, list);
        }

        return rows.map((row) => ({
          id: String(row['id']),
          code: String(row['code']),
          clientId: String(row['clientId']),
          clientName: String(row['clientName']),
          serviceId: String(row['serviceId']),
          service: String(row['serviceName']),
          title: String(row['title']),
          ownerId: String(row['ownerId']),
          reviewerIds: reviewersByAssignment.get(String(row['id'])) ?? [],
          status: row['status'] as any,
          priority: row['priority'] as any,
          periodStart: row['periodStart'] ? (row['periodStart'] as Date).toISOString().slice(0, 10) : null,
          periodEnd: row['periodEnd'] ? (row['periodEnd'] as Date).toISOString().slice(0, 10) : null,
          dueAt: (row['dueAt'] as Date).toISOString(),
          recurringScheduleId: row['recurringScheduleId'] ? String(row['recurringScheduleId']) : null,
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
            recurring_schedule_id, created_by
          ) VALUES (
            ${record.id}::uuid, ${record.clientId}::uuid, ${record.serviceId}::uuid,
            ${record.title}, ${record.description ?? null}, ${record.ownerId}::uuid,
            ${record.status}::public.assignment_status,
            ${record.priority ?? 'normal'}::public.work_priority,
            ${record.periodStart ? record.periodStart : null}::date,
            ${record.periodEnd ? record.periodEnd : null}::date,
            ${record.dueAt}::timestamptz,
            ${record.recurringScheduleId ? record.recurringScheduleId : null}::uuid,
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
        const expectedUpdatedAt = command.expectedUpdatedAt ?? null;
        const deliveryNotes = command.deliveryNotes ?? null;
        const reviewNotes = command.reviewNotes ?? null;
        const progressPercent = command.progressPercent !== undefined ? command.progressPercent : null;

        const updateRows = await tx`
          UPDATE public.assignments
          SET status = ${command.status}::public.assignment_status,
              delivery_notes = coalesce(${deliveryNotes}, delivery_notes),
              review_notes = coalesce(${reviewNotes}, review_notes),
              progress_percent = coalesce(${progressPercent}, progress_percent)
          WHERE id = ${command.id}::uuid
            AND (${expectedUpdatedAt}::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt}::timestamptz))
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
        const expectedUpdatedAt = command.expectedUpdatedAt ?? null;
        const title = command.title ?? null;
        const serviceId = command.serviceId ?? null;
        const ownerId = command.ownerId ?? null;
        const dueAt = command.dueAt ?? null;
        const deliveryNotes = command.deliveryNotes !== undefined ? command.deliveryNotes : null;
        const reviewNotes = command.reviewNotes !== undefined ? command.reviewNotes : null;
        const progressPercent = command.progressPercent !== undefined ? command.progressPercent : null;

        const updateRows = await tx`
          UPDATE public.assignments
          SET title = coalesce(${title}, title),
              service_id = coalesce(${serviceId ? serviceId : null}::uuid, service_id),
              owner_id = coalesce(${ownerId ? ownerId : null}::uuid, owner_id),
              due_at = coalesce(${dueAt ? dueAt : null}::timestamptz, due_at),
              delivery_notes = coalesce(${deliveryNotes}, delivery_notes),
              review_notes = coalesce(${reviewNotes}, review_notes),
              progress_percent = coalesce(${progressPercent}, progress_percent),
              updated_at = now()
          WHERE id = ${command.id}::uuid
            AND (${expectedUpdatedAt}::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt}::timestamptz))
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
        rs.next_occurrence_date AS "nextOccurrenceOn",
        rs.due_offset_days AS "dueDay",
        rs.is_active AS "active",
        rs.created_by AS "createdById",
        rs.created_at AS "createdAt",
        rs.updated_at AS "updatedAt"
      FROM public.recurring_schedules rs
      JOIN public.clients c ON c.id = rs.client_id
      LEFT JOIN public.service_catalog sc ON sc.id = rs.service_id
      WHERE rs.id = ${id}::uuid;
    `;
    const row = rows[0];
    if (!row) return null;

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
      reviewerIds: [],
      nextOccurrenceOn: row['nextOccurrenceOn']
        ? (row['nextOccurrenceOn'] as Date).toISOString().slice(0, 10)
        : '',
      dueDay: Number(row['dueDay']),
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
            rs.next_occurrence_date AS "nextOccurrenceOn",
            rs.due_offset_days AS "dueDay",
            rs.is_active AS "active",
            rs.created_by AS "createdById",
            rs.created_at AS "createdAt",
            rs.updated_at AS "updatedAt"
          FROM public.recurring_schedules rs
          JOIN public.clients c ON c.id = rs.client_id
          LEFT JOIN public.service_catalog sc ON sc.id = rs.service_id
          ORDER BY rs.next_occurrence_date ASC, rs.title ASC;
        `;

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
          reviewerIds: [],
          nextOccurrenceOn: row['nextOccurrenceOn']
            ? (row['nextOccurrenceOn'] as Date).toISOString().slice(0, 10)
            : '',
          dueDay: Number(row['dueDay']),
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
            default_owner_id, priority, is_active, created_by
          ) VALUES (
            ${input.id}::uuid, ${input.clientId}::uuid,
            ${input.serviceId ? input.serviceId : null}::uuid,
            ${input.title}, ${input.cadence}::public.recurrence_cadence,
            ${intervalMonths}, ${input.dueDay}, ${input.nextOccurrenceOn}::date,
            ${input.nextOccurrenceOn}::date, ${input.ownerId}::uuid,
            'normal'::public.work_priority, true, ${ctx.actorId}::uuid
          );
        `;

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
}
