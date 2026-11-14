import { describe, expect, it } from 'vitest';
import { addWorkingDays, computeSla, kolkataDateOf, slaStoppedAt, workingDaysBetween } from './sla';

// 2026-11-09 is a Monday, 2026-11-14 a Saturday and 2026-11-15 a Sunday.

describe('addWorkingDays', () => {
  it('counts the next working day as day 1', () => {
    expect(addWorkingDays('2026-11-09', 1)).toBe('2026-11-10');
    expect(addWorkingDays('2026-11-09', 3)).toBe('2026-11-12');
  });

  it('counts Saturday as a working day', () => {
    expect(addWorkingDays('2026-11-09', 5)).toBe('2026-11-14');
    expect(addWorkingDays('2026-11-13', 1)).toBe('2026-11-14');
  });

  it('skips Sunday across a week boundary', () => {
    expect(addWorkingDays('2026-11-09', 6)).toBe('2026-11-16');
    expect(addWorkingDays('2026-11-14', 1)).toBe('2026-11-16');
    expect(addWorkingDays('2026-11-09', 12)).toBe('2026-11-23');
  });

  it('starts from a Sunday without counting it', () => {
    expect(addWorkingDays('2026-11-15', 1)).toBe('2026-11-16');
    expect(addWorkingDays('2026-11-15', 6)).toBe('2026-11-21');
  });

  it('returns the start date for zero days', () => {
    expect(addWorkingDays('2026-11-09', 0)).toBe('2026-11-09');
  });

  it('crosses a month and a year end', () => {
    expect(addWorkingDays('2026-12-31', 2)).toBe('2027-01-02');
  });
});

describe('workingDaysBetween', () => {
  it('counts the days after the start up to and including the end', () => {
    expect(workingDaysBetween('2026-11-09', '2026-11-10')).toBe(1);
    expect(workingDaysBetween('2026-11-09', '2026-11-14')).toBe(5);
  });

  it('skips Sundays', () => {
    expect(workingDaysBetween('2026-11-13', '2026-11-16')).toBe(2);
    expect(workingDaysBetween('2026-11-09', '2026-11-16')).toBe(6);
    expect(workingDaysBetween('2026-11-14', '2026-11-15')).toBe(0);
  });

  it('is 0 when the end is not after the start', () => {
    expect(workingDaysBetween('2026-11-10', '2026-11-10')).toBe(0);
    expect(workingDaysBetween('2026-11-12', '2026-11-10')).toBe(0);
  });
});

describe('kolkataDateOf', () => {
  it('moves an instant at 19:00 UTC to the next Kolkata day', () => {
    expect(kolkataDateOf('2026-11-13T19:00:00.000Z')).toBe('2026-11-14');
  });

  it('switches day at 18:30 UTC', () => {
    expect(kolkataDateOf('2026-11-13T18:29:59.000Z')).toBe('2026-11-13');
    expect(kolkataDateOf('2026-11-13T18:30:00.000Z')).toBe('2026-11-14');
  });
});

describe('slaStoppedAt', () => {
  const stamps = { submittedAt: '2026-11-12T05:00:00.000Z', approvedAt: '2026-11-13T05:00:00.000Z', closedAt: null };

  it.each(['draft', 'assigned', 'in_progress', 'changes_requested', 'cancelled'])('is null while %s', (status) => {
    expect(slaStoppedAt({ status, ...stamps })).toBeNull();
  });

  it.each(['ready_for_review', 'approved', 'closed'])('uses the submission time when %s', (status) => {
    expect(slaStoppedAt({ status, ...stamps })).toBe('2026-11-12T05:00:00.000Z');
  });

  it('falls back to approval, then closing, for work finished without submission', () => {
    expect(slaStoppedAt({ status: 'approved', submittedAt: null, approvedAt: stamps.approvedAt, closedAt: null })).toBe(
      stamps.approvedAt,
    );
    expect(
      slaStoppedAt({ status: 'closed', submittedAt: null, approvedAt: null, closedAt: '2026-11-14T05:00:00.000Z' }),
    ).toBe('2026-11-14T05:00:00.000Z');
  });
});

