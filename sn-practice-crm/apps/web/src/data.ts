import type { CompanyRole } from '@sn/domain';

export const ROLE_LABELS: Record<CompanyRole, string> = {
  founder: 'Founder',
  manager: 'Manager',
  senior_staff: 'Senior Staff',
  staff: 'Staff',
  trainee: 'Trainee',
};

export const ROLE_PEOPLE: Record<CompanyRole, { id: string; name: string; initials: string }> = {
  founder: { id: 'founder-sn', name: 'S. Narayanan', initials: 'SN' },
  manager: { id: 'manager-priya', name: 'Priya Desai', initials: 'PD' },
  senior_staff: { id: 'senior-ananya', name: 'Ananya Rao', initials: 'AR' },
  staff: { id: 'staff-rohan', name: 'Rohan Mehta', initials: 'RM' },
  trainee: { id: 'trainee-neha', name: 'Neha Kapoor', initials: 'NK' },
};

export type AssignmentTone = 'default' | 'danger' | 'warning' | 'success';

export interface AssignmentMilestone {
  title: string;
  done: boolean;
}

export interface AssignmentRow {
  id: string;
  code?: string;
  title: string;
  client: string;
  clientId?: string;
  service: string;
  serviceId?: string;
  due: string;
  owner: string;
  ownerId?: string;
  reviewer?: string;
  reviewerId?: string;
  reviewerIds?: readonly string[];
  reviewerNames?: readonly string[];
  expectedUpdatedAt?: string;
  status: string;
  progress: number;
  tone: AssignmentTone;
  scope?: string;
  description?: string | null;
  recurringScheduleId?: string | null;
  engagementId?: string | null;
  engagementCode?: string | null;
  milestones?: AssignmentMilestone[];
  deliveryNotes?: string | null;
  reviewNotes?: string | null;
  fee?: number;
  billed?: boolean;
  invoiceId?: string;
  bankStatementRequired?: boolean;
  bankRecStatus?: 'Completed' | 'In progress' | 'Awaited' | 'Not applicable' | 'Not recorded';
}

