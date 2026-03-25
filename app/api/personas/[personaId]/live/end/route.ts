import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { finalizeLiveSession } from "@/lib/services";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

/** Finalizes an active live session, persisting the transcript and updating persona memory. */
export const POST = withPersonaRoute(async ({ request, params }) => {
    // Lenient parsing: finalization must succeed even if the client sent a garbled body (e.g. disconnect).
    const payload: { sessionId?: string; mode?: LiveSessionMode; reason?: "user_end" | "disconnect" } =
      await request.json().catch(() => ({}));

    const result = await finalizeLiveSession(params.personaId, {
      sessionId: payload.sessionId?.trim() || undefined,
      mode: payload.mode,
      reason: payload.reason,
    });

    return NextResponse.json(result);
  }, { errorMessage: "Unable to finalize live session." });
