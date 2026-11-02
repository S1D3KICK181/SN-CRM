import { describe, expect, it } from 'vitest';
import type { AssignmentRow } from '../data';
import { resolveDrawerSave, syncDrawerAssignment } from './drawer-sync';

const SAMPLE_ROW_1: AssignmentRow = {
  id: 'ASN-0001',
  title: 'Assignment One',
  client: 'Client One',
  service: 'GST',
  due: '10/11/2026',
  owner: 'Priya Desai',
  status: 'In progress',
  progress: 50,
  tone: 'default',
};

const SAMPLE_ROW_2: AssignmentRow = {
  id: 'ASN-0002',
  title: 'Assignment Two',
  client: 'Client Two',
  service: 'Audit',
  due: '15/11/2026',
  owner: 'Rohan Mehta',
  status: 'Open',
  progress: 15,
  tone: 'default',
};

describe('syncDrawerAssignment (role-scope & live synchronization)', () => {
  it('returns null when drawer has no selected assignment', () => {
    expect(syncDrawerAssignment(null, [SAMPLE_ROW_1, SAMPLE_ROW_2])).toBeNull();
  });

  it('syncs to fresh live row when selected assignment is present in active role assignments', () => {
    const staleSelected: AssignmentRow = {
      ...SAMPLE_ROW_1,
      progress: 30, // outdated progress in local state
    };
    const liveFresh: AssignmentRow = {
      ...SAMPLE_ROW_1,
      progress: 60, // fresh progress from server
    };

    const result = syncDrawerAssignment(staleSelected, [liveFresh, SAMPLE_ROW_2]);
    expect(result).toBe(liveFresh);
    expect(result?.progress).toBe(60);
  });

  it('clears/closes drawer (returns null) when selected assignment does not exist in new role assignments', () => {
    // e.g. User selected SAMPLE_ROW_1 as founder, then switched to trainee role where SAMPLE_ROW_1 is absent
    const traineeAssignments = [SAMPLE_ROW_2];

    const result = syncDrawerAssignment(SAMPLE_ROW_1, traineeAssignments);
    expect(result).toBeNull();
  });

  it('immediately closes drawer when role changes and active assignments list is synchronously emptied', () => {
    // On actual role change, assignments is synchronously cleared to [] before new list loads
    const result = syncDrawerAssignment(SAMPLE_ROW_1, []);
    expect(result).toBeNull();

    // Even if a late transition response from the previous role arrives now, it must never reopen the drawer
    const lateServerResponse: AssignmentRow = {
      ...SAMPLE_ROW_1,
      status: 'Completed',
    };
    const nextDrawer = resolveDrawerSave(result, lateServerResponse, SAMPLE_ROW_1.id);
    expect(nextDrawer).toBeNull();
  });
});

describe('resolveDrawerSave (save path correctness & rejection protection)', () => {
  it('never displays rejected or uncommitted state when save fails (saved is undefined)', () => {
    const currentDrawer: AssignmentRow = {
      ...SAMPLE_ROW_1,
      status: 'In progress',
    };

    // Attempted transition to 'Completed' failed on server
    const result = resolveDrawerSave(currentDrawer, undefined, 'ASN-0001');

    // Must preserve original committed state, not uncommitted state
    expect(result).toBe(currentDrawer);
    expect(result?.status).toBe('In progress');
  });

  it('replaces drawer state with saved server row on successful save for same assignment', () => {
    const currentDrawer: AssignmentRow = {
      ...SAMPLE_ROW_1,
      status: 'In progress',
    };
    const savedRow: AssignmentRow = {
      ...SAMPLE_ROW_1,
      status: 'Pending review',
      progress: 80,
    };

    const result = resolveDrawerSave(currentDrawer, savedRow, 'ASN-0001');
    expect(result).toBe(savedRow);
    expect(result?.status).toBe('Pending review');
  });

  it('does not reopen the drawer if drawer was closed while save was in flight', () => {
    const savedRow: AssignmentRow = {
      ...SAMPLE_ROW_1,
      status: 'Pending review',
    };

    // User closed the drawer before server responded
    const result = resolveDrawerSave(null, savedRow, 'ASN-0001');
    expect(result).toBeNull();
  });

  it('does not mutate or overwrite drawer if user switched to another assignment while save was in flight', () => {
    const currentDrawer: AssignmentRow = {
      ...SAMPLE_ROW_2,
      id: 'ASN-0002',
    };
    const savedRowForAsn1: AssignmentRow = {
      ...SAMPLE_ROW_1,
      id: 'ASN-0001',
      status: 'Pending review',
    };

    // User switched selected assignment to ASN-0002 while ASN-0001 save was in flight
    const result = resolveDrawerSave(currentDrawer, savedRowForAsn1, 'ASN-0001');
    expect(result).toBe(currentDrawer);
    expect(result?.id).toBe('ASN-0002');
  });
});
