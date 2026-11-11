import { describe, expect, it } from 'vitest';
import type { CompanyRole } from '@sn/domain';
import {
  EngagementOperationError,
  SAFE_ENGAGEMENT_ERROR_MESSAGES,
  sanitizeEngagementError,
  validateIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  getEngagementCapabilities,
  hasEngagementCapability,
  type EngagementErrorCode,
} from './engagements-types';

describe('EngagementOperationError', () => {
  it('sets name, code, message, status, serverCode, requestId', () => {
    const err = new EngagementOperationError({
      code: 'forbidden',
      message: 'Not allowed',
      status: 403,
      serverCode: 'engagement_forbidden',
      requestId: '00000000-0000-4000-a000-000000000001',
      cause: new Error('inner'),
    });
    expect(err.name).toBe('EngagementOperationError');
    expect(err.code).toBe('forbidden');
    expect(err.message).toBe('Not allowed');
    expect(err.status).toBe(403);
    expect(err.serverCode).toBe('engagement_forbidden');
    expect(err.requestId).toBe('00000000-0000-4000-a000-000000000001');
    expect(err.cause).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(Error);
  });

  it('omits cause property when not provided', () => {
    const err = new EngagementOperationError({ code: 'unexpected', message: 'oops' });
    expect('cause' in err).toBe(false);
  });
});

describe('sanitizeEngagementError', () => {
  it('replaces message with whitelisted copy for known codes', () => {
    const codes: EngagementErrorCode[] = [
      'unauthorized',
      'forbidden',
      'not_found',
      'conflict',
      'validation',
      'network',
      'aborted',
      'unexpected',
    ];
    for (const code of codes) {
      const raw = new EngagementOperationError({
        code,
        message: 'RAW INTERNAL SERVER DETAILS',
        status: 500,
        serverCode: 'raw_code',
        requestId: '00000000-0000-4000-a000-000000000002',
        cause: { sensitive: true },
      });
      const sanitized = sanitizeEngagementError(raw);
      expect(sanitized.message).toBe(SAFE_ENGAGEMENT_ERROR_MESSAGES[code]);
      expect(sanitized.code).toBe(code);
      expect(sanitized.status).toBe(500);
      // serverCode is preserved when it passes sanitization pattern (all lowercase snake)
      expect(sanitized.serverCode).toBe('raw_code');
      expect(sanitized.requestId).toBe('00000000-0000-4000-a000-000000000002');
      // cause must NOT be retained on sanitized error
      expect(sanitized.cause).toBeUndefined();
    }
  });

  it('strips arbitrary server message from raw (non-EngagementOperationError) thrown value', () => {
    const sanitized = sanitizeEngagementError(new Error('sql: injection attempt'));
    expect(sanitized.code).toBe('unexpected');
    expect(sanitized.message).toBe(SAFE_ENGAGEMENT_ERROR_MESSAGES.unexpected);
    expect(sanitized.cause).toBeUndefined();
  });

  it('handles thrown non-Error values', () => {
    const sanitized = sanitizeEngagementError('string error');
    expect(sanitized.code).toBe('unexpected');
  });

  it('strips serverCode that does not match safe pattern', () => {
    const raw = new EngagementOperationError({
      code: 'validation',
      message: 'bad',
      serverCode: 'BAD_CODE_UPPERCASE',
    });
    const sanitized = sanitizeEngagementError(raw);
    expect(sanitized.serverCode).toBeUndefined();
  });

  it('strips requestId that does not match safe pattern', () => {
    const raw = new EngagementOperationError({
      code: 'network',
      message: 'net',
      requestId: 'not-a-valid-id!@#',
    });
    const sanitized = sanitizeEngagementError(raw);
    expect(sanitized.requestId).toBeUndefined();
  });
});

describe('validateIdempotencyKey', () => {
  it('accepts non-blank strings up to 255 chars', () => {
    expect(validateIdempotencyKey('abc')).toBe('abc');
    expect(validateIdempotencyKey('  hello  ')).toBe('hello');
    expect(validateIdempotencyKey('a'.repeat(255))).toBe('a'.repeat(255));
  });

  it('rejects blank strings', () => {
    expect(validateIdempotencyKey('')).toBeNull();
    expect(validateIdempotencyKey('   ')).toBeNull();
  });

  it('rejects strings longer than 255 chars', () => {
    expect(validateIdempotencyKey('a'.repeat(256))).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(validateIdempotencyKey(null)).toBeNull();
    expect(validateIdempotencyKey(undefined)).toBeNull();
    expect(validateIdempotencyKey(123)).toBeNull();
    expect(validateIdempotencyKey({})).toBeNull();
  });

  it('preserves the caller-supplied key exactly after trimming', () => {
    const key = 'my-key-with-special-$#@!-chars';
    expect(validateIdempotencyKey(key)).toBe(key);
  });

  it('IDEMPOTENCY_KEY_MAX_LENGTH constant equals 255', () => {
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(255);
  });
});

describe('getEngagementCapabilities', () => {
  it('founder has all six capabilities', () => {
    const caps = getEngagementCapabilities('founder');
    expect(caps.has('read')).toBe(true);
    expect(caps.has('createDraft')).toBe(true);
    expect(caps.has('reviseDraft')).toBe(true);
    expect(caps.has('activate')).toBe(true);
    expect(caps.has('amend')).toBe(true);
    expect(caps.has('end')).toBe(true);
  });

  it('manager has read, createDraft, reviseDraft only', () => {
    const caps = getEngagementCapabilities('manager');
    expect(caps.has('read')).toBe(true);
    expect(caps.has('createDraft')).toBe(true);
    expect(caps.has('reviseDraft')).toBe(true);
    expect(caps.has('activate')).toBe(false);
    expect(caps.has('amend')).toBe(false);
    expect(caps.has('end')).toBe(false);
  });

  const noAccessRoles: CompanyRole[] = ['senior_staff', 'staff', 'trainee'];
  for (const role of noAccessRoles) {
    it(`${role} has no capabilities`, () => {
      const caps = getEngagementCapabilities(role);
      expect(caps.size).toBe(0);
    });
  }
});

describe('hasEngagementCapability', () => {
  it('returns true for founder activate', () => {
    expect(hasEngagementCapability('founder', 'activate')).toBe(true);
  });

  it('returns false for manager activate', () => {
    expect(hasEngagementCapability('manager', 'activate')).toBe(false);
  });

  it('returns false for staff read', () => {
    expect(hasEngagementCapability('staff', 'read')).toBe(false);
  });
});
