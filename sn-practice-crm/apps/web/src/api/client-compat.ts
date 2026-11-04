const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AUTHENTIC_CLIENT_ALIASES: Record<string, string> = {
  // UI fixtures CLI-0001 through CLI-0006
  'CLI-0001': '10000000-0000-4000-a000-000000000001',
  'CLI-0002': '10000000-0000-4000-a000-000000000002',
  'CLI-0003': '10000000-0000-4000-a000-000000000003',
  'CLI-0004': '10000000-0000-4000-a000-000000000004',
  'CLI-0005': '10000000-0000-4000-a000-000000000005',
  'CLI-0006': '10000000-0000-4000-a000-000000000006',

  // Mapper-generated slugs matching the six canonical clients
  cli_aster_foods_private_l: '10000000-0000-4000-a000-000000000001',
  cli_aster_foods: '10000000-0000-4000-a000-000000000001',
  cli_bluepeak_technologies_: '10000000-0000-4000-a000-000000000002',
  cli_bluepeak_tech: '10000000-0000-4000-a000-000000000002',
  cli_sharma_retail_enterpr: '10000000-0000-4000-a000-000000000003',
  cli_sharma_retail: '10000000-0000-4000-a000-000000000003',
  cli_kedia_holdings_privat: '10000000-0000-4000-a000-000000000004',
  cli_kedia_holdings: '10000000-0000-4000-a000-000000000004',
  cli_northstar_exports_inc: '10000000-0000-4000-a000-000000000005',
  cli_northstar_exports: '10000000-0000-4000-a000-000000000005',
  cli_apex_logistics_privat: '10000000-0000-4000-a000-000000000006',
  cli_apex_logistics: '10000000-0000-4000-a000-000000000006',
};

/**
 * Resolves a raw UI client identifier or slug to a canonical RFC 4122 client UUID.
 * Throws an explicit error for unknown non-UUID identifiers (e.g. cli_mehta, cli_kapoor).
 */
export function resolveClientUuid(rawIdOrSlug: string): string {
  if (typeof rawIdOrSlug === 'string' && UUID_REGEX.test(rawIdOrSlug.trim())) {
    return rawIdOrSlug.trim();
  }
  const mapped = AUTHENTIC_CLIENT_ALIASES[rawIdOrSlug?.trim()];
  if (mapped) {
    return mapped;
  }
  throw new Error(`Unrecognized client identifier: ${rawIdOrSlug}`);
}
