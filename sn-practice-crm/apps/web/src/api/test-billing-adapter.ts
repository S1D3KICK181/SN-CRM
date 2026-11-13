import type {
  InvoiceDto,
  PaymentReceiptDto,
  RecordPaymentInput,
  RecordVyaparBillInput,
  VoidFeeRecordInput,
} from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import type { PortExecutionOptions } from './types';
import { BillingOperationError, type BillingPort } from './billing-types';

export interface RecordedBillingCall {
  kind: 'invoices' | 'receipts';
  role: CompanyRole;
  signal?: AbortSignal;
  requestId?: string;
}

export interface RecordedBillingMutation {
  kind: 'record-bill' | 'void-bill' | 'record-payment' | 'void-payment';
  role: CompanyRole;
  /** Bill or receipt id for the void calls. */
  targetId?: string;
  input: RecordVyaparBillInput | RecordPaymentInput | VoidFeeRecordInput;
  idempotencyKey: string;
}

export class DeterministicTestBillingAdapter implements BillingPort {
  private readonly invoiceResponses = new Map<CompanyRole, InvoiceDto[]>();
  private readonly receiptResponses = new Map<CompanyRole, PaymentReceiptDto[]>();
  private readonly invoiceQueue: Array<Promise<InvoiceDto[]>> = [];
  private defaultError?: Error;
  private mutationInvoice?: InvoiceDto;
  private mutationReceipt?: PaymentReceiptDto;
  private mutationError?: Error;

  readonly calls: RecordedBillingCall[] = [];
  readonly mutations: RecordedBillingMutation[] = [];

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

  /** Response returned by the bill record and void calls. */
  setMutationInvoice(invoice: InvoiceDto | undefined): void {
    this.mutationInvoice = invoice;
  }

  /** Response returned by the payment record and void calls. */
  setMutationReceipt(receipt: PaymentReceiptDto | undefined): void {
    this.mutationReceipt = receipt;
  }

  /** Error thrown by every mutation until cleared. */
  setMutationError(error: Error | undefined): void {
    this.mutationError = error;
  }

  private abortIfNeeded(options?: PortExecutionOptions): void {
    if (options?.signal?.aborted) {
      throw new BillingOperationError({ code: 'aborted', message: 'The billing operation was aborted.' });
    }
  }

  private invoiceResult(): InvoiceDto {
    if (this.mutationError) throw this.mutationError;
    if (!this.mutationInvoice) throw new Error('No mutation invoice configured on the test billing adapter.');
    return this.mutationInvoice;
  }

  private receiptResult(): PaymentReceiptDto {
    if (this.mutationError) throw this.mutationError;
    if (!this.mutationReceipt) throw new Error('No mutation receipt configured on the test billing adapter.');
    return this.mutationReceipt;
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

  async recordVyaparBill(
    role: CompanyRole,
    input: RecordVyaparBillInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<InvoiceDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'record-bill', role, input, idempotencyKey });
    return this.invoiceResult();
  }

  async voidInvoice(
    role: CompanyRole,
    invoiceId: string,
    input: VoidFeeRecordInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<InvoiceDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'void-bill', role, targetId: invoiceId, input, idempotencyKey });
    return this.invoiceResult();
  }

  async recordPayment(
    role: CompanyRole,
    input: RecordPaymentInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<PaymentReceiptDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'record-payment', role, input, idempotencyKey });
    return this.receiptResult();
  }

  async voidPaymentReceipt(
    role: CompanyRole,
    receiptId: string,
    input: VoidFeeRecordInput,
    idempotencyKey: string,
    options?: PortExecutionOptions,
  ): Promise<PaymentReceiptDto> {
    this.abortIfNeeded(options);
    this.mutations.push({ kind: 'void-payment', role, targetId: receiptId, input, idempotencyKey });
    return this.receiptResult();
  }
}
