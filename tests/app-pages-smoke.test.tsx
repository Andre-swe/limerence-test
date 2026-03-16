import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  getProviderStatusMock,
  getSupabaseStatusMock,
  listPersonasMock,
  withUserStoreMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getProviderStatusMock: vi.fn(),
  getSupabaseStatusMock: vi.fn(),
  listPersonasMock: vi.fn(),
  withUserStoreMock: vi.fn((_userId: string, fn: () => unknown) => fn()),
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

vi.mock("@/components/create-persona-form", () => ({
  CreatePersonaForm: () => <form>CreatePersonaForm</form>,
}));

vi.mock("@/lib/store", () => ({
  listPersonas: listPersonasMock,
}));

vi.mock("@/lib/store-context", () => ({
  withUserStore: withUserStoreMock,
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
    listPersonasMock.mockResolvedValue([
      {
        id: "persona-1",
        name: "Mira",
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

    expect(markup).toContain("Choose someone.");
    expect(markup).toContain("Mira");
    expect(markup).toContain("user@example.com");
    expect(withUserStoreMock).toHaveBeenCalledWith("user-1", expect.any(Function));
  });

  it("renders the create page shell", () => {
    const markup = renderToStaticMarkup(CreatePersonaPage());

    expect(markup).toContain("Add someone gently.");
    expect(markup).toContain("CreatePersonaForm");
  });

  it("renders the settings diagnostics surface", () => {
    const markup = renderToStaticMarkup(SettingsPage());

    expect(markup).toContain("Call-first, quiet on the surface");
    expect(markup).toContain("Reasoning: mock");
    expect(markup).toContain("Runtime table: runtime_store");
  });
});
