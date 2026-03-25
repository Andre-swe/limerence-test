"use client";

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
import type { LiveSessionMode } from "@/lib/types";
import {
  modeLabel,
  type LiveState,
} from "@/components/conversation-panel-live-utils";

type ConversationPanelStageProps = {
  personaName: string;
  callDurationTimestamp: string | null | undefined;
  liveState: LiveState;
  liveConnected: boolean;
  liveConnecting: boolean;
  orbScale: number;
  activeMode: LiveSessionMode;
  activeVisualMode: Extract<LiveSessionMode, "screen" | "camera"> | null;
  isLocked: boolean;
  isReconnecting: boolean;
  reconnectionFailed: boolean;
  reconnectAttempt: number;
  nextRetryIn: number | null;
  callIssue: string | null;
  minimalStatus: string;
  onSwitchMode: (mode: LiveSessionMode) => void;
  onCancelReconnection: () => void;
  onRetryReconnection: () => void;
};

export function ConversationPanelStage({
  personaName,
  callDurationTimestamp,
  liveState,
  liveConnected,
  liveConnecting,
  orbScale,
  activeMode,
  activeVisualMode,
  isLocked,
  isReconnecting,
  reconnectionFailed,
  reconnectAttempt,
  nextRetryIn,
  callIssue,
  minimalStatus,
  onSwitchMode,
  onCancelReconnection,
  onRetryReconnection,
}: ConversationPanelStageProps) {
  return (
    <>
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
                {liveState === "thinking" && <Loader2 className="h-3 w-3 animate-spin" />}
                {liveState === "thinking" ? `${personaName} is thinking...` : minimalStatus}
              </div>
            )}
            {liveConnected ? (
              <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.54)] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[var(--sage)]">
                {activeVisualMode ? `${modeLabel(activeVisualMode)} active` : "Talk only"}
              </div>
            ) : null}
          </div>

          {isReconnecting && (
            <div className="mt-5 max-w-sm space-y-3">
              <div className="flex items-center justify-center gap-2 text-[var(--gold)]">
                <WifiOff className="h-5 w-5" />
                <p className="text-lg font-semibold tracking-[-0.02em]">Connection lost</p>
              </div>
              <p className="meta-quiet leading-6">
                Attempting to reconnect (attempt {reconnectAttempt + 1} of 5)...
              </p>
              <button type="button" onClick={onCancelReconnection} className="btn-pill mx-auto">
                Cancel
              </button>
            </div>
          )}

          {reconnectionFailed && (
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
              <button type="button" onClick={onRetryReconnection} className="btn-solid mx-auto">
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
                    onSwitchMode(mode);
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
    </>
  );
}

type ConversationPanelControlsProps = {
  liveConnected: boolean;
  liveConnecting: boolean;
  isLocked: boolean;
  isMuted: boolean;
  isAudioMuted: boolean;
  activeMode: LiveSessionMode;
  onToggleMute: () => void;
  onToggleAudio: () => void;
  onToggleLive: () => void;
};

export function ConversationPanelControls({
  liveConnected,
  liveConnecting,
  isLocked,
  isMuted,
  isAudioMuted,
  activeMode,
  onToggleMute,
  onToggleAudio,
  onToggleLive,
}: ConversationPanelControlsProps) {
  return (
    <div className="mt-4 rounded-[28px] border border-[var(--line)] bg-[var(--call-bar)] p-3">
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          disabled={!liveConnected || isLocked}
          onClick={onToggleMute}
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
          onClick={onToggleLive}
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
          onClick={onToggleAudio}
          className="call-control"
        >
          {isAudioMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          <span>{isAudioMuted ? "Hear" : "Quiet"}</span>
        </button>
      </div>
    </div>
  );
}
