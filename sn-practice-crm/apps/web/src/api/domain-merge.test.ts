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
    // Server DTO mapped row has default placeholders for non-wire fields
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
      fee: 25000, // mapper default
      scope: 'Standard statutory compliance fieldwork and verification.', // mapper default
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

  it('preserves simultaneous drawer edits alongside server status transition', () => {
    const submittedWithEdits: AssignmentRow = {
      ...EXISTING_ROW,
      status: 'Pending review',
      title: 'Updated Title by Drawer',
      due: '25/11/2026',
      fee: 55000,
      deliveryNotes: 'Updated drawer note',
      scope: 'Updated drawer scope',
    };

    const serverResult: AssignmentRow = {
      id: 'ASN-0001',
      title: 'Original Title',
      client: 'Acme Corp',
      service: 'GST Compliance',
      due: '10/11/2026',
      owner: 'Priya Desai',
      reviewer: 'Ananya Rao',
      status: 'Pending review',
      progress: 80,
      tone: 'warning',
      fee: 25000,
    };

    const merged = mergeTransitionResult(EXISTING_ROW, submittedWithEdits, serverResult);

    expect(merged.status).toBe('Pending review');
    expect(merged.title).toBe('Updated Title by Drawer');
    expect(merged.due).toBe('25/11/2026');
    expect(merged.fee).toBe(55000);
    expect(merged.deliveryNotes).toBe('Updated drawer note');
    expect(merged.scope).toBe('Updated drawer scope');
    expect(merged.billed).toBe(true);
    expect(merged.invoiceId).toBe('INV-2026-0081');
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
      fee: 25000, // mapper placeholder
      scope: 'Standard statutory compliance fieldwork and verification.', // mapper placeholder
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
});
