import { Activity, CalendarClock, Repeat2, ShieldCheck, UsersRound } from 'lucide-react';
import type { AssignmentRow, InvoiceRecord, ReceiptRecord, RecurringScheduleRecord } from '../../data';
import type { PageKey } from '../../shell/navigation';
import { Card, Status } from '../../ui/workspace-primitives';
import {
  computeBilledAndCollected,
  computeComingUp,
  computeFeesSnapshot,
  computeNeedsAttention,
  computeOpenWorkByPerson,
  computePendingByClient,
  computeRecurringSummary,
  formatPaise,
  type FeesState,
  type MetricTile,
} from './dashboard-metrics';

export function DashboardMetricStrip({ tiles }: { tiles: readonly MetricTile[] }) {
  return (
    <section className="metric-strip" aria-label="Operational summary">
      {tiles.map((tile) => (
        <article className={`metric-card tone-${tile.tone}`} key={tile.label}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small>{tile.note}</small>
        </article>
      ))}
    </section>
  );
}

/** What a fee card shows instead of figures while fees are loading or failed; null when ready. */
function FeesNotice({ feesState, onRetry }: { feesState: FeesState; onRetry?: () => void }) {
  if (feesState === 'loading') return <p className="dashboard-empty" role="status">Loading fees…</p>;
  if (feesState === 'error') {
    return (
      <div className="dashboard-empty" role="alert">
        <p>Fees could not be loaded.</p>
        {onRetry ? (
          <button className="soft-button" type="button" onClick={onRetry}>Retry</button>
        ) : null}
      </div>
    );
  }
  return null;
}

