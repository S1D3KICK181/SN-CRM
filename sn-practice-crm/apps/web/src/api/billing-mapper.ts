import type { InvoiceDto, InvoiceStatus as ApiInvoiceStatus, PaymentMethod, PaymentReceiptDto } from '@sn/contracts';
import type {
  InvoiceLineRecord,
  InvoicePaymentRecord,
  InvoiceRecord,
  InvoiceStatus,
  PaymentMode,
  ReceiptRecord,
} from '../data';
import { formatIsoToDisplayDate } from './mapper';

const PAYMENT_MODE_LABELS: Readonly<Record<PaymentMethod, PaymentMode>> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  upi: 'UPI',
  card: 'Card',
  other: 'Other',
};

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function mapPaymentMethodLabel(method: PaymentMethod): PaymentMode {
  return PAYMENT_MODE_LABELS[method];
}

export function mapInvoiceStatusLabel(status: ApiInvoiceStatus, daysOverdue: number): InvoiceStatus {
  switch (status) {
    case 'voided':
      return 'Cancelled';
    case 'draft':
      return 'Draft';
    case 'paid':
      return 'Paid';
    case 'issued':
    case 'part_paid':
      if (daysOverdue > 0) return 'Overdue';
      return status === 'part_paid' ? 'Partly Paid' : 'Pending';
  }
}

function describeInvoice(dto: InvoiceDto): string {
  const first = dto.items[0];
  if (!first) return 'No line items';
  const more = dto.items.length - 1;
  return more > 0 ? `${first.description} + ${more} more` : first.description;
}

export function mapInvoiceDto(dto: InvoiceDto): InvoiceRecord {
  const items: InvoiceLineRecord[] = dto.items.map((item) => ({
    id: item.id,
    description: item.description,
    quantity: item.quantity,
    rate: paiseToRupees(item.unitPricePaise),
    gstPercent: item.taxRatePercent,
    amount: paiseToRupees(item.lineSubtotalPaise),
  }));
  const payments: InvoicePaymentRecord[] = dto.payments.map((payment) => ({
    receiptId: payment.receiptId,
    receiptNumber: payment.receiptCode,
    date: formatIsoToDisplayDate(payment.receivedOn),
    amount: paiseToRupees(payment.amountPaise),
    amountPaise: payment.amountPaise,
    voided: payment.receiptStatus === 'voided',
  }));

  const record: InvoiceRecord = {
    id: dto.id,
    invoiceNumber: dto.code,
    clientId: dto.clientId,
    clientName: dto.clientName,
    description: describeInvoice(dto),
    invoiceDate: formatIsoToDisplayDate(dto.issueDate),
    dueDate: formatIsoToDisplayDate(dto.dueDate),
    subtotal: paiseToRupees(dto.subtotalPaise),
    gstAmount: paiseToRupees(dto.taxPaise),
    total: paiseToRupees(dto.totalPaise),
    amountReceived: paiseToRupees(dto.amountReceivedPaise),
    balance: paiseToRupees(dto.balancePaise),
    balancePaise: dto.balancePaise,
    status: mapInvoiceStatusLabel(dto.status, dto.daysOverdue),
    daysOverdue: dto.daysOverdue,
    clientCode: dto.clientCode,
    items,
    payments,
  };
  if (dto.vyaparBillNumber) record.vyaparBillNumber = dto.vyaparBillNumber;
  if (dto.assignmentCode) record.assignmentCode = dto.assignmentCode;
  if (dto.notes) record.notes = dto.notes;
  if (dto.voidReason) record.voidReason = dto.voidReason;
  return record;
}

export function mapReceiptDto(dto: PaymentReceiptDto): ReceiptRecord {
  const allocations = dto.allocations.map((allocation) => ({
    invoiceId: allocation.invoiceId,
    invoiceNumber: allocation.invoiceCode,
    amount: paiseToRupees(allocation.amountPaise),
  }));
  const first = allocations[0];
  return {
    id: dto.id,
    receiptNumber: dto.code,
    clientId: dto.clientId,
    clientName: dto.clientName,
    invoiceId: first?.invoiceId ?? '',
    invoiceNumber: first?.invoiceNumber ?? '',
    receiptDate: formatIsoToDisplayDate(dto.receivedOn),
    amount: paiseToRupees(dto.amountPaise),
    amountPaise: dto.amountPaise,
    paymentMode: mapPaymentMethodLabel(dto.method),
    referenceNumber: dto.reference ?? '',
    notes: dto.notes ?? '',
    status: dto.status === 'voided' ? 'Voided' : 'Received',
    allocations,
    unallocated: paiseToRupees(dto.unallocatedPaise),
  };
}
