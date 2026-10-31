// Indian formats, dates and money helpers
export const IST = "Asia/Kolkata";

export function fmtINR(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  return "₹" + (isNaN(v) ? 0 : v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return `${fmtDate(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function fyLabel(d?: string | Date | null | undefined): string {
  const date = d ? new Date(d) : new Date();
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `FY ${y}–${String((y + 1) % 100).padStart(2, "0")}`;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const diff = new Date(d).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(diff / 86400000);
}

export function toISODateInput(d: string | null | undefined): string {
  if (!d) return "";
  return d.slice(0, 10);
}
