import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { synthesizeStoredReply } from "@/lib/services";

export const runtime = "nodejs";

/** Synthesizes TTS audio for a previously stored persona reply and returns the updated message with an audio URL. */
export const POST = withPersonaRoute(async ({ params }) => {
    const message = await synthesizeStoredReply(params.personaId, params.messageId);

    return NextResponse.json({ message });
  }, { errorMessage: "Unable to synthesize audio." });
