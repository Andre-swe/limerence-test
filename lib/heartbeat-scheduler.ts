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

function resolveConcurrency(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const STORE_CONCURRENCY = resolveConcurrency(process.env.HEARTBEAT_STORE_CONCURRENCY, 4);
const PERSONA_CONCURRENCY = resolveConcurrency(process.env.HEARTBEAT_PERSONA_CONCURRENCY, 4);

async function mapInBatches<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem) => Promise<TResult>,
) {
  const results: TResult[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }

  return results;
}

/** Iterate the current store or multiple runtime-store keys and run only due heartbeats. */
export async function runDueHeartbeatsAcrossStores(
  input: RunDueHeartbeatsAcrossStoresInput,
) {
  const now = input.now ?? new Date();
  const storeKeys = [...new Set((input.storeKeys ?? []).filter(Boolean))];
  const runStore = async (storeKey?: string) => {
    const duePersonas = (await input.listPersonasForStore(storeKey)).filter((persona) =>
      input.isDue(persona, now),
    );

    return mapInBatches(duePersonas, PERSONA_CONCURRENCY, async (persona) => {
      const decision = await input.runHeartbeatForStore(persona.id, storeKey);
      return {
        personaId: persona.id,
        action: decision.action,
        reason: decision.reason,
      } satisfies DueHeartbeatResult;
    });
  };

  if (storeKeys.length === 0) {
    return runStore();
  }

  return (
    await mapInBatches(storeKeys, STORE_CONCURRENCY, (storeKey) => runStore(storeKey))
  ).flat();
}
