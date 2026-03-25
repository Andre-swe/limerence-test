import type { LiveSessionMetrics, Persona, LiveSessionMode, UserStateSnapshot } from "@/lib/types";

const MAX_COMPLETED_LIVE_SESSION_METRICS = 8;

const localShadowExecutionQueues = new Map<string, Promise<void>>();
const sessionLastTransitionTurn = new Map<string, number>();

export function incrementCountMap(
  counts: Record<string, number>,
  key: string | undefined,
  amount = 1,
) {
  if (!key) {
    return counts;
  }

  return {
    ...counts,
    [key]: (counts[key] ?? 0) + amount,
  };
}

export function isLiveSessionMode(value: unknown): value is LiveSessionMode {
  return value === "voice" || value === "screen" || value === "camera";
}

export function resolveMetricsMode(input: {
  mode?: LiveSessionMode;
  metadata?: Record<string, unknown>;
}) {
  if (input.mode) {
    return input.mode;
  }

  const metadataMode = input.metadata?.mode;
  if (isLiveSessionMode(metadataMode)) {
    return metadataMode;
  }

  return "voice" satisfies LiveSessionMode;
}

function pruneLiveSessionMetrics(
  metrics: Record<string, LiveSessionMetrics>,
): Record<string, LiveSessionMetrics> {
  const entries = Object.entries(metrics);
  const active = entries.filter(([, metric]) => !metric.endedAt);
  const completed = entries
    .filter(([, metric]) => Boolean(metric.endedAt))
    .sort((left, right) => {
      const leftTimestamp = left[1].endedAt ?? left[1].startedAt;
      const rightTimestamp = right[1].endedAt ?? right[1].startedAt;
      return rightTimestamp.localeCompare(leftTimestamp);
    })
    .slice(0, MAX_COMPLETED_LIVE_SESSION_METRICS);

  return Object.fromEntries([...active, ...completed]);
}

function createLiveSessionMetrics(input: {
  sessionId: string;
  mode: LiveSessionMode;
  startedAt: string;
}): LiveSessionMetrics {
  return {
    sessionId: input.sessionId,
    mode: input.mode,
    startedAt: input.startedAt,
    deliveryRequestedCount: 0,
    deliveryRequestedReasons: {},
    deliveriesSent: 0,
    sentReasons: {},
    coalescedCount: 0,
    coalescedReasons: {},
    pollNoDeliveryCount: 0,
    totalDeliveryIntervalMs: 0,
    deliveryIntervalCount: 0,
    averageDeliveryIntervalMs: 0,
    shadowTurnsEnqueued: 0,
    shadowTurnsSkipped: 0,
    periodicSyncEnqueues: 0,
  };
}

export function updateLiveSessionMetricsCollection(
  current: Record<string, LiveSessionMetrics>,
  input: {
    sessionId?: string;
    mode?: LiveSessionMode;
    at?: string;
    updater: (metric: LiveSessionMetrics) => LiveSessionMetrics;
  },
) {
  if (!input.sessionId) {
    return current;
  }

  const at = input.at ?? new Date().toISOString();
  const existing =
    current[input.sessionId] ??
    createLiveSessionMetrics({
      sessionId: input.sessionId,
      mode: input.mode ?? "voice",
      startedAt: at,
    });
  const nextMetric = input.updater({
    ...existing,
    mode: input.mode ?? existing.mode,
  });

  return pruneLiveSessionMetrics({
    ...current,
    [input.sessionId]: nextMetric,
  });
}

export function updateMindStateLiveSessionMetrics(
  mindState: Persona["mindState"],
  input: {
    sessionId?: string;
    mode?: LiveSessionMode;
    at?: string;
    updater: (metric: LiveSessionMetrics) => LiveSessionMetrics;
  },
) {
  return {
    ...mindState,
    liveSessionMetrics: updateLiveSessionMetricsCollection(
      mindState.liveSessionMetrics,
      input,
    ),
  };
}

export function isCriticalLiveDeliveryReason(reason?: string) {
  const normalized = reason?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }

  return (
    normalized === "visual mode changed" ||
    normalized.includes("boundary") ||
    normalized.startsWith("process shifted") ||
    normalized === "process instance changed" ||
    normalized === "repair risk became urgent"
  );
}

export function currentLiveDeliveryMetricReason(persona: Persona) {
  return (
    persona.mindState.processState.live_delivery_metric_reason ??
    persona.mindState.lastLiveDeliveryReason
  );
}

export function recordLocalShadowExecution(personaId: string, execution: Promise<void>) {
  localShadowExecutionQueues.set(personaId, execution);
}

export function getLocalShadowExecution(personaId: string) {
  return localShadowExecutionQueues.get(personaId);
}

export function clearLocalShadowExecution(personaId?: string) {
  if (!personaId) {
    return;
  }

  localShadowExecutionQueues.delete(personaId);
}

export async function drainLocalShadowExecutions() {
  await Promise.allSettled([...localShadowExecutionQueues.values()]);
}

export function clearAllLocalShadowExecutions() {
  localShadowExecutionQueues.clear();
}

export function recordLiveTransitionSessionTurn(sessionId: string, turnCount: number) {
  sessionLastTransitionTurn.set(sessionId, turnCount);
  if (sessionLastTransitionTurn.size > 200) {
    sessionLastTransitionTurn.clear();
  }
}

export function getLiveTransitionSessionTurn(sessionId: string) {
  return sessionLastTransitionTurn.get(sessionId);
}

export function clearLiveTransitionSessionState(sessionId?: string) {
  if (!sessionId) {
    return;
  }

  sessionLastTransitionTurn.delete(sessionId);
}

export function resetLiveTransitionState() {
  sessionLastTransitionTurn.clear();
}

export function resetServiceRuntimeHelpers() {
  clearAllLocalShadowExecutions();
  resetLiveTransitionState();
}

export type { LiveSessionMode, UserStateSnapshot };
