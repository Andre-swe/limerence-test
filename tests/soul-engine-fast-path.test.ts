import { beforeEach, describe, expect, it } from "vitest";
import { getProviders } from "@/lib/providers";
import { executeFastMessageTurn } from "@/lib/soul-engine";
import { getPersona, listMessages, resetStoreForTests } from "@/lib/store";
import type { MessageEntry } from "@/lib/types";

describe("fast message turn regressions", () => {
  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await resetStoreForTests();
  });

  it("keeps learning and internal-event scheduling on the fast path", async () => {
    const persona = await getPersona("persona-mom");
    const existingMessages = await listMessages("persona-mom");
    const userMessage: MessageEntry = {
      id: "msg-fast-user-1",
      personaId: "persona-mom",
      role: "user",
      kind: "text",
      channel: "telegram",
      body: "i'm nervous about tomorrow's interview and could use you",
      attachments: [],
      audioStatus: "unavailable",
      createdAt: "2026-03-16T15:00:00.000Z",
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
    };

    const result = await executeFastMessageTurn({
      persona: persona!,
      messages: [...existingMessages, userMessage],
      observations: [],
      feedbackNotes: [],
      perception: {
        kind: "text_message",
        channel: "telegram",
        modality: "text",
        content: userMessage.body,
        createdAt: userMessage.createdAt,
        internal: false,
        causationId: userMessage.id,
        correlationId: userMessage.id,
      },
      latestUserText: userMessage.body,
      reasoning: getProviders().reasoning,
      replyChannel: "telegram",
    });

    expect(result.learningArtifacts.length).toBeGreaterThan(0);
    expect(result.pendingInternalEvents.length).toBeGreaterThan(0);
    expect(result.events.some((event) => event.type === "learning_completed")).toBe(true);
    expect(result.events.some((event) => event.type === "internal_event_scheduled")).toBe(true);
    expect(result.persona.mindState.pendingInternalEvents.length).toBeGreaterThan(0);
  });
});
