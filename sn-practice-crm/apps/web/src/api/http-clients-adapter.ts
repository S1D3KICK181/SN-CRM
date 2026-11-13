import {
  CLIENT_ENTITY_TYPES,
  type ClientContactDto,
  type ClientDto,
  type ClientEntityType,
  type CreateClientContactInput,
  type CreateClientInput,
  type UpdateClientContactInput,
  type UpdateClientInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';
import type { PortExecutionOptions } from './types';
import { validateIdempotencyKey } from './engagements-types';
import {
  ClientOperationError,
  sanitizeClientMutationError,
  sanitizeCreateClientError,
  type ClientErrorCode,
  type ClientsPort,
} from './clients-types';

export interface HttpClientsAdapterOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  /** Signed-in session token source. When set, requests carry a Bearer token and never the demo header. */
  getAccessToken?: () => Promise<string | null> | string | null;
}

const RFC4122_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_CODE_REGEX = /^CL-\d{6}$/;
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MASKED_PAN_REGEX = /^(\*{6}[0-9]{4}|\*{10})$/;
const MASKED_GSTIN_REGEX = /^([0-9]{2}\*{10}[0-9A-Z]Z[0-9A-Z]|\*{15})$/;

const VALID_COMPANY_ROLES = new Set<CompanyRole>([
  'founder',
  'manager',
  'senior_staff',
  'staff',
  'trainee',
]);

const REQUIRED_NULLABLE_FIELDS = [
  'legalName',
  'panMasked',
  'gstinMasked',
  'email',
  'phone',
  'relationshipOwnerId',
  'relationshipOwnerName',
  'notes',
] as const;

function getDemoActorId(role: CompanyRole): string | null {
  if (!VALID_COMPANY_ROLES.has(role)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(ROLE_TO_DEMO_ACTOR_ID, role)) {
    return null;
  }
  const actorId = ROLE_TO_DEMO_ACTOR_ID[role];
  return typeof actorId === 'string' && actorId.trim().length > 0 ? actorId : null;
}

function isValidIsoUtcDate(isoString: string): boolean {
  if (!ISO_UTC_REGEX.test(isoString)) {
    return false;
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const datePart = isoString.slice(0, 10);
  const parts = datePart.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
}

// Detail fields added with the client master. They may be absent from older responses, which read as empty.
const OPTIONAL_TEXT_FIELDS = [
  'pan',
  'gstin',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'pincode',
  'tan',
  'cinLlpin',
  'udyamNumber',
  'iec',
  'incorporationDate',
] as const;

function readOptionalText(rec: Record<string, unknown>, field: string, owner: string): string | null {
  const val = rec[field];
  if (val === undefined || val === null) return null;
  if (typeof val !== 'string') {
    throw new ClientOperationError({
      code: 'unexpected',
      message: `Invalid ${owner} item: field "${field}" must be string or null.`,
    });
  }
  return val;
}

function parseContact(raw: unknown): ClientContactDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client contact item to be a non-null object.',
    });
  }
  const rec = raw as Record<string, unknown>;
  const id = rec['id'];
  const name = rec['name'];
  const isPrimary = rec['isPrimary'];
  const updatedAt = rec['updatedAt'];
  if (
    typeof id !== 'string' ||
    !RFC4122_UUID_REGEX.test(id) ||
    typeof name !== 'string' ||
    typeof isPrimary !== 'boolean' ||
    typeof updatedAt !== 'string' ||
    !isValidIsoUtcDate(updatedAt)
  ) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client contact item.',
    });
  }
  return {
    id,
    name,
    designation: readOptionalText(rec, 'designation', 'client contact'),
    email: readOptionalText(rec, 'email', 'client contact'),
    phone: readOptionalText(rec, 'phone', 'client contact'),
    whatsapp: readOptionalText(rec, 'whatsapp', 'client contact'),
    isPrimary,
    notes: readOptionalText(rec, 'notes', 'client contact'),
    updatedAt,
  };
}

