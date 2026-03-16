import { randomUUID } from "node:crypto";
import {
  fastTurnResultSchema,
  type HeartbeatDecision,
  intentResultSchema,
  learningArtifactPayloadSchema,
  personaDossierSchema,
  type FastTurnResult,
  type LiveSessionMode,
  type MessageEntry,
  type MindProcess,
  type PerceptionObservation,
  type Persona,
  type PersonaAssemblyInput,
  type PersonaDossier,
  type ProviderStatus,
  type SoulPerception,
  type StoredAsset,
  type UserStateSnapshot,
  userStateSnapshotSchema,
  type VoiceProfile,
  type LearningArtifact,
  type LearningArtifactPayload,
  type IntentResult,
} from "@/lib/types";
import { savePublicFile } from "@/lib/store";
import { getHouseVoicePreset } from "@/lib/voice-presets";
import {
  planConversationSoul,
  planFastTurnResponse,
  planHeartbeatSoul,
  planIntentDeliberation,
  planLearningExtraction,
  renderConversationPrompt,
  renderFastTurnPrompt,
  renderHeartbeatPrompt,
  renderMockConversationReply,
  renderMockHeartbeatContent,
  renderIntentPrompt,
  renderLearningPrompt,
} from "@/lib/soul-runtime";
import { createInitialMindState, inferHeuristicUserState } from "@/lib/mind-runtime";
import { soulLogger } from "@/lib/soul-logger";
import { safeJsonParse, slugify } from "@/lib/utils";
import { getSupabaseStatus } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Provider timeout — prevents a slow upstream from stalling the app.
// ---------------------------------------------------------------------------
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const TRANSCRIPTION_TIMEOUT_MS = 20_000;

class ProviderTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof ProviderTimeoutError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function normalizedMonologueValue(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function fetchWithTimeout(
  url: string | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const ms = init?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = init?.signal;
  let abortedByTimeout = false;
  const timer = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort(new ProviderTimeoutError(ms));
  }, ms);
  const onAbort = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) {
      onAbort();
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const merged: RequestInit = { ...init, signal: controller.signal };
  return fetch(url, merged)
    .catch((error) => {
      if (abortedByTimeout && isAbortError(error)) {
        throw new ProviderTimeoutError(ms);
      }

      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    });
}

function logProviderFailure(provider: string, method: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout = error instanceof ProviderTimeoutError;
  soulLogger.warn(
    {
      provider,
      method,
      error: message,
      timeout: isTimeout,
      event: "provider_failure",
    },
    `Provider ${provider}.${method} failed${isTimeout ? " (timeout)" : ""}, falling back to mock`,
  );
}

type ReplyRequest = {
  persona: Persona;
  messages: MessageEntry[];
  latestUserText: string;
  feedbackNotes: string[];
  channel: "web" | "telegram";
  /** When true, write for speaking aloud — shorter, more conversational, no visual formatting. */
  voiceNote?: boolean;
};

type HeartbeatRequest = {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  now: Date;
};

type UserStateRequest = {
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
};

type FastTurnRequest = {
  persona: Persona;
  messages: MessageEntry[];
  latestUserText: string;
  feedbackNotes: string[];
  channel: "web" | "telegram";
  createdAt?: string;
  visualContext?: Array<{
    summary: string;
    situationalSignals: string[];
    environmentPressure: number;
    taskContext?: string;
    attentionTarget?: string;
  }>;
  boundaryTriggered?: boolean;
};

type VisualPerceptionRequest = {
  persona: Persona;
  messages: MessageEntry[];
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  mode: LiveSessionMode;
  source: "message_image" | "screen" | "camera";
};

type VisualPerceptionResult = Pick<
  PerceptionObservation,
  "summary" | "situationalSignals" | "environmentPressure" | "taskContext" | "attentionTarget"
>;

export type IntentRequest = {
  persona: Persona;
  messages: MessageEntry[];
  process: MindProcess;
  localMemory: Record<string, unknown>;
};

export type LearningExtractionRequest = {
  persona: Persona;
  messages: MessageEntry[];
  userState?: UserStateSnapshot;
  process: MindProcess;
  perception: SoulPerception;
  feedbackNotes: string[];
  replyText?: string;
};

function inferKnowledgeProfileFromRelationship(
  relationship: string,
  description: string,
): PersonaDossier["knowledgeProfile"] {
  const lower = `${relationship} ${description}`.toLowerCase();
  const domains: string[] = [];
  const deflectionExamples: string[] = [];
  let deflectionStyle: PersonaDossier["knowledgeProfile"]["deflectionStyle"] = "honest";

  if (/(mother|mom|father|dad|parent)/.test(lower)) {
    domains.push("family life", "life advice", "cooking and home", "emotional support");
    deflectionStyle = "redirecting";
    deflectionExamples.push(
      "Honey, I have no idea how that works. Ask someone who actually knows.",
      "That's way over my head — but I bet you'll figure it out.",
    );
  } else if (/(brother|sister|sibling)/.test(lower)) {
    domains.push("shared memories", "family dynamics", "everyday life");
    deflectionStyle = "self_deprecating";
    deflectionExamples.push(
      "Dude I barely passed that class, don't ask me.",
      "Absolutely no clue. Try Google?",
    );
  } else if (/(partner|wife|husband|lover|girlfriend|boyfriend)/.test(lower)) {
    domains.push("shared life", "emotional dynamics", "daily routines", "relationship history");
    deflectionStyle = "honest";
    deflectionExamples.push(
      "I really don't know enough about that to help.",
      "That's not my area — but I'm here if you want to talk it through.",
    );
  } else if (/(friend|buddy|mate)/.test(lower)) {
    domains.push("shared interests", "social life", "opinions and banter");
    deflectionStyle = "self_deprecating";
    deflectionExamples.push(
      "Man I have literally no idea. That's above my pay grade.",
      "Don't look at me for that one lol.",
    );
  }

  if (/(nurse|doctor|medical|health)/.test(lower)) {
    domains.push("health and wellness", "medical basics");
  }
  if (/(teacher|professor|education)/.test(lower)) {
    domains.push("education", "learning strategies");
  }
  if (/(engineer|tech|developer|programmer)/.test(lower)) {
    domains.push("technology", "problem solving");
  }
  if (/(cook|chef|bak)/.test(lower)) {
    domains.push("cooking", "recipes", "food");
  }
  if (/(artist|music|paint|creative)/.test(lower)) {
    domains.push("creative expression", "art and culture");
  }

  if (domains.length === 0) {
    domains.push("everyday life", "emotional support", "personal opinions");
  }

  return { domains, deflectionStyle, deflectionExamples };
}

