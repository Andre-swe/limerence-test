"use client";

import { useVoice } from "@humeai/voice-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { LiveSessionMode, SoulSessionFrame } from "@/lib/types";
import {
  averageLevel,
  modeLabel,
  optimisticVisualContextText,
  resolveErrorMessage,
  statusCopyFor,
  type LiveState,
} from "@/components/conversation-panel-live-utils";

type LiveSessionResponse = {
  accessToken: string;
  hostname: string;
  mode: LiveSessionMode;
  soulFrame: SoulSessionFrame;
  sessionSettings: {
    context?: {
      text: string;
      type: "persistent";
    };
    customSessionId: string;
    systemPrompt: string;
    type: "session_settings";
    variables?: Record<string, string | number | boolean>;
    voiceId?: string;
  };
  voiceStatus: "ready" | "preview_only" | "unavailable";
};

type LivePerceptionResponse = {
  sessionFrame?: SoulSessionFrame;
};

type LiveContextResponse = {
  pendingJobs?: number;
  sessionFrame?: SoulSessionFrame;
};

type ConversationPanelLiveControllerInput = {
  activeMode: LiveSessionMode;
  activeVisualMode: Extract<LiveSessionMode, "screen" | "camera"> | null;
  isLocked: boolean;
  isPreparingLive: boolean;
  liveError: string | null;
  liveState: LiveState;
  pendingSessionFrame: SoulSessionFrame | null;
  personaId: string;
  resetLiveSessionArtifacts: () => void;
  sessionContextText: string;
  sessionContextVersion: number;
  sessionId: string | null;
  setActiveMode: Dispatch<SetStateAction<LiveSessionMode>>;
  setActiveVisualMode: Dispatch<
    SetStateAction<Extract<LiveSessionMode, "screen" | "camera"> | null>
  >;
  setIsPreparingLive: Dispatch<SetStateAction<boolean>>;
  setLiveError: Dispatch<SetStateAction<string | null>>;
  setLiveState: Dispatch<SetStateAction<LiveState>>;
  setPendingSessionFrame: Dispatch<SetStateAction<SoulSessionFrame | null>>;
  setSessionContextText: Dispatch<SetStateAction<string>>;
  setSessionContextVersion: Dispatch<SetStateAction<number>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setVisualError: Dispatch<SetStateAction<string | null>>;
  userEndedLiveRef: MutableRefObject<boolean>;
  visualError: string | null;
};

