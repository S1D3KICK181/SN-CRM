import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  PracticeOperationEnvelopeSchema,
  PracticeQueryEnvelopeSchema,
} from "../src/lib/practice-api/contract.ts";
import type { PracticeServerConfig } from "./config.ts";
import { PracticeHttpError, normalizeError } from "./errors.ts";
import { PracticeKernel } from "./kernel.ts";

export interface PracticeHttpRuntime {
  server: Server;
  abortActiveRequests(reason?: unknown): void;
}

export interface PracticeHttpOptions {
  config: PracticeServerConfig;
  kernel?: PracticeKernel;
  logger?: Pick<Console, "error">;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,200}$/;

function requestId(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"];
  return typeof candidate === "string" && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}

function appendVary(response: ServerResponse, value: string): void {
  const existing = response.getHeader("Vary");
  const values = new Set(
    (Array.isArray(existing) ? existing.join(",") : String(existing || ""))
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  response.setHeader("Vary", [...values].join(", "));
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  config: PracticeServerConfig,
): void {
  const origin = request.headers.origin;
  if (!origin) return;
  if (!config.allowedOrigins.has(origin)) {
    throw new PracticeHttpError(
      403,
      "CORS_ORIGIN_DENIED",
      "This origin is not allowed to call the practice server",
    );
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key, X-Request-ID",
  );
  response.setHeader("Access-Control-Expose-Headers", "X-Request-ID");
  response.setHeader("Access-Control-Max-Age", "600");
  appendVary(response, "Origin");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  requestIdValue: string,
): void {
  if (response.destroyed || response.writableEnded) return;
  const json = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(json));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-ID", requestIdValue);
  response.end(json);
}

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

async function readJsonBody(
  request: IncomingMessage,
  limitBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new PracticeHttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json",
    );
  }

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new PracticeHttpError(400, "INVALID_CONTENT_LENGTH", "Content-Length is invalid");
    }
    if (parsed > limitBytes) {
      request.resume();
      throw new PracticeHttpError(
        413,
        "REQUEST_TOO_LARGE",
        "The request body exceeds the configured limit",
      );
    }
  }

  return await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;

    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limitBytes) {
        exceeded = true;
        chunks.length = 0;
        return;
      }
      if (!exceeded) chunks.push(buffer);
    });
    request.once("error", reject);
    request.once("end", () => {
      signal.removeEventListener("abort", onAbort);
      if (exceeded) {
        reject(
          new PracticeHttpError(
            413,
            "REQUEST_TOO_LARGE",
            "The request body exceeds the configured limit",
          ),
        );
        return;
      }
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body.trim()) {
        reject(new PracticeHttpError(400, "INVALID_JSON", "The request body is empty"));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) {
    throw new PracticeHttpError(
      401,
      "INVALID_AUTHORIZATION",
      "Authorization must use the Bearer scheme",
    );
  }
  return match[1] ?? null;
}

function idempotencyKey(request: IncomingMessage): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new PracticeHttpError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key must contain 1 to 200 visible ASCII characters",
    );
  }
  return value;
}

function routeAllows(pathname: string): string | null {
  if (pathname === "/health") return "GET, OPTIONS";
  if (pathname === "/v1/query" || pathname === "/v1/operations") return "POST, OPTIONS";
  return null;
}

export function createPracticeHttpServer(options: PracticeHttpOptions): PracticeHttpRuntime {
  const kernel = options.kernel ?? new PracticeKernel(options.config);
  const logger = options.logger ?? console;
  const activeRequests = new Set<AbortController>();

  const server = createServer((request, response) => {
    const id = requestId(request);
    const controller = new AbortController();
    activeRequests.add(controller);
    request.once("aborted", () => controller.abort(abortError()));

    void (async () => {
      try {
        applyCors(request, response, options.config);
        const url = new URL(request.url || "/", "http://practice.local");
        const allowed = routeAllows(url.pathname);
        if (!allowed) {
          throw new PracticeHttpError(404, "ROUTE_NOT_FOUND", "The route does not exist");
        }

        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.setHeader("Allow", allowed);
          response.setHeader("X-Request-ID", id);
          response.end();
          return;
        }
        if (!allowed.split(", ").includes(request.method || "")) {
          response.setHeader("Allow", allowed);
          throw new PracticeHttpError(
            405,
            "METHOD_NOT_ALLOWED",
            "The HTTP method is not allowed for this route",
          );
        }

        if (url.pathname === "/health") {
          sendJson(
            response,
            200,
            { data: { status: "ok", mode: options.config.mode }, meta: { requestId: id } },
            id,
          );
          return;
        }

        const body = await readJsonBody(request, options.config.bodyLimitBytes, controller.signal);
        const context = {
          accessToken: bearerToken(request),
          requestId: id,
          signal: controller.signal,
        };

        if (url.pathname === "/v1/query") {
          const query = PracticeQueryEnvelopeSchema.parse(body);
          const result = await kernel.query(query, context);
          sendJson(response, 200, { data: result, meta: { requestId: id } }, id);
          return;
        }

        const operation = PracticeOperationEnvelopeSchema.parse(body);
        const result = await kernel.operate(operation, idempotencyKey(request), context);
        sendJson(response, 200, { data: result, meta: { requestId: id } }, id);
      } catch (error) {
        const normalized = normalizeError(error);
        if (normalized.status >= 500) {
          logger.error(
            JSON.stringify({
              level: "error",
              requestId: id,
              code: normalized.code,
              message: error instanceof Error ? error.message : "Unknown server error",
            }),
          );
        }
        sendJson(
          response,
          normalized.status === 499 ? 400 : normalized.status,
          {
            error: {
              code: normalized.code,
              message: normalized.message,
              requestId: id,
              ...(normalized.status < 500 && normalized.details !== undefined
                ? { details: normalized.details }
                : {}),
            },
          },
          id,
        );
      } finally {
        activeRequests.delete(controller);
      }
    })();
  });

  server.maxHeadersCount = 100;
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  return {
    server,
    abortActiveRequests(reason = abortError()) {
      for (const controller of activeRequests) controller.abort(reason);
    },
  };
}
