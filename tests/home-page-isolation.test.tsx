import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPersona, resetStoreForTests, savePersona } from "@/lib/store";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
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

vi.mock("@/components/persona-card", () => ({
  PersonaCard: ({ persona }: { persona: { name: string } }) => <article>{persona.name}</article>,
}));

vi.mock("@/components/user-menu", () => ({
  UserMenu: ({ email }: { email: string }) => <span>{email}</span>,
}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: createClientMock,
}));

import Home from "@/app/page";

describe("home page isolation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetStoreForTests();

    const sourcePersona = await getPersona("persona-mom");
    if (!sourcePersona) {
      throw new Error("Seed persona missing");
    }

    await savePersona({
      ...JSON.parse(JSON.stringify(sourcePersona)),
      id: "persona-other",
      name: "Other User Persona",
      userId: "user-other",
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });

    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-demo",
              email: "demo@example.com",
            },
          },
        }),
      },
    });
  });

  it("renders only personas owned by the authenticated user in local-file mode", async () => {
    const markup = renderToStaticMarkup(await Home());

    expect(markup).toContain("Mom");
    expect(markup).toContain("Alex Rivera");
    expect(markup).not.toContain("Other User Persona");
  });
});