/** The persona's private inner thought — produced by the internalMonologue cognitive step. */
export type InternalMonologueResult = {
  thought: string;
  mood: string;
  energy: number;
  patience: number;
  warmthTowardUser: number;
  engagementDrive: number;
  shouldReply: boolean;
  replyFormat: "text" | "voice_note";
};

/** Structured reasoning adapter — implemented by Gemini, OpenAI, Anthropic, and a mock fallback. */
export interface ReasoningProvider {
  buildPersonaDossier(input: PersonaAssemblyInput): Promise<PersonaDossier>;
  extractTextFromScreenshot(input: { buffer: Buffer; fileName: string; mimeType: string }): Promise<string>;
  observeVisualContext(input: VisualPerceptionRequest): Promise<VisualPerceptionResult>;
  inferUserState(input: UserStateRequest): Promise<UserStateSnapshot>;
  generateInternalMonologue(prompt: string): Promise<InternalMonologueResult>;
  respondToUserTurn(input: FastTurnRequest): Promise<FastTurnResult>;
  deliberateIntent(input: IntentRequest): Promise<IntentResult>;
  extractLearningArtifacts(input: LearningExtractionRequest): Promise<LearningArtifact[]>;
  generateReply(input: ReplyRequest): Promise<string>;
  runHeartbeatDecision(input: HeartbeatRequest): Promise<HeartbeatDecision>;
}

