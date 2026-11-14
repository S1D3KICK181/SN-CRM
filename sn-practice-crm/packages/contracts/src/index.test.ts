import { describe, it, expect, expectTypeOf } from 'vitest';
import type { CompanyRole } from '@sn/domain';
import {
  ASSIGNMENT_STATUSES,
  WORK_ITEM_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  WORK_ITEM_TRANSITIONS,
  CLIENT_STATUSES,
  CLIENT_ENTITY_TYPES,
  INDIAN_STATES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_ALLOWED_TYPES,
  MESSAGE_PURPOSES,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_FEE_MODELS,
  ENGAGEMENT_END_OUTCOMES,
  ENGAGEMENT_OPERATIONS,
  validateCreateEngagementDraftInput,
  validateReviseEngagementDraftInput,
  validateActivateEngagementInput,
  validateAmendActiveEngagementInput,
  validateEndEngagementInput,
  type AssignmentDto,
  type RecurringScheduleDto,
  type ClientDto,
  type ClientStatus,
  type ClientContactDto,
  type ClientEntityType,
  type CreateClientInput,
  type UpdateClientInput,
  type CreateClientContactInput,
  type ClientDocumentDto,
  type CreateDocumentInput,
  type RemoveDocumentInput,
  type DocumentCategory,
  type ClientMessageDto,
  type RecordClientMessageInput,
  type MessagePurpose,
  type UpdateClientContactInput,
  type WorkItemDto,
  type CreateAssignmentInput,
  type CreateRecurringScheduleInput,
  type EngagementDto,
  type EngagementVersionDto,
  type EngagementStatus,
  type EngagementFeeModel,
  type EngagementEndOutcome,
  type CreateEngagementDraftInput,
  type ReviseEngagementDraftInput,
  type ActivateEngagementInput,
  type AmendActiveEngagementInput,
  type EndEngagementInput,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  type InvoiceDto,
  type InvoiceStatus,
  type PaymentMethod,
  type PaymentAllocationSource,
  type ApplyCreditInput,
  type PaymentReceiptDto,
  type PaymentReceiptStatus,
  type RecordVyaparBillInput,
  type RecordPaymentInput,
  type VoidFeeRecordInput,
  type ServiceDto,
  type CreateServiceInput,
  type DepartmentDto,
  type CreateDepartmentInput,
  type UpdateDepartmentInput,
  type SetDepartmentMembersInput,
  type UpdateServiceInput,
} from './index';

