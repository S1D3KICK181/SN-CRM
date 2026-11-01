import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileClock,
  FileStack,
  FileText,
  Files,
  IndianRupee,
  ListChecks,
  Lock,
  MessageSquareText,
  Pencil,
  Plus,
  ReceiptIndianRupee,
  Repeat2,
  ShieldCheck,
  TrendingUp,
  UserRoundCheck,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { authorize, type CompanyRole } from '@sn/domain';
import { ApplicationChrome } from './shell/application-chrome';
import { MODULE_DESCRIPTIONS, type PageKey } from './shell/navigation';
import { Card, Field, MoreButton, Status } from './ui/workspace-primitives';
import { ClientsWorkspace } from './workspaces/clients/clients-workspace';
import { BillingWorkspace } from './workspaces/billing/billing-workspace';
import { AssignmentsTable } from './workspaces/assignments/assignments-table';
import { AssignmentsWorkspace } from './workspaces/assignments/assignments-workspace';
import {
  ASSIGNMENTS,
  CLIENTS,
  CLIENT_OUTSTANDING,
  DELEGATED_TASKS,
  INVOICES,
  PERSONAL_TASKS,
  RECEIPTS,
  RECURRING_SCHEDULES,
  ROLE_COPY,
  ROLE_LABELS,
  ROLE_PEOPLE,
  formatINR,
  type AssignmentMilestone,
  type AssignmentRow,
  type AssignmentTone,
  type ClientRecord,
  type ClientType,
  type DelegatedTaskRecord,
  type InvoiceRecord,
  type InvoiceStatus,
  type PaymentMode,
  type PersonalTaskRecord,
  type ReceiptRecord,
  type RecurringScheduleRecord,
  type ScheduleCategory,
  type ScheduleCadence,
} from './data';

type DialogMode = 'assignment' | 'personal' | 'delegated' | 'client' | 'schedule' | 'invoice' | 'receipt' | null;

export function App() {
  const [role, setRole] = useState<CompanyRole>('founder');
  const [activePage, setActivePage] = useState<PageKey>('Dashboard');
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<RecurringScheduleRecord[]>(RECURRING_SCHEDULES);
  const [assignments, setAssignments] = useState<AssignmentRow[]>(ASSIGNMENTS);
  const [personalTasks, setPersonalTasks] = useState<PersonalTaskRecord[]>(PERSONAL_TASKS);
  const [delegatedTasks, setDelegatedTasks] = useState<DelegatedTaskRecord[]>(DELEGATED_TASKS);
  const [selectedAssignmentForDrawer, setSelectedAssignmentForDrawer] = useState<AssignmentRow | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>(INVOICES);
  const [receipts, setReceipts] = useState<ReceiptRecord[]>(RECEIPTS);
  const [clients, setClients] = useState<ClientRecord[]>(CLIENTS);
  const [presetInvoiceForReceipt, setPresetInvoiceForReceipt] = useState<InvoiceRecord | null>(null);
  const [presetAssignmentForInvoice, setPresetAssignmentForInvoice] = useState<AssignmentRow | null>(null);

  const person = ROLE_PEOPLE[role];
  const actor = useMemo(() => ({ id: person.id, role }), [person.id, role]);
  const canCreateAssignment = authorize({ action: 'assignment.create', actor }).allowed;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function switchRole(nextRole: CompanyRole) {
    setRole(nextRole);
    setActivePage('Dashboard');
    setToast(`Preview switched to ${ROLE_LABELS[nextRole]}`);
  }

  function openPrimaryAction() {
    setDialog(canCreateAssignment ? 'assignment' : 'personal');
  }

  function handleUpdateSchedule(updated: RecurringScheduleRecord) {
    setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setToast(`Updated ${updated.title} (${updated.clientName})`);
  }

  function handleCreateAssignment(newAssignment: AssignmentRow) {
    setAssignments((prev) => [newAssignment, ...prev]);
    setToast(`Assignment ${newAssignment.id} (${newAssignment.title}) created`);
  }

  function handleUpdateAssignment(updated: AssignmentRow) {
    setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    if (selectedAssignmentForDrawer?.id === updated.id) {
      setSelectedAssignmentForDrawer(updated);
    }
    setToast(`Updated ${updated.id} (${updated.title})`);
  }

  function handleUpdateClient(updated: ClientRecord) {
    setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setSchedules((prev) =>
      prev.map((s) => {
        if (s.clientId === updated.id) {
          const nextBankRec = updated.bankStatementRequired === false
            ? 'Not applicable'
            : (s.bankRecStatus === 'Not applicable' ? 'Awaited' : s.bankRecStatus);
          return {
            ...s,
            defaultOwner: updated.primaryOwner,
            clientName: updated.name,
            bankRecStatus: nextBankRec,
          };
        }
        return s;
      })
    );
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.clientId === updated.id || a.client.toLowerCase() === updated.name.toLowerCase() || a.client.toLowerCase() === updated.tradeName.toLowerCase()) {
          return {
            ...a,
            bankStatementRequired: updated.bankStatementRequired,
            bankRecStatus: updated.bankStatementRequired === false ? 'Not applicable' : a.bankRecStatus,
          };
        }
        return a;
      })
    );
    setToast(`Client details updated for ${updated.name}`);
  }

  function handleCreatePersonalTask(newTask: PersonalTaskRecord) {
    setPersonalTasks((prev) => [newTask, ...prev]);
    setToast(`Personal task scheduled`);
  }

  function handleTogglePersonalTask(taskId: string) {
    setPersonalTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t))
    );
  }

  function handleDelegateTask(newTask: DelegatedTaskRecord) {
    setDelegatedTasks((prev) => [newTask, ...prev]);
    setToast(`Subtask delegated to ${newTask.person}`);
  }

  function handleUpdateDelegatedTask(updated: DelegatedTaskRecord) {
    setDelegatedTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setToast(`Updated task: ${updated.title}`);
  }

  function handleApproveDelegatedTask(task: DelegatedTaskRecord) {
    const updated: DelegatedTaskRecord = {
      ...task,
      status: 'Completed',
      progress: 100,
    };
    handleUpdateDelegatedTask(updated);
    setToast(`Approved ${task.title}`);
  }

  function handleSubmitTaskForReview(task: DelegatedTaskRecord) {
    const updated: DelegatedTaskRecord = {
      ...task,
      status: 'Pending Review',
      progress: 100,
    };
    handleUpdateDelegatedTask(updated);
    setToast(`Submitted ${task.title} for review`);
  }

  function handleOpenInvoiceForAssignment(asn: AssignmentRow) {
    setPresetAssignmentForInvoice(asn);
    setActivePage('Billing & Collections');
    setDialog('invoice');
  }

  function handleCreateClient(newClient: ClientRecord, selectedObligations: string[], assignedOwner: string) {
    setClients((prev) => [newClient, ...prev]);

    const newSchedules: RecurringScheduleRecord[] = [];
    const nextSchNum = schedules.length + 1;

    if (selectedObligations.includes('gst')) {
      if (newClient.gstScheme === 'Composition') {
        newSchedules.push({
          id: `SCH-000${nextSchNum}`,
          title: 'CMP-08 Quarterly',
          category: 'GST',
          clientId: newClient.id,
          clientName: newClient.name,
          cadence: 'Quarterly',
          generationDay: 1,
          statutoryDueDay: '18th of month following quarter',
          defaultOwner: assignedOwner,
          nextRunDate: '01/01/2027',
          nextDueDate: '18/01/2027',
          status: 'Active',
          bankRecStatus: 'Completed',
          currentStatus: 'Pending',
          checklistTemplate: [
            'Reconcile turnover and bank receipts for composition scheme',
            'Calculate flat 1% / 5% / 6% composition tax liability',
            'Generate Challan-cum-statement CMP-08 on GST portal',
            'Verify tax payment and download official filing acknowledgement',
          ],
          history: [],
        });
      } else if (newClient.gstScheme === 'QRMP') {
        newSchedules.push({
          id: `SCH-000${nextSchNum}`,
          title: 'GSTR-1 / IFF Quarterly',
          category: 'GST',
          clientId: newClient.id,
          clientName: newClient.name,
          cadence: 'Quarterly',
          generationDay: 1,
          statutoryDueDay: '13th of month following quarter',
          defaultOwner: assignedOwner,
          nextRunDate: '01/01/2027',
          nextDueDate: '13/01/2027',
          status: 'Active',
          bankRecStatus: 'Awaited',
          currentStatus: 'Pending',
          checklistTemplate: [
            'Reconcile monthly sales register with bank deposits',
            'Upload B2B invoices via Invoice Furnishing Facility (IFF) for Month 1 & 2',
            'Upload final quarterly GSTR-1 payload on portal',
          ],
          history: [],
        });
        newSchedules.push({
          id: `SCH-000${nextSchNum + 1}`,
          title: 'GSTR-3B Quarterly',
          category: 'GST',
          clientId: newClient.id,
          clientName: newClient.name,
          cadence: 'Quarterly',
          generationDay: 12,
          statutoryDueDay: '22nd/24th of month following quarter',
          defaultOwner: assignedOwner,
          nextRunDate: '12/01/2027',
          nextDueDate: '22/01/2027',
          status: 'Active',
          bankRecStatus: 'Awaited',
          currentStatus: 'Pending',
          checklistTemplate: [
            'Verify monthly PMT-06 challan payments for Month 1 & 2',
            'Download quarterly GSTR-2B and match ITC',
            'File quarterly GSTR-3B return with DSC / EVC',
          ],
          history: [],
        });
      } else {
        newSchedules.push({
          id: `SCH-000${nextSchNum}`,
          title: 'GSTR-1 Monthly',
          category: 'GST',
          clientId: newClient.id,
          clientName: newClient.name,
          cadence: 'Monthly',
          generationDay: 1,
          statutoryDueDay: '11th of every month',
          defaultOwner: assignedOwner,
          nextRunDate: '01/11/2026',
          nextDueDate: '11/11/2026',
          status: 'Active',
          bankRecStatus: 'Awaited',
          currentStatus: 'Pending',
          checklistTemplate: [
            'Obtain bank statements for the month (Required before GSTR-1 outward filing)',
            'Collect outward sales invoices and credit notes',
            'Validate HSN code classification and GST rates',
            'Upload JSON payload to GSTN portal and verify submission via DSC',
          ],
          history: [],
        });
        newSchedules.push({
          id: `SCH-000${nextSchNum + 1}`,
          title: 'GSTR-3B Monthly',
          category: 'GST',
          clientId: newClient.id,
          clientName: newClient.name,
          cadence: 'Monthly',
          generationDay: 12,
          statutoryDueDay: '20th of every month',
          defaultOwner: assignedOwner,
          nextRunDate: '12/11/2026',
          nextDueDate: '20/11/2026',
          status: 'Active',
          bankRecStatus: 'Awaited',
          currentStatus: 'Pending',
          checklistTemplate: [
            'Verify bank payments for GST Challan PMT-06',
            'Download auto-drafted GSTR-2B purchase register',
            'Reconcile eligible vs blocked Input Tax Credit (Rule 42/43)',
            'Calculate net cash tax payable after ITC ledger set-off',
            'File final GSTR-3B return with DSC / EVC',
          ],
          history: [],
        });
      }
    }

    if (selectedObligations.includes('tds')) {
      newSchedules.push({
        id: `SCH-000${nextSchNum + 2}`,
        title: 'Monthly TDS Deposit (Challan 281)',
        category: 'TDS',
        clientId: newClient.id,
        clientName: newClient.name,
        cadence: 'Monthly',
        generationDay: 1,
        statutoryDueDay: '07th of every month',
        defaultOwner: assignedOwner,
        nextRunDate: '01/11/2026',
        nextDueDate: '07/11/2026',
        status: 'Active',
        bankRecStatus: 'Not applicable',
        currentStatus: 'Pending',
        checklistTemplate: [
          'Collate 194C contractor & 194I rent deductions',
          'Verify PAN validity of deductees on Income Tax portal',
          'Generate e-tax payment Challan 281',
          'Archive BSR code and CIN receipt in document vault',
        ],
        history: [],
      });
    }

    if (selectedObligations.includes('bookkeeping')) {
      newSchedules.push({
        id: `SCH-000${nextSchNum + 3}`,
        title: 'Monthly Bank & Ledger Reconciliation',
        category: 'Bookkeeping',
        clientId: newClient.id,
        clientName: newClient.name,
        cadence: 'Monthly',
        generationDay: 2,
        statutoryDueDay: '30th of every month',
        defaultOwner: assignedOwner,
        nextRunDate: '02/11/2026',
        nextDueDate: '30/11/2026',
        status: 'Active',
        bankRecStatus: 'In progress',
        currentStatus: 'Docs Awaited',
        checklistTemplate: [
          'Import bank statements via CSV / Excel',
          'Match vendor disbursements and customer credits',
          'Resolve suspense and unmapped entries with client',
          'Prepare trial balance & ledger statement pack',
        ],
        history: [],
      });
    }

    if (newSchedules.length > 0) {
      setSchedules((prev) => [...prev, ...newSchedules]);
    }

    setToast(`Client ${newClient.name} onboarded with ${newSchedules.length} recurring schedules assigned to ${assignedOwner}`);
  }

  function handleCreateInvoice(newInvoice: InvoiceRecord) {
    setInvoices((prev) => [newInvoice, ...prev]);
    if (presetAssignmentForInvoice) {
      setAssignments((prev) =>
        prev.map((a) => (a.id === presetAssignmentForInvoice.id ? { ...a, billed: true } : a))
      );
      setPresetAssignmentForInvoice(null);
    }
    setToast(`Invoice ${newInvoice.invoiceNumber} raised for ${newInvoice.clientName}`);
  }

  function handleCreateReceipt(newReceipt: ReceiptRecord) {
    setReceipts((prev) => [newReceipt, ...prev]);

    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id === newReceipt.invoiceId) {
          const nextReceived = inv.amountReceived + newReceipt.amount;
          const nextBalance = Math.max(0, inv.total - nextReceived);
          const nextStatus: InvoiceStatus = nextBalance === 0 ? 'Paid' : 'Partially Paid';
          return {
            ...inv,
            amountReceived: nextReceived,
            balance: nextBalance,
            status: nextStatus,
          };
        }
        return inv;
      })
    );

    setClients((prev) =>
      prev.map((c) => {
        if (c.id === newReceipt.clientId) {
          const currentOut = parseInt(c.outstanding.replace(/[^0-9]/g, '') || '0', 10);
          const rem = Math.max(0, currentOut - newReceipt.amount);
          return {
            ...c,
            outstanding: formatINR(rem),
            outstandingTone: rem === 0 ? 'success' : rem > 50000 ? 'danger' : 'warning',
          };
        }
        return c;
      })
    );

    setToast(`Receipt ${newReceipt.receiptNumber} of ${formatINR(newReceipt.amount)} recorded for ${newReceipt.clientName}`);
  }

  function openReceiptModalForInvoice(inv: InvoiceRecord) {
    setPresetInvoiceForReceipt(inv);
    setDialog('receipt');
  }

  return (
    <ApplicationChrome
      role={role}
      activePage={activePage}
      toast={toast}
      onRoleChange={switchRole}
      onNavigate={setActivePage}
      onQuickAdd={openPrimaryAction}
      onToast={setToast}
      overlays={
        <>
          {selectedAssignmentForDrawer ? (
            <AssignmentDetailDrawer
              assignment={selectedAssignmentForDrawer}
              leadership={role === 'founder' || role === 'manager'}
              role={role}
              onClose={() => setSelectedAssignmentForDrawer(null)}
              onToast={setToast}
              onUpdateAssignment={handleUpdateAssignment}
              onOpenInvoice={handleOpenInvoiceForAssignment}
            />
          ) : null}
          <ComposerDialog
            mode={dialog}
            role={role}
            clients={clients}
            invoices={invoices}
            assignments={assignments}
            personalTasks={personalTasks}
            delegatedTasks={delegatedTasks}
            presetInvoice={presetInvoiceForReceipt}
            presetAssignment={presetAssignmentForInvoice}
            onClose={() => {
              setDialog(null);
              setPresetInvoiceForReceipt(null);
              setPresetAssignmentForInvoice(null);
            }}
            onCreated={setToast}
            onClientCreated={handleCreateClient}
            onInvoiceCreated={handleCreateInvoice}
            onReceiptCreated={handleCreateReceipt}
            onAssignmentCreated={handleCreateAssignment}
            onPersonalTaskCreated={handleCreatePersonalTask}
            onDelegatedTaskCreated={handleDelegateTask}
          />
        </>
      }
    >
      {activePage === 'Dashboard' ? (
        <RoleDashboard
          role={role}
          assignments={assignments}
          schedules={schedules}
          invoices={invoices}
          personalTasks={personalTasks}
          delegatedTasks={delegatedTasks}
          onCompose={setDialog}
          onToast={setToast}
          onSelectAssignment={setSelectedAssignmentForDrawer}
          onTogglePersonalTask={handleTogglePersonalTask}
          onUpdateDelegatedTask={handleUpdateDelegatedTask}
          onApproveDelegatedTask={handleApproveDelegatedTask}
          onSubmitTaskForReview={handleSubmitTaskForReview}
          onNavigate={setActivePage}
        />
      ) : (
        <ModuleWorkspace
          page={activePage}
          role={role}
          clients={clients}
          schedules={schedules}
          assignments={assignments}
          invoices={invoices}
          receipts={receipts}
          personalTasks={personalTasks}
          delegatedTasks={delegatedTasks}
          onCompose={setDialog}
          onToast={setToast}
          onUpdateSchedule={handleUpdateSchedule}
          onUpdateAssignment={handleUpdateAssignment}
          onSelectAssignment={setSelectedAssignmentForDrawer}
          onTogglePersonalTask={handleTogglePersonalTask}
          onRecordPaymentForInvoice={openReceiptModalForInvoice}
          onOpenInvoiceForAssignment={handleOpenInvoiceForAssignment}
          onSubmitTaskForReview={handleSubmitTaskForReview}
          onUpdateClient={handleUpdateClient}
        />
      )}
    </ApplicationChrome>
  );
}

