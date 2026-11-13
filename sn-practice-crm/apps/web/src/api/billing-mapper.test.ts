import { describe, expect, it } from 'vitest';
import type { InvoiceDto, InvoiceStatus, PaymentMethod, PaymentReceiptDto } from '@sn/contracts';
import { mapInvoiceDto, mapInvoiceStatusLabel, mapPaymentMethodLabel, mapReceiptDto } from './billing-mapper';

function invoiceDto(overrides: Partial<InvoiceDto> = {}): InvoiceDto {
  return {
    id: '70000000-0000-4000-a000-000000000002',
    code: 'INV-0001002',
    vyaparBillNumber: null,
    clientId: '10000000-0000-4000-a000-000000000001',
    clientCode: 'CL-001001',
    clientName: 'Aster Foods',
    assignmentId: '30000000-0000-4000-a000-000000000001',
    assignmentCode: 'AS-001001',
    issueDate: '2026-10-24',
    dueDate: '2026-11-23',
    currency: 'INR',
    subtotalPaise: 4200075,
    taxPaise: 756000,
    totalPaise: 4956075,
    amountReceivedPaise: 1650000,
    balancePaise: 3306075,
    daysOverdue: 0,
    status: 'part_paid',
    notes: 'Billed in two parts',
    issuedAt: '2026-10-24T04:30:00.000Z',
    voidReason: null,
    voidedAt: null,
    items: [
      {
        id: '72000000-0000-4000-a000-000000000002',
        description: 'GST return filing',
        quantity: 3,
        unitPricePaise: 800000,
        taxRatePercent: 18,
        lineSubtotalPaise: 2400000,
        lineTaxPaise: 432000,
        lineTotalPaise: 2832000,
      },
      {
        id: '72000000-0000-4000-a000-000000000003',
        description: 'GST reconciliation review',
        quantity: 1.5,
        unitPricePaise: 1200050,
        taxRatePercent: 18,
        lineSubtotalPaise: 1800075,
        lineTaxPaise: 324014,
        lineTotalPaise: 2124089,
      },
    ],
    payments: [
      {
        receiptId: '71000000-0000-4000-a000-000000000001',
        receiptCode: 'RCT-0001001',
        receivedOn: '2026-10-29',
        amountPaise: 1050000,
        receiptStatus: 'received',
      },
      {
        receiptId: '71000000-0000-4000-a000-000000000002',
        receiptCode: 'RCT-0001002',
        receivedOn: '2026-11-08',
        amountPaise: 600000,
        receiptStatus: 'voided',
      },
    ],
    createdAt: '2026-10-24T04:30:00.000Z',
    updatedAt: '2026-11-08T04:30:00.000Z',
    ...overrides,
  };
}

function receiptDto(overrides: Partial<PaymentReceiptDto> = {}): PaymentReceiptDto {
  return {
    id: '71000000-0000-4000-a000-000000000001',
    code: 'RCT-0001001',
    clientId: '10000000-0000-4000-a000-000000000001',
    clientCode: 'CL-001001',
    clientName: 'Aster Foods',
    receivedOn: '2026-10-29',
    amountPaise: 4000000,
    method: 'bank_transfer',
    reference: 'NEFT-AST-01001',
    notes: 'Settles two invoices',
    status: 'received',
    voidReason: null,
    voidedAt: null,
    allocatedPaise: 3500000,
    unallocatedPaise: 500000,
    allocations: [
      { invoiceId: '70000000-0000-4000-a000-000000000001', invoiceCode: 'INV-0001001', amountPaise: 2950000 },
      { invoiceId: '70000000-0000-4000-a000-000000000002', invoiceCode: 'INV-0001002', amountPaise: 550000 },
    ],
    createdAt: '2026-10-29T04:30:00.000Z',
    ...overrides,
  };
}