export function useConversationPanelLive({
  activeMode,
  activeVisualMode,
  isLocked,
  isPreparingLive,
  liveError,
  liveState,
  pendingSessionFrame,
  personaId,
  resetLiveSessionArtifacts,
  sessionContextText,
  sessionContextVersion,
  sessionId,
  setActiveMode,
  setActiveVisualMode,
  setIsPreparingLive,
  setLiveError,
  setLiveState,
  setPendingSessionFrame,
  setSessionContextText,
  setSessionContextVersion,
  setSessionId,
  setVisualError,
  userEndedLiveRef,
  visualError,
}: ConversationPanelLiveControllerInput) {
  const {
    callDurationTimestamp,
    connect,
    disconnect,
    fft,
    isAudioMuted,
    isMuted,
    isPlaying,
    micFft,
    mute,
    muteAudio,
    sendSessionSettings,
    status,
    unmute,
    unmuteAudio,
  } = useVoice();
  // The polling effect reads this ref so version bumps do not tear down and
  // recreate the interval on every delivery.
  const contextVersionRef = useRef(sessionContextVersion);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const visualStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureInFlightRef = useRef(false);

  contextVersionRef.current = sessionContextVersion;

  const liveConnected = status.value === "connected";
  const liveConnecting = status.value === "connecting" || isPreparingLive;
  const micLevel = averageLevel(micFft);
  const assistantLevel = averageLevel(fft);
  const liveLevel = Math.max(micLevel, assistantLevel);
  const orbScale = liveConnected ? 1 + Math.min(liveLevel / 380, 0.1) : 1;
  const minimalStatus = liveConnecting ? "Connecting" : statusCopyFor(liveState);

  useEffect(() => {
    if (status.value !== "connected") {
      return;
    }

    if (isPlaying) {
      setLiveState("replying");
      return;
    }

    setLiveState((current) => (current === "replying" ? "listening" : current));
  }, [isPlaying, setLiveState, status.value]);

  useEffect(() => {
    if (!pendingSessionFrame || status.value !== "connected") {
      return;
    }

    // Hume keeps the original bootstrap prompt/voice settings, so live
    // deliveries only need to refresh the compact volatile context overlay.
    if (pendingSessionFrame.liveDeliveryVersion <= sessionContextVersion) {
      setPendingSessionFrame(null);
      return;
    }

    sendSessionSettings({
      context: {
        text: pendingSessionFrame.contextText,
        type: "persistent",
      },
      variables: pendingSessionFrame.variables,
    });
    setSessionContextText(pendingSessionFrame.contextText);
    setSessionContextVersion(pendingSessionFrame.liveDeliveryVersion);
    setPendingSessionFrame(null);
  }, [
    pendingSessionFrame,
    sendSessionSettings,
    sessionContextVersion,
    setPendingSessionFrame,
    setSessionContextText,
    setSessionContextVersion,
    status.value,
  ]);

  async function stopVisualSharing(silent = false) {
    const currentMode = activeVisualMode;

    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    if (currentMode && sessionId && !silent) {
      try {
        // The explicit "end" event keeps the server-side visual timeline in
        // sync when the user actively turns sharing off mid-call.
        const formData = new FormData();
        formData.append("mode", currentMode);
        formData.append("event", "end");
        formData.append("sessionId", sessionId);
        formData.append("timestamp", new Date().toISOString());

        await fetch(`/api/personas/${personaId}/live/perception`, {
          method: "POST",
          body: formData,
        });
      } catch {
        // Preserve the live call even if the visual teardown request fails.
      }
    }

    visualStreamRef.current?.getTracks().forEach((track) => track.stop());
    visualStreamRef.current = null;
    if (hiddenVideoRef.current) {
      hiddenVideoRef.current.srcObject = null;
    }

    if (currentMode && status.value === "connected") {
      const optimisticContext = optimisticVisualContextText(sessionContextText, currentMode, false);
      sendSessionSettings({
        context: {
          text: optimisticContext,
          type: "persistent",
        },
        variables: {
          soul_visual_active: false,
          soul_visual_mode: "none",
        },
      });
      setSessionContextText(optimisticContext);
    }

    setActiveVisualMode(null);
    setActiveMode("voice");
  }

  const stopVisualSharingOnEffect = useEffectEvent((silent = false) => {
    void stopVisualSharing(silent);
  });

  const fetchLiveContext = useEffectEvent(async (activeSessionId: string) => {
    const response = await fetch(
      `/api/personas/${personaId}/live/context?sessionId=${encodeURIComponent(
        activeSessionId,
      )}&afterVersion=${contextVersionRef.current}`,
    );

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as LiveContextResponse;
  });

  useEffect(() => {
    if (!liveConnected || !sessionId) {
      return;
    }

    let consecutiveFailures = 0;
    let cancelled = false;

    const poll = async () => {
      try {
        const payload = await fetchLiveContext(sessionId);
        if (!payload || cancelled) {
          consecutiveFailures += 1;
          return;
        }

        consecutiveFailures = 0;
        // The hook stores the new frame and lets the delivery effect above
        // decide whether it is actually newer than what the client has seen.
        if (payload.sessionFrame) {
          setPendingSessionFrame(payload.sessionFrame);
        }
      } catch {
        consecutiveFailures += 1;
      }
    };

    void poll();
    const interval = setInterval(() => {
      if (consecutiveFailures >= 8) {
        return;
      }

      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [liveConnected, sessionId, setPendingSessionFrame]);

  useEffect(() => {
    if (status.value === "connected" || !visualStreamRef.current) {
      return;
    }

    void stopVisualSharingOnEffect(true);
  }, [status.value]);

  useEffect(() => {
    return () => {
      void stopVisualSharingOnEffect(true);
    };
  }, []);

  async function postVisualPerception(input: {
    mode: Extract<LiveSessionMode, "screen" | "camera">;
    event: "frame" | "start" | "end";
    sessionIdentifier?: string;
    imageFile?: File;
  }) {
    const currentSessionId = input.sessionIdentifier ?? sessionId;
    if (!currentSessionId) {
      return;
    }

    const formData = new FormData();
    formData.append("mode", input.mode);
    formData.append("event", input.event);
    formData.append("sessionId", currentSessionId);
    formData.append("timestamp", new Date().toISOString());
    if (input.imageFile) {
      formData.append("image", input.imageFile);
    }

    const response = await fetch(`/api/personas/${personaId}/live/perception`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? "Unable to process visual context.");
    }

    const payload = (await response.json()) as LivePerceptionResponse;
    if (payload.sessionFrame) {
      setPendingSessionFrame(payload.sessionFrame);
    }
  }

  async function requestVisualStream(mode: Extract<LiveSessionMode, "screen" | "camera">) {
    if (mode === "screen") {
      return navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
    }

    return navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
      },
      audio: false,
    });
  }

  async function captureAndSendFrame(
    mode: Extract<LiveSessionMode, "screen" | "camera">,
    stream: MediaStream,
    sessionIdentifier?: string,
  ) {
    if (captureInFlightRef.current) {
      return;
    }

    const video = hiddenVideoRef.current;
    if (!video || stream !== visualStreamRef.current) {
      return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    captureInFlightRef.current = true;

    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(960 / video.videoWidth, 1);
      canvas.width = Math.max(320, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(180, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.72);
      });

      if (!blob) {
        return;
      }

      const imageFile = new File([blob], `${mode}-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });

      await postVisualPerception({
        mode,
        event: "frame",
        sessionIdentifier,
        imageFile,
      });
    } catch (error) {
      setVisualError(resolveErrorMessage(error));
    } finally {
      captureInFlightRef.current = false;
    }
  }

  async function activateVisualSharing(
    mode: Extract<LiveSessionMode, "screen" | "camera">,
    stream: MediaStream,
    sessionIdentifier?: string,
  ) {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    visualStreamRef.current?.getTracks().forEach((track) => track.stop());
    visualStreamRef.current = stream;

    const video = hiddenVideoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    }

    const primaryTrack = stream.getVideoTracks()[0];
    if (primaryTrack) {
      primaryTrack.onended = () => {
        setVisualError(mode === "screen" ? "Screen sharing ended." : "Camera sharing ended.");
        void stopVisualSharing(true);
      };
    }

    setActiveMode(mode);
    setActiveVisualMode(mode);
    setVisualError(null);

    const optimisticContext = optimisticVisualContextText(sessionContextText, mode, true);
    sendSessionSettings({
      context: {
        text: optimisticContext,
        type: "persistent",
      },
      variables: {
        soul_visual_active: true,
        soul_visual_mode: mode,
      },
    });
    setSessionContextText(optimisticContext);

    try {
      await postVisualPerception({
        mode,
        event: "start",
        sessionIdentifier,
      });
      await captureAndSendFrame(mode, stream, sessionIdentifier);
    } catch (error) {
      setVisualError(resolveErrorMessage(error));
    }

    captureIntervalRef.current = setInterval(() => {
      void captureAndSendFrame(mode, stream, sessionIdentifier);
    }, 12000);
  }

  async function startLiveSession(mode: LiveSessionMode) {
    if (isLocked || liveConnected || liveConnecting) {
      return;
    }

    setLiveError(null);
    setVisualError(null);
    setIsPreparingLive(true);
    setLiveState("thinking");
    userEndedLiveRef.current = false;
    resetLiveSessionArtifacts();

    let preparedVisualStream: MediaStream | null = null;

    try {
      if (mode !== "voice") {
        try {
          preparedVisualStream = await requestVisualStream(mode);
        } catch (error) {
          setVisualError(resolveErrorMessage(error));
        }
      }

      const response = await fetch(`/api/personas/${personaId}/live`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
        }),
      });
      const payload = (await response.json()) as LiveSessionResponse | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Unable to start live conversation.");
      }

      const session = payload as LiveSessionResponse;
      setActiveMode(preparedVisualStream && session.mode !== "voice" ? session.mode : "voice");
      setSessionId(session.sessionSettings.customSessionId);
      setSessionContextText(session.sessionSettings.context?.text ?? "");
      setSessionContextVersion(session.soulFrame.liveDeliveryVersion);

      await connect({
        auth: {
          type: "accessToken",
          value: session.accessToken,
        },
        hostname: session.hostname,
        verboseTranscription: false,
      });

      sendSessionSettings({
        ...session.sessionSettings,
      });

      if (preparedVisualStream && session.mode !== "voice") {
        await activateVisualSharing(
          session.mode,
          preparedVisualStream,
          session.sessionSettings.customSessionId,
        );
      }
    } catch (error) {
      preparedVisualStream?.getTracks().forEach((track) => track.stop());
      setSessionContextText("");
      setSessionContextVersion(0);
      setSessionId(null);
      setActiveMode("voice");
      setLiveError(resolveErrorMessage(error));
      setLiveState("idle");
    } finally {
      setIsPreparingLive(false);
    }
  }

  async function endLiveSession() {
    setLiveError(null);
    userEndedLiveRef.current = true;
    await stopVisualSharing(true);
    if (sessionId) {
      await fetch(`/api/personas/${personaId}/live/end`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          mode: activeMode,
          reason: "user_end",
        }),
      }).catch(() => undefined);
    }
    await disconnect().catch((error) => {
      userEndedLiveRef.current = false;
      setLiveError(resolveErrorMessage(error));
    });
    setSessionContextText("");
    setSessionContextVersion(0);
    setPendingSessionFrame(null);
    setSessionId(null);
    setLiveState("idle");
  }

  async function switchMode(nextMode: LiveSessionMode) {
    if (isLocked || liveConnecting) {
      return;
    }

    if (
      liveConnected &&
      ((nextMode === "voice" && !activeVisualMode) || activeVisualMode === nextMode)
    ) {
      return;
    }

    if (!liveConnected) {
      await startLiveSession(nextMode);
      return;
    }

    if (nextMode === "voice") {
      setVisualError(null);
      await stopVisualSharing();
      return;
    }

    try {
      const stream = await requestVisualStream(nextMode);
      await stopVisualSharing();
      await activateVisualSharing(nextMode, stream);
    } catch (error) {
      setVisualError(resolveErrorMessage(error));
    }
  }

  return {
    activeVisualMode,
    callDurationTimestamp,
    callIssue: liveError || visualError,
    endLiveSession,
    hiddenVideoRef,
    isAudioMuted,
    isMuted,
    liveConnected,
    liveConnecting,
    minimalStatus,
    modeLabel,
    mute,
    muteAudio,
    orbScale,
    startLiveSession,
    switchMode,
    unmute,
    unmuteAudio,
  };
}