export const ASSIGNMENTS: AssignmentRow[] = [
  {
    id: 'ASN-0001',
    title: 'GSTR-1 filing — October',
    client: 'Aster Foods Private Limited',
    clientId: 'CLI-0001',
    service: 'GST Compliance',
    due: '03/11/2026',
    owner: 'Priya Desai',
    reviewer: 'Ananya Rao',
    status: 'In progress',
    progress: 72,
    tone: 'default',
    scope: 'Monthly outward supplies return, sales register verification, B2B e-invoices reconciliation.',
    milestones: [
      { title: 'Obtain October sales ledger & bank statements', done: true },
      { title: 'Reconcile e-invoices with GSTR-1 draft JSON', done: true },
      { title: 'Verify HSN summary & tax rate split (9%+9%)', done: true },
      { title: 'Client sign-off on tax liability', done: false },
      { title: 'Filing on GSTN portal via DSC', done: false },
    ],
    deliveryNotes: 'Sales register received. Awaiting client confirmation for 2 debit notes.',
    fee: 25000,
    billed: true,
    invoiceId: 'INV-2026-0081',
  },
  {
    id: 'ASN-0002',
    title: 'Q2 internal audit',
    client: 'BluePeak Technologies LLP',
    clientId: 'CLI-0002',
    service: 'Internal Audit',
    due: '06/11/2026',
    owner: 'Rohan Mehta',
    reviewer: 'Priya Desai',
    status: 'Pending review',
    progress: 84,
    tone: 'warning',
    scope: 'Quarterly internal controls testing, procurement vouchers sampling, statutory registers verification.',
    milestones: [
      { title: 'Procurement sample vouching (50 invoices)', done: true },
      { title: 'Fixed asset register physical verification audit', done: true },
      { title: 'Draft audit observations & risk matrix', done: true },
      { title: 'Managerial review by Senior Staff', done: true },
      { title: 'Partner closing conference with BluePeak management', done: false },
    ],
    deliveryNotes: 'Observations memorandum compiled. Waiting for management response on inventory variance.',
    fee: 75000,
    billed: true,
    invoiceId: 'INV-2026-0082',
  },
  {
    id: 'ASN-0003',
    title: 'TDS return — Q2',
    client: 'Sharma Retail',
    clientId: 'CLI-0003',
    service: 'Tax Compliance',
    due: 'Today',
    owner: 'Priya Desai',
    reviewer: 'Ananya Rao',
    status: 'Awaiting documents',
    progress: 45,
    tone: 'danger',
    scope: 'Form 26Q quarterly return, challan 281 verification, PAN validation via TRACES.',
    milestones: [
      { title: 'Extract TDS deduction register from Tally', done: true },
      { title: 'Verify Challan 281 BSR codes & CIN numbers', done: true },
      { title: 'Obtain pending deductee PAN declarations', done: false },
      { title: 'Generate FVU validation file via NSDL utility', done: false },
      { title: 'Upload on IT portal & generate provisional receipt', done: false },
    ],
    deliveryNotes: '3 vendor PAN cards missing; penal interest will apply if delayed beyond today.',
    fee: 15000,
    billed: false,
  },
  {
    id: 'ASN-0004',
    title: 'Monthly bookkeeping — October',
    client: 'Kedia Holdings',
    clientId: 'CLI-0004',
    service: 'Bookkeeping',
    due: '30/11/2026',
    owner: 'Rohan Mehta',
    reviewer: 'Ananya Rao',
    status: 'On track',
    progress: 61,
    tone: 'success',
    scope: 'Ledger scrutiny, bank statement entries, investment journal vouchers, monthly P&L trial balance.',
    milestones: [
      { title: 'Import bank statement entries into Tally', done: true },
      { title: 'Reconcile mutual fund dividend credits', done: true },
      { title: 'Depreciation & prepaid adjustments journal', done: true },
      { title: 'Monthly trial balance & MIS reporting', done: false },
    ],
    deliveryNotes: 'Bookkeeping up to 25th October completed. Dividend statement reconciled.',
    fee: 15000,
    billed: true,
    invoiceId: 'INV-2026-0084',
  },
  {
    id: 'ASN-0005',
    title: 'Statutory Audit FY 2025-26',
    client: 'Northstar Exports',
    clientId: 'CLI-0005',
    service: 'Statutory Audit',
    due: '10/11/2026',
    owner: 'Ananya Rao',
    reviewer: 'S. Narayanan',
    status: 'In progress',
    progress: 40,
    tone: 'default',
    scope: 'Companies Act 2013 audit, CARO 2020 verification, export realization compliance (FIRC/BRC).',
    milestones: [
      { title: 'Initial audit engagement letter & CARO checklist', done: true },
      { title: 'Export turnover vs EDPMS reconciliation', done: true },
      { title: 'Bank balance confirmation letters circularization', done: false },
      { title: 'Independent auditor report drafting', done: false },
    ],
    deliveryNotes: 'EDPMS reconciliation completed. 3 foreign inward remittances pending bank confirmation.',
    fee: 65000,
    billed: false,
  },
  {
    id: 'ASN-0006',
    title: 'Income Tax Scrutiny Submission',
    client: 'Apex Global Logistics',
    clientId: 'CLI-0006',
    service: 'Direct Tax Advisory',
    due: '15/11/2026',
    owner: 'Priya Desai',
    reviewer: 'S. Narayanan',
    status: 'In progress',
    progress: 55,
    tone: 'warning',
    scope: 'Section 143(3) scrutiny response, freight forwarding expenses verification, TDS reconciliation with 26AS.',
    milestones: [
      { title: 'Extract Section 142(1) notice questionnaire', done: true },
      { title: 'Compile ledger accounts with supporting vouchers', done: true },
      { title: 'Prepare point-by-point written submission', done: false },
      { title: 'Upload on IT e-filing portal under partner DSC', done: false },
    ],
    deliveryNotes: 'Hearing deadline 15th November. Vouchers compiled for 80% sample.',
    fee: 45000,
    billed: true,
    invoiceId: 'INV-2026-0086',
  },
];

export interface PersonalTaskRecord {
  id: string;
  code?: string;
  title: string;
  context: string;
  time: string;
  done: boolean;
  ownerRole?: string;
}

export const PERSONAL_TASKS: PersonalTaskRecord[] = [
  { id: 'TSK-P-01', title: 'Call Aster Foods for purchase register', context: 'Aster Foods', time: 'Today · 11:30', done: false },
  { id: 'TSK-P-02', title: 'Review BluePeak audit observation', context: 'ASN-0002', time: 'Today · 15:00', done: false },
  { id: 'TSK-P-03', title: 'Prepare tomorrow’s filing list', context: 'Personal', time: 'Today · 17:15', done: true },
];

export type DelegatedTaskStatus = 'To Do' | 'In Progress' | 'Pending Review' | 'Completed';

export interface DelegatedTaskRecord {
  id: string;
  code?: string;
  kind: 'delegated' | 'internal';
  title: string;
  parent: string;
  parentAssignmentId?: string;
  person: string;
  assigneeId?: string;
  assignedBy: string;
  createdById?: string;
  due: string;
  progress: number;
  status: DelegatedTaskStatus;
  tone?: 'default' | 'danger' | 'warning' | 'success';
  instructions?: string;
}

