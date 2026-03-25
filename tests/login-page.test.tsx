// @vitest-environment jsdom

import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  pushMock,
  refreshMock,
  useRouterMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  useRouterMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: useRouterMock,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/logo-mark", () => ({
  LogoMark: () => <span>Logo</span>,
}));

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRouterMock.mockReturnValue({
      push: pushMock,
      refresh: refreshMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the default sign-in form", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("switches into magic-link mode", () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in with magic link instead" }));

    expect(screen.getByText("We'll send you a magic link")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByRole("button", { name: "Send magic link" })).toBeTruthy();
  });

  it("shows password entry in sign-up mode", () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send sign-up link" })).toBeTruthy();
  });
});
