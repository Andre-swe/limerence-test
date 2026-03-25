import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { observeLiveVisualPerception } from "@/lib/services";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

/** Processes a visual perception frame (screen or camera image) during a live session and returns the updated session frame. */
export const POST = withPersonaRoute(async ({ request, params }) => {
    const formData = await request.formData();
    const mode = String(formData.get("mode") ?? "voice") as LiveSessionMode;
    const sessionId = String(formData.get("sessionId") ?? "").trim() || undefined;
    const event = String(formData.get("event") ?? "frame").trim() as "frame" | "start" | "end";
    const timestamp = String(formData.get("timestamp") ?? "").trim() || undefined;
    const image = formData.get("image");

    if (mode !== "screen" && mode !== "camera") {
      return NextResponse.json({ error: "Unsupported live mode." }, { status: 400 });
    }

    const result = await observeLiveVisualPerception(params.personaId, {
      mode,
      sessionId,
      event,
      imageFile: image instanceof File ? image : null,
      timestamp,
    });

    return NextResponse.json({
      sessionFrame: result.sessionFrame,
    });
  }, { errorMessage: "Unable to process visual perception." });