export const DELEGATED_TASKS: DelegatedTaskRecord[] = [
  {
    id: 'TSK-D-01',
    kind: 'delegated',
    title: 'Reconcile portal sales totals with books',
    parent: 'ASN-0001 · Aster Foods',
    parentAssignmentId: 'ASN-0001',
    person: 'Neha Kapoor',
    assignedBy: 'Priya Desai',
    due: 'Today',
    progress: 70,
    status: 'In Progress',
    instructions: 'Cross-check October sales summary with GSTR-2B download. Note any missing e-way bill references.',
  },
  {
    id: 'TSK-D-02',
    kind: 'delegated',
    title: 'Index supporting invoices for sample testing',
    parent: 'ASN-0001 · Aster Foods',
    parentAssignmentId: 'ASN-0001',
    person: 'Neha Kapoor',
    assignedBy: 'Priya Desai',
    due: 'Tomorrow',
    progress: 35,
    status: 'In Progress',
    instructions: 'Match vendor tax invoices with purchase register columns (Taxable, CGST, SGST).',
  },
  {
    id: 'TSK-D-03',
    kind: 'delegated',
    title: 'Prepare audit evidence register',
    parent: 'ASN-0002 · BluePeak',
    parentAssignmentId: 'ASN-0002',
    person: 'Rohan Mehta',
    assignedBy: 'Ananya Rao',
    due: '04/11',
    progress: 82,
    status: 'Pending Review',
    instructions: 'Compile fixed assets physical verification sheets and cross-reference with balance sheet schedule.',
  },
];

export const CLIENT_OUTSTANDING = [
  { client: 'BluePeak Technologies LLP', amount: '₹88,500', age: '62 days', tone: 'danger' as const },
  { client: 'Aster Foods Private Limited', amount: '₹14,500', age: '18 days', tone: 'warning' as const },
  { client: 'Northstar Exports', amount: '₹12,000', age: '9 days', tone: 'default' as const },
  { client: 'Kedia Holdings', amount: '₹6,750', age: 'Current', tone: 'success' as const },
];

export type ClientType =
  | 'Private Limited'
  | 'LLP'
  | 'Proprietorship'
  | 'Partnership'
  | 'Individual'
  | 'Public Limited';

export interface ClientRecord {
  id: string;
  name: string;
  tradeName: string;
  type: ClientType;
  industry: string;
  pan: string;
  gstin: string;
  gstScheme?: 'Regular' | 'QRMP' | 'Composition' | 'Unregistered';
  city: string;
  state: string;
  contactName: string;
  contactDesignation: string;
  phone: string;
  email: string;
  primaryOwner: string;
  status: 'Active' | 'Review required' | 'Suspended';
  billingFrequency: 'Monthly' | 'Quarterly' | 'Annual';
  recurringFee: string;
  outstanding: string;
  outstandingAge: string;
  outstandingTone: 'default' | 'danger' | 'warning' | 'success';
  activeAssignments: number;
  pendingDocs: number;
  onboardedDate: string;
  cin?: string;
  tan?: string;
  notes: string;
  bankStatementRequired?: boolean;
  hasBankAccount?: boolean;
}

