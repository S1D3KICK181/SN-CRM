import {
  Activity,
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
  IndianRupee,
  ListChecks,
  Plus,
  ReceiptIndianRupee,
  Repeat2,
  UserRoundCheck,
  WalletCards,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ClientDto, ReportingLineDto, ServiceCatalogItemDto, SessionActor } from '@sn/contracts';
import { authorize, type CompanyRole } from '@sn/domain';
import { useBilling } from './api/use-billing';
import { useEngagements } from './api/use-engagements';
import { SessionClient } from './api/auth/session-client';
import { SessionManager } from './api/auth/session-manager';
import type { AuthSessionSource } from './api/auth/types';
import { SessionProvider, useSessionActor } from './shell/session-context';
import { SignInGate } from './shell/sign-in-gate';
import { ApplicationChrome } from './shell/application-chrome';
import { MODULE_DESCRIPTIONS, type PageKey } from './shell/navigation';
import { Card, Field, MoreButton } from './ui/workspace-primitives';
import { ClientsWorkspace } from './workspaces/clients/clients-workspace';
import { EngagementsWorkspace } from './workspaces/engagements/engagements-workspace';
import { BillingWorkspace, type BillingActions } from './workspaces/billing/billing-workspace';
import { TeamWorkspace } from './workspaces/team/team-workspace';
import {
  TasksWorkspace,
  PersonalTasks,
  TaskQueue,
  DelegatedWork,
  ReviewQueue,
  type TasksWorkspaceModel,
  type TasksWorkspaceActions,
} from './workspaces/tasks/tasks-workspace';

export {
  PersonalTasks,
  TaskQueue,
  DelegatedWork,
  ReviewQueue,
  TasksWorkspace,
};
import { AssignmentDetailDrawer } from './workspaces/assignments/assignment-detail-drawer';
import { AssignmentsTable } from './workspaces/assignments/assignments-table';
import { AssignmentsWorkspace } from './workspaces/assignments/assignments-workspace';
import { todayInKolkata } from './workspaces/billing/billing-form-model';
import {
  BilledAndCollectedCard,
  ComingUpCard,
  DashboardMetricStrip,
  FeesSnapshotCard,
  NeedsAttentionCard,
  OpenWorkByPersonCard,
  PendingByClientCard,
  RecurringSchedulesCard,
} from './workspaces/dashboard/dashboard-cards';
import {
  buildMetricTiles,
  myAssignments,
  openAssignments,
  type FeesState,
  type MetricTile,
} from './workspaces/dashboard/dashboard-metrics';
import {
  CreateAssignmentDialog,
  type DialogClientOption,
  type DialogEngagementOption,
  type DialogStaffOption,
} from './workspaces/assignments/create-assignment-dialog';
import {
  resolveDrawerSave,
  syncDrawerAssignment,
  useAssignments,
  useClients,
  useTeamDirectory,
  useWorkItems,
  getDelegationTargets,
  getParentAssignmentOptions,
  normalizeDisplayDateToIso,
  type CreateDelegatedInput,
  type CreatePersonalInput,
  type CreateInternalInput,
} from './api';
import {
  ASSIGNMENTS,
  CLIENTS,
  DELEGATED_TASKS,
  PERSONAL_TASKS,
  RECURRING_SCHEDULES,
  ROLE_COPY,
  ROLE_LABELS,
  ROLE_PEOPLE,
  formatINR,
  type AssignmentRow,
  type AssignmentTone,
  type ClientRecord,
  type ClientType,
  type DelegatedTaskRecord,
  type InvoiceRecord,
  type PersonalTaskRecord,
  type ReceiptRecord,
  type RecurringScheduleRecord,
  type ScheduleCategory,
  type ScheduleCadence,
} from './data';

type DialogMode = 'assignment' | 'personal' | 'delegated' | 'internal' | 'client' | 'schedule' | null;

export function App() {
  const { status, actor, error, retry, signOut, signInWithPassword } = useSessionActor();

  if (status === 'initializing') {
    return (
      <div className="session-screen-center" role="status" aria-live="polite">
        <div className="session-spinner" />
        <p>Verifying secure session…</p>
      </div>
    );
  }

  if (status === 'unauthenticated' || !actor) {
    return <SignInGate onSignIn={signInWithPassword} />;
  }

  if (status === 'forbidden') {
    return (
      <div className="session-screen-center" role="alert">
        <h2>Access Restricted</h2>
        <p>Your account is verified, but you have no active employee profile or assigned role in the CRM database.</p>
        <button type="button" onClick={() => void signOut()}>Sign Out</button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="session-screen-center" role="alert">
        <h2>Connection Error</h2>
        <p>{error?.message ?? 'Could not connect to CRM API.'}</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button type="button" onClick={() => void retry()}>Retry</button>
          <button type="button" onClick={() => void signOut()}>Sign Out</button>
        </div>
      </div>
    );
  }

  return <AuthenticatedApp actor={actor} onSignOut={signOut} />;
}

