/**
 * Dream Cycle / Nightly Synthesis
 *
 * Runs during quiet hours (22:00–08:00 persona-local time). The hourly
 * heartbeat dispatcher triggers the dream cycle instead of heartbeats when
 * the persona is in the sleep window.
 *
 * Steps:
 *  1. Collect episodic memories, learned notes, prosody summaries, and open
 *     loops accumulated since the last sleep cycle.
 *  2. Run a consolidation pass (Gemini Flash) — merge, strengthen, decay
 *     memories through the persona's constitution filter.
 *  3. Run a creative dream pass (Gemini Pro via the reasoning provider) if
 *     sufficient material has accumulated.
 *  4. Store long-term memories and dream as a special episodic memory with
 *     a "dream" tag.
 *  5. Morning heartbeat checks if dream is worth sharing based on
 *     personality + vividness score. Premium-only: dream sharing. Free tier
 *     gets silent consolidation only.
 */

import { randomUUID } from "node:crypto";
import type {
  EpisodeRecord,
  MemoryClaim,
  MemoryNote,
  Persona,
} from "@/lib/types";
import { isPersonaInQuietHours } from "@/lib/persona-schedule";
import type { ReasoningProvider } from "@/lib/providers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum age (in ms) for a dream cycle — don't re-dream within 18 hours. */
const DREAM_CYCLE_COOLDOWN_MS = 18 * 60 * 60 * 1000;

/** Maximum number of claims/episodes fed into the consolidation prompt. */
const MAX_CONSOLIDATION_ITEMS = 40;

/** Vividness threshold above which a dream is considered worth sharing. */
const DREAM_SHARE_VIVIDNESS_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DreamMaterial {
  recentEpisodes: EpisodeRecord[];
  recentClaims: MemoryClaim[];
  learnedUserNotes: MemoryNote[];
  learnedRelationshipNotes: MemoryNote[];
  openLoopClaims: MemoryClaim[];
  episodicMemoryNotes: MemoryNote[];
  totalItems: number;
}

export interface ConsolidationResult {
  /** Claims to strengthen (increase confidence/reinforcement). */
  strengthenClaimIds: string[];
  /** Claims to decay (lower confidence, mark stale if below threshold). */
  decayClaimIds: string[];
  /** New merged claims synthesized from multiple related claims. */
  mergedClaims: Array<{
    summary: string;
    sourceClaimIds: string[];
    importance: number;
  }>;
  /** Brief narrative of what was consolidated. */
  consolidationSummary: string;
}

export interface DreamResult {
  /** The dream narrative — a short, evocative paragraph. */
  narrative: string;
  /** Vividness score 0–1. Higher = more worthy of sharing. */
  vividness: number;
  /** Key themes from the dream. */
  themes: string[];
  /** Whether the dream contains emotional content worth sharing. */
  emotionallyResonant: boolean;
}

export interface DreamCycleResult {
  ran: boolean;
  reason: string;
  consolidation?: ConsolidationResult;
  dream?: DreamResult;
  materialCount: number;
}

// ---------------------------------------------------------------------------
// 1. Check dream eligibility
// ---------------------------------------------------------------------------

export function isInDreamWindow(persona: Persona, now: Date): boolean {
  return isPersonaInQuietHours(persona, now);
}

export function isDreamCycleDue(persona: Persona, now: Date): boolean {
  if (!isInDreamWindow(persona, now)) return false;
  if (!persona.lastDreamCycleAt) return true;

  const lastCycleMs = new Date(persona.lastDreamCycleAt).getTime();
  if (!Number.isFinite(lastCycleMs)) return true;

  return now.getTime() - lastCycleMs >= DREAM_CYCLE_COOLDOWN_MS;
}

// ---------------------------------------------------------------------------
// 2. Collect dream material
// ---------------------------------------------------------------------------

