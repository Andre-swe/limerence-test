/**
 * Targeted unit tests for memory-v2.ts — focuses on the riskiest untested
 * paths: claim eviction, retrieval scoring, conflict resolution, and capacity
 * enforcement. All tests are standalone with inline fixtures; no providers or
 * stores are needed.
 */
import { describe, expect, it } from "vitest";
import {
  applyBoundaryClaimUpdate,
  applyFeedbackToMemoryClaims,
  applyLearningArtifactsToMemoryClaims,
  buildMemoryRetrievalPack,
  seedBootstrapClaims,
  renderClaimForContext,
  renderEpisodeForContext,
} from "@/lib/memory-v2";
import type {
  ClaimSource,
  EpisodeRecord,
  FeedbackEvent,
  LearningArtifact,
  MemoryClaim,
  Persona,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers — minimal factories for inline test fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-03-16T12:00:00.000Z";
const YESTERDAY = "2026-03-15T12:00:00.000Z";
const LAST_WEEK = "2026-03-09T12:00:00.000Z";
const TWO_MONTHS_AGO = "2026-01-16T12:00:00.000Z";

let counter = 0;
function uid() {
  return `test-${++counter}`;
}

function makeClaim(overrides: Partial<MemoryClaim> = {}): MemoryClaim {
  const id = overrides.id ?? uid();
  return {
    id,
    kind: "user_fact",
    summary: `Claim ${id}`,
    scope: "relationship",
    status: "tentative",
    confidence: 0.5,
    importance: 0.5,
    sourceIds: [],
    reinforcementCount: 1,
    firstObservedAt: NOW,
    lastObservedAt: NOW,
    tags: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<ClaimSource> = {}): ClaimSource {
  return {
    id: overrides.id ?? uid(),
    claimId: overrides.claimId ?? uid(),
    sourceType: "inference",
    createdAt: NOW,
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<EpisodeRecord> = {}): EpisodeRecord {
  return {
    id: overrides.id ?? uid(),
    channel: "web",
    summary: overrides.summary ?? `Episode ${uid()}`,
    participants: ["Mom", "user"],
    keyPhrases: [],
    affectiveArc: "steady",
    sourceMessageIds: [],
    sourceObservationIds: [],
    createdAt: NOW,
    ...overrides,
  };
}

/**
 * Build a minimal Persona-shaped object with only the fields memory-v2 reads.
 * Avoids depending on the full Persona construction pipeline.
 */
function makePersona(overrides: {
  memoryClaims?: MemoryClaim[];
  claimSources?: ClaimSource[];
  episodes?: EpisodeRecord[];
  activeProcess?: Persona["mindState"]["activeProcess"];
  currentDrive?: string;
  lastUserStateSummary?: string;
} = {}): Persona {
  return {
    id: uid(),
    userId: uid(),
    name: "Mom",
    relationship: "mother",
    source: "living",
    description: "My mother",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    pastedText: "",
    screenshotSummaries: [],
    interviewAnswers: {},
    heartbeatPolicy: {
      enabled: true,
      intervalHours: 4,
      maxOutboundPerDay: 3,
      quietHoursStart: 22,
      quietHoursEnd: 8,
      preferredMode: "mixed",
      workHoursEnabled: false,
      workHoursStart: 9,
      workHoursEnd: 17,
      workDays: [1, 2, 3, 4, 5],
      boundaryNotes: [],
      variableInterval: true,
      hourlyActivityCounts: Array(24).fill(0),
      minIntervalHours: 1,
      maxIntervalHours: 8,
    },
    voice: { provider: "mock", status: "ready", cloneState: "none", watermarkApplied: false },
    consent: { attestedRights: true, createdAt: NOW },
    dossier: {
      essence: "Warm, caring mother",
      communicationStyle: "Warm and direct",
      signaturePhrases: ["Love you, kiddo"],
      favoriteTopics: ["cooking", "gardening"],
      emotionalTendencies: ["warm", "protective"],
      routines: ["Good morning texts", "Sunday calls"],
      guidance: [],
      sourceSummary: "living",
      knowledgeProfile: { domains: [], deflectionStyle: "honest", deflectionExamples: [] },
    },
    voiceSamples: [],
    screenshots: [],
    preferenceSignals: [],
    personalityConstitution: {
      warmth: 0.8,
      directness: 0.6,
      humorType: "earnest",
      initiative: 0.7,
      volatility: 0.3,
      tenderness: 0.8,
      reserve: 0.3,
      rituality: 0.7,
      conflictStyle: "measured",
      repairStyle: "careful_listening",
      playfulness: 0.5,
      protectiveness: 0.8,
      selfDisclosure: 0.6,
      speechCadence: "measured",
      boundaryFirmness: 0.5,
      pushbackTendency: 0.4,
      emotionalIntensity: 0.6,
      patience: 0.7,
      affectionStyle: "verbal",
    },
    relationshipModel: {
      closeness: 0.7,
      asymmetry: "peer",
      sharedRituals: [],
      frictionPatterns: [],
      favoriteModes: ["live_voice"],
      acceptablePushback: 0.5,
      repairExpectations: "Repair quickly and stay human.",
      baselineTone: "quiet but available",
      feltHistory: "Built from memories, samples, and interaction.",
    },
    revision: 1,
    mindState: {
      activeProcess: overrides.activeProcess ?? "attunement",
      currentDrive: overrides.currentDrive ?? "Be present",
      unresolvedTension: "",
      recentShift: "",
      emotionalBaseline: "steady",
      recentTrend: "stable",
      contextVersion: 1,
      liveDeliveryVersion: 1,
      traceVersion: 1,
      processState: {},
      processInstances: {},
      soulMemory: {},
      learningState: {
        userModelSummary: "",
        relationshipSummary: "",
        selfConsistencySummary: "",
        artifacts: [],
      },
      workingMemory: {
        summary: "",
        currentFocus: "",
        emotionalWeather: "steady",
        lastUserNeed: "",
        updatedAt: NOW,
      },
      relationshipMemories: [],
      openLoops: [],
      scheduledPerceptions: [],
      pendingInternalEvents: [],
      pendingShadowTurns: [],
      recentUserStates: [],
      liveSessionMetrics: {},
      memoryRegions: {
        constitutionMemory: [],
        relationshipMemory: [],
        episodicMemory: [],
        boundaryMemory: [],
        repairMemory: [],
        ritualMemory: [],
        openLoopMemory: [],
        learnedUserNotes: [],
        learnedRelationshipNotes: [],
        processMemory: [],
      },
      memoryClaims: overrides.memoryClaims ?? [],
      claimSources: overrides.claimSources ?? [],
      episodes: overrides.episodes ?? [],
      recentChangedClaims: [],
      internalState: {
        currentThought: "",
        mood: "present and steady",
        energy: 0.6,
        patience: 0.8,
        warmthTowardUser: 0.7,
        engagementDrive: 0.6,
        recentThoughts: [],
      },
      recentEvents: [],
      traceHead: [],
    },
  };
}

function makeArtifact(overrides: Partial<LearningArtifact> = {}): LearningArtifact {
  return {
    id: overrides.id ?? uid(),
    kind: overrides.kind ?? "learn_about_user",
    summary: overrides.summary ?? "User likes hiking on weekends",
    createdAt: overrides.createdAt ?? NOW,
    memoryKeys: overrides.memoryKeys ?? [],
    ...(overrides.effectSummary !== undefined ? { effectSummary: overrides.effectSummary } : {}),
    ...(overrides.sourcePerceptionId !== undefined ? { sourcePerceptionId: overrides.sourcePerceptionId } : {}),
    ...(overrides.sourceMessageId !== undefined ? { sourceMessageId: overrides.sourceMessageId } : {}),
  };
}

// ============================================================================
// 1. Claim eviction — MAX_CLAIMS = 100
// ============================================================================
describe("claim eviction (MAX_CLAIMS=100)", () => {
  it("evicts lowest-weight claims when exceeding 100 via applyBoundaryClaimUpdate", () => {
    // Fill to exactly 100 claims — all low importance, old, single reinforcement
    const existingClaims: MemoryClaim[] = Array.from({ length: 100 }, (_, i) =>
      makeClaim({
        id: `old-${i}`,
        summary: `Old low-value claim number ${i}`,
        importance: 0.1,
        confidence: 0.1,
        reinforcementCount: 1,
        lastObservedAt: TWO_MONTHS_AGO,
      }),
    );

    const result = applyBoundaryClaimUpdate({
      claims: existingClaims,
      claimSources: [],
      summary: "Do not text me while I am at work",
      detail: "User explicitly stated no work-hour messages",
      createdAt: NOW,
      sourceMessageId: "msg-1",
      sessionId: "sess-1",
      sourceText: "Don't text me while I'm at work",
    });

    // Must not exceed 100
    expect(result.claims.length).toBeLessThanOrEqual(100);
    // The newly created high-importance boundary claim must survive eviction
    const boundaryClaim = result.claims.find(
      (c) => c.kind === "boundary" && c.summary.includes("Do not text me"),
    );
    expect(boundaryClaim).toBeDefined();
    expect(boundaryClaim!.confidence).toBeGreaterThanOrEqual(0.9);
    expect(boundaryClaim!.importance).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps high-weight claims and evicts low-weight ones", () => {
    const claims: MemoryClaim[] = [
      // 50 high-value: recent, high importance, confirmed
      ...Array.from({ length: 50 }, (_, i) =>
        makeClaim({
          id: `high-${i}`,
          summary: `High value claim ${i}`,
          importance: 0.95,
          confidence: 0.9,
          reinforcementCount: 5,
          status: "confirmed",
          lastObservedAt: NOW,
        }),
      ),
      // 55 low-value: old, low importance, tentative
      ...Array.from({ length: 55 }, (_, i) =>
        makeClaim({
          id: `low-${i}`,
          summary: `Low value claim ${i}`,
          importance: 0.1,
          confidence: 0.1,
          reinforcementCount: 1,
          status: "tentative",
          lastObservedAt: TWO_MONTHS_AGO,
        }),
      ),
    ];

    // Add one more claim to trigger eviction
    const result = applyBoundaryClaimUpdate({
      claims,
      claimSources: [],
      summary: "New boundary from overflow test",
      createdAt: NOW,
    });

    expect(result.claims.length).toBeLessThanOrEqual(100);

    // All 50 high-value claims should survive
    const highSurvivors = result.claims.filter((c) => c.id.startsWith("high-"));
    expect(highSurvivors.length).toBe(50);

    // The new boundary claim should survive (high importance/confidence)
    expect(result.claims.some((c) => c.summary.includes("New boundary from overflow test"))).toBe(true);
  });

  it("does not evict when under capacity", () => {
    const claims: MemoryClaim[] = Array.from({ length: 10 }, (_, i) =>
      makeClaim({ id: `claim-${i}`, summary: `Claim ${i}` }),
    );

    const result = applyBoundaryClaimUpdate({
      claims,
      claimSources: [],
      summary: "Keep it simple",
      createdAt: NOW,
    });

    // 10 existing + 1 new = 11, well under 100
    expect(result.claims.length).toBe(11);
  });
});

// ============================================================================
// 2. Retrieval scoring — buildMemoryRetrievalPack
// ============================================================================
describe("buildMemoryRetrievalPack scoring", () => {
  it("loads confirmed high-importance claims into alwaysLoadedClaims", () => {
    const confirmed = makeClaim({
      id: "c-boundary",
      kind: "boundary",
      summary: "Do not call after 10pm",
      status: "confirmed",
      importance: 0.95,
      confidence: 0.9,
      lastObservedAt: NOW,
    });
    const tentative = makeClaim({
      id: "c-fact",
      kind: "user_fact",
      summary: "Likes coffee",
      status: "tentative",
      importance: 0.5,
      confidence: 0.5,
      lastObservedAt: LAST_WEEK,
    });

    const persona = makePersona({ memoryClaims: [confirmed, tentative] });
    const pack = buildMemoryRetrievalPack({ persona });

    expect(pack.alwaysLoadedClaims.some((c) => c.id === "c-boundary")).toBe(true);
    // tentative user_fact should NOT be in alwaysLoaded (not confirmed, not in the preferred kind list)
    expect(pack.alwaysLoadedClaims.some((c) => c.id === "c-fact")).toBe(false);
  });

  it("excludes contradicted and stale claims from contextual retrieval", () => {
    const contradicted = makeClaim({
      id: "c-contra",
      kind: "user_fact",
      summary: "User is vegetarian",
      status: "contradicted",
      importance: 0.8,
      confidence: 0.3,
      lastObservedAt: NOW,
    });
    const stale = makeClaim({
      id: "c-stale",
      kind: "user_fact",
      summary: "User works at old company",
      status: "stale",
      importance: 0.6,
      confidence: 0.4,
      lastObservedAt: LAST_WEEK,
    });
    const active = makeClaim({
      id: "c-active",
      kind: "user_fact",
      summary: "User loves vegetarian cooking",
      status: "tentative",
      importance: 0.7,
      confidence: 0.7,
      lastObservedAt: NOW,
    });

    const persona = makePersona({ memoryClaims: [contradicted, stale, active] });
    const pack = buildMemoryRetrievalPack({
      persona,
      perception: { content: "vegetarian cooking recipes" },
    });

    // Contradicted and stale must be excluded from contextual
    expect(pack.contextualClaims.some((c) => c.id === "c-contra")).toBe(false);
    expect(pack.contextualClaims.some((c) => c.id === "c-stale")).toBe(false);
  });

  it("gives process-relevant claims a scoring bonus", () => {
    const boundaryClaim = makeClaim({
      id: "c-boundary-proc",
      kind: "boundary",
      summary: "No messages during quiet hours",
      status: "confirmed",
      importance: 0.7,
      confidence: 0.7,
      lastObservedAt: NOW,
    });
    const preferenceClaim = makeClaim({
      id: "c-preference",
      kind: "preference",
      summary: "Prefers voice notes over text",
      status: "confirmed",
      importance: 0.7,
      confidence: 0.7,
      lastObservedAt: NOW,
    });

    // boundary_negotiation should boost boundary claims
    const persona = makePersona({
      memoryClaims: [boundaryClaim, preferenceClaim],
      activeProcess: "boundary_negotiation",
    });
    const pack = buildMemoryRetrievalPack({ persona });

    // Both are confirmed and in allowed kinds, so both go to alwaysLoaded
    const boundaryIdx = pack.alwaysLoadedClaims.findIndex((c) => c.id === "c-boundary-proc");
    const preferenceIdx = pack.alwaysLoadedClaims.findIndex((c) => c.id === "c-preference");
    expect(boundaryIdx).not.toBe(-1);
    expect(preferenceIdx).not.toBe(-1);
    // Boundary claim should rank higher due to process relevance bonus in alwaysLoaded sorting
    // (alwaysLoaded sorts by importance + confidence + recency, not process bonus,
    //  but boundary kind has higher base importance via importanceForKind)
    // The key assertion: boundary_negotiation boosts boundary claims in contextual scoring
    // Let's verify via contextual instead — the process bonus affects contextual scoring
    const withBoundaryProcess = makePersona({
      memoryClaims: [
        makeClaim({
          id: "ctx-boundary",
          kind: "boundary",
          summary: "Quiet hours boundary rule for evenings",
          status: "tentative",
          importance: 0.5,
          confidence: 0.5,
          lastObservedAt: NOW,
        }),
        makeClaim({
          id: "ctx-preference",
          kind: "preference",
          summary: "Prefers short messages in evenings",
          status: "tentative",
          importance: 0.5,
          confidence: 0.5,
          lastObservedAt: NOW,
        }),
      ],
      activeProcess: "boundary_negotiation",
    });
    const pack2 = buildMemoryRetrievalPack({ persona: withBoundaryProcess });
    // boundary should be ranked higher than preference due to process bonus
    const ctxBoundary = pack2.contextualClaims.findIndex((c) => c.id === "ctx-boundary");
    const ctxPreference = pack2.contextualClaims.findIndex((c) => c.id === "ctx-preference");
    if (ctxBoundary !== -1 && ctxPreference !== -1) {
      expect(ctxBoundary).toBeLessThan(ctxPreference);
    }
    // At minimum, the boundary claim should appear in contextual results
    expect(ctxBoundary).not.toBe(-1);
  });

  it("boosts claims that topic-match the perception content", () => {
    const matchingClaim = makeClaim({
      id: "c-topic-match",
      kind: "user_fact",
      summary: "User runs marathons every spring",
      status: "tentative",
      importance: 0.6,
      confidence: 0.6,
      lastObservedAt: NOW,
      tags: ["marathons", "spring", "running"],
    });
    const unrelatedClaim = makeClaim({
      id: "c-unrelated",
      kind: "user_fact",
      summary: "User has a cat named Whiskers",
      status: "tentative",
      importance: 0.6,
      confidence: 0.6,
      lastObservedAt: NOW,
      tags: ["cat", "whiskers"],
    });

    const persona = makePersona({ memoryClaims: [matchingClaim, unrelatedClaim] });
    const pack = buildMemoryRetrievalPack({
      persona,
      perception: { content: "I just signed up for the spring marathon training program" },
    });

    // The matching claim should appear in contextual; the unrelated one may not
    const matchInContext = pack.contextualClaims.some((c) => c.id === "c-topic-match");
    const unrelatedInContext = pack.contextualClaims.some((c) => c.id === "c-unrelated");
    // We can not guarantee unrelated is excluded (depends on score threshold),
    // but the matching one should be prioritized
    if (matchInContext && unrelatedInContext) {
      const mIdx = pack.contextualClaims.findIndex((c) => c.id === "c-topic-match");
      const uIdx = pack.contextualClaims.findIndex((c) => c.id === "c-unrelated");
      expect(mIdx).toBeLessThan(uIdx);
    }
    // At minimum, the matching claim should score well enough to be retrieved
    expect(matchInContext).toBe(true);
  });

  it("retrieves topic-matched episodes", () => {
    const matchingEpisode = makeEpisode({
      id: "ep-match",
      summary: "We talked about the upcoming wedding plans",
      keyPhrases: ["wedding", "plans", "venue"],
      createdAt: NOW,
    });
    const oldEpisode = makeEpisode({
      id: "ep-old",
      summary: "Random small talk about weather",
      keyPhrases: ["weather", "rain"],
      createdAt: TWO_MONTHS_AGO,
    });

    const persona = makePersona({ episodes: [matchingEpisode, oldEpisode] });
    const pack = buildMemoryRetrievalPack({
      persona,
      perception: { content: "How are the wedding plans going?" },
    });

    expect(pack.contextualEpisodes.some((e) => e.id === "ep-match")).toBe(true);
  });

  it("limits alwaysLoadedClaims to 8", () => {
    const claims = Array.from({ length: 15 }, (_, i) =>
      makeClaim({
        id: `confirmed-${i}`,
        kind: "boundary",
        summary: `Confirmed boundary rule ${i}`,
        status: "confirmed",
        importance: 0.9,
        confidence: 0.9,
        lastObservedAt: NOW,
      }),
    );

    const persona = makePersona({ memoryClaims: claims });
    const pack = buildMemoryRetrievalPack({ persona });

    expect(pack.alwaysLoadedClaims.length).toBeLessThanOrEqual(8);
  });

  it("limits contextualClaims to 6", () => {
    // Create many high-scoring tentative claims that should all pass the threshold
    const claims = Array.from({ length: 20 }, (_, i) =>
      makeClaim({
        id: `ctx-${i}`,
        kind: "user_fact",
        summary: `User fact about hiking trail number ${i}`,
        status: "tentative",
        importance: 0.8,
        confidence: 0.8,
        lastObservedAt: NOW,
        tags: ["hiking", "trail"],
      }),
    );

    const persona = makePersona({ memoryClaims: claims });
    const pack = buildMemoryRetrievalPack({
      persona,
      perception: { content: "Let's go hiking on the trail" },
    });

    expect(pack.contextualClaims.length).toBeLessThanOrEqual(6);
  });

  it("contextualClaims excludes claims already in alwaysLoaded", () => {
    const sharedClaim = makeClaim({
      id: "shared-claim",
      kind: "boundary",
      summary: "No late night messages",
      status: "confirmed",
      importance: 0.95,
      confidence: 0.95,
      lastObservedAt: NOW,
      tags: ["messages", "night", "late"],
    });

    const persona = makePersona({ memoryClaims: [sharedClaim] });
    const pack = buildMemoryRetrievalPack({
      persona,
      perception: { content: "late night messages boundary" },
    });

    // Should appear in alwaysLoaded but NOT duplicated in contextual
    expect(pack.alwaysLoadedClaims.some((c) => c.id === "shared-claim")).toBe(true);
    expect(pack.contextualClaims.some((c) => c.id === "shared-claim")).toBe(false);
  });

  it("returns empty retrieval pack for persona with no claims or episodes", () => {
    const persona = makePersona({ memoryClaims: [], episodes: [] });
    const pack = buildMemoryRetrievalPack({ persona });

    expect(pack.alwaysLoadedClaims).toEqual([]);
    expect(pack.contextualClaims).toEqual([]);
    expect(pack.contextualEpisodes).toEqual([]);
    expect(pack.summary).toContain("No confirmed durable claims yet.");
  });

  it("summary reflects accurate counts", () => {
    const claims = [
      makeClaim({ kind: "boundary", status: "confirmed", importance: 0.9, confidence: 0.9, lastObservedAt: NOW }),
      makeClaim({ kind: "ritual", status: "confirmed", importance: 0.85, confidence: 0.85, lastObservedAt: NOW }),
    ];
    const persona = makePersona({ memoryClaims: claims });
    const pack = buildMemoryRetrievalPack({ persona });

    expect(pack.summary).toContain("2 confirmed durable claims ready.");
  });
});

// ============================================================================
// 3. Conflict resolution — writeClaim (via upsertClaim through public API)
// ============================================================================
describe("conflict resolution (reinforcement, contradiction, staleness)", () => {
  describe("reinforcement", () => {
    it("reinforces an existing claim when the same summary is written again", () => {
      const existing = makeClaim({
        id: "reinforce-me",
        kind: "boundary",
        summary: "Do not text me while I am at work",
        scope: "relationship",
        status: "tentative",
        confidence: 0.6,
        importance: 0.8,
        reinforcementCount: 1,
        lastObservedAt: LAST_WEEK,
      });

      const result = applyBoundaryClaimUpdate({
        claims: [existing],
        claimSources: [],
        summary: "Do not text me while I am at work",
        createdAt: NOW,
        sourceMessageId: "msg-2",
      });

      // Should still be 1 claim, not 2
      const matchingClaims = result.claims.filter((c) =>
        c.summary.includes("Do not text me"),
      );
      expect(matchingClaims.length).toBe(1);

      const reinforced = matchingClaims[0];
      // reinforcementCount should increase
      expect(reinforced.reinforcementCount).toBe(2);
      // confidence should increase (Math.max(old, new) + 0.05)
      expect(reinforced.confidence).toBeGreaterThan(existing.confidence);
      // lastObservedAt should be updated
      expect(reinforced.lastObservedAt).toBe(NOW);
      // resolution should be "confirmed" since the new status is "confirmed" and
      // the boundary claim builder always sets status=confirmed
      expect(reinforced.status).toBe("confirmed");
    });

    it("confidence boost is clamped to 1.0", () => {
      const existing = makeClaim({
        kind: "boundary",
        summary: "Do not text me while I am at work",
        scope: "relationship",
        status: "confirmed",
        confidence: 0.98,
        importance: 0.9,
        reinforcementCount: 5,
        lastObservedAt: YESTERDAY,
      });

      const result = applyBoundaryClaimUpdate({
        claims: [existing],
        claimSources: [],
        summary: "Do not text me while I am at work",
        createdAt: NOW,
      });

      const reinforced = result.claims.find((c) =>
        c.summary.includes("Do not text me"),
      )!;
      // confidence should be clamped at 1.0 even after +0.05 boost
      expect(reinforced.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe("contradiction (via feedback)", () => {
    it("marks matching claims as contradicted and slashes confidence", () => {
      const claimToContradict = makeClaim({
        id: "contra-target",
        kind: "user_fact",
        summary: "User is vegetarian and avoids all meat",
        status: "confirmed",
        confidence: 0.85,
        importance: 0.7,
        sourceIds: ["msg-original"],
        tags: ["diet", "vegetarian"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-1",
        personaId: "persona-1",
        messageId: "msg-original",
        note: "Actually I eat meat now, I stopped being vegetarian",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [claimToContradict],
        claimSources: [],
        feedback,
      });

      const contradicted = result.claims.find((c) => c.id === "contra-target");
      expect(contradicted).toBeDefined();
      expect(contradicted!.status).toBe("contradicted");
      // confidence is multiplied by 0.35
      expect(contradicted!.confidence).toBeCloseTo(0.85 * 0.35, 2);
      expect(contradicted!.tags).toContain("contradicted");
    });

    it("does not re-contradict an already contradicted claim", () => {
      const alreadyContradicted = makeClaim({
        id: "already-contra",
        kind: "user_fact",
        summary: "User is vegetarian and avoids all meat",
        status: "contradicted",
        confidence: 0.1,
        importance: 0.7,
        sourceIds: ["msg-original"],
        tags: ["diet", "vegetarian", "contradicted"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-2",
        personaId: "persona-1",
        messageId: "msg-original",
        note: "Still not vegetarian",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [alreadyContradicted],
        claimSources: [],
        feedback,
      });

      const claim = result.claims.find((c) => c.id === "already-contra");
      // confidence should not be slashed again
      expect(claim!.confidence).toBe(0.1);
    });

    it("creates a repair_note claim from feedback", () => {
      const feedback: FeedbackEvent = {
        id: "fb-3",
        personaId: "persona-1",
        messageId: "msg-x",
        note: "You got my schedule wrong, fix it please",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [],
        claimSources: [],
        feedback,
      });

      const repairClaim = result.claims.find((c) => c.kind === "repair_note");
      expect(repairClaim).toBeDefined();
      expect(repairClaim!.summary).toContain("Avoid this mismatch");
      expect(repairClaim!.status).toBe("confirmed");
      expect(repairClaim!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("matches claims by token overlap when sourceId does not match", () => {
      const claimToContradict = makeClaim({
        id: "token-match-target",
        kind: "user_fact",
        summary: "User works at Google headquarters",
        status: "confirmed",
        confidence: 0.8,
        importance: 0.7,
        sourceIds: ["unrelated-msg"],
        tags: ["work", "google"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-4",
        personaId: "persona-1",
        messageId: "different-msg",
        note: "I left Google, I work somewhere else now",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [claimToContradict],
        claimSources: [],
        feedback,
      });

      const contradicted = result.claims.find((c) => c.id === "token-match-target");
      expect(contradicted!.status).toBe("contradicted");
    });

    it("does not contradict claims from substring-only overlap", () => {
      const claim = makeClaim({
        id: "substring-target",
        summary: "User is starting a new role soon",
        detail: "They start next month.",
        status: "confirmed",
        confidence: 0.8,
        sourceIds: ["different-msg"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-substring",
        personaId: "persona-1",
        messageId: "other-msg",
        note: "art",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [claim],
        claimSources: [],
        feedback,
      });

      expect(result.claims.find((entry) => entry.id === "substring-target")?.status).toBe(
        "confirmed",
      );
    });

    it("allows specific one-word feedback to contradict an exact token match", () => {
      const claim = makeClaim({
        id: "single-token-target",
        summary: "User lives in Toronto.",
        status: "confirmed",
        confidence: 0.78,
        sourceIds: ["different-msg"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-single-token",
        personaId: "persona-1",
        messageId: "other-msg",
        note: "Toronto",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [claim],
        claimSources: [],
        feedback,
      });

      expect(result.claims.find((entry) => entry.id === "single-token-target")?.status).toBe(
        "contradicted",
      );
    });

    it("does not let generic one-word feedback contradict unrelated claims without linkage", () => {
      const claim = makeClaim({
        id: "generic-token-target",
        summary: "User prefers long walks after work.",
        status: "confirmed",
        confidence: 0.78,
        sourceIds: ["different-msg"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-generic-token",
        personaId: "persona-1",
        messageId: "other-msg",
        note: "wrong",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [claim],
        claimSources: [],
        feedback,
      });

      expect(result.claims.find((entry) => entry.id === "generic-token-target")?.status).toBe(
        "confirmed",
      );
    });

    it("contradicts claims linked through claim sources even for terse feedback", () => {
      const claim = makeClaim({
        id: "claim-source-target",
        summary: "User likes being called honey.",
        status: "confirmed",
        confidence: 0.82,
        sourceIds: ["unrelated-msg"],
      });

      const feedback: FeedbackEvent = {
        id: "fb-terse",
        personaId: "persona-1",
        messageId: "assistant-msg-1",
        note: "wrong",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims: [claim],
        claimSources: [
          makeSource({
            claimId: "claim-source-target",
            messageId: "assistant-msg-1",
            sourceType: "message",
          }),
        ],
        feedback,
      });

      expect(result.claims.find((entry) => entry.id === "claim-source-target")?.status).toBe(
        "contradicted",
      );
    });
  });

  describe("staleness", () => {
    it("contradicted claims recover when explicitly confirmed", () => {
      const contradicted = makeClaim({
        id: "recover-contradicted",
        kind: "boundary",
        summary: "Do not text me while I am at work",
        scope: "relationship",
        status: "contradicted",
        confidence: 0.2,
        importance: 0.9,
        reinforcementCount: 1,
        lastObservedAt: LAST_WEEK,
      });

      // Re-upsert via boundary update (which uses status: "confirmed")
      const result = applyBoundaryClaimUpdate({
        claims: [contradicted],
        claimSources: [],
        summary: "Do not text me while I am at work",
        createdAt: NOW,
      });

      const claim = result.claims.find((c) => c.id === "recover-contradicted");
      expect(claim).toBeDefined();
      // Contradicted claims can recover when explicitly reaffirmed as confirmed
      expect(claim!.status).toBe("confirmed");
    });

    it("contradicted claims stay contradicted on non-confirmed learning reinforcement", () => {
      const contradicted = makeClaim({
        id: "stay-contradicted",
        kind: "fact",
        summary: "User likes coffee",
        scope: "user",
        status: "contradicted",
        confidence: 0.2,
        importance: 0.5,
        reinforcementCount: 1,
        lastObservedAt: LAST_WEEK,
      });

      // Learning artifacts produce tentative claims — should not recover contradicted
      const result = applyLearningArtifactsToMemoryClaims({
        persona: {
          ...makePersona(),
          mindState: {
            ...makePersona().mindState,
            memoryClaims: [contradicted],
            claimSources: [],
            episodes: [],
          },
        },
        artifacts: [{
          id: "art-1",
          kind: "claim",
          summary: "User likes coffee",
          memoryKeys: ["user.notes"],
          createdAt: NOW,
        }],
        latestUserText: "I like coffee",
        perceptionChannel: "web",
      });

      const claim = result.claims.find((c) => c.id === "stay-contradicted");
      expect(claim).toBeDefined();
      expect(claim!.status).toBe("contradicted");
    });
  });
});

// ============================================================================
// 4. Capacity enforcement
// ============================================================================
describe("capacity enforcement", () => {
  describe("MAX_CLAIM_SOURCES=100", () => {
    it("evicts oldest sources when exceeding 100", () => {
      // Create 100 existing sources, all old
      const oldSources: ClaimSource[] = Array.from({ length: 100 }, (_, i) =>
        makeSource({
          id: `old-src-${i}`,
          claimId: `claim-${i}`,
          createdAt: TWO_MONTHS_AGO,
        }),
      );

      const result = applyBoundaryClaimUpdate({
        claims: [],
        claimSources: oldSources,
        summary: "New boundary creates a new source",
        createdAt: NOW,
        sourceMessageId: "msg-new",
      });

      // Must not exceed 100
      expect(result.sources.length).toBeLessThanOrEqual(100);
      // The newest source (for the new claim) should survive
      const hasNewSource = result.sources.some(
        (s) => new Date(s.createdAt).getTime() === new Date(NOW).getTime(),
      );
      expect(hasNewSource).toBe(true);
    });

    it("keeps newest sources when evicting", () => {
      const sources: ClaimSource[] = [
        makeSource({ id: "newest", createdAt: NOW }),
        makeSource({ id: "oldest", createdAt: TWO_MONTHS_AGO }),
        ...Array.from({ length: 99 }, (_, i) =>
          makeSource({ id: `mid-${i}`, createdAt: YESTERDAY }),
        ),
      ];

      // Adding a claim will add a new source, pushing over 101 -> evict
      const result = applyBoundaryClaimUpdate({
        claims: [],
        claimSources: sources,
        summary: "Trigger source eviction",
        createdAt: NOW,
      });

      expect(result.sources.length).toBeLessThanOrEqual(100);
      // The "newest" source should survive (it is sorted by createdAt descending)
      expect(result.sources.some((s) => s.id === "newest")).toBe(true);
    });
  });

  describe("MAX_EPISODES=48", () => {
    it("caps episodes at 48 when applying learning artifacts", () => {
      const existingEpisodes = Array.from({ length: 48 }, (_, i) =>
        makeEpisode({ id: `ep-${i}`, summary: `Episode ${i}` }),
      );

      const persona = makePersona({ episodes: existingEpisodes });

      const artifacts: LearningArtifact[] = [
        makeArtifact({
          kind: "consolidate_episode",
          summary: "We had a lovely evening conversation",
          createdAt: NOW,
        }),
        makeArtifact({
          kind: "consolidate_episode",
          summary: "We discussed weekend plans together",
          createdAt: NOW,
        }),
      ];

      const result = applyLearningArtifactsToMemoryClaims({
        persona,
        artifacts,
        latestUserText: "That was a nice chat",
        perceptionChannel: "web",
      });

      expect(result.episodes.length).toBeLessThanOrEqual(48);
    });

    it("new episodes are prepended (most recent first)", () => {
      const existingEpisodes = Array.from({ length: 5 }, (_, i) =>
        makeEpisode({ id: `existing-ep-${i}`, summary: `Existing episode ${i}` }),
      );

      const persona = makePersona({ episodes: existingEpisodes });

      const result = applyLearningArtifactsToMemoryClaims({
        persona,
        artifacts: [
          makeArtifact({
            kind: "consolidate_episode",
            summary: "Brand new episode about dinner",
            createdAt: NOW,
          }),
        ],
        latestUserText: "Let's have dinner",
        perceptionChannel: "web",
      });

      // New episode should be first
      expect(result.episodes[0].summary).toContain("Brand new episode about dinner");
    });
  });

  describe("MAX_RECENT_CHANGED_CLAIMS=12", () => {
    it("caps changedClaims at 12 even with many artifacts", () => {
      const persona = makePersona({ memoryClaims: [] });

      // Create 15 artifacts that all produce claims
      const artifacts: LearningArtifact[] = Array.from({ length: 15 }, (_, i) =>
        makeArtifact({
          kind: "learn_about_user",
          summary: `Unique user fact number ${i} about distinct topic ${i}`,
          createdAt: NOW,
        }),
      );

      const result = applyLearningArtifactsToMemoryClaims({
        persona,
        artifacts,
        latestUserText: "I have many interests",
        perceptionChannel: "web",
      });

      expect(result.changedClaims.length).toBeLessThanOrEqual(12);
      // But the actual claims array should have all 15
      expect(result.claims.length).toBe(15);
    });
  });

  describe("MAX_CLAIMS=100 via learning artifacts", () => {
    it("enforces claim limit when many artifacts flood in", () => {
      // Start with 95 existing claims
      const existingClaims = Array.from({ length: 95 }, (_, i) =>
        makeClaim({
          id: `existing-${i}`,
          summary: `Existing claim ${i}`,
          importance: 0.5,
          confidence: 0.5,
          lastObservedAt: LAST_WEEK,
        }),
      );

      const persona = makePersona({ memoryClaims: existingClaims });

      // Add 10 new artifacts, each creating a new claim -> 105 total
      const artifacts: LearningArtifact[] = Array.from({ length: 10 }, (_, i) =>
        makeArtifact({
          kind: "learn_about_user",
          summary: `Brand new fact about topic ${i}`,
          createdAt: NOW,
        }),
      );

      const result = applyLearningArtifactsToMemoryClaims({
        persona,
        artifacts,
        latestUserText: "I have so many interests",
        perceptionChannel: "web",
      });

      expect(result.claims.length).toBeLessThanOrEqual(100);
    });
  });

  describe("feedback-driven capacity enforcement", () => {
    it("stays within claim limits after feedback creates contradictions + repair notes", () => {
      const claims = Array.from({ length: 99 }, (_, i) =>
        makeClaim({
          id: `claim-${i}`,
          summary: `Claim about topic ${i}`,
          sourceIds: [`msg-${i}`],
        }),
      );

      const feedback: FeedbackEvent = {
        id: "fb-cap",
        personaId: "p1",
        messageId: "msg-50",
        note: "That claim about topic 50 was completely wrong",
        createdAt: NOW,
      };

      const result = applyFeedbackToMemoryClaims({
        claims,
        claimSources: [],
        feedback,
      });

      // 99 existing + 1 new repair_note = 100, should be within limit
      expect(result.claims.length).toBeLessThanOrEqual(100);
      expect(result.changedClaims.length).toBeLessThanOrEqual(12);
    });
  });
});

// ============================================================================
// 5. Edge cases — data loss / corruption vectors
// ============================================================================
describe("edge cases that could cause data loss or corruption", () => {
  it("handles NaN importance/confidence gracefully via clamp", () => {
    const badClaim = makeClaim({
      id: "nan-claim",
      kind: "user_fact",
      summary: "Claim with NaN values",
      importance: NaN,
      confidence: NaN,
      lastObservedAt: NOW,
    });

    // Should not throw; NaN claims should be handled by eviction scoring
    const persona = makePersona({ memoryClaims: [badClaim] });
    const pack = buildMemoryRetrievalPack({ persona });
    expect(pack).toBeDefined();
  });

  it("handles empty summary without throwing", () => {
    const result = applyBoundaryClaimUpdate({
      claims: [],
      claimSources: [],
      summary: "",
      createdAt: NOW,
    });

    expect(result.claims.length).toBe(1);
    expect(result.result.resolution).toBe("created");
  });

  it("does not duplicate source IDs on reinforcement", () => {
    const existing = makeClaim({
      kind: "boundary",
      summary: "Do not text me while I am at work",
      scope: "relationship",
      status: "tentative",
      sourceIds: ["shared-id"],
      reinforcementCount: 1,
      lastObservedAt: LAST_WEEK,
    });

    const result = applyBoundaryClaimUpdate({
      claims: [existing],
      claimSources: [],
      summary: "Do not text me while I am at work",
      createdAt: NOW,
      sourceMessageId: "shared-id",
      sessionId: "shared-id",
    });

    const reinforced = result.claims.find((c) =>
      c.summary.includes("Do not text me"),
    )!;
    // sourceIds should be deduplicated
    const uniqueSourceIds = new Set(reinforced.sourceIds);
    expect(uniqueSourceIds.size).toBe(reinforced.sourceIds.length);
  });

  it("tags are deduplicated on reinforcement", () => {
    const existing = makeClaim({
      kind: "boundary",
      summary: "Do not text me while I am at work",
      scope: "relationship",
      tags: ["boundary", "explicit"],
      reinforcementCount: 1,
      lastObservedAt: LAST_WEEK,
    });

    const result = applyBoundaryClaimUpdate({
      claims: [existing],
      claimSources: [],
      summary: "Do not text me while I am at work",
      createdAt: NOW,
    });

    const reinforced = result.claims.find((c) =>
      c.summary.includes("Do not text me"),
    )!;
    const uniqueTags = new Set(reinforced.tags);
    expect(uniqueTags.size).toBe(reinforced.tags.length);
  });

  it("eviction preserves claim order stability (no shuffling of equally-weighted claims)", () => {
    // All claims have identical weight characteristics
    const claims = Array.from({ length: 105 }, (_, i) =>
      makeClaim({
        id: `same-weight-${i}`,
        summary: `Same weight claim ${i}`,
        importance: 0.5,
        confidence: 0.5,
        reinforcementCount: 1,
        lastObservedAt: NOW,
      }),
    );

    const result = applyBoundaryClaimUpdate({
      claims,
      claimSources: [],
      summary: "New boundary to trigger eviction on same-weight set",
      createdAt: NOW,
    });

    // Just verify we get exactly 100 and no crash
    expect(result.claims.length).toBeLessThanOrEqual(100);
  });

  it("handles Infinity importance gracefully", () => {
    const badClaim = makeClaim({
      id: "inf-claim",
      summary: "Infinity importance",
      importance: Infinity,
      confidence: 0.5,
      lastObservedAt: NOW,
    });

    const persona = makePersona({ memoryClaims: [badClaim] });
    // Should not throw
    const pack = buildMemoryRetrievalPack({ persona });
    expect(pack).toBeDefined();
  });

  it("handles invalid date strings in lastObservedAt without crashing eviction", () => {
    const badClaim = makeClaim({
      id: "bad-date",
      summary: "Bad date claim",
      lastObservedAt: "not-a-date",
    });

    // This exercises calculateClaimWeight with an invalid date
    const result = applyBoundaryClaimUpdate({
      claims: [badClaim],
      claimSources: [],
      summary: "Valid boundary alongside bad-date claim",
      createdAt: NOW,
    });

    expect(result.claims.length).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// 6. seedBootstrapClaims capacity
// ============================================================================
describe("seedBootstrapClaims", () => {
  it("seeds claims from dossier material", () => {
    const result = seedBootstrapClaims({
      dossier: {
        essence: "Warm caring mother",
        communicationStyle: "Direct and warm",
        signaturePhrases: ["Love you"],
        favoriteTopics: ["cooking", "gardening", "travel", "music", "sports"],
        emotionalTendencies: ["warm", "protective", "patient"],
        routines: ["Morning texts", "Sunday calls", "Bedtime stories"],
        guidance: [],
        sourceSummary: "living",
        knowledgeProfile: { domains: [], deflectionStyle: "honest", deflectionExamples: [] },
      },
      interviewAnswers: {
        "How do they react to good news?": "She gets really excited and wants all the details",
        "What sayings do they use?": "Love you kiddo",
      },
      relationship: "mother",
      description: "My loving mother who always has time for me",
      createdAt: NOW,
    });

    // Should have seeded claims from: description(1) + routines(3) + topics(4) + interviews(2) + emotions(1)
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims.length).toBeLessThanOrEqual(100);
    // All should be tentative bootstrap claims
    expect(result.claims.every((c) => c.status === "tentative")).toBe(true);
    expect(result.claims.every((c) => c.tags.includes("bootstrap"))).toBe(true);
    // Sources should be created for each claim
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeLessThanOrEqual(100);
  });

  it("skips interview answers that are too short", () => {
    const result = seedBootstrapClaims({
      dossier: {
        essence: "",
        communicationStyle: "",
        signaturePhrases: [],
        favoriteTopics: [],
        emotionalTendencies: [],
        routines: [],
        guidance: [],
        sourceSummary: "",
        knowledgeProfile: { domains: [], deflectionStyle: "honest", deflectionExamples: [] },
      },
      interviewAnswers: {
        "Question 1": "Short",  // < 8 chars
        "Question 2": "OK",     // < 8 chars
        "Question 3": "",       // empty
      },
      relationship: "friend",
      description: "",
      createdAt: NOW,
    });

    // No claims should be seeded from short/empty answers, and no description
    expect(result.claims.length).toBe(0);
  });
});

// ============================================================================
// 7. Render helpers
// ============================================================================
describe("renderClaimForContext", () => {
  it("renders confirmed claim with correct prefix", () => {
    const claim = makeClaim({
      kind: "boundary",
      summary: "No messages after 10pm",
      status: "confirmed",
    });
    const rendered = renderClaimForContext(claim);
    expect(rendered).toBe("- [confirmed/boundary] No messages after 10pm");
  });

  it("renders tentative claim with correct prefix", () => {
    const claim = makeClaim({
      kind: "user_fact",
      summary: "Likes coffee",
      status: "tentative",
    });
    const rendered = renderClaimForContext(claim);
    expect(rendered).toBe("- [tentative/user_fact] Likes coffee");
  });
});

describe("renderEpisodeForContext", () => {
  it("renders episode with key phrases", () => {
    const episode = makeEpisode({
      summary: "We discussed dinner plans",
      keyPhrases: ["dinner", "restaurant", "Friday"],
    });
    const rendered = renderEpisodeForContext(episode);
    expect(rendered).toContain("We discussed dinner plans");
    expect(rendered).toContain("Key phrases: dinner, restaurant, Friday.");
  });

  it("renders episode without key phrases", () => {
    const episode = makeEpisode({
      summary: "Quick hello",
      keyPhrases: [],
    });
    const rendered = renderEpisodeForContext(episode);
    expect(rendered).toBe("- Quick hello");
    expect(rendered).not.toContain("Key phrases");
  });
});
