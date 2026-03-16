// @vitest-environment jsdom

import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectMock,
  disconnectMock,
  sendSessionSettingsMock,
  voiceHarness,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  sendSessionSettingsMock: vi.fn(),
  voiceHarness: {
    latestProps: null as null | Record<string, unknown>,
    setStatus: null as null | ((value: "connected" | "connecting" | "disconnected") => void),
  },
}));

vi.mock("@humeai/voice-react", async () => {
  const React = await import("react");

  type StatusValue = "connected" | "connecting" | "disconnected";

  const VoiceContext = React.createContext<{
    callDurationTimestamp: string;
    connect: typeof connectMock;
    disconnect: typeof disconnectMock;
    fft: number[];
    isAudioMuted: boolean;
    isMuted: boolean;
    isPlaying: boolean;
    micFft: number[];
    mute: () => void;
    muteAudio: () => void;
    sendSessionSettings: typeof sendSessionSettingsMock;
    status: { value: StatusValue };
    unmute: () => void;
    unmuteAudio: () => void;
  } | null>(null);

  function VoiceProvider({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) {
    const [statusValue, setStatusValue] = React.useState<StatusValue>("disconnected");

    React.useEffect(() => {
      voiceHarness.latestProps = props;
      voiceHarness.setStatus = setStatusValue;

      return () => {
        voiceHarness.latestProps = null;
        voiceHarness.setStatus = null;
      };
    }, [props]);

    connectMock.mockImplementation(async () => {
      setStatusValue("connected");
      (props.onOpen as undefined | (() => void))?.();
    });

    disconnectMock.mockImplementation(async () => {
      setStatusValue("disconnected");
      (props.onClose as undefined | ((event: { code: number; reason: string }) => void))?.({
        code: 1000,
        reason: "",
      });
    });

    return (
      <VoiceContext.Provider
        value={{
          callDurationTimestamp: "00:12",
          connect: connectMock,
          disconnect: disconnectMock,
          fft: [],
          isAudioMuted: false,
          isMuted: false,
          isPlaying: false,
          micFft: [],
          mute: vi.fn(),
          muteAudio: vi.fn(),
          sendSessionSettings: sendSessionSettingsMock,
          status: { value: statusValue },
          unmute: vi.fn(),
          unmuteAudio: vi.fn(),
        }}
      >
        {children}
      </VoiceContext.Provider>
    );
  }

  function useVoice() {
    const value = React.useContext(VoiceContext);
    if (!value) {
      throw new Error("useVoice must be used within a VoiceProvider test double.");
    }

    return value;
  }

  return {
    VoiceProvider,
    useVoice,
  };
});

import { ConversationPanel } from "@/components/conversation-panel";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    }),
  );
}

function buildSessionFrame(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    process: "arrival",
    systemPrompt: "system prompt",
    contextText: "seed context",
    variables: {},
    currentDrive: "stay present",
    traceVersion: 1,
    contextVersion: 1,
    liveDeliveryVersion: 1,
    readyEvents: [],
    ...overrides,
  };
}

