import { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ShieldCheck, UsersRound } from 'lucide-react';
import type { PracticeReportDto, ReportPeriodDto, ReportPeriodKind } from '@sn/contracts';
import type { CompanyRole } from '@sn/domain';
import { useReports } from '../../api/use-reports';
import type { ReportsPort } from '../../api/reports-types';
import { MESSAGE_PURPOSE_LABELS } from '../../api/messages-types';
import { DOCUMENT_CATEGORY_LABELS } from '../../api/documents-types';
import { ROLE_LABELS, formatINR } from '../../data';
import { Card } from '../../ui/workspace-primitives';
import {
  buildCsv,
  csvFileName,
  downloadCsv,
  formatCsvDate,
  formatCsvRupees,
  type CsvCell,
} from './csv';

export interface ReportsWorkspaceProps {
  role: CompanyRole;
  /** The reports source; the live API when omitted. */
  port?: ReportsPort;
  /** Today's date in Kolkata (YYYY-MM-DD); read from the clock when omitted. */
  today?: string;
}

type ReportTab = 'work' | 'team' | 'fees' | 'followups';

const PERIOD_KINDS: ReadonlyArray<{ kind: ReportPeriodKind; label: string }> = [
  { kind: 'day', label: 'Day' },
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
];

const NOW_NOTE = 'Open, overdue, pending and credit figures are as of now.';
const STAFF_NOTE = 'Showing your own work and the clients you look after.';
const EMPTY_TABLE = 'Nothing in this period.';

// ---------------------------------------------------------------------------
// Calendar helpers (Asia/Kolkata dates as YYYY-MM-DD, no time zones involved)
// ---------------------------------------------------------------------------

const kolkataDateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function kolkataToday(): string {
  return kolkataDateParts.format(new Date());
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}

/** The first date of the day, Monday-to-Sunday week or month that holds the date. */
function periodStart(kind: ReportPeriodKind, date: string): string {
  if (kind === 'day') return date;
  if (kind === 'month') return `${date.slice(0, 7)}-01`;
  const weekday = new Date(Date.parse(`${date}T00:00:00.000Z`)).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** The first date of the period before (-1) or after (1) the one that holds the date. */
function shiftPeriod(kind: ReportPeriodKind, date: string, direction: 1 | -1): string {
  const start = periodStart(kind, date);
  if (kind === 'day') return addDays(start, direction);
  if (kind === 'week') return addDays(start, 7 * direction);
  const year = Number.parseInt(start.slice(0, 4), 10);
  const month = Number.parseInt(start.slice(5, 7), 10) - 1 + direction;
  const shifted = new Date(Date.UTC(year, month, 1));
  return shifted.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

interface Column<Row> {
  readonly header: string;
  readonly numeric?: boolean;
  /** What the table shows. */
  readonly cell: (row: Row) => string;
  /** What the CSV file holds; the on-screen header is the CSV header. */
  readonly csv: (row: Row) => CsvCell;
}

const money = (paise: number): string => formatINR(paise / 100);

function textColumn<Row>(header: string, pick: (row: Row) => string): Column<Row> {
  return { header, cell: pick, csv: pick };
}

function countColumn<Row>(header: string, pick: (row: Row) => number): Column<Row> {
  return { header, numeric: true, cell: (row) => String(pick(row)), csv: pick };
}

function moneyColumn<Row>(header: string, pick: (row: Row) => number): Column<Row> {
  return { header, numeric: true, cell: (row) => money(pick(row)), csv: (row) => formatCsvRupees(pick(row)) };
}

function dateColumn<Row>(header: string, pick: (row: Row) => string): Column<Row> {
  return { header, cell: (row) => formatCsvDate(pick(row)), csv: (row) => formatCsvDate(pick(row)) };
}

const rightAligned = { textAlign: 'right' } as const;

function ReportTable<Row>({
  title,
  description,
  columns,
  rows,
  period,
  csvReport,
  csvTable,
}: {
  title: string;
  description?: string;
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  period: ReportPeriodDto;
  /** The report and table names that make up the downloaded file's name. */
  csvReport: string;
  csvTable: string;
}) {
  const headingId = `report-${csvReport}-${csvTable}`;
  const download = () =>
    downloadCsv(
      csvFileName(csvReport, csvTable, period),
      buildCsv(
        columns.map((column) => column.header),
        rows.map((row) => columns.map((column) => column.csv(row))),
      ),
    );

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card-header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        <button className="soft-button" type="button" aria-describedby={headingId} onClick={download}>
          <Download aria-hidden="true" /> Download CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="dashboard-empty">{EMPTY_TABLE}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.header} style={column.numeric ? rightAligned : undefined}>
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.header} style={column.numeric ? rightAligned : undefined}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Metric tiles
// ---------------------------------------------------------------------------

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly tone?: 'danger' | 'warning';
}