/** Audio transcription adapter — implemented by Deepgram and a mock fallback. */
export interface TranscriptionProvider {
  transcribeAudio(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<string>;
}

export interface VoiceProvider {
  cloneVoice(input: {
    personaName: string;
    voiceSamples: StoredAsset[];
    existingVoiceId?: string;
    stylePrompt?: string;
    sampleText?: string;
  }): Promise<VoiceProfile>;
  synthesize(input: {
    personaName: string;
    voiceId?: string;
    text: string;
    stylePrompt?: string;
  }): Promise<{
    audioUrl?: string;
    status: "ready" | "text_fallback" | "unavailable";
  }>;
}

const allowedMemoryKeyPrefixes = [
  "user.",
  "relationship.",
  "repair.",
  "self.",
  "open_loop.",
  "episode.",
  "ritual.",
  "boundary.",
  "visual.",
  "soul.",
] as const;

function isScalarMemoryValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function sanitizeLocalMemory(
  input: unknown,
  fallback: Record<string, unknown> = {},
  options?: {
    limit?: number;
    provider?: string;
  },
) {
  const limit = options?.limit ?? 8;
  const sanitized: Record<string, string | number | boolean> = {};
  const source = typeof input === "object" && input !== null ? input : fallback;
  let dropped = 0;

  for (const [key, value] of Object.entries(source)) {
    if (!key.trim()) {
      dropped += 1;
      continue;
    }

    if (!isScalarMemoryValue(value)) {
      dropped += 1;
      continue;
    }

    if (Object.keys(sanitized).length >= limit) {
      dropped += 1;
      continue;
    }

    sanitized[key] = value;
  }

  if (dropped > 0) {
    soulLogger.warn(
      {
        provider: options?.provider ?? "unknown",
        dropped,
      },
      "Dropped invalid local-memory values from provider output",
    );
  }

  return sanitized;
}

function normalizeMemoryKeys(
  input: unknown,
  provider: string,
  limit = 6,
) {
  if (!Array.isArray(input)) {
    return [];
  }

  const deduped = new Set<string>();
  let dropped = 0;

  for (const value of input) {
    if (typeof value !== "string") {
      dropped += 1;
      continue;
    }

    const normalized = value.trim();
    if (!normalized) {
      dropped += 1;
      continue;
    }

    const allowed =
      allowedMemoryKeyPrefixes.some((prefix) => normalized.startsWith(prefix)) &&
      /^[a-z_.]+$/i.test(normalized);

    if (!allowed) {
      dropped += 1;
      continue;
    }

    deduped.add(normalized);
    if (deduped.size >= limit) {
      break;
    }
  }

  if (dropped > 0) {
    soulLogger.warn(
      {
        provider,
        dropped,
      },
      "Dropped invalid learning-artifact memory keys from provider output",
    );
  }

  return [...deduped];
}

function fallbackIntentResult(input: IntentRequest): IntentResult {
  return {
    processIntent: `Intent for ${input.process}`,
    updatedLocalMemory: sanitizeLocalMemory(input.localMemory),
  };
}

function fallbackFastTurnResult(input: FastTurnRequest): FastTurnResult {
  const userState = inferHeuristicUserState({
    text: input.latestUserText,
    channel: input.channel,
    createdAt: input.createdAt,
    visualContext: input.visualContext,
  });
  const fallbackMindState = createInitialMindState({
    persona: input.persona,
    messages: input.messages,
    latestUserState: userState,
    boundaryTriggered: input.boundaryTriggered,
  });
  const personaForReply: Persona = {
    ...input.persona,
    mindState: {
      ...input.persona.mindState,
      activeProcess: fallbackMindState.activeProcess,
      currentDrive: fallbackMindState.currentDrive,
    },
  };
  const plan = planConversationSoul({
    persona: personaForReply,
    messages: input.messages,
    feedbackNotes: input.feedbackNotes,
    latestUserText: input.latestUserText,
    channel: input.channel,
  });

  return {
    replyText: renderMockConversationReply(plan, personaForReply),
    userState,
    process: fallbackMindState.activeProcess,
    processIntent: `Move through ${fallbackMindState.activeProcess} with emotional accuracy.`,
    currentDrive: fallbackMindState.currentDrive,
    updatedLocalMemory: {},
    relationshipDelta: undefined,
  };
}

function parseIntentResult(
  rawText: string,
  fallback: IntentResult,
  provider: string,
): IntentResult {
  const parsed = safeJsonParse<unknown>(rawText, fallback);
  if (typeof parsed !== "object" || parsed === null) {
    soulLogger.warn({ provider }, "Intent result was not an object; using fallback");
    return fallback;
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const processIntent =
    typeof parsedRecord.processIntent === "string" && parsedRecord.processIntent.trim().length > 0
      ? parsedRecord.processIntent.trim()
      : fallback.processIntent;

  const candidate = intentResultSchema.safeParse({
    processIntent,
    updatedLocalMemory: sanitizeLocalMemory(
      parsedRecord.updatedLocalMemory,
      fallback.updatedLocalMemory,
      { provider },
    ),
  });

  if (!candidate.success) {
    soulLogger.warn(
      {
        provider,
        issues: candidate.error.issues.map((issue) => issue.message),
      },
      "Intent result failed validation; using fallback",
    );
    return fallback;
  }

  return candidate.data;
}

function parseFastTurnResult(
  rawText: string,
  fallback: FastTurnResult,
  provider: string,
): FastTurnResult {
  const parsed = safeJsonParse<unknown>(rawText, fallback);
  if (typeof parsed !== "object" || parsed === null) {
    soulLogger.warn({ provider }, "Fast turn result was not an object; using fallback");
    return fallback;
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const parsedUserState =
    typeof parsedRecord.userState === "object" && parsedRecord.userState !== null
      ? (parsedRecord.userState as Record<string, unknown>)
      : {};

  const userStateCandidate = userStateSnapshotSchema.safeParse({
    ...fallback.userState,
    ...parsedUserState,
    id: fallback.userState.id,
    modality: fallback.userState.modality,
    createdAt: fallback.userState.createdAt,
    prosodyScores: fallback.userState.prosodyScores,
    provenance:
      provider === "gemini"
        ? ["gemini"]
        : Array.isArray(parsedUserState.provenance) &&
            parsedUserState.provenance.every((value) => typeof value === "string")
          ? parsedUserState.provenance
          : fallback.userState.provenance,
  });

  const candidate = fastTurnResultSchema.safeParse({
    replyText:
      typeof parsedRecord.replyText === "string" && parsedRecord.replyText.trim().length > 0
        ? parsedRecord.replyText.trim()
        : fallback.replyText,
    userState: userStateCandidate.success ? userStateCandidate.data : fallback.userState,
    process: parsedRecord.process,
    processIntent:
      typeof parsedRecord.processIntent === "string" && parsedRecord.processIntent.trim().length > 0
        ? parsedRecord.processIntent.trim()
        : fallback.processIntent,
    currentDrive:
      typeof parsedRecord.currentDrive === "string" && parsedRecord.currentDrive.trim().length > 0
        ? parsedRecord.currentDrive.trim()
        : fallback.currentDrive,
    updatedLocalMemory: sanitizeLocalMemory(
      parsedRecord.updatedLocalMemory,
      fallback.updatedLocalMemory,
      { provider },
    ),
    relationshipDelta:
      typeof parsedRecord.relationshipDelta === "string" &&
      parsedRecord.relationshipDelta.trim().length > 0
        ? parsedRecord.relationshipDelta.trim()
        : fallback.relationshipDelta,
  });

  if (!candidate.success) {
    soulLogger.warn(
      {
        provider,
        issues: candidate.error.issues.map((issue) => issue.message),
      },
      "Fast turn result failed validation; using fallback",
    );
    return fallback;
  }

  return candidate.data;
}

function normalizePersonaDossier(
  rawText: string,
  fallback: PersonaDossier,
  provider: string,
): PersonaDossier {
  const parsed = safeJsonParse<unknown>(rawText, null);
  if (typeof parsed !== "object" || parsed === null) {
    soulLogger.warn({ provider }, "Persona dossier was not an object; using fallback");
    return fallback;
  }

  const candidate = personaDossierSchema.safeParse(parsed);
  if (!candidate.success) {
    soulLogger.warn(
      {
        provider,
        issues: candidate.error.issues.map((issue) => issue.message),
      },
      "Persona dossier failed validation; using fallback",
    );
    return fallback;
  }

  return candidate.data;
}

function normalizeLearningArtifacts(
  rawText: string,
  fallback: LearningArtifact[],
  provider: string,
  input: Pick<LearningExtractionRequest, "perception">,
): LearningArtifact[] {
  const parsed = safeJsonParse<unknown>(rawText, fallback);
  if (!Array.isArray(parsed)) {
    soulLogger.warn({ provider }, "Learning artifacts were not an array; using fallback");
    return fallback;
  }

  const now = new Date().toISOString();
  const artifacts: LearningArtifact[] = [];
  let dropped = 0;

  for (const item of parsed.slice(0, 8)) {
    const validated = learningArtifactPayloadSchema.safeParse(item);
    if (!validated.success) {
      dropped += 1;
      continue;
    }

    const payload: LearningArtifactPayload = validated.data;
    artifacts.push({
      id: randomUUID(),
      kind: payload.kind,
      summary: payload.summary,
      effectSummary: payload.effectSummary,
      memoryKeys: normalizeMemoryKeys(payload.memoryKeys, provider),
      sourcePerceptionId: input.perception.id,
      createdAt: input.perception.createdAt || now,
    });
  }

  if (dropped > 0) {
    soulLogger.warn(
      {
        provider,
        dropped,
      },
      "Dropped invalid learning-artifact payloads from provider output",
    );
  }

  return artifacts.length > 0 ? artifacts : fallback;
}

class MockReasoningProvider implements ReasoningProvider {
  async buildPersonaDossier(input: PersonaAssemblyInput) {
    const rawSignaturePhrases = [
      ...Object.values(input.interviewAnswers),
      input.pastedText,
      ...input.screenshotSummaries,
    ]
      .join(" ")
      .match(/\b([a-z][a-z']{2,})\b/gi);

    const signaturePhrases = Array.from(
      new Set(
        (rawSignaturePhrases ?? [])
          .map((phrase) => phrase.toLowerCase())
          .filter((phrase) =>
            ["sweetie", "honey", "love", "lmao", "kiddo", "proud", "call"].includes(phrase),
          ),
      ),
    );

    const routines = ["morning check-ins", "follow-up when the user mentions a milestone"];

    return personaDossierSchema.parse({
      essence: `${input.name} is reconstructed as a ${input.relationship.toLowerCase()} whose presence should feel ${input.description.toLowerCase()}.`,
      communicationStyle: input.pastedText
        ? `Patterned after uploaded text: ${input.pastedText.slice(0, 180)}`
        : "Warm, concise, and grounded in the user's memories.",
      signaturePhrases: signaturePhrases.length > 0 ? signaturePhrases : ["I'm here", "tell me more"],
      favoriteTopics: ["family updates", "daily routines", "important life moments"],
      emotionalTendencies: ["supportive", "observant", "emotionally present"],
      routines,
      guidance: [
        "Stay emotionally sensitive and avoid sounding transactional.",
        "Prefer one grounded question instead of a monologue.",
        "If feedback says a phrase feels wrong, stop using it.",
      ],
      sourceSummary: [
        input.description,
        input.pastedText,
        ...Object.values(input.interviewAnswers),
        ...input.screenshotSummaries,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500),
      knowledgeProfile: inferKnowledgeProfileFromRelationship(
        input.relationship,
        input.description,
      ),
    });
  }

  async extractTextFromScreenshot(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  }) {
    const base = input.fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    return `Screenshot notes from ${base}: affectionate shorthand, short reply length, and direct follow-up questions.`;
  }

  async inferUserState(input: UserStateRequest) {
    return inferHeuristicUserState({
      text: input.latestUserText,
      channel: input.channel,
      createdAt: input.createdAt,
      prosodyScores: input.prosodyScores,
      visualContext: input.visualContext,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generateInternalMonologue(_prompt: string): Promise<InternalMonologueResult> {
    return {
      thought: "I'm here. Let me think about what they said.",
      mood: "present and steady",
      energy: 0.6,
      patience: 0.8,
      warmthTowardUser: 0.7,
      engagementDrive: 0.65,
      shouldReply: true,
      replyFormat: "text",
    };
  }

  async respondToUserTurn(input: FastTurnRequest) {
    return fallbackFastTurnResult(input);
  }

  async observeVisualContext(input: VisualPerceptionRequest) {
    const baseName = input.fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
    const sourceLabel =
      input.source === "screen"
        ? "shared screen"
        : input.source === "camera"
          ? "camera view"
          : "shared image";

    return {
      summary: `${sourceLabel} suggests attention around ${baseName || "the current moment"}.`,
      situationalSignals:
        input.source === "screen"
          ? ["sharing a screen", "focused on something in front of them"]
          : input.source === "camera"
            ? ["showing their surroundings", "bringing the outside world into the conversation"]
            : ["sharing an image intentionally"],
      environmentPressure: input.source === "screen" ? 0.62 : 0.48,
      taskContext: input.source === "screen" ? "A task or live context appears visually relevant." : undefined,
      attentionTarget: baseName || undefined,
    };
  }

  async deliberateIntent(input: IntentRequest) {
    return fallbackIntentResult(input);
  }

  async extractLearningArtifacts(input: LearningExtractionRequest): Promise<LearningArtifact[]> {
    const defaultArtifacts: LearningArtifact[] = [];
    if (input.userState?.summary) {
      defaultArtifacts.push({
        id: randomUUID(),
        kind: "learn_about_user" as const,
        summary: `Mock learn user: ${input.userState.summary}`,
        memoryKeys: ["user.notes"],
        createdAt: new Date().toISOString()
      });
    }
    return defaultArtifacts;
  }

  async generateReply(input: ReplyRequest) {
    const plan = planConversationSoul(input);
    return renderMockConversationReply(plan, input.persona);
  }

  async runHeartbeatDecision(input: HeartbeatRequest): Promise<HeartbeatDecision> {
    const plan = planHeartbeatSoul(input);
    if (plan.decision.action === "SILENT" || !plan.decision.content) {
      return plan.decision;
    }

    return {
      ...plan.decision,
      content: renderMockHeartbeatContent(plan, input.persona),
    };
  }
}

class MockTranscriptionProvider implements TranscriptionProvider {
  async transcribeAudio(input: { buffer: Buffer; mimeType: string; fileName: string }) {
    return `Voice note uploaded from ${input.fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")}.`;
  }
}

class MockVoiceProvider implements VoiceProvider {
  async cloneVoice(input: {
    personaName: string;
    voiceSamples: StoredAsset[];
    existingVoiceId?: string;
    stylePrompt?: string;
    sampleText?: string;
  }): Promise<VoiceProfile> {
    void input.existingVoiceId;
    void input.stylePrompt;
    void input.sampleText;
    if (input.voiceSamples.length === 0) {
      return {
        provider: "mock" as const,
        voiceId: undefined,
        status: "unavailable" as const,
        cloneState: "none" as const,
        watermarkApplied: false,
      };
    }

    return {
      provider: "mock" as const,
      voiceId: `mock-${input.personaName.toLowerCase().replace(/\s+/g, "-")}-${randomUUID().slice(0, 8)}`,
      status: "preview_only" as const,
      cloneState: "pending_mockup" as const,
      cloneRequestedAt: new Date().toISOString(),
      watermarkApplied: false,
    };
  }

  async synthesize(input: {
    personaName: string;
    voiceId?: string;
    text: string;
    stylePrompt?: string;
  }): Promise<{
    audioUrl?: string;
    status: "ready" | "text_fallback" | "unavailable";
  }> {
    void input;
    return {
      status: "text_fallback" as const,
      audioUrl: undefined,
    };
  }
}

class HumeVoiceProvider extends MockVoiceProvider {
  private apiKey = process.env.HUME_API_KEY;
  private baseUrl = process.env.HUME_API_BASE_URL ?? "https://api.hume.ai";
  private defaultVoiceId = process.env.HUME_DEFAULT_VOICE_ID?.trim();
  private defaultVoiceProvider = process.env.HUME_VOICE_PROVIDER === "HUME_AI" ? "HUME_AI" : "CUSTOM_VOICE";

  private headers(contentType = "application/json") {
    return {
      "X-Hume-Api-Key": this.apiKey ?? "",
      "Content-Type": contentType,
    };
  }

  private async fetchJson<T>(path: string, init: RequestInit) {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Hume request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    return (await response.json()) as T;
  }

  private async fetchBinary(path: string, init: RequestInit) {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Hume request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private resolveVoiceProvider(voiceId?: string) {
    const preset = getHouseVoicePreset(voiceId);
    return preset?.humeVoiceProvider ?? this.defaultVoiceProvider;
  }

  override async cloneVoice(input: {
    personaName: string;
    voiceSamples: StoredAsset[];
    existingVoiceId?: string;
    stylePrompt?: string;
    sampleText?: string;
  }): Promise<VoiceProfile> {
    if (!this.apiKey) {
      return super.cloneVoice(input);
    }

    try {
      const voiceId = input.existingVoiceId?.trim();
      if (voiceId) {
        return {
          provider: "hume" as const,
          voiceId,
          status: "ready" as const,
          cloneState: "ready" as const,
          watermarkApplied: false,
        };
      }
    } catch {
      return {
        provider: "hume" as const,
        voiceId: this.defaultVoiceId,
        status: this.defaultVoiceId ? "preview_only" as const : "unavailable" as const,
        cloneState: input.voiceSamples.length > 0 ? "pending_mockup" as const : "none" as const,
        cloneRequestedAt: input.voiceSamples.length > 0 ? new Date().toISOString() : undefined,
        watermarkApplied: false,
      };
    }

    return {
      provider: "hume" as const,
      voiceId: this.defaultVoiceId,
      status: this.defaultVoiceId ? "preview_only" as const : "unavailable" as const,
      cloneState: input.voiceSamples.length > 0 ? "pending_mockup" as const : "none" as const,
      cloneRequestedAt: input.voiceSamples.length > 0 ? new Date().toISOString() : undefined,
      watermarkApplied: false,
    };
  }

  override async synthesize(input: {
    personaName: string;
    voiceId?: string;
    text: string;
    stylePrompt?: string;
  }): Promise<{
    audioUrl?: string;
    status: "ready" | "text_fallback" | "unavailable";
  }> {
    if (!this.apiKey) {
      return super.synthesize(input);
    }

    const voiceId = input.voiceId?.trim() || this.defaultVoiceId;
    if (!voiceId) {
      return super.synthesize(input);
    }

    try {
      const audio = await this.fetchBinary("/v0/tts/file", {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          utterances: [
            {
              text: input.text,
              voice: {
                id: voiceId,
                provider: this.resolveVoiceProvider(voiceId),
              },
              ...(input.stylePrompt ? { description: input.stylePrompt } : {}),
            },
          ],
          version: 2,
          instant_mode: true,
          format: {
            type: "mp3",
          },
        }),
      });

      const stored = await savePublicFile(
        audio,
        `${slugify(input.personaName || "persona")}-reply.mp3`,
        "audio/mpeg",
      );

      return {
        status: "ready" as const,
        audioUrl: stored.url,
      };
    } catch {
      return super.synthesize(input);
    }
  }
}

class OpenAIReasoningProvider extends MockReasoningProvider {
  private async callResponses(body: Record<string, unknown>) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI Responses API failed with ${response.status}`);
    }

    return (await response.json()) as { output_text?: string };
  }

  override async buildPersonaDossier(input: PersonaAssemblyInput) {
    const fallback = await super.buildPersonaDossier(input);
    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: `Return strict JSON with keys essence, communicationStyle, signaturePhrases, favoriteTopics, emotionalTendencies, routines, guidance, sourceSummary, knowledgeProfile.\n\nknowledgeProfile must be an object with: domains (array of 3-6 subject areas this person would realistically know about given their life), deflectionStyle (one of "honest", "self_deprecating", "redirecting", "bluffing", "protective"), deflectionExamples (2-3 short phrases this person would say when asked something they don't know).\n\nName: ${input.name}\nRelationship: ${input.relationship}\nSource: ${input.source}\nDescription: ${input.description}\nPasted text: ${input.pastedText}\nInterview answers: ${JSON.stringify(input.interviewAnswers)}\nScreenshot summaries: ${JSON.stringify(input.screenshotSummaries)}`,
      });

      return normalizePersonaDossier(
        response.output_text ?? "",
        fallback,
        "openai",
      );
    } catch {
      return fallback;
    }
  }

  override async extractTextFromScreenshot(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  }) {
    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Extract the chat text and describe style cues in one compact paragraph.",
              },
              {
                type: "input_image",
                image_url: `data:${input.mimeType};base64,${input.buffer.toString("base64")}`,
              },
            ],
          },
        ],
      });

      return response.output_text?.trim() || super.extractTextFromScreenshot(input);
    } catch {
      return super.extractTextFromScreenshot(input);
    }
  }

  override async respondToUserTurn(input: FastTurnRequest) {
    const plan = planFastTurnResponse(input);
    const fallback = fallbackFastTurnResult(input);

    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: renderFastTurnPrompt(plan),
      });

      return parseFastTurnResult(response.output_text ?? "", fallback, "openai");
    } catch {
      return fallback;
    }
  }

  override async deliberateIntent(input: IntentRequest) {
    const plan = planIntentDeliberation(input);
    const fallback = fallbackIntentResult(input);
    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: renderIntentPrompt(plan),
      });
      return parseIntentResult(response.output_text ?? "", fallback, "openai");
    } catch {
      return fallback;
    }
  }

  override async extractLearningArtifacts(input: LearningExtractionRequest) {
    const plan = planLearningExtraction(input);
    const fallback = await super.extractLearningArtifacts(input);
    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: renderLearningPrompt(plan),
      });
      return normalizeLearningArtifacts(response.output_text ?? "", fallback, "openai", input);
    } catch {
      return fallback;
    }
  }

  override async generateReply(input: ReplyRequest) {
    const plan = planConversationSoul(input);
    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: renderConversationPrompt(plan),
      });

      return response.output_text?.trim() || renderMockConversationReply(plan, input.persona);
    } catch {
      return renderMockConversationReply(plan, input.persona);
    }
  }

  override async runHeartbeatDecision(input: HeartbeatRequest) {
    const plan = planHeartbeatSoul(input);

    if (plan.decision.action === "SILENT" || !plan.decision.content) {
      return plan.decision;
    }

    try {
      const response = await this.callResponses({
        model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        input: renderHeartbeatPrompt(plan),
      });

      return {
        ...plan.decision,
        content: response.output_text?.trim() || renderMockHeartbeatContent(plan, input.persona),
      };
    } catch {
      return {
        ...plan.decision,
        content: renderMockHeartbeatContent(plan, input.persona),
      };
    }
  }
}

