import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPersona, updatePersona } from "@/lib/store";
import { savePublicFile } from "@/lib/store";
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

function getClientIp(headersList: Headers): string {
  return (
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headersList.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const persona = await getPersona(personaId);

    if (!persona) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }

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

    // Capture client IP for audit trail
    const headersList = await headers();
    const clientIp = getClientIp(headersList);

    const consentWithIp: VoiceCloneConsent = {
      ...metadata.consent,
      ipAddress: clientIp,
    };

    // Upload reference audio to Supabase Storage
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const { fileName, url } = await savePublicFile(
      buffer,
      `voice-clone-${personaId}-${Date.now()}.webm`,
      audioFile.type || "audio/webm",
    );

    const now = new Date().toISOString();
    const profileId = randomUUID();

    // Create voice clone profile
    const voiceCloneProfile: VoiceCloneProfile = {
      id: profileId,
      personaId,
      status: "pending",
      referenceAudioUrl: url,
      referenceAudioFileName: fileName,
      referenceAudioDuration: metadata.duration,
      qualityScore: metadata.qualityScore,
      consent: consentWithIp,
      createdAt: now,
      updatedAt: now,
    };

    // Update persona with voice clone profile reference
    await updatePersona(personaId, (current) => ({
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

    console.error("Voice clone upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const persona = await getPersona(personaId);

    if (!persona) {
      return NextResponse.json({ error: "Persona not found" }, { status: 404 });
    }

    return NextResponse.json({
      voiceProfile: persona.voice,
      cloneProfileId: persona.voice.cloneProfileId,
      cloneState: persona.voice.cloneState,
    });
  } catch (error) {
    console.error("Voice clone status error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get status" },
      { status: 500 },
    );
  }
}
