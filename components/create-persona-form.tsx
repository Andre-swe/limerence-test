"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Wand2 } from "lucide-react";
import { VoiceRecorder } from "@/components/voice-recorder";
import { interviewPrompts } from "@/lib/types";
import { houseVoicePresets } from "@/lib/voice-presets";

type RecordedSample = {
  id: string;
  file: File;
  url: string;
};

export function CreatePersonaForm() {
  const router = useRouter();
  const [presencePreset, setPresencePreset] = useState<"soft" | "steady" | "close">("steady");
  const [modePreset, setModePreset] = useState<"mixed" | "text" | "voice_note">("mixed");
  const [starterVoiceId, setStarterVoiceId] = useState<string>(houseVoicePresets[0]?.id ?? "");
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sampleUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    sampleUrlsRef.current = recordedSamples.map((sample) => sample.url);
  }, [recordedSamples]);

  useEffect(() => {
    return () => {
      for (const url of sampleUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return (
    <form
      className="mx-auto max-w-4xl space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setIsSubmitting(true);
        try {
          const formData = new FormData(event.currentTarget);
          recordedSamples.forEach((sample) => {
            formData.append("voiceSamples", sample.file);
          });
          const response = await fetch("/api/personas", {
            method: "POST",
            body: formData,
          });
          const payload = (await response.json()) as { personaId: string };
          router.push(`/personas/${payload.personaId}`);
        } finally {
          setIsSubmitting(false);
        }
      }}
    >
      <input type="hidden" name="starterVoiceId" value={starterVoiceId} />
      <input
        type="hidden"
        name="heartbeatIntervalHours"
        value={presencePreset === "soft" ? "6" : presencePreset === "close" ? "2" : "4"}
      />
      <input type="hidden" name="preferredMode" value={modePreset} />

      <section className="paper-panel rounded-[34px] px-6 py-7 sm:px-8 sm:py-8">
        <p className="eyebrow">Identity</p>
        <div className="mt-3 max-w-2xl">
          <h2 className="serif-title text-4xl text-[var(--sage-deep)] sm:text-5xl">
            Begin with who they were.
          </h2>
          <p className="mt-3 text-sm leading-7 text-[rgba(29,38,34,0.62)]">
            Keep this close to memory, not performance. The voice can sharpen later. The presence
            starts here.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Name</span>
            <input
              name="name"
              required
              className="w-full rounded-[22px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
              placeholder="Mom"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Relationship</span>
            <input
              name="relationship"
              required
              className="w-full rounded-[22px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
              placeholder="Mother"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Avatar</span>
            <input
              name="avatar"
              type="file"
              accept="image/*"
              className="w-full rounded-[22px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
            />
          </label>
        </div>

        <label className="mt-5 block space-y-2">
          <span className="text-sm font-medium text-[var(--sage-deep)]">How they felt to be around</span>
          <textarea
            name="description"
            required
            rows={4}
            className="w-full rounded-[24px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
            placeholder="How they sounded, what made them distinct, what kind of emotional weather they carried."
          />
        </label>
      </section>

      <section className="paper-panel rounded-[34px] px-6 py-7 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow">Voice</p>
            <h2 className="serif-title mt-3 text-4xl text-[var(--sage-deep)]">
              Leave voice material now.
            </h2>
            <p className="mt-3 text-sm leading-7 text-[rgba(29,38,34,0.62)]">
              Limerence will hold onto recordings and use a starting voice for now. Custom voice
              shaping is still a mockup on this build.
            </p>
          </div>
          <div className="rounded-[26px] border border-[rgba(103,112,100,0.12)] bg-[rgba(223,228,218,0.64)] px-4 py-3 text-sm leading-6 text-[var(--sage-deep)]">
            {recordedSamples.length > 0 ? `${recordedSamples.length} recorded sample${recordedSamples.length === 1 ? "" : "s"} saved` : "No recordings yet"}
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {houseVoicePresets.map((voice) => {
            const active = starterVoiceId === voice.id;
            return (
              <button
                key={voice.id}
                type="button"
                onClick={() => setStarterVoiceId(voice.id)}
                className={`rounded-[26px] border px-5 py-5 text-left transition-colors ${
                  active
                    ? "border-[rgba(103,112,100,0.28)] bg-[rgba(215,223,205,0.78)]"
                    : "border-[var(--line)] bg-[rgba(255,255,255,0.72)]"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.18em] text-[rgba(29,38,34,0.42)]">
                  Starting voice
                </p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--sage-deep)]">
                  {voice.name}
                </p>
                <p className="mt-2 text-sm font-medium text-[rgba(29,38,34,0.62)]">{voice.tone}</p>
                <p className="mt-3 text-sm leading-7 text-[rgba(29,38,34,0.6)]">
                  {voice.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-[28px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-5 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--sage-deep)]">Record inside Limerence</p>
              <p className="mt-1 text-xs leading-6 text-[rgba(29,38,34,0.54)]">
                These recordings stay attached to the persona now, even though custom cloning is not
                live yet.
              </p>
            </div>
            <VoiceRecorder
              disabled={isSubmitting}
              onError={(message) => setRecorderError(message)}
              onRecorded={(file) => {
                setRecorderError(null);
                setRecordedSamples((current) => [
                  ...current,
                  {
                    id: `${file.name}-${Date.now()}`,
                    file,
                    url: URL.createObjectURL(file),
                  },
                ]);
              }}
            />
          </div>

          {recorderError ? (
            <p className="mt-3 text-xs leading-6 text-[var(--danger)]">{recorderError}</p>
          ) : null}

          {recordedSamples.length > 0 ? (
            <div className="mt-4 space-y-3">
              {recordedSamples.map((sample, index) => (
                <div
                  key={sample.id}
                  className="flex flex-col gap-3 rounded-[20px] border border-[var(--line)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--sage-deep)]">
                      Recording {index + 1}
                    </p>
                    <p className="text-xs leading-6 text-[rgba(29,38,34,0.52)]">
                      {Math.round(sample.file.size / 1024)} KB
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <audio controls src={sample.url} className="h-10 max-w-[220px]" />
                    <button
                      type="button"
                      onClick={() => {
                        setRecordedSamples((current) => {
                          const target = current.find((entry) => entry.id === sample.id);
                          if (target) {
                            URL.revokeObjectURL(target.url);
                          }
                          return current.filter((entry) => entry.id !== sample.id);
                        });
                      }}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.82)] text-[var(--sage-deep)]"
                      aria-label={`Delete recording ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Upload voice files</span>
            <input
              name="voiceSamples"
              type="file"
              accept="audio/*,video/*"
              multiple
              className="w-full rounded-[22px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--sage-deep)]">Upload chat screenshots</span>
            <input
              name="screenshots"
              type="file"
              accept="image/*"
              multiple
              className="w-full rounded-[22px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
            />
          </label>
        </div>

        <details className="mt-5 rounded-[24px] border border-[var(--line)] bg-[rgba(255,255,255,0.66)] px-5 py-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--sage-deep)]">
            Internal/testing: already have a voice id?
          </summary>
          <div className="mt-4 space-y-2">
            <input
              name="existingVoiceId"
              className="w-full rounded-[20px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
              placeholder="Paste an existing voice or character id"
            />
            <p className="text-xs leading-6 text-[rgba(29,38,34,0.5)]">
              This is kept off the main path. If present, Limerence uses it directly instead of the
              starting voice.
            </p>
          </div>
        </details>
      </section>

      <section className="paper-panel rounded-[34px] px-6 py-7 sm:px-8 sm:py-8">
        <p className="eyebrow">Memory</p>
        <h2 className="serif-title mt-3 text-4xl text-[var(--sage-deep)]">Give the mind something to hold.</h2>

        <label className="mt-6 block space-y-2">
          <span className="text-sm font-medium text-[var(--sage-deep)]">Messages, notes, or transcripts</span>
          <textarea
            name="pastedText"
            rows={5}
            className="w-full rounded-[24px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
            placeholder="Paste messages, notes, or voice-mail transcripts here."
          />
        </label>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-[28px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-5 py-5">
            <p className="text-sm font-medium text-[var(--sage-deep)]">How much of them should be in the room</p>
            <div className="mt-4 grid gap-3">
              {[
                {
                  key: "soft",
                  title: "Softly",
                  description: "Mostly waits for you to begin.",
                },
                {
                  key: "steady",
                  title: "Steady",
                  description: "Feels nearby without crowding.",
                },
                {
                  key: "close",
                  title: "Close",
                  description: "Shows up a little more often.",
                },
              ].map((option) => {
                const active = presencePreset === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setPresencePreset(option.key as "soft" | "steady" | "close")}
                    className={`rounded-[20px] border px-4 py-4 text-left ${
                      active
                        ? "border-[rgba(190,160,108,0.34)] bg-[rgba(190,160,108,0.12)]"
                        : "border-[var(--border)] bg-white"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--sage-deep)]">{option.title}</p>
                    <p className="mt-1 text-sm leading-6 text-[rgba(29,38,34,0.6)]">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[28px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-5 py-5">
            <p className="text-sm font-medium text-[var(--sage-deep)]">How they usually reached you</p>
            <div className="mt-4 grid gap-3">
              {[
                {
                  key: "mixed",
                  title: "Balanced",
                  description: "Text and voice both feel natural.",
                },
                {
                  key: "text",
                  title: "Quieter",
                  description: "Written notes lead more often.",
                },
                {
                  key: "voice_note",
                  title: "Vocal",
                  description: "Voice is part of how they show up.",
                },
              ].map((option) => {
                const active = modePreset === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setModePreset(option.key as "mixed" | "text" | "voice_note")}
                    className={`rounded-[20px] border px-4 py-4 text-left ${
                      active
                        ? "border-[rgba(103,112,100,0.28)] bg-[rgba(223,228,218,0.72)]"
                        : "border-[var(--border)] bg-white"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--sage-deep)]">{option.title}</p>
                    <p className="mt-1 text-sm leading-6 text-[rgba(29,38,34,0.6)]">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {interviewPrompts.map((prompt) => (
            <label key={prompt} className="block space-y-2">
              <span className="text-sm font-medium text-[var(--sage-deep)]">{prompt}</span>
              <textarea
                name={`interview-${prompt}`}
                rows={3}
                className="w-full rounded-[22px] border border-[var(--border)] bg-white px-4 py-3 outline-none"
                placeholder="Answer in detail."
              />
            </label>
          ))}
        </div>
      </section>

      <section className="paper-panel rounded-[34px] px-6 py-7 sm:px-8 sm:py-8">
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="eyebrow">Safety</p>
            <h2 className="serif-title mt-3 text-4xl text-[var(--sage-deep)]">Required attestation</h2>
            <div className="mt-5 space-y-4 text-sm leading-6 text-[rgba(29,38,34,0.74)]">
              <label className="flex items-start gap-3">
                <input name="attestedRights" type="checkbox" className="mt-1" required />
                <span>I have the right to upload this voice and message material.</span>
              </label>
            </div>
          </div>

          <div className="rounded-[28px] bg-[rgba(63,74,66,0.96)] px-5 py-5 text-white md:max-w-sm">
            <p className="eyebrow text-[rgba(255,255,255,0.68)]">Preview build</p>
            <p className="mt-3 text-sm leading-7 text-[rgba(255,255,255,0.82)]">
              This creates the persona now, keeps any recordings with them, and starts from a
              house voice while voice shaping remains a mockup.
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-4 py-3 text-sm font-semibold text-[var(--sage-deep)]"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {isSubmitting ? "Creating..." : "Create preview"}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}
