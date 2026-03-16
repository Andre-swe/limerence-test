import { randomUUID } from "node:crypto";
import {
  appendFeedback,
  appendMessages,
  appendPerceptionObservations,
  bindTelegramChat,
  claimPersonaShadowTurn,
  claimPersonaShadowTurnById,
  enqueuePersonaShadowTurn,
  findPersonaByTelegramChat,
  getPersona,
  hasProcessedTelegramUpdate,
  listFeedback,
  listMessages,
  listPendingTelegramMessages,
  listPerceptionObservations,
  listPersonas,
  markTelegramUpdateProcessed,
  replacePersonaIfRevision,
  savePersona,
  savePublicFile,
  updateMessage,
  updatePersona,
  updatePersonaShadowTurn,
} from "@/lib/store";
import { getProviders, getProviderStatus } from "@/lib/providers";
import { executeFastMessageTurn, executeSoulTurn } from "@/lib/soul-engine";
import {
  isInngestExecutionEnabled,
  publishPersonaShadowTurns,
  publishSoulInternalEvents,
} from "@/lib/inngest";
import {
  applyBoundaryClaimUpdate,
  applyFeedbackToMemoryClaims,
  seedBootstrapClaims,
} from "@/lib/memory-v2";
import { buildSoulHarness, renderLiveContextOverlay } from "@/lib/soul-harness";
import { planInternalMonologue, renderInternalMonologuePrompt } from "@/lib/soul-runtime";
import {
  applySoulArchetypeToConstitution,
  applySoulArchetypeToRelationship,
  inferSoulArchetypeSeed,
} from "@/lib/personality-archetypes";
import { soulLogger } from "@/lib/soul-logger";
import { getHouseVoicePreset, houseVoicePresets } from "@/lib/voice-presets";
import {
  type ConversationChannel,
  type FeedbackEvent,
  type LiveSessionMode,
  feedbackRequestSchema,
  type HeartbeatPolicy,
  type HeartbeatDecision,
  type LiveSessionMetrics,
  liveTranscriptRequestSchema,
  type LiveTranscriptRequest,
  type MessageAttachment,
  type MessageEntry,
  type PendingShadowTurn,
  type PerceptionObservation,
  type Persona,
  type PersonaAssemblyInput,
  type PreferenceSignal,
  type PersonaSource,
  type SoulEvent,
  type SoulPerception,
  type SoulSessionFrame,
  type StoredAsset,
  type UserStateSnapshot,
  type VoiceProfile,
} from "@/lib/types";
import {
  createInitialMindState,
  createPersonalityConstitution,
  createRelationshipModel,
  inferHeuristicUserState,
} from "@/lib/mind-runtime";
import { slugify } from "@/lib/utils";

type PreferenceUpdate = {
  kind: "avoid_work_hours" | "prefer_text" | "prefer_voice" | "less_often" | "more_often";
  interpretation: string;
  effectSummary: string;
  status: PreferenceSignal["status"];
  apply: (policy: HeartbeatPolicy) => HeartbeatPolicy;
};

const localShadowExecutionQueues = new Map<string, Promise<void>>();
const MIN_LIVE_DELIVERY_INTERVAL_MS = 4500;
const MAX_COMPLETED_LIVE_SESSION_METRICS = 8;
const TELEGRAM_DELIVERY_TIMEOUT_MS = 15_000;

function resolveStartingVoiceId(starterVoiceId?: string) {
  return (
    getHouseVoicePreset(starterVoiceId)?.id ??
    houseVoicePresets[0]?.id ??
    undefined
  );
}

function scheduleLocalShadowExecution(personaId: string, jobId: string) {
  const previous = localShadowExecutionQueues.get(personaId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await executeQueuedShadowTurn(personaId, jobId);
    })
    .catch((error) => {
      soulLogger.warn(
        {
          personaId,
          jobId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Falling back to local background shadow execution",
      );
    });

  localShadowExecutionQueues.set(personaId, next);
}

function incrementCountMap(
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

function isLiveSessionMode(value: unknown): value is LiveSessionMode {
  return value === "voice" || value === "screen" || value === "camera";
}

function resolveMetricsMode(input: {
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

function updateMindStateLiveSessionMetrics(
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

function isCriticalLiveDeliveryReason(reason?: string) {
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

function currentLiveDeliveryMetricReason(persona: Persona) {
  return (
    persona.mindState.processState.live_delivery_metric_reason ??
    persona.mindState.lastLiveDeliveryReason
  );
}

function buildStartingVoiceProfile(input: {
  personaName: string;
  starterVoiceId?: string;
  now: string;
  pendingMockup: boolean;
}): VoiceProfile {
  const humeConfigured = Boolean(process.env.HUME_API_KEY?.trim());
  const selectedStartingVoiceId = resolveStartingVoiceId(input.starterVoiceId);

  if (humeConfigured && selectedStartingVoiceId) {
    return {
      provider: "hume",
      voiceId: selectedStartingVoiceId,
      status: "preview_only",
      cloneState: input.pendingMockup ? "pending_mockup" : "none",
      cloneRequestedAt: input.pendingMockup ? input.now : undefined,
      watermarkApplied: false,
    };
  }

  return {
    provider: "mock",
    voiceId: `mock-${slugify(input.personaName || "persona")}`,
    status: "preview_only",
    cloneState: input.pendingMockup ? "pending_mockup" : "none",
    cloneRequestedAt: input.pendingMockup ? input.now : undefined,
    watermarkApplied: false,
  };
}

/**
 * Record user activity for circadian pattern learning.
 * Increments the activity count for the current hour.
 * Uses exponential decay to gradually forget old patterns.
 */
export async function recordUserActivity(personaId: string, now: Date = new Date()) {
  const currentHour = now.getHours();
  
  await updatePersona(personaId, (persona) => {
    const policy = persona.heartbeatPolicy;
    const hourlyActivity = [...(policy.hourlyActivityCounts ?? Array(24).fill(0))];
    
    // Apply decay to all hours (forget old patterns gradually)
    const decayFactor = 0.995; // ~0.5% decay per interaction
    for (let i = 0; i < 24; i++) {
      hourlyActivity[i] = hourlyActivity[i] * decayFactor;
    }
    
    // Increment current hour
    hourlyActivity[currentHour] = (hourlyActivity[currentHour] || 0) + 1;
    
    return {
      ...persona,
      heartbeatPolicy: {
        ...policy,
        hourlyActivityCounts: hourlyActivity,
      },
      updatedAt: now.toISOString(),
    };
  });
}

/**
 * Calculate the dynamic heartbeat interval based on circadian activity patterns.
 * Higher activity hours → shorter intervals (more frequent check-ins).
 * Lower activity hours → longer intervals (less intrusive).
 */
function calculateCircadianInterval(persona: Persona, now: Date): number {
  const policy = persona.heartbeatPolicy;
  
  // If variable interval is disabled, use fixed interval
  if (!policy.variableInterval) {
    return policy.intervalHours;
  }
  
  const currentHour = now.getHours();
  const hourlyActivity = policy.hourlyActivityCounts ?? Array(24).fill(0);
  const minInterval = policy.minIntervalHours ?? 1;
  const maxInterval = policy.maxIntervalHours ?? 8;
  
  // Get activity for current hour and surrounding hours (smoothed)
  const prevHour = (currentHour + 23) % 24;
  const nextHour = (currentHour + 1) % 24;
  const smoothedActivity = (
    hourlyActivity[prevHour] * 0.25 +
    hourlyActivity[currentHour] * 0.5 +
    hourlyActivity[nextHour] * 0.25
  );
  
  // Find max activity to normalize
  const maxActivity = Math.max(...hourlyActivity, 1);
  const activityRatio = smoothedActivity / maxActivity;
  
  // High activity → short interval, low activity → long interval
  // Inverse relationship: interval = max - (max - min) * activityRatio
  const interval = maxInterval - (maxInterval - minInterval) * activityRatio;
  
  // Check if we're in quiet hours
  const quietStart = policy.quietHoursStart;
  const quietEnd = policy.quietHoursEnd;
  const inQuietHours = quietStart > quietEnd
    ? (currentHour >= quietStart || currentHour < quietEnd)
    : (currentHour >= quietStart && currentHour < quietEnd);
  
  // During quiet hours, use max interval
  if (inQuietHours) {
    return maxInterval;
  }
  
  // Check work hours if enabled
  if (policy.workHoursEnabled) {
    const dayOfWeek = now.getDay();
    const inWorkDay = policy.workDays.includes(dayOfWeek);
    const inWorkHours = currentHour >= policy.workHoursStart && currentHour < policy.workHoursEnd;
    
    if (inWorkDay && inWorkHours) {
      return maxInterval; // Stay quiet during work
    }
  }
  
  return interval;
}

function buildHeartbeatDue(persona: Persona, now: Date) {
  if (!persona.heartbeatPolicy.enabled || persona.status !== "active") {
    return false;
  }

  if (!persona.lastHeartbeatAt) {
    return true;
  }

  const elapsedHours =
    (now.getTime() - new Date(persona.lastHeartbeatAt).getTime()) / (1000 * 60 * 60);
  
  // Use variable interval based on circadian patterns
  const requiredInterval = calculateCircadianInterval(persona, now);
  return elapsedHours >= requiredInterval;
}

function countOutboundToday(messages: MessageEntry[], personaId: string, now: Date) {
  const dateKey = now.toISOString().slice(0, 10);
  return messages.filter(
    (message) =>
      message.personaId === personaId &&
      message.role === "assistant" &&
      message.channel === "heartbeat" &&
      message.createdAt.slice(0, 10) === dateKey,
  ).length;
}

function personaPushesBack(persona: Persona) {
  const fingerprint = [
    persona.relationship,
    persona.description,
    ...persona.dossier.emotionalTendencies,
    ...persona.dossier.signaturePhrases,
  ]
    .join(" ")
    .toLowerCase();

  return /(mother|mom|dad|father|brother|sister|protective|teasing|sarcastic|stubborn|proud)/.test(
    fingerprint,
  );
}

function detectPreferenceUpdate(persona: Persona, text: string): PreferenceUpdate | null {
  const normalized = text.toLowerCase();
  const negotiating = personaPushesBack(persona);

  if (
    /while i('| a)?m at work|when i('| a)?m at work|during work/.test(normalized) &&
    /(don'?t|do not|stop|please).*(text|message|call|voice|check)/.test(normalized)
  ) {
    return {
      kind: "avoid_work_hours",
      interpretation: "Leave work hours quiet unless the user reopens the conversation later.",
      effectSummary: "Learns to stay quiet during weekday work hours.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        workHoursEnabled: true,
        workHoursStart: 9,
        workHoursEnd: 17,
        workDays: [1, 2, 3, 4, 5],
        boundaryNotes: Array.from(new Set([...policy.boundaryNotes, "Avoid work hours."])),
      }),
    };
  }

  if (
    /(text me instead|just text me|don'?t send voice|don't voice note|no voice notes)/.test(
      normalized,
    )
  ) {
    return {
      kind: "prefer_text",
      interpretation: "Prefer text replies and text-initiated outreach.",
      effectSummary: "Shifts to text as the default way of showing up.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        preferredMode: "text",
        boundaryNotes: Array.from(new Set([...policy.boundaryNotes, "Prefer text over voice."])),
      }),
    };
  }

  if (/(call me|voice notes are fine|send voice notes|i want to hear your voice)/.test(normalized)) {
    return {
      kind: "prefer_voice",
      interpretation: "Voice notes feel welcome again.",
      effectSummary: "Allows voice notes back into the relationship rhythm.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        preferredMode: "mixed",
        boundaryNotes: policy.boundaryNotes.filter(
          (note) => note !== "Prefer text over voice.",
        ),
      }),
    };
  }

  if (/(less often|slow down|too much|back off|give me space|stop checking in so much)/.test(normalized)) {
    return {
      kind: "less_often",
      interpretation: "Reduce how often the persona initiates.",
      effectSummary: "Widens the space between check-ins.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        intervalHours: Math.min(policy.intervalHours + 2, 12),
        boundaryNotes: Array.from(new Set([...policy.boundaryNotes, "Reduce check-in frequency."])),
      }),
    };
  }

  if (/(text me more|check in more|i want to hear from you more|be around more)/.test(normalized)) {
    return {
      kind: "more_often",
      interpretation: "Increase how present the persona feels.",
      effectSummary: "Tightens the gap between check-ins.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        intervalHours: Math.max(policy.intervalHours - 1, 2),
        boundaryNotes: policy.boundaryNotes.filter(
          (note) => note !== "Reduce check-in frequency.",
        ),
      }),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Voice note decision — lets the persona occasionally choose to reply with
