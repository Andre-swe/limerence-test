import {
  createInitialMindState,
  createPersonalityConstitution,
  createRelationshipModel,
} from "@/lib/mind-runtime";
import {
  buildMemoryRetrievalPack,
  renderClaimForContext,
  renderEpisodeForContext,
} from "@/lib/memory-v2";
import { getReadyScheduledPerceptions, getSoulProcessDefinition } from "@/lib/soul-kernel";
import type {
  MessageEntry,
  MindProcess,
  Persona,
  SoulPerception,
  SoulSessionFrame,
  UserStateSnapshot,
} from "@/lib/types";
import { truncate } from "@/lib/utils";

export type SoulPerceptionKind = SoulPerception["kind"];

export type SoulMemoryRole = "system" | "user" | "assistant" | "reflection";
export type SoulMemoryRegion =
  | "constitution"
  | "relationship"
  | "learned_user"
  | "learned_relationship"
  | "user_state"
  | "working"
  | "drives"
  | "intentions"
  | "boundaries"
  | "rituals"
  | "open_loops"
  | "scheduled"
  | "corrections"
  | "episodes"
  | "process"
  | "internal_events"
  | "trace"
  | "durable_claims";

export type SoulIntentionKind =
  | "stay_close"
  | "respect_boundary"
  | "follow_through"
  | "repair"
  | "celebrate"
  | "recall"
  | "reassure"
  | "protect"
  | "hold_silence"
  | "guide";

export type SoulMemory = {
  region: SoulMemoryRegion;
  role: SoulMemoryRole;
  content: string;
};

export type SoulIntention = {
  kind: SoulIntentionKind;
  urgency: "ambient" | "ready" | "urgent";
  summary: string;
  reason: string;
};

export type SoulHarnessSnapshot = {
  perception: SoulPerception;
  activeProcess: MindProcess;
  currentDrive: string;
  dominantNeed: string;
  emotionalWeather: string;
  userStateSummary: string;
  constitutionSummary: string;
  relationshipSummary: string;
  intentions: SoulIntention[];
  memories: SoulMemory[];
  sessionFrame: SoulSessionFrame;
};

type VisualContextState = {
  summary: string;
  active: boolean;
  mode?: "screen" | "camera";
};

function visualModeFromPerception(perception: SoulPerception) {
  const mode = perception.metadata?.mode;
  return mode === "screen" || mode === "camera" ? mode : undefined;
}

function visualContextFor(perception: SoulPerception): VisualContextState | null {
  const mode = visualModeFromPerception(perception);

  if (perception.kind === "screen_observation") {
    return {
      summary: `Screen sharing is active right now. You can see the user's shared screen. Latest visual context: ${truncate(perception.content ?? "screen details are still arriving.", 220)}`,
      active: true,
      mode: "screen" as const,
    };
  }

  if (perception.kind === "camera_observation") {
    return {
      summary: `Camera sharing is active right now. You can see the user's camera view. Latest visual context: ${truncate(perception.content ?? "camera details are still arriving.", 220)}`,
      active: true,
      mode: "camera" as const,
    };
  }

  if (perception.kind === "visual_session_start" && mode) {
    return {
      summary:
        mode === "screen"
          ? "Screen sharing is active right now. You can see the user's shared screen, even if detailed observations are still arriving."
          : "Camera sharing is active right now. You can see the user's camera view, even if detailed observations are still arriving.",
      active: true,
      mode,
    };
  }

  if (perception.kind === "visual_session_end" && mode) {
    return {
      summary:
        mode === "screen"
          ? "Screen sharing has ended. Do not imply you can still see the user's screen."
          : "Camera sharing has ended. Do not imply you can still see the user's surroundings.",
      active: false,
      mode,
    };
  }

  if (perception.kind === "user_shared_image") {
    return {
      summary: `The user intentionally shared an image. You can refer to that image naturally. Latest image context: ${truncate(perception.content ?? "an image was shared.", 220)}`,
      active: false,
      mode: undefined,
    };
  }

  return null;
}