describe('computeSla', () => {
  // Created Monday 09/11/2026; a target of 10 working days gives the deadline Friday 20/11/2026.
  const base = { createdAt: '2026-11-09T05:00:00.000Z', stoppedAt: null, targetDays: 10, cancelled: false };
  const at = (iso: string) => new Date(iso);

  it('is on track with more than 2 working days left', () => {
    expect(computeSla({ ...base, now: at('2026-11-11T05:00:00.000Z') })).toEqual({
      targetDays: 10,
      deadline: '2026-11-20',
      status: 'on_track',
      workingDaysUsed: 2,
      workingDaysLeft: 8,
    });
    expect(computeSla({ ...base, now: at('2026-11-17T05:00:00.000Z') })?.status).toBe('on_track');
  });

  it('is at risk with 2 or fewer working days left, including on the deadline day', () => {
    expect(computeSla({ ...base, now: at('2026-11-18T05:00:00.000Z') })).toMatchObject({
      status: 'at_risk',
      workingDaysUsed: 8,
      workingDaysLeft: 2,
    });
    expect(computeSla({ ...base, now: at('2026-11-20T05:00:00.000Z') })).toMatchObject({
      status: 'at_risk',
      workingDaysLeft: 0,
    });
  });

  it('is breached once today is past the deadline', () => {
    expect(computeSla({ ...base, now: at('2026-11-21T05:00:00.000Z') })).toMatchObject({
      status: 'breached',
      workingDaysUsed: 11,
      workingDaysLeft: 0,
    });
  });

  it('uses the Kolkata date for the current time', () => {
    // 19:00 UTC on 20/11 is already 21/11 in Kolkata.
    expect(computeSla({ ...base, now: at('2026-11-20T19:00:00.000Z') })?.status).toBe('breached');
    expect(computeSla({ ...base, now: at('2026-11-20T18:00:00.000Z') })?.status).toBe('at_risk');
  });

  it('starts the clock on the Kolkata date of creation', () => {
    // 19:00 UTC on Friday 13/11 is Saturday 14/11 in Kolkata, so day 1 is Monday 16/11.
    const sla = computeSla({
      ...base,
      createdAt: '2026-11-13T19:00:00.000Z',
      targetDays: 1,
      now: at('2026-11-14T05:00:00.000Z'),
    });
    expect(sla).toMatchObject({ deadline: '2026-11-16', workingDaysUsed: 0, workingDaysLeft: 1 });
  });

  it('starts on a Sunday', () => {
    const sla = computeSla({
      ...base,
      createdAt: '2026-11-15T05:00:00.000Z',
      targetDays: 3,
      now: at('2026-11-16T05:00:00.000Z'),
    });
    expect(sla).toMatchObject({ deadline: '2026-11-18', workingDaysUsed: 1, workingDaysLeft: 2, status: 'at_risk' });
  });

  it('is met when stopped on or before the deadline', () => {
    expect(computeSla({ ...base, stoppedAt: '2026-11-20T10:00:00.000Z', now: at('2026-12-30T05:00:00.000Z') })).toEqual({
      targetDays: 10,
      deadline: '2026-11-20',
      status: 'met',
      workingDaysUsed: 10,
      workingDaysLeft: 0,
    });
  });

  it('is late when stopped after the deadline, and does not change as time passes', () => {
    expect(computeSla({ ...base, stoppedAt: '2026-11-21T05:00:00.000Z', now: at('2026-12-30T05:00:00.000Z') })).toEqual({
      targetDays: 10,
      deadline: '2026-11-20',
      status: 'late',
      workingDaysUsed: 11,
      workingDaysLeft: 0,
    });
  });

  it('handles a target of 0 days', () => {
    const created = { ...base, targetDays: 0 };
    expect(computeSla({ ...created, now: at('2026-11-09T10:00:00.000Z') })).toMatchObject({
      deadline: '2026-11-09',
      status: 'at_risk',
      workingDaysLeft: 0,
    });
    expect(computeSla({ ...created, now: at('2026-11-10T05:00:00.000Z') })?.status).toBe('breached');
    expect(
      computeSla({ ...created, stoppedAt: '2026-11-09T11:00:00.000Z', now: at('2026-11-10T05:00:00.000Z') })?.status,
    ).toBe('met');
  });

  it('has no SLA for a cancelled assignment', () => {
    expect(computeSla({ ...base, cancelled: true, now: at('2026-11-11T05:00:00.000Z') })).toBeNull();
  });

  it('has no SLA without a target', () => {
    expect(computeSla({ ...base, targetDays: null, now: at('2026-11-11T05:00:00.000Z') })).toBeNull();
  });
});
