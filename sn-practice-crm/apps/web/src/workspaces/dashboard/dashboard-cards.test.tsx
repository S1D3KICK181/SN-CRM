// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AssignmentRow, InvoiceRecord, ReceiptRecord, RecurringScheduleRecord } from '../../data';
import {
  BilledAndCollectedCard,
  ComingUpCard,
  DashboardMetricStrip,
  FeesSnapshotCard,
  NeedsAttentionCard,
  OpenWorkByPersonCard,
  PendingByClientCard,
  RecurringSchedulesCard,
} from './dashboard-cards';

afterEach(() => {
  cleanup();
});

const TODAY = '2026-11-13';

function assignment(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: 'a1',
    title: 'October GST',
    client: 'Aster Foods',
    service: 'GST',
    due: '13/11/2026',
    owner: 'Priya Desai',
    ownerId: 'u-priya',
    status: 'In progress',
    progress: 10,
    tone: 'default',
    ...overrides,
  };
}

function bill(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'i1',
    invoiceNumber: 'INV-000001',
    clientId: 'c1',
    clientName: 'Aster Foods',
    description: 'Returns',
    invoiceDate: '05/11/2026',
    dueDate: '20/11/2026',
    subtotal: 1000,
    gstAmount: 0,
    total: 1000,
    amountReceived: 0,
    balance: 1000,
    balancePaise: 100000,
    status: 'Pending',
    daysOverdue: 0,
    ...overrides,
  };
}

const receipt: ReceiptRecord = {
  id: 'r1',
  receiptNumber: 'RCT-000001',
  clientId: 'c1',
  clientName: 'Aster Foods',
  invoiceId: 'i1',
  invoiceNumber: 'INV-000001',
  receiptDate: '08/11/2026',
  amount: 400,
  amountPaise: 40000,
  paymentMode: 'UPI',
  referenceNumber: '',
  notes: '',
  status: 'Received',
};

const schedule: RecurringScheduleRecord = {
  id: 's1',
  title: 'GSTR-3B Monthly',
  category: 'GST',
  clientId: 'c1',
  clientName: 'Aster Foods',
  cadence: 'Monthly',
  defaultOwner: 'Priya Desai',
  nextRunDate: '01/12/2026',
  nextDueDate: '20/12/2026',
  status: 'Active',
};

describe('DashboardMetricStrip', () => {
  it('renders label, value and note for every tile', () => {
    render(
      <DashboardMetricStrip
        tiles={[
          { label: 'Due today', value: '2', note: '1 overdue', tone: 'danger' },
          { label: 'Open assignments', value: '5', note: '3 in progress', tone: 'default' },
        ]}
      />,
    );
    const strip = screen.getByRole('region', { name: 'Operational summary' });
    expect(within(strip).getByText('Due today')).toBeTruthy();
    expect(within(strip).getByText('1 overdue')).toBeTruthy();
    expect(strip.querySelector('.tone-danger')).toBeTruthy();
    expect(within(strip).getByText('5')).toBeTruthy();
  });
});