function createMockStream() {
  const track = {
    kind: "video",
    onended: null as null | (() => void),
    stop: vi.fn(),
  };

  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;

  return {
    stream,
    track,
  };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ConversationPanel", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getDisplayMediaMock = vi.fn();
  const getUserMediaMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    cleanup();

    Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    Object.defineProperty(window.HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 1280,
    });
    Object.defineProperty(window.HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 720,
    });
    Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
    });
    Object.defineProperty(window.HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: vi.fn((callback: (blob: Blob | null) => void) => {
        callback(new Blob(["frame"], { type: "image/jpeg" }));
      }),
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia: getDisplayMediaMock,
        getUserMedia: getUserMediaMock,
      },
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    try {
      await vi.runOnlyPendingTimersAsync();
    } catch {
      // Some tests switch back to real timers.
    }
    vi.useRealTimers();
  });

  it("polls live context updates and stops polling on unmount", async () => {
    vi.useRealTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    fetchMock.mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/live")) {
        return jsonResponse({
          accessToken: "live-token",
          hostname: "api.hume.ai",
          mode: "voice",
          soulFrame: buildSessionFrame(),
          sessionSettings: {
            context: {
              text: "seed context",
              type: "persistent",
            },
            customSessionId: "sess-1",
            systemPrompt: "system prompt",
            type: "session_settings",
            variables: {
              soul_mode: "voice",
            },
          },
          voiceStatus: "ready",
        });
      }

      if (url.includes("/live/context")) {
        return jsonResponse({
          sessionFrame: buildSessionFrame({
            contextText: "updated context",
            liveDeliveryVersion: 2,
            variables: {
              soul_mode: "voice",
              soul_visual_active: false,
            },
          }),
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { unmount } = render(
      <ConversationPanel
        personaId="persona-test"
        personaName="Mira"
        personaStatus="active"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Talk live session" }));

    await waitFor(() => {
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(sendSessionSettingsMock).toHaveBeenCalledTimes(2);
    });

    const contextCallsBeforeUnmount = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/live/context"),
    ).length;

    expect(sendSessionSettingsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: {
          text: "updated context",
          type: "persistent",
        },
      }),
    );
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/live/context?sessionId=sess-1&afterVersion=1"),
    )).toBe(true);

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    const contextCallsAfterUnmount = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/live/context"),
    ).length;
    expect(contextCallsAfterUnmount).toBe(contextCallsBeforeUnmount);
  });

  it("starts screen sharing and stops tracks on unexpected disconnect", async () => {
    const { stream, track } = createMockStream();
    getDisplayMediaMock.mockResolvedValue(stream);
    fetchMock.mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/live")) {
        return jsonResponse({
          accessToken: "live-token",
          hostname: "api.hume.ai",
          mode: "screen",
          soulFrame: buildSessionFrame(),
          sessionSettings: {
            context: {
              text: "seed context",
              type: "persistent",
            },
            customSessionId: "sess-screen",
            systemPrompt: "system prompt",
            type: "session_settings",
            variables: {
              soul_mode: "screen",
            },
          },
          voiceStatus: "ready",
        });
      }

      if (url.includes("/live/perception")) {
        return jsonResponse({});
      }

      if (url.includes("/live/context")) {
        return jsonResponse({});
      }

      if (url.endsWith("/live/end")) {
        return jsonResponse({});
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <ConversationPanel
        personaId="persona-test"
        personaName="Mira"
        personaStatus="active"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share screen/i }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getDisplayMediaMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/live/perception"),
    )).toBe(true);

    await act(async () => {
      voiceHarness.setStatus?.("disconnected");
      (voiceHarness.latestProps?.onClose as undefined | ((event: { code: number; reason: string }) => void))?.({
        code: 1006,
        reason: "Socket dropped",
      });
    });

    await flushAsyncWork();

    expect(track.stop).toHaveBeenCalled();

    expect(screen.getByText("Socket dropped")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/live/end"),
    )).toBe(true);
  });

  it("surfaces visual perception errors without crashing the live session", async () => {
    const { stream } = createMockStream();
    getDisplayMediaMock.mockResolvedValue(stream);
    fetchMock.mockImplementation((input) => {
      const url = String(input);

      if (url.endsWith("/live")) {
        return jsonResponse({
          accessToken: "live-token",
          hostname: "api.hume.ai",
          mode: "screen",
          soulFrame: buildSessionFrame(),
          sessionSettings: {
            context: {
              text: "seed context",
              type: "persistent",
            },
            customSessionId: "sess-screen-error",
            systemPrompt: "system prompt",
            type: "session_settings",
          },
          voiceStatus: "ready",
        });
      }

      if (url.includes("/live/perception")) {
        return jsonResponse({ error: "visual pipeline offline" }, 500);
      }

      if (url.includes("/live/context")) {
        return jsonResponse({});
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <ConversationPanel
        personaId="persona-test"
        personaName="Mira"
        personaStatus="active"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share screen/i }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("visual pipeline offline")).toBeTruthy();
  });
});