export const CLIENTS: ClientRecord[] = [
  {
    id: 'CLI-0001',
    name: 'Aster Foods Private Limited',
    tradeName: 'Aster Foods',
    type: 'Private Limited',
    industry: 'FMCG & Food Processing',
    pan: 'AABCA1234F',
    gstin: '27AABCA1234F1Z5',
    gstScheme: 'Regular',
    city: 'Mumbai',
    state: 'Maharashtra',
    contactName: 'Rajesh Varma',
    contactDesignation: 'Managing Director',
    phone: '+91 98201 44521',
    email: 'accounts@asterfoods.com',
    primaryOwner: 'Priya Desai',
    status: 'Active',
    billingFrequency: 'Monthly',
    recurringFee: '₹25,000',
    outstanding: '₹14,500',
    outstandingAge: '18 days',
    outstandingTone: 'warning',
    activeAssignments: 2,
    pendingDocs: 1,
    onboardedDate: '15/04/2024',
    cin: 'U15400MH2021PTC362145',
    tan: 'MUMB12345E',
    notes: 'Monthly GSTR-1 and GSTR-3B filing. Annual audit conducted in September.',
  },
  {
    id: 'CLI-0002',
    name: 'BluePeak Technologies LLP',
    tradeName: 'BluePeak Tech',
    type: 'LLP',
    industry: 'IT & Cloud Solutions',
    pan: 'AABCB5678G',
    gstin: '27AABCB5678G1Z8',
    gstScheme: 'Regular',
    city: 'Pune',
    state: 'Maharashtra',
    contactName: 'Nitin Kulkarni',
    contactDesignation: 'Designated Partner',
    phone: '+91 98902 33140',
    email: 'nitin@bluepeak.io',
    primaryOwner: 'Rohan Mehta',
    status: 'Review required',
    billingFrequency: 'Monthly',
    recurringFee: '₹40,000',
    outstanding: '₹88,500',
    outstandingAge: '62 days overdue',
    outstandingTone: 'danger',
    activeAssignments: 1,
    pendingDocs: 2,
    onboardedDate: '10/01/2023',
    tan: 'PUNE09876C',
    notes: 'Internal audit in progress. Outstanding billing requires collection intervention.',
  },
  {
    id: 'CLI-0003',
    name: 'Sharma Retail',
    tradeName: 'Sharma Superstore',
    type: 'Proprietorship',
    industry: 'Consumer Retail',
    pan: 'BHPPS9821L',
    gstin: '27BHPPS9821L1Z2',
    gstScheme: 'Composition',
    city: 'Thane',
    state: 'Maharashtra',
    contactName: 'Manoj Sharma',
    contactDesignation: 'Proprietor',
    phone: '+91 97690 12890',
    email: 'sharmaretail@gmail.com',
    primaryOwner: 'Priya Desai',
    status: 'Active',
    billingFrequency: 'Quarterly',
    recurringFee: '₹15,000',
    outstanding: '₹0',
    outstandingAge: 'Current',
    outstandingTone: 'success',
    activeAssignments: 1,
    pendingDocs: 1,
    onboardedDate: '01/06/2023',
    notes: 'Composition scheme quarterly CMP-08 filing and Q2 TDS compliance.',
  },
  {
    id: 'CLI-0004',
    name: 'Kedia Holdings',
    tradeName: 'Kedia Advisory',
    type: 'Private Limited',
    industry: 'Financial Advisory',
    pan: 'AABCK4321D',
    gstin: '27AABCK4321D1Z1',
    gstScheme: 'QRMP',
    city: 'Mumbai',
    state: 'Maharashtra',
    contactName: 'Vikram Kedia',
    contactDesignation: 'Director',
    phone: '+91 98210 56789',
    email: 'vikram@kediaholdings.in',
    primaryOwner: 'Rohan Mehta',
    status: 'Active',
    billingFrequency: 'Monthly',
    recurringFee: '₹20,000',
    outstanding: '₹6,750',
    outstandingAge: 'Current',
    outstandingTone: 'success',
    activeAssignments: 1,
    pendingDocs: 0,
    onboardedDate: '12/08/2024',
    cin: 'U65990MH2022PTC384512',
    notes: 'QRMP quarterly return filer with monthly PMT-06 tax payment.',
  },
  {
    id: 'CLI-0005',
    name: 'Northstar Exports',
    tradeName: 'Northstar Textiles',
    type: 'Partnership',
    industry: 'Textile Manufacturing & Export',
    pan: 'AABCN7890M',
    gstin: '24AABCN7890M1Z7',
    gstScheme: 'Regular',
    city: 'Surat',
    state: 'Gujarat',
    contactName: 'Kunal Patel',
    contactDesignation: 'Managing Partner',
    phone: '+91 98250 88712',
    email: 'kunal@northstarexports.com',
    primaryOwner: 'Ananya Rao',
    status: 'Active',
    billingFrequency: 'Monthly',
    recurringFee: '₹35,000',
    outstanding: '₹12,000',
    outstandingAge: '9 days',
    outstandingTone: 'default',
    activeAssignments: 1,
    pendingDocs: 1,
    onboardedDate: '05/11/2023',
    tan: 'SURT54321A',
    notes: 'GST refund applications (LUT/export without payment of tax) and export remittances.',
  },
  {
    id: 'CLI-0006',
    name: 'Apex Logistics Limited',
    tradeName: 'Apex Express',
    type: 'Public Limited',
    industry: 'Freight & Transportation',
    pan: 'AABCA9012E',
    gstin: '27AABCA9012E1Z3',
    gstScheme: 'Regular',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    contactName: 'Sanjay Deshmukh',
    contactDesignation: 'CFO',
    phone: '+91 98190 66442',
    email: 'cfo@apexlogistics.com',
    primaryOwner: 'Ananya Rao',
    status: 'Active',
    billingFrequency: 'Quarterly',
    recurringFee: '₹75,000',
    outstanding: '₹0',
    outstandingAge: 'Current',
    outstandingTone: 'success',
    activeAssignments: 2,
    pendingDocs: 0,
    onboardedDate: '20/02/2022',
    cin: 'L60200MH2015PLC271890',
    tan: 'MUMB98765B',
    notes: 'Comprehensive statutory audit and multi-state GST compliance across 4 states.',
  },
];

export type ScheduleCategory = 'GST' | 'TDS' | 'Bookkeeping' | 'Payroll' | 'Audit & ROC';
export type ScheduleCadence = 'Monthly' | 'Quarterly' | 'Annual';

export interface RecurringScheduleRecord {
  id: string;
  code?: string;
  title: string;
  service?: string;
  category: ScheduleCategory | string;
  clientId: string;
  clientCode?: string;
  clientName: string;
  cadence: ScheduleCadence;
  generationDay?: number;
  statutoryDueDay?: string;
  defaultOwner: string;
  nextRunDate: string;
  nextDueDate: string;
  engagementId?: string | null;
  engagementCode?: string | null;
  status: 'Active' | 'Needs attention' | 'Paused';
  exceptionReason?: string;
  bankRecStatus?: 'Completed' | 'In progress' | 'Awaited' | 'Not applicable';
  currentStatus?: 'Pending' | 'Bank Statement Received' | 'Docs Awaited' | 'Ready to File' | 'Filed' | 'Active' | 'Paused';
  checklistTemplate?: string[];
  history?: Array<{
    period: string;
    assignmentId: string;
    status: string;
    completedOn?: string;
  }>;
}

