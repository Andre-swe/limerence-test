import { randomUUID } from "node:crypto";
import type {
  MemoryNote,
  MessageEntry,
  MindProcess,
  MindState,
  OpenLoop,
  PerceptionObservation,
  Persona,
  PersonalityConstitution,
  RelationshipMemory,
  RelationshipModel,
  UserStateSnapshot,
} from "@/lib/types";
import { getSoulProcessDefinition, scheduleSoulPerceptions } from "@/lib/soul-kernel";
import { addHours, truncate } from "@/lib/utils";

type PersonaMindLike = Pick<
  Persona,
  "name" | "relationship" | "description" | "dossier" | "heartbeatPolicy" | "preferenceSignals"
> & {
  source?: Persona["source"];
  personalityConstitution?: PersonalityConstitution;
  relationshipModel?: RelationshipModel;
  mindState?: MindState;
};

type ReflectionResult = {
  mindState: MindState;
  contextualUpdate?: string;
  userState?: UserStateSnapshot;
};

type OpenLoopTemplate = {
  title: string;
  match: RegExp;
  followUpPrompt: string;
  summary: string;
  keywords: string[];
  priority: OpenLoop["priority"];
  dueHint: string;
};

const completionPattern =
  /\b(got the job|went well|is over|it's over|its over|finished|done now|made it|i'm home now|im home now|i'm back|im back|landed|wrapped up)\b/i;

const openLoopTemplates: OpenLoopTemplate[] = [
  {
    title: "Interview follow-through",
    match: /\binterview\b/i,
    followUpPrompt: "how did the interview go?",
    summary: "Check back in after the interview once the moment has passed.",
    keywords: ["interview", "job"],
    priority: "high",
    dueHint: "after the interview",
  },
  {
    title: "Presentation follow-through",
    match: /\b(presentation|pitch|meeting)\b/i,
    followUpPrompt: "how did it go once you were in the room?",
    summary: "Circle back after the presentation or meeting is over.",
    keywords: ["presentation", "pitch", "meeting"],
    priority: "high",
    dueHint: "after the event",
  },
  {
    title: "Exam follow-through",
    match: /\b(exam|test|final)\b/i,
    followUpPrompt: "how did the exam land?",
    summary: "Check back in after the exam is done.",
    keywords: ["exam", "test", "final"],
    priority: "high",
    dueHint: "after the exam",
  },
  {
    title: "Appointment follow-through",
    match: /\b(appointment|doctor|therapy|dentist)\b/i,
    followUpPrompt: "how did the appointment go?",
    summary: "Check back in after the appointment.",
    keywords: ["appointment", "doctor", "therapy", "dentist"],
    priority: "medium",
    dueHint: "after the appointment",
  },
  {
    title: "Trip arrival follow-through",
    match: /\b(flight|trip|travel|drive)\b/i,
    followUpPrompt: "did you make it there alright?",
    summary: "Check back in after the trip or travel block.",
    keywords: ["flight", "trip", "travel", "drive"],
    priority: "medium",
    dueHint: "after they should have arrived",
  },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toDate(value: string) {
  return new Date(value);
}

function setHourWithFallback(iso: string, hour: number) {
  const date = toDate(iso);
  if (date.getHours() >= hour) {
    date.setDate(date.getDate() + 1);
  }
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function inferReadyAt(text: string, createdAt: string) {
  const lower = text.toLowerCase();
  const relativeHours = lower.match(/\bin (\d+) hours?\b/);
  if (relativeHours) {
    return addHours(createdAt, Number(relativeHours[1]) + 1);
  }

  if (/\bin an hour\b|\bin 1 hour\b/.test(lower)) {
    return addHours(createdAt, 2);
  }

  if (/\btomorrow morning\b/.test(lower)) {
    return setHourWithFallback(addHours(createdAt, 24), 11);
  }

  if (/\btomorrow\b/.test(lower)) {
    return setHourWithFallback(addHours(createdAt, 24), 17);
  }

  if (/\btonight\b|\bthis evening\b/.test(lower)) {
    return setHourWithFallback(createdAt, 21);
  }

  if (/\bthis afternoon\b/.test(lower)) {
    return setHourWithFallback(createdAt, 17);
  }

  if (/\blater\b|\bafter\b/.test(lower)) {
    return addHours(createdAt, 4);
  }

  return undefined;
}

function scoreWords(text: string, patterns: RegExp[], weight = 0.2) {
  return clamp(patterns.reduce((total, pattern) => total + (pattern.test(text) ? weight : 0), 0));
}

function summarizeTrait(value: number, low: string, mid: string, high: string) {
  if (value >= 0.67) {
    return high;
  }

  if (value <= 0.33) {
    return low;
  }

  return mid;
}

function topProsodySignals(scores?: Record<string, number>) {
  return Object.entries(scores ?? {})
    .filter(([, value]) => value > 0.12)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([key]) => key);
}

export function memoryNote(
  summary: string,
  createdAt: string,
  options?: {
    sourceMessageId?: string;
    sourceText?: string;
    weight?: number;
  },
): MemoryNote {
  return {
    id: randomUUID(),
    summary,
    sourceMessageId: options?.sourceMessageId,
    sourceText: options?.sourceText,
    weight: options?.weight ?? 3,
    createdAt,
    updatedAt: createdAt,
  };
}

export function mergeMemoryNotes<T extends { summary: string; updatedAt: string; weight?: number }>(
  existing: T[],
  next: T[],
  limit = 16,
) {
  const merged = [...existing];

  for (const candidate of next) {
    const duplicate = merged.find(
      (note) => note.summary.toLowerCase() === candidate.summary.toLowerCase(),
    );
    if (duplicate) {
      duplicate.updatedAt = candidate.updatedAt;
      if (typeof candidate.weight === "number" && typeof duplicate.weight === "number") {
        duplicate.weight = Math.min(5, Math.max(duplicate.weight, candidate.weight));
      }
      continue;
    }
    merged.unshift(candidate);
  }

  return merged.slice(0, limit);
}

function memorySummaryFor(text: string) {
  const lower = text.toLowerCase();

  if (/(while i('| a)?m at work|when i('| a)?m at work|during work)/.test(lower)) {
    return {
      kind: "boundary" as const,
      summary: "Weekday work hours should stay quiet unless the user reopens things later.",
    };
  }

  if (/(text me instead|just text me|don'?t send voice|no voice notes)/.test(lower)) {
    return {
      kind: "preference" as const,
      summary: "Text is safer than voice when the user is asking for space.",
    };
  }

  if (/(call me|i want to hear your voice|voice notes are fine)/.test(lower)) {
    return {
      kind: "preference" as const,
      summary: "Hearing the voice is welcome again when the moment feels right.",
    };
  }

  if (/(remember when|we used to|every morning|every night|always)/.test(lower)) {
    return {
      kind: "ritual" as const,
      summary: "Shared routines and remembered moments matter to this relationship.",
    };
  }

  if (/(got the job|interview|exam|presentation|appointment|trip|flight)/.test(lower)) {
    return {
      kind: "milestone" as const,
      summary: truncate(text, 140),
    };
  }

  if (/(i am|i'm|i feel|i have)/.test(lower)) {
    return {
      kind: "fact" as const,
      summary: truncate(text, 140),
    };
  }

  return null;
}

function reinforceMemory(
  memories: RelationshipMemory[],
  next: Omit<RelationshipMemory, "id" | "createdAt" | "lastReinforcedAt">,
  timestamp: string,
) {
  const existing = memories.find(
    (memory) => memory.kind === next.kind && memory.summary.toLowerCase() === next.summary.toLowerCase(),
  );

  if (!existing) {
    return [
      {
        ...next,
        id: randomUUID(),
        createdAt: timestamp,
        lastReinforcedAt: timestamp,
      },
      ...memories,
    ].slice(0, 12);
  }

  return memories.map((memory) =>
    memory.id === existing.id
      ? {
          ...memory,
          weight: Math.min(memory.weight + 1, 5),
          sourceText: next.sourceText,
          lastReinforcedAt: timestamp,
        }
      : memory,
  );
}

function maybeAddRelationshipMemory(memories: RelationshipMemory[], text: string, timestamp: string) {
  const extracted = memorySummaryFor(text);
  if (!extracted) {
    return memories;
  }

  return reinforceMemory(
    memories,
    {
      kind: extracted.kind,
      summary: extracted.summary,
      sourceText: text,
      weight: extracted.kind === "boundary" ? 5 : extracted.kind === "milestone" ? 4 : 3,
    },
    timestamp,
  );
}

function maybeCreateLoops(text: string, sourceMessageId: string, createdAt: string) {
  const lower = text.toLowerCase();
  if (!/(later|after|tomorrow|tonight|this afternoon|in an hour|in \d+ hours?|soon)/.test(lower)) {
    return [] as OpenLoop[];
  }

  return openLoopTemplates
    .filter((template) => template.match.test(text))
    .map((template) => ({
      id: sourceMessageId ? `loop-${sourceMessageId}-${template.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : randomUUID(),
      title: template.title,
      summary: template.summary,
      followUpPrompt: template.followUpPrompt,
      keywords: template.keywords,
      status: "open" as const,
      priority: template.priority,
      sourceText: text,
      sourceMessageId,
      dueHint: template.dueHint,
      readyAt: inferReadyAt(text, createdAt),
      createdAt,
      updatedAt: createdAt,
    }));
}

function mergeOpenLoops(existing: OpenLoop[], next: OpenLoop[]) {
  const merged = [...existing];

  for (const loop of next) {
    const duplicate = merged.find(
      (current) =>
        current.status === "open" &&
        current.title === loop.title &&
        current.sourceText.toLowerCase() === loop.sourceText.toLowerCase(),
    );

    if (!duplicate) {
      merged.unshift(loop);
    }
  }

  return merged.slice(0, 12);
}

function resolveOpenLoops(existing: OpenLoop[], text: string, timestamp: string) {
  const lower = text.toLowerCase();
  if (!completionPattern.test(lower)) {
    return existing;
  }

  return existing.map((loop) => {
    if (loop.status === "open" && loop.keywords.some((keyword) => lower.includes(keyword))) {
      return {
        ...loop,
        status: "resolved" as const,
        updatedAt: timestamp,
      };
    }

    return loop;
  });
}

function topOpenLoop(openLoops: OpenLoop[], now?: Date) {
  return openLoops
    .filter((loop) => {
      if (loop.status !== "open") {
        return false;
      }

      if (!now || !loop.readyAt) {
        return true;
      }

      return new Date(loop.readyAt) <= now;
    })
    .sort((left, right) => {
      const priorityScore = { high: 3, medium: 2, low: 1 };
      return priorityScore[right.priority] - priorityScore[left.priority];
    })[0];
}

function modalityForChannel(channel: MessageEntry["channel"]): UserStateSnapshot["modality"] {
  if (channel === "live") {
    return "live_voice";
  }

  if (channel === "heartbeat") {
    return "voice_note";
  }

  return "text";
}

function modalityForInput(input: {
  channel: MessageEntry["channel"];
  hasVisualContext: boolean;
  hasText: boolean;
}): UserStateSnapshot["modality"] {
  if (input.hasVisualContext && input.hasText) {
    return "multimodal";
  }

  if (input.hasVisualContext) {
    return input.channel === "live" ? "multimodal" : "image";
  }

  return modalityForChannel(input.channel);
}

function summaryFromSignals(signals: string[]) {
  if (signals.length === 0) {
    return "Open and conversational, with no strong pressure yet.";
  }

  if (signals.length === 1) {
    return `${signals[0][0]?.toUpperCase() ?? ""}${signals[0].slice(1)}.`;
  }

  return `${signals[0][0]?.toUpperCase() ?? ""}${signals[0].slice(1)}, with ${signals
    .slice(1, 3)
    .join(" and ")}.`;
}

function determineRepairRisk(text: string, prosodySignals: string[]) {
  const lower = text.toLowerCase();
  let score = scoreWords(lower, [
    /\bwrong\b/,
    /\boff\b/,
    /you wouldn'?t say that/,
    /that doesn'?t sound like/,
    /not right/,
  ]);

  if (prosodySignals.includes("anger")) {
    score += 0.22;
  }

  if (prosodySignals.includes("distress")) {
    score += 0.16;
  }

  return clamp(score);
}

/**
 * Infer a user emotional state from text, prosody, and visual context using
 * heuristic scoring. Blends keyword detection, prosody signals, and visual
 * cues into a normalized UserStateSnapshot. Used as fallback when Gemini
 * inference is unavailable or as a fast pre-pass.
 */
export function inferHeuristicUserState(input: {
  text: string;
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
}): UserStateSnapshot {
  const lower = input.text.toLowerCase();
  const visualContext = input.visualContext ?? [];
  const visualContextSummary = visualContext.map((item) => item.summary).join(" ").trim();
  const situationalSignals = Array.from(
    new Set(visualContext.flatMap((item) => item.situationalSignals)),
  ).slice(0, 8);
  const environmentPressure = clamp(
    visualContext.length > 0
      ? average(visualContext.map((item) => item.environmentPressure))
      : 0.5,
  );
  const taskContext = visualContext
    .map((item) => item.taskContext)
    .find((value): value is string => Boolean(value));
  const attentionTarget = visualContext
    .map((item) => item.attentionTarget)
    .find((value): value is string => Boolean(value));
  const prosodySignals = topProsodySignals(input.prosodyScores);
  const positiveProsody = average(
    ["joy", "love", "contentment", "satisfaction", "pride", "relief", "excitement", "amusement"].map(
      (key) => input.prosodyScores?.[key] ?? 0,
    ),
  );
  const negativeProsody = average(
    ["sadness", "distress", "anxiety", "anger", "pain", "fear", "tiredness", "guilt"].map(
      (key) => input.prosodyScores?.[key] ?? 0,
    ),
  );
  const activationProsody = average(
    ["determination", "concentration", "interest", "excitement", "anxiety"].map(
      (key) => input.prosodyScores?.[key] ?? 0,
    ),
  );

  const positiveText = scoreWords(lower, [
    /\bgood news\b/,
    /\bgreat news\b/,
    /\bgot the job\b/,
    /\bexcited\b/,
    /\bhappy\b/,
    /\bproud\b/,
    /\blove\b/,
  ]);
  const negativeText = scoreWords(lower, [
    /\bnervous\b/,
    /\banxious\b/,
    /\boverwhelmed\b/,
    /\bsad\b/,
    /\blonely\b/,
    /\bgrief\b/,
    /\bmiss\b/,
    /\bupset\b/,
    /\bangry\b/,
    /\bfrustrated\b/,
    /\btired\b/,
    /\bscared\b/,
  ]);
  const taskFocus = clamp(
    scoreWords(lower, [
      /\binterview\b/,
      /\bexam\b/,
      /\btest\b/,
      /\bmeeting\b/,
      /\bpresentation\b/,
      /\bappointment\b/,
      /\bdoctor\b/,
      /\bneed to\b/,
      /\bshould\b/,
      /\btrying to\b/,
    ]) +
      scoreWords(visualContextSummary.toLowerCase(), [
        /\bcalendar\b/,
        /\bemail\b/,
        /\bmeeting\b/,
        /\bdocument\b/,
        /\bdeadline\b/,
        /\binterview\b/,
        /\bwork\b/,
      ], 0.12) +
      activationProsody * 0.25,
  );
  const vulnerability = clamp(
    scoreWords(lower, [
      /\bnervous\b/,
      /\banxious\b/,
      /\bscared\b/,
      /\bsad\b/,
      /\blonely\b/,
      /\bmiss\b/,
      /\bheavy\b/,
      /\bgrief\b/,
      /\bneed you\b/,
    ]) +
      average([
        input.prosodyScores?.sadness ?? 0,
        input.prosodyScores?.distress ?? 0,
        input.prosodyScores?.anxiety ?? 0,
        input.prosodyScores?.empathicPain ?? 0,
      ]) *
        0.45,
  );
  const desireForCloseness = clamp(
    scoreWords(lower, [
      /\bi miss\b/,
      /\bcan you stay\b/,
      /\bi need you\b/,
      /\btalk to me\b/,
      /\bi love you\b/,
      /\bcall me\b/,
      /\bhear your voice\b/,
    ]) +
      average([
        input.prosodyScores?.love ?? 0,
        input.prosodyScores?.nostalgia ?? 0,
        input.prosodyScores?.sympathy ?? 0,
      ]) *
        0.4,
  );
  const desireForSpace = clamp(
    scoreWords(lower, [
      /don'?t text me/,
      /\bgive me space\b/,
      /\bback off\b/,
      /\bleave me alone\b/,
      /\bnot now\b/,
      /\btoo much\b/,
      /\bless often\b/,
    ]) +
      (input.prosodyScores?.contempt ?? 0) * 0.2,
  );
  const boundaryPressure = clamp(
    scoreWords(lower, [
      /don'?t text me/,
      /while i('| a)?m at work/,
      /\bjust text me\b/,
      /\bno voice notes\b/,
      /\bless often\b/,
      /\bmore often\b/,
    ]) + desireForSpace * 0.35,
  );
  const griefLoad = clamp(
    scoreWords(lower, [
      /\bgrief\b/,
      /\bgrieving\b/,
      /\bmiss\b/,
      /\bnostalgic\b/,
      /\bremember when\b/,
      /\bwe used to\b/,
      /\bheavy\b/,
    ]) +
      average([
        input.prosodyScores?.nostalgia ?? 0,
        input.prosodyScores?.sadness ?? 0,
        input.prosodyScores?.empathicPain ?? 0,
      ]) *
        0.45,
  );
  const frustration = clamp(
    scoreWords(lower, [
      /\bfrustrated\b/,
      /\bangry\b/,
      /\bmad\b/,
      /\bannoyed\b/,
      /\bupset\b/,
      /\bseriously\b/,
    ]) +
      average([
        input.prosodyScores?.anger ?? 0,
        input.prosodyScores?.distress ?? 0,
        input.prosodyScores?.disappointment ?? 0,
      ]) *
        0.5 +
      environmentPressure * 0.08,
  );
  const playfulness = clamp(
    scoreWords(lower, [/\blol\b/, /\blmao\b/, /\bhaha\b/, /\bteasing\b/, /\bjk\b/], 0.18) +
      average([
        input.prosodyScores?.amusement ?? 0,
        input.prosodyScores?.joy ?? 0,
      ]) *
        0.4,
  );
  const certainty = clamp(
    scoreWords(lower, [/\bi know\b/, /\bdefinitely\b/, /\bfor sure\b/, /\bgo ahead\b/], 0.16) +
      average([
        input.prosodyScores?.determination ?? 0,
        input.prosodyScores?.concentration ?? 0,
      ]) *
        0.45,
  );
  const arousal = clamp(
    0.22 + positiveProsody * 0.28 + negativeProsody * 0.36 + activationProsody * 0.25 + environmentPressure * 0.08,
  );
  const activation = clamp(taskFocus * 0.5 + activationProsody * 0.35 + certainty * 0.15);
  const valence = clamp(0.5 + positiveProsody * 0.32 + positiveText * 0.28 - negativeProsody * 0.38 - negativeText * 0.28);
  const repairRisk = determineRepairRisk(lower, prosodySignals);

  const topSignals = [
    visualContextSummary ? "bringing visual context into the conversation" : null,
    environmentPressure >= 0.62 ? "moving through a pressured environment" : null,
    griefLoad > 0.6 ? "carrying grief or nostalgia" : null,
    boundaryPressure > 0.65 ? "setting a boundary" : null,
    repairRisk > 0.6 ? "sensing mismatch" : null,
    frustration > 0.58 ? "frustrated or activated" : null,
    vulnerability > 0.64 ? "needing steadiness" : null,
    taskFocus > 0.6 ? "focused on a concrete event" : null,
    playfulness > 0.58 ? "keeping some play in the air" : null,
    desireForCloseness > 0.6 ? "wanting closeness" : null,
    desireForSpace > 0.58 ? "wanting more space" : null,
    valence > 0.62 && activation > 0.5 ? "carrying bright energy" : null,
    ...situationalSignals.map((signal) => `visual context suggests ${signal}`),
    ...prosodySignals.map((signal) => `prosody suggests ${signal}`),
  ].filter((value): value is string => Boolean(value));

  return {
    id: randomUUID(),
    modality: modalityForInput({
      channel: input.channel,
      hasVisualContext: visualContext.length > 0,
      hasText: Boolean(input.text.trim()),
    }),
    topSignals: Array.from(new Set(topSignals)).slice(0, 6),
    valence,
    arousal,
    activation,
    certainty,
    vulnerability,
    desireForCloseness,
    desireForSpace,
    repairRisk,
    boundaryPressure,
    taskFocus,
    griefLoad,
    playfulness,
    frustration,
    visualContextSummary: visualContextSummary || undefined,
    situationalSignals,
    environmentPressure,
    taskContext,
    attentionTarget,
    summary: summaryFromSignals(Array.from(new Set(topSignals)).slice(0, 3)),
    evidence: truncate([input.text, visualContextSummary].filter(Boolean).join(" ").trim(), 180),
    confidence: clamp(
      0.48 +
        (input.text.trim().length > 0 ? 0.12 : 0) +
        (visualContext.length > 0 ? 0.12 : 0) +
        (prosodySignals.length > 0 ? 0.12 : 0),
    ),
    provenance: Array.from(
      new Set([
        "heuristic" as const,
        ...(visualContext.length > 0 ? (["visual_perception"] as const) : []),
        ...(prosodySignals.length > 0 ? (["hume_prosody"] as const) : []),
      ]),
    ),
    prosodyScores: input.prosodyScores,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function deriveHumorType(fingerprint: string): PersonalityConstitution["humorType"] {
  if (/(sarcastic|dry humor|wry|lmao)/.test(fingerprint)) {
    return "dry";
  }
  if (/(playful|teasing|joking|funny)/.test(fingerprint)) {
    return "playful";
  }
  if (/(wry)/.test(fingerprint)) {
    return "wry";
  }
  if (/(restrained|serious|solemn)/.test(fingerprint)) {
    return "none";
  }
  return "earnest";
}

function defaultConstitutionForRelationship(relationship: string) {
  const lower = relationship.toLowerCase();

  if (/(mother|mom|father|dad|parent)/.test(lower)) {
    return {
      warmth: 0.82,
      directness: 0.6,
      initiative: 0.76,
      tenderness: 0.8,
      reserve: 0.32,
      rituality: 0.72,
      playfulness: 0.42,
      protectiveness: 0.84,
      selfDisclosure: 0.4,
      boundaryFirmness: 0.68,
      pushbackTendency: 0.56,
      emotionalIntensity: 0.74,
      patience: 0.7,
      affectionStyle: "protective" as const,
      conflictStyle: "protective" as const,
      repairStyle: "steady_reassurance" as const,
      speechCadence: "measured" as const,
    };
  }

  if (/(brother|sister|sibling|friend)/.test(lower)) {
    return {
      warmth: 0.6,
      directness: 0.68,
      initiative: 0.54,
      tenderness: 0.5,
      reserve: 0.48,
      rituality: 0.44,
      playfulness: 0.72,
      protectiveness: 0.58,
      selfDisclosure: 0.44,
      boundaryFirmness: 0.58,
      pushbackTendency: 0.6,
      emotionalIntensity: 0.48,
      patience: 0.56,
      affectionStyle: "playful" as const,
      conflictStyle: "teasing" as const,
      repairStyle: "playful_softening" as const,
      speechCadence: "brief" as const,
    };
  }

  if (/(partner|lover|wife|husband|girlfriend|boyfriend|ex)/.test(lower)) {
    return {
      warmth: 0.78,
      directness: 0.5,
      initiative: 0.6,
      tenderness: 0.84,
      reserve: 0.38,
      rituality: 0.58,
      playfulness: 0.46,
      protectiveness: 0.62,
      selfDisclosure: 0.72,
      boundaryFirmness: 0.42,
      pushbackTendency: 0.34,
      emotionalIntensity: 0.78,
      patience: 0.64,
      affectionStyle: "verbal" as const,
      conflictStyle: "measured" as const,
      repairStyle: "careful_listening" as const,
      speechCadence: "flowing" as const,
    };
  }

  return {
    warmth: 0.62,
    directness: 0.56,
    initiative: 0.5,
    tenderness: 0.56,
    reserve: 0.48,
    rituality: 0.44,
    playfulness: 0.42,
    protectiveness: 0.48,
    selfDisclosure: 0.48,
    boundaryFirmness: 0.5,
    pushbackTendency: 0.42,
    emotionalIntensity: 0.54,
    patience: 0.58,
    affectionStyle: "verbal" as const,
    conflictStyle: "measured" as const,
    repairStyle: "careful_listening" as const,
    speechCadence: "measured" as const,
  };
}

/** Derive a personality constitution from source material (description, texts, interview answers). */
export function createPersonalityConstitution(input: PersonaMindLike): PersonalityConstitution {
  if (input.personalityConstitution) {
    return input.personalityConstitution;
  }

  const fingerprint = [
    input.relationship,
    input.description,
    input.dossier.communicationStyle,
    input.dossier.essence,
    input.dossier.sourceSummary,
    ...input.dossier.emotionalTendencies,
    ...input.dossier.signaturePhrases,
    ...input.dossier.guidance,
  ]
    .join(" ")
    .toLowerCase();

  const base = defaultConstitutionForRelationship(input.relationship);
  const warmth = clamp(base.warmth + scoreWords(fingerprint, [/\bwarm\b/, /\baffectionate\b/, /\breassuring\b/, /\bkind\b/], 0.09) - scoreWords(fingerprint, [/\bcold\b/, /\bdetached\b/, /\bstoic\b/], 0.12));
  const directness = clamp(base.directness + scoreWords(fingerprint, [/\bdirect\b/, /\bbrief\b/, /\bshort\b/, /\bblunt\b/], 0.09) - scoreWords(fingerprint, [/\blyrical\b/, /\bsoft\b/, /\bgentle\b/], 0.07));
  const initiative = clamp(base.initiative + scoreWords(fingerprint, [/\bchecks in\b/, /\bfollows up\b/, /\bprotective\b/, /\binitiates\b/], 0.08));
  const tenderness = clamp(base.tenderness + scoreWords(fingerprint, [/\btender\b/, /\bgentle\b/, /\bsoft\b/, /\bloving\b/], 0.08));
  const reserve = clamp(base.reserve + scoreWords(fingerprint, [/\bguarded\b/, /\brestrained\b/, /\beconomical\b/, /\bbrief\b/], 0.09) - scoreWords(fingerprint, [/\bself-disclosing\b/, /\bemotional\b/], 0.08));
  const rituality = clamp(base.rituality + scoreWords(fingerprint, [/\bmorning\b/, /\bevery morning\b/, /\broutine\b/, /\britual\b/, /\bsign off\b/], 0.09));
  const playfulness = clamp(base.playfulness + scoreWords(fingerprint, [/\bteasing\b/, /\bplayful\b/, /\bsarcastic\b/, /\blmao\b/], 0.1));
  const protectiveness = clamp(base.protectiveness + scoreWords(fingerprint, [/\bprotective\b/, /\bproud\b/, /\bchecks in\b/, /\bcare\b/], 0.09));
  const selfDisclosure = clamp(base.selfDisclosure + scoreWords(fingerprint, [/\bopen\b/, /\bemotional\b/, /\bsharing\b/], 0.08) - scoreWords(fingerprint, [/\bguarded\b/, /\brestrained\b/], 0.07));
  const boundaryFirmness = clamp(base.boundaryFirmness + scoreWords(fingerprint, [/\bstubborn\b/, /\bprotective\b/, /\bdirect\b/], 0.08));
  const pushbackTendency = clamp(base.pushbackTendency + scoreWords(fingerprint, [/\bteasing\b/, /\bstubborn\b/, /\bsarcastic\b/, /\bprotective\b/], 0.08) - scoreWords(fingerprint, [/\bgentle\b/, /\bsoft\b/], 0.06));
  const emotionalIntensity = clamp(base.emotionalIntensity + scoreWords(fingerprint, [/\bemotional\b/, /\bintense\b/, /\bproud\b/, /\baffectionate\b/], 0.08) - scoreWords(fingerprint, [/\bstoic\b/, /\bflat\b/], 0.06));
  const patience = clamp(base.patience + scoreWords(fingerprint, [/\bsteady\b/, /\bpatient\b/, /\bcalm\b/, /\bgrounded\b/], 0.08));

  return {
    warmth,
    directness,
    humorType: deriveHumorType(fingerprint),
    initiative,
    volatility: clamp(scoreWords(fingerprint, [/\bvolatile\b/, /\bdramatic\b/, /\breactive\b/], 0.18) || base.emotionalIntensity * 0.35),
    tenderness,
    reserve,
    rituality,
    conflictStyle: base.conflictStyle,
    repairStyle: base.repairStyle,
    playfulness,
    protectiveness,
    selfDisclosure,
    speechCadence: /lyrical|poetic/.test(fingerprint)
      ? "lyrical"
      : /brief|short|clipped|lowercase/.test(fingerprint)
        ? "brief"
        : base.speechCadence,
    boundaryFirmness,
    pushbackTendency,
    emotionalIntensity,
    patience,
    affectionStyle: base.affectionStyle,
  };
}

/** Derive a relationship model from source material and personality constitution. */
export function createRelationshipModel(input: PersonaMindLike): RelationshipModel {
  if (input.relationshipModel) {
    return input.relationshipModel;
  }

  const lowerRelationship = input.relationship.toLowerCase();
  const preferenceModes = input.heartbeatPolicy.preferredMode === "voice_note"
    ? (["voice_note", "live_voice"] as const)
    : input.heartbeatPolicy.preferredMode === "text"
      ? (["text", "live_voice"] as const)
      : (["live_voice", "text", "voice_note"] as const);

  return {
    closeness: /(mother|mom|father|dad|partner|wife|husband|lover|best friend|brother|sister)/.test(
      lowerRelationship,
    )
      ? 0.8
      : 0.58,
    asymmetry: /(mother|mom|father|dad)/.test(lowerRelationship)
      ? "caretaking"
      : /(brother|sister|friend)/.test(lowerRelationship)
        ? "peer"
        : /(partner|wife|husband|lover|ex)/.test(lowerRelationship)
          ? "romantic"
          : "synthetic",
    sharedRituals: input.dossier.routines.slice(0, 4),
    frictionPatterns: input.preferenceSignals.slice(0, 3).map((signal) => signal.interpretation),
    favoriteModes: [...preferenceModes],
    acceptablePushback: /(mother|mom|father|dad|brother|sister)/.test(lowerRelationship)
      ? 0.62
      : /(friend|partner|lover|ex)/.test(lowerRelationship)
        ? 0.38
        : 0.3,
    repairExpectations: "If the voice lands wrong, repair quickly and return to the real person.",
    baselineTone: /(sarcastic|teasing)/.test(input.description.toLowerCase())
      ? "guarded warmth with some play"
      : "quiet but available",
    feltHistory: truncate(input.dossier.sourceSummary || input.description, 220),
  };
}

function routeSoulProcess(input: {
  persona: PersonaMindLike;
  latestUserText?: string;
  latestUserState?: UserStateSnapshot;
  openLoops: OpenLoop[];
  boundaryTriggered: boolean;
  channel?: MessageEntry["channel"];
}) {
  const constitution = createPersonalityConstitution(input.persona);
  const relationship = createRelationshipModel(input.persona);
  const state = input.latestUserState;
  const readyLoop = topOpenLoop(input.openLoops);

  if (!state && !input.latestUserText) {
    return "arrival" as const;
  }

  if (input.boundaryTriggered || (state?.boundaryPressure ?? 0) >= 0.62) {
    return "boundary_negotiation" as const;
  }

  if ((state?.repairRisk ?? 0) >= 0.6) {
    return "repair" as const;
  }

  if ((state?.desireForSpace ?? 0) >= 0.72) {
    return "silence_holding" as const;
  }

  if ((state?.griefLoad ?? 0) >= 0.66) {
    return constitution.tenderness >= 0.7 ? "grief_presence" : "attunement";
  }

  if (readyLoop && completionPattern.test(input.latestUserText ?? "")) {
    return "follow_through" as const;
  }

  if ((state?.valence ?? 0.5) >= 0.68 && (state?.activation ?? 0.5) >= 0.55) {
    return constitution.playfulness >= 0.68 ? "play" : "celebration";
  }

  if ((state?.vulnerability ?? 0.5) >= 0.64 || (state?.frustration ?? 0.5) >= 0.56) {
    if (constitution.protectiveness >= 0.72 && relationship.acceptablePushback >= 0.45) {
      return "protective_check_in" as const;
    }

    if (constitution.playfulness >= 0.68 && (state?.frustration ?? 0) < 0.45) {
      return "play" as const;
    }

    if (constitution.directness >= 0.72 && (state?.taskFocus ?? 0) >= 0.55) {
      return "practical_guidance" as const;
    }

    if (constitution.reserve >= 0.68 || (state?.desireForSpace ?? 0) >= 0.45) {
      return "attunement" as const;
    }

    return "comfort" as const;
  }

  if (readyLoop && (state?.taskFocus ?? 0) >= 0.48) {
    return "reengagement" as const;
  }

  if ((state?.desireForCloseness ?? 0.5) >= 0.6) {
    return constitution.playfulness >= 0.62 ? "play" : "attunement";
  }

  return input.channel === "live" ? ("attunement" as const) : ("arrival" as const);
}

function driveForProcess(input: {
  process: MindProcess;
  persona: PersonaMindLike;
  userState?: UserStateSnapshot;
  openLoops: OpenLoop[];
}) {
  const readyLoop = topOpenLoop(input.openLoops);
  const constitution = createPersonalityConstitution(input.persona);

  switch (input.process) {
    case "arrival":
      return "Arrive lightly and let the other person set the emotional altitude.";
    case "attunement":
      return constitution.reserve >= 0.65
        ? "Track the feeling carefully before filling the space."
        : "Meet the user where they are without collapsing into generic reassurance.";
    case "comfort":
      return "Lower the pressure and help the user feel held without sounding therapeutic.";
    case "celebration":
      return "Receive the good news in a way that feels shared and lived in.";
    case "play":
      return "Keep warmth alive through play without dodging what is true.";
    case "memory_recall":
      return "Stay inside the remembered scene long enough for it to feel inhabited.";
    case "repair":
      return "Repair mismatch fast and move back toward the real person.";
    case "boundary_negotiation":
      return "Show a brief pulse of personality if natural, then accept the limit completely.";
    case "follow_through":
      return readyLoop
        ? `Return to the thread "${readyLoop.followUpPrompt}" with continuity and timing.`
        : "Close the unfinished thread without sounding like a reminder app.";
    case "silence_holding":
      return "Reduce pressure and let the relationship prove it can stay nearby without speaking too much.";
    case "grief_presence":
      return "Be soft enough for grief and memory without trying to solve them away.";
    case "practical_guidance":
      return "Offer something concrete and usable while staying in character.";
    case "reengagement":
      return "Reopen the thread gently so the conversation feels continuous rather than reset.";
    case "protective_check_in":
      return "Lead with steadiness and care, with just enough firmness to feel protective rather than passive.";
  }
}

function needForProcess(process: MindProcess) {
  switch (process) {
    case "arrival":
      return "presence before agenda";
    case "attunement":
      return "to feel accurately met";
    case "comfort":
      return "steadiness without being smothered";
    case "celebration":
      return "warm recognition and one grounded follow-up";
    case "play":
      return "lightness that still keeps contact";
    case "memory_recall":
      return "company inside a remembered moment";
    case "repair":
      return "quick correction and realignment";
    case "boundary_negotiation":
      return "the boundary to be heard and then respected";
    case "follow_through":
      return "continuity on something that mattered earlier";
    case "silence_holding":
      return "space without abandonment";
    case "grief_presence":
      return "gentle company with no forced uplift";
    case "practical_guidance":
      return "one useful thing that reduces pressure";
    case "reengagement":
      return "a soft return to what still matters";
    case "protective_check_in":
      return "care that feels active, not vague";
  }
}

function emotionalWeatherFor(state: UserStateSnapshot | undefined, relationship: RelationshipModel) {
  if (!state) {
    return relationship.baselineTone;
  }

  if (state.griefLoad >= 0.66) {
    return "heavy with grief and memory";
  }

  if (state.boundaryPressure >= 0.62) {
    return "tense around a boundary";
  }

  if (state.repairRisk >= 0.6) {
    return "fragile around mismatch";
  }

  if (state.vulnerability >= 0.64) {
    return "tender and needing steadiness";
  }

  if (state.valence >= 0.68 && state.activation >= 0.55) {
    return "bright and rising";
  }

  if (state.taskFocus >= 0.58) {
    return "focused and leaning toward a concrete event";
  }

  return relationship.baselineTone;
}

function trendFromStates(states: UserStateSnapshot[]) {
  const recent = states.slice(-4);
  if (recent.length === 0) {
    return "No durable user-state trend yet.";
  }

  const avgValence = average(recent.map((state) => state.valence));
  const avgArousal = average(recent.map((state) => state.arousal));
  const avgCloseness = average(recent.map((state) => state.desireForCloseness));
  const avgSpace = average(recent.map((state) => state.desireForSpace));

  const tone =
    avgValence >= 0.6 ? "generally bright" : avgValence <= 0.4 ? "generally heavy" : "mixed";
  const energy =
    avgArousal >= 0.62 ? "with active energy" : avgArousal <= 0.38 ? "with quieter energy" : "with steady energy";
  const closeness =
    avgSpace > avgCloseness + 0.12
      ? "and asking for more room lately"
      : avgCloseness > avgSpace + 0.12
        ? "and leaning closer lately"
        : "and not strongly pushing for more or less closeness";

  return `${tone}, ${energy}, ${closeness}`;
}

function baselineFromStates(states: UserStateSnapshot[], relationship: RelationshipModel) {
  const recent = states.slice(-6);
  if (recent.length === 0) {
    return relationship.baselineTone;
  }

  const vulnerability = average(recent.map((state) => state.vulnerability));
  const playfulness = average(recent.map((state) => state.playfulness));
  const taskFocus = average(recent.map((state) => state.taskFocus));

  if (vulnerability >= 0.6) {
    return "the relationship tends to meet tender, exposed moments";
  }

  if (playfulness >= 0.58) {
    return "the relationship often carries play or teasing alongside contact";
  }

  if (taskFocus >= 0.58) {
    return "the relationship often orients around concrete events and follow-through";
  }

  return relationship.baselineTone;
}

function buildWorkingMemory(input: {
  persona: PersonaMindLike;
  messages: MessageEntry[];
  activeProcess: MindProcess;
  latestUserState?: UserStateSnapshot;
  openLoops: OpenLoop[];
}) {
  const relationship = createRelationshipModel(input.persona);
  const latestUserText =
    input.messages
      .slice()
      .reverse()
      .find((message) => message.role === "user")
      ?.body ?? "";
  const loop = topOpenLoop(input.openLoops);
  const currentFocus =
    loop?.summary ||
    input.latestUserState?.summary ||
    latestUserText ||
    input.persona.dossier.essence;
  const emotionalWeather = emotionalWeatherFor(input.latestUserState, relationship);
  const lastUserNeed = needForProcess(input.activeProcess);
  const summary = [
    `Stay with ${truncate(currentFocus, 150)}.`,
    `The emotional weather feels ${emotionalWeather}.`,
    loop
      ? `There is an open loop to remember: ${truncate(loop.followUpPrompt, 120)}`
      : "There is no urgent open loop pulling for follow-through.",
  ].join(" ");

  return {
    summary,
    currentFocus: truncate(currentFocus, 160),
    emotionalWeather,
    lastUserNeed,
    updatedAt: new Date().toISOString(),
  };
}

function regionNotesFromRelationshipMemories(memories: RelationshipMemory[], kind: RelationshipMemory["kind"]) {
  return memories
    .filter((memory) => memory.kind === kind)
    .map((memory) =>
      memoryNote(memory.summary, memory.createdAt, {
        sourceText: memory.sourceText,
        weight: memory.weight,
      }),
    );
}

function constitutionNotes(constitution: PersonalityConstitution, timestamp: string) {
  return [
    memoryNote(
      `Warmth is ${summarizeTrait(constitution.warmth, "restrained", "balanced", "high")}. Directness is ${summarizeTrait(
        constitution.directness,
        "soft",
        "measured",
        "plainspoken",
      )}.`,
      timestamp,
      { weight: 4 },
    ),
    memoryNote(
      `Humor tends ${constitution.humorType === "none" ? "toward seriousness" : `toward ${constitution.humorType}`}, with ${summarizeTrait(
        constitution.playfulness,
        "little play",
        "some play",
        "strong play",
      )}.`,
      timestamp,
      { weight: 3 },
    ),
    memoryNote(
      `Protectiveness is ${summarizeTrait(
        constitution.protectiveness,
        "light",
        "present",
        "strong",
      )}; affection tends ${constitution.affectionStyle}.`,
      timestamp,
      { weight: 4 },
    ),
  ];
}

function relationshipNotes(model: RelationshipModel, timestamp: string) {
  return [
    memoryNote(
      `Closeness feels ${summarizeTrait(model.closeness, "light", "steady", "close")} with an ${model.asymmetry} dynamic.`,
      timestamp,
      { weight: 4 },
    ),
    memoryNote(`Repair expectation: ${model.repairExpectations}`, timestamp, { weight: 4 }),
    ...(model.sharedRituals.length > 0
      ? [memoryNote(`Shared rituals: ${model.sharedRituals.join(", ")}`, timestamp, { weight: 3 })]
      : []),
  ];
}

function buildStateFromMessages(input: {
  persona: PersonaMindLike;
  messages: MessageEntry[];
  observations?: PerceptionObservation[];
  boundaryTriggered?: boolean;
  latestUserState?: UserStateSnapshot;
}) {
  const timestamp = input.messages.at(-1)?.createdAt ?? new Date().toISOString();
  const constitution = createPersonalityConstitution(input.persona);
  const relationship = createRelationshipModel(input.persona);

  let relationshipMemories: RelationshipMemory[] = input.persona.preferenceSignals
    .slice(0, 4)
    .map((signal) => ({
      id: signal.id,
      kind: signal.status === "negotiating" ? "boundary" : "preference",
      summary: signal.effectSummary,
      sourceText: signal.sourceText,
      weight: signal.status === "negotiating" ? 5 : 4,
      createdAt: signal.createdAt,
      lastReinforcedAt: signal.createdAt,
    }));
  let openLoops: OpenLoop[] = [];
  let recentUserStates: UserStateSnapshot[] = [];
  let episodicMemory: MemoryNote[] = [];
  let repairMemory: MemoryNote[] = [];
  let processMemory: MemoryNote[] = [];

  for (const message of input.messages) {
    episodicMemory = mergeMemoryNotes(
      episodicMemory,
      [
        memoryNote(
          `${message.role === "assistant" ? input.persona.name : "User"} (${message.channel}): ${truncate(message.body, 160)}`,
          message.createdAt,
          {
            sourceMessageId: message.id,
            sourceText: message.body,
            weight: message.channel === "live" ? 2 : 3,
          },
        ),
      ],
      18,
    );

    if (message.role === "user") {
      const userState =
        (input.latestUserState && message.id === input.messages.at(-1)?.id
          ? input.latestUserState
          : message.userState) ??
        inferHeuristicUserState({
          text: message.body,
          channel: message.channel,
          createdAt: message.createdAt,
          prosodyScores: message.metadata?.prosodyScores,
        });

      recentUserStates = [...recentUserStates, userState].slice(-8);
      relationshipMemories = maybeAddRelationshipMemory(
        relationshipMemories,
        message.body,
        message.createdAt,
      );
      openLoops = resolveOpenLoops(openLoops, message.body, message.createdAt);
      openLoops = mergeOpenLoops(openLoops, maybeCreateLoops(message.body, message.id, message.createdAt));

      if (userState.repairRisk >= 0.6) {
        repairMemory = mergeMemoryNotes(
          repairMemory,
          [
            memoryNote("A recent turn risked sounding wrong or false and may need repair.", message.createdAt, {
              sourceMessageId: message.id,
              sourceText: message.body,
              weight: 4,
            }),
          ],
          8,
        );
      }

      if (userState.boundaryPressure >= 0.62) {
        processMemory = mergeMemoryNotes(
          processMemory,
          [
            memoryNote("A live boundary is active and should remain in process memory.", message.createdAt, {
              sourceMessageId: message.id,
              sourceText: message.body,
              weight: 5,
            }),
          ],
          8,
        );
      }
    }
  }

  for (const observation of input.observations ?? []) {
    episodicMemory = mergeMemoryNotes(
      episodicMemory,
      [
        memoryNote(
          `Observed via ${observation.mode}: ${truncate(observation.summary, 160)}`,
          observation.createdAt,
          {
            sourceText: observation.summary,
            weight: observation.kind === "user_shared_image" ? 3 : 2,
          },
        ),
      ],
      18,
    );

    if (observation.userState) {
      recentUserStates = [...recentUserStates, observation.userState].slice(-8);
    }

    relationshipMemories = maybeAddRelationshipMemory(
      relationshipMemories,
      observation.summary,
      observation.createdAt,
    );

    if (observation.taskContext || /\b(interview|meeting|presentation|appointment|trip|flight|exam)\b/i.test(observation.summary)) {
      openLoops = mergeOpenLoops(
        openLoops,
        maybeCreateLoops(
          [observation.summary, observation.taskContext].filter(Boolean).join(" "),
          observation.sourceMessageId ?? observation.id,
          observation.createdAt,
        ),
      );
    }

    processMemory = mergeMemoryNotes(
      processMemory,
      [
        memoryNote(
          `Visual context: ${truncate(observation.summary, 160)}`,
          observation.createdAt,
          {
            sourceText: observation.summary,
            weight: observation.environmentPressure >= 0.62 ? 4 : 3,
          },
        ),
      ],
      8,
    );
  }

  const latestUserText =
    input.messages
      .slice()
      .reverse()
      .find((message) => message.role === "user")
      ?.body ?? "";
  const latestUserState = input.latestUserState ?? recentUserStates.at(-1);
  const activeProcess = routeSoulProcess({
    persona: input.persona,
    latestUserText,
    latestUserState,
    openLoops,
    boundaryTriggered: Boolean(input.boundaryTriggered),
    channel: input.messages.at(-1)?.channel,
  });
  const currentDrive = driveForProcess({
    process: activeProcess,
    persona: input.persona,
    userState: latestUserState,
    openLoops,
  });
  const unresolvedTension =
    latestUserState?.boundaryPressure && latestUserState.boundaryPressure >= 0.62
      ? "A boundary is active and must stay respected."
      : latestUserState?.repairRisk && latestUserState.repairRisk >= 0.6
        ? "The voice may need repair before moving forward."
        : topOpenLoop(openLoops)
          ? `There is a living thread around "${topOpenLoop(openLoops)?.title}".`
          : "No urgent unresolved tension.";
  const recentShift = latestUserState
    ? latestUserState.summary
    : "No recent user-state shift has been captured yet.";
  const recentTrend = trendFromStates(recentUserStates);
  const emotionalBaseline = baselineFromStates(recentUserStates, relationship);
  const scheduledPerceptions = scheduleSoulPerceptions({
    messages: input.messages,
    openLoops,
    activeProcess,
    latestUserState,
    personality: constitution,
    relationship,
    timestamp,
  });
  const processDefinition = getSoulProcessDefinition(activeProcess);
  const workingMemory = buildWorkingMemory({
    persona: input.persona,
    messages: input.messages,
    activeProcess,
    latestUserState,
    openLoops,
  });
  const scheduledNotes = scheduledPerceptions.slice(0, 4).map((perception) =>
    memoryNote(
      `${perception.summary} Ready at ${perception.readyAt}.`,
      perception.createdAt,
      {
        sourceText: perception.content,
        weight: perception.urgency === "urgent" ? 5 : perception.urgency === "ready" ? 4 : 3,
      },
    ),
  );

  return {
    activeProcess,
    currentProcessInstanceId: undefined,
    currentDrive,
    unresolvedTension,
    recentShift,
    emotionalBaseline,
    recentTrend,
    contextVersion: 1,
    liveDeliveryVersion: 1,
    lastLiveDeliveryReason: "session bootstrap",
    lastLiveDeliverySentAt: undefined,
    lastCoalescedLiveDeliveryVersion: undefined,
    traceVersion: 1,
    processState: {
      last_process: activeProcess,
      last_boundary_active:
        latestUserState?.boundaryPressure && latestUserState.boundaryPressure >= 0.62
          ? "true"
          : "false",
      last_summary: latestUserState?.summary ?? "",
      last_process_summary: processDefinition.summary,
      last_process_intensity: processDefinition.intensity,
    },
    processInstances: {},
    soulMemory: {},
    learningState: {
      userModelSummary: "",
      relationshipSummary: "",
      selfConsistencySummary: "",
      artifacts: [],
    },
    workingMemory,
    relationshipMemories,
    openLoops,
    scheduledPerceptions,
    pendingInternalEvents: [],
    pendingShadowTurns: [],
    lastUserState: latestUserState,
    recentUserStates,
    liveSessionMetrics: {},
    memoryRegions: {
      constitutionMemory: constitutionNotes(constitution, timestamp),
      relationshipMemory: relationshipMemories,
      episodicMemory,
      boundaryMemory: regionNotesFromRelationshipMemories(relationshipMemories, "boundary").concat(
        regionNotesFromRelationshipMemories(relationshipMemories, "preference"),
      ),
      repairMemory,
      ritualMemory: regionNotesFromRelationshipMemories(relationshipMemories, "ritual"),
      openLoopMemory: openLoops,
      learnedUserNotes: recentUserStates.slice(-3).map((state) =>
        memoryNote(`User state note: ${state.summary}`, state.createdAt, {
          sourceText: state.evidence,
          weight: 3,
        }),
      ),
      learnedRelationshipNotes: relationshipMemories.slice(0, 4).map((memory) =>
        memoryNote(`Relationship note: ${memory.summary}`, memory.createdAt, {
          sourceText: memory.sourceText,
          weight: memory.weight,
        }),
      ),
      processMemory: mergeMemoryNotes(
        [
          ...relationshipNotes(relationship, timestamp),
          memoryNote(
            `Active process ${activeProcess}: ${processDefinition.summary}`,
            timestamp,
            { weight: processDefinition.intensity === "high" ? 5 : 4 },
          ),
          memoryNote(`Default drive: ${processDefinition.defaultDrive}`, timestamp, {
            weight: 4,
          }),
          ...scheduledNotes,
        ],
        processMemory,
        12,
      ),
    },
    memoryClaims: [],
    claimSources: [],
    episodes: [],
    recentChangedClaims: [],
    lastRetrievalPack: undefined,
    internalState: {
      currentThought: "",
      mood: "present and steady",
      energy: 0.6,
      patience: 0.8,
      warmthTowardUser: 0.7,
      engagementDrive: 0.6,
      recentThoughts: [],
      updatedAt: timestamp,
    },
    recentEvents: [],
    traceHead: [],
    lastReflectionAt: timestamp,
  } satisfies MindState;
}

/** Build the initial mind state for a persona from messages, observations, and user state. */
export function createInitialMindState(input: {
  persona: PersonaMindLike;
  messages?: MessageEntry[];
  observations?: PerceptionObservation[];
  boundaryTriggered?: boolean;
  latestUserState?: UserStateSnapshot;
}) {
  return buildStateFromMessages({
    persona: input.persona,
    messages: input.messages ?? [],
    observations: input.observations,
    boundaryTriggered: input.boundaryTriggered,
    latestUserState: input.latestUserState,
  });
}

export function reflectMindState(input: {
  persona: PersonaMindLike;
  messages: MessageEntry[];
  observations?: PerceptionObservation[];
  latestMessage: MessageEntry;
  boundaryTriggered?: boolean;
  providedUserState?: UserStateSnapshot;
}): ReflectionResult {
  const messages = input.messages.map((message) =>
    message.id === input.latestMessage.id && input.providedUserState
      ? {
          ...message,
          userState: input.providedUserState,
        }
      : message,
  );

  const mindState = createInitialMindState({
    persona: input.persona,
    messages,
    observations: input.observations,
    boundaryTriggered: input.boundaryTriggered,
    latestUserState:
      input.latestMessage.role === "user" ? input.providedUserState : undefined,
  });

  return {
    mindState,
    userState: input.providedUserState,
    contextualUpdate:
      input.latestMessage.role === "user"
        ? renderMindContext({
            persona: {
              ...input.persona,
              personalityConstitution:
                input.persona.personalityConstitution ?? createPersonalityConstitution(input.persona),
              relationshipModel:
                input.persona.relationshipModel ?? createRelationshipModel(input.persona),
              mindState,
            },
            messages,
            feedbackNotes: [],
          })
        : undefined,
  };
}

export function renderMindContext(input: {
  persona: PersonaMindLike;
  messages: MessageEntry[];
  feedbackNotes: string[];
}) {
  const personalityConstitution =
    input.persona.personalityConstitution ?? createPersonalityConstitution(input.persona);
  const relationshipModel =
    input.persona.relationshipModel ?? createRelationshipModel(input.persona);
  const mindState =
    input.persona.mindState ??
    createInitialMindState({
      persona: {
        ...input.persona,
        personalityConstitution,
        relationshipModel,
      },
      messages: input.messages,
    });
  const recentTurns = input.messages.slice(-6).map((message) => {
    const speaker = message.role === "assistant" ? input.persona.name : "User";
    return `- ${speaker}: ${truncate(message.body, 180)}`;
  });
  const relationshipMemories = mindState.relationshipMemories
    .slice(0, 5)
    .map((memory) => `- (${memory.kind}) ${memory.summary}`)
    .join("\n");
  const openLoops = mindState.openLoops
    .slice(0, 5)
    .map((loop) => {
      const readiness = loop.readyAt ? ` Ready after: ${loop.readyAt}.` : "";
      return `- [${loop.status}] ${loop.title}: ${loop.followUpPrompt}.${readiness}`;
    })
    .join("\n");
  const scheduled = mindState.scheduledPerceptions
    .slice(0, 5)
    .map((perception) => `- [${perception.kind}] ${perception.summary} Ready at ${perception.readyAt}.`)
    .join("\n");
  const feedbackNotes =
    input.feedbackNotes.length > 0
      ? input.feedbackNotes.slice(-4).map((note) => `- ${truncate(note, 180)}`).join("\n")
      : "No correction notes yet.";

  return [
    `Soul state:\n- Active process: ${mindState.activeProcess}\n- Current drive: ${mindState.currentDrive}\n- Unresolved tension: ${mindState.unresolvedTension}\n- Recent shift: ${mindState.recentShift}\n- Emotional baseline: ${mindState.emotionalBaseline}\n- Recent trend: ${mindState.recentTrend}`,
    `Constitution:\n- Warmth ${personalityConstitution.warmth.toFixed(2)}\n- Directness ${personalityConstitution.directness.toFixed(2)}\n- Humor ${personalityConstitution.humorType}\n- Protectiveness ${personalityConstitution.protectiveness.toFixed(2)}\n- Playfulness ${personalityConstitution.playfulness.toFixed(2)}`,
    `Relationship model:\n- Closeness ${relationshipModel.closeness.toFixed(2)}\n- Asymmetry ${relationshipModel.asymmetry}\n- Acceptable pushback ${relationshipModel.acceptablePushback.toFixed(2)}\n- Baseline tone ${relationshipModel.baselineTone}`,
    `Working memory:\n- Current focus: ${mindState.workingMemory.currentFocus}\n- Emotional weather: ${mindState.workingMemory.emotionalWeather}\n- Last user need: ${mindState.workingMemory.lastUserNeed}\n- Summary: ${mindState.workingMemory.summary}`,
    `Relationship memories:\n${relationshipMemories || "No durable relationship memories yet."}`,
    `Open loops:\n${openLoops || "No active open loops yet."}`,
    `Scheduled internal events:\n${scheduled || "No internal events queued yet."}`,
    `Correction notes:\n${feedbackNotes}`,
    `Recent conversation:\n${recentTurns.join("\n") || "- No prior conversation yet."}`,
  ].join("\n\n");
}

export function getReadyOpenLoop(persona: Persona, now: Date) {
  return topOpenLoop(persona.mindState.openLoops, now) ?? null;
}
