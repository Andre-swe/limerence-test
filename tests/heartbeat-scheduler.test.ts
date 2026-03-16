import { describe, expect, it, vi } from "vitest";
import { runDueHeartbeatsAcrossStores } from "@/lib/heartbeat-scheduler";
import type { Persona } from "@/lib/types";

type ScheduledPersona = Persona & { due: boolean };

describe("heartbeat scheduler", () => {
  it("runs due personas across every runtime-store key", async () => {
    const stores: Record<string, ScheduledPersona[]> = {
      "user-1": [
        { id: "persona-1", due: true } as ScheduledPersona,
        { id: "persona-2", due: false } as ScheduledPersona,
      ],
      "user-2": [
        { id: "persona-3", due: true } as ScheduledPersona,
      ],
      default: [
        { id: "persona-4", due: true } as ScheduledPersona,
      ],
    };

    const listPersonasForStore = vi.fn(async (storeKey?: string) => {
      if (!storeKey) {
        return [];
      }

      return stores[storeKey] ?? [];
    });
    const runHeartbeatForStore = vi.fn(async (personaId: string, storeKey?: string) => ({
      action: "TEXT" as const,
      reason: `ran:${storeKey}:${personaId}`,
    }));

    const results = await runDueHeartbeatsAcrossStores({
      storeKeys: ["user-1", "user-2", "default", "user-1"],
      listPersonasForStore,
      runHeartbeatForStore,
      isDue: (persona) => (persona as ScheduledPersona).due,
    });

    expect(listPersonasForStore).toHaveBeenCalledTimes(3);
    expect(runHeartbeatForStore).toHaveBeenCalledTimes(3);
    expect(runHeartbeatForStore).toHaveBeenNthCalledWith(1, "persona-1", "user-1");
    expect(runHeartbeatForStore).toHaveBeenNthCalledWith(2, "persona-3", "user-2");
    expect(runHeartbeatForStore).toHaveBeenNthCalledWith(3, "persona-4", "default");
    expect(results).toEqual([
      {
        personaId: "persona-1",
        action: "TEXT",
        reason: "ran:user-1:persona-1",
      },
      {
        personaId: "persona-3",
        action: "TEXT",
        reason: "ran:user-2:persona-3",
      },
      {
        personaId: "persona-4",
        action: "TEXT",
        reason: "ran:default:persona-4",
      },
    ]);
  });
});
