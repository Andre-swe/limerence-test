import { z } from "zod";

export const interviewPrompts = [
  "How would they react to good news?",
  "What phrases or sayings did they use often?",
  "Were they more sarcastic or sincere in texts?",
  "How did they usually sign off?",
  "What topics lit them up immediately?",
] as const;

export const personaSourceSchema = z.enum(["living"]);
export const personaStatusSchema = z.enum(["draft", "active"]);
export const channelSchema = z.enum(["web", "telegram", "heartbeat", "live"]);
export const liveSessionModeSchema = z.enum(["voice", "screen", "camera"]);
export const messageRoleSchema = z.enum(["user", "assistant", "system"]);
export const messageKindSchema = z.enum(["text", "audio", "preview", "image"]);
export const replyModeSchema = z.enum(["text", "voice_note"]);
export const telegramDeliveryStatusSchema = z.enum([
  "not_requested",
  "pending",
  "sent",
  "failed",
]);

const normalizedScoreSchema = z.number().min(0).max(1);
const flexibleScoreSchema = normalizedScoreSchema.default(0.5);

export const feedbackRequestSchema = z.object({
  messageId: z.string().min(1),
  note: z.string().min(4).max(280),
});

export const liveTranscriptRequestSchema = z.object({
  role: z.enum(["user", "assistant"]),
  body: z.string().trim().min(1).max(4000),
  eventId: z.string().trim().min(1).max(120).optional(),
  fromText: z.boolean().optional(),
  language: z.string().trim().min(1).max(40).optional(),
  liveMode: liveSessionModeSchema.optional(),
  sessionId: z.string().trim().min(1).max(120).optional(),
  prosodyScores: z.record(z.string(), normalizedScoreSchema).optional(),
});

export const heartbeatPolicySchema = z.object({
  enabled: z.boolean().default(true),
  intervalHours: z.number().min(1).max(24).default(4),
  maxOutboundPerDay: z.number().min(1).max(10).default(3),
  quietHoursStart: z.number().min(0).max(23).default(22),
  quietHoursEnd: z.number().min(0).max(23).default(8),
  preferredMode: z.enum(["text", "voice_note", "mixed"]).default("mixed"),
  workHoursEnabled: z.boolean().default(false),
  workHoursStart: z.number().min(0).max(23).default(9),
  workHoursEnd: z.number().min(0).max(23).default(17),
  workDays: z.array(z.number().min(0).max(6)).default([1, 2, 3, 4, 5]),
  boundaryNotes: z.array(z.string()).default([]),
  // Variable-interval heartbeat settings (circadian rhythm)
  variableInterval: z.boolean().default(true),
  // Activity counts per hour (0-23), learned from user interactions
  hourlyActivityCounts: z.array(z.number()).length(24).default(Array(24).fill(0)),
  // Min/max interval bounds for variable scheduling
  minIntervalHours: z.number().min(0.5).max(12).default(1),
  maxIntervalHours: z.number().min(2).max(48).default(8),
});

export const preferenceSignalSchema = z.object({
  id: z.string(),
  sourceText: z.string(),
  interpretation: z.string(),
  effectSummary: z.string(),
  status: z.enum(["noted", "negotiating"]),
  createdAt: z.string(),
});

export const soulProcessSchema = z.enum([
  "arrival",
  "attunement",
  "comfort",
  "celebration",
  "play",
  "memory_recall",
  "repair",
  "boundary_negotiation",
  "follow_through",
  "silence_holding",
  "grief_presence",
  "practical_guidance",
  "reengagement",
  "protective_check_in",
]);

export const cognitiveStepIdSchema = z.enum([
  "encode_perception",
  "appraise_user_state",
  "retrieve_memory",
  "update_relationship_model",
  "select_process",
  "deliberate_intent",
  "render_response",
  "run_learning_subprocesses",
  "schedule_internal_events",
  "commit_trace",
]);

export const learningSubprocessSchema = z.enum([
  "learn_about_user",
  "learn_about_relationship",
  "learn_about_self_consistency",
  "repair_from_feedback",
  "consolidate_episode",
  "update_open_loops",
]);

export const scalarLocalMemoryValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const scalarLocalMemorySchema = z
  .record(z.string(), scalarLocalMemoryValueSchema)
  .default({});

