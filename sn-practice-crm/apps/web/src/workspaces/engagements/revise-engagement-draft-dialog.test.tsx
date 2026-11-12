// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngagementDto, EngagementVersionDto, ReviseEngagementDraftInput } from "@sn/contracts";
import { ReviseEngagementDraftDialog } from "./revise-engagement-draft-dialog";
import type { EngagementMutationResult } from "../../api/engagements-types";

afterEach(cleanup);

const id = "11111111-1111-4111-8111-111111111111";
const managerId = "22222222-2222-4222-8222-222222222222";
const version: EngagementVersionDto = {
  id,
  engagementId: id,
  versionNumber: 1,
  title: "Initial title",
  scope: "Initial scope",
  exclusions: null,
  responsiblePartnerId: id,
  responsiblePartnerName: "Founder",
  deliveryManagerId: managerId,
  deliveryManagerName: "Manager",
  feeModel: "fixed",
  agreedFeePaise: 1250050,
  billingTerms: "Monthly",
  startDate: "2026-01-01",
  endDate: null,
  approvedAt: null,
  approvedById: null,
  createdById: id,
  createdAt: "2026-01-01T00:00:00Z",
};
const engagement: EngagementDto = {
  id,
  code: "ENG-000001",
  clientId: id,
  clientName: "Client",
  serviceId: managerId,
  serviceName: "Tax",
  status: "draft",
  approvedVersionId: null,
  approvedVersion: null,
  approvedAt: null,
  approvedById: null,
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: id,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const options = { partners: [{ id, label: "Founder" }], managers: [{ id: managerId, label: "Manager" }] };
function renderDialog(
  onRevise = vi.fn<(input: ReviseEngagementDraftInput) => Promise<EngagementMutationResult>>().mockResolvedValue({ success: true }),
  onClose = vi.fn(),
) {
  return render(<ReviseEngagementDraftDialog open role="founder" engagement={engagement} version={version} {...options} onClose={onClose} onRevise={onRevise} />);
}
function dialogProps(overrides: Partial<React.ComponentProps<typeof ReviseEngagementDraftDialog>> = {}) {
  return { open: true, role: "founder" as const, engagement, version, ...options, onClose: vi.fn(), onRevise: vi.fn(), ...overrides };
}

describe("ReviseEngagementDraftDialog", () => {
  it("prefills every field and focuses the title initially", async () => {
    renderDialog();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Initial title");
    expect((screen.getByLabelText("Scope") as HTMLTextAreaElement).value).toBe("Initial scope");
    expect((screen.getByLabelText("Exclusions") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText("Responsible partner") as HTMLSelectElement).value).toBe(id);
    expect((screen.getByLabelText("Delivery manager") as HTMLSelectElement).value).toBe(managerId);
    expect((screen.getByLabelText("Fee model") as HTMLSelectElement).value).toBe("fixed");
    expect((screen.getByLabelText("Agreed fee (₹)") as HTMLInputElement).value).toBe("12500.50");
    expect((screen.getByLabelText("Billing terms") as HTMLInputElement).value).toBe("Monthly");
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("2026-01-01");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
  });

  it("sends exact input equality with no forbidden fields", async () => {
    const revise = vi.fn().mockResolvedValue({ success: true });
    renderDialog(revise);
    fireEvent.click(screen.getByRole("button", { name: /save revision/i }));
    await waitFor(() => expect(revise).toHaveBeenCalledTimes(1));
    const input = revise.mock.calls[0]?.[0];
    expect(input).toEqual({
      engagementId: id,
      expectedUpdatedAt: engagement.updatedAt,
      title: "Initial title",
      scope: "Initial scope",
      exclusions: null,
      responsiblePartnerId: id,
      deliveryManagerId: managerId,
      feeModel: "fixed",
      agreedFeePaise: 1250050,
      billingTerms: "Monthly",
      startDate: "2026-01-01",
      endDate: null,
    });
    for (const field of [
      "clientId", "serviceId", "status", "version", "versionNumber", "createdAt",
      "updatedAt", "approvedAt", "approvedById",
    ]) {
      expect(input).not.toHaveProperty(field);
    }
  });

  it("shows validation summary, title aria-invalid, describedby target, and focuses first invalid", async () => {
    const revise = vi.fn();
    renderDialog(revise);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save revision/i }));
    expect(await screen.findByText("Please correct the highlighted fields.")).toBeTruthy();
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Title").getAttribute("aria-describedby")).toBe("revise-title-error");
    expect(document.getElementById("revise-title-error")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
    expect(revise).not.toHaveBeenCalled();
  });

  it("blocks stale partner alone", () => {
    render(<ReviseEngagementDraftDialog {...dialogProps({ partners: [] })} />);
    expect(screen.getByText(/unavailable in the directory/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /save revision/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks stale manager alone", () => {
    render(<ReviseEngagementDraftDialog {...dialogProps({ managers: [] })} />);
    expect(screen.getByText(/unavailable in the directory/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /save revision/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses safe coordinator fallback, retains edited title, and hides supplied secret", async () => {
    const revise = vi.fn().mockResolvedValue({ success: false, error: { message: "private" } });
    renderDialog(revise);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retained" } });
    fireEvent.click(screen.getByRole("button", { name: /save revision/i }));
    expect(await screen.findByText(/unable to revise/i)).toBeTruthy();
    expect(screen.queryByText("private")).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Retained");
    expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /save revision/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses safe fallback for raw rejection and hides raw secret", async () => {
    renderDialog(vi.fn().mockRejectedValue(new Error("secret")));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Rejected title" } });
    fireEvent.click(screen.getByRole("button", { name: /save revision/i }));
    expect(await screen.findByText(/unable to revise/i)).toBeTruthy();
    expect(screen.queryByText("secret")).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Rejected title");
    expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /save revision/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes once from X", () => {
    const close = vi.fn();
    renderDialog(undefined, close);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes once from Cancel", () => {
    const close = vi.fn();
    renderDialog(undefined, close);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes once from Escape", () => {
    const close = vi.fn();
    renderDialog(undefined, close);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes once from backdrop", () => {
    const close = vi.fn();
    renderDialog(undefined, close);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("wraps idle Tab from Save revision to Close", () => {
    renderDialog();
    const save = screen.getByRole("button", { name: /save revision/i });
    const close = screen.getByRole("button", { name: "Close" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("wraps idle ShiftTab from Close to Save revision", () => {
    renderDialog();
    const save = screen.getByRole("button", { name: /save revision/i });
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("restores opener after a real open-to-closed transition", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const close = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return <ReviseEngagementDraftDialog {...dialogProps({ open, opener, onClose: () => { close(); setOpen(false); } })} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(close).toHaveBeenCalledTimes(1);
    opener.remove();
  });

  it("restores opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const view = render(<ReviseEngagementDraftDialog {...dialogProps({ opener })} />);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps all controls disabled, prevents duplicate submit and close, traps pending focus, then cleans up", async () => {
    let resolve!: (result: EngagementMutationResult) => void;
    const revise = vi.fn().mockReturnValue(new Promise<EngagementMutationResult>((finish) => { resolve = finish; }));
    const close = vi.fn();
    const view = renderDialog(revise, close);
    const form = screen.getByRole("button", { name: /save revision/i }).closest("form")!;
    fireEvent.submit(form);
    expect((await screen.findByRole("button", { name: /saving/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(revise).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole("dialog");
    dialog.querySelectorAll("button, input, select, textarea").forEach((element) => {
      expect((element as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.submit(form);
    expect(revise).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    resolve({ success: true });
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).disabled).toBe(false));
    view.rerender(<ReviseEngagementDraftDialog {...dialogProps({ open: false, onClose: close })} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    outside.remove();
  });

  it("closes once on success", async () => {
    const close = vi.fn();
    renderDialog(vi.fn().mockResolvedValue({ success: true }), close);
    fireEvent.click(screen.getByRole("button", { name: /save revision/i }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
});