describe('Contracts Single Status Truth & Runtime Tuples', () => {
  it('exports ASSIGNMENT_STATUSES matching exactly 8 PostgreSQL enum states', () => {
    expect(ASSIGNMENT_STATUSES).toHaveLength(8);
    expect(ASSIGNMENT_STATUSES).toEqual([
      'draft',
      'assigned',
      'in_progress',
      'ready_for_review',
      'changes_requested',
      'approved',
      'closed',
      'cancelled',
    ]);
  });

  it('exports WORK_ITEM_STATUSES matching exactly 7 PostgreSQL enum states', () => {
    expect(WORK_ITEM_STATUSES).toHaveLength(7);
    expect(WORK_ITEM_STATUSES).toEqual([
      'todo',
      'in_progress',
      'blocked',
      'ready_for_review',
      'changes_requested',
      'completed',
      'cancelled',
    ]);
  });

  it('exports ASSIGNMENT_TRANSITIONS matching active 5 transitions', () => {
    expect(ASSIGNMENT_TRANSITIONS).toHaveLength(5);
    expect(ASSIGNMENT_TRANSITIONS).toEqual([
      'start',
      'submit',
      'complete',
      'request_changes',
      'reopen',
    ]);
  });

  it('exports WORK_ITEM_TRANSITIONS matching active 5 transitions', () => {
    expect(WORK_ITEM_TRANSITIONS).toHaveLength(5);
    expect(WORK_ITEM_TRANSITIONS).toEqual([
      'start',
      'submit',
      'complete',
      'request_changes',
      'reopen',
    ]);
  });

  it('exports CLIENT_STATUSES matching exactly 3 PostgreSQL enum states', () => {
    expect(CLIENT_STATUSES).toHaveLength(3);
    expect(CLIENT_STATUSES).toEqual(['active', 'on_hold', 'archived']);
  });

  it('verifies DTO and Input type shapes at compile time', () => {
    expectTypeOf<WorkItemDto>().toHaveProperty('code').toBeString();
    expectTypeOf<AssignmentDto>().toHaveProperty('serviceId').toBeString();
    expectTypeOf<AssignmentDto>().toHaveProperty('description').toBeNullable();
    expectTypeOf<ClientDto>().toHaveProperty('code').toBeString();
    expectTypeOf<ClientDto>().toHaveProperty('status').toMatchTypeOf<ClientStatus>();
    expectTypeOf<ClientDto>().toHaveProperty('relationshipOwnerName').toBeNullable();
    expectTypeOf<ClientDto>().toHaveProperty('activeAssignmentsCount').toBeNumber();
    expectTypeOf<ClientDto>().toHaveProperty('panMasked').toBeNullable();
    expectTypeOf<ClientDto>().toHaveProperty('pan').toEqualTypeOf<string | null>();
    expectTypeOf<ClientDto>().toHaveProperty('gstinMasked').toBeNullable();
    expectTypeOf<ClientDto>().toHaveProperty('gstin').toEqualTypeOf<string | null>();
    expectTypeOf<CreateAssignmentInput>().not.toHaveProperty('clientName');
    expectTypeOf<AssignmentDto>().toHaveProperty('engagementId').toEqualTypeOf<string | null>();
    expectTypeOf<AssignmentDto>().toHaveProperty('engagementCode').toEqualTypeOf<string | null>();
    expectTypeOf<CreateAssignmentInput>().toHaveProperty('engagementId').toEqualTypeOf<string | null | undefined>();
    expectTypeOf<CreateRecurringScheduleInput>().not.toHaveProperty('clientName');
    expectTypeOf<RecurringScheduleDto>().toHaveProperty('engagementId').toEqualTypeOf<string | null>();
    expectTypeOf<RecurringScheduleDto>().toHaveProperty('engagementCode').toEqualTypeOf<string | null>();
    expectTypeOf<CreateRecurringScheduleInput>().toHaveProperty('engagementId').toEqualTypeOf<string | null | undefined>();
  });

  it('exports ENGAGEMENT_STATUSES matching exactly 3 PostgreSQL enum states', () => {
    expect(ENGAGEMENT_STATUSES).toHaveLength(3);
    expect(ENGAGEMENT_STATUSES).toEqual(['draft', 'active', 'ended']);
  });

  it('exports ENGAGEMENT_FEE_MODELS matching exactly 4 fee models', () => {
    expect(ENGAGEMENT_FEE_MODELS).toHaveLength(4);
    expect(ENGAGEMENT_FEE_MODELS).toEqual(['fixed', 'recurring', 'milestone', 'time_based']);
  });

  it('exports ENGAGEMENT_END_OUTCOMES matching exactly 2 outcomes', () => {
    expect(ENGAGEMENT_END_OUTCOMES).toHaveLength(2);
    expect(ENGAGEMENT_END_OUTCOMES).toEqual(['completed', 'terminated']);
  });

  it('exports ENGAGEMENT_OPERATIONS matching ARCHITECTURE.md conventions', () => {
    expect(ENGAGEMENT_OPERATIONS).toEqual({
      createDraft: 'engagement.createDraft',
      reviseDraft: 'engagement.reviseDraft',
      activate: 'engagement.activate',
      amend: 'engagement.amend',
      end: 'engagement.end',
    });
  });

  it('verifies Engagement DTO and Input shapes at compile time', () => {
    expectTypeOf<EngagementDto>().toHaveProperty('code').toBeString();
    expectTypeOf<EngagementDto>().toHaveProperty('serviceId').toBeString();
    expectTypeOf<EngagementDto>().toHaveProperty('status').toMatchTypeOf<EngagementStatus>();
    expectTypeOf<EngagementDto>().toHaveProperty('approvedVersionId').toBeNullable();
    expectTypeOf<EngagementDto>().toHaveProperty('endOutcome').toBeNullable();
    expectTypeOf<EngagementDto>().toHaveProperty('endReason').toBeNullable();

    expectTypeOf<EngagementVersionDto>().toHaveProperty('engagementId').toBeString();
    expectTypeOf<EngagementVersionDto>().toHaveProperty('versionNumber').toBeNumber();
    expectTypeOf<EngagementVersionDto>().toHaveProperty('agreedFeePaise').toBeNumber();
    expectTypeOf<EngagementVersionDto>().toHaveProperty('feeModel').toMatchTypeOf<EngagementFeeModel>();
    expectTypeOf<EngagementVersionDto>().toHaveProperty('responsiblePartnerId').toBeString();
    expectTypeOf<EngagementVersionDto>().toHaveProperty('deliveryManagerId').toBeString();

    expectTypeOf<CreateEngagementDraftInput>().toHaveProperty('clientId').toBeString();
    expectTypeOf<CreateEngagementDraftInput>().toHaveProperty('serviceId').toBeString();
    expectTypeOf<CreateEngagementDraftInput>().toHaveProperty('agreedFeePaise').toBeNumber();
    expectTypeOf<ReviseEngagementDraftInput>().toHaveProperty('expectedUpdatedAt').toBeString();
    expectTypeOf<ActivateEngagementInput>().toHaveProperty('versionId').toBeString();
    expectTypeOf<AmendActiveEngagementInput>().toHaveProperty('agreedFeePaise').toBeNumber();
    expectTypeOf<EndEngagementInput>().toHaveProperty('outcome').toMatchTypeOf<EngagementEndOutcome>();
    expectTypeOf<EndEngagementInput>().toHaveProperty('reason').toBeString();
  });

  describe('Engagement contract validation functions', () => {
    const validDraftInput: CreateEngagementDraftInput = {
      clientId: '11111111-1111-4111-8111-111111111111',
      serviceId: '99999999-9999-4999-8999-999999999999',
      title: 'Statutory Audit FY 26-27',
      scope: 'Complete audit of financial statements and statutory disclosures',
      exclusions: 'Internal audit and tax advisory',
      responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
      deliveryManagerId: '33333333-3333-4333-8333-333333333333',
      feeModel: 'fixed',
      agreedFeePaise: 25000000,
      billingTerms: '50% on commencement, 50% on draft sign-off',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    };

    it('validates a valid CreateEngagementDraftInput', () => {
      const result = validateCreateEngagementDraftInput(validDraftInput);
      expect(result.success).toBe(true);
    });

    it('rejects CreateEngagementDraftInput with missing, null, or malformed serviceId', () => {
      const missingService = { ...validDraftInput } as Record<string, unknown>;
      delete missingService['serviceId'];
      const resMissing = validateCreateEngagementDraftInput(missingService);
      expect(resMissing.success).toBe(false);
      if (!resMissing.success) {
        expect(resMissing.errors).toContain('serviceId must be a valid UUID');
      }

      const nullService = { ...validDraftInput, serviceId: null };
      const resNull = validateCreateEngagementDraftInput(nullService);
      expect(resNull.success).toBe(false);
      if (!resNull.success) {
        expect(resNull.errors).toContain('serviceId must be a valid UUID');
      }

      const malformedService = { ...validDraftInput, serviceId: 'bad-service-uuid' };
      const resMalformed = validateCreateEngagementDraftInput(malformedService);
      expect(resMalformed.success).toBe(false);
      if (!resMalformed.success) {
        expect(resMalformed.errors).toContain('serviceId must be a valid UUID');
      }
    });

    it('rejects impossible calendar dates like 2026-02-30 and 2025-02-29 while accepting real leap day 2024-02-29', () => {
      const feb30 = { ...validDraftInput, startDate: '2026-02-30', endDate: '2026-03-01' };
      const resFeb30 = validateCreateEngagementDraftInput(feb30);
      expect(resFeb30.success).toBe(false);
      if (!resFeb30.success) {
        expect(resFeb30.errors).toContain('startDate must be in YYYY-MM-DD format');
      }

      const nonLeap29 = { ...validDraftInput, startDate: '2025-02-29', endDate: '2025-03-01' };
      const resNonLeap = validateCreateEngagementDraftInput(nonLeap29);
      expect(resNonLeap.success).toBe(false);
      if (!resNonLeap.success) {
        expect(resNonLeap.errors).toContain('startDate must be in YYYY-MM-DD format');
      }

      const leap2024 = { ...validDraftInput, startDate: '2024-02-29', endDate: '2024-03-01' };
      const resLeap = validateCreateEngagementDraftInput(leap2024);
      expect(resLeap.success).toBe(true);

      const leap2028 = { ...validDraftInput, startDate: '2028-02-29', endDate: '2028-03-01' };
      const resLeap2028 = validateCreateEngagementDraftInput(leap2028);
      expect(resLeap2028.success).toBe(true);
    });

    it('rejects impossible UTC calendar timestamps like 2026-02-30T10:00:00.000Z in expectedUpdatedAt', () => {
      const invalidTimestamp = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        title: 'Revised Audit Terms',
        scope: 'Updated scope',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'fixed' as const,
        agreedFeePaise: 15000000,
        billingTerms: 'Terms',
        startDate: '2026-04-01',
        expectedUpdatedAt: '2026-02-30T10:00:00.000Z',
      };
      const res = validateReviseEngagementDraftInput(invalidTimestamp);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.errors).toContain('expectedUpdatedAt must be an ISO-8601 UTC timestamp');
      }

      const validTimestamp = {
        ...invalidTimestamp,
        expectedUpdatedAt: '2024-02-29T23:59:59.999Z',
      };
      expect(validateReviseEngagementDraftInput(validTimestamp).success).toBe(true);
    });

    it('rejects CreateEngagementDraftInput with invalid UUID or non-integer paise', () => {
      const invalid = {
        ...validDraftInput,
        clientId: 'not-a-uuid',
        agreedFeePaise: 250000.5,
      };
      const result = validateCreateEngagementDraftInput(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toContain('clientId must be a valid UUID');
        expect(result.errors).toContain('agreedFeePaise must be a non-negative safe integer');
      }
    });

    it('rejects CreateEngagementDraftInput with negative fee or date inverted', () => {
      const invalid = {
        ...validDraftInput,
        agreedFeePaise: -100,
        startDate: '2026-05-01',
        endDate: '2026-04-01',
      };
      const result = validateCreateEngagementDraftInput(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toContain('agreedFeePaise must be a non-negative safe integer');
        expect(result.errors).toContain('endDate cannot precede startDate');
      }
    });

    it('validates a valid ReviseEngagementDraftInput', () => {
      const validRevise: ReviseEngagementDraftInput = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        title: 'Revised Audit Terms',
        scope: 'Updated scope with branch audits',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'recurring',
        agreedFeePaise: 30000000,
        billingTerms: 'Quarterly arrears',
        startDate: '2026-04-01',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      const result = validateReviseEngagementDraftInput(validRevise);
      expect(result.success).toBe(true);
    });

    it('rejects ReviseEngagementDraftInput with missing or non-UTC expectedUpdatedAt', () => {
      const invalid = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        title: 'Revised Audit Terms',
        scope: 'Updated scope',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'milestone',
        agreedFeePaise: 15000000,
        billingTerms: 'Per milestone',
        startDate: '2026-04-01',
        expectedUpdatedAt: 'invalid-date',
      };
      const result = validateReviseEngagementDraftInput(invalid);
      expect(result.success).toBe(false);
    });

    it('validates a valid ActivateEngagementInput', () => {
      const validActivate: ActivateEngagementInput = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        versionId: '55555555-5555-4555-8555-555555555555',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      expect(validateActivateEngagementInput(validActivate).success).toBe(true);
    });

    it('rejects ActivateEngagementInput with invalid versionId UUID', () => {
      const invalid = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        versionId: 'bad-uuid',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      expect(validateActivateEngagementInput(invalid).success).toBe(false);
    });

    it('validates a valid AmendActiveEngagementInput', () => {
      const validAmend: AmendActiveEngagementInput = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        title: 'Amended Audit FY 26-27',
        scope: 'Additional compliance verification added to scope',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'fixed',
        agreedFeePaise: 35000000,
        billingTerms: 'Milestone billing',
        startDate: '2026-04-01',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      expect(validateAmendActiveEngagementInput(validAmend).success).toBe(true);
    });

    it('validates a valid EndEngagementInput with required reason', () => {
      const validEnd: EndEngagementInput = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        outcome: 'completed',
        reason: 'Statutory audit completed and report signed off by Partner',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      expect(validateEndEngagementInput(validEnd).success).toBe(true);
    });

    it('rejects EndEngagementInput with empty or too short reason', () => {
      const invalid = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        outcome: 'terminated',
        reason: ' ',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      const result = validateEndEngagementInput(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toContain('reason is required and must be at least 2 characters');
      }
    });

    it('rejects EndEngagementInput with invalid outcome', () => {
      const invalid = {
        engagementId: '44444444-4444-4444-8444-444444444444',
        outcome: 'cancelled', // Not an allowed outcome; only completed or terminated
        reason: 'Client requested cancellation',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      };
      const result = validateEndEngagementInput(invalid);
      expect(result.success).toBe(false);
    });

    it.each([
      ['validateCreateEngagementDraftInput', validateCreateEngagementDraftInput, {
        clientId: '11111111-1111-4111-8111-111111111111',
        serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'Statutory Audit FY 26-27',
        scope: 'Complete statutory audit under Companies Act 2013',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'fixed' as const,
        agreedFeePaise: 25000000,
        billingTerms: '50% advance, 50% on sign-off',
        startDate: '2026-04-01',
      }],
      ['validateReviseEngagementDraftInput', validateReviseEngagementDraftInput, {
        engagementId: '44444444-4444-4444-8444-444444444444',
        title: 'Statutory Audit FY 26-27 Revised',
        scope: 'Updated scope',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'fixed' as const,
        agreedFeePaise: 25000000,
        billingTerms: '50% advance, 50% on sign-off',
        startDate: '2026-04-01',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      }],
      ['validateAmendActiveEngagementInput', validateAmendActiveEngagementInput, {
        engagementId: '44444444-4444-4444-8444-444444444444',
        title: 'Amended Audit FY 26-27',
        scope: 'Additional compliance verification added to scope',
        responsiblePartnerId: '22222222-2222-4222-8222-222222222222',
        deliveryManagerId: '33333333-3333-4333-8333-333333333333',
        feeModel: 'fixed' as const,
        agreedFeePaise: 35000000,
        billingTerms: 'Milestone billing',
        startDate: '2026-04-01',
        expectedUpdatedAt: '2026-11-11T10:00:00.000Z',
      }],
    ])('%s rejects non-string exclusions values', (_name, validator, baseInput) => {
      const nonStringValues = [123, true, false, ['array'], { nested: 'object' }, () => {}];
      for (const val of nonStringValues) {
        const res = validator({ ...baseInput, exclusions: val });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.errors).toContain('exclusions must be a string or null when provided');
        }
      }

      // Proves undefined, null, or string are accepted
      expect(validator({ ...baseInput, exclusions: undefined }).success).toBe(true);
      expect(validator({ ...baseInput, exclusions: null }).success).toBe(true);
      expect(validator({ ...baseInput, exclusions: 'Tax return preparation excluded' }).success).toBe(true);
    });
  });
});

