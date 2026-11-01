import { useMemo, useState } from 'react';
import {
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
  type ClientRecord,
  type InvoiceRecord,
  type ReceiptRecord,
} from '../../data';
import { Card } from '../../ui/workspace-primitives';
import { InvoiceDetailDrawer } from './invoice-detail-drawer';

type BillingComposeIntent = 'invoice' | 'receipt';

interface BillingWorkspaceProps {
  role: CompanyRole;
  model: {
    invoices: InvoiceRecord[];
    receipts: ReceiptRecord[];
    clients: ClientRecord[];
  };
  actions: {
    compose: (intent: BillingComposeIntent) => void;
    notify: (message: string) => void;
    recordPaymentForInvoice: (invoice: InvoiceRecord) => void;
  };
}

export function BillingWorkspace({
  role,
  model,
  actions,
}: BillingWorkspaceProps) {
  const { invoices, receipts, clients } = model;
  const { compose: onCompose, notify: onToast, recordPaymentForInvoice: onRecordPaymentForInvoice } = actions;

  const [tab, setTab] = useState<'invoices' | 'ageing' | 'receipts'>('invoices');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Unpaid' | 'Paid' | 'Draft'>('All');
  const [search, setSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [portfolioFilter, setPortfolioFilter] = useState<string>('All');

  const leadership = role === 'founder' || role === 'manager';

  if (role === 'trainee') {
    return (
      <Card title="Restricted Practice Area" description="Financial data and billing operations are reserved for Staff, Managers, and Partners">
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
          <ShieldCheck size={48} color="var(--brand)" style={{ margin: '0 auto 16px', opacity: 0.7 }} />
          <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>Article Assistant Access Restricted</h3>
          <p style={{ maxWidth: 460, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>
            Fee schedules, tax invoices, receipt allocations, and client ledger ageing are restricted to Staff in-charge, Operations Managers, and Partners under practice governance rules.
          </p>
        </div>
      </Card>
    );
  }

  const staffName = role === 'senior_staff' ? 'Priya Desai' : role === 'staff' ? 'Rohan Mehta' : null;
  const effectiveStaff = !leadership ? staffName : (portfolioFilter === 'All' ? null : portfolioFilter);

  const scopedClients = useMemo(() => {
    if (!effectiveStaff) return clients;
    return clients.filter((c) => {
      if (c.primaryOwner === effectiveStaff) return true;
      if (effectiveStaff === 'Priya Desai' && c.id === 'CLI-0006') return true;
      return false;
    });
  }, [clients, effectiveStaff]);

  const scopedClientIds = useMemo(() => {
    return new Set(scopedClients.map((c) => c.id));
  }, [scopedClients]);

  const scopedInvoices = useMemo(() => {
    if (!effectiveStaff) return invoices;
    return invoices.filter((i) => scopedClientIds.has(i.clientId));
  }, [invoices, scopedClientIds, effectiveStaff]);

  const scopedReceipts = useMemo(() => {
    if (!effectiveStaff) return receipts;
    return receipts.filter((r) => scopedClientIds.has(r.clientId));
  }, [receipts, scopedClientIds, effectiveStaff]);

  const totals = useMemo(() => {
    const live = scopedInvoices.filter((i) => i.status !== 'Draft' && i.status !== 'Cancelled');
    const billed = live.reduce((sum, i) => sum + i.total, 0);
    const received = live.reduce((sum, i) => sum + i.amountReceived, 0);
    const outstanding = live.reduce((sum, i) => sum + i.balance, 0);
    const overdue = live.filter((i) => i.daysOverdue > 0).reduce((sum, i) => sum + i.balance, 0);
    return { billed, received, outstanding, overdue };
  }, [scopedInvoices]);

  const ageingBuckets = useMemo(() => {
    const openInvoices = scopedInvoices.filter((i) => i.balance > 0);
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
  }, [scopedInvoices]);

  const filteredInvoices = useMemo(() => {
    return scopedInvoices.filter((inv) => {
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
  }, [scopedInvoices, statusFilter, search]);

  return (
    <div className="billing-layout">
      {/* Staff Scoped Banner */}
      {!leadership && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(67, 24, 255, 0.07), rgba(67, 24, 255, 0.02))',
            border: '1px solid rgba(67, 24, 255, 0.22)',
            borderRadius: 14,
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                background: 'var(--brand)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {staffName === 'Priya Desai' ? 'PD' : 'RM'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 13, color: 'var(--ink-strong)' }}>
                  {staffName} · Client Portfolio Billing &amp; Collections
                </strong>
                <span className="cadence-pill is-active" style={{ fontSize: 10, padding: '2px 8px' }}>
                  {scopedClients.length} Assigned Clients
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>
                Showing invoices, receivables, and payment receipts strictly for clients assigned to you. Practice-wide financials and partner drawings are reserved for leadership.
              </p>
            </div>
          </div>
          <button
            className="primary-button"
            type="button"
            style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }}
            onClick={() => onCompose('receipt')}
          >
            <ReceiptIndianRupee size={12} /> Record Client Receipt
          </button>
        </div>
      )}

      {/* Leadership Portfolio Filter */}
      {leadership && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>Portfolio Scope:</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: 'All', label: 'Entire Practice (Firm-Wide)' },
              { id: 'Priya Desai', label: "Priya Desai's Portfolio (3)" },
              { id: 'Rohan Mehta', label: "Rohan Mehta's Portfolio (2)" },
              { id: 'Ananya Rao', label: "Ananya Rao's Portfolio (2)" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPortfolioFilter(p.id)}
                className={`cadence-pill ${portfolioFilter === p.id ? 'is-active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Horizon UI KPI Metric Cards */}
      <section className="workspace-stats-grid">
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>{!leadership ? 'Billed for my clients' : 'Billed this FY (2026–27)'}</span>
            <strong>{formatINR(totals.billed)}</strong>
            <small>{scopedInvoices.length} invoices generated</small>
          </div>
          <span className="workspace-stat-icon">
            <FileText aria-hidden="true" />
          </span>
        </article>

        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Realized &amp; Collected</span>
            <strong style={{ color: '#01b574' }}>{formatINR(totals.received)}</strong>
            <small>{Math.round((totals.received / (totals.billed || 1)) * 100)}% realization rate</small>
          </div>
          <span className="workspace-stat-icon stat-success">
            <CheckCircle2 aria-hidden="true" />
          </span>
        </article>

        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>{!leadership ? 'Outstanding for my clients' : 'Total Outstanding'}</span>
            <strong>{formatINR(totals.outstanding)}</strong>
            <small>{scopedInvoices.filter((i) => i.balance > 0).length} pending collection</small>
          </div>
          <span className="workspace-stat-icon stat-gold">
            <ReceiptIndianRupee aria-hidden="true" />
          </span>
        </article>

        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Overdue Receivables</span>
            <strong style={{ color: '#ee5d50' }}>{formatINR(totals.overdue)}</strong>
            <small>Requires collection intervention</small>
          </div>
          <span className="workspace-stat-icon stat-warning">
            <CalendarClock aria-hidden="true" />
          </span>
        </article>
      </section>

      {/* Main Card with Sub-Navigation */}
      <Card
        title={!leadership ? `${staffName}'s Client Invoices & Receivables` : "Fee Invoices & Practice Receivables"}
        description={!leadership ? "Client invoices, payment status, and receipt recording for your portfolio." : "Accounting charges, GST compliance invoices, and payment receipts."}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            {leadership ? (
              <button
                className="primary-button"
                type="button"
                style={{ fontSize: 12, padding: '7px 14px' }}
                onClick={() => onCompose('invoice')}
              >
                <Plus size={14} /> Raise Invoice
              </button>
            ) : null}
            <button
              className={!leadership ? "primary-button" : "soft-button"}
              type="button"
              style={{ fontSize: 12, padding: '7px 14px' }}
              onClick={() => onCompose('receipt')}
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
            <span className="tab-badge">{scopedInvoices.length}</span>
          </button>
          <button
            type="button"
            className={`work-tab-btn ${tab === 'ageing' ? 'is-active' : ''}`}
            onClick={() => setTab('ageing')}
          >
            <TrendingUp size={14} />
            Ageing &amp; Receivables
            <span className="tab-badge">{scopedInvoices.filter((i) => i.balance > 0).length}</span>
          </button>
          <button
            type="button"
            className={`work-tab-btn ${tab === 'receipts' ? 'is-active' : ''}`}
            onClick={() => setTab('receipts')}
          >
            <CheckCircle2 size={14} />
            Receipts Register
            <span className="tab-badge">{scopedReceipts.length}</span>
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
                    borderRadius: 'var(--radius-md)',
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
                        No invoices found matching current filter.
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} onClick={() => setSelectedInvoice(inv)} style={{ cursor: 'pointer' }}>
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
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{inv.invoiceDate}</span>
                        </td>
                        <td>
                          <span className="due-chip" style={inv.daysOverdue > 0 ? { color: '#ee5d50', background: '#fdeeee', borderColor: '#ee5d50' } : {}}>
                            <CalendarClock size={12} />
                            {inv.dueDate} {inv.daysOverdue > 0 ? `(${inv.daysOverdue}d late)` : ''}
                          </span>
                        </td>
                        <td>
                          <strong style={{ fontSize: 12, color: 'var(--ink-strong)' }}>{formatINR(inv.total)}</strong>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: '#01b574', fontWeight: 600 }}>{formatINR(inv.amountReceived)}</span>
                        </td>
                        <td>
                          <strong style={{ fontSize: 12, color: inv.balance > 0 ? (inv.daysOverdue > 0 ? '#ee5d50' : '#d97706') : '#01b574' }}>
                            {formatINR(inv.balance)}
                          </strong>
                        </td>
                        <td>
                          <span className={`invoice-chip ${
                            inv.status === 'Paid'
                              ? 'is-paid'
                              : inv.status === 'Partially Paid'
                              ? 'is-partial'
                              : inv.status === 'Overdue'
                              ? 'is-overdue'
                              : inv.status === 'Draft'
                              ? 'is-draft'
                              : 'is-unpaid'
                          }`}>
                            {inv.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                            {inv.balance > 0 ? (
                              <button
                                className="primary-button"
                                type="button"
                                style={{ fontSize: 11, padding: '3px 8px' }}
                                onClick={() => onRecordPaymentForInvoice(inv)}
                              >
                                Record Receipt
                              </button>
                            ) : null}
                            <button
                              className="soft-button"
                              type="button"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => setSelectedInvoice(inv)}
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

            {/* Client Receivables Table */}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Client Name</th>
                    <th>City &amp; State</th>
                    <th>Primary Contact</th>
                    <th>Outstanding Amount</th>
                    <th>Ageing Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedClients
                    .filter((c) => parseInt(c.outstanding.replace(/[^0-9]/g, '') || '0', 10) > 0)
                    .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div>
                            <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>{c.name}</strong>
                            <small style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 11 }}>{c.type}</small>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontSize: 12 }}>{c.city}, {c.state}</span>
                        </td>
                        <td>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{c.contactName}</span>
                            <small style={{ display: 'block', color: 'var(--ink-muted)', fontSize: 11 }}>{c.phone}</small>
                          </div>
                        </td>
                        <td>
                          <strong style={{ fontSize: 13, color: c.outstandingTone === 'danger' ? '#ee5d50' : '#b45309' }}>
                            {c.outstanding}
                          </strong>
                        </td>
                        <td>
                          <span className={`invoice-chip ${c.outstandingTone === 'danger' ? 'is-overdue' : 'is-partial'}`}>
                            {c.outstandingAge}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="primary-button"
                              type="button"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => {
                                const openInv = scopedInvoices.find((i) => i.clientId === c.id && i.balance > 0);
                                if (openInv) onRecordPaymentForInvoice(openInv);
                                else onCompose('receipt');
                              }}
                            >
                              Record Payment
                            </button>
                            <button
                              className="soft-button"
                              type="button"
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => onToast(`Collection reminder sent to ${c.contactName} (${c.name})`)}
                            >
                              Follow-Up
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'receipts' && (
          <div className="table-scroll">
            {scopedReceipts.length === 0 ? (
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
                    <th>Audit Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedReceipts.map((rec) => (
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
                        <span className="client-id-chip">{rec.invoiceNumber}</span>
                      </td>
                      <td>
                        <span className="category-tag cat-gst" style={{ fontSize: 10, padding: '2px 8px' }}>
                          {rec.paymentMode}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink)' }}>
                          {rec.referenceNumber}
                        </span>
                      </td>
                      <td>
                        <strong style={{ fontSize: 12, color: '#01b574' }}>{formatINR(rec.amount)}</strong>
                      </td>
                      <td>
                        <small style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{rec.notes}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Card>

      {/* Slide-over Invoice Detail Drawer */}
      {selectedInvoice ? (
        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          receipts={receipts.filter((r) => r.invoiceId === selectedInvoice.id)}
          onClose={() => setSelectedInvoice(null)}
          onRecordPayment={() => {
            const inv = selectedInvoice;
            setSelectedInvoice(null);
            onRecordPaymentForInvoice(inv);
          }}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}
