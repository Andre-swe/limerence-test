import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { appendLiveTranscriptTurn } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Appends a transcript turn to the active live session and returns any contextual update plus the current session frame. */
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

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const result = await withUserStore(ownership.userId, () =>
      appendLiveTranscriptTurn(personaId, payload)
    );

    return NextResponse.json({
      contextualUpdate: result.contextualUpdate,
      sessionFrame: result.sessionFrame,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save live transcript.",
      },
      { status: 400 },
    );
  }
}
