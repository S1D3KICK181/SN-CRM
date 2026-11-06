import { describe, expect, it } from 'vitest';
import { maskGstinForRoutineRead, maskPanForRoutineRead } from './client-privacy';

describe('maskPanForRoutineRead', () => {
  it('masks valid uppercase PANs with six asterisks and four serial digits', () => {
    expect(maskPanForRoutineRead('AABCA1234A')).toBe('******1234');
    expect(maskPanForRoutineRead('AABCB2345B')).toBe('******2345');
    expect(maskPanForRoutineRead('AABCS3456C')).toBe('******3456');
    expect(maskPanForRoutineRead('ZZZZZ9999Z')).toBe('******9999');
  });

  it('handles lowercase and whitespace-padded valid PANs', () => {
    expect(maskPanForRoutineRead('aabca1234a')).toBe('******1234');
    expect(maskPanForRoutineRead('  AABCA1234A  ')).toBe('******1234');
    expect(maskPanForRoutineRead('\tAABCS3456C\n')).toBe('******3456');
  });

  it('returns null for null, undefined, empty, or whitespace-only inputs', () => {
    expect(maskPanForRoutineRead(null)).toBeNull();
    expect(maskPanForRoutineRead(undefined)).toBeNull();
    expect(maskPanForRoutineRead('')).toBeNull();
    expect(maskPanForRoutineRead('   ')).toBeNull();
    expect(maskPanForRoutineRead('\t \n')).toBeNull();
  });

  it('fails closed to 10 asterisks for short, malformed, or invalid formats', () => {
    const fullyMasked = '**********';
    expect(maskPanForRoutineRead('ABC')).toBe(fullyMasked);
    expect(maskPanForRoutineRead('AABCA')).toBe(fullyMasked);
    expect(maskPanForRoutineRead('1234567890')).toBe(fullyMasked);
    expect(maskPanForRoutineRead('AABCAAAAAA')).toBe(fullyMasked);
    expect(maskPanForRoutineRead('12345ABCDE')).toBe(fullyMasked);
    expect(maskPanForRoutineRead('AABCA1234AA')).toBe(fullyMasked); // 11 chars
    expect(maskPanForRoutineRead('AABC1234A')).toBe(fullyMasked); // 9 chars
    expect(maskPanForRoutineRead('AABCA-1234-A')).toBe(fullyMasked);
  });

  it('proves outputs never leak raw PAN letters or the raw unmasked PAN string', () => {
    const rawPans = ['AABCA1234A', 'XYZPQ9876Z', 'BPLMN5555K'];
    for (const raw of rawPans) {
      const masked = maskPanForRoutineRead(raw)!;
      expect(masked).toHaveLength(10);
      expect(masked.startsWith('******')).toBe(true);

      // Verify prefix letters (first 5 chars) never appear
      expect(masked).not.toContain(raw.slice(0, 5));
      // Verify final checksum letter never appears
      expect(masked.endsWith(raw.slice(-1))).toBe(false);
      // Verify complete raw PAN never appears
      expect(masked).not.toContain(raw);
    }
  });
});

describe('maskGstinForRoutineRead', () => {
  it('masks valid uppercase GSTINs with state code, 10 asterisks, and 3-char registration suffix', () => {
    expect(maskGstinForRoutineRead('27AABCA1234A1Z5')).toBe('27**********1Z5');
    expect(maskGstinForRoutineRead('27AABCB2345B1Z4')).toBe('27**********1Z4');
    expect(maskGstinForRoutineRead('27AABCS3456C1Z3')).toBe('27**********1Z3');
    expect(maskGstinForRoutineRead('29AABCK4567D2Z1')).toBe('29**********2Z1');
  });

  it('handles lowercase and whitespace-padded valid GSTINs and normalizes casing', () => {
    expect(maskGstinForRoutineRead('  27aabca1234a1z5  ')).toBe('27**********1Z5');
    expect(maskGstinForRoutineRead('\t27aabcb2345b1z4\n')).toBe('27**********1Z4');
  });

  it('returns null for null, undefined, empty, or whitespace-only inputs', () => {
    expect(maskGstinForRoutineRead(null)).toBeNull();
    expect(maskGstinForRoutineRead(undefined)).toBeNull();
    expect(maskGstinForRoutineRead('')).toBeNull();
    expect(maskGstinForRoutineRead('   ')).toBeNull();
    expect(maskGstinForRoutineRead('\t \n')).toBeNull();
  });

  it('fails closed to 15 asterisks for short, malformed, or invalid formats', () => {
    const fullyMasked = '***************';
    expect(maskGstinForRoutineRead('ABC')).toBe(fullyMasked);
    expect(maskGstinForRoutineRead('27AABCA1234A')).toBe(fullyMasked); // 12 chars
    expect(maskGstinForRoutineRead('INVALIDGSTIN123')).toBe(fullyMasked);
    expect(maskGstinForRoutineRead('2712345678901Z5')).toBe(fullyMasked); // numeric PAN part
    expect(maskGstinForRoutineRead('27AABCA1234A1Z55')).toBe(fullyMasked); // 16 chars
    expect(maskGstinForRoutineRead('XXAABCA1234A1Z5')).toBe(fullyMasked); // non-numeric state code
  });

  it('proves outputs never leak the raw GSTIN or any substring of the embedded PAN', () => {
    const sampleGstins = [
      { gstin: '27AABCA1234A1Z5', embeddedPan: 'AABCA1234A' },
      { gstin: '27AABCB2345B1Z4', embeddedPan: 'AABCB2345B' },
      { gstin: '29XYZPQ9876Z1ZA', embeddedPan: 'XYZPQ9876Z' },
    ];

    for (const { gstin, embeddedPan } of sampleGstins) {
      const masked = maskGstinForRoutineRead(gstin)!;
      expect(masked).toHaveLength(15);
      expect(masked.slice(2, 12)).toBe('**********');

      // Verify raw GSTIN is never in output
      expect(masked).not.toContain(gstin);
      // Verify embedded PAN is never in output
      expect(masked).not.toContain(embeddedPan);
      // Verify PAN prefix letters are never in output
      expect(masked).not.toContain(embeddedPan.slice(0, 5));
      // Verify PAN serial digits are never in output
      expect(masked).not.toContain(embeddedPan.slice(5, 9));
    }
  });
});
