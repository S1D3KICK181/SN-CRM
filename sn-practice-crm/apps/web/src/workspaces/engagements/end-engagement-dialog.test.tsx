// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EndEngagementInput, EngagementDto, EngagementVersionDto } from "@sn/contracts";
import type { EngagementMutationResult } from "../../api/engagements-types";
import { EndEngagementDialog } from "./end-engagement-dialog";

afterEach(cleanup);

const engagement: EngagementDto = {
  id: "11111111-1111-4111-8111-111111111111", code: "ENG-01-A3e", clientId: "22222222-2222-4222-8222-222222222222", clientName: "Acme Client", serviceId: "33333333-3333-4333-8333-333333333333", serviceName: "Tax advisory", status: "active", approvedVersionId: "55555555-5555-4555-8555-555555555555", approvedVersion: null, approvedAt: "2026-02-02T00:00:00Z", approvedById: "44444444-4444-4444-8444-444444444444", endedAt: null, endedById: null, endOutcome: null, endReason: null, createdById: "44444444-4444-4444-8444-444444444444", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
};
const version: EngagementVersionDto = {
  id: "55555555-5555-4555-8555-555555555555", engagementId: engagement.id, versionNumber: 2, title: "Annual compliance", scope: "Full compliance scope", exclusions: null, responsiblePartnerId: "66666666-6666-4666-8666-666666666666", responsiblePartnerName: "Priya Partner", deliveryManagerId: "77777777-7777-4777-8777-777777777777", deliveryManagerName: "Dev Manager", feeModel: "fixed", agreedFeePaise: 125000, billingTerms: "Monthly", startDate: "2026-04-01", endDate: "2027-03-31", approvedAt: "2026-02-02T00:00:00Z", approvedById: engagement.createdById, createdById: engagement.createdById, createdAt: "2026-02-01T00:00:00Z",
};
const ok: EngagementMutationResult = { success: true };
const props = (
  role: "founder" | "manager" = "founder",
  onEnd: (input: EndEngagementInput) => Promise<EngagementMutationResult> = vi.fn().mockResolvedValue(ok),
) => ({ open: true, role, engagement, version, opener: null, onClose: vi.fn(), onEnd });
const endButton = () => screen.getByRole("button", { name: /^(End engagement|Ending…)$/ }) as HTMLButtonElement;
const fill = (outcome = "Completed", reason = "Delivered as agreed") => {
  fireEvent.click(screen.getByLabelText(new RegExp(outcome)));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });
};