export const RECURRING_SCHEDULES: RecurringScheduleRecord[] = [
  {
    id: 'SCH-0001',
    title: 'GSTR-1 Monthly',
    category: 'GST',
    clientId: 'CLI-0001',
    clientName: 'Aster Foods Private Limited',
    cadence: 'Monthly',
    generationDay: 1,
    statutoryDueDay: '11th of every month',
    defaultOwner: 'Priya Desai',
    nextRunDate: '01/11/2026',
    nextDueDate: '11/11/2026',
    status: 'Active',
    bankRecStatus: 'Completed',
    currentStatus: 'Ready to File',
    checklistTemplate: [
      'Obtain bank statements for the month (Required before GSTR-1 outward filing)',
      'Collect outward sales invoices and credit notes',
      'Validate HSN code classification and GST rates',
      'Reconcile invoice serial number sequences',
      'Upload JSON payload to GSTN portal and verify submission via DSC',
    ],
    history: [
      { period: 'October 2026', assignmentId: 'ASN-0001', status: 'In progress' },
      { period: 'September 2026', assignmentId: 'ASN-0098', status: 'Completed', completedOn: '10/10/2026' },
      { period: 'August 2026', assignmentId: 'ASN-0065', status: 'Completed', completedOn: '11/09/2026' },
    ],
  },
  {
    id: 'SCH-0002',
    title: 'GSTR-3B Monthly',
    category: 'GST',
    clientId: 'CLI-0001',
    clientName: 'Aster Foods Private Limited',
    cadence: 'Monthly',
    generationDay: 12,
    statutoryDueDay: '20th of every month',
    defaultOwner: 'Priya Desai',
    nextRunDate: '12/11/2026',
    nextDueDate: '20/11/2026',
    status: 'Active',
    bankRecStatus: 'Completed',
    currentStatus: 'Pending',
    checklistTemplate: [
      'Verify bank payments for GST Challan PMT-06',
      'Download auto-drafted GSTR-2B purchase register',
      'Reconcile eligible vs blocked Input Tax Credit (Rule 42/43)',
      'Calculate net cash tax payable after ITC ledger set-off',
      'File final GSTR-3B return with DSC / EVC',
    ],
    history: [
      { period: 'September 2026', assignmentId: 'ASN-0082', status: 'Completed', completedOn: '19/10/2026' },
      { period: 'August 2026', assignmentId: 'ASN-0051', status: 'Completed', completedOn: '20/09/2026' },
    ],
  },
  {
    id: 'SCH-0003',
    title: 'Monthly Bank & Ledger Reconciliation',
    category: 'Bookkeeping',
    clientId: 'CLI-0004',
    clientName: 'Kedia Holdings',
    cadence: 'Monthly',
    generationDay: 2,
    statutoryDueDay: '30th of every month',
    defaultOwner: 'Rohan Mehta',
    nextRunDate: '02/11/2026',
    nextDueDate: '30/11/2026',
    status: 'Active',
    bankRecStatus: 'In progress',
    currentStatus: 'Docs Awaited',
    checklistTemplate: [
      'Import HDFC / ICICI bank statements via CSV',
      'Auto-match recurring vendor disbursements',
      'Resolve suspense entries with Vikram Kedia',
      'Prepare month-end trial balance & ledger pack',
    ],
    history: [
      { period: 'October 2026', assignmentId: 'ASN-0004', status: 'On track' },
      { period: 'September 2026', assignmentId: 'ASN-0074', status: 'Completed', completedOn: '08/10/2026' },
    ],
  },
  {
    id: 'SCH-0004',
    title: 'Monthly TDS Deposit (Challan 281)',
    category: 'TDS',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    cadence: 'Monthly',
    generationDay: 1,
    statutoryDueDay: '07th of every month',
    defaultOwner: 'Rohan Mehta',
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
    history: [
      { period: 'September 2026', assignmentId: 'ASN-0071', status: 'Completed', completedOn: '06/10/2026' },
      { period: 'August 2026', assignmentId: 'ASN-0044', status: 'Completed', completedOn: '07/09/2026' },
    ],
  },
  {
    id: 'SCH-0005',
    title: 'Quarterly TDS Return Filing (Form 26Q)',
    category: 'TDS',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    cadence: 'Quarterly',
    generationDay: 15,
    statutoryDueDay: '31st of Jan/Apr/Jul/Oct',
    defaultOwner: 'Rohan Mehta',
    nextRunDate: '15/01/2027',
    nextDueDate: '31/01/2027',
    status: 'Active',
    bankRecStatus: 'Not applicable',
    currentStatus: 'Docs Awaited',
    checklistTemplate: [
      'Reconcile monthly Challan 281 receipts against books',
      'Validate deductee PAN records on TRACES portal',
      'Run RPU utility to generate FVU verification file',
      'Upload file to TIN-NSDL portal and download provisional receipt',
    ],
    history: [
      { period: 'Q2 (Jul–Sep 2026)', assignmentId: 'ASN-0003', status: 'Awaiting documents' },
      { period: 'Q1 (Apr–Jun 2026)', assignmentId: 'ASN-0022', status: 'Completed', completedOn: '29/07/2026' },
    ],
  },
  {
    id: 'SCH-0006',
    title: 'GSTR-1 Monthly',
    category: 'GST',
    clientId: 'CLI-0002',
    clientName: 'BluePeak Technologies LLP',
    cadence: 'Monthly',
    generationDay: 1,
    statutoryDueDay: '11th of every month',
    defaultOwner: 'Priya Desai',
    nextRunDate: '01/11/2026',
    nextDueDate: '11/11/2026',
    status: 'Active',
    bankRecStatus: 'Awaited',
    currentStatus: 'Docs Awaited',
    checklistTemplate: [
      'Obtain bank statements for the month (Required before GSTR-1 outward filing)',
      'Export Stripe/Razorpay SaaS outward invoices',
      'Verify export/domestic B2B invoice GST rates',
      'File GSTR-1 payload on portal',
    ],
    history: [
      { period: 'September 2026', assignmentId: 'ASN-0084', status: 'Completed', completedOn: '10/10/2026' },
    ],
  },
  {
    id: 'SCH-0007',
    title: 'GSTR-3B Monthly',
    category: 'GST',
    clientId: 'CLI-0002',
    clientName: 'BluePeak Technologies LLP',
    cadence: 'Monthly',
    generationDay: 12,
    statutoryDueDay: '20th of every month',
    defaultOwner: 'Priya Desai',
    nextRunDate: '12/11/2026',
    nextDueDate: '20/11/2026',
    status: 'Active',
    bankRecStatus: 'Awaited',
    currentStatus: 'Pending',
    checklistTemplate: [
      'Reconcile cloud hosting input tax credits (AWS/Azure)',
      'Compute net liability after ITC offset',
      'Confirm tax payment and file GSTR-3B',
    ],
    history: [
      { period: 'September 2026', assignmentId: 'ASN-0085', status: 'Completed', completedOn: '19/10/2026' },
    ],
  },
  {
    id: 'SCH-0008',
    title: 'GSTR-1 Monthly',
    category: 'GST',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    cadence: 'Monthly',
    generationDay: 1,
    statutoryDueDay: '11th of every month',
    defaultOwner: 'Rohan Mehta',
    nextRunDate: '01/11/2026',
    nextDueDate: '11/11/2026',
    status: 'Active',
    bankRecStatus: 'In progress',
    currentStatus: 'Bank Statement Received',
    checklistTemplate: [
      'Reconcile daily POS cashier cash & card swiping against bank deposits',
      'Compile B2C and B2B outward sales invoices',
      'Upload and verify GSTR-1 on portal',
    ],
    history: [
      { period: 'September 2026', assignmentId: 'ASN-0086', status: 'Completed', completedOn: '11/10/2026' },
    ],
  },
  {
    id: 'SCH-0009',
    title: 'GSTR-3B Monthly',
    category: 'GST',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    cadence: 'Monthly',
    generationDay: 12,
    statutoryDueDay: '20th of every month',
    defaultOwner: 'Rohan Mehta',
    nextRunDate: '12/11/2026',
    nextDueDate: '20/11/2026',
    status: 'Active',
    bankRecStatus: 'In progress',
    currentStatus: 'Pending',
    checklistTemplate: [
      'Download GSTR-2B purchase register',
      'Verify vendor ITC eligibility for retail stock purchases',
      'Pay balance GST via Challan and file 3B',
    ],
    history: [
      { period: 'September 2026', assignmentId: 'ASN-0087', status: 'Completed', completedOn: '20/10/2026' },
    ],
  },
];

