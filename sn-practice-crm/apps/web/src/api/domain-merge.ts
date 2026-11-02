import type { AssignmentRow } from '../data';
import type { CreateAssignmentCommand } from './types';

/**
 * Merges a server-authoritative lifecycle transition response with existing local state
 * and submitted drawer edits.
 *
 * Rules:
 * 1. Server lifecycle and operational fields are strictly authoritative:
 *    - id
 *    - status
 *    - progress
 *    - tone
 *    - owner
 *    - reviewer
 *    - service
 * 2. Simultaneous drawer edits take precedence over unchanged / mapper defaults:
 *    - title: submitted if changed, else serverRow.title or existing.title
 *    - due: submitted if changed, else serverRow.due or existing.due
 *    - client: submitted if changed, else serverRow.client or existing.client
 *    - clientId: serverRow.clientId || submitted.clientId || existing.clientId
 * 3. Local-only / non-wire domain fields are NEVER clobbered by mapper defaults:
 *    - fee: submitted.fee ?? existing.fee
 *    - scope: submitted.scope ?? existing.scope
 *    - deliveryNotes: submitted.deliveryNotes ?? existing.deliveryNotes
 *    - billed: submitted.billed ?? existing.billed ?? false
 *    - invoiceId: submitted.invoiceId ?? existing.invoiceId
 *    - bankStatementRequired: submitted.bankStatementRequired ?? existing.bankStatementRequired ?? true
 *    - bankRecStatus: submitted.bankRecStatus ?? existing.bankRecStatus ?? (serverRow.status === 'Completed' ? 'Completed' : 'Awaited')
 *    - milestones: submitted.milestones ?? existing.milestones ?? serverRow.milestones
 */
export function mergeTransitionResult(
  existing: AssignmentRow,
  submitted: AssignmentRow,
  serverRow: AssignmentRow,
  currentRow?: AssignmentRow,
): AssignmentRow {
  const base = currentRow ?? existing;

  const isTitleEdited = submitted.title !== undefined && submitted.title !== existing.title;
  const isDueEdited = submitted.due !== undefined && submitted.due !== existing.due;
  const isClientEdited = submitted.client !== undefined && submitted.client !== existing.client;
  const isServiceEdited = submitted.service !== undefined && submitted.service !== existing.service;
  const isFeeEdited = submitted.fee !== undefined && submitted.fee !== existing.fee;
  const isScopeEdited = submitted.scope !== undefined && submitted.scope !== existing.scope;
  const isDeliveryNotesEdited =
    submitted.deliveryNotes !== undefined && submitted.deliveryNotes !== existing.deliveryNotes;
  const isMilestonesEdited =
    submitted.milestones !== undefined && submitted.milestones !== existing.milestones;

  // Newer local mutations check (preserve concurrent mutations from markAssignmentBilled / cascadeClientFields):
  const billed =
    base.billed !== existing.billed
      ? (base.billed ?? false)
      : submitted.billed !== undefined && submitted.billed !== existing.billed
        ? submitted.billed
        : (base.billed ?? existing.billed ?? false);

  const invoiceId =
    base.invoiceId !== existing.invoiceId
      ? base.invoiceId
      : submitted.invoiceId !== undefined && submitted.invoiceId !== existing.invoiceId
        ? submitted.invoiceId
        : (base.invoiceId ?? existing.invoiceId);

  const bankStatementRequired =
    base.bankStatementRequired !== existing.bankStatementRequired
      ? base.bankStatementRequired
      : submitted.bankStatementRequired !== undefined &&
          submitted.bankStatementRequired !== existing.bankStatementRequired
        ? submitted.bankStatementRequired
        : (base.bankStatementRequired ?? existing.bankStatementRequired ?? true);

  const bankRecStatus =
    base.bankRecStatus !== existing.bankRecStatus
      ? base.bankRecStatus
      : submitted.bankRecStatus !== undefined && submitted.bankRecStatus !== existing.bankRecStatus
        ? submitted.bankRecStatus
        : (base.bankRecStatus ??
          existing.bankRecStatus ??
          (serverRow.status === 'Completed' ? 'Completed' : 'Awaited'));

  return {
    // 1. Identity & lifecycle (server authoritative)
    id: serverRow.id,
    status: serverRow.status,
    progress: serverRow.progress,
    tone: serverRow.tone,
    owner: serverRow.owner,
    reviewer: serverRow.reviewer,

    // 2. Core editable fields (drawer edit wins over server default if edited in same save)
    title: isTitleEdited ? submitted.title : (base.title || serverRow.title || existing.title),
    due: isDueEdited ? submitted.due : (base.due || serverRow.due || existing.due),
    service: isServiceEdited ? submitted.service : (base.service || serverRow.service || existing.service),
    client: isClientEdited ? submitted.client : (base.client || serverRow.client || existing.client),
    clientId: serverRow.clientId || base.clientId || submitted.clientId || existing.clientId,

    // 3. Local-only non-wire domain fields (preserve submitted or existing; never clobber with mapper defaults)
    fee: isFeeEdited ? submitted.fee : (base.fee ?? existing.fee),
    scope: isScopeEdited ? submitted.scope : (base.scope ?? existing.scope),
    deliveryNotes: isDeliveryNotesEdited ? submitted.deliveryNotes : (base.deliveryNotes ?? existing.deliveryNotes),
    billed,
    invoiceId,
    bankStatementRequired,
    bankRecStatus,
    milestones: isMilestonesEdited ? submitted.milestones : (base.milestones ?? existing.milestones ?? serverRow.milestones),
  };
}

/**
 * Merges a server-created assignment response with submitted local-only / non-wire domain fields.
 *
 * Rules:
 * - Server identity, code, and status are strictly authoritative.
 * - Non-wire fields submitted in the creation command (fee, scope, deliveryNotes, bankStatementRequired, etc.)
 *   are preserved in the returned AssignmentRow.
 */
export function mergeCreateResult(
  submitted: CreateAssignmentCommand | AssignmentRow,
  serverRow: AssignmentRow,
): AssignmentRow {
  const asRow = submitted as Partial<AssignmentRow>;
  return {
    // Server-authoritative fields
    id: serverRow.id,
    title: serverRow.title,
    client: serverRow.client,
    clientId: serverRow.clientId,
    service: serverRow.service,
    due: serverRow.due,
    owner: serverRow.owner,
    reviewer: serverRow.reviewer,
    status: serverRow.status,
    progress: serverRow.progress,
    tone: serverRow.tone,

    // Merged local-only fields
    fee: asRow.fee !== undefined ? asRow.fee : serverRow.fee,
    scope: asRow.scope !== undefined ? asRow.scope : serverRow.scope,
    deliveryNotes: asRow.deliveryNotes !== undefined ? asRow.deliveryNotes : serverRow.deliveryNotes,
    billed: asRow.billed !== undefined ? asRow.billed : (serverRow.billed ?? false),
    invoiceId: asRow.invoiceId !== undefined ? asRow.invoiceId : serverRow.invoiceId,
    bankStatementRequired:
      asRow.bankStatementRequired !== undefined
        ? asRow.bankStatementRequired
        : (serverRow.bankStatementRequired ?? true),
    bankRecStatus:
      asRow.bankRecStatus !== undefined
        ? asRow.bankRecStatus
        : serverRow.bankRecStatus,
    milestones: asRow.milestones ?? serverRow.milestones,
  };
}