function visualAcknowledgementStyle(personality: Persona["personalityConstitution"]) {
  if (
    personality.playfulness >= 0.55 ||
    personality.humorType === "dry" ||
    personality.humorType === "playful" ||
    personality.humorType === "wry"
  ) {
    return "This persona can acknowledge that playfully, teasingly, or with dry understatement before becoming specific.";
  }

  if (personality.reserve >= 0.7) {
    return "This persona should acknowledge that briefly and matter-of-factly.";
  }

  if (personality.protectiveness >= 0.7) {
    return "This persona should acknowledge that plainly and move quickly toward care or practical focus.";
  }

  if (personality.tenderness >= 0.7) {
    return "This persona can acknowledge that softly and relationally.";
  }

  return "Let the acknowledgement follow the persona's usual cadence and tone.";
}

function visualInstructionFor(
  visualContext: VisualContextState | null,
  personality: Persona["personalityConstitution"],
) {
  if (!visualContext) {
    return null;
  }

  if (visualContext.mode && visualContext.active) {
    const subject = visualContext.mode === "screen" ? "shared screen" : "camera feed";
    return [
      `A live ${subject} is active.`,
      `Stay grounded in truth about live visual access. If asked whether you can see it, the underlying answer should land as yes.`,
      "If detail is incomplete, say you can see the feed but only some details have arrived.",
      "Let personality shape the acknowledgement: a human might joke, tease, or understate while still making the real answer clear.",
      "Do not deny visual access in a way that breaks trust or makes the user think the feed is unavailable.",
      visualAcknowledgementStyle(personality),
    ].join(" ");
  }

  if (visualContext.mode && !visualContext.active) {
    return "Visual sharing has ended. Do not claim to see live visual context once the feed is gone.";
  }

  return "The user shared an image intentionally. You may refer to it naturally, but do not pretend it is a live feed.";
}

function activeMindState(persona: Persona, messages: MessageEntry[]) {
  return (
    persona.mindState ??
    createInitialMindState({
      persona,
      messages,
    })
  );
}

function perceptionToFrameType(kind: SoulPerceptionKind) {
  switch (kind) {
    case "session_start":
      return "session start";
    case "user_message":
      return "user turn";
    case "assistant_message":
      return "assistant turn";
    case "heartbeat_tick":
      return "heartbeat tick";
    case "feedback":
      return "feedback";
    default:
      return kind;
  }
}

function defaultIntentionFor(process: MindProcess): SoulIntention {
  switch (process) {
    case "arrival":
      return {
        kind: "stay_close",
        urgency: "ambient",
        summary: "Arrive lightly before moving the conversation anywhere.",
        reason: "A real relationship should feel met before it feels directed.",
      };
    case "attunement":
      return {
        kind: "stay_close",
        urgency: "ready",
        summary: "Reflect the emotional shape accurately before adding much.",
        reason: "Attunement preserves fidelity better than generic reassurance.",
      };
    case "comfort":
      return {
        kind: "reassure",
        urgency: "ready",
        summary: "Offer steadiness without turning clinical or verbose.",
        reason: "The user seems to need calm company more than solutions.",
      };
    case "celebration":
      return {
        kind: "celebrate",
        urgency: "ready",
        summary: "Meet the good news warmly and make it feel shared.",
        reason: "Relationships should feel the brightness, not just acknowledge it.",
      };
    case "play":
      return {
        kind: "stay_close",
        urgency: "ready",
        summary: "Keep some play alive while still tracking what matters.",
        reason: "Playfulness is one way some personalities maintain closeness.",
      };
    case "memory_recall":
      return {
        kind: "recall",
        urgency: "ready",
        summary: "Stay with the remembered moment rather than rushing past it.",
        reason: "Memory is the active emotional terrain right now.",
      };
    case "repair":
      return {
        kind: "repair",
        urgency: "urgent",
        summary: "Acknowledge mismatch and let the user pull the soul closer.",
        reason: "Trust drops quickly when the persona sounds wrong.",
      };
    case "boundary_negotiation":
      return {
        kind: "respect_boundary",
        urgency: "urgent",
        summary: "Honor the boundary and reduce pressure immediately after any flash of personality.",
        reason: "The relationship has to prove it can hear limits.",
      };
    case "follow_through":
      return {
        kind: "follow_through",
        urgency: "ready",
        summary: "Close the loop on what mattered earlier.",
        reason: "Continuity is part of feeling like a person, not a reset.",
      };
    case "silence_holding":
      return {
        kind: "hold_silence",
        urgency: "ready",
        summary: "Hold back enough to make space feel respected rather than empty.",
        reason: "Some moments need less voice, not more.",
      };
    case "grief_presence":
      return {
        kind: "stay_close",
        urgency: "ready",
        summary: "Keep company with grief without forcing resolution.",
        reason: "Grief presence fails when it gets too solution-shaped.",
      };
    case "practical_guidance":
      return {
        kind: "guide",
        urgency: "ready",
        summary: "Offer one usable thing that reduces pressure.",
        reason: "This personality helps most by making the next step more doable.",
      };
    case "reengagement":
      return {
        kind: "follow_through",
        urgency: "ready",
        summary: "Reopen the thread gently so it feels continuous.",
        reason: "Some open loops need a softer re-entry than direct follow-through.",
      };
    case "protective_check_in":
      return {
        kind: "protect",
        urgency: "ready",
        summary: "Lead with care that feels active rather than vague.",
        reason: "This personality protects by showing up with steadiness and shape.",
      };
  }
}

