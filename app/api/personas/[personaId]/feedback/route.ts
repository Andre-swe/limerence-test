import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { addPersonaFeedback } from "@/lib/services";

export const runtime = "nodejs";

/** Records user feedback (e.g. thumbs-up/down or freeform notes) for a persona interaction. */
export const POST = withPersonaRoute(async ({ request, params }) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const feedback = await addPersonaFeedback(params.personaId, payload);

    return NextResponse.json({
      feedback,
    });
  }, { errorMessage: "Unable to save feedback." });