describe('Billing contracts (BIL-01a)', () => {
  it('exports invoice statuses and payment methods matching the PostgreSQL enums', () => {
    expect(INVOICE_STATUSES).toEqual(['draft', 'issued', 'part_paid', 'paid', 'voided']);
    expect(PAYMENT_METHODS).toEqual(['cash', 'bank_transfer', 'cheque', 'upi', 'card', 'other']);
  });

  it('keeps the billing DTO shapes aligned with the brief', () => {
    expectTypeOf<InvoiceStatus>().toEqualTypeOf<'draft' | 'issued' | 'part_paid' | 'paid' | 'voided'>();
    expectTypeOf<PaymentMethod>().toEqualTypeOf<'cash' | 'bank_transfer' | 'cheque' | 'upi' | 'card' | 'other'>();
    expectTypeOf<PaymentReceiptStatus>().toEqualTypeOf<'received' | 'voided'>();
    expectTypeOf<InvoiceDto['currency']>().toEqualTypeOf<'INR'>();
    expectTypeOf<InvoiceDto['balancePaise']>().toEqualTypeOf<number>();
    expectTypeOf<InvoiceDto['assignmentCode']>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceDto['vyaparBillNumber']>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceDto['vyaparBillNumber']>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceDto['items'][number]['quantity']>().toEqualTypeOf<number>();
    expectTypeOf<InvoiceDto['payments'][number]['receiptStatus']>().toEqualTypeOf<PaymentReceiptStatus>();
    expectTypeOf<PaymentReceiptDto['unallocatedPaise']>().toEqualTypeOf<number>();
    expectTypeOf<PaymentReceiptDto['allocations'][number]['invoiceCode']>().toEqualTypeOf<string>();
  });
});