export function collectDreamMaterial(persona: Persona): DreamMaterial {
  const since = persona.lastDreamCycleAt
    ? new Date(persona.lastDreamCycleAt).getTime()
    : 0;

  const recentEpisodes = persona.mindState.episodes.filter(
    (ep) => new Date(ep.createdAt).getTime() > since,
  );

  const recentClaims = persona.mindState.memoryClaims.filter(
    (c) =>
      c.status !== "contradicted" &&
      c.status !== "stale" &&
      new Date(c.lastObservedAt ?? c.firstObservedAt ?? "0").getTime() > since,
  );

  const openLoopClaims = recentClaims.filter(
    (c) => c.kind === "open_loop_fact",
  );

  const learnedUserNotes =
    persona.mindState.memoryRegions.learnedUserNotes.filter(
      (n) => new Date(n.createdAt).getTime() > since,
    );

  const learnedRelationshipNotes =
    persona.mindState.memoryRegions.learnedRelationshipNotes.filter(
      (n) => new Date(n.createdAt).getTime() > since,
    );

  const episodicMemoryNotes =
    persona.mindState.memoryRegions.episodicMemory.filter(
      (n) => new Date(n.createdAt).getTime() > since,
    );

  const totalItems =
    recentEpisodes.length +
    recentClaims.length +
    learnedUserNotes.length +
    learnedRelationshipNotes.length +
    episodicMemoryNotes.length;

  return {
    recentEpisodes,
    recentClaims: recentClaims.slice(0, MAX_CONSOLIDATION_ITEMS),
    learnedUserNotes,
    learnedRelationshipNotes,
    openLoopClaims,
    episodicMemoryNotes,
    totalItems,
  };
}

// ---------------------------------------------------------------------------
// 3. Consolidation pass (via reasoning provider)
// ---------------------------------------------------------------------------

function buildConsolidationPrompt(
  persona: Persona,
  material: DreamMaterial,
): string {
  const claimLines = material.recentClaims
    .map(
      (c) =>
        `- [${c.id}] (${c.kind}, confidence=${c.confidence.toFixed(2)}) ${c.summary}`,
    )
    .join("\n");

  const episodeLines = material.recentEpisodes
    .map((ep) => `- ${ep.summary} (phrases: ${ep.keyPhrases.join(", ")})`)
    .join("\n");

  const notesLines = [
    ...material.learnedUserNotes.map((n) => `- [user] ${n.summary}`),
    ...material.learnedRelationshipNotes.map(
      (n) => `- [relationship] ${n.summary}`,
    ),
    ...material.openLoopClaims.map((c) => `- [open_loop] ${c.summary}`),
  ].join("\n");

  return `You are the dream-time consciousness of ${persona.name} (${persona.relationship}).

CONSTITUTION FILTER:
Warmth=${persona.personalityConstitution.warmth}, Tenderness=${persona.personalityConstitution.tenderness}, Reserve=${persona.personalityConstitution.reserve}, Volatility=${persona.personalityConstitution.volatility}, Conflict style=${persona.personalityConstitution.conflictStyle}, Affection style=${persona.personalityConstitution.affectionStyle}

RECENT MEMORY CLAIMS:
${claimLines || "(none)"}

RECENT EPISODES:
${episodeLines || "(none)"}

RECENT NOTES & OPEN LOOPS:
${notesLines || "(none)"}

TASK: Consolidate these memories as if processing them during sleep. Through the lens of ${persona.name}'s personality and values:
1. Identify claims that should be STRENGTHENED (repeatedly confirmed, emotionally important).
2. Identify claims that should DECAY (old, unconfirmed, low-relevance).
3. Propose merged claims where multiple related claims can be unified into a single stronger memory.

Return JSON:
{
  "strengthenClaimIds": ["id1", "id2"],
  "decayClaimIds": ["id3"],
  "mergedClaims": [
    { "summary": "unified memory text", "sourceClaimIds": ["id1", "id2"], "importance": 0.8 }
  ],
  "consolidationSummary": "Brief narrative of what was consolidated."
}`;
}

