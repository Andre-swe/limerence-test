import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withPersonaRoute } from "@/lib/persona-route";
import { savePublicFile, updatePersona } from "@/lib/store";
import type { VoiceCloneConsent, VoiceCloneProfile } from "@/lib/types";

const voiceCloneUploadSchema = z.object({
  consent: z.object({
    granted: z.boolean(),
    timestamp: z.string(),
    userAgent: z.string(),
    consentText: z.string(),
  }),
  qualityScore: z.number().min(0).max(100),
  duration: z.number().min(1),
});

function getClientIp(headersList: Headers) {
  return (
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headersList.get("x-real-ip") ||
    "unknown"
  );
}

export const POST = withPersonaRoute(async ({ request, params }) => {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    const metadataJson = formData.get("metadata") as string | null;

    if (!audioFile) {
      return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
    }

    if (!metadataJson) {
      return NextResponse.json({ error: "Metadata is required" }, { status: 400 });
    }

    const metadata = voiceCloneUploadSchema.parse(JSON.parse(metadataJson));

    if (!metadata.consent.granted) {
      return NextResponse.json({ error: "Consent is required" }, { status: 400 });
    }

    const consentWithIp: VoiceCloneConsent = {
      ...metadata.consent,
      ipAddress: getClientIp(request.headers),
    };

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const { fileName, url } = await savePublicFile(
      buffer,
      `voice-clone-${params.personaId}-${Date.now()}.webm`,
      audioFile.type || "audio/webm",
    );

    const now = new Date().toISOString();
    const profileId = randomUUID();
    const voiceCloneProfile: VoiceCloneProfile = {
      id: profileId,
      personaId: params.personaId,
      status: "pending",
      referenceAudioUrl: url,
      referenceAudioFileName: fileName,
      referenceAudioDuration: metadata.duration,
      qualityScore: metadata.qualityScore,
      consent: consentWithIp,
      createdAt: now,
      updatedAt: now,
    };

    await updatePersona(params.personaId, (current) => ({
      ...current,
      updatedAt: now,
      voice: {
        ...current.voice,
        cloneState: "pending_mockup",
        cloneRequestedAt: now,
        cloneProfileId: profileId,
      },
    }));

    return NextResponse.json({
      success: true,
      profile: voiceCloneProfile,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 },
      );
    }

    throw error;
  }
}, { errorMessage: "Upload failed" });

export const GET = withPersonaRoute(async ({ persona }) => {
  return NextResponse.json({
    voiceProfile: persona.voice,
    cloneProfileId: persona.voice.cloneProfileId,
    cloneState: persona.voice.cloneState,
  });
}, { errorMessage: "Failed to get status" });
