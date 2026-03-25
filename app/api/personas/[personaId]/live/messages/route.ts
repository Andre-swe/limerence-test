import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { appendLiveTranscriptTurn } from "@/lib/services";

export const runtime = "nodejs";

/** Appends a transcript turn to the active live session and returns any contextual update plus the current session frame. */
export const POST = withPersonaRoute(async ({ request, params }) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const result = await appendLiveTranscriptTurn(params.personaId, payload);

    return NextResponse.json({
      contextualUpdate: result.contextualUpdate,
      sessionFrame: result.sessionFrame,
    });
  }, { errorMessage: "Unable to save live transcript." });
