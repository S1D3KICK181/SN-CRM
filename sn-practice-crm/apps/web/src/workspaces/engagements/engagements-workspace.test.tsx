// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EngagementDto } from "@sn/contracts";
import { EngagementsWorkspace } from "./engagements-workspace";
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
});
