import { NextResponse } from "next/server";
import { createPersonaLiveSession } from "@/lib/hume-evi";
import { withPersonaRoute } from "@/lib/persona-route";
import { checkRateLimit, RATE_LIMITS, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

/** Provisions a new Hume EVI live session for the persona in the requested mode (voice, screen, or camera). */
const handleSessionRequest = withPersonaRoute(async ({ request, persona, userId }) => {
    // Rate limit: 5 live call initiations per hour per user
    const rateCheck = checkRateLimit(
      rateLimitKey(userId, "liveCalls"),
      RATE_LIMITS.liveCalls,
    );
    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.retryAfter);
    }

    if (persona.status !== "active") {
      return NextResponse.json(
        { error: "This persona must be approved before live conversation can begin." },
        { status: 400 },
      );
    }

    let mode: LiveSessionMode = "voice";
    let isPremium = false;
    if (request.method === "POST") {
      const payload = (await request.json().catch(() => ({}))) as {
        mode?: LiveSessionMode;
        isPremium?: boolean;
      };
      if (payload.mode === "screen" || payload.mode === "camera" || payload.mode === "voice") {
        mode = payload.mode;
      }
      // Premium status should be verified server-side in production
      // For now, accept from client but this should check user subscription
      isPremium = payload.isPremium === true;
    }

    const session = await createPersonaLiveSession(persona, mode, { isPremium });
    return NextResponse.json(session);
  }, { errorMessage: "Unable to start live session." });

export async function GET(
  request: Request,
  context: { params: Promise<{ personaId: string }> },
) {
  return handleSessionRequest(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ personaId: string }> },
) {
  return handleSessionRequest(request, context);
}
