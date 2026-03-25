import { randomUUID } from "node:crypto";
import { isInngestExecutionEnabled } from "@/lib/inngest";
import { appendMessages, appendPerceptionObservations, getPersona, listFeedback, listMessages, listPerceptionObservations, updatePersona } from "@/lib/store";
import { getProviders } from "@/lib/providers";
import { buildSoulHarness, renderLiveContextOverlay } from "@/lib/soul-harness";
import { inferProsodyUserState } from "@/lib/mind-runtime";
import { summarizeLiveSessionMetrics, summarizePendingInternalEvents, buildDebugContext } from "@/lib/debug-observability";
import { soulLogger } from "@/lib/soul-logger";
import { createMessage } from "@/lib/services/assets";
import { applyPreferenceSignalIfNeeded } from "@/lib/services/messaging";
import { enqueueShadowTurnForExecution } from "@/lib/services/internal-events";
import {
  clearLiveTransitionSessionState,
  currentLiveDeliveryMetricReason,
  getLiveTransitionSessionTurn,
  incrementCountMap,
  isCriticalLiveDeliveryReason,
  recordLiveTransitionSessionTurn,
  updateMindStateLiveSessionMetrics,
} from "@/lib/services/runtime";
import type {
  LiveSessionMetrics,
  LiveSessionMode,
  MessageEntry,
  PerceptionObservation,
  Persona,
  SoulPerception,
  SoulSessionFrame,
  UserStateSnapshot,
} from "@/lib/types";

const MIN_LIVE_DELIVERY_INTERVAL_MS = 4500;
const MAX_COMPLETED_LIVE_SESSION_METRICS = 8;

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

function updateLiveSessionMetricsCollection(
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

function currentContextVersion(persona: Persona) {
  return persona.mindState.contextVersion;
}

function currentLiveDeliveryVersion(persona: Persona) {
  return persona.mindState.liveDeliveryVersion;
}

function currentTraceVersion(persona: Persona) {
  return persona.mindState.traceVersion;
}

function buildSessionFrame(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  perception: SoulPerception;
  contextDelta?: string;
  liveOverlay?: boolean;
}) {
  const snapshot = buildSoulHarness({
    persona: input.persona,
    messages: input.messages,
    feedbackNotes: input.feedbackNotes,
    perception: input.perception,
  });

  const contextText = input.liveOverlay
    ? renderLiveContextOverlay(snapshot)
    : snapshot.sessionFrame.contextText;

  return {
    ...snapshot.sessionFrame,
    contextText,
    contextVersion: currentContextVersion(input.persona),
    liveDeliveryVersion: currentLiveDeliveryVersion(input.persona),
    traceVersion: currentTraceVersion(input.persona),
    deliveryReason: input.persona.mindState.lastLiveDeliveryReason,
    contextDelta: input.contextDelta,
  } satisfies SoulSessionFrame;
}

function buildPendingShadowTurn(input: {
  persona: Persona;
  perception: SoulPerception;
  sessionId?: string;
  providedUserState?: UserStateSnapshot;
}) {
  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(),
    perception: input.perception,
    sessionId: input.sessionId,
    baseRevision: input.persona.revision,
    status: "pending" as const,
    attempts: 0,
    createdAt,
    providedUserState: input.providedUserState,
  };
}

function visualObservationKindForMode(mode: LiveSessionMode): PerceptionObservation["kind"] {
  return mode === "camera" ? "camera_observation" : "screen_observation";
}

function visualSessionEventKind(phase: "start" | "end"): PerceptionObservation["kind"] {
  return phase === "start" ? "visual_session_start" : "visual_session_end";
}

function resolveLivePerceptionForSession(
  sessionId: string | undefined,
  observations: PerceptionObservation[],
) {
  if (!sessionId) {
    return {
      kind: "session_start",
      createdAt: new Date().toISOString(),
      internal: true,
      sessionId,
    } satisfies SoulPerception;
  }

  const latestForSession = observations
    .filter((observation) => observation.sessionId === sessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1);

  if (
    latestForSession &&
    latestForSession.mode !== "voice" &&
    latestForSession.kind !== "visual_session_end"
  ) {
    return {
      kind: "visual_session_start",
      createdAt: new Date().toISOString(),
      internal: true,
      sessionId,
      metadata: {
        mode: latestForSession.mode,
      },
    } satisfies SoulPerception;
  }

  return {
    kind: "session_start",
    createdAt: new Date().toISOString(),
    internal: true,
    sessionId,
  } satisfies SoulPerception;
}

function createDerivedVisualObservation(input: {
  persona: Persona;
  messages: MessageEntry[];
  mode: LiveSessionMode;
  source: "message_image" | "screen" | "camera";
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  createdAt: string;
  sessionId?: string;
  sourceMessageId?: string;
}) {
  const providers = getProviders();
  return providers.reasoning
    .observeVisualContext({
      persona: input.persona,
      messages: input.messages,
      buffer: input.buffer,
      fileName: input.fileName,
      mimeType: input.mimeType,
      mode: input.mode,
      source: input.source,
    })
    .then((derived) => {
      const userState = inferProsodyUserState({
        channel: input.source === "message_image" ? "web" : "live",
        createdAt: input.createdAt,
        visualContext: [derived],
      });

      return {
        id: randomUUID(),
        personaId: input.persona.id,
        kind:
          input.source === "message_image"
            ? "user_shared_image"
            : visualObservationKindForMode(input.mode),
        mode: input.mode,
        summary: derived.summary,
        situationalSignals: derived.situationalSignals,
        environmentPressure: derived.environmentPressure,
        taskContext: derived.taskContext,
        attentionTarget: derived.attentionTarget,
        sessionId: input.sessionId,
        sourceMessageId: input.sourceMessageId,
        userState,
        createdAt: input.createdAt,
      } satisfies PerceptionObservation;
    });
}

type SmoothedDelta = {
  field: string;
  previous: number;
  next: number;
  signedDelta: number;
  delta: number;
};

