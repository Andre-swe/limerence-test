import { getPersona, replacePersonaIfRevision } from "@/lib/store";
import { executeFastMessageTurn, executeSoulTurn } from "@/lib/soul-engine";
import { soulLogger } from "@/lib/soul-logger";
import type { LiveSessionMode, Persona } from "@/lib/types";

export async function commitTurnResultWithRevision(input: {
  personaId: string;
  baseRevision: number;
  turnResult: Awaited<ReturnType<typeof executeSoulTurn>>;
  updatedAt: string;
  lastActiveAt?: string;
  lastHeartbeatAt?: string;
  nextHeartbeatAt?: string;
  shadowJobId?: string;
  liveSessionId?: string;
  liveMode?: LiveSessionMode;
  liveDeliveryMetricReason?: string;
}) {
  return replacePersonaIfRevision(input.personaId, input.baseRevision, (current) => {
    const didRequestLiveDelivery =
      Boolean(input.liveSessionId) &&
      input.turnResult.persona.mindState.liveDeliveryVersion > current.mindState.liveDeliveryVersion;

    const nextMindState = {
      ...input.turnResult.persona.mindState,
      liveSessionMetrics: current.mindState.liveSessionMetrics,
      internalState: current.mindState.internalState,
      pendingShadowTurns: current.mindState.pendingShadowTurns.map((job) =>
        job.id === input.shadowJobId
          ? {
              ...job,
              status: "completed" as const,
              completedAt: input.updatedAt,
            }
          : job,
      ),
      processState: {
        ...input.turnResult.persona.mindState.processState,
        ...(didRequestLiveDelivery && input.liveDeliveryMetricReason
          ? { live_delivery_metric_reason: input.liveDeliveryMetricReason }
          : {}),
      },
    };

    return {
      ...input.turnResult.persona,
      updatedAt: input.updatedAt,
      lastActiveAt: input.lastActiveAt ?? current.lastActiveAt,
      lastHeartbeatAt: input.lastHeartbeatAt ?? current.lastHeartbeatAt,
      nextHeartbeatAt: input.nextHeartbeatAt ?? current.nextHeartbeatAt,
      mindState: nextMindState,
    };
  });
}

export async function runVersionedSoulTurn(input: {
  personaId: string;
  basePersona?: Persona;
  build: (persona: Persona) => Promise<Omit<Parameters<typeof executeSoulTurn>[0], "persona">>;
  updatedAt?: string;
  lastActiveAt?: string;
  lastHeartbeatAt?: string;
  nextHeartbeatAt?: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const persona =
      attempt === 0 && input.basePersona ? input.basePersona : await getPersona(input.personaId);

    if (!persona) {
      throw new Error("Persona not found.");
    }

    const executeInput = await input.build(persona);
    const turnResult = await executeSoulTurn({
      ...executeInput,
      persona,
    });
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const committed = await commitTurnResultWithRevision({
      personaId: input.personaId,
      baseRevision: persona.revision,
      turnResult,
      updatedAt,
      lastActiveAt: input.lastActiveAt ?? updatedAt,
      lastHeartbeatAt: input.lastHeartbeatAt,
      nextHeartbeatAt: input.nextHeartbeatAt,
    });

    if (committed.matched) {
      return {
        persona: committed.persona,
        turnResult,
      };
    }

    soulLogger.debug(
      {
        personaId: input.personaId,
        expectedRevision: persona.revision,
        actualRevision: committed.persona.revision,
        attempt: attempt + 1,
      },
      "Async soul turn revision mismatch; retrying",
    );
  }

  throw new Error("Unable to commit soul turn after revision retries.");
}

// Retained for fast message replies where latency matters more than depth.
export async function runVersionedFastMessageTurn(input: {
  personaId: string;
  basePersona?: Persona;
  build: (persona: Persona) => Promise<Omit<Parameters<typeof executeFastMessageTurn>[0], "persona">>;
  updatedAt?: string;
  lastActiveAt?: string;
}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const persona =
      attempt === 0 && input.basePersona ? input.basePersona : await getPersona(input.personaId);

    if (!persona) {
      throw new Error("Persona not found.");
    }

    const executeInput = await input.build(persona);
    const turnResult = await executeFastMessageTurn({
      ...executeInput,
      persona,
    });
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const committed = await replacePersonaIfRevision(input.personaId, persona.revision, (current) => ({
      ...turnResult.persona,
      updatedAt,
      lastActiveAt: input.lastActiveAt ?? updatedAt,
      lastHeartbeatAt: current.lastHeartbeatAt,
    }));

    if (committed.matched) {
      return {
        persona: committed.persona,
        turnResult,
      };
    }

    soulLogger.debug(
      {
        personaId: input.personaId,
        expectedRevision: persona.revision,
        actualRevision: committed.persona.revision,
        attempt: attempt + 1,
      },
      "Fast message turn revision mismatch; retrying",
    );
  }

  throw new Error("Unable to commit fast message turn after revision retries.");
}