export function ComingUpCard({ assignments, today }: { assignments: readonly AssignmentRow[]; today: string }) {
  const { items, openCount } = computeComingUp(assignments, today);
  return (
    <Card
      title="Coming up"
      description="Open assignments by due date"
      action={<CalendarClock aria-hidden="true" />}
      className="compact-card"
    >
      {items.length === 0 ? (
        <p className="dashboard-empty">
          {openCount > 0 ? 'Nothing due. All open work is scheduled.' : 'No open assignments.'}
        </p>
      ) : (
        <div className="deadline-list">
          {items.map((item) => (
            <div className="deadline-row" key={item.id}>
              <span className="deadline-date"><strong>{item.dateLabel}</strong></span>
              <span><strong>{item.title}</strong><small>{item.client}</small></span>
              <Status tone={item.tone}>{item.chip}</Status>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function OpenWorkByPersonCard({
  assignments,
  members,
}: {
  assignments: readonly AssignmentRow[];
  /** People who always get a row, such as a department's members. */
  members?: readonly { id: string; name: string }[];
}) {
  const people = computeOpenWorkByPerson(assignments, undefined, members);
  return (
    <Card
      title="Open work by person"
      description="Open assignments each person owns"
      action={<UsersRound aria-hidden="true" />}
      className="compact-card"
    >
      {people.length === 0 ? (
        <p className="dashboard-empty">No open assignments.</p>
      ) : (
        <div className="capacity-list">
          {people.map((person) => (
            <div className="capacity-row" key={person.key}>
              <span><strong>{person.name}</strong></span>
              <span className="capacity-value">{person.open} open</span>
              <i><b style={{ width: `${person.widthPercent}%` }} /></i>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function RecurringSchedulesCard({ schedules }: { schedules: readonly RecurringScheduleRecord[] }) {
  const summary = computeRecurringSummary(schedules);
  return (
    <Card
      title="Recurring schedules"
      description="Automatic monthly and periodic work"
      action={<Repeat2 aria-hidden="true" />}
      className="compact-card"
    >
      {summary.total === 0 ? (
        <p className="dashboard-empty">No recurring schedules yet.</p>
      ) : (
        <>
          <div className="exception-summary">
            <strong>{summary.active}</strong>
            <span>active · {summary.paused} paused</span>
          </div>
          <div className="mini-list">
            {summary.categories.map((item) => (
              <span key={item.category}><i className="dot-default" />{item.category} <b>{item.active}</b></span>
            ))}
          </div>
          {summary.next ? (
            <div className="collection-progress">
              <span>Next due {summary.next.dueDisplay} · {summary.next.title}</span>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function BilledAndCollectedCard({
  invoices,
  receipts,
  today,
  feesState,
  onRetry,
}: {
  invoices: readonly InvoiceRecord[];
  receipts: readonly ReceiptRecord[];
  today: string;
  feesState: FeesState;
  onRetry?: () => void;
}) {
  const data = computeBilledAndCollected(invoices, receipts, today);
  const largest = data.months.reduce((max, m) => Math.max(max, m.billedPaise, m.collectedPaise), 0);
  const height = (paise: number) => (largest > 0 ? (paise / largest) * 100 : 0);
  return (
    <Card
      title="Billed and collected"
      description={`This financial year · ${data.financialYear.label}`}
      className="chart-card"
    >
      {feesState !== 'ready' ? (
        <FeesNotice feesState={feesState} onRetry={onRetry} />
      ) : data.billCount === 0 ? (
        <p className="dashboard-empty">No bills recorded this financial year.</p>
      ) : (
        <>
          <div className="chart-summary">
            <div><span>Billed</span><strong>{formatPaise(data.billedPaise)}</strong></div>
            <div><span>Collected</span><strong>{formatPaise(data.collectedPaise)}</strong></div>
          </div>
          <div className="fee-bars" role="group" aria-label="Billed and collected by month this financial year">
            {data.months.map((month) => (
              <div className="fee-bars-month" key={month.label}>
                <span className="sr-only">
                  {month.label}: billed {formatPaise(month.billedPaise)}, collected {formatPaise(month.collectedPaise)}
                </span>
                <div className="fee-bars-pair" aria-hidden="true">
                  <i className="fee-bar is-billed" style={{ height: `${height(month.billedPaise)}%` }} />
                  <i className="fee-bar is-collected" style={{ height: `${height(month.collectedPaise)}%` }} />
                </div>
                <span className="fee-bars-label" aria-hidden="true">{month.label}</span>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span><i className="legend-primary" />Billed</span>
            <span><i className="legend-gold" />Collected</span>
          </div>
        </>
      )}
    </Card>
  );
}

export function FeesSnapshotCard({
  invoices,
  receipts,
  today,
  feesState,
  onRetry,
}: {
  invoices: readonly InvoiceRecord[];
  receipts: readonly ReceiptRecord[];
  today: string;
  feesState: FeesState;
  onRetry?: () => void;
}) {
  const snapshot = computeFeesSnapshot(invoices, receipts, today);
  const overdue = snapshot.overduePaise > 0;
  const items: Array<[string, string, string, boolean]> = [
    ['Billed this month', formatPaise(snapshot.billedThisMonthPaise), `${snapshot.billsThisMonth} ${snapshot.billsThisMonth === 1 ? 'bill' : 'bills'}`, false],
    ['Collected this month', formatPaise(snapshot.collectedThisMonthPaise), `${snapshot.paymentsThisMonth} ${snapshot.paymentsThisMonth === 1 ? 'payment' : 'payments'}`, false],
    ['Pending', formatPaise(snapshot.pendingPaise), `${snapshot.pendingClients} ${snapshot.pendingClients === 1 ? 'client' : 'clients'}`, false],
    [
      'Overdue',
      formatPaise(snapshot.overduePaise),
      overdue ? `oldest ${snapshot.oldestOverdueDays} ${snapshot.oldestOverdueDays === 1 ? 'day' : 'days'}` : 'None overdue',
      overdue,
    ],
  ];
  return (
    <Card
      title="Fees snapshot"
      description="Current month and overall position"
      className="snapshot-card"
    >
      {feesState !== 'ready' ? (
        <FeesNotice feesState={feesState} onRetry={onRetry} />
      ) : (
        <>
          <div className="snapshot-grid">
            {items.map(([label, value, note, danger]) => (
              <article className={danger ? 'snapshot-item is-danger' : 'snapshot-item'} key={label}>
                <span>{label}</span><strong>{value}</strong><small>{note}</small>
              </article>
            ))}
          </div>
          {snapshot.collectedPercent !== null ? (
            <div className="collection-progress">
              <span><strong>{snapshot.collectedPercent}%</strong> of fees billed this year collected</span>
              <i><b style={{ width: `${snapshot.collectedPercent}%` }} /></i>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function monogram(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('');
}

export function PendingByClientCard({
  invoices,
  feesState,
  compact = false,
  onRetry,
  onNavigate,
}: {
  invoices: readonly InvoiceRecord[];
  feesState: FeesState;
  compact?: boolean;
  onRetry?: () => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const pending = computePendingByClient(invoices);
  return (
    <Card
      title="Pending by client"
      description="Largest pending fees first"
      className={compact ? 'outstanding-card is-compact' : 'outstanding-card'}
    >
      {feesState !== 'ready' ? (
        <FeesNotice feesState={feesState} onRetry={onRetry} />
      ) : pending.clients.length === 0 ? (
        <p className="dashboard-empty">Nothing pending. All bills are paid.</p>
      ) : (
        <>
          <div className="outstanding-total">
            <span>Total pending</span>
            <strong>{formatPaise(pending.totalPaise)}</strong>
            <small>{formatPaise(pending.overduePaise)} overdue</small>
          </div>
          <div className="list-stack">
            {pending.clients.slice(0, compact ? 3 : 4).map((client) => (
              <button
                className="list-row"
                type="button"
                key={client.clientId}
                onClick={() => onNavigate?.('Billing & Collections')}
              >
                <span className="client-monogram" aria-hidden="true">{monogram(client.clientName)}</span>
                <span>
                  <strong>{client.clientName}</strong>
                  <small>{client.overdueDays > 0 ? `${client.overdueDays} ${client.overdueDays === 1 ? 'day' : 'days'} overdue` : 'Not yet due'}</small>
                </span>
                <span className={client.overdueDays > 0 ? 'amount tone-danger' : 'amount'}>
                  {formatPaise(client.pendingPaise)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function NeedsAttentionCard({
  assignments,
  invoices,
  today,
  feesState,
  onRetry,
}: {
  assignments: readonly AssignmentRow[];
  invoices: readonly InvoiceRecord[];
  today: string;
  feesState: FeesState;
  onRetry?: () => void;
}) {
  const { all } = computeNeedsAttention(assignments, invoices, today);
  return (
    <Card
      title="Needs attention"
      description="Overdue work, returned work and overdue fees"
      action={<ShieldCheck aria-hidden="true" />}
      className="triage-card"
    >
      <div className="triage-lead">
        <span>
          <strong>{all.length > 0 ? `${all.length} ${all.length === 1 ? 'item needs' : 'items need'} attention.` : 'Nothing needs attention right now.'}</strong>
        </span>
      </div>
      <div className="triage-list">
        {all.slice(0, 6).map((item) => (
          <div className="triage-row" key={item.key}>
            <span className={`signal-icon tone-${item.tone}`}><Activity aria-hidden="true" /></span>
            <span><strong>{`${item.title} · ${item.detail}`}</strong></span>
            <Status tone={item.tone}>{item.chip}</Status>
          </div>
        ))}
      </div>
      {feesState === 'error' ? <FeesNotice feesState={feesState} onRetry={onRetry} /> : null}
    </Card>
  );
}
