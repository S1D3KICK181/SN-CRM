import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ZodType } from 'zod';
import type { ApiErrorEnvelope } from '@sn/contracts';
import { CrmApplication } from './application';
import { ApiError } from './errors';
import {
  assignmentTransitionSchema,
  createAssignmentSchema,
  createLedgerEntrySchema,
  createRecurringScheduleSchema,
  createWorkItemSchema,
  reportingLineSchema,
  updateRecurringScheduleSchema,
  workItemTransitionSchema,
} from './schemas';

const DEFAULT_LOCAL_ORIGINS = [
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
  return { allowDevActorHeader: allowDev };
}

export interface ApiServerOptions {
  allowedOrigins?: readonly string[];
  logger?: Logger;
  createRequestId?: () => string;
  allowDevActorHeader?: boolean;
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
  response.setHeader('access-control-allow-headers', 'content-type,x-demo-user-id,x-request-id');
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

function routeId(pathname: string, pattern: RegExp): string | null {
  const match = pattern.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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

      if (!allowDevActorHeader) {
        throw new ApiError(401, 'dev_auth_disabled', 'Development header authentication is disabled.');
      }

      if (request.method === 'GET' && pathname === '/api/v1/demo/actors') {
        sendData(response, context, allowedOrigins, 200, await application.listDemoActors());
        return;
      }

      const actorHeader = request.headers['x-demo-user-id'];
      const actor = await application.requireActor(typeof actorHeader === 'string' ? actorHeader : undefined);

      if (request.method === 'GET' && pathname === '/api/v1/session') {
        sendData(response, context, allowedOrigins, 200, actor);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/assignments') {
        sendData(response, context, allowedOrigins, 200, await application.listAssignments(actor));
        return;
      }
      if (request.method === 'POST' && pathname === '/api/v1/assignments') {
        const input = await readJson(request, createAssignmentSchema);
        sendData(response, context, allowedOrigins, 201, await application.createAssignment(actor, input));
        return;
      }
      const assignmentTransitionId = routeId(pathname, /^\/api\/v1\/assignments\/([^/]+)\/transitions$/);
      if (request.method === 'POST' && assignmentTransitionId) {
        const { action } = await readJson(request, assignmentTransitionSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.transitionAssignment(actor, assignmentTransitionId, action),
        );
        return;
      }

      if (request.method === 'GET' && pathname === '/api/v1/recurring-schedules') {
        sendData(response, context, allowedOrigins, 200, await application.listRecurringSchedules(actor));
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
        const { action } = await readJson(request, workItemTransitionSchema);
        sendData(
          response,
          context,
          allowedOrigins,
          200,
          await application.transitionWorkItem(actor, workItemTransitionId, action),
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
