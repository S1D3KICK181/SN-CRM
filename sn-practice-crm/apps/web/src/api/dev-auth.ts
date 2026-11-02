import type { CompanyRole } from '@sn/domain';

/**
 * Insecure development authentication header mappings.
 *
 * NOTE: The local API prototype relies on the `x-demo-user-id` header to identify
 * the acting user. This header is strictly an insecure development authentication
 * mechanism for local multi-persona simulation and must never be used in production.
 */
export const ROLE_TO_DEMO_ACTOR_ID: Record<CompanyRole, string> = {
  founder: 'usr_founder',
  manager: 'usr_manager',
  senior_staff: 'usr_senior',
  staff: 'usr_staff',
  trainee: 'usr_trainee',
};

export const DEMO_ACTOR_ID_TO_NAME: Record<string, string> = {
  usr_founder: 'S. Narayanan',
  usr_manager: 'Ananya Rao',
  usr_senior: 'Priya Desai',
  usr_staff: 'Rohan Mehta',
  usr_trainee: 'Neha Kapoor',
};

export const NAME_TO_DEMO_ACTOR_ID: Record<string, string> = {
  'S. Narayanan': 'usr_founder',
  'Ananya Rao': 'usr_manager',
  'Priya Desai': 'usr_senior',
  'Rohan Mehta': 'usr_staff',
  'Neha Kapoor': 'usr_trainee',
};