describe('Vyapar bill and payment contracts (FEE-01a)', () => {
  it('keeps the input shapes aligned with the brief', () => {
    expectTypeOf<RecordVyaparBillInput['clientId']>().toEqualTypeOf<string>();
    expectTypeOf<RecordVyaparBillInput['vyaparBillNumber']>().toEqualTypeOf<string>();
    expectTypeOf<RecordVyaparBillInput['billDate']>().toEqualTypeOf<string>();
    expectTypeOf<RecordVyaparBillInput['dueDate']>().toEqualTypeOf<string>();
    expectTypeOf<RecordVyaparBillInput['amountPaise']>().toEqualTypeOf<number>();
    expectTypeOf<RecordVyaparBillInput['description']>().toEqualTypeOf<string>();
    expectTypeOf<RecordPaymentInput['invoiceId']>().toEqualTypeOf<string>();
    expectTypeOf<RecordPaymentInput['receivedOn']>().toEqualTypeOf<string>();
    expectTypeOf<RecordPaymentInput['amountPaise']>().toEqualTypeOf<number>();
    expectTypeOf<RecordPaymentInput['method']>().toEqualTypeOf<PaymentMethod>();
    expectTypeOf<RecordPaymentInput['reference']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<RecordPaymentInput['notes']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<VoidFeeRecordInput['reason']>().toEqualTypeOf<string>();
  });
});

