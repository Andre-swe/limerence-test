import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const { createServerClientMock, getUserMock } = vi.hoisted(() => {
  const getUserMock = vi.fn();
  const createServerClientMock = vi.fn(() => ({
    auth: {
      getUser: getUserMock,
    },
  }));

  return {
    createServerClientMock,
    getUserMock,
  };
});

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test");
    getUserMock.mockResolvedValue({
      data: { user: null },
    });
  });

  it("handles CORS preflight requests", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/personas", { method: "OPTIONS" }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("lets public auth paths through without Supabase auth", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/api/auth/sign-in", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated users away from protected pages", async () => {
    const response = await proxy(new NextRequest("http://localhost/settings"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fsettings",
    );
  });

  it("returns a 401 for unauthenticated persona API requests", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/personas/persona-1/messages"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized. Valid session required.",
    });
  });

  it("injects x-user-id into authenticated persona API requests", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-42" } },
    });

    const response = await proxy(
      new NextRequest("http://localhost/api/personas/persona-1/messages", {
        headers: { origin: "http://localhost:3000" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-user-id")).toBe("user-42");
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});
