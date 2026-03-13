import { randomUUID } from "node:crypto";
import { buildSoulHarness } from "@/lib/soul-harness";
import { createInitialMindState } from "@/lib/mind-runtime";
import {
  applySoulArchetypeToConstitution,
  applySoulArchetypeToRelationship,
  inferSoulArchetypeSeed,
  type SoulArchetypeId,
} from "@/lib/personality-archetypes";
import { soulLogger } from "@/lib/soul-logger";
import { learningArtifactSchema } from "@/lib/types";
import type {
  CognitiveStepId,
  InternalScheduledEvent,
  LearningArtifact,
  MessageEntry,
  MindProcess,
  PerceptionObservation,
  Persona,
  ProcessInstanceState,
  SoulEvent,
  SoulMemoryMap,
  SoulPerception,
  SoulSessionFrame,
  SoulTraceEntry,
  UserStateSnapshot,
} from "@/lib/types";
import { truncate } from "@/lib/utils";

type ReplyChannel = "web" | "telegram";

type ReasoningAdapter = {
  inferUserState(input: {
    persona: Persona;
    messages: MessageEntry[];
    latestUserText: string;
    channel: MessageEntry["channel"];
    createdAt?: string;
    prosodyScores?: Record<string, number>;
    visualContext?: Array<{
      summary: string;
      situationalSignals: string[];
      environmentPressure: number;
      taskContext?: string;
      attentionTarget?: string;
    }>;
  }): Promise<UserStateSnapshot>;
  generateReply(input: {
    persona: Persona;
    messages: MessageEntry[];
    latestUserText: string;
    feedbackNotes: string[];
    channel: ReplyChannel;
  }): Promise<string>;
  deliberateIntent(input: {
    persona: Persona;
    messages: MessageEntry[];
    process: MindProcess;
    localMemory: Record<string, unknown>;
  }): Promise<{ processIntent: string; updatedLocalMemory: Record<string, unknown> }>;
  extractLearningArtifacts(input: {
    persona: Persona;
    messages: MessageEntry[];
    userState?: UserStateSnapshot;
    process: MindProcess;
    perception: SoulPerception;
    feedbackNotes: string[];
  }): Promise<LearningArtifact[]>;
};

export type TurnExecutionResult = {
  perception: SoulPerception;
  persona: Persona;
  userState?: UserStateSnapshot;
  replyText?: string;
  sessionFrame: SoulSessionFrame;
  trace: SoulTraceEntry[];
  events: SoulEvent[];
  learningArtifacts: LearningArtifact[];
  pendingInternalEvents: InternalScheduledEvent[];
  contextDelta?: string;
  selectedArchetype?: SoulArchetypeId;
};

export type ExecuteSoulTurnInput = {
  persona: Persona;
  messages: MessageEntry[];
  observations: PerceptionObservation[];
  feedbackNotes: string[];
  perception: SoulPerception;
  latestUserText?: string;
  providedUserState?: UserStateSnapshot;
  reasoning: ReasoningAdapter;
  replyChannel?: ReplyChannel;
  renderReply?: boolean;
  boundaryTriggered?: boolean;
};

function createPerceptionId() {
  return `perc_${randomUUID()}`;
}

function createTraceId() {
  return `trace_${randomUUID()}`;
}

function createEventId() {
  return `evt_${randomUUID()}`;
}

function summarizePerception(perception: SoulPerception) {
  return `${perception.kind}${perception.content ? `: ${truncate(perception.content, 140)}` : ""}`;
}

function summarizeUserState(state?: UserStateSnapshot) {
  if (!state) {
    return "No user-state snapshot.";
  }

  const signals = state.topSignals.slice(0, 3).join(", ");
  return `${state.summary}${signals ? ` Signals: ${signals}.` : ""}`;
}

function trimRecord(record: Record<string, string | number | boolean>, limit = 8) {
  return Object.fromEntries(Object.entries(record).slice(0, limit));
}

