"use client";

import { VoiceProvider, useVoice } from "@humeai/voice-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  Camera,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { LiveSessionMode, PersonaStatus, SoulSessionFrame } from "@/lib/types";

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

type LiveTranscriptResponse = {
  contextualUpdate?: string;
  sessionFrame?: SoulSessionFrame;
};

type LiveContextResponse = {
  pendingJobs?: number;
  sessionFrame?: SoulSessionFrame;
};

type LiveState = "idle" | "listening" | "thinking" | "replying";

type VoiceEvent = {
  type: string;
  receivedAt: Date;
  [key: string]: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUserMessageEvent(
  event: VoiceEvent,
): event is VoiceEvent & {
  fromText?: boolean;
  interim?: boolean;
  language?: string;
  message?: { content?: string };
  models?: {
    prosody?: {
      scores?: Record<string, number>;
    };
  };
  time?: { begin?: number; end?: number };
  type: "user_message";
} {
  return event.type === "user_message";
}

function isAssistantMessageEvent(
  event: VoiceEvent,
): event is VoiceEvent & {
  fromText?: boolean;
  id?: string;
  language?: string;
  message?: { content?: string };
  models?: {
    prosody?: {
      scores?: Record<string, number>;
    };
  };
  type: "assistant_message";
} {
  return event.type === "assistant_message";
}

function isSocketErrorEvent(
  event: VoiceEvent,
): event is VoiceEvent & {
  code?: string;
  message?: string;
  slug?: string;
  type: "error";
} {
  return event.type === "error";
}

function resolveEventText(event: VoiceEvent) {
  const maybeMessage = isObject(event.message) ? event.message : null;
  return typeof maybeMessage?.content === "string" ? maybeMessage.content.trim() : "";
}

function resolveProsodyScores(event: VoiceEvent) {
  const maybeModels = isObject(event.models) ? event.models : null;
  const maybeProsody = maybeModels && isObject(maybeModels.prosody) ? maybeModels.prosody : null;
  const maybeScores = maybeProsody && isObject(maybeProsody.scores) ? maybeProsody.scores : null;

  if (!maybeScores) {
    return undefined;
  }

  const entries = Object.entries(maybeScores).filter((entry): entry is [string, number] => {
    return typeof entry[1] === "number";
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function resolveErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (isObject(error) && typeof error.message === "string") {
    return error.message;
  }

  return "Something went wrong.";
}

function averageLevel(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sample = values.slice(0, 24);
  const total = sample.reduce((sum, value) => sum + value, 0);
  return total / sample.length;
}

function statusCopyFor(state: LiveState) {
  switch (state) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "replying":
      return "Speaking";
    case "idle":
      return "Ready";
  }
}

function modeLabel(mode: LiveSessionMode) {
  switch (mode) {
    case "voice":
      return "Talk";
    case "screen":
      return "Screen";
    case "camera":
      return "Camera";
  }
}

function optimisticVisualContextText(
  current: string,
  mode: Extract<LiveSessionMode, "screen" | "camera">,
  active: boolean,
) {
  const note = active
    ? mode === "screen"
      ? "VISUAL_CONTEXT\nScreen sharing is active right now. You can see the user's shared screen, even if detailed observations are still arriving."
      : "VISUAL_CONTEXT\nCamera sharing is active right now. You can see the user's camera view, even if detailed observations are still arriving."
    : mode === "screen"
      ? "VISUAL_CONTEXT\nScreen sharing has ended. Do not imply you can still see the user's screen."
      : "VISUAL_CONTEXT\nCamera sharing has ended. Do not imply you can still see the user's surroundings.";

  if (!current.trim()) {
    return note;
  }

  const cleaned = current.replace(
    /VISUAL_CONTEXT\n[\s\S]*?(?=\n\n[A-Z_]+\n|$)/g,
    "",
  ).trim();

  return `${cleaned}\n\n${note}`;
}

type ConversationPanelProps = {
  personaId: string;
  personaName: string;
  personaStatus: PersonaStatus;
};

export function ConversationPanel({
  personaId,
  personaName,
  personaStatus,
}: ConversationPanelProps) {
  const [isPreparingLive, setIsPreparingLive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [pendingSessionFrame, setPendingSessionFrame] = useState<SoulSessionFrame | null>(null);
  const [sessionContextText, setSessionContextText] = useState("");
  const [sessionContextVersion, setSessionContextVersion] = useState(0);
  const [activeMode, setActiveMode] = useState<LiveSessionMode>("voice");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeVisualMode, setActiveVisualMode] = useState<Extract<
    LiveSessionMode,
    "screen" | "camera"
  > | null>(null);
  const persistedLiveEventsRef = useRef(new Set<string>());
  const userEndedLiveRef = useRef(false);

  const isLocked = personaStatus !== "active";

  function resetLiveSessionArtifacts() {
    persistedLiveEventsRef.current.clear();
  }

  async function persistLiveTranscript(input: {
    role: "user" | "assistant";
    body: string;
    eventId: string;
    fromText?: boolean;
    language?: string;
    prosodyScores?: Record<string, number>;
  }) {
    if (persistedLiveEventsRef.current.has(input.eventId)) {
      return;
    }

    persistedLiveEventsRef.current.add(input.eventId);

    try {
      const response = await fetch(`/api/personas/${personaId}/live/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          liveMode: activeMode,
          sessionId: sessionId ?? undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to save live transcript.");
      }

      const payload = (await response.json()) as LiveTranscriptResponse;
      if (payload.sessionFrame) {
        setPendingSessionFrame(payload.sessionFrame);
      }
    } catch (error) {
      persistedLiveEventsRef.current.delete(input.eventId);
      setLiveError(resolveErrorMessage(error));
    }
  }

  function handleVoiceEvent(rawEvent: VoiceEvent) {
    if (isSocketErrorEvent(rawEvent)) {
      const detail = [rawEvent.code, rawEvent.slug].filter(Boolean).join(" · ");
      setLiveError(
        detail
          ? `${rawEvent.message ?? "Live session error."} (${detail})`
          : rawEvent.message ?? "Live session error.",
      );
      setLiveState("idle");
      return;
    }

    if (rawEvent.type === "user_interruption") {
      setLiveState("listening");
      return;
    }

    if (isUserMessageEvent(rawEvent)) {
      if (rawEvent.interim) {
        return;
      }

      const transcript = resolveEventText(rawEvent);
      if (!transcript) {
        return;
      }

      const begin =
        isObject(rawEvent.time) && typeof rawEvent.time.begin === "number"
          ? rawEvent.time.begin
          : rawEvent.receivedAt.getTime();
      const end =
        isObject(rawEvent.time) && typeof rawEvent.time.end === "number"
          ? rawEvent.time.end
          : rawEvent.receivedAt.getTime();

      setLiveState("thinking");
      void persistLiveTranscript({
        role: "user",
        body: transcript,
        eventId: `user:${begin}-${end}`,
        fromText: rawEvent.fromText,
        language: rawEvent.language,
        prosodyScores: resolveProsodyScores(rawEvent),
      });
      return;
    }

    if (isAssistantMessageEvent(rawEvent)) {
      const transcript = resolveEventText(rawEvent);
      if (!transcript) {
        return;
      }

      void persistLiveTranscript({
        role: "assistant",
        body: transcript,
        eventId:
          typeof rawEvent.id === "string" && rawEvent.id
            ? `assistant:${rawEvent.id}`
            : `assistant:${rawEvent.receivedAt.toISOString()}:${transcript.slice(0, 60)}`,
        fromText: rawEvent.fromText,
        language: rawEvent.language,
        prosodyScores: resolveProsodyScores(rawEvent),
      });
    }
  }

  return (
    <VoiceProvider
      clearMessagesOnDisconnect
      onError={(error) => {
        setLiveError(resolveErrorMessage(error));
        setLiveState("idle");
      }}
      onInterruption={() => {
        setLiveState("listening");
      }}
      onMessage={(event) => {
        handleVoiceEvent(event as VoiceEvent);
      }}
      onOpen={() => {
        userEndedLiveRef.current = false;
        setLiveError(null);
        setLiveState("listening");
      }}
      onClose={(event) => {
        const closingSessionId = sessionId;
        const closingMode = activeMode;
        const endedByUser = userEndedLiveRef.current;
        if (!userEndedLiveRef.current) {
          const reason = event.reason?.trim();
          const message =
            reason ||
            (event.code
              ? `The live session ended unexpectedly (${event.code}).`
              : "The live session ended unexpectedly.");
          setLiveError(message);
        }
        if (closingSessionId && !endedByUser) {
          void fetch(`/api/personas/${personaId}/live/end`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sessionId: closingSessionId,
              mode: closingMode,
              reason: "disconnect",
            }),
          }).catch(() => undefined);
        }
        setLiveState("idle");
        setSessionContextText("");
        setSessionContextVersion(0);
        setPendingSessionFrame(null);
        setSessionId(null);
        setActiveMode("voice");
        setActiveVisualMode(null);
        userEndedLiveRef.current = false;
      }}
    >
      <ConversationPanelInner
        activeMode={activeMode}
        activeVisualMode={activeVisualMode}
        isLocked={isLocked}
        isPreparingLive={isPreparingLive}
        liveError={liveError}
        liveState={liveState}
        pendingSessionFrame={pendingSessionFrame}
        personaId={personaId}
        personaName={personaName}
        resetLiveSessionArtifacts={resetLiveSessionArtifacts}
        sessionContextText={sessionContextText}
        sessionContextVersion={sessionContextVersion}
        sessionId={sessionId}
        setActiveMode={setActiveMode}
        setActiveVisualMode={setActiveVisualMode}
        setIsPreparingLive={setIsPreparingLive}
        setLiveError={setLiveError}
        setLiveState={setLiveState}
        setPendingSessionFrame={setPendingSessionFrame}
        setSessionContextText={setSessionContextText}
        setSessionContextVersion={setSessionContextVersion}
        setSessionId={setSessionId}
        setVisualError={setVisualError}
        userEndedLiveRef={userEndedLiveRef}
        visualError={visualError}
      />
    </VoiceProvider>
  );
}

type ConversationPanelInnerProps = {
  activeMode: LiveSessionMode;
  activeVisualMode: Extract<LiveSessionMode, "screen" | "camera"> | null;
  isLocked: boolean;
  isPreparingLive: boolean;
  liveError: string | null;
  liveState: LiveState;
  pendingSessionFrame: SoulSessionFrame | null;
  personaId: string;
  personaName: string;
  resetLiveSessionArtifacts: () => void;
  sessionContextText: string;
  sessionContextVersion: number;
  sessionId: string | null;
  setActiveMode: (value: LiveSessionMode) => void;
  setActiveVisualMode: (value: Extract<LiveSessionMode, "screen" | "camera"> | null) => void;
  setIsPreparingLive: (value: boolean) => void;
  setLiveError: (value: string | null) => void;
  setLiveState: (value: LiveState | ((current: LiveState) => LiveState)) => void;
  setPendingSessionFrame: (value: SoulSessionFrame | null) => void;
  setSessionContextText: (value: string) => void;
  setSessionContextVersion: (value: number) => void;
  setSessionId: (value: string | null) => void;
  setVisualError: (value: string | null) => void;
  userEndedLiveRef: MutableRefObject<boolean>;
  visualError: string | null;
};

function ConversationPanelInner({
  activeMode,
  activeVisualMode,
  isLocked,
  isPreparingLive,
  liveError,
  liveState,
  pendingSessionFrame,
  personaId,
  personaName,
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
}: ConversationPanelInnerProps) {
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
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const visualStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureInFlightRef = useRef(false);

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

    if (pendingSessionFrame.liveDeliveryVersion <= sessionContextVersion) {
      setPendingSessionFrame(null);
      return;
    }

    sendSessionSettings({
      context: {
        text: pendingSessionFrame.contextText,
        type: "persistent",
      },
      systemPrompt: pendingSessionFrame.systemPrompt,
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

  useEffect(() => {
    if (!liveConnected || !sessionId) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/personas/${personaId}/live/context?sessionId=${encodeURIComponent(
            sessionId,
          )}&afterVersion=${sessionContextVersion}`,
        );

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as LiveContextResponse;
        if (payload.sessionFrame && !cancelled) {
          setPendingSessionFrame(payload.sessionFrame);
        }
      } catch {
        // Keep the live experience steady if a poll misses.
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [liveConnected, personaId, sessionContextVersion, sessionId, setPendingSessionFrame]);

  useEffect(() => {
    return () => {
      void stopVisualSharing(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        setVisualError(
          mode === "screen" ? "Screen sharing ended." : "Camera sharing ended.",
        );
        void stopVisualSharing();
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

  async function stopVisualSharing(silent = false) {
    const currentMode = activeVisualMode;

    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    if (currentMode && sessionId && !silent) {
      try {
        await postVisualPerception({
          mode: currentMode,
          event: "end",
        });
      } catch {
        // Keep the voice session alive even if the perception loop fails.
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
        sessionSettings: session.sessionSettings,
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

  const callIssue = liveError || visualError;

  return (
    <section className="paper-panel mx-auto max-w-3xl rounded-[42px] px-4 py-4 sm:px-6 sm:py-6">
      <video ref={hiddenVideoRef} className="hidden" muted playsInline />

      <div className="flex items-start justify-between gap-4 px-2 py-2">
        <div>
          <h2 className="serif-title text-4xl text-[var(--sage-deep)] sm:text-5xl">{personaName}</h2>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--sage)]">
            {callDurationTimestamp ?? "00:00"}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[34px] border border-[var(--line)] bg-[var(--call-surface)] px-4 py-8 sm:px-6 sm:py-10">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <div className="call-orb-shell">
            <div className="call-orb-ring" />
            <div className="call-orb-ring call-orb-ring-soft" />
            <div
              className={`call-orb-core ${liveConnected || liveConnecting ? "orb-breathe" : ""}`}
              style={{ transform: `scale(${orbScale})` }}
            />
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.78)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--sage-deep)]">
              {minimalStatus}
            </div>
            {liveConnected ? (
              <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.54)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--sage)]">
                {activeVisualMode ? `${modeLabel(activeVisualMode)} active` : "Talk only"}
              </div>
            ) : null}
          </div>

          {callIssue || isLocked ? (
            <div className="mt-5 max-w-sm space-y-3">
              <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)]">
                {isLocked ? "Quiet for now" : "Something shifted"}
              </p>
              <p className="text-sm leading-7 text-[rgba(29,38,34,0.58)]">
                {isLocked ? "This recreation stays silent until review is complete." : callIssue}
              </p>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {(["voice", "screen", "camera"] as const).map((mode) => {
              const active = activeMode === mode && (mode === "voice" ? !activeVisualMode : activeVisualMode === mode);
              const Icon = mode === "voice" ? Mic : mode === "screen" ? MonitorUp : Camera;

              return (
                <button
                  key={mode}
                  type="button"
                  disabled={isLocked || liveConnecting}
                  onClick={() => {
                    void switchMode(mode);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? "border-transparent bg-[var(--sage-deep)] text-white"
                      : "border-[var(--line)] bg-[rgba(255,255,255,0.8)] text-[var(--sage-deep)]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {mode === "voice" ? "Talk" : mode === "screen" ? "Share screen" : "Use camera"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[28px] border border-[var(--line)] bg-[var(--call-bar)] p-3">
        <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            disabled={!liveConnected || isLocked}
            onClick={() => {
              if (isMuted) {
                unmute();
                return;
              }

              mute();
            }}
            className="call-control"
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            <span>{isMuted ? "Unmute" : "Mute"}</span>
          </button>

          <button
            type="button"
            disabled={isLocked || liveConnecting}
            onClick={() => {
              if (liveConnected) {
                void endLiveSession();
                return;
              }

              void startLiveSession(activeMode);
            }}
            className={`call-control ${
              liveConnected
                ? "border-[rgba(122,63,58,0.18)] bg-[rgba(122,63,58,0.08)] text-[var(--danger)]"
                : "bg-[var(--sage-deep)] text-white"
            }`}
          >
            {liveConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : liveConnected ? (
              <Square className="h-4 w-4" />
            ) : activeMode === "screen" ? (
              <MonitorUp className="h-4 w-4" />
            ) : activeMode === "camera" ? (
              <Camera className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            <span>{liveConnecting ? "Connecting" : liveConnected ? "End" : modeLabel(activeMode)}</span>
          </button>

          <button
            type="button"
            disabled={!liveConnected || isLocked}
            onClick={() => {
              if (isAudioMuted) {
                unmuteAudio();
                return;
              }

              muteAudio();
            }}
            className="call-control"
          >
            {isAudioMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            <span>{isAudioMuted ? "Hear" : "Quiet"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