function RoleDashboard({
  role,
  assignments,
  schedules,
  invoices,
  personalTasks,
  delegatedTasks,
  onCompose,
  onToast,
  onSelectAssignment,
  onTogglePersonalTask,
  onUpdateDelegatedTask,
  onApproveDelegatedTask,
  onSubmitTaskForReview,
  onNavigate,
}: {
  role: CompanyRole;
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  invoices: InvoiceRecord[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onUpdateDelegatedTask: (updated: DelegatedTaskRecord) => void;
  onApproveDelegatedTask: (task: DelegatedTaskRecord) => void;
  onSubmitTaskForReview: (task: DelegatedTaskRecord) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const copy = ROLE_COPY[role];
  const leadership = role === 'founder' || role === 'manager';
  return (
    <>
      <PageHeading
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        primaryLabel={leadership ? 'New assignment' : 'New personal task'}
        onPrimary={() => onCompose(leadership ? 'assignment' : 'personal')}
        onSecondary={() => onToast('Today’s work plan is ready')}
      />
      {role === 'founder' ? (
        <FounderDashboard
          assignments={assignments}
          schedules={schedules}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'manager' ? (
        <ManagerDashboard
          assignments={assignments}
          schedules={schedules}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'senior_staff' ? (
        <SeniorDashboard
          assignments={assignments}
          personalTasks={personalTasks}
          delegatedTasks={delegatedTasks}
          onCompose={onCompose}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onTogglePersonalTask={onTogglePersonalTask}
          onApproveDelegatedTask={onApproveDelegatedTask}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'staff' ? (
        <StaffDashboard
          assignments={assignments}
          personalTasks={personalTasks}
          delegatedTasks={delegatedTasks}
          onCompose={onCompose}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onTogglePersonalTask={onTogglePersonalTask}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'trainee' ? (
        <TraineeDashboard
          personalTasks={personalTasks}
          delegatedTasks={delegatedTasks}
          onToast={onToast}
          onTogglePersonalTask={onTogglePersonalTask}
          onSubmitTaskForReview={onSubmitTaskForReview}
          onNavigate={onNavigate}
        />
      ) : null}
    </>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  primaryLabel,
  onPrimary,
  onSecondary,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <section className="page-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">
        <button className="soft-button" type="button" onClick={onSecondary}>
          <CalendarClock aria-hidden="true" /> Today’s plan
        </button>
        <button className="primary-button" type="button" onClick={onPrimary}>
          <Plus aria-hidden="true" /> {primaryLabel}
        </button>
      </div>
    </section>
  );
}

function FounderDashboard({
  assignments,
  schedules,
  onToast,
  onSelectAssignment,
  onNavigate,
}: {
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <MetricStrip variant="leadership" />
      <div className="dashboard-grid chart-and-snapshot">
        <BillingCollectionsChart />
        <CollectionsSnapshot />
      </div>
      <div className="dashboard-grid assignments-and-outstanding">
        <AssignmentsTable
          title="All open assignments"
          rows={assignments}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
          canEdit={true}
        />
        <ClientOutstanding />
      </div>
      <div className="dashboard-grid four-up">
        <DeadlineRadar schedules={schedules} assignments={assignments} />
        <TeamCapacity />
        <PracticeComplianceRadar schedules={schedules} />
        <StatutoryExceptions schedules={schedules} />
      </div>
    </div>
  );
}

function ManagerDashboard({
  assignments,
  schedules,
  onToast,
  onSelectAssignment,
  onNavigate,
}: {
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <MetricStrip variant="manager" />
      <div className="dashboard-grid operations-top">
        <OperationalTriage />
        <DeadlineRadar schedules={schedules} assignments={assignments} />
      </div>
      <AssignmentsTable
        title="All open assignments"
        rows={assignments}
        onToast={onToast}
        onSelectAssignment={onSelectAssignment}
        onNavigate={onNavigate}
        canEdit={true}
      />
      <div className="dashboard-grid chart-and-snapshot">
        <BillingCollectionsChart />
        <PracticeComplianceRadar schedules={schedules} />
      </div>
      <div className="dashboard-grid three-up">
        <TeamCapacity />
        <StatutoryExceptions schedules={schedules} />
        <ClientOutstanding compact />
      </div>
    </div>
  );
}

function SeniorDashboard({
  assignments,
  personalTasks,
  delegatedTasks,
  onCompose,
  onToast,
  onSelectAssignment,
  onTogglePersonalTask,
  onApproveDelegatedTask,
  onNavigate,
}: {
  assignments: AssignmentRow[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onApproveDelegatedTask: (task: DelegatedTaskRecord) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const visible = assignments.filter((a) => a.owner === 'Priya Desai' || a.reviewer === 'Priya Desai');
  return (
    <div className="dashboard-stack">
      <MetricStrip variant="senior" />
      <div className="dashboard-grid operations-top">
        <AssignmentsTable
          title="Assignments I own or review"
          rows={visible}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
          compact
        />
        <DeadlineRadar assignments={assignments} />
      </div>
      <div className="dashboard-grid three-up">
        <DelegatedWork
          tasks={delegatedTasks}
          role="senior_staff"
          onAdd={() => onCompose('delegated')}
        />
        <PersonalTasks
          tasks={personalTasks}
          onToggle={onTogglePersonalTask}
          onAdd={() => onCompose('personal')}
        />
        <ReviewQueue
          delegatedTasks={delegatedTasks}
          onApprove={onApproveDelegatedTask}
          onToast={onToast}
        />
      </div>
    </div>
  );
}

function StaffDashboard({
  assignments,
  personalTasks,
  delegatedTasks,
  onCompose,
  onToast,
  onSelectAssignment,
  onTogglePersonalTask,
  onNavigate,
}: {
  assignments: AssignmentRow[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const myAssignments = assignments.filter((assignment) => assignment.owner === 'Rohan Mehta');
  return (
    <div className="dashboard-stack">
      <MetricStrip variant="staff" />
      <div className="dashboard-grid operations-top">
        <AssignmentsTable
          title="My assignments"
          rows={myAssignments}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
          compact
        />
        <PersonalTasks
          tasks={personalTasks}
          onToggle={onTogglePersonalTask}
          onAdd={() => onCompose('personal')}
        />
      </div>
      <div className="dashboard-grid three-up">
        <DelegatedWork
          tasks={delegatedTasks}
          role="staff"
          onAdd={() => onCompose('delegated')}
        />
        <DeadlineRadar assignments={assignments} />
        <DocumentRequests />
      </div>
    </div>
  );
}

function TraineeDashboard({
  personalTasks,
  delegatedTasks,
  onToast,
  onTogglePersonalTask,
  onSubmitTaskForReview,
  onNavigate,
}: {
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onToast: (message: string) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onSubmitTaskForReview: (task: DelegatedTaskRecord) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <MetricStrip variant="trainee" />
      <div className="dashboard-grid operations-top trainee-top">
        <TaskQueue
          tasks={delegatedTasks}
          onSubmitForReview={onSubmitTaskForReview}
          onToast={onToast}
          onNavigate={onNavigate}
        />
        <PersonalTasks
          tasks={personalTasks}
          onToggle={onTogglePersonalTask}
        />
      </div>
      <div className="dashboard-grid three-up">
        <TodayChecklist />
        <DocumentRequests />
        <GuidanceCard />
      </div>
    </div>
  );
}

type MetricVariant = 'leadership' | 'manager' | 'senior' | 'staff' | 'trainee';

function MetricStrip({ variant }: { variant: MetricVariant }) {
  const data: Record<MetricVariant, Array<[string, string, string, AssignmentTone]>> = {
    leadership: [
      ['Due today', '7', '2 at risk', 'danger'],
      ['Open assignments', '38', '33 assigned', 'default'],
      ['Pending review', '6', 'Founder or Manager action', 'warning'],
      ['Outstanding fees', '₹1,21,750', '₹88,500 overdue', 'danger'],
    ],
    manager: [
      ['Due today', '7', '2 at risk', 'danger'],
      ['Unassigned work', '5', 'Needs allocation', 'warning'],
      ['Pending review', '6', 'Your action', 'warning'],
      ['Cash balance', '₹42,680', 'Reconciled yesterday', 'success'],
    ],
    senior: [
      ['My assignments', '8', '6 on track', 'default'],
      ['Due today', '2', '1 awaiting documents', 'danger'],
      ['Subtask review', '3', 'Trainee submissions', 'warning'],
      ['Delegated tasks', '6', '4 in progress', 'success'],
    ],
    staff: [
      ['My assignments', '5', '4 on track', 'default'],
      ['Due today', '1', 'GST reconciliation', 'danger'],
      ['With trainee', '2', 'One due tomorrow', 'warning'],
      ['Personal tasks', '4', '2 scheduled today', 'success'],
    ],
    trainee: [
      ['Assigned tasks', '7', '5 in progress', 'default'],
      ['Due today', '3', 'Start with evidence', 'danger'],
      ['Checklists', '18/24', '75% complete', 'success'],
      ['Personal tasks', '2', 'Next at 15:00', 'warning'],
    ],
  };

  return (
    <section className="metric-strip" aria-label="Operational summary">
      {data[variant].map(([label, value, note, tone]) => (
        <article className={`metric-card tone-${tone}`} key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </article>
      ))}
    </section>
  );
}

function BillingCollectionsChart() {
  return (
    <Card
      title="Billing & collections"
      description="Invoices raised versus cash collected · FY 2026–27"
      className="chart-card"
      action={
        <div className="segmented" aria-label="Chart period">
          <button type="button">Quarter</button>
          <button type="button" className="is-active">Year</button>
        </div>
      }
    >
      <div className="chart-summary">
        <div><span>Collected</span><strong>₹8.42L</strong></div>
        <div><span>Invoiced</span><strong>₹9.64L</strong></div>
        <p><TrendingUp aria-hidden="true" /> 12.8% ahead of last year</p>
      </div>
      <div className="line-chart" aria-label="Monthly billing and collection trend">
        <svg viewBox="0 0 760 230" role="img" aria-label="Collections and billing from April to September">
          <path className="chart-grid" d="M20 30H740M20 85H740M20 140H740M20 195H740" />
          <path className="chart-area" d="M20 177C90 168 120 126 170 137S265 116 320 107S415 73 470 91S555 43 610 62S690 38 740 28V195H20Z" />
          <path className="chart-line" d="M20 177C90 168 120 126 170 137S265 116 320 107S415 73 470 91S555 43 610 62S690 38 740 28" />
          <path className="chart-line-secondary" d="M20 187C80 182 125 158 170 162S255 140 320 151S408 111 470 125S555 84 610 101S690 70 740 77" />
          <circle className="chart-point" cx="740" cy="28" r="5" />
        </svg>
        <div className="chart-labels"><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span></div>
      </div>
      <div className="chart-legend"><span><i className="legend-primary" />Invoiced</span><span><i className="legend-gold" />Collected</span></div>
    </Card>
  );
}

function CollectionsSnapshot() {
  const items = [
    ['Raised this month', '₹1,84,000', '12 invoices'],
    ['Collected this month', '₹1,27,500', '69% realized'],
    ['Outstanding', '₹1,21,750', '4 clients'],
    ['Overdue', '₹88,500', '62 days oldest'],
  ];
  return (
    <Card title="Collections snapshot" description="Current billing position" action={<MoreButton />} className="snapshot-card">
      <div className="snapshot-grid">
        {items.map(([label, value, note], index) => (
          <article className={index === 3 ? 'snapshot-item is-danger' : 'snapshot-item'} key={label}>
            <span>{label}</span><strong>{value}</strong><small>{note}</small>
          </article>
        ))}
      </div>
      <div className="collection-progress"><span><strong>69%</strong> of October billing collected</span><i><b /></i></div>
    </Card>
  );
}

function ClientOutstanding({ compact = false }: { compact?: boolean }) {
  return (
    <Card title="Top client outstanding" description="Prioritized by value and age" action={<MoreButton />} className={compact ? 'outstanding-card is-compact' : 'outstanding-card'}>
      <div className="outstanding-total"><span>Total outstanding</span><strong>₹1,21,750</strong><small>₹88,500 currently overdue</small></div>
      <div className="list-stack">
        {CLIENT_OUTSTANDING.slice(0, compact ? 3 : 4).map((item) => (
          <button className="list-row" type="button" key={item.client}>
            <span className="client-monogram">{item.client.split(' ').slice(0, 2).map((part) => part[0]).join('')}</span>
            <span><strong>{item.client}</strong><small>{item.age}</small></span>
            <span className={`amount tone-${item.tone}`}>{item.amount}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function DeadlineRadar({
  schedules = [],
  assignments = [],
}: {
  schedules?: RecurringScheduleRecord[];
  assignments?: AssignmentRow[];
}) {
  const items: Array<[string, string, string, AssignmentTone]> = [
    ['Today', 'TDS return evidence', 'Sharma Retail', 'danger'],
    ['03/11', 'GSTR-1 filing', 'Aster Foods', 'warning'],
    ['06/11', 'Internal audit close', 'BluePeak Technologies', 'default'],
    ['11/11', 'GSTR-1 Monthly', 'Kedia Holdings', 'default'],
    ['20/11', 'GSTR-3B Monthly', 'Aster Foods', 'default'],
  ];
  return (
    <Card title="Deadline radar" description="Next statutory filing milestones" action={<CalendarClock aria-hidden="true" />} className="compact-card">
      <div className="deadline-list">
        {items.map(([date, title, client, tone]) => (
          <div className="deadline-row" key={`${date}-${title}-${client}`}>
            <span className="deadline-date"><strong>{date}</strong></span>
            <span><strong>{title}</strong><small>{client}</small></span>
            <Status tone={tone}>{tone === 'danger' ? 'Urgent' : tone === 'warning' ? 'Approaching' : 'Scheduled'}</Status>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TeamCapacity() {
  const people = [['Priya Desai', 'GST & compliance', 86], ['Rohan Mehta', 'Audit & bookkeeping', 68], ['Neha Kapoor', 'Delivery support', 54]] as const;
  return (
    <Card title="Team capacity" description="Committed work · next 7 days" action={<UsersRound aria-hidden="true" />} className="compact-card">
      <div className="capacity-list">
        {people.map(([name, functionName, load]) => (
          <div className="capacity-row" key={name}>
            <span><strong>{name}</strong><small>{functionName}</small></span>
            <span className="capacity-value">{load}%</span>
            <i><b style={{ width: `${load}%` }} /></i>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PracticeComplianceRadar({ schedules = [] }: { schedules?: RecurringScheduleRecord[] }) {
  const pendingGst = schedules.filter((s) => s.category === 'GST' && s.currentStatus !== 'Filed').length;
  const pendingTds = schedules.filter((s) => s.category === 'TDS' && s.currentStatus !== 'Filed').length;
  const bankRecNeeded = schedules.filter((s) => s.bankRecStatus === 'Awaited' || s.bankRecStatus === 'In progress').length;
  const readyToFile = schedules.filter((s) => s.currentStatus === 'Ready to File').length;

  return (
    <Card
      title="Compliance Radar"
      description="Active statutory client obligations"
      action={<CalendarClock aria-hidden="true" />}
      className="compact-card"
    >
      <div className="exception-summary">
        <strong>{schedules.length || 7}</strong>
        <span>Continuous mandates<br />across practice clients</span>
      </div>
      <div className="mini-list">
        <span><i className="dot-warning" />Pending GST (11th &amp; 20th) <b>{pendingGst || 4}</b></span>
        <span><i className="dot-danger" />Bank Rec statement needed <b>{bankRecNeeded || 3}</b></span>
        <span><i className="dot-default" />Pending TDS / 26Q <b>{pendingTds || 2}</b></span>
        <span><i className="dot-success" />Ready for DSC filing <b>{readyToFile || 1}</b></span>
      </div>
    </Card>
  );
}

function StatutoryExceptions({ schedules = [] }: { schedules?: RecurringScheduleRecord[] }) {
  const awaitedDocs = schedules.filter((s) => s.currentStatus === 'Docs Awaited').length || 1;
  const bankPending = schedules.filter((s) => s.bankRecStatus === 'Awaited').length || 2;
  const filedCount = schedules.filter((s) => s.currentStatus === 'Filed').length || 1;

  return (
    <Card
      title="Statutory Exceptions"
      description="Blockers requiring client or partner action"
      action={<AlertTriangle aria-hidden="true" />}
      className="compact-card"
    >
      <div className="mini-list" style={{ marginTop: 6 }}>
        <span><i className="dot-danger" />Bank Statements overdue <b>{bankPending}</b></span>
        <span><i className="dot-warning" />Client purchase data awaited <b>{awaitedDocs}</b></span>
        <span><i className="dot-success" />Filing proofs &amp; ARNs recorded <b>{filedCount}</b></span>
      </div>
    </Card>
  );
}

function OperationalTriage() {
  const items = [
    ['GST portal exceptions unresolved', 'Aster Foods · statutory filing', 'High risk', 'danger'],
    ['Evidence pack is incomplete', 'Sharma Retail · client dependency', '3 documents', 'warning'],
    ['Audit response awaits review', 'BluePeak · quality gate', 'Manager', 'default'],
    ['Collection exposure is concentrated', 'BluePeak · 62 days overdue', '₹88,500', 'gold'],
  ];
  return (
    <Card title="Operational triage" description="Risk, value, and dependencies across the practice" action={<ShieldCheck aria-hidden="true" />} className="triage-card">
      <div className="triage-lead"><span><small>Risk concentration</small><strong>Two blockers can change this week’s outcome.</strong></span><b>4<small>signals</small></b></div>
      <div className="triage-list">
        {items.map(([title, meta, impact, tone]) => (
          <button className="triage-row" type="button" key={title}><span className={`signal-icon tone-${tone}`}><Activity aria-hidden="true" /></span><span><strong>{title}</strong><small>{meta}</small></span><Status tone={tone === 'gold' ? 'warning' : tone as AssignmentTone}>{impact}</Status></button>
        ))}
      </div>
    </Card>
  );
}

function DelegatedWork({
  tasks,
  onAdd,
  role,
}: {
  tasks: DelegatedTaskRecord[];
  onAdd: () => void;
  role?: 'senior_staff' | 'staff';
}) {
  const visibleTasks = role === 'staff' ? tasks.filter((task) => task.person === 'Neha Kapoor') : tasks;
  return (
    <Card title="Delegated work" description="Sub-tasks delegated under your Assignments" action={<button className="mini-add" type="button" onClick={onAdd}><Plus aria-hidden="true" /> Delegate</button>} className="compact-card">
      <div className="list-stack task-list">
        {visibleTasks.map((task) => (
          <div className="task-row" key={task.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><strong>{task.title}</strong><small>{task.parent}</small></span>
            <span style={{ textAlign: 'right' }}>
              <Status tone={task.status === 'Completed' ? 'success' : task.status === 'Pending Review' ? 'warning' : 'default'}>
                {task.status || 'In Progress'}
              </Status>
              <small style={{ display: 'block' }}>{task.person} · {task.due}</small>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PersonalTasks({
  tasks,
  onToggle,
  onAdd,
}: {
  tasks: PersonalTaskRecord[];
  onToggle?: (id: string) => void;
  onAdd?: () => void;
}) {
  return (
    <Card title="Personal tasks" description="Private planning and reminders" action={onAdd ? <button className="mini-add" type="button" onClick={onAdd}><Plus aria-hidden="true" /> Add task</button> : <ListChecks aria-hidden="true" />} className="compact-card">
      <div className="personal-list">
        {tasks.map((task) => (
          <label className={task.done ? 'personal-row is-done' : 'personal-row'} key={task.id} style={{ cursor: onToggle ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => onToggle && onToggle(task.id)}
            />
            <span className="custom-check"><Check aria-hidden="true" /></span>
            <span><strong>{task.title}</strong><small>{task.context} · {task.time}</small></span>
          </label>
        ))}
      </div>
    </Card>
  );
}

function ReviewQueue({
  delegatedTasks = [],
  onApprove,
  onToast,
}: {
  delegatedTasks?: DelegatedTaskRecord[];
  onApprove?: (task: DelegatedTaskRecord) => void;
  onToast?: (msg: string) => void;
}) {
  const pending = delegatedTasks.filter((t) => t.status === 'Pending Review');
  return (
    <Card title="Review queue" description="Team work awaiting your decision" action={<ClipboardCheck aria-hidden="true" />} className="compact-card">
      <div className="review-score"><span><strong>{pending.length}</strong> ready to review</span><small>{pending.length === 0 ? 'Queue clear' : 'Awaiting sign-off'}</small></div>
      <div className="mini-list">
        {pending.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-muted)', padding: '8px 0', margin: 0 }}>All delegated sub-tasks verified.</p>
        ) : (
          pending.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span>
                <i className="dot-warning" />
                {t.title} <b>{t.person}</b>
              </span>
              {onApprove ? (
                <button
                  className="soft-button"
                  type="button"
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => onApprove(t)}
                >
                  Approve
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function DocumentRequests() {
  return (
    <Card title="Document requests" description="Items blocking assigned work" action={<Files aria-hidden="true" />} className="compact-card">
      <div className="document-count"><strong>5</strong><span>documents awaited<br />from 2 clients</span></div>
      <div className="mini-list"><span><i className="dot-danger" />Bank statement · Sharma Retail <b>2d late</b></span><span><i className="dot-warning" />Purchase register · Aster Foods <b>Today</b></span><span><i className="dot-default" />Payroll inputs · Northstar <b>04/11</b></span></div>
    </Card>
  );
}

function TaskQueue({
  tasks,
  onSubmitForReview,
  onToast,
  onNavigate,
}: {
  tasks: DelegatedTaskRecord[];
  onSubmitForReview?: (task: DelegatedTaskRecord) => void;
  onToast: (message: string) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const traineeTasks = tasks.filter((t) => t.person === 'Neha Kapoor');
  return (
    <Card
      title="My task queue"
      description="Delegated work ordered by due time"
      action={
        <button
          className="text-button"
          type="button"
          onClick={() => (onNavigate ? onNavigate('My Tasks') : onToast('All trainee tasks displayed'))}
        >
          View all <ChevronRight aria-hidden="true" />
        </button>
      }
      className="task-queue"
    >
      <div className="queue-list">
        {traineeTasks.map((task, index) => (
          <div className="queue-row" key={task.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="queue-priority">{index + 1}</span>
              <div>
                <strong>{task.title}</strong>
                <small style={{ display: 'block', color: 'var(--ink-muted)' }}>{task.parent} · Assigned by {task.assignedBy}</small>
                {task.instructions ? <p style={{ fontSize: 11, color: 'var(--ink-muted)', margin: '4px 0 0' }}>{task.instructions}</p> : null}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'right' }}>
                <Status tone={task.status === 'Completed' ? 'success' : task.status === 'Pending Review' ? 'warning' : 'default'}>
                  {task.status || `${task.progress}%`}
                </Status>
                <small style={{ display: 'block' }}>{task.due}</small>
              </div>
              {task.status !== 'Completed' && task.status !== 'Pending Review' && onSubmitForReview ? (
                <button
                  className="primary-button"
                  type="button"
                  style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
                  onClick={() => onSubmitForReview(task)}
                >
                  Submit for Review
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TodayChecklist() {
  return (
    <Card title="Today’s checklist" description="Evidence-first completion" action={<BookOpenCheck aria-hidden="true" />} className="compact-card">
      <div className="checklist-ring"><span><strong>75%</strong><small>18 of 24</small></span><p>6 checklist items remain across three delegated tasks.</p></div>
      <div className="collection-progress"><span><strong>Next:</strong> verify portal totals</span><i><b style={{ width: '75%' }} /></i></div>
    </Card>
  );
}

function GuidanceCard() {
  return (
    <Card title="Need guidance?" description="Keep the work trail clear" action={<UserRoundCheck aria-hidden="true" />} className="compact-card guidance-card">
      <p>Ask the Assignment Owner a question inside the task so the answer remains with the client work.</p>
      <button className="soft-button full-width" type="button"><MessageSquareText aria-hidden="true" /> Ask Priya Desai</button>
    </Card>
  );
}

function ModuleWorkspace({
  page,
  role,
  clients,
  schedules,
  assignments,
  invoices,
  receipts,
  personalTasks,
  delegatedTasks,
  onCompose,
  onToast,
  onUpdateSchedule,
  onUpdateAssignment,
  onSelectAssignment,
  onTogglePersonalTask,
  onRecordPaymentForInvoice,
  onOpenInvoiceForAssignment,
  onSubmitTaskForReview,
  onUpdateClient,
}: {
  page: PageKey;
  role: CompanyRole;
  clients: ClientRecord[];
  schedules: RecurringScheduleRecord[];
  assignments: AssignmentRow[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (id: string) => void;
  onRecordPaymentForInvoice: (inv: InvoiceRecord) => void;
  onOpenInvoiceForAssignment: (asn: AssignmentRow) => void;
  onSubmitTaskForReview?: (task: DelegatedTaskRecord) => void;
  onUpdateClient?: (updated: ClientRecord) => void;
}) {
  const leadership = role === 'founder' || role === 'manager';
  const primaryLabel =
    page === 'Assignments' && leadership
      ? 'New assignment'
      : page === 'My Tasks'
      ? 'New personal task'
      : page === 'Clients' && leadership
      ? 'New client'
      : page === 'Billing & Collections'
      ? (leadership ? 'Raise invoice' : 'Record receipt')
      : `Add ${page.toLowerCase()}`;
  const primaryMode: DialogMode =
    page === 'Assignments' && leadership
      ? 'assignment'
      : page === 'My Tasks'
      ? 'personal'
      : page === 'Clients' && leadership
      ? 'client'
      : page === 'Billing & Collections'
      ? (leadership ? 'invoice' : 'receipt')
      : null;
  return (
    <>
      <PageHeading
        eyebrow=""
        title={page}
        description={MODULE_DESCRIPTIONS[page]}
        primaryLabel={primaryLabel}
        onPrimary={() => (primaryMode ? onCompose(primaryMode) : onToast(`${page} creation flow is next in this vertical slice`))}
        onSecondary={() => onToast(`${page} filters opened`)}
      />
      {page === 'Clients' ? (
        <ClientsWorkspace
          role={role}
          model={{
            clients,
            schedules,
            invoices,
            receipts,
          }}
          actions={{
            compose: onCompose,
            notify: onToast,
            recordPaymentForInvoice: onRecordPaymentForInvoice,
            updateClient: onUpdateClient,
          }}
        />
      ) : null}
      {page === 'Assignments' ? (
        <AssignmentsWorkspace
          role={role}
          schedules={schedules}
          assignments={assignments}
          onToast={onToast}
          onCompose={onCompose}
          onUpdateSchedule={onUpdateSchedule}
          onUpdateAssignment={onUpdateAssignment}
          onSelectAssignment={onSelectAssignment}
        />
      ) : null}
      {page === 'Billing & Collections' ? (
        <BillingWorkspace
          role={role}
          model={{
            invoices,
            receipts,
            clients,
          }}
          actions={{
            compose: onCompose,
            notify: onToast,
            recordPaymentForInvoice: onRecordPaymentForInvoice,
          }}
        />
      ) : null}
      {page === 'My Tasks' ? (
        <div className="dashboard-grid operations-top">
          <PersonalTasks
            tasks={personalTasks}
            onToggle={onTogglePersonalTask}
            onAdd={() => onCompose('personal')}
          />
          {role === 'trainee' ? (
            <TaskQueue
              tasks={delegatedTasks}
              onSubmitForReview={onSubmitTaskForReview}
              onToast={onToast}
            />
          ) : (
            <DelegatedWork
              tasks={delegatedTasks}
              role={role === 'staff' ? 'staff' : role === 'senior_staff' ? 'senior_staff' : undefined}
              onAdd={() => onCompose('delegated')}
            />
          )}
        </div>
      ) : null}
      {page === 'Office Accounts' ? <AccountsWorkspace /> : null}
      {page === 'Team' ? <TeamWorkspace role={role} /> : null}
      {!['Clients', 'Assignments', 'Billing & Collections', 'My Tasks', 'Office Accounts', 'Team'].includes(page) ? (
        <ModuleFoundation page={page} />
      ) : null}
    </>
  );
}

function ModuleFoundation({ page }: { page: PageKey }) {
  const modules: Record<string, Array<[string, string, string]>> = {
    Clients: [['Active clients', '48', '3 require attention'], ['Registrations tracked', '126', 'PAN, GSTIN, TAN and more'], ['Document requests', '12', '5 overdue']],
    Documents: [['Current requests', '12', 'Across 7 clients'], ['Awaiting review', '8', 'Evidence uploaded'], ['Expiring soon', '4', 'Next 30 days']],
    Communication: [['Follow-ups due', '9', '4 scheduled today'], ['Unanswered requests', '5', 'Oldest 3 days'], ['Activity logged', '74', 'This week']],
    'Billing & Collections': [['Raised this month', '₹1,84,000', '12 invoices'], ['Collected', '₹1,27,500', '69% realized'], ['Outstanding', '₹1,21,750', '4 clients']],
    Reports: [['Delivery readiness', '86%', 'Across open work'], ['Review velocity', '78%', 'Within 24 hours'], ['Collections discipline', '61%', 'Improvement needed']],
    Settings: [['Active staff', '12', '5 role types'], ['Recurring templates', '18', '42 live schedules'], ['Audit events', '286', 'Last 30 days']],
  };
  const stats = modules[page] ?? [['Workspace records', '24', 'Ready for API wiring'], ['Recent activity', '18', 'This week'], ['Needs attention', '3', 'Action required']];
  return (
    <div className="module-foundation">
      <section className="module-stat-grid">
        {stats.map(([label, value, note]) => <article className="card module-stat" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
      </section>
      <Card title={`${page} workspace`} description="The clean-slate shell and permission boundary are active on this route." action={<MoreButton />}>
        <div className="foundation-body"><span className="foundation-icon"><FileStack aria-hidden="true" /></span><div><strong>This module now belongs to the new application.</strong><p>Its end-to-end workflow will be filled from the Lovable behavioural reference without importing the old visual layer.</p></div><button className="soft-button" type="button">Open module plan <ChevronRight aria-hidden="true" /></button></div>
      </Card>
    </div>
  );
}

function CashLedger() {
  return (
    <Card title="Office cash ledger" description="Manager-owned · reconciled 29/10" action={<WalletCards aria-hidden="true" />} className="compact-card cash-card">
      <div className="cash-balance"><span>Closing cash</span><strong>₹42,680</strong><small><Check aria-hidden="true" /> Yesterday reconciled</small></div>
      <div className="cash-movements"><span><i className="money-in" /><small>Cash in</small><strong>₹18,500</strong></span><span><i className="money-out" /><small>Cash out</small><strong>₹7,240</strong></span></div>
    </Card>
  );
}

function AccountsWorkspace() {
  return <div className="dashboard-stack"><MetricStrip variant="manager" /><div className="dashboard-grid chart-and-snapshot"><CashLedger /><Card title="Recent ledger entries" description="Manager-operated · immutable audit trail" action={<IndianRupee aria-hidden="true" />}><div className="ledger-list">{[['Client receipt · Aster Foods', '+ ₹14,500', 'success'], ['Office stationery', '− ₹2,340', 'danger'], ['Travel reimbursement · Rohan', '− ₹1,280', 'danger'], ['Cash withdrawal from bank', '+ ₹10,000', 'success']].map(([label, value, tone]) => <div key={label}><span><strong>{label}</strong><small>29/10/2026 · Ananya Rao</small></span><b className={`tone-${tone}`}>{value}</b></div>)}</div></Card></div></div>;
}

function TeamWorkspace({ role }: { role: CompanyRole }) {
  return <div className="dashboard-grid team-layout"><Card title="Reporting structure" description="Every non-Founder reports to Founder or Manager" action={<UsersRound aria-hidden="true" />}><div className="org-tree"><div className="org-founder"><span>SN</span><strong>S. Narayanan</strong><small>Founder</small></div><div className="org-branch"><div><span>AR</span><strong>Ananya Rao</strong><small>Manager · reports to Founder</small></div><div><span>PD</span><strong>Priya Desai</strong><small>Senior Staff · reports to Manager</small></div><div><span>RM</span><strong>Rohan Mehta</strong><small>Staff · reports to Manager</small></div><div><span>NK</span><strong>Neha Kapoor</strong><small>Trainee · reports to Manager</small></div></div></div></Card><Card title="Authority guardrails" description={`Visible while previewing as ${ROLE_LABELS[role]}`} action={<ShieldCheck aria-hidden="true" />}><div className="authority-list"><span><CheckCircle2 />Founder and Manager create Assignments</span><span><CheckCircle2 />Senior Staff delegate to Staff or Trainee</span><span><CheckCircle2 />Staff delegate only to Trainee</span><span><CheckCircle2 />Every role creates Personal Tasks for self</span><span><CheckCircle2 />Manager operates Office Accounts</span></div></Card></div>;
}

function AssignmentDetailDrawer({
  assignment,
  leadership,
  role,
  onClose,
  onToast,
  onUpdateAssignment,
  onOpenInvoice,
  initialEditing = false,
}: {
  assignment: AssignmentRow;
  leadership: boolean;
  role?: CompanyRole;
  onClose: () => void;
  onToast: (msg: string) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onOpenInvoice?: (asn: AssignmentRow) => void;
  initialEditing?: boolean;
}) {
  const canEditAssignment = role === 'founder' || role === 'manager';
  const currentPersonName = role ? ROLE_PEOPLE[role]?.name : '';
  const isAssignedCustodian = Boolean(
    currentPersonName &&
    (assignment.owner.toLowerCase().includes(currentPersonName.toLowerCase()) ||
     currentPersonName.toLowerCase().includes(assignment.owner.toLowerCase()))
  );
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [tab, setTab] = useState<'checklist' | 'overview' | 'papers' | 'billing'>('checklist');
  const [status, setStatus] = useState(assignment.status);
  const [milestones, setMilestones] = useState<AssignmentMilestone[]>(
    assignment.milestones || [
      { title: 'Initial document scrutiny and intake', done: true },
      { title: 'Fieldwork verification & ledger scrutiny', done: assignment.progress >= 50 },
      { title: 'Managerial quality review', done: assignment.progress >= 80 },
      { title: 'Partner final sign-off & dispatch', done: assignment.progress === 100 },
    ]
  );
  const [newPaper, setNewPaper] = useState('');
  const [workingPapers, setWorkingPapers] = useState<string[]>([
    `${assignment.client.replace(/\s+/g, '_')}_Working_Papers.xlsx`,
    `Statutory_Verification_Checklist_${assignment.id}.pdf`,
  ]);

  const visibleMilestones = useMemo(() => {
    if (assignment.bankStatementRequired === false) {
      return milestones.filter(
        (m) => !m.title.toLowerCase().includes('bank statement') && !m.title.toLowerCase().includes('bank reconciliation')
      );
    }
    return milestones;
  }, [milestones, assignment.bankStatementRequired]);

  const [editTitle, setEditTitle] = useState(assignment.title);
  const [editService, setEditService] = useState(assignment.service);
  const [editOwner, setEditOwner] = useState(assignment.owner);
  const [editReviewer, setEditReviewer] = useState(assignment.reviewer || 'S. Narayanan');
  const [editDue, setEditDue] = useState(assignment.due);
  const [editStatus, setEditStatus] = useState(assignment.status);
  const [editScope, setEditScope] = useState(assignment.scope || '');
  const [editDeliveryNotes, setEditDeliveryNotes] = useState(assignment.deliveryNotes || '');
  const [editFee, setEditFee] = useState<number>(assignment.fee || 25000);
  const [editBankStatementReq, setEditBankStatementReq] = useState<boolean>(assignment.bankStatementRequired !== false);

  useEffect(() => {
    setEditTitle(assignment.title);
    setEditService(assignment.service);
    setEditOwner(assignment.owner);
    setEditReviewer(assignment.reviewer || 'S. Narayanan');
    setEditDue(assignment.due);
    setEditStatus(assignment.status);
    setEditScope(assignment.scope || '');
    setEditDeliveryNotes(assignment.deliveryNotes || '');
    setEditFee(assignment.fee || 25000);
    setEditBankStatementReq(assignment.bankStatementRequired !== false);
    setIsEditing(initialEditing);
  }, [assignment, initialEditing]);

  function toggleMilestone(index: number) {
    if (!isAssignedCustodian) return;
    setMilestones((prev) => {
      const next = prev.map((m, i) => (i === index ? { ...m, done: !m.done } : m));
      const doneCount = next.filter((m) => m.done).length;
      const nextProgress = Math.round((doneCount / next.length) * 100);
      const nextStatus = nextProgress === 100 ? 'Completed' : nextProgress >= 80 ? 'Pending review' : 'In progress';
      setStatus(nextStatus);
      return next;
    });
  }

  function handleSave() {
    if (!isAssignedCustodian) return;
    const doneCount = milestones.filter((m) => m.done).length;
    const progress = Math.round((doneCount / milestones.length) * 100);
    const updated: AssignmentRow = {
      ...assignment,
      status,
      progress,
      milestones,
      tone: status === 'Completed' ? 'success' : status === 'Pending review' ? 'warning' : 'default',
    };
    onUpdateAssignment(updated);
    onClose();
  }

  function handleSaveEdit(e?: FormEvent) {
    if (e) e.preventDefault();
    const updated: AssignmentRow = {
      ...assignment,
      title: editTitle.trim() || assignment.title,
      service: editService,
      owner: editOwner,
      reviewer: editReviewer,
      due: editDue.trim() || assignment.due,
      status: editStatus,
      scope: editScope.trim(),
      deliveryNotes: editDeliveryNotes.trim(),
      fee: editFee,
      bankStatementRequired: editBankStatementReq,
      bankRecStatus: editBankStatementReq ? (assignment.bankRecStatus || 'Awaited') : 'Not applicable',
      tone: editStatus === 'Completed' ? 'success' : editStatus === 'Pending review' ? 'warning' : 'default',
    };
    onUpdateAssignment(updated);
    setIsEditing(false);
    onToast(`Assignment ${assignment.id} details saved`);
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Assignment Details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{assignment.id.substring(4)}</span>
            <div>
              <h2>{assignment.title}</h2>
              <p>{assignment.client} · {assignment.service}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canEditAssignment ? (
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                style={{ fontSize: 11, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Pencil size={12} /> {isEditing ? 'Cancel Edit' : 'Edit Assignment'}
              </button>
            ) : null}
            <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        {!isEditing ? (
          <nav className="drawer-tabs">
            <button
              className={`drawer-tab ${tab === 'checklist' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('checklist')}
            >
              Milestones &amp; Checklist ({visibleMilestones.filter((m) => m.done).length}/{visibleMilestones.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('overview')}
            >
              Scope &amp; Team
            </button>
            <button
              className={`drawer-tab ${tab === 'papers' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('papers')}
            >
              Working Papers ({workingPapers.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'billing' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('billing')}
            >
              Billing Link
            </button>
          </nav>
        ) : null}

        <div className="drawer-content" style={{ padding: '20px 24px' }}>
          {isEditing ? (
            <form id="assignment-edit-form" onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--canvas)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Edit Assignment · {assignment.id}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Update scope, custody, reviewer, statutory due date, fee, and banking requirements.
                </p>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Assignment Scope &amp; Service</h4>
                <div className="form-grid">
                  <Field label="Assignment Title" full>
                    <input
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="e.g. GSTR-1 &amp; GSTR-3B Monthly Return Filing"
                    />
                  </Field>
                  <Field label="Client Entity">
                    <input value={assignment.client} readOnly style={{ opacity: 0.8 }} />
                  </Field>
                  <Field label="Practice Service Line">
                    <select value={editService} onChange={(e) => setEditService(e.target.value)}>
                      <option value="GST Compliance">GST Compliance</option>
                      <option value="Statutory Audit">Statutory Audit</option>
                      <option value="TDS Compliance">TDS Compliance</option>
                      <option value="Bookkeeping">Bookkeeping &amp; Accounts</option>
                      <option value="ROC Compliance">ROC &amp; Corporate</option>
                      <option value="Advisory">Tax Advisory</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Ownership, Review &amp; Status</h4>
                <div className="form-grid">
                  <Field label="Assigned Staff (Owner / Custodian)">
                    <select value={editOwner} onChange={(e) => setEditOwner(e.target.value)}>
                      <option value="S. Narayanan">S. Narayanan · Founder</option>
                      <option value="Ananya Rao">Ananya Rao · Manager</option>
                      <option value="Priya Desai">Priya Desai · Senior Staff</option>
                      <option value="Rohan Mehta">Rohan Mehta · Staff</option>
                    </select>
                  </Field>
                  <Field label="Sign-off Reviewer (Partner / Manager)">
                    <select value={editReviewer} onChange={(e) => setEditReviewer(e.target.value)}>
                      <option value="S. Narayanan">S. Narayanan (Founder)</option>
                      <option value="Ananya Rao">Ananya Rao (Manager)</option>
                      <option value="Priya Desai">Priya Desai (Senior Staff)</option>
                    </select>
                  </Field>
                  <Field label="Assignment Status">
                    <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                      <option value="In progress">In progress</option>
                      <option value="Pending review">Pending review</option>
                      <option value="Awaiting documents">Awaiting documents</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </Field>
                  <Field label="Target Statutory Due Date">
                    <input
                      value={editDue}
                      onChange={(e) => setEditDue(e.target.value)}
                      placeholder="e.g. 11/11/2026 or Today"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 6 }}>Banking &amp; Bank Statement Requirement</h4>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
                  For cash-only or retail clients without bank operations, set to "No" so bank statement reconciliation is marked Not Applicable for this filing.
                </p>
                <div className="form-grid">
                  <Field label="Bank Statement &amp; Reconciliation Required for this Filing?" full>
                    <select
                      value={editBankStatementReq ? 'yes' : 'no'}
                      onChange={(e) => setEditBankStatementReq(e.target.value === 'yes')}
                    >
                      <option value="yes">Yes — Mandatory bank statement &amp; reconciliation</option>
                      <option value="no">No — Not Applicable (Client has no bank / cash-only filing)</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Commercials &amp; Notes</h4>
                <div className="form-grid">
                  <Field label="Agreed Professional Fee (₹)">
                    <input
                      type="number"
                      value={editFee}
                      onChange={(e) => setEditFee(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Delivery Instructions / Working Notes" full>
                    <textarea
                      rows={2}
                      value={editDeliveryNotes}
                      onChange={(e) => setEditDeliveryNotes(e.target.value)}
                      placeholder="Special instructions, portal credentials note, or client reminders"
                      style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                    />
                  </Field>
                </div>
              </div>
            </form>
          ) : (
            <>
              {tab === 'checklist' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {!isAssignedCustodian ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--canvas)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 8, fontSize: 12, color: 'var(--ink-secondary)' }}>
                      <Lock size={14} color="var(--ink-muted)" />
                      <span>
                        Fieldwork milestones and delivery progress can only be updated by the assigned custodian (<strong>{assignment.owner}</strong>).
                      </span>
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface-muted)', padding: '12px 16px', borderRadius: 10 }}>
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Delivery Progress</span>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
                        {Math.round((visibleMilestones.filter((m) => m.done).length / (visibleMilestones.length || 1)) * 100)}%
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Status:</span>
                      <select
                        className="staff-scope-select"
                        value={status}
                        disabled={!isAssignedCustodian}
                        onChange={(e) => setStatus(e.target.value)}
                        style={{ opacity: isAssignedCustodian ? 1 : 0.7, cursor: isAssignedCustodian ? 'pointer' : 'not-allowed' }}
                      >
                        <option value="In progress">In progress</option>
                        <option value="Pending review">Pending review</option>
                        <option value="Awaiting documents">Awaiting documents</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)' }}>Engagement Milestones</span>
                    {visibleMilestones.map((m, idx) => (
                      <label
                        key={m.title}
                        className={`checklist-interactive-row ${m.done ? 'is-completed' : ''}`}
                        style={{ cursor: isAssignedCustodian ? 'pointer' : 'not-allowed', padding: '10px 14px', borderRadius: 8, opacity: isAssignedCustodian ? 1 : 0.85 }}
                      >
                        <input
                          type="checkbox"
                          checked={m.done}
                          disabled={!isAssignedCustodian}
                          onChange={() => isAssignedCustodian && toggleMilestone(idx)}
                          className="checklist-checkbox"
                          style={{ cursor: isAssignedCustodian ? 'pointer' : 'not-allowed' }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: m.done ? 500 : 600, textDecoration: m.done ? 'line-through' : 'none' }}>
                            {m.title}
                          </span>
                          <small style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                            {m.done ? 'Completed and verified' : `Step ${idx + 1} pending`}
                          </small>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === 'overview' ? (
                <div className="drawer-grid">
                  <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                    <span className="drawer-label">Engagement Scope</span>
                    <span className="drawer-val" style={{ fontWeight: 400, fontSize: 13, lineHeight: 1.5 }}>
                      {assignment.scope || 'Full statutory deliverable verification and reporting according to ICAI standards.'}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Assignment Owner</span>
                    <span className="drawer-val">{assignment.owner}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Reviewer / Sign-off</span>
                    <span className="drawer-val">{assignment.reviewer || 'S. Narayanan (Founder)'}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Statutory Target Due Date</span>
                    <span className="drawer-val" style={{ color: assignment.due === 'Today' ? 'var(--signal)' : 'inherit' }}>
                      {assignment.due}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Bank Rec for GST</span>
                    <span className="drawer-val">
                      {assignment.bankStatementRequired === false ? (
                        <span className="category-tag" style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 8px' }}>
                          Not Applicable (No Bank)
                        </span>
                      ) : (
                        <span style={{ color: '#01b574', fontWeight: 600 }}>Required</span>
                      )}
                    </span>
                  </div>
                  <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                    <span className="drawer-label">Delivery Notes</span>
                    <span className="drawer-val" style={{ fontWeight: 400, fontSize: 12 }}>
                      {assignment.deliveryNotes || 'Standard delivery cycle.'}
                    </span>
                  </div>
                </div>
              ) : null}

              {tab === 'papers' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
                    Audit evidence files, working papers, and signed confirmations tied to {assignment.id}.
                  </p>
                  <div className="list-stack">
                    {workingPapers.map((paper) => (
                      <div
                        key={paper}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'var(--surface-muted)',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                          <Files size={15} color="var(--brand)" />
                          {paper}
                        </span>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => onToast(`Downloaded ${paper}`)}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder="New paper name or document link…"
                      value={newPaper}
                      onChange={(e) => setNewPaper(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        fontSize: 12,
                      }}
                    />
                    <button
                      className="soft-button"
                      type="button"
                      onClick={() => {
                        if (newPaper.trim()) {
                          setWorkingPapers((prev) => [...prev, newPaper.trim()]);
                          setNewPaper('');
                          onToast(`Added working paper reference`);
                        }
                      }}
                    >
                      <Plus size={14} /> Attach
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === 'billing' ? (
                <div className="drawer-grid">
                  <div className="drawer-item">
                    <span className="drawer-label">Agreed Professional Fee</span>
                    <span className="drawer-val" style={{ fontSize: 16, fontWeight: 700 }}>
                      {formatINR(assignment.fee || 25000)}
                    </span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Invoicing Status</span>
                    <span className="drawer-val">
                      <span className={`status ${assignment.billed ? 'tone-success' : 'tone-warning'}`}>
                        {assignment.billed ? 'Billed' : 'Unbilled'}
                      </span>
                    </span>
                  </div>
                  {assignment.billed && assignment.invoiceId ? (
                    <div className="drawer-item" style={{ gridColumn: 'span 2' }}>
                      <span className="drawer-label">Linked Tax Invoice</span>
                      <span className="drawer-val" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{assignment.invoiceId}</strong>
                        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                          (Fee included in practice billing register)
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {!assignment.billed && leadership ? (
                    <div className="drawer-item" style={{ gridColumn: 'span 2', background: 'var(--surface-muted)', padding: 14, borderRadius: 8 }}>
                      <p style={{ fontSize: 12, color: 'var(--ink)', margin: '0 0 10px' }}>
                        Deliverable is nearing completion. You can raise a Tax Invoice now with standard 18% GST (CGST 9% + SGST 9%).
                      </p>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => {
                          onClose();
                          if (onOpenInvoice) onOpenInvoice(assignment);
                        }}
                      >
                        <ReceiptIndianRupee size={14} /> Raise Tax Invoice for this Assignment
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="drawer-footer">
          {isEditing ? (
            <>
              <button className="soft-button" type="button" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                form="assignment-edit-form"
                onClick={() => handleSaveEdit()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Check size={14} /> Save Changes
              </button>
            </>
          ) : (
            <>
              <button className="soft-button" type="button" onClick={onClose}>
                Close
              </button>
              {isAssignedCustodian ? (
                <button className="primary-button" type="button" onClick={handleSave}>
                  <Check size={14} /> Save progress &amp; update status
                </button>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', background: 'var(--surface-muted)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                  <Lock size={13} />
                  <span>Milestones locked to assigned custodian ({assignment.owner})</span>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function ComposerDialog({
  mode,
  role,
  clients,
  invoices,
  assignments,
  personalTasks,
  delegatedTasks,
  presetInvoice,
  presetAssignment,
  onClose,
  onCreated,
  onClientCreated,
  onInvoiceCreated,
  onReceiptCreated,
  onAssignmentCreated,
  onPersonalTaskCreated,
  onDelegatedTaskCreated,
}: {
  mode: DialogMode;
  role: CompanyRole;
  clients: ClientRecord[];
  invoices: InvoiceRecord[];
  assignments: AssignmentRow[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  presetInvoice: InvoiceRecord | null;
  presetAssignment?: AssignmentRow | null;
  onClose: () => void;
  onCreated: (message: string) => void;
  onClientCreated: (client: ClientRecord, services: string[], owner: string) => void;
  onInvoiceCreated: (invoice: InvoiceRecord) => void;
  onReceiptCreated: (receipt: ReceiptRecord) => void;
  onAssignmentCreated: (assignment: AssignmentRow) => void;
  onPersonalTaskCreated: (task: PersonalTaskRecord) => void;
  onDelegatedTaskCreated: (task: DelegatedTaskRecord) => void;
}) {
  useEffect(() => {
    if (!mode) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode, onClose]);

  if (!mode) return null;
  const titles: Record<Exclude<DialogMode, null>, [string, string]> = {
    assignment: ['Create assignment', 'Create a controlled client obligation with a clear owner and review gate.'],
    personal: ['New personal task', 'Plan a private reminder for yourself without creating practice-level work.'],
    delegated: ['Delegate Sub-Task', 'Break down an existing Assignment into operational verification steps while retaining owner accountability.'],
    client: ['New client record', 'Onboard a corporate, LLP, or individual client with Indian tax registrations.'],
    schedule: ['New Recurring Schedule', 'Configure an automated compliance cycle for GST, TDS, bookkeeping, or ROC.'],
    invoice: ['Raise Tax Invoice', 'Generate a professional fee invoice with standard 18% GST (CGST 9% + SGST 9%).'],
    receipt: ['Record Payment Receipt', 'Log client payment receipt with bank UTR and allocate against open invoice balance.'],
  };
  const [title, description] = titles[mode];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);

    if (mode === 'client') {
      const name = fd.get('name') as string;
      const tradeName = (fd.get('tradeName') as string) || name;
      const type = (fd.get('type') as ClientType) || 'Private Limited';
      const pan = (fd.get('pan') as string)?.toUpperCase() || 'AABCA0000A';
      const gstin = (fd.get('gstin') as string)?.toUpperCase() || '';
      const contactName = fd.get('contactName') as string;
      const phone = fd.get('phone') as string;
      const email = fd.get('email') as string;
      const owner = (fd.get('owner') as string) || 'Priya Desai';
      const fee = fd.get('fee') as string;
      const gstScheme = (fd.get('gstScheme') as 'Regular' | 'QRMP' | 'Composition' | 'Unregistered') || 'Regular';

      const services: string[] = [];
      if (fd.get('enrollGst')) services.push('gst');
      if (fd.get('enrollTds')) services.push('tds');
      if (fd.get('enrollBookkeeping')) services.push('bookkeeping');

      const nextId = `CLI-000${clients.length + 1}`;
      const newClient: ClientRecord = {
        id: nextId,
        name,
        tradeName,
        type,
        industry: 'Professional & Business Services',
        pan,
        gstin,
        gstScheme,
        city: 'Mumbai',
        state: 'Maharashtra',
        contactName,
        contactDesignation: 'Director',
        phone,
        email,
        primaryOwner: owner,
        status: 'Active',
        billingFrequency: 'Monthly',
        recurringFee: fee ? `₹${Number(fee).toLocaleString('en-IN')}` : '₹25,000',
        outstanding: '₹0',
        outstandingAge: 'Current',
        outstandingTone: 'success',
        activeAssignments: services.length > 0 ? 1 : 0,
        pendingDocs: 0,
        onboardedDate: '30/10/2026',
        notes: 'Newly onboarded client with statutory compliance enrolment.',
      };

      onClientCreated(newClient, services, owner);
    } else if (mode === 'assignment') {
      const clientName = (fd.get('clientName') as string) || 'Aster Foods Private Limited';
      const title = (fd.get('title') as string) || 'Statutory Compliance Engagement';
      const service = (fd.get('service') as string) || 'GST Compliance';
      const ownerFull = (fd.get('owner') as string) || 'Priya Desai';
      const firstOwner = ownerFull.split('—')[0] ?? '';
      const owner = (firstOwner.split('·')[0] ?? '').trim() || 'Priya Desai';
      const due = (fd.get('dueDate') as string) || '15/11/2026';
      const scope = (fd.get('scope') as string) || 'Standard audit and compliance fieldwork.';
      const fee = Number(fd.get('fee')) || 25000;

      const nextId = `ASN-000${assignments.length + 1}`;
      const newAsn: AssignmentRow = {
        id: nextId,
        title,
        client: clientName,
        service,
        due,
        owner,
        reviewer: owner === 'S. Narayanan' ? 'S. Narayanan' : owner === 'Ananya Rao' ? 'S. Narayanan' : 'Ananya Rao',
        status: 'In progress',
        progress: 15,
        tone: 'default',
        scope,
        fee,
        billed: false,
        milestones: [
          { title: 'Initial document intake & bank statements obtained', done: true },
          { title: 'Fieldwork verification & ledger scrutiny', done: false },
          { title: 'Managerial quality review', done: false },
          { title: 'Partner final sign-off & dispatch', done: false },
        ],
      };
      onAssignmentCreated(newAsn);
    } else if (mode === 'personal') {
      const title = (fd.get('title') as string) || 'Personal reminder';
      const context = (fd.get('context') as string) || 'Personal';
      const time = (fd.get('time') as string) || 'Today · 16:30';
      const newTsk: PersonalTaskRecord = {
        id: `TSK-P-0${personalTasks.length + 1}`,
        title,
        context,
        time,
        done: false,
        ownerRole: role,
      };
      onPersonalTaskCreated(newTsk);
    } else if (mode === 'delegated') {
      const parent = (fd.get('parent') as string) || 'ASN-0001 · Aster Foods';
      const childTitle = (fd.get('title') as string) || 'Verification sub-task';
      const delegateTo = (fd.get('delegateTo') as string) || 'Neha Kapoor';
      const firstDel = delegateTo.split('—')[0] ?? '';
      const person = (firstDel.split('·')[0] ?? '').trim() || 'Neha Kapoor';
      const due = (fd.get('due') as string) || 'Tomorrow';
      const instructions = (fd.get('instructions') as string) || '';

      const newDel: DelegatedTaskRecord = {
        id: `TSK-D-0${delegatedTasks.length + 1}`,
        title: childTitle,
        parent,
        person,
        assignedBy: ROLE_PEOPLE[role].name,
        due,
        progress: 0,
        status: 'In Progress',
        instructions,
      };
      onDelegatedTaskCreated(newDel);
    } else if (mode === 'invoice') {
      const clientId = fd.get('clientId') as string;
      const targetClient = clients.find((c) => c.id === clientId);
      const desc = fd.get('description') as string;
      const subtotal = Number(fd.get('subtotal')) || 15000;
      const gstAmount = Math.round(subtotal * 0.18);
      const total = subtotal + gstAmount;
      const dueDate = (fd.get('dueDate') as string) || '15/11/2026';

      const nextInvNum = `SN/2026-27/008${invoices.length + 1}`;
      const newInvoice: InvoiceRecord = {
        id: `INV-2026-008${invoices.length + 1}`,
        invoiceNumber: nextInvNum,
        clientId,
        clientName: targetClient?.name || 'Client',
        description: desc,
        invoiceDate: '30/10/2026',
        dueDate,
        subtotal,
        gstAmount,
        total,
        amountReceived: 0,
        balance: total,
        status: 'Unpaid',
        daysOverdue: 0,
      };

      onInvoiceCreated(newInvoice);
    } else if (mode === 'receipt') {
      const clientId = fd.get('clientId') as string;
      const targetClient = clients.find((c) => c.id === clientId);
      const invoiceId = fd.get('invoiceId') as string;
      const targetInv = invoices.find((i) => i.id === invoiceId);
      const amount = Number(fd.get('amount')) || (targetInv ? targetInv.balance : 15000);
      const paymentMode = (fd.get('paymentMode') as PaymentMode) || 'NEFT';
      const referenceNumber = (fd.get('referenceNumber') as string) || 'UTR-0091823';
      const notes = (fd.get('notes') as string) || 'Settlement against open balance.';

      const nextRecNum = `RCP/2026-27/004${invoices.length + 1}`;
      const newReceipt: ReceiptRecord = {
        id: `REC-2026-004${invoices.length + 1}`,
        receiptNumber: nextRecNum,
        clientId,
        clientName: targetClient?.name || 'Client',
        invoiceId,
        invoiceNumber: targetInv?.invoiceNumber || '',
        receiptDate: '30/10/2026',
        amount,
        paymentMode,
        referenceNumber,
        notes,
      };

      onReceiptCreated(newReceipt);
    } else {
      onCreated('Compliance item scheduled');
    }

    onClose();
  }

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-header">
          <div>
            <span className="dialog-icon">
              {mode === 'assignment' ? (
                <BriefcaseBusiness />
              ) : mode === 'delegated' ? (
                <UserRoundCheck />
              ) : mode === 'client' ? (
                <Building2 />
              ) : mode === 'schedule' ? (
                <Repeat2 />
              ) : mode === 'invoice' ? (
                <FileText />
              ) : mode === 'receipt' ? (
                <ReceiptIndianRupee />
              ) : (
                <CalendarClock />
              )}
            </span>
            <div>
              <h2 id="dialog-title">{title}</h2>
              <p>{description}</p>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            {mode === 'assignment' ? (
              <AssignmentFields clients={clients} role={role} />
            ) : mode === 'delegated' ? (
              <DelegationFields role={role} assignments={assignments} />
            ) : mode === 'client' ? (
              <NewClientFields />
            ) : mode === 'schedule' ? (
              <NewScheduleFields />
            ) : mode === 'invoice' ? (
              <NewInvoiceFields clients={clients} presetAssignment={presetAssignment} />
            ) : mode === 'receipt' ? (
              <NewReceiptFields clients={clients} invoices={invoices} presetInvoice={presetInvoice} />
            ) : (
              <PersonalTaskFields />
            )}
          </div>
          <div className="dialog-footer">
            <button className="soft-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              {mode === 'assignment'
                ? 'Create draft'
                : mode === 'delegated'
                ? 'Delegate task'
                : mode === 'client'
                ? 'Create client & activate schedules'
                : mode === 'schedule'
                ? 'Save schedule'
                : mode === 'invoice'
                ? 'Issue Invoice'
                : mode === 'receipt'
                ? 'Record & Allocate Receipt'
                : 'Schedule task'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function NewScheduleFields() {
  return (
    <>
      <Field label="Target client" full>
        <select required defaultValue="">
          <option value="" disabled>Select client</option>
          {CLIENTS.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Schedule title" full>
        <input required placeholder="e.g. GSTR-3B Summary Return & Tax Offset" />
      </Field>
      <Field label="Compliance category">
        <select required defaultValue="GST">
          <option value="GST">GST Compliance</option>
          <option value="TDS">TDS / TCS Compliance</option>
          <option value="Bookkeeping">Bookkeeping & Reconciliations</option>
          <option value="Payroll">Payroll & PF/ESI</option>
          <option value="Audit & ROC">Audit & Statutory ROC</option>
        </select>
      </Field>
      <Field label="Cadence">
        <select required defaultValue="Monthly">
          <option value="Monthly">Monthly</option>
          <option value="Quarterly">Quarterly</option>
          <option value="Annual">Annual</option>
        </select>
      </Field>
      <Field label="Generation trigger day">
        <select required defaultValue="1">
          <option value="1">Day 1 of cycle (recommended)</option>
          <option value="2">Day 2</option>
          <option value="3">Day 3</option>
          <option value="5">Day 5</option>
          <option value="12">Day 12 (post GSTR-2B)</option>
          <option value="15">Day 15</option>
        </select>
      </Field>
      <Field label="Statutory due date rule">
        <input required placeholder="e.g. 20th of every month" defaultValue="11th of every month" />
      </Field>
      <Field label="Default Assignment Owner" full>
        <select required defaultValue="Priya Desai · Senior Staff">
          <option>Priya Desai · Senior Staff</option>
          <option>Rohan Mehta · Staff</option>
          <option>Ananya Rao · Manager</option>
          <option>S. Narayanan · Founder</option>
        </select>
      </Field>
      <Field label="Standard workflow checklist template" full hint="These steps will be instantiated inside every generated assignment.">
        <textarea
          rows={3}
          defaultValue="1. Collect client documentation & registers&#10;2. Validate GSTIN/PAN & statutory limits&#10;3. Generate & review computation pack&#10;4. File return and archive acknowledgment receipt"
        />
      </Field>
    </>
  );
}

function NewClientFields() {
  const [enrollGst, setEnrollGst] = useState(true);
  const [enrollTds, setEnrollTds] = useState(true);
  const [enrollBookkeeping, setEnrollBookkeeping] = useState(false);

  return (
    <>
      <Field label="Client legal name" full>
        <input name="name" required placeholder="e.g. Paramount Logistics Private Limited" />
      </Field>
      <Field label="Trade name / brand">
        <input name="tradeName" placeholder="e.g. Paramount Express" />
      </Field>
      <Field label="Entity type">
        <select name="type" required defaultValue="Private Limited">
          <option>Private Limited</option>
          <option>LLP</option>
          <option>Proprietorship</option>
          <option>Partnership</option>
          <option>Public Limited</option>
          <option>Individual</option>
        </select>
      </Field>
      <Field label="PAN number">
        <input
          name="pan"
          required
          placeholder="e.g. AABCP1234D"
          maxLength={10}
          style={{ textTransform: 'uppercase' }}
        />
      </Field>
      <Field label="Primary GSTIN">
        <input
          name="gstin"
          placeholder="e.g. 27AABCP1234D1Z9"
          maxLength={15}
          style={{ textTransform: 'uppercase' }}
        />
      </Field>
      <Field label="Primary contact name">
        <input name="contactName" required placeholder="e.g. Amit Parekh" />
      </Field>
      <Field label="Contact mobile">
        <input name="phone" required placeholder="+91 98200 11223" />
      </Field>
      <Field label="Contact email" full>
        <input name="email" type="email" placeholder="accounts@paramount.in" />
      </Field>
      <Field label="Relationship Owner / Staff In-Charge">
        <select name="owner" required defaultValue="Priya Desai">
          <option value="Priya Desai">Priya Desai · Senior Staff</option>
          <option value="Rohan Mehta">Rohan Mehta · Staff</option>
          <option value="Ananya Rao">Ananya Rao · Manager</option>
          <option value="S. Narayanan">S. Narayanan · Founder</option>
        </select>
      </Field>
      <Field label="GST Registration Scheme">
        <select name="gstScheme" defaultValue="Regular">
          <option value="Regular">Regular Scheme (Monthly GSTR-1 &amp; GSTR-3B)</option>
          <option value="QRMP">QRMP Scheme (Quarterly Return, Monthly Payment)</option>
          <option value="Composition">Composition Scheme (Quarterly CMP-08 &amp; GSTR-4)</option>
          <option value="Unregistered">Unregistered / Exempt</option>
        </select>
      </Field>
      <Field label="Monthly Accounting Charges (₹)">
        <input name="fee" type="number" defaultValue="25000" />
      </Field>

      <div className="field is-full" style={{ marginTop: 8, padding: '12px', background: 'var(--canvas)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-strong)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Statutory Compliance Mandates (Enrolled Once &amp; Attached to Staff)
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="enrollGst"
              checked={enrollGst}
              onChange={(e) => setEnrollGst(e.target.checked)}
            />
            <span><strong>GST Compliance:</strong> GSTR-1 &amp; GSTR-3B / CMP-08 (Includes prerequisite Bank Reconciliation)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="enrollTds"
              checked={enrollTds}
              onChange={(e) => setEnrollTds(e.target.checked)}
            />
            <span><strong>TDS Compliance:</strong> Monthly Challan 281 &amp; Quarterly Form 26Q returns</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="enrollBookkeeping"
              checked={enrollBookkeeping}
              onChange={(e) => setEnrollBookkeeping(e.target.checked)}
            />
            <span><strong>Monthly Bookkeeping &amp; Ledger Rec</strong> (Rare — select bookkeeping clients only)</span>
          </label>
        </div>
      </div>
    </>
  );
}

function NewInvoiceFields({
  clients,
  presetAssignment,
}: {
  clients: ClientRecord[];
  presetAssignment?: AssignmentRow | null;
}) {
  const matchedClient = presetAssignment
    ? clients.find((c) => c.name.toLowerCase() === presetAssignment.client.toLowerCase())
    : null;
  const initialClientId = matchedClient?.id || clients[0]?.id || '';
  const initialFee = presetAssignment?.fee
    ? parseInt(String(presetAssignment.fee).replace(/[^0-9]/g, ''), 10) || 15000
    : 15000;
  const initialDescription = presetAssignment
    ? `Professional Accounting Charges — ${presetAssignment.title} (${presetAssignment.id})`
    : 'Monthly Accounting Charges & GST Compliance — November 2026';

  const [selectedClient, setSelectedClient] = useState(initialClientId);
  const [description, setDescription] = useState(initialDescription);
  const [subtotal, setSubtotal] = useState(initialFee);
  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;

  return (
    <>
      <Field label="Client entity" full>
        <select
          name="clientId"
          required
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Invoice description / service period" full>
        <input
          name="description"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Professional Fee (₹)">
        <input
          type="number"
          name="subtotal"
          required
          value={subtotal}
          onChange={(e) => setSubtotal(Number(e.target.value))}
        />
      </Field>
      <Field label="GST Rate (18%)">
        <input
          disabled
          value={`₹${gst.toLocaleString('en-IN')} (CGST 9% + SGST 9%)`}
          style={{ background: 'var(--canvas)', color: 'var(--ink)' }}
        />
      </Field>
      <Field label="Total Invoice Amount (₹)">
        <input
          disabled
          value={`₹${total.toLocaleString('en-IN')}`}
          style={{ background: 'var(--canvas)', fontWeight: 800, color: 'var(--brand)' }}
        />
      </Field>
      <Field label="Due date">
        <input type="date" name="dueDate" defaultValue="2026-11-15" required />
      </Field>
    </>
  );
}

function NewReceiptFields({
  clients,
  invoices,
  presetInvoice,
}: {
  clients: ClientRecord[];
  invoices: InvoiceRecord[];
  presetInvoice: InvoiceRecord | null;
}) {
  const [clientId, setClientId] = useState(presetInvoice?.clientId || clients[0]?.id || '');
  const clientInvoices = invoices.filter((i) => i.clientId === clientId && i.balance > 0);
  const [invoiceId, setInvoiceId] = useState(presetInvoice?.id || clientInvoices[0]?.id || '');
  const targetInvoice = invoices.find((i) => i.id === invoiceId);
  const [amount, setAmount] = useState<number>(targetInvoice ? targetInvoice.balance : 15000);

  useEffect(() => {
    if (presetInvoice) {
      setClientId(presetInvoice.clientId);
      setInvoiceId(presetInvoice.id);
      setAmount(presetInvoice.balance);
    }
  }, [presetInvoice]);

  return (
    <>
      <Field label="Client entity" full>
        <select
          name="clientId"
          required
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            const nextInvs = invoices.filter((i) => i.clientId === e.target.value && i.balance > 0);
            const first = nextInvs[0];
            if (first) {
              setInvoiceId(first.id);
              setAmount(first.balance);
            }
          }}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (Outstanding: {c.outstanding})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Allocate against invoice" full>
        <select
          name="invoiceId"
          required
          value={invoiceId}
          onChange={(e) => {
            setInvoiceId(e.target.value);
            const inv = invoices.find((i) => i.id === e.target.value);
            if (inv) setAmount(inv.balance);
          }}
        >
          {clientInvoices.length === 0 ? (
            <option value="">No pending invoices for this client</option>
          ) : (
            clientInvoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoiceNumber} · {inv.description} (Balance: ₹{inv.balance.toLocaleString('en-IN')})
              </option>
            ))
          )}
        </select>
      </Field>
      <Field label="Amount Received (₹)">
        <input
          type="number"
          name="amount"
          required
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </Field>
      <Field label="Payment Mode">
        <select name="paymentMode" required defaultValue="NEFT">
          <option value="NEFT">NEFT Bank Transfer</option>
          <option value="RTGS">RTGS Bank Transfer</option>
          <option value="UPI">UPI Payment</option>
          <option value="Cheque">Account Payee Cheque</option>
          <option value="Cash">Cash (Office Accounts)</option>
        </select>
      </Field>
      <Field label="Bank UTR / Cheque / Ref Number" full>
        <input
          name="referenceNumber"
          required
          placeholder="e.g. HDFC202611019876 or CHQ-002931"
        />
      </Field>
      <Field label="Receipt Notes / Remarks" full>
        <input
          name="notes"
          placeholder="e.g. Full settlement against October GST compliance invoice."
        />
      </Field>
    </>
  );
}

function AssignmentFields({ clients, role }: { clients: ClientRecord[]; role?: CompanyRole }) {
  const defaultOwner = role === 'founder' ? 'S. Narayanan' : role === 'manager' ? 'Ananya Rao' : 'Priya Desai';
  return (
    <>
      <Field label="Client" full>
        <select name="clientName" required defaultValue={clients[0]?.name || ''}>
          {clients.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Assignment title" full>
        <input name="title" required placeholder="e.g. Income Tax Return & Tax Audit Report" />
      </Field>
      <Field label="Service">
        <select name="service" required defaultValue="GST Compliance">
          <option value="GST Compliance">GST Compliance</option>
          <option value="Internal Audit">Internal Audit</option>
          <option value="Statutory Audit">Statutory Audit</option>
          <option value="Bookkeeping">Bookkeeping</option>
          <option value="Tax Compliance">Tax Compliance</option>
          <option value="Direct Tax Advisory">Direct Tax Advisory</option>
        </select>
      </Field>
      <Field label="Assignment Owner">
        <select name="owner" required defaultValue={defaultOwner}>
          <option value="S. Narayanan">S. Narayanan — Founder</option>
          <option value="Ananya Rao">Ananya Rao — Manager</option>
          <option value="Priya Desai">Priya Desai — Senior Staff</option>
          <option value="Rohan Mehta">Rohan Mehta — Staff</option>
        </select>
      </Field>
      <Field label="Target Due date">
        <input name="dueDate" type="text" defaultValue="15/11/2026" required />
      </Field>
      <Field label="Agreed Professional Fee (₹)">
        <input name="fee" type="number" defaultValue="35000" required />
      </Field>
      <Field label="Engagement Scope & Notes" full hint="A database sequence ASN-xxxx will allocate the Assignment code.">
        <textarea name="scope" rows={3} placeholder="Scope of deliverable, client dependencies, and review expectations" />
      </Field>
    </>
  );
}

function PersonalTaskFields() {
  return (
    <>
      <Field label="Task description" full>
        <input name="title" required autoFocus placeholder="e.g. Call Aster Foods accountant for purchase register" />
      </Field>
      <Field label="Link to client or context">
        <input name="context" placeholder="e.g. Aster Foods or ASN-0001" defaultValue="Personal" />
      </Field>
      <Field label="Reminder / Due schedule">
        <input name="time" placeholder="e.g. Today · 16:30" defaultValue="Today · 16:30" />
      </Field>
    </>
  );
}

function DelegationFields({ role, assignments }: { role: CompanyRole; assignments: AssignmentRow[] }) {
  const targets = role === 'staff' ? ['Neha Kapoor — Trainee'] : ['Rohan Mehta — Staff', 'Neha Kapoor — Trainee'];
  return (
    <>
      <Field label="Parent Assignment" full>
        <select name="parent" required defaultValue={assignments[0] ? `${assignments[0].id} · ${assignments[0].title}` : ''}>
          {assignments.map((assignment) => (
            <option key={assignment.id} value={`${assignment.id} · ${assignment.title}`}>
              {assignment.id} · {assignment.title} ({assignment.client})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sub-task title" full>
        <input name="title" required autoFocus placeholder="e.g. Verify portal sales totals against books" />
      </Field>
      <Field label="Delegate to">
        <select name="delegateTo" required defaultValue={targets[0]}>
          {targets.map((target) => (
            <option key={target} value={target}>
              {target}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target completion date">
        <input name="due" type="text" defaultValue="Tomorrow" required />
      </Field>
      <Field label="Instructions & Evidence checklist" full hint="The Assignment Owner remains accountable for final delivery.">
        <textarea name="instructions" rows={3} placeholder="Expected output, evidence required, and verification criteria" />
      </Field>
    </>
  );
}
