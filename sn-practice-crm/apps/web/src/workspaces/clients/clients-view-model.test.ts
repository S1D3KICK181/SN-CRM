import { describe, expect, it } from 'vitest';
import type { ClientDto } from '@sn/contracts';
import {
  computeClientDirectoryStats,
  formatClientDate,
  getClientInitials,
  matchesClientSearch,
  toClientDetailViewModel,
  toClientListItemViewModel,
  toClientStatusDetails,
} from './clients-view-model';

function createMockClientDto(overrides: Partial<ClientDto> = {}): ClientDto {
  return {
    id: 'c1111111-1111-4111-8111-111111111111',
    code: 'CL-000001',
    displayName: 'Aster Foods',
    legalName: 'Aster Foods Private Limited',
    gstinMasked: '27**********1Z5',
    panMasked: '******1234',
    email: 'contact@asterfoods.in',
    phone: '+91 98200 12345',
    relationshipOwnerId: 'u2222222-2222-4222-8222-222222222222',
    relationshipOwnerName: 'S. Narayanan',
    status: 'active',
    notes: 'Key FMCG account with monthly GST filings.',
    activeAssignmentsCount: 3,
    createdById: 'u1111111-1111-4111-8111-111111111111',
    createdAt: '2026-04-01T09:30:00.000Z',
    updatedAt: '2026-04-15T14:20:00.000Z',
    ...overrides,
  };
}

