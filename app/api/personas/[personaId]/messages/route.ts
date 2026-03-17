import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import { sendPersonaMessage } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Sends an async message (text, audio, and/or images) to a persona and returns the updated persona state with reply messages. */
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

    // Rate limit: 30 messages per minute per user
    const rateCheck = checkRateLimit(
      rateLimitKey(ownership.userId, "messages"),
      RATE_LIMITS.messages,
    );
    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.retryAfter);
    }

    const formData = await request.formData();
    const text = String(formData.get("text") ?? "").trim();
    const audio = formData.get("audio");
    const images = formData
      .getAll("images")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    // Run store operations within user's store context
    const result = await withUserStore(ownership.userId, () =>
      sendPersonaMessage(personaId, {
        text,
        channel: "web" as const,
        audioFile: audio instanceof File ? audio : null,
        images,
      })
    );

    return NextResponse.json({
      messages: result.messages,
      leftOnRead: "leftOnRead" in result ? result.leftOnRead : false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to send message.",
      },
      { status: 400 },
    );
  }
}
