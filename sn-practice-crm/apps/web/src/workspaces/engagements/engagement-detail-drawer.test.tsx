// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { EngagementDto, EngagementVersionDto } from "@sn/contracts";
import { EngagementOperationError } from "../../api/engagements-types";
import { EngagementDetailDrawer, type EngagementDetailDrawerProps } from "./engagement-detail-drawer";

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
type AmendmentOmitOptions = {
  status?: EngagementDto["status"];
  approvedVersion?: EngagementDto["approvedVersion"];
  versions?: EngagementDetailDrawerProps["versions"];
  canAmend?: EngagementDetailDrawerProps["canAmend"];
  onAmend?: EngagementDetailDrawerProps["onAmend"];
  loading?: EngagementDetailDrawerProps["loading"];
  error?: EngagementDetailDrawerProps["error"];
};

describe("EngagementDetailDrawer", () => {
  it("shows the revise activator only for a draft and passes its exact element", () => {
    const onRevise = vi.fn();
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise onRevise={onRevise} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Revise draft" });
    fireEvent.click(button);
    expect(onRevise).toHaveBeenCalledWith(button);
  });
  it("hides revise for an active engagement", () => {
    render(<EngagementDetailDrawer engagement={engagement} versions={[version(1)]} canRevise onRevise={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it("shows the amendment activator for the current active terms and passes its exact element", () => {
    const onAmend = vi.fn();
    render(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[version(1, engagement.approvedAt)]}
        canAmend
        onAmend={onAmend}
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Amend terms" });
    fireEvent.click(button);
    expect(onAmend).toHaveBeenCalledWith(button);
  });
  const amendmentOmitCases: ReadonlyArray<readonly [string, AmendmentOmitOptions]> = [
    ["draft", { status: "draft" as const }],
    ["ended", { status: "ended" as const }],
    ["loading", { loading: true }],
    ["retained error", { error: { name: "network", message: "safe", code: "network" } }],
    ["no current version", { approvedVersion: null, versions: [] }],
    ["cannot amend", { canAmend: false }],
    ["missing amendment handler", { onAmend: undefined }],
  ];
  it.each(amendmentOmitCases)("omits amendment for %s", (_name, options) => {
    render(
      <EngagementDetailDrawer
        engagement={{ ...engagement, ...options }}
        versions={options.versions ?? [version(1, engagement.approvedAt)]}
        canAmend={options.canAmend ?? true}
        onAmend={options.onAmend === undefined && _name === "missing amendment handler" ? undefined : vi.fn()}
        loading={options.loading}
        error={options.error}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Amend terms" })).toBeNull();
  });
  it("disables an obscured amendment and does not call back", () => {
    const onAmend = vi.fn();
    render(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[version(1, engagement.approvedAt)]}
        canAmend
        onAmend={onAmend}
        obscured
        onClose={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Amend terms", hidden: true }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onAmend).not.toHaveBeenCalled();
  });
  it("keeps amendment independent from draft revision and activation gates", () => {
    const onRevise = vi.fn();
    const onActivate = vi.fn();
    const onAmend = vi.fn();
    const { rerender } = render(
      <EngagementDetailDrawer
        engagement={{ ...engagement, status: "draft", approvedVersion: version(1) }}
        versions={[version(1)]}
        canRevise
        onRevise={onRevise}
        canActivate
        onActivate={onActivate}
        canAmend
        onAmend={onAmend}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Revise draft" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve & activate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Amend terms" })).toBeNull();
    rerender(
      <EngagementDetailDrawer
        engagement={engagement}
        versions={[version(1, engagement.approvedAt)]}
        canRevise
        onRevise={onRevise}
        canActivate
        onActivate={onActivate}
        canAmend
        onAmend={onAmend}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Amend terms" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve & activate" })).toBeNull();
  });
  it("hides revise for an ended engagement", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "ended" }} versions={[version(1)]} canRevise onRevise={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it("hides revise when retained data has an error", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise onRevise={vi.fn()} error={new EngagementOperationError({ message: "safe", code: "network" })} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it("hides revise while loading", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise onRevise={vi.fn()} loading onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it("hides revise when a draft has no current version", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft", approvedVersion: null }} versions={[]} canRevise onRevise={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it("hides revise when the actor cannot revise", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} onRevise={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it("hides revise when no revise handler is supplied", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
  });
  it.each([
    ["active", { status: "active" as const, versions: [version(1)], canActivate: true, loading: false, error: null }],
    ["ended", { status: "ended" as const, versions: [version(1)], canActivate: true, loading: false, error: null }],
    ["retained error", { status: "draft" as const, versions: [version(1)], canActivate: true, loading: false, error: { name: "network", message: "safe", code: "network" } }],
    ["loading", { status: "draft" as const, versions: [version(1)], canActivate: true, loading: true, error: null }],
    ["no current version", { status: "draft" as const, approvedVersion: null, versions: [], canActivate: true, loading: false, error: null }],
    ["cannot activate", { status: "draft" as const, versions: [version(1)], canActivate: false, loading: false, error: null }],
    ["missing activation handler", { status: "draft" as const, versions: [version(1)], canActivate: true, loading: false, error: null }],
  ] as const)("omits activation for %s drawer state", (_name, options) => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, ...options }} versions={options.versions ?? [version(1)]} canActivate={options.canActivate ?? true} onClose={vi.fn()} onActivate={_name === "missing activation handler" ? undefined : vi.fn()} loading={options.loading} error={options.error} />);
    expect(screen.queryByRole("button", { name: "Approve & activate" })).toBeNull();
  });
  it("passes the exact clicked activation opener", () => {
    const onActivate = vi.fn();
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canActivate onActivate={onActivate} onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Approve & activate" });
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith(button);
  });
  it("disables both valid action buttons while obscured", () => {
    const onActivate = vi.fn();
    const onRevise = vi.fn();
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise onRevise={onRevise} canActivate onActivate={onActivate} obscured onClose={vi.fn()} />);
    const revise = screen.getByRole("button", { name: "Revise draft", hidden: true }) as HTMLButtonElement;
    const button = screen.getByRole("button", { name: "Approve & activate", hidden: true }) as HTMLButtonElement;
    expect(revise.disabled).toBe(true);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
  });
  it("keeps revise visible when activation is gated but has no handler", () => {
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise onRevise={vi.fn()} canActivate onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Revise draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve & activate" })).toBeNull();
  });
  it("makes an obscured drawer inert and ignores its dismissal controls", () => {
    const close = vi.fn();
    render(<EngagementDetailDrawer engagement={{ ...engagement, status: "draft" }} versions={[version(1)]} canRevise obscured onRevise={vi.fn()} onClose={close} />);
    const drawer = document.querySelector("aside")!;
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("engagement-drawer-backdrop").getAttribute("inert")).toBe("");
    expect((within(drawer).getByRole("button", { name: "Close engagement details", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(drawer).getByRole("button", { name: "Close", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(drawer).getByRole("button", { name: "Revise draft", hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("engagement-drawer-backdrop"));
    expect(close).not.toHaveBeenCalled();
  });
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
        error={new EngagementOperationError({ message: "safe", code: "network" })}
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
