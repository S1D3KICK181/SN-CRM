import { createHash } from 'node:crypto';

/**
 * Deterministically serialize any JSON-serializable value with sorted keys recursively.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((key) => {
        const val = (obj as Record<string, unknown>)[key];
        return JSON.stringify(key) + ':' + canonicalJsonStringify(val);
      })
      .join(',') +
    '}'
  );
}

/**
 * Compute canonical SHA-256 hex digest for an arbitrary JSON payload.
 */
export function computeRequestHash(payload: unknown): string {
  const canonicalJson = canonicalJsonStringify(payload);
  return createHash('sha256').update(canonicalJson).digest('hex');
}
