import type {
  EngagementDto,
  EngagementVersionDto,
  EngagementStatus,
  EngagementFeeModel,
  EngagementEndOutcome,
} from "@sn/contracts";

export interface EngagementStats {
  accessible: number;
  active: number;
  draft: number;
  ended: number;
}
export type EngagementListStatus = "all" | EngagementStatus;

export function computeEngagementStats(items: readonly EngagementDto[]): EngagementStats {
  return {
    accessible: items.length,
    active: items.filter((item) => item.status === "active").length,
    draft: items.filter((item) => item.status === "draft").length,
    ended: items.filter((item) => item.status === "ended").length,
  };
}

export function matchesEngagementSearch(item: EngagementDto, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [item.code, item.clientName, item.serviceName].some((value) =>
    value?.toLocaleLowerCase().includes(needle),
  );
}

export function filterEngagements(
  items: readonly EngagementDto[],
  query: string,
  status: EngagementListStatus,
): EngagementDto[] {
  return items.filter(
    (item) => matchesEngagementSearch(item, query) && (status === "all" || item.status === status),
  );
}

export function latestVersion(
  versions: readonly EngagementVersionDto[],
): EngagementVersionDto | null {
  return versions.reduce<EngagementVersionDto | null>((latest, version) => {
    return latest === null || version.versionNumber > latest.versionNumber ? version : latest;
  }, null);
}

export function currentTerms(
  versions: readonly EngagementVersionDto[],
  approvedVersion: EngagementVersionDto | null | undefined,
): EngagementVersionDto | null {
  return latestVersion(versions) ?? approvedVersion ?? null;
}

export function formatInrFromPaise(paise: number | null | undefined): string {
  if (typeof paise !== "number" || !Number.isFinite(paise) || paise < 0) return "Not provided";
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not provided";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return "Not provided";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatPeriod(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  const start = formatDate(startDate);
  if (start === "Not provided") return "Not provided";
  return `${start} – ${endDate ? formatDate(endDate) : "Ongoing"}`;
}

export function formatIndiaTimestamp(value: string | null | undefined): string {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not provided"
    : new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function humanFeeModel(model: EngagementFeeModel | null | undefined): string {
  const labels: Record<EngagementFeeModel, string> = {
    fixed: "Fixed fee",
    recurring: "Recurring fee",
    milestone: "Milestone-based",
    time_based: "Time-based",
  };
  return model ? (labels[model] ?? "Fee model unavailable") : "Fee model unavailable";
}

export function humanEndOutcome(outcome: EngagementEndOutcome | null | undefined): string {
  const labels: Record<EngagementEndOutcome, string> = {
    completed: "Completed",
    terminated: "Terminated",
  };
  return outcome ? (labels[outcome] ?? "Outcome unavailable") : "Outcome unavailable";
}

export function missing(value: string | null | undefined): string {
  return value?.trim() ? value : "Not provided";
}