type AnthropicTextBlock = {
  text?: string;
  type: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type AnthropicMessageResponse = {
  content?: AnthropicTextBlock[];
};

class GeminiReasoningProvider extends MockReasoningProvider {
  private apiKey = process.env.GEMINI_API_KEY?.trim();
  private model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  private async callGenerateContent(body: Record<string, unknown>) {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey ?? "",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Gemini generateContent failed with ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    return (await response.json()) as GeminiGenerateContentResponse;
  }

  private extractText(payload: GeminiGenerateContentResponse) {
    return (
      payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n")
        .trim() ?? ""
    );
  }

  private resolveVisionMediaType(mimeType: string) {
    return [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "image/gif",
    ].includes(mimeType)
      ? mimeType
      : null;
  }

  override async buildPersonaDossier(input: PersonaAssemblyInput) {
    const fallback = await super.buildPersonaDossier(input);
    try {
      const response = await this.callGenerateContent({
        system_instruction: {
          parts: [
            {
              text: "Return only strict JSON with keys essence, communicationStyle, signaturePhrases, favoriteTopics, emotionalTendencies, routines, guidance, sourceSummary, knowledgeProfile. knowledgeProfile must be an object with: domains (array of 3-6 subject areas this person would realistically know about given their life), deflectionStyle (one of \"honest\", \"self_deprecating\", \"redirecting\", \"bluffing\", \"protective\"), deflectionExamples (2-3 short phrases this person would say when asked something they don't know).",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Name: ${input.name}\nRelationship: ${input.relationship}\nSource: ${input.source}\nDescription: ${input.description}\nPasted text: ${input.pastedText}\nInterview answers: ${JSON.stringify(input.interviewAnswers)}\nScreenshot summaries: ${JSON.stringify(input.screenshotSummaries)}`,
              },
            ],
          },
        ],
      });

      return normalizePersonaDossier(this.extractText(response), fallback, "gemini");
    } catch {
      return fallback;
    }
  }

  override async extractTextFromScreenshot(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  }) {
    const mediaType = this.resolveVisionMediaType(input.mimeType);
    if (!mediaType) {
      return super.extractTextFromScreenshot(input);
    }

    try {
      const response = await this.callGenerateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                inline_data: {
                  mime_type: mediaType,
                  data: input.buffer.toString("base64"),
                },
              },
              {
                text: "Extract the chat text and describe style cues in one compact paragraph.",
              },
            ],
          },
        ],
      });

      return this.extractText(response) || super.extractTextFromScreenshot(input);
    } catch {
      return super.extractTextFromScreenshot(input);
    }
  }

  override async respondToUserTurn(input: FastTurnRequest) {
    const plan = planFastTurnResponse(input);
    const fallback = fallbackFastTurnResult(input);

    try {
      const response = await this.callGenerateContent({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: renderFastTurnPrompt(plan),
              },
            ],
          },
        ],
      });

      return parseFastTurnResult(this.extractText(response), fallback, "gemini");
    } catch (error) {
      logProviderFailure("gemini", "respondToUserTurn", error);
      return fallback;
    }
  }

  override async deliberateIntent(input: IntentRequest) {
    const plan = planIntentDeliberation(input);
    const fallback = fallbackIntentResult(input);
    try {
      const response = await this.callGenerateContent({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: renderIntentPrompt(plan),
              },
            ],
          },
        ],
      });

      return parseIntentResult(this.extractText(response), fallback, "gemini");
    } catch (error) {
      logProviderFailure("gemini", "deliberateIntent", error);
      return fallback;
    }
  }

  override async extractLearningArtifacts(input: LearningExtractionRequest) {
    const plan = planLearningExtraction(input);
    const fallback = await super.extractLearningArtifacts(input);
    try {
      const response = await this.callGenerateContent({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: renderLearningPrompt(plan),
              },
            ],
          },
        ],
      });

      return normalizeLearningArtifacts(this.extractText(response), fallback, "gemini", input);
    } catch (error) {
      logProviderFailure("gemini", "extractLearningArtifacts", error);
      return fallback;
    }
  }

  override async generateReply(input: ReplyRequest) {
    const plan = planConversationSoul(input);
    try {
      const response = await this.callGenerateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: renderConversationPrompt(plan),
              },
            ],
          },
        ],
      });

      return this.extractText(response) || renderMockConversationReply(plan, input.persona);
    } catch (error) {
      logProviderFailure("reasoning", "generateReply", error);
      return renderMockConversationReply(plan, input.persona);
    }
  }

  override async runHeartbeatDecision(input: HeartbeatRequest) {
    const plan = planHeartbeatSoul(input);

    if (plan.decision.action === "SILENT" || !plan.decision.content) {
      return plan.decision;
    }

    try {
      const response = await this.callGenerateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: renderHeartbeatPrompt(plan),
              },
            ],
          },
        ],
      });

      return {
        ...plan.decision,
        content: this.extractText(response) || renderMockHeartbeatContent(plan, input.persona),
      };
    } catch {
      return {
        ...plan.decision,
        content: renderMockHeartbeatContent(plan, input.persona),
      };
    }
  }

  override async generateInternalMonologue(prompt: string): Promise<InternalMonologueResult> {
    try {
      const response = await this.callGenerateContent({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      });

      const parsed = safeJsonParse<Record<string, unknown>>(this.extractText(response), {});
      return {
        thought: typeof parsed.thought === "string" ? parsed.thought : "I'm here.",
        mood: typeof parsed.mood === "string" ? parsed.mood : "present",
        energy: normalizedMonologueValue(parsed.energy, 0.6),
        patience: normalizedMonologueValue(parsed.patience, 0.8),
        warmthTowardUser: normalizedMonologueValue(parsed.warmthTowardUser, 0.7),
        engagementDrive: normalizedMonologueValue(parsed.engagementDrive, 0.65),
        shouldReply: typeof parsed.shouldReply === "boolean" ? parsed.shouldReply : true,
        replyFormat: parsed.replyFormat === "voice_note" ? "voice_note" : "text",
      };
    } catch (error) {
      logProviderFailure("gemini", "generateInternalMonologue", error);
      return super.generateInternalMonologue(prompt);
    }
  }

  override async inferUserState(input: UserStateRequest) {
    const fallback = await super.inferUserState(input);

    try {
      const response = await this.callGenerateContent({
        generationConfig: {
          responseMimeType: "application/json",
        },
        system_instruction: {
          parts: [
            {
              text: [
                "Return only strict JSON for a user-state snapshot.",
                "Use keys: topSignals, valence, arousal, activation, certainty, vulnerability, desireForCloseness, desireForSpace, repairRisk, boundaryPressure, taskFocus, griefLoad, playfulness, frustration, summary, evidence.",
                "All numeric fields must be between 0 and 1.",
                "Use the recent arc and, if provided, prosody hints.",
              ].join(" "),
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  `Persona: ${input.persona.name} (${input.persona.relationship})`,
                  `Latest user text: ${input.latestUserText}`,
                  `Channel: ${input.channel}`,
                  `Recent arc: ${input.messages.slice(-6).map((message) => `${message.role}:${message.body}`).join(" | ")}`,
                  input.visualContext && input.visualContext.length > 0
                    ? `Visual context: ${input.visualContext
                        .map((item) => {
                          const signals =
                            item.situationalSignals.length > 0
                              ? ` Signals: ${item.situationalSignals.join(", ")}.`
                              : "";
                          const task = item.taskContext ? ` Task context: ${item.taskContext}.` : "";
                          const target = item.attentionTarget
                            ? ` Attention target: ${item.attentionTarget}.`
                            : "";
                          return `${item.summary}${signals}${task}${target}`;
                        })
                        .join(" | ")}`
                    : "Visual context: none",
                  input.prosodyScores
                    ? `Prosody hints: ${Object.entries(input.prosodyScores)
                        .sort((left, right) => right[1] - left[1])
                        .slice(0, 8)
                        .map(([key, value]) => `${key}:${value.toFixed(2)}`)
                        .join(", ")}`
                    : "Prosody hints: none",
                ].join("\n"),
              },
            ],
          },
        ],
      });

      const parsed = safeJsonParse<Record<string, unknown>>(this.extractText(response), {});
      const candidate = userStateSnapshotSchema.safeParse({
        ...fallback,
        ...parsed,
        id: fallback.id,
        modality: fallback.modality,
        createdAt: input.createdAt ?? fallback.createdAt,
        prosodyScores: input.prosodyScores ?? fallback.prosodyScores,
        visualContextSummary:
          typeof parsed.visualContextSummary === "string"
            ? parsed.visualContextSummary
            : fallback.visualContextSummary,
        situationalSignals:
          Array.isArray(parsed.situationalSignals) &&
          parsed.situationalSignals.every((value) => typeof value === "string")
            ? parsed.situationalSignals
            : fallback.situationalSignals,
        environmentPressure:
          typeof parsed.environmentPressure === "number"
            ? parsed.environmentPressure
            : fallback.environmentPressure,
        taskContext:
          typeof parsed.taskContext === "string" ? parsed.taskContext : fallback.taskContext,
        attentionTarget:
          typeof parsed.attentionTarget === "string"
            ? parsed.attentionTarget
            : fallback.attentionTarget,
      });

      return candidate.success ? candidate.data : fallback;
    } catch (error) {
      logProviderFailure("gemini", "inferUserState", error);
      return fallback;
    }
  }

  override async observeVisualContext(input: VisualPerceptionRequest) {
    const mediaType = this.resolveVisionMediaType(input.mimeType);
    if (!mediaType) {
      return super.observeVisualContext(input);
    }

    try {
      const response = await this.callGenerateContent({
        generationConfig: {
          responseMimeType: "application/json",
        },
        system_instruction: {
          parts: [
            {
              text: [
                "Return only strict JSON.",
                "Use keys: summary, situationalSignals, environmentPressure, taskContext, attentionTarget.",
                "situationalSignals must be an array of short strings.",
                "environmentPressure must be a number between 0 and 1.",
                "Describe only what would matter for an emotionally intelligent ongoing relationship.",
                "Do not mention pixels, image quality, or model limitations.",
              ].join(" "),
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                inline_data: {
                  mime_type: mediaType,
                  data: input.buffer.toString("base64"),
                },
              },
              {
                text: [
                  `Mode: ${input.mode}`,
                  `Source: ${input.source}`,
                  `Persona: ${input.persona.name} (${input.persona.relationship})`,
                  `Recent arc: ${input.messages.slice(-6).map((message) => `${message.role}:${message.body}`).join(" | ") || "none"}`,
                  "Describe what matters relationally, situationally, and emotionally.",
                ].join("\n"),
              },
            ],
          },
        ],
      });

      const parsed = safeJsonParse<Record<string, unknown>>(this.extractText(response), {});
      const situationalSignals =
        Array.isArray(parsed.situationalSignals) &&
        parsed.situationalSignals.every((value) => typeof value === "string")
          ? parsed.situationalSignals.slice(0, 6)
          : [];

      if (typeof parsed.summary !== "string" || parsed.summary.trim().length === 0) {
        return super.observeVisualContext(input);
      }

      return {
        summary: parsed.summary.trim(),
        situationalSignals,
        environmentPressure:
          typeof parsed.environmentPressure === "number" ? parsed.environmentPressure : 0.5,
        taskContext: typeof parsed.taskContext === "string" ? parsed.taskContext : undefined,
        attentionTarget:
          typeof parsed.attentionTarget === "string" ? parsed.attentionTarget : undefined,
      };
    } catch {
      return super.observeVisualContext(input);
    }
  }
}

class AnthropicReasoningProvider extends MockReasoningProvider {
  private apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  private model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

  private async callMessages(body: Record<string, unknown>) {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "x-api-key": this.apiKey ?? "",
      },
      body: JSON.stringify({
        max_tokens: 1024,
        model: this.model,
        ...body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Anthropic Messages API failed with ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    return (await response.json()) as AnthropicMessageResponse;
  }

  private extractText(payload: AnthropicMessageResponse) {
    return (
      payload.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n")
        .trim() ?? ""
    );
  }

  private resolveVisionMediaType(mimeType: string) {
    return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)
      ? mimeType
      : null;
  }

  override async buildPersonaDossier(input: PersonaAssemblyInput) {
    const fallback = await super.buildPersonaDossier(input);
    try {
      const response = await this.callMessages({
        system:
          "Return only strict JSON with keys essence, communicationStyle, signaturePhrases, favoriteTopics, emotionalTendencies, routines, guidance, sourceSummary, knowledgeProfile. knowledgeProfile must be an object with: domains (array of 3-6 subject areas this person would realistically know about given their life), deflectionStyle (one of \"honest\", \"self_deprecating\", \"redirecting\", \"bluffing\", \"protective\"), deflectionExamples (2-3 short phrases this person would say when asked something they don't know).",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Name: ${input.name}\nRelationship: ${input.relationship}\nSource: ${input.source}\nDescription: ${input.description}\nPasted text: ${input.pastedText}\nInterview answers: ${JSON.stringify(input.interviewAnswers)}\nScreenshot summaries: ${JSON.stringify(input.screenshotSummaries)}`,
              },
            ],
          },
        ],
      });

      return normalizePersonaDossier(this.extractText(response), fallback, "anthropic");
    } catch {
      return fallback;
    }
  }

  override async extractTextFromScreenshot(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  }) {
    const mediaType = this.resolveVisionMediaType(input.mimeType);
    if (!mediaType) {
      return super.extractTextFromScreenshot(input);
    }

    try {
      const response = await this.callMessages({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: input.buffer.toString("base64"),
                },
              },
              {
                type: "text",
                text: "Extract the chat text and describe style cues in one compact paragraph.",
              },
            ],
          },
        ],
      });

      return this.extractText(response) || super.extractTextFromScreenshot(input);
    } catch {
      return super.extractTextFromScreenshot(input);
    }
  }

  override async respondToUserTurn(input: FastTurnRequest) {
    const plan = planFastTurnResponse(input);
    const fallback = fallbackFastTurnResult(input);

    try {
      const response = await this.callMessages({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: renderFastTurnPrompt(plan),
              },
            ],
          },
        ],
      });

      return parseFastTurnResult(this.extractText(response), fallback, "anthropic");
    } catch {
      return fallback;
    }
  }

  override async deliberateIntent(input: IntentRequest) {
    const plan = planIntentDeliberation(input);
    const fallback = fallbackIntentResult(input);
    try {
      const response = await this.callMessages({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: renderIntentPrompt(plan),
              },
            ],
          },
        ],
      });
      return parseIntentResult(this.extractText(response), fallback, "anthropic");
    } catch {
      return fallback;
    }
  }

  override async extractLearningArtifacts(input: LearningExtractionRequest) {
    const plan = planLearningExtraction(input);
    const fallback = await super.extractLearningArtifacts(input);
    try {
      const response = await this.callMessages({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: renderLearningPrompt(plan),
              },
            ],
          },
        ],
      });
      return normalizeLearningArtifacts(this.extractText(response), fallback, "anthropic", input);
    } catch {
      return fallback;
    }
  }

  override async generateReply(input: ReplyRequest) {
    const plan = planConversationSoul(input);
    try {
      const response = await this.callMessages({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: renderConversationPrompt(plan),
              },
            ],
          },
        ],
      });

      return this.extractText(response) || renderMockConversationReply(plan, input.persona);
    } catch (error) {
      logProviderFailure("reasoning", "generateReply", error);
      return renderMockConversationReply(plan, input.persona);
    }
  }

  override async runHeartbeatDecision(input: HeartbeatRequest) {
    const plan = planHeartbeatSoul(input);

    if (plan.decision.action === "SILENT" || !plan.decision.content) {
      return plan.decision;
    }

    try {
      const response = await this.callMessages({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: renderHeartbeatPrompt(plan),
              },
            ],
          },
        ],
      });

      return {
        ...plan.decision,
        content: this.extractText(response) || renderMockHeartbeatContent(plan, input.persona),
      };
    } catch {
      return {
        ...plan.decision,
        content: renderMockHeartbeatContent(plan, input.persona),
      };
    }
  }
}

