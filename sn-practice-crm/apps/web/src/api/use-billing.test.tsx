// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { InvoiceDto, PaymentReceiptDto } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { DeterministicTestBillingAdapter } from './test-billing-adapter';
import { BillingOperationError } from './billing-types';
import { useBilling } from './use-billing';

const invoice: InvoiceDto = {
  id: '70000000-0000-4000-a000-000000000003',
  code: 'INV-0001003',
  vyaparBillNumber: null,
  clientId: '10000000-0000-4000-a000-000000000003',
  clientCode: 'CL-001003',
  clientName: 'Sharma Retail',
  assignmentId: null,
  assignmentCode: null,
  issueDate: '2026-09-28',
  dueDate: '2026-10-26',
  currency: 'INR',
  subtotalPaise: 1500000,
  taxPaise: 270000,
  totalPaise: 1770000,
  amountReceivedPaise: 0,
  balancePaise: 1770000,
  daysOverdue: 18,
  status: 'issued',
  notes: null,
  issuedAt: '2026-09-28T04:30:00.000Z',
  voidReason: null,
  voidedAt: null,
  items: [],
  payments: [],
  createdAt: '2026-09-28T04:30:00.000Z',
  updatedAt: '2026-09-28T04:30:00.000Z',
};

const receipt: PaymentReceiptDto = {
  id: '71000000-0000-4000-a000-000000000002',
  code: 'RCT-0001002',
  clientId: '10000000-0000-4000-a000-000000000001',
  clientCode: 'CL-001001',
  clientName: 'Aster Foods',
  receivedOn: '2026-11-08',
  amountPaise: 1000000,
  method: 'upi',
  reference: null,
  notes: null,
  status: 'received',
  voidReason: null,
  voidedAt: null,
  allocatedPaise: 600000,
  unallocatedPaise: 400000,
  allocations: [],
  createdAt: '2026-11-08T04:30:00.000Z',
};