export const intentResultSchema = z.object({
  processIntent: z.string().trim().min(1),
  updatedLocalMemory: scalarLocalMemorySchema.default({}),
});

export const learningArtifactPayloadSchema = z.object({
  kind: learningSubprocessSchema,
  summary: z.string().trim().min(1),
  effectSummary: z.string().trim().min(1).optional(),
  memoryKeys: z.array(z.string().trim().min(1)).default([]),
});

export const relationshipMemorySchema = z.object({
  id: z.string(),
  kind: z.enum(["fact", "boundary", "preference", "ritual", "repair", "milestone"]),
  summary: z.string(),
  sourceText: z.string(),
  weight: z.number().min(1).max(5).default(3),
  createdAt: z.string(),
  lastReinforcedAt: z.string(),
});

export const openLoopSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  followUpPrompt: z.string(),
  keywords: z.array(z.string()).default([]),
  status: z.enum(["open", "resolved", "muted"]).default("open"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  sourceText: z.string(),
  sourceMessageId: z.string().optional(),
  dueHint: z.string().optional(),
  readyAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const workingMemorySchema = z.object({
  summary: z.string(),
  currentFocus: z.string(),
  emotionalWeather: z.string(),
  lastUserNeed: z.string(),
  updatedAt: z.string(),
});

export const personalityConstitutionSchema = z.object({
  warmth: flexibleScoreSchema,
  directness: flexibleScoreSchema,
  humorType: z.enum(["dry", "playful", "wry", "earnest", "none"]).default("earnest"),
  initiative: flexibleScoreSchema,
  volatility: flexibleScoreSchema,
  tenderness: flexibleScoreSchema,
  reserve: flexibleScoreSchema,
  rituality: flexibleScoreSchema,
  conflictStyle: z
    .enum(["avoidant", "direct", "protective", "teasing", "measured"])
    .default("measured"),
  repairStyle: z
    .enum([
      "quick_apology",
      "steady_reassurance",
      "practical_reset",
      "playful_softening",
      "careful_listening",
    ])
    .default("careful_listening"),
  playfulness: flexibleScoreSchema,
  protectiveness: flexibleScoreSchema,
  selfDisclosure: flexibleScoreSchema,
  speechCadence: z.enum(["brief", "measured", "flowing", "lyrical"]).default("measured"),
  boundaryFirmness: flexibleScoreSchema,
  pushbackTendency: flexibleScoreSchema,
  emotionalIntensity: flexibleScoreSchema,
  patience: flexibleScoreSchema,
  affectionStyle: z
    .enum(["verbal", "playful", "protective", "restrained", "ritual"])
    .default("verbal"),
});

export const relationshipModelSchema = z.object({
  closeness: flexibleScoreSchema,
  asymmetry: z
    .enum(["peer", "caretaking", "looked_up_to", "looked_after", "romantic", "synthetic"])
    .default("peer"),
  sharedRituals: z.array(z.string()).default([]),
  frictionPatterns: z.array(z.string()).default([]),
  favoriteModes: z.array(z.enum(["text", "live_voice", "voice_note"])).default(["live_voice"]),
  acceptablePushback: flexibleScoreSchema,
  repairExpectations: z.string().default("Repair quickly and stay human."),
  baselineTone: z.string().default("quiet but available"),
  feltHistory: z.string().default("Built from memories, samples, and interaction."),
});

export const userStateSnapshotSchema = z.object({
  id: z.string(),
  modality: z.enum(["text", "live_voice", "voice_note", "image", "multimodal"]),
  topSignals: z.array(z.string()).default([]),
  valence: flexibleScoreSchema,
  arousal: flexibleScoreSchema,
  activation: flexibleScoreSchema,
  certainty: flexibleScoreSchema,
  vulnerability: flexibleScoreSchema,
  desireForCloseness: flexibleScoreSchema,
  desireForSpace: flexibleScoreSchema,
  repairRisk: flexibleScoreSchema,
  boundaryPressure: flexibleScoreSchema,
  taskFocus: flexibleScoreSchema,
  griefLoad: flexibleScoreSchema,
  playfulness: flexibleScoreSchema,
  frustration: flexibleScoreSchema,
  visualContextSummary: z.string().optional(),
  situationalSignals: z.array(z.string()).default([]),
  environmentPressure: flexibleScoreSchema,
  taskContext: z.string().optional(),
  attentionTarget: z.string().optional(),
  summary: z.string(),
  evidence: z.string().optional(),
  confidence: flexibleScoreSchema,
  provenance: z
    .array(
      z.enum([
        "heuristic",
        "gemini",
        "hume_prosody",
        "visual_perception",
        "feedback",
      ]),
    )
    .default(["heuristic"]),
  prosodyScores: z.record(z.string(), normalizedScoreSchema).optional(),
  createdAt: z.string(),
});

export const fastTurnResultSchema = z.object({
  replyText: z.string().trim().min(1).max(2400),
  userState: userStateSnapshotSchema,
  process: soulProcessSchema,
  processIntent: z.string().trim().min(1).max(280),
  currentDrive: z.string().trim().min(1).max(280),
  updatedLocalMemory: scalarLocalMemorySchema.default({}),
  relationshipDelta: z.string().trim().min(1).max(280).optional(),
});

export const soulPerceptionSchema = z.object({
  id: z.string().optional(),
  causationId: z.string().optional(),
  correlationId: z.string().optional(),
  kind: z.enum([
    "session_start",
    "user_message",
    "assistant_message",
    "text_message",
    "voice_turn",
    "user_shared_image",
    "screen_observation",
    "camera_observation",
    "visual_session_start",
    "visual_session_end",
    "interruption",
    "feedback",
    "timer_elapsed",
    "silence",
    "heartbeat_tick",
    "learning_complete",
    "process_transition",
    "memory_consolidation",
    "scheduled_followup_ready",
    "response_rendered",
  ]),
  channel: channelSchema.optional(),
  modality: z
    .enum(["text", "live_voice", "voice_note", "image", "multimodal"])
    .optional(),
  content: z.string().optional(),
  createdAt: z.string(),
  internal: z.boolean().default(false),
  sessionId: z.string().optional(),
  userStateId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const scheduledPerceptionSchema = z.object({
  id: z.string(),
  kind: z.enum(["timer_elapsed", "silence", "heartbeat_tick"]),
  summary: z.string(),
  content: z.string().optional(),
  readyAt: z.string(),
  urgency: z.enum(["ambient", "ready", "urgent"]).default("ready"),
  source: z.enum(["open_loop", "user_state", "boundary", "process"]),
  sourceId: z.string().optional(),
  status: z.enum(["pending", "consumed", "dismissed"]).default("pending"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memoryNoteSchema = z.object({
  id: z.string(),
  summary: z.string(),
  sourceText: z.string().optional(),
  sourceMessageId: z.string().optional(),
  weight: z.number().min(1).max(5).default(3),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memoryRegionSnapshotSchema = z.object({
  constitutionMemory: z.array(memoryNoteSchema).default([]),
  relationshipMemory: z.array(relationshipMemorySchema).default([]),
  episodicMemory: z.array(memoryNoteSchema).default([]),
  boundaryMemory: z.array(memoryNoteSchema).default([]),
  repairMemory: z.array(memoryNoteSchema).default([]),
  ritualMemory: z.array(memoryNoteSchema).default([]),
  openLoopMemory: z.array(openLoopSchema).default([]),
  learnedUserNotes: z.array(memoryNoteSchema).default([]),
  learnedRelationshipNotes: z.array(memoryNoteSchema).default([]),
  processMemory: z.array(memoryNoteSchema).default([]),
});

export const memoryClaimKindSchema = z.enum([
  "user_fact",
  "preference",
  "boundary",
  "ritual",
  "relationship_note",
  "repair_note",
  "milestone",
  "open_loop_fact",
]);

export const memoryClaimScopeSchema = z
  .enum(["relationship", "session", "persona_self", "global_user"])
  .default("relationship");

export const memoryClaimStatusSchema = z
  .enum(["tentative", "confirmed", "contradicted", "stale"])
  .default("tentative");

export const memoryClaimSchema = z.object({
  id: z.string(),
  kind: memoryClaimKindSchema,
  summary: z.string(),
  detail: z.string().optional(),
  scope: memoryClaimScopeSchema,
  status: memoryClaimStatusSchema,
  confidence: flexibleScoreSchema,
  importance: flexibleScoreSchema,
  sourceIds: z.array(z.string()).default([]),
  reinforcementCount: z.number().int().min(1).default(1),
  firstObservedAt: z.string(),
  lastObservedAt: z.string(),
  lastConfirmedAt: z.string().optional(),
  lastUsedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const claimSourceSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  messageId: z.string().optional(),
  observationId: z.string().optional(),
  sessionId: z.string().optional(),
  feedbackEventId: z.string().optional(),
  sourceType: z.enum(["message", "observation", "session", "feedback", "inference", "bootstrap"]),
  excerpt: z.string().optional(),
  createdAt: z.string(),
});

export const episodeRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  channel: channelSchema,
  summary: z.string(),
  participants: z.array(z.string()).default([]),
  keyPhrases: z.array(z.string()).default([]),
  affectiveArc: z.string(),
  sourceMessageIds: z.array(z.string()).default([]),
  sourceObservationIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export const memoryRetrievalPackSchema = z.object({
  alwaysLoadedClaims: z.array(memoryClaimSchema).default([]),
  contextualClaims: z.array(memoryClaimSchema).default([]),
  contextualEpisodes: z.array(episodeRecordSchema).default([]),
  summary: z.string().default(""),
  builtAt: z.string(),
  perceptionId: z.string().optional(),
});

export const claimConflictResolutionSchema = z.enum([
  "created",
  "reinforced",
  "confirmed",
  "contradicted",
  "stale",
  "skipped",
]);

export const claimWriteResultSchema = z.object({
  claim: memoryClaimSchema,
  resolution: claimConflictResolutionSchema,
  changed: z.boolean().default(true),
});

export const processInstanceStateSchema = z.object({
  id: z.string(),
  process: soulProcessSchema,
  status: z.enum(["active", "completed", "superseded"]).default("active"),
  invocationCount: z.number().min(0).default(0),
  localMemory: scalarLocalMemorySchema,
  lastPerceptionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const soulMemoryValueSchema = z.object({
  kind: z.enum([
    "user_note",
    "relationship_note",
    "ritual",
    "belief",
    "sensitivity",
    "attachment",
    "correction",
    "open_loop",
    "visual_context",
    "archetype_seed",
    "misc",
  ]),
  summary: z.string(),
  value: z.string(),
  weight: z.number().min(1).max(5).default(3),
  sourceIds: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

export const soulMemoryMapSchema = z
  .record(z.string(), soulMemoryValueSchema)
  .default({});

export const learningArtifactSchema = z.object({
  id: z.string(),
  kind: learningSubprocessSchema,
  summary: z.string(),
  effectSummary: z.string().optional(),
  memoryKeys: z.array(z.string()).default([]),
  sourcePerceptionId: z.string().optional(),
  sourceMessageId: z.string().optional(),
  createdAt: z.string(),
});

export const internalScheduledEventSchema = z.object({
  id: z.string(),
  dedupeKey: z.string(),
  processHint: soulProcessSchema.optional(),
  perception: soulPerceptionSchema,
  readyAt: z.string(),
  origin: z.enum(["open_loop", "user_state", "boundary", "process", "learning", "system"]),
  status: z.enum(["pending", "queued", "executed", "cancelled"]).default("pending"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pendingShadowTurnSchema = z.object({
  id: z.string(),
  perception: soulPerceptionSchema,
  sessionId: z.string().optional(),
  baseRevision: z.number().min(1),
  status: z.enum(["pending", "processing", "completed", "failed"]).default("pending"),
  attempts: z.number().min(0).default(0),
  createdAt: z.string(),
  claimedAt: z.string().optional(),
  completedAt: z.string().optional(),
  providedUserState: userStateSnapshotSchema.optional(),
  lastError: z.string().optional(),
});

export const soulEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    "perception_received",
    "step_started",
    "step_completed",
    "process_transition",
    "memory_write",
    "response_dispatched",
    "internal_event_scheduled",
    "internal_event_executed",
    "fallback_used",
    "learning_completed",
  ]),
  perceptionId: z.string().optional(),
  process: soulProcessSchema.optional(),
  processInstanceId: z.string().optional(),
  stepId: cognitiveStepIdSchema.optional(),
  channel: channelSchema.optional(),
  sessionId: z.string().optional(),
  summary: z.string(),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  memoryKeys: z.array(z.string()).default([]),
  provider: z.string().optional(),
  model: z.string().optional(),
  fallback: z.boolean().default(false),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const soulTraceEntrySchema = z.object({
  id: z.string(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  eventId: z.string().optional(),
  stepId: cognitiveStepIdSchema,
  process: soulProcessSchema,
  processInstanceId: z.string().optional(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  memoryDiffs: z.array(z.string()).default([]),
  provider: z.string().optional(),
  model: z.string().optional(),
  fallback: z.boolean().default(false),
  createdAt: z.string(),
  durationMs: z.number().min(0).default(0),
});

export const learningStateSchema = z.object({
  userModelSummary: z.string().default(""),
  relationshipSummary: z.string().default(""),
  selfConsistencySummary: z.string().default(""),
  lastLearningAt: z.string().optional(),
  artifacts: z.array(learningArtifactSchema).default([]),
});

export const liveSessionMetricsSchema = z.object({
  sessionId: z.string(),
  mode: liveSessionModeSchema.default("voice"),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  deliveryRequestedCount: z.number().int().min(0).default(0),
  deliveryRequestedReasons: z.record(z.string(), z.number().int().min(0)).default({}),
  deliveriesSent: z.number().int().min(0).default(0),
  sentReasons: z.record(z.string(), z.number().int().min(0)).default({}),
  coalescedCount: z.number().int().min(0).default(0),
  coalescedReasons: z.record(z.string(), z.number().int().min(0)).default({}),
  pollNoDeliveryCount: z.number().int().min(0).default(0),
  totalDeliveryIntervalMs: z.number().min(0).default(0),
  deliveryIntervalCount: z.number().int().min(0).default(0),
  averageDeliveryIntervalMs: z.number().min(0).default(0),
  lastDeliveredAt: z.string().optional(),
  shadowTurnsEnqueued: z.number().int().min(0).default(0),
  shadowTurnsSkipped: z.number().int().min(0).default(0),
  periodicSyncEnqueues: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Persona internal state — the soul's own emotional experience.
// Inspired by OpenSouls' internalMonologue pattern: the persona has private
// thoughts that persist in working memory and shape every subsequent action.
// ---------------------------------------------------------------------------

export const personaInternalStateSchema = z.object({
  /** The persona's current private thought — what they're feeling right now. */
  currentThought: z.string().default(""),
  /** Narrative summary of the persona's emotional weather. */
  mood: z.string().default("present and steady"),
  /** Energy level — low means shorter/quieter responses, high means more initiative. */
  energy: z.number().min(0).max(1).default(0.6),
  /** Patience — drops with repeated low-content messages or frustrating exchanges. */
  patience: z.number().min(0).max(1).default(0.8),
  /** Warmth toward the user right now — affected by recent interaction quality. */
  warmthTowardUser: z.number().min(0).max(1).default(0.7),
  /** How much the persona wants to engage right now. */
  engagementDrive: z.number().min(0).max(1).default(0.6),
  /** Recent internal monologue entries — private thoughts that shape responses. */
  recentThoughts: z.array(z.object({
    thought: z.string(),
    createdAt: z.string(),
  })).default([]),
  /** When the internal state was last updated. */
  updatedAt: z.string().optional(),
});

export const soulStateSchema = z.object({
  activeProcess: soulProcessSchema.default("arrival"),
  currentProcessInstanceId: z.string().optional(),
  currentDrive: z.string(),
  unresolvedTension: z.string(),
  recentShift: z.string(),
  emotionalBaseline: z.string(),
  recentTrend: z.string(),
  contextVersion: z.number().min(1).default(1),
  liveDeliveryVersion: z.number().min(1).default(1),
  lastLiveDeliveryReason: z.string().optional(),
  lastLiveDeliverySentAt: z.string().optional(),
  lastCoalescedLiveDeliveryVersion: z.number().min(1).optional(),
  traceVersion: z.number().min(1).default(1),
  processState: z.record(z.string(), z.string()).default({}),
  processInstances: z.record(z.string(), processInstanceStateSchema).default({}),
  soulMemory: soulMemoryMapSchema,
  learningState: learningStateSchema,
  workingMemory: workingMemorySchema,
  relationshipMemories: z.array(relationshipMemorySchema).default([]),
  openLoops: z.array(openLoopSchema).default([]),
  scheduledPerceptions: z.array(scheduledPerceptionSchema).default([]),
  pendingInternalEvents: z.array(internalScheduledEventSchema).default([]),
  pendingShadowTurns: z.array(pendingShadowTurnSchema).default([]),
  lastUserState: userStateSnapshotSchema.optional(),
  recentUserStates: z.array(userStateSnapshotSchema).default([]),
  liveSessionMetrics: z.record(z.string(), liveSessionMetricsSchema).default({}),
  memoryRegions: memoryRegionSnapshotSchema,
  memoryClaims: z.array(memoryClaimSchema).default([]),
  claimSources: z.array(claimSourceSchema).default([]),
  episodes: z.array(episodeRecordSchema).default([]),
  recentChangedClaims: z.array(memoryClaimSchema).default([]),
  lastRetrievalPack: memoryRetrievalPackSchema.optional(),
  internalState: personaInternalStateSchema.default({
    currentThought: "",
    mood: "present and steady",
    energy: 0.6,
    patience: 0.8,
    warmthTowardUser: 0.7,
    engagementDrive: 0.6,
    recentThoughts: [],
  }),
  recentEvents: z.array(soulEventSchema).default([]),
  traceHead: z.array(soulTraceEntrySchema).default([]),
  lastReflectionAt: z.string().optional(),
});

export const soulProcessDefinitionSchema = z.object({
  id: soulProcessSchema,
  summary: z.string(),
  defaultDrive: z.string(),
  intensity: z.enum(["low", "medium", "high"]).default("medium"),
  supportsChannels: z
    .array(z.enum(["text", "live_voice", "voice_note"]))
    .default(["text", "live_voice", "voice_note"]),
  entryCriteria: z.array(z.string()).default([]),
  stepOverrides: z.record(z.string(), z.string()).default({}),
  subprocesses: z.array(learningSubprocessSchema).default([]),
  localStateKeys: z.array(z.string()).default([]),
  immediateTransitionRules: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  exitCriteria: z.array(z.string()).default([]),
});

export const soulSessionFrameSchema = z.object({
  process: soulProcessSchema,
  processInstanceId: z.string().optional(),
  systemPrompt: z.string(),
  contextText: z.string(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  userStateSummary: z.string().optional(),
  currentDrive: z.string(),
  traceVersion: z.number().min(1).default(1),
  contextVersion: z.number().min(1).default(1),
  liveDeliveryVersion: z.number().min(1).default(1),
  contextDelta: z.string().optional(),
  deliveryReason: z.string().optional(),
  readyEvents: z.array(z.string()).default([]),
});

export const storedAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["avatar", "voice_sample", "screenshot", "audio_note"]),
  fileName: z.string(),
  originalName: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number(),
  extractedText: z.string().optional(),
});

export const messageAttachmentSchema = z.object({
  id: z.string(),
  type: z.enum(["audio", "image"]),
  fileName: z.string(),
  originalName: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number(),
  extractedText: z.string().optional(),
  visualSummary: z.string().optional(),
});

export const knowledgeProfileSchema = z.object({
  domains: z.array(z.string()).default([]),
  deflectionStyle: z
    .enum(["honest", "self_deprecating", "redirecting", "bluffing", "protective"])
    .default("honest"),
  deflectionExamples: z.array(z.string()).default([]),
});

export const personaDossierSchema = z.object({
  essence: z.string(),
  communicationStyle: z.string(),
  signaturePhrases: z.array(z.string()),
  favoriteTopics: z.array(z.string()),
  emotionalTendencies: z.array(z.string()),
  routines: z.array(z.string()),
  guidance: z.array(z.string()),
  sourceSummary: z.string(),
  knowledgeProfile: knowledgeProfileSchema.default({
    domains: [],
    deflectionStyle: "honest",
    deflectionExamples: [],
  }),
});

export const voiceProfileSchema = z.object({
  provider: z.enum(["mock", "hume"]),
  voiceId: z.string().optional(),
  status: z.enum(["ready", "preview_only", "unavailable"]),
  cloneState: z.enum(["none", "pending_mockup", "ready"]).default("none"),
  cloneRequestedAt: z.string().optional(),
  watermarkApplied: z.boolean().default(false),
});

export const consentRecordSchema = z.object({
  attestedRights: z.boolean(),
  createdAt: z.string(),
});

export const messageMetadataSchema = z.object({
  humeMessageId: z.string().optional(),
  fromText: z.boolean().optional(),
  language: z.string().optional(),
  liveMode: liveSessionModeSchema.optional(),
  sessionId: z.string().optional(),
  prosodyScores: z.record(z.string(), normalizedScoreSchema).optional(),
});

export const perceptionObservationSchema = z.object({
  id: z.string(),
  personaId: z.string(),
  kind: z.enum([
    "user_shared_image",
    "screen_observation",
    "camera_observation",
    "visual_session_start",
    "visual_session_end",
  ]),
  mode: liveSessionModeSchema,
  summary: z.string(),
  situationalSignals: z.array(z.string()).default([]),
  environmentPressure: flexibleScoreSchema,
  taskContext: z.string().optional(),
  attentionTarget: z.string().optional(),
  sessionId: z.string().optional(),
  sourceMessageId: z.string().optional(),
  userState: userStateSnapshotSchema.optional(),
  createdAt: z.string(),
});

export const personaSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  relationship: z.string(),
  source: personaSourceSchema,
  description: z.string(),
  status: personaStatusSchema,
  avatarUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastActiveAt: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  nextHeartbeatAt: z.string().optional(),
  telegramChatId: z.number().optional(),
  telegramUsername: z.string().optional(),
  pastedText: z.string(),
  screenshotSummaries: z.array(z.string()),
  interviewAnswers: z.record(z.string(), z.string()),
  heartbeatPolicy: heartbeatPolicySchema,
  voice: voiceProfileSchema,
  consent: consentRecordSchema,
  dossier: personaDossierSchema,
  voiceSamples: z.array(storedAssetSchema),
  screenshots: z.array(storedAssetSchema),
  preferenceSignals: z.array(preferenceSignalSchema).default([]),
  personalityConstitution: personalityConstitutionSchema,
  relationshipModel: relationshipModelSchema,
  mindState: soulStateSchema,
  revision: z.number().min(1).default(1),
});

export const messageSchema = z.object({
  id: z.string(),
  personaId: z.string(),
  role: messageRoleSchema,
  kind: messageKindSchema,
  channel: channelSchema,
  body: z.string(),
  audioUrl: z.string().optional(),
  audioStatus: z.enum(["ready", "text_fallback", "unavailable"]).default("unavailable"),
  createdAt: z.string(),
  replyMode: replyModeSchema.optional(),
  attachments: z.array(messageAttachmentSchema).default([]),
  userState: userStateSnapshotSchema.optional(),
  metadata: messageMetadataSchema.optional(),
  delivery: z.object({
    webInbox: z.boolean().default(true),
    telegramStatus: telegramDeliveryStatusSchema.default("not_requested"),
    attempts: z.number().default(0),
    lastAttemptAt: z.string().optional(),
    lastError: z.string().optional(),
  }),
});

export const feedbackEventSchema = z.object({
  id: z.string(),
  personaId: z.string(),
  messageId: z.string(),
  note: z.string(),
  createdAt: z.string(),
});

export const dataStoreSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
    }),
  ),
  personas: z.array(personaSchema),
  messages: z.array(messageSchema),
  perceptionObservations: z.array(perceptionObservationSchema).default([]),
  feedbackEvents: z.array(feedbackEventSchema),
  processedTelegramUpdates: z.array(z.string()),
});

export const heartbeatDecisionSchema = z.object({
  action: z.enum(["SILENT", "TEXT", "VOICE_NOTE"]),
  content: z.string().optional(),
  reason: z.string(),
});

export type PersonaSource = z.infer<typeof personaSourceSchema>;
export type PersonaStatus = z.infer<typeof personaStatusSchema>;
export type ConversationChannel = z.infer<typeof channelSchema>;
export type LiveSessionMode = z.infer<typeof liveSessionModeSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageKind = z.infer<typeof messageKindSchema>;
export type ReplyMode = z.infer<typeof replyModeSchema>;
export type HeartbeatPolicy = z.infer<typeof heartbeatPolicySchema>;
export type StoredAsset = z.infer<typeof storedAssetSchema>;
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;
export type KnowledgeProfile = z.infer<typeof knowledgeProfileSchema>;
export type PersonaDossier = z.infer<typeof personaDossierSchema>;
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export type PreferenceSignal = z.infer<typeof preferenceSignalSchema>;
export type MindProcess = z.infer<typeof soulProcessSchema>;
export type CognitiveStepId = z.infer<typeof cognitiveStepIdSchema>;
export type LearningSubprocess = z.infer<typeof learningSubprocessSchema>;
export type RelationshipMemory = z.infer<typeof relationshipMemorySchema>;
export type OpenLoop = z.infer<typeof openLoopSchema>;
export type WorkingMemory = z.infer<typeof workingMemorySchema>;
export type PersonalityConstitution = z.infer<typeof personalityConstitutionSchema>;
export type RelationshipModel = z.infer<typeof relationshipModelSchema>;
export type UserStateSnapshot = z.infer<typeof userStateSnapshotSchema>;
export type FastTurnResult = z.infer<typeof fastTurnResultSchema>;
export type SoulPerception = z.infer<typeof soulPerceptionSchema>;
export type ScheduledPerception = z.infer<typeof scheduledPerceptionSchema>;
export type MemoryNote = z.infer<typeof memoryNoteSchema>;
export type MemoryRegionSnapshot = z.infer<typeof memoryRegionSnapshotSchema>;
export type MemoryClaimKind = z.infer<typeof memoryClaimKindSchema>;
export type MemoryClaimScope = z.infer<typeof memoryClaimScopeSchema>;
export type MemoryClaimStatus = z.infer<typeof memoryClaimStatusSchema>;
export type MemoryClaim = z.infer<typeof memoryClaimSchema>;
export type ClaimSource = z.infer<typeof claimSourceSchema>;
export type EpisodeRecord = z.infer<typeof episodeRecordSchema>;
export type MemoryRetrievalPack = z.infer<typeof memoryRetrievalPackSchema>;
export type PersonaInternalState = z.infer<typeof personaInternalStateSchema>;
export type ClaimConflictResolution = z.infer<typeof claimConflictResolutionSchema>;
export type ClaimWriteResult = z.infer<typeof claimWriteResultSchema>;
export type ProcessInstanceState = z.infer<typeof processInstanceStateSchema>;
export type SoulMemoryValue = z.infer<typeof soulMemoryValueSchema>;
export type SoulMemoryMap = z.infer<typeof soulMemoryMapSchema>;
export type IntentResult = z.infer<typeof intentResultSchema>;
export type LearningArtifactPayload = z.infer<typeof learningArtifactPayloadSchema>;
export type LearningArtifact = z.infer<typeof learningArtifactSchema>;
export type InternalScheduledEvent = z.infer<typeof internalScheduledEventSchema>;
export type PendingShadowTurn = z.infer<typeof pendingShadowTurnSchema>;
export type SoulEvent = z.infer<typeof soulEventSchema>;
export type SoulTraceEntry = z.infer<typeof soulTraceEntrySchema>;
export type LiveSessionMetrics = z.infer<typeof liveSessionMetricsSchema>;
export type SoulState = z.infer<typeof soulStateSchema>;
export type MindState = SoulState;
export type SoulProcessDefinition = z.infer<typeof soulProcessDefinitionSchema>;
export type SoulSessionFrame = z.infer<typeof soulSessionFrameSchema>;
export type Persona = z.infer<typeof personaSchema>;
export type MessageMetadata = z.infer<typeof messageMetadataSchema>;
export type MessageEntry = z.infer<typeof messageSchema>;
export type PerceptionObservation = z.infer<typeof perceptionObservationSchema>;
export type FeedbackEvent = z.infer<typeof feedbackEventSchema>;
export type DataStore = z.infer<typeof dataStoreSchema>;
export type HeartbeatDecision = z.infer<typeof heartbeatDecisionSchema>;
export type LiveTranscriptRequest = z.infer<typeof liveTranscriptRequestSchema>;

export type PersonaAssemblyInput = {
  name: string;
  relationship: string;
  source: PersonaSource;
  description: string;
  pastedText: string;
  interviewAnswers: Record<string, string>;
  screenshotSummaries: string[];
};

export type ProviderStatus = {
  reasoning: "mock" | "openai" | "anthropic" | "gemini";
  transcription: "mock" | "deepgram";
  voice: "mock" | "hume";
  supabaseConfigured: boolean;
};
