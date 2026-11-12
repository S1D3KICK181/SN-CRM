// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngagementDto, EngagementVersionDto } from "@sn/contracts";
import { ActivateEngagementDialog } from "./activate-engagement-dialog";

afterEach(cleanup);

const engagement: EngagementDto = {
  id: "11111111-1111-4111-8111-111111111111", code: "ENG-01-A3c", clientId: "22222222-2222-4222-8222-222222222222", clientName: "Acme Client", serviceId: "33333333-3333-4333-8333-333333333333", serviceName: "Tax advisory", status: "draft", approvedVersionId: null, approvedVersion: null, approvedAt: null, approvedById: null, endedAt: null, endedById: null, endOutcome: null, endReason: null, createdById: "44444444-4444-4444-8444-444444444444", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
};
const version: EngagementVersionDto = {
  id: "55555555-5555-4555-8555-555555555555", engagementId: engagement.id, versionNumber: 3, title: "Annual compliance", scope: "Full compliance scope", exclusions: null, responsiblePartnerId: "66666666-6666-4666-8666-666666666666", responsiblePartnerName: "Priya Partner", deliveryManagerId: "77777777-7777-4777-8777-777777777777", deliveryManagerName: "Dev Manager", feeModel: "fixed", agreedFeePaise: 125000, billingTerms: "Monthly", startDate: "2026-04-01", endDate: "2027-03-31", approvedAt: null, approvedById: null, createdById: engagement.createdById, createdAt: "2026-02-01T00:00:00Z",
};
const props = (role: "founder" | "manager" | "senior_staff" | "staff" | "trainee" = "founder", onActivate = vi.fn().mockResolvedValue({ success: true as const })) => ({ open: true, role, engagement, version, opener: null, onClose: vi.fn(), onActivate });

describe("ActivateEngagementDialog", () => {
  it("renders for Founder and denies Manager, senior, staff, and trainee", () => {
    expect(render(<ActivateEngagementDialog {...props()} />).queryByRole("dialog")).toBeTruthy();
    for (const role of ["manager", "senior_staff", "staff", "trainee"] as const) {
      cleanup();
      expect(render(<ActivateEngagementDialog {...props(role)} />).queryByRole("dialog")).toBeNull();
    }
  });
  it("shows the human summary without fixture UUIDs and focuses Cancel", async () => {
    render(<ActivateEngagementDialog {...props()} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    const body = document.body.textContent ?? "";
    for (const value of ["ENG-01-A3c", "Acme Client", "Tax advisory", "v3", "Annual compliance", "Full compliance scope", "01/04/2026", "₹1,250", "Priya Partner", "Dev Manager"]) expect(body).toContain(value);
    for (const id of [engagement.id, version.id, version.responsiblePartnerId, version.deliveryManagerId]) expect(body).not.toContain(id);
  });
  it("submits exactly ActivateEngagementInput and has no forbidden fields", async () => {
    const onActivate = vi.fn().mockResolvedValue({ success: true as const });
    render(<ActivateEngagementDialog {...props("founder", onActivate)} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve & activate" }));
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith({ engagementId: engagement.id, versionId: version.id, expectedUpdatedAt: engagement.updatedAt }));
    expect(Object.keys(onActivate.mock.calls[0]![0])).toEqual(["engagementId", "versionId", "expectedUpdatedAt"]);
  });
  it.each(["Close", "Cancel"] as const)("closes through %s", (name) => {
    const onClose = vi.fn(); render(<ActivateEngagementDialog {...props()} onClose={onClose} />); fireEvent.click(screen.getByRole("button", { name })); expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("closes through Escape", async () => {
    const onClose = vi.fn();
    render(<ActivateEngagementDialog {...props()} onClose={onClose} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("closes through backdrop", () => {
    const onClose = vi.fn();
    render(<ActivateEngagementDialog {...props()} onClose={onClose} />);
    fireEvent.mouseDown(document.querySelector(".activation-dialog-layer")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("keeps focus and uses the latest Escape callback after a parent rerender", async () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const view = render(<ActivateEngagementDialog {...props()} onClose={onCloseA} />);
    const approve = screen.getByRole("button", { name: "Approve & activate" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    approve.focus();
    view.rerender(<ActivateEngagementDialog {...props()} onClose={onCloseB} />);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(document.activeElement).toBe(approve);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
  });
  it("wraps idle Tab from Approve to Close", async () => {
    render(<ActivateEngagementDialog {...props()} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const close = screen.getByRole("button", { name: "Close" });
    const primary = screen.getByRole("button", { name: "Approve & activate" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    primary.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });
  it("wraps idle Shift+Tab from Close to Approve", async () => {
    render(<ActivateEngagementDialog {...props()} />);
    const primary = screen.getByRole("button", { name: "Approve & activate" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(primary);
  });
  it("restores opener on close transition", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const view = render(<ActivateEngagementDialog {...props()} opener={opener} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    view.rerender(<ActivateEngagementDialog {...props()} open={false} opener={opener} />);
    expect(document.activeElement).toBe(opener);
  });
  it("restores opener on actual unmount", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const view = render(<ActivateEngagementDialog {...props()} opener={opener} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });
  it("locks every dismissal and submits once while pending", async () => {
    let resolve!: (value: { success: true }) => void;
    const onActivate = vi.fn(() => new Promise<{ success: true }>((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(<ActivateEngagementDialog {...props("founder", onActivate)} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve & activate" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Approving/ })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Approving/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(onActivate).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.querySelector(".activation-dialog-layer")!);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    outside.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    resolve({ success: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    outside.remove();
  });
  it.each([false, "reject"] as const)("keeps safe failure open and re-enables controls (%s)", async (failure) => { const onActivate = failure === "reject" ? vi.fn().mockRejectedValue(new Error("secret")) : vi.fn().mockResolvedValue({ success: false as const }); render(<ActivateEngagementDialog {...props("founder", onActivate)} />); fireEvent.click(screen.getByRole("button", { name: "Approve & activate" })); await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unable to approve")); expect(screen.queryByText("secret")).toBeNull(); expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false); });
  it("closes once after success", async () => { const onClose = vi.fn(); render(<ActivateEngagementDialog {...props()} onClose={onClose} />); fireEvent.click(screen.getByRole("button", { name: "Approve & activate" })); await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1)); });
});
