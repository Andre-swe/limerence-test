"use client";

import { useEffect, useState } from "react";
import { Bug } from "lucide-react";

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
  memoryClaims?: Array<{ summary: string; status: string; kind: string }>;
  contradictedClaims?: Array<{ summary: string }>;
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