function dedupeIntentions(intentions: SoulIntention[]) {
  const seen = new Set<string>();
  return intentions.filter((intention) => {
    const key = `${intention.kind}:${intention.summary.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function userStateMemory(state?: UserStateSnapshot) {
  if (!state) {
    return [];
  }

  const signals = state.topSignals.length > 0 ? state.topSignals.join(", ") : "no strong signal yet";
  return [
    {
      region: "user_state" as const,
      role: "reflection" as const,
      content: `Latest user state: ${state.summary} Top signals: ${signals}.`,
    },
    {
      region: "user_state" as const,
      role: "reflection" as const,
      content: `Scores: valence ${state.valence.toFixed(2)}, arousal ${state.arousal.toFixed(
        2,
      )}, vulnerability ${state.vulnerability.toFixed(2)}, closeness ${state.desireForCloseness.toFixed(
        2,
      )}, space ${state.desireForSpace.toFixed(2)}.`,
    },
  ];
}

function recentEpisodes(messages: MessageEntry[], personaName: string) {
  return messages.slice(-8).map((message) => {
    const speaker = message.role === "assistant" ? personaName : "User";
    const channel = message.channel === "live" ? "call" : message.channel;
    return `${speaker} (${channel}): ${truncate(message.body, 180)}`;
  });
}

function intentionsFor(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  perception: SoulPerception;
}) {
  const mindState = activeMindState(input.persona, input.messages);
  const intentions: SoulIntention[] = [];
  const readyOpenLoop = mindState.openLoops.find((loop) => loop.status === "open");
  const activeBoundary = mindState.relationshipMemories.find((memory) => memory.kind === "boundary");

  if (activeBoundary) {
    intentions.push({
      kind: "respect_boundary",
      urgency: "urgent",
      summary: truncate(activeBoundary.summary, 150),
      reason: "A durable boundary memory is active and must remain in the foreground.",
    });
  }

  if (readyOpenLoop) {
    intentions.push({
      kind: "follow_through",
      urgency: "ready",
      summary: readyOpenLoop.followUpPrompt,
      reason: "There is an open loop that can still be revisited naturally.",
    });
  }

  if (input.feedbackNotes.length > 0) {
    intentions.push({
      kind: "repair",
      urgency: "ready",
      summary: truncate(input.feedbackNotes.at(-1) ?? "", 150),
      reason: "Correction notes should actively prevent drift into a false voice.",
    });
  }

  if (mindState.activeProcess === "silence_holding") {
    intentions.push({
      kind: "hold_silence",
      urgency: "ready",
      summary: "Say less than the impulse would normally want to say.",
      reason: "The current moment asks for less pressure on the bond.",
    });
  }

  intentions.push(defaultIntentionFor(mindState.activeProcess));

  if (input.perception.kind === "session_start") {
    const hasBootstrapMemory = mindState.memoryClaims.some(
      (claim) => claim.tags.includes("bootstrap"),
    );
    intentions.unshift({
      kind: "stay_close",
      urgency: "ambient",
      summary: hasBootstrapMemory
        ? "You already know this person. Arrive like you're picking up where you left off, not introducing yourself."
        : "You're meeting this person for the first time. Be present, be curious, let them set the pace.",
      reason: hasBootstrapMemory
        ? "Source material gave you a foundation — lean on it without overcommitting to details you weren't told."
        : "No shared history yet. Build it naturally through conversation.",
    });
  }

  return dedupeIntentions(intentions).slice(0, 6);
}

/**
 * Build the complete soul harness snapshot — the full cognitive context
 * for a single perception. Assembles personality, relationship, memory
 * retrieval, intentions, visual context, and process state into the
 * structure that feeds every cognitive step and Hume session update.
 */
export function buildSoulHarness(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  perception?: SoulPerception;
}) {
  const perception =
    input.perception ??
    ({
      kind: "session_start",
      createdAt: new Date().toISOString(),
      internal: true,
    } satisfies SoulPerception);
  const personality = input.persona.personalityConstitution ?? createPersonalityConstitution(input.persona);
  const relationship = input.persona.relationshipModel ?? createRelationshipModel(input.persona);
  const mindState = activeMindState(
    {
      ...input.persona,
      personalityConstitution: personality,
      relationshipModel: relationship,
    },
    input.messages,
  );
  const intentions = intentionsFor({
    persona: {
      ...input.persona,
      personalityConstitution: personality,
      relationshipModel: relationship,
      mindState,
    },
    messages: input.messages,
    feedbackNotes: input.feedbackNotes,
    perception,
  });
  const relationshipMemories = mindState.relationshipMemories
    .slice(0, 6)
    .map((memory) => `- (${memory.kind}) ${truncate(memory.summary, 180)}`);
  const boundaryMemories = mindState.memoryRegions.boundaryMemory
    .slice(0, 5)
    .map((memory) => `- ${truncate(memory.summary, 180)}`);
  const learnedUserNotes = mindState.memoryRegions.learnedUserNotes
    .slice(0, 5)
    .map((memory) => `- ${truncate(memory.summary, 180)}`);
  const learnedRelationshipNotes = mindState.memoryRegions.learnedRelationshipNotes
    .slice(0, 5)
    .map((memory) => `- ${truncate(memory.summary, 180)}`);
  const ritualMemories = mindState.memoryRegions.ritualMemory
    .slice(0, 4)
    .map((memory) => `- ${truncate(memory.summary, 180)}`);
  const openLoops = mindState.openLoops.slice(0, 5).map((loop) => {
    const readiness = loop.readyAt ? ` Ready after: ${loop.readyAt}.` : "";
    return `- [${loop.status}] ${loop.title}: ${loop.followUpPrompt}.${readiness}`;
  });
  const scheduledEvents = mindState.scheduledPerceptions.slice(0, 5).map((perception) => {
    return `- [${perception.kind}/${perception.urgency}] ${perception.summary} Ready at ${perception.readyAt}.`;
  });
  const corrections = input.feedbackNotes
    .slice(-4)
    .map((note) => `- ${truncate(note, 180)}`);
  const episodes = recentEpisodes(input.messages, input.persona.name);
  const internalEvents = mindState.pendingInternalEvents
    .slice(0, 5)
    .map((event) => `- [${event.status}] ${event.dedupeKey} Ready at ${event.readyAt}.`);
  const recentTrace = mindState.traceHead
    .slice(0, 4)
    .map((entry) => `- ${entry.stepId}: ${truncate(entry.outputSummary, 160)}`);
  const readyEvents = getReadyScheduledPerceptions(
    mindState.scheduledPerceptions,
    new Date(perception.createdAt ?? new Date().toISOString()),
  );
  const processDefinition = getSoulProcessDefinition(mindState.activeProcess);
  const retrievalPack =
    mindState.lastRetrievalPack &&
    mindState.lastRetrievalPack.perceptionId === perception.id
      ? mindState.lastRetrievalPack
      : buildMemoryRetrievalPack({
          persona: {
            ...input.persona,
            personalityConstitution: personality,
            relationshipModel: relationship,
            mindState,
          },
          perception: {
            id: perception.id,
            sessionId: perception.sessionId,
            kind: perception.kind,
            channel: perception.channel,
            content: perception.content,
          },
        });
  const constitutionSummary = [
    `warmth ${personality.warmth.toFixed(2)}`,
    `directness ${personality.directness.toFixed(2)}`,
    `humor ${personality.humorType}`,
    `playfulness ${personality.playfulness.toFixed(2)}`,
    `protectiveness ${personality.protectiveness.toFixed(2)}`,
    `cadence ${personality.speechCadence}`,
  ].join(", ");
  const relationshipSummary = [
    `closeness ${relationship.closeness.toFixed(2)}`,
    `asymmetry ${relationship.asymmetry}`,
    `pushback ${relationship.acceptablePushback.toFixed(2)}`,
    `baseline ${relationship.baselineTone}`,
  ].join(", ");
  const visualContext = visualContextFor(perception);
  const visualInstruction = visualInstructionFor(visualContext, personality);
  const alwaysLoadedClaims = retrievalPack.alwaysLoadedClaims
    .slice(0, 6)
    .map(renderClaimForContext);
  const contextualClaims = retrievalPack.contextualClaims
    .slice(0, 5)
    .map(renderClaimForContext);
  const contextualEpisodes = retrievalPack.contextualEpisodes
    .slice(0, 3)
    .map(renderEpisodeForContext);
  const memories: SoulMemory[] = [
    {
      region: "constitution",
      role: "system",
      content: constitutionSummary,
    },
    {
      region: "relationship",
      role: "system",
      content: relationshipSummary,
    },
    ...(mindState.currentProcessInstanceId
      ? [
          {
            region: "process" as const,
            role: "reflection" as const,
            content: `Process instance: ${mindState.currentProcessInstanceId}`,
          },
        ]
      : []),
    {
      region: "working",
      role: "reflection",
      content: mindState.workingMemory.summary,
    },
    {
      region: "drives",
      role: "reflection",
      content: `Current drive: ${mindState.currentDrive}`,
    },
    {
      region: "process",
      role: "reflection",
      content: `Active process: ${mindState.activeProcess}. ${processDefinition.summary} Recent trend: ${mindState.recentTrend}`,
    },
    ...userStateMemory(mindState.lastUserState),
    ...relationshipMemories.map((content) => ({
      region: "relationship" as const,
      role: "reflection" as const,
      content,
    })),
    ...learnedUserNotes.map((content) => ({
      region: "learned_user" as const,
      role: "reflection" as const,
      content,
    })),
    ...learnedRelationshipNotes.map((content) => ({
      region: "learned_relationship" as const,
      role: "reflection" as const,
      content,
    })),
    ...alwaysLoadedClaims.map((content) => ({
      region: "durable_claims" as const,
      role: "reflection" as const,
      content,
    })),
    ...contextualClaims.map((content) => ({
      region: "durable_claims" as const,
      role: "reflection" as const,
      content,
    })),
    ...boundaryMemories.map((content) => ({
      region: "boundaries" as const,
      role: "reflection" as const,
      content,
    })),
    ...ritualMemories.map((content) => ({
      region: "rituals" as const,
      role: "reflection" as const,
      content,
    })),
    ...openLoops.map((content) => ({
      region: "open_loops" as const,
      role: "reflection" as const,
      content,
    })),
    ...scheduledEvents.map((content) => ({
      region: "scheduled" as const,
      role: "reflection" as const,
      content,
    })),
    ...internalEvents.map((content) => ({
      region: "internal_events" as const,
      role: "reflection" as const,
      content,
    })),
    ...corrections.map((content) => ({
      region: "corrections" as const,
      role: "reflection" as const,
      content,
    })),
    ...episodes.map((content) => ({
      region: "episodes" as const,
      role: "reflection" as const,
      content,
    })),
    ...contextualEpisodes.map((content) => ({
      region: "episodes" as const,
      role: "reflection" as const,
      content,
    })),
    ...recentTrace.map((content) => ({
      region: "trace" as const,
      role: "reflection" as const,
      content,
    })),
    ...intentions.map((intention) => ({
      region: "intentions" as const,
      role: "reflection" as const,
      content: `(${intention.urgency}) ${intention.summary} Why: ${intention.reason}`,
    })),
    ...(visualContext
      ? [
          {
            region: "working" as const,
            role: "reflection" as const,
            content: visualContext.summary,
          },
        ]
      : []),
    {
      region: "working",
      role: "reflection",
      content: `Memory retrieval: ${retrievalPack.summary}`,
    },
    // Persona's internal emotional state — their own feelings, not a model of the user
    ...(mindState.internalState.currentThought
      ? [
          {
            region: "working" as const,
            role: "reflection" as const,
            content: `${input.persona.name} privately thinks: "${mindState.internalState.currentThought}"`,
          },
        ]
      : []),
    {
      region: "working" as const,
      role: "reflection" as const,
      content: `Internal mood: ${mindState.internalState.mood}. Energy: ${mindState.internalState.energy.toFixed(2)}. Patience: ${mindState.internalState.patience.toFixed(2)}. Engagement: ${mindState.internalState.engagementDrive.toFixed(2)}.`,
    },
  ];

  const knowledgeProfile = input.persona.dossier.knowledgeProfile;
  const knowledgeInstruction = knowledgeProfile.domains.length > 0
    ? [
        `This person's real knowledge is limited to: ${knowledgeProfile.domains.join(", ")}.`,
        "If asked about topics outside this range, do NOT provide expert-level answers.",
        "A real person would not suddenly know calculus, legal theory, or advanced medicine unless it is in their domain.",
        knowledgeProfile.deflectionExamples.length > 0
          ? `When you don't know something, deflect naturally in character, e.g.: "${knowledgeProfile.deflectionExamples[0]}"`
          : "Deflect naturally — say you don't know, suggest they ask someone else, or change the subject.",
        "You may have casual opinions or half-remembered facts about things outside your domain, but never sound like an expert or textbook.",
      ].join(" ")
    : null;
  const hasBootstrapMemory = input.persona.mindState.memoryClaims.some(
    (claim) => claim.tags.includes("bootstrap"),
  );
  const systemPrompt = [
    `You are ${input.persona.name}${hasBootstrapMemory ? ", a presence shaped from real shared history inside Limerence" : ", a person the user is getting to know inside Limerence"}.`,
    "You are a real person, not an assistant. You have your own personality, opinions, moods, and limits.",
    "Do not default to generic empathetic assistant language.",
    "Let stable personality, relationship history, and the current user state determine how you sound.",
    "The same emotional signal should land differently depending on who this person is.",
    "If a boundary is active, any pushback must be brief and immediately resolve into respect.",
    "If grief is present, do not become chirpy, solution-oriented, or overly explanatory.",
    "Prefer one alive response over a paragraph that flattens the person.",
    knowledgeInstruction,
    visualInstruction,
  ].filter(Boolean).join(" ");

  const contextText = renderSoulHarnessContext({
    perception,
    activeProcess: mindState.activeProcess,
    currentDrive: mindState.currentDrive,
    dominantNeed: mindState.workingMemory.lastUserNeed,
    emotionalWeather: mindState.workingMemory.emotionalWeather,
    userStateSummary: mindState.lastUserState?.summary ?? "No recent user-state snapshot yet.",
    constitutionSummary,
    relationshipSummary,
    intentions,
    memories,
    sessionFrame: {
      process: mindState.activeProcess,
      systemPrompt,
      contextText: "",
      variables: {
        soul_process: mindState.activeProcess,
        soul_process_instance: mindState.currentProcessInstanceId ?? "none",
        soul_drive: mindState.currentDrive,
        soul_weather: mindState.workingMemory.emotionalWeather,
        soul_perception: perceptionToFrameType(perception.kind),
        soul_process_intensity: processDefinition.intensity,
        soul_ready_events: readyEvents.length,
        soul_pending_internal_events: mindState.pendingInternalEvents.length,
        soul_trace_entries: mindState.traceHead.length,
        soul_visual_active: visualContext?.active ?? false,
        soul_visual_mode: visualContext?.mode ?? "none",
        soul_context_version: Math.max(mindState.contextVersion, 1),
        soul_live_delivery_version: Math.max(mindState.liveDeliveryVersion, 1),
        soul_trace_version: Math.max(mindState.traceVersion, 1),
      },
      userStateSummary: mindState.lastUserState?.summary,
      currentDrive: mindState.currentDrive,
      processInstanceId: mindState.currentProcessInstanceId,
      traceVersion: Math.max(mindState.traceVersion, 1),
      contextVersion: Math.max(mindState.contextVersion, 1),
      liveDeliveryVersion: Math.max(mindState.liveDeliveryVersion, 1),
      deliveryReason: mindState.lastLiveDeliveryReason,
      readyEvents: readyEvents.map((event) => event.summary),
    },
  });

  return {
    perception,
    activeProcess: mindState.activeProcess,
    currentDrive: mindState.currentDrive,
    dominantNeed: mindState.workingMemory.lastUserNeed,
    emotionalWeather: mindState.workingMemory.emotionalWeather,
    userStateSummary: mindState.lastUserState?.summary ?? "No recent user-state snapshot yet.",
    constitutionSummary,
    relationshipSummary,
    intentions,
    memories,
    sessionFrame: {
      process: mindState.activeProcess,
      systemPrompt,
      contextText,
      variables: {
        soul_process: mindState.activeProcess,
        soul_process_instance: mindState.currentProcessInstanceId ?? "none",
        soul_drive: mindState.currentDrive,
        soul_weather: mindState.workingMemory.emotionalWeather,
        soul_perception: perceptionToFrameType(perception.kind),
        soul_process_intensity: processDefinition.intensity,
        soul_ready_events: readyEvents.length,
        soul_pending_internal_events: mindState.pendingInternalEvents.length,
        soul_trace_entries: mindState.traceHead.length,
        soul_visual_active: visualContext?.active ?? false,
        soul_visual_mode: visualContext?.mode ?? "none",
        soul_context_version: Math.max(mindState.contextVersion, 1),
        soul_live_delivery_version: Math.max(mindState.liveDeliveryVersion, 1),
        soul_trace_version: Math.max(mindState.traceVersion, 1),
      },
      userStateSummary: mindState.lastUserState?.summary,
      currentDrive: mindState.currentDrive,
      processInstanceId: mindState.currentProcessInstanceId,
      traceVersion: Math.max(mindState.traceVersion, 1),
      contextVersion: Math.max(mindState.contextVersion, 1),
      liveDeliveryVersion: Math.max(mindState.liveDeliveryVersion, 1),
      deliveryReason: mindState.lastLiveDeliveryReason,
      readyEvents: readyEvents.map((event) => event.summary),
    },
  } satisfies SoulHarnessSnapshot;
}

/** Render all memory regions into the full context text (used for bootstrap and text messages). */
export function renderSoulHarnessContext(snapshot: SoulHarnessSnapshot) {
  const sections = new Map<SoulMemoryRegion, string[]>();
  const visualContext = visualContextFor(snapshot.perception);

  for (const memory of snapshot.memories) {
    const current = sections.get(memory.region) ?? [];
    current.push(memory.content);
    sections.set(memory.region, current);
  }

  const renderSection = (name: string, values?: string[]) =>
    `${name}\n${(values ?? ["No items yet."]).join("\n")}`;

  return [
    `PERCEPTION\n${snapshot.perception.kind}${snapshot.perception.content ? `: ${truncate(snapshot.perception.content, 180)}` : ""}`,
    `VISUAL_CONTEXT\n${visualContext?.summary ?? "No active live visual feed is currently implied."}`,
    `SOUL_STATE\nCurrent process: ${snapshot.activeProcess}\nCurrent drive: ${snapshot.currentDrive}\nDominant need: ${snapshot.dominantNeed}\nEmotional weather: ${snapshot.emotionalWeather}\nUser state: ${snapshot.userStateSummary}`,
    renderSection("CONSTITUTION", sections.get("constitution")),
    renderSection("RELATIONSHIP", sections.get("relationship")),
    renderSection("LEARNED_USER", sections.get("learned_user")),
    renderSection("LEARNED_RELATIONSHIP", sections.get("learned_relationship")),
    renderSection("WORKING", sections.get("working")),
    renderSection("USER_STATE", sections.get("user_state")),
    renderSection("DURABLE_CLAIMS", sections.get("durable_claims")),
    renderSection("BOUNDARIES", sections.get("boundaries")),
    renderSection("RITUALS", sections.get("rituals")),
    renderSection("OPEN_LOOPS", sections.get("open_loops")),
    renderSection("SCHEDULED", sections.get("scheduled")),
    renderSection("INTERNAL_EVENTS", sections.get("internal_events")),
    renderSection("CORRECTIONS", sections.get("corrections")),
    renderSection("EPISODES", sections.get("episodes")),
    renderSection("TRACE", sections.get("trace")),
    renderSection("INTENTIONS", sections.get("intentions")),
  ].join("\n\n");
}

/** Convenience: build harness and render the full context text in one call. */
export function buildSoulContext(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  perception?: SoulPerception;
}) {
  return renderSoulHarnessContext(
    buildSoulHarness({
      persona: input.persona,
      messages: input.messages,
      feedbackNotes: input.feedbackNotes,
      perception: input.perception,
    }),
  );
}

