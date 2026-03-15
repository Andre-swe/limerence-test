import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { synthesizeStoredReply } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Synthesizes TTS audio for a previously stored persona reply and returns the updated message with an audio URL. */
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ personaId: string; messageId: string }>;
  },
) {
  try {
    const { personaId, messageId } = await params;

    const ownership = await verifyPersonaOwnership(request, personaId);
    if (!ownership.authorized) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    const message = await withUserStore(ownership.userId, () =>
      synthesizeStoredReply(personaId, messageId)
    );

    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to synthesize audio.",
      },
      { status: 400 },
    );
  }
}
