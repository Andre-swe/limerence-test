import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  getProviderStatusMock,
  getSupabaseStatusMock,
  listPersonaDirectoryEntriesForUserMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getProviderStatusMock: vi.fn(),
  getSupabaseStatusMock: vi.fn(),
  listPersonaDirectoryEntriesForUserMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() })),
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

vi.mock("@/components/persona-list-card", () => ({
  PersonaListCard: ({ persona }: { persona: { name: string } }) => <article>{persona.name}</article>,
  PersonaListEmpty: () => <div>No personas</div>,
}));

vi.mock("@/components/user-menu", () => ({
  UserMenu: ({ email }: { email: string }) => <span>{email}</span>,
}));

vi.mock("@/components/create-persona-form", () => ({
  CreatePersonaForm: () => <form>CreatePersonaForm</form>,
}));

vi.mock("@/app/settings/settings-client", () => ({
  SettingsClient: ({ user }: { user: { email: string } }) => <div>Settings {user.email}</div>,
}));

vi.mock("@/lib/store", () => ({
  listPersonaDirectoryEntriesForUser: listPersonaDirectoryEntriesForUserMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/providers", () => ({
  getProviderStatus: getProviderStatusMock,
}));

vi.mock("@/lib/supabase", () => ({
  getSupabaseStatus: getSupabaseStatusMock,
}));

import CreatePersonaPage from "@/app/create/page";
import Home from "@/app/page";
import SettingsPage from "@/app/settings/page";

describe("app pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPersonaDirectoryEntriesForUserMock.mockResolvedValue([
      {
        persona: {
          id: "persona-1",
          name: "Mira",
          createdAt: "2026-03-16T12:00:00.000Z",
        },
        lastMessage: null,
        unreadCount: 0,
      },
    ]);
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "user-1",
              email: "user@example.com",
            },
          },
        }),
      },
    });
    getProviderStatusMock.mockReturnValue({
      reasoning: "mock",
      transcription: "mock",
      voice: "mock",
    });
    getSupabaseStatusMock.mockReturnValue({
      urlConfigured: true,
      anonKeyConfigured: true,
      serviceRoleConfigured: false,
      runtimeStoreConfigured: false,
      runtimeStoreTable: "runtime_store",
      storageBucket: "uploads",
    });
  });

  it("renders the home page with the authenticated persona grid", async () => {
    const markup = renderToStaticMarkup(await Home());

    expect(markup).toContain("Your Personas");
    expect(markup).toContain("Mira");
    expect(markup).toContain("user@example.com");
    expect(listPersonaDirectoryEntriesForUserMock).toHaveBeenCalledWith("user-1");
  });

  it("renders the create page shell", () => {
    const markup = renderToStaticMarkup(CreatePersonaPage());

    expect(markup).toContain("Add someone gently.");
    expect(markup).toContain("CreatePersonaForm");
  });

  it("renders the settings page for authenticated users", async () => {
    const markup = renderToStaticMarkup(await SettingsPage());

    expect(markup).toContain("Settings");
    expect(markup).toContain("user@example.com");
  });
});
