import {
  ENGAGEMENT_FEE_MODELS,
  type CreateEngagementDraftInput,
  type EngagementFeeModel,
  type EngagementVersionDto,
  type ReviseEngagementDraftInput,
  type AmendActiveEngagementInput,
} from '@sn/contracts';

export type DraftOption = {
  id: string;
  label: string;
};
export type EngagementTermsValues = {
  title: string;
  scope: string;
  exclusions: string;
  responsiblePartnerId: string;
  deliveryManagerId: string;
  feeModel: EngagementFeeModel | string;
  agreedFee: string;
  billingTerms: string;
  startDate: string;
  endDate: string;
};
export type DraftValues = EngagementTermsValues & {
  clientId: string;
  serviceId: string;
};
export type DraftErrors = Partial<Record<keyof DraftValues | 'form', string>>;
export type EngagementTermsErrors = Partial<Record<keyof EngagementTermsValues | 'form', string>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SAFE_ERROR = 'Unable to create the engagement draft. Please try again.';
export const SAFE_REVISE_ERROR = 'Unable to revise the engagement draft. Please try again.';
export const SAFE_AMEND_ERROR = 'Unable to approve the engagement amendment. Please try again.';
export function isValidUuid(value: string): boolean {
  return UUID.test(value);
}
export function parseRupeeToPaise(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [rupees, fraction = ''] = trimmed.split('.');
  const paise = Number(`${rupees}${fraction.padEnd(2, '0')}`);
  return Number.isSafeInteger(paise) ? paise : null;
}
export function formatPaiseAsRupee(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) return '';
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}
export function prefillEngagementTerms(version: EngagementVersionDto): EngagementTermsValues {
  return {
    title: version.title,
    scope: version.scope,
    exclusions: version.exclusions ?? '',
    responsiblePartnerId: version.responsiblePartnerId,
    deliveryManagerId: version.deliveryManagerId,
    feeModel: version.feeModel,
    agreedFee: formatPaiseAsRupee(version.agreedFeePaise),
    billingTerms: version.billingTerms,
    startDate: version.startDate,
    endDate: version.endDate ?? '',
  };
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export function validateEngagementTerms(
  input: EngagementTermsValues,
  options: { partners: readonly DraftOption[]; managers: readonly DraftOption[] },
): EngagementTermsErrors {
  const errors: EngagementTermsErrors = {};
  const has = (items: readonly DraftOption[], id: string) => isValidUuid(id) && items.some((item) => isValidUuid(item.id) && item.id === id);
  if (input.title.trim().length < 2 || input.title.trim().length > 180) errors.title = 'Title must be 2–180 characters.';
  if (input.scope.trim().length < 2) errors.scope = 'Scope must be at least 2 characters.';
  if (!has(options.partners, input.responsiblePartnerId)) errors.responsiblePartnerId = 'Select a responsible partner.';
  if (!has(options.managers, input.deliveryManagerId)) errors.deliveryManagerId = 'Select a delivery manager.';
  if (!ENGAGEMENT_FEE_MODELS.includes(input.feeModel as EngagementFeeModel)) errors.feeModel = 'Select a valid fee model.';
  if (parseRupeeToPaise(input.agreedFee) === null) errors.agreedFee = 'Enter a valid non-negative rupee amount with up to 2 decimals.';
  if (input.billingTerms.trim().length < 2) errors.billingTerms = 'Billing terms must be at least 2 characters.';
  if (!validDate(input.startDate)) errors.startDate = 'Enter a valid start date.';
  if (input.endDate && (!validDate(input.endDate) || (validDate(input.startDate) && input.endDate < input.startDate))) errors.endDate = 'End date cannot be before the start date.';
  return errors;
}
export function validateEngagementDraft(
  input: DraftValues,
  options: {
    clients: readonly DraftOption[];
    services: readonly DraftOption[];
    partners: readonly DraftOption[];
    managers: readonly DraftOption[];
  },
): DraftErrors {
  const errors: DraftErrors = validateEngagementTerms(input, options);
  const has = (items: readonly DraftOption[], id: string) => isValidUuid(id) && items.some((item) => isValidUuid(item.id) && item.id === id);
  if (!has(options.clients, input.clientId)) errors.clientId = 'Select a client.';
  if (!has(options.services, input.serviceId)) errors.serviceId = 'Select a service.';
  return errors;
}
export function toCreateEngagementDraftInput(input: DraftValues): CreateEngagementDraftInput {
  const agreedFeePaise = parseRupeeToPaise(input.agreedFee);
  if (agreedFeePaise === null || !ENGAGEMENT_FEE_MODELS.includes(input.feeModel as EngagementFeeModel)) {
    throw new Error('invalid engagement draft');
  }
  return {
    clientId: input.clientId,
    serviceId: input.serviceId,
    title: input.title.trim(),
    scope: input.scope.trim(),
    exclusions: input.exclusions.trim() || null,
    responsiblePartnerId: input.responsiblePartnerId,
    deliveryManagerId: input.deliveryManagerId,
    feeModel: input.feeModel as EngagementFeeModel,
    agreedFeePaise,
    billingTerms: input.billingTerms.trim(),
    startDate: input.startDate,
    endDate: input.endDate || null,
  };
}
type EngagementTermsInputFields = {
  engagementId: string;
  expectedUpdatedAt: string;
  title: string;
  scope: string;
  exclusions: string | null;
  responsiblePartnerId: string;
  deliveryManagerId: string;
  feeModel: EngagementFeeModel;
  agreedFeePaise: number;
  billingTerms: string;
  startDate: string;
  endDate: string | null;
};

function toEngagementTermsInput(
  engagementId: string,
  expectedUpdatedAt: string,
  input: EngagementTermsValues,
): EngagementTermsInputFields {
  const agreedFeePaise = parseRupeeToPaise(input.agreedFee);
  if (
    agreedFeePaise === null ||
    !ENGAGEMENT_FEE_MODELS.includes(input.feeModel as EngagementFeeModel)
  ) {
    throw new Error('invalid engagement revision');
  }
  return {
    engagementId,
    expectedUpdatedAt,
    title: input.title.trim(),
    scope: input.scope.trim(),
    exclusions: input.exclusions.trim() || null,
    responsiblePartnerId: input.responsiblePartnerId,
    deliveryManagerId: input.deliveryManagerId,
    feeModel: input.feeModel as EngagementFeeModel,
    agreedFeePaise,
    billingTerms: input.billingTerms.trim(),
    startDate: input.startDate,
    endDate: input.endDate || null,
  };
}

export function toReviseEngagementDraftInput(
  engagementId: string,
  expectedUpdatedAt: string,
  input: EngagementTermsValues,
): ReviseEngagementDraftInput {
  return toEngagementTermsInput(engagementId, expectedUpdatedAt, input);
}

export function toAmendActiveEngagementInput(
  engagementId: string,
  expectedUpdatedAt: string,
  input: EngagementTermsValues,
): AmendActiveEngagementInput {
  return toEngagementTermsInput(engagementId, expectedUpdatedAt, input);
}