export const ROLE_COPY: Record<CompanyRole, { eyebrow?: string; title: string; description: string }> = {
  founder: {
    eyebrow: '',
    title: 'Practice overview',
    description: 'Delivery, client exposure, team capacity, and cash position for FY 2026–27.',
  },
  manager: {
    eyebrow: '',
    title: 'Good day, Ananya',
    description: 'Today’s delivery pressure, review queue, recurring work, and office accounts.',
  },
  senior_staff: {
    eyebrow: '',
    title: 'Good day, Priya',
    description: 'Your client obligations, work delegated to the team, and items awaiting your review.',
  },
  staff: {
    eyebrow: '',
    title: 'Good day, Rohan',
    description: 'Your assignments, trainee follow-ups, personal reminders, and approaching deadlines.',
  },
  trainee: {
    eyebrow: '',
    title: 'Good day, Neha',
    description: 'A focused queue of delegated work, checklists, evidence, and personal reminders.',
  },
};

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    // Whole rupees stay compact; live billing amounts that carry paise are never rounded away.
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export type InvoiceStatus = 'Paid' | 'Partly Paid' | 'Pending' | 'Overdue' | 'Draft' | 'Cancelled';

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  description: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: number;
  gstAmount: number;
  total: number;
  amountReceived: number;
  balance: number;
  /** Exact pending amount in paise; send this to the server, never a rupee float. */
  balancePaise: number;
  status: InvoiceStatus;
  daysOverdue: number;
  clientCode?: string;
  /** Bill number as raised in Vyapar; absent on older demo rows. */
  vyaparBillNumber?: string;
  assignmentCode?: string;
  notes?: string;
  voidReason?: string;
  items?: InvoiceLineRecord[];
  payments?: InvoicePaymentRecord[];
}

