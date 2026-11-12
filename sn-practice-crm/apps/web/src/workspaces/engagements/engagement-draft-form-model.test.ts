import { describe, expect, it } from 'vitest';
import { formatPaiseAsRupee, parseRupeeToPaise, prefillEngagementTerms, toAmendActiveEngagementInput, toCreateEngagementDraftInput, toReviseEngagementDraftInput, validateEngagementDraft, validateEngagementTerms, type DraftValues } from './engagement-draft-form-model';
import type { EngagementVersionDto } from '@sn/contracts';
const id = '11111111-1111-4111-8111-111111111111';
const values: DraftValues = { clientId: id, serviceId: id, title: 'Tax', scope: 'Scope', exclusions: '', responsiblePartnerId: id, deliveryManagerId: id, feeModel: 'fixed', agreedFee: '10.05', billingTerms: 'Monthly', startDate: '2026-02-28', endDate: '' };
const options = { clients: [{ id, label: 'Client' }], services: [{ id, label: 'Service' }], partners: [{ id, label: 'Founder' }], managers: [{ id, label: 'Manager' }] };
describe('engagement draft model', () => {
  it('formats paise and prefills every nullable term safely', () => {
    expect(formatPaiseAsRupee(1250050)).toBe('12500.50');
    const version = { id, engagementId: id, versionNumber: 1, title: 'Tax', scope: 'Scope', exclusions: null, responsiblePartnerId: id, responsiblePartnerName: 'Founder', deliveryManagerId: id, deliveryManagerName: 'Manager', feeModel: 'fixed', agreedFeePaise: 1250050, billingTerms: 'Monthly', startDate: '2026-01-01', endDate: null, approvedAt: null, approvedById: null, createdById: id, createdAt: '2026-01-01T00:00:00Z' } as EngagementVersionDto;
    expect(prefillEngagementTerms(version)).toEqual({ title: 'Tax', scope: 'Scope', exclusions: '', responsiblePartnerId: id, deliveryManagerId: id, feeModel: 'fixed', agreedFee: '12500.50', billingTerms: 'Monthly', startDate: '2026-01-01', endDate: '' });
  });
  it('supports shared terms validation and exact revision payloads', () => {
    expect(parseRupeeToPaise('12500.50')).toBe(1250050);
    expect(validateEngagementTerms(values, options)).toEqual({});
    expect(toReviseEngagementDraftInput(id, '2026-01-01T00:00:00Z', values)).toEqual(expect.objectContaining({ engagementId: id, expectedUpdatedAt: '2026-01-01T00:00:00Z', agreedFeePaise: 1005 }));
    expect(toReviseEngagementDraftInput(id, '2026-01-01T00:00:00Z', values)).not.toHaveProperty('clientId');
  });
  it.each([['0', 0], ['10', 1000], ['0.05', 5], ['10.50', 1050]])('%s converts exactly', (input, expected) => expect(parseRupeeToPaise(input)).toBe(expected));
  it.each(['-1', 'junk', '1.234', '90071992547409.92'])('rejects unsafe fee %s', (input) => expect(parseRupeeToPaise(input)).toBeNull());
  it('validates dates and stale ids', () => { expect(validateEngagementDraft({ ...values, startDate: '2026-02-30', clientId: 'bad' }, options)).toMatchObject({ clientId: expect.any(String), startDate: expect.any(String) }); expect(validateEngagementDraft({ ...values, endDate: '2026-02-27' }, options)).toHaveProperty('endDate'); });
  it('independently rejects stale people, invalid fee model, impossible start, and reversed end', () => {
    expect(validateEngagementTerms({ ...values, responsiblePartnerId: 'bad' }, options)).toHaveProperty('responsiblePartnerId');
    expect(validateEngagementTerms({ ...values, deliveryManagerId: 'bad' }, options)).toHaveProperty('deliveryManagerId');
    expect(validateEngagementTerms({ ...values, feeModel: 'invalid' }, options)).toHaveProperty('feeModel');
    expect(validateEngagementTerms({ ...values, startDate: '2026-02-30' }, options)).toHaveProperty('startDate');
    expect(validateEngagementTerms({ ...values, endDate: '2026-02-27' }, options)).toHaveProperty('endDate');
  });
  it('emits exactly the revision contract and no server-owned fields', () => {
    const payload = toReviseEngagementDraftInput(id, '2026-01-01T00:00:00Z', values);
    expect(payload).toEqual({ engagementId: id, expectedUpdatedAt: '2026-01-01T00:00:00Z', title: 'Tax', scope: 'Scope', exclusions: null, responsiblePartnerId: id, deliveryManagerId: id, feeModel: 'fixed', agreedFeePaise: 1005, billingTerms: 'Monthly', startDate: '2026-02-28', endDate: null });
    for (const key of ['clientId', 'serviceId', 'code', 'versionId', 'clientName', 'serviceName', 'responsiblePartnerName', 'deliveryManagerName', 'agreedFee']) expect(payload).not.toHaveProperty(key);
  });
  it('emits exactly the amendment contract and no server-owned fields', () => {
    const payload = toAmendActiveEngagementInput(id, '2026-01-01T00:00:00Z', values);
    expect(payload).toEqual({ engagementId: id, expectedUpdatedAt: '2026-01-01T00:00:00Z', title: 'Tax', scope: 'Scope', exclusions: null, responsiblePartnerId: id, deliveryManagerId: id, feeModel: 'fixed', agreedFeePaise: 1005, billingTerms: 'Monthly', startDate: '2026-02-28', endDate: null });
    for (const key of ['clientId', 'serviceId', 'status', 'version', 'versionNumber', 'createdAt', 'updatedAt', 'approvedAt', 'approvedById']) expect(payload).not.toHaveProperty(key);
  });
  it('constructs the exact contract payload', () => { const payload = toCreateEngagementDraftInput(values); expect(payload).toEqual({ clientId: id, serviceId: id, title: 'Tax', scope: 'Scope', exclusions: null, responsiblePartnerId: id, deliveryManagerId: id, feeModel: 'fixed', agreedFeePaise: 1005, billingTerms: 'Monthly', startDate: '2026-02-28', endDate: null }); expect(payload).not.toHaveProperty('agreedFee'); });
  it.each([['1', 100], ['1.2', 120], ['1.20', 120], ['999999', 99999900]])('converts fee %s exactly', (input, expected) => expect(parseRupeeToPaise(input)).toBe(expected));
  it.each(['-1', '+1', '1.234', '1e2', 'Infinity', '90071992547409.92'])('rejects unsafe or junk fee %s', (input) => expect(parseRupeeToPaise(input)).toBeNull());
  it('rejects blank and one-character title, scope, and billing terms', () => {
    const errors = validateEngagementDraft({ ...values, title: ' ', scope: 'x', billingTerms: ' ' }, options);
    expect(errors.title).toBeTruthy(); expect(errors.scope).toBeTruthy(); expect(errors.billingTerms).toBeTruthy();
  });
  it('rejects a title over the contract maximum but does not invent a scope maximum', () => {
    const errors = validateEngagementDraft({ ...values, title: 'x'.repeat(181), scope: 'x'.repeat(5001) }, options);
    expect(errors.title).toBeTruthy(); expect(errors.scope).toBeUndefined();
  });
  it('rejects stale and malformed ids in every option category', () => {
    const errors = validateEngagementDraft({ ...values, clientId: 'bad', serviceId: 'bad', responsiblePartnerId: 'bad', deliveryManagerId: 'bad' }, options);
    expect(errors).toMatchObject({ clientId: expect.any(String), serviceId: expect.any(String), responsiblePartnerId: expect.any(String), deliveryManagerId: expect.any(String) });
  });
  it('rejects an invalid fee model', () => {
    expect(validateEngagementDraft({ ...values, feeModel: 'invalid' }, options).feeModel).toBe('Select a valid fee model.');
  });
  it('does not emit an invalid fee model', () => {
    expect(() => toCreateEngagementDraftInput({ ...values, feeModel: 'invalid' })).toThrow('invalid engagement draft');
  });
  it('rejects impossible calendar dates and reversed end dates', () => {
    expect(validateEngagementDraft({ ...values, startDate: '2026-02-30' }, options).startDate).toBeTruthy();
    expect(validateEngagementDraft({ ...values, endDate: '2026-02-27' }, options).endDate).toBeTruthy();
  });
});
