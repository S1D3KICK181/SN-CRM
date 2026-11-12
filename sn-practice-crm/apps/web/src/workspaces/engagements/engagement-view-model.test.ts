import { describe, expect, it } from "vitest";
import type { EngagementDto, EngagementVersionDto } from "@sn/contracts";
import {
  computeEngagementStats,
  currentTerms,
  filterEngagements,
  formatDate,
  formatIndiaTimestamp,
  formatInrFromPaise,
  formatPeriod,
  humanFeeModel,
  latestVersion,
  missing,
} from "./engagement-view-model";

const version = (
  number: number,
  overrides: Partial<EngagementVersionDto> = {},
): EngagementVersionDto => ({
  id: `v${number}`,
  engagementId: "e1",
  versionNumber: number,
  title: `Version ${number}`,
  scope: "Scope",
  exclusions: null,
  responsiblePartnerId: "p",
  deliveryManagerId: "m",
  feeModel: "fixed",
  agreedFeePaise: 0,
  billingTerms: "Monthly",
  startDate: "2026-04-01",
  endDate: null,
  approvedAt: null,
  approvedById: null,
  createdById: "u",
  createdAt: "2026-04-01T00:00:00Z",
  ...overrides,
});
const item = (overrides: Partial<EngagementDto> = {}): EngagementDto => ({
  id: "e1",
  code: "ENG-1",
  clientId: "c",
  clientName: "Aster Foods",
  serviceId: "s",
  serviceName: "Audit",
  status: "active",
  approvedVersionId: null,
  approvedVersion: null,
  approvedAt: null,
  approvedById: null,
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: "u",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-02T00:00:00Z",
  ...overrides,
});

describe("engagement view model", () => {
  it("computes stats, searches case-insensitively, and filters status", () => {
    const items = [
      item(),
      item({ id: "e2", code: "ENG-2", clientName: "Beta", status: "draft" }),
      item({ id: "e3", status: "ended" }),
    ];
    expect(computeEngagementStats(items)).toEqual({ accessible: 3, active: 1, draft: 1, ended: 1 });
    expect(filterEngagements(items, "BETA", "draft")).toHaveLength(1);
    expect(filterEngagements(items, "audit", "all")).toHaveLength(3);
  });

  it("computes empty stats and every status count", () => {
    expect(computeEngagementStats([])).toEqual({ accessible: 0, active: 0, draft: 0, ended: 0 });
  });

  it("searches code, client, and service independently with whitespace and all", () => {
    const items = [
      item({ code: "ENG-ALPHA" }),
      item({ id: "e2", clientName: "Northwind" }),
      item({ id: "e3", serviceName: "Indirect Tax" }),
    ];
    expect(filterEngagements(items, " alpha ", "all")).toHaveLength(1);
    expect(filterEngagements(items, "NORTH", "all")).toHaveLength(1);
    expect(filterEngagements(items, "tax", "all")).toHaveLength(1);
    expect(filterEngagements(items, "   ", "all")).toHaveLength(3);
  });

  it("filters status and combines search with status", () => {
    const items = [item(), item({ id: "e2", code: "DRAFT-TAX", status: "draft" })];
    expect(filterEngagements(items, "", "draft")).toEqual([items[1]]);
    expect(filterEngagements(items, "tax", "draft")).toEqual([items[1]]);
  });
  it("selects latest without mutating, formats INR/dates/periods, and labels fees", () => {
    const versions = [version(1), version(3), version(2)];
    expect(latestVersion(versions)?.versionNumber).toBe(3);
    expect(versions.map((entry) => entry.versionNumber)).toEqual([1, 3, 2]);
    expect(currentTerms([], version(2))?.versionNumber).toBe(2);
    expect(formatInrFromPaise(0)).toBe("₹0");
    expect(formatInrFromPaise(undefined)).toBe("Not provided");
    expect(formatDate("2026-04-01")).toBe("01/04/2026");
    expect(formatDate("invalid")).toBe("Not provided");
    expect(formatIndiaTimestamp("2026-04-01T10:30:00Z")).toContain("Apr 2026");
    expect(formatPeriod("2026-04-01", null)).toContain("Ongoing");
    expect(humanFeeModel("time_based")).toBe("Time-based");
    expect(humanFeeModel(null)).toBe("Fee model unavailable");
  });

  it("formats positive and invalid INR values", () => {
    expect(formatInrFromPaise(123456)).toBe("₹1,234.56");
    expect(formatInrFromPaise(Number.NaN)).toBe("Not provided");
  });

  it("formats missing and closed periods", () => {
    expect(formatDate(null)).toBe("Not provided");
    expect(formatPeriod("2026-04-01", "2026-04-30")).toContain("30/04/2026");
  });

  it("formats every fee label and invalid timestamps", () => {
    expect(formatIndiaTimestamp("invalid")).toBe("Not provided");
    expect(humanFeeModel("fixed")).toBe("Fixed fee");
    expect(humanFeeModel("recurring")).toBe("Recurring fee");
    expect(humanFeeModel("milestone")).toBe("Milestone-based");
  });

  it("renders missing text", () => {
    expect(missing("")).toBe("Not provided");
    expect(missing("  ")).toBe("Not provided");
    expect(missing("Present")).toBe("Present");
  });
});
