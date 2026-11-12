// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AmendActiveEngagementInput,
  EngagementDto,
  EngagementVersionDto,
  ReviseEngagementDraftInput,
} from "@sn/contracts";
import type { EngagementMutationResult } from "../../api/engagements-types";
import { EngagementTermsDialog } from "./engagement-terms-dialog";

afterEach(cleanup);
const id = "11111111-1111-4111-8111-111111111111";
const managerId = "22222222-2222-4222-8222-222222222222";
const version: EngagementVersionDto = {
  id,
  engagementId: id,
  versionNumber: 3,
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
  approvedAt: "2026-01-02T00:00:00Z",
  approvedById: id,
  createdById: id,
  createdAt: "2026-01-01T00:00:00Z",
};
const engagement: EngagementDto = {
  id,
  code: "ENG-01-A3d",
  clientId: id,
  clientName: "Client",
  serviceId: managerId,
  serviceName: "Tax",
  status: "active",
  approvedVersionId: id,
  approvedVersion: version,
  approvedAt: version.approvedAt,
  approvedById: id,
  endedAt: null,
  endedById: null,
  endOutcome: null,
  endReason: null,
  createdById: id,
  createdAt: version.createdAt,
  updatedAt: version.createdAt,
};
const options = {
  partners: [{ id, label: "Founder" }],
  managers: [{ id: managerId, label: "Manager" }],
};
function renderDialog(
  mode: "reviseDraft" | "amendActive" = "amendActive",
  onSave = vi.fn().mockResolvedValue({ success: true } as EngagementMutationResult),
  onClose = vi.fn(),
) {
  return render(
    <EngagementTermsDialog
      open
      role="founder"
      engagement={engagement}
      version={version}
      {...options}
      mode={mode}
      onClose={onClose}
      onSave={onSave}
    />,
  );
}

describe("EngagementTermsDialog", () => {
  it("permits amendment for Founder only", () => {
    render(
      <EngagementTermsDialog
        open
        role="founder"
        engagement={engagement}
        version={version}
        {...options}
        mode="amendActive"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Approve amendment" })).toBeTruthy();
  });

  it("permits draft revision for Founder and Manager", () => {
    for (const role of ["founder", "manager"] as const) {
      cleanup();
      render(
        <EngagementTermsDialog
          open
          role={role}
          engagement={engagement}
          version={version}
          {...options}
          mode="reviseDraft"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(screen.getByRole("dialog")).toBeTruthy();
    }
  });

  it.each(["manager", "senior_staff", "staff", "trainee"] as const)(
    "denies %s from amendment",
    (role) => {
      cleanup();
      render(
        <EngagementTermsDialog
          open
          role={role}
          engagement={engagement}
          version={version}
          {...options}
          mode="amendActive"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each(["senior_staff", "staff", "trainee"] as const)(
    "denies %s from draft revision",
    (role) => {
      cleanup();
      render(
        <EngagementTermsDialog
          open
          role={role}
          engagement={engagement}
          version={version}
          {...options}
          mode="reviseDraft"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
  it("shows amendment context, omits UUIDs, and focuses Title without callback focus churn", async () => {
    const view = renderDialog();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
    expect(screen.getByRole("dialog").textContent).toMatch(
      /ENG-01-A3d.*Client.*Tax.*current v3.*next v4/,
    );
    expect(screen.queryByText(id)).toBeNull();
    const title = screen.getByLabelText("Title");
    title.focus();
    view.rerender(
      <EngagementTermsDialog
        open
        role="founder"
        engagement={engagement}
        version={version}
        {...options}
        mode="amendActive"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(title);
    expect(screen.getByText("Prior approved terms remain immutable.")).toBeTruthy();
  });
  it("sends the exact amendment input", async () => {
    const save = vi.fn().mockResolvedValue({ success: true });
    renderDialog("amendActive", save);
    fireEvent.click(screen.getByRole("button", { name: "Approve amendment" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual({
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
  });
  it.each(["Close", "Cancel"])("dismisses from %s", (name) => {
    const close = vi.fn();
    renderDialog("amendActive", undefined, close);
    fireEvent.click(screen.getByRole("button", { name }));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("dismisses from Escape and backdrop", () => {
    const close = vi.fn();
    renderDialog("amendActive", undefined, close);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("wraps idle Tab and ShiftTab", () => {
    renderDialog();
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Approve amendment" });
    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });
  it("focuses the first invalid field and blocks unavailable directory entries", async () => {
    const save = vi.fn();
    renderDialog("amendActive", save);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve amendment" }));
    expect(await screen.findByText("Please correct the highlighted fields.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Title")));
    cleanup();
    render(
      <EngagementTermsDialog
        open
        role="founder"
        engagement={engagement}
        version={version}
        partners={[]}
        managers={options.managers}
        mode="amendActive"
        onClose={vi.fn()}
        onSave={save}
      />,
    );
    expect(screen.getByText(/unavailable in the directory/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve amendment" })).toHaveProperty(
      "disabled",
      true,
    );
  });
  it("keeps pending controls locked, traps outside focus, and re-enables on resolved failure", async () => {
    let resolve!: (result: EngagementMutationResult) => void;
    const save = vi.fn().mockReturnValue(
      new Promise<EngagementMutationResult>((done) => {
        resolve = done;
      }),
    );
    const close = vi.fn();
    renderDialog("amendActive", save, close);
    fireEvent.click(screen.getByRole("button", { name: "Approve amendment" }));
    expect(await screen.findByRole("button", { name: /approving/i })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    resolve({ success: false, error: { code: "unexpected", name: "Failure", message: "secret" } });
    expect(await screen.findByText(/unable to approve/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve amendment" })).toHaveProperty(
      "disabled",
      false,
    );
  });
  it("uses safe error for rejected save and closes once on success", async () => {
    const close = vi.fn();
    renderDialog("reviseDraft", vi.fn().mockRejectedValue(new Error("secret")), close);
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    expect(await screen.findByText(/unable to revise/i)).toBeTruthy();
    cleanup();
    renderDialog("reviseDraft", vi.fn().mockResolvedValue({ success: true }), close);
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  });
  it("restores opener after close transition and unmount", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    const close = vi.fn();
    const view = renderDialog(
      "amendActive",
      undefined,
      vi.fn(() => close()),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    view.rerender(
      <EngagementTermsDialog
        open={false}
        role="founder"
        engagement={engagement}
        version={version}
        {...options}
        mode="amendActive"
        onClose={close}
        onSave={vi.fn()}
        opener={opener}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    view.unmount();
    opener.remove();
  });
  it("keeps revision mode copy and contract regression", async () => {
    const save = vi
      .fn<(input: ReviseEngagementDraftInput) => Promise<EngagementMutationResult>>()
      .mockResolvedValue({ success: true });
    renderDialog("reviseDraft", save);
    expect(screen.getByRole("heading", { name: "Revise draft engagement" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual({
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
    expect(Object.keys(save.mock.calls[0]?.[0] ?? {})).toEqual([
      "engagementId",
      "expectedUpdatedAt",
      "title",
      "scope",
      "exclusions",
      "responsiblePartnerId",
      "deliveryManagerId",
      "feeModel",
      "agreedFeePaise",
      "billingTerms",
      "startDate",
      "endDate",
    ]);
  });
});