const LIVE_STATE_ALPHA = 0.35;
const POSITIVE_PROSODY_KEYS = [
  "joy",
  "love",
  "contentment",
  "satisfaction",
  "pride",
  "relief",
  "excitement",
  "amusement",
];
const NEGATIVE_PROSODY_KEYS = ["sadness", "distress", "anxiety", "anger", "pain", "fear", "tiredness", "guilt"];
const PROSODY_SHIFT_THRESHOLD = 0.12;
const PROSODY_SHIFT_SENSITIVE_THRESHOLD = 0.08;

export function computeProsodyValence(scores: Record<string, number>): number {
  const avg = (keys: string[]) => {
    const vals = keys.map((k) => scores[k] ?? 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  return avg(POSITIVE_PROSODY_KEYS) - avg(NEGATIVE_PROSODY_KEYS);
}

const REDUCIBLE_FIELDS: Array<keyof UserStateSnapshot> = [
  "valence",
  "arousal",
  "activation",
  "vulnerability",
  "desireForCloseness",
  "desireForSpace",
  "repairRisk",
  "boundaryPressure",
  "taskFocus",
  "griefLoad",
  "frustration",
  "environmentPressure",
];

export function reduceLiveUserState(
  previous: UserStateSnapshot | undefined,
  candidate: UserStateSnapshot,
  alpha = LIVE_STATE_ALPHA,
): UserStateSnapshot {
  if (!previous) return candidate;

  const reduced = { ...candidate };
  for (const field of REDUCIBLE_FIELDS) {
    const p = previous[field];
    const n = candidate[field];
    if (typeof p === "number" && typeof n === "number") {
      (reduced as Record<string, unknown>)[field] = p + alpha * (n - p);
    }
  }
  return reduced;
}

const TRANSITION_CHANNELS: Array<{
  field: keyof UserStateSnapshot;
  threshold: number;
  sensitiveThreshold: number;
  reason: string;
  alarmDirection: "rising" | "falling" | "either";
}> = [
  { field: "boundaryPressure", threshold: 0.12, sensitiveThreshold: 0.08, reason: "boundary_activated", alarmDirection: "rising" },
  { field: "repairRisk", threshold: 0.1, sensitiveThreshold: 0.06, reason: "repair_risk_crossed", alarmDirection: "rising" },
  { field: "frustration", threshold: 0.12, sensitiveThreshold: 0.08, reason: "frustration_became_salient", alarmDirection: "rising" },
  { field: "griefLoad", threshold: 0.12, sensitiveThreshold: 0.07, reason: "grief_intensified", alarmDirection: "either" },
  { field: "vulnerability", threshold: 0.14, sensitiveThreshold: 0.09, reason: "vulnerability_surfaced", alarmDirection: "either" },
  { field: "valence", threshold: 0.15, sensitiveThreshold: 0.1, reason: "valence_shifted", alarmDirection: "falling" },
  { field: "arousal", threshold: 0.15, sensitiveThreshold: 0.1, reason: "arousal_changed", alarmDirection: "either" },
  { field: "desireForSpace", threshold: 0.18, sensitiveThreshold: 0.12, reason: "space_requested", alarmDirection: "rising" },
];

const HIGH_SENSITIVITY_PROCESSES = new Set([
  "repair",
  "boundary_negotiation",
  "grief_presence",
  "protective_check_in",
]);

export type LiveTransition = {
  meaningful: boolean;
  reason: string | undefined;
  deltas: SmoothedDelta[];
};

const COMPOSITE_PATTERNS: Array<{
  channels: Array<{ field: keyof UserStateSnapshot; direction: "rising" | "falling" }>;
  thresholdMultiplier: number;
  reason: string;
}> = [
  {
    channels: [
      { field: "frustration", direction: "rising" },
      { field: "desireForSpace", direction: "rising" },
    ],
    thresholdMultiplier: 0.6,
    reason: "withdrawal_pattern",
  },
  {
    channels: [
      { field: "repairRisk", direction: "rising" },
      { field: "frustration", direction: "rising" },
    ],
    thresholdMultiplier: 0.6,
    reason: "repair_escalation",
  },
  {
    channels: [
      { field: "griefLoad", direction: "rising" },
      { field: "vulnerability", direction: "rising" },
    ],
    thresholdMultiplier: 0.6,
    reason: "grief_deepening",
  },
];

export function detectMeaningfulTransition(
  previous: UserStateSnapshot | undefined,
  next: UserStateSnapshot | undefined,
  currentProcess?: string,
): LiveTransition {
  if (!previous || !next) {
    return { meaningful: true, reason: "no_prior_state", deltas: [] };
  }

  const sensitive = currentProcess ? HIGH_SENSITIVITY_PROCESSES.has(currentProcess) : false;
  const deltas: SmoothedDelta[] = [];
  let topReason: string | undefined;
  let topDelta = 0;

  const signedDeltaMap = new Map<string, number>();

  for (const channel of TRANSITION_CHANNELS) {
    const p = previous[channel.field] as number | undefined;
    const n = next[channel.field] as number | undefined;
    const pVal = p ?? 0.5;
    const nVal = n ?? 0.5;
    const signedDelta = LIVE_STATE_ALPHA * (nVal - pVal);
    const delta = Math.abs(signedDelta);
    deltas.push({ field: channel.field, previous: pVal, next: nVal, signedDelta, delta });
    signedDeltaMap.set(channel.field, signedDelta);

    const bar = sensitive ? channel.sensitiveThreshold : channel.threshold;
    if (delta < bar || delta <= topDelta) continue;
    if (channel.alarmDirection === "rising" && signedDelta <= 0) continue;
    if (channel.alarmDirection === "falling" && signedDelta >= 0) continue;

    topDelta = delta;
    topReason = channel.reason;
  }

  if (!topReason) {
    for (const pattern of COMPOSITE_PATTERNS) {
      let allMatch = true;
      let minDelta = Infinity;
      for (const req of pattern.channels) {
        const sd = signedDeltaMap.get(req.field) ?? 0;
        const matchesDirection =
          (req.direction === "rising" && sd > 0) ||
          (req.direction === "falling" && sd < 0);
        if (!matchesDirection) {
          allMatch = false;
          break;
        }
        const ch = TRANSITION_CHANNELS.find((c) => c.field === req.field);
        const bar = ch ? (sensitive ? ch.sensitiveThreshold : ch.threshold) : 0.12;
        const needed = bar * pattern.thresholdMultiplier;
        if (Math.abs(sd) < needed) {
          allMatch = false;
          break;
        }
        minDelta = Math.min(minDelta, Math.abs(sd));
      }
      if (allMatch && minDelta > topDelta) {
        topDelta = minDelta;
        topReason = pattern.reason;
      }
    }
  }

  if (!topReason && previous.prosodyScores && next.prosodyScores) {
    const prevProsodyValence = computeProsodyValence(previous.prosodyScores);
    const nextProsodyValence = computeProsodyValence(next.prosodyScores);
    const prosodyShift = nextProsodyValence - prevProsodyValence;
    const prosodyThreshold = sensitive
      ? PROSODY_SHIFT_SENSITIVE_THRESHOLD
      : PROSODY_SHIFT_THRESHOLD;

    if (prosodyShift < -prosodyThreshold) {
      topReason = "prosody_shift";
      topDelta = Math.abs(prosodyShift);
    }
  }

  return {
    meaningful: topReason !== undefined,
    reason: topReason,
    deltas,
  };
}

function shouldPeriodicSync(input: {
  sessionUserTurnCount: number;
  lastTransitionTurnIndex: number;
  activeProcess: string;
}): boolean {
  const { sessionUserTurnCount, lastTransitionTurnIndex, activeProcess } = input;
  if (sessionUserTurnCount <= 1) return false;

  const highSensitivity = ["repair", "boundary_negotiation", "grief_presence"].includes(activeProcess);
  const baseInterval = Math.min(10, 4 + Math.floor(sessionUserTurnCount / 8));
  const interval = highSensitivity ? Math.max(3, baseInterval - 2) : baseInterval;
  const turnsSinceTransition = sessionUserTurnCount - lastTransitionTurnIndex;
  return turnsSinceTransition >= interval && turnsSinceTransition % interval === 0;
}

function shouldEnqueueLiveShadowTurn(input: {
  persona: Persona;
  inferredUserState?: UserStateSnapshot;
  messages: MessageEntry[];
  sessionId?: string;
  hasContextualUpdate: boolean;
}): { enqueue: boolean; reason: string } {
  const { persona, inferredUserState, hasContextualUpdate } = input;

  if (hasContextualUpdate) return { enqueue: true, reason: "boundary_activated" };

  const previous = persona.mindState.lastUserState;
  if (!previous || !inferredUserState) return { enqueue: true, reason: "no_prior_state" };

  const sessionUserTurns = input.messages.filter(
    (m) =>
      m.channel === "live" &&
      m.role === "user" &&
      (!input.sessionId || m.metadata?.sessionId === input.sessionId),
  );
  if (sessionUserTurns.length <= 1) return { enqueue: true, reason: "session_first_turn" };

  const transition = detectMeaningfulTransition(previous, inferredUserState, persona.mindState.activeProcess);
  if (transition.meaningful) {
    if (input.sessionId) {
      recordLiveTransitionSessionTurn(input.sessionId, sessionUserTurns.length);
    }
    return { enqueue: true, reason: transition.reason ?? "state_transition" };
  }

  const lastTransitionIdx = input.sessionId
    ? (getLiveTransitionSessionTurn(input.sessionId) ?? 1)
    : 1;
  if (
    shouldPeriodicSync({
      sessionUserTurnCount: sessionUserTurns.length,
      lastTransitionTurnIndex: lastTransitionIdx,
      activeProcess: persona.mindState.activeProcess,
    })
  ) {
    if (input.sessionId) {
      recordLiveTransitionSessionTurn(input.sessionId, sessionUserTurns.length);
    }
    return { enqueue: true, reason: "periodic_sync" };
  }

  return { enqueue: false, reason: "deferred_to_consolidation" };
}

export function compareVisualObservation(
  previous: PerceptionObservation | undefined,
  next: PerceptionObservation,
): { escalate: boolean; reason: string } {
  const DISTRESS_SIGNALS = /\b(distress|crying|urgent|emergency|panic|injury|blood|accident)\b/i;

  if (!previous) {
    return { escalate: true, reason: "first_visual_observation" };
  }

  if (next.situationalSignals.some((s) => DISTRESS_SIGNALS.test(s))) {
    return { escalate: true, reason: "high_signal_distress" };
  }

  if (
    next.attentionTarget &&
    previous.attentionTarget &&
    next.attentionTarget !== previous.attentionTarget
  ) {
    return { escalate: true, reason: "attention_target_changed" };
  }

  if (next.taskContext && previous.taskContext && next.taskContext !== previous.taskContext) {
    return { escalate: true, reason: "task_context_changed" };
  }

  const pressureDelta = Math.abs(next.environmentPressure - previous.environmentPressure);
  if (pressureDelta >= 0.2) {
    return { escalate: true, reason: "environment_pressure_jump" };
  }

  const previousSignalSet = new Set(previous.situationalSignals.map((s) => s.toLowerCase()));
  const novelSignals = next.situationalSignals.filter(
    (s) => !previousSignalSet.has(s.toLowerCase()),
  );
  if (novelSignals.length >= 2) {
    return { escalate: true, reason: "novel_situational_signals" };
  }

  if (next.environmentPressure >= 0.7) {
    return { escalate: true, reason: "high_environment_pressure" };
  }

  return { escalate: false, reason: "visual_scene_stable" };
}

async function recordLiveShadowTurnOutcome(input: {
  persona: Persona;
  sessionId?: string;
  mode?: LiveSessionMode;
  reason: string;
  kind: "enqueued" | "skipped";
  at: string;
}) {
  if (!input.sessionId) {
    return input.persona;
  }

  return updatePersona(input.persona.id, (persona) => ({
    ...persona,
    mindState: updateMindStateLiveSessionMetrics(persona.mindState, {
      sessionId: input.sessionId,
      mode: input.mode,
      at: input.at,
      updater: (metric) => ({
        ...metric,
        shadowTurnsEnqueued:
          metric.shadowTurnsEnqueued + (input.kind === "enqueued" ? 1 : 0),
        shadowTurnsSkipped:
          metric.shadowTurnsSkipped + (input.kind === "skipped" ? 1 : 0),
        periodicSyncEnqueues:
          metric.periodicSyncEnqueues +
          (input.kind === "enqueued" && input.reason === "periodic_sync" ? 1 : 0),
      }),
    }),
  }));
}

async function recordLivePollNoDelivery(input: {
  persona: Persona;
  sessionId?: string;
  mode?: LiveSessionMode;
  at: string;
}) {
  if (!input.sessionId || !input.persona.mindState.liveSessionMetrics[input.sessionId]) {
    return input.persona;
  }

  return updatePersona(input.persona.id, (persona) => ({
    ...persona,
    mindState: updateMindStateLiveSessionMetrics(persona.mindState, {
      sessionId: input.sessionId,
      mode: input.mode,
      at: input.at,
      updater: (metric) => ({
        ...metric,
        pollNoDeliveryCount: metric.pollNoDeliveryCount + 1,
      }),
    }),
  }));
}

async function recordLiveDeliveryCoalesced(input: {
  persona: Persona;
  sessionId?: string;
  mode?: LiveSessionMode;
  reason?: string;
  at: string;
}) {
  if (!input.sessionId) {
    return input.persona;
  }

  if (
    input.persona.mindState.lastCoalescedLiveDeliveryVersion ===
    input.persona.mindState.liveDeliveryVersion
  ) {
    return input.persona;
  }

  return updatePersona(input.persona.id, (persona) => ({
    ...persona,
    mindState: updateMindStateLiveSessionMetrics(
      {
        ...persona.mindState,
        lastCoalescedLiveDeliveryVersion: persona.mindState.liveDeliveryVersion,
      },
      {
        sessionId: input.sessionId,
        mode: input.mode,
        at: input.at,
        updater: (metric) => ({
          ...metric,
          coalescedCount: metric.coalescedCount + 1,
          coalescedReasons: incrementCountMap(metric.coalescedReasons, input.reason),
        }),
      },
    ),
  }));
}

async function recordLiveDeliverySent(input: {
  persona: Persona;
  sessionId?: string;
  mode?: LiveSessionMode;
  reason?: string;
  at: string;
}) {
  if (!input.sessionId) {
    return input.persona;
  }

  return updatePersona(input.persona.id, (persona) => {
    const existingMetric = persona.mindState.liveSessionMetrics[input.sessionId!];
    const intervalMs =
      existingMetric?.lastDeliveredAt
        ? Math.max(0, new Date(input.at).getTime() - new Date(existingMetric.lastDeliveredAt).getTime())
        : 0;

    return {
      ...persona,
      mindState: updateMindStateLiveSessionMetrics(
        {
          ...persona.mindState,
          lastLiveDeliverySentAt: input.at,
        },
        {
          sessionId: input.sessionId,
          mode: input.mode,
          at: input.at,
          updater: (metric) => {
            const deliveryIntervalCount = metric.deliveryIntervalCount + (intervalMs > 0 ? 1 : 0);
            const totalDeliveryIntervalMs = metric.totalDeliveryIntervalMs + intervalMs;
            return {
              ...metric,
              deliveriesSent: metric.deliveriesSent + 1,
              sentReasons: incrementCountMap(metric.sentReasons, input.reason),
              totalDeliveryIntervalMs,
              deliveryIntervalCount,
              averageDeliveryIntervalMs:
                deliveryIntervalCount > 0
                  ? totalDeliveryIntervalMs / deliveryIntervalCount
                  : metric.averageDeliveryIntervalMs,
              lastDeliveredAt: input.at,
            };
          },
        },
      ),
    };
  });
}

async function finalizeLiveSessionMetrics(input: {
  personaId: string;
  sessionId?: string;
  mode?: LiveSessionMode;
  endedAt: string;
}) {
  if (!input.sessionId) {
    return;
  }
  const sessionId = input.sessionId;

  await updatePersona(input.personaId, (persona) => ({
    ...persona,
    mindState: {
      ...persona.mindState,
      liveSessionMetrics: persona.mindState.liveSessionMetrics[sessionId]
        ? pruneLiveSessionMetrics(
            updateLiveSessionMetricsCollection(persona.mindState.liveSessionMetrics, {
              sessionId,
              mode: input.mode,
              at: input.endedAt,
              updater: (metric) => ({
                ...metric,
                endedAt: input.endedAt,
              }),
            }),
          )
        : persona.mindState.liveSessionMetrics,
    },
  }));
}

export function resetLiveSessionState() {
  clearLiveTransitionSessionState();
}

export async function resetServiceRuntimeStateForTests() {
  resetLiveSessionState();
}

export async function getLiveContextUpdate(
  personaId: string,
  input: {
    sessionId?: string;
    afterVersion?: number;
  },
) {
  if (!isInngestExecutionEnabled()) {
    const { processNextShadowTurnForServices } = await import("@/lib/services/internal-events");
    for (let count = 0; count < 2; count += 1) {
      const processed = await processNextShadowTurnForServices(personaId, input.sessionId);
      if (!processed) {
        break;
      }
    }
  }

  const persona = await getPersona(personaId);
  if (!persona) {
    throw new Error("Persona not found.");
  }

  const pendingJobs = persona.mindState.pendingShadowTurns.filter((job) => {
    if (job.status === "completed" || job.status === "failed") {
      return false;
    }

    if (!input.sessionId) {
      return true;
    }

    return job.sessionId === input.sessionId;
  }).length;

  const delivering = persona.mindState.liveDeliveryVersion > (input.afterVersion ?? 0);
  const at = new Date().toISOString();
  const sessionMode = input.sessionId
    ? persona.mindState.liveSessionMetrics[input.sessionId]?.mode
    : undefined;
  const deliveryReason = currentLiveDeliveryMetricReason(persona);

  if (!delivering) {
    const metricPersona = await recordLivePollNoDelivery({
      persona,
      sessionId: input.sessionId,
      mode: sessionMode,
      at,
    });

    soulLogger.debug(
      {
        ...buildDebugContext(metricPersona, {
          event: "live_context_poll_no_delivery",
          sessionId: input.sessionId,
          channel: "live",
        }),
        beforeLiveSessionMetrics: summarizeLiveSessionMetrics(
          persona.mindState.liveSessionMetrics,
          input.sessionId,
        ),
        afterLiveSessionMetrics: summarizeLiveSessionMetrics(
          metricPersona.mindState.liveSessionMetrics,
          input.sessionId,
        ),
        event: "live_context_poll_no_delivery",
      },
      "Live context poll had no pending delivery",
    );

    return {
      persona: metricPersona,
      sessionFrame: undefined,
      pendingJobs,
    };
  }

  const lastSentAt = persona.mindState.lastLiveDeliverySentAt;
  const withinCooldown =
    !isCriticalLiveDeliveryReason(deliveryReason) &&
    Boolean(lastSentAt) &&
    new Date(at).getTime() - new Date(lastSentAt!).getTime() < MIN_LIVE_DELIVERY_INTERVAL_MS;

  if (withinCooldown) {
    const metricPersona = await recordLiveDeliveryCoalesced({
      persona,
      sessionId: input.sessionId,
      mode: sessionMode,
      reason: deliveryReason,
      at,
    });

    soulLogger.debug(
      {
        ...buildDebugContext(metricPersona, {
          event: "live_context_delivery_coalesced",
          sessionId: input.sessionId,
          channel: "live",
        }),
        version: persona.mindState.liveDeliveryVersion,
        reason: deliveryReason,
        beforeLiveSessionMetrics: summarizeLiveSessionMetrics(
          persona.mindState.liveSessionMetrics,
          input.sessionId,
        ),
        afterLiveSessionMetrics: summarizeLiveSessionMetrics(
          metricPersona.mindState.liveSessionMetrics,
          input.sessionId,
        ),
      },
      "Live context delivery coalesced during cooldown",
    );

    return {
      persona: metricPersona,
      sessionFrame: undefined,
      pendingJobs,
    };
  }

  const [messages, feedbackNotes, observations] = await Promise.all([
    listMessages(personaId),
    listFeedback(personaId).then((entries) => entries.map((entry) => entry.note)),
    listPerceptionObservations(personaId),
  ]);
  const perception = resolveLivePerceptionForSession(input.sessionId, observations);
  const sessionFrame = buildSessionFrame({
    persona,
    messages,
    feedbackNotes,
    perception,
    liveOverlay: true,
  });
  const metricPersona = await recordLiveDeliverySent({
    persona,
    sessionId: input.sessionId,
    mode: sessionMode,
    reason: deliveryReason,
    at,
  });

  soulLogger.debug(
    {
      ...buildDebugContext(metricPersona, {
        event: "live_context_delivery_sent",
        sessionId: input.sessionId,
        channel: "live",
      }),
      version: sessionFrame.liveDeliveryVersion,
      reason: deliveryReason,
      contextTextLength: sessionFrame.contextText.length,
      beforeLiveSessionMetrics: summarizeLiveSessionMetrics(
        persona.mindState.liveSessionMetrics,
        input.sessionId,
      ),
      afterLiveSessionMetrics: summarizeLiveSessionMetrics(
        metricPersona.mindState.liveSessionMetrics,
        input.sessionId,
      ),
    },
    "Live context delivery sent to Hume",
  );

  return {
    persona: metricPersona,
    sessionFrame,
    pendingJobs,
  };
}

export async function appendLiveTranscriptTurn(personaId: string, payload: unknown) {
  const { liveTranscriptRequestSchema } = await import("@/lib/types");
  const parsed = liveTranscriptRequestSchema.parse(payload);
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  if (persona.status !== "active") {
    throw new Error("This persona must be approved before live conversation can begin.");
  }

  const body = parsed.body.trim();
  if (!body) {
    throw new Error("A transcript body is required.");
  }

  const existingLiveMessage = parsed.eventId
    ? (await listMessages(personaId)).find(
        (message) =>
          message.channel === "live" &&
          message.role === parsed.role &&
          message.metadata?.humeMessageId === parsed.eventId &&
          message.metadata?.sessionId === parsed.sessionId,
      )
    : undefined;

  if (existingLiveMessage) {
    return {
      message: existingLiveMessage,
      persona,
      sessionFrame: undefined,
      contextualUpdate: undefined,
    };
  }

  const isAssistant = parsed.role === "assistant";
  const liveMessageCreatedAt = new Date().toISOString();
  const currentObservations = await listPerceptionObservations(personaId);
  const inferredUserState =
    !isAssistant
      ? inferProsodyUserState({
          channel: "live",
          createdAt: liveMessageCreatedAt,
          prosodyScores: parsed.prosodyScores,
          visualContext: currentObservations.slice(-3).map((observation) => ({
            summary: observation.summary,
            situationalSignals: observation.situationalSignals,
            environmentPressure: observation.environmentPressure,
            taskContext: observation.taskContext,
            attentionTarget: observation.attentionTarget,
          })),
        })
      : undefined;
  const message = createMessage({
    personaId,
    role: parsed.role,
    kind: "text",
    channel: "live",
    body,
    userState: inferredUserState,
    metadata: {
      humeMessageId: parsed.eventId,
      fromText: parsed.fromText,
      language: parsed.language,
      liveMode: parsed.liveMode,
      sessionId: parsed.sessionId,
      prosodyScores: parsed.prosodyScores,
    },
    audioStatus:
      isAssistant && persona.voice.status !== "unavailable" && persona.voice.voiceId
        ? "text_fallback"
        : "unavailable",
    createdAt: liveMessageCreatedAt,
    replyMode: isAssistant ? "voice_note" : undefined,
    delivery: {
      webInbox: true,
      attempts: 0,
    },
  });

  await appendMessages([message]);

  let activePersona = persona;
  const contextualUpdates: string[] = [];
  const preUpdatePersona = persona;

  if (inferredUserState) {
    activePersona = await updatePersona(personaId, (current) => {
      const smoothed = reduceLiveUserState(current.mindState.lastUserState, inferredUserState);
      return {
        ...current,
        updatedAt: inferredUserState.createdAt,
        lastActiveAt: inferredUserState.createdAt,
        mindState: {
          ...current.mindState,
          lastUserState: smoothed,
          recentUserStates: [smoothed, ...current.mindState.recentUserStates].slice(0, 12),
          recentShift: inferredUserState.summary ?? current.mindState.recentShift ?? "",
          contextVersion: current.mindState.contextVersion + 1,
        },
      };
    });
  }

  if (!isAssistant) {
    const learned = await applyPreferenceSignalIfNeeded(activePersona, body, {
      sourceMessageId: message.id,
      sessionId: parsed.sessionId,
    });
    activePersona = learned.persona;
    if (learned.contextualUpdate) {
      contextualUpdates.push(learned.contextualUpdate);
      activePersona = await updatePersona(activePersona.id, (current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        mindState: updateMindStateLiveSessionMetrics(
          {
            ...current.mindState,
            liveDeliveryVersion: current.mindState.liveDeliveryVersion + 1,
            lastLiveDeliveryReason: "boundary or preference changed during the live call",
            processState: {
              ...current.mindState.processState,
              last_live_delivery_reason: "boundary or preference changed during the live call",
              live_delivery_metric_reason: "boundary or preference changed during the live call",
              live_delivery_version: String(current.mindState.liveDeliveryVersion + 1),
            },
          },
          {
            sessionId: parsed.sessionId,
            mode: parsed.liveMode ?? "voice",
            at: new Date().toISOString(),
            updater: (metric) => ({
              ...metric,
              deliveryRequestedCount: metric.deliveryRequestedCount + 1,
              deliveryRequestedReasons: incrementCountMap(
                metric.deliveryRequestedReasons,
                "boundary or preference changed during the live call",
              ),
            }),
          },
        ),
      }));
    }
  }

  const messages = await listMessages(personaId);
  const feedbackNotes = await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const perception = {
    kind: isAssistant ? "assistant_message" : "user_message",
    modality: "live_voice",
    content: body,
    channel: "live",
    createdAt: message.createdAt,
    internal: false,
    causationId: message.id,
    correlationId: parsed.sessionId ?? message.id,
    sessionId: parsed.sessionId,
    userStateId: inferredUserState?.id,
    metadata: {
      ...(parsed.liveMode ? { mode: parsed.liveMode } : {}),
      ...(parsed.prosodyScores ? { prosodyScores: parsed.prosodyScores } : {}),
    },
  } satisfies SoulPerception;

  const hasContextualUpdate = contextualUpdates.length > 0;
  const shadowDecision = isAssistant
    ? { enqueue: false, reason: "assistant_turn" }
    : shouldEnqueueLiveShadowTurn({
        persona: preUpdatePersona,
        inferredUserState,
        messages,
        sessionId: parsed.sessionId,
        hasContextualUpdate,
      });

  if (shadowDecision.enqueue) {
    const shadowTurn = buildPendingShadowTurn({
      persona: activePersona,
      perception: {
        ...perception,
        metadata: {
          ...(perception.metadata ?? {}),
          shadowTriggerReason: shadowDecision.reason,
        },
      },
      sessionId: parsed.sessionId,
      providedUserState: inferredUserState,
    });

    activePersona = await enqueueShadowTurnForExecution(activePersona.id, shadowTurn, {
      backgroundFallback: false,
    });
    activePersona = await recordLiveShadowTurnOutcome({
      persona: activePersona,
      sessionId: parsed.sessionId,
      mode: parsed.liveMode ?? "voice",
      reason: shadowDecision.reason,
      kind: "enqueued",
      at: message.createdAt,
    });
  } else {
    activePersona = await recordLiveShadowTurnOutcome({
      persona: activePersona,
      sessionId: parsed.sessionId,
      mode: parsed.liveMode ?? "voice",
      reason: shadowDecision.reason,
      kind: "skipped",
      at: message.createdAt,
    });
  }

  const sessionFrame = hasContextualUpdate
    ? buildSessionFrame({
        persona: activePersona,
        messages,
        feedbackNotes,
        perception,
        contextDelta: contextualUpdates.join(" "),
        liveOverlay: true,
      })
    : undefined;

  return {
    message,
    persona: activePersona,
    sessionFrame,
    contextualUpdate: hasContextualUpdate ? contextualUpdates.join("\n\n") : undefined,
  };
}

export async function observeLiveVisualPerception(
  personaId: string,
  payload: {
    mode: LiveSessionMode;
    sessionId?: string;
    event?: "frame" | "start" | "end";
    imageFile?: File | null;
    timestamp?: string;
  },
) {
  if (payload.mode !== "screen" && payload.mode !== "camera") {
    throw new Error("Visual perception only supports screen or camera modes.");
  }

  const persona = await getPersona(personaId);
  if (!persona) {
    throw new Error("Persona not found.");
  }
  if (persona.status !== "active") {
    throw new Error("This persona must be approved before live conversation can begin.");
  }

  const createdAt = payload.timestamp
    ? new Date(payload.timestamp).toISOString()
    : new Date().toISOString();
  const messages = await listMessages(personaId);
  let observation: PerceptionObservation;

  if (payload.event === "start" || payload.event === "end") {
    observation = {
      id: randomUUID(),
      personaId,
      kind: visualSessionEventKind(payload.event),
      mode: payload.mode,
      summary:
        payload.event === "start"
          ? `${payload.mode === "screen" ? "Screen" : "Camera"} sharing began.`
          : `${payload.mode === "screen" ? "Screen" : "Camera"} sharing ended.`,
      situationalSignals:
        payload.event === "start"
          ? [`${payload.mode} sharing is active`]
          : [`${payload.mode} sharing is no longer active`],
      environmentPressure: 0.5,
      sessionId: payload.sessionId,
      createdAt,
    };
  } else {
    if (!payload.imageFile || payload.imageFile.size === 0) {
      throw new Error("A visual frame is required.");
    }

    const buffer = Buffer.from(await payload.imageFile.arrayBuffer());
    observation = await createDerivedVisualObservation({
      persona,
      messages,
      mode: payload.mode,
      source: payload.mode,
      fileName: payload.imageFile.name,
      mimeType: payload.imageFile.type || "image/jpeg",
      buffer,
      createdAt,
      sessionId: payload.sessionId,
    });
  }

  await appendPerceptionObservations([observation]);
  const fastPersona = observation.userState
    ? await updatePersona(personaId, (current) => {
        const smoothed = reduceLiveUserState(current.mindState.lastUserState, observation.userState!);
        return {
          ...current,
          updatedAt: observation.createdAt,
          lastActiveAt: observation.createdAt,
          mindState: {
            ...current.mindState,
            lastUserState: smoothed,
            recentUserStates: [smoothed, ...current.mindState.recentUserStates].slice(0, 12),
            recentShift: observation.userState?.summary ?? current.mindState.recentShift ?? "",
            contextVersion: current.mindState.contextVersion + 1,
          },
        };
      })
    : persona;
  const feedbackNotes = await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const perception = {
    kind: observation.kind,
    modality: "multimodal",
    content: observation.summary,
    channel: "live",
    createdAt,
    internal: true,
    causationId: observation.sourceMessageId ?? observation.id,
    correlationId: payload.sessionId ?? observation.id,
    sessionId: payload.sessionId,
    userStateId: observation.userState?.id,
    metadata: {
      mode: payload.mode,
    },
  } satisfies SoulPerception;

  const isSessionEvent = payload.event === "start" || payload.event === "end";
  const allObservations = await listPerceptionObservations(personaId);
  const previousSessionObs = allObservations
    .filter(
      (o) =>
        o.sessionId === payload.sessionId &&
        o.id !== observation.id &&
        o.kind !== "visual_session_start" &&
        o.kind !== "visual_session_end",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);

  const visualDecision = isSessionEvent
    ? { escalate: true, reason: "session_mode_transition" }
    : compareVisualObservation(previousSessionObs, observation);

  let resultPersona = fastPersona;
  if (visualDecision.escalate) {
    const shadowTurn = buildPendingShadowTurn({
      persona: fastPersona,
      perception: {
        ...perception,
        metadata: {
          ...(perception.metadata ?? {}),
          shadowTriggerReason: visualDecision.reason,
        },
      },
      sessionId: payload.sessionId,
      providedUserState: observation.userState,
    });
    resultPersona = await enqueueShadowTurnForExecution(fastPersona.id, shadowTurn, {
      backgroundFallback: false,
    });
    resultPersona = await recordLiveShadowTurnOutcome({
      persona: resultPersona,
      sessionId: payload.sessionId,
      mode: payload.mode,
      reason: visualDecision.reason,
      kind: "enqueued",
      at: createdAt,
    });
  } else {
    resultPersona = await recordLiveShadowTurnOutcome({
      persona: resultPersona,
      sessionId: payload.sessionId,
      mode: payload.mode,
      reason: visualDecision.reason,
      kind: "skipped",
      at: createdAt,
    });
  }

  const sessionFrame = visualDecision.escalate
    ? buildSessionFrame({
        persona: resultPersona,
        messages,
        feedbackNotes,
        perception,
        contextDelta: `Visual observation escalated (${visualDecision.reason}) from ${payload.mode}.`,
        liveOverlay: true,
      })
    : undefined;

  return {
    observation,
    persona: resultPersona,
    sessionFrame,
    contextualUpdate: sessionFrame?.contextDelta,
  };
}

export async function finalizeLiveSession(
  personaId: string,
  payload: {
    sessionId?: string;
    mode?: LiveSessionMode;
    reason?: "user_end" | "disconnect";
  },
) {
  const persona = await getPersona(personaId);
  if (!persona) {
    throw new Error("Persona not found.");
  }

  const existingJob = persona.mindState.pendingShadowTurns.find(
    (job) =>
      job.sessionId === payload.sessionId &&
      job.perception.kind === "memory_consolidation" &&
      job.status !== "failed",
  );

  if (existingJob) {
    clearLiveTransitionSessionState(payload.sessionId);
    return {
      persona,
      queued: false,
      jobId: existingJob.id,
    };
  }

  const liveMetricsBefore = summarizeLiveSessionMetrics(
    persona.mindState.liveSessionMetrics,
    payload.sessionId,
  );
  const pendingEventsBefore = summarizePendingInternalEvents(
    persona.mindState.pendingInternalEvents,
  );

  const [messages, observations, feedback] = await Promise.all([
    listMessages(personaId),
    listPerceptionObservations(personaId),
    listFeedback(personaId),
  ]);

  const sessionMessages = messages.filter(
    (m) => m.channel === "live" && (!payload.sessionId || m.metadata?.sessionId === payload.sessionId),
  );
  const sessionObservations = observations.filter(
    (o) => !payload.sessionId || o.sessionId === payload.sessionId,
  );
  const userTurns = sessionMessages.filter((m) => m.role === "user");
  const assistantTurns = sessionMessages.filter((m) => m.role === "assistant");
  const sessionFeedback = feedback.filter((f) =>
    sessionMessages.some((m) => m.id === f.messageId),
  );

  const stateSnapshots = userTurns.filter((m) => m.userState).slice(-10);
  const userStateTrajectory = stateSnapshots
    .map(
      (m) =>
        `[${m.userState?.summary ?? "unknown"}] valence=${(m.userState?.valence ?? 0).toFixed(2)} vulnerability=${(m.userState?.vulnerability ?? 0).toFixed(2)} frustration=${(m.userState?.frustration ?? 0).toFixed(2)}`,
    )
    .join(" → ");

  const peakFrustration = Math.max(0, ...stateSnapshots.map((m) => m.userState?.frustration ?? 0));
  const peakRepairRisk = Math.max(0, ...stateSnapshots.map((m) => m.userState?.repairRisk ?? 0));
  const repairWarning =
    peakFrustration >= 0.5 || peakRepairRisk >= 0.45 || sessionFeedback.length > 0;

  const keyUserPhrases = userTurns
    .slice(-6)
    .map((m) => m.body)
    .filter((b) => b.length > 10);

  const visualSummary = sessionObservations
    .filter((o) => o.kind !== "visual_session_start" && o.kind !== "visual_session_end")
    .slice(-4)
    .map((o) => o.summary)
    .join("; ");

  const consolidationBrief = [
    `## Session Summary`,
    `Session ended (${payload.reason ?? "disconnect"}). ${userTurns.length} user turns, ${assistantTurns.length} assistant turns.`,
    sessionObservations.length > 0
      ? `Visual context: ${sessionObservations.length} observations (${payload.mode ?? "voice"}). ${visualSummary}`
      : undefined,
    userStateTrajectory ? `\n## Emotional Trajectory\n${userStateTrajectory}` : undefined,
    keyUserPhrases.length > 0
      ? `\n## Key User Phrases\n${keyUserPhrases.map((p) => `- "${p}"`).join("\n")}`
      : undefined,
    repairWarning
      ? `\n## Repair Notes\nPeak frustration: ${peakFrustration.toFixed(2)}, peak repair risk: ${peakRepairRisk.toFixed(2)}.${sessionFeedback.length > 0 ? ` User gave ${sessionFeedback.length} correction(s) during the call: ${sessionFeedback.map((f) => f.note).join("; ")}` : ""} Produce explicit repair notes if warranted.`
      : undefined,
    `\n## Consolidation Directives`,
    `Extract the following durable learning from this session:`,
    `1. **Episodic memory**: What happened in this call that is worth remembering as a concrete episode?`,
    `2. **Learned user notes**: What did you learn about the user (facts, habits, concerns, context)?`,
    `3. **Learned relationship notes**: How did the relationship change or deepen? Any new shared references, rituals, or trust signals?`,
    repairWarning
      ? `4. **Repair notes**: What went wrong, and what should be different next time?`
      : undefined,
    `5. **Open loops**: Are there follow-through items the user mentioned (appointments, events, decisions) that deserve a check-in later?`,
    `6. **Relational tone summary**: In one sentence, how would you describe the emotional quality of this interaction?`,
    `\nDo not overfit transient phrasing. Focus on what will still matter in the next conversation.`,
  ]
    .filter(Boolean)
    .join("\n");

  const createdAt = new Date().toISOString();
  const perception = {
    kind: "memory_consolidation" as const,
    modality: "live_voice" as const,
    channel: "live" as const,
    internal: true,
    createdAt,
    sessionId: payload.sessionId,
    correlationId: payload.sessionId ?? `session-end-${personaId}`,
    content: consolidationBrief,
    metadata: {
      mode: payload.mode ?? "voice",
      reason: payload.reason ?? "disconnect",
      sessionEnded: true,
      sessionTurnCount: userTurns.length + assistantTurns.length,
      sessionObservationCount: sessionObservations.length,
      sessionFeedbackCount: sessionFeedback.length,
      peakFrustration,
      peakRepairRisk,
      repairWarning,
    },
  } satisfies SoulPerception;

  const shadowTurn = buildPendingShadowTurn({
    persona,
    perception,
    sessionId: payload.sessionId,
  });

  const queuedPersona = await enqueueShadowTurnForExecution(persona.id, shadowTurn, {
    backgroundFallback: false,
  });

  await finalizeLiveSessionMetrics({
    personaId,
    sessionId: payload.sessionId,
    mode: payload.mode,
    endedAt: createdAt,
  });

  const finalizedPersona = (await getPersona(personaId)) ?? queuedPersona;

  clearLiveTransitionSessionState(payload.sessionId);

  soulLogger.debug(
    {
      ...buildDebugContext(finalizedPersona, {
        event: "post_call_consolidation_enqueued",
        sessionId: payload.sessionId,
        channel: "live",
      }),
      userTurnCount: userTurns.length,
      assistantTurnCount: assistantTurns.length,
      observationCount: sessionObservations.length,
      feedbackCount: sessionFeedback.length,
      repairWarning,
      beforeLiveSessionMetrics: liveMetricsBefore,
      afterLiveSessionMetrics: summarizeLiveSessionMetrics(
        finalizedPersona.mindState.liveSessionMetrics,
        payload.sessionId,
      ),
      beforePendingInternalEvents: pendingEventsBefore,
      afterPendingInternalEvents: summarizePendingInternalEvents(
        finalizedPersona.mindState.pendingInternalEvents,
      ),
    },
    "Post-call consolidation enqueued",
  );

  return {
    persona: finalizedPersona,
    queued: true,
    jobId: shadowTurn.id,
  };
}
