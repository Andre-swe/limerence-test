import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { finalizeLiveSession } from "@/lib/services";
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

    const payload = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      mode?: LiveSessionMode;
      reason?: "user_end" | "disconnect";
    };

    const result = await finalizeLiveSession(personaId, {
      sessionId: payload.sessionId?.trim() || undefined,
      mode: payload.mode,
      reason: payload.reason,
    });

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
