import { randomUUID } from "node:crypto";
import type {
  AwakeningSchedule,
  ClaimSource,
  EpisodeRecord,
  FeedbackEvent,
  InternalScheduledEvent,
  LearningArtifact,
  MemoryClaim,
  MemoryClaimKind,
  MemoryClaimScope,
  MemoryClaimStatus,
  MessageEntry,
  Persona,
  UserStateSnapshot,
  MemoryRetrievalPack,
  ClaimWriteResult,
} from "@/lib/types";
import { truncate } from "@/lib/utils";

type ClaimCandidate = {
  kind: MemoryClaimKind;
  summary: string;
  detail?: string;
  scope?: MemoryClaimScope;
  status?: MemoryClaimStatus;
  confidence?: number;
  importance?: number;
  sourceIds?: string[];
  createdAt: string;
  sourceMessageId?: string;
  sourceObservationId?: string;
  sessionId?: string;
  feedbackEventId?: string;
  sourceType?: ClaimSource["sourceType"];
  excerpt?: string;
  tags?: string[];
};

type RetrievalInput = {
  persona: Persona;
  perception?: {
    id?: string;
    sessionId?: string;
    kind?: string;
    channel?: MessageEntry["channel"];
    content?: string;
  };
};

// Capacity limits — prevent unbounded growth in the persona JSONB blob.
const MAX_CLAIMS = 100;
const MAX_CLAIM_SOURCES = 100;
const MAX_EPISODES = 48;
const MAX_RECENT_CHANGED_CLAIMS = 12;

function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate weight score for a claim. Higher = more important to keep.
 * Combines importance, confidence, reinforcement count, and recency.
 */
function calculateClaimWeight(claim: MemoryClaim): number {
  const now = Date.now();
  const lastObserved = new Date(claim.lastObservedAt).getTime();
  const ageMs = now - lastObserved;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  
  // Recency decay: claims lose value over time (half-life of ~30 days)
  const recencyFactor = Math.exp(-ageDays / 30);
  
  // Reinforcement bonus: claims that are reinforced multiple times are more valuable
  const reinforcementBonus = Math.min(claim.reinforcementCount * 0.05, 0.25);
  
  // Base weight from importance and confidence
  const baseWeight = (claim.importance * 0.6) + (claim.confidence * 0.4);
  
  // Combine factors
  return (baseWeight + reinforcementBonus) * (0.5 + 0.5 * recencyFactor);
}

/**
 * Evict lowest-weight claims to stay within capacity limit.
 * Returns claims sorted by weight (highest first), capped at maxCount.
 */
function evictLowestWeightClaims(claims: MemoryClaim[], maxCount: number): MemoryClaim[] {
  if (claims.length <= maxCount) {
    return claims;
  }
  
  // Sort by weight descending (highest weight first)
  const sorted = [...claims].sort((a, b) => calculateClaimWeight(b) - calculateClaimWeight(a));
  
  return sorted.slice(0, maxCount);
}

/**
 * Evict oldest claim sources to stay within capacity limit.
 * Sources are evicted by creation date (oldest first).
 */
