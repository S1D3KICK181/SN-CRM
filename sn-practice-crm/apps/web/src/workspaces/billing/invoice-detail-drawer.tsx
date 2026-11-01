import { ReceiptIndianRupee, X } from 'lucide-react';
import { formatINR, type InvoiceRecord, type ReceiptRecord } from '../../data';

interface InvoiceDetailDrawerProps {
  invoice: InvoiceRecord;
  receipts: ReceiptRecord[];
  onClose: () => void;
  onRecordPayment: () => void;
  onToast: (msg: string) => void;
}

export function InvoiceDetailDrawer({
  invoice,
  receipts,
  onClose,
  onRecordPayment,
  onToast,
}: InvoiceDetailDrawerProps) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Invoice details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">IN</span>
            <div>
              <h2>{invoice.invoiceNumber}</h2>
              <p>{invoice.clientName} · {invoice.invoiceDate}</p>
            </div>
          </div>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="drawer-content">
          <div className="drawer-grid" style={{ marginBottom: 16 }}>
            <div className="drawer-item">
              <span className="drawer-label">Invoice Status</span>
              <span className={`invoice-chip ${invoice.status === 'Paid' ? 'is-paid' : invoice.status === 'Overdue' ? 'is-overdue' : 'is-unpaid'}`}>
                {invoice.status}
              </span>
            </div>
            <div className="drawer-item">
              <span className="drawer-label">Due Date</span>
              <span className="drawer-val">{invoice.dueDate}</span>
            </div>
            <div className="drawer-item full-width">
              <span className="drawer-label">Service Description</span>
              <span className="drawer-val">{invoice.description}</span>
            </div>
          </div>

          {/* Line Item & Tax Calculation Breakdown */}
          <div className="drawer-card" style={{ padding: 14 }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 12, textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              Tax Invoice Breakdown (GST 18%)
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Professional Accounting Charges:</span>
                <strong>{formatINR(invoice.subtotal)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-muted)' }}>
                <span>CGST (9%):</span>
                <span>{formatINR(Math.round(invoice.gstAmount / 2))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-muted)' }}>
                <span>SGST (9%):</span>
                <span>{formatINR(Math.round(invoice.gstAmount / 2))}</span>
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <strong>Total Invoice Amount:</strong>
                <strong style={{ color: 'var(--brand)' }}>{formatINR(invoice.total)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#01b574' }}>
                <span>Amount Received:</span>
                <strong>− {formatINR(invoice.amountReceived)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: invoice.balance > 0 ? '#ee5d50' : '#01b574' }}>
                <strong>Net Balance Payable:</strong>
                <strong>{formatINR(invoice.balance)}</strong>
              </div>
            </div>
          </div>

          {/* Payment Allocations */}
          <div style={{ marginTop: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Allocated Payment Receipts ({receipts.length})
            </span>
            {receipts.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 6 }}>
                No payment receipts have been allocated to this invoice yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {receipts.map((r) => (
                  <div key={r.id} className="history-card-row">
                    <div>
                      <strong>{r.receiptNumber} · {formatINR(r.amount)}</strong>
                      <small>{r.receiptDate} · Mode: {r.paymentMode} (Ref: {r.referenceNumber})</small>
                    </div>
                    <span className="invoice-chip is-paid">Settled</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="drawer-footer">
          {invoice.balance > 0 ? (
            <button
              className="primary-button"
              type="button"
              onClick={onRecordPayment}
            >
              <ReceiptIndianRupee size={14} /> Record Payment
            </button>
          ) : null}
          <button
            className="soft-button"
            type="button"
            onClick={() => onToast(`Tax invoice PDF exported for ${invoice.invoiceNumber}`)}
          >
            Export PDF
          </button>
          <button className="soft-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
