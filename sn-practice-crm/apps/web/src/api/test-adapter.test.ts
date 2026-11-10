import { describe, expect, it } from 'vitest';
import { DeterministicTestAssignmentsAdapter } from './test-adapter';

describe('DeterministicTestAssignmentsAdapter', () => {
  it('creates schedules without injecting unsupported prototype facts', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    const created = await adapter.createSchedule('founder', {
      title: 'Monthly GST Obligations',
      clientId: '10000000-0000-4000-a000-000000000001',
      clientName: 'Aster Foods Private Limited',
      cadence: 'monthly',
      dueDay: 20,
      nextOccurrenceOn: '2026-12-01',
      ownerId: '20000000-0000-4000-a000-000000000001',
    });

    expect(created.title).toBe('Monthly GST Obligations');
    expect(created.clientName).toBe('Aster Foods Private Limited');
    expect(created.status).toBe('Active');
    expect(created.nextDueDate).toBe('20/12/2026');

    // No unsupported prototype facts
    expect(created.generationDay).toBeUndefined();
    expect(created.bankRecStatus).toBeUndefined();
    expect(created.currentStatus).toBeUndefined();
    expect(created.checklistTemplate).toBeUndefined();
    expect(created.history).toBeUndefined();
  });

  it('updates schedules preserving clean schema boundaries', async () => {
    const adapter = new DeterministicTestAssignmentsAdapter();
    const updated = await adapter.updateSchedule('founder', 'sch_123', {
      active: false,
    });

    expect(updated.id).toBe('sch_123');
    expect(updated.status).toBe('Paused');
    expect(updated.generationDay).toBeUndefined();
    expect(updated.bankRecStatus).toBeUndefined();
    expect(updated.currentStatus).toBeUndefined();
    expect(updated.checklistTemplate).toBeUndefined();
    expect(updated.history).toBeUndefined();
  });
});