/** One invoice line; amounts in rupees. */
export interface InvoiceLineRecord {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  gstPercent: number;
  amount: number;
}

/** One receipt allocated onto an invoice; amount in rupees, date DD/MM/YYYY. */
export interface InvoicePaymentRecord {
  receiptId: string;
  receiptNumber: string;
  date: string;
  amount: number;
  amountPaise: number;
  voided: boolean;
}

export type PaymentMode = 'Cash' | 'Bank transfer' | 'Cheque' | 'UPI' | 'Card' | 'Other';

export interface ReceiptRecord {
  id: string;
  receiptNumber: string;
  clientId: string;
  clientName: string;
  invoiceId: string;
  invoiceNumber: string;
  receiptDate: string;
  amount: number;
  amountPaise: number;
  paymentMode: PaymentMode;
  referenceNumber: string;
  notes: string;
  status?: 'Received' | 'Voided';
  allocations?: { invoiceId: string; invoiceNumber: string; amount: number }[];
  unallocated?: number;
}

export const INVOICES: InvoiceRecord[] = [
  {
    id: 'INV-2026-0045',
    invoiceNumber: 'SN/2026-27/0045',
    clientId: 'CLI-0002',
    clientName: 'BluePeak Technologies LLP',
    description: 'Statutory & Tax Audit Interim Retainer',
    invoiceDate: '01/08/2026',
    dueDate: '15/09/2026',
    subtotal: 75000,
    gstAmount: 13500,
    total: 88500,
    amountReceived: 0,
    balance: 88500,
    balancePaise: 8850000,
    status: 'Overdue',
    daysOverdue: 62,
  },
  {
    id: 'INV-2026-0062',
    invoiceNumber: 'SN/2026-27/0062',
    clientId: 'CLI-0001',
    clientName: 'Aster Foods Private Limited',
    description: 'September 2026 Monthly GST & TDS Compliance',
    invoiceDate: '01/10/2026',
    dueDate: '15/10/2026',
    subtotal: 12288,
    gstAmount: 2212,
    total: 14500,
    amountReceived: 14500,
    balance: 0,
    balancePaise: 0,
    status: 'Paid',
    daysOverdue: 0,
  },
  {
    id: 'INV-2026-0071',
    invoiceNumber: 'SN/2026-27/0071',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    description: 'Q2 TDS Return Filing & Retainer',
    invoiceDate: '01/10/2026',
    dueDate: '15/10/2026',
    subtotal: 12712,
    gstAmount: 2288,
    total: 15000,
    amountReceived: 15000,
    balance: 0,
    balancePaise: 0,
    status: 'Paid',
    daysOverdue: 0,
  },
  {
    id: 'INV-2026-0078',
    invoiceNumber: 'SN/2026-27/0078',
    clientId: 'CLI-0004',
    clientName: 'Kedia Holdings',
    description: 'Monthly Bookkeeping & Ledger Reconciliation — September',
    invoiceDate: '05/10/2026',
    dueDate: '20/10/2026',
    subtotal: 16949,
    gstAmount: 3051,
    total: 20000,
    amountReceived: 13250,
    balance: 6750,
    balancePaise: 675000,
    status: 'Partly Paid',
    daysOverdue: 10,
  },
  {
    id: 'INV-2026-0079',
    invoiceNumber: 'SN/2026-27/0079',
    clientId: 'CLI-0005',
    clientName: 'Northstar Exports',
    description: 'GST Export Refund (LUT) Filing & September Return',
    invoiceDate: '05/10/2026',
    dueDate: '21/10/2026',
    subtotal: 29661,
    gstAmount: 5339,
    total: 35000,
    amountReceived: 23000,
    balance: 12000,
    balancePaise: 1200000,
    status: 'Partly Paid',
    daysOverdue: 9,
  },
  {
    id: 'INV-2026-0080',
    invoiceNumber: 'SN/2026-27/0080',
    clientId: 'CLI-0006',
    clientName: 'Apex Logistics Limited',
    description: 'Q2 Multi-State GST Retainer & Audit Advisory',
    invoiceDate: '10/10/2026',
    dueDate: '25/10/2026',
    subtotal: 63559,
    gstAmount: 11441,
    total: 75000,
    amountReceived: 75000,
    balance: 0,
    balancePaise: 0,
    status: 'Paid',
    daysOverdue: 0,
  },
  {
    id: 'INV-2026-0081',
    invoiceNumber: 'SN/2026-27/0081',
    clientId: 'CLI-0001',
    clientName: 'Aster Foods Private Limited',
    description: 'October 2026 Monthly GST Retainer & Compliance',
    invoiceDate: '28/10/2026',
    dueDate: '12/11/2026',
    subtotal: 12288,
    gstAmount: 2212,
    total: 14500,
    amountReceived: 0,
    balance: 14500,
    balancePaise: 1450000,
    status: 'Pending',
    daysOverdue: 0,
  },
  {
    id: 'INV-2026-0082',
    invoiceNumber: 'SN/2026-27/0082',
    clientId: 'CLI-0002',
    clientName: 'BluePeak Technologies LLP',
    description: 'October 2026 Monthly GST & Cross-Border SaaS Advisory',
    invoiceDate: '28/10/2026',
    dueDate: '12/11/2026',
    subtotal: 29661,
    gstAmount: 5339,
    total: 35000,
    amountReceived: 0,
    balance: 35000,
    balancePaise: 3500000,
    status: 'Pending',
    daysOverdue: 0,
  },
  {
    id: 'INV-2026-0083',
    invoiceNumber: 'SN/2026-27/0083',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    description: 'October 2026 Retainer & Monthly GST Filing',
    invoiceDate: '30/10/2026',
    dueDate: '15/11/2026',
    subtotal: 12712,
    gstAmount: 2288,
    total: 15000,
    amountReceived: 0,
    balance: 15000,
    balancePaise: 1500000,
    status: 'Draft',
    daysOverdue: 0,
  },
];

