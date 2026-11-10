import { describe, expect, it } from 'vitest';
import type { AssignmentRow } from '../data';
import { mergeCreateResult, mergeTransitionResult } from './domain-merge';

describe('domain-merge helper', () => {
  const EXISTING_ROW: AssignmentRow = {
    id: 'ASN-0001',
    title: 'Original Title',
    client: 'Acme Corp',
    clientId: 'cli_acme',
    service: 'GST Compliance',
    due: '10/11/2026',
    owner: 'Priya Desai',
    reviewer: 'Ananya Rao',
    status: 'In progress',
    progress: 50,
    tone: 'default',
    fee: 40000,
    scope: 'Custom high-touch audit scope',
    deliveryNotes: 'Awaiting November purchase ledger',
    billed: true,
    invoiceId: 'INV-2026-0081',
    bankStatementRequired: false,
    bankRecStatus: 'Not applicable',
    milestones: [
      { title: 'Custom Milestone 1', done: true },
      { title: 'Custom Milestone 2', done: false },
    ],
  };

  it('preserves all local domain fields across a status transition', () => {
    // Server DTO mapped row has server-authoritative fields
    const serverResult: AssignmentRow = {
      id: 'ASN-0001',
      title: 'Original Title',
      client: 'Acme Corp',
      clientId: 'cli_acme',
      service: 'GST Compliance',
      due: '10/11/2026',
      owner: 'Priya Desai',
      reviewer: 'Ananya Rao',
      status: 'Pending review',
      progress: 80,
      tone: 'warning',
      fee: 25000, // mapper placeholder
      scope: 'Custom high-touch audit scope',
      deliveryNotes: 'Awaiting November purchase ledger',
      billed: false, // mapper default
      bankStatementRequired: true, // mapper default
      bankRecStatus: 'Awaited', // mapper default
    };

    const submitted: AssignmentRow = {
      ...EXISTING_ROW,
      status: 'Pending review',
    };

    const merged = mergeTransitionResult(EXISTING_ROW, submitted, serverResult);

    // Server-authoritative lifecycle fields win
    expect(merged.status).toBe('Pending review');
    expect(merged.progress).toBe(80);
    expect(merged.tone).toBe('warning');

    // Local / non-wire domain fields are preserved
    expect(merged.fee).toBe(40000);
    expect(merged.scope).toBe('Custom high-touch audit scope');
    expect(merged.deliveryNotes).toBe('Awaiting November purchase ledger');
    expect(merged.billed).toBe(true);
    expect(merged.invoiceId).toBe('INV-2026-0081');
    expect(merged.bankStatementRequired).toBe(false);
    expect(merged.bankRecStatus).toBe('Not applicable');
    expect(merged.milestones).toEqual(EXISTING_ROW.milestones);
  });

  it('preserves simultaneous drawer edits alongside server status transition without clobbering server-authoritative fields', () => {
    const submittedWithEdits: AssignmentRow = {
      ...EXISTING_ROW,
      status: 'Ready for review',
      title: 'Updated Title by Drawer',
      due: '25/11/2026',
      fee: 55000,
      deliveryNotes: 'Stale local note that must not clobber server',
      scope: 'Stale local scope that must not clobber server',
    };

    const serverResult: AssignmentRow = {
      id: 'ASN-0001',
      code: 'ASN-2026-0001',
      title: 'Updated Title by Drawer',
      client: 'Acme Corp',
      clientId: 'cli_acme',
      service: 'GST Compliance',
      serviceId: 'srv_gst',
      due: '25/11/2026',
      owner: 'Priya Desai',
      ownerId: 'usr_priya',
      reviewer: 'Ananya Rao',
      reviewerId: 'usr_ananya',
      recurringScheduleId: 'sch_123',
      expectedUpdatedAt: '2026-11-10T19:00:00.000Z',
      status: 'Ready for review',
      progress: 80,
      tone: 'warning',
      description: 'Server authoritative deliverable description',
      deliveryNotes: 'Server authoritative verified delivery notes',
      reviewNotes: 'Server authoritative review notes',
    };

    const merged = mergeTransitionResult(EXISTING_ROW, submittedWithEdits, serverResult);

    // Server-authoritative DB fields win over stale local notes/description
    expect(merged.status).toBe('Ready for review');
    expect(merged.code).toBe('ASN-2026-0001');
    expect(merged.ownerId).toBe('usr_priya');
    expect(merged.reviewerId).toBe('usr_ananya');
    expect(merged.recurringScheduleId).toBe('sch_123');
    expect(merged.expectedUpdatedAt).toBe('2026-11-10T19:00:00.000Z');
    expect(merged.description).toBe('Server authoritative deliverable description');
    expect(merged.deliveryNotes).toBe('Server authoritative verified delivery notes');
    expect(merged.reviewNotes).toBe('Server authoritative review notes');

    // Drawer fee and billing legacy fields preserved
    expect(merged.fee).toBe(55000);
    expect(merged.billed).toBe(true);
    expect(merged.invoiceId).toBe('INV-2026-0081');
  });

  it('proves fresh expectedUpdatedAt, description, notes, IDs, and code survive create and transition merges for subsequent mutations', () => {
    const serverCreated: AssignmentRow = {
      id: 'asg_uuid_1001',
      code: 'ASN-1001',
      title: 'Statutory GST Filing',
      client: 'Beta Industries',
      clientId: '10000000-0000-4000-a000-000000000002',
      service: 'GST Compliance',
      serviceId: '20000000-0000-4000-a000-000000000001',
      due: '30/11/2026',
      owner: 'Priya Desai',
      ownerId: '00000000-0000-4000-a000-000000000002',
      reviewer: 'Ananya Rao',
      reviewerId: '00000000-0000-4000-a000-000000000003',
      recurringScheduleId: 'sch_uuid_7001',
      status: 'Assigned',
      progress: 0,
      tone: 'default',
      expectedUpdatedAt: '2026-11-10T18:30:00.000Z',
      description: 'Monthly statutory verification',
      deliveryNotes: 'Server intake notes',
      reviewNotes: null,
    };

    const createdMerged = mergeCreateResult(
      {
        title: 'Statutory GST Filing',
        clientId: '10000000-0000-4000-a000-000000000002',
        serviceId: '20000000-0000-4000-a000-000000000001',
        fee: 50000,
      },
      serverCreated,
    );

    // Fresh concurrency token and all server fields are preserved for subsequent mutations
    expect(createdMerged.expectedUpdatedAt).toBe('2026-11-10T18:30:00.000Z');
    expect(createdMerged.code).toBe('ASN-1001');
    expect(createdMerged.recurringScheduleId).toBe('sch_uuid_7001');
    expect(createdMerged.ownerId).toBe('00000000-0000-4000-a000-000000000002');
    expect(createdMerged.reviewerId).toBe('00000000-0000-4000-a000-000000000003');
    expect(createdMerged.description).toBe('Monthly statutory verification');
    expect(createdMerged.deliveryNotes).toBe('Server intake notes');
    expect(createdMerged.fee).toBe(50000);

    // Transition response returns new expectedUpdatedAt token
    const serverTransitioned: AssignmentRow = {
      ...createdMerged,
      status: 'In progress',
      progress: 40,
      expectedUpdatedAt: '2026-11-10T19:45:00.000Z',
      deliveryNotes: 'Updated fieldwork delivery notes on server',
    };

    const transitionMerged = mergeTransitionResult(
      createdMerged,
      { ...createdMerged, deliveryNotes: 'Stale local draft notes' },
      serverTransitioned,
    );

    // The fresh token survives so subsequent mutation succeeds without optimistic conflict
    expect(transitionMerged.expectedUpdatedAt).toBe('2026-11-10T19:45:00.000Z');
    expect(transitionMerged.status).toBe('In progress');
    expect(transitionMerged.deliveryNotes).toBe('Updated fieldwork delivery notes on server');
    expect(transitionMerged.fee).toBe(50000);
  });

  it('merges local fields on create while allowing server-authoritative identity and status to win', () => {
    const submittedInput = {
      title: 'Brand New Engagement',
      client: 'Beta Industries',
      service: 'Statutory Audit',
      due: '30/11/2026',
      owner: 'Priya Desai',
      fee: 65000,
      scope: 'Comprehensive annual statutory audit',
      deliveryNotes: 'Initial draft notes',
      bankStatementRequired: false,
      bankRecStatus: 'Not applicable' as const,
      billed: false,
    };

    const serverResult: AssignmentRow = {
      id: 'asg_server_123',
      title: 'Brand New Engagement',
      client: 'Beta Industries',
      clientId: 'cli_beta_industries',
      service: 'Statutory Audit',
      due: '30/11/2026',
      owner: 'Priya Desai',
      reviewer: 'Ananya Rao',
      status: 'Open',
      progress: 15,
      tone: 'default',
      fee: 25000,
      description: 'Comprehensive annual statutory audit',
      deliveryNotes: 'Initial draft notes',
    };

    const merged = mergeCreateResult(submittedInput, serverResult);

    // Server identity wins
    expect(merged.id).toBe('asg_server_123');
    expect(merged.status).toBe('Open');
    expect(merged.clientId).toBe('cli_beta_industries');

    // Local fields from submitted input are preserved
    expect(merged.fee).toBe(65000);
    expect(merged.scope).toBe('Comprehensive annual statutory audit');
    expect(merged.deliveryNotes).toBe('Initial draft notes');
    expect(merged.bankStatementRequired).toBe(false);
    expect(merged.bankRecStatus).toBe('Not applicable');
  });

  it('preserves absence of non-wire fields without synthesizing false/true/Awaited defaults', () => {
    const minimalExisting: AssignmentRow = {
      id: 'ASN-0099',
      title: 'Minimal Assignment',
      client: 'Acme Corp',
      service: 'GST Compliance',
      due: '10/11/2026',
      owner: 'Priya Desai',
      status: 'In progress',
      progress: 50,
      tone: 'default',
    };

    const serverResult: AssignmentRow = {
      ...minimalExisting,
      status: 'Pending review',
      progress: 80,
      tone: 'warning',
    };

    const submitted: AssignmentRow = {
      ...minimalExisting,
      status: 'Pending review',
    };

    const merged = mergeTransitionResult(minimalExisting, submitted, serverResult);
    expect(merged.billed).toBeUndefined();
    expect(merged.bankStatementRequired).toBeUndefined();
    expect(merged.bankRecStatus).toBeUndefined();
    expect(merged.milestones).toBeUndefined();

    const created = mergeCreateResult(
      {
        title: 'New Minimal',
        client: 'Acme Corp',
        service: 'GST',
        due: '10/11/2026',
        owner: 'Priya Desai',
      },
      serverResult,
    );

    expect(created.billed).toBeUndefined();
    expect(created.bankStatementRequired).toBeUndefined();
    expect(created.bankRecStatus).toBeUndefined();
    expect(created.milestones).toBeUndefined();
  });
});
