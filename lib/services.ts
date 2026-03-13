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
import { getProviders } from "@/lib/providers";
import { executeSoulTurn } from "@/lib/soul-engine";
import {
  isInngestExecutionEnabled,
  publishPersonaShadowTurns,
  publishSoulInternalEvents,
} from "@/lib/inngest";
import { buildSoulHarness } from "@/lib/soul-harness";
import {
  applySoulArchetypeToConstitution,
  applySoulArchetypeToRelationship,
  inferSoulArchetypeSeed,
} from "@/lib/personality-archetypes";
import { soulLogger } from "@/lib/soul-logger";
import { getHouseVoicePreset, houseVoicePresets } from "@/lib/voice-presets";
import {
  approvalRequestSchema,
  type ConversationChannel,
  type FeedbackEvent,
  type LiveSessionMode,
  feedbackRequestSchema,
  type HeartbeatPolicy,
  type HeartbeatDecision,
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

function resolveStartingVoiceId(starterVoiceId?: string) {
  return (
    getHouseVoicePreset(starterVoiceId)?.id ??
    houseVoicePresets[0]?.id ??
    undefined
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

function buildHeartbeatDue(persona: Persona, now: Date) {
  if (!persona.heartbeatPolicy.enabled || persona.status !== "active") {
    return false;
  }

  if (!persona.lastHeartbeatAt) {
    return true;
  }

  const elapsedHours =
    (now.getTime() - new Date(persona.lastHeartbeatAt).getTime()) / (1000 * 60 * 60);
  return elapsedHours >= persona.heartbeatPolicy.intervalHours;
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

async function applyPreferenceSignalIfNeeded(persona: Persona, userText: string) {
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

function currentTraceVersion(persona: Persona) {
  return persona.mindState.traceVersion;
}

function buildSessionFrame(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  perception: SoulPerception;
  contextDelta?: string;
}) {
  const snapshot = buildSoulHarness({
    persona: input.persona,
    messages: input.messages,
    feedbackNotes: input.feedbackNotes,
    perception: input.perception,
  });

  return {
    ...snapshot.sessionFrame,
    contextVersion: currentContextVersion(input.persona),
    traceVersion: currentTraceVersion(input.persona),
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
}) {
  return replacePersonaIfRevision(input.personaId, input.baseRevision, (current) => ({
    ...input.turnResult.persona,
    updatedAt: input.updatedAt,
    lastActiveAt: input.lastActiveAt ?? current.lastActiveAt,
    lastHeartbeatAt: input.lastHeartbeatAt ?? current.lastHeartbeatAt,
    mindState: {
      ...input.turnResult.persona.mindState,
      pendingShadowTurns: current.mindState.pendingShadowTurns.map((job) =>
        job.id === input.shadowJobId
          ? {
              ...job,
              status: "completed",
              completedAt: input.updatedAt,
              updatedAt: input.updatedAt,
            }
          : job,
      ),
    },
  }));
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

    soulLogger.warn(
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

type ClaimedShadowTurn = Awaited<ReturnType<typeof claimPersonaShadowTurn>>;

async function processClaimedShadowTurn(
  personaId: string,
  claimed: NonNullable<ClaimedShadowTurn>,
  sessionId?: string,
) {
  const { persona, job } = claimed;
  const providers = getProviders();
  const feedbackNotes = await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));

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
    });

    if (committed.matched) {
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

    soulLogger.warn(
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
  return updatePersona(personaId, (persona) => ({
    ...persona,
    updatedAt: userState.createdAt,
    lastActiveAt: userState.createdAt,
    mindState: {
      ...persona.mindState,
      lastUserState: userState,
      recentUserStates: [userState, ...persona.mindState.recentUserStates].slice(0, 12),
      recentShift: userState.summary,
      contextVersion: persona.mindState.contextVersion + 1,
    },
  }));
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
        recentEvents: [executedEvent, ...current.mindState.recentEvents].slice(0, 80),
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

export async function createPersonaFromForm(formData: FormData) {
  const providers = getProviders();
  const now = new Date().toISOString();

  const name = String(formData.get("name") ?? "").trim();
  const relationship = String(formData.get("relationship") ?? "").trim();
  const source = String(formData.get("source") ?? "living") as PersonaSource;
  const description = String(formData.get("description") ?? "").trim();
  const pastedText = String(formData.get("pastedText") ?? "").trim();
  const existingVoiceId = String(formData.get("existingVoiceId") ?? "").trim();
  const starterVoiceId = String(formData.get("starterVoiceId") ?? "").trim();
  const attestedRights = formData.get("attestedRights") === "on";
  const deceasedDisclosureAccepted = formData.get("deceasedDisclosureAccepted") === "on";
  const heartbeatIntervalHours = Number(formData.get("heartbeatIntervalHours") ?? 4);
  const preferredMode: Persona["heartbeatPolicy"]["preferredMode"] =
    String(formData.get("preferredMode") ?? "mixed") === "voice_note"
      ? "voice_note"
      : String(formData.get("preferredMode") ?? "mixed") === "text"
        ? "text"
        : "mixed";
  const status: Persona["status"] = source === "deceased" ? "pending_review" : "active";

  if (!name || !relationship || !description) {
    throw new Error("Name, relationship, and description are required.");
  }

  if (!attestedRights) {
    throw new Error("Rights attestation is required.");
  }

  if (source === "deceased" && !deceasedDisclosureAccepted) {
    throw new Error("The deceased-person disclosure must be accepted.");
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
    userId: "user-demo",
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
    },
    voice,
    consent: {
      attestedRights,
      deceasedDisclosureAccepted,
      manualReviewRequired: source === "deceased",
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

  const persona: Persona = {
    ...personaBase,
    mindState: createInitialMindState({
      persona: personaBase,
      messages: [],
    }),
  };

  await savePersona(persona);

  await appendMessages([
    createMessage({
      personaId: persona.id,
      role: "assistant",
      kind: "preview",
      channel: "web",
      body:
        source === "deceased"
          ? `I've assembled ${name}'s draft persona. It will stay in review until you approve the sensitive-use disclosures.`
          : `I've assembled ${name}'s draft persona. Start talking normally, even if that includes boundaries like "don't text me while I'm at work."`,
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
  const originalText = payload.text?.trim() ?? "";
  let userText = originalText;
  const imageFiles = (payload.images ?? []).filter((file) => file.size > 0);
  let audioAttachment: MessageAttachment | undefined;

  if (payload.audioFile && payload.audioFile.size > 0) {
    audioAttachment = await persistMessageAttachment(payload.audioFile, "audio");

    if (!userText) {
      const buffer = Buffer.from(await payload.audioFile.arrayBuffer());
      userText = await providers.transcription.transcribeAudio({
        buffer,
        mimeType: payload.audioFile.type || "audio/webm",
        fileName: payload.audioFile.name,
      });
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

  for (const imageFile of imageFiles) {
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

    imageAttachments.push(attachment);
    observations.push(observation);
  }

  const inferredUserState = await providers.reasoning.inferUserState({
    persona,
    messages: existingMessages,
    latestUserText: userText,
    channel: payload.channel ?? "web",
    createdAt: userMessageCreatedAt,
    visualContext: observations.map((observation) => ({
      summary: observation.summary,
      situationalSignals: observation.situationalSignals,
      environmentPressure: observation.environmentPressure,
      taskContext: observation.taskContext,
      attentionTarget: observation.attentionTarget,
    })),
  });

  userMessage.userState = inferredUserState;
  userMessage.attachments = [...userMessage.attachments, ...imageAttachments];

  await appendMessages([userMessage]);
  if (observations.length > 0) {
    await appendPerceptionObservations(observations);
  }
  let activePersona = persona;
  const { preferenceUpdate, persona: updatedPersona } = await applyPreferenceSignalIfNeeded(
    persona,
    originalText,
  );
  activePersona = updatedPersona;

  const feedback = await listFeedback(personaId);
  const feedbackNotes = feedback.map((entry) => entry.note);
  const userTurnExecution = await runVersionedSoulTurn({
    personaId,
    basePersona: activePersona,
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
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
        userStateId: inferredUserState.id,
        metadata: {
          messageId: userMessage.id,
          attachmentTypes: userMessage.attachments.map((attachment) => attachment.type).join(","),
        },
      },
      latestUserText: userText,
      providedUserState: inferredUserState,
      reasoning: providers.reasoning,
      replyChannel: payload.channel === "telegram" ? "telegram" : "web",
      renderReply: true,
      boundaryTriggered: Boolean(preferenceUpdate),
    }),
  });
  const userTurnResult = userTurnExecution.turnResult;
  activePersona = userTurnExecution.persona;
  activePersona = await queuePendingInternalEvents(activePersona);

  const replyText = preferenceUpdate
    ? composePreferenceReply(activePersona, preferenceUpdate)
    : userTurnResult.replyText ?? "";
  const shouldReplyWithVoiceNote =
    payload.channel === "telegram" || Boolean(audioAttachment);
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

  await appendMessages([assistantMessage]);

  const messagesWithReply = await listMessages(personaId);
  const assistantTurnExecution = await runVersionedSoulTurn({
    personaId,
    basePersona: activePersona,
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
        kind: "assistant_message",
        channel: payload.channel ?? "web",
        modality: synthesized.audioUrl ? "voice_note" : "text",
        content: assistantMessage.body,
        createdAt: assistantMessage.createdAt,
        internal: true,
        causationId: userMessage.id,
        correlationId: userMessage.id,
        metadata: {
          messageId: assistantMessage.id,
          replyMode: assistantMessage.replyMode,
        },
      },
      latestUserText: "",
      reasoning: providers.reasoning,
      renderReply: false,
    }),
  });
  activePersona = assistantTurnExecution.persona;
  activePersona = await queuePendingInternalEvents(activePersona);

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
  });
  const pendingJobs = persona.mindState.pendingShadowTurns.filter((job) => {
    if (job.status === "completed" || job.status === "failed") {
      return false;
    }

    if (!input.sessionId) {
      return true;
    }

    return job.sessionId === input.sessionId;
  }).length;

  return {
    persona,
    sessionFrame:
      sessionFrame.contextVersion > (input.afterVersion ?? 0) ? sessionFrame : undefined,
    pendingJobs,
  };
}

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

  if (inferredUserState) {
    activePersona = await applyFastLiveUserState(personaId, inferredUserState);
  }

  if (!isAssistant) {
    const learned = await applyPreferenceSignalIfNeeded(activePersona, body);
    activePersona = learned.persona;
    if (learned.contextualUpdate) {
      contextualUpdates.push(learned.contextualUpdate);
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

  const shadowTurn = buildPendingShadowTurn({
    persona: activePersona,
    perception,
    sessionId: parsed.sessionId,
  });

  activePersona = await enqueuePersonaShadowTurn(activePersona.id, shadowTurn);
  await publishPersonaShadowTurns({
    personaId: activePersona.id,
    jobs: [shadowTurn],
  });

  const sessionFrame = buildSessionFrame({
    persona: activePersona,
    messages,
    feedbackNotes,
    perception,
    contextDelta:
      contextualUpdates.length > 0
        ? contextualUpdates.join(" ")
        : "Shadow cognition queued for this live turn.",
  });

  return {
    message,
    persona: activePersona,
    sessionFrame,
    contextualUpdate: contextualUpdates.length > 0 ? contextualUpdates.join("\n\n") : undefined,
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
  const shadowTurn = buildPendingShadowTurn({
    persona: fastPersona,
    perception,
    sessionId: payload.sessionId,
    providedUserState: observation.userState,
  });
  const queuedPersona = await enqueuePersonaShadowTurn(fastPersona.id, shadowTurn);
  await publishPersonaShadowTurns({
    personaId,
    jobs: [shadowTurn],
  });
  const sessionFrame = buildSessionFrame({
    persona: queuedPersona,
    messages,
    feedbackNotes,
    perception,
    contextDelta: `Visual observation queued from ${payload.mode}.`,
  });

  return {
    observation,
    persona: queuedPersona,
    sessionFrame,
    contextualUpdate: sessionFrame.contextDelta,
  };
}

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
  }));

  return feedback;
}

export async function approvePersona(personaId: string, payload: unknown) {
  const parsed = approvalRequestSchema.parse(payload);

  if (!parsed.approved) {
    throw new Error("Declining personas is not implemented in this prototype.");
  }

  return updatePersona(personaId, (persona) => ({
    ...persona,
    status: "active",
    updatedAt: new Date().toISOString(),
    consent: {
      ...persona.consent,
      approvedAt: new Date().toISOString(),
    },
  }));
}

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

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

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