export const RECEIPTS: ReceiptRecord[] = [
  {
    id: 'REC-2026-0041',
    receiptNumber: 'RCP/2026-27/0041',
    clientId: 'CLI-0001',
    clientName: 'Aster Foods Private Limited',
    invoiceId: 'INV-2026-0062',
    invoiceNumber: 'SN/2026-27/0062',
    receiptDate: '29/10/2026',
    amount: 14500,
    amountPaise: 1450000,
    paymentMode: 'Bank transfer',
    referenceNumber: 'HDFCN263028190',
    notes: 'Direct credit in practice current account.',
  },
  {
    id: 'REC-2026-0042',
    receiptNumber: 'RCP/2026-27/0042',
    clientId: 'CLI-0004',
    clientName: 'Kedia Holdings',
    invoiceId: 'INV-2026-0078',
    invoiceNumber: 'SN/2026-27/0078',
    receiptDate: '24/10/2026',
    amount: 13250,
    amountPaise: 1325000,
    paymentMode: 'Cheque',
    referenceNumber: 'CHQ-440912',
    notes: 'Part-settlement. Balance ₹6,750 committed on 10/11.',
  },
  {
    id: 'REC-2026-0043',
    receiptNumber: 'RCP/2026-27/0043',
    clientId: 'CLI-0005',
    clientName: 'Northstar Exports',
    invoiceId: 'INV-2026-0079',
    invoiceNumber: 'SN/2026-27/0079',
    receiptDate: '20/10/2026',
    amount: 23000,
    amountPaise: 2300000,
    paymentMode: 'Bank transfer',
    referenceNumber: 'ICICR52026102000',
    notes: 'Part-settlement for export refund assignment.',
  },
  {
    id: 'REC-2026-0044',
    receiptNumber: 'RCP/2026-27/0044',
    clientId: 'CLI-0003',
    clientName: 'Sharma Retail',
    invoiceId: 'INV-2026-0071',
    invoiceNumber: 'SN/2026-27/0071',
    receiptDate: '15/10/2026',
    amount: 15000,
    amountPaise: 1500000,
    paymentMode: 'UPI',
    referenceNumber: 'UPI-261015-882190',
    notes: 'Full settlement for Q2 TDS.',
  },
  {
    id: 'REC-2026-0045',
    receiptNumber: 'RCP/2026-27/0045',
    clientId: 'CLI-0006',
    clientName: 'Apex Logistics Limited',
    invoiceId: 'INV-2026-0050',
    invoiceNumber: 'SN/2026-27/0050',
    receiptDate: '05/10/2026',
    amount: 75000,
    amountPaise: 7500000,
    paymentMode: 'Bank transfer',
    referenceNumber: 'AXISN262788910',
    notes: 'Settled by corporate accounts via NEFT.',
  },
];

