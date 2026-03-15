import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { runHeartbeat } from "@/lib/services";

export const runtime = "nodejs";

/** Triggers a single heartbeat cycle for a persona, returning the autonomous decision it produced. */
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

    const decision = await runHeartbeat(personaId);

    return NextResponse.json({
      decision,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to run heartbeat.",
      },
      { status: 400 },
    );
  }
}
