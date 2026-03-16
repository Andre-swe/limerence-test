import type { HeartbeatDecision, Persona } from "@/lib/types";

export type DueHeartbeatResult = {
  personaId: string;
  action: HeartbeatDecision["action"];
  reason: string;
};

type RunDueHeartbeatsAcrossStoresInput = {
  now?: Date;
  storeKeys?: string[] | null;
  listPersonasForStore: (storeKey?: string) => Promise<Persona[]>;
  runHeartbeatForStore: (personaId: string, storeKey?: string) => Promise<HeartbeatDecision>;
  isDue: (persona: Persona, now: Date) => boolean;
};

/** Iterate the current store or multiple runtime-store keys and run only due heartbeats. */
export async function runDueHeartbeatsAcrossStores(
  input: RunDueHeartbeatsAcrossStoresInput,
) {
  const now = input.now ?? new Date();
  const storeKeys = [...new Set((input.storeKeys ?? []).filter(Boolean))];
  const results: DueHeartbeatResult[] = [];

  if (storeKeys.length === 0) {
    const duePersonas = (await input.listPersonasForStore()).filter((persona) =>
      input.isDue(persona, now),
    );

    for (const persona of duePersonas) {
      const decision = await input.runHeartbeatForStore(persona.id);
      results.push({
        personaId: persona.id,
        action: decision.action,
        reason: decision.reason,
      });
    }

    return results;
  }

  for (const storeKey of storeKeys) {
    const duePersonas = (await input.listPersonasForStore(storeKey)).filter((persona) =>
      input.isDue(persona, now),
    );

    for (const persona of duePersonas) {
      const decision = await input.runHeartbeatForStore(persona.id, storeKey);
      results.push({
        personaId: persona.id,
        action: decision.action,
        reason: decision.reason,
      });
    }
  }

  return results;
}
