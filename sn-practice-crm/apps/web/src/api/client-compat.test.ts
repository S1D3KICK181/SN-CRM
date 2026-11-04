import { describe, expect, it } from 'vitest';
import { resolveClientUuid } from './client-compat';

describe('client-compat: resolveClientUuid', () => {
  it('passes through valid RFC 4122 UUIDs untouched', () => {
    const validUuid = '10000000-0000-4000-a000-000000000001';
    expect(resolveClientUuid(validUuid)).toBe(validUuid);
    const anotherUuid = '25000000-0000-4000-a000-000000000099';
    expect(resolveClientUuid(anotherUuid)).toBe(anotherUuid);
  });

  it('maps authentic UI fixture IDs CLI-0001 through CLI-0006 to canonical UUIDs', () => {
    expect(resolveClientUuid('CLI-0001')).toBe('10000000-0000-4000-a000-000000000001');
    expect(resolveClientUuid('CLI-0002')).toBe('10000000-0000-4000-a000-000000000002');
    expect(resolveClientUuid('CLI-0003')).toBe('10000000-0000-4000-a000-000000000003');
    expect(resolveClientUuid('CLI-0004')).toBe('10000000-0000-4000-a000-000000000004');
    expect(resolveClientUuid('CLI-0005')).toBe('10000000-0000-4000-a000-000000000005');
    expect(resolveClientUuid('CLI-0006')).toBe('10000000-0000-4000-a000-000000000006');
  });

  it('maps authentic mapper-generated slugs for the 6 clients to canonical UUIDs', () => {
    expect(resolveClientUuid('cli_aster_foods_private_l')).toBe('10000000-0000-4000-a000-000000000001');
    expect(resolveClientUuid('cli_aster_foods')).toBe('10000000-0000-4000-a000-000000000001');
    expect(resolveClientUuid('cli_bluepeak_technologies_')).toBe('10000000-0000-4000-a000-000000000002');
    expect(resolveClientUuid('cli_bluepeak_tech')).toBe('10000000-0000-4000-a000-000000000002');
    expect(resolveClientUuid('cli_sharma_retail_enterpr')).toBe('10000000-0000-4000-a000-000000000003');
    expect(resolveClientUuid('cli_sharma_retail')).toBe('10000000-0000-4000-a000-000000000003');
    expect(resolveClientUuid('cli_kedia_holdings_privat')).toBe('10000000-0000-4000-a000-000000000004');
    expect(resolveClientUuid('cli_kedia_holdings')).toBe('10000000-0000-4000-a000-000000000004');
    expect(resolveClientUuid('cli_northstar_exports_inc')).toBe('10000000-0000-4000-a000-000000000005');
    expect(resolveClientUuid('cli_northstar_exports')).toBe('10000000-0000-4000-a000-000000000005');
    expect(resolveClientUuid('cli_apex_logistics_privat')).toBe('10000000-0000-4000-a000-000000000006');
    expect(resolveClientUuid('cli_apex_logistics')).toBe('10000000-0000-4000-a000-000000000006');
  });

  it('rejects unmapped legacy slugs including cli_mehta and cli_kapoor', () => {
    expect(() => resolveClientUuid('cli_mehta')).toThrowError(/Unrecognized client identifier: cli_mehta/);
    expect(() => resolveClientUuid('cli_kapoor')).toThrowError(/Unrecognized client identifier: cli_kapoor/);
    expect(() => resolveClientUuid('unknown_slug')).toThrowError(/Unrecognized client identifier: unknown_slug/);
    expect(() => resolveClientUuid('')).toThrowError(/Unrecognized client identifier/);
  });
});
