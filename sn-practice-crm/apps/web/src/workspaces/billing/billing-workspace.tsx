import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Plus,
  ReceiptIndianRupee,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { CompanyRole } from '@sn/domain';
import {
  formatINR,
  type InvoiceRecord,
  type ReceiptRecord,
} from '../../data';
import { Card } from '../../ui/workspace-primitives';
import { InvoiceDetailDrawer } from './invoice-detail-drawer';

const READ_ONLY_NOTE_ID = 'billing-read-only-note';
const READ_ONLY_NOTE = 'Read-only for now: raising invoices and recording receipts are not available yet.';

interface BillingWorkspaceProps {
  role: CompanyRole;
  model: {
    invoices: InvoiceRecord[];
    receipts: ReceiptRecord[];
  };
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function invoiceChipClass(status: InvoiceRecord['status']): string {
  switch (status) {
    case 'Paid':
      return 'is-paid';
    case 'Partially Paid':
      return 'is-partial';
    case 'Overdue':
      return 'is-overdue';
    case 'Draft':
    case 'Cancelled':
      return 'is-draft';
    default:
      return 'is-unpaid';
  }
}

const DISABLED_ACTION_STYLE = { cursor: 'not-allowed', opacity: 0.6 } as const;

export function BillingWorkspace({ role, model, loading, error, onRetry }: BillingWorkspaceProps) {
  const { invoices, receipts } = model;

  const [tab, setTab] = useState<'invoices' | 'ageing' | 'receipts'>('invoices');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Unpaid' | 'Paid' | 'Draft'>('All');
  const [search, setSearch] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const leadership = role === 'founder' || role === 'manager';

  const totals = useMemo(() => {
    const live = invoices.filter((i) => i.status !== 'Draft' && i.status !== 'Cancelled');
    const billed = live.reduce((sum, i) => sum + i.total, 0);
    const received = live.reduce((sum, i) => sum + i.amountReceived, 0);
    const outstanding = live.reduce((sum, i) => sum + i.balance, 0);
    const overdue = live.filter((i) => i.daysOverdue > 0).reduce((sum, i) => sum + i.balance, 0);
    return { billed, received, outstanding, overdue };
  }, [invoices]);

  const openInvoices = useMemo(() => invoices.filter((i) => i.balance > 0), [invoices]);

  const ageingBuckets = useMemo(() => {
    const b0to30 = openInvoices.filter((i) => i.daysOverdue <= 0);
    const b31to60 = openInvoices.filter((i) => i.daysOverdue > 0 && i.daysOverdue <= 30);
    const b61to90 = openInvoices.filter((i) => i.daysOverdue > 30 && i.daysOverdue <= 60);
    const b90plus = openInvoices.filter((i) => i.daysOverdue > 60);

    return {
      current: { total: b0to30.reduce((s, i) => s + i.balance, 0), count: b0to30.length },
      d30: { total: b31to60.reduce((s, i) => s + i.balance, 0), count: b31to60.length },
      d60: { total: b61to90.reduce((s, i) => s + i.balance, 0), count: b61to90.length },
      critical: { total: b90plus.reduce((s, i) => s + i.balance, 0), count: b90plus.length },
    };
  }, [openInvoices]);

  const receivablesByClient = useMemo(() => {
    const byClient = new Map<string, { clientId: string; clientName: string; clientCode: string; outstanding: number; count: number; worstDaysOverdue: number }>();
    for (const inv of openInvoices) {
      const entry = byClient.get(inv.clientId) ?? {
        clientId: inv.clientId,
        clientName: inv.clientName,
        clientCode: inv.clientCode ?? '',
        outstanding: 0,
        count: 0,
        worstDaysOverdue: 0,
      };
      entry.outstanding += inv.balance;
      entry.count += 1;
      entry.worstDaysOverdue = Math.max(entry.worstDaysOverdue, inv.daysOverdue);
      byClient.set(inv.clientId, entry);
    }
    return [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding);
  }, [openInvoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter === 'Unpaid') {
        if (!['Unpaid', 'Partially Paid', 'Overdue'].includes(inv.status)) return false;
      } else if (statusFilter === 'Paid') {
        if (inv.status !== 'Paid') return false;
      } else if (statusFilter === 'Draft') {
        if (inv.status !== 'Draft') return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          inv.invoiceNumber.toLowerCase().includes(q) ||
          inv.clientName.toLowerCase().includes(q) ||
          inv.description.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [invoices, statusFilter, search]);

  const selectedInvoice = useMemo(
    () => invoices.find((inv) => inv.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );

  if (!leadership) {
    return (
      <Card title="Billing is restricted">
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
          <ShieldCheck size={48} color="var(--brand)" style={{ margin: '0 auto 16px', opacity: 0.7 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>Founder and Manager only</h3>
          <p style={{ maxWidth: 460, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>
            Invoices, receipts and collections are visible to the Founder and Manager.
          </p>
        </div>
      </Card>
    );
  }

  const hasData = invoices.length > 0 || receipts.length > 0;
  const initialLoading = loading && !hasData && !error;
  const initialError = Boolean(error) && !hasData;
  const stale = Boolean(error) && hasData;

  return (
    <div className="billing-layout">
      <p id={READ_ONLY_NOTE_ID} style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-muted)' }}>
        {READ_ONLY_NOTE}
      </p>

      {stale ? (
        <div className="workspace-warning-banner" role="status" style={{ marginBottom: 14 }}>
          <span className="workspace-warning-message">
            <AlertTriangle size={15} /> Refresh failed. Showing last loaded data.
          </span>
          <button className="soft-button" type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {initialLoading ? (
        <Card title="Fee Invoices & Practice Receivables" description="Loading billing records…">
          <div aria-busy="true" aria-label="Loading billing records">
            {[1, 2, 3, 4].map((x) => (
              <div className="skeleton-row engagement-skeleton-row" key={x}>
                <span className="skeleton-pulse" />
              </div>
            ))}
          </div>
        </Card>
      ) : initialError ? (
        <Card title="Fee Invoices & Practice Receivables" description="Unable to load billing records">
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load billing records</h3>
            <p>{error}</p>
            <button className="primary-button" type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        </Card>
      ) : (
        <>
          {/* Horizon UI KPI Metric Cards */}
          <section className="workspace-stats-grid">
            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Billed to date</span>
                <strong>{formatINR(totals.billed)}</strong>
                <small>Excludes drafts and cancelled invoices</small>
              </div>
              <span className="workspace-stat-icon">
                <FileText aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Realized &amp; Collected</span>
                <strong style={{ color: 'var(--success)' }}>{formatINR(totals.received)}</strong>
                <small>{Math.round((totals.received / (totals.billed || 1)) * 100)}% realization rate</small>
              </div>
              <span className="workspace-stat-icon stat-success">
                <CheckCircle2 aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Total Outstanding</span>
                <strong>{formatINR(totals.outstanding)}</strong>
                <small>{openInvoices.length} pending collection</small>
              </div>
              <span className="workspace-stat-icon stat-gold">
                <ReceiptIndianRupee aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Overdue Receivables</span>
                <strong style={{ color: 'var(--danger)' }}>{formatINR(totals.overdue)}</strong>
                <small>Requires collection intervention</small>
              </div>
              <span className="workspace-stat-icon stat-warning">
                <CalendarClock aria-hidden="true" />
              </span>
            </article>
          </section>

          {/* Main Card with Sub-Navigation */}
          <Card
            title="Fee Invoices & Practice Receivables"
            description="Accounting charges, GST compliance invoices, and payment receipts."
            action={
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="primary-button"
                  type="button"
                  disabled
                  aria-describedby={READ_ONLY_NOTE_ID}
                  style={{ fontSize: 12, padding: '7px 14px', ...DISABLED_ACTION_STYLE }}
                >
                  <Plus size={14} /> Raise Invoice
                </button>
                <button
                  className="soft-button"
                  type="button"
                  disabled
                  aria-describedby={READ_ONLY_NOTE_ID}
                  style={{ fontSize: 12, padding: '7px 14px', ...DISABLED_ACTION_STYLE }}
                >
                  <ReceiptIndianRupee size={14} /> Record Receipt
                </button>
              </div>
            }
          >
            {/* Sub-tabs bar */}
            <div className="work-mode-switcher" style={{ marginBottom: 16 }}>
              <button
                type="button"
                className={`work-tab-btn ${tab === 'invoices' ? 'is-active' : ''}`}
                onClick={() => setTab('invoices')}
              >
                <FileText size={14} />
                Invoices
                <span className="tab-badge">{invoices.length}</span>
              </button>
              <button
                type="button"
                className={`work-tab-btn ${tab === 'ageing' ? 'is-active' : ''}`}
                onClick={() => setTab('ageing')}
              >
                <TrendingUp size={14} />
                Ageing &amp; Receivables
                <span className="tab-badge">{openInvoices.length}</span>
              </button>
              <button
                type="button"
                className={`work-tab-btn ${tab === 'receipts' ? 'is-active' : ''}`}
                onClick={() => setTab('receipts')}
              >
                <CheckCircle2 size={14} />
                Receipts Register
                <span className="tab-badge">{receipts.length}</span>
              </button>
            </div>

            {tab === 'invoices' && (
              <>
                {/* Filter Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['All', 'Unpaid', 'Paid', 'Draft'] as const).map((sf) => (
                      <button
                        key={sf}
                        type="button"
                        onClick={() => setStatusFilter(sf)}
                        className={`cadence-pill ${statusFilter === sf ? 'is-active' : ''}`}
                        style={{ fontSize: 11 }}
                      >
                        {sf === 'Unpaid' ? 'Unpaid & Overdue' : sf}
                      </button>
                    ))}
                  </div>
                  <div style={{ position: 'relative', width: 260 }}>
                    <Search
                      size={14}
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }}
                    />
                    <input
                      type="text"
                      placeholder="Search invoice or client…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 12px 6px 32px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border)',
                        fontSize: 12,
                      }}
                    />
                  </div>
                </div>

                {/* Invoices Table */}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice #</th>
                        <th>Client Legal Entity</th>
                        <th>Date</th>
                        <th>Due Date</th>
                        <th>Total Billed</th>
                        <th>Received</th>
                        <th>Balance</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                            {invoices.length === 0 ? 'No invoices recorded yet.' : 'No invoices found matching current filter.'}
                          </td>
                        </tr>
                      ) : (
                        filteredInvoices.map((inv) => (
                          <tr key={inv.id} onClick={() => setSelectedInvoiceId(inv.id)} style={{ cursor: 'pointer' }}>
                            <td>
                              <div>
                                <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{inv.invoiceNumber}</strong>
                                <small style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {inv.description}
                                </small>
                              </div>
                            </td>
                            <td>
                              <span style={{ fontWeight: 600, color: 'var(--ink-strong)', fontSize: 12 }}>
                                {inv.clientName}
                              </span>
                              {inv.clientCode ? (
                                <small style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 11 }}>{inv.clientCode}</small>
                              ) : null}
                            </td>
                            <td>
                              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{inv.invoiceDate}</span>
                            </td>
                            <td>
                              <span className="due-chip" style={inv.daysOverdue > 0 ? { color: 'var(--danger)', background: 'var(--danger-soft)', borderColor: 'var(--danger)' } : {}}>
                                <CalendarClock size={12} />
                                {inv.dueDate} {inv.daysOverdue > 0 ? `(${inv.daysOverdue}d late)` : ''}
                              </span>
                            </td>
                            <td>
                              <strong style={{ fontSize: 12, color: 'var(--ink-strong)' }}>{formatINR(inv.total)}</strong>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>{formatINR(inv.amountReceived)}</span>
                            </td>
                            <td>
                              <strong style={{ fontSize: 12, color: inv.balance > 0 ? (inv.daysOverdue > 0 ? 'var(--danger)' : 'var(--warning)') : 'var(--success)' }}>
                                {formatINR(inv.balance)}
                              </strong>
                            </td>
                            <td>
                              <span className={`invoice-chip ${invoiceChipClass(inv.status)}`}>
                                {inv.status}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                                {inv.balance > 0 ? (
                                  <button
                                    className="primary-button"
                                    type="button"
                                    disabled
                                    aria-describedby={READ_ONLY_NOTE_ID}
                                    aria-label={`Record payment for ${inv.invoiceNumber}`}
                                    style={{ fontSize: 11, padding: '3px 8px', ...DISABLED_ACTION_STYLE }}
                                  >
                                    Record payment
                                  </button>
                                ) : null}
                                <button
                                  className="soft-button"
                                  type="button"
                                  style={{ fontSize: 11, padding: '3px 8px' }}
                                  aria-label={`View ${inv.invoiceNumber}`}
                                  onClick={() => setSelectedInvoiceId(inv.id)}
                                >
                                  View
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'ageing' && (
              <div>
                {/* Ageing Summary Cards */}
                <div className="ageing-card-grid">
                  <div className="ageing-bucket-card">
                    <span>0–30 Days (Current)</span>
                    <strong>{formatINR(ageingBuckets.current.total)}</strong>
                    <small>{ageingBuckets.current.count} {ageingBuckets.current.count === 1 ? 'invoice' : 'invoices'} on track</small>
                  </div>
                  <div className="ageing-bucket-card">
                    <span>31–60 Days</span>
                    <strong>{formatINR(ageingBuckets.d30.total)}</strong>
                    <small>{ageingBuckets.d30.count} pending items</small>
                  </div>
                  <div className={`ageing-bucket-card ${ageingBuckets.d60.total > 0 || ageingBuckets.critical.total > 0 ? 'is-critical' : ''}`}>
                    <span>61–90 Days (Critical)</span>
                    <strong>{formatINR(ageingBuckets.d60.total)}</strong>
                    <small>{ageingBuckets.d60.count} overdue items</small>
                  </div>
                  <div className={`ageing-bucket-card ${ageingBuckets.critical.total > 0 ? 'is-critical' : ''}`}>
                    <span>90+ Days (Severe)</span>
                    <strong>{formatINR(ageingBuckets.critical.total)}</strong>
                    <small>{ageingBuckets.critical.count} bad debt exposure</small>
                  </div>
                </div>

                {/* Client Receivables Table, derived from the open invoices above */}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Client Name</th>
                        <th>Open Invoices</th>
                        <th>Outstanding Amount</th>
                        <th>Ageing Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receivablesByClient.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                            No outstanding receivables.
                          </td>
                        </tr>
                      ) : (
                        receivablesByClient.map((c) => (
                          <tr key={c.clientId}>
                            <td>
                              <div>
                                <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{c.clientName}</strong>
                                {c.clientCode ? (
                                  <small style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 11 }}>{c.clientCode}</small>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <span style={{ fontSize: 12 }}>{c.count}</span>
                            </td>
                            <td>
                              <strong style={{ fontSize: 13, color: c.worstDaysOverdue > 0 ? 'var(--danger)' : 'var(--warning)' }}>
                                {formatINR(c.outstanding)}
                              </strong>
                            </td>
                            <td>
                              <span className={`invoice-chip ${c.worstDaysOverdue > 0 ? 'is-overdue' : 'is-partial'}`}>
                                {c.worstDaysOverdue > 0 ? `${c.worstDaysOverdue}d overdue` : 'Current'}
                              </span>
                            </td>
                            <td>
                              <button
                                className="primary-button"
                                type="button"
                                disabled
                                aria-describedby={READ_ONLY_NOTE_ID}
                                aria-label={`Record payment for ${c.clientName}`}
                                style={{ fontSize: 11, padding: '3px 8px', ...DISABLED_ACTION_STYLE }}
                              >
                                Record payment
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === 'receipts' && (
              <div className="table-scroll">
                {receipts.length === 0 ? (
                  <p style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
                    No payment receipts recorded for this portfolio yet.
                  </p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Receipt #</th>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Linked Invoice</th>
                        <th>Payment Mode</th>
                        <th>Bank Reference / UTR</th>
                        <th>Amount</th>
                        <th>Status &amp; Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((rec) => {
                        const voided = rec.status === 'Voided';
                        const allocations = rec.allocations ?? [];
                        const unallocated = rec.unallocated ?? 0;
                        return (
                          <tr key={rec.id}>
                            <td>
                              <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{rec.receiptNumber}</strong>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{rec.receiptDate}</span>
                            </td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>{rec.clientName}</span>
                            </td>
                            <td>
                              {allocations.length === 0 ? (
                                <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Not allocated</span>
                              ) : (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {allocations.map((allocation) => (
                                    <span className="client-id-chip" key={allocation.invoiceId}>{allocation.invoiceNumber}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td>
                              <span className="category-tag cat-gst" style={{ fontSize: 10, padding: '2px 8px' }}>
                                {rec.paymentMode}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink)' }}>
                                {rec.referenceNumber || '—'}
                              </span>
                            </td>
                            <td>
                              <strong style={{ fontSize: 12, color: voided ? 'var(--ink-muted)' : 'var(--success)', textDecoration: voided ? 'line-through' : 'none' }}>
                                {formatINR(rec.amount)}
                              </strong>
                              {!voided && unallocated > 0 ? (
                                <small style={{ display: 'block', fontSize: 11, color: 'var(--warning)' }}>
                                  Unallocated {formatINR(unallocated)}
                                </small>
                              ) : null}
                            </td>
                            <td>
                              {voided ? <span className="invoice-chip is-overdue">Voided</span> : null}
                              {rec.notes ? (
                                <small style={{ display: 'block', fontSize: 11, color: 'var(--ink-muted)' }}>{rec.notes}</small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Slide-over Invoice Detail Drawer */}
      {selectedInvoice ? (
        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          readOnlyNoteId={READ_ONLY_NOTE_ID}
          onClose={() => setSelectedInvoiceId(null)}
        />
      ) : null}
    </div>
  );
}
