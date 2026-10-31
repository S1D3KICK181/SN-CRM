import type { CompanyRole } from '@sn/domain';

export interface SessionActor {
  id: string;
  name: string;
  role: CompanyRole;
  reportsToId: string | null;
}

export interface ApiEnvelope<T> {
  data: T;
  requestId: string;
}

export interface ApiProblem {
  code: string;
  message: string;
  requestId: string;
}
