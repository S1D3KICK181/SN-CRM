import type { CompanyRole } from '@sn/domain';

/**
 * Insecure development authentication header mappings.
 *
 * NOTE: The local API prototype relies on the `x-demo-user-id` header to identify
 * the acting user. This header is strictly an insecure development authentication
 * mechanism for local multi-persona simulation and must never be used in production.
 */
export const ROLE_TO_DEMO_ACTOR_ID: Record<CompanyRole, string> = {
  founder: '00000000-0000-4000-a000-000000000001',
  manager: '00000000-0000-4000-a000-000000000002',
  senior_staff: '00000000-0000-4000-a000-000000000003',
  staff: '00000000-0000-4000-a000-000000000004',
  trainee: '00000000-0000-4000-a000-000000000005',
};

export const DEMO_ACTOR_ID_TO_NAME: Record<string, string> = {
  '00000000-0000-4000-a000-000000000001': 'S. Narayanan',
  '00000000-0000-4000-a000-000000000002': 'Priya Desai',
  '00000000-0000-4000-a000-000000000003': 'Ananya Rao',
  '00000000-0000-4000-a000-000000000004': 'Rohan Mehta',
  '00000000-0000-4000-a000-000000000005': 'Neha Kapoor',
  usr_founder: 'S. Narayanan',
  usr_manager: 'Priya Desai',
  usr_senior: 'Ananya Rao',
  usr_staff: 'Rohan Mehta',
  usr_trainee: 'Neha Kapoor',
};

export const NAME_TO_DEMO_ACTOR_ID: Record<string, string> = {
  'S. Narayanan': '00000000-0000-4000-a000-000000000001',
  'Priya Desai': '00000000-0000-4000-a000-000000000002',
  'Ananya Rao': '00000000-0000-4000-a000-000000000003',
  'Rohan Mehta': '00000000-0000-4000-a000-000000000004',
  'Neha Kapoor': '00000000-0000-4000-a000-000000000005',
};
