import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { buildMemoryRetrievalPack } from "@/lib/memory-v2";

/** Debug route: returns the persona's cognitive state, memory claims, and trace. */
export async function GET(
  request: Request,
  context: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await context.params;
    const ownership = await verifyPersonaOwnership(request, personaId);
    if (!ownership.authorized) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }
    const persona = ownership.persona;

    return NextResponse.json({
      personaId: persona.id,
      personaName: persona.name,
      activeProcess: persona.mindState.activeProcess,
      currentProcessInstanceId: persona.mindState.currentProcessInstanceId,
      // Persona's inner life — private thoughts and emotional state
      internalState: persona.mindState.internalState,
      learningState: persona.mindState.learningState,
      liveSessionMetrics: persona.mindState.liveSessionMetrics,
      memoryClaims: persona.mindState.memoryClaims.slice(0, 12),
      recentChangedClaims: persona.mindState.recentChangedClaims.slice(0, 8),
      contradictedClaims: persona.mindState.memoryClaims
        .filter((claim) => claim.status === "contradicted" || claim.status === "stale")
        .slice(0, 8),
      claimSources: persona.mindState.claimSources.slice(0, 24),
      episodes: persona.mindState.episodes.slice(0, 12),
      lastRetrievalPack:
        persona.mindState.lastRetrievalPack ??
        buildMemoryRetrievalPack({
          persona,
        }),
      pendingInternalEvents: persona.mindState.pendingInternalEvents,
      pendingShadowTurns: persona.mindState.pendingShadowTurns,
      recentEvents: persona.mindState.recentEvents,
      traceHead: persona.mindState.traceHead,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load soul trace." },
      { status: 500 },
    );
  }
}
