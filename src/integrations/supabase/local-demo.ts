const DATA_KEY = "sn-crm-local-demo-data-v1";
const SESSION_KEY = "sn-crm-local-demo-session-v1";

export const LOCAL_DEMO_EMAIL = "demo@sn.local";
export const LOCAL_DEMO_PASSWORD = "Demo@1234";
export const LOCAL_DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

interface Row {
  [key: string]: any;
  id?: any;
  user_id?: any;
  role?: any;
  created_at?: any;
  is_demo?: any;
  client_code?: any;
  engagement_code?: any;
  assignment_code?: any;
  task_code?: any;
  invoice_number?: any;
  receipt_number?: any;
  invoice_id?: any;
  engagement_id?: any;
  amount?: any;
  amount_received?: any;
  status?: any;
  total?: any;
  due_date?: any;
}
type Tables = Record<string, Row[]>;

const iso = (days = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const timestamp = (days = 0) => `${iso(days)}T09:30:00.000Z`;

function seedTables(): Tables {
  const founder = LOCAL_DEMO_USER_ID;
  return {
    profiles: [
      {
        id: founder,
        full_name: "S. Narayanan",
        email: LOCAL_DEMO_EMAIL,
        designation: "Founder",
        phone: "+91 98765 43210",
        is_active: true,
        created_at: timestamp(-300),
      },
      {
        id: "user-2",
        full_name: "Meera Iyer",
        email: "meera@sn.local",
        designation: "Manager",
        is_active: true,
        created_at: timestamp(-240),
      },
      {
        id: "user-3",
        full_name: "Arjun Rao",
        email: "arjun@sn.local",
        designation: "Accounts Executive",
        is_active: true,
        created_at: timestamp(-180),
      },
    ],
    user_roles: [
      { user_id: founder, role: "founder" },
      { user_id: "user-2", role: "manager" },
      { user_id: "user-3", role: "accounts" },
    ],
    departments: [
      {
        id: "dept-1",
        name: "Tax & Compliance",
        description: "GST, TDS and statutory work",
        is_active: true,
        created_at: timestamp(-300),
      },
      {
        id: "dept-2",
        name: "Audit & Assurance",
        description: "Internal and statutory audits",
        is_active: true,
        created_at: timestamp(-300),
      },
      {
        id: "dept-3",
        name: "Accounts & Advisory",
        description: "Bookkeeping and CFO services",
        is_active: true,
        created_at: timestamp(-300),
      },
    ],
    user_departments: [
      { user_id: founder, department_id: "dept-1" },
      { user_id: founder, department_id: "dept-3" },
      { user_id: "user-2", department_id: "dept-2" },
      { user_id: "user-3", department_id: "dept-3" },
    ],
    clients: [
      {
        id: "client-1",
        client_code: "CLI-0001",
        name: "Aster Foods Private Limited",
        client_type: "Private Limited",
        status: "Active",
        category: "A",
        industry: "Food processing",
        nature_of_business: "Manufacturing and distribution",
        contact_name: "Kavita Shah",
        contact_designation: "Director",
        mobile: "+91 98111 10101",
        whatsapp: "+91 98111 10101",
        email: "finance@aster.example",
        gstin: "27AAAAA0000A1Z5",
        pan: "AAAAA0000A",
        address_line: "12 Market Road",
        city: "Mumbai",
        state: "Maharashtra",
        pin_code: "400001",
        primary_department: "dept-1",
        primary_staff: founder,
        relationship_manager: founder,
        recurring_fee: 25000,
        billing_frequency: "Monthly",
        payment_due_days: 15,
        fee_terms: "Monthly retainer",
        onboarded_on: iso(-240),
        notes: "Priority client",
        is_demo: true,
        created_at: timestamp(-240),
      },
      {
        id: "client-2",
        client_code: "CLI-0002",
        name: "BluePeak Technologies LLP",
        client_type: "LLP",
        status: "Active",
        category: "B",
        industry: "Information technology",
        nature_of_business: "Software services",
        contact_name: "Rohan Menon",
        mobile: "+91 98222 20202",
        whatsapp: "+91 98222 20202",
        email: "accounts@bluepeak.example",
        gstin: "29BBBBB1111B1Z4",
        pan: "BBBBB1111B",
        city: "Bengaluru",
        state: "Karnataka",
        primary_department: "dept-3",
        primary_staff: "user-2",
        relationship_manager: "user-2",
        recurring_fee: 18000,
        billing_frequency: "Monthly",
        payment_due_days: 15,
        onboarded_on: iso(-180),
        notes: null,
        is_demo: true,
        created_at: timestamp(-180),
      },
      {
        id: "client-3",
        client_code: "CLI-0003",
        name: "Cedar Family Trust",
        client_type: "Trust",
        status: "Prospect",
        category: "C",
        industry: "Investments",
        contact_name: "Anita Desai",
        mobile: "+91 98333 30303",
        email: "anita@cedar.example",
        city: "Pune",
        state: "Maharashtra",
        primary_department: "dept-3",
        primary_staff: founder,
        recurring_fee: 0,
        billing_frequency: "Annual",
        payment_due_days: 30,
        onboarded_on: iso(-30),
        notes: "Proposal under discussion",
        is_demo: true,
        created_at: timestamp(-30),
      },
    ],
    client_contacts: [
      {
        id: "contact-1",
        client_id: "client-1",
        name: "Kavita Shah",
        designation: "Director",
        email: "kavita@aster.example",
        phone: "+91 98111 10101",
        is_primary: true,
        created_at: timestamp(-200),
      },
    ],
    client_branches: [
      {
        id: "branch-1",
        client_id: "client-1",
        name: "Mumbai Head Office",
        address: "12 Market Road, Mumbai",
        gstin: "27AAAAA0000A1Z5",
        is_active: true,
        created_at: timestamp(-200),
      },
    ],
    services: [
      {
        id: "service-1",
        code: "GST-RET",
        name: "GST Return Filing",
        service_group: "Tax Compliance",
        department_id: "dept-1",
        default_fee: 6000,
        billing_frequency: "Monthly",
        is_recurring: true,
        recurrence_frequency: "Monthly",
        requires_review: true,
        timeline_days: 10,
        required_documents: "Sales register, purchase register, bank statements",
        is_active: true,
        created_at: timestamp(-300),
      },
      {
        id: "service-2",
        code: "INT-AUD",
        name: "Internal Audit",
        service_group: "Audit",
        department_id: "dept-2",
        default_fee: 75000,
        billing_frequency: "Quarterly",
        is_recurring: true,
        recurrence_frequency: "Quarterly",
        requires_review: true,
        timeline_days: 30,
        is_active: true,
        created_at: timestamp(-300),
      },
      {
        id: "service-3",
        code: "CFO-ADV",
        name: "Virtual CFO Advisory",
        service_group: "Advisory",
        department_id: "dept-3",
        default_fee: 30000,
        billing_frequency: "Monthly",
        is_recurring: true,
        recurrence_frequency: "Monthly",
        requires_review: true,
        timeline_days: 20,
        is_active: true,
        created_at: timestamp(-300),
      },
    ],
    engagements: [
      {
        id: "eng-1",
        engagement_code: "ENG-0001",
        client_id: "client-1",
        service_id: "service-1",
        agreed_fee: 6000,
        billing_frequency: "Monthly",
        start_date: iso(-180),
        status: "Active",
        fee_terms: "15 days",
        is_demo: true,
        created_at: timestamp(-180),
      },
      {
        id: "eng-2",
        engagement_code: "ENG-0002",
        client_id: "client-2",
        service_id: "service-2",
        agreed_fee: 75000,
        billing_frequency: "Quarterly",
        start_date: iso(-120),
        status: "Active",
        fee_terms: "30 days",
        is_demo: true,
        created_at: timestamp(-120),
      },
      {
        id: "eng-3",
        engagement_code: "ENG-0003",
        client_id: "client-2",
        service_id: "service-3",
        agreed_fee: 30000,
        billing_frequency: "Monthly",
        start_date: iso(-90),
        status: "Active",
        fee_terms: "15 days",
        is_demo: true,
        created_at: timestamp(-90),
      },
    ],
    work_assignments: [
      {
        id: "assignment-1",
        assignment_code: "ASN-0001",
        title: "GST return — September",
        client_id: "client-1",
        service_id: "service-1",
        engagement_id: "eng-1",
        department_id: "dept-1",
        assigned_staff: founder,
        reviewer: "user-2",
        collaborators: [],
        status: "In Progress",
        priority: "High",
        progress: 65,
        work_period: "September 2026",
        assigned_on: iso(-12),
        internal_due: iso(2),
        statutory_due: iso(5),
        follow_up_on: iso(1),
        blocker: null,
        agreed_fee: 6000,
        workflow_stage: 2,
        is_demo: true,
        created_by: founder,
        created_at: timestamp(-12),
        updated_at: timestamp(-1),
      },
      {
        id: "assignment-2",
        assignment_code: "ASN-0002",
        title: "Q2 internal audit",
        client_id: "client-2",
        service_id: "service-2",
        engagement_id: "eng-2",
        department_id: "dept-2",
        assigned_staff: "user-2",
        reviewer: founder,
        collaborators: [],
        status: "Pending Internal Review",
        priority: "Medium",
        progress: 80,
        work_period: "Q2 FY 2026–27",
        assigned_on: iso(-35),
        internal_due: iso(-2),
        statutory_due: iso(8),
        blocker: "Awaiting management response",
        agreed_fee: 75000,
        workflow_stage: 3,
        is_demo: true,
        created_by: founder,
        created_at: timestamp(-35),
        updated_at: timestamp(-2),
      },
      {
        id: "assignment-3",
        assignment_code: "ASN-0003",
        title: "Monthly MIS and cash-flow review",
        client_id: "client-2",
        service_id: "service-3",
        engagement_id: "eng-3",
        department_id: "dept-3",
        assigned_staff: "user-3",
        reviewer: founder,
        collaborators: [],
        status: "Completed",
        priority: "Medium",
        progress: 100,
        work_period: "September 2026",
        assigned_on: iso(-30),
        internal_due: iso(-8),
        statutory_due: iso(-5),
        actual_completion: iso(-6),
        agreed_fee: 30000,
        workflow_stage: 4,
        is_demo: true,
        created_by: founder,
        created_at: timestamp(-30),
        updated_at: timestamp(-6),
      },
    ],
    assignment_stages: [
      {
        id: "stage-1",
        assignment_id: "assignment-1",
        name: "Documents received",
        position: 1,
        status: "Completed",
        completed_at: timestamp(-8),
        completed_by: founder,
        created_at: timestamp(-12),
      },
      {
        id: "stage-2",
        assignment_id: "assignment-1",
        name: "Return preparation",
        position: 2,
        status: "In Progress",
        created_at: timestamp(-12),
      },
      {
        id: "stage-3",
        assignment_id: "assignment-1",
        name: "Review and filing",
        position: 3,
        status: "Pending",
        created_at: timestamp(-12),
      },
    ],
    checklist_items: [
      {
        id: "check-1",
        assignment_id: "assignment-1",
        title: "Reconcile GSTR-2B",
        is_done: true,
        completed_at: timestamp(-5),
        completed_by: founder,
        created_at: timestamp(-10),
      },
      {
        id: "check-2",
        assignment_id: "assignment-1",
        title: "Review outward supplies",
        is_done: false,
        created_at: timestamp(-10),
      },
    ],
    assignment_comments: [
      {
        id: "comment-1",
        assignment_id: "assignment-1",
        author_id: founder,
        body: "Purchase reconciliation is complete; reviewing exceptions.",
        created_at: timestamp(-1),
      },
    ],
    tasks: [
      {
        id: "task-1",
        task_code: "TSK-0001",
        title: "Confirm ITC mismatch with client",
        description: "Validate two unmatched supplier invoices",
        client_id: "client-1",
        assignment_id: "assignment-1",
        service_id: "service-1",
        assignee: founder,
        reviewer: "user-2",
        assigned_date: iso(-3),
        due_date: iso(1),
        status: "In Progress",
        priority: "High",
        progress: 50,
        blocker: null,
        completed_at: null,
        is_demo: true,
        created_at: timestamp(-3),
      },
      {
        id: "task-2",
        task_code: "TSK-0002",
        title: "Review audit findings",
        client_id: "client-2",
        assignment_id: "assignment-2",
        service_id: "service-2",
        assignee: founder,
        assigned_date: iso(-5),
        due_date: iso(-1),
        status: "Open",
        priority: "Urgent",
        progress: 10,
        blocker: "Management response pending",
        is_demo: true,
        created_at: timestamp(-5),
      },
    ],
    document_items: [
      {
        id: "doc-1",
        client_id: "client-1",
        assignment_id: "assignment-1",
        name: "September purchase register",
        category: "Accounts",
        period: "September 2026",
        status: "Received",
        requested_on: iso(-10),
        received_on: iso(-6),
        due_date: iso(-5),
        responsible: founder,
        is_demo: true,
        created_at: timestamp(-10),
      },
      {
        id: "doc-2",
        client_id: "client-1",
        assignment_id: "assignment-1",
        name: "Bank statement",
        category: "Banking",
        period: "September 2026",
        status: "Requested",
        requested_on: iso(-4),
        due_date: iso(1),
        responsible: founder,
        is_demo: true,
        created_at: timestamp(-4),
      },
    ],
    invoices: [
      {
        id: "invoice-1",
        invoice_number: "SNP/2026-27/001",
        client_id: "client-1",
        engagement_id: "eng-1",
        assignment_id: "assignment-1",
        invoice_date: iso(-20),
        due_date: iso(-5),
        description: "GST compliance retainer",
        subtotal: 25000,
        discount: 0,
        tax_rate: 18,
        tax_amount: 4500,
        total: 29500,
        amount_received: 15000,
        status: "Partially Paid",
        prepared_by: founder,
        is_demo: true,
        created_at: timestamp(-20),
      },
      {
        id: "invoice-2",
        invoice_number: "SNP/2026-27/002",
        client_id: "client-2",
        engagement_id: "eng-2",
        assignment_id: "assignment-2",
        invoice_date: iso(-8),
        due_date: iso(7),
        description: "Q2 internal audit",
        subtotal: 75000,
        discount: 0,
        tax_rate: 18,
        tax_amount: 13500,
        total: 88500,
        amount_received: 0,
        status: "Unpaid",
        prepared_by: founder,
        is_demo: true,
        created_at: timestamp(-8),
      },
    ],
    invoice_items: [
      {
        id: "item-1",
        invoice_id: "invoice-1",
        description: "Monthly GST compliance",
        quantity: 1,
        rate: 25000,
        amount: 25000,
        created_at: timestamp(-20),
      },
      {
        id: "item-2",
        invoice_id: "invoice-2",
        description: "Internal audit professional fee",
        quantity: 1,
        rate: 75000,
        amount: 75000,
        created_at: timestamp(-8),
      },
    ],
    payments: [
      {
        id: "payment-1",
        receipt_number: "RCT-0001",
        client_id: "client-1",
        receipt_date: iso(-10),
        amount: 15000,
        method: "Bank Transfer",
        reference_no: "UTR-DEMO-1001",
        bank_account: "Current Account",
        recorded_by: "user-3",
        is_demo: true,
        created_at: timestamp(-10),
      },
    ],
    payment_allocations: [
      {
        id: "allocation-1",
        payment_id: "payment-1",
        invoice_id: "invoice-1",
        amount: 15000,
        is_demo: true,
        created_at: timestamp(-10),
      },
    ],
    collection_followups: [
      {
        id: "followup-1",
        invoice_id: "invoice-1",
        owner: "user-3",
        followup_date: iso(-2),
        next_followup: iso(2),
        channel: "Phone",
        outcome: "Client promised payment next week",
        status: "Open",
        created_at: timestamp(-2),
      },
    ],
    client_tax_money: [
      {
        id: "tax-1",
        client_id: "client-1",
        tax_type: "GST",
        period: "September 2026",
        amount_received: 125000,
        amount_paid: 110000,
        balance: 15000,
        received_on: iso(-4),
        paid_on: iso(-2),
        status: "Partially Paid",
        reference_no: "GST-DEMO-01",
        responsible: "user-3",
        is_demo: true,
        created_at: timestamp(-4),
      },
    ],
    audit_engagements: [
      {
        id: "audit-1",
        client_id: "client-2",
        title: "Q2 Internal Audit",
        period: "Q2 FY 2026–27",
        scope: "Revenue, procurement and payroll controls",
        lead_auditor: "user-2",
        start_date: iso(-40),
        end_date: iso(10),
        status: "Fieldwork",
        overall_rating: "Needs Improvement",
        is_demo: true,
        created_at: timestamp(-40),
      },
    ],
    audit_findings: [
      {
        id: "finding-1",
        engagement_id: "audit-1",
        title: "Delayed vendor reconciliations",
        description: "Vendor ledgers are not reconciled monthly.",
        risk_category: "High",
        recommendation: "Introduce a monthly close checklist.",
        management_response: "Process owner assigned.",
        owner: "Finance Manager",
        due_date: iso(14),
        status: "In Progress",
        is_demo: true,
        created_at: timestamp(-12),
      },
    ],
    advisory_reports: [
      {
        id: "report-1",
        client_id: "client-2",
        title: "September management report",
        report_type: "Monthly MIS",
        period: "September 2026",
        summary: "Revenue grew while receivable days increased.",
        content: "Focus on collections and gross-margin discipline.",
        status: "Published",
        prepared_by: founder,
        is_demo: true,
        created_at: timestamp(-7),
      },
    ],
    advisory_actions: [
      {
        id: "action-1",
        client_id: "client-2",
        report_id: "report-1",
        title: "Reduce receivable days below 45",
        description: "Weekly review of overdue customer balances",
        owner: "Finance Manager",
        due_date: iso(20),
        status: "Open",
        priority: "High",
        is_demo: true,
        created_at: timestamp(-7),
      },
    ],
    comm_templates: [
      {
        id: "template-1",
        name: "Document reminder",
        message_type: "Missing document reminder",
        channel: "WhatsApp",
        language: "English",
        body: "Hello {{client_name}}, please share the pending documents for {{assignment}}.",
        is_active: true,
        created_at: timestamp(-120),
      },
      {
        id: "template-2",
        name: "Invoice reminder",
        message_type: "Invoice reminder",
        channel: "Email",
        language: "English",
        subject: "Payment reminder",
        body: "Dear {{client_name}}, invoice {{invoice_number}} is due for payment.",
        is_active: true,
        created_at: timestamp(-120),
      },
    ],
    comm_logs: [
      {
        id: "comm-1",
        client_id: "client-1",
        assignment_id: "assignment-1",
        template_id: "template-1",
        message_type: "Missing document reminder",
        channel: "WhatsApp",
        recipient: "+91 98111 10101",
        content: "Reminder to share the pending bank statement.",
        status: "Draft",
        created_by: founder,
        is_demo: true,
        created_at: timestamp(-1),
      },
    ],
    workflow_templates: [
      {
        id: "workflow-1",
        name: "Monthly Compliance",
        description: "Standard monthly compliance workflow",
        service_id: "service-1",
        is_active: true,
        created_at: timestamp(-200),
      },
    ],
    workflow_stages: [
      {
        id: "workflow-stage-1",
        template_id: "workflow-1",
        name: "Collect documents",
        position: 1,
        default_days: 3,
        requires_review: false,
        created_at: timestamp(-200),
      },
      {
        id: "workflow-stage-2",
        template_id: "workflow-1",
        name: "Prepare return",
        position: 2,
        default_days: 4,
        requires_review: true,
        created_at: timestamp(-200),
      },
    ],
    org_settings: [
      {
        id: 1,
        firm_name: "SN Practice (Local Demo)",
        address: "12 Example Street, Chennai 600001",
        phone: "+91 44 4000 0000",
        email: "hello@snpractice.local",
        logo_url: null,
        invoice_prefix: "SNP",
        default_tax_rate: 18,
        tax_label: "GST",
        bank_name: "Demo Bank",
        bank_account: "000012345678",
        ifsc: "DEMO0000001",
        upi_id: "snpractice@demo",
        whatsapp_provider: null,
        reminder_rules: {},
        updated_at: timestamp(),
      },
    ],
  };
}

let memoryTables: Tables | undefined;

function readTables(): Tables {
  if (typeof window === "undefined") return (memoryTables ??= seedTables());
  const stored = window.localStorage.getItem(DATA_KEY);
  if (stored)
    try {
      return JSON.parse(stored);
    } catch {
      /* reset corrupt data */
    }
  const seeded = seedTables();
  window.localStorage.setItem(DATA_KEY, JSON.stringify(seeded));
  return seeded;
}

function writeTables(tables: Tables) {
  memoryTables = tables;
  if (typeof window !== "undefined") window.localStorage.setItem(DATA_KEY, JSON.stringify(tables));
}

export function resetLocalDemoData() {
  writeTables(seedTables());
}

export function removeLocalDemoRecords() {
  const tables = readTables();
  for (const [name, rows] of Object.entries(tables)) {
    tables[name] = rows.filter((row) => row.is_demo !== true);
  }
  writeTables(tables);
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const randomId = () =>
  globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function splitSelection(selection: string): string[] {
  const parts: string[] = [];
  let depth = 0,
    current = "";
  for (const char of selection) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function foreignKey(base: string, relation: string): string {
  if (relation === "profiles")
    return (
      (
        {
          clients: "primary_staff",
          work_assignments: "assigned_staff",
          tasks: "assignee",
          collection_followups: "owner",
          client_tax_money: "responsible",
          document_items: "responsible",
          assignment_comments: "author_id",
        } as Record<string, string>
      )[base] ?? "profile_id"
    );
  return (
    (
      {
        clients: "client_id",
        services: "service_id",
        departments: "department_id",
        invoices: "invoice_id",
        payments: "payment_id",
      } as Record<string, string>
    )[relation] ?? `${relation.replace(/s$/, "")}_id`
  );
}

function attachRelations(tables: Tables, base: string, rows: Row[], selection: string): Row[] {
  const relations = splitSelection(selection).filter((part) => part.includes("("));
  return rows.map((source) => {
    const row = clone(source);
    for (const expression of relations) {
      const relation = expression.slice(0, expression.indexOf("(")).split("!")[0];
      if (!relation) continue;
      const target = tables[relation] ?? [];
      if (relation === "invoice_items")
        row[relation] = clone(target.filter((item) => item.invoice_id === row.id));
      else if (relation === "audit_findings")
        row[relation] = clone(target.filter((item) => item.engagement_id === row.id));
      else
        row[relation] = clone(
          target.find((item) => item.id === row[foreignKey(base, relation)]) ?? null,
        );
    }
    return row;
  });
}

function withDefaults(table: string, input: Row, length: number): Row {
  const row = { ...input };
  if (row.id == null && !["user_roles", "user_departments"].includes(table)) row.id = randomId();
  if (row.created_at == null) row.created_at = new Date().toISOString();
  if (
    row.is_demo == null &&
    ![
      "profiles",
      "user_roles",
      "user_departments",
      "departments",
      "services",
      "org_settings",
    ].includes(table)
  )
    row.is_demo = false;
  const prefixes: Record<string, string> = {
    clients: "CLI",
    engagements: "ENG",
    work_assignments: "ASN",
    tasks: "TSK",
    invoices: "SNP/LOCAL",
    payments: "RCT",
  };
  const code = prefixes[table]
    ? `${prefixes[table]}-${String(length + 1).padStart(4, "0")}`
    : undefined;
  if (table === "clients" && !row.client_code) row.client_code = code;
  if (table === "engagements" && !row.engagement_code) row.engagement_code = code;
  if (table === "work_assignments" && !row.assignment_code) row.assignment_code = code;
  if (table === "tasks" && !row.task_code) row.task_code = code;
  if (table === "invoices" && !row.invoice_number) row.invoice_number = code;
  if (table === "payments" && !row.receipt_number) row.receipt_number = code;
  return row;
}

function recomputeInvoices(tables: Tables) {
  for (const invoice of tables["invoices"] ?? []) {
    const received = (tables["payment_allocations"] ?? [])
      .filter((a) => a.invoice_id === invoice.id)
      .reduce((sum, a) => sum + Number(a.amount || 0), 0);
    invoice.amount_received = received;
    if (!["Draft", "Cancelled"].includes(invoice.status))
      invoice.status =
        received >= Number(invoice.total || 0)
          ? "Paid"
          : received > 0
            ? "Partially Paid"
            : invoice.due_date && invoice.due_date < iso()
              ? "Overdue"
              : "Unpaid";
  }
}

class LocalQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private selection = "*";
  private maxRows: number | undefined;
  private one = false;
  private countMode = false;
  private returning = false;

  constructor(
    private table: string,
    private action: "select" | "insert" | "update" | "delete" | "upsert" = "select",
    private payload?: any,
  ) {}
  select(selection = "*", options?: { count?: string }) {
    this.selection = selection;
    this.countMode = options?.count === "exact";
    this.returning = this.action !== "select";
    return this;
  }
  insert(payload: any) {
    return new LocalQuery(this.table, "insert", payload);
  }
  update(payload: any) {
    return new LocalQuery(this.table, "update", payload);
  }
  delete() {
    return new LocalQuery(this.table, "delete");
  }
  upsert(payload: any) {
    return new LocalQuery(this.table, "upsert", payload);
  }
  eq(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: any) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: any[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: any) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(value: number) {
    this.maxRows = value;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  or(expression: string) {
    const conditions = expression.split(",").map((item) => {
      const [column = "", operator = "", ...rest] = item.split(".");
      const expected = rest.join(".").replace(/^%|%$/g, "").toLowerCase();
      return (row: Row) =>
        operator === "ilike" &&
        String(row[column] ?? "")
          .toLowerCase()
          .includes(expected);
    });
    this.filters.push((row) => conditions.some((condition) => condition(row)));
    return this;
  }
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const tables = readTables();
    const rows = tables[this.table] ?? (tables[this.table] = []);
    const matches = (row: Row) => this.filters.every((filter) => filter(row));
    let affected: Row[] = [];
    if (this.action === "insert") {
      affected = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((input) =>
        withDefaults(this.table, input, rows.length),
      );
      rows.push(...affected);
    } else if (this.action === "update") {
      affected = rows.filter(matches);
      affected.forEach((row) => Object.assign(row, this.payload));
    } else if (this.action === "delete") {
      affected = rows.filter(matches);
      tables[this.table] = rows.filter((row) => !matches(row));
    } else if (this.action === "upsert") {
      for (const input of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const existing = rows.find(
          (row) =>
            row.id === input.id || (row.user_id === input.user_id && row.role === input.role),
        );
        if (existing) {
          Object.assign(existing, input);
          affected.push(existing);
        } else {
          const added = withDefaults(this.table, input, rows.length);
          rows.push(added);
          affected.push(added);
        }
      }
    } else affected = rows.filter(matches);
    if (this.action !== "select") {
      recomputeInvoices(tables);
      writeTables(tables);
    }
    for (const { column, ascending } of [...this.orders].reverse())
      affected.sort(
        (a, b) =>
          String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * (ascending ? 1 : -1),
      );
    if (this.maxRows != null) affected = affected.slice(0, this.maxRows);
    const selected = attachRelations(tables, this.table, affected, this.selection);
    const data =
      this.action === "select" || this.returning
        ? this.one
          ? (selected[0] ?? null)
          : selected
        : null;
    return {
      data,
      error: null,
      count: this.countMode ? selected.length : null,
      status: 200,
      statusText: "OK",
    };
  }
}

const hasSession = () =>
  typeof window !== "undefined" && window.localStorage.getItem(SESSION_KEY) === "active";
const demoUser = () => ({
  id: LOCAL_DEMO_USER_ID,
  email: LOCAL_DEMO_EMAIL,
  user_metadata: { full_name: "S. Narayanan" },
  app_metadata: {},
  aud: "authenticated",
  created_at: timestamp(-300),
});

export function createLocalDemoClient() {
  return {
    from: (table: string) => new LocalQuery(table),
    rpc: async (name: string) => ({ data: name === "is_founder", error: null }),
    auth: {
      getUser: async () => ({ data: { user: hasSession() ? demoUser() : null }, error: null }),
      getSession: async () => ({
        data: {
          session: hasSession() ? { user: demoUser(), access_token: "local-demo-token" } : null,
        },
        error: null,
      }),
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        if (email.toLowerCase() !== LOCAL_DEMO_EMAIL || password !== LOCAL_DEMO_PASSWORD)
          return {
            data: { user: null, session: null },
            error: new Error(`Use ${LOCAL_DEMO_EMAIL} / ${LOCAL_DEMO_PASSWORD}`),
          };
        window.localStorage.setItem(SESSION_KEY, "active");
        return {
          data: {
            user: demoUser(),
            session: { user: demoUser(), access_token: "local-demo-token" },
          },
          error: null,
        };
      },
      signUp: async () => {
        window.localStorage.setItem(SESSION_KEY, "active");
        return {
          data: {
            user: demoUser(),
            session: { user: demoUser(), access_token: "local-demo-token" },
          },
          error: null,
        };
      },
      signOut: async () => {
        if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_KEY);
        return { error: null };
      },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: { user: demoUser() }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}
