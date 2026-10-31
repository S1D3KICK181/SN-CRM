import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Users, BriefcaseBusiness, ClipboardList, CheckSquare,
  Building2, FolderOpen, MessageSquareText, ReceiptText, HandCoins,
  Landmark, ShieldCheck, TrendingUp, FileBarChart, Settings,
} from "lucide-react";

export type AppRole =
  | "founder" | "manager" | "senior_staff" | "staff" | "trainee" | "accounts";

export const ROLE_LABELS: Record<AppRole, string> = {
  founder: "Founder / Super Admin",
  manager: "Department Head / Manager",
  senior_staff: "Senior Staff",
  staff: "Staff",
  trainee: "Trainee",
  accounts: "Accounts & Collection Staff",
};

// Which roles may see which sidebar sections (server-side RLS is the real gate)
export const NAV_SECTIONS: {
  label: string; to: string; icon: LucideIcon; roles: AppRole[] | "all";
}[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, roles: "all" },
  { label: "Clients", to: "/clients", icon: Users, roles: "all" },
  { label: "Services & Engagements", to: "/services", icon: BriefcaseBusiness, roles: "all" },
  { label: "Work Assignments", to: "/assignments", icon: ClipboardList, roles: "all" },
  { label: "My Tasks", to: "/my-tasks", icon: CheckSquare, roles: "all" },
  { label: "Team & Departments", to: "/team", icon: Building2, roles: ["founder", "manager", "accounts"] },
  { label: "Documents", to: "/documents", icon: FolderOpen, roles: "all" },
  { label: "Communication & Reminders", to: "/communication", icon: MessageSquareText, roles: "all" },
  { label: "Billing & Invoices", to: "/billing", icon: ReceiptText, roles: ["founder", "manager", "accounts"] },
  { label: "Receipts & Collections", to: "/receipts", icon: HandCoins, roles: ["founder", "manager", "accounts"] },
  { label: "Client Tax Money", to: "/tax-money", icon: Landmark, roles: ["founder", "manager", "accounts"] },
  { label: "Internal Audit", to: "/internal-audit", icon: ShieldCheck, roles: ["founder", "manager"] },
  { label: "L2 / Virtual CFO", to: "/advisory", icon: TrendingUp, roles: "all" },
  { label: "Reports", to: "/reports", icon: FileBarChart, roles: "all" },
  { label: "Settings", to: "/settings", icon: Settings, roles: "all" },
];

export const CLIENT_STATUSES = ["Active", "Inactive", "Prospect", "On Hold", "Closed"];
export const ASSIGNMENT_STATUSES = [
  "New", "Awaiting Assignment", "Assigned", "Awaiting Client Documents", "In Progress",
  "Pending Internal Review", "Correction Required", "Awaiting Client Approval",
  "Ready for Filing / Submission", "Filed / Submitted", "Completed", "On Hold", "Cancelled",
];
export const TASK_STATUSES = ["Open", "In Progress", "Pending Review", "Completed", "On Hold", "Cancelled"];
export const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const DOC_STATUSES = [
  "Not Requested", "Requested", "Partially Received", "Received", "Under Review",
  "Accepted", "Correction Required", "Not Applicable",
];
export const INVOICE_STATUSES = ["Draft", "Unpaid", "Partially Paid", "Paid", "Overdue", "Cancelled"];
export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "UPI", "Cheque", "Other"];
export const CLIENT_TYPES = ["Individual", "Proprietorship", "Partnership", "LLP", "Private Limited", "Trust", "Other"];
export const COMM_STATUSES = ["Draft", "Ready", "Opened for Sending", "Sent", "Delivered", "Failed", "Cancelled"];
export const MESSAGE_TYPES = [
  "Document request", "Missing document reminder", "Deadline reminder", "Approval request",
  "Tax payment reminder", "Invoice reminder", "Overdue fee reminder", "Completion update", "Follow-up",
];
export const RISK_CATEGORIES = ["Low", "Medium", "High", "Critical"];
export const FINDING_STATUSES = ["Open", "In Progress", "Resolved", "Verified", "Closed"];

// Badge tone per status keyword
export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "muted" {
  const s = status.toLowerCase();
  if (["completed", "paid", "accepted", "received", "filed / submitted", "resolved", "verified", "closed", "reconciled", "delivered"].some((k) => s.includes(k))) return "success";
  if (["awaiting", "pending", "requested", "open", "in progress", "draft", "partially", "on hold", "under review", "new"].some((k) => s.startsWith(k))) return "warning";
  if (["overdue", "correction required", "failed", "cancelled", "critical"].some((k) => s.includes(k))) return "danger";
  if (["unpaid", "active"].some((k) => s.startsWith(k))) return "info";
  return "muted";
}
