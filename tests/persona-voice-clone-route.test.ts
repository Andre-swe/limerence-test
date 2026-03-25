import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectJsonError, expectJsonResponse } from "@/tests/helpers/assertions";
import { personaParams, requestWithUser } from "@/tests/helpers/route-helpers";

const {
  savePublicFileMock,
  updatePersonaMock,
  verifyPersonaOwnershipMock,
  withUserStoreMock,
} = vi.hoisted(() => ({
  savePublicFileMock: vi.fn(),
  updatePersonaMock: vi.fn(),
  verifyPersonaOwnershipMock: vi.fn(),
  withUserStoreMock: vi.fn((_userId: string, fn: () => unknown) => fn()),
}));

vi.mock("@/lib/auth", () => ({
  verifyPersonaOwnership: verifyPersonaOwnershipMock,
}));

vi.mock("@/lib/store-context", () => ({
  withUserStore: withUserStoreMock,
}));

vi.mock("@/lib/store", () => ({
  savePublicFile: savePublicFileMock,
  updatePersona: updatePersonaMock,
}));

import {
  GET as voiceCloneGet,
  POST as voiceClonePost,
} from "@/app/api/personas/[personaId]/voice-clone/route";

describe("persona voice clone route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPersonaOwnershipMock.mockResolvedValue({
      authorized: true,
      userId: "user-1",
      persona: {
        id: "persona-test",
        name: "Test Persona",
        voice: {
          provider: "mock",
          voiceId: "voice-1",
          status: "preview_only",
          cloneState: "none",
          watermarkApplied: false,
        },
      },
    });
    savePublicFileMock.mockResolvedValue({
      fileName: "voice-clone.webm",
      url: "/uploads/voice-clone.webm",
    });
    updatePersonaMock.mockResolvedValue(undefined);
  });

  it("rejects requests for personas the user does not own", async () => {
    verifyPersonaOwnershipMock.mockResolvedValueOnce({
      authorized: false,
      error: "Persona not found.",
      status: 403,
    });

    const response = await voiceCloneGet(
      requestWithUser("http://localhost/api/personas/persona-test/voice-clone", "user-2"),
      personaParams(),
    );

    await expectJsonError(response, 403, "Persona not found.");
    expect(withUserStoreMock).not.toHaveBeenCalled();
  });

  it("stores a voice clone upload inside the owned user store context", async () => {
    const formData = new FormData();
    formData.set("audio", new File([Buffer.from("voice")], "sample.webm", { type: "audio/webm" }));
    formData.set(
      "metadata",
      JSON.stringify({
        consent: {
          granted: true,
          timestamp: "2026-03-16T15:00:00.000Z",
          userAgent: "Vitest",
          consentText: "I consent.",
        },
        qualityScore: 87,
        duration: 14,
      }),
    );

    const response = await voiceClonePost(
      requestWithUser("http://localhost/api/personas/persona-test/voice-clone", "user-1", {
        method: "POST",
        body: formData,
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      personaParams(),
    );

    const body = await expectJsonResponse<{
      success: boolean;
      profile: { personaId: string; consent: { ipAddress: string } };
    }>(response);
    expect(body.success).toBe(true);
    expect(body.profile.personaId).toBe("persona-test");
    expect(body.profile.consent.ipAddress).toBe("203.0.113.9");
    expect(withUserStoreMock).toHaveBeenCalledWith("user-1", expect.any(Function));
    expect(savePublicFileMock).toHaveBeenCalledTimes(1);
    expect(updatePersonaMock).toHaveBeenCalledWith("persona-test", expect.any(Function));
  });

  it("returns the owned persona's clone status", async () => {
    const response = await voiceCloneGet(
      requestWithUser("http://localhost/api/personas/persona-test/voice-clone", "user-1"),
      personaParams(),
    );

    const body = await expectJsonResponse<{
      voiceProfile: { voiceId: string };
      cloneState: string;
    }>(response);
    expect(body.voiceProfile.voiceId).toBe("voice-1");
    expect(body.cloneState).toBe("none");
  });
});
