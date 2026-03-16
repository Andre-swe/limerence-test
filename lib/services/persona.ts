import { randomUUID } from "node:crypto";
import { seedBootstrapClaims } from "@/lib/memory-v2";
import { createInitialMindState, createPersonalityConstitution, createRelationshipModel } from "@/lib/mind-runtime";
import {
  applySoulArchetypeToConstitution,
  applySoulArchetypeToRelationship,
  inferSoulArchetypeSeed,
} from "@/lib/personality-archetypes";
import { isValidTimeZone } from "@/lib/persona-schedule";
import { getProviders } from "@/lib/providers";
import { appendMessages, savePersona } from "@/lib/store";
import type { Persona, PersonaAssemblyInput, PersonaSource, VoiceProfile } from "@/lib/types";
import { getHouseVoicePreset, houseVoicePresets } from "@/lib/voice-presets";
import { slugify } from "@/lib/utils";
import { createMessage, persistFileAsset } from "@/lib/services/assets";

function resolveStartingVoiceId(starterVoiceId?: string) {
  return (
    getHouseVoicePreset(starterVoiceId)?.id ??
    houseVoicePresets[0]?.id ??
    undefined
  );
}

function buildStartingVoiceProfile(input: {
  personaName: string;
  starterVoiceId?: string;
  now: string;
  pendingMockup: boolean;
}): VoiceProfile {
  const humeConfigured = Boolean(process.env.HUME_API_KEY?.trim());
  const selectedStartingVoiceId = resolveStartingVoiceId(input.starterVoiceId);

  // Onboarding should not block on a full voice clone. Start with a previewable
  // voice when possible and fall back to a deterministic mock identity otherwise.
  if (humeConfigured && selectedStartingVoiceId) {
    return {
      provider: "hume",
      voiceId: selectedStartingVoiceId,
      status: "preview_only",
      cloneState: input.pendingMockup ? "pending_mockup" : "none",
      cloneRequestedAt: input.pendingMockup ? input.now : undefined,
      watermarkApplied: false,
    };
  }

  return {
    provider: "mock",
    voiceId: `mock-${slugify(input.personaName || "persona")}`,
    status: "preview_only",
    cloneState: input.pendingMockup ? "pending_mockup" : "none",
    cloneRequestedAt: input.pendingMockup ? input.now : undefined,
    watermarkApplied: false,
  };
}