describe('Client credit contracts (FEE-02a)', () => {
  it('keeps the allocation source and credit input shapes aligned with the brief', () => {
    expectTypeOf<PaymentAllocationSource>().toEqualTypeOf<'payment' | 'credit'>();
    expectTypeOf<InvoiceDto['payments'][number]['allocationId']>().toEqualTypeOf<string>();
    expectTypeOf<InvoiceDto['payments'][number]['source']>().toEqualTypeOf<PaymentAllocationSource>();
    expectTypeOf<PaymentReceiptDto['allocations'][number]['allocationId']>().toEqualTypeOf<string>();
    expectTypeOf<PaymentReceiptDto['allocations'][number]['source']>().toEqualTypeOf<PaymentAllocationSource>();
    expectTypeOf<RecordVyaparBillInput['applyCredit']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<ApplyCreditInput>().toEqualTypeOf<Record<string, never>>();
  });
});

describe('Service list contracts (SVC-01)', () => {
  it('keeps the service shapes aligned with the brief', () => {
    expectTypeOf<ServiceDto['description']>().toEqualTypeOf<string | null>();
    expectTypeOf<ServiceDto['turnaroundDays']>().toEqualTypeOf<number | null>();
    expectTypeOf<ServiceDto['isStatutory']>().toEqualTypeOf<boolean>();
    expectTypeOf<ServiceDto['isActive']>().toEqualTypeOf<boolean>();
    expectTypeOf<ServiceDto['usage']['assignments']>().toEqualTypeOf<number>();
    expectTypeOf<ServiceDto['usage']['recurringSchedules']>().toEqualTypeOf<number>();
    expectTypeOf<ServiceDto['usage']['engagements']>().toEqualTypeOf<number>();
    expectTypeOf<CreateServiceInput['description']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<CreateServiceInput['turnaroundDays']>().toEqualTypeOf<number | null | undefined>();
    expectTypeOf<CreateServiceInput['isStatutory']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<UpdateServiceInput['name']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<UpdateServiceInput['isActive']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<UpdateServiceInput['expectedUpdatedAt']>().toEqualTypeOf<string>();
  });
});

