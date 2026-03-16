import type {
  InternalScheduledEvent,
  LiveSessionMetrics,
  MemoryRetrievalPack,
  Persona,
} from "@/lib/types";

export function buildDebugContext(
  persona: Pick<Persona, "id" | "userId">,
  extra: Record<string, unknown> = {},
) {
  return {
    personaId: persona.id,
    userId: persona.userId,
    ...extra,
  };
}

export function summarizePendingInternalEvents(events: InternalScheduledEvent[]) {
  const counts = events.reduce<Record<string, number>>((accumulator, event) => {
    accumulator[event.status] = (accumulator[event.status] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    total: events.length,
    pending: counts.pending ?? 0,
    queued: counts.queued ?? 0,
    executed: counts.executed ?? 0,
    cancelled: counts.cancelled ?? 0,
    preview: events.slice(0, 4).map((event) => ({
      id: event.id,
      dedupeKey: event.dedupeKey,
      origin: event.origin,
      status: event.status,
      readyAt: event.readyAt,
    })),
  };
}

export function summarizeLiveSessionMetrics(
  metrics: Record<string, LiveSessionMetrics>,
  focusSessionId?: string,
) {
  const entries = Object.values(metrics);
  const active = entries.filter((entry) => !entry.endedAt);
  const completed = entries.filter((entry) => entry.endedAt);
  const focus = focusSessionId ? metrics[focusSessionId] : undefined;

  return {
    total: entries.length,
    active: active.length,
    completed: completed.length,
    focus: focus
      ? {
          sessionId: focus.sessionId,
          mode: focus.mode,
          deliveriesSent: focus.deliveriesSent,
          coalescedCount: focus.coalescedCount,
          pollNoDeliveryCount: focus.pollNoDeliveryCount,
          shadowTurnsEnqueued: focus.shadowTurnsEnqueued,
          periodicSyncEnqueues: focus.periodicSyncEnqueues,
          endedAt: focus.endedAt,
        }
      : null,
  };
}

export function summarizeRetrievalPack(pack: MemoryRetrievalPack) {
  return {
    perceptionId: pack.perceptionId,
    alwaysLoadedClaims: pack.alwaysLoadedClaims.length,
    contextualClaims: pack.contextualClaims.length,
    contextualEpisodes: pack.contextualEpisodes.length,
    summary: pack.summary,
  };
}
