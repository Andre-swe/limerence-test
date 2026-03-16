// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchMock,
  refreshMock,
  useRouterMock,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  useRouterMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
}));

import { RunHeartbeatButton } from "@/components/run-heartbeat-button";

describe("RunHeartbeatButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    useRouterMock.mockReturnValue({
      refresh: refreshMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes the page after a successful run", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });

    render(<RunHeartbeatButton endpoint="/api/internal/heartbeat" label="Run now" />);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error and skips refresh when the request fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<RunHeartbeatButton endpoint="/api/internal/heartbeat" label="Run now" />);
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