describe("EndEngagementDialog", () => {
  it("renders nothing for a manager or when closed", () => {
    expect(render(<EndEngagementDialog {...props("manager")} />).queryByRole("dialog")).toBeNull();
    cleanup();
    expect(render(<EndEngagementDialog {...props()} open={false} />).queryByRole("dialog")).toBeNull();
  });
  it("shows code, client, service and current terms without UUIDs", () => {
    render(<EndEngagementDialog {...props()} />);
    const body = document.body.textContent ?? "";
    for (const value of ["ENG-01-A3e", "Acme Client", "Tax advisory", "v2 · Annual compliance", "01/04/2026", "Ending is permanent.", "Any recurring schedules linked to this engagement stop creating new assignments."]) expect(body).toContain(value);
    for (const id of [engagement.id, version.id, engagement.clientId, engagement.serviceId]) expect(body).not.toContain(id);
    expect(screen.getByRole("dialog", { name: "End engagement" })).toBeTruthy();
  });
  it("shows a placeholder when there are no current terms", () => {
    render(<EndEngagementDialog {...props()} version={null} />);
    expect(screen.getByText("Current terms").nextElementSibling?.textContent).toBe("Not provided");
  });
  it("focuses the first Outcome radio and preselects nothing", async () => {
    render(<EndEngagementDialog {...props()} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Completed/)));
    expect((screen.getByLabelText(/Completed/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/Terminated/) as HTMLInputElement).checked).toBe(false);
  });
  it("rejects an empty submit with both messages and focuses the first radio", async () => {
    const onEnd = vi.fn();
    render(<EndEngagementDialog {...props("founder", onEnd)} />);
    fireEvent.click(endButton());
    expect(await screen.findByText("Select an outcome.")).toBeTruthy();
    expect(screen.getByText("Enter a reason of at least 2 characters.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/Completed/));
    expect(screen.getByLabelText(/Completed/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Reason").getAttribute("aria-describedby")).toContain("end-engagement-reason-error");
    expect(onEnd).not.toHaveBeenCalled();
  });
  it("rejects a whitespace-only reason and focuses the textarea", () => {
    const onEnd = vi.fn();
    render(<EndEngagementDialog {...props("founder", onEnd)} />);
    fill("Terminated", "   ");
    fireEvent.click(endButton());
    expect(screen.getByText("Enter a reason of at least 2 characters.")).toBeTruthy();
    expect(screen.queryByText("Select an outcome.")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Reason"));
    expect(onEnd).not.toHaveBeenCalled();
  });
  it("clears a field message when that field changes", () => {
    render(<EndEngagementDialog {...props()} />);
    fireEvent.click(endButton());
    fireEvent.click(screen.getByLabelText(/Terminated/));
    expect(screen.queryByText("Select an outcome.")).toBeNull();
    expect(screen.getByText("Enter a reason of at least 2 characters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "ok" } });
    expect(screen.queryByText("Enter a reason of at least 2 characters.")).toBeNull();
  });
  it("submits the exact input once with a trimmed reason, then closes", async () => {
    const onEnd = vi.fn().mockResolvedValue(ok);
    const onClose = vi.fn();
    render(<EndEngagementDialog {...props("founder", onEnd)} onClose={onClose} />);
    fill("Completed", "  Delivered as agreed  ");
    fireEvent.click(endButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith({ engagementId: engagement.id, outcome: "completed", reason: "Delivered as agreed", expectedUpdatedAt: engagement.updatedAt });
  });
  it("locks every control and dismissal while pending and sends one request", async () => {
    let resolve!: (value: EngagementMutationResult) => void;
    const onEnd = vi.fn(() => new Promise<EngagementMutationResult>((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(<EndEngagementDialog {...props("founder", onEnd)} onClose={onClose} />);
    fill();
    fireEvent.click(endButton());
    await waitFor(() => expect(endButton().textContent).toContain("Ending…"));
    for (const control of [screen.getByRole("button", { name: "Close" }), screen.getByRole("button", { name: "Cancel" }), endButton(), screen.getByLabelText(/Completed/), screen.getByLabelText(/Terminated/), screen.getByLabelText("Reason")]) expect((control as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    expect(onEnd).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.querySelector(".end-engagement-dialog-layer")!);
    expect(onClose).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    resolve(ok);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    outside.remove();
  });
  it.each(["failure", "reject"] as const)("shows the safe message on %s and keeps the entered values", async (kind) => {
    const onEnd = kind === "reject" ? vi.fn().mockRejectedValue(new Error("secret")) : vi.fn().mockResolvedValue({ success: false });
    const onClose = vi.fn();
    render(<EndEngagementDialog {...props("founder", onEnd)} onClose={onClose} />);
    fill("Terminated", "Client withdrew");
    fireEvent.click(endButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Unable to end this engagement. Please refresh and try again."));
    expect(screen.queryByText("secret")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Terminated/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("Client withdrew");
    expect(endButton().disabled).toBe(false);
  });
  it("closes through Cancel, X and Escape when idle", () => {
    const onClose = vi.fn();
    render(<EndEngagementDialog {...props()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
  it("traps Tab across radios, textarea and buttons", async () => {
    render(<EndEngagementDialog {...props()} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Completed/)));
    endButton().focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(endButton());
  });
  it("returns focus to the opener on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const view = render(<EndEngagementDialog {...props()} opener={opener} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Completed/)));
    view.rerender(<EndEngagementDialog {...props()} open={false} opener={opener} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
