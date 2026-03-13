import { writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSoulTraceRoute } from "@/app/api/personas/[personaId]/soul/trace/route";
import { buildPersonaLivePrompt, createPersonaLiveSession } from "@/lib/hume-evi";
import {
  createInitialMindState,
  createRelationshipModel,
  inferHeuristicUserState,
} from "@/lib/mind-runtime";
import { getReadyScheduledPerceptions } from "@/lib/soul-kernel";
import { buildSoulHarness, buildStableSystemPrompt, renderLiveContextOverlay, renderSoulHarnessContext } from "@/lib/soul-harness";
import { planConversationSoul, renderMockConversationReply } from "@/lib/soul-runtime";
import {
  addPersonaFeedback,
  appendLiveTranscriptTurn,
  compareVisualObservation,
  computeProsodyValence,
  createPersonaFromForm,
  detectMeaningfulTransition,
  executeQueuedShadowTurn,
  executeSoulInternalEvent,
  finalizeLiveSession,
  getLiveContextUpdate,
  observeLiveVisualPerception,
  processTelegramWebhook,
  reduceLiveUserState,
  resetServiceRuntimeStateForTests,
  runHeartbeat,
  sendPersonaMessage,
} from "@/lib/services";
import { inngest } from "@/lib/inngest";
import {
  getPersona,
  listMessages,
  listPerceptionObservations,
  resetStoreForTests,
  updatePersona,
} from "@/lib/store";
import type { MemoryClaim } from "@/lib/types";

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
    await resetServiceRuntimeStateForTests();
    await resetStoreForTests();
  });

  it("creates personas as active without a review gate", async () => {
    const formData = new FormData();
    formData.append("name", "Nina");
    formData.append("relationship", "Aunt");
    formData.append("description", "Playful and observant.");
    formData.append("attestedRights", "on");
    formData.append("heartbeatIntervalHours", "4");
    formData.append("preferredMode", "mixed");
    formData.append(
      "voiceSamples",
      new File([Buffer.from("sample")], "nina-sample.webm", { type: "audio/webm" }),
    );

    const persona = await createPersonaFromForm(formData);
    expect(persona.status).toBe("active");
    expect(persona.voice.status).toBe("preview_only");
    expect(persona.voice.cloneState).toBe("pending_mockup");
    expect(persona.mindState.workingMemory.summary.length).toBeGreaterThan(0);
  });

  it("hydrates legacy deceased pending-review personas into active neutral personas", async () => {
    const rawStorePath = path.join(process.cwd(), "data", "demo-store.json");
    await writeFile(
      rawStorePath,
      JSON.stringify({
        users: [{ id: "user-demo", name: "Demo Workspace", createdAt: new Date().toISOString() }],
        personas: [
          {
            id: "persona-legacy",
            userId: "user-demo",
            name: "Legacy Persona",
            relationship: "Parent",
            source: "deceased",
            description: "Warm and protective.",
            status: "pending_review",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pastedText: "",
            screenshotSummaries: [],
            interviewAnswers: {},
            heartbeatPolicy: {
              enabled: true,
              intervalHours: 4,
              maxOutboundPerDay: 3,
              quietHoursStart: 22,
              quietHoursEnd: 8,
              preferredMode: "mixed",
              workHoursEnabled: false,
              workHoursStart: 9,
              workHoursEnd: 17,
              workDays: [1, 2, 3, 4, 5],
              boundaryNotes: [],
            },
            voice: {
              provider: "mock",
              status: "preview_only",
              cloneState: "none",
              watermarkApplied: false,
            },
            consent: {
              attestedRights: true,
              deceasedDisclosureAccepted: true,
              manualReviewRequired: true,
              approvedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
            dossier: {
              essence: "Warm and protective.",
              communicationStyle: "Gentle and calm.",
              signaturePhrases: [],
              favoriteTopics: [],
              emotionalTendencies: [],
              routines: [],
              guidance: [],
              sourceSummary: "Legacy source summary.",
            },
            voiceSamples: [],
            screenshots: [],
            preferenceSignals: [],
          },
        ],
        messages: [],
        perceptionObservations: [],
        feedbackEvents: [],
        processedTelegramUpdates: [],
      }),
      "utf8",
    );

    const persona = await getPersona("persona-legacy");
    expect(persona?.source).toBe("living");
    expect(persona?.status).toBe("active");
    expect(persona?.consent).toEqual({
      attestedRights: true,
      createdAt: expect.any(String),
    });
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

  it("turns explicit boundary statements into confirmed durable claims immediately", async () => {
    await withoutReasoningProviders(async () => {
      await sendPersonaMessage("persona-mom", {
        text: "please don't text me while i'm at work.",
        channel: "web",
      });

      const persona = await getPersona("persona-mom");
      const boundaryClaim = persona?.mindState.memoryClaims.find(
        (claim) => claim.kind === "boundary",
      );

      expect(boundaryClaim).toBeTruthy();
      expect(boundaryClaim?.status).toBe("confirmed");
      expect(boundaryClaim?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(
        persona?.mindState.recentChangedClaims.some((claim) => claim.id === boundaryClaim?.id),
      ).toBe(true);
      expect(
        persona?.mindState.lastRetrievalPack?.alwaysLoadedClaims.some(
          (claim) => claim.id === boundaryClaim?.id,
        ),
      ).toBe(true);
    });
  });

  it("marks contradicted memories and writes repair notes from feedback", async () => {
    const messages = await listMessages("persona-mom");
    const targetMessage = messages.find((message) => message.role === "assistant");
    expect(targetMessage).toBeTruthy();

    const now = new Date().toISOString();
    const seededClaim: MemoryClaim = {
      id: "claim-honey",
      kind: "relationship_note",
      summary: "She called you honey often.",
      detail: "The relationship often used honey as a pet name.",
      scope: "relationship",
      status: "confirmed",
      confidence: 0.88,
      importance: 0.72,
      sourceIds: [targetMessage!.id],
      reinforcementCount: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      lastConfirmedAt: now,
      lastUsedAt: undefined,
      expiresAt: undefined,
      tags: ["honey", "pet_name"],
    };

    await updatePersona("persona-mom", (current) => ({
      ...current,
      mindState: {
        ...current.mindState,
        memoryClaims: [seededClaim, ...current.mindState.memoryClaims],
      },
    }));

    await addPersonaFeedback("persona-mom", {
      messageId: targetMessage?.id,
      note: "She never called me honey that often.",
    });

    const persona = await getPersona("persona-mom");
    const contradictedClaim = persona?.mindState.memoryClaims.find(
      (claim) => claim.id === seededClaim.id,
    );
    const repairClaim = persona?.mindState.memoryClaims.find(
      (claim) => claim.kind === "repair_note" && claim.summary.toLowerCase().includes("honey"),
    );

    expect(contradictedClaim?.status).toBe("contradicted");
    expect(contradictedClaim?.confidence).toBeLessThan(0.5);
    expect(repairClaim?.status).toBe("confirmed");
    expect(
      persona?.mindState.recentChangedClaims.some((claim) => claim.id === repairClaim?.id),
    ).toBe(true);
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

  it("shapes mock fallback replies with dossier phrases and communication style", async () => {
    const momMessages = await listMessages("persona-mom");
    const alexMessages = await listMessages("persona-alex");

    const momPlan = planConversationSoul({
      persona: (await getPersona("persona-mom"))!,
      messages: momMessages,
      feedbackNotes: [],
      latestUserText: "I'm nervous.",
      channel: "web",
    });
    const alexPlan = planConversationSoul({
      persona: (await getPersona("persona-alex"))!,
      messages: alexMessages,
      feedbackNotes: [],
      latestUserText: "I'm nervous.",
      channel: "web",
    });

    const momReply = renderMockConversationReply(momPlan, (await getPersona("persona-mom"))!);
    const alexReply = renderMockConversationReply(alexPlan, (await getPersona("persona-alex"))!);

    expect(momReply.toLowerCase()).toMatch(/sweetie|honey|love you/);
    expect(alexReply).toBe(alexReply.toLowerCase());
    expect(alexReply.toLowerCase()).toMatch(/lmao|you got this|don't overthink it/);
  });

  it("queues assistant reflection as a shadow turn instead of blocking the web reply", async () => {
    const previousInngestKey = process.env.INNGEST_EVENT_KEY;
    process.env.INNGEST_EVENT_KEY = "test-inngest-key";
    const sendSpy = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["mock-id"] });

    try {
      await withoutReasoningProviders(async () => {
        const result = await sendPersonaMessage("persona-mom", {
          text: "hello there",
          channel: "web",
        });

        const persona = await getPersona("persona-mom");
        const assistantShadowTurn = persona?.mindState.pendingShadowTurns.find(
          (job) =>
            job.perception.kind === "assistant_message" &&
            job.perception.metadata?.messageId === result.appended[1].id,
        );

        expect(assistantShadowTurn?.status).toBe("pending");

        const events = sendSpy.mock.calls.flatMap(([payload]) =>
          Array.isArray(payload) ? payload : [payload],
        );

        expect(events.some((event) => event.name === "soul/shadow-turn")).toBe(true);
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
    expect(result.sessionFrame?.readyEvents.length ?? 0).toBeGreaterThanOrEqual(0);
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
    const sendSpy = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["mock-id"] });

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
    const sendSpy = vi.spyOn(inngest, "send").mockResolvedValue({ ids: ["mock-id"] });

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
          afterVersion: result.sessionFrame?.liveDeliveryVersion ?? 0,
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

  it("coalesces clustered non-critical live deliveries and counts them once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T15:00:00.000Z"));

    const before = await getPersona("persona-mom");
    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      mindState: {
        ...persona.mindState,
        liveDeliveryVersion: before!.mindState.liveDeliveryVersion + 1,
        lastLiveDeliveryReason: "periodic_sync",
        lastLiveDeliverySentAt: "2026-03-13T15:00:00.000Z",
        processState: {
          ...persona.mindState.processState,
          live_delivery_metric_reason: "periodic_sync",
        },
        liveSessionMetrics: {
          ...persona.mindState.liveSessionMetrics,
          "coalesce-1": {
            sessionId: "coalesce-1",
            mode: "voice",
            startedAt: "2026-03-13T14:59:00.000Z",
            deliveryRequestedCount: 1,
            deliveryRequestedReasons: { periodic_sync: 1 },
            deliveriesSent: 1,
            sentReasons: { periodic_sync: 1 },
            coalescedCount: 0,
            coalescedReasons: {},
            pollNoDeliveryCount: 0,
            totalDeliveryIntervalMs: 0,
            deliveryIntervalCount: 0,
            averageDeliveryIntervalMs: 0,
            lastDeliveredAt: "2026-03-13T15:00:00.000Z",
            shadowTurnsEnqueued: 1,
            shadowTurnsSkipped: 0,
            periodicSyncEnqueues: 1,
          },
        },
      },
    }));

    vi.setSystemTime(new Date("2026-03-13T15:00:01.000Z"));
    const first = await getLiveContextUpdate("persona-mom", {
      sessionId: "coalesce-1",
      afterVersion: before!.mindState.liveDeliveryVersion,
    });
    expect(first.sessionFrame).toBeUndefined();

    vi.setSystemTime(new Date("2026-03-13T15:00:02.000Z"));
    const second = await getLiveContextUpdate("persona-mom", {
      sessionId: "coalesce-1",
      afterVersion: before!.mindState.liveDeliveryVersion,
    });
    expect(second.sessionFrame).toBeUndefined();

    const persona = await getPersona("persona-mom");
    const metrics = persona?.mindState.liveSessionMetrics["coalesce-1"];
    expect(metrics?.coalescedCount).toBe(1);
    expect(metrics?.coalescedReasons.periodic_sync).toBe(1);
  });

  it("bypasses coalescing for critical live delivery reasons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T16:00:00.000Z"));

    const before = await getPersona("persona-mom");
    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      mindState: {
        ...persona.mindState,
        liveDeliveryVersion: before!.mindState.liveDeliveryVersion + 1,
        lastLiveDeliveryReason: "boundary memory changed",
        lastLiveDeliverySentAt: "2026-03-13T16:00:00.000Z",
        processState: {
          ...persona.mindState.processState,
          live_delivery_metric_reason: "boundary memory changed",
        },
        liveSessionMetrics: {
          ...persona.mindState.liveSessionMetrics,
          "critical-1": {
            sessionId: "critical-1",
            mode: "voice",
            startedAt: "2026-03-13T15:59:00.000Z",
            deliveryRequestedCount: 1,
            deliveryRequestedReasons: { "boundary memory changed": 1 },
            deliveriesSent: 0,
            sentReasons: {},
            coalescedCount: 0,
            coalescedReasons: {},
            pollNoDeliveryCount: 0,
            totalDeliveryIntervalMs: 0,
            deliveryIntervalCount: 0,
            averageDeliveryIntervalMs: 0,
            lastDeliveredAt: "2026-03-13T16:00:00.000Z",
            shadowTurnsEnqueued: 1,
            shadowTurnsSkipped: 0,
            periodicSyncEnqueues: 0,
          },
        },
      },
    }));

    vi.setSystemTime(new Date("2026-03-13T16:00:01.000Z"));
    const context = await getLiveContextUpdate("persona-mom", {
      sessionId: "critical-1",
      afterVersion: before!.mindState.liveDeliveryVersion,
    });

    expect(context.sessionFrame?.deliveryReason).toBe("boundary memory changed");

    const persona = await getPersona("persona-mom");
    const metrics = persona?.mindState.liveSessionMetrics["critical-1"];
    expect(metrics?.deliveriesSent).toBe(1);
    expect(metrics?.sentReasons["boundary memory changed"]).toBe(1);
    expect(metrics?.coalescedCount).toBe(0);
  });

  it("updates delivery interval metrics only when a live frame is actually sent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T17:00:00.000Z"));

    const before = await getPersona("persona-mom");
    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      mindState: {
        ...persona.mindState,
        liveDeliveryVersion: before!.mindState.liveDeliveryVersion + 1,
        lastLiveDeliveryReason: "ready internal events changed",
        lastLiveDeliverySentAt: "2026-03-13T16:59:55.000Z",
        processState: {
          ...persona.mindState.processState,
          live_delivery_metric_reason: "ready internal events changed",
        },
        liveSessionMetrics: {
          ...persona.mindState.liveSessionMetrics,
          "interval-1": {
            sessionId: "interval-1",
            mode: "voice",
            startedAt: "2026-03-13T16:58:00.000Z",
            deliveryRequestedCount: 1,
            deliveryRequestedReasons: { "ready internal events changed": 1 },
            deliveriesSent: 0,
            sentReasons: {},
            coalescedCount: 0,
            coalescedReasons: {},
            pollNoDeliveryCount: 0,
            totalDeliveryIntervalMs: 0,
            deliveryIntervalCount: 0,
            averageDeliveryIntervalMs: 0,
            lastDeliveredAt: "2026-03-13T16:59:55.000Z",
            shadowTurnsEnqueued: 1,
            shadowTurnsSkipped: 0,
            periodicSyncEnqueues: 0,
          },
        },
      },
    }));

    vi.setSystemTime(new Date("2026-03-13T17:00:00.000Z"));
    const context = await getLiveContextUpdate("persona-mom", {
      sessionId: "interval-1",
      afterVersion: before!.mindState.liveDeliveryVersion,
    });
    expect(context.sessionFrame?.deliveryReason).toBe("ready internal events changed");

    const persona = await getPersona("persona-mom");
    const metrics = persona?.mindState.liveSessionMetrics["interval-1"];
    expect(metrics?.deliveriesSent).toBe(1);
    expect(metrics?.deliveryIntervalCount).toBe(1);
    expect(metrics?.averageDeliveryIntervalMs).toBe(5000);
  });

  it("executes queued shadow turns through the shared background executor", async () => {
    await withoutReasoningProviders(async () => {
      await appendLiveTranscriptTurn("persona-mom", {
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
        queuedPersona!.mindState.contextVersion,
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
          afterVersion: result.sessionFrame?.liveDeliveryVersion ?? 0,
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

  it("does not ship a live context update for every ordinary live turn", async () => {
    await withoutReasoningProviders(async () => {
      // First live turn will be enqueued (first in session) — drain its
      // shadow processing before testing the ordinary-turn contract.
      await appendLiveTranscriptTurn("persona-mom", {
        role: "user",
        body: "hello.",
        eventId: "evt-ordinary-live-0",
        sessionId: "live-ordinary-1",
      });

      // Process first turn's shadow through polling so the baseline is stable
      await getLiveContextUpdate("persona-mom", {
        sessionId: "live-ordinary-1",
        afterVersion: 0,
      });

      // Second ordinary turn should be deferred — no shadow turn enqueued, no
      // session frame returned. The turn is persisted and will be consolidated
      // at the end of the call.
      const result = await appendLiveTranscriptTurn("persona-mom", {
        role: "user",
        body: "go ahead.",
        eventId: "evt-ordinary-live-1",
        sessionId: "live-ordinary-1",
      });

      expect(result.sessionFrame).toBeUndefined();

      const queuedPersona = await getPersona("persona-mom");
      const queuedJob = queuedPersona?.mindState.pendingShadowTurns.find(
        (job) => job.sessionId === "live-ordinary-1" && job.perception.causationId === result.message.id,
      );

      // Routine turns are deferred to post-call consolidation — no shadow turn
      expect(queuedJob).toBeUndefined();

      // Context polling should not return a delivery since no new shadow was enqueued
      const context = await getLiveContextUpdate("persona-mom", {
        sessionId: "live-ordinary-1",
        afterVersion: queuedPersona!.mindState.liveDeliveryVersion,
      });
      expect(context.sessionFrame).toBeUndefined();
    });
  });

  it("skips shadow turns for live assistant transcript turns", async () => {
    await withoutReasoningProviders(async () => {
      const before = await getPersona("persona-mom");
      const beforeShadowCount = before!.mindState.pendingShadowTurns.length;

      await appendLiveTranscriptTurn("persona-mom", {
        role: "assistant",
        body: "hey sweetie, how are you?",
        eventId: "evt-assistant-live-1",
        sessionId: "live-assistant-1",
      });

      const after = await getPersona("persona-mom");
      // Assistant turns should NOT enqueue shadow turns — Hume drives those
      expect(after!.mindState.pendingShadowTurns.length).toBe(beforeShadowCount);

      // But the message should still be persisted
      const messages = await listMessages("persona-mom");
      expect(messages.some((m) => m.body === "hey sweetie, how are you?")).toBe(true);
    });
  });

  it("ships a live context update immediately when a live boundary is set", async () => {
    await withoutReasoningProviders(async () => {
      const before = await getPersona("persona-mom");
      const result = await appendLiveTranscriptTurn("persona-mom", {
        role: "user",
        body: "don't text me while i'm at work.",
        eventId: "evt-live-boundary-1",
        sessionId: "live-boundary-1",
      });

      expect(result.sessionFrame?.liveDeliveryVersion).toBeGreaterThan(
        before!.mindState.liveDeliveryVersion,
      );
      expect(result.sessionFrame?.deliveryReason?.toLowerCase()).toContain("boundary");
    });
  });

  it("queues a post-call consolidation turn when the live session ends", async () => {
    await withoutReasoningProviders(async () => {
      // Seed a few live turns so consolidation has session evidence
      await appendLiveTranscriptTurn("persona-mom", {
        role: "user",
        body: "hey mom, just checking in.",
        eventId: "evt-consolidation-1",
        sessionId: "live-ended-1",
      });
      await appendLiveTranscriptTurn("persona-mom", {
        role: "assistant",
        body: "sweetie! so good to hear from you.",
        eventId: "evt-consolidation-2",
        sessionId: "live-ended-1",
      });

      const result = await finalizeLiveSession("persona-mom", {
        sessionId: "live-ended-1",
        mode: "voice",
        reason: "user_end",
      });

      expect(result.queued).toBe(true);

      const persona = await getPersona("persona-mom");
      const queuedJob = persona?.mindState.pendingShadowTurns.find((job) => job.id === result.jobId);

      expect(queuedJob?.perception.kind).toBe("memory_consolidation");
      expect(queuedJob?.sessionId).toBe("live-ended-1");
      expect(queuedJob?.status).toBe("pending");
      // Consolidation perception should include rich session evidence
      expect(queuedJob?.perception.content).toContain("Session Summary");
      expect(queuedJob?.perception.content).toContain("Consolidation Directives");
      expect(queuedJob?.perception.content).toContain("Episodic memory");
      expect(queuedJob?.perception.content).toContain("Learned user notes");
      expect(queuedJob?.perception.content).toContain("Open loops");
      expect(queuedJob?.perception.metadata?.sessionTurnCount).toBeGreaterThan(0);
      expect(queuedJob?.perception.metadata?.repairWarning).toBeDefined();
    });
  });

  it("finalizes and bounds live session metrics, and exposes them through the trace route", async () => {
    const completedMetrics = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `completed-${index}`,
        {
          sessionId: `completed-${index}`,
          mode: "voice" as const,
          startedAt: `2026-03-12T0${index}:00:00.000Z`,
          endedAt: `2026-03-12T1${index}:00:00.000Z`,
          deliveryRequestedCount: 1,
          deliveryRequestedReasons: { periodic_sync: 1 },
          deliveriesSent: 1,
          sentReasons: { periodic_sync: 1 },
          coalescedCount: 0,
          coalescedReasons: {},
          pollNoDeliveryCount: 0,
          totalDeliveryIntervalMs: 0,
          deliveryIntervalCount: 0,
          averageDeliveryIntervalMs: 0,
          lastDeliveredAt: `2026-03-12T1${index}:00:00.000Z`,
          shadowTurnsEnqueued: 1,
          shadowTurnsSkipped: 0,
          periodicSyncEnqueues: 1,
        },
      ]),
    );

    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      mindState: {
        ...persona.mindState,
        liveSessionMetrics: {
          ...completedMetrics,
          "active-kept": {
            sessionId: "active-kept",
            mode: "voice",
            startedAt: "2026-03-13T18:00:00.000Z",
            deliveryRequestedCount: 0,
            deliveryRequestedReasons: {},
            deliveriesSent: 0,
            sentReasons: {},
            coalescedCount: 0,
            coalescedReasons: {},
            pollNoDeliveryCount: 0,
            totalDeliveryIntervalMs: 0,
            deliveryIntervalCount: 0,
            averageDeliveryIntervalMs: 0,
            shadowTurnsEnqueued: 0,
            shadowTurnsSkipped: 0,
            periodicSyncEnqueues: 0,
          },
        },
      },
    }));

    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "call ended with one last thing.",
      eventId: "evt-metrics-finalize-1",
      sessionId: "metrics-session-1",
    });

    await finalizeLiveSession("persona-mom", {
      sessionId: "metrics-session-1",
      mode: "voice",
      reason: "user_end",
    });

    const after = await getPersona("persona-mom");
    const metrics = after?.mindState.liveSessionMetrics ?? {};
    const completedCount = Object.values(metrics).filter((entry) => entry.endedAt).length;

    expect(metrics["metrics-session-1"]?.endedAt).toBeTruthy();
    expect(metrics["active-kept"]).toBeTruthy();
    expect(completedCount).toBeLessThanOrEqual(8);

    const response = await getSoulTraceRoute(new Request("http://localhost"), {
      params: Promise.resolve({ personaId: "persona-mom" }),
    });
    const body = await response.json();

    expect(body.liveSessionMetrics["active-kept"]).toBeTruthy();
    expect(body.liveSessionMetrics["metrics-session-1"]?.endedAt).toBeTruthy();
  });

  it("exposes memory claims, provenance, and retrieval packs in the trace route", async () => {
    await withoutReasoningProviders(async () => {
      await sendPersonaMessage("persona-mom", {
        text: "please don't text me while i'm at work.",
        channel: "web",
      });

      const response = await getSoulTraceRoute(new Request("http://localhost"), {
        params: Promise.resolve({ personaId: "persona-mom" }),
      });
      const body = await response.json();

      expect(body.memoryClaims.some((claim: MemoryClaim) => claim.kind === "boundary")).toBe(true);
      expect(body.claimSources.length).toBeGreaterThan(0);
      expect(body.lastRetrievalPack.summary.length).toBeGreaterThan(0);
      expect(
        body.lastRetrievalPack.alwaysLoadedClaims.some(
          (claim: MemoryClaim) => claim.kind === "boundary",
        ),
      ).toBe(true);
    });
  });

  it("detects meaningful transitions using smoothed deltas instead of raw thresholds", () => {
    const base: Parameters<typeof detectMeaningfulTransition>[0] = {
      id: "state-1",
      modality: "live_voice",
      topSignals: [],
      valence: 0.5,
      arousal: 0.5,
      activation: 0.5,
      certainty: 0.5,
      vulnerability: 0.5,
      desireForCloseness: 0.5,
      desireForSpace: 0.5,
      repairRisk: 0.3,
      boundaryPressure: 0.3,
      taskFocus: 0.5,
      griefLoad: 0.3,
      playfulness: 0.5,
      frustration: 0.3,
      environmentPressure: 0.5,
      situationalSignals: [],
      summary: "calm",
      confidence: 0.7,
      provenance: ["heuristic"],
      createdAt: new Date().toISOString(),
    };

    // Small jitter should NOT trigger in normal process
    const jitter = { ...base, id: "state-2", frustration: 0.35 };
    expect(detectMeaningfulTransition(base, jitter).meaningful).toBe(false);

    // Large RISING frustration SHOULD trigger (alarmDirection = "rising")
    const spike = { ...base, id: "state-3", frustration: 0.7 };
    const result = detectMeaningfulTransition(base, spike);
    expect(result.meaningful).toBe(true);
    expect(result.reason).toContain("frustration");

    // No previous state always triggers
    expect(detectMeaningfulTransition(undefined, base).meaningful).toBe(true);

    // Process-sensitivity: during "repair", lower thresholds catch subtler shifts
    const subtleShift = { ...base, id: "state-4", repairRisk: 0.48 };
    // Normal process: delta = 0.35*(0.48-0.3) = 0.063, threshold 0.10 → NOT triggered
    expect(detectMeaningfulTransition(base, subtleShift, "attunement").meaningful).toBe(false);
    // Repair process: sensitiveThreshold 0.06 → triggered
    expect(detectMeaningfulTransition(base, subtleShift, "repair").meaningful).toBe(true);
  });

  it("filters transition direction — dropping frustration does not trigger alarm", () => {
    const elevated: Parameters<typeof detectMeaningfulTransition>[0] = {
      id: "state-high",
      modality: "live_voice",
      topSignals: [],
      valence: 0.5,
      arousal: 0.5,
      activation: 0.5,
      certainty: 0.5,
      vulnerability: 0.5,
      desireForCloseness: 0.5,
      desireForSpace: 0.5,
      repairRisk: 0.7,
      boundaryPressure: 0.3,
      taskFocus: 0.5,
      griefLoad: 0.3,
      playfulness: 0.5,
      frustration: 0.7,
      environmentPressure: 0.5,
      situationalSignals: [],
      summary: "frustrated",
      confidence: 0.7,
      provenance: ["heuristic"],
      createdAt: new Date().toISOString(),
    };

    // User calming down: frustration 0.7 → 0.3 is a LARGE delta but FALLING
    // frustration has alarmDirection="rising", so this should NOT trigger
    const calming = { ...elevated, id: "state-calm", frustration: 0.3, repairRisk: 0.3 };
    const result = detectMeaningfulTransition(elevated, calming);
    expect(result.meaningful).toBe(false);

    // Valence has alarmDirection="falling" — rising valence should NOT trigger
    const brightening = { ...elevated, id: "state-bright", valence: 0.9, frustration: 0.7, repairRisk: 0.7 };
    expect(detectMeaningfulTransition(elevated, brightening).meaningful).toBe(false);

    // But valence DROPPING should trigger (needs delta > 0.15: 0.35*0.5=0.175)
    const darkening = { ...elevated, id: "state-dark", valence: 0.0, frustration: 0.7, repairRisk: 0.7 };
    const darkResult = detectMeaningfulTransition(elevated, darkening);
    expect(darkResult.meaningful).toBe(true);
    expect(darkResult.reason).toBe("valence_shifted");

    // Bidirectional channels (griefLoad) trigger in EITHER direction
    // Need delta > 0.12: start at 0.7, drop to 0.2 → 0.35*0.5 = 0.175
    const griefHigh = { ...elevated, griefLoad: 0.7, frustration: 0.7, repairRisk: 0.7 };
    const griefDrop = { ...griefHigh, id: "state-grief-drop", griefLoad: 0.2 };
    const griefResult = detectMeaningfulTransition(griefHigh, griefDrop);
    expect(griefResult.meaningful).toBe(true);
    expect(griefResult.reason).toBe("grief_intensified");
  });

  it("detects composite transition patterns at lower thresholds", () => {
    const base: Parameters<typeof detectMeaningfulTransition>[0] = {
      id: "state-1",
      modality: "live_voice",
      topSignals: [],
      valence: 0.5,
      arousal: 0.5,
      activation: 0.5,
      certainty: 0.5,
      vulnerability: 0.3,
      desireForCloseness: 0.5,
      desireForSpace: 0.3,
      repairRisk: 0.3,
      boundaryPressure: 0.3,
      taskFocus: 0.5,
      griefLoad: 0.3,
      playfulness: 0.5,
      frustration: 0.3,
      environmentPressure: 0.5,
      situationalSignals: [],
      summary: "calm",
      confidence: 0.7,
      provenance: ["heuristic"],
      createdAt: new Date().toISOString(),
    };

    // Withdrawal pattern: frustration + desireForSpace both rising modestly
    // Each alone would be below threshold (0.12), but together at 60% threshold they trigger
    // frustration delta: 0.35 * (0.55 - 0.3) = 0.0875, needs >= 0.12 * 0.6 = 0.072 ✓
    // desireForSpace delta: 0.35 * (0.55 - 0.3) = 0.0875, needs >= 0.18 * 0.6 = 0.108 → too low!
    // Need a bigger shift for desireForSpace (threshold 0.18)
    // desireForSpace delta needs: 0.35 * x >= 0.108 → x >= 0.309
    const withdrawal = {
      ...base,
      id: "state-withdrawal",
      frustration: 0.55, // delta = 0.0875 > 0.072 ✓
      desireForSpace: 0.62, // delta = 0.35*0.32 = 0.112 > 0.108 ✓
    };

    // Neither channel alone triggers its standalone threshold
    // frustration: 0.0875 < 0.12 standalone
    // desireForSpace: 0.112 < 0.18 standalone
    const result = detectMeaningfulTransition(base, withdrawal);
    expect(result.meaningful).toBe(true);
    expect(result.reason).toBe("withdrawal_pattern");

    // But if only one channel rises, the composite doesn't trigger
    const justFrustration = { ...base, id: "state-just-frust", frustration: 0.55 };
    expect(detectMeaningfulTransition(base, justFrustration).meaningful).toBe(false);
  });

  it("detects prosody shift when voice quality changes even if scalar scores don't", () => {
    const base: Parameters<typeof detectMeaningfulTransition>[0] = {
      id: "state-1",
      modality: "live_voice",
      topSignals: [],
      valence: 0.5,
      arousal: 0.5,
      activation: 0.5,
      certainty: 0.5,
      vulnerability: 0.5,
      desireForCloseness: 0.5,
      desireForSpace: 0.5,
      repairRisk: 0.3,
      boundaryPressure: 0.3,
      taskFocus: 0.5,
      griefLoad: 0.3,
      playfulness: 0.5,
      frustration: 0.3,
      environmentPressure: 0.5,
      situationalSignals: [],
      summary: "calm voice",
      confidence: 0.7,
      provenance: ["heuristic", "hume_prosody"],
      createdAt: new Date().toISOString(),
      prosodyScores: { joy: 0.4, contentment: 0.3, sadness: 0.05, anxiety: 0.05 },
    };

    // Voice gets darker — positive prosody drops, negative rises
    // But scalar fields stay the same (simulating text-keyword-driven scores)
    const darkVoice = {
      ...base,
      id: "state-dark-voice",
      prosodyScores: { joy: 0.05, contentment: 0.05, sadness: 0.35, anxiety: 0.3 },
    };

    // Verify prosody valence shifted significantly
    const prevValence = computeProsodyValence(base.prosodyScores!);
    const nextValence = computeProsodyValence(darkVoice.prosodyScores!);
    expect(prevValence).toBeGreaterThan(0); // positive baseline
    expect(nextValence).toBeLessThan(0); // negative now
    expect(prevValence - nextValence).toBeGreaterThan(0.12); // exceeds threshold

    // The transition detector should catch this via prosody shift
    const result = detectMeaningfulTransition(base, darkVoice);
    expect(result.meaningful).toBe(true);
    expect(result.reason).toBe("prosody_shift");

    // Voice brightening (negative → positive) should NOT trigger alarm
    // because prosody_shift only alarms on falling valence
    const brightVoice = {
      ...base,
      id: "state-bright",
      prosodyScores: { joy: 0.05, contentment: 0.05, sadness: 0.35, anxiety: 0.3 },
    };
    const brighterVoice = {
      ...brightVoice,
      id: "state-brighter",
      prosodyScores: { joy: 0.5, contentment: 0.4, sadness: 0.02, anxiety: 0.02 },
    };
    expect(detectMeaningfulTransition(brightVoice, brighterVoice).reason).not.toBe("prosody_shift");

    // No prosody scores → prosody shift detection is skipped
    const noProsody = { ...base, id: "state-no-prosody", prosodyScores: undefined };
    expect(detectMeaningfulTransition(base, noProsody).reason).not.toBe("prosody_shift");
  });

  it("smooths user state via reduceLiveUserState instead of storing raw heuristic", () => {
    const previous: Parameters<typeof reduceLiveUserState>[0] = {
      id: "state-prev",
      modality: "live_voice",
      topSignals: [],
      valence: 0.5,
      arousal: 0.5,
      activation: 0.5,
      certainty: 0.5,
      vulnerability: 0.3,
      desireForCloseness: 0.5,
      desireForSpace: 0.5,
      repairRisk: 0.2,
      boundaryPressure: 0.2,
      taskFocus: 0.5,
      griefLoad: 0.2,
      playfulness: 0.5,
      frustration: 0.2,
      environmentPressure: 0.5,
      situationalSignals: [],
      summary: "calm",
      confidence: 0.7,
      provenance: ["heuristic"],
      createdAt: new Date().toISOString(),
    };

    // A sudden spike to 0.8 should be dampened by the EMA
    const candidate = { ...previous, id: "state-next", frustration: 0.8 };
    const reduced = reduceLiveUserState(previous, candidate);

    // With alpha=0.35: smoothed = 0.2 + 0.35 * (0.8 - 0.2) = 0.41
    expect(reduced.frustration).toBeCloseTo(0.41, 1);
    // Non-reducible fields should pass through unchanged
    expect(reduced.summary).toBe(candidate.summary);
    expect(reduced.id).toBe(candidate.id);

    // No previous → returns candidate as-is
    const fresh = reduceLiveUserState(undefined, candidate);
    expect(fresh.frustration).toBe(0.8);
  });

  it("compares visual observations for scene changes instead of scalar thresholds", () => {
    const base = {
      id: "obs-1",
      personaId: "p-1",
      kind: "screen_observation" as const,
      mode: "screen" as const,
      summary: "User is coding in VS Code",
      situationalSignals: ["focused", "coding"],
      environmentPressure: 0.4,
      taskContext: "writing code",
      attentionTarget: "VS Code editor",
      createdAt: new Date().toISOString(),
    };

    // Same scene — should NOT escalate
    const same = { ...base, id: "obs-2" };
    expect(compareVisualObservation(base, same).escalate).toBe(false);

    // Task context changed — SHOULD escalate
    const taskChanged = { ...base, id: "obs-3", taskContext: "reading email" };
    const r1 = compareVisualObservation(base, taskChanged);
    expect(r1.escalate).toBe(true);
    expect(r1.reason).toBe("task_context_changed");

    // Attention target changed — SHOULD escalate
    const attentionChanged = { ...base, id: "obs-4", attentionTarget: "Slack window" };
    const r2 = compareVisualObservation(base, attentionChanged);
    expect(r2.escalate).toBe(true);
    expect(r2.reason).toBe("attention_target_changed");

    // Distress signal — always escalates
    const distress = { ...base, id: "obs-5", situationalSignals: ["distress", "crying"] };
    expect(compareVisualObservation(base, distress).escalate).toBe(true);

    // No previous — first observation always escalates
    expect(compareVisualObservation(undefined, base).escalate).toBe(true);
  });

  it("includes repair notes in consolidation when user gave feedback during the call", async () => {
    await withoutReasoningProviders(async () => {
      // Seed a live turn then leave feedback — feedback triggers repairWarning
      const turnResult = await appendLiveTranscriptTurn("persona-mom", {
        role: "user",
        body: "that doesn't sound like something you'd say.",
        eventId: "evt-repair-1",
        sessionId: "live-repair-1",
      });
      await addPersonaFeedback("persona-mom", {
        messageId: turnResult.message.id,
        note: "too formal, my mom wouldn't talk like this",
      });

      await appendLiveTranscriptTurn("persona-mom", {
        role: "assistant",
        body: "you're right, let me try again.",
        eventId: "evt-repair-2",
        sessionId: "live-repair-1",
      });

      const result = await finalizeLiveSession("persona-mom", {
        sessionId: "live-repair-1",
        mode: "voice",
        reason: "user_end",
      });

      const persona = await getPersona("persona-mom");
      const job = persona?.mindState.pendingShadowTurns.find((j) => j.id === result.jobId);
      // Should contain repair notes directive because of feedback
      expect(job?.perception.content).toContain("Repair");
      expect(job?.perception.metadata?.repairWarning).toBe(true);
      expect(job?.perception.metadata?.sessionFeedbackCount).toBeGreaterThan(0);
    });
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

    let before = await getPersona("persona-mom");
    let eventId = before?.mindState.pendingInternalEvents[0]?.id;

    if (!eventId) {
      const queuedJobIds =
        before?.mindState.pendingShadowTurns
          .filter((job) => job.status === "pending" || job.status === "processing")
          .map((job) => job.id) ?? [];

      for (const jobId of queuedJobIds) {
        await executeQueuedShadowTurn("persona-mom", jobId);
      }

      before = await getPersona("persona-mom");
      eventId = before?.mindState.pendingInternalEvents[0]?.id;
    }

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
      expect(result.sessionFrame!.contextText.length).toBeGreaterThan(0);
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

  it("produces a live overlay that is smaller than full context and excludes stable regions", async () => {
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

    const fullContext = renderSoulHarnessContext(snapshot);
    const liveOverlay = renderLiveContextOverlay(snapshot);
    const stablePrompt = buildStableSystemPrompt(snapshot);

    // The overlay must be materially smaller than the full context
    expect(liveOverlay.length).toBeLessThan(fullContext.length);

    // The overlay should contain volatile sections
    expect(liveOverlay).toContain("SOUL_STATE");
    expect(liveOverlay).toContain("VISUAL_CONTEXT");

    // The overlay must NOT contain stable sections that belong in the system prompt
    expect(liveOverlay).not.toContain("CONSTITUTION");
    expect(liveOverlay).not.toContain("LEARNED_USER");
    expect(liveOverlay).not.toContain("LEARNED_RELATIONSHIP");
    expect(liveOverlay).not.toContain("RITUALS");
    expect(liveOverlay).not.toContain("EPISODES");

    // The stable system prompt should carry durable context
    expect(stablePrompt).toContain("Durable context");
    expect(stablePrompt.length).toBeGreaterThan(snapshot.sessionFrame.systemPrompt.length);
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
      attachments: [],
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
      expect(session.sessionSettings.systemPrompt).toContain("Durable context");
      expect(session.soulFrame.readyEvents.length).toBeGreaterThanOrEqual(0);
      expect(session.sessionSettings.metadata).toBeTruthy();

      // Version variables must be present so mid-call updates keep them current
      expect(session.sessionSettings.variables?.soul_context_version).toBeGreaterThanOrEqual(1);
      expect(session.sessionSettings.variables?.soul_live_delivery_version).toBeGreaterThanOrEqual(1);
      expect(session.sessionSettings.variables?.soul_trace_version).toBeGreaterThanOrEqual(1);
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
