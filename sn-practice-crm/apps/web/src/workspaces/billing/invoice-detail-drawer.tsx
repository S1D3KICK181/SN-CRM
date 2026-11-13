import { ReceiptIndianRupee, X } from 'lucide-react';
import { formatINR, type InvoiceRecord, type InvoicePaymentRecord } from '../../data';
import { billLabel, canRecordPayment } from './billing-form-model';

interface InvoiceDetailDrawerProps {
  invoice: InvoiceRecord;
  /** Founder and Manager: may cancel the bill and its payments. */
  canCancel: boolean;
  /** Everyone who can see the screen except the Trainee. */
  canRecordPayment: boolean;
  onRecordPayment: (opener: HTMLElement) => void;
  onCancelBill: (opener: HTMLElement) => void;
  onCancelPayment: (payment: InvoicePaymentRecord, opener: HTMLElement) => void;
  onClose: () => void;
}

const CANCEL_BLOCKED_NOTE_ID = 'cancel-bill-blocked-note';

const LABEL_STYLE = { fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' } as const;

export function InvoiceDetailDrawer({
  invoice,
  canCancel,
  canRecordPayment: mayRecordPayment,
  onRecordPayment,
  onCancelBill,
  onCancelPayment,
  onClose,
}: InvoiceDetailDrawerProps) {
  const items = invoice.items ?? [];
  const payments = invoice.payments ?? [];
  const hasReceivedPayments = payments.some((payment) => !payment.voided);
  const showCrmRef = Boolean(invoice.vyaparBillNumber);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Invoice details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">BL</span>
            <div>
              <h2>{billLabel(invoice)}</h2>
              <p>
                {invoice.clientCode ? `${invoice.clientCode} · ` : ''}
                {invoice.clientName}
              </p>
              {showCrmRef ? <p>CRM ref {invoice.invoiceNumber}</p> : null}
            </div>
          </div>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="drawer-content">
          <div className="drawer-grid" style={{ marginBottom: 16 }}>
            <div className="drawer-item">
              <span className="drawer-label">Bill status</span>
              <span
                className={`invoice-chip ${
                  invoice.status === 'Paid'
                    ? 'is-paid'
                    : invoice.status === 'Partly Paid'
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
              <span className="drawer-label">Linked assignment</span>
              <span className="drawer-val">{invoice.assignmentCode ?? 'Not linked'}</span>
            </div>
            <div className="drawer-item">
              <span className="drawer-label">Bill date</span>
              <span className="drawer-val">{invoice.invoiceDate}</span>
            </div>
            <div className="drawer-item">
              <span className="drawer-label">Due date</span>
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
                <span className="drawer-label">Cancellation reason</span>
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
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td style={{ fontSize: 12 }}>{item.description}</td>
                        <td style={{ fontSize: 12 }}>{item.quantity}</td>
                        <td style={{ fontSize: 12 }}>{formatINR(item.rate)}</td>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <strong>Fee:</strong>
                <strong style={{ color: 'var(--brand)' }}>{formatINR(invoice.total)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--success)' }}>
                <span>Received:</span>
                <strong>{formatINR(invoice.amountReceived)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: invoice.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                <strong>Pending:</strong>
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
                  <div key={`${payment.receiptId}-${index}`} className="history-card-row">
                    <div>
                      <strong>{payment.receiptNumber} · {formatINR(payment.amount)}</strong>
                      <small>{payment.date}</small>
                    </div>
                    {payment.voided ? <span className="invoice-chip is-overdue">Cancelled</span> : null}
                    {canCancel && !payment.voided ? (
                      <button
                        className="soft-button"
                        type="button"
                        aria-label={`Cancel payment ${payment.receiptNumber}`}
                        onClick={(event) => onCancelPayment(payment, event.currentTarget)}
                      >
                        Cancel payment
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="drawer-footer">
          {mayRecordPayment && canRecordPayment(invoice) ? (
            <button className="primary-button" type="button" onClick={(event) => onRecordPayment(event.currentTarget)}>
              <ReceiptIndianRupee size={14} /> Record payment
            </button>
          ) : null}
          {canCancel && invoice.status !== 'Cancelled' ? (
            <>
              <button
                className="soft-button engagement-end-button"
                type="button"
                disabled={hasReceivedPayments}
                aria-describedby={hasReceivedPayments ? CANCEL_BLOCKED_NOTE_ID : undefined}
                onClick={(event) => onCancelBill(event.currentTarget)}
              >
                Cancel bill
              </button>
              {hasReceivedPayments ? (
                <small id={CANCEL_BLOCKED_NOTE_ID} style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                  Cancel the payments on this bill first.
                </small>
              ) : null}
            </>
          ) : null}
          <button className="soft-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}
