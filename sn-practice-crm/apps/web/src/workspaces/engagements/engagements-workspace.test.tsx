// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ClientDto, EngagementDto, ReportingLineDto, ServiceCatalogItemDto, SessionActor } from "@sn/contracts";
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
  const actor = (id: string, role: SessionActor["role"], name = role): SessionActor => ({ id, name, role, reportsToId: null });
  const client = (id: string, name: string, status: ClientDto["status"] = "active"): ClientDto => ({ id, code: "CL-000001", displayName: name, legalName: null, gstinMasked: null, panMasked: null, email: null, phone: null, relationshipOwnerId: null, relationshipOwnerName: null, status, notes: null, activeAssignmentsCount: 0, createdById: id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" });
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
});