function evictOldestSources(sources: ClaimSource[], maxCount: number): ClaimSource[] {
  if (sources.length <= maxCount) {
    return sources;
  }
  
  // Sort by createdAt descending (newest first)
  const sorted = [...sources].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  return sorted.slice(0, maxCount);
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function summaryKey(kind: MemoryClaimKind, scope: MemoryClaimScope, summary: string) {
  return `${kind}:${scope}:${normalizeText(summary)}`;
}

function importanceForKind(kind: MemoryClaimKind) {
  switch (kind) {
    case "boundary":
      return 0.95;
    case "repair_note":
      return 0.9;
    case "ritual":
      return 0.8;
    case "open_loop_fact":
      return 0.78;
    case "relationship_note":
      return 0.75;
    case "preference":
      return 0.72;
    case "milestone":
      return 0.7;
    case "user_fact":
    default:
      return 0.62;
  }
}

function guessKindFromText(text: string, fallback: MemoryClaimKind) {
  const lower = text.toLowerCase();
  if (/(don'?t|do not|while i('| a)?m at work|need space|leave me alone|quiet hours|stop texting)/.test(lower)) {
    return "boundary";
  }
  if (/(prefer|like|hate|love|rather|text me|voice notes|call me)/.test(lower)) {
    return "preference";
  }
  if (/(always|every morning|every night|usually|before big meetings|when i('| a)?m)/.test(lower)) {
    return "ritual";
  }
  if (/(anniversary|birthday|interview|exam|trip|appointment|graduation|wedding)/.test(lower)) {
    return "milestone";
  }
  if (/(relationship|between us|you tend to|with you)/.test(lower)) {
    return "relationship_note";
  }
  return fallback;
}

function directUserStatementConfidence(text: string) {
  if (!text.trim()) {
    return 0.52;
  }
  const lower = text.toLowerCase();
  if (/^(i (am|have|hate|love|prefer|need|want|always|never|usually)|my )/.test(lower)) {
    return 0.82;
  }
  if (/(don'?t|do not|please stop|text me instead|call me|voice notes are fine)/.test(lower)) {
    return 0.9;
  }
  return 0.58;
}

function makeClaimSource(input: {
  claimId: string;
  createdAt: string;
  sourceType: ClaimSource["sourceType"];
  messageId?: string;
  observationId?: string;
  sessionId?: string;
  feedbackEventId?: string;
  excerpt?: string;
}) {
  return {
    id: randomUUID(),
    claimId: input.claimId,
    messageId: input.messageId,
    observationId: input.observationId,
    sessionId: input.sessionId,
    feedbackEventId: input.feedbackEventId,
    sourceType: input.sourceType,
    excerpt: input.excerpt ? truncate(input.excerpt, 240) : undefined,
    createdAt: input.createdAt,
  } satisfies ClaimSource;
}

function upsertClaim(input: {
  claims: MemoryClaim[];
  sources: ClaimSource[];
  candidate: ClaimCandidate;
}) {
  const claims = [...input.claims];
  const sources = [...input.sources];
  const scope = input.candidate.scope ?? "relationship";
  const key = summaryKey(input.candidate.kind, scope, input.candidate.summary);
  const existingIndex = claims.findIndex((claim) => summaryKey(claim.kind, claim.scope, claim.summary) === key);

  if (existingIndex === -1) {
    const claim: MemoryClaim = {
      id: randomUUID(),
      kind: input.candidate.kind,
      summary: truncate(input.candidate.summary, 240),
      detail: input.candidate.detail ? truncate(input.candidate.detail, 480) : undefined,
      scope,
      status: input.candidate.status ?? "tentative",
      confidence: clamp(input.candidate.confidence ?? 0.6),
      importance: clamp(input.candidate.importance ?? importanceForKind(input.candidate.kind)),
      sourceIds: unique(input.candidate.sourceIds ?? []),
      reinforcementCount: 1,
      firstObservedAt: input.candidate.createdAt,
      lastObservedAt: input.candidate.createdAt,
      lastConfirmedAt:
        (input.candidate.status ?? "tentative") === "confirmed"
          ? input.candidate.createdAt
          : undefined,
      lastUsedAt: undefined,
      expiresAt: undefined,
      tags: unique(input.candidate.tags ?? []),
    };

    sources.unshift(
      makeClaimSource({
        claimId: claim.id,
        createdAt: input.candidate.createdAt,
        sourceType: input.candidate.sourceType ?? "inference",
        messageId: input.candidate.sourceMessageId,
        observationId: input.candidate.sourceObservationId,
        sessionId: input.candidate.sessionId,
        feedbackEventId: input.candidate.feedbackEventId,
        excerpt: input.candidate.excerpt ?? input.candidate.detail ?? input.candidate.summary,
      }),
    );

    return {
      claims: evictLowestWeightClaims([claim, ...claims], MAX_CLAIMS),
      sources: evictOldestSources(sources, MAX_CLAIM_SOURCES),
      result: {
        claim,
        resolution: "created",
        changed: true,
      } satisfies ClaimWriteResult,
    };
  }

  const existing = claims[existingIndex];
  const nextStatus =
    existing.status === "contradicted"
      ? existing.status
      : input.candidate.status === "confirmed" || existing.status === "confirmed"
        ? "confirmed"
        : existing.status;
  const nextClaim: MemoryClaim = {
    ...existing,
    detail: input.candidate.detail
      ? truncate(input.candidate.detail, 480)
      : existing.detail,
    status: nextStatus,
    confidence: clamp(
      Math.max(
        existing.confidence,
        input.candidate.confidence ?? existing.confidence,
      ) + 0.05,
    ),
    importance: clamp(
      Math.max(existing.importance, input.candidate.importance ?? existing.importance),
    ),
    sourceIds: unique([...existing.sourceIds, ...(input.candidate.sourceIds ?? [])]),
    reinforcementCount: existing.reinforcementCount + 1,
    lastObservedAt: input.candidate.createdAt,
    lastConfirmedAt:
      nextStatus === "confirmed"
        ? input.candidate.createdAt
        : existing.lastConfirmedAt,
    tags: unique([...existing.tags, ...(input.candidate.tags ?? [])]),
  };
  claims[existingIndex] = nextClaim;

  sources.unshift(
    makeClaimSource({
      claimId: nextClaim.id,
      createdAt: input.candidate.createdAt,
      sourceType: input.candidate.sourceType ?? "inference",
      messageId: input.candidate.sourceMessageId,
      observationId: input.candidate.sourceObservationId,
      sessionId: input.candidate.sessionId,
      feedbackEventId: input.candidate.feedbackEventId,
      excerpt: input.candidate.excerpt ?? input.candidate.detail ?? input.candidate.summary,
    }),
  );

  return {
    claims: evictLowestWeightClaims(claims, MAX_CLAIMS),
    sources: evictOldestSources(sources, MAX_CLAIM_SOURCES),
    result: {
      claim: nextClaim,
      resolution:
        existing.status !== nextStatus && nextStatus === "confirmed"
          ? "confirmed"
          : "reinforced",
      changed: true,
    } satisfies ClaimWriteResult,
  };
}

/** Create a high-confidence boundary claim from an explicit user statement. */
export function buildConfirmedBoundaryClaim(input: {
  summary: string;
  detail?: string;
  createdAt: string;
  sourceMessageId?: string;
  sessionId?: string;
  sourceText?: string;
}) {
  return {
    kind: "boundary",
    summary: input.summary,
    detail: input.detail,
    scope: "relationship",
    status: "confirmed",
    confidence: 0.96,
    importance: 0.96,
    sourceIds: [input.sourceMessageId, input.sessionId].filter(Boolean) as string[],
    createdAt: input.createdAt,
    sourceMessageId: input.sourceMessageId,
    sessionId: input.sessionId,
    sourceType: "message",
    excerpt: input.sourceText ?? input.summary,
    tags: ["boundary", "explicit"],
  } satisfies ClaimCandidate;
}

/** Upsert a confirmed boundary claim and return updated claims + sources. */
export function applyBoundaryClaimUpdate(input: {
  claims: MemoryClaim[];
  claimSources: ClaimSource[];
  summary: string;
  detail?: string;
  createdAt: string;
  sourceMessageId?: string;
  sessionId?: string;
  sourceText?: string;
}) {
  return upsertClaim({
    claims: input.claims,
    sources: input.claimSources,
    candidate: buildConfirmedBoundaryClaim(input),
  });
}

/** Convert learning artifacts from a soul turn into durable memory claims and episodes. */
export function applyLearningArtifactsToMemoryClaims(input: {
  persona: Persona;
  artifacts: LearningArtifact[];
  userState?: UserStateSnapshot;
  latestUserText: string;
  perceptionChannel: MessageEntry["channel"];
  perceptionSessionId?: string;
}) {
  let claims = [...input.persona.mindState.memoryClaims];
  let claimSources = [...input.persona.mindState.claimSources];
  const episodes = [...input.persona.mindState.episodes];
  const changedResults: ClaimWriteResult[] = [];

  const claimCandidateForArtifact = (artifact: LearningArtifact): ClaimCandidate | null => {
    switch (artifact.kind) {
      case "learn_about_user":
        return {
          kind: guessKindFromText(
            `${artifact.summary} ${input.latestUserText}`,
            "user_fact",
          ),
          summary: artifact.summary,
          detail: artifact.effectSummary,
          status:
            directUserStatementConfidence(input.latestUserText) >= 0.8 ? "confirmed" : "tentative",
          confidence: directUserStatementConfidence(input.latestUserText),
          importance: 0.68,
          sourceIds: [artifact.sourcePerceptionId, artifact.sourceMessageId, ...artifact.memoryKeys].filter(
            Boolean,
          ) as string[],
          createdAt: artifact.createdAt,
          sourceMessageId: artifact.sourceMessageId,
          sessionId: input.perceptionSessionId,
          sourceType: artifact.sourceMessageId ? "message" : "inference",
          excerpt: input.latestUserText || artifact.summary,
          tags: tokenize(artifact.summary).slice(0, 6),
        };
      case "learn_about_relationship":
        return {
          kind: "relationship_note",
          summary: artifact.summary,
          detail: artifact.effectSummary,
          status: "tentative",
          confidence: 0.7,
          importance: 0.78,
          sourceIds: [artifact.sourcePerceptionId, artifact.sourceMessageId, ...artifact.memoryKeys].filter(
            Boolean,
          ) as string[],
          createdAt: artifact.createdAt,
          sourceMessageId: artifact.sourceMessageId,
          sessionId: input.perceptionSessionId,
          sourceType: "inference",
          excerpt: input.latestUserText || artifact.summary,
          tags: tokenize(artifact.summary).slice(0, 6),
        };
      case "repair_from_feedback":
        return {
          kind: "repair_note",
          summary: artifact.summary,
          detail: artifact.effectSummary,
          status: "confirmed",
          confidence: 0.92,
          importance: 0.9,
          sourceIds: [artifact.sourcePerceptionId, artifact.sourceMessageId, ...artifact.memoryKeys].filter(
            Boolean,
          ) as string[],
          createdAt: artifact.createdAt,
          sourceMessageId: artifact.sourceMessageId,
          sessionId: input.perceptionSessionId,
          sourceType: "feedback",
          excerpt: artifact.effectSummary ?? artifact.summary,
          tags: ["repair", ...tokenize(artifact.summary).slice(0, 4)],
        };
      case "update_open_loops":
        return {
          kind: "open_loop_fact",
          summary: artifact.summary,
          detail: artifact.effectSummary,
          status: "tentative",
          confidence: 0.72,
          importance: 0.76,
          sourceIds: [artifact.sourcePerceptionId, artifact.sourceMessageId, ...artifact.memoryKeys].filter(
            Boolean,
          ) as string[],
          createdAt: artifact.createdAt,
          sourceMessageId: artifact.sourceMessageId,
          sessionId: input.perceptionSessionId,
          sourceType: "inference",
          excerpt: input.latestUserText || artifact.summary,
          tags: ["open_loop", ...tokenize(artifact.summary).slice(0, 4)],
        };
      case "schedule_awakening": {
        const awakeningSchedule = inferAwakeningScheduleFromText(
          `${artifact.summary} ${artifact.effectSummary ?? ""}`,
        );
        if (!awakeningSchedule) return null;
        return {
          kind: "ritual",
          summary: artifact.summary,
          detail: artifact.effectSummary,
          status: "confirmed" as MemoryClaimStatus,
          confidence: 0.82,
          importance: 0.8,
          sourceIds: [artifact.sourcePerceptionId, artifact.sourceMessageId, ...artifact.memoryKeys].filter(
            Boolean,
          ) as string[],
          createdAt: artifact.createdAt,
          sourceMessageId: artifact.sourceMessageId,
          sessionId: input.perceptionSessionId,
          sourceType: "inference" as const,
          excerpt: artifact.summary,
          tags: ["awakening", awakeningSchedule.awakeningKind, ...tokenize(artifact.summary).slice(0, 4)],
        };
      }
      case "learn_about_self_consistency":
      case "consolidate_episode":
      default:
        return null;
    }
  };

  const pendingAwakeningEvents: InternalScheduledEvent[] = [];

  for (const artifact of input.artifacts) {
    const candidate = claimCandidateForArtifact(artifact);
    if (candidate) {
      const write = upsertClaim({ claims, sources: claimSources, candidate });
      claims = write.claims;
      claimSources = write.sources;
      changedResults.push(write.result);

      // For schedule_awakening artifacts, attach the awakeningSchedule and materialize event
      if (artifact.kind === "schedule_awakening") {
        const awakeningSchedule = inferAwakeningScheduleFromText(
          `${artifact.summary} ${artifact.effectSummary ?? ""}`,
        );
        if (awakeningSchedule) {
          const claimId = write.result.claim.id;
          claims = claims.map((c) =>
            c.id === claimId
              ? {
                  ...c,
                  kind: "ritual" as const,
                  awakeningSchedule: awakeningSchedule,
                  tags: [...new Set([...c.tags, "awakening", awakeningSchedule.awakeningKind, "scheduled"])],
                }
              : c,
          );
          const updatedClaim = claims.find((c) => c.id === claimId)!;
          const timezone = input.persona.timezone
            ? input.persona.timezone
            : "UTC";
          pendingAwakeningEvents.push(
            buildAwakeningInternalEvent(updatedClaim, timezone, new Date()),
          );
        }
      }
    }

    if (artifact.kind === "consolidate_episode") {
      const summaryKeyValue = normalizeText(artifact.summary);
      const existingIndex = episodes.findIndex(
        (episode) => normalizeText(episode.summary) === summaryKeyValue,
      );
      const nextEpisode: EpisodeRecord = {
        id: existingIndex >= 0 ? episodes[existingIndex].id : randomUUID(),
        sessionId: input.perceptionSessionId,
        channel: input.perceptionChannel,
        summary: truncate(artifact.summary, 240),
        participants: unique([input.persona.name, "user"]),
        keyPhrases: unique(tokenize(input.latestUserText).slice(0, 6)),
        affectiveArc: input.userState?.summary ?? "The emotional arc stayed mixed and relational.",
        sourceMessageIds: [artifact.sourceMessageId].filter(Boolean) as string[],
        sourceObservationIds: [artifact.sourcePerceptionId].filter(Boolean) as string[],
        createdAt: artifact.createdAt,
      };

      if (existingIndex >= 0) {
        episodes[existingIndex] = nextEpisode;
      } else {
        episodes.unshift(nextEpisode);
      }
    }
  }

  const changedClaims = changedResults.map((result) => result.claim).slice(0, MAX_RECENT_CHANGED_CLAIMS);

  return {
    claims: evictLowestWeightClaims(claims, MAX_CLAIMS),
    claimSources: evictOldestSources(claimSources, MAX_CLAIM_SOURCES),
    episodes: episodes.slice(0, MAX_EPISODES),
    changedClaims,
    writeResults: changedResults,
    pendingAwakeningEvents,
  };
}

/** Mark matching claims as contradicted and create a repair-note claim from user feedback. */
export function applyFeedbackToMemoryClaims(input: {
  claims: MemoryClaim[];
  claimSources: ClaimSource[];
  feedback: FeedbackEvent;
}) {
  const noteTokens = tokenize(input.feedback.note);
  let claims = [...input.claims];
  let claimSources = [...input.claimSources];
  const changedClaims: MemoryClaim[] = [];

  const matchesClaim = (claim: MemoryClaim) => {
    if (claim.sourceIds.includes(input.feedback.messageId)) {
      return true;
    }
    const haystack = normalizeText([claim.summary, claim.detail ?? "", ...claim.tags].join(" "));
    return noteTokens.filter((token) => haystack.includes(token)).length >= 2;
  };

  claims = claims.map((claim) => {
    if (!matchesClaim(claim) || claim.status === "contradicted") {
      return claim;
    }
    const contradicted: MemoryClaim = {
      ...claim,
      status: "contradicted",
      confidence: clamp(claim.confidence * 0.35),
      lastObservedAt: input.feedback.createdAt,
      tags: unique([...claim.tags, "contradicted"]),
    };
    changedClaims.push(contradicted);
    claimSources.unshift(
      makeClaimSource({
        claimId: claim.id,
        createdAt: input.feedback.createdAt,
        sourceType: "feedback",
        feedbackEventId: input.feedback.id,
        messageId: input.feedback.messageId,
        excerpt: input.feedback.note,
      }),
    );
    return contradicted;
  });

  const repairWrite = upsertClaim({
    claims,
    sources: claimSources,
    candidate: {
      kind: "repair_note",
      summary: `Avoid this mismatch: ${truncate(input.feedback.note, 160)}`,
      detail: input.feedback.note,
      scope: "relationship",
      status: "confirmed",
      confidence: 0.95,
      importance: 0.92,
      sourceIds: [input.feedback.id, input.feedback.messageId],
      createdAt: input.feedback.createdAt,
      sourceMessageId: input.feedback.messageId,
      feedbackEventId: input.feedback.id,
      sourceType: "feedback",
      excerpt: input.feedback.note,
      tags: ["repair", ...noteTokens.slice(0, 5)],
    },
  });

  claims = repairWrite.claims;
  claimSources = repairWrite.sources;
  changedClaims.unshift(repairWrite.result.claim);

  return {
    claims: evictLowestWeightClaims(claims, MAX_CLAIMS),
    claimSources: evictOldestSources(claimSources, MAX_CLAIM_SOURCES),
    changedClaims: changedClaims.slice(0, MAX_RECENT_CHANGED_CLAIMS),
  };
}

function claimRecencyScore(claim: MemoryClaim, now: Date) {
  const ageMs = Math.max(0, now.getTime() - new Date(claim.lastObservedAt).getTime());
  const days = ageMs / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - days / 30);
}

function claimStatusScore(status: MemoryClaimStatus) {
  switch (status) {
    case "confirmed":
      return 1;
    case "tentative":
      return 0.45;
    case "stale":
      return 0.12;
    case "contradicted":
    default:
      return -5;
  }
}

function processRelevanceBonus(claim: MemoryClaim, process: Persona["mindState"]["activeProcess"]) {
  if (process === "boundary_negotiation" && claim.kind === "boundary") {
    return 0.8;
  }
  if (process === "repair" && claim.kind === "repair_note") {
    return 0.7;
  }
  if (process === "memory_recall" && claim.kind === "milestone") {
    return 0.5;
  }
  if (process === "follow_through" && claim.kind === "open_loop_fact") {
    return 0.65;
  }
  return 0;
}

function topicRelevanceBonus(claim: MemoryClaim, topicTokens: string[]) {
  if (topicTokens.length === 0) {
    return 0;
  }
  const haystack = normalizeText([claim.summary, claim.detail ?? "", ...claim.tags].join(" "));
  const matches = topicTokens.filter((token) => haystack.includes(token)).length;
  return Math.min(matches * 0.18, 0.72);
}

function modalityBonus(claim: MemoryClaim, perceptionKind?: string) {
  if (!perceptionKind) {
    return 0;
  }
  if ((perceptionKind === "screen_observation" || perceptionKind === "camera_observation") && claim.kind === "ritual") {
    return 0.1;
  }
  if (perceptionKind === "feedback" && claim.kind === "repair_note") {
    return 0.3;
  }
  return 0;
}

/**
 * Build a retrieval pack: select the most relevant claims and episodes for the
 * current perception context. Returns always-loaded (high-importance confirmed)
 * claims, contextually scored claims, and topic-matched episodes.
 */
export function buildMemoryRetrievalPack(input: RetrievalInput) {
  const { persona } = input;
  const now = new Date();
  const claims =
    persona.mindState.memoryClaims.length > 0
      ? persona.mindState.memoryClaims
      : [
          ...persona.mindState.memoryRegions.boundaryMemory.map(
            (note) =>
              ({
                id: note.id,
                kind: "boundary",
                summary: note.summary,
                detail: note.sourceText,
                scope: "relationship",
                status: "confirmed",
                confidence: 0.9,
                importance: 0.92,
                sourceIds: [note.sourceMessageId].filter(Boolean) as string[],
                reinforcementCount: 1,
                firstObservedAt: note.createdAt,
                lastObservedAt: note.updatedAt,
                lastConfirmedAt: note.updatedAt,
                tags: tokenize(note.summary).slice(0, 5),
              }) satisfies MemoryClaim,
          ),
          ...persona.mindState.memoryRegions.ritualMemory.map(
            (note) =>
              ({
                id: note.id,
                kind: "ritual",
                summary: note.summary,
                detail: note.sourceText,
                scope: "relationship",
                status: "confirmed",
                confidence: 0.82,
                importance: 0.78,
                sourceIds: [note.sourceMessageId].filter(Boolean) as string[],
                reinforcementCount: 1,
                firstObservedAt: note.createdAt,
                lastObservedAt: note.updatedAt,
                lastConfirmedAt: note.updatedAt,
                tags: tokenize(note.summary).slice(0, 5),
              }) satisfies MemoryClaim,
          ),
          ...persona.mindState.memoryRegions.learnedRelationshipNotes.map(
            (note) =>
              ({
                id: note.id,
                kind: "relationship_note",
                summary: note.summary,
                detail: note.sourceText,
                scope: "relationship",
                status: "tentative",
                confidence: 0.68,
                importance: 0.72,
                sourceIds: [note.sourceMessageId].filter(Boolean) as string[],
                reinforcementCount: 1,
                firstObservedAt: note.createdAt,
                lastObservedAt: note.updatedAt,
                tags: tokenize(note.summary).slice(0, 5),
              }) satisfies MemoryClaim,
          ),
          ...persona.mindState.memoryRegions.learnedUserNotes.map(
            (note) =>
              ({
                id: note.id,
                kind: "user_fact",
                summary: note.summary,
                detail: note.sourceText,
                scope: "relationship",
                status: "tentative",
                confidence: 0.65,
                importance: 0.62,
                sourceIds: [note.sourceMessageId].filter(Boolean) as string[],
                reinforcementCount: 1,
                firstObservedAt: note.createdAt,
                lastObservedAt: note.updatedAt,
                tags: tokenize(note.summary).slice(0, 5),
              }) satisfies MemoryClaim,
          ),
          ...persona.mindState.memoryRegions.repairMemory.map(
            (note) =>
              ({
                id: note.id,
                kind: "repair_note",
                summary: note.summary,
                detail: note.sourceText,
                scope: "relationship",
                status: "confirmed",
                confidence: 0.88,
                importance: 0.9,
                sourceIds: [note.sourceMessageId].filter(Boolean) as string[],
                reinforcementCount: 1,
                firstObservedAt: note.createdAt,
                lastObservedAt: note.updatedAt,
                tags: ["repair", ...tokenize(note.summary).slice(0, 4)],
              }) satisfies MemoryClaim,
          ),
        ];

  const topicTokens = tokenize(
    [
      input.perception?.content ?? "",
      persona.mindState.lastUserState?.summary ?? "",
      persona.mindState.currentDrive,
    ].join(" "),
  ).slice(0, 10);

  const confirmedClaims = claims.filter(
    (claim) =>
      claim.status === "confirmed" &&
      ["relationship_note", "boundary", "ritual", "repair_note", "open_loop_fact", "preference"].includes(
        claim.kind,
      ),
  );
  // When no confirmed claims exist yet (new persona with only bootstrap memories),
  // promote tentative bootstrap claims so the persona has something to work with.
  const alwaysLoadedPool =
    confirmedClaims.length > 0
      ? confirmedClaims
      : claims.filter(
          (claim) =>
            claim.status === "tentative" &&
            claim.tags.includes("bootstrap"),
        );
  const alwaysLoadedClaims = alwaysLoadedPool
    .sort((left, right) => {
      const leftScore = left.importance + left.confidence + claimRecencyScore(left, now);
      const rightScore = right.importance + right.confidence + claimRecencyScore(right, now);
      return rightScore - leftScore;
    })
    .slice(0, 8);

  const contextualClaims = claims
    .filter((claim) => claim.status !== "contradicted" && claim.status !== "stale")
    .map((claim) => ({
      claim,
      score:
        claimStatusScore(claim.status) +
        claim.importance +
        claim.confidence +
        claimRecencyScore(claim, now) +
        processRelevanceBonus(claim, persona.mindState.activeProcess) +
        topicRelevanceBonus(claim, topicTokens) +
        modalityBonus(claim, input.perception?.kind),
    }))
    .filter(({ claim, score }) => score > 1.7 && !alwaysLoadedClaims.some((loaded) => loaded.id === claim.id))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map(({ claim }) => claim);

  const contextualEpisodes = persona.mindState.episodes
    .map((episode) => {
      const haystack = normalizeText([episode.summary, ...episode.keyPhrases].join(" "));
      const matches = topicTokens.filter((token) => haystack.includes(token)).length;
      const recency = claimRecencyScore(
        {
          id: episode.id,
          kind: "milestone",
          summary: episode.summary,
          scope: "relationship",
          status: "confirmed",
          confidence: 0.7,
          importance: 0.7,
          sourceIds: [...episode.sourceMessageIds, ...episode.sourceObservationIds],
          reinforcementCount: 1,
          firstObservedAt: episode.createdAt,
          lastObservedAt: episode.createdAt,
          lastConfirmedAt: episode.createdAt,
          tags: episode.keyPhrases,
        },
        now,
      );
      return {
        episode,
        score: matches * 0.25 + recency,
      };
    })
    .filter(({ score }) => score > 0.35)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ episode }) => episode);

  return {
    alwaysLoadedClaims,
    contextualClaims,
    contextualEpisodes,
    summary: [
      alwaysLoadedClaims.length > 0
        ? `${alwaysLoadedClaims.length} confirmed durable claims ready.`
        : "No confirmed durable claims yet.",
      contextualClaims.length > 0
        ? `${contextualClaims.length} context-matched claims retrieved.`
        : "No contextual claim retrieval.",
      contextualEpisodes.length > 0
        ? `${contextualEpisodes.length} remembered episodes retrieved.`
        : "No episode retrieval.",
    ].join(" "),
    builtAt: new Date().toISOString(),
    perceptionId: input.perception?.id,
  } satisfies MemoryRetrievalPack;
}