describe('clients-view-model', () => {
  describe('formatClientDate', () => {
    it('formats ISO timestamps to Indian standard DD/MM/YYYY in Asia/Kolkata', () => {
      // 09:30 UTC on 01/04/2026 is 15:00 on 01/04/2026 in Asia/Kolkata
      expect(formatClientDate('2026-04-01T09:30:00.000Z')).toBe('01/04/2026');
    });

    it('rolls late UTC date to the next India calendar date across midnight boundary', () => {
      // 20:30 UTC on 01/04/2026 + 05:30 = 02:00 AM on 02/04/2026 in Asia/Kolkata
      expect(formatClientDate('2026-04-01T20:30:00.000Z')).toBe('02/04/2026');
    });

    it('returns "Not available" for invalid, empty, or unparseable input', () => {
      expect(formatClientDate('')).toBe('Not available');
      expect(formatClientDate('invalid-date')).toBe('Not available');
    });
  });

  describe('getClientInitials', () => {
    it('extracts uppercase initials for multi-word and single-word names', () => {
      expect(getClientInitials('Aster Foods')).toBe('AF');
      expect(getClientInitials('Aster Foods Private Limited')).toBe('AF');
      expect(getClientInitials('Zenith')).toBe('ZE');
      expect(getClientInitials('   Tata   Motors   ')).toBe('TM');
    });

    it('returns "NA" for empty or blank names', () => {
      expect(getClientInitials('')).toBe('NA');
      expect(getClientInitials('   ')).toBe('NA');
    });
  });

  describe('toClientStatusDetails', () => {
    it('maps known statuses to correct labels and tones', () => {
      expect(toClientStatusDetails('active')).toEqual({ label: 'Active', tone: 'success' });
      expect(toClientStatusDetails('on_hold')).toEqual({ label: 'On Hold', tone: 'warning' });
      expect(toClientStatusDetails('archived')).toEqual({ label: 'Archived', tone: 'muted' });
    });
  });

  describe('toClientListItemViewModel', () => {
    it('projects all backed fields faithfully', () => {
      const dto = createMockClientDto();
      const vm = toClientListItemViewModel(dto);

      expect(vm.id).toBe(dto.id);
      expect(vm.code).toBe('CL-000001');
      expect(vm.displayName).toBe('Aster Foods');
      expect(vm.legalName).toBe('Aster Foods Private Limited');
      expect(vm.subtitle).toBe('Aster Foods Private Limited');
      expect(vm.initials).toBe('AF');
      expect(vm.status).toBe('active');
      expect(vm.statusLabel).toBe('Active');
      expect(vm.statusTone).toBe('success');
      expect(vm.panMasked).toBe('******1234');
      expect(vm.gstinMasked).toBe('27**********1Z5');
      expect(vm.email).toBe('contact@asterfoods.in');
      expect(vm.phone).toBe('+91 98200 12345');
      expect(vm.relationshipOwnerName).toBe('S. Narayanan');
      expect(vm.activeAssignmentsCount).toBe(3);
      expect(vm.activeAssignmentsLabel).toBe('3 active');
      expect(vm.createdAtLabel).toBe('01/04/2026');
      expect(vm.updatedAtLabel).toBe('15/04/2026');
    });

    it('enforces truthful fallbacks for null and whitespace-only fields', () => {
      const dto = createMockClientDto({
        legalName: '   ',
        panMasked: '   ',
        gstinMasked: null,
        email: '   ',
        phone: null,
        relationshipOwnerName: '   ',
        relationshipOwnerId: null,
        activeAssignmentsCount: 0,
      });
      const vm = toClientListItemViewModel(dto);

      expect(vm.legalName).toBeNull();
      // Subtitle falls back to code once, never duplicates
      expect(vm.subtitle).toBe('CL-000001');
      expect(vm.panMasked).toBe('Not available');
      expect(vm.gstinMasked).toBe('Not available');
      expect(vm.email).toBe('Not provided');
      expect(vm.phone).toBe('Not provided');
      expect(vm.relationshipOwnerName).toBe('Unassigned');
      expect(vm.activeAssignmentsLabel).toBe('0 active');
    });
  });

  describe('toClientDetailViewModel', () => {
    it('projects detail fields while stripping unneeded internal fields', () => {
      const dto = createMockClientDto({ notes: 'Requires dual partner review.' });
      const detail = toClientDetailViewModel(dto);

      expect(detail.displayName).toBe('Aster Foods');
      expect(detail.notesLabel).toBe('Requires dual partner review.');

      // Check minimized view model: raw internal metadata must not exist
      expect('rawPanMasked' in detail).toBe(false);
      expect('rawGstinMasked' in detail).toBe(false);
      expect('rawEmail' in detail).toBe(false);
      expect('rawPhone' in detail).toBe(false);
      expect('rawNotes' in detail).toBe(false);
      expect('relationshipOwnerId' in detail).toBe(false);
      expect('createdById' in detail).toBe(false);
      expect('createdAtIso' in detail).toBe(false);
      expect('updatedAtIso' in detail).toBe(false);
    });

    it('normalizes null and whitespace notes to "Not provided"', () => {
      expect(toClientDetailViewModel(createMockClientDto({ notes: null })).notesLabel).toBe('Not provided');
      expect(toClientDetailViewModel(createMockClientDto({ notes: '   ' })).notesLabel).toBe('Not provided');
    });
  });

  describe('computeClientDirectoryStats', () => {
    it('computes accurate aggregate numbers from live items, counting only nonblank relationship owners', () => {
      const items: ClientDto[] = [
        createMockClientDto({ id: 'c1', status: 'active', activeAssignmentsCount: 2, relationshipOwnerName: 'Partner A' }),
        createMockClientDto({ id: 'c2', status: 'active', activeAssignmentsCount: 5, relationshipOwnerName: null }),
        createMockClientDto({ id: 'c3', status: 'on_hold', activeAssignmentsCount: 1, relationshipOwnerName: '   ' }), // whitespace ignored
        createMockClientDto({ id: 'c4', status: 'archived', activeAssignmentsCount: 0, relationshipOwnerName: 'Partner B' }),
      ];

      const stats = computeClientDirectoryStats(items);
      expect(stats.accessibleClients).toBe(4);
      expect(stats.activeClients).toBe(2);
      expect(stats.activeAssignments).toBe(8);
      expect(stats.relationshipManaged).toBe(2); // Only Partner A and Partner B
    });

    it('returns zero counts for empty collection', () => {
      const stats = computeClientDirectoryStats([]);
      expect(stats.accessibleClients).toBe(0);
      expect(stats.activeClients).toBe(0);
      expect(stats.activeAssignments).toBe(0);
      expect(stats.relationshipManaged).toBe(0);
    });
  });

  describe('matchesClientSearch', () => {
    const client = createMockClientDto({
      code: 'CL-000042',
      displayName: 'Zenith Logistics',
      legalName: 'Zenith Multi-Modal Logistics Private Limited',
      relationshipOwnerName: 'R. Sharma',
      panMasked: '******9876',
      gstinMasked: '27**********2Z9',
    });

    it('matches by displayName case-insensitively', () => {
      expect(matchesClientSearch(client, 'zenith')).toBe(true);
      expect(matchesClientSearch(client, 'LOGISTICS')).toBe(true);
    });

    it('matches by legalName case-insensitively', () => {
      expect(matchesClientSearch(client, 'multi-modal')).toBe(true);
    });

    it('matches by code case-insensitively', () => {
      expect(matchesClientSearch(client, 'CL-000042')).toBe(true);
      expect(matchesClientSearch(client, 'cl-000042')).toBe(true);
      expect(matchesClientSearch(client, '000042')).toBe(true);
    });

    it('matches by relationship owner name', () => {
      expect(matchesClientSearch(client, 'Sharma')).toBe(true);
    });

    it('matches by masked PAN or masked GSTIN', () => {
      expect(matchesClientSearch(client, '9876')).toBe(true);
      expect(matchesClientSearch(client, '2Z9')).toBe(true);
    });

    it('returns true for empty or whitespace query', () => {
      expect(matchesClientSearch(client, '')).toBe(true);
      expect(matchesClientSearch(client, '   ')).toBe(true);
    });

    it('returns false when no fields match', () => {
      expect(matchesClientSearch(client, 'Nonexistent Corp')).toBe(false);
    });
  });

  describe('Privacy Proof against hostile runtime extras', () => {
    it('excludes arbitrary runtime secrets, raw PAN, and raw GSTIN from projections and serialization', () => {
      // Simulate hostile backend / rogue payload injecting raw secrets and identifiers
      const hostilePayload = {
        ...createMockClientDto({
          panMasked: '******1234',
          gstinMasked: '27**********1Z5',
        }),
        pan: 'ABCDE1234F',
        rawPan: 'ABCDE1234F',
        gstin: '27ABCDE1234F1Z5',
        apiKey: 'sk_live_secret_token_xyz',
        internalRiskScore: 99,
        internalNotesSecret: 'DO_NOT_DISCLOSE_INVESTIGATION',
      } as unknown as ClientDto;

      const listItem = toClientListItemViewModel(hostilePayload);
      const detailItem = toClientDetailViewModel(hostilePayload);

      // Verify keys do not exist on projected models
      const forbiddenKeys = ['pan', 'rawPan', 'gstin', 'apiKey', 'internalRiskScore', 'internalNotesSecret'];
      for (const key of forbiddenKeys) {
        expect(key in listItem).toBe(false);
        expect(key in detailItem).toBe(false);
      }

      // Verify JSON serialization contains none of the forbidden keys or secret values
      const serializedList = JSON.stringify(listItem);
      const serializedDetail = JSON.stringify(detailItem);

      expect(serializedList).not.toContain('ABCDE1234F');
      expect(serializedList).not.toContain('27ABCDE1234F1Z5');
      expect(serializedList).not.toContain('sk_live_secret_token_xyz');
      expect(serializedList).not.toContain('DO_NOT_DISCLOSE');

      expect(serializedDetail).not.toContain('ABCDE1234F');
      expect(serializedDetail).not.toContain('27ABCDE1234F1Z5');
      expect(serializedDetail).not.toContain('sk_live_secret_token_xyz');
      expect(serializedDetail).not.toContain('DO_NOT_DISCLOSE');

      // Verify search cannot match raw secrets or raw unmasked tax IDs
      expect(matchesClientSearch(hostilePayload, 'ABCDE1234F')).toBe(false);
      expect(matchesClientSearch(hostilePayload, '27ABCDE1234F1Z5')).toBe(false);
      expect(matchesClientSearch(hostilePayload, 'sk_live_secret_token_xyz')).toBe(false);
      expect(matchesClientSearch(hostilePayload, 'DO_NOT_DISCLOSE')).toBe(false);

      // But masked values and safe fields CAN match
      expect(matchesClientSearch(hostilePayload, '1234')).toBe(true);
      expect(matchesClientSearch(hostilePayload, '1Z5')).toBe(true);
      expect(matchesClientSearch(hostilePayload, 'Aster Foods')).toBe(true);
    });
  });
});