describe('Department contracts (DEPT-01)', () => {
  it('keeps the department shapes aligned with the brief', () => {
    expectTypeOf<DepartmentDto['isActive']>().toEqualTypeOf<boolean>();
    expectTypeOf<DepartmentDto['members'][number]['isHead']>().toEqualTypeOf<boolean>();
    expectTypeOf<DepartmentDto['members'][number]['role']>().toEqualTypeOf<CompanyRole>();
    expectTypeOf<DepartmentDto['serviceIds']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<CreateDepartmentInput['name']>().toEqualTypeOf<string>();
    expectTypeOf<UpdateDepartmentInput['name']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<UpdateDepartmentInput['isActive']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<UpdateDepartmentInput['expectedUpdatedAt']>().toEqualTypeOf<string>();
    expectTypeOf<SetDepartmentMembersInput['members'][number]['userId']>().toEqualTypeOf<string>();
    expectTypeOf<ServiceDto['departmentId']>().toEqualTypeOf<string | null>();
    expectTypeOf<ServiceDto['departmentName']>().toEqualTypeOf<string | null>();
    expectTypeOf<CreateServiceInput['departmentId']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<UpdateServiceInput['departmentId']>().toEqualTypeOf<string | null | undefined>();
  });
});

describe('Client master contracts (CLI-02a)', () => {
  it('exports the entity types and the Indian states and union territories', () => {
    expect(CLIENT_ENTITY_TYPES).toEqual([
      'individual',
      'huf',
      'proprietorship',
      'partnership',
      'llp',
      'private_limited',
      'public_limited',
      'trust',
      'society',
      'other',
    ]);
    expect(INDIAN_STATES).toHaveLength(36);
    expect(new Set(INDIAN_STATES).size).toBe(36);
    expect(INDIAN_STATES).toContain('Maharashtra');
    expect(INDIAN_STATES).toContain('Delhi');
  });

  it('verifies the client master type shapes at compile time', () => {
    expectTypeOf<ClientDto>().toHaveProperty('entityType').toEqualTypeOf<ClientEntityType | null>();
    expectTypeOf<ClientDto>().toHaveProperty('addressLine1').toEqualTypeOf<string | null>();
    expectTypeOf<ClientDto>().toHaveProperty('incorporationDate').toEqualTypeOf<string | null>();
    expectTypeOf<ClientDto>().toHaveProperty('contacts').toEqualTypeOf<readonly ClientContactDto[]>();
    expectTypeOf<ClientDto>().toHaveProperty('canEdit').toBeBoolean();
    expectTypeOf<ClientDto>().toHaveProperty('canChangeOwnerOrStatus').toBeBoolean();
    expectTypeOf<ClientContactDto>().toHaveProperty('isPrimary').toBeBoolean();
    expectTypeOf<ClientContactDto>().toHaveProperty('whatsapp').toEqualTypeOf<string | null>();
    expectTypeOf<CreateClientInput>().not.toHaveProperty('contacts');
    expectTypeOf<CreateClientInput>().toHaveProperty('entityType').toEqualTypeOf<ClientEntityType | null | undefined>();
    expectTypeOf<UpdateClientInput>().toHaveProperty('expectedUpdatedAt').toEqualTypeOf<string>();
    expectTypeOf<UpdateClientInput>().toHaveProperty('pan').toEqualTypeOf<string | null | undefined>();
    expectTypeOf<UpdateClientInput>().toHaveProperty('status').toEqualTypeOf<ClientStatus | undefined>();
    expectTypeOf<CreateClientContactInput>().toHaveProperty('name').toBeString();
    expectTypeOf<UpdateClientContactInput>().toHaveProperty('expectedUpdatedAt').toEqualTypeOf<string>();
  });
});

