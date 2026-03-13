import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPersonaLivePrompt, createPersonaLiveSession } from "@/lib/hume-evi";
import {
  createInitialMindState,
  createRelationshipModel,
  inferHeuristicUserState,
} from "@/lib/mind-runtime";
import { getReadyScheduledPerceptions } from "@/lib/soul-kernel";
import { buildSoulHarness, renderSoulHarnessContext } from "@/lib/soul-harness";
import { planConversationSoul, renderMockConversationReply } from "@/lib/soul-runtime";
import {
  addPersonaFeedback,
  appendLiveTranscriptTurn,
  createPersonaFromForm,
  executeQueuedShadowTurn,
  executeSoulInternalEvent,
  getLiveContextUpdate,
  observeLiveVisualPerception,
  processTelegramWebhook,
  runHeartbeat,
  sendPersonaMessage,
} from "@/lib/services";
import { inngest } from "@/lib/inngest";
import {
  getPersona,
  listMessages,
  listPerceptionObservations,
  resetStoreForTests,
} from "@/lib/store";

function withoutReasoningProviders<T>(operation: () => Promise<T>) {
  const previous = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  return operation().finally(() => {
    if (previous.GEMINI_API_KEY === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previous.GEMINI_API_KEY;
    }

    if (previous.OPENAI_API_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    }

    if (previous.ANTHROPIC_API_KEY === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = previous.ANTHROPIC_API_KEY;
    }
  });
}