describe('useBilling', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(['founder', 'manager', 'senior_staff', 'staff'] as const)('loads and maps invoices and receipts for %s', async (role) => {
    const port = new DeterministicTestBillingAdapter();
    port.setInvoicesResponse(role, [invoice]);
    port.setReceiptsResponse(role, [receipt]);

    const { result } = renderHook(() => useBilling(role, { port }));
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.invoices).toHaveLength(1);
    expect(result.current.invoices[0]).toMatchObject({
      invoiceNumber: 'INV-0001003',
      status: 'Overdue',
      total: 17700,
      balance: 17700,
      invoiceDate: '28/09/2026',
    });
    expect(result.current.receipts[0]).toMatchObject({
      receiptNumber: 'RCT-0001002',
      paymentMode: 'UPI',
      amount: 10000,
      unallocated: 4000,
    });
  });

  it.each(['trainee'] as const)('never loads anything for %s', async (role) => {
    const port = new DeterministicTestBillingAdapter();
    port.setInvoicesResponse(role, [invoice]);
    port.setReceiptsResponse(role, [receipt]);

    const { result } = renderHook(() => useBilling(role, { port }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(0);
    expect(result.current.invoices).toEqual([]);
    expect(result.current.receipts).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('does not load when disabled', async () => {
    const port = new DeterministicTestBillingAdapter();
    const { result } = renderHook(() => useBilling('founder', { port, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('suppresses data synchronously when the role drops to one without billing access', async () => {
    const port = new DeterministicTestBillingAdapter();
    port.setInvoicesResponse('founder', [invoice]);

    const { result, rerender } = renderHook(({ role }: { role: CompanyRole }) => useBilling(role, { port }), {
      initialProps: { role: 'founder' as CompanyRole },
    });
    await waitFor(() => expect(result.current.invoices).toHaveLength(1));

    rerender({ role: 'trainee' });
    expect(result.current.invoices).toEqual([]);
    expect(result.current.receipts).toEqual([]);
    expect(result.current.hasLiveSnapshot).toBe(false);
  });

  it('never shows one role data to another while the next load is in flight', async () => {
    const port = new DeterministicTestBillingAdapter();
    port.setInvoicesResponse('founder', [invoice]);
    let release: (value: InvoiceDto[]) => void = () => undefined;
    port.enqueueDeferredInvoices(new Promise<InvoiceDto[]>((resolve) => { release = resolve; }));

    const { result, rerender } = renderHook(({ role }: { role: CompanyRole }) => useBilling(role, { port }), {
      initialProps: { role: 'founder' as CompanyRole },
    });
    // First founder load is the deferred one; release it with data.
    await act(async () => {
      release([invoice]);
    });
    await waitFor(() => expect(result.current.invoices).toHaveLength(1));

    let releaseManager: (value: InvoiceDto[]) => void = () => undefined;
    port.enqueueDeferredInvoices(new Promise<InvoiceDto[]>((resolve) => { releaseManager = resolve; }));
    rerender({ role: 'manager' });

    expect(result.current.invoices).toEqual([]);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      releaseManager([{ ...invoice, code: 'INV-0009999' }]);
    });
    await waitFor(() => expect(result.current.invoices[0]?.invoiceNumber).toBe('INV-0009999'));
  });

  it('ignores a stale response that resolves after the role changed', async () => {
    const port = new DeterministicTestBillingAdapter();
    let releaseFounder: (value: InvoiceDto[]) => void = () => undefined;
    port.enqueueDeferredInvoices(new Promise<InvoiceDto[]>((resolve) => { releaseFounder = resolve; }));
    port.setInvoicesResponse('manager', [{ ...invoice, code: 'INV-0000002' }]);

    const { result, rerender } = renderHook(({ role }: { role: CompanyRole }) => useBilling(role, { port }), {
      initialProps: { role: 'founder' as CompanyRole },
    });
    rerender({ role: 'manager' });
    await waitFor(() => expect(result.current.invoices[0]?.invoiceNumber).toBe('INV-0000002'));

    await act(async () => {
      releaseFounder([{ ...invoice, code: 'INV-0000001' }]);
    });
    expect(result.current.invoices.map((item) => item.invoiceNumber)).toEqual(['INV-0000002']);
  });

  it('exposes a sanitized error and recovers on retry', async () => {
    const port = new DeterministicTestBillingAdapter();
    port.setDefaultError(new BillingOperationError({ code: 'network', message: 'raw socket text 10.0.0.5' }));

    const { result } = renderHook(() => useBilling('founder', { port }));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.loading).toBe(false);
    expect(result.current.error?.code).toBe('network');
    expect(result.current.error?.message).toBe('Unable to reach the server. Please check your network connection and try again.');
    expect(result.current.error?.message).not.toContain('10.0.0.5');
    expect(result.current.invoices).toEqual([]);

    port.setDefaultError(undefined);
    port.setInvoicesResponse('founder', [invoice]);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.invoices).toHaveLength(1));
    expect(result.current.error).toBeNull();
    expect(result.current.hasLiveSnapshot).toBe(true);
  });

  it('keeps the last loaded rows when a retry fails', async () => {
    const port = new DeterministicTestBillingAdapter();
    port.setInvoicesResponse('founder', [invoice]);

    const { result } = renderHook(() => useBilling('founder', { port }));
    await waitFor(() => expect(result.current.hasLiveSnapshot).toBe(true));

    port.setDefaultError(new BillingOperationError({ code: 'unexpected', message: 'boom' }));
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.invoices).toHaveLength(1);
    expect(result.current.hasLiveSnapshot).toBe(true);
  });
});

describe('useBilling mutations', () => {
  afterEach(() => {
    cleanup();
  });

  const billInput = {
    clientId: '10000000-0000-4000-a000-000000000001',
    vyaparBillNumber: 'VYP-140',
    billDate: '2026-11-01',
    dueDate: '2026-11-16',
    amountPaise: 250000,
    description: 'Returns for October',
  };

  async function setup(role: CompanyRole = 'founder') {
    const port = new DeterministicTestBillingAdapter();
    port.setInvoicesResponse(role, [invoice]);
    port.setReceiptsResponse(role, [receipt]);
    port.setMutationInvoice(invoice);
    port.setMutationReceipt(receipt);
    const hook = renderHook(() => useBilling(role, { port }));
    await waitFor(() => expect(hook.result.current.hasLiveSnapshot).toBe(true));
    return { port, ...hook };
  }

  it('recording a bill sends the key and reloads both lists', async () => {
    const { port, result } = await setup();
    const before = port.calls.length;
    await act(async () => {
      await result.current.recordBill(billInput, 'key-1');
    });
    expect(port.mutations).toEqual([{ kind: 'record-bill', role: 'founder', input: billInput, idempotencyKey: 'key-1' }]);
    const after = port.calls.slice(before).map((call) => call.kind).sort();
    expect(after).toEqual(['invoices', 'receipts']);
  });

  it('recording a payment, cancelling a bill and cancelling a payment each reload both lists', async () => {
    const { port, result } = await setup('manager');
    const runs: Array<[string, () => Promise<unknown>]> = [
      ['record-payment', () => result.current.recordPayment({ invoiceId: invoice.id, receivedOn: '2026-11-02', amountPaise: 100, method: 'upi' }, 'k2')],
      ['void-bill', () => result.current.voidBill(invoice.id, { reason: 'Raised twice' }, 'k3')],
      ['void-payment', () => result.current.voidPayment(receipt.id, { reason: 'Bounced' }, 'k4')],
    ];
    for (const [kind, run] of runs) {
      const before = port.calls.length;
      await act(async () => {
        await run();
      });
      expect(port.mutations.at(-1)?.kind).toBe(kind);
      expect(port.calls.slice(before).map((call) => call.kind).sort()).toEqual(['invoices', 'receipts']);
    }
    expect(port.mutations.at(-1)?.targetId).toBe(receipt.id);
  });

  it('a failed mutation throws a sanitized error and does not reload', async () => {
    const { port, result } = await setup();
    port.setMutationError(
      new BillingOperationError({ code: 'unexpected', message: 'raw stack', status: 409, serverCode: 'duplicate_vyapar_bill' }),
    );
    const before = port.calls.length;
    let caught: unknown;
    await act(async () => {
      caught = await result.current.recordBill(billInput, 'key-1').catch((err: unknown) => err);
    });
    expect(caught).toBeInstanceOf(BillingOperationError);
    expect((caught as BillingOperationError).serverCode).toBe('duplicate_vyapar_bill');
    expect((caught as BillingOperationError).message).not.toContain('raw stack');
    expect(port.calls.length).toBe(before);
  });

  it('refuses to mutate for the trainee without touching the port', async () => {
    const port = new DeterministicTestBillingAdapter();
    const { result } = renderHook(() => useBilling('trainee', { port }));
    let caught: unknown;
    await act(async () => {
      caught = await result.current.recordBill(billInput, 'key-1').catch((err: unknown) => err);
    });
    expect((caught as BillingOperationError).code).toBe('forbidden');
    expect(port.mutations).toHaveLength(0);
  });

  it('using credit and removing it each send the key and reload both lists', async () => {
    const { port, result } = await setup('manager');
    const allocationId = '73000000-0000-4000-a000-0000000000c1';
    const runs: Array<[string, string, () => Promise<unknown>]> = [
      ['apply-credit', invoice.id, () => result.current.applyCredit(invoice.id, 'k-apply')],
      ['remove-credit', allocationId, () => result.current.removeCredit(allocationId, 'k-remove')],
    ];
    for (const [kind, targetId, run] of runs) {
      const before = port.calls.length;
      await act(async () => {
        await run();
      });
      expect(port.mutations.at(-1)).toMatchObject({ kind, role: 'manager', targetId, input: {} });
      expect(port.calls.slice(before).map((call) => call.kind).sort()).toEqual(['invoices', 'receipts']);
    }
    expect(port.mutations.map((mutation) => mutation.idempotencyKey)).toEqual(['k-apply', 'k-remove']);
  });

  it('a failed credit change throws a sanitized error and does not reload', async () => {
    const { port, result } = await setup();
    port.setMutationError(
      new BillingOperationError({ code: 'unexpected', message: 'raw stack', status: 422, serverCode: 'no_credit_available' }),
    );
    const before = port.calls.length;
    let caught: unknown;
    await act(async () => {
      caught = await result.current.applyCredit(invoice.id, 'key-1').catch((err: unknown) => err);
    });
    expect((caught as BillingOperationError).serverCode).toBe('no_credit_available');
    expect((caught as BillingOperationError).message).not.toContain('raw stack');
    expect(port.calls.length).toBe(before);
  });

  it('refuses the credit actions for the trainee without touching the port', async () => {
    const port = new DeterministicTestBillingAdapter();
    const { result } = renderHook(() => useBilling('trainee', { port }));
    let applied: unknown;
    let removed: unknown;
    await act(async () => {
      applied = await result.current.applyCredit(invoice.id, 'key-1').catch((err: unknown) => err);
      removed = await result.current.removeCredit(invoice.id, 'key-2').catch((err: unknown) => err);
    });
    expect((applied as BillingOperationError).code).toBe('forbidden');
    expect((removed as BillingOperationError).code).toBe('forbidden');
    expect(port.mutations).toHaveLength(0);
  });
});
