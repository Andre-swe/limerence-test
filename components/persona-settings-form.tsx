"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";

type PersonaSettingsView = {
  timezone: string;
  heartbeatPolicy: {
    intervalHours: number;
    quietHoursStart: number;
    quietHoursEnd: number;
    preferredMode: "text" | "voice_note" | "mixed";
    enabled: boolean;
    maxOutboundPerDay: number;
    variableInterval: boolean;
  };
  deliveryChannels: {
    web: boolean;
  };
  diagnostics: {
    nextHeartbeatAt: string | null;
    nextRitualAt: string | null;
    quietReason: string | null;
    pendingInternalEventCount: number;
    pendingRitualCount: number;
    pendingShadowTurnCount: number;
  };
  preferenceSignals: Array<{
    id: string;
    effectSummary: string;
    sourceText: string;
    createdAt: string;
  }>;
};

type PersonaSettingsFormProps = {
  personaId: string;
  initialPersona: PersonaSettingsView;
};

function hourLabel(value: number) {
  const suffix = value >= 12 ? "PM" : "AM";
  const normalized = value % 12 || 12;
  return `${normalized}:00 ${suffix}`;
}

function timezonePreview(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
  } catch {
    return "Invalid timezone";
  }
}

export function PersonaSettingsForm({
  personaId,
  initialPersona,
}: PersonaSettingsFormProps) {
  const [persona, setPersona] = useState(initialPersona);
  const [timezone, setTimezone] = useState(initialPersona.timezone);
  const [intervalHours, setIntervalHours] = useState(
    initialPersona.heartbeatPolicy.intervalHours,
  );
  const [quietHoursStart, setQuietHoursStart] = useState(
    initialPersona.heartbeatPolicy.quietHoursStart,
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(
    initialPersona.heartbeatPolicy.quietHoursEnd,
  );
  const [preferredMode, setPreferredMode] = useState<
    PersonaSettingsView["heartbeatPolicy"]["preferredMode"]
  >(initialPersona.heartbeatPolicy.preferredMode);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const submit = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/personas/${personaId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timezone,
          heartbeatIntervalHours: intervalHours,
          quietHoursStart,
          quietHoursEnd,
          preferredMode,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        persona?: PersonaSettingsView;
      };

      if (!response.ok || !body.persona) {
        throw new Error(body.error ?? "Unable to save persona settings.");
      }

      setPersona(body.persona);
      setTimezone(body.persona.timezone);
      setIntervalHours(body.persona.heartbeatPolicy.intervalHours);
      setQuietHoursStart(body.persona.heartbeatPolicy.quietHoursStart);
      setQuietHoursEnd(body.persona.heartbeatPolicy.quietHoursEnd);
      setPreferredMode(body.persona.heartbeatPolicy.preferredMode);
      setSavedAt(new Date().toISOString());
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unable to save persona settings.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="paper-panel rounded-[30px] px-6 py-6 sm:px-8">
      <p className="eyebrow">Baseline Settings</p>
      <h2 className="serif-title mt-2 text-4xl text-[var(--sage-deep)]">
        Timing and delivery
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[rgba(29,38,34,0.62)]">
        These are the explicit defaults. Conversation can still teach the persona better
        boundaries and rituals over time.
      </p>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--sage-deep)]">Timezone</span>
          <input
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="input-quiet w-full"
            placeholder="America/Toronto"
            autoComplete="off"
          />
          <p className="text-xs leading-6 text-[rgba(29,38,34,0.5)]">
            Local preview: {timezonePreview(timezone)}
          </p>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--sage-deep)]">Preferred mode</span>
          <select
            value={preferredMode}
            onChange={(event) =>
              setPreferredMode(
                event.target.value as PersonaSettingsView["heartbeatPolicy"]["preferredMode"],
              )
            }
            className="input-quiet w-full"
          >
            <option value="mixed">Balanced</option>
            <option value="text">Text-first</option>
            <option value="voice_note">Voice-note leaning</option>
          </select>
        </label>

        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--sage-deep)]">
            Check-in interval (hours)
          </span>
          <input
            type="range"
            min={1}
            max={24}
            value={intervalHours}
            onChange={(event) => setIntervalHours(Number(event.target.value))}
            className="w-full"
          />
          <p className="text-xs leading-6 text-[rgba(29,38,34,0.5)]">
            Current interval: {intervalHours} hour{intervalHours === 1 ? "" : "s"}
          </p>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Quiet hours start</span>
            <select
              value={quietHoursStart}
              onChange={(event) => setQuietHoursStart(Number(event.target.value))}
              className="input-quiet w-full"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Quiet hours end</span>
            <select
              value={quietHoursEnd}
              onChange={(event) => setQuietHoursEnd(Number(event.target.value))}
              className="input-quiet w-full"
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => {
            void submit();
          }}
          className="btn-solid"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? "Saving..." : "Save settings"}
        </button>
        <p className="text-xs leading-6 text-[rgba(29,38,34,0.5)]">
          {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}.` : "Not saved yet."}
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[rgba(29,38,34,0.42)]">
            Quiet right now
          </p>
          <p className="mt-2 text-sm text-[var(--sage-deep)]">
            {persona.diagnostics.quietReason ?? "No active silence boundary."}
          </p>
        </div>
        <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[rgba(29,38,34,0.42)]">
            Next heartbeat
          </p>
          <p className="mt-2 text-sm text-[var(--sage-deep)]">
            {persona.diagnostics.nextHeartbeatAt
              ? new Date(persona.diagnostics.nextHeartbeatAt).toLocaleString()
              : "No heartbeat scheduled."}
          </p>
        </div>
        <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-[rgba(29,38,34,0.42)]">
            Next ritual
          </p>
          <p className="mt-2 text-sm text-[var(--sage-deep)]">
            {persona.diagnostics.nextRitualAt
              ? new Date(persona.diagnostics.nextRitualAt).toLocaleString()
              : "No ritual queued."}
          </p>
        </div>
      </div>
    </section>
  );
}
