import { describe, expect, it, vi } from 'vitest';
import type { InvoiceDto, PaymentReceiptDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { HttpBillingAdapter } from './http-billing-adapter';
import { BillingOperationError } from './billing-types';
import { ROLE_TO_DEMO_ACTOR_ID } from './dev-auth';

const invoice: InvoiceDto = {
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
  subtotalPaise: 4200000,
  taxPaise: 756000,
  totalPaise: 4956000,
  amountReceivedPaise: 1650000,
  balancePaise: 3306000,
  daysOverdue: 0,
  status: 'part_paid',
  notes: null,
  issuedAt: '2026-10-24T04:30:00.000Z',
  voidReason: null,
  voidedAt: null,
  items: [
    {
      id: '72000000-0000-4000-a000-000000000002',
      description: 'GST return filing',
      quantity: 1.5,
      unitPricePaise: 800000,
      taxRatePercent: 18,
      lineSubtotalPaise: 1200000,
      lineTaxPaise: 216000,
      lineTotalPaise: 1416000,
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
  ],
  createdAt: '2026-10-24T04:30:00.000Z',
  updatedAt: '2026-11-08T04:30:00.000Z',
};

const receipt: PaymentReceiptDto = {
  id: '71000000-0000-4000-a000-000000000001',
  code: 'RCT-0001001',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientCode: 'CL-001001',
  clientName: 'Aster Foods',
  receivedOn: '2026-10-29',
  amountPaise: 4000000,
  method: 'bank_transfer',
  reference: 'NEFT-AST-01001',
  notes: null,
  status: 'received',
  voidReason: null,
  voidedAt: null,
  allocatedPaise: 3000000,
  unallocatedPaise: 1000000,
  allocations: [
    { invoiceId: '70000000-0000-4000-a000-000000000002', invoiceCode: 'INV-0001002', amountPaise: 3000000 },
  ],
  createdAt: '2026-10-29T04:30:00.000Z',
};

function okResponse(data: unknown, requestId = 'req-billing-1'): Response {
  return new Response(JSON.stringify({ data, requestId }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function adapterFor(data: unknown) {
  const fetchFn = vi.fn().mockResolvedValue(okResponse(data));
  return { fetchFn, adapter: new HttpBillingAdapter({ fetchFn }) };
}

describe('HttpBillingAdapter', () => {
  it('calls the invoices and payment-receipts routes with the demo actor header for each role', async () => {
    const roles: CompanyRole[] = ['founder', 'manager', 'senior_staff', 'staff', 'trainee'];

    for (const role of roles) {
      const invoices = adapterFor([invoice]);
      await invoices.adapter.listInvoices(role);
      const [invoiceUrl, invoiceInit] = invoices.fetchFn.mock.calls[0] as [string, RequestInit];
      expect(invoiceUrl).toBe('/api/v1/invoices');
      expect(invoiceInit.method).toBe('GET');
      expect(new Headers(invoiceInit.headers).get('x-demo-user-id')).toBe(ROLE_TO_DEMO_ACTOR_ID[role]);

      const receipts = adapterFor([receipt]);
      await receipts.adapter.listPaymentReceipts(role);
      const [receiptUrl] = receipts.fetchFn.mock.calls[0] as [string, RequestInit];
      expect(receiptUrl).toBe('/api/v1/payment-receipts');
    }
  });

  it('uses a Bearer token when a token source is configured and never falls back to the demo header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([invoice]));
    const adapter = new HttpBillingAdapter({ fetchFn, getAccessToken: () => ' token-123 ' });
    await adapter.listInvoices('founder');

    const headers = new Headers((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-123');
    expect(headers.get('x-demo-user-id')).toBeNull();

    const blankFetch = vi.fn();
    const blank = new HttpBillingAdapter({ fetchFn: blankFetch, getAccessToken: () => null });
    await expect(blank.listInvoices('founder')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(blankFetch).not.toHaveBeenCalled();
  });

  it('parses valid invoices and receipts unchanged', async () => {
    const invoices = await adapterFor([invoice]).adapter.listInvoices('founder');
    expect(invoices).toEqual([invoice]);

    const receipts = await adapterFor([receipt]).adapter.listPaymentReceipts('founder');
    expect(receipts).toEqual([receipt]);
  });

  it('rejects a response whose data is not an array', async () => {
    await expect(adapterFor({ nope: true }).adapter.listInvoices('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
    await expect(adapterFor('x').adapter.listPaymentReceipts('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
  });

  it('rejects an envelope without data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'req-1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(new HttpBillingAdapter({ fetchFn }).listInvoices('founder')).rejects.toBeInstanceOf(
      BillingOperationError,
    );
  });

  it.each([
    ['a missing field', (dto: Record<string, unknown>) => { delete dto['totalPaise']; }],
    ['a non-integer paise amount', (dto: Record<string, unknown>) => { dto['totalPaise'] = 12.5; }],
    ['an unsafe paise amount', (dto: Record<string, unknown>) => { dto['totalPaise'] = Number.MAX_SAFE_INTEGER + 2; }],
    ['a negative days overdue', (dto: Record<string, unknown>) => { dto['daysOverdue'] = -1; }],
    ['an unknown status', (dto: Record<string, unknown>) => { dto['status'] = 'refunded'; }],
    ['a non-INR currency', (dto: Record<string, unknown>) => { dto['currency'] = 'USD'; }],
    ['a malformed date', (dto: Record<string, unknown>) => { dto['dueDate'] = '23/11/2026'; }],
    ['a non-UUID id', (dto: Record<string, unknown>) => { dto['id'] = 'INV-0001002'; }],
    ['items that are not an array', (dto: Record<string, unknown>) => { dto['items'] = 'none'; }],
    ['a payment with an unknown receipt status', (dto: Record<string, unknown>) => {
      dto['payments'] = [{ ...invoice.payments[0], receiptStatus: 'pending' }];
    }],
    ['an item with a string quantity', (dto: Record<string, unknown>) => {
      dto['items'] = [{ ...invoice.items[0], quantity: '1.5' }];
    }],
  ])('rejects an invoice with %s', async (_name, mutate) => {
    const bad = structuredClone(invoice) as unknown as Record<string, unknown>;
    mutate(bad);
    await expect(adapterFor([bad]).adapter.listInvoices('founder')).rejects.toMatchObject({ code: 'unexpected' });
  });

  it.each([
    ['an unknown payment method', (dto: Record<string, unknown>) => { dto['method'] = 'neft'; }],
    ['a missing allocations array', (dto: Record<string, unknown>) => { delete dto['allocations']; }],
    ['a fractional unallocated amount', (dto: Record<string, unknown>) => { dto['unallocatedPaise'] = 0.5; }],
    ['a non-string reference', (dto: Record<string, unknown>) => { dto['reference'] = 42; }],
    ['an allocation without an invoice code', (dto: Record<string, unknown>) => {
      dto['allocations'] = [{ invoiceId: receipt.allocations[0]!.invoiceId, amountPaise: 1 }];
    }],
  ])('rejects a receipt with %s', async (_name, mutate) => {
    const bad = structuredClone(receipt) as unknown as Record<string, unknown>;
    mutate(bad);
    await expect(adapterFor([bad]).adapter.listPaymentReceipts('founder')).rejects.toMatchObject({
      code: 'unexpected',
    });
  });

  it('normalizes HTTP errors into sanitized BillingOperationError without leaking server text', async () => {
    const cases = [
      { status: 401, code: 'unauthorized', message: 'Session expired. Please sign in again to view billing records.' },
      { status: 403, code: 'forbidden', message: 'Billing records are visible to the Founder and Manager only.' },
      { status: 404, code: 'not_found', message: 'The billing service could not be located.' },
      { status: 500, code: 'unexpected', message: 'An unexpected error occurred while loading billing records. Please try again.' },
    ];

    for (const c of cases) {
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'server_failure', message: 'Internal raw stack trace' } }), {
          status: c.status,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const adapter = new HttpBillingAdapter({ fetchFn });
      const caught = await adapter.listInvoices('founder').catch((err: unknown) => err);

      expect(caught).toBeInstanceOf(BillingOperationError);
      const error = caught as BillingOperationError;
      expect(error.code).toBe(c.code);
      expect(error.status).toBe(c.status);
      expect(error.serverCode).toBe('server_failure');
      expect(error.message).toBe(c.message);
      expect(error.message).not.toContain('Internal raw stack trace');
    }
  });

  it('handles network failure with sanitized error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch https://secret.example'));
    const error = await new HttpBillingAdapter({ fetchFn }).listPaymentReceipts('founder').catch((err: unknown) => err);

    expect(error).toMatchObject({
      code: 'network',
      message: 'Unable to reach the server. Please check your network connection and try again.',
    });
  });

  it('handles pre-aborted and in-flight aborted signals', async () => {
    const pre = new AbortController();
    pre.abort();
    const fetchFn = vi.fn();
    await expect(new HttpBillingAdapter({ fetchFn }).listInvoices('founder', { signal: pre.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchFn).not.toHaveBeenCalled();

    const inFlight = new AbortController();
    const slowFetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          inFlight.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const pending = new HttpBillingAdapter({ fetchFn: slowFetch }).listInvoices('founder', { signal: inFlight.signal });
    inFlight.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('preserves the browser fetch receiver binding', async () => {
    const win = {
      isWindow: true,
      fetch(this: unknown, _input?: RequestInfo | URL, _init?: RequestInit) {
        if (!this || (this as { isWindow?: boolean }).isWindow !== true) {
          throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
        }
        return Promise.resolve(okResponse([invoice]));
      },
    };
    const adapter = new HttpBillingAdapter({ fetchFn: (input, init) => win.fetch.call(win, input, init) as Promise<Response> });
    await expect(adapter.listInvoices('founder')).resolves.toHaveLength(1);
  });

  it('prefixes the configured base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([]));
    await new HttpBillingAdapter({ fetchFn, baseUrl: 'http://127.0.0.1:4321/' }).listPaymentReceipts('manager');
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:4321/api/v1/payment-receipts');
  });
});
