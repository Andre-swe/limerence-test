import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { getLiveContextUpdate } from "@/lib/services";

export const runtime = "nodejs";

/** Returns the latest session frame and pending background jobs for the live overlay, supporting incremental polling via `afterVersion`. */
export const GET = withPersonaRoute(async ({ request, params }) => {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const afterVersion = Number(url.searchParams.get("afterVersion") ?? "0");

    const result = await getLiveContextUpdate(params.personaId, {
      sessionId,
      afterVersion: Number.isFinite(afterVersion) ? afterVersion : 0,
    });

    // Only return what the client needs — avoid sending the full persona
    // (with all mind state, memories, etc.) on every 3-second poll.
    return NextResponse.json({
      sessionFrame: result.sessionFrame,
      pendingJobs: result.pendingJobs,
    });
  }, { errorMessage: "Unable to resolve live context." });
