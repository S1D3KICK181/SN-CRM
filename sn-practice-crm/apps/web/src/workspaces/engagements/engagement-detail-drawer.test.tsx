// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { EngagementDto, EngagementVersionDto } from "@sn/contracts";
import { EngagementDetailDrawer } from "./engagement-detail-drawer";

afterEach(cleanup);

const version = (n: number, approvedAt: string | null = null): EngagementVersionDto => ({
  id: `v${n}`,
  engagementId: "e",
  versionNumber: n,
  title: `Title ${n}`,
  scope: "Long scope",
  exclusions: null,
  responsiblePartnerId: "p",
  responsiblePartnerName: "Priya Partner",
  deliveryManagerId: "m",
  deliveryManagerName: "Dev Manager",
  feeModel: "recurring",
  agreedFeePaise: n * 100,
  billingTerms: "Monthly",
  startDate: "2026-01-01",
  endDate: null,
  approvedAt,
  approvedById: approvedAt ? "u" : null,
  createdById: "u",
  createdAt: "2026-01-01T00:00:00Z",
});
const engagement: EngagementDto = {
  id: "e",
  code: "ENG-1",
  clientId: "c",
  clientName: "Client",
  serviceId: "s",
  serviceName: "Tax",
  status: "active",
  approvedVersionId: "v1",
  approvedVersion: version(1, "2026-02-01T00:00:00Z"),
  approvedAt: "2026-02-01T00:00:00Z",
  approvedById: "u",
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: "u",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
};

describe("EngagementDetailDrawer", () => {
  it("shows latest terms while preserving approved evidence and ordered history", () => {
    render(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[version(1, engagement.approvedAt), version(2)]}
        activator={document.body}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText("v2")).toHaveLength(2);
    expect(screen.getAllByText("Title 2")).toHaveLength(2);
    expect(screen.getByText("Recurring fee")).toBeTruthy();
    expect(screen.getByText("Priya Partner")).toBeTruthy();
    expect(screen.getByText("Dev Manager")).toBeTruthy();
    expect(screen.getByText(/Approved:.*v1/)).toBeTruthy();
  });
  it("loads, reports fatal errors, and keeps retained data warning with retry", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <EngagementDetailDrawer
        engagement={null}
        versions={[]}
        loading
        onClose={vi.fn()}
        onRetry={retry}
      />,
    );
    expect(screen.getByLabelText("Loading engagement details")).toBeTruthy();
    rerender(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[]}
        error={{ message: "safe", code: "network" } as never}
        onClose={vi.fn()}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(/retained data/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });
  it("focuses close and restores the supplied activator on every close path", () => {
    const activator = document.createElement("button");
    document.body.append(activator);
    const close = vi.fn();
    const { unmount } = render(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[]}
        activator={activator}
        onClose={close}
      />,
    );
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: "Close engagement details" })[0],
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(activator);
  });

  it("wraps Tab from the footer Close button to the header close button", () => {
    render(<EngagementDetailDrawer engagement={engagement} versions={[]} onClose={vi.fn()} />);
    const headerClose = screen.getByRole("button", { name: "Close engagement details" });
    const footerClose = screen.getByRole("button", { name: "Close" });
    footerClose.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(headerClose);
  });

  it("wraps Shift+Tab from the header close button to the footer Close button", () => {
    render(<EngagementDetailDrawer engagement={engagement} versions={[]} onClose={vi.fn()} />);
    const headerClose = screen.getByRole("button", { name: "Close engagement details" });
    const footerClose = screen.getByRole("button", { name: "Close" });
    headerClose.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(footerClose);
  });

  it("orders version history newest first in the DOM", () => {
    render(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[version(1), version(2)]}
        onClose={vi.fn()}
      />,
    );
    const history = screen.getByText("Version history").parentElement!;
    const entries = within(history).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toContain("v2");
    expect(entries[1]!.textContent).toContain("v1");
  });

  it("shows empty history and approved fallback terms", () => {
    render(<EngagementDetailDrawer engagement={engagement} versions={[]} onClose={vi.fn()} />);
    expect(screen.getByText("No version history is available for this engagement.")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
  });

  it("closes from the backdrop", () => {
    const close = vi.fn();
    render(<EngagementDetailDrawer engagement={engagement} versions={[]} onClose={close} />);
    fireEvent.mouseDown(screen.getByTestId("engagement-drawer-backdrop"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes from the header button", () => {
    const close = vi.fn();
    render(<EngagementDetailDrawer engagement={engagement} versions={[]} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Close engagement details" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes from the footer button", () => {
    const close = vi.fn();
    render(<EngagementDetailDrawer engagement={engagement} versions={[]} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("renders active not-ended facts and wrapped long content", () => {
    render(
      <EngagementDetailDrawer engagement={engagement} versions={[version(1)]} onClose={vi.fn()} />,
    );
    expect(screen.getByText("End outcome: Not ended")).toBeTruthy();
    expect(screen.getByText("Long scope").closest(".drawer-content")?.className).toContain(
      "drawer-text-contain",
    );
  });

  it("renders ended facts when the engagement has ended", () => {
    render(
      <EngagementDetailDrawer
        engagement={{
          ...engagement,
          endedAt: "2026-03-01T10:00:00Z",
          endOutcome: "completed",
          endReason: "Delivered",
        }}
        versions={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Ended:/)).toBeTruthy();
    expect(screen.getByText(/Ended:.*Completed/)).toBeTruthy();
    expect(screen.queryByText("End outcome: Not ended")).toBeNull();
  });
});