function sanitizeProcessLocalMemory(record: Record<string, unknown>, limit = 8) {
  const sanitized: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!key.trim()) {
      continue;
    }

    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }

    if (Object.keys(sanitized).length >= limit) {
      break;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function boundedArray<T>(items: T[], limit: number) {
  return items.slice(0, limit);
}

function buildVisualContext(observations: PerceptionObservation[]) {
  return observations.slice(-4).map((observation) => ({
    summary: observation.summary,
    situationalSignals: observation.situationalSignals,
    environmentPressure: observation.environmentPressure,
    taskContext: observation.taskContext,
    attentionTarget: observation.attentionTarget,
  }));
}

function archetypeForPersona(persona: Persona) {
  return inferSoulArchetypeSeed({
    relationship: persona.relationship,
    description: persona.description,
    sourceSummary: persona.dossier.sourceSummary,
  });
}

function mergeSoulMemory(base: SoulMemoryMap, next: SoulMemoryMap) {
  return {
    ...base,
    ...next,
  };
}

function latestMessageForRole(messages: MessageEntry[], role: MessageEntry["role"]) {
  return messages
    .slice()
    .reverse()
    .find((message) => message.role === role);
}

function createLearningArtifact(
  kind: LearningArtifact["kind"],
  summary: string,
  input: {
    sourcePerceptionId?: string;
    sourceMessageId?: string;
    memoryKeys?: string[];
    effectSummary?: string;
    createdAt: string;
  },
): LearningArtifact {
  return {
    id: randomUUID(),
    kind,
    summary,
    memoryKeys: input.memoryKeys ?? [],
    effectSummary: input.effectSummary,
    sourcePerceptionId: input.sourcePerceptionId,
    sourceMessageId: input.sourceMessageId,
    createdAt: input.createdAt,
  };
}

function createStepTrace(input: {
  stepId: CognitiveStepId;
  process: MindProcess;
  processInstanceId?: string;
  correlationId?: string;
  causationId?: string;
  eventId?: string;
  inputSummary: string;
  outputSummary: string;
  memoryDiffs?: string[];
  provider?: string;
  model?: string;
  fallback?: boolean;
  createdAt: string;
  durationMs?: number;
}) {
  return {
    id: createTraceId(),
    stepId: input.stepId,
    process: input.process,
    processInstanceId: input.processInstanceId,
    correlationId: input.correlationId,
    causationId: input.causationId,
    eventId: input.eventId,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
    memoryDiffs: input.memoryDiffs ?? [],
    provider: input.provider,
    model: input.model,
    fallback: input.fallback ?? false,
    createdAt: input.createdAt,
    durationMs: input.durationMs ?? 0,
  } satisfies SoulTraceEntry;
}

function createStepLifecycleEvents(input: {
  stepId: CognitiveStepId;
  process: MindProcess;
  processInstanceId?: string;
  perceptionId?: string;
  sessionId?: string;
  channel?: MessageEntry["channel"];
  summary: string;
  inputSummary: string;
  outputSummary: string;
  provider?: string;
  model?: string;
  fallback?: boolean;
  createdAt: string;
  durationMs?: number;
}) {
  const started = {
    id: createEventId(),
    type: "step_started",
    stepId: input.stepId,
    process: input.process,
    processInstanceId: input.processInstanceId,
    perceptionId: input.perceptionId,
    sessionId: input.sessionId,
    channel: input.channel,
    summary: `${input.stepId} started`,
    inputSummary: input.inputSummary,
    memoryKeys: [],
    fallback: false,
    startedAt: input.createdAt,
    durationMs: 0,
  } satisfies SoulEvent;

  const completed = {
    id: createEventId(),
    type: "step_completed",
    stepId: input.stepId,
    process: input.process,
    processInstanceId: input.processInstanceId,
    perceptionId: input.perceptionId,
    sessionId: input.sessionId,
    channel: input.channel,
    summary: input.summary,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
    memoryKeys: [],
    provider: input.provider,
    model: input.model,
    fallback: input.fallback ?? false,
    startedAt: input.createdAt,
    completedAt: input.createdAt,
    durationMs: input.durationMs ?? 0,
  } satisfies SoulEvent;

  return [started, completed] as const;
}

function deriveRelationshipModel(input: {
  persona: Persona;
  userState?: UserStateSnapshot;
}) {
  const archetype = archetypeForPersona(input.persona);
  const base = applySoulArchetypeToRelationship(input.persona.relationshipModel, archetype);
  const state = input.userState;

  if (!state) {
    return base;
  }

  return {
    ...base,
    closeness: Math.max(
      0,
      Math.min(
        1,
        base.closeness * 0.86 +
          state.desireForCloseness * 0.09 +
          (1 - state.desireForSpace) * 0.05,
      ),
    ),
    acceptablePushback: Math.max(
      0,
      Math.min(
        1,
        base.acceptablePushback * 0.82 +
          (1 - state.boundaryPressure) * 0.08 +
          (1 - state.repairRisk) * 0.1,
      ),
    ),
    baselineTone:
      state.griefLoad >= 0.62
        ? "soft and grief-aware"
        : state.taskFocus >= 0.66
          ? "focused but relational"
          : state.playfulness >= 0.64
            ? "light, familiar, and a little playful"
            : base.baselineTone,
    feltHistory:
      state.visualContextSummary && state.visualContextSummary.length > 0
        ? `${base.feltHistory} Recent visual context added situational grounding.`
        : base.feltHistory,
  };
}

function processInstanceFor(
  persona: Persona,
  nextProcess: MindProcess,
  perception: SoulPerception,
  previousProcess?: MindProcess,
) {
  const existingId = persona.mindState.currentProcessInstanceId;
  const existing =
    existingId && persona.mindState.processInstances[existingId]
      ? persona.mindState.processInstances[existingId]
      : undefined;

  if (existing && existing.process === nextProcess) {
    return {
      currentProcessInstanceId: existing.id,
      processInstances: {
        ...persona.mindState.processInstances,
        [existing.id]: {
          ...existing,
          invocationCount: existing.invocationCount + 1,
          lastPerceptionId: perception.id,
          updatedAt: perception.createdAt,
        },
      },
      transition: null,
    };
  }

  const nextId = `proc_${randomUUID()}`;
  const nextInstance: ProcessInstanceState = {
    id: nextId,
    process: nextProcess,
    status: "active",
    invocationCount: 1,
    localMemory: {},
    lastPerceptionId: perception.id,
    createdAt: perception.createdAt,
    updatedAt: perception.createdAt,
  };

  const processInstances = {
    ...persona.mindState.processInstances,
    ...(existing
      ? {
          [existing.id]: {
            ...existing,
            status: "superseded" as const,
            updatedAt: perception.createdAt,
          },
        }
      : {}),
    [nextId]: nextInstance,
  };

  return {
    currentProcessInstanceId: nextId,
    processInstances,
    transition:
      previousProcess && previousProcess !== nextProcess
        ? {
            from: previousProcess,
            to: nextProcess,
          }
        : null,
  };
}

function buildSoulMemoryUpdates(input: {
  persona: Persona;
  userState?: UserStateSnapshot;
  latestUserText: string;
  perception: SoulPerception;
  selectedArchetype?: SoulArchetypeId;
}) {
  const updates: SoulMemoryMap = {
    ...(input.selectedArchetype
      ? {
          "archetype.seed": {
            kind: "archetype_seed",
            summary: `Current archetype seed: ${input.selectedArchetype}`,
            value: input.selectedArchetype,
            weight: 4,
            sourceIds: [input.perception.id ?? ""].filter(Boolean),
            updatedAt: input.perception.createdAt,
          },
        }
      : {}),
  };

  if (input.userState) {
    updates["user.current_state"] = {
      kind: "user_note",
      summary: input.userState.summary,
      value: input.userState.summary,
      weight: 4,
      sourceIds: [input.userState.id],
      updatedAt: input.userState.createdAt,
    };
  }

  if (input.latestUserText.trim()) {
    updates["episode.latest_user_turn"] = {
      kind: "misc",
      summary: truncate(input.latestUserText, 160),
      value: truncate(input.latestUserText, 160),
      weight: 3,
      sourceIds: [input.perception.id ?? ""].filter(Boolean),
      updatedAt: input.perception.createdAt,
    };
  }

  return updates;
}

function buildLearningArtifacts(input: {
  persona: Persona;
  userState?: UserStateSnapshot;
  perception: SoulPerception;
  latestUserText: string;
  feedbackNotes: string[];
  messages: MessageEntry[];
  process: MindProcess;
}) {
  const artifacts: LearningArtifact[] = [];
  const latestUserMessage = latestMessageForRole(input.messages, "user");
  const latestAssistantMessage = latestMessageForRole(input.messages, "assistant");

  if (input.userState && input.latestUserText.trim()) {
    artifacts.push(
      createLearningArtifact(
        "learn_about_user",
        `User note: ${input.userState.summary}`,
        {
          memoryKeys: ["user.notes", "user.current_state"],
          sourcePerceptionId: input.perception.id,
          sourceMessageId: latestUserMessage?.id,
          createdAt: input.perception.createdAt,
        },
      ),
    );
  }

  artifacts.push(
    createLearningArtifact(
      "learn_about_relationship",
      `Relationship learns through ${input.process} with tone ${input.persona.relationshipModel.baselineTone}.`,
      {
        memoryKeys: ["relationship.notes"],
        sourcePerceptionId: input.perception.id,
        sourceMessageId: latestUserMessage?.id,
        createdAt: input.perception.createdAt,
      },
    ),
  );

  artifacts.push(
    createLearningArtifact(
      "learn_about_self_consistency",
      `Self-consistency check: stay inside ${input.persona.name}'s tone without flattening into assistant voice.`,
      {
        memoryKeys: ["self.consistency"],
        sourcePerceptionId: input.perception.id,
        sourceMessageId: latestAssistantMessage?.id,
        createdAt: input.perception.createdAt,
      },
    ),
  );

  if (input.feedbackNotes.length > 0 || input.userState?.repairRisk && input.userState.repairRisk >= 0.58) {
    artifacts.push(
      createLearningArtifact(
        "repair_from_feedback",
        "A mismatch signal is active; future phrasing should move closer to the remembered person.",
        {
          memoryKeys: ["repair.last_mismatch", "self.consistency"],
          sourcePerceptionId: input.perception.id,
          sourceMessageId: latestUserMessage?.id,
          effectSummary: input.feedbackNotes.at(-1),
          createdAt: input.perception.createdAt,
        },
      ),
    );
  }

  artifacts.push(
    createLearningArtifact(
      "consolidate_episode",
      `Consolidated episode around ${truncate(input.latestUserText || input.perception.content || input.process, 120)}.`,
      {
        memoryKeys: ["episode.latest", "relationship.notes"],
        sourcePerceptionId: input.perception.id,
        sourceMessageId: latestUserMessage?.id,
        createdAt: input.perception.createdAt,
      },
    ),
  );

  artifacts.push(
    createLearningArtifact(
      "update_open_loops",
      "Revisit open-loop readiness after this turn.",
      {
        memoryKeys: ["open_loop.last_check"],
        sourcePerceptionId: input.perception.id,
        sourceMessageId: latestUserMessage?.id,
        createdAt: input.perception.createdAt,
      },
    ),
  );

  return artifacts;
}

function normalizeLearningArtifactsForEngine(input: {
  providerArtifacts: LearningArtifact[];
  fallbackArtifacts: LearningArtifact[];
}) {
  const validated = input.providerArtifacts.flatMap((artifact) => {
    const parsed = learningArtifactSchema.safeParse(artifact);
    return parsed.success ? [parsed.data] : [];
  });

  return validated.length > 0 ? validated : input.fallbackArtifacts;
}

function applyLearningArtifacts(
  persona: Persona,
  artifacts: LearningArtifact[],
  userState: UserStateSnapshot | undefined,
  latestUserText: string,
) {
  const learnedUserNotes = [...persona.mindState.memoryRegions.learnedUserNotes];
  const learnedRelationshipNotes = [...persona.mindState.memoryRegions.learnedRelationshipNotes];
  const episodicMemory = [...persona.mindState.memoryRegions.episodicMemory];
  const repairMemory = [...persona.mindState.memoryRegions.repairMemory];
  const soulMemory = { ...persona.mindState.soulMemory };

  for (const artifact of artifacts) {
    if (artifact.kind === "learn_about_user") {
      learnedUserNotes.unshift({
        id: randomUUID(),
        summary: artifact.summary,
        sourceText: latestUserText || userState?.evidence,
        sourceMessageId: artifact.sourceMessageId,
        weight: 4,
        createdAt: artifact.createdAt,
        updatedAt: artifact.createdAt,
      });
      soulMemory["user.notes"] = {
        kind: "user_note",
        summary: artifact.summary,
        value: artifact.summary,
        weight: 4,
        sourceIds: artifact.memoryKeys,
        updatedAt: artifact.createdAt,
      };
    }

    if (artifact.kind === "learn_about_relationship") {
      learnedRelationshipNotes.unshift({
        id: randomUUID(),
        summary: artifact.summary,
        sourceText: latestUserText,
        sourceMessageId: artifact.sourceMessageId,
        weight: 3,
        createdAt: artifact.createdAt,
        updatedAt: artifact.createdAt,
      });
      soulMemory["relationship.notes"] = {
        kind: "relationship_note",
        summary: artifact.summary,
        value: artifact.summary,
        weight: 3,
        sourceIds: artifact.memoryKeys,
        updatedAt: artifact.createdAt,
      };
    }

    if (artifact.kind === "learn_about_self_consistency") {
      soulMemory["self.consistency"] = {
        kind: "belief",
        summary: artifact.summary,
        value: artifact.summary,
        weight: 4,
        sourceIds: artifact.memoryKeys,
        updatedAt: artifact.createdAt,
      };
    }

    if (artifact.kind === "repair_from_feedback") {
      repairMemory.unshift({
        id: randomUUID(),
        summary: artifact.summary,
        sourceText: artifact.effectSummary,
        sourceMessageId: artifact.sourceMessageId,
        weight: 5,
        createdAt: artifact.createdAt,
        updatedAt: artifact.createdAt,
      });
      soulMemory["repair.last_mismatch"] = {
        kind: "correction",
        summary: artifact.summary,
        value: artifact.effectSummary ?? artifact.summary,
        weight: 5,
        sourceIds: artifact.memoryKeys,
        updatedAt: artifact.createdAt,
      };
    }

    if (artifact.kind === "consolidate_episode") {
      episodicMemory.unshift({
        id: randomUUID(),
        summary: artifact.summary,
        sourceText: latestUserText || userState?.evidence,
        sourceMessageId: artifact.sourceMessageId,
        weight: 3,
        createdAt: artifact.createdAt,
        updatedAt: artifact.createdAt,
      });
      soulMemory["episode.latest"] = {
        kind: "misc",
        summary: artifact.summary,
        value: artifact.summary,
        weight: 3,
        sourceIds: artifact.memoryKeys,
        updatedAt: artifact.createdAt,
      };
    }

    if (artifact.kind === "update_open_loops") {
      soulMemory["open_loop.last_check"] = {
        kind: "open_loop",
        summary: artifact.summary,
        value: artifact.summary,
        weight: 2,
        sourceIds: artifact.memoryKeys,
        updatedAt: artifact.createdAt,
      };
    }
  }

  return {
    learnedUserNotes: boundedArray(learnedUserNotes, 12),
    learnedRelationshipNotes: boundedArray(learnedRelationshipNotes, 12),
    episodicMemory: boundedArray(episodicMemory, 24),
    repairMemory: boundedArray(repairMemory, 12),
    soulMemory,
  };
}

function toInternalScheduledEvents(input: {
  persona: Persona;
  perception: SoulPerception;
}) {
  const previous = input.persona.mindState.pendingInternalEvents;
  const mapped = input.persona.mindState.scheduledPerceptions.map((scheduled) => ({
    id: `internal_${scheduled.id}`,
    dedupeKey: `${scheduled.kind}:${scheduled.source}:${scheduled.sourceId ?? scheduled.summary}`,
    processHint: input.persona.mindState.activeProcess,
    perception: {
      id: `internal-perception_${scheduled.id}`,
      kind:
        scheduled.kind === "heartbeat_tick"
          ? "scheduled_followup_ready"
          : scheduled.kind === "silence"
            ? "scheduled_followup_ready"
            : "timer_elapsed",
      channel: "heartbeat",
      modality: "text",
      content: scheduled.content ?? scheduled.summary,
      createdAt: scheduled.readyAt,
      internal: true,
      causationId: input.perception.id,
      correlationId: input.perception.correlationId ?? input.perception.id,
      metadata: {
        source: scheduled.source,
        sourceId: scheduled.sourceId,
        scheduledKind: scheduled.kind,
      },
    },
    readyAt: scheduled.readyAt,
    origin: scheduled.source,
    status: "pending",
    createdAt: scheduled.createdAt,
    updatedAt: scheduled.updatedAt,
  } satisfies InternalScheduledEvent));

  const deduped = new Map<string, InternalScheduledEvent>();
  for (const event of previous) {
    deduped.set(event.dedupeKey, event);
  }

  for (const event of mapped) {
    const existing = deduped.get(event.dedupeKey);
    deduped.set(
      event.dedupeKey,
      existing
        ? {
            ...event,
            id: existing.id,
            status: existing.status,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          }
        : event,
    );
  }

  return Array.from(deduped.values())
    .sort((left, right) => left.readyAt.localeCompare(right.readyAt))
    .slice(0, 24);
}

function nextLearningState(
  persona: Persona,
  artifacts: LearningArtifact[],
  userState?: UserStateSnapshot,
) {
  const existing = persona.mindState.learningState;
  const mergedArtifacts = [...artifacts, ...existing.artifacts].slice(0, 24);
  const userSummary =
    artifacts.find((artifact) => artifact.kind === "learn_about_user")?.summary ??
    existing.userModelSummary;
  const relationshipSummary =
    artifacts.find((artifact) => artifact.kind === "learn_about_relationship")?.summary ??
    existing.relationshipSummary;
  const selfConsistencySummary =
    artifacts.find((artifact) => artifact.kind === "learn_about_self_consistency")?.summary ??
    existing.selfConsistencySummary;

  return {
    userModelSummary: userSummary || userState?.summary || "",
    relationshipSummary,
    selfConsistencySummary,
    lastLearningAt: artifacts[0]?.createdAt ?? existing.lastLearningAt,
    artifacts: mergedArtifacts,
  };
}

function providerName() {
  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return "mock";
}

function modelName() {
  return (
    process.env.GEMINI_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "mock"
  );
}

export async function executeSoulTurn(input: ExecuteSoulTurnInput): Promise<TurnExecutionResult> {
  const startedAt = Date.now();
  const provider = providerName();
  const model = modelName();
  const perception: SoulPerception = {
    ...input.perception,
    id: input.perception.id ?? createPerceptionId(),
    causationId: input.perception.causationId ?? latestMessageForRole(input.messages, "user")?.id,
    correlationId:
      input.perception.correlationId ??
      input.perception.sessionId ??
      input.perception.id ??
      createPerceptionId(),
    modality: input.perception.modality ?? (input.perception.channel === "live" ? "live_voice" : "text"),
    createdAt: input.perception.createdAt ?? new Date().toISOString(),
  };

  const archetype = archetypeForPersona(input.persona);
  const selectedArchetype = archetype?.id;
  const personalityConstitution = applySoulArchetypeToConstitution(
    input.persona.personalityConstitution,
    archetype,
  );
  const seededRelationship = applySoulArchetypeToRelationship(
    input.persona.relationshipModel,
    archetype,
  );
  const seededPersona: Persona = {
    ...input.persona,
    personalityConstitution,
    relationshipModel: seededRelationship,
  };

  const events: SoulEvent[] = [
    {
      id: createEventId(),
      type: "perception_received",
      perceptionId: perception.id,
      channel: perception.channel,
      sessionId: perception.sessionId,
      summary: summarizePerception(perception),
      memoryKeys: [],
      fallback: false,
      startedAt: perception.createdAt,
      completedAt: perception.createdAt,
      durationMs: 0,
    },
  ];
  const trace: SoulTraceEntry[] = [];

  const [encodeStarted, encodeCompleted] = createStepLifecycleEvents({
    stepId: "encode_perception",
    process: seededPersona.mindState.activeProcess,
    processInstanceId: seededPersona.mindState.currentProcessInstanceId,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Perception encoded",
    inputSummary: summarizePerception(input.perception),
    outputSummary: summarizePerception(perception),
    createdAt: perception.createdAt,
  });
  events.push(encodeStarted, encodeCompleted);
  trace.push(
    createStepTrace({
      stepId: "encode_perception",
      process: seededPersona.mindState.activeProcess,
      processInstanceId: seededPersona.mindState.currentProcessInstanceId,
      eventId: encodeCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: summarizePerception(input.perception),
      outputSummary: summarizePerception(perception),
      createdAt: perception.createdAt,
    }),
  );

  const latestUserText =
    input.latestUserText ??
    (perception.kind === "user_message" ||
    perception.kind === "text_message" ||
    perception.kind === "voice_turn"
      ? perception.content ?? ""
      : "");

  const appraisedUserState =
    input.providedUserState ??
    (latestUserText.trim() || perception.userStateId
      ? await input.reasoning.inferUserState({
          persona: seededPersona,
          messages: input.messages,
          latestUserText,
          channel: perception.channel ?? "web",
          createdAt: perception.createdAt,
          prosodyScores:
            typeof perception.metadata?.prosodyScores === "object" &&
            perception.metadata?.prosodyScores
              ? (perception.metadata.prosodyScores as Record<string, number>)
              : undefined,
          visualContext: buildVisualContext(input.observations),
        })
      : undefined);

  const [appraiseStarted, appraiseCompleted] = createStepLifecycleEvents({
    stepId: "appraise_user_state",
    process: seededPersona.mindState.activeProcess,
    processInstanceId: seededPersona.mindState.currentProcessInstanceId,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "User-state appraisal completed",
    inputSummary: truncate(latestUserText || perception.content || summarizePerception(perception), 160),
    outputSummary: summarizeUserState(appraisedUserState),
    provider,
    model,
    createdAt: perception.createdAt,
  });
  events.push(appraiseStarted, appraiseCompleted);
  trace.push(
    createStepTrace({
      stepId: "appraise_user_state",
      process: seededPersona.mindState.activeProcess,
      processInstanceId: seededPersona.mindState.currentProcessInstanceId,
      eventId: appraiseCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: truncate(latestUserText || perception.content || summarizePerception(perception), 160),
      outputSummary: summarizeUserState(appraisedUserState),
      provider,
      model,
      createdAt: perception.createdAt,
    }),
  );

  const memorySummary = [
    `relationship memories ${seededPersona.mindState.relationshipMemories.length}`,
    `open loops ${seededPersona.mindState.openLoops.length}`,
    `learned user notes ${seededPersona.mindState.memoryRegions.learnedUserNotes.length}`,
    `pending internal events ${seededPersona.mindState.pendingInternalEvents.length}`,
  ].join(", ");
  const [retrieveStarted, retrieveCompleted] = createStepLifecycleEvents({
    stepId: "retrieve_memory",
    process: seededPersona.mindState.activeProcess,
    processInstanceId: seededPersona.mindState.currentProcessInstanceId,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Memory retrieval bundle prepared",
    inputSummary: summarizePerception(perception),
    outputSummary: memorySummary,
    createdAt: perception.createdAt,
  });
  events.push(retrieveStarted, retrieveCompleted);
  trace.push(
    createStepTrace({
      stepId: "retrieve_memory",
      process: seededPersona.mindState.activeProcess,
      processInstanceId: seededPersona.mindState.currentProcessInstanceId,
      eventId: retrieveCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: summarizePerception(perception),
      outputSummary: memorySummary,
      createdAt: perception.createdAt,
    }),
  );

  const updatedRelationshipModel = deriveRelationshipModel({
    persona: seededPersona,
    userState: appraisedUserState,
  });

  const [relationshipStarted, relationshipCompleted] = createStepLifecycleEvents({
    stepId: "update_relationship_model",
    process: seededPersona.mindState.activeProcess,
    processInstanceId: seededPersona.mindState.currentProcessInstanceId,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Relationship model updated",
    inputSummary: summarizeUserState(appraisedUserState),
    outputSummary: `closeness ${updatedRelationshipModel.closeness.toFixed(2)}, pushback ${updatedRelationshipModel.acceptablePushback.toFixed(2)}, baseline ${updatedRelationshipModel.baselineTone}`,
    createdAt: perception.createdAt,
  });
  events.push(relationshipStarted, relationshipCompleted);
  trace.push(
    createStepTrace({
      stepId: "update_relationship_model",
      process: seededPersona.mindState.activeProcess,
      processInstanceId: seededPersona.mindState.currentProcessInstanceId,
      eventId: relationshipCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: summarizeUserState(appraisedUserState),
      outputSummary: `Updated baseline tone to ${updatedRelationshipModel.baselineTone}.`,
      createdAt: perception.createdAt,
      memoryDiffs: ["relationship.notes"],
    }),
  );

  const baseState = createInitialMindState({
    persona: {
      ...seededPersona,
      relationshipModel: updatedRelationshipModel,
      personalityConstitution,
    },
    messages: input.messages,
    observations: input.observations,
    latestUserState: appraisedUserState,
    boundaryTriggered: input.boundaryTriggered,
  });

  const processTransition = processInstanceFor(
    seededPersona,
    baseState.activeProcess,
    perception,
    seededPersona.mindState.activeProcess,
  );

  if (processTransition.transition) {
    events.push({
      id: createEventId(),
      type: "process_transition",
      perceptionId: perception.id,
      process: processTransition.transition.to,
      processInstanceId: processTransition.currentProcessInstanceId,
      sessionId: perception.sessionId,
      channel: perception.channel,
      summary: `${processTransition.transition.from} -> ${processTransition.transition.to}`,
      inputSummary: summarizeUserState(appraisedUserState),
      outputSummary: baseState.currentDrive,
      memoryKeys: [],
      fallback: false,
      startedAt: perception.createdAt,
      completedAt: perception.createdAt,
      durationMs: 0,
    });
  }

  const [selectStarted, selectCompleted] = createStepLifecycleEvents({
    stepId: "select_process",
    process: baseState.activeProcess,
    processInstanceId: processTransition.currentProcessInstanceId,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Process selected",
    inputSummary: summarizeUserState(appraisedUserState),
    outputSummary: `${baseState.activeProcess}: ${baseState.currentDrive}`,
    createdAt: perception.createdAt,
  });
  events.push(selectStarted, selectCompleted);
  trace.push(
    createStepTrace({
      stepId: "select_process",
      process: baseState.activeProcess,
      processInstanceId: processTransition.currentProcessInstanceId,
      eventId: selectCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: summarizeUserState(appraisedUserState),
      outputSummary: `${baseState.activeProcess} selected with drive ${baseState.currentDrive}.`,
      createdAt: perception.createdAt,
    }),
  );

  const currentInstance = processTransition.processInstances[processTransition.currentProcessInstanceId];
  const localMemoryBase: Record<string, unknown> = {
    ...currentInstance.localMemory,
    last_user_summary: appraisedUserState?.summary ?? "",
    last_user_state_id: appraisedUserState?.id ?? "",
    last_perception_kind: perception.kind,
    last_user_text: truncate(latestUserText, 160),
  };

  const intentResult = await input.reasoning.deliberateIntent({
    persona: seededPersona,
    messages: input.messages,
    process: baseState.activeProcess,
    localMemory: localMemoryBase,
  });

  const localMemory = sanitizeProcessLocalMemory(intentResult.updatedLocalMemory);
  const deliberateSummary = intentResult.processIntent || [
    `drive ${baseState.currentDrive}`,
    `tension ${baseState.unresolvedTension}`,
    `trend ${baseState.recentTrend}`,
  ].join(" | ");
  const [deliberateStarted, deliberateCompleted] = createStepLifecycleEvents({
    stepId: "deliberate_intent",
    process: baseState.activeProcess,
    processInstanceId: currentInstance.id,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Intent deliberation completed",
    inputSummary: summarizeUserState(appraisedUserState),
    outputSummary: deliberateSummary,
    createdAt: perception.createdAt,
  });
  events.push(deliberateStarted, deliberateCompleted);
  trace.push(
    createStepTrace({
      stepId: "deliberate_intent",
      process: baseState.activeProcess,
      processInstanceId: currentInstance.id,
      eventId: deliberateCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: summarizeUserState(appraisedUserState),
      outputSummary: deliberateSummary,
      createdAt: perception.createdAt,
      memoryDiffs: ["process.local"],
    }),
  );

  const preLearnPersona: Persona = {
    ...seededPersona,
    relationshipModel: updatedRelationshipModel,
    mindState: {
      ...baseState,
      currentProcessInstanceId: processTransition.currentProcessInstanceId,
      processInstances: {
        ...processTransition.processInstances,
        [currentInstance.id]: {
          ...currentInstance,
          localMemory: trimRecord(localMemory),
          updatedAt: perception.createdAt,
        },
      },
      soulMemory: mergeSoulMemory(
        seededPersona.mindState.soulMemory,
        buildSoulMemoryUpdates({
          persona: seededPersona,
          userState: appraisedUserState,
          latestUserText,
          perception,
          selectedArchetype,
        }),
      ),
      learningState: seededPersona.mindState.learningState,
      contextVersion: seededPersona.mindState.contextVersion,
      traceVersion: seededPersona.mindState.traceVersion,
      pendingInternalEvents: seededPersona.mindState.pendingInternalEvents,
      pendingShadowTurns: seededPersona.mindState.pendingShadowTurns,
      recentEvents: seededPersona.mindState.recentEvents,
      traceHead: seededPersona.mindState.traceHead,
      memoryRegions: {
        ...baseState.memoryRegions,
        learnedUserNotes: seededPersona.mindState.memoryRegions.learnedUserNotes,
        learnedRelationshipNotes: seededPersona.mindState.memoryRegions.learnedRelationshipNotes,
      },
      processState: {
        ...baseState.processState,
        process_instance_id: currentInstance.id,
        current_intent: deliberateSummary,
      },
    },
  };

  let replyText: string | undefined;
  if (input.renderReply && latestUserText.trim()) {
    replyText = await input.reasoning.generateReply({
      persona: preLearnPersona,
      messages: input.messages,
      latestUserText,
      feedbackNotes: input.feedbackNotes,
      channel: input.replyChannel ?? "web",
    });

    const [renderStarted, renderCompleted] = createStepLifecycleEvents({
      stepId: "render_response",
      process: preLearnPersona.mindState.activeProcess,
      processInstanceId: currentInstance.id,
      perceptionId: perception.id,
      sessionId: perception.sessionId,
      channel: perception.channel,
      summary: "Response rendered",
      inputSummary: deliberateSummary,
      outputSummary: truncate(replyText, 180),
      provider,
      model,
      createdAt: perception.createdAt,
    });
    events.push(renderStarted, renderCompleted, {
      id: createEventId(),
      type: "response_dispatched",
      perceptionId: perception.id,
      process: preLearnPersona.mindState.activeProcess,
      processInstanceId: currentInstance.id,
      channel: perception.channel,
      sessionId: perception.sessionId,
      summary: truncate(replyText, 180),
      outputSummary: truncate(replyText, 180),
      memoryKeys: [],
      provider,
      model,
      fallback: false,
      startedAt: perception.createdAt,
      completedAt: perception.createdAt,
      durationMs: 0,
    });
    trace.push(
      createStepTrace({
        stepId: "render_response",
        process: preLearnPersona.mindState.activeProcess,
        processInstanceId: currentInstance.id,
        eventId: renderCompleted.id,
        correlationId: perception.correlationId,
        causationId: perception.causationId,
        inputSummary: deliberateSummary,
        outputSummary: truncate(replyText, 180),
        provider,
        model,
        createdAt: perception.createdAt,
      }),
    );
  }

  const fallbackLearningArtifacts = buildLearningArtifacts({
    persona: preLearnPersona,
    userState: appraisedUserState,
    perception,
    latestUserText,
    feedbackNotes: input.feedbackNotes,
    messages: input.messages,
    process: preLearnPersona.mindState.activeProcess,
  });
  const learningArtifacts = normalizeLearningArtifactsForEngine({
    providerArtifacts: await input.reasoning.extractLearningArtifacts({
      persona: preLearnPersona,
      userState: appraisedUserState,
      perception,
      feedbackNotes: input.feedbackNotes,
      messages: input.messages,
      process: preLearnPersona.mindState.activeProcess,
    }),
    fallbackArtifacts: fallbackLearningArtifacts,
  });
  events.push(
    ...learningArtifacts.map(
      (artifact) =>
        ({
          id: createEventId(),
          type: "learning_completed",
          perceptionId: perception.id,
          process: preLearnPersona.mindState.activeProcess,
          processInstanceId: currentInstance.id,
          channel: perception.channel,
          sessionId: perception.sessionId,
          summary: artifact.kind,
          outputSummary: artifact.summary,
          memoryKeys: artifact.memoryKeys,
          fallback: false,
          startedAt: artifact.createdAt,
          completedAt: artifact.createdAt,
          durationMs: 0,
        }) satisfies SoulEvent,
    ),
  );
  const learningChanges = applyLearningArtifacts(
    preLearnPersona,
    learningArtifacts,
    appraisedUserState,
    latestUserText,
  );

  const [learningStarted, learningCompleted] = createStepLifecycleEvents({
    stepId: "run_learning_subprocesses",
    process: preLearnPersona.mindState.activeProcess,
    processInstanceId: currentInstance.id,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Learning subprocesses completed",
    inputSummary: summarizePerception(perception),
    outputSummary: learningArtifacts.map((artifact) => artifact.kind).join(", "),
    createdAt: perception.createdAt,
  });
  events.push(learningStarted, learningCompleted);
  trace.push(
    createStepTrace({
      stepId: "run_learning_subprocesses",
      process: preLearnPersona.mindState.activeProcess,
      processInstanceId: currentInstance.id,
      eventId: learningCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: summarizePerception(perception),
      outputSummary: learningArtifacts.map((artifact) => artifact.summary).join(" | "),
      createdAt: perception.createdAt,
      memoryDiffs: learningArtifacts.flatMap((artifact) => artifact.memoryKeys),
    }),
  );

  const withLearningPersona: Persona = {
    ...preLearnPersona,
    mindState: {
      ...preLearnPersona.mindState,
      soulMemory: mergeSoulMemory(preLearnPersona.mindState.soulMemory, learningChanges.soulMemory),
      learningState: nextLearningState(preLearnPersona, learningArtifacts, appraisedUserState),
      memoryRegions: {
        ...preLearnPersona.mindState.memoryRegions,
        episodicMemory: learningChanges.episodicMemory,
        repairMemory: learningChanges.repairMemory,
        learnedUserNotes: learningChanges.learnedUserNotes,
        learnedRelationshipNotes: learningChanges.learnedRelationshipNotes,
      },
    },
  };

  const pendingInternalEvents = toInternalScheduledEvents({
    persona: withLearningPersona,
    perception,
  });
  const [scheduleStarted, scheduleCompleted] = createStepLifecycleEvents({
    stepId: "schedule_internal_events",
    process: withLearningPersona.mindState.activeProcess,
    processInstanceId: currentInstance.id,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Internal events scheduled",
    inputSummary: `${withLearningPersona.mindState.scheduledPerceptions.length} scheduled perceptions`,
    outputSummary: `${pendingInternalEvents.length} internal events pending`,
    createdAt: perception.createdAt,
  });
  events.push(scheduleStarted, scheduleCompleted);
  trace.push(
    createStepTrace({
      stepId: "schedule_internal_events",
      process: withLearningPersona.mindState.activeProcess,
      processInstanceId: currentInstance.id,
      eventId: scheduleCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: `${withLearningPersona.mindState.scheduledPerceptions.length} scheduled perceptions`,
      outputSummary: `${pendingInternalEvents.length} internal events pending`,
      createdAt: perception.createdAt,
      memoryDiffs: pendingInternalEvents.map((event) => event.dedupeKey),
    }),
  );

  const scheduledEvents = pendingInternalEvents.map((event) => ({
    id: createEventId(),
    type: "internal_event_scheduled",
    perceptionId: event.perception.id,
    process: event.processHint,
    processInstanceId: currentInstance.id,
    channel: event.perception.channel,
    sessionId: event.perception.sessionId,
    summary: event.dedupeKey,
    outputSummary: `ready at ${event.readyAt}`,
    memoryKeys: [],
    fallback: false,
    startedAt: perception.createdAt,
    completedAt: perception.createdAt,
    durationMs: 0,
  } satisfies SoulEvent));
  events.push(...scheduledEvents);

  const commitSummary = `Committed ${trace.length + 1} traces, ${events.length} events, ${learningArtifacts.length} learning artifacts.`;
  const [commitStarted, commitCompleted] = createStepLifecycleEvents({
    stepId: "commit_trace",
    process: withLearningPersona.mindState.activeProcess,
    processInstanceId: currentInstance.id,
    perceptionId: perception.id,
    sessionId: perception.sessionId,
    channel: perception.channel,
    summary: "Trace committed",
    inputSummary: `${trace.length} prior step traces`,
    outputSummary: commitSummary,
    createdAt: perception.createdAt,
  });
  events.push(commitStarted, commitCompleted);
  trace.push(
    createStepTrace({
      stepId: "commit_trace",
      process: withLearningPersona.mindState.activeProcess,
      processInstanceId: currentInstance.id,
      eventId: commitCompleted.id,
      correlationId: perception.correlationId,
      causationId: perception.causationId,
      inputSummary: `${trace.length} step traces`,
      outputSummary: commitSummary,
      createdAt: perception.createdAt,
    }),
  );

  const committedPersona: Persona = {
    ...withLearningPersona,
    mindState: {
      ...withLearningPersona.mindState,
      pendingInternalEvents,
      pendingShadowTurns: withLearningPersona.mindState.pendingShadowTurns,
      recentEvents: boundedArray([...events, ...withLearningPersona.mindState.recentEvents], 80),
      traceHead: boundedArray([...trace, ...withLearningPersona.mindState.traceHead], 40),
      contextVersion: withLearningPersona.mindState.contextVersion + 1,
      traceVersion: withLearningPersona.mindState.traceVersion + trace.length,
    },
  };

  const sessionFrame = buildSoulHarness({
    persona: committedPersona,
    messages: input.messages,
    feedbackNotes: input.feedbackNotes,
    perception: {
      ...perception,
      userStateId: appraisedUserState?.id,
    },
  }).sessionFrame;

  const contextDelta = replyText
    ? `Latest rendered response intent: ${truncate(replyText, 180)}`
    : `Updated process: ${committedPersona.mindState.activeProcess}. Drive: ${committedPersona.mindState.currentDrive}.`;

  const finalPersona: Persona = {
    ...committedPersona,
    relationshipModel: updatedRelationshipModel,
    mindState: {
      ...committedPersona.mindState,
      processState: {
        ...committedPersona.mindState.processState,
        process_instance_id: currentInstance.id,
        trace_version: String(committedPersona.mindState.traceVersion),
      },
    },
  };

  soulLogger.debug(
    {
      personaId: finalPersona.id,
      process: finalPersona.mindState.activeProcess,
      processInstanceId: finalPersona.mindState.currentProcessInstanceId,
      perceptionId: perception.id,
      correlationId: perception.correlationId,
      archetype: selectedArchetype,
      durationMs: Date.now() - startedAt,
    },
    "soul turn executed",
  );

  return {
    perception,
    persona: finalPersona,
    userState: appraisedUserState,
    replyText,
    sessionFrame: {
      ...sessionFrame,
      processInstanceId: currentInstance.id,
      traceVersion: finalPersona.mindState.traceVersion,
      contextVersion: finalPersona.mindState.contextVersion,
      contextDelta,
    },
    trace,
    events,
    learningArtifacts,
    pendingInternalEvents,
    contextDelta,
    selectedArchetype,
  };
}