// ---------------------------------------------------------------------------
// Bootstrap claims — seed a new persona with tentative memories from source
// material so their first conversation feels like reunion, not blank slate.
// ---------------------------------------------------------------------------

type BootstrapInput = {
  dossier: Persona["dossier"];
  interviewAnswers: Record<string, string>;
  relationship: string;
  description: string;
  createdAt: string;
};

/** Seed tentative claims from source material so a new persona feels like a reunion. */
export function seedBootstrapClaims(input: BootstrapInput) {
  let claims: MemoryClaim[] = [];
  let sources: ClaimSource[] = [];

  const seed = (candidate: ClaimCandidate) => {
    const write = upsertClaim({ claims, sources, candidate });
    claims = write.claims;
    sources = write.sources;
  };

  // Relationship shape — from the description the creator gave
  if (input.description.trim()) {
    seed({
      kind: "relationship_note",
      summary: `Our relationship: ${truncate(input.description, 180)}`,
      scope: "relationship",
      status: "tentative",
      confidence: 0.62,
      importance: 0.78,
      createdAt: input.createdAt,
      sourceType: "bootstrap",
      excerpt: input.description,
      tags: ["bootstrap", "relationship"],
    });
  }

  // Routines — from the dossier
  for (const routine of input.dossier.routines.slice(0, 3)) {
    seed({
      kind: "ritual",
      summary: routine,
      scope: "relationship",
      status: "tentative",
      confidence: 0.58,
      importance: 0.72,
      createdAt: input.createdAt,
      sourceType: "bootstrap",
      excerpt: routine,
      tags: ["bootstrap", "ritual"],
    });
  }

  // Favorite topics — things we talk about
  for (const topic of input.dossier.favoriteTopics.slice(0, 4)) {
    seed({
      kind: "relationship_note",
      summary: `We often talk about ${topic}.`,
      scope: "relationship",
      status: "tentative",
      confidence: 0.55,
      importance: 0.6,
      createdAt: input.createdAt,
      sourceType: "bootstrap",
      excerpt: topic,
      tags: ["bootstrap", "topic"],
    });
  }

  // Interview answers — direct statements about the person
  for (const [question, answer] of Object.entries(input.interviewAnswers)) {
    if (!answer.trim() || answer.length < 8) continue;
    const kind = guessKindFromText(answer, "user_fact");
    seed({
      kind,
      summary: truncate(answer, 200),
      detail: question,
      scope: "relationship",
      status: "tentative",
      confidence: 0.65,
      importance: importanceForKind(kind) * 0.85,
      createdAt: input.createdAt,
      sourceType: "bootstrap",
      excerpt: answer,
      tags: ["bootstrap", "interview"],
    });
  }

  // Emotional tendencies — how this person shows up
  if (input.dossier.emotionalTendencies.length > 0) {
    seed({
      kind: "relationship_note",
      summary: `Emotionally: ${input.dossier.emotionalTendencies.join(", ")}.`,
      scope: "persona_self",
      status: "tentative",
      confidence: 0.6,
      importance: 0.68,
      createdAt: input.createdAt,
      sourceType: "bootstrap",
      excerpt: input.dossier.emotionalTendencies.join(", "),
      tags: ["bootstrap", "personality"],
    });
  }

  return { claims, sources };
}

