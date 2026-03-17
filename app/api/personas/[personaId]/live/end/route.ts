import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { finalizeLiveSession } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

/** Finalizes an active live session, persisting the transcript and updating persona memory. */
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

    // Lenient parsing: finalization must succeed even if the client sent a garbled body (e.g. disconnect).
    const payload: { sessionId?: string; mode?: LiveSessionMode; reason?: "user_end" | "disconnect" } =
      await request.json().catch(() => ({}));

    const result = await withUserStore(ownership.userId, () =>
      finalizeLiveSession(personaId, {
        sessionId: payload.sessionId?.trim() || undefined,
        mode: payload.mode,
        reason: payload.reason,
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to finalize live session.",
      },
      { status: 400 },
    );
  }
}
