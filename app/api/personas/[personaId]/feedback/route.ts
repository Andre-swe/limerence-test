import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { addPersonaFeedback } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Records user feedback (e.g. thumbs-up/down or freeform notes) for a persona interaction. */
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

    const payload = await request.json();
    const feedback = await withUserStore(ownership.userId, () =>
      addPersonaFeedback(personaId, payload)
    );

    return NextResponse.json({
      feedback,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save feedback.",
      },
      { status: 400 },
    );
  }
}