/** Render a claim as a single line for inclusion in the soul harness context. */
export function renderClaimForContext(claim: MemoryClaim) {
  const prefix =
    claim.status === "confirmed"
      ? "confirmed"
      : claim.status === "tentative"
        ? "tentative"
        : claim.status;
  return `- [${prefix}/${claim.kind}] ${truncate(claim.summary, 180)}`;
}

/** Render an episode as a single line for inclusion in the soul harness context. */
export function renderEpisodeForContext(episode: EpisodeRecord) {
  return `- ${truncate(episode.summary, 180)}${episode.keyPhrases.length > 0 ? ` Key phrases: ${episode.keyPhrases.slice(0, 4).join(", ")}.` : ""}`;
}

// ---------------------------------------------------------------------------
// Ritual schedule inference — extract scheduling intent from natural language.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Timezone-aware date helpers.
// ---------------------------------------------------------------------------

function getLocalWeekday(date: Date, timezone: string): number {
  const dayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days.indexOf(dayStr);
}

function getLocalDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/**
 * Compute the timezone offset in ms for a given instant and timezone.
 * Recomputed per-date so DST transitions are handled correctly.
 */
function tzOffsetMs(date: Date, timezone: string): number {
  const local = getLocalDateParts(date, timezone);
  const utc = getLocalDateParts(date, "UTC");
  const localMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const utcMs = Date.UTC(utc.year, utc.month - 1, utc.day, utc.hour, utc.minute);
  return localMs - utcMs;
}