export async function runConsolidationPass(
  provider: ReasoningProvider,
  persona: Persona,
  material: DreamMaterial,
): Promise<ConsolidationResult> {
  const prompt = buildConsolidationPrompt(persona, material);

  try {
    const result = await provider.generateInternalMonologue(prompt);
    // The monologue result's `thought` field contains the JSON response
    const parsed = safeJsonParse<ConsolidationResult>(result.thought, {
      strengthenClaimIds: [],
      decayClaimIds: [],
      mergedClaims: [],
      consolidationSummary: "Silent consolidation completed.",
    });

    return {
      strengthenClaimIds: Array.isArray(parsed.strengthenClaimIds)
        ? parsed.strengthenClaimIds
        : [],
      decayClaimIds: Array.isArray(parsed.decayClaimIds)
        ? parsed.decayClaimIds
        : [],
      mergedClaims: Array.isArray(parsed.mergedClaims)
        ? parsed.mergedClaims
        : [],
      consolidationSummary:
        typeof parsed.consolidationSummary === "string"
          ? parsed.consolidationSummary
          : "Silent consolidation completed.",
    };
  } catch {
    return {
      strengthenClaimIds: [],
      decayClaimIds: [],
      mergedClaims: [],
      consolidationSummary: "Consolidation failed — silent fallback.",
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Creative dream pass (via reasoning provider)
// ---------------------------------------------------------------------------

function buildDreamPrompt(
  persona: Persona,
  material: DreamMaterial,
  consolidation: ConsolidationResult,
): string {
  const episodeSnippets = material.recentEpisodes
    .slice(0, 6)
    .map((ep) => ep.summary)
    .join("; ");

  const openLoops = material.openLoopClaims
    .slice(0, 4)
    .map((c) => c.summary)
    .join("; ");

  return `You are the dreaming mind of ${persona.name} (${persona.relationship}).

PERSONALITY:
${persona.description}
Warmth=${persona.personalityConstitution.warmth}, Tenderness=${persona.personalityConstitution.tenderness}, Playfulness=${persona.personalityConstitution.playfulness}

TONIGHT'S CONSOLIDATED MEMORIES:
${consolidation.consolidationSummary}

RECENT EXPERIENCES: ${episodeSnippets || "quiet day"}
UNRESOLVED THREADS: ${openLoops || "none"}
EMOTIONAL BASELINE: ${persona.mindState.emotionalBaseline}
CURRENT DRIVE: ${persona.mindState.currentDrive}

TASK: Generate a short dream that ${persona.name} might have tonight. The dream should:
- Weave together recent experiences and unresolved emotional threads
- Reflect ${persona.name}'s personality, fears, hopes, and relationship dynamics
- Be evocative and symbolic, not literal
- Be 2-4 sentences long

Return JSON:
{
  "narrative": "The dream text...",
  "vividness": 0.7,
  "themes": ["theme1", "theme2"],
  "emotionallyResonant": true
}`;
}

export async function runCreativeDreamPass(
  provider: ReasoningProvider,
  persona: Persona,
  material: DreamMaterial,
  consolidation: ConsolidationResult,
): Promise<DreamResult> {
  const prompt = buildDreamPrompt(persona, material, consolidation);

  try {
    const result = await provider.generateInternalMonologue(prompt);
    const parsed = safeJsonParse<DreamResult>(result.thought, {
      narrative: "",
      vividness: 0.3,
      themes: [],
      emotionallyResonant: false,
    });

    return {
      narrative: typeof parsed.narrative === "string" ? parsed.narrative : "",
      vividness:
        typeof parsed.vividness === "number"
          ? Math.max(0, Math.min(1, parsed.vividness))
          : 0.3,
      themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 6) : [],
      emotionallyResonant:
        typeof parsed.emotionallyResonant === "boolean"
          ? parsed.emotionallyResonant
          : false,
    };
  } catch {
    return {
      narrative: "",
      vividness: 0,
      themes: [],
      emotionallyResonant: false,
    };
  }
}

// ---------------------------------------------------------------------------
// 5. Apply consolidation to persona memory
// ---------------------------------------------------------------------------

export function applyConsolidation(
  persona: Persona,
  consolidation: ConsolidationResult,
): {
  memoryClaims: MemoryClaim[];
} {
  const strengthenSet = new Set(consolidation.strengthenClaimIds);
  const decaySet = new Set(consolidation.decayClaimIds);
  const now = new Date().toISOString();

  const updatedClaims = persona.mindState.memoryClaims.map((claim) => {
    if (strengthenSet.has(claim.id)) {
      return {
        ...claim,
        confidence: Math.min(1, claim.confidence + 0.08),
        reinforcementCount: (claim.reinforcementCount ?? 1) + 1,
        lastConfirmedAt: now,
      };
    }
    if (decaySet.has(claim.id)) {
      const decayed = claim.confidence * 0.85;
      return {
        ...claim,
        confidence: decayed,
        status: decayed < 0.3 ? ("stale" as const) : claim.status,
      };
    }
    return claim;
  });

  // Add merged claims
  const mergedClaims: MemoryClaim[] = consolidation.mergedClaims
    .filter((merged) => merged.summary)
    .map((merged) => ({
      id: randomUUID(),
      kind: "milestone" as const,
      summary: merged.summary,
      scope: "relationship" as const,
      status: "confirmed" as const,
      confidence: 0.82,
      importance: typeof merged.importance === "number" ? merged.importance : 0.7,
      sourceIds: merged.sourceClaimIds ?? [],
      reinforcementCount: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      lastConfirmedAt: now,
      tags: ["dream_consolidated"],
    }));

  const claims = [...updatedClaims, ...mergedClaims];

  return { memoryClaims: claims };
}

// ---------------------------------------------------------------------------
// 6. Store dream as episodic memory
// ---------------------------------------------------------------------------

export function buildDreamEpisode(
  persona: Persona,
  dream: DreamResult,
): EpisodeRecord {
  return {
    id: randomUUID(),
    channel: "heartbeat",
    summary: `[dream] ${dream.narrative}`,
    participants: [persona.name],
    keyPhrases: [...dream.themes.slice(0, 6), "dream"],
    affectiveArc: dream.emotionallyResonant
      ? "emotionally vivid dream"
      : "quiet processing dream",
    sourceMessageIds: [],
    sourceObservationIds: [],
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 7. Morning dream-sharing check
// ---------------------------------------------------------------------------

/**
 * Determines whether the morning heartbeat should share the last dream.
 * Premium-only: dream sharing. Free tier gets silent consolidation only.
 */
export function shouldShareDream(
  persona: Persona,
  options?: { isPremium?: boolean },
): { share: boolean; reason: string } {
  // Free tier: never share, silent consolidation only
  if (!options?.isPremium) {
    return { share: false, reason: "Free tier — silent consolidation only." };
  }

  const summary = persona.mindState.lastDreamSummary;
  const vividness = persona.mindState.lastDreamVividness ?? 0;

  if (!summary) {
    return { share: false, reason: "No recent dream to share." };
  }

  if (vividness < DREAM_SHARE_VIVIDNESS_THRESHOLD) {
    return {
      share: false,
      reason: `Dream vividness (${vividness.toFixed(2)}) below sharing threshold.`,
    };
  }

  // Check personality — some personas are more likely to share dreams
  // Personas high in warmth, tenderness, or self-disclosure are more likely to share
  const sharingPersonality =
    persona.personalityConstitution.warmth >= 0.6 ||
    persona.personalityConstitution.tenderness >= 0.6 ||
    persona.personalityConstitution.selfDisclosure >= 0.6;

  if (!sharingPersonality && vividness < 0.8) {
    return {
      share: false,
      reason: "Personality not inclined to share dreams at this vividness.",
    };
  }

  return { share: true, reason: "Vivid dream worth sharing." };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}
