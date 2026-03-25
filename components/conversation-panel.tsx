"use client";

import { VoiceProvider } from "@humeai/voice-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  isAssistantMessageEvent,
  isObject,
  isSocketErrorEvent,
  isUserMessageEvent,
  resolveErrorMessage,
  resolveEventText,
  resolveProsodyScores,
  type LiveState,
  type VoiceEvent,
} from "@/components/conversation-panel-live-utils";
import {
  ConversationPanelControls,
  ConversationPanelStage,
} from "@/components/conversation-panel-sections";
import { useConversationPanelLive } from "@/components/use-conversation-panel-live";
import { useOnboardingActions } from "@/components/onboarding";
import { friendlyErrors, parseErrorType } from "@/components/thinking-indicator";
import type { LiveSessionMode, PersonaStatus, SoulSessionFrame } from "@/lib/types";

type ReconnectionState = "connected" | "reconnecting" | "failed" | "idle";

type LiveTranscriptResponse = {
  contextualUpdate?: string;
  sessionFrame?: SoulSessionFrame;
};

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
  const { markCallMade } = useOnboardingActions();
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
  const [reconnectionState, setReconnectionState] = useState<ReconnectionState>("idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [nextRetryIn, setNextRetryIn] = useState<number | null>(null);
  const persistedLiveEventsRef = useRef(new Set<string>());
  const userEndedLiveRef = useRef(false);
  const activeModeRef = useRef(activeMode);
  const sessionIdRef = useRef(sessionId);
  const lastSessionStateRef = useRef<{
    mode: LiveSessionMode;
    sessionId: string | null;
    contextText: string;
    contextVersion: number;
  } | null>(null);
  activeModeRef.current = activeMode;
  sessionIdRef.current = sessionId;

  const isLocked = personaStatus !== "active";

  // Store session state for potential reconnection
  const saveSessionState = useCallback(() => {
    if (sessionId) {
      lastSessionStateRef.current = {
        mode: activeMode,
        sessionId,
        contextText: sessionContextText,
        contextVersion: sessionContextVersion,
      };
    }
  }, [activeMode, sessionId, sessionContextText, sessionContextVersion]);

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
          liveMode: activeModeRef.current,
          sessionId: sessionIdRef.current ?? undefined,
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
      const errorType = parseErrorType(error);
      const friendly = friendlyErrors[errorType];
      setLiveError(friendly.message);
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
        setReconnectionState("connected");
        setReconnectAttempt(0);
        setNextRetryIn(null);
        // Mark call made for onboarding
        markCallMade();
      }}
      onClose={(event) => {
        const closingSessionId = sessionId;
        const closingMode = activeMode;
        const endedByUser = userEndedLiveRef.current;

        // Save session state before clearing for potential reconnection
        saveSessionState();

        if (!endedByUser) {
          const reason = event.reason?.trim();
          const isNetworkError = event.code === 1006 || event.code === 1001;
          
          if (isNetworkError && lastSessionStateRef.current) {
            // Network disconnection - attempt reconnection
            setReconnectionState("reconnecting");
            setLiveState("idle");
            // Don't clear session state yet - we'll try to reconnect
            return;
          }

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
        setReconnectionState("idle");
        userEndedLiveRef.current = false;
        lastSessionStateRef.current = null;
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
        reconnectionState={reconnectionState}
        reconnectAttempt={reconnectAttempt}
        nextRetryIn={nextRetryIn}
        setReconnectionState={setReconnectionState}
        setReconnectAttempt={setReconnectAttempt}
        setNextRetryIn={setNextRetryIn}
        lastSessionStateRef={lastSessionStateRef}
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
  reconnectionState: ReconnectionState;
  reconnectAttempt: number;
  nextRetryIn: number | null;
  setReconnectionState: Dispatch<SetStateAction<ReconnectionState>>;
  setReconnectAttempt: Dispatch<SetStateAction<number>>;
  setNextRetryIn: Dispatch<SetStateAction<number | null>>;
  lastSessionStateRef: MutableRefObject<{
    mode: LiveSessionMode;
    sessionId: string | null;
    contextText: string;
    contextVersion: number;
  } | null>;
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

function ConversationPanelInner(props: ConversationPanelInnerProps) {
  const {
    callDurationTimestamp,
    callIssue,
    endLiveSession,
    hiddenVideoRef,
    isAudioMuted,
    isMuted,
    liveConnected,
    liveConnecting,
    minimalStatus,
    mute,
    muteAudio,
    orbScale,
    startLiveSession,
    switchMode,
    unmute,
    unmuteAudio,
  } = useConversationPanelLive(props);

  const { 
    activeMode, 
    activeVisualMode, 
    isLocked, 
    liveState, 
    personaName,
    reconnectionState,
    reconnectAttempt,
    nextRetryIn,
    setReconnectionState,
    setReconnectAttempt,
    setNextRetryIn,
    lastSessionStateRef,
  } = props;

  const isReconnecting = reconnectionState === "reconnecting";

  // Handle reconnection with exponential backoff
  const attemptReconnect = useCallback(async () => {
    if (!lastSessionStateRef.current) {
      setReconnectionState("failed");
      return;
    }

    const savedState = lastSessionStateRef.current;
    setReconnectAttempt((prev) => prev + 1);

    try {
      // Try to start a new session with the saved mode
      await startLiveSession(savedState.mode);
      setReconnectionState("connected");
      setReconnectAttempt(0);
      setNextRetryIn(null);
    } catch {
      // Will be handled by the backoff logic
    }
  }, [lastSessionStateRef, setReconnectionState, setReconnectAttempt, setNextRetryIn, startLiveSession]);

  // Exponential backoff reconnection effect
  useEffect(() => {
    if (reconnectionState !== "reconnecting") return;

    const maxAttempts = 5;
    const baseDelay = 1000;
    const maxDelay = 30000;

    if (reconnectAttempt >= maxAttempts) {
      setReconnectionState("failed");
      lastSessionStateRef.current = null;
      return;
    }

    const delay = Math.min(maxDelay, baseDelay * Math.pow(2, reconnectAttempt) + Math.random() * 1000);
    setNextRetryIn(Math.ceil(delay / 1000));

    const countdownInterval = setInterval(() => {
      setNextRetryIn((prev) => (prev && prev > 1 ? prev - 1 : null));
    }, 1000);

    const reconnectTimeout = setTimeout(() => {
      void attemptReconnect();
    }, delay);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(reconnectTimeout);
    };
  }, [reconnectionState, reconnectAttempt, attemptReconnect, setReconnectionState, setNextRetryIn, lastSessionStateRef]);

  const cancelReconnection = useCallback(() => {
    setReconnectionState("idle");
    setReconnectAttempt(0);
    setNextRetryIn(null);
    lastSessionStateRef.current = null;
  }, [setReconnectionState, setReconnectAttempt, setNextRetryIn, lastSessionStateRef]);

  const retryReconnection = useCallback(() => {
    if (!lastSessionStateRef.current) {
      setReconnectionState("failed");
      return;
    }

    setReconnectionState("reconnecting");
    setReconnectAttempt((prev) => prev + 1);
    void startLiveSession(lastSessionStateRef.current.mode);
  }, [lastSessionStateRef, setReconnectAttempt, setReconnectionState, startLiveSession]);

  const toggleLiveSession = useCallback(() => {
    if (liveConnected) {
      void endLiveSession();
      return;
    }

    void startLiveSession(activeMode);
  }, [activeMode, endLiveSession, liveConnected, startLiveSession]);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      unmute();
      return;
    }

    mute();
  }, [isMuted, mute, unmute]);

  const toggleAudio = useCallback(() => {
    if (isAudioMuted) {
      unmuteAudio();
      return;
    }

    muteAudio();
  }, [isAudioMuted, muteAudio, unmuteAudio]);

  return (
    <section className="paper-panel mx-auto max-w-3xl rounded-[42px] px-4 py-4 sm:px-6 sm:py-6">
      <video ref={hiddenVideoRef} className="hidden" muted playsInline />

      <ConversationPanelStage
        personaName={personaName}
        callDurationTimestamp={callDurationTimestamp ?? undefined}
        liveState={liveState}
        liveConnected={liveConnected}
        liveConnecting={liveConnecting}
        orbScale={orbScale}
        activeMode={activeMode}
        activeVisualMode={activeVisualMode}
        isLocked={isLocked}
        isReconnecting={isReconnecting}
        reconnectionFailed={reconnectionState === "failed"}
        reconnectAttempt={reconnectAttempt}
        nextRetryIn={nextRetryIn}
        callIssue={callIssue}
        minimalStatus={minimalStatus}
        onSwitchMode={(mode) => {
          void switchMode(mode);
        }}
        onCancelReconnection={cancelReconnection}
        onRetryReconnection={retryReconnection}
      />

      <ConversationPanelControls
        liveConnected={liveConnected}
        liveConnecting={liveConnecting}
        isLocked={isLocked}
        isMuted={isMuted}
        isAudioMuted={isAudioMuted}
        activeMode={activeMode}
        onToggleMute={toggleMute}
        onToggleAudio={toggleAudio}
        onToggleLive={toggleLiveSession}
      />
    </section>
  );
}