function parseClientDto(raw: unknown): ClientDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client item to be a non-null object.',
    });
  }

  const rec = raw as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(rec, 'id')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "id".',
    });
  }
  const id = rec['id'];
  if (typeof id !== 'string' || !RFC4122_UUID_REGEX.test(id)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "id" (must be RFC 4122 UUID).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'code')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "code".',
    });
  }
  const code = rec['code'];
  if (typeof code !== 'string' || !CLIENT_CODE_REGEX.test(code)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "code" (must match CL-xxxxxx).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'displayName')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "displayName".',
    });
  }
  const displayName = rec['displayName'];
  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "displayName".',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'createdById')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "createdById".',
    });
  }
  const createdById = rec['createdById'];
  if (typeof createdById !== 'string' || !RFC4122_UUID_REGEX.test(createdById)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing or invalid "createdById" (must be RFC 4122 UUID).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'createdAt')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "createdAt".',
    });
  }
  const createdAt = rec['createdAt'];
  if (typeof createdAt !== 'string' || !isValidIsoUtcDate(createdAt)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid "createdAt" (must be valid ISO-8601 UTC ending in Z).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'updatedAt')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "updatedAt".',
    });
  }
  const updatedAt = rec['updatedAt'];
  if (typeof updatedAt !== 'string' || !isValidIsoUtcDate(updatedAt)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid "updatedAt" (must be valid ISO-8601 UTC ending in Z).',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'status')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "status".',
    });
  }
  const status = rec['status'];
  if (status !== 'active' && status !== 'on_hold' && status !== 'archived') {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid status.',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rec, 'activeAssignmentsCount')) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: missing required property "activeAssignmentsCount".',
    });
  }
  const activeAssignmentsCount = rec['activeAssignmentsCount'];
  if (
    typeof activeAssignmentsCount !== 'number' ||
    !Number.isInteger(activeAssignmentsCount) ||
    activeAssignmentsCount < 0
  ) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: invalid "activeAssignmentsCount" (must be non-negative integer).',
    });
  }

  for (const field of REQUIRED_NULLABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(rec, field)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: `Invalid client item: missing required property "${field}".`,
      });
    }
    const val = rec[field];
    if (val !== null && typeof val !== 'string') {
      throw new ClientOperationError({
        code: 'unexpected',
        message: `Invalid client item: field "${field}" must be string or null.`,
      });
    }
  }

  const relationshipOwnerId = rec['relationshipOwnerId'] as string | null;
  if (relationshipOwnerId !== null) {
    if (!RFC4122_UUID_REGEX.test(relationshipOwnerId)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "relationshipOwnerId" (must be RFC 4122 UUID or null).',
      });
    }
  }

  const panMasked = rec['panMasked'] as string | null;
  if (panMasked !== null) {
    if (!MASKED_PAN_REGEX.test(panMasked)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "panMasked" format.',
      });
    }
  }

  const gstinMasked = rec['gstinMasked'] as string | null;
  if (gstinMasked !== null) {
    if (!MASKED_GSTIN_REGEX.test(gstinMasked)) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "gstinMasked" format.',
      });
    }
  }

  const legalName = rec['legalName'] as string | null;
  const email = rec['email'] as string | null;
  const phone = rec['phone'] as string | null;
  const relationshipOwnerName = rec['relationshipOwnerName'] as string | null;
  const notes = rec['notes'] as string | null;

  const detail: Record<(typeof OPTIONAL_TEXT_FIELDS)[number], string | null> = {
    pan: null,
    gstin: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    pincode: null,
    tan: null,
    cinLlpin: null,
    udyamNumber: null,
    iec: null,
    incorporationDate: null,
  };
  for (const field of OPTIONAL_TEXT_FIELDS) {
    detail[field] = readOptionalText(rec, field, 'client');
  }
  const entityTypeRaw = readOptionalText(rec, 'entityType', 'client');
  let entityType: ClientEntityType | null = null;
  if (entityTypeRaw !== null) {
    const match = CLIENT_ENTITY_TYPES.find((candidate) => candidate === entityTypeRaw);
    if (!match) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Invalid client item: invalid "entityType".',
      });
    }
    entityType = match;
  }
  const contactsRaw = rec['contacts'];
  if (contactsRaw !== undefined && !Array.isArray(contactsRaw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Invalid client item: "contacts" must be an array.',
    });
  }
  const contacts = (contactsRaw ?? []).map(parseContact);
  const canEdit = rec['canEdit'] === true;
  const canChangeOwnerOrStatus = rec['canChangeOwnerOrStatus'] === true;

  // Construct a safe, clean projection containing ONLY contract-approved fields.
  // Hostile/untrusted properties (such as raw `pan`, raw `gstin`, or arbitrary properties)
  // are never passed through.
  return {
    id,
    code,
    displayName,
    legalName,
    gstinMasked,
    panMasked,
    email,
    phone,
    relationshipOwnerId,
    relationshipOwnerName,
    status,
    notes,
    ...detail,
    entityType,
    contacts,
    canEdit,
    canChangeOwnerOrStatus,
    activeAssignmentsCount,
    createdById,
    createdAt,
    updatedAt,
  };
}

function parseClientList(raw: unknown): ClientDto[] {
  if (!Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client list data to be an array.',
    });
  }
  return raw.map((item) => parseClientDto(item));
}

function parseClientDetail(raw: unknown): ClientDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ClientOperationError({
      code: 'unexpected',
      message: 'Expected client detail data to be a non-null object.',
    });
  }
  return parseClientDto(raw);
}

export class HttpClientsAdapter implements ClientsPort {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly getAccessToken?: () => Promise<string | null> | string | null;

