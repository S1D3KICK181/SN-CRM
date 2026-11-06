const VALID_PAN_REGEX = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const FULLY_MASKED_PAN = '**********';

const VALID_GSTIN_REGEX = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z]$/;
const FULLY_MASKED_GSTIN = '***************';

/**
 * Masks a Permanent Account Number (PAN) for routine, un-audited reads.
 *
 * Rules:
 * - null, undefined, or all-whitespace strings return null.
 * - Valid 10-character PANs ([A-Za-z]{5}[0-9]{4}[A-Za-z]) return six ASCII
 *   asterisks plus the four numeric serial digits (e.g. '******1234').
 *   Total length: 10. No alphabetic series or checksum letters are ever revealed.
 * - Any malformed non-empty value fails closed to '**********' (10 asterisks)
 *   so that no substring of an unvalidated or irregular identifier is ever echoed.
 */
export function maskPanForRoutineRead(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!VALID_PAN_REGEX.test(trimmed)) {
    return FULLY_MASKED_PAN;
  }
  return `******${trimmed.slice(5, 9)}`;
}

/**
 * Masks a Goods and Services Tax Identification Number (GSTIN) for routine, un-audited reads.
 *
 * Rules:
 * - null, undefined, or all-whitespace strings return null.
 * - Valid 15-character GSTINs (2 digits state code + 10-char PAN + 1 entity char + literal Z + 1 checksum)
 *   replace the complete embedded PAN (positions 3-12) with 10 asterisks while preserving
 *   the 2-digit state code and final 3 registration characters (e.g. '27**********1Z5').
 *   Total length: 15. No characters of the embedded PAN are ever revealed.
 * - Any malformed non-empty value fails closed to '***************' (15 asterisks)
 *   so that no substring of an unvalidated or irregular identifier is ever echoed.
 */
export function maskGstinForRoutineRead(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!VALID_GSTIN_REGEX.test(trimmed)) {
    return FULLY_MASKED_GSTIN;
  }
  const stateCode = trimmed.slice(0, 2);
  const tail = trimmed.slice(12).toUpperCase();
  return `${stateCode}**********${tail}`;
}
