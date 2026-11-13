import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type postgres from 'postgres';
import type { ZodType } from 'zod';
import type { ApiErrorEnvelope, SessionActor } from '@sn/contracts';
import { CrmApplication } from './application';
import { DEV_ACTOR_ALIASES, normalizeDevUserHeader, resolveActor, verifySupabaseToken } from './auth';
import { ApiError } from './errors';
import {
  assignmentTransitionSchema,
  activateEngagementSchema,
  amendEngagementSchema,
  createEngagementDraftSchema,
  endEngagementSchema,
  reviseEngagementDraftSchema,
  createAssignmentSchema,
  createClientSchema,
  createLedgerEntrySchema,
  createRecurringScheduleSchema,
  createWorkItemSchema,
  entityUuid,
  recordPaymentSchema,
  recordVyaparBillSchema,
  voidFeeRecordSchema,
  applyCreditSchema,
  removeCreditSchema,
  generateDueAssignmentsSchema,
  reportingLineSchema,
  updateAssignmentSchema,
  updateRecurringScheduleSchema,
  workItemTransitionSchema,
} from './schemas';

export { DEV_ACTOR_ALIASES, normalizeDevUserHeader };

const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:4310',
  'http://127.0.0.1:4310',
  'http://localhost:4311',
  'http://127.0.0.1:4311',
  'http://localhost:4320',
  'http://127.0.0.1:4320',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://localhost:4322',
  'http://127.0.0.1:4322',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

interface Logger {
  error(message: string, metadata?: unknown): void;
}

export interface AuthConfig {
  readonly allowDevActorHeader: boolean;
  readonly jwksUrl?: string;
  readonly jwtSecret?: string;
  readonly jwtIssuer?: string;
}

export function isProductionEnvironment(nodeEnv: string | undefined): boolean {
  return typeof nodeEnv === 'string' && nodeEnv.trim().toLowerCase() === 'production';
}

export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const isProduction = isProductionEnvironment(env['NODE_ENV']);
  const allowDev = env['ALLOW_DEV_ACTOR_HEADER']?.trim().toLowerCase() === 'true';

  if (isProduction && allowDev) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: ALLOW_DEV_ACTOR_HEADER cannot be enabled when NODE_ENV is production.',
    );
  }
  return {
    allowDevActorHeader: allowDev,
    jwksUrl: env['SUPABASE_JWKS_URL']?.trim() || undefined,
    jwtSecret: env['SUPABASE_JWT_SECRET']?.trim() || undefined,
    jwtIssuer: env['SUPABASE_JWT_ISSUER']?.trim() || undefined,
  };
}

export interface ApiServerOptions {
  allowedOrigins?: readonly string[];
  logger?: Logger;
  createRequestId?: () => string;
  allowDevActorHeader?: boolean;
  jwksUrl?: string;
  jwtSecret?: string;
  jwtIssuer?: string;
  sql?: postgres.Sql;
}

interface RequestContext {
  requestId: string;
  origin: string | undefined;
}

function requestIdFor(request: IncomingMessage, createRequestId: () => string): string {
  const supplied = request.headers['x-request-id'];
  if (typeof supplied === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(supplied)) return supplied;
  return createRequestId();
}

function writeCorsHeaders(response: ServerResponse, origin: string | undefined, allowedOrigins: Set<string>): void {
  if (!origin || !allowedOrigins.has(origin)) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,OPTIONS');
  response.setHeader(
    'access-control-allow-headers',
    'authorization,content-type,idempotency-key,x-demo-user-id,x-request-id',
  );
  response.setHeader('access-control-max-age', '600');
}

function sendJson(
  response: ServerResponse,
  context: RequestContext,
  allowedOrigins: Set<string>,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-request-id', context.requestId);
  writeCorsHeaders(response, context.origin, allowedOrigins);
  response.end(JSON.stringify(body));
}