describe('Client document contracts (DOC-01a)', () => {
  it('exports the categories, the size limit and the allowed types', () => {
    expect(DOCUMENT_CATEGORIES).toEqual([
      'kyc',
      'financial_statements',
      'returns_filed',
      'acknowledgements',
      'agreements',
      'correspondence',
      'other',
    ]);
    expect(DOCUMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(Object.keys(DOCUMENT_ALLOWED_TYPES).sort()).toEqual([
      'application/msword',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'text/csv',
    ]);
    expect(DOCUMENT_ALLOWED_TYPES['image/jpeg']).toEqual(['jpg', 'jpeg']);
  });

  it('verifies the document type shapes at compile time', () => {
    expectTypeOf<ClientDocumentDto>().toHaveProperty('category').toEqualTypeOf<DocumentCategory>();
    expectTypeOf<ClientDocumentDto>().toHaveProperty('financialYearStart').toEqualTypeOf<number | null>();
    expectTypeOf<ClientDocumentDto>().toHaveProperty('removedReason').toEqualTypeOf<string | null>();
    expectTypeOf<ClientDocumentDto>().toHaveProperty('removedAt').toEqualTypeOf<string | null>();
    expectTypeOf<ClientDocumentDto>().toHaveProperty('status').toEqualTypeOf<'pending' | 'available' | 'removed'>();
    expectTypeOf<CreateDocumentInput>().toHaveProperty('financialYearStart').toEqualTypeOf<number | null | undefined>();
    expectTypeOf<CreateDocumentInput>().toHaveProperty('sizeBytes').toBeNumber();
    expectTypeOf<RemoveDocumentInput>().toHaveProperty('reason').toBeString();
  });
});

describe('Client message contracts (MSG-01)', () => {
  it('exports the message purposes', () => {
    expect(MESSAGE_PURPOSES).toEqual(['document_request', 'deadline_reminder', 'payment_reminder', 'general']);
  });

  it('verifies the message type shapes at compile time', () => {
    expectTypeOf<ClientMessageDto>().toHaveProperty('purpose').toEqualTypeOf<MessagePurpose>();
    expectTypeOf<ClientMessageDto>().toHaveProperty('channel').toEqualTypeOf<'whatsapp'>();
    expectTypeOf<ClientMessageDto>().toHaveProperty('status').toEqualTypeOf<'opened'>();
    expectTypeOf<ClientMessageDto>().toHaveProperty('contactId').toEqualTypeOf<string | null>();
    expectTypeOf<ClientMessageDto>().toHaveProperty('assignmentCode').toEqualTypeOf<string | null>();
    expectTypeOf<ClientMessageDto>().toHaveProperty('invoiceLabel').toEqualTypeOf<string | null>();
    expectTypeOf<RecordClientMessageInput>().toHaveProperty('contactId').toEqualTypeOf<string | null | undefined>();
    expectTypeOf<RecordClientMessageInput>().toHaveProperty('assignmentId').toEqualTypeOf<string | null | undefined>();
    expectTypeOf<RecordClientMessageInput>().toHaveProperty('body').toBeString();
  });
});
