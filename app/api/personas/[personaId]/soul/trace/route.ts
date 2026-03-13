import { NextResponse } from "next/server";
import { getPersona } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ personaId: string }> },
) {
  const { personaId } = await context.params;
  const persona = await getPersona(personaId);

  if (!persona) {
    return NextResponse.json({ error: "Persona not found." }, { status: 404 });
  }

  return NextResponse.json({
    personaId: persona.id,
    activeProcess: persona.mindState.activeProcess,
    currentProcessInstanceId: persona.mindState.currentProcessInstanceId,
    learningState: persona.mindState.learningState,
    pendingInternalEvents: persona.mindState.pendingInternalEvents,
    pendingShadowTurns: persona.mindState.pendingShadowTurns,
    recentEvents: persona.mindState.recentEvents,
    traceHead: persona.mindState.traceHead,
  });
}