function sendData(
  response: ServerResponse,
  context: RequestContext,
  allowedOrigins: Set<string>,
  status: number,
  data: unknown,
): void {
  sendJson(response, context, allowedOrigins, status, { data, requestId: context.requestId });
}

async function readJson<T>(request: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const contentType = request.headers['content-type'];
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'json_content_type_required', 'This endpoint requires an application/json request body.');
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 1_048_576) {
      tooLarge = true;
    } else {
      chunks.push(buffer);
    }
  }
  if (tooLarge) throw new ApiError(413, 'payload_too_large', 'JSON request bodies are limited to 1 MB.');

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      422,
      'validation_failed',
      'The request body did not pass validation.',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}

function invalidIdentifier(): never {
  throw new ApiError(422, 'invalid_identifier', 'The route parameter must be a valid RFC 4122 UUID.');
}

function idempotencyKey(request: IncomingMessage): string {
  const raw = request.headers['idempotency-key'];
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'idempotency_key_required', 'The Idempotency-Key request header is required.');
  }
  const value = raw.trim();
  if (!value || value.length > 255) {
    throw new ApiError(422, 'invalid_idempotency_key', 'The Idempotency-Key must be non-blank and at most 255 characters.');
  }
  return value;
}

function routeId(pathname: string, pattern: RegExp): string | null {
  const match = pattern.exec(pathname);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    invalidIdentifier();
  }
  const parsed = entityUuid.safeParse(decoded);
  if (!parsed.success) {
    invalidIdentifier();
  }
  return parsed.data;
}

function problemFor(error: unknown, requestId: string): { status: number; body: ApiErrorEnvelope } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: {
        error: { code: error.code, message: error.message, details: error.details },
        requestId,
      },
    };
  }

  const pgErr = error as { code?: string; message?: string };
  if (pgErr?.code) {
    if (pgErr.code === '42501') {
      return {
        status: 403,
        body: {
          error: { code: 'forbidden', message: 'You do not have permission to perform this operation.' },
          requestId,
        },
      };
    }
    if (pgErr.code === '23514') {
      const msg = pgErr.message ?? '';
      const isConstraint = msg.includes('check constraint') || msg.includes('violates check constraint');
      return {
        status: 422,
        body: {
          error: {
            code: 'validation_failed',
            message: isConstraint ? 'Request failed database validation constraints.' : msg || 'Business rule validation failed.',
          },
          requestId,
        },
      };
    }
    if (pgErr.code === '23503') {
      return {
        status: 422,
        body: {
          error: { code: 'referenced_entity_not_found', message: 'The referenced entity does not exist.' },
          requestId,
        },
      };
    }
    if (pgErr.code === '23505') {
      return {
        status: 409,
        body: {
          error: { code: 'conflict', message: 'A record with this identifier already exists.' },
          requestId,
        },
      };
    }
    if (pgErr.code === '08000' || pgErr.code === 'ECONNREFUSED') {
      return {
        status: 503,
        body: {
          error: { code: 'database_unavailable', message: 'Database service is temporarily unavailable.' },
          requestId,
        },
      };
    }
  }

  return {
    status: 500,
    body: {
      error: { code: 'internal_error', message: 'The server could not complete this request.' },
      requestId,
    },
  };
}