/**
 * Convert a local-timezone (year, month, day, hour, minute) to a UTC
 * timestamp, recomputing the DST offset for that specific date.
 */
function localToUtcMs(
  year: number, month: number, day: number,
  hour: number, minute: number,
  timezone: string,
): number {
  // Build a rough UTC estimate, then compute the offset AT that instant
  const roughUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMs(new Date(roughUtcMs), timezone);
  return roughUtcMs - offset;
}

/**
 * Compute the UTC readyAt for the next awakening occurrence.
 * Uses the persona's timezone for local-hour targeting and applies
 * bell-curve jitter (triangular distribution).
 *
 * DST-safe: the offset is recomputed for the candidate date, not the
 * current instant, so spring-forward / fall-back transitions are handled.
 *
 * For "once" recurrence, returns the exact target time without recurrence
 * loop — fires once at the specified hour.
 */
export function computeNextAwakeningReadyAt(input: {
  targetHour: number;
  jitterMinutes: number;
  recurrence: "daily" | "weekdays" | "weekends" | "once";
  timezone: string;
  now: Date;
}): string {
  // Triangular jitter: sum of 2 uniforms gives bell-curve bias toward center
  const u1 = Math.random();
  const u2 = Math.random();
  const jitterFraction = (u1 + u2) / 2 - 0.5; // range -0.5 to 0.5, biased toward 0
  const jitterMs = Math.round(jitterFraction * 2 * input.jitterMinutes * 60_000);

  // Get user's current local date
  const local = getLocalDateParts(input.now, input.timezone);

  // Build today's target in UTC (DST-safe: offset computed for the target date)
  let candidateMs = localToUtcMs(
    local.year, local.month, local.day,
    input.targetHour, 0, input.timezone,
  ) + jitterMs;

  // If already past, advance to tomorrow
  if (candidateMs <= input.now.getTime()) {
    // Recompute for tomorrow to get the correct DST offset
    const tomorrow = new Date(input.now.getTime() + 86_400_000);
    const tomorrowLocal = getLocalDateParts(tomorrow, input.timezone);
    candidateMs = localToUtcMs(
      tomorrowLocal.year, tomorrowLocal.month, tomorrowLocal.day,
      input.targetHour, 0, input.timezone,
    ) + jitterMs;
  }

  // Advance to match recurrence (up to 7 days), recomputing offset each day
  for (let i = 0; i < 7; i++) {
    const candidate = new Date(candidateMs);
    const weekday = getLocalWeekday(candidate, input.timezone);
    const isWeekend = weekday === 0 || weekday === 6;

    if (input.recurrence === "once" || input.recurrence === "daily") break;
    if (input.recurrence === "weekdays" && !isWeekend) break;
    if (input.recurrence === "weekends" && isWeekend) break;

    // Advance one day and recompute with correct DST offset
    const nextDay = new Date(candidateMs + 86_400_000);
    const nextLocal = getLocalDateParts(nextDay, input.timezone);
    candidateMs = localToUtcMs(
      nextLocal.year, nextLocal.month, nextLocal.day,
      input.targetHour, 0, input.timezone,
    ) + jitterMs;
  }

  return new Date(candidateMs).toISOString();
}