describe('ComingUpCard', () => {
  it('shows date, title, client and a status chip', () => {
    render(<ComingUpCard today={TODAY} assignments={[assignment(), assignment({ id: 'a2', title: 'Late', due: '10/11/2026' })]} />);
    expect(screen.getByRole('heading', { name: 'Coming up' })).toBeTruthy();
    expect(screen.getByText('Open assignments by due date')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('10/11')).toBeTruthy();
    expect(screen.getByText('Due today')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('explains an empty list', () => {
    const { rerender } = render(<ComingUpCard today={TODAY} assignments={[]} />);
    expect(screen.getByText('No open assignments.')).toBeTruthy();
    rerender(<ComingUpCard today={TODAY} assignments={[assignment({ due: '' })]} />);
    expect(screen.getByText('Nothing due. All open work is scheduled.')).toBeTruthy();
  });
});

describe('OpenWorkByPersonCard', () => {
  it('lists owners with open counts', () => {
    render(<OpenWorkByPersonCard assignments={[assignment(), assignment({ id: 'a2' })]} />);
    expect(screen.getByText('Priya Desai')).toBeTruthy();
    expect(screen.getByText('2 open')).toBeTruthy();
  });

  it('explains an empty list', () => {
    render(<OpenWorkByPersonCard assignments={[]} />);
    expect(screen.getByText('No open assignments.')).toBeTruthy();
  });
});

describe('RecurringSchedulesCard', () => {
  it('shows the active count, categories and next due date', () => {
    render(<RecurringSchedulesCard schedules={[schedule, { ...schedule, id: 's2', status: 'Paused' }]} />);
    expect(screen.getByText('active · 1 paused')).toBeTruthy();
    expect(screen.getByText(/^GST/)).toBeTruthy();
    expect(screen.getByText('Next due 20/12/2026 · GSTR-3B Monthly')).toBeTruthy();
  });

  it('explains an empty list without invented numbers', () => {
    render(<RecurringSchedulesCard schedules={[]} />);
    expect(screen.getByText('No recurring schedules yet.')).toBeTruthy();
    expect(screen.queryByText('7')).toBeNull();
  });
});

describe('BilledAndCollectedCard', () => {
  it('summarises the year and gives each month an accessible text', () => {
    render(
      <BilledAndCollectedCard invoices={[bill()]} receipts={[receipt]} today={TODAY} feesState="ready" />,
    );
    expect(screen.getByText('This financial year · 2026–27')).toBeTruthy();
    expect(document.querySelector('.chart-summary')?.textContent).toBe('Billed₹1,000Collected₹400');
    expect(screen.getByRole('group', { name: /billed and collected by month/i })).toBeTruthy();
    expect(screen.getByText('Nov: billed ₹1,000, collected ₹400')).toBeTruthy();
    expect(screen.getByText('Apr: billed ₹0, collected ₹0')).toBeTruthy();
  });

  it('explains an empty year', () => {
    render(<BilledAndCollectedCard invoices={[]} receipts={[]} today={TODAY} feesState="ready" />);
    expect(screen.getByText('No bills recorded this financial year.')).toBeTruthy();
  });

  it('shows loading and a working Retry on error', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <BilledAndCollectedCard invoices={[]} receipts={[]} today={TODAY} feesState="loading" />,
    );
    expect(screen.getByText('Loading fees…')).toBeTruthy();
    rerender(
      <BilledAndCollectedCard invoices={[]} receipts={[]} today={TODAY} feesState="error" onRetry={onRetry} />,
    );
    expect(screen.getByText('Fees could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('FeesSnapshotCard', () => {
  it('shows the four items and the collected percentage', () => {
    render(
      <FeesSnapshotCard
        invoices={[bill({ status: 'Overdue', daysOverdue: 9 })]}
        receipts={[receipt]}
        today={TODAY}
        feesState="ready"
      />,
    );
    expect(screen.getByText('Billed this month')).toBeTruthy();
    expect(screen.getByText('1 bill')).toBeTruthy();
    expect(screen.getByText('1 payment')).toBeTruthy();
    expect(screen.getByText('1 client')).toBeTruthy();
    expect(screen.getByText('oldest 9 days')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(document.querySelector('.snapshot-item.is-danger')).toBeTruthy();
  });

  it('shows no overdue danger and hides the percentage when nothing is billed', () => {
    render(<FeesSnapshotCard invoices={[]} receipts={[]} today={TODAY} feesState="ready" />);
    expect(screen.getByText('None overdue')).toBeTruthy();
    expect(document.querySelector('.snapshot-item.is-danger')).toBeNull();
    expect(screen.queryByText(/of fees billed this year collected/)).toBeNull();
  });

  it('shows the error state with Retry', () => {
    const onRetry = vi.fn();
    render(<FeesSnapshotCard invoices={[]} receipts={[]} today={TODAY} feesState="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('PendingByClientCard', () => {
  const invoices = [
    bill({ id: '1', clientId: 'c1', clientName: 'Aster Foods', status: 'Overdue', daysOverdue: 62, balancePaise: 8850000 }),
    bill({ id: '2', clientId: 'c2', clientName: 'Northstar Exports', balancePaise: 1200000 }),
  ];

  it('shows the total, rows and navigates to billing', () => {
    const onNavigate = vi.fn();
    render(<PendingByClientCard invoices={invoices} feesState="ready" onNavigate={onNavigate} />);
    expect(screen.getByText('Total pending')).toBeTruthy();
    expect(screen.getByText('₹1,00,500')).toBeTruthy();
    expect(screen.getByText('₹88,500 overdue')).toBeTruthy();
    expect(screen.getByText('62 days overdue')).toBeTruthy();
    expect(screen.getByText('Not yet due')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Northstar Exports/ }));
    expect(onNavigate).toHaveBeenCalledWith('Billing & Collections');
  });

  it('shows three clients when compact', () => {
    const many = ['A', 'B', 'C', 'D'].map((name, i) =>
      bill({ id: name, clientId: name, clientName: `Client ${name}`, balancePaise: 1000 * (10 - i) }),
    );
    const { rerender } = render(<PendingByClientCard invoices={many} feesState="ready" />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    rerender(<PendingByClientCard invoices={many} feesState="ready" compact />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('explains an empty list', () => {
    render(<PendingByClientCard invoices={[]} feesState="ready" />);
    expect(screen.getByText('Nothing pending. All bills are paid.')).toBeTruthy();
  });
});

describe('NeedsAttentionCard', () => {
  it('leads with the count and lists rows in order', () => {
    render(
      <NeedsAttentionCard
        today={TODAY}
        feesState="ready"
        assignments={[
          assignment({ id: '1', title: 'Late', due: '10/11/2026' }),
          assignment({ id: '2', title: 'Returned', status: 'Changes requested', due: '30/11/2026' }),
        ]}
        invoices={[bill({ status: 'Overdue', balancePaise: 250000, vyaparBillNumber: 'VYP-9', clientName: 'BluePeak' })]}
      />,
    );
    expect(screen.getByText('3 items need attention.')).toBeTruthy();
    expect(screen.getByText('Late · Aster Foods')).toBeTruthy();
    expect(screen.getByText('3d overdue')).toBeTruthy();
    expect(screen.getByText('Changes requested')).toBeTruthy();
    expect(screen.getByText('BluePeak · VYP-9')).toBeTruthy();
    expect(screen.getByText('₹2,500')).toBeTruthy();
  });

  it('says so when nothing needs attention', () => {
    render(<NeedsAttentionCard today={TODAY} feesState="ready" assignments={[]} invoices={[]} />);
    expect(screen.getByText('Nothing needs attention right now.')).toBeTruthy();
  });

  it('keeps the work rows and offers Retry when fees failed', () => {
    const onRetry = vi.fn();
    render(
      <NeedsAttentionCard
        today={TODAY}
        feesState="error"
        assignments={[assignment({ title: 'Late', due: '10/11/2026' })]}
        invoices={[]}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Late · Aster Foods')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