export async function createPersonaFromForm(formData: FormData, userId: string) {
  const providers = getProviders();
  const now = new Date().toISOString();

  const name = String(formData.get("name") ?? "").trim();
  const relationship = String(formData.get("relationship") ?? "").trim();
  const source: PersonaSource = "living";
  const description = String(formData.get("description") ?? "").trim();
  const pastedText = String(formData.get("pastedText") ?? "").trim();
  const existingVoiceId = String(formData.get("existingVoiceId") ?? "").trim();
  const starterVoiceId = String(formData.get("starterVoiceId") ?? "").trim();
  const attestedRights = formData.get("attestedRights") === "on";
  const heartbeatIntervalHours = Number(formData.get("heartbeatIntervalHours") ?? 4);
  const preferredMode: Persona["heartbeatPolicy"]["preferredMode"] =
    String(formData.get("preferredMode") ?? "mixed") === "voice_note"
      ? "voice_note"
      : String(formData.get("preferredMode") ?? "mixed") === "text"
        ? "text"
        : "mixed";
  const rawTimezone = String(formData.get("timezone") ?? "").trim();
  const status: Persona["status"] = "active";

  if (!name || !relationship || !description) {
    throw new Error("Name, relationship, and description are required.");
  }

  if (!attestedRights) {
    throw new Error("Rights attestation is required.");
  }

  if (rawTimezone && !isValidTimeZone(rawTimezone)) {
    throw new Error("Invalid timezone.");
  }

  const interviewAnswers = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key, value]) => key.startsWith("interview-") && typeof value === "string")
      .map(([key, value]) => [key.replace("interview-", ""), String(value)]),
  );

  const avatarFile = formData.get("avatar");
  const voiceFiles = formData.getAll("voiceSamples").filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );
  const screenshotFiles = formData
    .getAll("screenshots")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  const avatarAsset =
    avatarFile instanceof File && avatarFile.size > 0
      ? await persistFileAsset(avatarFile, "avatar")
      : null;

  const voiceSamples = await Promise.all(
    voiceFiles.map((file) => persistFileAsset(file, "voice_sample")),
  );

  const screenshots = await Promise.all(
    screenshotFiles.map(async (file) => {
      const asset = await persistFileAsset(file, "screenshot");
      const buffer = Buffer.from(await file.arrayBuffer());
      const extractedText = await providers.reasoning.extractTextFromScreenshot({
        buffer,
        fileName: file.name,
        mimeType: file.type || "image/png",
      });
      return {
        ...asset,
        extractedText,
      };
    }),
  );

  const assemblyInput: PersonaAssemblyInput = {
    name,
    relationship,
    source,
    description,
    pastedText,
    interviewAnswers,
    screenshotSummaries: screenshots.map((screenshot) => screenshot.extractedText ?? ""),
  };

  const dossier = await providers.reasoning.buildPersonaDossier(assemblyInput);
  const voice =
    existingVoiceId
      ? await providers.voice.cloneVoice({
          personaName: name,
          voiceSamples,
          existingVoiceId,
          stylePrompt: [
            description,
            dossier.communicationStyle,
            dossier.emotionalTendencies.join(", "),
          ]
            .filter(Boolean)
            .join(" "),
          sampleText:
            dossier.signaturePhrases[0]
              ? `${dossier.signaturePhrases[0]}, tell me the part that matters most right now.`
              : undefined,
        })
      : buildStartingVoiceProfile({
          personaName: name,
          starterVoiceId,
          now,
          pendingMockup: voiceSamples.length > 0,
        });

  const personaBaseCore: Omit<
    Persona,
    "mindState" | "personalityConstitution" | "relationshipModel"
  > = {
    id: randomUUID(),
    userId,
    name,
    relationship,
    source,
    description,
    status,
    avatarUrl: avatarAsset?.url,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: undefined,
    lastHeartbeatAt: undefined,
    timezone: rawTimezone || undefined,
    pastedText,
    screenshotSummaries: assemblyInput.screenshotSummaries,
    interviewAnswers,
    heartbeatPolicy: {
      enabled: true,
      intervalHours: Number.isFinite(heartbeatIntervalHours) && heartbeatIntervalHours >= 0.5
        ? Math.min(heartbeatIntervalHours, 48)
        : 4,
      maxOutboundPerDay: 3,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      preferredMode,
      workHoursEnabled: false,
      workHoursStart: 9,
      workHoursEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      boundaryNotes: [],
      variableInterval: true,
      hourlyActivityCounts: Array(24).fill(0),
      minIntervalHours: 1,
      maxIntervalHours: 8,
    },
    voice,
    consent: {
      attestedRights,
      createdAt: now,
    },
    dossier,
    voiceSamples,
    screenshots,
    preferenceSignals: [],
    revision: 1,
  };

  const inferredArchetype = inferSoulArchetypeSeed({
    relationship,
    description,
    sourceSummary: dossier.sourceSummary,
  });
  // Persist the constitution and relationship model after archetype shaping so
  // the initial mind state is derived from the same durable persona structure.
  const personalityConstitution = applySoulArchetypeToConstitution(
    createPersonalityConstitution({
      ...personaBaseCore,
      source,
    }),
    inferredArchetype,
  );
  const relationshipModel = applySoulArchetypeToRelationship(
    createRelationshipModel({
      ...personaBaseCore,
      source,
      personalityConstitution,
    }),
    inferredArchetype,
  );
  const personaBase = {
    ...personaBaseCore,
    personalityConstitution,
    relationshipModel,
  } satisfies Omit<Persona, "mindState">;

  const hasSourceMaterial =
    pastedText.length > 0 ||
    Object.values(interviewAnswers).some((answer) => answer.trim().length > 0) ||
    screenshots.length > 0;

  const baseMindState = createInitialMindState({
    persona: personaBase,
    messages: [],
  });

  // Only seed memory claims from material the user actually supplied. Empty
  // personas should begin teachable rather than with fabricated bootstrap facts.
  const mindState = hasSourceMaterial
    ? (() => {
        const bootstrap = seedBootstrapClaims({
          dossier,
          interviewAnswers,
          relationship,
          description,
          createdAt: now,
        });
        return {
          ...baseMindState,
          memoryClaims: bootstrap.claims,
          claimSources: bootstrap.sources,
        };
      })()
    : baseMindState;

  const persona: Persona = {
    ...personaBase,
    mindState,
  };

  await savePersona(persona);

  await appendMessages([
    createMessage({
      personaId: persona.id,
      role: "assistant",
      kind: "preview",
      channel: "web",
      body: hasSourceMaterial
        ? `${name} is here, shaped from the material you shared. They already have a sense of who you are together. Start talking naturally.`
        : `${name} is here. They're starting fresh — get to know each other, and they'll learn who you are through conversation.`,
      audioStatus: "text_fallback",
      replyMode: "text",
      delivery: {
        webInbox: true,
        attempts: 0,
      },
    }),
  ]);

  return persona;
}
