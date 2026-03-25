"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IdentitySection,
  MemorySection,
  RecordedSample,
  SafetySection,
  VoiceSection,
} from "@/components/create-persona-form-sections";
import { useOnboardingActions } from "@/components/onboarding";
import { houseVoicePresets } from "@/lib/voice-presets";

export function CreatePersonaForm() {
  const router = useRouter();
  const { markPersonaCreated } = useOnboardingActions();
  const [presencePreset, setPresencePreset] = useState<"soft" | "steady" | "close">("steady");
  const [modePreset, setModePreset] = useState<"mixed" | "text" | "voice_note">("mixed");
  const [starterVoiceId, setStarterVoiceId] = useState<string>(houseVoicePresets[0]?.id ?? "");
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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

  const handleRecordedSample = (file: File) => {
    setRecordedSamples((current) => [
      ...current,
      {
        id: `${file.name}-${Date.now()}`,
        file,
        url: URL.createObjectURL(file),
      },
    ]);
  };

  const handleRemoveRecordedSample = (sampleId: string) => {
    setRecordedSamples((current) => {
      const target = current.find((entry) => entry.id === sampleId);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return current.filter((entry) => entry.id !== sampleId);
    });
  };

  return (
    <form
      className="mx-auto max-w-4xl space-y-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (isSubmitting) return;

        const form = event.currentTarget;
        const formData = new FormData(form);
        const errors: Record<string, string> = {};

        const name = (formData.get("name") as string)?.trim();
        const relationship = (formData.get("relationship") as string)?.trim();
        const description = (formData.get("description") as string)?.trim();
        const attestedRights = formData.get("attestedRights");

        if (!name || name.length < 1) {
          errors.name = "Name is required";
        } else if (name.length > 50) {
          errors.name = "Name must be 50 characters or less";
        }

        if (!relationship || relationship.length < 1) {
          errors.relationship = "Relationship is required";
        } else if (relationship.length > 50) {
          errors.relationship = "Relationship must be 50 characters or less";
        }

        if (!description || description.length < 10) {
          errors.description = "Please provide at least 10 characters describing them";
        } else if (description.length > 2000) {
          errors.description = "Description must be 2000 characters or less";
        }

        if (!attestedRights) {
          errors.attestedRights = "You must confirm you have the rights to this material";
        }

        if (!starterVoiceId) {
          errors.voice = "Please select a starting voice";
        }

        if (Object.keys(errors).length > 0) {
          setFieldErrors(errors);
          setCreateError("Please fix the errors above");
          return;
        }

        setFieldErrors({});
        setIsSubmitting(true);
        try {
          recordedSamples.forEach((sample) => {
            formData.append("voiceSamples", sample.file);
          });
          const response = await fetch("/api/personas", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "Unable to create persona.");
          }
          const payload = (await response.json()) as { personaId: string };
          markPersonaCreated();
          router.push(`/personas/${payload.personaId}`);
        } catch (error) {
          setCreateError(error instanceof Error ? error.message : "Something went wrong.");
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

      <IdentitySection
        fieldErrors={fieldErrors}
        onClearFieldError={(field) => setFieldErrors((current) => ({ ...current, [field]: "" }))}
      />

      <VoiceSection
        recordedSamples={recordedSamples}
        recorderError={recorderError}
        isSubmitting={isSubmitting}
        starterVoiceId={starterVoiceId}
        setStarterVoiceId={setStarterVoiceId}
        onRecorded={handleRecordedSample}
        onRemoveRecordedSample={handleRemoveRecordedSample}
        onRecorderError={setRecorderError}
      />

      <MemorySection
        presencePreset={presencePreset}
        setPresencePreset={setPresencePreset}
        modePreset={modePreset}
        setModePreset={setModePreset}
      />

      <SafetySection createError={createError} isSubmitting={isSubmitting} />
    </form>
  );
}