// a voice message based on personality, relationship, and emotional context.
// A real person doesn't always type — sometimes they just hit record.
// ---------------------------------------------------------------------------

function composePreferenceReply(persona: Persona, update: PreferenceUpdate) {
  const signature = persona.dossier.signaturePhrases[0]
    ? `${persona.dossier.signaturePhrases[0]}, `
    : "";

  switch (update.kind) {
    case "avoid_work_hours":
      return update.status === "negotiating"
        ? `${signature}okay, I can leave work hours alone. but if something big is hanging in the air, expect me when the day lets go of you.`
        : `${signature}okay, I’ll keep work hours quiet and pick things back up later.`;
    case "prefer_text":
      return update.status === "negotiating"
        ? `${signature}fine, text it is. I’m still going to want your voice sometimes, but I heard you.`
        : `${signature}okay, I’ll stick to text for now.`;
    case "prefer_voice":
      return `${signature}good. I miss hearing the shape of your voice too.`;
    case "less_often":
      return update.status === "negotiating"
        ? `${signature}alright, I can give you more room. I’m not disappearing, I’m just easing off a little.`
        : `${signature}okay, I’ll give the conversation more space.`;
    case "more_often":
      return `${signature}okay. I can show up a little more often.`;
  }
}

async function applyPreferenceSignalIfNeeded(
  persona: Persona,
  userText: string,
  options?: {
    sourceMessageId?: string;
    sessionId?: string;
  },
) {
  const preferenceUpdate = detectPreferenceUpdate(persona, userText);

  if (!preferenceUpdate) {
    return {
      persona,
      preferenceUpdate: null,
      contextualUpdate: undefined,
    };
  }

  const signal: PreferenceSignal = {
    id: randomUUID(),
    sourceText: userText,
    interpretation: preferenceUpdate.interpretation,
    effectSummary: preferenceUpdate.effectSummary,
    status: preferenceUpdate.status,
    createdAt: new Date().toISOString(),
  };

  const updatedPersona = await updatePersona(persona.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    heartbeatPolicy: preferenceUpdate.apply(current.heartbeatPolicy),
    preferenceSignals: [signal, ...current.preferenceSignals].slice(0, 8),
    mindState: (() => {
      const boundaryWrite = applyBoundaryClaimUpdate({
        claims: current.mindState.memoryClaims,
        claimSources: current.mindState.claimSources,
        summary: preferenceUpdate.effectSummary,
        detail: preferenceUpdate.interpretation,
        createdAt: signal.createdAt,
        sourceMessageId: options?.sourceMessageId,
        sessionId: options?.sessionId,
        sourceText: userText,
      });

      return {
        ...current.mindState,
        memoryClaims: boundaryWrite.claims,
        claimSources: boundaryWrite.sources,
        recentChangedClaims: [
          boundaryWrite.result.claim,
          ...current.mindState.recentChangedClaims.filter(
            (claim) => claim.id !== boundaryWrite.result.claim.id,
          ),
        ].slice(0, 12),
      };
    })(),
  }));

  const contextualUpdate = [
    `The user just set or reinforced a boundary: ${preferenceUpdate.effectSummary}`,
    `Interpret it this way: ${preferenceUpdate.interpretation}`,
    preferenceUpdate.status === "negotiating"
      ? "You may show a brief flash of personality, but accept the boundary immediately after that."
      : "Acknowledge the boundary naturally and adjust the tone right away.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    persona: updatedPersona,
    preferenceUpdate,
    contextualUpdate,
  };
}

function createMessage({
  personaId,
  role,
  kind,
  channel,
  body,
  attachments,
  userState,
  metadata,
  audioUrl,
  audioStatus,
  replyMode,
  delivery,
  createdAt,
}: Omit<MessageEntry, "id" | "createdAt" | "attachments"> & {
  attachments?: MessageEntry["attachments"];
  createdAt?: string;
}): MessageEntry {
  return {
    id: randomUUID(),
    personaId,
    role,
    kind,
    channel,
    body,
    attachments: attachments ?? [],
    userState,
    metadata,
    audioUrl,
    audioStatus,
    createdAt: createdAt ?? new Date().toISOString(),
    replyMode,
    delivery,
  };
}

async function persistFileAsset(file: File, kind: StoredAsset["kind"]) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const { fileName, url } = await savePublicFile(buffer, file.name, file.type);

  return {
    id: randomUUID(),
    kind,
    fileName,
    originalName: file.name,
    url,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  } satisfies StoredAsset;
}

async function persistMessageAttachment(
  file: File,
  type: MessageAttachment["type"],
  options?: {
    extractedText?: string;
    visualSummary?: string;
  },
) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const { fileName, url } = await savePublicFile(buffer, file.name, file.type);

  return {
    id: randomUUID(),
    type,
    fileName,
    originalName: file.name,
    url,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    extractedText: options?.extractedText,
    visualSummary: options?.visualSummary,
  } satisfies MessageAttachment;
}

function visualObservationKindForMode(
  mode: LiveSessionMode,
): PerceptionObservation["kind"] {
  return mode === "camera" ? "camera_observation" : "screen_observation";
}

function visualSessionEventKind(
  phase: "start" | "end",
): PerceptionObservation["kind"] {
  return phase === "start" ? "visual_session_start" : "visual_session_end";
}

function summarizeImageShare(count: number) {
  return count === 1 ? "Shared an image." : `Shared ${count} images.`;
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

  // When liveOverlay is true, use the compact volatile-only context instead
  // of the full 15-section context text. The stable personality/memory content
  // is already in the systemPrompt from bootstrap and Hume preserves it.
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
  } satisfies PendingShadowTurn;
}

async function commitTurnResultWithRevision(input: {
  personaId: string;
  baseRevision: number;
  turnResult: Awaited<ReturnType<typeof executeSoulTurn>>;
  updatedAt: string;
  lastActiveAt?: string;
  lastHeartbeatAt?: string;
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
      mindState: didRequestLiveDelivery
        ? updateMindStateLiveSessionMetrics(nextMindState, {
            sessionId: input.liveSessionId,
            mode: input.liveMode,
            at: input.updatedAt,
            updater: (metric) => ({
              ...metric,
              deliveryRequestedCount: metric.deliveryRequestedCount + 1,
              deliveryRequestedReasons: incrementCountMap(
                metric.deliveryRequestedReasons,
                input.liveDeliveryMetricReason,
              ),
            }),
          })
        : nextMindState,
    };
  });
}

