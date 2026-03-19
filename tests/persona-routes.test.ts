import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectJsonError,
  expectJsonResponse,
} from "@/tests/helpers/assertions";
import {
  formRequest,
  jsonRequest,
  personaMessageParams,
  personaParams,
  requestWithUser,
} from "@/tests/helpers/route-helpers";

const {
  addPersonaFeedbackMock,
  appendLiveTranscriptTurnMock,
  buildMemoryRetrievalPackMock,
  createPersonaFromFormMock,
  createPersonaLiveSessionMock,
  finalizeLiveSessionMock,
  getAuthenticatedUserIdMock,
  getLiveContextUpdateMock,
  observeLiveVisualPerceptionMock,
  runHeartbeatMock,
  sendPersonaMessageMock,
  synthesizeStoredReplyMock,
  verifyPersonaOwnershipMock,
  withUserStoreMock,
} = vi.hoisted(() => ({
  addPersonaFeedbackMock: vi.fn(),
  appendLiveTranscriptTurnMock: vi.fn(),
  buildMemoryRetrievalPackMock: vi.fn(),
  createPersonaFromFormMock: vi.fn(),
  createPersonaLiveSessionMock: vi.fn(),
  finalizeLiveSessionMock: vi.fn(),
  getAuthenticatedUserIdMock: vi.fn(),
  getLiveContextUpdateMock: vi.fn(),
  observeLiveVisualPerceptionMock: vi.fn(),
  runHeartbeatMock: vi.fn(),
  sendPersonaMessageMock: vi.fn(),
  synthesizeStoredReplyMock: vi.fn(),
  verifyPersonaOwnershipMock: vi.fn(),
  withUserStoreMock: vi.fn((_userId: string, fn: () => unknown) => fn()),
}));

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
  verifyPersonaOwnership: verifyPersonaOwnershipMock,
}));

vi.mock("@/lib/store-context", () => ({
  withUserStore: withUserStoreMock,
}));

vi.mock("@/lib/services", () => ({
  addPersonaFeedback: addPersonaFeedbackMock,
  appendLiveTranscriptTurn: appendLiveTranscriptTurnMock,
  createPersonaFromForm: createPersonaFromFormMock,
  finalizeLiveSession: finalizeLiveSessionMock,
  getLiveContextUpdate: getLiveContextUpdateMock,
  observeLiveVisualPerception: observeLiveVisualPerceptionMock,
  runHeartbeat: runHeartbeatMock,
  sendPersonaMessage: sendPersonaMessageMock,
  synthesizeStoredReply: synthesizeStoredReplyMock,
}));

vi.mock("@/lib/hume-evi", () => ({
  createPersonaLiveSession: createPersonaLiveSessionMock,
}));

vi.mock("@/lib/memory-v2", () => ({
  buildMemoryRetrievalPack: buildMemoryRetrievalPackMock,
}));

import { POST as personaFeedbackPost } from "@/app/api/personas/[personaId]/feedback/route";
import { POST as personaHeartbeatPost } from "@/app/api/personas/[personaId]/heartbeat/route";
import { GET as liveContextGet } from "@/app/api/personas/[personaId]/live/context/route";
import { POST as liveEndPost } from "@/app/api/personas/[personaId]/live/end/route";
import { POST as liveMessagesPost } from "@/app/api/personas/[personaId]/live/messages/route";
import { POST as livePerceptionPost } from "@/app/api/personas/[personaId]/live/perception/route";
import { GET as liveGet, POST as livePost } from "@/app/api/personas/[personaId]/live/route";
import { POST as messageAudioPost } from "@/app/api/personas/[personaId]/messages/[messageId]/audio/route";
import { POST as personaMessagesPost } from "@/app/api/personas/[personaId]/messages/route";
import { GET as soulTraceGet } from "@/app/api/personas/[personaId]/soul/trace/route";
import { POST as personasPost } from "@/app/api/personas/route";

const activePersona = {
  id: "persona-test",
  userId: "user-1",
  name: "Test Persona",
  status: "active",
  mindState: {
    activeProcess: "arrival",
    currentProcessInstanceId: "process-1",
    internalState: { mood: "steady" },
    learningState: { artifacts: [] },
    liveSessionMetrics: {},
    memoryClaims: [],
    recentChangedClaims: [],
    claimSources: [],
    episodes: [],
    lastRetrievalPack: undefined,
    pendingInternalEvents: [],
    pendingShadowTurns: [],
    recentEvents: [],
    traceHead: [],
  },
};

