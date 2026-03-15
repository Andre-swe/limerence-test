import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { observeLiveVisualPerception } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

/** Processes a visual perception frame (screen or camera image) during a live session and returns the updated session frame. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;

    const ownership = await verifyPersonaOwnership(request, personaId);
    if (!ownership.authorized) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "voice") as LiveSessionMode;
    const sessionId = String(formData.get("sessionId") ?? "").trim() || undefined;
    const event = String(formData.get("event") ?? "frame").trim() as "frame" | "start" | "end";
    const timestamp = String(formData.get("timestamp") ?? "").trim() || undefined;
    const image = formData.get("image");

    if (mode !== "screen" && mode !== "camera") {
      return NextResponse.json({ error: "Unsupported live mode." }, { status: 400 });
    }

    const result = await withUserStore(ownership.userId, () =>
      observeLiveVisualPerception(personaId, {
        mode,
        sessionId,
        event,
        imageFile: image instanceof File ? image : null,
        timestamp,
      })
    );

    return NextResponse.json({
      sessionFrame: result.sessionFrame,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process visual perception.",
      },
      { status: 400 },
    );
  }
}