/**
 * Build an InternalScheduledEvent for the next awakening occurrence.
 * The event fires through the normal internal-event pipeline and carries
 * the awakeningClaimId in perception.metadata for clean attribution.
 */
export function buildAwakeningInternalEvent(
  claim: MemoryClaim,
  timezone: string,
  now: Date,
): InternalScheduledEvent {
  const schedule = claim.awakeningSchedule!;
  const readyAt = computeNextAwakeningReadyAt({
    targetHour: schedule.targetHour,
    jitterMinutes: schedule.jitterMinutes,
    recurrence: schedule.recurrence,
    timezone,
    now,
  });

  const eventId = `awakening_${claim.id}_${readyAt.slice(0, 10)}`;
  return {
    id: eventId,
    dedupeKey: `awakening:${claim.id}`,
    readyAt,
    origin: "awakening",
    status: "pending",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    perception: {
      id: `awakening-perception_${eventId}`,
      kind: "scheduled_followup_ready",
      channel: "heartbeat",
      modality: "text",
      content: schedule.sourceUtterance,
      createdAt: readyAt,
      internal: true,
      metadata: {
        awakeningClaimId: claim.id,
        awakeningKind: schedule.awakeningKind,
        sourceUtterance: schedule.sourceUtterance,
        reason: schedule.reason,
      },
    },
  };
}


