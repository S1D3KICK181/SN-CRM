import type { AssignmentRow } from '../data';
import type { CreateAssignmentCommand } from './types';

/**
 * Merges a server-authoritative lifecycle transition response with existing local state
 * and submitted drawer edits.
 *
 * Rules:
 * 1. Server-authoritative row is the foundation (...serverRow):
 *    All server-backed fields (id, code, status, progress, tone, owner, ownerId,
 *    reviewer, reviewerId, reviewerIds, reviewerNames, service, serviceId, due,
 *    client, clientId, description, deliveryNotes, reviewNotes, recurringScheduleId,
 *    expectedUpdatedAt) survive unconditionally.
 * 2. Stale local notes or description never overwrite DB-backed server results.
 * 3. Legacy UI-only fields (fee, billed, invoiceId, bankStatementRequired, bankRecStatus,
 *    milestones) are preserved only when explicitly present; absence remains absence (undefined).
 */
export function mergeTransitionResult(
  existing: AssignmentRow,
  submitted: AssignmentRow,
  serverRow: AssignmentRow,
  currentRow?: AssignmentRow,
): AssignmentRow {
  const base = currentRow ?? existing;

  // 1. Start directly from the complete server-authoritative row
  const result: AssignmentRow = {
    ...serverRow,
  };

  // Sync description & scope mapping from serverRow; fall back to base if serverRow omitted them
  if (serverRow.description !== undefined) {
    result.description = serverRow.description;
    result.scope = serverRow.description ?? serverRow.scope ?? base.scope ?? existing.scope;
  } else if (serverRow.scope !== undefined) {
    result.scope = serverRow.scope;
    result.description = serverRow.description ?? base.description ?? existing.description;
  } else {
    result.description = base.description ?? existing.description;
    result.scope = base.scope ?? existing.scope;
  }

  if (serverRow.deliveryNotes !== undefined) {
    result.deliveryNotes = serverRow.deliveryNotes;
  } else {
    result.deliveryNotes = base.deliveryNotes ?? existing.deliveryNotes;
  }

  if (serverRow.reviewNotes !== undefined) {
    result.reviewNotes = serverRow.reviewNotes;
  } else {
    result.reviewNotes = base.reviewNotes ?? existing.reviewNotes;
  }

  // 2. Preserve only explicitly present legacy UI-only fields; absence remains absence.
  // Check for concurrent local mutations (e.g. markAssignmentBilled or cascadeClientFields during in-flight transition):
  if (submitted.fee !== undefined && submitted.fee !== existing.fee) {
    result.fee = submitted.fee;
  } else if (base.fee !== undefined) {
    result.fee = base.fee;
  }

  const resolvedBilled =
    base.billed !== existing.billed
      ? base.billed
      : submitted.billed !== undefined && submitted.billed !== existing.billed
        ? submitted.billed
        : (base.billed ?? existing.billed);
  if (resolvedBilled !== undefined) {
    result.billed = resolvedBilled;
  }

  const resolvedInvoiceId =
    base.invoiceId !== existing.invoiceId
      ? base.invoiceId
      : submitted.invoiceId !== undefined && submitted.invoiceId !== existing.invoiceId
        ? submitted.invoiceId
        : (base.invoiceId ?? existing.invoiceId);
  if (resolvedInvoiceId !== undefined) {
    result.invoiceId = resolvedInvoiceId;
  }

  const resolvedBankStatement =
    base.bankStatementRequired !== existing.bankStatementRequired
      ? base.bankStatementRequired
      : submitted.bankStatementRequired !== undefined &&
          submitted.bankStatementRequired !== existing.bankStatementRequired
        ? submitted.bankStatementRequired
        : (base.bankStatementRequired ?? existing.bankStatementRequired);
  if (resolvedBankStatement !== undefined) {
    result.bankStatementRequired = resolvedBankStatement;
  }

  const resolvedBankRec =
    base.bankRecStatus !== existing.bankRecStatus
      ? base.bankRecStatus
      : submitted.bankRecStatus !== undefined && submitted.bankRecStatus !== existing.bankRecStatus
        ? submitted.bankRecStatus
        : (base.bankRecStatus ?? existing.bankRecStatus);
  if (resolvedBankRec !== undefined) {
    result.bankRecStatus = resolvedBankRec;
  }

  const resolvedMilestones =
    submitted.milestones !== undefined
      ? submitted.milestones
      : base.milestones !== undefined
        ? base.milestones
        : serverRow.milestones;
  if (resolvedMilestones !== undefined) {
    result.milestones = resolvedMilestones;
  }

  return result;
}

/**
 * Merges a server-created assignment response with submitted legacy UI-only domain fields.
 *
 * Rules:
 * - Server row is completely authoritative: all DB-backed fields (id, code, title,
 *   client, clientId, service, serviceId, due, owner, ownerId, reviewer, reviewerId,
 *   reviewerIds, reviewerNames, status, progress, tone, expectedUpdatedAt, description,
 *   deliveryNotes, reviewNotes, recurringScheduleId) survive intact.
 * - Stale local values never overwrite server results.
 * - Legacy UI-only fields (fee, billed, invoiceId, bankStatementRequired, bankRecStatus,
 *   milestones) are preserved only when explicitly defined; absence remains undefined.
 */
export function mergeCreateResult(
  submitted: CreateAssignmentCommand | AssignmentRow,
  serverRow: AssignmentRow,
): AssignmentRow {
  const asRow = submitted as Partial<AssignmentRow>;
  const result: AssignmentRow = {
    ...serverRow,
  };

  if (serverRow.description !== undefined) {
    result.description = serverRow.description;
    result.scope = serverRow.description ?? serverRow.scope;
  } else if (serverRow.scope !== undefined) {
    result.scope = serverRow.scope;
  }

  // Preserve only explicitly present legacy UI-only fields
  if (asRow.fee !== undefined) {
    result.fee = asRow.fee;
  }
  if (asRow.billed !== undefined) {
    result.billed = asRow.billed;
  }
  if (asRow.invoiceId !== undefined) {
    result.invoiceId = asRow.invoiceId;
  }
  if (asRow.bankStatementRequired !== undefined) {
    result.bankStatementRequired = asRow.bankStatementRequired;
  }
  if (asRow.bankRecStatus !== undefined) {
    result.bankRecStatus = asRow.bankRecStatus;
  }
  if (asRow.milestones !== undefined) {
    result.milestones = asRow.milestones;
  }

  return result;
}
