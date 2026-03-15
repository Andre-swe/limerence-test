import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { createPersonaLiveSession } from "@/lib/hume-evi";
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

    const persona = ownership.persona;

    if (persona.status !== "active") {
      return NextResponse.json(
        { error: "This persona must be approved before live conversation can begin." },
        { status: 400 },
      );
    }

    let mode: LiveSessionMode = "voice";
    if (request.method === "POST") {
      const payload = (await request.json().catch(() => ({}))) as { mode?: LiveSessionMode };
      if (payload.mode === "screen" || payload.mode === "camera" || payload.mode === "voice") {
        mode = payload.mode;
      }
    }

    const session = await withUserStore(ownership.userId, () =>
      createPersonaLiveSession(persona, mode)
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