const IN_PERIOD = 'In this period';
const AS_OF_NOW = 'As of now';

function MetricTiles({ label, tiles }: { label: string; tiles: readonly Tile[] }) {
  return (
    <section
      className="metric-strip"
      aria-label={label}
      style={tiles.length === 5 ? { gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' } : undefined}
    >
      {tiles.map((tile) => (
        <article className={`metric-card${tile.tone ? ` tone-${tile.tone}` : ''}`} key={tile.label}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small>{tile.note}</small>
        </article>
      ))}
    </section>
  );
}

const sum = <Row,>(rows: readonly Row[], pick: (row: Row) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0);

// ---------------------------------------------------------------------------
// The four reports
// ---------------------------------------------------------------------------

type WorkRows = PracticeReportDto['workProgress'];

const SLA_NOTE = "Turnaround against each service's usual turnaround, in working days.";

function WorkProgressReport({ work, period }: { work: WorkRows; period: ReportPeriodDto }) {
  const { summary, sla } = work;
  type SlaServiceRow = WorkRows['sla']['byService'][number];
  type SlaOwnerRow = WorkRows['sla']['byOwner'][number];
  const countsColumns = <Row extends { created: number; completed: number; openNow: number; overdueNow: number }>() => [
    countColumn<Row>('Created', (row) => row.created),
    countColumn<Row>('Completed', (row) => row.completed),
    countColumn<Row>('Open now', (row) => row.openNow),
    countColumn<Row>('Overdue now', (row) => row.overdueNow),
  ];
  return (
    <div className="dashboard-stack">
      <MetricTiles
        label="Work progress summary"
        tiles={[
          { label: 'Created', value: String(summary.created), note: IN_PERIOD },
          { label: 'Completed', value: String(summary.completed), note: IN_PERIOD },
          { label: 'Submitted for review', value: String(summary.submittedForReview), note: IN_PERIOD },
          { label: 'Overdue now', value: String(summary.overdueNow), note: AS_OF_NOW, ...(summary.overdueNow > 0 ? { tone: 'danger' as const } : {}) },
          { label: 'Due in the next 7 days', value: String(summary.dueNext7Days), note: AS_OF_NOW },
        ]}
      />
      <ReportTable
        title="By service"
        columns={[
          textColumn<WorkRows['byService'][number]>('Service', (row) => row.serviceName),
          ...countsColumns<WorkRows['byService'][number]>(),
        ]}
        rows={work.byService}
        period={period}
        csvReport="work"
        csvTable="by-service"
      />
      <ReportTable
        title="By person"
        columns={[
          textColumn<WorkRows['byOwner'][number]>('Person', (row) => row.ownerName),
          ...countsColumns<WorkRows['byOwner'][number]>(),
        ]}
        rows={work.byOwner}
        period={period}
        csvReport="work"
        csvTable="by-person"
      />
      <ReportTable
        title="Overdue assignments"
        description="The 25 most overdue, as of now."
        columns={[
          textColumn<WorkRows['overdueList'][number]>('Assignment', (row) => row.assignmentCode),
          textColumn<WorkRows['overdueList'][number]>('Title', (row) => row.title),
          textColumn<WorkRows['overdueList'][number]>('Client', (row) => row.clientName),
          textColumn<WorkRows['overdueList'][number]>('Owner', (row) => row.ownerName),
          dateColumn<WorkRows['overdueList'][number]>('Due date', (row) => row.dueDate),
          countColumn<WorkRows['overdueList'][number]>('Days overdue', (row) => row.daysOverdue),
        ]}
        rows={work.overdueList}
        period={period}
        csvReport="work"
        csvTable="overdue-assignments"
      />
      <MetricTiles
        label="SLA summary"
        tiles={[
          { label: 'Met in period', value: String(sla.summary.metInPeriod), note: IN_PERIOD },
          { label: 'Late in period', value: String(sla.summary.lateInPeriod), note: IN_PERIOD },
          { label: 'At risk now', value: String(sla.summary.atRiskNow), note: AS_OF_NOW, ...(sla.summary.atRiskNow > 0 ? { tone: 'warning' as const } : {}) },
          { label: 'Breached now', value: String(sla.summary.breachedNow), note: AS_OF_NOW, ...(sla.summary.breachedNow > 0 ? { tone: 'danger' as const } : {}) },
        ]}
      />
      <ReportTable
        title="SLA by service"
        description={SLA_NOTE}
        columns={[
          textColumn<SlaServiceRow>('Service', (row) => row.serviceName),
          {
            header: 'Target (working days)',
            numeric: true,
            cell: (row: SlaServiceRow) => (row.targetDays === null ? '—' : String(row.targetDays)),
            csv: (row: SlaServiceRow) => row.targetDays,
          },
          countColumn<SlaServiceRow>('Met', (row) => row.met),
          countColumn<SlaServiceRow>('Late', (row) => row.late),
          countColumn<SlaServiceRow>('At risk now', (row) => row.atRiskNow),
          countColumn<SlaServiceRow>('Breached now', (row) => row.breachedNow),
        ]}
        rows={sla.byService}
        period={period}
        csvReport="work"
        csvTable="sla-by-service"
      />
      <ReportTable
        title="SLA by person"
        description={SLA_NOTE}
        columns={[
          textColumn<SlaOwnerRow>('Person', (row) => row.ownerName),
          countColumn<SlaOwnerRow>('Met', (row) => row.met),
          countColumn<SlaOwnerRow>('Late', (row) => row.late),
          countColumn<SlaOwnerRow>('At risk now', (row) => row.atRiskNow),
          countColumn<SlaOwnerRow>('Breached now', (row) => row.breachedNow),
        ]}
        rows={sla.byOwner}
        period={period}
        csvReport="work"
        csvTable="sla-by-person"
      />
    </div>
  );
}

function TeamActivityReport({ rows, period }: { rows: PracticeReportDto['teamActivity']; period: ReportPeriodDto }) {
  type Row = PracticeReportDto['teamActivity'][number];
  return (
    <div className="dashboard-stack">
      <MetricTiles
        label="Team activity summary"
        tiles={[
          { label: 'Assignments completed', value: String(sum(rows, (row) => row.assignmentsCompleted)), note: IN_PERIOD },
          { label: 'Submitted for review', value: String(sum(rows, (row) => row.submittedForReview)), note: IN_PERIOD },
          { label: 'Tasks completed', value: String(sum(rows, (row) => row.tasksCompleted)), note: IN_PERIOD },
          { label: 'Reviews done', value: String(sum(rows, (row) => row.reviewsDone)), note: IN_PERIOD },
        ]}
      />
      <ReportTable
        title="Team activity"
        columns={[
          textColumn<Row>('Name', (row) => row.name),
          textColumn<Row>('Role', (row) => ROLE_LABELS[row.role]),
          countColumn<Row>('Assignments completed', (row) => row.assignmentsCompleted),
          countColumn<Row>('Submitted for review', (row) => row.submittedForReview),
          countColumn<Row>('Tasks completed', (row) => row.tasksCompleted),
          countColumn<Row>('Tasks open', (row) => row.tasksOpen),
          countColumn<Row>('Tasks overdue', (row) => row.tasksOverdue),
          countColumn<Row>('Reviews done', (row) => row.reviewsDone),
        ]}
        rows={rows}
        period={period}
        csvReport="team"
        csvTable="activity"
      />
    </div>
  );
}

function FeesReport({ fees, period }: { fees: NonNullable<PracticeReportDto['fees']>; period: ReportPeriodDto }) {
  type Row = NonNullable<PracticeReportDto['fees']>['byClient'][number];
  const { summary } = fees;
  return (
    <div className="dashboard-stack">
      <MetricTiles
        label="Fees and collections summary"
        tiles={[
          { label: 'Bills recorded', value: String(summary.billsRecorded), note: IN_PERIOD },
          { label: 'Billed', value: money(summary.billedPaise), note: IN_PERIOD },
          { label: 'Payments received', value: String(summary.paymentsReceived), note: IN_PERIOD },
          { label: 'Received', value: money(summary.receivedPaise), note: IN_PERIOD },
          { label: 'Pending now', value: money(summary.pendingNowPaise), note: AS_OF_NOW },
          { label: 'Overdue now', value: money(summary.overdueNowPaise), note: AS_OF_NOW, ...(summary.overdueNowPaise > 0 ? { tone: 'danger' as const } : {}) },
          { label: 'Credit held', value: money(summary.creditHeldPaise), note: AS_OF_NOW },
        ]}
      />
      <ReportTable
        title="By client"
        columns={[
          textColumn<Row>('Code', (row) => row.clientCode),
          textColumn<Row>('Client', (row) => row.clientName),
          moneyColumn<Row>('Billed', (row) => row.billedPaise),
          moneyColumn<Row>('Received', (row) => row.receivedPaise),
          moneyColumn<Row>('Pending now', (row) => row.pendingNowPaise),
          moneyColumn<Row>('Overdue now', (row) => row.overdueNowPaise),
          moneyColumn<Row>('Credit held', (row) => row.creditPaise),
        ]}
        rows={fees.byClient}
        period={period}
        csvReport="fees"
        csvTable="by-client"
      />
    </div>
  );
}

function FollowUpsReport({ followUps, period }: { followUps: PracticeReportDto['followUps']; period: ReportPeriodDto }) {
  type MessageRow = PracticeReportDto['followUps']['messagesByPurpose'][number];
  type DocumentRow = PracticeReportDto['followUps']['documentsByCategory'][number];
  type ClientRow = PracticeReportDto['followUps']['needsFollowUp'][number];
  return (
    <div className="dashboard-stack">
      <MetricTiles
        label="Client follow-ups summary"
        tiles={[
          { label: 'Messages sent', value: String(sum(followUps.messagesByPurpose, (row) => row.count)), note: IN_PERIOD },
          { label: 'Documents added', value: String(sum(followUps.documentsByCategory, (row) => row.count)), note: IN_PERIOD },
          {
            label: 'Clients needing follow-up',
            value: String(followUps.needsFollowUp.length),
            note: AS_OF_NOW,
            ...(followUps.needsFollowUp.length > 0 ? { tone: 'warning' as const } : {}),
          },
        ]}
      />
      <ReportTable
        title="Messages by purpose"
        columns={[
          textColumn<MessageRow>('Purpose', (row) => MESSAGE_PURPOSE_LABELS[row.purpose]),
          countColumn<MessageRow>('Messages', (row) => row.count),
        ]}
        rows={followUps.messagesByPurpose}
        period={period}
        csvReport="followups"
        csvTable="messages-by-purpose"
      />
      <ReportTable
        title="Documents by category"
        columns={[
          textColumn<DocumentRow>('Category', (row) => DOCUMENT_CATEGORY_LABELS[row.category]),
          countColumn<DocumentRow>('Documents', (row) => row.count),
        ]}
        rows={followUps.documentsByCategory}
        period={period}
        csvReport="followups"
        csvTable="documents-by-category"
      />
      <ReportTable
        title="Clients needing follow-up"
        description="Overdue work or fees, and no WhatsApp message in the last 14 days."
        columns={[
          textColumn<ClientRow>('Code', (row) => row.clientCode),
          textColumn<ClientRow>('Client', (row) => row.clientName),
          countColumn<ClientRow>('Overdue assignments', (row) => row.overdueAssignments),
          moneyColumn<ClientRow>('Overdue fees', (row) => row.overdueFeesPaise),
          textColumn<ClientRow>('Last message', (row) => (row.lastMessageAt ? formatCsvDate(row.lastMessageAt) : 'Never')),
        ]}
        rows={followUps.needsFollowUp}
        period={period}
        csvReport="followups"
        csvTable="clients-needing-follow-up"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function ReportsWorkspace({ role, port, today: todayOverride }: ReportsWorkspaceProps) {
  const [today] = useState(() => todayOverride ?? kolkataToday());
  const [kind, setKind] = useState<ReportPeriodKind>('week');
  const [date, setDate] = useState(today);
  const [tab, setTab] = useState<ReportTab>('work');
  const { report, loading, error, retry } = useReports(role, { period: kind, date, ...(port ? { port } : {}) });

  if (role === 'trainee') {
    return (
      <Card title="Reports are restricted">
        <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
          <ShieldCheck size={48} color="var(--brand)" style={{ margin: '0 auto 16px', opacity: 0.7 }} />
          <p style={{ maxWidth: 460, margin: '0 auto', fontSize: 13, lineHeight: 1.6 }}>
            Reports are available to the Founder, the Manager, Senior Staff and Staff.
          </p>
        </div>
      </Card>
    );
  }

  const ownWorkOnly = role === 'senior_staff' || role === 'staff';
  const nextStart = shiftPeriod(kind, date, 1);
  const hasFees = report?.fees != null;
  // The Fees tab is hidden when the report has no fees section; a tab that disappeared falls back to Work progress.
  const activeTab: ReportTab = tab === 'fees' && !hasFees ? 'work' : tab;

  const tabs: ReadonlyArray<{ key: ReportTab; label: string }> = [
    { key: 'work', label: 'Work progress' },
    { key: 'team', label: 'Team activity' },
    ...(hasFees ? [{ key: 'fees' as const, label: 'Fees and collections' }] : []),
    { key: 'followups', label: 'Client follow-ups' },
  ];

  const chooseDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setDate(value > today ? today : value);
  };

  return (
    <div className="dashboard-stack">
      <section
        className="client-toolbar"
        aria-label="Report period"
        style={{ flexWrap: 'wrap', justifyContent: 'flex-start', gap: 16 }}
      >
        <div className="segmented" role="group" aria-label="Period">
          {PERIOD_KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              className={kind === option.kind ? 'is-active' : undefined}
              aria-pressed={kind === option.kind}
              onClick={() => setKind(option.kind)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          className="client-select"
          type="date"
          aria-label="Report date"
          value={date}
          max={today}
          onChange={(event) => chooseDate(event.target.value)}
          style={{ backgroundImage: 'none', paddingRight: 12 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="soft-button" type="button" onClick={() => setDate(shiftPeriod(kind, date, -1))}>
            <ChevronLeft aria-hidden="true" /> Previous
          </button>
          <button
            className="soft-button"
            type="button"
            disabled={nextStart > today}
            onClick={() => setDate(nextStart)}
          >
            Next <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <strong aria-live="polite" style={{ color: 'var(--ink-strong)', fontSize: 14 }}>
          {report ? report.period.label : 'Loading…'}
        </strong>
      </section>

      <p className="dashboard-empty" style={{ margin: 0 }}>
        {NOW_NOTE}
      </p>

      {ownWorkOnly ? (
        <div className="staff-scope-bar">
          <div className="staff-scope-info">
            <UsersRound size={16} />
            <span>{STAFF_NOTE}</span>
          </div>
        </div>
      ) : null}

      {error ? (
        <Card title="Report">
          <div className="workspace-error-card" role="alert">
            <h3>Unable to load the report</h3>
            <p>{error.message}</p>
            <button className="primary-button" type="button" onClick={retry}>
              Retry
            </button>
          </div>
        </Card>
      ) : loading || report === null ? (
        <div aria-busy="true" aria-label="Loading report">
          {[1, 2, 3, 4].map((x) => (
            <div className="skeleton-row engagement-skeleton-row" key={x}>
              <span className="skeleton-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="work-mode-switcher" role="tablist" aria-label="Reports">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                id={`reports-tab-${item.key}`}
                aria-selected={activeTab === item.key}
                aria-controls="reports-panel"
                className={`work-tab-btn ${activeTab === item.key ? 'is-active' : ''}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div id="reports-panel" role="tabpanel" aria-labelledby={`reports-tab-${activeTab}`}>
            {activeTab === 'work' ? <WorkProgressReport work={report.workProgress} period={report.period} /> : null}
            {activeTab === 'team' ? <TeamActivityReport rows={report.teamActivity} period={report.period} /> : null}
            {activeTab === 'fees' && report.fees ? <FeesReport fees={report.fees} period={report.period} /> : null}
            {activeTab === 'followups' ? <FollowUpsReport followUps={report.followUps} period={report.period} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
