import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectJsonError, expectJsonResponse } from "@/tests/helpers/assertions";
import { jsonRequest } from "@/tests/helpers/route-helpers";

const {
  cookieStore,
  cookiesMock,
  createServerClientMock,
  exchangeCodeForSessionMock,
  signInWithOtpMock,
  signInWithPasswordMock,
  signOutMock,
  signUpMock,
} = vi.hoisted(() => {
  const cookieStore = {
    getAll: vi.fn(() => []),
    set: vi.fn(),
  };
  const signInWithOtpMock = vi.fn();
  const signInWithPasswordMock = vi.fn();
  const signOutMock = vi.fn();
  const signUpMock = vi.fn();
  const exchangeCodeForSessionMock = vi.fn();
  const createServerClientMock = vi.fn(() => ({
    auth: {
      signInWithOtp: signInWithOtpMock,
      signInWithPassword: signInWithPasswordMock,
      signOut: signOutMock,
      signUp: signUpMock,
      exchangeCodeForSession: exchangeCodeForSessionMock,
      getUser: vi.fn(),
    },
  }));

  return {
    cookieStore,
    cookiesMock: vi.fn(async () => cookieStore),
    createServerClientMock,
    exchangeCodeForSessionMock,
    signInWithOtpMock,
    signInWithPasswordMock,
    signOutMock,
    signUpMock,
  };
});

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { GET as authCallbackGet } from "@/app/auth/callback/route";
import { POST as magicLinkPost } from "@/app/api/auth/magic-link/route";
import { POST as signInPost } from "@/app/api/auth/sign-in/route";
import { POST as signOutPost } from "@/app/api/auth/sign-out/route";
import { POST as signUpPost } from "@/app/api/auth/sign-up/route";

describe("auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
    cookiesMock.mockResolvedValue(cookieStore);
    signInWithOtpMock.mockResolvedValue({ error: null });
    signInWithPasswordMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      error: null,
    });
    signOutMock.mockResolvedValue({ error: null });
    signUpMock.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      error: null,
    });
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
  });

  it("rejects sign-up without email or password", async () => {
    const response = await signUpPost(jsonRequest("http://localhost/api/auth/sign-up", {
      email: "",
      password: "",
    }, { method: "POST" }));

    await expectJsonError(response, 400, "Email and password are required.");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("signs up and uses an allowed origin for redirect", async () => {
    const response = await signUpPost(
      jsonRequest(
        "http://localhost/api/auth/sign-up",
        { email: "user@example.com", password: "secret" },
        { method: "POST", headers: { origin: "http://localhost:3000" } },
      ),
    );

    const body = await expectJsonResponse<{ message: string; user: { email: string } }>(response);
    expect(body.message).toContain("confirmation link");
    expect(signUpMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
      options: {
        emailRedirectTo: "http://localhost:3000/auth/callback",
      },
    });
  });

  it("falls back to default origin when Origin header is not in allowlist", async () => {
    const response = await signUpPost(
      jsonRequest(
        "http://localhost/api/auth/sign-up",
        { email: "user@example.com", password: "secret" },
        { method: "POST", headers: { origin: "https://evil.com" } },
      ),
    );

    const body = await expectJsonResponse<{ message: string; user: { email: string } }>(response);
    expect(body.message).toContain("confirmation link");
    expect(signUpMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
      options: {
        emailRedirectTo: "https://limerance.vercel.app/auth/callback",
      },
    });
  });

  it("returns the Supabase sign-up error", async () => {
    signUpMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "email already used" },
    });

    const response = await signUpPost(
      jsonRequest(
        "http://localhost/api/auth/sign-up",
        { email: "user@example.com", password: "secret" },
        { method: "POST" },
      ),
    );

    await expectJsonError(response, 400, "email already used");
  });

  it("rejects sign-in without email or password", async () => {
    const response = await signInPost(
      jsonRequest(
        "http://localhost/api/auth/sign-in",
        { email: "", password: "" },
        { method: "POST" },
      ),
    );

    await expectJsonError(response, 400, "Email and password are required.");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("signs in and returns the user payload", async () => {
    const response = await signInPost(
      jsonRequest(
        "http://localhost/api/auth/sign-in",
        { email: "user@example.com", password: "secret" },
        { method: "POST" },
      ),
    );

    const body = await expectJsonResponse<{ user: { id: string } }>(response);
    expect(body.user.id).toBe("user-1");
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
    });
  });

  it("returns a 401 when Supabase rejects sign-in", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "bad credentials" },
    });

    const response = await signInPost(
      jsonRequest(
        "http://localhost/api/auth/sign-in",
        { email: "user@example.com", password: "wrong" },
        { method: "POST" },
      ),
    );

    await expectJsonError(response, 401, "bad credentials");
  });

  it("signs out successfully", async () => {
    const response = await signOutPost();

    const body = await expectJsonResponse<{ success: boolean }>(response);
    expect(body.success).toBe(true);
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("rejects magic-link requests without an email", async () => {
    const response = await magicLinkPost(
      jsonRequest(
        "http://localhost/api/auth/magic-link",
        { email: "" },
        { method: "POST" },
      ),
    );

    await expectJsonError(response, 400, "Email is required.");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("requests a magic link and falls back to default allowed origin", async () => {
    const response = await magicLinkPost(
      jsonRequest(
        "http://localhost/api/auth/magic-link",
        { email: "user@example.com" },
        { method: "POST" },
      ),
    );

    const body = await expectJsonResponse<{ message: string }>(response);
    expect(body.message).toContain("magic link");
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        emailRedirectTo: "https://limerance.vercel.app/auth/callback",
      },
    });
  });

  it("returns the Supabase magic-link error", async () => {
    signInWithOtpMock.mockResolvedValueOnce({
      error: { message: "send failed" },
    });

    const response = await magicLinkPost(
      jsonRequest(
        "http://localhost/api/auth/magic-link",
        { email: "user@example.com" },
        { method: "POST", headers: { origin: "https://app.example" } },
      ),
    );

    await expectJsonError(response, 400, "send failed");
  });

  it("redirects auth callbacks with a valid code to the requested next path", async () => {
    const response = await authCallbackGet(
      new Request(
        "https://app.example/auth/callback?code=test-code&next=%2Fsettings",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/settings");
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("test-code");
  });

  it("redirects failed auth callbacks back to login with an error", async () => {
    exchangeCodeForSessionMock.mockResolvedValueOnce({
      error: { message: "invalid code" },
    });

    const response = await authCallbackGet(
      new Request("https://app.example/auth/callback?code=bad-code"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example/login?error=auth_callback_error",
    );
  });
});
