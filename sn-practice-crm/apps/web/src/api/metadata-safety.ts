/**
 * Shared API metadata sanitization utilities to prevent reflecting raw
 * server payloads, tax IDs (PAN/GSTIN), or arbitrary injection strings
 * across client-facing error objects, error banners, or support references.
 */

export const SAFE_SERVER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const RFC4122_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SUPPORT_REQ_REF_PATTERN = /^(?:req-|req_|req:)[A-Za-z0-9._:-]{0,76}$/;
export const RAW_PAN_SHAPE_PATTERN = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
export const RAW_GSTIN_SHAPE_PATTERN =
  /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z]$/;

/**
 * Sanitizes serverCode to prevent reflecting arbitrary strings or tax IDs.
 * Preserves serverCode only if it is a conservative lower-snake-case machine code
 * matching ^[a-z][a-z0-9_]{0,63}$ and is not shaped like a raw PAN or GSTIN.
 */
export function sanitizeServerCode(code: string | undefined): string | undefined {
  if (typeof code !== 'string') return undefined;
  if (!SAFE_SERVER_CODE_PATTERN.test(code)) return undefined;
  if (RAW_PAN_SHAPE_PATTERN.test(code) || RAW_GSTIN_SHAPE_PATTERN.test(code)) return undefined;
  return code;
}

/**
 * Sanitizes requestId to prevent reflecting arbitrary strings or tax IDs.
 * Preserves requestId only if it is either an RFC4122 UUID or a conservative
 * support-reference form beginning req-, req_, or req: with total max length 80
 * and only characters in [A-Za-z0-9._:-]. Otherwise discards it.
 * Raw PAN/GSTIN-shaped values are always stripped.
 */
export function sanitizeRequestId(id: string | undefined): string | undefined {
  if (typeof id !== 'string') return undefined;
  if (RAW_PAN_SHAPE_PATTERN.test(id) || RAW_GSTIN_SHAPE_PATTERN.test(id)) return undefined;
  if (RFC4122_UUID_PATTERN.test(id)) return id;
  if (id.length <= 80 && SUPPORT_REQ_REF_PATTERN.test(id)) return id;
  return undefined;
}

/**
 * Checks whether a candidate string is a valid RFC 4122 UUID.
 */
export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && RFC4122_UUID_PATTERN.test(value);
}
