import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { createPersonaLiveSession } from "@/lib/hume-evi";
import { checkRateLimit, RATE_LIMITS, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit";
import { withUserStore } from "@/lib/store-context";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

/** Provisions a new Hume EVI live session for the persona in the requested mode (voice, screen, or camera). */
async function handleSessionRequest(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;

    const ownership = await verifyPersonaOwnership(request, personaId);
    if (!ownership.authorized) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    // Rate limit: 5 live call initiations per hour per user
    const rateCheck = checkRateLimit(
      rateLimitKey(ownership.userId, "liveCalls"),
      RATE_LIMITS.liveCalls,
    );
    if (!rateCheck.allowed) {
      return rateLimitResponse(rateCheck.retryAfter);
    }

    const persona = ownership.persona;

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

    const session = await withUserStore(ownership.userId, () =>
      createPersonaLiveSession(persona, mode, { isPremium })
    );
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to start live session.",
      },
      { status: 400 },
    );
  }
}

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