/**
 * Deactivate awakening claims that match the cancellation text.
 * Matches by keyword overlap between cancellation text and the awakening's
 * sourceUtterance/summary, rather than deactivating all awakenings.
 */
export function deactivateMatchingAwakeningClaims(
  claims: MemoryClaim[],
  cancellationText: string,
  now: string,
): { claims: MemoryClaim[]; deactivatedIds: string[] } {
  const cancelTokens = new Set(
    cancellationText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );

  // Time-of-day keywords map to target hours for matching
  const hourKeywords: Record<string, [number, number]> = {
    morning: [6, 10],
    goodnight: [20, 23],
    bedtime: [20, 23],
    evening: [17, 21],
    lunch: [11, 13],
    weekend: [-1, -1], // special: match recurrence
  };

  const deactivatedIds: string[] = [];

  const updated = claims.map((claim) => {
    if (claim.kind !== "ritual" || !claim.awakeningSchedule?.active) return claim;
    if (claim.status === "contradicted" || claim.status === "stale") return claim;

    const schedule = claim.awakeningSchedule;
    let matches = false;

    // Check keyword overlap with sourceUtterance/summary
    const awakeningText = `${schedule.sourceUtterance} ${claim.summary}`.toLowerCase();
    const awakeningTokens = awakeningText.split(/\s+/).filter((t) => t.length > 2);
    const tokenOverlap = awakeningTokens.filter((t) => cancelTokens.has(t)).length;
    if (tokenOverlap >= 2) matches = true;

    // Check time-of-day keywords against targetHour
    for (const [keyword, [minHour, maxHour]] of Object.entries(hourKeywords)) {
      if (!cancelTokens.has(keyword)) continue;
      if (keyword === "weekend" && schedule.recurrence === "weekends") {
        matches = true;
        break;
      }
      if (minHour >= 0 && schedule.targetHour >= minHour && schedule.targetHour <= maxHour) {
        matches = true;
        break;
      }
    }

    if (!matches) return claim;

    deactivatedIds.push(claim.id);
    return {
      ...claim,
      awakeningSchedule: { ...schedule, active: false },
      status: "stale" as const,
      lastObservedAt: now,
    };
  });

  return { claims: updated, deactivatedIds };
}


