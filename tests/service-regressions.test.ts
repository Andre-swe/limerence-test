import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendLiveTranscriptTurn,
  recordUserActivity,
  resetServiceRuntimeStateForTests,
  runDueHeartbeats,
  runHeartbeat,
} from "@/lib/services";
import {
  appendMessages,
  getPersona,
  listMessages,
  resetStoreForTests,
  updatePersona,
} from "@/lib/store";

describe("service regressions", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await resetServiceRuntimeStateForTests();
    await resetStoreForTests();
  });

  it("advances heartbeat scheduling even when the outbound cap suppresses a send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T15:00:00.000Z"));

    await appendMessages([
      {
        id: "heartbeat-existing-1",
        personaId: "persona-mom",
        role: "assistant",
        kind: "text",
        channel: "heartbeat",
        body: "Checking in.",
        attachments: [],
        audioStatus: "unavailable",
        createdAt: "2026-03-16T14:30:00.000Z",
        replyMode: "text",
        delivery: {
          webInbox: true,
          telegramStatus: "not_requested",
          attempts: 0,
        },
      },
    ]);
    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      heartbeatPolicy: {
        ...persona.heartbeatPolicy,
        maxOutboundPerDay: 1,
      },
      nextHeartbeatAt: undefined,
    }));

    const decision = await runHeartbeat("persona-mom");
    const persona = await getPersona("persona-mom");

    expect(decision.action).toBe("SILENT");
    expect(decision.reason).toContain("Daily outbound heartbeat cap reached");
    expect(persona?.lastHeartbeatAt).toBe("2026-03-16T15:00:00.000Z");
    expect(persona?.nextHeartbeatAt).toBeTruthy();
    expect(new Date(persona!.nextHeartbeatAt!).getTime()).toBeGreaterThan(
      new Date("2026-03-16T15:00:00.000Z").getTime(),
    );
  });

  it("deduplicates repeated live transcript events by event id", async () => {
    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "remember this for later",
      eventId: "evt-dedupe-1",
      sessionId: "live-session-1",
    });
    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "remember this for later",
      eventId: "evt-dedupe-1",
      sessionId: "live-session-1",
    });

    const messages = await listMessages("persona-mom");
    const matchingEvents = messages.filter(
      (message) =>
        message.channel === "live" &&
        message.role === "user" &&
        message.metadata?.humeMessageId === "evt-dedupe-1",
    );

    expect(matchingEvents).toHaveLength(1);
  });

  it("does not collapse distinct live transcript turns when event id is missing", async () => {
    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "still here",
      sessionId: "live-session-no-event",
    });
    await appendLiveTranscriptTurn("persona-mom", {
      role: "user",
      body: "still here",
      sessionId: "live-session-no-event",
    });

    const messages = await listMessages("persona-mom");
    const sessionTurns = messages.filter(
      (message) =>
        message.channel === "live" &&
        message.role === "user" &&
        message.metadata?.sessionId === "live-session-no-event",
    );

    expect(sessionTurns).toHaveLength(2);
  });

  it("records activity in the persona's local hour instead of server time", async () => {
    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      timezone: "America/Los_Angeles",
      heartbeatPolicy: {
        ...persona.heartbeatPolicy,
        hourlyActivityCounts: Array(24).fill(0),
      },
    }));

    await recordUserActivity("persona-mom", new Date("2026-03-16T15:00:00.000Z"));

    const persona = await getPersona("persona-mom");
    expect(persona?.heartbeatPolicy.hourlyActivityCounts[8]).toBeGreaterThan(0);
    expect(persona?.heartbeatPolicy.hourlyActivityCounts[15]).toBe(0);
  });

  it("runs only personas whose nextHeartbeatAt is due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T12:00:00.000Z"));

    await updatePersona("persona-mom", (persona) => ({
      ...persona,
      nextHeartbeatAt: "2026-03-16T11:59:00.000Z",
    }));
    await updatePersona("persona-alex", (persona) => ({
      ...persona,
      nextHeartbeatAt: "2026-03-16T13:00:00.000Z",
    }));

    const results = await runDueHeartbeats();

    expect(results.map((result) => result.personaId)).toContain("persona-mom");
    expect(results.map((result) => result.personaId)).not.toContain("persona-alex");
  });
});
