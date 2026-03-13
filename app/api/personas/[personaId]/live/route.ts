import { NextResponse } from "next/server";
import { createPersonaLiveSession } from "@/lib/hume-evi";
import { getPersona } from "@/lib/store";
import type { LiveSessionMode } from "@/lib/types";

export const runtime = "nodejs";

async function handleSessionRequest(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const persona = await getPersona(personaId);

    if (!persona) {
      return NextResponse.json({ error: "Persona not found." }, { status: 404 });
    }

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

    const session = await createPersonaLiveSession(persona, mode);
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
