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

  it.each(['founder', 'manager'] as const)('loads and maps invoices and receipts for %s', async (role) => {
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

  it.each(['senior_staff', 'staff', 'trainee'] as const)('never loads anything for %s', async (role) => {
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

    rerender({ role: 'staff' });
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
