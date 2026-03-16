import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  getPersonaForUserMock,
  listMessagesMock,
  notFoundMock,
  withUserStoreMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getPersonaForUserMock: vi.fn(),
  listMessagesMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("notFound");
  }),
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

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

vi.mock("@/components/logo-mark", () => ({
  LogoMark: () => <span>Logo</span>,
}));

vi.mock("@/components/conversation-panel", () => ({
  ConversationPanel: ({ personaName }: { personaName: string }) => (
    <section>Conversation:{personaName}</section>
  ),
}));

vi.mock("@/components/messages-panel", () => ({
  MessagesPanel: ({
    initialMessages,
    personaName,
  }: {
    initialMessages: Array<{ id: string }>;
    personaName: string;
  }) => <section>Messages:{personaName}:{initialMessages.length}</section>,
}));

vi.mock("@/components/debug-panel", () => ({
  DebugPanel: ({ personaId }: { personaId: string }) => <aside>Debug:{personaId}</aside>,
}));

vi.mock("@/lib/supabase-server", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/store", () => ({
  getPersonaForUser: getPersonaForUserMock,
  listMessages: listMessagesMock,
}));

vi.mock("@/lib/store-context", () => ({
  withUserStore: withUserStoreMock,
}));

import PersonaDetailPage from "@/app/personas/[personaId]/page";
import PersonaMessagesPage from "@/app/personas/[personaId]/messages/page";

describe("persona pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    getPersonaForUserMock.mockResolvedValue({
      id: "persona-test",
      name: "Mira",
      status: "active",
    });
    listMessagesMock.mockResolvedValue([
      { id: "msg-1" },
      { id: "msg-2" },
    ]);
  });

  it("loads the detail page through the authenticated owner's persona lookup", async () => {
    const markup = renderToStaticMarkup(
      await PersonaDetailPage({
        params: Promise.resolve({ personaId: "persona-test" }),
      }),
    );

    expect(getPersonaForUserMock).toHaveBeenCalledWith("user-1", "persona-test");
    expect(markup).toContain("Conversation:Mira");
    expect(markup).toContain("Debug:persona-test");
  });

  it("returns notFound when the detail page has no authenticated user", async () => {
    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: null,
          },
        }),
      },
    });

    await expect(
      PersonaDetailPage({
        params: Promise.resolve({ personaId: "persona-test" }),
      }),
    ).rejects.toThrow("notFound");
  });

  it("loads persona messages inside the authenticated user's store context", async () => {
    const markup = renderToStaticMarkup(
      await PersonaMessagesPage({
        params: Promise.resolve({ personaId: "persona-test" }),
      }),
    );

    expect(getPersonaForUserMock).toHaveBeenCalledWith("user-1", "persona-test");
    expect(withUserStoreMock).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(listMessagesMock).toHaveBeenCalledWith("persona-test");
    expect(markup).toContain("Messages:Mira:2");
  });
});
