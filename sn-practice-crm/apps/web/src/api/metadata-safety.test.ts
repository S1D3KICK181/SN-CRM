import { describe, expect, it } from 'vitest';
import {
  sanitizeRequestId,
  sanitizeServerCode,
} from './metadata-safety';

describe('metadata-safety module', () => {
  describe('sanitizeServerCode', () => {
    it('accepts valid snake_case machine error codes', () => {
      expect(sanitizeServerCode('role_not_permitted')).toBe('role_not_permitted');
      expect(sanitizeServerCode('validation_error')).toBe('validation_error');
      expect(sanitizeServerCode('internal_error')).toBe('internal_error');
      expect(sanitizeServerCode('not_found')).toBe('not_found');
    });

    it('rejects codes shaped like Indian PAN or GSTIN', () => {
      expect(sanitizeServerCode('ABCDE1234F')).toBeUndefined();
      expect(sanitizeServerCode('27ABCDE1234F1Z5')).toBeUndefined();
    });

    it('rejects arbitrary scripts, uppercase codes, and excessive length', () => {
      expect(sanitizeServerCode('<script>')).toBeUndefined();
      expect(sanitizeServerCode('ERROR_CODE')).toBeUndefined();
      expect(sanitizeServerCode('a'.repeat(65))).toBeUndefined();
      expect(sanitizeServerCode(undefined)).toBeUndefined();
    });
  });

  describe('sanitizeRequestId', () => {
    it('accepts valid RFC 4122 UUIDs', () => {
      const uuid = '00000000-0000-4000-a000-000000000001';
      expect(sanitizeRequestId(uuid)).toBe(uuid);
    });

    it('accepts valid support reference formats (req-, req_, req:)', () => {
      expect(sanitizeRequestId('req-12345')).toBe('req-12345');
      expect(sanitizeRequestId('req_abc_def')).toBe('req_abc_def');
      expect(sanitizeRequestId('req:trace-id-123')).toBe('req:trace-id-123');
    });

    it('strips values shaped like Indian PAN or GSTIN', () => {
      expect(sanitizeRequestId('ABCDE1234F')).toBeUndefined();
      expect(sanitizeRequestId('27ABCDE1234F1Z5')).toBeUndefined();
    });

    it('rejects arbitrary strings, payloads, or excessively long IDs', () => {
      expect(sanitizeRequestId('random-token-without-prefix')).toBeUndefined();
      expect(sanitizeRequestId('<payload>')).toBeUndefined();
      expect(sanitizeRequestId('req-' + 'a'.repeat(85))).toBeUndefined();
      expect(sanitizeRequestId(undefined)).toBeUndefined();
    });
  });
});