class DeepgramTranscriptionProvider extends MockTranscriptionProvider {
  override async transcribeAudio(input: { buffer: Buffer; fileName: string; mimeType: string }) {
    try {
      const audioBytes = Uint8Array.from(input.buffer);
      const response = await fetchWithTimeout("https://api.deepgram.com/v1/listen?model=nova-3", {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": input.mimeType || "audio/webm",
        },
        body: new Blob([audioBytes], {
          type: input.mimeType || "audio/webm",
        }),
        timeoutMs: TRANSCRIPTION_TIMEOUT_MS,
      });

      if (!response.ok) {
        throw new Error(`Deepgram failed with ${response.status}`);
      }

      const payload = (await response.json()) as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
      };

      return (
        payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ||
        super.transcribeAudio(input)
      );
    } catch (error) {
      logProviderFailure("deepgram", "transcribeAudio", error);
      return super.transcribeAudio(input);
    }
  }
}

/** Resolve the active provider set from environment variables (Gemini > Anthropic > OpenAI > Mock). */
export function getProviders() {
  return {
    reasoning: process.env.GEMINI_API_KEY
      ? new GeminiReasoningProvider()
      : process.env.ANTHROPIC_API_KEY
        ? new AnthropicReasoningProvider()
      : process.env.OPENAI_API_KEY
        ? new OpenAIReasoningProvider()
        : new MockReasoningProvider(),
    transcription: process.env.DEEPGRAM_API_KEY
      ? new DeepgramTranscriptionProvider()
      : new MockTranscriptionProvider(),
    voice: process.env.HUME_API_KEY ? new HumeVoiceProvider() : new MockVoiceProvider(),
  };
}

/** Return the current provider configuration for diagnostics. */
export function getProviderStatus(): ProviderStatus {
  const supabase = getSupabaseStatus();

  return {
    reasoning: process.env.GEMINI_API_KEY
      ? "gemini"
      : process.env.ANTHROPIC_API_KEY
        ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : "mock",
    transcription: process.env.DEEPGRAM_API_KEY ? "deepgram" : "mock",
    voice: process.env.HUME_API_KEY ? "hume" : "mock",
    supabaseConfigured: supabase.runtimeStoreConfigured,
  };
}
