import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviders } from "@/lib/providers";
import { getPersona, listMessages, resetStoreForTests } from "@/lib/store";

const originalProviderEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

function mockOpenAIResponses(outputText: string) {
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: outputText,
      }),
    }),
  );
}

describe("provider regressions", () => {
  beforeEach(async () => {
    await resetStoreForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (originalProviderEnv.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalProviderEnv.GEMINI_API_KEY;
    }

    if (originalProviderEnv.ANTHROPIC_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalProviderEnv.ANTHROPIC_API_KEY;
    }

    if (originalProviderEnv.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalProviderEnv.OPENAI_API_KEY;
    }
  });

  it("falls back when provider dossier JSON fails schema validation", async () => {
    mockOpenAIResponses(JSON.stringify({ essence: "Only essence present" }));

    const dossier = await getProviders().reasoning.buildPersonaDossier({
      name: "Mom",
      relationship: "Mother",
      source: "living",
      description: "Warm and protective.",
      pastedText: "Call me when you get home, honey.",
      interviewAnswers: {
        favorite: "Always asked about meals and sleep.",
      },
      screenshotSummaries: [],
    });

    expect(dossier.communicationStyle).toBeTruthy();
    expect(dossier.favoriteTopics.length).toBeGreaterThan(0);
    expect(dossier.knowledgeProfile.domains.length).toBeGreaterThan(0);
  });

  it("adds sourcePerceptionId to provider learning artifacts", async () => {
    mockOpenAIResponses(
      JSON.stringify([
        {
          kind: "learn_about_user",
          summary: "User is carrying stress about tomorrow.",
          memoryKeys: ["user.notes"],
        },
      ]),
    );

    const persona = await getPersona("persona-mom");
    const messages = await listMessages("persona-mom");
    const perception = {
      id: "perc-provider-1",
      kind: "text_message" as const,
      channel: "web" as const,
      modality: "text" as const,
      content: "i'm stressed about tomorrow",
      createdAt: "2026-03-16T15:00:00.000Z",
      internal: false,
      causationId: "msg-provider-1",
      correlationId: "msg-provider-1",
    };

    const artifacts = await getProviders().reasoning.extractLearningArtifacts({
      persona: persona!,
      messages,
      process: persona!.mindState.activeProcess,
      perception,
      feedbackNotes: [],
      replyText: "We'll get through tomorrow together.",
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].summary).toBe("User is carrying stress about tomorrow.");
    expect(artifacts[0].sourcePerceptionId).toBe(perception.id);
  });
});
