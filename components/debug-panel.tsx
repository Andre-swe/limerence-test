"use client";

import { useEffect, useState } from "react";
import { Bug } from "lucide-react";

type AwakeningScheduleData = {
  recurrence: string;
  targetHour: number;
  jitterMinutes: number;
  reason: string;
  sourceUtterance: string;
  active: boolean;
  lastFiredAt: string | null;
  fireCount: number;
  skipCount: number;
  awakeningKind?: string;
};

type TraceData = {
  personaName?: string;
  activeProcess?: string;
  internalState?: {
    currentThought: string;
    mood: string;
    energy: number;
    patience: number;
    warmthTowardUser: number;
    engagementDrive: number;
    recentThoughts: Array<{ thought: string; createdAt: string }>;
  };
  memoryClaims?: Array<{ summary: string; status: string; kind: string; awakeningSchedule?: AwakeningScheduleData }>;
  contradictedClaims?: Array<{ summary: string }>;
  timezone?: string;
  settingsDiagnostics?: {
    nextHeartbeatAt?: string;
    nextAwakeningAt?: string;
    pendingInternalEventCount?: number;
    pendingShadowTurnCount?: number;
    quietReason?: string;
  };
};

/** Debug panel that shows the persona's internal state and recent thoughts. */
export function DebugPanel({ personaId }: { personaId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [trace, setTrace] = useState<TraceData | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/personas/${personaId}/soul/trace`);
        if (response.ok && !cancelled) {
          setTrace(await response.json());
        }
      } catch {
        // Silently fail — debug panel is non-critical
      }
    };

    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, personaId]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.9)] text-[var(--sage)] shadow-md backdrop-blur-sm"
        title="Debug: persona internal state"
      >
        <Bug className="h-4 w-4" />
      </button>

      {isOpen && trace ? (
        <div className="absolute bottom-12 right-0 w-80 max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.95)] p-4 shadow-xl backdrop-blur-md text-xs">
          <p className="eyebrow mb-3">Internal State — {trace.personaName}</p>

          {trace.internalState ? (
            <>
              <div className="space-y-2">
                <div>
                  <p className="font-medium text-[var(--sage-deep)]">Current Thought</p>
                  <p className="mt-0.5 italic text-[rgba(29,38,34,0.6)]">
                    {trace.internalState.currentThought || "—"}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-[var(--sage-deep)]">Mood</p>
                  <p className="mt-0.5 text-[rgba(29,38,34,0.6)]">{trace.internalState.mood}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[rgba(29,38,34,0.4)]">Energy</p>
                    <p className="font-mono">{trace.internalState.energy.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[rgba(29,38,34,0.4)]">Patience</p>
                    <p className="font-mono">{trace.internalState.patience.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[rgba(29,38,34,0.4)]">Warmth</p>
                    <p className="font-mono">{trace.internalState.warmthTowardUser.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[rgba(29,38,34,0.4)]">Engagement</p>
                    <p className="font-mono">{trace.internalState.engagementDrive.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              {trace.internalState.recentThoughts.length > 0 ? (
                <div className="mt-3">
                  <p className="font-medium text-[var(--sage-deep)]">Recent Thoughts</p>
                  <div className="mt-1 space-y-1">
                    {trace.internalState.recentThoughts.slice(0, 5).map((t, i) => (
                      <p key={i} className="italic text-[rgba(29,38,34,0.5)]">
                        &ldquo;{t.thought}&rdquo;
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-[rgba(29,38,34,0.4)]">No internal state yet.</p>
          )}

          <div className="divider-soft my-3" />

          <p className="text-[rgba(29,38,34,0.4)]">
            Process: <span className="font-mono">{trace.activeProcess}</span>
          </p>
          {trace.timezone || trace.settingsDiagnostics ? (
            <div className="mt-3 rounded-lg border border-[var(--line)] p-2">
              <p className="font-medium text-[var(--sage-deep)]">Timing</p>
              {trace.timezone ? (
                <p className="mt-1 text-[rgba(29,38,34,0.5)]">
                  Timezone: <span className="font-mono">{trace.timezone}</span>
                </p>
              ) : null}
              {trace.settingsDiagnostics?.quietReason ? (
                <p className="mt-1 text-[rgba(29,38,34,0.5)]">
                  Quiet now: {trace.settingsDiagnostics.quietReason}
                </p>
              ) : (
                <p className="mt-1 text-[rgba(29,38,34,0.5)]">Quiet now: no active silence boundary</p>
              )}
              <div className="mt-1 grid grid-cols-2 gap-1 text-[rgba(29,38,34,0.4)]">
                <p>
                  Next heartbeat:{" "}
                  <span className="font-mono">
                    {trace.settingsDiagnostics?.nextHeartbeatAt
                      ? new Date(trace.settingsDiagnostics.nextHeartbeatAt).toLocaleString()
                      : "---"}
                  </span>
                </p>
                <p>
                  Next awakening:{" "}
                  <span className="font-mono">
                    {trace.settingsDiagnostics?.nextAwakeningAt
                      ? new Date(trace.settingsDiagnostics.nextAwakeningAt).toLocaleString()
                      : "---"}
                  </span>
                </p>
                <p>
                  Pending events:{" "}
                  <span className="font-mono">
                    {trace.settingsDiagnostics?.pendingInternalEventCount ?? 0}
                  </span>
                </p>
                <p>
                  Shadow turns:{" "}
                  <span className="font-mono">
                    {trace.settingsDiagnostics?.pendingShadowTurnCount ?? 0}
                  </span>
                </p>
              </div>
            </div>
          ) : null}

          {(() => {
            const awakenings = trace.memoryClaims?.filter(
              (c) => c.kind === "ritual" && c.awakeningSchedule?.active,
            );
            if (!awakenings || awakenings.length === 0) return null;
            return (
              <div className="mt-3">
                <p className="font-medium text-[var(--sage-deep)]">Scheduled Awakenings</p>
                <div className="mt-1 space-y-2">
                  {awakenings.map((r, i) => {
                    const s = r.awakeningSchedule!;
                    const windowStart = Math.max(0, s.targetHour * 60 - s.jitterMinutes);
                    const windowEnd = Math.min(1439, s.targetHour * 60 + s.jitterMinutes);
                    const fmtTime = (mins: number) =>
                      `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
                    return (
                      <div key={i} className="rounded-lg border border-[var(--line)] p-2">
                        <p className="text-[rgba(29,38,34,0.7)]">{r.summary}</p>
                        {s.awakeningKind && s.awakeningKind !== "ritual" ? (
                          <p className="mt-0.5 text-[rgba(29,38,34,0.5)] italic">{s.awakeningKind}</p>
                        ) : null}
                        <div className="mt-1 grid grid-cols-2 gap-1 text-[rgba(29,38,34,0.4)]">
                          <p>
                            Schedule: <span className="font-mono">{s.recurrence} ~{s.targetHour}:00</span>
                          </p>
                          <p>
                            Window: <span className="font-mono">{fmtTime(windowStart)}-{fmtTime(windowEnd)}</span>
                          </p>
                          <p>
                            Fired: <span className="font-mono">{s.fireCount}</span>
                          </p>
                          <p>
                            Skipped: <span className="font-mono">{s.skipCount}</span>
                          </p>
                        </div>
                        {s.lastFiredAt ? (
                          <p className="mt-1 text-[rgba(29,38,34,0.35)]">
                            Last: {new Date(s.lastFiredAt).toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {trace.contradictedClaims && trace.contradictedClaims.length > 0 ? (
            <div className="mt-2">
              <p className="font-medium text-[var(--danger)]">Contradicted</p>
              {trace.contradictedClaims.slice(0, 3).map((c, i) => (
                <p key={i} className="mt-0.5 text-[rgba(29,38,34,0.4)] line-through">{c.summary}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
