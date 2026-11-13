import type { InvoiceDto, PaymentReceiptDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { BillingOperationError, type BillingPort } from './billing-types';

export interface RecordedBillingCall {
  kind: 'invoices' | 'receipts';
  role: CompanyRole;
  signal?: AbortSignal;
  requestId?: string;
}

export class DeterministicTestBillingAdapter implements BillingPort {
  private readonly invoiceResponses = new Map<CompanyRole, InvoiceDto[]>();
  private readonly receiptResponses = new Map<CompanyRole, PaymentReceiptDto[]>();
  private readonly invoiceQueue: Array<Promise<InvoiceDto[]>> = [];
  private defaultError?: Error;

  readonly calls: RecordedBillingCall[] = [];

  setInvoicesResponse(role: CompanyRole, items: InvoiceDto[]): void {
    this.invoiceResponses.set(role, items);
  }

  setReceiptsResponse(role: CompanyRole, items: PaymentReceiptDto[]): void {
    this.receiptResponses.set(role, items);
  }

  enqueueDeferredInvoices(promise: Promise<InvoiceDto[]>): void {
    this.invoiceQueue.push(promise);
  }

  setDefaultError(error: Error | undefined): void {
    this.defaultError = error;
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new BillingOperationError({ code: 'aborted', message: 'The billing operation was aborted.' });
    }
  }

  async listInvoices(role: CompanyRole, options?: PortExecutionOptions): Promise<InvoiceDto[]> {
    this.calls.push({ kind: 'invoices', role, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    const deferred = this.invoiceQueue.shift();
    if (deferred) return deferred;

    if (this.defaultError) throw this.defaultError;
    return [...(this.invoiceResponses.get(role) ?? [])];
  }

  async listPaymentReceipts(role: CompanyRole, options?: PortExecutionOptions): Promise<PaymentReceiptDto[]> {
    this.calls.push({ kind: 'receipts', role, signal: options?.signal, requestId: options?.requestId });
    this.abortIfNeeded(options);

    if (this.defaultError) throw this.defaultError;
    return [...(this.receiptResponses.get(role) ?? [])];
  }
}