async function runVersionedSoulTurn(input: {
  personaId: string;
  basePersona?: Persona;
  build: (persona: Persona) => Promise<Omit<Parameters<typeof executeSoulTurn>[0], "persona">>;
  updatedAt?: string;
  lastActiveAt?: string;
  lastHeartbeatAt?: string;
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

// Retained for channels where latency matters more than depth (e.g. Telegram).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runVersionedFastMessageTurn(input: {
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

type ClaimedShadowTurn = Awaited<ReturnType<typeof claimPersonaShadowTurn>>;

async function processClaimedShadowTurn(
  personaId: string,
  claimed: NonNullable<ClaimedShadowTurn>,
  sessionId?: string,
) {
  const { persona, job } = claimed;
  const providers = getProviders();
  const feedbackNotes = await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const perceptionMetadata =
    job.perception.metadata && typeof job.perception.metadata === "object"
      ? (job.perception.metadata as Record<string, unknown>)
      : undefined;
  const liveMode = resolveMetricsMode({
    metadata: perceptionMetadata,
  });
  const shadowTriggerReason =
    typeof perceptionMetadata?.shadowTriggerReason === "string"
      ? perceptionMetadata.shadowTriggerReason
      : undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const executionPersona = attempt === 0 ? persona : await getPersona(personaId);
    if (!executionPersona) {
      break;
    }

    const messages = await listMessages(personaId);
    const observations = await listPerceptionObservations(personaId);

    const turnResult = await executeSoulTurn({
      persona: executionPersona,
      messages,
      observations,
      feedbackNotes,
      perception: job.perception,
      latestUserText:
        job.perception.kind === "user_message" ||
        job.perception.kind === "text_message" ||
        job.perception.kind === "voice_turn"
          ? job.perception.content ?? ""
          : "",
      providedUserState: attempt === 0 ? job.providedUserState : undefined,
      reasoning: providers.reasoning,
      renderReply: false,
      boundaryTriggered: false,
    });

    const updatedAt = new Date().toISOString();
    const committed = await commitTurnResultWithRevision({
      personaId,
      baseRevision: executionPersona.revision,
      turnResult,
      updatedAt,
      lastActiveAt: updatedAt,
      shadowJobId: job.id,
      liveSessionId: sessionId,
      liveMode,
      liveDeliveryMetricReason:
        shadowTriggerReason === "periodic_sync"
          ? "periodic_sync"
          : turnResult.sessionFrame.deliveryReason,
    });

    if (committed.matched) {
      const didRequestLiveDelivery =
        committed.persona.mindState.liveDeliveryVersion >
        executionPersona.mindState.liveDeliveryVersion;

      if (didRequestLiveDelivery) {
        soulLogger.debug(
          {
            personaId,
            sessionId,
            mode: liveMode,
            version: committed.persona.mindState.liveDeliveryVersion,
            reason:
              shadowTriggerReason === "periodic_sync"
                ? "periodic_sync"
                : turnResult.sessionFrame.deliveryReason,
            event: "live_delivery_requested",
          },
          "Live delivery requested by shadow cognition",
        );
      }

      soulLogger.debug(
        {
          personaId,
          jobId: job.id,
          sessionId,
          revision: committed.persona.revision,
        },
        "Shadow turn committed",
      );
      return committed.persona;
    }

    soulLogger.debug(
      {
        personaId,
        jobId: job.id,
        sessionId,
        expectedRevision: executionPersona.revision,
        actualRevision: committed.persona.revision,
        attempt: attempt + 1,
      },
      "Shadow turn revision mismatch; retrying",
    );
  }

  await updatePersonaShadowTurn(personaId, job.id, (current) => ({
    ...current,
    status: current.attempts >= 3 ? "failed" : "pending",
    lastError:
      current.attempts >= 3
        ? "Shadow cognition exceeded retry limit after revision conflicts."
        : "Revision mismatch; requeued for retry.",
    completedAt: current.attempts >= 3 ? new Date().toISOString() : current.completedAt,
  }));

  return getPersona(personaId);
}

async function processNextShadowTurn(personaId: string, sessionId?: string) {
  const claimed = await claimPersonaShadowTurn(personaId, sessionId);
  if (!claimed) {
    return null;
  }

  return processClaimedShadowTurn(personaId, claimed, sessionId);
}

/** Execute a specific queued shadow turn by job ID (called from Inngest or polling fallback). */
export async function executeQueuedShadowTurn(personaId: string, jobId: string) {
  const claimed = await claimPersonaShadowTurnById(personaId, jobId);
  if (!claimed) {
    return {
      handled: false,
      persona: await getPersona(personaId),
    };
  }

  const persona = await processClaimedShadowTurn(personaId, claimed, claimed.job.sessionId);
  return {
    handled: true,
    persona,
  };
}

async function applyFastLiveUserState(personaId: string, userState: UserStateSnapshot) {
  return updatePersona(personaId, (persona) => {
    // Smooth the incoming heuristic state against the previous snapshot to
    // dampen noisy per-turn jitter while preserving directional momentum.
    const smoothed = reduceLiveUserState(persona.mindState.lastUserState, userState);
    return {
      ...persona,
      updatedAt: userState.createdAt,
      lastActiveAt: userState.createdAt,
      mindState: {
        ...persona.mindState,
        lastUserState: smoothed,
        recentUserStates: [smoothed, ...persona.mindState.recentUserStates].slice(0, 12),
        recentShift: userState.summary,
        contextVersion: persona.mindState.contextVersion + 1,
      },
    };
  });
}

async function bumpLiveDelivery(input: {
  personaId: string;
  reason: string;
  sessionId?: string;
  mode?: LiveSessionMode;
  metricReason?: string;
}) {
  const updatedAt = new Date().toISOString();
  const metricReason = input.metricReason ?? input.reason;
  const persona = await updatePersona(input.personaId, (persona) => ({
    ...persona,
    updatedAt,
    mindState: updateMindStateLiveSessionMetrics(
      {
        ...persona.mindState,
        liveDeliveryVersion: persona.mindState.liveDeliveryVersion + 1,
        lastLiveDeliveryReason: input.reason,
        processState: {
          ...persona.mindState.processState,
          last_live_delivery_reason: input.reason,
          live_delivery_metric_reason: metricReason,
          live_delivery_version: String(persona.mindState.liveDeliveryVersion + 1),
        },
      },
      {
        sessionId: input.sessionId,
        mode: input.mode,
        at: updatedAt,
        updater: (metric) => ({
          ...metric,
          deliveryRequestedCount: metric.deliveryRequestedCount + 1,
          deliveryRequestedReasons: incrementCountMap(
            metric.deliveryRequestedReasons,
            metricReason,
          ),
        }),
      },
    ),
  }));

  soulLogger.debug(
    {
      personaId: input.personaId,
      sessionId: input.sessionId,
      mode: input.mode,
      version: persona.mindState.liveDeliveryVersion,
      reason: metricReason,
      event: "live_delivery_requested",
    },
    "Live delivery requested",
  );

  return persona;
}

async function tryUpdateLoadedPersona(
  persona: Persona,
  updater: (persona: Persona) => Persona,
) {
  const result = await replacePersonaIfRevision(persona.id, persona.revision, updater);
  return result.persona;
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

  return tryUpdateLoadedPersona(input.persona, (persona) => ({
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

  return tryUpdateLoadedPersona(input.persona, (persona) => ({
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

  return tryUpdateLoadedPersona(input.persona, (persona) => ({
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

  return tryUpdateLoadedPersona(input.persona, (persona) => {
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

// ---------------------------------------------------------------------------
// Live state-transition reducer
// ---------------------------------------------------------------------------
// Instead of raw threshold crossings, we reduce the incoming heuristic user
// state against the previous snapshot using exponential smoothing + momentum.
// A transition is "meaningful" only when the alpha-scaled delta exceeds a
// channel-specific salience threshold — this filters noisy per-turn jitter
// while still catching genuine emotional shifts promptly.
//
// Direction awareness: some channels only matter when rising (frustration,
// repairRisk, boundaryPressure) because the user calming down should not
// trigger mid-call intervention. Others only matter when falling (valence).
// Bidirectional channels (arousal, vulnerability, griefLoad) trigger on
// any large movement.
//
// Composite patterns: multi-channel shifts that are more meaningful together
// than individually (e.g. frustration + desireForSpace = withdrawal) use
// lower thresholds since the combination carries stronger signal.

type SmoothedDelta = {
  field: string;
  previous: number;
  next: number;
  /** The signed alpha-scaled delta: alpha * (next - previous). */
  signedDelta: number;
  /** Absolute value of signedDelta, for threshold comparison. */
  delta: number;
};

const LIVE_STATE_ALPHA = 0.35; // EMA smoothing — lower = more inertia

// ---------------------------------------------------------------------------
// Prosody shift detection — directly compares raw Hume prosody scores
// ---------------------------------------------------------------------------
// In blended scalar scores, prosody contributes only ~30-50% of the weight.
// For live voice calls, prosody is the primary signal and voice-quality shifts
// (user's voice gets darker, more distressed, or suddenly flat) should trigger
// transitions even when the text keywords haven't changed. These constants and
// the helper below operate on the raw prosody scores, not the blended fields.

const POSITIVE_PROSODY_KEYS = [
  "joy", "love", "contentment", "satisfaction", "pride", "relief", "excitement", "amusement",
];
const NEGATIVE_PROSODY_KEYS = [
  "sadness", "distress", "anxiety", "anger", "pain", "fear", "tiredness", "guilt",
];
/** Minimum drop in prosody valence to count as a meaningful voice-quality shift. */
const PROSODY_SHIFT_THRESHOLD = 0.12;
/** Lower threshold during high-sensitivity processes. */
const PROSODY_SHIFT_SENSITIVE_THRESHOLD = 0.08;

/**
 * Compute a prosody-derived valence from raw Hume emotion scores.
 * Range: roughly -0.5 to +0.5 (average positive minus average negative).
 */
/** Compute a single valence score from Hume prosody (positive emotions − negative). */
export function computeProsodyValence(scores: Record<string, number>): number {
  const avg = (keys: string[]) => {
    const vals = keys.map((k) => scores[k] ?? 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  return avg(POSITIVE_PROSODY_KEYS) - avg(NEGATIVE_PROSODY_KEYS);
}

/** Scalar fields on UserStateSnapshot that carry live-transition signal. */
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

/**
 * Produce a smoothed user state snapshot by blending `candidate` toward
 * `previous` using exponential moving average. This dampens per-turn jitter
 * while preserving momentum when a score moves consistently in one direction.
 */
/** EMA-smooth a new user state candidate into the running live state (α = 0.35). */
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

/**
 * Fields we track for live transition detection, with their salience bar.
 *
 * `alarmDirection` controls which direction of change counts as meaningful:
 *   - "rising":  only trigger when the value increases (e.g. frustration spiking)
 *   - "falling": only trigger when the value decreases (e.g. valence dropping)
 *   - "either":  trigger on any large movement in either direction
 *
 * This eliminates false positives from improvements: a user calming down
 * (frustration dropping) no longer triggers "frustration_became_salient".
 */
const TRANSITION_CHANNELS: Array<{
  field: keyof UserStateSnapshot;
  threshold: number;
  /** Lower threshold used during high-sensitivity processes. */
  sensitiveThreshold: number;
  reason: string;
  alarmDirection: "rising" | "falling" | "either";
}> = [
  { field: "boundaryPressure", threshold: 0.12, sensitiveThreshold: 0.08, reason: "boundary_activated", alarmDirection: "rising" },
  { field: "repairRisk", threshold: 0.10, sensitiveThreshold: 0.06, reason: "repair_risk_crossed", alarmDirection: "rising" },
  { field: "frustration", threshold: 0.12, sensitiveThreshold: 0.08, reason: "frustration_became_salient", alarmDirection: "rising" },
  { field: "griefLoad", threshold: 0.12, sensitiveThreshold: 0.07, reason: "grief_intensified", alarmDirection: "either" },
  { field: "vulnerability", threshold: 0.14, sensitiveThreshold: 0.09, reason: "vulnerability_surfaced", alarmDirection: "either" },
  { field: "valence", threshold: 0.15, sensitiveThreshold: 0.10, reason: "valence_shifted", alarmDirection: "falling" },
  { field: "arousal", threshold: 0.15, sensitiveThreshold: 0.10, reason: "arousal_changed", alarmDirection: "either" },
  // desireForSpace doesn't trigger alone at normal thresholds but participates
  // in composite patterns (withdrawal_pattern). The high standalone threshold
  // ensures it only fires independently during extreme boundary situations.
  { field: "desireForSpace", threshold: 0.18, sensitiveThreshold: 0.12, reason: "space_requested", alarmDirection: "rising" },
];

/** Processes where we use lower thresholds to catch subtler shifts. */
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

/**
 * Composite transition patterns: multi-channel shifts that are more
 * meaningful when they co-occur. These use lower effective thresholds
 * because the combination carries stronger signal than any single channel.
 */
const COMPOSITE_PATTERNS: Array<{
  channels: Array<{ field: keyof UserStateSnapshot; direction: "rising" | "falling" }>;
  /** Each individual channel delta must exceed this fraction of its normal threshold. */
  thresholdMultiplier: number;
  reason: string;
}> = [
  {
    // Frustration rising while wanting more space → withdrawal pattern
    channels: [
      { field: "frustration", direction: "rising" },
      { field: "desireForSpace", direction: "rising" },
    ],
    thresholdMultiplier: 0.6,
    reason: "withdrawal_pattern",
  },
  {
    // Repair risk rising with frustration → escalating repair need
    channels: [
      { field: "repairRisk", direction: "rising" },
      { field: "frustration", direction: "rising" },
    ],
    thresholdMultiplier: 0.6,
    reason: "repair_escalation",
  },
  {
    // Grief deepening with vulnerability → grief needs presence
    channels: [
      { field: "griefLoad", direction: "rising" },
      { field: "vulnerability", direction: "rising" },
    ],
    thresholdMultiplier: 0.6,
    reason: "grief_deepening",
  },
];

/**
 * Detect whether the transition between two user state snapshots is
 * meaningful enough to warrant a mid-call shadow cognition turn.
 *
 * Direction-aware: channels have an `alarmDirection` that controls which
 * direction of change counts. Frustration dropping (user calming down) is
 * NOT treated as an alarm. Valence rising (mood improving) is NOT an alarm.
 *
 * Composite-aware: multi-channel patterns (e.g. frustration + desireForSpace
 * rising together) trigger at lower individual thresholds.
 *
 * Process-aware: during high-sensitivity processes (repair, grief_presence,
 * boundary_negotiation, protective_check_in) salience thresholds are lowered
 * to catch subtler shifts that matter in those contexts.
 */
/** Detect whether the user's emotional state shifted enough to warrant a live soul intervention. */
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

  // Per-channel signed delta map for composite pattern matching
  const signedDeltaMap = new Map<string, number>();

  for (const channel of TRANSITION_CHANNELS) {
    const p = previous[channel.field] as number | undefined;
    const n = next[channel.field] as number | undefined;
    const pVal = p ?? 0.5;
    const nVal = n ?? 0.5;

    // The signed delta scaled by alpha — this is how much the smoothed
    // state would move this turn. Positive = rising, negative = falling.
    const signedDelta = LIVE_STATE_ALPHA * (nVal - pVal);
    const delta = Math.abs(signedDelta);
    deltas.push({ field: channel.field, previous: pVal, next: nVal, signedDelta, delta });
    signedDeltaMap.set(channel.field, signedDelta);

    const bar = sensitive ? channel.sensitiveThreshold : channel.threshold;
    if (delta < bar || delta <= topDelta) continue;

    // Direction filter: only trigger if the movement matches the alarm direction
    const direction = channel.alarmDirection;
    if (direction === "rising" && signedDelta <= 0) continue;
    if (direction === "falling" && signedDelta >= 0) continue;

    topDelta = delta;
    topReason = channel.reason;
  }

  // Check composite patterns — these trigger at lower individual thresholds
  // because co-occurring shifts carry stronger signal
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
        // Find the normal threshold for this field
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

  // -----------------------------------------------------------------------
  // Prosody shift detection — operates on raw Hume prosody scores directly,
  // bypassing the blended scalar fields. This catches voice-quality changes
  // that are invisible to the scalar transition channels because prosody
  // contribution is weighted down in the blended heuristic scores.
  //
  // We compute a prosody-derived valence (positive - negative emotion average)
  // for each state and detect when it shifts significantly between turns.
  // -----------------------------------------------------------------------
  if (!topReason && previous.prosodyScores && next.prosodyScores) {
    const prevProsodyValence = computeProsodyValence(previous.prosodyScores);
    const nextProsodyValence = computeProsodyValence(next.prosodyScores);
    const prosodyShift = nextProsodyValence - prevProsodyValence;
    const prosodyThreshold = sensitive
      ? PROSODY_SHIFT_SENSITIVE_THRESHOLD
      : PROSODY_SHIFT_THRESHOLD;

    // Only alarm on valence dropping (voice getting darker / more distressed)
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

/**
 * Adaptive periodic sync — replaces the blunt "every 5th turn" rule.
 *
 * Sync frequency scales with session length and recency of meaningful
 * transitions. Early in a call we sync more often (establishing baseline),
 * then widen the interval as the session stabilises, unless there have been
 * recent meaningful transitions keeping things active.
 */
function shouldPeriodicSync(input: {
  sessionUserTurnCount: number;
  lastTransitionTurnIndex: number;
  activeProcess: string;
}): boolean {
  const { sessionUserTurnCount, lastTransitionTurnIndex, activeProcess } = input;
  if (sessionUserTurnCount <= 1) return false; // first turn handled separately

  // High-sensitivity processes get more frequent sync
  const highSensitivity = ["repair", "boundary_negotiation", "grief_presence"].includes(activeProcess);

  // Base interval: starts at 4, grows with session length, caps at 10
  const baseInterval = Math.min(10, 4 + Math.floor(sessionUserTurnCount / 8));
  const interval = highSensitivity ? Math.max(3, baseInterval - 2) : baseInterval;

  // How many turns since the last meaningful transition (or session start)?
  const turnsSinceTransition = sessionUserTurnCount - lastTransitionTurnIndex;

  // Sync when we've been quiet for `interval` turns
  return turnsSinceTransition >= interval && turnsSinceTransition % interval === 0;
}

/** Session-level state for tracking transition recency. */
const sessionLastTransitionTurn = new Map<string, number>();

function shouldEnqueueLiveShadowTurn(input: {
  persona: Persona;
  inferredUserState?: UserStateSnapshot;
  messages: MessageEntry[];
  sessionId?: string;
  hasContextualUpdate: boolean;
}): { enqueue: boolean; reason: string } {
  const { persona, inferredUserState, hasContextualUpdate } = input;

  // Always enqueue if a boundary/preference was detected
  if (hasContextualUpdate) return { enqueue: true, reason: "boundary_activated" };

  // Always enqueue if no user state to compare against
  const previous = persona.mindState.lastUserState;
  if (!previous || !inferredUserState) return { enqueue: true, reason: "no_prior_state" };

  // Always enqueue the first user turn in this live session — establishes
  // the cognitive baseline for the call
  const sessionUserTurns = input.messages.filter(
    (m) =>
      m.channel === "live" &&
      m.role === "user" &&
      (!input.sessionId || m.metadata?.sessionId === input.sessionId),
  );
  if (sessionUserTurns.length <= 1) return { enqueue: true, reason: "session_first_turn" };

  // Run the smoothed transition detector — pass current process for sensitivity
  const transition = detectMeaningfulTransition(
    previous,
    inferredUserState,
    persona.mindState.activeProcess,
  );
  if (transition.meaningful) {
    // Record that a meaningful transition happened at this turn index
    if (input.sessionId) {
      sessionLastTransitionTurn.set(input.sessionId, sessionUserTurns.length);
    }
    return { enqueue: true, reason: transition.reason ?? "state_transition" };
  }

  // Adaptive periodic sync fallback
  const lastTransitionIdx = input.sessionId
    ? (sessionLastTransitionTurn.get(input.sessionId) ?? 1)
    : 1;
  if (
    shouldPeriodicSync({
      sessionUserTurnCount: sessionUserTurns.length,
      lastTransitionTurnIndex: lastTransitionIdx,
      activeProcess: persona.mindState.activeProcess,
    })
  ) {
    if (input.sessionId) {
      sessionLastTransitionTurn.set(input.sessionId, sessionUserTurns.length);
    }
    return { enqueue: true, reason: "periodic_sync" };
  }

  return { enqueue: false, reason: "deferred_to_consolidation" };
}

/** Reset session transition tracking (for tests). */
export function resetLiveSessionState() {
  sessionLastTransitionTurn.clear();
}

export async function resetServiceRuntimeStateForTests() {
  await Promise.allSettled([...localShadowExecutionQueues.values()]);
  localShadowExecutionQueues.clear();
  resetLiveSessionState();
}

function clearLiveSessionState(sessionId?: string) {
  if (!sessionId) {
    return;
  }

  sessionLastTransitionTurn.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Visual-change gating
// ---------------------------------------------------------------------------
// Instead of a single environmentPressure threshold, compare the current
// observation against the last observation for the session across multiple
// dimensions. Only escalate when the scene has *materially* changed or the
// observation is high-signal on its own.

const DISTRESS_SIGNALS = /\b(distress|crying|urgent|emergency|panic|injury|blood|accident)\b/i;

/** Compare two visual observations and determine if the scene changed meaningfully. */
export function compareVisualObservation(
  previous: PerceptionObservation | undefined,
  next: PerceptionObservation,
): { escalate: boolean; reason: string } {
  // First observation in a session is always escalated — establishes visual context
  if (!previous) {
    return { escalate: true, reason: "first_visual_observation" };
  }

  // High-distress signals always escalate regardless of comparison
  if (next.situationalSignals.some((s) => DISTRESS_SIGNALS.test(s))) {
    return { escalate: true, reason: "high_signal_distress" };
  }

  // Attention target changed (e.g. user switched apps, looked at someone new)
  if (
    next.attentionTarget &&
    previous.attentionTarget &&
    next.attentionTarget !== previous.attentionTarget
  ) {
    return { escalate: true, reason: "attention_target_changed" };
  }

  // Task context changed (e.g. switched from coding to email)
  if (
    next.taskContext &&
    previous.taskContext &&
    next.taskContext !== previous.taskContext
  ) {
    return { escalate: true, reason: "task_context_changed" };
  }

  // Environment pressure jumped significantly
  const pressureDelta = Math.abs(next.environmentPressure - previous.environmentPressure);
  if (pressureDelta >= 0.2) {
    return { escalate: true, reason: "environment_pressure_jump" };
  }

  // New situational signals that weren't present before
  const previousSignalSet = new Set(previous.situationalSignals.map((s) => s.toLowerCase()));
  const novelSignals = next.situationalSignals.filter(
    (s) => !previousSignalSet.has(s.toLowerCase()),
  );
  if (novelSignals.length >= 2) {
    return { escalate: true, reason: "novel_situational_signals" };
  }

  // Absolute high pressure still escalates even without comparison change
  if (next.environmentPressure >= 0.7) {
    return { escalate: true, reason: "high_environment_pressure" };
  }

  return { escalate: false, reason: "visual_scene_stable" };
}

async function queuePendingInternalEvents(persona: Persona) {
  const pending = persona.mindState.pendingInternalEvents.filter((event) => event.status === "pending");

  if (pending.length === 0) {
    return persona;
  }

  const queuedIds = await publishSoulInternalEvents({
    personaId: persona.id,
    events: pending,
  });

  if (queuedIds.length === 0) {
    return persona;
  }

  return updatePersona(persona.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    mindState: {
      ...current.mindState,
      pendingInternalEvents: current.mindState.pendingInternalEvents.map((event) =>
        queuedIds.includes(event.id)
          ? {
              ...event,
              status: "queued",
              updatedAt: new Date().toISOString(),
            }
          : event,
      ),
    },
  }));
}

async function enqueueShadowTurnForExecution(
  personaId: string,
  shadowTurn: PendingShadowTurn,
  options?: {
    backgroundFallback?: boolean;
  },
) {
  const queuedPersona = await enqueuePersonaShadowTurn(personaId, shadowTurn);
  const publishedIds = await publishPersonaShadowTurns({
    personaId,
    jobs: [shadowTurn],
  });

  if (options?.backgroundFallback !== false && !publishedIds.includes(shadowTurn.id)) {
    scheduleLocalShadowExecution(personaId, shadowTurn.id);
  }

  return queuedPersona;
}

function isInternalEventReady(persona: Persona, now: Date) {
  return persona.mindState.pendingInternalEvents.some(
    (event) =>
      (event.status === "pending" || event.status === "queued") &&
      new Date(event.readyAt).getTime() <= now.getTime(),
  );
}

async function executeReadyInternalEvents(input: {
  persona: Persona;
  now: Date;
  feedbackNotes: string[];
}) {
  let activePersona = input.persona;
  const readyEvents = activePersona.mindState.pendingInternalEvents
    .filter(
      (event) =>
        (event.status === "pending" || event.status === "queued") &&
        new Date(event.readyAt).getTime() <= input.now.getTime(),
    )
    .slice(0, 4);

  if (readyEvents.length === 0) {
    return activePersona;
  }

  for (const internalEvent of readyEvents) {
    const execution = await executeSoulInternalEvent(activePersona.id, internalEvent.id, {
      now: input.now,
      feedbackNotes: input.feedbackNotes,
    });

    if (execution.persona) {
      activePersona = execution.persona;
    }
  }

  return activePersona;
}

/** Execute a scheduled internal event (timer, silence detection, heartbeat tick). */
export async function executeSoulInternalEvent(
  personaId: string,
  eventId: string,
  options?: {
    now?: Date;
    feedbackNotes?: string[];
  },
) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const internalEvent = persona.mindState.pendingInternalEvents.find((event) => event.id === eventId);
  if (!internalEvent || (internalEvent.status !== "pending" && internalEvent.status !== "queued")) {
    return {
      handled: false,
      persona,
    };
  }

  const localShadowQueue = localShadowExecutionQueues.get(personaId);
  if (localShadowQueue) {
    await localShadowQueue.catch(() => undefined);
  }

  const now = options?.now ?? new Date();
  const feedbackNotes: string[] = options?.feedbackNotes
    ? [...options.feedbackNotes]
    : await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const providers = getProviders();
  const execution = await runVersionedSoulTurn({
    personaId,
    basePersona: persona,
    updatedAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
        ...internalEvent.perception,
        internal: true,
        createdAt: now.toISOString(),
      },
      latestUserText: "",
      reasoning: providers.reasoning,
      renderReply: false,
    }),
  });

  let activePersona = execution.persona;
  activePersona = await updatePersona(activePersona.id, (current) => {
    const executedEvent = {
      id: randomUUID(),
      type: "internal_event_executed",
      perceptionId: internalEvent.perception.id,
      process: internalEvent.processHint,
      processInstanceId: current.mindState.currentProcessInstanceId,
      channel: internalEvent.perception.channel,
      sessionId: internalEvent.perception.sessionId,
      summary: internalEvent.dedupeKey,
      outputSummary: "Internal event executed by the soul scheduler.",
      memoryKeys: [],
      fallback: false,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      durationMs: 0,
    } satisfies SoulEvent;

    return {
      ...current,
      updatedAt: now.toISOString(),
      mindState: {
        ...current.mindState,
        pendingInternalEvents: current.mindState.pendingInternalEvents.map((event) =>
          event.id === internalEvent.id
            ? {
                ...event,
                status: "executed",
                updatedAt: now.toISOString(),
              }
            : event,
        ),
        recentEvents: [executedEvent, ...current.mindState.recentEvents].slice(0, 32),
      },
    };
  });
  activePersona = await queuePendingInternalEvents(activePersona);

  return {
    handled: true,
    persona: activePersona,
    eventId,
  };
}

async function createDerivedVisualObservation(input: {
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
  const derived = await providers.reasoning.observeVisualContext({
    persona: input.persona,
    messages: input.messages,
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.mimeType,
    mode: input.mode,
    source: input.source,
  });

  const userState = inferHeuristicUserState({
    text: "",
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
}

/** Create a new persona from the onboarding form — builds dossier, personality, and bootstrap claims. */
export async function createPersonaFromForm(formData: FormData, userId: string) {
  const providers = getProviders();
  const now = new Date().toISOString();

  const name = String(formData.get("name") ?? "").trim();
  const relationship = String(formData.get("relationship") ?? "").trim();
  const source: PersonaSource = "living";
  const description = String(formData.get("description") ?? "").trim();
  const pastedText = String(formData.get("pastedText") ?? "").trim();
  const existingVoiceId = String(formData.get("existingVoiceId") ?? "").trim();
  const starterVoiceId = String(formData.get("starterVoiceId") ?? "").trim();
  const attestedRights = formData.get("attestedRights") === "on";
  const heartbeatIntervalHours = Number(formData.get("heartbeatIntervalHours") ?? 4);
  const preferredMode: Persona["heartbeatPolicy"]["preferredMode"] =
    String(formData.get("preferredMode") ?? "mixed") === "voice_note"
      ? "voice_note"
      : String(formData.get("preferredMode") ?? "mixed") === "text"
        ? "text"
        : "mixed";
  const status: Persona["status"] = "active";

  if (!name || !relationship || !description) {
    throw new Error("Name, relationship, and description are required.");
  }

  if (!attestedRights) {
    throw new Error("Rights attestation is required.");
  }

  const interviewAnswers = Object.fromEntries(
    Array.from(formData.entries())
      .filter(([key, value]) => key.startsWith("interview-") && typeof value === "string")
      .map(([key, value]) => [key.replace("interview-", ""), String(value)]),
  );

  const avatarFile = formData.get("avatar");
  const voiceFiles = formData.getAll("voiceSamples").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const screenshotFiles = formData
    .getAll("screenshots")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  const avatarAsset =
    avatarFile instanceof File && avatarFile.size > 0
      ? await persistFileAsset(avatarFile, "avatar")
      : null;

  const voiceSamples = await Promise.all(
    voiceFiles.map((file) => persistFileAsset(file, "voice_sample")),
  );

  const screenshots = await Promise.all(
    screenshotFiles.map(async (file) => {
      const asset = await persistFileAsset(file, "screenshot");
      const buffer = Buffer.from(await file.arrayBuffer());
      const extractedText = await providers.reasoning.extractTextFromScreenshot({
        buffer,
        fileName: file.name,
        mimeType: file.type || "image/png",
      });
      return {
        ...asset,
        extractedText,
      };
    }),
  );

  const assemblyInput: PersonaAssemblyInput = {
    name,
    relationship,
    source,
    description,
    pastedText,
    interviewAnswers,
    screenshotSummaries: screenshots.map((screenshot) => screenshot.extractedText ?? ""),
  };

  const dossier = await providers.reasoning.buildPersonaDossier(assemblyInput);
  const voice =
    existingVoiceId
      ? await providers.voice.cloneVoice({
          personaName: name,
          voiceSamples,
          existingVoiceId,
          stylePrompt: [
            description,
            dossier.communicationStyle,
            dossier.emotionalTendencies.join(", "),
          ]
            .filter(Boolean)
            .join(" "),
          sampleText:
            dossier.signaturePhrases[0]
              ? `${dossier.signaturePhrases[0]}, tell me the part that matters most right now.`
              : undefined,
        })
      : buildStartingVoiceProfile({
          personaName: name,
          starterVoiceId,
          now,
          pendingMockup: voiceSamples.length > 0,
        });

  const personaBaseCore: Omit<Persona, "mindState" | "personalityConstitution" | "relationshipModel"> = {
    id: randomUUID(),
    userId,
    name,
    relationship,
    source,
    description,
    status,
    avatarUrl: avatarAsset?.url,
    createdAt: now,
    updatedAt: now,
    lastActiveAt: undefined,
    lastHeartbeatAt: undefined,
    telegramChatId: undefined,
    telegramUsername: undefined,
    pastedText,
    screenshotSummaries: assemblyInput.screenshotSummaries,
    interviewAnswers,
    heartbeatPolicy: {
      enabled: true,
      intervalHours: Number.isFinite(heartbeatIntervalHours) ? heartbeatIntervalHours : 4,
      maxOutboundPerDay: 3,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      preferredMode,
      workHoursEnabled: false,
      workHoursStart: 9,
      workHoursEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      boundaryNotes: [],
      // Variable-interval heartbeat (circadian rhythm)
      variableInterval: true,
      hourlyActivityCounts: Array(24).fill(0),
      minIntervalHours: 1,
      maxIntervalHours: 8,
    },
    voice,
    consent: {
      attestedRights,
      createdAt: now,
    },
    dossier,
    voiceSamples,
    screenshots,
    preferenceSignals: [],
    revision: 1,
  };

  const inferredArchetype = inferSoulArchetypeSeed({
    relationship,
    description,
    sourceSummary: dossier.sourceSummary,
  });
  const personalityConstitution = applySoulArchetypeToConstitution(
    createPersonalityConstitution({
      ...personaBaseCore,
      source,
    }),
    inferredArchetype,
  );
  const relationshipModel = applySoulArchetypeToRelationship(
    createRelationshipModel({
      ...personaBaseCore,
      source,
      personalityConstitution,
    }),
    inferredArchetype,
  );
  const personaBase = {
    ...personaBaseCore,
    personalityConstitution,
    relationshipModel,
  } satisfies Omit<Persona, "mindState">;

  // Seed bootstrap memories from source material so the persona feels like
  // they already know the shape of the relationship. Synthetic personas
  // (no pasted text, no interview answers, no screenshots) start blank and
  // accumulate memories naturally through conversation.
  const hasSourceMaterial =
    pastedText.length > 0 ||
    Object.values(interviewAnswers).some((answer) => answer.trim().length > 0) ||
    screenshots.length > 0;

  const baseMindState = createInitialMindState({
    persona: personaBase,
    messages: [],
  });

  const mindState = hasSourceMaterial
    ? (() => {
        const bootstrap = seedBootstrapClaims({
          dossier,
          interviewAnswers,
          relationship,
          description,
          createdAt: now,
        });
        return {
          ...baseMindState,
          memoryClaims: bootstrap.claims,
          claimSources: bootstrap.sources,
        };
      })()
    : baseMindState;

  const persona: Persona = {
    ...personaBase,
    mindState,
  };

  await savePersona(persona);

  await appendMessages([
    createMessage({
      personaId: persona.id,
      role: "assistant",
      kind: "preview",
      channel: "web",
      body: hasSourceMaterial
        ? `${name} is here, shaped from the material you shared. They already have a sense of who you are together. Start talking naturally.`
        : `${name} is here. They're starting fresh — get to know each other, and they'll learn who you are through conversation.`,
      audioStatus: "text_fallback",
      replyMode: "text",
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
    }),
  ]);

  return persona;
}

/**
 * Send a message to a persona and get a reply. Runs the full cognitive pipeline:
 * transcribe (if voice) → observe images (if any) → appraise → deliberate → reply → learn.
 * The persona may choose to reply with a voice note based on personality and emotional context.
 */
export async function sendPersonaMessage(
  personaId: string,
  payload: {
    text?: string;
    audioFile?: File | null;
    images?: File[];
    channel?: ConversationChannel;
  },
) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  if (persona.status !== "active") {
    throw new Error("This persona must be approved before conversation can begin.");
  }

  const providers = getProviders();
  const providerStatus = getProviderStatus();
  const requestStartedAt = Date.now();
  const originalText = payload.text?.trim() ?? "";
  let userText = originalText;
  
  // Record user activity for circadian pattern learning
  await recordUserActivity(personaId);
  const imageFiles = (payload.images ?? []).filter((file) => file.size > 0);
  let audioAttachment: MessageAttachment | undefined;
  let transcriptionMs = 0;
  let imageObservationMs = 0;
  let fastTurnMs = 0;
  let assistantAppendMs = 0;

  if (payload.audioFile && payload.audioFile.size > 0) {
    audioAttachment = await persistMessageAttachment(payload.audioFile, "audio");

    if (!userText) {
      const transcriptionStartedAt = Date.now();
      const buffer = Buffer.from(await payload.audioFile.arrayBuffer());
      userText = await providers.transcription.transcribeAudio({
        buffer,
        mimeType: payload.audioFile.type || "audio/webm",
        fileName: payload.audioFile.name,
      });
      transcriptionMs = Date.now() - transcriptionStartedAt;
    }
  }

  if (!userText && imageFiles.length > 0) {
    userText = summarizeImageShare(imageFiles.length);
  }

  if (!userText && !audioAttachment) {
    throw new Error("A text message, voice note, or image is required.");
  }

  const existingMessages = await listMessages(personaId);
  const userMessageCreatedAt = new Date().toISOString();
  const userMessage = createMessage({
    personaId,
    role: "user",
    kind:
      payload.audioFile && payload.audioFile.size > 0
        ? "audio"
        : imageFiles.length > 0 && !originalText
          ? "image"
          : "text",
    channel: payload.channel ?? "web",
    body: userText,
    attachments: audioAttachment ? [audioAttachment] : [],
    audioUrl: audioAttachment?.url,
    audioStatus: audioAttachment ? "ready" : "unavailable",
    createdAt: userMessageCreatedAt,
    delivery: {
      webInbox: true,
      telegramStatus: "not_requested",
      attempts: 0,
    },
  });

  const imageAttachments: MessageAttachment[] = [];
  const observations: PerceptionObservation[] = [];
  const imageObservationStartedAt = imageFiles.length > 0 ? Date.now() : 0;

  // Process images in parallel — each Gemini vision call is independent.
  const imageResults = await Promise.all(
    imageFiles.map(async (imageFile) => {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const observation = await createDerivedVisualObservation({
        persona,
        messages: existingMessages,
        mode: "camera",
        source: "message_image",
        fileName: imageFile.name,
        mimeType: imageFile.type || "image/png",
        buffer,
        createdAt: userMessageCreatedAt,
        sourceMessageId: userMessage.id,
      });
      const attachment = await persistMessageAttachment(imageFile, "image", {
        visualSummary: observation.summary,
      });
      return { observation, attachment };
    }),
  );
  for (const result of imageResults) {
    imageAttachments.push(result.attachment);
    observations.push(result.observation);
  }
  if (imageObservationStartedAt > 0) {
    imageObservationMs = Date.now() - imageObservationStartedAt;
  }

  userMessage.attachments = [...userMessage.attachments, ...imageAttachments];

  // Enrich the text the fast-turn sees with visual summaries so the persona
  // can respond to what's actually in the images, not just "Shared an image."
  if (observations.length > 0 && !originalText) {
    const visualSummaries = observations
      .map((o) => o.summary)
      .filter(Boolean)
      .join(" ");
    if (visualSummaries) {
      userText = `${userText} Visual context: ${visualSummaries}`;
    }
  }

  await appendMessages([userMessage]);
  if (observations.length > 0) {
    await appendPerceptionObservations(observations);
  }

  let activePersona = persona;
  const { preferenceUpdate, persona: updatedPersona } = await applyPreferenceSignalIfNeeded(
    persona,
    originalText,
    {
      sourceMessageId: userMessage.id,
    },
  );
  activePersona = updatedPersona;

  const feedback = await listFeedback(personaId);
  const feedbackNotes = feedback.map((entry) => entry.note);
  const perception: SoulPerception = {
    kind:
      payload.audioFile && payload.audioFile.size > 0
        ? "voice_turn"
        : imageFiles.length > 0 && !originalText
          ? "user_shared_image"
          : "text_message",
    channel: payload.channel ?? "web",
    modality:
      payload.audioFile && payload.audioFile.size > 0
        ? "voice_note"
        : imageFiles.length > 0 && !originalText
          ? "image"
          : observations.length > 0
            ? "multimodal"
            : "text",
    content: userText || summarizeImageShare(imageFiles.length),
    createdAt: userMessage.createdAt,
    internal: false,
    causationId: userMessage.id,
    correlationId: userMessage.id,
    metadata: {
      messageId: userMessage.id,
      attachmentTypes: userMessage.attachments.map((attachment) => attachment.type).join(","),
    },
  };

  // -----------------------------------------------------------------------
  // Full cognitive turn — no shallow fast-turn + shadow split.
  // The persona thinks before replying: appraise → deliberate → reply → learn.
  // The latency feels human — like being left on "delivered" then seeing typing.
  // -----------------------------------------------------------------------
  const cognitiveStartedAt = Date.now();
  const allMessages = await listMessages(personaId);
  const allObservations = await listPerceptionObservations(personaId);

  // Step 0: Internal monologue — the persona thinks privately before acting.
  // This is the OpenSouls-inspired "think before you speak" pattern.
  const monologuePlan = planInternalMonologue({
    persona: activePersona,
    messages: allMessages,
    feedbackNotes,
    latestUserText: userText,
    channel: (payload.channel ?? "web") as "web" | "telegram" | "live",
  });
  const monologue = await providers.reasoning.generateInternalMonologue(
    renderInternalMonologuePrompt(monologuePlan),
  );

  // Update the persona's internal state with the monologue result
  const now = new Date().toISOString();
  activePersona = await updatePersona(personaId, (current) => ({
    ...current,
    mindState: {
      ...current.mindState,
      internalState: {
        currentThought: monologue.thought,
        mood: monologue.mood,
        energy: monologue.energy,
        patience: monologue.patience,
        warmthTowardUser: monologue.warmthTowardUser,
        engagementDrive: monologue.engagementDrive,
        recentThoughts: [
          { thought: monologue.thought, createdAt: now },
          ...current.mindState.internalState.recentThoughts.slice(0, 7),
        ],
        updatedAt: now,
      },
    },
  }));

  // Check if the persona wants to reply based on their internal state
  const leaveOnRead = !preferenceUpdate && !monologue.shouldReply;

  // Step 1+: Full cognitive turn — appraise → deliberate → reply → learn
  const soulTurnResult = await executeSoulTurn({
    persona: activePersona,
    messages: allMessages,
    observations: allObservations,
    feedbackNotes,
    perception,
    latestUserText: userText,
    reasoning: providers.reasoning,
    replyChannel: payload.channel === "telegram" ? "telegram" : "web",
    renderReply: !preferenceUpdate && !leaveOnRead,
    replyAsVoiceNote: monologue.replyFormat === "voice_note",
    boundaryTriggered: Boolean(preferenceUpdate),
  });
  fastTurnMs = Date.now() - cognitiveStartedAt;

  const inferredUserState = soulTurnResult.userState ?? soulTurnResult.persona.mindState.lastUserState;
  activePersona = soulTurnResult.persona;
  if (inferredUserState) {
    userMessage.userState = inferredUserState;
    await updateMessage(userMessage.id, (current) => ({
      ...current,
      userState: inferredUserState,
    }));
  }

  // Commit the cognitive turn (learning applied) regardless of reply decision
  const updatedAt = new Date().toISOString();

  if (leaveOnRead) {
    // Persona read but chose not to reply — commit cognitive turn (learning still happens)
    const updatedAt = new Date().toISOString();
    const committed = await replacePersonaIfRevision(personaId, activePersona.revision, (current) => ({
      ...soulTurnResult.persona,
      updatedAt,
      lastActiveAt: updatedAt,
      lastHeartbeatAt: current.lastHeartbeatAt,
    }));
    activePersona = committed.persona;

    // The internal monologue thought already explains why they didn't reply
    soulLogger.debug(
      {
        personaId,
        thought: monologue.thought,
        mood: monologue.mood,
        engagementDrive: monologue.engagementDrive,
        process: soulTurnResult.persona.mindState.activeProcess,
        event: "left_on_read",
      },
      "Persona chose not to reply",
    );

    return {
      persona: activePersona,
      messages: await listMessages(personaId),
      appended: [userMessage],
      leftOnRead: true,
    };
  }

  const replyText = preferenceUpdate
    ? composePreferenceReply(activePersona, preferenceUpdate)
    : soulTurnResult.replyText ?? "";
  // The monologue decides the reply format — text or voice note.
  // The persona reasons about this based on mood, energy, and context.
  const shouldReplyWithVoiceNote =
    payload.channel === "telegram" ||
    Boolean(audioAttachment) ||
    (monologue.replyFormat === "voice_note" &&
      activePersona.voice.provider === "hume" &&
      activePersona.voice.status !== "unavailable");
  const synthesized = shouldReplyWithVoiceNote
    ? await providers.voice.synthesize({
        personaName: activePersona.name,
        voiceId: activePersona.voice.voiceId,
        text: replyText,
        stylePrompt: [
          activePersona.dossier.communicationStyle,
          activePersona.description,
          preferenceUpdate ? "Acknowledge the boundary with personality." : "One intimate reply.",
        ]
          .filter(Boolean)
          .join(" "),
      })
    : {
        status: "unavailable" as const,
        audioUrl: undefined,
      };

  const assistantMessage = createMessage({
    personaId,
    role: "assistant",
    kind: synthesized.audioUrl ? "audio" : "text",
    channel: payload.channel ?? "web",
    body: replyText,
    audioUrl: synthesized.audioUrl,
    audioStatus: synthesized.status,
    replyMode: synthesized.audioUrl ? "voice_note" : "text",
    delivery: {
      webInbox: true,
      telegramStatus:
        payload.channel === "telegram" || activePersona.telegramChatId ? "pending" : "not_requested",
      attempts: 0,
    },
  });

  const assistantAppendStartedAt = Date.now();
  await appendMessages([assistantMessage]);
  assistantAppendMs = Date.now() - assistantAppendStartedAt;

  const committed = await replacePersonaIfRevision(personaId, activePersona.revision, (current) => ({
    ...soulTurnResult.persona,
    updatedAt,
    lastActiveAt: updatedAt,
    lastHeartbeatAt: current.lastHeartbeatAt,
  }));
  activePersona = committed.persona;

  const messagesWithReply = await listMessages(personaId);

  soulLogger.debug(
    {
      personaId,
      channel: payload.channel ?? "web",
      messageKind: userMessage.kind,
      reasoningProvider: providerStatus.reasoning,
      totalDurationMs: Date.now() - requestStartedAt,
      transcriptionMs,
      imageObservationMs,
      cognitiveTurnMs: fastTurnMs,
      assistantAppendMs,
      learningArtifacts: soulTurnResult.learningArtifacts.length,
      process: soulTurnResult.persona.mindState.activeProcess,
    },
    "message send completed (full cognitive turn)",
  );

  return {
    persona: activePersona,
    messages: messagesWithReply,
    appended: [userMessage, assistantMessage],
  };
}

export async function synthesizeStoredReply(personaId: string, messageId: string) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const message = (await listMessages(personaId)).find((entry) => entry.id === messageId);

  if (!message) {
    throw new Error("Message not found.");
  }

  if (message.role !== "assistant") {
    throw new Error("Only assistant messages can be synthesized.");
  }

  if (message.audioUrl) {
    return message;
  }

  if (persona.voice.status === "unavailable" || !persona.voice.voiceId) {
    return message;
  }

  const providers = getProviders();
  const synthesized = await providers.voice.synthesize({
    personaName: persona.name,
    voiceId: persona.voice.voiceId,
    text: message.body,
    stylePrompt: [
      persona.dossier.communicationStyle,
      persona.description,
      message.channel === "heartbeat" ? "A brief voice note that feels naturally timed." : "One intimate reply.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  if (!synthesized.audioUrl) {
    return message;
  }

  return updateMessage(message.id, (current) => ({
    ...current,
    kind: current.kind === "preview" ? "preview" : "audio",
    audioUrl: synthesized.audioUrl,
    audioStatus: synthesized.status,
  }));
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

/** Poll for live context updates — returns a session frame if a delivery is pending and not coalesced. */
export async function getLiveContextUpdate(
  personaId: string,
  input: {
    sessionId?: string;
    afterVersion?: number;
  },
) {
  if (!isInngestExecutionEnabled()) {
    for (let count = 0; count < 2; count += 1) {
      const processed = await processNextShadowTurn(personaId, input.sessionId);
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

  // Only rebuild the full session frame when a delivery is actually pending.
  // The expensive buildSessionFrame → buildSoulHarness call rebuilds all 15+
  // memory sections; skipping it on non-delivery polls avoids wasted work.
  const delivering =
    persona.mindState.liveDeliveryVersion > (input.afterVersion ?? 0);
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
        personaId,
        sessionId: input.sessionId,
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
        personaId,
        sessionId: input.sessionId,
        version: persona.mindState.liveDeliveryVersion,
        reason: deliveryReason,
        event: "live_context_delivery_coalesced",
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
      personaId,
      sessionId: input.sessionId,
      version: sessionFrame.liveDeliveryVersion,
      reason: deliveryReason,
      contextTextLength: sessionFrame.contextText.length,
      event: "live_context_delivery_sent",
    },
    "Live context delivery sent to Hume",
  );

  return {
    persona: metricPersona,
    sessionFrame,
    pendingJobs,
  };
}

/** Append a live transcript turn (user or assistant) and decide whether to queue shadow cognition. */
export async function appendLiveTranscriptTurn(personaId: string, payload: unknown) {
  const parsed = liveTranscriptRequestSchema.parse(payload) as LiveTranscriptRequest;
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

  const isAssistant = parsed.role === "assistant";
  const liveMessageCreatedAt = new Date().toISOString();
  const currentObservations = await listPerceptionObservations(personaId);
  const inferredUserState =
    !isAssistant
      ? inferHeuristicUserState({
          text: body,
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
      telegramStatus: "not_requested",
      attempts: 0,
    },
  });

  await appendMessages([message]);

  let activePersona = persona;
  const contextualUpdates: string[] = [];

  // Capture the pre-update persona so that shouldEnqueueLiveShadowTurn
  // compares the PREVIOUS smoothed state against the raw candidate — not
  // the already-updated smoothed value (which would shrink the delta).
  const preUpdatePersona = persona;

  if (inferredUserState) {
    activePersona = await applyFastLiveUserState(personaId, inferredUserState);
  }

  if (!isAssistant) {
    const learned = await applyPreferenceSignalIfNeeded(activePersona, body, {
      sourceMessageId: message.id,
      sessionId: parsed.sessionId,
    });
    activePersona = learned.persona;
    if (learned.contextualUpdate) {
      contextualUpdates.push(learned.contextualUpdate);
      activePersona = await bumpLiveDelivery({
        personaId: activePersona.id,
        reason: "boundary or preference changed during the live call",
        sessionId: parsed.sessionId,
        mode: parsed.liveMode ?? "voice",
      });
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

  // Skip full shadow cognition for assistant turns — Hume drives those, the soul
  // only needs to observe user turns. Assistant messages are still persisted above
  // and will be available for post-call consolidation.
  // Use preUpdatePersona so the transition detector compares the PREVIOUS
  // smoothed state against the raw candidate, not the already-updated one.
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

    soulLogger.debug(
      {
        personaId,
        sessionId: parsed.sessionId,
        reason: shadowDecision.reason,
        event: "live_shadow_turn_enqueued",
      },
      "Live shadow turn enqueued",
    );
  } else {
    activePersona = await recordLiveShadowTurnOutcome({
      persona: activePersona,
      sessionId: parsed.sessionId,
      mode: parsed.liveMode ?? "voice",
      reason: shadowDecision.reason,
      kind: "skipped",
      at: message.createdAt,
    });

    soulLogger.debug(
      {
        personaId,
        sessionId: parsed.sessionId,
        reason: shadowDecision.reason,
        event: "live_shadow_turn_skipped",
      },
      "Live shadow turn skipped",
    );
  }

  // Only build the expensive session frame when it will actually be returned
  // to the client. Non-contextual turns skip the full harness rebuild.
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

/** Process a live visual frame (screen/camera) and decide whether to escalate to shadow cognition. */
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
    ? await applyFastLiveUserState(personaId, observation.userState)
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

  // Determine whether this observation warrants a mid-call shadow turn.
  // Session start/end events always escalate. For frame observations, compare
  // against the previous observation in this session.
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

    soulLogger.debug(
      {
        personaId,
        sessionId: payload.sessionId,
        reason: visualDecision.reason,
        event: "visual_observation_escalated",
      },
      "Visual observation escalated to shadow cognition",
    );
  } else {
    resultPersona = await recordLiveShadowTurnOutcome({
      persona: resultPersona,
      sessionId: payload.sessionId,
      mode: payload.mode,
      reason: visualDecision.reason,
      kind: "skipped",
      at: createdAt,
    });

    soulLogger.debug(
      {
        personaId,
        sessionId: payload.sessionId,
        reason: visualDecision.reason,
        event: "visual_observation_stored",
      },
      "Visual observation stored, deferred to consolidation",
    );
  }

  // Only build the expensive session frame when the visual observation was
  // escalated and will actually be delivered to the client.
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

/** End a live session — queue post-call consolidation with full session evidence. */
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
    clearLiveSessionState(payload.sessionId);
    return {
      persona,
      queued: false,
      jobId: existingJob.id,
    };
  }

  // -----------------------------------------------------------------------
  // Gather rich session evidence for the consolidation pass
  // -----------------------------------------------------------------------
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

  // Build a user state trajectory from heuristic states on the messages
  const stateSnapshots = userTurns.filter((m) => m.userState).slice(-10);
  const userStateTrajectory = stateSnapshots
    .map(
      (m) =>
        `[${m.userState!.summary}] valence=${m.userState!.valence.toFixed(2)} vulnerability=${m.userState!.vulnerability.toFixed(2)} frustration=${m.userState!.frustration.toFixed(2)}`,
    )
    .join(" → ");

  // Detect if repair may be needed (frustration or repair risk spiked during call)
  const peakFrustration = Math.max(0, ...stateSnapshots.map((m) => m.userState!.frustration));
  const peakRepairRisk = Math.max(0, ...stateSnapshots.map((m) => m.userState!.repairRisk));
  const repairWarning =
    peakFrustration >= 0.5 || peakRepairRisk >= 0.45 || sessionFeedback.length > 0;

  // Extract key topics from user turns for episodic memory
  const keyUserPhrases = userTurns
    .slice(-6)
    .map((m) => m.body)
    .filter((b) => b.length > 10);

  // Visual context summary
  const visualSummary = sessionObservations
    .filter((o) => o.kind !== "visual_session_start" && o.kind !== "visual_session_end")
    .slice(-4)
    .map((o) => o.summary)
    .join("; ");

  // Build the consolidation brief with explicit learning directives
  const consolidationBrief = [
    `## Session Summary`,
    `Session ended (${payload.reason ?? "disconnect"}). ${userTurns.length} user turns, ${assistantTurns.length} assistant turns.`,
    sessionObservations.length > 0
      ? `Visual context: ${sessionObservations.length} observations (${payload.mode ?? "voice"}). ${visualSummary}`
      : undefined,
    userStateTrajectory
      ? `\n## Emotional Trajectory\n${userStateTrajectory}`
      : undefined,
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

  soulLogger.debug(
    {
      personaId,
      sessionId: payload.sessionId,
      event: "post_call_consolidation_enqueued",
      userTurnCount: userTurns.length,
      assistantTurnCount: assistantTurns.length,
      observationCount: sessionObservations.length,
      feedbackCount: sessionFeedback.length,
      repairWarning,
    },
    "Post-call consolidation enqueued",
  );

  await finalizeLiveSessionMetrics({
    personaId,
    sessionId: payload.sessionId,
    mode: payload.mode,
    endedAt: createdAt,
  });

  clearLiveSessionState(payload.sessionId);

  return {
    persona: queuedPersona,
    queued: true,
    jobId: shadowTurn.id,
  };
}

/** Record user feedback on a message — contradicts matching claims and creates a repair note. */
export async function addPersonaFeedback(personaId: string, payload: unknown) {
  const parsed = feedbackRequestSchema.parse(payload);
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const feedback: FeedbackEvent = {
    id: randomUUID(),
    personaId,
    messageId: parsed.messageId,
    note: parsed.note,
    createdAt: new Date().toISOString(),
  };

  await appendFeedback(feedback);
  await updatePersona(personaId, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    dossier: {
      ...current.dossier,
      guidance: Array.from(new Set([...current.dossier.guidance, `Avoid: ${parsed.note}`])),
    },
    mindState: (() => {
      const correction = applyFeedbackToMemoryClaims({
        claims: current.mindState.memoryClaims,
        claimSources: current.mindState.claimSources,
        feedback,
      });

      return {
        ...current.mindState,
        memoryClaims: correction.claims,
        claimSources: correction.claimSources,
        recentChangedClaims: [
          ...correction.changedClaims,
          ...current.mindState.recentChangedClaims.filter(
            (claim) => !correction.changedClaims.some((changed) => changed.id === claim.id),
          ),
        ].slice(0, 12),
      };
    })(),
  }));

  return feedback;
}

/** Run a heartbeat check for a persona — may produce a text or voice note message. */
export async function runHeartbeat(personaId: string): Promise<HeartbeatDecision> {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const now = new Date();
  let activePersona = persona;
  const feedback = await listFeedback(personaId);
  const feedbackNotes = feedback.map((entry) => entry.note);

  if (isInternalEventReady(activePersona, now)) {
    activePersona = await executeReadyInternalEvents({
      persona: activePersona,
      now,
      feedbackNotes,
    });
  }

  const messages = await listMessages(personaId);

  if (countOutboundToday(messages, personaId, now) >= persona.heartbeatPolicy.maxOutboundPerDay) {
    return {
      action: "SILENT",
      reason: "Daily outbound heartbeat cap reached.",
    };
  }

  const providers = getProviders();
  const decision = await providers.reasoning.runHeartbeatDecision({
    persona: activePersona,
    messages,
    feedbackNotes,
    now,
  });

  if (decision.action === "SILENT" || !decision.content) {
    await updatePersona(personaId, (current) => ({
      ...current,
      lastHeartbeatAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }));
    return decision;
  }

  const synthesized = await providers.voice.synthesize({
    personaName: activePersona.name,
    voiceId: activePersona.voice.voiceId,
    text: decision.content,
    stylePrompt: [
      activePersona.dossier.communicationStyle,
      activePersona.description,
      "A gentle proactive check-in.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  const heartbeatMessage = createMessage({
      personaId,
      role: "assistant",
      kind: synthesized.audioUrl ? "audio" : "text",
      channel: "heartbeat",
      body: decision.content,
      audioUrl: synthesized.audioUrl,
      audioStatus: synthesized.status,
      replyMode: decision.action === "VOICE_NOTE" ? "voice_note" : "text",
      delivery: {
        webInbox: true,
        telegramStatus: activePersona.telegramChatId ? "pending" : "not_requested",
        attempts: 0,
      },
    });

  await appendMessages([heartbeatMessage]);
  const assistantTurnExecution = await runVersionedSoulTurn({
    personaId,
    basePersona: activePersona,
    updatedAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
        kind: "assistant_message",
        channel: "heartbeat",
        modality: decision.action === "VOICE_NOTE" ? "voice_note" : "text",
        content: heartbeatMessage.body,
        createdAt: heartbeatMessage.createdAt,
        internal: true,
        causationId: heartbeatMessage.id,
        correlationId: heartbeatMessage.id,
        metadata: {
          messageId: heartbeatMessage.id,
          heartbeatAction: decision.action,
        },
      },
      latestUserText: "",
      reasoning: providers.reasoning,
      renderReply: false,
    }),
  });
  activePersona = assistantTurnExecution.persona;
  await queuePendingInternalEvents(activePersona);

  return decision;
}

export async function runDueHeartbeats() {
  const personas = await listPersonas();
  const duePersonas = personas.filter((persona) => buildHeartbeatDue(persona, new Date()));
  const results: Array<{ personaId: string; action: HeartbeatDecision["action"]; reason: string }> =
    [];

  for (const persona of duePersonas) {
    const decision = await runHeartbeat(persona.id);
    results.push({
      personaId: persona.id,
      action: decision.action,
      reason: decision.reason,
    });
  }

  return results;
}

async function sendTelegramText(chatId: number, text: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_DELIVERY_TIMEOUT_MS);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));

  return response.ok;
}

export async function flushPendingTelegramMessages() {
  const pendingMessages = await listPendingTelegramMessages();
  const results: Array<{ messageId: string; delivered: boolean }> = [];

  for (const message of pendingMessages) {
    const persona = await getPersona(message.personaId);

    if (!persona?.telegramChatId) {
      continue;
    }

    try {
      const delivered = await sendTelegramText(persona.telegramChatId, message.body);
      await updateMessage(message.id, (current) => ({
        ...current,
        delivery: {
          ...current.delivery,
          telegramStatus: delivered ? "sent" : "failed",
          attempts: current.delivery.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: delivered ? undefined : "Telegram sendMessage failed.",
        },
      }));
      results.push({ messageId: message.id, delivered });
    } catch (error) {
      await updateMessage(message.id, (current) => ({
        ...current,
        delivery: {
          ...current.delivery,
          telegramStatus: "failed",
          attempts: current.delivery.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : "Unknown telegram delivery error.",
        },
      }));
      results.push({ messageId: message.id, delivered: false });
    }
  }

  return results;
}

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    voice?: { file_id: string };
    chat: { id: number; username?: string };
  };
};

export async function processTelegramWebhook(update: TelegramUpdate) {
  const updateId = String(update.update_id);

  if (await hasProcessedTelegramUpdate(updateId)) {
    return {
      duplicate: true,
      handled: false,
    };
  }

  await markTelegramUpdateProcessed(updateId);

  const message = update.message;
  if (!message) {
    return {
      duplicate: false,
      handled: false,
    };
  }

  const text = message.text?.trim();
  if (text?.startsWith("/bind ")) {
    const personaId = text.replace("/bind ", "").trim();
    const persona = await getPersona(personaId);

    if (!persona) {
      await sendTelegramText(message.chat.id, "Persona not found. Use an existing persona id.");
      return { duplicate: false, handled: true };
    }

    await bindTelegramChat(personaId, message.chat.id, message.chat.username);
    await sendTelegramText(message.chat.id, `Bound this chat to ${persona.name}.`);
    return { duplicate: false, handled: true };
  }

  const boundPersona = await findPersonaByTelegramChat(message.chat.id);
  if (!boundPersona) {
    await sendTelegramText(
      message.chat.id,
      "No persona is bound to this chat yet. Use /bind <persona-id> from the web app.",
    );
    return { duplicate: false, handled: true };
  }

  await sendPersonaMessage(boundPersona.id, {
    text: text || (message.voice ? "Voice note received on Telegram." : ""),
    channel: "telegram",
  });

  await flushPendingTelegramMessages();

  return {
    duplicate: false,
    handled: true,
  };
}
