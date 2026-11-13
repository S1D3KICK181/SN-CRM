import { ReceiptIndianRupee, X } from 'lucide-react';
import { formatINR, type InvoiceRecord } from '../../data';

interface InvoiceDetailDrawerProps {
  invoice: InvoiceRecord;
  /** Id of the page note that explains why recording a payment is disabled. */
  readOnlyNoteId: string;
  onClose: () => void;
}

const LABEL_STYLE = { fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' } as const;

export function InvoiceDetailDrawer({ invoice, readOnlyNoteId, onClose }: InvoiceDetailDrawerProps) {
  const items = invoice.items ?? [];
  const payments = invoice.payments ?? [];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Invoice details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">IN</span>
            <div>
              <h2>{invoice.invoiceNumber}</h2>
              <p>
                {invoice.clientCode ? `${invoice.clientCode} · ` : ''}
                {invoice.clientName}
              </p>
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
              <span
                className={`invoice-chip ${
                  invoice.status === 'Paid'
                    ? 'is-paid'
                    : invoice.status === 'Partially Paid'
                    ? 'is-partial'
                    : invoice.status === 'Overdue'
                    ? 'is-overdue'
                    : invoice.status === 'Draft' || invoice.status === 'Cancelled'
                    ? 'is-draft'
                    : 'is-unpaid'
                }`}
              >
                {invoice.status}
              </span>
            </div>
            <div className="drawer-item">
              <span className="drawer-label">Linked Assignment</span>
              <span className="drawer-val">{invoice.assignmentCode ?? 'Not linked'}</span>
            </div>
            <div className="drawer-item">
              <span className="drawer-label">Issue Date</span>
              <span className="drawer-val">{invoice.invoiceDate}</span>
            </div>
            <div className="drawer-item">
              <span className="drawer-label">Due Date</span>
              <span className="drawer-val">
                {invoice.dueDate}
                {invoice.daysOverdue > 0 ? ` (${invoice.daysOverdue}d late)` : ''}
              </span>
            </div>
            {invoice.notes ? (
              <div className="drawer-item full-width">
                <span className="drawer-label">Notes</span>
                <span className="drawer-val">{invoice.notes}</span>
              </div>
            ) : null}
            {invoice.status === 'Cancelled' && invoice.voidReason ? (
              <div className="drawer-item full-width">
                <span className="drawer-label">Void Reason</span>
                <span className="drawer-val">{invoice.voidReason}</span>
              </div>
            ) : null}
          </div>

          {/* Line items */}
          <div className="drawer-card" style={{ padding: 14, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 10px', fontSize: 12, textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              Line items
            </h4>
            {items.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>No line items</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>GST %</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td style={{ fontSize: 12 }}>{item.description}</td>
                        <td style={{ fontSize: 12 }}>{item.quantity}</td>
                        <td style={{ fontSize: 12 }}>{formatINR(item.rate)}</td>
                        <td style={{ fontSize: 12 }}>{item.gstPercent}%</td>
                        <td style={{ fontSize: 12 }}>{formatINR(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="drawer-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal:</span>
                <strong>{formatINR(invoice.subtotal)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-muted)' }}>
                <span>GST:</span>
                <span>{formatINR(invoice.gstAmount)}</span>
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <strong>Total:</strong>
                <strong style={{ color: 'var(--brand)' }}>{formatINR(invoice.total)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                <span>Received:</span>
                <strong>{formatINR(invoice.amountReceived)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: invoice.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                <strong>Balance:</strong>
                <strong>{formatINR(invoice.balance)}</strong>
              </div>
            </div>
          </div>

          {/* Payments */}
          <div style={{ marginTop: 16 }}>
            <span style={LABEL_STYLE}>Payments ({payments.length})</span>
            {payments.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 6 }}>No payments recorded</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {payments.map((payment, index) => (
                  <div key={`${payment.receiptNumber}-${index}`} className="history-card-row">
                    <div>
                      <strong>{payment.receiptNumber} · {formatINR(payment.amount)}</strong>
                      <small>{payment.date}</small>
                    </div>
                    {payment.voided ? <span className="invoice-chip is-overdue">Voided</span> : null}
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
              disabled
              aria-describedby={readOnlyNoteId}
              style={{ cursor: 'not-allowed', opacity: 0.6 }}
            >
              <ReceiptIndianRupee size={14} /> Record payment
            </button>
          ) : null}
          <button className="soft-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