describe("persona routes", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    getAuthenticatedUserIdMock.mockReturnValue("user-1");
    verifyPersonaOwnershipMock.mockResolvedValue({
      authorized: true,
      userId: "user-1",
      persona: activePersona,
    });
    createPersonaFromFormMock.mockResolvedValue({
      id: "persona-new",
      status: "active",
    });
    addPersonaFeedbackMock.mockResolvedValue({ id: "feedback-1" });
    runHeartbeatMock.mockResolvedValue({ action: "TEXT", reason: "ready" });
    getLiveContextUpdateMock.mockResolvedValue({
      sessionFrame: { liveDeliveryVersion: 2 },
      pendingJobs: 1,
    });
    finalizeLiveSessionMock.mockResolvedValue({
      queued: true,
      jobId: "job-1",
    });
    appendLiveTranscriptTurnMock.mockResolvedValue({
      contextualUpdate: "changed",
      sessionFrame: { liveDeliveryVersion: 3 },
    });
    observeLiveVisualPerceptionMock.mockResolvedValue({
      sessionFrame: { liveDeliveryVersion: 4 },
    });
    sendPersonaMessageMock.mockResolvedValue({
      messages: [{ id: "msg-1" }],
      leftOnRead: false,
    });
    synthesizeStoredReplyMock.mockResolvedValue({ id: "msg-1", audioUrl: "/audio.mp3" });
    createPersonaLiveSessionMock.mockResolvedValue({ accessToken: "live-token" });
    buildMemoryRetrievalPackMock.mockReturnValue({
      alwaysLoadedClaims: [],
      contextualClaims: [],
      contextualEpisodes: [],
      summary: "ready",
      builtAt: "2026-03-16T00:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  });

  it("rejects persona creation without an authenticated user", async () => {
    getAuthenticatedUserIdMock.mockReturnValueOnce(null);

    const response = await personasPost(new Request("http://localhost/api/personas", {
      method: "POST",
      body: new FormData(),
    }));

    await expectJsonError(response, 401, "Unauthorized. Valid session required.");
  });

  it("creates a persona inside the user store context", async () => {
    const formData = new FormData();
    formData.set("name", "Nina");

    const response = await personasPost(
      requestWithUser("http://localhost/api/personas", "user-1", {
        method: "POST",
        body: formData,
      }),
    );

    const body = await expectJsonResponse<{ personaId: string; status: string }>(response);
    expect(body).toEqual({ personaId: "persona-new", status: "active" });
    expect(withUserStoreMock).toHaveBeenCalledTimes(1);
    expect(createPersonaFromFormMock).toHaveBeenCalledWith(formData, "user-1");
  });

  it("returns a 400 when persona creation fails", async () => {
    createPersonaFromFormMock.mockRejectedValueOnce(new Error("bad persona"));

    const response = await personasPost(
      requestWithUser("http://localhost/api/personas", "user-1", {
        method: "POST",
        body: new FormData(),
      }),
    );

    await expectJsonError(response, 400, "bad persona");
  });

  it("returns ownership errors for feedback requests", async () => {
    verifyPersonaOwnershipMock.mockResolvedValueOnce({
      authorized: false,
      error: "Forbidden. You do not own this persona.",
      status: 403,
    });

    const response = await personaFeedbackPost(
      jsonRequest("http://localhost/api/personas/persona-test/feedback", { note: "x" }, {
        method: "POST",
      }),
      personaParams(),
    );

    await expectJsonError(response, 403, "Forbidden. You do not own this persona.");
  });

  it("records feedback for an owned persona", async () => {
    const response = await personaFeedbackPost(
      jsonRequest(
        "http://localhost/api/personas/persona-test/feedback",
        { messageId: "msg-1", note: "too formal" },
        { method: "POST" },
      ),
      personaParams(),
    );

    const body = await expectJsonResponse<{ feedback: { id: string } }>(response);
    expect(body.feedback.id).toBe("feedback-1");
    expect(addPersonaFeedbackMock).toHaveBeenCalledWith("persona-test", {
      messageId: "msg-1",
      note: "too formal",
    });
  });

  it("runs heartbeat for an owned persona", async () => {
    const response = await personaHeartbeatPost(
      new Request("http://localhost/api/personas/persona-test/heartbeat", { method: "POST" }),
      personaParams(),
    );

    const body = await expectJsonResponse<{ decision: { action: string } }>(response);
    expect(body.decision.action).toBe("TEXT");
    expect(runHeartbeatMock).toHaveBeenCalledWith("persona-test");
  });

  it("returns a 400 when heartbeat execution fails", async () => {
    runHeartbeatMock.mockRejectedValueOnce(new Error("heartbeat failed"));

    const response = await personaHeartbeatPost(
      new Request("http://localhost/api/personas/persona-test/heartbeat", { method: "POST" }),
      personaParams(),
    );

    await expectJsonError(response, 400, "heartbeat failed");
  });

  it("parses live context query params and normalizes NaN afterVersion", async () => {
    const response = await liveContextGet(
      new Request("http://localhost/api/personas/persona-test/live/context?sessionId=sess-1&afterVersion=NaN"),
      personaParams(),
    );

    const body = await expectJsonResponse<{ pendingJobs: number }>(response);
    expect(body.pendingJobs).toBe(1);
    expect(getLiveContextUpdateMock).toHaveBeenCalledWith("persona-test", {
      sessionId: "sess-1",
      afterVersion: 0,
    });
  });

  it("returns a 400 when live context resolution fails", async () => {
    getLiveContextUpdateMock.mockRejectedValueOnce(new Error("no live state"));

    const response = await liveContextGet(
      new Request("http://localhost/api/personas/persona-test/live/context"),
      personaParams(),
    );

    await expectJsonError(response, 400, "no live state");
  });

  it("finalizes live sessions with an empty payload when JSON parsing fails", async () => {
    const response = await liveEndPost(
      new Request("http://localhost/api/personas/persona-test/live/end", {
        method: "POST",
        body: "{not-json",
      }),
      personaParams(),
    );

    const body = await expectJsonResponse<{ jobId: string }>(response);
    expect(body.jobId).toBe("job-1");
    expect(finalizeLiveSessionMock).toHaveBeenCalledWith("persona-test", {
      sessionId: undefined,
      mode: undefined,
      reason: undefined,
    });
  });

  it("returns a 400 when live-session finalization fails", async () => {
    finalizeLiveSessionMock.mockRejectedValueOnce(new Error("end failed"));

    const response = await liveEndPost(
      jsonRequest(
        "http://localhost/api/personas/persona-test/live/end",
        { sessionId: "sess-1" },
        { method: "POST" },
      ),
      personaParams(),
    );

    await expectJsonError(response, 400, "end failed");
  });

  it("stores live transcript turns and returns contextual updates", async () => {
    const response = await liveMessagesPost(
      jsonRequest(
        "http://localhost/api/personas/persona-test/live/messages",
        { role: "user", body: "hello" },
        { method: "POST" },
      ),
      personaParams(),
    );

    const body = await expectJsonResponse<{
      contextualUpdate: string;
      sessionFrame: { liveDeliveryVersion: number };
    }>(response);
    expect(body.contextualUpdate).toBe("changed");
    expect(appendLiveTranscriptTurnMock).toHaveBeenCalledWith("persona-test", {
      role: "user",
      body: "hello",
    });
  });

  it("returns a 400 when live transcript persistence fails", async () => {
    appendLiveTranscriptTurnMock.mockRejectedValueOnce(new Error("transcript failed"));

    const response = await liveMessagesPost(
      jsonRequest(
        "http://localhost/api/personas/persona-test/live/messages",
        { role: "user", body: "hello" },
        { method: "POST" },
      ),
      personaParams(),
    );

    await expectJsonError(response, 400, "transcript failed");
  });

  it("rejects live perception requests for unsupported modes", async () => {
    const formData = new FormData();
    formData.set("mode", "voice");

    const response = await livePerceptionPost(
      formRequest(
        "http://localhost/api/personas/persona-test/live/perception",
        formData,
        { method: "POST" },
      ),
      personaParams(),
    );

    await expectJsonError(response, 400, "Unsupported live mode.");
  });

  it("passes visual perception files through for screen and camera modes", async () => {
    const formData = new FormData();
    formData.set("mode", "screen");
    formData.set("sessionId", "sess-1");
    formData.set("event", "frame");
    formData.set("image", new File([Buffer.from("pixels")], "screen.jpg", { type: "image/jpeg" }));

    const response = await livePerceptionPost(
      formRequest(
        "http://localhost/api/personas/persona-test/live/perception",
        formData,
        { method: "POST" },
      ),
      personaParams(),
    );

    const body = await expectJsonResponse<{ sessionFrame: { liveDeliveryVersion: number } }>(response);
    expect(body.sessionFrame.liveDeliveryVersion).toBe(4);
    expect(observeLiveVisualPerceptionMock).toHaveBeenCalledWith(
      "persona-test",
      expect.objectContaining({
        mode: "screen",
        sessionId: "sess-1",
      }),
    );
  });

  it("refuses live sessions for inactive personas", async () => {
    verifyPersonaOwnershipMock.mockResolvedValueOnce({
      authorized: true,
      userId: "user-1",
      persona: {
        ...activePersona,
        status: "draft",
      },
    });

    const response = await liveGet(
      new Request("http://localhost/api/personas/persona-test/live"),
      personaParams(),
    );

    await expectJsonError(
      response,
      400,
      "This persona must be approved before live conversation can begin.",
    );
  });

  it("creates live sessions and honors the requested mode", async () => {
    const response = await livePost(
      jsonRequest(
        "http://localhost/api/personas/persona-test/live",
        { mode: "camera" },
        { method: "POST" },
      ),
      personaParams(),
    );

    const body = await expectJsonResponse<{ accessToken: string }>(response);
    expect(body.accessToken).toBe("live-token");
    expect(createPersonaLiveSessionMock).toHaveBeenCalledWith(activePersona, "camera", { isPremium: false });
  });

  it("normalizes message attachments and channel values", async () => {
    const formData = new FormData();
    formData.set("text", "hello");
    formData.set("channel", "web");
    formData.set("audio", new File([Buffer.from("audio")], "reply.webm", { type: "audio/webm" }));
    formData.append("images", new File([Buffer.from("img-1")], "one.png", { type: "image/png" }));
    formData.append("images", new File([Buffer.alloc(0)], "empty.png", { type: "image/png" }));

    const response = await personaMessagesPost(
      formRequest(
        "http://localhost/api/personas/persona-test/messages",
        formData,
        { method: "POST" },
      ),
      personaParams(),
    );

    const body = await expectJsonResponse<{ leftOnRead: boolean }>(response);
    expect(body.leftOnRead).toBe(false);
    expect(sendPersonaMessageMock).toHaveBeenCalledWith(
      "persona-test",
      expect.objectContaining({
        text: "hello",
        channel: "web",
        images: expect.arrayContaining([
          expect.objectContaining({ name: "one.png" }),
        ]),
      }),
    );
  });

  it("returns a 400 when async message sending fails", async () => {
    sendPersonaMessageMock.mockRejectedValueOnce(new Error("send failed"));

    const response = await personaMessagesPost(
      formRequest(
        "http://localhost/api/personas/persona-test/messages",
        new FormData(),
        { method: "POST" },
      ),
      personaParams(),
    );

    await expectJsonError(response, 400, "send failed");
  });

  it("synthesizes stored audio replies", async () => {
    const response = await messageAudioPost(
      new Request("http://localhost/api/personas/persona-test/messages/message-test/audio", {
        method: "POST",
      }),
      personaMessageParams(),
    );

    const body = await expectJsonResponse<{ message: { audioUrl: string } }>(response);
    expect(body.message.audioUrl).toBe("/audio.mp3");
    expect(synthesizeStoredReplyMock).toHaveBeenCalledWith("persona-test", "message-test");
  });

  it("returns a 400 when stored-audio synthesis fails", async () => {
    synthesizeStoredReplyMock.mockRejectedValueOnce(new Error("tts failed"));

    const response = await messageAudioPost(
      new Request("http://localhost/api/personas/persona-test/messages/message-test/audio", {
        method: "POST",
      }),
      personaMessageParams(),
    );

    await expectJsonError(response, 400, "tts failed");
  });

  it("returns soul traces for the owning user", async () => {
    verifyPersonaOwnershipMock.mockResolvedValueOnce({
      authorized: true,
      userId: "user-1",
      persona: {
        ...activePersona,
        mindState: {
          ...activePersona.mindState,
          memoryClaims: [{ id: "claim-1", kind: "boundary", status: "confirmed" }],
        },
      },
    });

    const response = await soulTraceGet(
      requestWithUser("http://localhost/api/personas/persona-test/soul/trace", "user-1"),
      personaParams(),
    );

    const body = await expectJsonResponse<{ personaId: string; memoryClaims: Array<{ id: string }> }>(response);
    expect(body.personaId).toBe("persona-test");
    expect(body.memoryClaims[0]?.id).toBe("claim-1");
  });

  it("rejects soul traces when the requester does not own the persona", async () => {
    verifyPersonaOwnershipMock.mockResolvedValueOnce({
      authorized: false,
      error: "Persona not found.",
      status: 403,
    });

    const response = await soulTraceGet(
      requestWithUser("http://localhost/api/personas/persona-test/soul/trace", "user-2"),
      personaParams(),
    );

    await expectJsonError(response, 403, "Persona not found.");
  });

  it("applies the same ownership check in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    verifyPersonaOwnershipMock.mockResolvedValueOnce({
      authorized: false,
      error: "Persona not found.",
      status: 403,
    });

    const response = await soulTraceGet(
      requestWithUser("http://localhost/api/personas/persona-test/soul/trace", "user-1"),
      personaParams(),
    );

    await expectJsonError(response, 403, "Persona not found.");
  });
});
