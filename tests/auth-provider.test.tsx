// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authSignOutMock,
  createClientMock,
  fetchMock,
  getSessionMock,
  onAuthStateChangeMock,
  unsubscribeMock,
} = vi.hoisted(() => ({
  authSignOutMock: vi.fn(),
  createClientMock: vi.fn(),
  fetchMock: vi.fn(),
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@/lib/supabase-browser", () => ({
  createClient: createClientMock,
}));

import { AuthProvider, useAuth } from "@/components/auth-provider";

function AuthProbe() {
  const { loading, signOut, user } = useAuth();

  return (
    <div>
      <span>{loading ? "loading" : user?.id ?? "none"}</span>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
    });
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-1",
          },
        },
      },
    });
    onAuthStateChangeMock.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: unsubscribeMock,
        },
      },
    });
    authSignOutMock.mockResolvedValue({
      error: null,
    });
    createClientMock.mockReturnValue({
      auth: {
        getSession: getSessionMock,
        onAuthStateChange: onAuthStateChangeMock,
        signOut: authSignOutMock,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs out through both the browser client and the server route", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await screen.findByText("user-1");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(authSignOutMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", { method: "POST" });
    await waitFor(() => {
      expect(screen.getByText("none")).toBeTruthy();
    });
  });
});
