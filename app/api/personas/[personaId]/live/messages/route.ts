import { NextResponse } from "next/server";
import { appendLiveTranscriptTurn } from "@/lib/services";

export const runtime = "nodejs";

/** Appends a transcript turn to the active live session and returns any contextual update plus the current session frame. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const payload = await request.json();
    const result = await appendLiveTranscriptTurn(personaId, payload);

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
