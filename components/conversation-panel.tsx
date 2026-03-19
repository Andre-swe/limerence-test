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
  Camera,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  RefreshCw,
  Square,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import {
  isAssistantMessageEvent,
  isObject,
  isSocketErrorEvent,
  isUserMessageEvent,
  modeLabel,
  resolveErrorMessage,
  resolveEventText,
  resolveProsodyScores,
  type LiveState,
  type VoiceEvent,
} from "@/components/conversation-panel-live-utils";
import { useConversationPanelLive } from "@/components/use-conversation-panel-live";
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
              className={`call-orb-core ${
                liveState === "listening"
                  ? "orb-listen"
                  : liveState === "replying"
                    ? "orb-speak"
                    : liveConnected || liveConnecting
                      ? "orb-breathe"
                      : ""
              }`}
              style={{ transform: `scale(${orbScale})` }}
            />
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {isReconnecting ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(190,160,108,0.3)] bg-[rgba(190,160,108,0.12)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--gold)]">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Reconnecting{nextRetryIn ? ` in ${nextRetryIn}s` : "..."}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.78)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--sage-deep)]">
                {liveState === "thinking" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {liveState === "thinking" ? `${personaName} is thinking...` : minimalStatus}
              </div>
            )}
            {liveConnected ? (
              <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.54)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--sage)]">
                {activeVisualMode ? `${modeLabel(activeVisualMode)} active` : "Talk only"}
              </div>
            ) : null}
          </div>

          {/* Reconnection UI */}
          {isReconnecting && (
            <div className="mt-5 max-w-sm space-y-3">
              <div className="flex items-center justify-center gap-2 text-[var(--gold)]">
                <WifiOff className="h-5 w-5" />
                <p className="text-lg font-semibold tracking-[-0.02em]">
                  Connection lost
                </p>
              </div>
              <p className="meta-quiet leading-6">
                Attempting to reconnect (attempt {reconnectAttempt + 1} of 5)...
              </p>
              <button
                type="button"
                onClick={cancelReconnection}
                className="btn-pill mx-auto"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Reconnection failed UI */}
          {reconnectionState === "failed" && (
            <div className="mt-5 max-w-sm space-y-3">
              <div className="flex items-center justify-center gap-2 text-[var(--danger)]">
                <WifiOff className="h-5 w-5" />
                <p className="text-lg font-semibold tracking-[-0.02em]">
                  Unable to reconnect
                </p>
              </div>
              <p className="meta-quiet leading-6">
                The connection could not be restored. Please try starting a new call.
              </p>
              <button
                type="button"
                onClick={() => {
                  setReconnectionState("idle");
                  void startLiveSession("voice");
                }}
                className="btn-solid mx-auto"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            </div>
          )}

          {callIssue || isLocked ? (
            <div className="mt-5 max-w-sm space-y-3">
              <p className="text-xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)]">
                {isLocked ? "Quiet for now" : "Something shifted"}
              </p>
              <p className="meta-quiet leading-7">
                {isLocked ? "This person is not available yet." : callIssue}
              </p>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {(["voice", "screen", "camera"] as const).map((mode) => {
              const active =
                activeMode === mode &&
                (mode === "voice" ? !activeVisualMode : activeVisualMode === mode);
              const Icon = mode === "voice" ? Mic : mode === "screen" ? MonitorUp : Camera;

              return (
                <button
                  key={mode}
                  type="button"
                  disabled={isLocked || liveConnecting}
                  onClick={() => {
                    void switchMode(mode);
                  }}
                  className={active ? "btn-solid" : "btn-pill"}
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
            aria-label={
              liveConnecting
                ? "Connecting live session"
                : liveConnected
                  ? "End live session"
                  : `Start ${modeLabel(activeMode)} live session`
            }
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
                : "call-control-primary"
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
