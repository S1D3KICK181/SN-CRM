// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ClientDto, EngagementDto, EngagementVersionDto, ReportingLineDto, ServiceCatalogItemDto, SessionActor } from "@sn/contracts";
import { buildEngagementOptions, EngagementsWorkspace } from "./engagements-workspace";
import { TestEngagementsAdapter } from "../../api/test-engagements-adapter";

afterEach(cleanup);
const engagement = (id: string, status: EngagementDto["status"] = "active"): EngagementDto => ({
  id,
  code: `ENG-${id}`,
  clientId: "c",
  clientName: `Client ${id}`,
  serviceId: "s",
  serviceName: "Tax",
  status,
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
  updatedAt: "2026-04-01T00:00:00Z",
});

describe("EngagementsWorkspace", () => {
  it.each(["active", "ended"] as const)("does not expose revise for %s engagements", async (status) => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1", status)]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    fireEvent.click(screen.getByText("Client 1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /revise draft/i })).toBeNull());
  });
  const actor = (id: string, role: SessionActor["role"], name = role): SessionActor => ({ id, name, role, reportsToId: null });
  const client = (id: string, name: string, status: ClientDto["status"] = "active"): ClientDto => ({ id, code: "CL-000001", displayName: name, legalName: null, gstinMasked: null, panMasked: null, email: null, phone: null, relationshipOwnerId: null, relationshipOwnerName: null, status, notes: null, activeAssignmentsCount: 0, pan: null, gstin: null, entityType: null, addressLine1: null, addressLine2: null, city: null, state: null, pincode: null, tan: null, cinLlpin: null, udyamNumber: null, iec: null, incorporationDate: null, contacts: [], canEdit: false, canChangeOwnerOrStatus: false, createdById: id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
  const service = (id: string, name: string): ServiceCatalogItemDto => ({ id, name });
  const founder = actor("11111111-1111-4111-8111-111111111111", "founder");
  const manager = actor("22222222-2222-4222-8222-222222222222", "manager");
  const staff = actor("33333333-3333-4333-8333-333333333333", "staff");
  const lines: ReportingLineDto[] = [{ employee: founder, manager: null }, { employee: manager, manager: founder }, { employee: staff, manager }];
  it("renders founder metrics, search/status filters, and selection", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1"), engagement("2", "draft")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    expect(screen.getByText("Accessible engagements").parentElement?.textContent).toContain("2");
    fireEvent.change(screen.getByLabelText("Search engagements"), {
      target: { value: "client 2" },
    });
    expect(screen.getByText("Client 2")).toBeTruthy();
    fireEvent.click(screen.getByText("Client 2"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it.each(["senior_staff", "staff", "trainee"] as const)(
    "denies %s without calling list",
    (role) => {
      const port = new TestEngagementsAdapter();
      const list = vi.spyOn(port, "list");
      render(<EngagementsWorkspace role={role} port={port} />);
      expect(screen.getByText("No permission")).toBeTruthy();
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("shows manager access and all four metrics", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1"), engagement("2", "draft"), engagement("3", "ended")]);
    render(<EngagementsWorkspace role="manager" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    expect(screen.getByText("Accessible engagements").parentElement?.textContent).toContain("3");
    const metrics = screen.getByRole("region", { name: "Engagement metrics" });
    expect(metrics.textContent).toContain("Active1");
    expect(metrics.textContent).toContain("Draft1");
    expect(metrics.textContent).toContain("Ended1");
  });

  it("supports code, client, and service search and clearing", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    const search = screen.getByLabelText("Search engagements");
    for (const value of ["ENG-1", "client 1", "tax", ""]) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getByText("Client 1")).toBeTruthy();
    }
  });

  it("changes status filter and shows filtered empty state", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Filter engagements by status"), {
      target: { value: "ended" },
    });
    expect(screen.getByText("No engagements match your filters.")).toBeTruthy();
  });

  it("shows a skeleton and no confidential rows during the initial request", () => {
    const port = new TestEngagementsAdapter();
    vi.spyOn(port, "list").mockImplementation(() => new Promise(() => undefined));
    render(<EngagementsWorkspace role="founder" port={port} />);
    expect(screen.getByLabelText("Loading engagement directory")).toBeTruthy();
    expect(screen.queryByText("Client 1")).toBeNull();
  });

  it("shows sanitized initial failure and retries successfully", async () => {
    const port = new TestEngagementsAdapter();
    vi.spyOn(port, "list").mockRejectedValueOnce(new Error("internal secret"));
    port.seed([engagement("1")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText("internal secret")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
  });

  it("shows the empty state when no rows are accessible", async () => {
    const port = new TestEngagementsAdapter();
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("No engagements accessible.")).toBeTruthy());
  });

  it("opens the drawer from keyboard Enter", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    fireEvent.keyDown(screen.getByText("Client 1").closest("tr")!, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("opens the drawer from keyboard Space", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    fireEvent.keyDown(screen.getByText("Client 1").closest("tr")!, { key: " " });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
  });

  it("retains rows with a stale warning after refresh failure and recovers on retry", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    const list = vi.spyOn(port, "list");
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    list.mockRejectedValueOnce(new Error("private backend detail"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh engagement list" }));
    await waitFor(() => expect(screen.getByText(/Showing last loaded data/)).toBeTruthy());
    expect(screen.getByText("Client 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Showing last loaded data/)).toBeNull());
    expect(screen.getByText("Client 1")).toBeTruthy();
  });

  it("resets filters and selection on founder to staff transition", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    const view = render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search engagements"), { target: { value: "missing" } });
    view.rerender(<EngagementsWorkspace role="staff" port={port} />);
    expect(screen.getByText("No permission")).toBeTruthy();
    view.rerender(<EngagementsWorkspace role="founder" port={port} />);
    expect((screen.getByLabelText("Search engagements") as HTMLInputElement).value).toBe("");
  });

  it("does not render raw UUID strings", async () => {
    const port = new TestEngagementsAdapter();
    port.seed([engagement("1")]);
    render(<EngagementsWorkspace role="founder" port={port} />);
    await waitFor(() => expect(screen.getByText("Client 1")).toBeTruthy());
    expect(document.body.textContent).not.toContain("00000000-0000-0000-0000-000000000000");
  });

  it.each(["founder", "manager"] as const)("shows New engagement for %s", async (role) => {
    render(<EngagementsWorkspace role={role} port={new TestEngagementsAdapter()} currentActor={actor("44444444-4444-4444-8444-444444444444", role)} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /new engagement/i })).toBeTruthy());
  });

  it("does not list for senior, staff, or trainee and has no action", () => {
    for (const role of ["senior_staff", "staff", "trainee"] as const) {
      const port = new TestEngagementsAdapter();
      const list = vi.spyOn(port, "list");
      const view = render(<EngagementsWorkspace role={role} port={port} />);
      expect(screen.queryByRole("button", { name: /new engagement/i })).toBeNull();
      expect(list).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it("builds filtered, deduped, sorted role-aware options and includes the actor", () => {
    const options = buildEngagementOptions(manager, [client("bad", "Bad"), client(founder.id, "Zulu"), client(founder.id, "Alpha")], lines, [service(staff.id, "Tax"), service("bad", "Bad")]);
    expect(options.clients).toEqual([{ id: founder.id, label: "Alpha" }]);
    expect(options.services).toEqual([{ id: staff.id, label: "Tax" }]);
    expect(options.partners.map((item) => item.id)).toEqual([founder.id]);
    expect(options.managers.map((item) => item.id)).toEqual([founder.id, manager.id]);
  });

  it("excludes on-hold, archived, and invalid-UUID clients while keeping active valid clients", () => {
    const options = buildEngagementOptions(undefined, [
      client("44444444-4444-4444-8444-444444444444", "Active"),
      client("55555555-5555-4555-8555-555555555555", "On hold", "on_hold"),
      client("66666666-6666-4666-8666-666666666666", "Archived", "archived"),
      client("invalid", "Invalid"),
    ]);
    expect(options.clients).toEqual([{ id: "44444444-4444-4444-8444-444444444444", label: "Active" }]);
  });

  it.each([
    [founder, [founder.id], [founder.id]],
    [manager, [], [manager.id]],
  ] as const)("includes an actor absent from team lines according to role", (currentActor, partnerIds, managerIds) => {
    const options = buildEngagementOptions(currentActor);
    expect(options.partners.map((item) => item.id)).toEqual(partnerIds);
    expect(options.managers.map((item) => item.id)).toEqual(managerIds);
  });

  it("uses the current actor for duplicate UUIDs and includes it once with current eligibility", () => {
    const staleDirectoryLine: ReportingLineDto = { employee: { ...founder, name: "Stale name", role: "staff" }, manager: null };
    const currentActor = { ...founder, name: "Current name", role: "founder" as const };
    const options = buildEngagementOptions(currentActor, [], [staleDirectoryLine]);
    expect(options.partners).toEqual([{ id: founder.id, label: "Current name", role: "founder" }]);
    expect(options.managers).toEqual([{ id: founder.id, label: "Current name", role: "founder" }]);
  });

  it("creates a draft through the adapter and updates metrics with its generated code", async () => {
    const port = new TestEngagementsAdapter();
    const create = vi.spyOn(port, "createDraft");
    render(<EngagementsWorkspace role="founder" port={port} currentActor={founder} clients={[client(founder.id, "Client")]} teamLines={lines} services={[service(staff.id, "Tax")]} />);
    fireEvent.click(await screen.findByRole("button", { name: /new engagement/i }));
    for (const [label, value] of [["Client", founder.id], ["Service", staff.id], ["Responsible partner", founder.id], ["Delivery manager", manager.id], ["Title", "New title"], ["Scope", "A scope"], ["Agreed fee (₹)", "10"], ["Billing terms", "Monthly"], ["Start date", "2026-01-01"]] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: /create draft/i }));
    await waitFor(() => expect(screen.getByText(/ENG-/)).toBeTruthy());
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty("code");
    expect(screen.getByRole("region", { name: "Engagement metrics" }).textContent).toContain("Draft1");
  });

  it("does not reopen the create dialog across founder to staff to founder", async () => {
    const view = render(<EngagementsWorkspace role="founder" port={new TestEngagementsAdapter()} currentActor={founder} />);
    fireEvent.click(await screen.findByRole("button", { name: /new engagement/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<EngagementsWorkspace role="staff" port={new TestEngagementsAdapter()} currentActor={staff} />);
    view.rerender(<EngagementsWorkspace role="founder" port={new TestEngagementsAdapter()} currentActor={founder} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([founder, manager] as const)("revises the seeded draft through the adapter for %s", async (currentActor) => {
    const draftId = "77777777-7777-4777-8777-777777777777";
    const versionId = "88888888-8888-4888-8888-888888888888";
    const draft = engagement(draftId, "draft");
    const version: EngagementVersionDto = {
      id: versionId,
      engagementId: draftId,
      versionNumber: 1,
      title: "Original title",
      scope: "Original scope",
      exclusions: null,
      responsiblePartnerId: founder.id,
      responsiblePartnerName: "Founder",
      deliveryManagerId: manager.id,
      deliveryManagerName: "Manager",
      feeModel: "fixed",
      agreedFeePaise: 125000,
      billingTerms: "Monthly",
      startDate: "2026-01-01",
      endDate: null,
      approvedAt: null,
      approvedById: null,
      createdById: founder.id,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const port = new TestEngagementsAdapter().seed([draft], new Map([[draftId, [version]]]));
    render(<EngagementsWorkspace role={currentActor.role} port={port} currentActor={currentActor} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${draftId}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${draftId}`));
    await screen.findByRole("button", { name: "Revise draft" });
    fireEvent.click(screen.getByRole("button", { name: "Revise draft" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const drawer = document.querySelector<HTMLElement>('aside[role="dialog"]');
    expect(drawer).not.toBeNull();
    if (!drawer) throw new Error("Expected the engagement drawer to be present");
    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(drawer?.getAttribute("inert")).toBe("");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Revised title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save revision" }));
    await waitFor(async () => {
      const versions = await port.listVersions(currentActor.role, draftId);
      expect(versions).toHaveLength(2);
      expect(versions[1]?.versionNumber).toBe(2);
      expect(versions[1]?.title).toBe("Revised title");
      expect(screen.queryByRole("dialog", { name: "Revise draft engagement" })).toBeNull();
      expect(screen.getByRole("dialog", { name: draft.code })).toBeTruthy();
      expect(screen.getAllByText("Revised title")).toHaveLength(2);
      expect(screen.getByText("Original title")).toBeTruthy();
      expect(screen.getByRole("region", { name: "Engagement metrics" }).textContent).toContain("Draft1");
      expect(screen.getAllByText(draft.code)).toHaveLength(3);
    });
  });

  it("activates the latest draft through the real adapter for a founder", async () => {
    const draftId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const latestVersionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const draft = { ...engagement(draftId, "draft"), updatedAt: "2026-04-02T00:00:00Z" };
    const firstVersion = { ...versionForWorkspace(draftId, founder.id, manager.id, "v1"), id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", versionNumber: 1 };
    const latestVersion = { ...firstVersion, id: latestVersionId, versionNumber: 2, title: "Latest activation terms" };
    const port = new TestEngagementsAdapter().seed([draft], new Map([[draftId, [firstVersion, latestVersion]]]));
    const activate = vi.spyOn(port, "activate");
    render(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${draftId}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${draftId}`));
    const activationButton = await screen.findByRole("button", { name: "Approve & activate" });
    fireEvent.click(activationButton);
    fireEvent.click(screen.getByRole("button", { name: "Approve & activate" }));
    expect(activationButton.isConnected).toBe(true);
    expect((activationButton as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(activate).toHaveBeenCalledTimes(1));
    expect(activate).toHaveBeenCalledWith(
      "founder",
      draftId,
      {
        engagementId: draftId,
        versionId: latestVersionId,
        expectedUpdatedAt: draft.updatedAt,
      },
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(activate.mock.calls[0]?.[3]).toMatch(/^[0-9a-f-]{36}$/);
    const activated = await port.list("founder");
    expect(activated.find((item) => item.id === draftId)).toMatchObject({
      status: "active",
      approvedVersionId: latestVersionId,
    });
    expect(screen.getByRole("dialog", { name: draft.code })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve & activate" })).toBeNull();
    expect(screen.getByRole("region", { name: "Engagement metrics" }).textContent).toContain("Active1");
    expect(screen.getByRole("region", { name: "Engagement metrics" }).textContent).toContain("Draft0");
    const history = screen.getByText("Version history").parentElement;
    expect(history?.textContent).toContain("v1");
    expect(history?.textContent).toContain("Draft");
  });

  it("shows a manager the revise action without exposing activation", async () => {
    const draftId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const draft = engagement(draftId, "draft");
    const draftVersion = versionForWorkspace(draftId, founder.id, manager.id, "manager draft");
    const port = new TestEngagementsAdapter().seed([draft], new Map([[draftId, [draftVersion]]]));
    const activate = vi.spyOn(port, "activate");
    render(<EngagementsWorkspace role="manager" port={port} currentActor={manager} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${draftId}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${draftId}`));
    expect(await screen.findByRole("button", { name: "Revise draft" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve & activate" })).toBeNull();
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not retain the revision modal across founder to staff to founder transition", async () => {
    const draftId = "99999999-9999-4999-8999-999999999999";
    const version: EngagementVersionDto = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      engagementId: draftId,
      versionNumber: 1,
      title: "Transition title",
      scope: "Transition scope",
      exclusions: null,
      responsiblePartnerId: founder.id,
      responsiblePartnerName: "Founder",
      deliveryManagerId: manager.id,
      deliveryManagerName: "Manager",
      feeModel: "fixed",
      agreedFeePaise: 100000,
      billingTerms: "Monthly",
      startDate: "2026-01-01",
      endDate: null,
      approvedAt: null,
      approvedById: null,
      createdById: founder.id,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const port = new TestEngagementsAdapter().seed([engagement(draftId, "draft")], new Map([[draftId, [version]]]));
    const view = render(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${draftId}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${draftId}`));
    fireEvent.click(await screen.findByRole("button", { name: "Revise draft" }));
    expect(screen.getByRole("dialog", { name: "Revise draft engagement" })).toBeTruthy();
    view.rerender(<EngagementsWorkspace role="staff" port={port} currentActor={staff} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Revise draft" })).toBeNull();
    view.rerender(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("clears the activation modal across founder, manager, staff, and founder", async () => {
    const draftId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const draft = engagement(draftId, "draft");
    const draftVersion: EngagementVersionDto = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", engagementId: draftId, versionNumber: 1, title: "Activation draft", scope: "Scope", exclusions: null, responsiblePartnerId: founder.id, responsiblePartnerName: "Founder", deliveryManagerId: manager.id, deliveryManagerName: "Manager", feeModel: "fixed", agreedFeePaise: 100000, billingTerms: "Monthly", startDate: "2026-01-01", endDate: null, approvedAt: null, approvedById: null, createdById: founder.id, createdAt: "2026-01-01T00:00:00Z" };
    const port = new TestEngagementsAdapter().seed([draft], new Map([[draftId, [draftVersion]]]));
    const view = render(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${draftId}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${draftId}`));
    const activationButton = await screen.findByRole("button", { name: "Approve & activate" });
    fireEvent.click(activationButton);
    expect(screen.getByRole("dialog", { name: "Approve engagement" })).toBeTruthy();
    expect(activationButton.isConnected).toBe(true);
    expect((activationButton as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<EngagementsWorkspace role="manager" port={port} currentActor={manager} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve engagement" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Approve & activate" })).toBeNull();
    view.rerender(<EngagementsWorkspace role="staff" port={port} currentActor={staff} teamLines={lines} />);
    expect(screen.queryByRole("dialog", { name: "Approve engagement" })).toBeNull();
    view.rerender(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve engagement" })).toBeNull());
  });

  it("amends active terms through the real adapter for a founder", async () => {
    const engagementId = "12121212-1212-4121-8121-121212121212";
    const versionId = "13131313-1313-4131-8131-131313131313";
    const active = {
      ...engagement(engagementId, "active"),
      approvedVersionId: versionId,
      approvedAt: "2026-04-02T00:00:00Z",
      approvedById: founder.id,
      updatedAt: "2026-04-02T00:00:00Z",
    };
    const approvedV1: EngagementVersionDto = {
      id: versionId,
      engagementId,
      versionNumber: 1,
      title: "Approved v1",
      scope: "Approved scope",
      exclusions: null,
      responsiblePartnerId: founder.id,
      responsiblePartnerName: "Founder",
      deliveryManagerId: manager.id,
      deliveryManagerName: "Manager",
      feeModel: "fixed",
      agreedFeePaise: 100000,
      billingTerms: "Monthly",
      startDate: "2026-01-01",
      endDate: null,
      approvedAt: active.approvedAt,
      approvedById: founder.id,
      createdById: founder.id,
      createdAt: "2026-04-01T00:00:00Z",
    };
    active.approvedVersion = approvedV1;
    const port = new TestEngagementsAdapter().seed([active], new Map([[engagementId, [approvedV1]]]));
    const amend = vi.spyOn(port, "amend");
    render(
      <EngagementsWorkspace
        role="founder"
        port={port}
        currentActor={founder}
        teamLines={lines}
      />,
    );
    await waitFor(() => expect(screen.getByText(`Client ${engagementId}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${engagementId}`));
    const amendmentButton = await screen.findByRole("button", { name: "Amend terms" });
    fireEvent.click(amendmentButton);
    expect(screen.getByRole("dialog", { name: "Approve amendment" })).toBeTruthy();
    expect(amendmentButton.isConnected).toBe(true);
    expect((amendmentButton as HTMLButtonElement).disabled).toBe(true);
    const drawer = document.querySelector<HTMLElement>('aside[role="dialog"]');
    expect(drawer?.getAttribute("inert")).toBe("");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Approved amendment v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve amendment" }));
    await waitFor(() => expect(amend).toHaveBeenCalledTimes(1));
    expect(amend).toHaveBeenCalledWith(
      "founder",
      engagementId,
      {
        engagementId,
        expectedUpdatedAt: active.updatedAt,
        title: "Approved amendment v2",
        scope: approvedV1.scope,
        exclusions: approvedV1.exclusions,
        responsiblePartnerId: founder.id,
        deliveryManagerId: manager.id,
        feeModel: approvedV1.feeModel,
        agreedFeePaise: approvedV1.agreedFeePaise,
        billingTerms: approvedV1.billingTerms,
        startDate: approvedV1.startDate,
        endDate: approvedV1.endDate,
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const updated = (await port.list("founder")).find((item) => item.id === engagementId);
    expect(updated).toMatchObject({ status: "active", approvedVersion: { versionNumber: 2, title: "Approved amendment v2" } });
    const versions = await port.listVersions("founder", engagementId);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ id: versionId, title: "Approved v1", versionNumber: 1 });
    expect(versions.every((version) => version.approvedAt)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: active.code })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(amendmentButton));
    expect(screen.getAllByText("Approved amendment v2")).toHaveLength(2);
    const history = screen.getByText("Version history").parentElement;
    expect(history?.textContent).toContain("Approved amendment v2");
    expect(history?.textContent).toContain("Approved v1");
    expect(screen.getByRole("region", { name: "Engagement metrics" }).textContent).toContain("Active1");
    expect(screen.getByRole("region", { name: "Engagement metrics" }).textContent).toContain("Draft0");
    expect(screen.getByRole("button", { name: "Amend terms" })).toBeTruthy();
  });

  it("does not expose amendment to a manager", async () => {
    const id = "14141414-1414-4141-8141-141414141414";
    const active = { ...engagement(id, "active"), approvedVersionId: "15151515-1515-4151-8151-151515151515" };
    const approved = { ...versionForWorkspace(id, founder.id, manager.id, "Manager active"), id: active.approvedVersionId, approvedAt: "2026-04-02T00:00:00Z", approvedById: founder.id };
    active.approvedAt = approved.approvedAt;
    active.approvedById = founder.id;
    active.approvedVersion = approved;
    const port = new TestEngagementsAdapter().seed([active], new Map([[id, [approved]]]));
    const amend = vi.spyOn(port, "amend");
    render(<EngagementsWorkspace role="manager" port={port} currentActor={manager} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${id}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${id}`));
    expect(await screen.findByRole("dialog", { name: active.code })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Amend terms" })).toBeNull();
    expect(amend).not.toHaveBeenCalled();
  });

  it("clears the amendment modal across role transitions", async () => {
    const id = "16161616-1616-4161-8161-161616161616";
    const active = { ...engagement(id, "active"), approvedVersionId: "17171717-1717-4171-8171-171717171717" };
    const approved = { ...versionForWorkspace(id, founder.id, manager.id, "Transition active"), id: active.approvedVersionId, approvedAt: "2026-04-02T00:00:00Z", approvedById: founder.id };
    active.approvedAt = approved.approvedAt;
    active.approvedById = founder.id;
    active.approvedVersion = approved;
    const port = new TestEngagementsAdapter().seed([active], new Map([[id, [approved]]]));
    const view = render(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${id}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${id}`));
    fireEvent.click(await screen.findByRole("button", { name: "Amend terms" }));
    expect(screen.getByRole("dialog", { name: "Approve amendment" })).toBeTruthy();
    view.rerender(<EngagementsWorkspace role="manager" port={port} currentActor={manager} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve amendment" })).toBeNull());
    view.rerender(<EngagementsWorkspace role="staff" port={port} currentActor={staff} teamLines={lines} />);
    expect(screen.queryByRole("dialog", { name: "Approve amendment" })).toBeNull();
    view.rerender(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve amendment" })).toBeNull());
  });

  const seedActive = (id: string) => {
    const active = { ...engagement(id, "active"), approvedVersionId: `${id}-version`, approvedAt: "2026-04-02T00:00:00Z", approvedById: founder.id, updatedAt: "2026-04-02T00:00:00Z" };
    const approved = { ...versionForWorkspace(id, founder.id, manager.id, "End active"), id: active.approvedVersionId, approvedAt: active.approvedAt, approvedById: founder.id };
    active.approvedVersion = approved;
    return new TestEngagementsAdapter().seed([active], new Map([[id, [approved]]]));
  };
  const openDrawer = async (id: string) => {
    await waitFor(() => expect(screen.getByText(`Client ${id}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${id}`));
    return screen.findByRole("button", { name: "End engagement" });
  };

  it("ends an active engagement as Completed for a founder", async () => {
    const id = "18181818-1818-4181-8181-181818181818";
    render(<EngagementsWorkspace role="founder" port={seedActive(id)} currentActor={founder} teamLines={lines} />);
    fireEvent.click(await openDrawer(id));
    const dialog = screen.getByRole("dialog", { name: "End engagement" });
    fireEvent.click(within(dialog).getByLabelText(/Completed/));
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Delivered in full" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "End engagement" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "End engagement" })).toBeNull());
    await waitFor(() => expect(screen.getByText(/Ended:.*Completed.*Delivered in full/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "End engagement" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Amend terms" })).toBeNull();
    const metrics = screen.getByRole("region", { name: "Engagement metrics" }).textContent;
    expect(metrics).toContain("Active0");
    expect(metrics).toContain("Ended1");
    const drawer = document.querySelector<HTMLElement>('aside[role="dialog"]')!;
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
  });

  it("returns focus to the same End button when the dialog is cancelled", async () => {
    const id = "19191919-1919-4191-8191-191919191919";
    render(<EngagementsWorkspace role="founder" port={seedActive(id)} currentActor={founder} teamLines={lines} />);
    const endButton = await openDrawer(id);
    fireEvent.click(endButton);
    expect(endButton.isConnected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "End engagement" })).toBeNull());
    expect(endButton.isConnected).toBe(true);
    expect(document.activeElement).toBe(endButton);
  });

  it("does not expose End to a manager", async () => {
    const id = "20202020-2020-4202-8202-202020202020";
    render(<EngagementsWorkspace role="manager" port={seedActive(id)} currentActor={manager} teamLines={lines} />);
    await waitFor(() => expect(screen.getByText(`Client ${id}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Client ${id}`));
    expect(await screen.findByRole("dialog", { name: `ENG-${id}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End engagement" })).toBeNull();
  });

  it("clears the End dialog across role transitions", async () => {
    const id = "21212121-2121-4212-8212-212121212121";
    const port = seedActive(id);
    const view = render(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    fireEvent.click(await openDrawer(id));
    expect(screen.getByRole("dialog", { name: "End engagement" })).toBeTruthy();
    view.rerender(<EngagementsWorkspace role="manager" port={port} currentActor={manager} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "End engagement" })).toBeNull());
    view.rerender(<EngagementsWorkspace role="founder" port={port} currentActor={founder} teamLines={lines} />);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "End engagement" })).toBeNull());
  });

  it("hides Amend while the End dialog is open and End while the Amend dialog is open", async () => {
    const id = "23232323-2323-4232-8232-232323232323";
    render(<EngagementsWorkspace role="founder" port={seedActive(id)} currentActor={founder} teamLines={lines} />);
    fireEvent.click(await openDrawer(id));
    expect(screen.queryByRole("button", { name: "Amend terms", hidden: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "End engagement" })).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Amend terms" }));
    expect(screen.getByRole("dialog", { name: "Approve amendment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End engagement", hidden: true })).toBeNull();
  });
});

const versionForWorkspace = (
  engagementId: string,
  responsiblePartnerId: string,
  deliveryManagerId: string,
  title: string,
): EngagementVersionDto => ({
  id: `${engagementId}-version`,
  engagementId,
  versionNumber: 1,
  title,
  scope: "Scope",
  exclusions: null,
  responsiblePartnerId,
  responsiblePartnerName: "Founder",
  deliveryManagerId,
  deliveryManagerName: "Manager",
  feeModel: "fixed",
  agreedFeePaise: 100000,
  billingTerms: "Monthly",
  startDate: "2026-01-01",
  endDate: null,
  approvedAt: null,
  approvedById: null,
  createdById: responsiblePartnerId,
  createdAt: "2026-01-01T00:00:00Z",
});