export function createApiServer(application: CrmApplication, options: ApiServerOptions = {}): Server {
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_LOCAL_ORIGINS);
  const logger = options.logger ?? console;
  const createRequestId = options.createRequestId ?? randomUUID;
  const allowDevActorHeader = options.allowDevActorHeader ?? false;

  return createServer(async (request, response) => {
    const context: RequestContext = {
      requestId: requestIdFor(request, createRequestId),
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
    };

    try {
      if (context.origin && !allowedOrigins.has(context.origin)) {
        throw new ApiError(403, 'cors_origin_denied', 'This origin is not allowed to access the local API.');
      }

      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.setHeader('x-request-id', context.requestId);
        writeCorsHeaders(response, context.origin, allowedOrigins);
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      const { pathname } = url;

      if (request.method === 'GET' && pathname === '/health') {
        sendData(response, context, allowedOrigins, 200, {
          status: 'ok',
          service: 'sn-practice-crm-api',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/demo/actors') {
        if (!allowDevActorHeader) {
          throw new ApiError(401, 'dev_auth_disabled', 'Development header authentication is disabled.');
        }
        sendData(response, context, allowedOrigins, 200, await application.listDemoActors());
        return;
      }

      let actor: SessionActor;
      if (options.sql) {
        actor = await resolveActor(
          request,
          options.sql,
          {
            jwksUrl: options.jwksUrl,
            jwtSecret: options.jwtSecret,
            jwtIssuer: options.jwtIssuer,
            allowDevActorHeader,
          },
          (actorId) => application.requireActor(actorId),
        );
      } else {
        const authHeader = request.headers.authorization;
        if (typeof authHeader === 'string' && authHeader.trim().toLowerCase().startsWith('bearer ')) {
          const token = authHeader.trim().slice(7).trim();
          const verified = await verifySupabaseToken(token, {
            jwksUrl: options.jwksUrl,
            jwtSecret: options.jwtSecret,
            jwtIssuer: options.jwtIssuer,
          });
          actor = await application.requireActor(verified.sub);
        } else {
          if (!allowDevActorHeader) {
            throw new ApiError(401, 'dev_auth_disabled', 'Development header authentication is disabled.');
          }
          const rawHeader = request.headers['x-demo-user-id'];
          const actorId = normalizeDevUserHeader(typeof rawHeader === 'string' ? rawHeader : undefined);
          actor = await application.requireActor(actorId);
        }
      }

      if (request.method === 'GET' && pathname === '/api/v1/session') {
        sendData(response, context, allowedOrigins, 200, actor);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/services') {
        sendData(response, context, allowedOrigins, 200, await application.listServices(actor));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/invoices') {
        sendData(response, context, allowedOrigins, 200, await application.listInvoices(actor));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/payment-receipts') {
        sendData(response, context, allowedOrigins, 200, await application.listPaymentReceipts(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/invoices') {
        const key = idempotencyKey(request);
        const body = await readJson(request, recordVyaparBillSchema);
        sendData(response, context, allowedOrigins, 201, await application.recordVyaparBill(actor, body, key));
        return;
      }
      const invoiceVoidId = routeId(pathname, /^\/api\/v1\/invoices\/([^/]+)\/void$/);
      if (request.method === 'POST' && invoiceVoidId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, voidFeeRecordSchema);
        sendData(response, context, allowedOrigins, 200, await application.voidInvoice(actor, invoiceVoidId, body, key));
        return;
      }
      const invoiceApplyCreditId = routeId(pathname, /^\/api\/v1\/invoices\/([^/]+)\/apply-credit$/);
      if (request.method === 'POST' && invoiceApplyCreditId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, applyCreditSchema);
        sendData(response, context, allowedOrigins, 200, await application.applyCredit(actor, invoiceApplyCreditId, body, key));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/payment-receipts') {
        const key = idempotencyKey(request);
        const body = await readJson(request, recordPaymentSchema);
        sendData(response, context, allowedOrigins, 201, await application.recordPayment(actor, body, key));
        return;
      }
      const receiptVoidId = routeId(pathname, /^\/api\/v1\/payment-receipts\/([^/]+)\/void$/);
      if (request.method === 'POST' && receiptVoidId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, voidFeeRecordSchema);
        sendData(response, context, allowedOrigins, 200, await application.voidPaymentReceipt(actor, receiptVoidId, body, key));
        return;
      }

      const allocationRemoveId = routeId(pathname, /^\/api\/v1\/payment-allocations\/([^/]+)\/remove$/);
      if (request.method === 'POST' && allocationRemoveId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, removeCreditSchema);
        sendData(response, context, allowedOrigins, 200, await application.removeCreditAllocation(actor, allocationRemoveId, body, key));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/engagements') {
        sendData(response, context, allowedOrigins, 200, await application.listEngagements(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/engagements') {
        const key = idempotencyKey(request);
        const body = await readJson(request, createEngagementDraftSchema);
        sendData(response, context, allowedOrigins, 201, await application.createEngagementDraft(actor, body, key));
        return;
      }
      const engagementVersionsId = routeId(pathname, /^\/api\/v1\/engagements\/([^/]+)\/versions$/);
      if (request.method === 'GET' && engagementVersionsId) {
        sendData(response, context, allowedOrigins, 200, await application.listEngagementVersions(actor, engagementVersionsId));
        return;
      }
      const engagementDraftId = routeId(pathname, /^\/api\/v1\/engagements\/([^/]+)\/draft$/);
      if (request.method === 'PATCH' && engagementDraftId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, reviseEngagementDraftSchema);
        sendData(response, context, allowedOrigins, 200, await application.reviseEngagementDraft(actor, engagementDraftId, body, key));
        return;
      }
      const engagementActivateId = routeId(pathname, /^\/api\/v1\/engagements\/([^/]+)\/activate$/);
      if (request.method === 'POST' && engagementActivateId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, activateEngagementSchema);
        sendData(response, context, allowedOrigins, 200, await application.activateEngagement(actor, engagementActivateId, body, key));
        return;
      }
      const engagementAmendId = routeId(pathname, /^\/api\/v1\/engagements\/([^/]+)\/amendments$/);
      if (request.method === 'POST' && engagementAmendId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, amendEngagementSchema);
        sendData(response, context, allowedOrigins, 200, await application.amendEngagement(actor, engagementAmendId, body, key));
        return;
      }
      const engagementEndId = routeId(pathname, /^\/api\/v1\/engagements\/([^/]+)\/end$/);
      if (request.method === 'POST' && engagementEndId) {
        const key = idempotencyKey(request);
        const body = await readJson(request, endEngagementSchema);
        sendData(response, context, allowedOrigins, 200, await application.endEngagement(actor, engagementEndId, body, key));
        return;
      }
      const engagementId = routeId(pathname, /^\/api\/v1\/engagements\/([^/]+)$/);
      if (request.method === 'GET' && engagementId) {
        sendData(response, context, allowedOrigins, 200, await application.getEngagement(actor, engagementId));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/clients') {
        sendData(response, context, allowedOrigins, 200, await application.listClients(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/clients') {
        application.assertClientCreateAuthority(actor);
        const input = await readJson(request, createClientSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          201,
          await application.createClient(actor, input as import('@sn/contracts').CreateClientInput),
        );
        return;
      }
      const clientId = routeId(pathname, /^\/api\/v1\/clients\/([^/]+)$/);
      if (request.method === 'GET' && clientId) {
        sendData(response, context, allowedOrigins, 200, await application.getClient(actor, clientId));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/assignments') {
        sendData(response, context, allowedOrigins, 200, await application.listAssignments(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/assignments') {
        const input = await readJson(request, createAssignmentSchema);
        sendData(response, context, allowedOrigins, 201, await application.createAssignment(actor, input as unknown as import('@sn/contracts').CreateAssignmentInput));
        return;
      }
      const assignmentTransitionId = routeId(pathname, /^\/api\/v1\/assignments\/([^/]+)\/transitions$/);
      if (request.method === 'POST' && assignmentTransitionId) {
        const body = await readJson(request, assignmentTransitionSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.transitionAssignment(actor, assignmentTransitionId, body.action, body as unknown as import('@sn/contracts').AssignmentTransitionInput),
        );
        return;
      }
      const assignmentId = routeId(pathname, /^\/api\/v1\/assignments\/([^/]+)$/);
      if (request.method === 'PATCH' && assignmentId) {
        const body = await readJson(request, updateAssignmentSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.updateAssignment(actor, assignmentId, body as unknown as import('@sn/contracts').UpdateAssignmentInput),
        );
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/recurring-schedules') {
        sendData(response, context, allowedOrigins, 200, await application.listRecurringSchedules(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/recurring-schedules/generate-due') {
        const body = await readJson(request, generateDueAssignmentsSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.generateDueAssignments(actor, body),
        );
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/recurring-schedules') {
        const input = await readJson(request, createRecurringScheduleSchema);
        sendData(response, context, allowedOrigins, 201, await application.createRecurringSchedule(actor, input));
        return;
      }
      const scheduleId = routeId(pathname, /^\/api\/v1\/recurring-schedules\/([^/]+)$/);
      if (request.method === 'PATCH' && scheduleId) {
        const input = await readJson(request, updateRecurringScheduleSchema);
        sendData(response, context, allowedOrigins, 200, await application.updateRecurringSchedule(actor, scheduleId, input));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/work-items') {
        sendData(response, context, allowedOrigins, 200, await application.listWorkItems(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/work-items') {
        const input = await readJson(request, createWorkItemSchema);
        sendData(response, context, allowedOrigins, 201, await application.createWorkItem(actor, input));
        return;
      }
      const workItemTransitionId = routeId(pathname, /^\/api\/v1\/work-items\/([^/]+)\/transitions$/);
      if (request.method === 'POST' && workItemTransitionId) {
        const body = await readJson(request, workItemTransitionSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.transitionWorkItem(actor, workItemTransitionId, body.action, body),
        );
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/reporting-lines') {
        sendData(response, context, allowedOrigins, 200, await application.listReportingLines(actor));
        return;
      }
      const reportingEmployeeId = routeId(pathname, /^\/api\/v1\/reporting-lines\/([^/]+)$/);
      if (request.method === 'PUT' && reportingEmployeeId) {
        const { managerId } = await readJson(request, reportingLineSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.updateReportingLine(actor, reportingEmployeeId, managerId),
        );
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/office-accounts/summary') {
        sendData(response, context, allowedOrigins, 200, await application.getOfficeAccountsSummary(actor));
        return;
      }
      if (request.method === 'GET' && pathname === '/api/v1/office-accounts/entries') {
        sendData(response, context, allowedOrigins, 200, await application.listLedgerEntries(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/office-accounts/entries') {
        const input = await readJson(request, createLedgerEntrySchema);
        sendData(response, context, allowedOrigins, 201, await application.createLedgerEntry(actor, input));
        return;
      }

      throw new ApiError(404, 'route_not_found', 'No API route matches this request.');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        logger.error('Unhandled API error', { requestId: context.requestId, error });
      }
      const problem = problemFor(error, context.requestId);
      sendJson(response, context, allowedOrigins, problem.status, problem.body);
    }
  });
}

export function localOriginsFromEnvironment(value: string | undefined): string[] {
  if (!value) return [...DEFAULT_LOCAL_ORIGINS];
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1')) {
      throw new Error(`LOCAL_WEB_ORIGINS must contain only local HTTP origins. Invalid value: ${origin}`);
    }
  }
  return origins;
}

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const isProduction = isProductionEnvironment(env['NODE_ENV']);
  if (isProduction) {
    const raw = env['CORS_ALLOWED_ORIGINS'];
    if (!raw || !raw.trim()) {
      throw new Error('FATAL CONFIGURATION ERROR: CORS_ALLOWED_ORIGINS must be set in production mode.');
    }
    const origins = raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length === 0) {
      throw new Error('FATAL CONFIGURATION ERROR: CORS_ALLOWED_ORIGINS must contain at least one origin.');
    }
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (url.protocol !== 'https:') {
          throw new Error(`Production CORS origin must use https: protocol. Invalid origin: ${origin}`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Production CORS origin')) throw err;
        throw new Error(`FATAL CONFIGURATION ERROR: Invalid production CORS origin: ${origin}`);
      }
    }
    return origins;
  }
  return localOriginsFromEnvironment(env['LOCAL_WEB_ORIGINS']);
}