describe('billing mapper', () => {
  describe('invoice status labels', () => {
    it.each<[InvoiceStatus, number, string]>([
      ['voided', 0, 'Cancelled'],
      ['voided', 12, 'Cancelled'],
      ['draft', 0, 'Draft'],
      ['draft', 30, 'Draft'],
      ['paid', 0, 'Paid'],
      ['paid', 9, 'Paid'],
      ['issued', 0, 'Pending'],
      ['issued', 1, 'Overdue'],
      ['part_paid', 0, 'Partly Paid'],
      ['part_paid', 5, 'Overdue'],
    ])('maps %s with %i days overdue to %s', (status, daysOverdue, label) => {
      expect(mapInvoiceStatusLabel(status, daysOverdue)).toBe(label);
    });
  });

  describe('payment method labels', () => {
    it.each<[PaymentMethod, string]>([
      ['cash', 'Cash'],
      ['bank_transfer', 'Bank transfer'],
      ['cheque', 'Cheque'],
      ['upi', 'UPI'],
      ['card', 'Card'],
      ['other', 'Other'],
    ])('maps %s to %s', (method, label) => {
      expect(mapPaymentMethodLabel(method)).toBe(label);
    });
  });

  describe('mapInvoiceDto', () => {
    it('converts paise to rupees and ISO dates to DD/MM/YYYY', () => {
      const record = mapInvoiceDto(invoiceDto());

      expect(record).toMatchObject({
        id: '70000000-0000-4000-a000-000000000002',
        invoiceNumber: 'INV-0001002',
        clientId: '10000000-0000-4000-a000-000000000001',
        clientCode: 'CL-001001',
        clientName: 'Aster Foods',
        invoiceDate: '24/10/2026',
        dueDate: '23/11/2026',
        subtotal: 42000.75,
        gstAmount: 7560,
        total: 49560.75,
        amountReceived: 16500,
        balance: 33060.75,
        balancePaise: 3306075,
        status: 'Partly Paid',
        daysOverdue: 0,
        assignmentCode: 'AS-001001',
        notes: 'Billed in two parts',
      });
    });

    it('maps lines (quantity, rate, GST %, pre-tax amount) and payments', () => {
      const record = mapInvoiceDto(invoiceDto());

      expect(record.items).toEqual([
        { id: '72000000-0000-4000-a000-000000000002', description: 'GST return filing', quantity: 3, rate: 8000, gstPercent: 18, amount: 24000 },
        { id: '72000000-0000-4000-a000-000000000003', description: 'GST reconciliation review', quantity: 1.5, rate: 12000.5, gstPercent: 18, amount: 18000.75 },
      ]);
      expect(record.payments).toEqual([
        { receiptId: '71000000-0000-4000-a000-000000000001', receiptNumber: 'RCT-0001001', date: '29/10/2026', amount: 10500, amountPaise: 1050000, voided: false },
        { receiptId: '71000000-0000-4000-a000-000000000002', receiptNumber: 'RCT-0001002', date: '08/11/2026', amount: 6000, amountPaise: 600000, voided: true },
      ]);
    });

    it('carries the Vyapar bill number when there is one and omits it otherwise', () => {
      expect(mapInvoiceDto(invoiceDto({ vyaparBillNumber: 'VYP-140' })).vyaparBillNumber).toBe('VYP-140');
      expect('vyaparBillNumber' in mapInvoiceDto(invoiceDto({ vyaparBillNumber: null }))).toBe(false);
    });

    it('describes the invoice by its first line plus the count of the others', () => {
      expect(mapInvoiceDto(invoiceDto()).description).toBe('GST return filing + 1 more');

      const three = invoiceDto();
      expect(mapInvoiceDto({ ...three, items: [...three.items, { ...three.items[0]!, id: '72000000-0000-4000-a000-000000000009' }] }).description).toBe(
        'GST return filing + 2 more',
      );
      expect(mapInvoiceDto({ ...three, items: [three.items[0]!] }).description).toBe('GST return filing');
      expect(mapInvoiceDto({ ...three, items: [] }).description).toBe('No line items');
    });

    it('marks an issued invoice past its due date as Overdue', () => {
      const record = mapInvoiceDto(invoiceDto({ status: 'issued', daysOverdue: 18, amountReceivedPaise: 0, balancePaise: 4956075 }));
      expect(record.status).toBe('Overdue');
      expect(record.daysOverdue).toBe(18);
    });

    it('omits optional fields that are empty and carries the void reason for a cancelled invoice', () => {
      const draft = mapInvoiceDto(invoiceDto({ status: 'draft', assignmentCode: null, assignmentId: null, notes: null, items: [], payments: [] }));
      expect(draft.status).toBe('Draft');
      expect('assignmentCode' in draft).toBe(false);
      expect('notes' in draft).toBe(false);
      expect('voidReason' in draft).toBe(false);

      const cancelled = mapInvoiceDto(invoiceDto({ status: 'voided', voidReason: 'Wrong client', balancePaise: 0 }));
      expect(cancelled.status).toBe('Cancelled');
      expect(cancelled.voidReason).toBe('Wrong client');
    });
  });

  describe('mapReceiptDto', () => {
    it('maps a receipt allocated across two invoices, using the first for the legacy invoice fields', () => {
      const record = mapReceiptDto(receiptDto());

      expect(record).toMatchObject({
        id: '71000000-0000-4000-a000-000000000001',
        receiptNumber: 'RCT-0001001',
        clientId: '10000000-0000-4000-a000-000000000001',
        clientName: 'Aster Foods',
        invoiceId: '70000000-0000-4000-a000-000000000001',
        invoiceNumber: 'INV-0001001',
        receiptDate: '29/10/2026',
        amount: 40000,
        amountPaise: 4000000,
        paymentMode: 'Bank transfer',
        referenceNumber: 'NEFT-AST-01001',
        notes: 'Settles two invoices',
        status: 'Received',
        unallocated: 5000,
      });
      expect(record.allocations).toEqual([
        { invoiceId: '70000000-0000-4000-a000-000000000001', invoiceNumber: 'INV-0001001', amount: 29500 },
        { invoiceId: '70000000-0000-4000-a000-000000000002', invoiceNumber: 'INV-0001002', amount: 5500 },
      ]);
    });

    it('uses empty strings for an unallocated receipt with no reference or notes, and marks voided ones', () => {
      const record = mapReceiptDto(
        receiptDto({
          allocations: [],
          allocatedPaise: 0,
          unallocatedPaise: 4000000,
          reference: null,
          notes: null,
          status: 'voided',
          method: 'cheque',
          voidReason: 'Cheque bounced',
        }),
      );

      expect(record.invoiceId).toBe('');
      expect(record.invoiceNumber).toBe('');
      expect(record.referenceNumber).toBe('');
      expect(record.notes).toBe('');
      expect(record.status).toBe('Voided');
      expect(record.paymentMode).toBe('Cheque');
      expect(record.unallocated).toBe(40000);
    });
  });
});
