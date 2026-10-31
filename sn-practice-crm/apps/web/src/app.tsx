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
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  ReceiptIndianRupee,
  Repeat2,
  Search,
  ShieldCheck,
  TrendingUp,
  UserRoundCheck,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { authorize, type CompanyRole } from '@sn/domain';
import { ApplicationChrome } from './shell/application-chrome';
import { MODULE_DESCRIPTIONS, type PageKey } from './shell/navigation';
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

function Card({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="card-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MoreButton({ label = 'More options' }: { label?: string }) {
  return (
    <button className="card-menu" type="button" aria-label={label}>
      <MoreHorizontal aria-hidden="true" />
    </button>
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

function AssignmentsTable({
  title,
  rows,
  onToast,
  onSelectAssignment,
  onNavigate,
  compact = false,
  canEdit = false,
}: {
  title: string;
  rows: AssignmentRow[];
  onToast: (message: string) => void;
  onSelectAssignment?: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
  compact?: boolean;
  canEdit?: boolean;
}) {
  return (
    <Card
      title={title}
      description="Sorted by deadline, statutory risk, and dependency"
      className={`table-card ${compact ? 'is-compact' : ''}`}
      action={
        <button
          className="text-button"
          type="button"
          onClick={() => (onNavigate ? onNavigate('Assignments') : onToast('Assignments workspace opened'))}
        >
          View all <ChevronRight aria-hidden="true" />
        </button>
      }
    >
      <div className="table-scroll">
        <table>
          <thead><tr><th>Assignment</th><th>Client</th><th>Due</th><th>Status</th><th>Progress</th><th>Owner</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <button
                    className="assignment-link"
                    type="button"
                    onClick={() => {
                      if (onSelectAssignment) onSelectAssignment(row);
                      else onToast(`${row.id} opened`);
                    }}
                  >
                    <strong>{row.title}</strong>
                    <small>{row.id} · {row.service}</small>
                  </button>
                </td>
                <td>{row.client}</td>
                <td className={row.due === 'Today' ? 'is-danger-text' : ''}>{row.due}</td>
                <td><Status tone={row.tone}>{row.status}</Status></td>
                <td><div className="table-progress"><i><b style={{ width: `${row.progress}%` }} /></i><span>{row.progress}%</span></div></td>
                <td>{row.owner}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      className="row-button"
                      type="button"
                      aria-label={`Open ${row.id}`}
                      onClick={() => {
                        if (onSelectAssignment) onSelectAssignment(row);
                        else onToast(`${row.id} details opened`);
                      }}
                    >
                      <ChevronRight aria-hidden="true" />
                    </button>
                    {canEdit && onSelectAssignment ? (
                      <button
                        className="icon-button"
                        type="button"
                        title={`Edit ${row.id}`}
                        aria-label={`Edit ${row.id}`}
                        style={{ width: 28, height: 28 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAssignment(row);
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Status({ tone = 'default', children }: { tone?: AssignmentTone; children: ReactNode }) {
  return <span className={`status tone-${tone}`}>{children}</span>;
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
          clients={clients}
          schedules={schedules}
          invoices={invoices}
          receipts={receipts}
          onToast={onToast}
          onCompose={onCompose}
          onRecordPaymentForInvoice={onRecordPaymentForInvoice}
          onUpdateClient={onUpdateClient}
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
          invoices={invoices}
          receipts={receipts}
          clients={clients}
          onToast={onToast}
          onCompose={onCompose}
          onRecordPaymentForInvoice={onRecordPaymentForInvoice}
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

function ClientsWorkspace({
  role,
  clients,
  schedules,
  invoices,
  receipts,
  onToast,
  onCompose,
  onRecordPaymentForInvoice,
  onUpdateClient,
}: {
  role: CompanyRole;
  clients: ClientRecord[];
  schedules: RecurringScheduleRecord[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  onToast: (message: string) => void;
  onCompose: (mode: DialogMode) => void;
  onRecordPaymentForInvoice: (inv: InvoiceRecord) => void;
  onUpdateClient?: (updated: ClientRecord) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [selectedClient, setSelectedClient] = useState<ClientRecord | null>(null);
  const [startInEditMode, setStartInEditMode] = useState(false);

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const q = search.toLowerCase();
      const matchSearch =
        c.name.toLowerCase().includes(q) ||
        c.tradeName.toLowerCase().includes(q) ||
        c.pan.toLowerCase().includes(q) ||
        c.gstin.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q);
      const matchType = typeFilter === 'All' || c.type === typeFilter;
      return matchSearch && matchType;
    });
  }, [clients, search, typeFilter]);

  const leadership = role === 'founder' || role === 'manager';

  return (
    <div className="client-workspace">
      <section className="workspace-stats-grid">
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Total Active Clients</span>
            <strong>48</strong>
            <small>6 currently in active view</small>
          </div>
          <span className="workspace-stat-icon">
            <Building2 aria-hidden="true" />
          </span>
        </article>
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Active GST Filers</span>
            <strong>38</strong>
            <small>October filings due in 4 days</small>
          </div>
          <span className="workspace-stat-icon stat-success">
            <CheckCircle2 aria-hidden="true" />
          </span>
        </article>
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Awaited Documents</span>
            <strong>12</strong>
            <small>5 client dependencies overdue</small>
          </div>
          <span className="workspace-stat-icon stat-warning">
            <Files aria-hidden="true" />
          </span>
        </article>
        <article className="workspace-stat-card">
          <div className="workspace-stat-info">
            <span>Practice Outstanding</span>
            <strong>₹1,21,750</strong>
            <small>₹88,500 over 60 days overdue</small>
          </div>
          <span className="workspace-stat-icon stat-gold">
            <IndianRupee aria-hidden="true" />
          </span>
        </article>
      </section>

      <div className="client-toolbar">
        <div className="client-search-wrap">
          <Search aria-hidden="true" />
          <input
            className="client-search-input"
            type="search"
            placeholder="Search by client name, PAN, GSTIN, trade name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="client-filter-group">
          <select
            className="client-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by entity type"
          >
            <option value="All">All entity types</option>
            <option value="Private Limited">Private Limited</option>
            <option value="LLP">LLP</option>
            <option value="Proprietorship">Proprietorship</option>
            <option value="Partnership">Partnership</option>
            <option value="Public Limited">Public Limited</option>
          </select>
          {leadership ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => onCompose('client')}
            >
              <Plus aria-hidden="true" /> Add client
            </button>
          ) : null}
        </div>
      </div>

      <Card
        title="Client directory"
        description={`${filtered.length} entities matching current filter · Click row to open profile drawer`}
        action={<MoreButton />}
        className="table-card"
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Client / Trade Name</th>
                <th>Entity Type</th>
                <th>Tax IDs</th>
                <th>Relationship Owner</th>
                <th>Active Work</th>
                <th>Accounting Charges / Cadence</th>
                <th>Outstanding</th>
                <th>Profile</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => {
                const entityClass =
                  client.type === 'Private Limited'
                    ? 'entity-pvt-ltd'
                    : client.type === 'LLP'
                    ? 'entity-llp'
                    : client.type === 'Proprietorship'
                    ? 'entity-prop'
                    : client.type === 'Partnership'
                    ? 'entity-partnership'
                    : client.type === 'Public Limited'
                    ? 'entity-public-ltd'
                    : 'entity-individual';

                return (
                  <tr
                    key={client.id}
                    className="interactive-row"
                    onClick={() => {
                      setSelectedClient(client);
                      setStartInEditMode(false);
                    }}
                  >
                    <td>
                      <div>
                        <strong>{client.name}</strong>
                        <small className="table-secondary">{client.tradeName} · {client.city}</small>
                      </div>
                    </td>
                    <td>
                      <span className={`entity-badge ${entityClass}`}>{client.type}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <span className="tax-id-chip">{client.pan}</span>
                        <span className="tax-id-chip" style={{ color: 'var(--ink-muted)' }}>{client.gstin}</span>
                      </div>
                    </td>
                    <td>
                      <span>{client.primaryOwner}</span>
                    </td>
                    <td>
                      <span className="status tone-default">
                        {client.activeAssignments} active
                      </span>
                    </td>
                    <td>
                      <div>
                        <strong>{client.recurringFee}</strong>
                        <small className="table-secondary">{client.billingFrequency}</small>
                      </div>
                    </td>
                    <td>
                      <div>
                        <strong className={`tone-${client.outstandingTone}`}>{client.outstanding}</strong>
                        <small className="table-secondary">{client.outstandingAge}</small>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          className="text-button"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClient(client);
                            setStartInEditMode(false);
                          }}
                        >
                          View <ChevronRight aria-hidden="true" />
                        </button>
                        {leadership ? (
                          <button
                            className="icon-button"
                            type="button"
                            title={`Edit ${client.name}`}
                            aria-label={`Edit ${client.name}`}
                            style={{ width: 28, height: 28 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedClient(client);
                              setStartInEditMode(true);
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedClient ? (
        <ClientProfileDrawer
          client={selectedClient}
          schedules={schedules}
          leadership={leadership}
          role={role}
          invoices={invoices}
          receipts={receipts}
          onClose={() => {
            setSelectedClient(null);
            setStartInEditMode(false);
          }}
          onToast={onToast}
          onCompose={onCompose}
          onRecordPaymentForInvoice={onRecordPaymentForInvoice}
          onUpdateClient={(updated) => {
            setSelectedClient(updated);
            if (onUpdateClient) onUpdateClient(updated);
          }}
          initialEditing={startInEditMode}
        />
      ) : null}
    </div>
  );
}

function ClientProfileDrawer({
  client,
  schedules,
  leadership,
  role,
  invoices,
  receipts,
  onClose,
  onToast,
  onCompose,
  onRecordPaymentForInvoice,
  onUpdateClient,
  initialEditing = false,
}: {
  client: ClientRecord;
  schedules: RecurringScheduleRecord[];
  leadership: boolean;
  role?: CompanyRole;
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onCompose: (mode: DialogMode) => void;
  onRecordPaymentForInvoice: (inv: InvoiceRecord) => void;
  onUpdateClient?: (updated: ClientRecord) => void;
  initialEditing?: boolean;
}) {
  const canFullEdit = role === 'founder' || role === 'manager';
  const [tab, setTab] = useState<'overview' | 'kyc' | 'schedules' | 'work' | 'billing'>('overview');
  const [isEditing, setIsEditing] = useState(initialEditing);

  const [editName, setEditName] = useState(client.name);
  const [editTradeName, setEditTradeName] = useState(client.tradeName);
  const [editType, setEditType] = useState<ClientType>(client.type);
  const [editIndustry, setEditIndustry] = useState(client.industry);
  const [editCity, setEditCity] = useState(client.city);
  const [editState, setEditState] = useState(client.state);
  const [editPan, setEditPan] = useState(client.pan);
  const [editGstin, setEditGstin] = useState(client.gstin);
  const [editGstScheme, setEditGstScheme] = useState<'Regular' | 'QRMP' | 'Composition' | 'Unregistered'>(client.gstScheme || 'Regular');
  const [editCin, setEditCin] = useState(client.cin || '');
  const [editTan, setEditTan] = useState(client.tan || '');
  const [editContactName, setEditContactName] = useState(client.contactName);
  const [editContactDesignation, setEditContactDesignation] = useState(client.contactDesignation);
  const [editPhone, setEditPhone] = useState(client.phone);
  const [editEmail, setEditEmail] = useState(client.email);
  const [editOwner, setEditOwner] = useState(client.primaryOwner);
  const [editStatus, setEditStatus] = useState(client.status);
  const [editBillingFreq, setEditBillingFreq] = useState<'Monthly' | 'Quarterly' | 'Annual'>(client.billingFrequency);
  const [editRecurringFee, setEditRecurringFee] = useState(
    parseInt(client.recurringFee.replace(/[^0-9]/g, ''), 10) || 25000
  );
  const [editNotes, setEditNotes] = useState(client.notes || '');
  const [editBankStatementReq, setEditBankStatementReq] = useState<boolean>(client.bankStatementRequired !== false);

  useEffect(() => {
    setEditName(client.name);
    setEditTradeName(client.tradeName);
    setEditType(client.type);
    setEditIndustry(client.industry);
    setEditCity(client.city);
    setEditState(client.state);
    setEditPan(client.pan);
    setEditGstin(client.gstin);
    setEditGstScheme(client.gstScheme || 'Regular');
    setEditCin(client.cin || '');
    setEditTan(client.tan || '');
    setEditContactName(client.contactName);
    setEditContactDesignation(client.contactDesignation);
    setEditPhone(client.phone);
    setEditEmail(client.email);
    setEditOwner(client.primaryOwner);
    setEditStatus(client.status);
    setEditBillingFreq(client.billingFrequency);
    setEditRecurringFee(parseInt(client.recurringFee.replace(/[^0-9]/g, ''), 10) || 25000);
    setEditNotes(client.notes || '');
    setEditBankStatementReq(client.bankStatementRequired !== false);
    setIsEditing(initialEditing);
  }, [client, initialEditing]);

  function handleSave(e?: FormEvent) {
    if (e) e.preventDefault();
    const updatedClient: ClientRecord = {
      ...client,
      name: editName.trim() || client.name,
      tradeName: editTradeName.trim() || client.tradeName,
      type: editType,
      industry: editIndustry.trim() || client.industry,
      city: editCity.trim() || client.city,
      state: editState.trim() || client.state,
      pan: editPan.trim().toUpperCase() || client.pan,
      gstin: editGstin.trim().toUpperCase() || client.gstin,
      gstScheme: editGstScheme,
      cin: editCin.trim() || undefined,
      tan: editTan.trim().toUpperCase() || undefined,
      contactName: editContactName.trim() || client.contactName,
      contactDesignation: editContactDesignation.trim() || client.contactDesignation,
      phone: editPhone.trim() || client.phone,
      email: editEmail.trim() || client.email,
      primaryOwner: editOwner,
      status: editStatus,
      billingFrequency: editBillingFreq,
      recurringFee: `₹${editRecurringFee.toLocaleString('en-IN')}`,
      notes: editNotes.trim(),
      bankStatementRequired: editBankStatementReq,
      hasBankAccount: editBankStatementReq,
    };

    if (onUpdateClient) {
      onUpdateClient(updatedClient);
    }
    setIsEditing(false);
  }

  const clientAssignments = useMemo(() => {
    return ASSIGNMENTS.filter(
      (a) =>
        a.client.toLowerCase().includes(client.tradeName.toLowerCase()) ||
        a.client.toLowerCase().includes(client.name.toLowerCase())
    );
  }, [client]);

  const clientSchedules = useMemo(() => {
    return schedules.filter((s) => s.clientId === client.id);
  }, [client, schedules]);

  const clientInvoices = useMemo(() => {
    return invoices.filter((i) => i.clientId === client.id);
  }, [invoices, client.id]);

  const clientReceipts = useMemo(() => {
    return receipts.filter((r) => r.clientId === client.id);
  }, [receipts, client.id]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Client details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{client.name.substring(0, 2).toUpperCase()}</span>
            <div>
              <h2>{client.name}</h2>
              <p>{client.tradeName} · {client.type} · {client.city}, {client.state}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canFullEdit ? (
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                style={{ fontSize: 11, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Pencil size={12} /> {isEditing ? 'Cancel Edit' : 'Edit Details'}
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
              className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              className={`drawer-tab ${tab === 'kyc' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('kyc')}
            >
              Registrations & KYC
            </button>
            <button
              className={`drawer-tab ${tab === 'schedules' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('schedules')}
            >
              Compliance Schedules ({clientSchedules.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'work' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('work')}
            >
              Active Work ({clientAssignments.length})
            </button>
            <button
              className={`drawer-tab ${tab === 'billing' ? 'is-active' : ''}`}
              type="button"
              onClick={() => setTab('billing')}
            >
              Billing & Accounting Charges
            </button>
          </nav>
        ) : null}

        <div className="drawer-content">
          {isEditing ? (
            <form id="client-edit-form" onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'var(--canvas)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Edit Client Profile · {client.id}
                </span>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Update statutory registrations, entity classification, staff assignment, and contact info.
                </p>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Entity &amp; Business Information</h4>
                <div className="form-grid">
                  <Field label="Legal Entity Name" full>
                    <input
                      required
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Aster Foods Private Limited"
                    />
                  </Field>
                  <Field label="Trade Name / Brand">
                    <input
                      value={editTradeName}
                      onChange={(e) => setEditTradeName(e.target.value)}
                      placeholder="e.g. Aster Foods"
                    />
                  </Field>
                  <Field label="Entity Type">
                    <select
                      value={editType}
                      onChange={(e) => setEditType(e.target.value as ClientType)}
                    >
                      <option value="Private Limited">Private Limited</option>
                      <option value="LLP">LLP</option>
                      <option value="Proprietorship">Proprietorship</option>
                      <option value="Partnership">Partnership</option>
                      <option value="Public Limited">Public Limited</option>
                      <option value="Individual">Individual</option>
                    </select>
                  </Field>
                  <Field label="City">
                    <input
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      placeholder="e.g. Mumbai"
                    />
                  </Field>
                  <Field label="State">
                    <input
                      value={editState}
                      onChange={(e) => setEditState(e.target.value)}
                      placeholder="e.g. Maharashtra"
                    />
                  </Field>
                  <Field label="Industry / Sector" full>
                    <input
                      value={editIndustry}
                      onChange={(e) => setEditIndustry(e.target.value)}
                      placeholder="e.g. FMCG & Food Processing"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Statutory Registrations &amp; GST Scheme</h4>
                <div className="form-grid">
                  <Field label="PAN Number">
                    <input
                      required
                      maxLength={10}
                      value={editPan}
                      onChange={(e) => setEditPan(e.target.value.toUpperCase())}
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Field>
                  <Field label="Primary GSTIN">
                    <input
                      maxLength={15}
                      value={editGstin}
                      onChange={(e) => setEditGstin(e.target.value.toUpperCase())}
                      style={{ textTransform: 'uppercase' }}
                    />
                  </Field>
                  <Field label="GST Registration Scheme" full>
                    <select
                      value={editGstScheme}
                      onChange={(e) => setEditGstScheme(e.target.value as any)}
                    >
                      <option value="Regular">Regular Scheme (Monthly GSTR-1 &amp; GSTR-3B)</option>
                      <option value="QRMP">QRMP Scheme (Quarterly Return, Monthly PMT-06)</option>
                      <option value="Composition">Composition Scheme (Quarterly CMP-08 &amp; GSTR-4)</option>
                      <option value="Unregistered">Unregistered / Exempt</option>
                    </select>
                  </Field>
                  <Field label="CIN (Corporate ID)">
                    <input
                      value={editCin}
                      onChange={(e) => setEditCin(e.target.value.toUpperCase())}
                      placeholder="e.g. U01111MH2021PTC123456"
                    />
                  </Field>
                  <Field label="TAN Number">
                    <input
                      value={editTan}
                      onChange={(e) => setEditTan(e.target.value.toUpperCase())}
                      placeholder="e.g. MUMA12345D"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Relationship &amp; Commercials</h4>
                <div className="form-grid">
                  <Field label="Staff In-Charge">
                    <select
                      value={editOwner}
                      onChange={(e) => setEditOwner(e.target.value)}
                    >
                      <option value="S. Narayanan">S. Narayanan · Founder</option>
                      <option value="Ananya Rao">Ananya Rao · Manager</option>
                      <option value="Priya Desai">Priya Desai · Senior Staff</option>
                      <option value="Rohan Mehta">Rohan Mehta · Staff</option>
                    </select>
                  </Field>
                  <Field label="Relationship Status">
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                    >
                      <option value="Active">Active</option>
                      <option value="Review required">Review required</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </Field>
                  <Field label="Monthly Accounting Charges (₹)">
                    <input
                      type="number"
                      value={editRecurringFee}
                      onChange={(e) => setEditRecurringFee(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Billing Cadence">
                    <select
                      value={editBillingFreq}
                      onChange={(e) => setEditBillingFreq(e.target.value as any)}
                    >
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Annual">Annual</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Primary Contact</h4>
                <div className="form-grid">
                  <Field label="Contact Person Name">
                    <input
                      value={editContactName}
                      onChange={(e) => setEditContactName(e.target.value)}
                      placeholder="e.g. Rajesh Kumar"
                    />
                  </Field>
                  <Field label="Designation">
                    <input
                      value={editContactDesignation}
                      onChange={(e) => setEditContactDesignation(e.target.value)}
                      placeholder="e.g. Chief Financial Officer"
                    />
                  </Field>
                  <Field label="Mobile / WhatsApp">
                    <input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      placeholder="e.g. +91 98200 12345"
                    />
                  </Field>
                  <Field label="Email Address">
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="e.g. rajesh@asterfoods.in"
                    />
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 6 }}>Banking &amp; GST Reconciliation</h4>
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-muted)' }}>
                  Some clients do not operate through bank accounts or file cash-only returns. Setting this to "No" marks bank reconciliation as Not Applicable on GST filings.
                </p>
                <div className="form-grid">
                  <Field label="Bank Statement Required for GST Return Filing?" full>
                    <select
                      value={editBankStatementReq ? 'yes' : 'no'}
                      onChange={(e) => setEditBankStatementReq(e.target.value === 'yes')}
                    >
                      <option value="yes">Yes — Mandatory bank statement &amp; reconciliation before filing</option>
                      <option value="no">No — Not Applicable (Client has no bank operations / cash-only filing)</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="drawer-card" style={{ padding: 14 }}>
                <h4 style={{ marginBottom: 10 }}>Engagement Notes</h4>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Internal audit notes, client billing terms, or special compliance instructions"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
                />
              </div>
            </form>
          ) : (
            <>
          {tab === 'overview' ? (
            <>
              <div className="drawer-card">
                <h4>Primary Contact</h4>
                <div className="drawer-grid">
                  <div className="drawer-item">
                    <span className="drawer-label">Contact Person</span>
                    <span className="drawer-val">{client.contactName}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Designation</span>
                    <span className="drawer-val">{client.contactDesignation}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Mobile</span>
                    <span className="drawer-val">{client.phone}</span>
                  </div>
                  <div className="drawer-item">
                    <span className="drawer-label">Email</span>
                    <span className="drawer-val">{client.email}</span>
                  </div>
                </div>
                <div className="drawer-contact-actions">
                  <a className="contact-action-btn" href={`tel:${client.phone}`}>
                    <Phone size={12} /> Call
                  </a>
                  <a className="contact-action-btn" href={`mailto:${client.email}`}>
                    <Mail size={12} /> Email
                  </a>
                </div>
              </div>

              {/* Banking Status & GST Return Workflow Toggle Card (Editable by Staff & Leadership) */}
              <div className="drawer-card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <h4 style={{ margin: '0 0 4px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 size={15} color="var(--brand)" />
                      Banking Operations &amp; GST Return Workflow
                    </h4>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
                      {client.bankStatementRequired === false
                        ? 'Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are excluded from the GST return filing workflow.'
                        : 'Client operates active bank account(s). Bank statement receipt and bank reconciliation are active steps in monthly GST compliance.'}
                    </p>
                  </div>
                  <span
                    className="filing-chip"
                    style={{
                      whiteSpace: 'nowrap',
                      background: client.bankStatementRequired === false ? 'var(--canvas)' : '#ecfdf5',
                      color: client.bankStatementRequired === false ? 'var(--ink-muted)' : '#059669',
                      border: `1px solid ${client.bankStatementRequired === false ? 'var(--border)' : '#a7f3d0'}`,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                    }}
                  >
                    {client.bankStatementRequired === false ? '— No Bank (Excluded)' : '✓ Active Bank'}
                  </span>
                </div>

                {role !== 'trainee' ? (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      {role === 'staff' || role === 'senior_staff' ? 'Staff banking toggle (fieldwork scope):' : 'Banking status toggle:'}
                    </span>
                    <button
                      type="button"
                      className={client.bankStatementRequired === false ? 'primary-button' : 'soft-button'}
                      style={{ fontSize: 11, padding: '5px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={() => {
                        const nextVal = client.bankStatementRequired === false ? true : false;
                        const updatedClient: ClientRecord = {
                          ...client,
                          bankStatementRequired: nextVal,
                          hasBankAccount: nextVal,
                        };
                        if (onUpdateClient) onUpdateClient(updatedClient);
                        onToast(
                          nextVal
                            ? `Enabled bank operations for ${client.tradeName}. Added banking steps to GST filing workflow.`
                            : `Set ${client.tradeName} to No Bank. Banking steps excluded from GST return filing workflow.`
                        );
                      }}
                    >
                      <Building2 size={12} />
                      {client.bankStatementRequired === false ? 'Enable Active Bank & Workflow' : 'Toggle to No Bank (Exclude Banking)'}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Industry</span>
                  <span className="drawer-val">{client.industry}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Relationship Manager</span>
                  <span className="drawer-val">{client.primaryOwner}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Bank Rec for GST</span>
                  <span className="drawer-val">
                    {client.bankStatementRequired === false ? (
                      <span className="category-tag" style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 8px' }}>
                        Excluded from Workflow (No Bank)
                      </span>
                    ) : (
                      <span style={{ color: '#01b574', fontWeight: 600 }}>Required (Standard)</span>
                    )}
                  </span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Compliance Status</span>
                  <span className="drawer-val">{client.status}</span>
                </div>
                <div className="drawer-item full-width">
                  <span className="drawer-label">Internal Practice Notes</span>
                  <span className="drawer-val" style={{ fontWeight: 400, color: 'var(--ink)' }}>{client.notes}</span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'kyc' ? (
            <div className="drawer-grid">
              <div className="drawer-item full-width">
                <span className="drawer-label">Permanent Account Number (PAN)</span>
                <span className="tax-id-chip" style={{ fontSize: 13, alignSelf: 'flex-start', padding: '4px 8px' }}>
                  {client.pan}
                </span>
              </div>
              <div className="drawer-item full-width">
                <span className="drawer-label">Primary Goods & Services Tax ID (GSTIN)</span>
                <span className="tax-id-chip" style={{ fontSize: 13, alignSelf: 'flex-start', padding: '4px 8px' }}>
                  {client.gstin}
                </span>
              </div>
              {client.cin ? (
                <div className="drawer-item full-width">
                  <span className="drawer-label">Corporate Identification Number (CIN)</span>
                  <span className="tax-id-chip" style={{ fontSize: 12, alignSelf: 'flex-start', padding: '4px 8px' }}>
                    {client.cin}
                  </span>
                </div>
              ) : null}
              {client.tan ? (
                <div className="drawer-item full-width">
                  <span className="drawer-label">Tax Deduction Account Number (TAN)</span>
                  <span className="tax-id-chip" style={{ fontSize: 12, alignSelf: 'flex-start', padding: '4px 8px' }}>
                    {client.tan}
                  </span>
                </div>
              ) : null}
              <div className="drawer-item">
                <span className="drawer-label">State Jurisdiction</span>
                <span className="drawer-val">{client.state}</span>
              </div>
              <div className="drawer-item">
                <span className="drawer-label">GST Filing Scheme</span>
                <span className="drawer-val" style={{ fontWeight: 600, color: 'var(--brand)' }}>
                  {client.gstScheme === 'Composition'
                    ? 'Composition Scheme (Quarterly CMP-08)'
                    : client.gstScheme === 'QRMP'
                    ? 'QRMP Scheme (Quarterly Return, Monthly Payment)'
                    : 'Regular Scheme (Monthly GSTR-1 & 3B)'}
                </span>
              </div>
            </div>
          ) : null}

          {tab === 'schedules' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-strong)' }}>
                  Assigned Compliance Mandates ({clientSchedules.length})
                </span>
                {leadership ? (
                  <button
                    className="soft-button"
                    type="button"
                    style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={() => onCompose('schedule')}
                  >
                    <Plus size={12} /> Add schedule
                  </button>
                ) : null}
              </div>

              {clientSchedules.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                  No standing compliance schedules configured for this client yet.
                </p>
              ) : (
                clientSchedules.map((s) => (
                  <div key={s.id} className="drawer-card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ fontSize: 13, color: 'var(--ink-strong)' }}>{s.title}</strong>
                          <span className={`category-tag cat-${s.category.toLowerCase().replace(/[^a-z]/g, '')}`}>{s.category}</span>
                        </div>
                        <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>
                          {s.cadence} · Due: {s.statutoryDueDay}
                        </p>
                      </div>
                      <span className={`filing-chip ${
                        s.currentStatus === 'Ready to File'
                          ? 'is-ready'
                          : s.currentStatus === 'Docs Awaited'
                          ? 'is-awaited'
                          : s.currentStatus === 'Bank Statement Received' || s.currentStatus === 'Filed'
                          ? 'is-done'
                          : 'is-pending'
                      }`}>
                        {s.currentStatus || 'Active'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, background: 'var(--canvas)', padding: 10, borderRadius: 10, fontSize: 11 }}>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: 10 }}>Staff In-Charge</span>
                        <strong style={{ color: 'var(--ink-strong)' }}>{s.defaultOwner}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--ink-muted)', display: 'block', fontSize: 10 }}>Bank Reconciliation</span>
                        <span style={{ fontWeight: 600, color: s.bankRecStatus === 'Completed' ? 'var(--success)' : s.bankRecStatus === 'In progress' ? '#b45309' : s.bankRecStatus === 'Awaited' ? '#2563eb' : 'var(--ink)' }}>
                          {s.bankRecStatus === 'Completed' ? '✓ Reconciled' : s.bankRecStatus === 'In progress' ? '⏳ In progress' : s.bankRecStatus === 'Awaited' ? '⚠️ Statement Awaited' : '—'}
                        </span>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Checklist Steps ({s.checklistTemplate.length})
                      </span>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--ink)' }}>
                        {s.checklistTemplate.map((step, idx) => (
                          <li key={idx} style={{ marginBottom: 3 }}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === 'work' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {clientAssignments.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No assignments currently linked to this client.</p>
              ) : (
                clientAssignments.map((a) => (
                  <div key={a.id} className="drawer-card" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <strong style={{ fontSize: 13, color: 'var(--ink-strong)' }}>{a.title}</strong>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>{a.service} · Due {a.due}</p>
                      </div>
                      <Status tone={a.tone}>{a.status}</Status>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: 'var(--ink-muted)', width: 45 }}>{a.progress}%</span>
                      <i style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', display: 'block' }}>
                        <b style={{ width: `${a.progress}%`, height: '100%', background: 'var(--brand)', display: 'block' }} />
                      </i>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === 'billing' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Accounting Charges</span>
                  <span className="drawer-val" style={{ fontSize: 16 }}>{client.recurringFee}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Billing Cadence</span>
                  <span className="drawer-val">{client.billingFrequency}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Current Outstanding</span>
                  <span className={`drawer-val tone-${client.outstandingTone}`} style={{ fontSize: 16 }}>
                    {client.outstanding}
                  </span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Aging</span>
                  <span className="drawer-val">{client.outstandingAge}</span>
                </div>
              </div>

              {/* Invoices List */}
              <div className="drawer-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={14} color="var(--brand)" />
                    <strong style={{ fontSize: 12, color: 'var(--ink-strong)' }}>
                      Tax Invoices ({clientInvoices.length})
                    </strong>
                  </div>
                  {leadership ? (
                    <button
                      className="soft-button"
                      type="button"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => {
                        onClose();
                        onCompose('invoice');
                      }}
                    >
                      <Plus size={12} /> Raise invoice
                    </button>
                  ) : null}
                </div>

                {clientInvoices.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
                    No tax invoices issued for this client yet.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Invoice #</th>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Total</th>
                          <th>Balance</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientInvoices.map((inv) => (
                          <tr key={inv.id}>
                            <td>
                              <strong style={{ fontSize: 11, color: 'var(--ink-strong)' }}>{inv.invoiceNumber}</strong>
                            </td>
                            <td><span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{inv.invoiceDate}</span></td>
                            <td><span style={{ fontSize: 11 }}>{inv.description}</span></td>
                            <td><strong style={{ fontSize: 11 }}>{formatINR(inv.total)}</strong></td>
                            <td>
                              <span style={{ fontSize: 11, fontWeight: inv.balance > 0 ? 600 : 400, color: inv.balance > 0 ? '#ee5d50' : 'var(--ink-muted)' }}>
                                {formatINR(inv.balance)}
                              </span>
                            </td>
                            <td>
                              <span className={`invoice-chip is-${inv.status.toLowerCase().replace(/[^a-z]/g, '')}`} style={{ fontSize: 10 }}>
                                {inv.status}
                              </span>
                            </td>
                            <td>
                              {inv.balance > 0 ? (
                                <button
                                  className="primary-button"
                                  type="button"
                                  style={{ fontSize: 10, padding: '3px 8px', whiteSpace: 'nowrap' }}
                                  onClick={() => {
                                    onClose();
                                    onRecordPaymentForInvoice(inv);
                                  }}
                                >
                                  Record Receipt
                                </button>
                              ) : (
                                <span style={{ fontSize: 11, color: '#01b574', fontWeight: 600 }}>Settled</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Receipts & Payments Register */}
              <div className="drawer-card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ReceiptIndianRupee size={14} color="#01b574" />
                    <strong style={{ fontSize: 12, color: 'var(--ink-strong)' }}>
                      Payment Receipts ({clientReceipts.length})
                    </strong>
                  </div>
                  <button
                    className="soft-button"
                    type="button"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => {
                      onClose();
                      const openInv = clientInvoices.find((i) => i.balance > 0);
                      if (openInv) onRecordPaymentForInvoice(openInv);
                      else onCompose('receipt');
                    }}
                  >
                    <Plus size={12} /> Record Receipt
                  </button>
                </div>

                {clientReceipts.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>
                    No payment receipts recorded for this FY yet.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Receipt #</th>
                          <th>Date</th>
                          <th>Mode</th>
                          <th>Bank Ref / UTR</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientReceipts.map((rec) => (
                          <tr key={rec.id}>
                            <td>
                              <strong style={{ fontSize: 11, color: 'var(--ink-strong)' }}>{rec.receiptNumber}</strong>
                            </td>
                            <td><span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{rec.receiptDate}</span></td>
                            <td>
                              <span className="category-tag cat-gst" style={{ fontSize: 9, padding: '2px 6px' }}>
                                {rec.paymentMode}
                              </span>
                            </td>
                            <td>
                              <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--ink)' }}>
                                {rec.referenceNumber}
                              </span>
                            </td>
                            <td>
                              <strong style={{ fontSize: 11, color: '#01b574' }}>{formatINR(rec.amount)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
            </>
          )}
        </div>

        <div className="drawer-footer">
          {isEditing ? (
            <>
              <button
                className="soft-button"
                type="button"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="submit"
                form="client-edit-form"
                onClick={() => handleSave()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Check size={14} /> Save Changes
              </button>
            </>
          ) : (
            <>
              {leadership ? (
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    onClose();
                    onCompose('assignment');
                  }}
                >
                  <Plus size={14} /> New assignment
                </button>
              ) : null}
              <button
                className="soft-button"
                type="button"
                onClick={() => {
                  onClose();
                  onToast(`Document request notice issued to ${client.tradeName}`);
                }}
              >
                <Files size={14} /> Request docs
              </button>
            </>
          )}
        </div>
      </aside>
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

function AssignmentsWorkspace({
  role,
  schedules,
  assignments,
  onToast,
  onCompose,
  onUpdateSchedule,
  onUpdateAssignment,
  onSelectAssignment,
}: {
  role: CompanyRole;
  schedules: RecurringScheduleRecord[];
  assignments: AssignmentRow[];
  onToast: (message: string) => void;
  onCompose: (mode: DialogMode) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
}) {
  const [activeTab, setActiveTab] = useState<'compliance' | 'oneoff'>('compliance');
  const [staffFilter, setStaffFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | 'GST' | 'TDS' | 'Bookkeeping'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Bank Rec Needed' | 'Docs Awaited' | 'Ready to File' | 'Filed'>('All');
  const [search, setSearch] = useState('');
  const [selectedSchedule, setSelectedSchedule] = useState<RecurringScheduleRecord | null>(null);

  const person = ROLE_PEOPLE[role];
  const leadership = role === 'founder' || role === 'manager';
  const myAssignedStaffName = person.name;

  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      // 1. Staff filtering: staff only see their assigned clients unless leadership
      if (!leadership) {
        if (s.defaultOwner !== myAssignedStaffName) return false;
      } else if (staffFilter !== 'All') {
        if (s.defaultOwner !== staffFilter) return false;
      }

      // 2. Category filtering
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;

      // 3. Status filtering
      if (statusFilter === 'Bank Rec Needed') {
        if (s.bankRecStatus !== 'Awaited' && s.bankRecStatus !== 'In progress') return false;
      } else if (statusFilter === 'Docs Awaited') {
        if (s.currentStatus !== 'Docs Awaited') return false;
      } else if (statusFilter === 'Ready to File') {
        if (s.currentStatus !== 'Ready to File') return false;
      } else if (statusFilter === 'Filed') {
        if (s.currentStatus !== 'Filed') return false;
      }

      // 4. Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matches =
          s.title.toLowerCase().includes(q) ||
          s.clientName.toLowerCase().includes(q) ||
          s.defaultOwner.toLowerCase().includes(q) ||
          s.statutoryDueDay.toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [schedules, leadership, myAssignedStaffName, staffFilter, categoryFilter, statusFilter, search]);

  const distinctClientCount = useMemo(() => {
    const ids = new Set(filteredSchedules.map((s) => s.clientId));
    return ids.size;
  }, [filteredSchedules]);

  const pendingGstCount = useMemo(() => {
    return filteredSchedules.filter((s) => s.category === 'GST' && s.currentStatus !== 'Filed').length;
  }, [filteredSchedules]);

  const pendingTdsCount = useMemo(() => {
    return filteredSchedules.filter((s) => s.category === 'TDS' && s.currentStatus !== 'Filed').length;
  }, [filteredSchedules]);

  const bankRecsPendingCount = useMemo(() => {
    return filteredSchedules.filter((s) => s.bankRecStatus === 'In progress' || s.bankRecStatus === 'Awaited').length;
  }, [filteredSchedules]);

  return (
    <div className="assignments-workspace" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* View Switcher: Monthly Compliance Tracker vs One-Off Assignments */}
      <div className="work-mode-switcher">
        <button
          type="button"
          className={`work-tab-btn ${activeTab === 'compliance' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('compliance')}
        >
          <CalendarClock size={16} />
          Monthly Compliance Tracker
          <span className="tab-badge">{filteredSchedules.length} obligations</span>
        </button>
        <button
          type="button"
          className={`work-tab-btn ${activeTab === 'oneoff' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('oneoff')}
        >
          <BriefcaseBusiness size={16} />
          One-Off &amp; Project Assignments
          <span className="tab-badge">{ASSIGNMENTS.length} active</span>
        </button>
      </div>

      {activeTab === 'compliance' ? (
        <>
          {/* Staff Scope Bar */}
          <div className="staff-scope-bar">
            <div className="staff-scope-info">
              <UsersRound size={16} />
              {!leadership ? (
                <span>
                  Showing compliance obligations for clients assigned to <strong>{myAssignedStaffName}</strong> ({ROLE_LABELS[role]})
                </span>
              ) : (
                <span>
                  Practice Compliance Desk · Scope: <strong>{staffFilter === 'All' ? 'All Practice Clients' : staffFilter}</strong>
                </span>
              )}
            </div>

            {leadership ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Filter by Staff:</span>
                <select
                  className="staff-scope-select"
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                >
                  <option value="All">All Staff (Entire Practice)</option>
                  <option value="Priya Desai">Priya Desai (Senior Staff)</option>
                  <option value="Rohan Mehta">Rohan Mehta (Staff)</option>
                  <option value="Ananya Rao">Ananya Rao (Manager)</option>
                  <option value="S. Narayanan">S. Narayanan (Founder)</option>
                </select>
              </div>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                {distinctClientCount} clients in your care
              </span>
            )}
          </div>

          {/* Horizon KPI Metric Cards */}
          <section className="workspace-stats-grid">
            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Assigned Clients</span>
                <strong>{distinctClientCount}</strong>
                <small>Under active compliance</small>
              </div>
              <span className="workspace-stat-icon">
                <Building2 aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Pending GST Returns</span>
                <strong>{pendingGstCount}</strong>
                <small>Due on 11th &amp; 20th</small>
              </div>
              <span className="workspace-stat-icon stat-warning">
                <FileText aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>TDS &amp; Challans Due</span>
                <strong>{pendingTdsCount}</strong>
                <small>Due on 7th &amp; 31st</small>
              </div>
              <span className="workspace-stat-icon stat-gold">
                <ReceiptIndianRupee aria-hidden="true" />
              </span>
            </article>

            <article className="workspace-stat-card">
              <div className="workspace-stat-info">
                <span>Bank Rec Pending</span>
                <strong>{bankRecsPendingCount}</strong>
                <small>Required before GST filing</small>
              </div>
              <span className="workspace-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
                <WalletCards aria-hidden="true" />
              </span>
            </article>
          </section>

          {/* Search & Domain Filter Pills */}
          <div className="client-toolbar">
            <div className="client-search-wrap">
              <Search aria-hidden="true" />
              <input
                className="client-search-input"
                type="search"
                placeholder="Search by client, schedule title, due date, owner…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="cadence-tabs">
              {(['All', 'GST', 'TDS', 'Bookkeeping'] as const).map((cat) => (
                <button
                  key={cat}
                  className={`cadence-pill ${categoryFilter === cat ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat === 'Bookkeeping' ? 'Bank Rec & Books' : cat}
                </button>
              ))}
            </div>

            <div className="cadence-tabs">
              {(['All', 'Bank Rec Needed', 'Docs Awaited', 'Ready to File', 'Filed'] as const).map((st) => (
                <button
                  key={st}
                  className={`cadence-pill ${statusFilter === st ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  style={{ fontSize: 11 }}
                >
                  {st}
                </button>
              ))}
            </div>

            {leadership ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => onCompose('schedule')}
              >
                <Plus aria-hidden="true" /> Add schedule
              </button>
            ) : null}
          </div>

          {/* Horizon Compliance Table */}
          <Card
            title={!leadership ? `My Assigned Clients Compliance (${filteredSchedules.length})` : `Practice Compliance Matrix (${filteredSchedules.length})`}
            description="Standing compliance schedules assigned to staff · Bank reconciliation is verified as part of monthly GST"
            action={<MoreButton />}
            className="table-card"
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Target Client</th>
                    <th>Compliance Obligation</th>
                    <th>Staff In-Charge</th>
                    <th>Statutory Due Date</th>
                    <th>Bank Reconciliation</th>
                    <th>Filing Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedules.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--ink-muted)' }}>
                        No compliance schedules match your current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredSchedules.map((schedule) => (
                      <tr
                        key={schedule.id}
                        onClick={() => setSelectedSchedule(schedule)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <strong style={{ color: 'var(--ink-strong)', fontSize: 12 }}>
                              {schedule.clientName}
                            </strong>
                            <span className="client-id-chip" style={{ width: 'fit-content' }}>
                              {schedule.clientId}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <strong style={{ color: 'var(--ink-strong)' }}>{schedule.title}</strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`category-tag cat-${schedule.category.toLowerCase().replace(/[^a-z]/g, '')}`}>
                                {schedule.category}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                                {schedule.cadence}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span className="user-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                              {schedule.defaultOwner.substring(0, 2).toUpperCase()}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-strong)' }}>
                              {schedule.defaultOwner}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="due-chip">
                            <CalendarClock size={12} />
                            {schedule.nextDueDate}
                          </span>
                        </td>
                        <td>
                          <span className={`bank-rec-chip ${
                            schedule.bankRecStatus === 'Completed'
                              ? 'is-done'
                              : schedule.bankRecStatus === 'In progress'
                              ? 'is-progress'
                              : schedule.bankRecStatus === 'Awaited'
                              ? 'is-awaited'
                              : 'is-na'
                          }`}>
                            {schedule.bankRecStatus === 'Completed' && '✓ Reconciled'}
                            {schedule.bankRecStatus === 'In progress' && '⏳ In Progress'}
                            {schedule.bankRecStatus === 'Awaited' && '⚠️ Statement Awaited'}
                            {schedule.bankRecStatus === 'Not applicable' && 'N/A (No Bank)'}
                          </span>
                        </td>
                        <td>
                          <span className={`filing-chip ${
                            schedule.currentStatus === 'Ready to File'
                              ? 'is-ready'
                              : schedule.currentStatus === 'Docs Awaited'
                              ? 'is-awaited'
                              : schedule.currentStatus === 'Bank Statement Received' || schedule.currentStatus === 'Filed'
                              ? 'is-done'
                              : 'is-pending'
                          }`}>
                            {schedule.currentStatus || 'Pending'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="soft-button"
                            type="button"
                            style={{ fontSize: 11, padding: '4px 10px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSchedule(schedule);
                            }}
                          >
                            View Checklist ({schedule.bankRecStatus === 'Not applicable' ? schedule.checklistTemplate.filter(s => !s.toLowerCase().includes('bank') && !s.toLowerCase().includes('reconciliation')).length : schedule.checklistTemplate.length})
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <AssignmentsTable
          title={leadership ? 'All open practice assignments' : 'Assignments visible to me'}
          rows={leadership ? assignments : assignments.filter((a) => a.owner === myAssignedStaffName || a.reviewer === myAssignedStaffName)}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          canEdit={leadership}
        />
      )}

      {/* Slide-over Schedule Detail Drawer */}
      {selectedSchedule ? (
        <ScheduleDetailDrawer
          schedule={selectedSchedule}
          leadership={leadership}
          role={role}
          onClose={() => setSelectedSchedule(null)}
          onToast={onToast}
          onUpdateSchedule={onUpdateSchedule}
        />
      ) : null}
    </div>
  );
}

function ScheduleDetailDrawer({
  schedule,
  leadership,
  role,
  onClose,
  onToast,
  onUpdateSchedule,
}: {
  schedule: RecurringScheduleRecord;
  leadership: boolean;
  role?: CompanyRole;
  onClose: () => void;
  onToast: (msg: string) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
}) {
  const currentPersonName = role ? ROLE_PEOPLE[role]?.name : '';
  const isAssignedCustodian = Boolean(
    currentPersonName &&
    (schedule.defaultOwner.toLowerCase().includes(currentPersonName.toLowerCase()) ||
     currentPersonName.toLowerCase().includes(schedule.defaultOwner.toLowerCase()))
  );
  const [tab, setTab] = useState<'checklist' | 'overview' | 'history'>('checklist');
  const [bankRecStatus, setBankRecStatus] = useState(schedule.bankRecStatus || 'Awaited');
  const [currentStatus, setCurrentStatus] = useState(schedule.currentStatus || 'Pending');
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({
    0: schedule.bankRecStatus === 'Completed',
  });
  const [arn, setArn] = useState('');

  const hasBank = schedule.bankRecStatus !== 'Not applicable' && bankRecStatus !== 'Not applicable';

  const workflowChecklist = useMemo(() => {
    if (hasBank) return schedule.checklistTemplate;
    return schedule.checklistTemplate.filter(
      (step) => !step.toLowerCase().includes('bank') && !step.toLowerCase().includes('reconciliation')
    );
  }, [schedule.checklistTemplate, hasBank]);

  function toggleStep(idx: number) {
    if (!isAssignedCustodian) return;
    setCheckedSteps((prev) => {
      const next = { ...prev, [idx]: !prev[idx] };
      if (hasBank && idx === 0 && next[0] && schedule.category === 'GST') {
        setBankRecStatus('Completed');
      }
      return next;
    });
  }

  function handleSave() {
    if (!isAssignedCustodian) return;
    const updated: RecurringScheduleRecord = {
      ...schedule,
      bankRecStatus,
      currentStatus,
    };
    onUpdateSchedule(updated);
    onClose();
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="client-drawer" aria-label="Recurring schedule details">
        <div className="client-drawer-header">
          <div className="drawer-client-lead">
            <span className="drawer-monogram">{schedule.category.substring(0, 2).toUpperCase()}</span>
            <div>
              <h2>{schedule.title}</h2>
              <p>{schedule.clientName} · {schedule.cadence} Cycle</p>
            </div>
          </div>
          <button className="drawer-close-btn" type="button" onClick={onClose} aria-label="Close drawer">
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="drawer-tabs">
          <button
            className={`drawer-tab ${tab === 'checklist' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('checklist')}
          >
            Workflow Checklist ({workflowChecklist.length})
          </button>
          <button
            className={`drawer-tab ${tab === 'overview' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            className={`drawer-tab ${tab === 'history' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setTab('history')}
          >
            Generated History ({schedule.history.length})
          </button>
        </nav>

        <div className="drawer-content">
          {tab === 'checklist' ? (
            <div className="checklist-step-box">
              {!isAssignedCustodian ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--canvas)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 8, fontSize: 12, color: 'var(--ink-secondary)', marginBottom: 14 }}>
                  <Lock size={14} color="var(--ink-muted)" />
                  <span>
                    Checklist steps, bank reconciliation, and filing progress can only be updated by the assigned custodian (<strong>{schedule.defaultOwner}</strong>).
                  </span>
                </div>
              ) : null}

              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 10px' }}>
                {!hasBank
                  ? 'Banking excluded: Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are not part of this return workflow.'
                  : 'Complete each prerequisite step. Bank statement receipt is verified before filing GST returns:'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {workflowChecklist.map((step, idx) => (
                  <div
                    key={idx}
                    className={`checklist-interactive-row ${checkedSteps[idx] ? 'is-completed' : ''}`}
                    style={{
                      cursor: isAssignedCustodian ? 'pointer' : 'not-allowed',
                      opacity: isAssignedCustodian ? 1 : 0.85,
                    }}
                    onClick={isAssignedCustodian ? () => toggleStep(idx) : undefined}
                  >
                    <div className="checklist-checkbox">
                      {checkedSteps[idx] ? <Check size={12} /> : null}
                    </div>
                    <span className="checklist-step-text" style={{ fontSize: 12, lineHeight: 1.4 }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>

              {/* Status Controls */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {hasBank ? (
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Bank Reconciliation Status
                    </span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {(['Completed', 'In progress', 'Awaited'] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!isAssignedCustodian}
                          onClick={() => {
                            if (!isAssignedCustodian) return;
                            setBankRecStatus(st);
                            if (st === 'Completed') {
                              setCheckedSteps((prev) => ({ ...prev, 0: true }));
                            }
                          }}
                          className={`work-tab-btn ${bankRecStatus === st ? 'is-active' : ''}`}
                          style={{
                            fontSize: 11,
                            padding: '4px 10px',
                            cursor: isAssignedCustodian ? 'pointer' : 'not-allowed',
                            opacity: isAssignedCustodian ? 1 : 0.7,
                          }}
                        >
                          {st === 'Completed' && '✓ Reconciled'}
                          {st === 'In progress' && '⏳ In Progress'}
                          {st === 'Awaited' && '⚠️ Statement Awaited'}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ background: 'var(--canvas)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      <Building2 size={13} color="var(--ink-muted)" />
                      <span>Banking Excluded from GST Workflow</span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-muted)' }}>
                      Client operates without bank accounts (cash-only). Bank statement collection and reconciliation are not required or tracked for this return filing.
                    </p>
                  </div>
                )}

                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Filing Progress Status
                  </span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {(hasBank
                      ? ['Pending', 'Docs Awaited', 'Bank Statement Received', 'Ready to File', 'Filed'] as const
                      : ['Pending', 'Docs Awaited', 'Ready to File', 'Filed'] as const
                    ).map((fs) => (
                      <button
                        key={fs}
                        type="button"
                        disabled={!isAssignedCustodian}
                        onClick={() => isAssignedCustodian && setCurrentStatus(fs)}
                        className={`work-tab-btn ${currentStatus === fs ? 'is-active' : ''}`}
                        style={{
                          fontSize: 11,
                          padding: '4px 10px',
                          cursor: isAssignedCustodian ? 'pointer' : 'not-allowed',
                          opacity: isAssignedCustodian ? 1 : 0.7,
                        }}
                      >
                        {fs}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Portal Filing Proof / Acknowledgment ARN
                  </span>
                  <input
                    value={arn}
                    readOnly={!isAssignedCustodian}
                    onChange={(e) => setArn(e.target.value)}
                    placeholder="e.g. AA271026001923M (GSTN ARN / Challan BSR)"
                    style={{
                      width: '100%',
                      marginTop: 6,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      background: isAssignedCustodian ? 'var(--surface)' : 'var(--canvas)',
                      cursor: isAssignedCustodian ? 'text' : 'not-allowed',
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'overview' ? (
            <>
              {schedule.exceptionReason ? (
                <div className="drawer-card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-soft)' }}>
                  <h4 style={{ color: 'var(--danger)' }}>Compliance Exception</h4>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                    {schedule.exceptionReason}
                  </p>
                </div>
              ) : null}

              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Schedule ID</span>
                  <span className="drawer-val">{schedule.id}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Category</span>
                  <span className="drawer-val">{schedule.category}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Cadence</span>
                  <span className="drawer-val">{schedule.cadence}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Generation Day</span>
                  <span className="drawer-val">Day {schedule.generationDay} of cycle</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Statutory Due Date</span>
                  <span className="drawer-val">{schedule.statutoryDueDay}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Default Assignment Owner</span>
                  <span className="drawer-val">{schedule.defaultOwner}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Next Automated Run</span>
                  <span className="drawer-val">{schedule.nextRunDate}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Target Due Date</span>
                  <span className="drawer-val">{schedule.nextDueDate}</span>
                </div>
                <div className="drawer-item full-width">
                  <span className="drawer-label">Client Legal Entity</span>
                  <span className="drawer-val">{schedule.clientName} ({schedule.clientId})</span>
                </div>
              </div>
            </>
          ) : null}

          {tab === 'history' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 4px' }}>
                Past assignments generated from this recurring compliance schedule:
              </p>
              {schedule.history.map((h) => (
                <div key={h.period} className="history-card-row">
                  <div>
                    <strong>{h.period}</strong>
                    <small>Assignment Ref: {h.assignmentId} {h.completedOn ? `· Completed on ${h.completedOn}` : ''}</small>
                  </div>
                  <Status tone={h.status === 'Completed' ? 'success' : h.status === 'In progress' ? 'default' : 'warning'}>
                    {h.status}
                  </Status>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="drawer-footer">
          {isAssignedCustodian ? (
            <button
              className="primary-button"
              type="button"
              onClick={handleSave}
            >
              <CheckCircle2 size={14} /> Save progress &amp; update status
            </button>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', background: 'var(--surface-muted)', padding: '6px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <Lock size={13} />
              <span>Workflow &amp; filing progress locked to assigned custodian ({schedule.defaultOwner})</span>
            </div>
          )}
          <button className="soft-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}

function BillingWorkspace({
  role,
  invoices,
  receipts,
  clients,
  onToast,
  onCompose,
  onRecordPaymentForInvoice,
}: {
  role: CompanyRole;
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  clients: ClientRecord[];
  onToast: (msg: string) => void;
  onCompose: (mode: DialogMode) => void;
  onRecordPaymentForInvoice: (inv: InvoiceRecord) => void;
}) {
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

function InvoiceDetailDrawer({
  invoice,
  receipts,
  onClose,
  onRecordPayment,
  onToast,
}: {
  invoice: InvoiceRecord;
  receipts: ReceiptRecord[];
  onClose: () => void;
  onRecordPayment: () => void;
  onToast: (msg: string) => void;
}) {
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

function Field({ label, children, full = false, hint }: { label: string; children: ReactNode; full?: boolean; hint?: string }) {
  return <label className={full ? 'field is-full' : 'field'}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
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