function AuthenticatedApp({
  actor,
  onSignOut,
}: {
  actor: SessionActor;
  onSignOut: (options?: { scope?: 'local' | 'global' }) => Promise<void>;
}) {
  const role = actor.role;
  const [activePage, setActivePage] = useState<PageKey>('Dashboard');
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [toast, setToast] = useState<string | null>(null);
  const {
    assignments,
    schedules,
    services,
    loading: assignmentsLoading,
    error: assignmentsError,
    refresh: refreshAssignments,
    handleCreateAssignment: createAssignmentLive,
    handleUpdateAssignment: updateAssignmentLive,
    handleCreateSchedule: createScheduleLive,
    handleUpdateSchedule: updateScheduleLive,
    generateDueAssignments: generateDueLive,
    isGeneratingDue,
  } = useAssignments(role, { onToast: setToast });
  const assignmentDialogOpen =
    (dialog === 'assignment' || dialog === 'schedule') && (role === 'founder' || role === 'manager');
  const {
    items: engagementItems,
    listError: engagementsListError,
    hasLiveSnapshot: engagementsLoaded,
  } = useEngagements(role, {
    enabled: assignmentDialogOpen,
  });
  const engagementOptions = useMemo<readonly DialogEngagementOption[]>(
    () =>
      engagementItems
        .filter((e) => e.status === 'active')
        .map((e) => ({
          id: e.id,
          code: e.code,
          clientId: e.clientId,
          title: e.approvedVersion?.title ?? e.serviceName ?? e.code,
        })),
    [engagementItems],
  );
  const { items: directoryClients } = useClients(role);
  const { lines: directoryLines } = useTeamDirectory(role);

  const {
    loading: workItemsLoading,
    error: workItemsError,
    hasLiveSnapshot: workItemsHasLiveSnapshot,
    personalTasks,
    assignedToMe,
    delegatedByMe,
    reviewableTasks,
    visibleDelegatedWork,
    handleCreateDelegated,
    handleCreatePersonal,
    handleCreateInternal,
    handleStart: handleStartTask,
    handleSubmit: handleSubmitTaskForReview,
    handleApprove: handleApproveDelegatedTask,
    handleReopen: handleReopenDelegatedTask,
    handleTogglePersonal: handleTogglePersonalTask,
    refresh: refreshWorkItems,
  } = useWorkItems(role, assignments, { onToast: setToast });
  const [selectedAssignmentForDrawer, setSelectedAssignmentForDrawer] = useState<AssignmentRow | null>(null);
  const {
    invoices,
    receipts,
    loading: billingLoading,
    error: billingError,
    retry: retryBilling,
    recordBill,
    recordPayment,
    voidBill,
    voidPayment,
    applyCredit,
    removeCredit,
  } = useBilling(role);
  const [clients, setClients] = useState<ClientRecord[]>(CLIENTS);

  const staffOptions = useMemo<readonly DialogStaffOption[]>(() => {
    if (!directoryLines || directoryLines.length === 0) return [];
    const seen = new Set<string>();
    const list: DialogStaffOption[] = [];
    for (const line of directoryLines) {
      if (!seen.has(line.employee.id)) {
        seen.add(line.employee.id);
        list.push({
          id: line.employee.id,
          name: line.employee.name,
          role: line.employee.role,
        });
      }
    }
    return list;
  }, [directoryLines]);

  const clientOptions = useMemo<readonly DialogClientOption[]>(() => {
    if (!directoryClients || directoryClients.length === 0) {
      return clients.map((c) => ({ id: c.id, name: c.name }));
    }
    return directoryClients.map((c) => ({
      id: c.id,
      name: c.displayName,
    }));
  }, [directoryClients, clients]);

  const canCreateAssignment = authorize({ action: 'assignment.create', actor }).allowed;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (selectedAssignmentForDrawer) {
      const next = syncDrawerAssignment(selectedAssignmentForDrawer, assignments);
      if (next !== selectedAssignmentForDrawer) {
        setSelectedAssignmentForDrawer(next);
      }
    }
  }, [assignments, selectedAssignmentForDrawer]);

  function handleCompose(mode: DialogMode) {
    if (mode === 'personal' || mode === 'delegated' || mode === 'internal') {
      setActivePage('My Tasks');
    }
    setDialog(mode);
  }

  function openPrimaryAction() {
    if (canCreateAssignment) {
      setDialog('assignment');
    } else {
      setActivePage('My Tasks');
      setDialog('personal');
    }
  }

  // Errors propagate to the schedule drawer, which reports them and stays open.
  async function handleUpdateSchedule(updated: RecurringScheduleRecord) {
    const nextDate = normalizeDisplayDateToIso(updated.nextRunDate);
    await updateScheduleLive(updated.id, {
      active: updated.status !== 'Paused',
      nextOccurrenceOn: nextDate || undefined,
    });
  }

  async function handleCreateAssignment(newAssignment: AssignmentRow): Promise<boolean> {
    try {
      const created = await createAssignmentLive(newAssignment);
      return Boolean(created && created.id);
    } catch {
      return false;
    }
  }

  async function handleUpdateAssignment(updated: AssignmentRow): Promise<AssignmentRow | undefined> {
    const saved = await updateAssignmentLive(updated);
    setSelectedAssignmentForDrawer((current) => resolveDrawerSave(current, saved, updated.id));
    return saved;
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
      for (const s of newSchedules) {
        void createScheduleLive({
          clientId: s.clientId,
          clientName: s.clientName,
          title: s.title,
          cadence: s.cadence.toLowerCase() as 'monthly' | 'quarterly' | 'annual',
          ownerId: s.defaultOwner,
          dueDay: s.generationDay ?? 11,
          nextOccurrenceOn: s.nextRunDate,
        });
      }
    }

    setToast(`Client ${newClient.name} onboarded with ${newSchedules.length} recurring schedules assigned to ${assignedOwner}`);
  }

  return (
    <ApplicationChrome
      actor={actor}
      activePage={activePage}
      toast={toast}
      onSignOut={onSignOut}
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
              teamMembers={staffOptions}
              services={services}
            />
          ) : null}
          <CreateAssignmentDialog
            isOpen={assignmentDialogOpen}
            role={role}
            clients={clientOptions}
            engagements={engagementOptions}
            engagementsUnavailable={Boolean(engagementsListError)}
            engagementsLoading={!engagementsLoaded && !engagementsListError}
            teamMembers={staffOptions}
            services={services}
            onClose={() => setDialog(null)}
            onCreateAssignment={async (cmd) => {
              const res = await createAssignmentLive(cmd);
              return Boolean(res && res.id);
            }}
            onCreateSchedule={async (cmd) => {
              const res = await createScheduleLive(cmd);
              return Boolean(res && res.id);
            }}
            onToast={setToast}
          />
          {dialog && !['personal', 'delegated', 'internal', 'assignment', 'schedule'].includes(dialog) ? (
            <ComposerDialog
              key={dialog}
              mode={dialog}
              role={role}
              clients={clients}
              assignments={assignments}
              personalTasks={personalTasks}
              delegatedTasks={visibleDelegatedWork}
              onClose={() => setDialog(null)}
              onCreated={setToast}
              onClientCreated={handleCreateClient}
              onAssignmentCreated={handleCreateAssignment}
              onPersonalTaskCreated={handleCreatePersonal}
              onDelegatedTaskCreated={handleCreateDelegated}
              onInternalTaskCreated={handleCreateInternal}
            />
          ) : null}
        </>
      }
    >
      {activePage === 'Dashboard' ? (
        <RoleDashboard
          role={role}
          actorId={actor.id}
          actorName={actor.name}
          assignments={assignments}
          schedules={schedules}
          invoices={invoices}
          receipts={receipts}
          billingLoading={billingLoading}
          billingError={billingError ? billingError.message : null}
          onRetryBilling={retryBilling}
          personalTasks={personalTasks}
          delegatedTasks={visibleDelegatedWork}
          assignedToMe={assignedToMe}
          reviewableTasks={reviewableTasks}
          onCompose={handleCompose}
          onToast={setToast}
          onSelectAssignment={setSelectedAssignmentForDrawer}
          onTogglePersonalTask={handleTogglePersonalTask}
          onStartTask={handleStartTask}
          onApproveDelegatedTask={handleApproveDelegatedTask}
          onReopenDelegatedTask={handleReopenDelegatedTask}
          onSubmitTaskForReview={handleSubmitTaskForReview}
          onNavigate={setActivePage}
        />
      ) : (
        <ModuleWorkspace
          page={activePage}
          role={role}
          currentActor={actor}
          directoryClients={directoryClients}
          directoryLines={directoryLines}
          services={services}
          clients={clients}
          schedules={schedules}
          assignments={assignments}
          invoices={invoices}
          receipts={receipts}
          billingLoading={billingLoading}
          billingError={billingError ? billingError.message : null}
          onRetryBilling={retryBilling}
          billingActions={{ recordBill, recordPayment, voidBill, voidPayment, applyCredit, removeCredit }}
          assignmentsLoading={assignmentsLoading}
          assignmentsError={assignmentsError ? assignmentsError.message : null}
          onRetryAssignments={refreshAssignments}
          workItemsModel={{
            personalTasks,
            assignedToMe,
            delegatedTasks: visibleDelegatedWork,
            reviewableTasks,
            loading: workItemsLoading,
            error: workItemsError,
            hasLiveSnapshot: workItemsHasLiveSnapshot,
          }}
          workItemsActions={{
            onTogglePersonalTask: handleTogglePersonalTask,
            onStartTask: handleStartTask,
            onSubmitTaskForReview: handleSubmitTaskForReview,
            onApproveDelegatedTask: handleApproveDelegatedTask,
            onReopenDelegatedTask: handleReopenDelegatedTask,
            onRefresh: refreshWorkItems,
            onCreatePersonal: handleCreatePersonal,
            onCreateDelegated: handleCreateDelegated,
            onCreateInternal: handleCreateInternal,
          }}
          dialog={dialog}
          onCloseDialog={() => setDialog(null)}
          onCompose={handleCompose}
          onToast={setToast}
          onUpdateSchedule={handleUpdateSchedule}
          onUpdateAssignment={handleUpdateAssignment}
          onSelectAssignment={setSelectedAssignmentForDrawer}
          onGenerateDue={generateDueLive}
          isGeneratingDue={isGeneratingDue}
        />
      )}
    </ApplicationChrome>
  );
}

