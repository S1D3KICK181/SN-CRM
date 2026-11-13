import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompanyRole } from '@sn/domain';
import type {
  InvoiceDto,
  PaymentReceiptDto,
  RecordPaymentInput,
  RecordVyaparBillInput,
  VoidFeeRecordInput,
} from '@sn/contracts';
import type { InvoiceRecord, ReceiptRecord } from '../data';
import { useOptionalSessionActor } from '../shell/session-context';
import { mapInvoiceDto, mapReceiptDto } from './billing-mapper';
import { HttpBillingAdapter } from './http-billing-adapter';
import {
  BillingOperationError,
  SAFE_BILLING_ERROR_MESSAGES,
  sanitizeBillingError,
  type BillingPort,
} from './billing-types';

export interface UseBillingOptions {
  readonly port?: BillingPort;
  readonly enabled?: boolean;
  readonly getAccessToken?: () => Promise<string | null> | string | null;
  readonly baseUrl?: string;
}

export interface UseBillingResult {
  readonly invoices: InvoiceRecord[];
  readonly receipts: ReceiptRecord[];
  readonly loading: boolean;
  readonly error: BillingOperationError | null;
  readonly hasLiveSnapshot: boolean;
  readonly retry: () => void;
  /** Mutations throw a sanitized BillingOperationError and reload both lists on success. */
  readonly recordBill: (input: RecordVyaparBillInput, idempotencyKey: string) => Promise<InvoiceDto>;
  readonly recordPayment: (input: RecordPaymentInput, idempotencyKey: string) => Promise<PaymentReceiptDto>;
  readonly voidBill: (invoiceId: string, input: VoidFeeRecordInput, idempotencyKey: string) => Promise<InvoiceDto>;
  readonly voidPayment: (
    receiptId: string,
    input: VoidFeeRecordInput,
    idempotencyKey: string,
  ) => Promise<PaymentReceiptDto>;
}

interface BillingSnapshot {
  readonly port: BillingPort;
  readonly role: CompanyRole;
  readonly invoices: InvoiceRecord[];
  readonly receipts: ReceiptRecord[];
  readonly loading: boolean;
  readonly error: BillingOperationError | null;
  readonly hasLiveSnapshot: boolean;
}

const NO_INVOICES: InvoiceRecord[] = [];
const NO_RECEIPTS: ReceiptRecord[] = [];

function mayReadBilling(role: CompanyRole): boolean {
  return role === 'founder' || role === 'manager' || role === 'senior_staff' || role === 'staff';
}

/**
 * Billing data and mutations. Everyone except the Trainee loads (the API scopes the lists
 * to the clients each role looks after); the Trainee gets empty lists and never triggers a request. Data loaded for one role is never
 * exposed to another (zero-frame suppression on role or port change).
 */
export function useBilling(role: CompanyRole, options: UseBillingOptions = {}): UseBillingResult {
  const { enabled = true } = options;
  const sessionActor = useOptionalSessionActor();
  const getAccessToken = options.getAccessToken ?? sessionActor?.getAccessToken;
  const baseUrl =
    options.baseUrl ??
    (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_CRM_API_BASE_URL ?? '') : '');

  const port = useMemo(
    () => options.port ?? new HttpBillingAdapter({ getAccessToken, baseUrl }),
    [options.port, getAccessToken, baseUrl],
  );

  const allowed = enabled && mayReadBilling(role);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();

    setSnapshot((previous) => {
      const sameScope = previous !== null && previous.port === port && previous.role === role;
      return {
        port,
        role,
        invoices: sameScope ? previous.invoices : NO_INVOICES,
        receipts: sameScope ? previous.receipts : NO_RECEIPTS,
        loading: true,
        error: null,
        hasLiveSnapshot: sameScope ? previous.hasLiveSnapshot : false,
      };
    });

    Promise.all([
      port.listInvoices(role, { signal: controller.signal }),
      port.listPaymentReceipts(role, { signal: controller.signal }),
    ])
      .then(([invoiceDtos, receiptDtos]) => {
        if (controller.signal.aborted) return;
        setSnapshot({
          port,
          role,
          invoices: invoiceDtos.map(mapInvoiceDto),
          receipts: receiptDtos.map(mapReceiptDto),
          loading: false,
          error: null,
          hasLiveSnapshot: true,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = sanitizeBillingError(err);
        if (error.code === 'aborted') return;
        setSnapshot((previous) => ({
          port,
          role,
          invoices: previous !== null && previous.port === port && previous.role === role ? previous.invoices : NO_INVOICES,
          receipts: previous !== null && previous.port === port && previous.role === role ? previous.receipts : NO_RECEIPTS,
          loading: false,
          error,
          hasLiveSnapshot: previous !== null && previous.port === port && previous.role === role && previous.hasLiveSnapshot,
        }));
      });

    return () => controller.abort();
  }, [allowed, port, role, attempt]);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const reloadBoth = useCallback(async () => {
    try {
      const [invoiceDtos, receiptDtos] = await Promise.all([port.listInvoices(role), port.listPaymentReceipts(role)]);
      setSnapshot({
        port,
        role,
        invoices: invoiceDtos.map(mapInvoiceDto),
        receipts: receiptDtos.map(mapReceiptDto),
        loading: false,
        error: null,
        hasLiveSnapshot: true,
      });
    } catch {
      // The change itself was saved; fall back to the normal reload so the lists catch up.
      setAttempt((value) => value + 1);
    }
  }, [port, role]);

  const mutate = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      if (!allowed) {
        throw new BillingOperationError({ code: 'forbidden', message: SAFE_BILLING_ERROR_MESSAGES.forbidden });
      }
      let result: T;
      try {
        result = await run();
      } catch (err: unknown) {
        throw sanitizeBillingError(err);
      }
      await reloadBoth();
      return result;
    },
    [allowed, reloadBoth],
  );

  const recordBill = useCallback(
    (input: RecordVyaparBillInput, key: string) => mutate(() => port.recordVyaparBill(role, input, key)),
    [mutate, port, role],
  );
  const recordPayment = useCallback(
    (input: RecordPaymentInput, key: string) => mutate(() => port.recordPayment(role, input, key)),
    [mutate, port, role],
  );
  const voidBill = useCallback(
    (invoiceId: string, input: VoidFeeRecordInput, key: string) =>
      mutate(() => port.voidInvoice(role, invoiceId, input, key)),
    [mutate, port, role],
  );
  const voidPayment = useCallback(
    (receiptId: string, input: VoidFeeRecordInput, key: string) =>
      mutate(() => port.voidPaymentReceipt(role, receiptId, input, key)),
    [mutate, port, role],
  );
  const actions = { retry, recordBill, recordPayment, voidBill, voidPayment };

  if (!allowed) {
    return {
      invoices: NO_INVOICES,
      receipts: NO_RECEIPTS,
      loading: false,
      error: null,
      hasLiveSnapshot: false,
      ...actions,
    };
  }

  // Zero-frame privacy guard: a snapshot that belongs to another role or port is never shown.
  const current = snapshot !== null && snapshot.port === port && snapshot.role === role ? snapshot : null;
  if (!current) {
    return {
      invoices: NO_INVOICES,
      receipts: NO_RECEIPTS,
      loading: true,
      error: null,
      hasLiveSnapshot: false,
      ...actions,
    };
  }

  return {
    invoices: current.invoices,
    receipts: current.receipts,
    loading: current.loading,
    error: current.error,
    hasLiveSnapshot: current.hasLiveSnapshot,
    ...actions,
  };
}
