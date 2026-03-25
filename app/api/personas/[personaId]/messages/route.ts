import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { checkRateLimit, RATE_LIMITS, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import { sendPersonaMessage } from "@/lib/services";

export const runtime = "nodejs";

/** Sends an async message (text, audio, and/or images) to a persona and returns the updated persona state with reply messages. */
export const POST = withPersonaRoute(async ({ request, params, userId }) => {
    // Rate limit: 30 messages per minute per user
    const rateCheck = checkRateLimit(
      rateLimitKey(userId, "messages"),
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

    const result = await sendPersonaMessage(params.personaId, {
      text,
      channel: "web" as const,
      audioFile: audio instanceof File ? audio : null,
      images,
    });

    return NextResponse.json({
      messages: result.messages,
      leftOnRead: "leftOnRead" in result ? result.leftOnRead : false,
    });
  }, { errorMessage: "Unable to send message." });