/** Extract an AwakeningSchedule from a natural-language scheduling utterance. */
export function inferAwakeningScheduleFromText(
  text: string,
): AwakeningSchedule | null {
  const lower = text.toLowerCase();

  // --- Recurring ritual patterns ---

  // Morning patterns
  if (/(good morning|morning text|wake.?up text|morning message)/i.test(lower)) {
    return {
      recurrence: "daily",
      targetHour: 8,
      jitterMinutes: 45,
      reason: "User likes good morning texts",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "ritual",
    };
  }

  // Goodnight / bedtime patterns
  if (/(good\s?night|bedtime|before.*(bed|sleep)|night.?time text)/i.test(lower)) {
    return {
      recurrence: "daily",
      targetHour: 22,
      jitterMinutes: 30,
      reason: "User likes goodnight texts",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "ritual",
    };
  }

  // After-work patterns
  if (/(after work|end of.*(work|day)|evening check|when.*(done|off) work)/i.test(lower)) {
    return {
      recurrence: "weekdays",
      targetHour: 18,
      jitterMinutes: 60,
      reason: "User wants check-ins after work",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "ritual",
    };
  }

  // Lunch / midday patterns
  if (/(lunch|midday|middle of the day|noon)/i.test(lower)) {
    return {
      recurrence: "daily",
      targetHour: 12,
      jitterMinutes: 30,
      reason: "User wants midday check-ins",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "ritual",
    };
  }

  // Weekend patterns
  if (/(weekend|saturday|sunday)/i.test(lower) && /(check|text|message|reach)/i.test(lower)) {
    return {
      recurrence: "weekends",
      targetHour: 10,
      jitterMinutes: 60,
      reason: "User wants weekend check-ins",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "ritual",
    };
  }

  // --- One-shot reminder/followup patterns ---

  // "remind me ... tomorrow morning"
  if (/\btomorrow morning\b/.test(lower)) {
    return {
      recurrence: "once",
      targetHour: 9,
      jitterMinutes: 30,
      reason: "One-shot reminder for tomorrow morning",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "reminder",
    };
  }

  // "remind me ... tonight" / "this evening"
  if (/\b(tonight|this evening)\b/.test(lower)) {
    return {
      recurrence: "once",
      targetHour: 21,
      jitterMinutes: 15,
      reason: "One-shot reminder for tonight",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "reminder",
    };
  }

  // "remind me ... tomorrow" (generic)
  if (/\btomorrow\b/.test(lower)) {
    return {
      recurrence: "once",
      targetHour: 10,
      jitterMinutes: 30,
      reason: "One-shot reminder for tomorrow",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "reminder",
    };
  }

  // "in N hours"
  const hoursMatch = lower.match(/\bin (\d+) hours?\b/);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    const targetHour = (new Date().getHours() + hours) % 24;
    return {
      recurrence: "once",
      targetHour,
      jitterMinutes: 10,
      reason: `One-shot reminder in ${hours} hour(s)`,
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "reminder",
    };
  }

  // "this afternoon"
  if (/\bthis afternoon\b/.test(lower)) {
    return {
      recurrence: "once",
      targetHour: 15,
      jitterMinutes: 30,
      reason: "One-shot reminder for this afternoon",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "reminder",
    };
  }

  // "remind me about" (generic — default to ~4 hours from now)
  if (/\bremind me\b/.test(lower)) {
    const targetHour = (new Date().getHours() + 4) % 24;
    return {
      recurrence: "once",
      targetHour,
      jitterMinutes: 30,
      reason: "One-shot reminder (user requested)",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "reminder",
    };
  }

  // Persona-initiated patterns: "think about that", "get back to you", "let me think"
  // (must come before followup to avoid "get back to" matching as followup)
  if (/\b(think about that|get back to you|let me think|i'll think)\b/.test(lower)) {
    const targetHour = (new Date().getHours() + 2) % 24;
    return {
      recurrence: "once",
      targetHour,
      jitterMinutes: 30,
      reason: "Deferred action — persona will return",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "deferred",
    };
  }

  // Persona-initiated patterns: "check back", "follow up", "circle back"
  if (/\b(check back|follow up|circle back)\b/.test(lower)) {
    const targetHour = (new Date().getHours() + 4) % 24;
    return {
      recurrence: "once",
      targetHour,
      jitterMinutes: 45,
      reason: "Self-initiated followup",
      sourceUtterance: text,
      active: true,
      lastFiredAt: null,
      fireCount: 0,
      skipCount: 0,
      awakeningKind: "followup",
    };
  }

  return null;
}