  constructor(options: HttpClientsAdapterOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
    this.baseUrl = options.baseUrl?.replace(/\/+$/, '') ?? '';
    this.getAccessToken = options.getAccessToken;
  }

  private async resolveAccessToken(): Promise<string | null> {
    if (!this.getAccessToken) return null;
    try {
      const resolved = await this.getAccessToken();
      return typeof resolved === 'string' && resolved.trim().length > 0 ? resolved.trim() : null;
    } catch {
      return null;
    }
  }

  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return this.baseUrl ? `${this.baseUrl}${cleanPath}` : cleanPath;
  }

  private mapStatusToErrorCode(status: number): ClientErrorCode {
    switch (status) {
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'not_found';
      case 409:
        return 'conflict';
      case 415:
      case 422:
        return 'validation';
      default:
        return 'unexpected';
    }
  }

  private async execute<T>(
    role: CompanyRole,
    path: string,
    init: RequestInit,
    options?: PortExecutionOptions,
  ): Promise<{ data: T; requestId?: string }> {
    const actorId = getDemoActorId(role);
    if (!actorId) {
      throw new ClientOperationError({
        code: 'unauthorized',
        message: `Unknown company role: ${String(role)}`,
        requestId: options?.requestId,
      });
    }

    if (options?.signal?.aborted) {
      throw new ClientOperationError({
        code: 'aborted',
        message: 'The client operation was aborted.',
        requestId: options?.requestId,
      });
    }

    const token = await this.resolveAccessToken();

    // Check abort again after awaiting the token so a cancelled request is never dispatched.
    if (options?.signal?.aborted) {
      throw new ClientOperationError({
        code: 'aborted',
        message: 'The client operation was aborted.',
        requestId: options?.requestId,
      });
    }

    const headers = new Headers(init.headers);
    if (this.getAccessToken) {
      // Signed-in transport: a Bearer token is required, and there is never a demo-header fallback.
      if (!token) {
        throw new ClientOperationError({
          code: 'unauthorized',
          message: 'Session expired. Please sign in again to continue.',
          requestId: options?.requestId,
        });
      }
      headers.set('authorization', `Bearer ${token}`);
    } else {
      // Local demo preview without a session: the role's demo actor header.
      headers.set('x-demo-user-id', actorId);
    }
    if (options?.requestId) {
      headers.set('x-request-id', options.requestId);
    }

    let response: Response;
    try {
      response = await this.fetchFn(this.buildUrl(path), {
        ...init,
        headers,
        signal: options?.signal,
      });
    } catch (err: unknown) {
      if (err instanceof ClientOperationError) {
        throw err;
      }
      if (
        (err instanceof Error && err.name === 'AbortError') ||
        (options?.signal && options.signal.aborted)
      ) {
        throw new ClientOperationError({
          code: 'aborted',
          message: 'The client operation was aborted.',
          requestId: options?.requestId,
          cause: err,
        });
      }
      throw new ClientOperationError({
        code: 'network',
        message: err instanceof Error ? err.message : 'Network error while contacting CRM API.',
        requestId: options?.requestId,
        cause: err,
      });
    }

    const headerRequestId = response.headers.get('x-request-id') ?? undefined;

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let serverCode: string | undefined;
      let bodyRequestId: string | undefined;

      try {
        const errorJson: unknown = await response.json();
        if (typeof errorJson === 'object' && errorJson !== null) {
          const rec = errorJson as Record<string, unknown>;
          const errVal = rec['error'];
          if (typeof errVal === 'object' && errVal !== null) {
            const errObj = errVal as Record<string, unknown>;
            const msgVal = errObj['message'];
            if (typeof msgVal === 'string' && msgVal.trim().length > 0) {
              errorMessage = msgVal;
            }
            const codeVal = errObj['code'];
            if (typeof codeVal === 'string') {
              serverCode = codeVal;
            }
          }
          const reqVal = rec['requestId'];
          if (typeof reqVal === 'string' && reqVal.trim().length > 0) {
            bodyRequestId = reqVal;
          }
        }
      } catch {
        // Non-JSON error body fallback (e.g. 500 HTML)
      }

      const effectiveRequestId = bodyRequestId ?? headerRequestId ?? options?.requestId;

      throw new ClientOperationError({
        code: this.mapStatusToErrorCode(response.status),
        message: errorMessage,
        requestId: effectiveRequestId,
        status: response.status,
        serverCode,
      });
    }

    if (response.status === 204) {
      return { data: null as T, requestId: headerRequestId ?? options?.requestId };
    }

    let envelopeJson: unknown;
    try {
      envelopeJson = await response.json();
    } catch (err) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'The server response was not valid JSON.',
        requestId: headerRequestId ?? options?.requestId,
        status: response.status,
        cause: err,
      });
    }

    if (
      typeof envelopeJson !== 'object' ||
      envelopeJson === null ||
      Array.isArray(envelopeJson) ||
      !('data' in envelopeJson)
    ) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'The server response did not match the expected API envelope format.',
        requestId: headerRequestId ?? options?.requestId,
        status: response.status,
      });
    }

    const envelope = envelopeJson as { data: unknown; requestId?: unknown };
    const resolvedRequestId =
      typeof envelope.requestId === 'string' && envelope.requestId.trim().length > 0
        ? envelope.requestId
        : (headerRequestId ?? options?.requestId);

    return {
      data: envelope.data as T,
      requestId: resolvedRequestId,
    };
  }

  async list(role: CompanyRole, options?: PortExecutionOptions): Promise<ClientDto[]> {
    const result = await this.execute<unknown>(
      role,
      '/api/v1/clients',
      { method: 'GET' },
      options,
    );
    try {
      return parseClientList(result.data);
    } catch (err) {
      if (err instanceof ClientOperationError) {
        throw new ClientOperationError({
          code: err.code,
          message: err.message,
          requestId: result.requestId ?? options?.requestId,
          status: 200,
          cause: err,
        });
      }
      throw err;
    }
  }

  async get(role: CompanyRole, id: string, options?: PortExecutionOptions): Promise<ClientDto> {
    const result = await this.execute<unknown>(
      role,
      `/api/v1/clients/${encodeURIComponent(id)}`,
      { method: 'GET' },
      options,
    );
    try {
      return parseClientDetail(result.data);
    } catch (err) {
      if (err instanceof ClientOperationError) {
        throw new ClientOperationError({
          code: err.code,
          message: err.message,
          requestId: result.requestId ?? options?.requestId,
          status: 200,
          cause: err,
        });
      }
      throw err;
    }
  }

  async create(
    role: CompanyRole,
    input: CreateClientInput,
    options?: PortExecutionOptions,
  ): Promise<ClientDto> {
    try {
      const result = await this.execute<unknown>(
        role,
        '/api/v1/clients',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
        options,
      );
      try {
        return parseClientDto(result.data);
      } catch {
        throw new ClientOperationError({
          code: 'unexpected',
          message: 'Failed to parse created client record.',
          requestId: result.requestId ?? options?.requestId,
          status: 201,
        });
      }
    } catch (err: unknown) {
      throw sanitizeCreateClientError(err);
    }
  }

  private requireIdempotencyKey(raw: string, requestId?: string): string {
    const valid = validateIdempotencyKey(raw);
    if (valid === null) {
      throw new ClientOperationError({
        code: 'unexpected',
        message: 'Idempotency-Key is required: must be a non-blank string of at most 255 characters.',
        requestId,
      });
    }
    return valid;
  }

  private async mutate<T>(
    role: CompanyRole,
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    idempotencyKey: string,
    parse: (raw: unknown) => T,
    options?: PortExecutionOptions,
  ): Promise<T> {
    try {
      const key = this.requireIdempotencyKey(idempotencyKey, options?.requestId);
      const result = await this.execute<unknown>(
        role,
        path,
        {
          method,
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(body),
        },
        options,
      );
      try {
        return parse(result.data);
      } catch {
        throw new ClientOperationError({
          code: 'unexpected',
          message: 'Failed to parse the saved record.',
          requestId: result.requestId ?? options?.requestId,
          status: 200,
        });
      }
    } catch (err: unknown) {
      throw sanitizeClientMutationError(err);
    }
  }

  updateClient(
    role: CompanyRole,
    clientId: string,
    input: UpdateClientInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientDto> {
    return this.mutate(
      role,
      `/api/v1/clients/${encodeURIComponent(clientId)}`,
      'PATCH',
      input,
      idempotencyKey,
      parseClientDetail,
      options,
    );
  }

  createContact(
    role: CompanyRole,
    clientId: string,
    input: CreateClientContactInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientContactDto> {
    return this.mutate(
      role,
      `/api/v1/clients/${encodeURIComponent(clientId)}/contacts`,
      'POST',
      input,
      idempotencyKey,
      parseContact,
      options,
    );
  }

  updateContact(
    role: CompanyRole,
    contactId: string,
    input: UpdateClientContactInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<ClientContactDto> {
    return this.mutate(
      role,
      `/api/v1/client-contacts/${encodeURIComponent(contactId)}`,
      'PATCH',
      input,
      idempotencyKey,
      parseContact,
      options,
    );
  }

  async deleteContact(role: CompanyRole, contactId: string, options?: PortExecutionOptions): Promise<void> {
    try {
      await this.execute<unknown>(
        role,
        `/api/v1/client-contacts/${encodeURIComponent(contactId)}`,
        { method: 'DELETE' },
        options,
      );
    } catch (err: unknown) {
      throw sanitizeClientMutationError(err);
    }
  }
}