function RoleDashboard({
  role,
  actorId,
  actorName = '',
  assignments,
  schedules,
  invoices,
  receipts,
  billingLoading = false,
  billingError = null,
  onRetryBilling,
  personalTasks,
  delegatedTasks,
  assignedToMe = [],
  reviewableTasks = [],
  onCompose,
  onToast,
  onSelectAssignment,
  onTogglePersonalTask,
  onStartTask,
  onApproveDelegatedTask,
  onReopenDelegatedTask,
  onSubmitTaskForReview,
  onNavigate,
}: {
  role: CompanyRole;
  actorId: string;
  actorName?: string;
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  billingLoading?: boolean;
  billingError?: string | null;
  onRetryBilling?: () => void;
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  assignedToMe?: DelegatedTaskRecord[];
  reviewableTasks?: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onStartTask?: (task: DelegatedTaskRecord) => void;
  onApproveDelegatedTask?: (task: DelegatedTaskRecord) => void;
  onReopenDelegatedTask?: (task: DelegatedTaskRecord) => void;
  onSubmitTaskForReview?: (task: DelegatedTaskRecord) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  const copy = ROLE_COPY[role];
  const firstName = actorName.trim().split(/\s+/)[0] ?? '';
  // Founder keeps the overview title; everyone else is greeted by their own first name.
  const headingTitle = role === 'founder' || !firstName ? copy.title : `Good day, ${firstName}`;
  const leadership = role === 'founder' || role === 'manager';
  const today = todayInKolkata();
  const feesState: FeesState = billingLoading ? 'loading' : billingError ? 'error' : 'ready';
  const tiles = buildMetricTiles({
    role,
    actorId,
    today,
    assignments,
    personalTasks,
    delegatedTasks,
    assignedToMe,
    reviewableTasks,
    invoices,
    feesState,
  });
  const fees = { invoices, receipts, today, feesState, onRetry: onRetryBilling };
  return (
    <>
      <PageHeading
        eyebrow={copy.eyebrow}
        title={headingTitle}
        description={copy.description}
        primaryLabel={leadership ? 'New assignment' : 'New personal task'}
        onPrimary={() => onCompose(leadership ? 'assignment' : 'personal')}
      />
      {role === 'founder' ? (
        <FounderDashboard
          tiles={tiles}
          today={today}
          fees={fees}
          assignments={assignments}
          schedules={schedules}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'manager' ? (
        <ManagerDashboard
          tiles={tiles}
          today={today}
          fees={fees}
          assignments={assignments}
          schedules={schedules}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'senior_staff' ? (
        <SeniorDashboard
          tiles={tiles}
          today={today}
          mine={myAssignments(role, assignments, actorId)}
          personalTasks={personalTasks}
          delegatedTasks={delegatedTasks}
          reviewableTasks={reviewableTasks}
          onCompose={onCompose}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onTogglePersonalTask={onTogglePersonalTask}
          onApproveDelegatedTask={onApproveDelegatedTask}
          onReopenDelegatedTask={onReopenDelegatedTask}
          onNavigate={onNavigate}
        />
      ) : null}
      {role === 'staff' ? (
        <StaffDashboard
          tiles={tiles}
          today={today}
          mine={myAssignments(role, assignments, actorId)}
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
          tiles={tiles}
          personalTasks={personalTasks}
          assignedToMe={assignedToMe}
          onToast={onToast}
          onTogglePersonalTask={onTogglePersonalTask}
          onStartTask={onStartTask}
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
  primaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  return (
    <section className="page-heading">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">
        {onSecondary ? (
          <button className="soft-button" type="button" onClick={onSecondary}>
            <CalendarClock aria-hidden="true" /> Today’s plan
          </button>
        ) : null}
        {primaryLabel && onPrimary ? (
          <button className="primary-button" type="button" onClick={onPrimary}>
            <Plus aria-hidden="true" /> {primaryLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}

interface DashboardFees {
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  today: string;
  feesState: FeesState;
  onRetry?: () => void;
}

function FounderDashboard({
  tiles,
  today,
  fees,
  assignments,
  schedules,
  onToast,
  onSelectAssignment,
  onNavigate,
}: {
  tiles: MetricTile[];
  today: string;
  fees: DashboardFees;
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <DashboardMetricStrip tiles={tiles} />
      <div className="dashboard-grid chart-and-snapshot">
        <BilledAndCollectedCard {...fees} />
        <FeesSnapshotCard {...fees} />
      </div>
      <div className="dashboard-grid assignments-and-outstanding">
        <AssignmentsTable
          title="All open assignments"
          rows={openAssignments(assignments)}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
          canEdit={true}
        />
        <PendingByClientCard
          invoices={fees.invoices}
          feesState={fees.feesState}
          onRetry={fees.onRetry}
          onNavigate={onNavigate}
        />
      </div>
      <div className="dashboard-grid three-up">
        <ComingUpCard assignments={assignments} today={today} />
        <OpenWorkByPersonCard assignments={assignments} />
        <RecurringSchedulesCard schedules={schedules} />
      </div>
    </div>
  );
}

function ManagerDashboard({
  tiles,
  today,
  fees,
  assignments,
  schedules,
  onToast,
  onSelectAssignment,
  onNavigate,
}: {
  tiles: MetricTile[];
  today: string;
  fees: DashboardFees;
  assignments: AssignmentRow[];
  schedules: RecurringScheduleRecord[];
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <DashboardMetricStrip tiles={tiles} />
      <div className="dashboard-grid operations-top">
        <NeedsAttentionCard
          assignments={assignments}
          invoices={fees.invoices}
          today={today}
          feesState={fees.feesState}
          onRetry={fees.onRetry}
        />
        <ComingUpCard assignments={assignments} today={today} />
      </div>
      <AssignmentsTable
        title="All open assignments"
        rows={openAssignments(assignments)}
        onToast={onToast}
        onSelectAssignment={onSelectAssignment}
        onNavigate={onNavigate}
        canEdit={true}
      />
      <div className="dashboard-grid chart-and-snapshot">
        <BilledAndCollectedCard {...fees} />
        <RecurringSchedulesCard schedules={schedules} />
      </div>
      <div className="dashboard-grid operations-top">
        <OpenWorkByPersonCard assignments={assignments} />
        <PendingByClientCard
          compact
          invoices={fees.invoices}
          feesState={fees.feesState}
          onRetry={fees.onRetry}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

function SeniorDashboard({
  tiles,
  today,
  mine,
  personalTasks,
  delegatedTasks,
  reviewableTasks,
  onCompose,
  onToast,
  onSelectAssignment,
  onTogglePersonalTask,
  onApproveDelegatedTask,
  onReopenDelegatedTask,
  onNavigate,
}: {
  tiles: MetricTile[];
  today: string;
  mine: AssignmentRow[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  reviewableTasks?: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onApproveDelegatedTask?: (task: DelegatedTaskRecord) => void;
  onReopenDelegatedTask?: (task: DelegatedTaskRecord) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <DashboardMetricStrip tiles={tiles} />
      <div className="dashboard-grid operations-top">
        <AssignmentsTable
          title="Assignments I own or review"
          rows={openAssignments(mine)}
          onToast={onToast}
          onSelectAssignment={onSelectAssignment}
          onNavigate={onNavigate}
          compact
        />
        <ComingUpCard assignments={mine} today={today} />
      </div>
      <div className="dashboard-grid three-up">
        <DelegatedWork
          tasks={delegatedTasks}
          role="senior_staff"
          onAdd={() => onCompose('delegated')}
          onAddInternal={() => onCompose('internal')}
        />
        <PersonalTasks
          tasks={personalTasks}
          onToggle={onTogglePersonalTask}
          onAdd={() => onCompose('personal')}
        />
        <ReviewQueue
          delegatedTasks={reviewableTasks ?? delegatedTasks}
          onApprove={onApproveDelegatedTask}
          onReopen={onReopenDelegatedTask}
          onToast={onToast}
        />
      </div>
    </div>
  );
}

function StaffDashboard({
  tiles,
  today,
  mine,
  personalTasks,
  delegatedTasks,
  onCompose,
  onToast,
  onSelectAssignment,
  onTogglePersonalTask,
  onNavigate,
}: {
  tiles: MetricTile[];
  today: string;
  mine: AssignmentRow[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <DashboardMetricStrip tiles={tiles} />
      <div className="dashboard-grid operations-top">
        <AssignmentsTable
          title="My assignments"
          rows={openAssignments(mine)}
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
      <div className="dashboard-grid operations-top">
        <DelegatedWork
          tasks={delegatedTasks}
          role="staff"
          onAdd={() => onCompose('delegated')}
          onAddInternal={() => onCompose('internal')}
        />
        <ComingUpCard assignments={mine} today={today} />
      </div>
    </div>
  );
}

function TraineeDashboard({
  tiles,
  personalTasks,
  assignedToMe = [],
  onToast,
  onTogglePersonalTask,
  onStartTask,
  onSubmitTaskForReview,
  onNavigate,
}: {
  tiles: MetricTile[];
  personalTasks: PersonalTaskRecord[];
  assignedToMe?: DelegatedTaskRecord[];
  onToast: (message: string) => void;
  onTogglePersonalTask: (taskId: string) => void;
  onStartTask?: (task: DelegatedTaskRecord) => void;
  onSubmitTaskForReview?: (task: DelegatedTaskRecord) => void;
  onNavigate?: (page: PageKey) => void;
}) {
  return (
    <div className="dashboard-stack">
      <DashboardMetricStrip tiles={tiles} />
      <div className="dashboard-grid operations-top trainee-top">
        <TaskQueue
          tasks={assignedToMe}
          onStartTask={onStartTask}
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
        <GuidanceCard />
      </div>
    </div>
  );
}

/** Office Accounts is still a sample screen; its summary strip keeps its fixed sample figures. */
function AccountsMetricStrip() {
  const data: Array<[string, string, string, AssignmentTone]> = [
    ['Due today', '7', '2 at risk', 'danger'],
    ['Unassigned work', '5', 'Needs allocation', 'warning'],
    ['Pending review', '6', 'Your action', 'warning'],
    ['Cash balance', '₹42,680', 'Reconciled yesterday', 'success'],
  ];

  return (
    <section className="metric-strip" aria-label="Operational summary">
      {data.map(([label, value, note, tone]) => (
        <article className={`metric-card tone-${tone}`} key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </article>
      ))}
    </section>
  );
}

function GuidanceCard() {
  return (
    <Card title="Need guidance?" description="Keep the work trail clear" action={<UserRoundCheck aria-hidden="true" />} className="compact-card guidance-card">
      <p>Ask the assignment owner your question inside the task, so the answer stays with the client work.</p>
    </Card>
  );
}

const billingUnavailable = () => Promise.reject(new Error('Billing actions are not connected.'));
const NO_BILLING_ACTIONS: BillingActions = {
  recordBill: billingUnavailable,
  recordPayment: billingUnavailable,
  voidBill: billingUnavailable,
  voidPayment: billingUnavailable,
  applyCredit: billingUnavailable,
  removeCredit: billingUnavailable,
};

export function ModuleWorkspace({
  page,
  role,
  currentActor,
  directoryClients,
  directoryLines,
  services,
  clients,
  schedules,
  assignments,
  invoices,
  receipts,
  workItemsModel,
  workItemsActions,
  dialog,
  onCloseDialog,
  onCompose,
  onToast,
  onUpdateSchedule,
  onUpdateAssignment,
  onSelectAssignment,
  billingLoading,
  billingError,
  onRetryBilling,
  billingActions,
  onGenerateDue,
  isGeneratingDue,
  assignmentsLoading,
  assignmentsError,
  onRetryAssignments,
}: {
  page: PageKey;
  role: CompanyRole;
  currentActor?: SessionActor;
  directoryClients?: readonly ClientDto[];
  directoryLines?: readonly ReportingLineDto[];
  services?: readonly ServiceCatalogItemDto[];
  clients: ClientRecord[];
  schedules: RecurringScheduleRecord[];
  assignments: AssignmentRow[];
  invoices: InvoiceRecord[];
  receipts: ReceiptRecord[];
  workItemsModel?: TasksWorkspaceModel;
  workItemsActions?: TasksWorkspaceActions;
  dialog?: DialogMode;
  onCloseDialog?: () => void;
  onCompose: (mode: DialogMode) => void;
  onToast: (message: string) => void;
  onUpdateSchedule: (updated: RecurringScheduleRecord) => void;
  onUpdateAssignment: (updated: AssignmentRow) => void;
  onSelectAssignment: (assignment: AssignmentRow) => void;
  billingLoading?: boolean;
  billingError?: string | null;
  onRetryBilling?: () => void;
  billingActions?: BillingActions;
  onGenerateDue?: () => void;
  isGeneratingDue?: boolean;
  assignmentsLoading?: boolean;
  assignmentsError?: string | null;
  onRetryAssignments?: () => void;
}) {
  const leadership = role === 'founder' || role === 'manager';
  const primaryLabel =
    page === 'Assignments'
      ? (leadership ? 'New assignment' : undefined)
      : page === 'My Tasks'
      ? 'New personal task'
      : page === 'Clients'
      ? undefined
      : undefined;
  const primaryMode: DialogMode =
    page === 'Assignments'
      ? (leadership ? 'assignment' : null)
      : page === 'My Tasks'
      ? 'personal'
      : page === 'Clients'
      ? null
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
          onToast={onToast}
        />
      ) : null}
      {page === 'Engagements' ? (
        <EngagementsWorkspace
          role={role}
          onToast={onToast}
          currentActor={currentActor}
          clients={directoryClients}
          teamLines={directoryLines}
          services={services}
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
          onGenerateDue={onGenerateDue}
          isGeneratingDue={isGeneratingDue}
          isLoading={assignmentsLoading}
          error={assignmentsError}
          onRetry={onRetryAssignments}
        />
      ) : null}
      {page === 'Billing & Collections' ? (
        <BillingWorkspace
          role={role}
          model={{
            invoices,
            receipts,
          }}
          clients={directoryClients ?? []}
          actions={billingActions ?? NO_BILLING_ACTIONS}
          loading={billingLoading ?? false}
          error={billingError ?? null}
          onRetry={onRetryBilling ?? (() => undefined)}
          onToast={onToast}
        />
      ) : null}
      {page === 'My Tasks' ? (
        <TasksWorkspace
          role={role}
          assignments={assignments}
          onToast={onToast}
          onCompose={onCompose}
          activeDialog={dialog === 'personal' || dialog === 'delegated' || dialog === 'internal' ? dialog : null}
          onCloseDialog={onCloseDialog}
          currentActor={currentActor}
          model={workItemsModel}
          actions={workItemsActions}
        />
      ) : null}
      {page === 'Office Accounts' ? <AccountsWorkspace /> : null}
      {page === 'Team' ? <TeamWorkspace role={role} onToast={onToast} /> : null}
      {!['Clients', 'Engagements', 'Assignments', 'Billing & Collections', 'My Tasks', 'Office Accounts', 'Team'].includes(page) ? (
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
  return <div className="dashboard-stack"><AccountsMetricStrip /><div className="dashboard-grid chart-and-snapshot"><CashLedger /><Card title="Recent ledger entries" description="Manager-operated · immutable audit trail" action={<IndianRupee aria-hidden="true" />}><div className="ledger-list">{[['Client receipt · Aster Foods', '+ ₹14,500', 'success'], ['Office stationery', '− ₹2,340', 'danger'], ['Travel reimbursement · Rohan', '− ₹1,280', 'danger'], ['Cash withdrawal from bank', '+ ₹10,000', 'success']].map(([label, value, tone]) => <div key={label}><span><strong>{label}</strong><small>29/10/2026 · Ananya Rao</small></span><b className={`tone-${tone}`}>{value}</b></div>)}</div></Card></div></div>;
}

export function ComposerDialog({
  mode,
  role,
  clients,
  assignments,
  personalTasks,
  delegatedTasks,
  onClose,
  onCreated,
  onClientCreated,
  onAssignmentCreated,
  onPersonalTaskCreated,
  onDelegatedTaskCreated,
  onInternalTaskCreated,
}: {
  mode: DialogMode;
  role: CompanyRole;
  clients: ClientRecord[];
  assignments: AssignmentRow[];
  personalTasks: PersonalTaskRecord[];
  delegatedTasks: DelegatedTaskRecord[];
  onClose: () => void;
  onCreated: (message: string) => void;
  onClientCreated: (client: ClientRecord, services: string[], owner: string) => void;
  onAssignmentCreated: (assignment: AssignmentRow) => Promise<boolean>;
  onPersonalTaskCreated: (input: CreatePersonalInput | any) => Promise<boolean> | void;
  onDelegatedTaskCreated: (input: CreateDelegatedInput | any) => Promise<boolean> | void;
  onInternalTaskCreated?: (input: CreateInternalInput | any) => Promise<boolean> | void;
}) {
  const isMountedRef = useRef(true);
  const closedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (mode) {
      closedRef.current = false;
      setSubmitting(false);
    }
  }, [mode]);

  const handleClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  };

  useEffect(() => {
    if (!mode) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') handleClose(); }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mode, onClose]);

  if (!mode) return null;
  const titles: Record<Exclude<DialogMode, null>, [string, string]> = {
    assignment: ['Create assignment', 'Create a controlled client obligation with a clear owner and review gate.'],
    personal: ['New personal task', 'Plan a private reminder for yourself without creating practice-level work.'],
    delegated: ['Delegate Sub-Task', 'Break down an existing Assignment into operational verification steps while retaining owner accountability.'],
    internal: ['Delegate Office Task', 'Assign non-client administrative or menial office operations within your downward authority.'],
    client: ['New client record', 'Onboard a corporate, LLP, or individual client with Indian tax registrations.'],
    schedule: ['New Recurring Schedule', 'Configure an automated compliance cycle for GST, TDS, bookkeeping, or ROC.'],
  };
  const [title, description] = titles[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
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

      const matchedClient = clients.find(
        (c) => c.name.toLowerCase() === clientName.toLowerCase(),
      );
      const clientId = matchedClient?.id;

      const nextId = `ASN-000${assignments.length + 1}`;
      const newAsn: AssignmentRow = {
        id: nextId,
        title,
        client: clientName,
        clientId,
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

      setSubmitting(true);
      try {
        const ok = await onAssignmentCreated(newAsn);
        if (!isMountedRef.current || closedRef.current) {
          return;
        }
        if (ok === true) {
          handleClose();
          return;
        }
      } catch {
        // Prevent unhandled promise rejection
      }
      if (isMountedRef.current && !closedRef.current) {
        setSubmitting(false);
      }
      return;
    } else if (mode === 'personal') {
      const title = ((fd.get('title') as string) || 'Personal reminder').trim();
      const context = ((fd.get('context') as string) || 'Personal').trim();
      const time = ((fd.get('time') as string) || 'Today · 16:30').trim();

      setSubmitting(true);
      try {
        const ok = await onPersonalTaskCreated({
          title,
          context,
          time,
        });
        if (!isMountedRef.current || closedRef.current) {
          return;
        }
        if (ok === true) {
          handleClose();
          return;
        }
      } catch {
        // Prevent unhandled promise rejection
      }
      if (isMountedRef.current && !closedRef.current) {
        setSubmitting(false);
      }
      return;
    } else if (mode === 'delegated') {
      const assignmentId = (fd.get('assignmentId') as string) || (fd.get('parent') as string) || '';
      const assigneeId = (fd.get('assigneeId') as string) || (fd.get('delegateTo') as string) || '';
      const childTitle = ((fd.get('title') as string) || 'Verification sub-task').trim();
      const due = ((fd.get('due') as string) || 'Tomorrow').trim();
      const instructions = ((fd.get('instructions') as string) || '').trim();

      setSubmitting(true);
      try {
        const ok = await onDelegatedTaskCreated({
          assignmentId,
          assigneeId,
          title: childTitle,
          due,
          instructions,
        });
        if (!isMountedRef.current || closedRef.current) {
          return;
        }
        if (ok === true) {
          handleClose();
          return;
        }
      } catch {
        // Prevent unhandled promise rejection
      }
      if (isMountedRef.current && !closedRef.current) {
        setSubmitting(false);
      }
      return;
    } else if (mode === 'internal') {
      const title = ((fd.get('title') as string) || '').trim();
      const assigneeId = (fd.get('assigneeId') as string) || '';
      const due = ((fd.get('due') as string) || 'Tomorrow').trim();
      const instructions = ((fd.get('instructions') as string) || '').trim();

      setSubmitting(true);
      try {
        const ok = await onInternalTaskCreated?.({
          title,
          assigneeId,
          due,
          instructions,
        });
        if (!isMountedRef.current || closedRef.current) {
          return;
        }
        if (ok === true) {
          handleClose();
          return;
        }
      } catch {
        // Prevent unhandled promise rejection
      }
      if (isMountedRef.current && !closedRef.current) {
        setSubmitting(false);
      }
      return;
    } else {
      onCreated('Compliance item scheduled');
    }

    handleClose();
  }

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && handleClose()}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="dialog-header">
          <div>
            <span className="dialog-icon">
              {mode === 'assignment' ? (
                <BriefcaseBusiness />
              ) : mode === 'delegated' ? (
                <UserRoundCheck />
              ) : mode === 'internal' ? (
                <FileStack />
              ) : mode === 'client' ? (
                <Building2 />
              ) : mode === 'schedule' ? (
                <Repeat2 />
              ) : (
                <CalendarClock />
              )}
            </span>
            <div>
              <h2 id="dialog-title">{title}</h2>
              <p>{description}</p>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={handleClose} aria-label="Close">
            <X />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            {mode === 'assignment' ? (
              <AssignmentFields clients={clients} role={role} />
            ) : mode === 'delegated' ? (
              <DelegationFields role={role} assignments={assignments} />
            ) : mode === 'internal' ? (
              <InternalTaskFields role={role} />
            ) : mode === 'client' ? (
              <NewClientFields />
            ) : (
              <PersonalTaskFields />
            )}
          </div>
          <div className="dialog-footer">
            <button className="soft-button" type="button" onClick={handleClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={submitting}>
              {mode === 'assignment'
                ? 'Create draft'
                : mode === 'delegated' || mode === 'internal'
                ? 'Delegate task'
                : mode === 'client'
                ? 'Create client & activate schedules'
                : 'Schedule task'}
            </button>
          </div>
        </form>
      </section>
    </div>
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
  const parentOptions = useMemo(() => {
    return getParentAssignmentOptions(role, assignments);
  }, [role, assignments]);

  const targets = useMemo(() => {
    return getDelegationTargets(role);
  }, [role]);

  return (
    <>
      <Field label="Parent Assignment" full>
        <select
          name="assignmentId"
          required
          defaultValue={parentOptions[0]?.id || ''}
        >
          {parentOptions.map((assignment) => (
            <option key={assignment.id} value={assignment.id}>
              {assignment.id} · {assignment.title} ({assignment.client})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Sub-task title" full>
        <input name="title" required autoFocus placeholder="e.g. Verify portal sales totals against books" />
      </Field>
      <Field label="Delegate to">
        <select name="assigneeId" required defaultValue={targets[0]?.id || ''}>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
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

function InternalTaskFields({ role }: { role: CompanyRole }) {
  const targets = useMemo(() => {
    return getDelegationTargets(role);
  }, [role]);

  return (
    <>
      <Field label="Task description" full>
        <input
          name="title"
          required
          autoFocus
          placeholder="e.g. File November purchase bills in the blue cardboard file"
        />
      </Field>
      <Field label="Delegate to">
        <select name="assigneeId" required defaultValue={targets[0]?.id || ''}>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target completion date">
        <input name="due" type="text" defaultValue="Tomorrow" required />
      </Field>
      <Field
        label="Instructions & Location notes"
        full
        hint="Internal tasks do not link to client assignments or create billing scope."
      >
        <textarea
          name="instructions"
          rows={3}
          placeholder="Specific filing instructions, records cabinet, or administrative steps"
        />
      </Field>
    </>
  );
}

export interface AppRootProps {
  authSource?: AuthSessionSource;
  client?: SessionClient;
  manager?: SessionManager;
}

export function AppRoot({ authSource, client, manager }: AppRootProps = {}) {
  return (
    <SessionProvider authSource={authSource} client={client} manager={manager}>
      <App />
    </SessionProvider>
  );
}
