import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { getLiveContextUpdate } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Returns the latest session frame and pending background jobs for the live overlay, supporting incremental polling via `afterVersion`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;

    const ownership = await verifyPersonaOwnership(request, personaId);
    if (!ownership.authorized) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const afterVersion = Number(url.searchParams.get("afterVersion") ?? "0");

    const result = await withUserStore(ownership.userId, () =>
      getLiveContextUpdate(personaId, {
        sessionId,
        afterVersion: Number.isFinite(afterVersion) ? afterVersion : 0,
      })
    );

    // Only return what the client needs — avoid sending the full persona
    // (with all mind state, memories, etc.) on every 3-second poll.
    return NextResponse.json({
      sessionFrame: result.sessionFrame,
      pendingJobs: result.pendingJobs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to resolve live context.",
      },
      { status: 400 },
    );
  }
}