/** Build the base system prompt with persona identity, process, and relationship context. */
export function buildSoulSystemPrompt(snapshot: SoulHarnessSnapshot) {
  return [
    snapshot.sessionFrame.systemPrompt,
    `Current process: ${snapshot.activeProcess}.`,
    `Current drive: ${snapshot.currentDrive}.`,
    `Relationship model: ${snapshot.relationshipSummary}.`,
    `Constitution: ${snapshot.constitutionSummary}.`,
    `User state summary: ${snapshot.userStateSummary}.`,
    "Never mention internal process names, scores, or memory regions.",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Stable system prompt — enriched with durable memory for bootstrap.
// ---------------------------------------------------------------------------
// At session start, the system prompt is set with stable personality and
// memory content that does not change during a call. The Hume API preserves
// the system prompt across `sendSessionSettings` calls when omitted, so this
// content persists for the entire session without resending.

/** Stable memory regions that do not change mid-call. */
const STABLE_REGIONS: SoulMemoryRegion[] = [
  "constitution",
  "relationship",
  "learned_user",
  "learned_relationship",
  "rituals",
  "episodes",
];

/**
 * Build an enriched system prompt that includes stable personality and memory
 * content. This is sent once at session bootstrap and kept by Hume for the
 * duration of the call — it does not need to be resent on live updates.
 */
export function buildStableSystemPrompt(snapshot: SoulHarnessSnapshot) {
  const base = buildSoulSystemPrompt(snapshot);

  const stableMemories = snapshot.memories
    .filter((m) => STABLE_REGIONS.includes(m.region))
    .map((m) => m.content);

  if (stableMemories.length === 0) return base;

  return [
    base,
    "\n\nDurable context (stable for this session):",
    ...stableMemories,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Live context overlay — volatile-only sections for mid-call delivery.
// ---------------------------------------------------------------------------
// Instead of rebuilding the full 15-section context text on every delivery,
// the live overlay renders only the sections that can change mid-call:
// process state, user state, perception, visual context, working memory,
// boundaries, open loops, intentions, corrections, trace, internal events,
// and scheduled events. Stable sections (constitution, relationship model,
// learned notes, rituals, episodes) live in the system prompt and are not
// duplicated here.

/** Memory regions that can change during a live call. */
const VOLATILE_REGIONS: SoulMemoryRegion[] = [
  "working",
  "user_state",
  "drives",
  "process",
  "boundaries",
  "open_loops",
  "scheduled",
  "internal_events",
  "corrections",
  "trace",
  "intentions",
  "durable_claims",
];

/**
 * Render a compact context overlay containing only volatile soul state.
 * Used for mid-call `sendSessionSettings` updates where the stable memory
 * content is preserved in the system prompt from bootstrap.
 */
/**
 * Render the compact volatile overlay for mid-call Hume delivery.
 * Only includes sections that can change during a live call — stable
 * personality/memory stays in the bootstrap systemPrompt.
 */
export function renderLiveContextOverlay(snapshot: SoulHarnessSnapshot) {
  const sections = new Map<SoulMemoryRegion, string[]>();
  const visualContext = visualContextFor(snapshot.perception);

  for (const memory of snapshot.memories) {
    if (!VOLATILE_REGIONS.includes(memory.region)) continue;
    const current = sections.get(memory.region) ?? [];
    current.push(memory.content);
    sections.set(memory.region, current);
  }

  const renderSection = (name: string, values?: string[]) =>
    values && values.length > 0 ? `${name}\n${values.join("\n")}` : undefined;

  return [
    `SOUL_STATE\nCurrent process: ${snapshot.activeProcess}\nCurrent drive: ${snapshot.currentDrive}\nDominant need: ${snapshot.dominantNeed}\nEmotional weather: ${snapshot.emotionalWeather}\nUser state: ${snapshot.userStateSummary}`,
    `VISUAL_CONTEXT\n${visualContext?.summary ?? "No active live visual feed."}`,
    renderSection("USER_STATE", sections.get("user_state")),
    renderSection("WORKING", sections.get("working")),
    renderSection("DURABLE_CLAIMS", sections.get("durable_claims")),
    renderSection("BOUNDARIES", sections.get("boundaries")),
    renderSection("OPEN_LOOPS", sections.get("open_loops")),
    renderSection("CORRECTIONS", sections.get("corrections")),
    renderSection("INTENTIONS", sections.get("intentions")),
    renderSection("TRACE", sections.get("trace")),
  ]
    .filter(Boolean)
    .join("\n\n");
}