describe("persona workflows", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await resetStoreForTests();
  });

  it("creates deceased personas in pending review", async () => {
    const formData = new FormData();
    formData.append("name", "Nina");
    formData.append("relationship", "Aunt");
    formData.append("source", "deceased");
    formData.append("description", "Playful and observant.");
    formData.append("attestedRights", "on");
    formData.append("deceasedDisclosureAccepted", "on");
    formData.append("heartbeatIntervalHours", "4");
    formData.append("preferredMode", "mixed");
    formData.append(
      "voiceSamples",
      new File([Buffer.from("sample")], "nina-sample.webm", { type: "audio/webm" }),
    );

    const persona = await createPersonaFromForm(formData);
    expect(persona.status).toBe("pending_review");
    expect(persona.voice.status).toBe("preview_only");
    expect(persona.voice.cloneState).toBe("pending_mockup");
    expect(persona.mindState.workingMemory.summary.length).toBeGreaterThan(0);
  });

  it("uses an existing voice id directly when one is provided", async () => {
    const previousHumeApiKey = process.env.HUME_API_KEY;
    process.env.HUME_API_KEY = "test-hume-key";

    try {
      const formData = new FormData();
      formData.append("name", "Drew");
      formData.append("relationship", "Friend");
      formData.append("source", "living");
      formData.append("description", "Warm, easygoing, and gently teasing.");
      formData.append("attestedRights", "on");
      formData.append("existingVoiceId", "voice-ready-123");

      const persona = await createPersonaFromForm(formData);
      expect(persona.voice.status).toBe("ready");
      expect(persona.voice.voiceId).toBe("voice-ready-123");
      expect(persona.voice.cloneState).toBe("ready");
    } finally {
      if (previousHumeApiKey === undefined) {
        delete process.env.HUME_API_KEY;
      } else {
        process.env.HUME_API_KEY = previousHumeApiKey;
      }
    }
  });

  it("stores feedback and folds it into guidance", async () => {
    const initialMessages = await listMessages("persona-mom");
    const targetMessage = initialMessages.find((message) => message.role === "assistant");
    expect(targetMessage).toBeTruthy();

    await addPersonaFeedback("persona-mom", {
      messageId: targetMessage?.id,
      note: "She never called me honey that often.",
    });

    const persona = await getPersona("persona-mom");
    expect(persona?.dossier.guidance.some((item) => item.includes("never called me honey"))).toBe(
      true,
    );
  });

  it("runs a heartbeat and appends an outbound message", async () => {
    const before = await listMessages("persona-mom");
    const decision = await runHeartbeat("persona-mom");
    const after = await listMessages("persona-mom");

    expect(["TEXT", "VOICE_NOTE", "SILENT"]).toContain(decision.action);
    expect(after.length).toBeGreaterThanOrEqual(before.length);
  });

  it("replays seed history into open loops", async () => {
    const persona = await getPersona("persona-mom");

    expect(persona?.mindState.openLoops[0]?.title).toContain("Interview");
    expect(persona?.mindState.workingMemory.summary).toContain("open loop");
  });

  it("handles telegram binding and avoids duplicate updates", async () => {
    await processTelegramWebhook({
      update_id: 100,
      message: {
        message_id: 1,
        text: "/bind persona-mom",
        chat: {
          id: 4242,
          username: "demo_user",
        },
      },
    });

    const first = await processTelegramWebhook({
      update_id: 101,
      message: {
        message_id: 2,
        text: "I have news.",
        chat: {
          id: 4242,
          username: "demo_user",
        },
      },
    });
    const duplicate = await processTelegramWebhook({
      update_id: 101,
      message: {
        message_id: 2,
        text: "I have news.",
        chat: {
          id: 4242,
          username: "demo_user",
        },
      },
    });

    expect(first.handled).toBe(true);
    expect(duplicate.duplicate).toBe(true);
  });

  it("creates user and assistant messages for a web turn", async () => {
    const result = await sendPersonaMessage("persona-mom", {
      text: "I got the job.",
      channel: "web",
    });

    expect(result.appended).toHaveLength(2);
    expect(result.appended[0].role).toBe("user");
    expect(result.appended[0].userState?.summary.length).toBeGreaterThan(0);
    expect(result.appended[1].role).toBe("assistant");
  });

  it("learns work-hour boundaries from natural language", async () => {
    const result = await sendPersonaMessage("persona-mom", {
      text: "don't text me while I'm at work.",
      channel: "web",
    });

    const persona = await getPersona("persona-mom");
    expect(persona?.heartbeatPolicy.workHoursEnabled).toBe(true);
    expect(persona?.preferenceSignals[0]?.effectSummary).toContain("work hours");
    expect(result.appended[1].body.toLowerCase()).toContain("work");
  });

  it("resolves open loops when the user circles back with an outcome", async () => {
    await sendPersonaMessage("persona-mom", {
      text: "the interview went well and I got the job.",
      channel: "web",
    });

    const persona = await getPersona("persona-mom");
    const interviewLoop = persona?.mindState.openLoops.find((loop) => loop.title.includes("Interview"));

    expect(interviewLoop?.status).toBe("resolved");
  });

  it("keeps heartbeat silent during learned work hours", async () => {
    await sendPersonaMessage("persona-mom", {
      text: "please don't text me while I'm at work.",
      channel: "web",
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T14:00:00.000Z"));

    const decision = await runHeartbeat("persona-mom");
    expect(decision.action).toBe("SILENT");
  });

  it("learns boundaries from live transcripts too", async () => {
    const result = await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "don't text me while I'm at work.",
      eventId: "evt-1",
    });

    const persona = await getPersona("persona-mom");
    const messages = await listMessages("persona-mom");

    expect(persona?.heartbeatPolicy.workHoursEnabled).toBe(true);
    expect(result.contextualUpdate).toContain("boundary");
    expect(messages.at(-1)?.channel).toBe("live");
    expect(result.sessionFrame.readyEvents.length).toBeGreaterThanOrEqual(0);
  });

  it("stores structured user state for live voice turns from prosody hints", async () => {
    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "go ahead.",
      eventId: "evt-prosody-1",
      prosodyScores: {
        determination: 0.45,
        anger: 0.34,
        concentration: 0.15,
      },
    });

    const persona = await getPersona("persona-mom");
    const lastUserState = persona?.mindState.lastUserState;

    expect(lastUserState?.prosodyScores?.determination).toBeCloseTo(0.45);
    expect(lastUserState?.summary.toLowerCase()).toContain("prosody");
    expect(persona?.mindState.recentUserStates.length).toBeGreaterThan(0);
  });

  it("publishes shadow-turn jobs to inngest for live transcripts and visual observations", async () => {
    const previousInngestKey = process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_EVENT_KEY = "test-inngest-key";
    const sendSpy = vi.spyOn(inngest, "send").mockResolvedValue(undefined);

    try {
      await withoutReasoningProviders(async () => {
        await appendLiveTranscriptTurn("persona-mom", {
          role: "user",
          body: "keep this in mind for later.",
          eventId: "evt-inngest-1",
          sessionId: "live-inngest-1",
        });

        await observeLiveVisualPerception("persona-mom", {
          mode: "screen",
          event: "frame",
          sessionId: "live-inngest-1",
          imageFile: new File([Buffer.from("screen-bits")], "screen.jpg", {
            type: "image/jpeg",
          }),
        });
      });

      const events = sendSpy.mock.calls.flatMap(([payload]) =>
        Array.isArray(payload) ? payload : [payload],
      );

      expect(events.filter((event) => event.name === "soul/shadow-turn")).toHaveLength(2);
      expect(events.every((event) => event.data.personaId === "persona-mom")).toBe(true);
      expect(events.every((event) => typeof event.data.jobId === "string")).toBe(true);
    } finally {
      sendSpy.mockRestore();
      if (previousInngestKey === undefined) {
        delete process.env.INNGEST_EVENT_KEY;
      } else {
        process.env.INNGEST_EVENT_KEY = previousInngestKey;
      }
    }
  });

  it("keeps live context polling read-only when inngest execution is enabled", async () => {
    const previousInngestKey = process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_EVENT_KEY = "test-inngest-key";
    const sendSpy = vi.spyOn(inngest, "send").mockResolvedValue(undefined);

    try {
      await withoutReasoningProviders(async () => {
        const result = await appendLiveTranscriptTurn("persona-mom", {
          role: "user",
          body: "remember this without blocking the call.",
          eventId: "evt-inngest-2",
          sessionId: "live-inngest-2",
        });

        const queuedPersona = await getPersona("persona-mom");
        const queuedJob = queuedPersona?.mindState.pendingShadowTurns.find(
          (job) => job.sessionId === "live-inngest-2",
        );

        expect(queuedJob?.status).toBe("pending");

        const context = await getLiveContextUpdate("persona-mom", {
          sessionId: "live-inngest-2",
          afterVersion: result.sessionFrame.contextVersion,
        });
        const afterContextPersona = await getPersona("persona-mom");
        const afterContextJob = afterContextPersona?.mindState.pendingShadowTurns.find(
          (job) => job.id === queuedJob?.id,
        );

        expect(context.pendingJobs).toBeGreaterThan(0);
        expect(afterContextJob?.status).toBe("pending");
      });
    } finally {
      sendSpy.mockRestore();
      if (previousInngestKey === undefined) {
        delete process.env.INNGEST_EVENT_KEY;
      } else {
        process.env.INNGEST_EVENT_KEY = previousInngestKey;
      }
    }
  });

  it("executes queued shadow turns through the shared background executor", async () => {
    await withoutReasoningProviders(async () => {
      const result = await appendLiveTranscriptTurn("persona-mom", {
        role: "user",
        body: "please hold onto this thought.",
        eventId: "evt-shadow-exec-1",
        sessionId: "live-shadow-exec-1",
      });

      const queuedPersona = await getPersona("persona-mom");
      const queuedJob = queuedPersona?.mindState.pendingShadowTurns.find(
        (job) => job.sessionId === "live-shadow-exec-1",
      );

      expect(queuedJob?.status).toBe("pending");

      const execution = await executeQueuedShadowTurn("persona-mom", queuedJob!.id);
      const processedPersona = await getPersona("persona-mom");
      const processedJob = processedPersona?.mindState.pendingShadowTurns.find(
        (job) => job.id === queuedJob?.id,
      );

      expect(execution.handled).toBe(true);
      expect(processedJob?.status).toBe("completed");
      expect(processedPersona?.mindState.contextVersion).toBeGreaterThan(
        result.sessionFrame.contextVersion,
      );
    });
  });

  it("falls back to polling-based shadow execution when inngest is unavailable", async () => {
    const previousInngestKey = process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_EVENT_KEY;

    try {
      await withoutReasoningProviders(async () => {
        const result = await appendLiveTranscriptTurn("persona-mom", {
          role: "user",
          body: "keep going even without background infra.",
          eventId: "evt-poll-fallback-1",
          sessionId: "live-poll-fallback-1",
        });

        const queuedPersona = await getPersona("persona-mom");
        const queuedJob = queuedPersona?.mindState.pendingShadowTurns.find(
          (job) => job.sessionId === "live-poll-fallback-1",
        );

        expect(queuedJob?.status).toBe("pending");

        const context = await getLiveContextUpdate("persona-mom", {
          sessionId: "live-poll-fallback-1",
          afterVersion: result.sessionFrame.contextVersion,
        });
        const processedPersona = await getPersona("persona-mom");
        const processedJob = processedPersona?.mindState.pendingShadowTurns.find(
          (job) => job.id === queuedJob?.id,
        );

        expect(processedJob?.status).toBe("completed");
        expect(context.pendingJobs).toBe(0);
      });
    } finally {
      if (previousInngestKey === undefined) {
        delete process.env.INNGEST_EVENT_KEY;
      } else {
        process.env.INNGEST_EVENT_KEY = previousInngestKey;
      }
    }
  });

  it("queues internal scheduled events for follow-through and reengagement", async () => {
    await sendPersonaMessage("persona-mom", {
      text: "my interview is tomorrow morning and i'm nervous.",
      channel: "web",
    });

    const persona = await getPersona("persona-mom");
    expect(persona?.mindState.scheduledPerceptions.length).toBeGreaterThan(0);
    expect(
      persona?.mindState.scheduledPerceptions.some((event) => event.source === "open_loop"),
    ).toBe(true);
  });

  it("uses scheduled internal events when deciding heartbeats", async () => {
    const persona = await getPersona("persona-mom");
    expect(persona).toBeTruthy();

    const ready = getReadyScheduledPerceptions(persona!.mindState.scheduledPerceptions, new Date());
    expect(ready.length).toBeGreaterThan(0);

    const decision = await runHeartbeat("persona-mom");
    expect(["TEXT", "VOICE_NOTE", "SILENT"]).toContain(decision.action);
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it("executes queued internal events through the shared soul engine", async () => {
    await sendPersonaMessage("persona-mom", {
      text: "my interview is tomorrow morning and i'm nervous.",
      channel: "web",
    });

    const before = await getPersona("persona-mom");
    const eventId = before?.mindState.pendingInternalEvents[0]?.id;

    expect(eventId).toBeTruthy();

    const result = await executeSoulInternalEvent("persona-mom", eventId!);
    const after = await getPersona("persona-mom");

    expect(result.handled).toBe(true);
    expect(
      after?.mindState.pendingInternalEvents.find((event) => event.id === eventId)?.status,
    ).toBe("executed");
    expect(
      after?.mindState.recentEvents.some((event) => event.type === "internal_event_executed"),
    ).toBe(true);
  });

  it("keeps text and live voice on the same soul state", async () => {
    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "i'm nervous about tomorrow.",
      eventId: "evt-mixed-1",
      prosodyScores: {
        anxiety: 0.51,
        concentration: 0.28,
      },
    });

    await sendPersonaMessage("persona-mom", {
      text: "it still feels close.",
      channel: "web",
    });

    const persona = await getPersona("persona-mom");
    expect(persona?.mindState.recentUserStates.length).toBeGreaterThanOrEqual(2);
    expect(persona?.mindState.memoryRegions.episodicMemory.length).toBeGreaterThan(1);
    expect(persona?.mindState.memoryRegions.processMemory.length).toBeGreaterThan(0);
  });

  it("stores user-shared images in messages and derives visual context for the soul", async () => {
    await withoutReasoningProviders(async () => {
      const result = await sendPersonaMessage("persona-mom", {
        text: "what do you think about this?",
        channel: "web",
        images: [
          new File([Buffer.from("image-bits")], "desk.png", {
            type: "image/png",
          }),
        ],
      });

      const persona = await getPersona("persona-mom");
      const observations = await listPerceptionObservations("persona-mom");
      const userMessage = result.appended[0];

      expect(userMessage.attachments.some((attachment) => attachment.type === "image")).toBe(true);
      expect(result.appended[1].replyMode).toBe("text");
      expect(observations.some((observation) => observation.kind === "user_shared_image")).toBe(
        true,
      );
      expect(persona?.mindState.lastUserState?.visualContextSummary?.length).toBeGreaterThan(0);
    });
  });

  it("keeps passive live visual observations out of messages while updating soul context", async () => {
    await withoutReasoningProviders(async () => {
      const beforeMessages = await listMessages("persona-mom");

      const result = await observeLiveVisualPerception("persona-mom", {
        mode: "screen",
        event: "frame",
        sessionId: "live-screen-1",
        imageFile: new File([Buffer.from("screen-bits")], "screen.jpg", {
          type: "image/jpeg",
        }),
      });

      const afterMessages = await listMessages("persona-mom");
      const observations = await listPerceptionObservations("persona-mom");
      const persona = await getPersona("persona-mom");

      expect(afterMessages).toHaveLength(beforeMessages.length);
      expect(result.observation.kind).toBe("screen_observation");
      expect(observations.at(-1)?.sessionId).toBe("live-screen-1");
      expect(result.sessionFrame.contextText.length).toBeGreaterThan(0);
      expect(persona?.mindState.lastUserState?.modality).toBe("multimodal");
    });
  });

  it("builds a live prompt from persona memory and corrections", async () => {
    const persona = await getPersona("persona-mom");
    const messages = await listMessages("persona-mom");

    expect(persona).toBeTruthy();

    const prompt = buildPersonaLivePrompt({
      persona: persona!,
      messages,
      feedbackNotes: ["She would never say that."],
    });

    expect(prompt).toContain("Current process");
    expect(prompt).toContain("Current drive");
    expect(prompt).toContain("OPEN_LOOPS");
    expect(prompt).toContain("CORRECTIONS");
  });

  it("makes visual call context explicit in the live prompt", async () => {
    const persona = await getPersona("persona-mom");
    const messages = await listMessages("persona-mom");

    expect(persona).toBeTruthy();

    const prompt = buildPersonaLivePrompt({
      persona: persona!,
      messages,
      feedbackNotes: [],
      mode: "screen",
    });

    expect(prompt.toLowerCase()).toContain("screen sharing is active");
    expect(prompt.toLowerCase()).toContain("let personality shape the acknowledgement");
    expect(prompt.toLowerCase()).toContain("underlying answer should land as yes");
  });

  it("builds an opensouls-style harness snapshot for a live session", async () => {
    const persona = await getPersona("persona-mom");
    const messages = await listMessages("persona-mom");

    expect(persona).toBeTruthy();

    const snapshot = buildSoulHarness({
      persona: persona!,
      messages,
      feedbackNotes: ["She would never say that."],
      perception: {
        kind: "session_start",
        createdAt: "2026-03-12T12:00:00.000Z",
        internal: true,
      },
    });
    const context = renderSoulHarnessContext(snapshot);

    expect(snapshot.intentions.length).toBeGreaterThan(0);
    expect(snapshot.currentDrive.length).toBeGreaterThan(0);
    expect(context).toContain("CONSTITUTION");
    expect(context).toContain("INTENTIONS");
    expect(context).toContain("OPEN_LOOPS");
    expect(context).toContain("SCHEDULED");
  });

  it("derives measurably different personality frames and replies across constitutions", async () => {
    const basePersona = await getPersona("persona-mom");
    expect(basePersona).toBeTruthy();

    const messageBody =
      "i'm nervous about the interview tomorrow. tell me what to do, and can you stay with me a minute?";
    const userState = inferHeuristicUserState({
      text: messageBody,
      channel: "web",
      createdAt: "2026-03-12T12:00:00.000Z",
    });
    const userMessage = {
      id: "variant-user",
      personaId: "variant",
      role: "user" as const,
      kind: "text" as const,
      channel: "web" as const,
      body: messageBody,
      createdAt: "2026-03-12T12:00:00.000Z",
      audioStatus: "unavailable" as const,
      userState,
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested" as const,
        attempts: 0,
      },
    };

    const variants = [
      {
        name: "Protective mom",
        relationship: "Mother",
        description: "Protective, affectionate, steady, checks in early.",
        personalityConstitution: {
          ...basePersona!.personalityConstitution,
          protectiveness: 0.94,
          warmth: 0.88,
          directness: 0.72,
          playfulness: 0.22,
          humorType: "earnest" as const,
        },
      },
      {
        name: "Teasing brother",
        relationship: "Older brother",
        description: "Dry humor, clipped replies, affectionate under the sarcasm.",
        personalityConstitution: {
          ...basePersona!.personalityConstitution,
          protectiveness: 0.58,
          warmth: 0.54,
          directness: 0.68,
          playfulness: 0.88,
          humorType: "dry" as const,
          speechCadence: "brief" as const,
        },
      },
      {
        name: "Soft ex",
        relationship: "Ex-partner",
        description: "Tender, emotionally open, slow and careful with repair.",
        personalityConstitution: {
          ...basePersona!.personalityConstitution,
          tenderness: 0.94,
          protectiveness: 0.42,
          reserve: 0.18,
          directness: 0.34,
          playfulness: 0.2,
          selfDisclosure: 0.82,
          speechCadence: "flowing" as const,
        },
      },
      {
        name: "Restrained father",
        relationship: "Father",
        description: "Measured, restrained, practical, steady under stress.",
        personalityConstitution: {
          ...basePersona!.personalityConstitution,
          warmth: 0.48,
          reserve: 0.84,
          directness: 0.76,
          tenderness: 0.36,
          playfulness: 0.12,
          protectiveness: 0.76,
          speechCadence: "brief" as const,
        },
      },
      {
        name: "Synthetic companion",
        relationship: "Companion",
        description: "Synthetic but attentive, ritual-heavy, gently lyrical.",
        personalityConstitution: {
          ...basePersona!.personalityConstitution,
          warmth: 0.72,
          protectiveness: 0.32,
          directness: 0.42,
          rituality: 0.9,
          reserve: 0.28,
          tenderness: 0.72,
          playfulness: 0.34,
          speechCadence: "lyrical" as const,
          affectionStyle: "ritual" as const,
        },
      },
    ].map((variant) => {
      const persona = {
        ...basePersona!,
        id: `variant-${variant.name}`,
        name: variant.name,
        relationship: variant.relationship,
        description: variant.description,
        personalityConstitution: variant.personalityConstitution,
        relationshipModel: createRelationshipModel({
          ...basePersona!,
          relationship: variant.relationship,
          description: variant.description,
          personalityConstitution: variant.personalityConstitution,
        }),
      };

      const mindState = createInitialMindState({
        persona,
        messages: [userMessage],
        latestUserState: userState,
      });
      const runtimePersona = { ...persona, mindState };
      const plan = planConversationSoul({
        persona: runtimePersona,
        messages: [userMessage],
        feedbackNotes: [],
        latestUserText: messageBody,
        channel: "web",
      });

      return {
        process: plan.process,
        stylePrompt: plan.stylePrompt,
        reply: renderMockConversationReply(plan, runtimePersona),
      };
    });

    expect(new Set(variants.map((variant) => variant.reply)).size).toBe(5);
    expect(new Set(variants.map((variant) => variant.stylePrompt)).size).toBe(5);
  });

  it("builds a live session from the soul frame instead of ad hoc context", async () => {
    const previousAccessToken = process.env.HUME_ACCESS_TOKEN;
    process.env.HUME_ACCESS_TOKEN = "test-access-token";

    try {
      const persona = await getPersona("persona-mom");
      expect(persona).toBeTruthy();

      const session = await createPersonaLiveSession(persona!);

      expect(session.sessionSettings.context?.text).toBe(session.soulFrame.contextText);
      expect(session.sessionSettings.systemPrompt).toContain("Current process");
      expect(session.soulFrame.readyEvents.length).toBeGreaterThanOrEqual(0);
      expect(session.sessionSettings.metadata).toBeTruthy();
    } finally {
      if (previousAccessToken === undefined) {
        delete process.env.HUME_ACCESS_TOKEN;
      } else {
        process.env.HUME_ACCESS_TOKEN = previousAccessToken;
      }
    }
  });

  it("builds mode-aware live sessions for visual calls", async () => {
    const previousAccessToken = process.env.HUME_ACCESS_TOKEN;
    process.env.HUME_ACCESS_TOKEN = "test-access-token";

    try {
      const persona = await getPersona("persona-mom");
      expect(persona).toBeTruthy();

      const session = await createPersonaLiveSession(persona!, "screen");

      expect(session.mode).toBe("screen");
      expect(session.sessionSettings.metadata?.liveMode).toBe("screen");
      expect(session.sessionSettings.variables?.live_mode).toBe("screen");
      expect(session.sessionSettings.context?.text).toBe(session.soulFrame.contextText);
    } finally {
      if (previousAccessToken === undefined) {
        delete process.env.HUME_ACCESS_TOKEN;
      } else {
        process.env.HUME_ACCESS_TOKEN = previousAccessToken;
      }
    }
  });
});
