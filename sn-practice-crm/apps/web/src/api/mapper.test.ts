import { describe, expect, it } from 'vitest';
import type { RecurringScheduleDto } from '@sn/contracts';
import {
  DateValidationError,
  computeRecurringNextDueDate,
  mapCommandToCreateInput,
  mapDtoToAssignmentRow,
  mapDtoToRecurringScheduleRecord,
  mapScheduleCommandToCreateInput,
  parseDisplayDateToIso,
} from './mapper';

describe('Recurring schedule mapping & date arithmetic', () => {
  describe('computeRecurringNextDueDate', () => {
    it('computes due date across month boundary with positive offset', () => {
      // For GSTR-3B with cycle starting Dec 1 (covering November, period end Nov 30) + 20 offset days
      const dueDate = computeRecurringNextDueDate('2026-12-01', 20);
      expect(dueDate).toBe('20/12/2026');
    });

    it('computes due date across year boundary', () => {
      // Cycle starting Jan 1, 2027 (covering Dec 2026, period end Dec 31, 2026) + 11 offset days
      const dueDate = computeRecurringNextDueDate('2027-01-01', 11);
      expect(dueDate).toBe('11/01/2027');
    });

    it('computes period end date when offset is zero across year boundary', () => {
      // Cycle starting Jan 1, 2027 with 0 offset days = Dec 31, 2026
      const dueDate = computeRecurringNextDueDate('2027-01-01', 0);
      expect(dueDate).toBe('31/12/2026');
    });

    it('handles February leap year correctly', () => {
      // 2024 is a leap year (Feb has 29 days). Cycle starting March 1, 2024 + 15 days = March 15, 2024
      const dueDate = computeRecurringNextDueDate('2024-03-01', 15);
      expect(dueDate).toBe('15/03/2024');
    });

    it('handles February non-leap year correctly', () => {
      // 2026 is non-leap (Feb has 28 days). Cycle starting March 1, 2026 + 15 days = March 15, 2026
      const dueDate = computeRecurringNextDueDate('2026-03-01', 15);
      expect(dueDate).toBe('15/03/2026');
    });

    it('returns fallback dash for empty or missing date string', () => {
      expect(computeRecurringNextDueDate('', 10)).toBe('—');
      expect(computeRecurringNextDueDate(null, 10)).toBe('—');
      expect(computeRecurringNextDueDate(undefined, 10)).toBe('—');
    });
  });

  describe('mapDtoToRecurringScheduleRecord', () => {
    const sampleDto: RecurringScheduleDto = {
      id: '40000000-0000-4000-a000-000000000001',
      code: 'RS-001001',
      clientId: '10000000-0000-4000-a000-000000000001',
      clientName: 'Aster Foods Private Limited',
      serviceId: '50000000-0000-4000-a000-000000000001',
      service: 'GST Compliance',
      title: 'Monthly GSTR-1 & GSTR-3B Compliance',
      cadence: 'monthly',
      ownerId: '00000000-0000-4000-a000-000000000002',
      ownerName: 'Priya Desai',
      reviewerIds: ['00000000-0000-4000-a000-000000000001'],
      reviewerNames: ['S. Narayanan'],
      nextOccurrenceOn: '2026-12-01',
      dueDay: 20,
      active: true,
      createdById: '00000000-0000-4000-a000-000000000001',
      createdAt: '2026-11-01T04:00:00.000Z',
      updatedAt: '2026-11-01T04:00:00.000Z',
    };

    it('maps only truthful server-backed facts without injecting fabricated constants', () => {
      const record = mapDtoToRecurringScheduleRecord(sampleDto);

      expect(record.id).toBe(sampleDto.id);
      expect(record.code).toBe('RS-001001');
      expect(record.title).toBe(sampleDto.title);
      expect(record.service).toBe('GST Compliance');
      expect(record.category).toBe('GST Compliance');
      expect(record.clientId).toBe(sampleDto.clientId);
      expect(record.clientName).toBe(sampleDto.clientName);
      expect(record.cadence).toBe('Monthly');
      expect(record.defaultOwner).toBe('Priya Desai');
      expect(record.status).toBe('Active');
      expect(record.nextRunDate).toBe('01/12/2026');
      expect(record.nextDueDate).toBe('20/12/2026');

      // Crucial: No fabricated constants or collections!
      expect(record.generationDay).toBeUndefined();
      expect(record.bankRecStatus).toBeUndefined();
      expect(record.currentStatus).toBeUndefined();
      expect(record.checklistTemplate).toBeUndefined();
      expect(record.history).toBeUndefined();
    });

    it('truthfully maps paused status when active is false', () => {
      const record = mapDtoToRecurringScheduleRecord({
        ...sampleDto,
        active: false,
      });
      expect(record.status).toBe('Paused');
    });

    it('preserves unknown service name and does not categorize as GST', () => {
      const customDto: RecurringScheduleDto = {
        ...sampleDto,
        service: 'Special Advisory Compliance',
        title: 'Special Advisory Compliance',
      };
      const record = mapDtoToRecurringScheduleRecord(customDto);
      expect(record.service).toBe('Special Advisory Compliance');
      expect(record.category).toBe('Special Advisory Compliance');
    });
  });

  describe('parseDisplayDateToIso', () => {
    it('throws DateValidationError for missing, empty, or whitespace-only date', () => {
      expect(() => parseDisplayDateToIso('')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso('   ')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso(undefined)).toThrow(DateValidationError);
    });

    it('rejects relative date "Today" / "today" with DateValidationError', () => {
      expect(() => parseDisplayDateToIso('Today')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso('today')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso('  TODAY  ')).toThrow(DateValidationError);
    });

    it('rejects malformed date strings', () => {
      expect(() => parseDisplayDateToIso('not-a-date')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso('32/13/2026')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso('2026-13-45')).toThrow(DateValidationError);
    });

    it('rejects impossible calendar dates without auto-normalizing', () => {
      // Feb 31 does not exist
      expect(() => parseDisplayDateToIso('31/02/2026')).toThrow(DateValidationError);
      // Feb 29 in non-leap year (2025)
      expect(() => parseDisplayDateToIso('29/02/2025')).toThrow(DateValidationError);
      expect(() => parseDisplayDateToIso('2025-02-29')).toThrow(DateValidationError);
      // April 31 does not exist
      expect(() => parseDisplayDateToIso('31/04/2026')).toThrow(DateValidationError);
    });

    it('accepts valid DD/MM/YYYY formats and converts to deterministic UTC ISO', () => {
      const iso = parseDisplayDateToIso('20/11/2026');
      expect(iso).toBe('2026-11-20T12:00:00.000Z');
    });

    it('accepts valid leap year Feb 29 in 2024', () => {
      const iso = parseDisplayDateToIso('29/02/2024');
      expect(iso).toBe('2024-02-29T12:00:00.000Z');
    });

    it('accepts valid YYYY-MM-DD formats', () => {
      const iso = parseDisplayDateToIso('2026-11-20');
      expect(iso).toBe('2026-11-20T12:00:00.000Z');
    });

    it('accepts valid full ISO 8601 strings', () => {
      const iso = parseDisplayDateToIso('2026-11-20T12:00:00.000Z');
      expect(iso).toBe('2026-11-20T12:00:00.000Z');
    });
  });

  describe('mapCommandToCreateInput fail-closed validation', () => {
    const validCommand = {
      clientId: '10000000-0000-4000-a000-000000000001',
      title: 'Statutory Audit FY 2026-27',
      ownerId: '00000000-0000-4000-a000-000000000002',
      serviceId: '20000000-0000-4000-a000-000000000001',
      dueDate: '20/11/2026',
    };

    it('maps valid create command to CreateAssignmentInput', () => {
      const input = mapCommandToCreateInput(validCommand);
      expect(input.title).toBe('Statutory Audit FY 2026-27');
      expect(input.clientId).toBe('10000000-0000-4000-a000-000000000001');
      expect(input.ownerId).toBe('00000000-0000-4000-a000-000000000002');
      expect(input.serviceId).toBe('20000000-0000-4000-a000-000000000001');
      expect(input.dueAt).toBe('2026-11-20T12:00:00.000Z');
    });

    it('maps known demo actor name to authentic UUID', () => {
      const input = mapCommandToCreateInput({
        ...validCommand,
        ownerNameOrId: 'Priya Desai',
      });
      expect(input.ownerId).toBe('00000000-0000-4000-a000-000000000002');
    });

    it('fails closed when title is missing or blank', () => {
      expect(() => mapCommandToCreateInput({ ...validCommand, title: '' })).toThrow(/Assignment title is required/i);
      expect(() => mapCommandToCreateInput({ ...validCommand, title: '   ' })).toThrow(/Assignment title is required/i);
    });

    it('fails closed when clientId is missing or invalid UUID (never fabricates client slug)', () => {
      expect(() => mapCommandToCreateInput({ ...validCommand, clientId: '' })).toThrow(/Client ID is required/i);
      expect(() => mapCommandToCreateInput({ ...validCommand, clientId: 'cli_unknown_random' })).toThrow(/Unrecognized client identifier/i);
    });

    it('fails closed when owner is missing or invalid UUID (never defaults to demo UUID)', () => {
      expect(() => mapCommandToCreateInput({ ...validCommand, ownerId: '', ownerNameOrId: undefined, owner: undefined })).toThrow(/Assignment in-charge owner is required/i);
      expect(() => mapCommandToCreateInput({ ...validCommand, ownerId: 'invalid-owner-id', ownerNameOrId: undefined })).toThrow(/Invalid owner UUID/i);
    });

    it('fails closed when due date is missing or malformed', () => {
      expect(() => mapCommandToCreateInput({ ...validCommand, dueDate: '' })).toThrow(DateValidationError);
      expect(() => mapCommandToCreateInput({ ...validCommand, dueDate: 'Today' })).toThrow(DateValidationError);
      expect(() => mapCommandToCreateInput({ ...validCommand, dueDate: '31/02/2026' })).toThrow(DateValidationError);
    });

    it('fails closed when service reference is missing (never defaults to Statutory Compliance)', () => {
      expect(() => mapCommandToCreateInput({ ...validCommand, serviceId: undefined, service: undefined })).toThrow(/Assignment service is required/i);
      expect(() => mapCommandToCreateInput({ ...validCommand, serviceId: '', service: '   ' })).toThrow(/Assignment service is required/i);
    });
  });

  describe('mapScheduleCommandToCreateInput fail-closed validation', () => {
    const validScheduleCommand = {
      clientId: '10000000-0000-4000-a000-000000000001',
      title: 'Quarterly TDS Filing',
      ownerId: '00000000-0000-4000-a000-000000000002',
      serviceId: '20000000-0000-4000-a000-000000000001',
      cadence: 'quarterly' as const,
      nextOccurrenceOn: '2026-12-01',
      dueDay: 15,
    };

    it('maps valid schedule command to CreateRecurringScheduleInput', () => {
      const input = mapScheduleCommandToCreateInput(validScheduleCommand);
      expect(input.title).toBe('Quarterly TDS Filing');
      expect(input.cadence).toBe('quarterly');
      expect(input.dueDay).toBe(15);
      expect(input.nextOccurrenceOn).toBe('2026-12-01');
    });

    it('fails closed on invalid dueDay (must be integer 1..31)', () => {
      expect(() => mapScheduleCommandToCreateInput({ ...validScheduleCommand, dueDay: 0 })).toThrow(/Due offset must be an integer between 1 and 31/i);
      expect(() => mapScheduleCommandToCreateInput({ ...validScheduleCommand, dueDay: 32 })).toThrow(/Due offset must be an integer between 1 and 31/i);
      expect(() => mapScheduleCommandToCreateInput({ ...validScheduleCommand, dueDay: 15.5 })).toThrow(/Due offset must be an integer between 1 and 31/i);
    });

    it('fails closed when nextOccurrenceOn is missing or invalid', () => {
      expect(() => mapScheduleCommandToCreateInput({ ...validScheduleCommand, nextOccurrenceOn: '' })).toThrow(/First occurrence start date/i);
      expect(() => mapScheduleCommandToCreateInput({ ...validScheduleCommand, nextOccurrenceOn: '31/02/2026' })).toThrow(DateValidationError);
    });

    it('fails closed when service is missing', () => {
      expect(() => mapScheduleCommandToCreateInput({ ...validScheduleCommand, serviceId: undefined, service: undefined })).toThrow(/Recurring schedule service is required/i);
    });
  });

  describe('mapDtoToAssignmentRow canonical status and progress mapping', () => {
    const baseDto: import('@sn/contracts').AssignmentDto = {
      id: '30000000-0000-4000-a000-000000000001',
      code: 'ASN-001',
      title: 'Tax Audit',
      description: null,
      clientId: '10000000-0000-4000-a000-000000000001',
      clientName: 'Aster Foods Private Limited',
      serviceId: '20000000-0000-4000-a000-000000000001',
      service: 'Statutory Audit',
      ownerId: '00000000-0000-4000-a000-000000000002',
      ownerName: 'Priya Desai',
      reviewerIds: [],
      reviewerNames: [],
      recurringScheduleId: null,
      engagementId: null,
      engagementCode: null,
      deliveryNotes: null,
      reviewNotes: null,
      createdById: '00000000-0000-4000-a000-000000000001',
      status: 'assigned',
      progressPercent: 25,
      dueAt: '2026-11-20T12:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    it('maps "assigned" to "Assigned" and preserves progressPercent exactly', () => {
      const row = mapDtoToAssignmentRow({ ...baseDto, status: 'assigned', progressPercent: 25 });
      expect(row.status).toBe('Assigned');
      expect(row.progress).toBe(25);
      expect(row.tone).toBe('default');
    });

    it('maps "ready_for_review" to "Ready for review" and preserves progressPercent exactly', () => {
      const row = mapDtoToAssignmentRow({ ...baseDto, status: 'ready_for_review', progressPercent: 85 });
      expect(row.status).toBe('Ready for review');
      expect(row.progress).toBe(85);
      expect(row.tone).toBe('warning');
    });

    it('maps "closed" to "Closed" and preserves progressPercent without forcing 100', () => {
      const row = mapDtoToAssignmentRow({ ...baseDto, status: 'closed', progressPercent: 95 });
      expect(row.status).toBe('Closed');
      expect(row.progress).toBe(95);
      expect(row.tone).toBe('success');
    });

    it('maps "approved" to "Approved" and preserves progressPercent without forcing 100', () => {
      const row = mapDtoToAssignmentRow({ ...baseDto, status: 'approved', progressPercent: 90 });
      expect(row.status).toBe('Approved');
      expect(row.progress).toBe(90);
      expect(row.tone).toBe('success');
    });

    it('maps "changes_requested" to "Changes requested"', () => {
      const row = mapDtoToAssignmentRow({ ...baseDto, status: 'changes_requested', progressPercent: 60 });
      expect(row.status).toBe('Changes requested');
      expect(row.tone).toBe('danger');
    });

    it('maps "cancelled" to "Cancelled"', () => {
      const row = mapDtoToAssignmentRow({ ...baseDto, status: 'cancelled', progressPercent: 0 });
      expect(row.status).toBe('Cancelled');
      expect(row.tone).toBe('default');
    });
  });
});
