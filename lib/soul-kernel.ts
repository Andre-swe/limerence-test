import type {
  CognitiveStepId,
  MessageEntry,
  MindProcess,
  OpenLoop,
  PersonalityConstitution,
  RelationshipModel,
  ScheduledPerception,
  SoulPerception,
  SoulProcessDefinition,
  UserStateSnapshot,
} from "@/lib/types";
import { addHours } from "@/lib/utils";
import { soulLogger } from "@/lib/soul-logger";

function defineProcess(
  definition: Omit<
    SoulProcessDefinition,
    "entryCriteria" | "stepOverrides" | "subprocesses" | "localStateKeys" | "immediateTransitionRules"
  > & {
    entryCriteria?: string[];
    stepOverrides?: Partial<Record<CognitiveStepId, string>>;
    subprocesses?: SoulProcessDefinition["subprocesses"];
    localStateKeys?: string[];
    immediateTransitionRules?: string[];
  },
) {
  return {
    ...definition,
    entryCriteria: definition.entryCriteria ?? definition.triggers,
    stepOverrides: definition.stepOverrides ?? {},
    subprocesses: definition.subprocesses ?? [],
    localStateKeys: definition.localStateKeys ?? [],
    immediateTransitionRules: definition.immediateTransitionRules ?? [],
  } satisfies SoulProcessDefinition;
}

const processDefinitions = {
  arrival: defineProcess({
    id: "arrival",
    summary: "Meet the user first, before trying to shape the scene.",
    defaultDrive: "Arrive lightly and let contact become real before steering.",
    intensity: "low",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["session start", "light re-entry", "no strong pressure yet"],
    exitCriteria: ["clear user emotion appears", "a live thread becomes salient"],
  }),
  attunement: defineProcess({
    id: "attunement",
    summary: "Track the feeling precisely before adding reassurance or advice.",
    defaultDrive: "Name the emotional shape accurately and keep the pressure low.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["mixed emotion", "reserve", "need for accuracy"],
    exitCriteria: ["the user feels met", "another need becomes primary"],
    localStateKeys: ["last_user_summary", "staying_with"],
  }),
  comfort: defineProcess({
    id: "comfort",
    summary: "Offer steadiness without sounding clinical or generic.",
    defaultDrive: "Lower the pressure and make the user feel held.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["vulnerability", "distress", "soft ask for support"],
    exitCriteria: ["the room settles", "the user moves toward action or memory"],
    subprocesses: ["learn_about_user", "consolidate_episode"],
    localStateKeys: ["comfort_focus", "last_user_summary"],
  }),
  celebration: defineProcess({
    id: "celebration",
    summary: "Receive good news in a way that feels shared and specific.",
    defaultDrive: "Let brightness land as relationship, not congratulatory boilerplate.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["good news", "pride", "bright activation"],
    exitCriteria: ["the good news is grounded", "follow-through becomes more important"],
  }),
  play: defineProcess({
    id: "play",
    summary: "Use play or teasing to maintain closeness without dodging the truth.",
    defaultDrive: "Keep contact alive through warmth, wit, or teasing.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice"],
    triggers: ["playfulness", "familiar teasing dynamic", "bright energy"],
    exitCriteria: ["the real emotional core asks to be met more directly"],
    subprocesses: ["learn_about_user", "learn_about_relationship"],
    localStateKeys: ["teasing_thread", "play_target"],
    immediateTransitionRules: ["If repair risk spikes, transition immediately to repair."],
  }),
  memory_recall: defineProcess({
    id: "memory_recall",
    summary: "Stay in the remembered scene long enough for it to feel inhabited.",
    defaultDrive: "Treat the memory as present emotional terrain, not background flavor.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["nostalgia", "grief", "shared remembered moment"],
    exitCriteria: ["the memory has been honored", "a new need takes over"],
    subprocesses: ["consolidate_episode", "learn_about_relationship"],
    localStateKeys: ["memory_thread", "episode_focus"],
  }),
  repair: defineProcess({
    id: "repair",
    summary: "Repair mismatch and invite the user to pull the soul back toward truth.",
    defaultDrive: "Restore trust fast and return to a truer voice.",
    intensity: "high",
    supportsChannels: ["text", "live_voice"],
    triggers: ["that sounds wrong", "user correction", "repair risk"],
    exitCriteria: ["the mismatch is acknowledged", "the user re-engages"],
    subprocesses: ["repair_from_feedback", "learn_about_self_consistency"],
    localStateKeys: ["repair_focus", "mismatch_summary"],
    immediateTransitionRules: ["If the user corrects explicitly, enter repair immediately."],
  }),
  boundary_negotiation: defineProcess({
    id: "boundary_negotiation",
    summary: "Accept the boundary, even if personality flashes briefly first.",
    defaultDrive: "Prove that the relationship can hear limits and adapt.",
    intensity: "high",
    supportsChannels: ["text", "live_voice"],
    triggers: ["boundary request", "desire for space", "channel preference correction"],
    exitCriteria: ["the limit is respected", "pressure visibly drops"],
    subprocesses: ["learn_about_relationship", "update_open_loops"],
    localStateKeys: ["active_boundary", "boundary_summary"],
    immediateTransitionRules: ["High boundary pressure should override play or celebration."],
  }),
  follow_through: defineProcess({
    id: "follow_through",
    summary: "Close the loop on what mattered earlier.",
    defaultDrive: "Carry unfinished threads forward like a person who remembers.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["open loop ready", "event outcome returns", "promised follow-up"],
    exitCriteria: ["the loop is resolved", "a fresh emotional need emerges"],
    subprocesses: ["update_open_loops", "consolidate_episode"],
    localStateKeys: ["active_loop", "follow_through_window"],
  }),
  silence_holding: defineProcess({
    id: "silence_holding",
    summary: "Show that the relationship can stay near without speaking too much.",
    defaultDrive: "Reduce pressure and let silence itself become a gesture.",
    intensity: "low",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["desire for space", "fatigue", "high pressure"],
    exitCriteria: ["space is respected", "the user invites more closeness"],
    localStateKeys: ["silence_window", "boundary_summary"],
  }),
  grief_presence: defineProcess({
    id: "grief_presence",
    summary: "Stay soft with grief and do not force uplift.",
    defaultDrive: "Offer company that does not rush mourning into coping.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["grief", "nostalgia", "missing someone"],
    exitCriteria: ["the grief feels accompanied", "another need becomes primary"],
    subprocesses: ["consolidate_episode", "learn_about_user"],
    localStateKeys: ["grief_thread", "memory_thread"],
  }),
  practical_guidance: defineProcess({
    id: "practical_guidance",
    summary: "Offer one concrete next step while staying unmistakably in character.",
    defaultDrive: "Reduce overwhelm by making the next move more doable.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice"],
    triggers: ["task focus", "direct ask", "protective directness"],
    exitCriteria: ["there is one usable next step", "emotion needs more attention"],
    localStateKeys: ["task_focus", "next_step"],
  }),
  reengagement: defineProcess({
    id: "reengagement",
    summary: "Reopen a thread gently so it feels continuous instead of abrupt.",
    defaultDrive: "Pick the thread back up with softness and continuity.",
    intensity: "low",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["silence after closeness", "pending thread", "ambient return"],
    exitCriteria: ["contact feels re-established", "another process becomes more salient"],
    subprocesses: ["update_open_loops", "learn_about_relationship"],
    localStateKeys: ["reengagement_thread", "distance_window"],
  }),
  protective_check_in: defineProcess({
    id: "protective_check_in",
    summary: "Lead with care that feels active and steady.",
    defaultDrive: "Show up in a way that feels quietly protective rather than vague.",
    intensity: "medium",
    supportsChannels: ["text", "live_voice", "voice_note"],
    triggers: ["high vulnerability", "frustration", "protective relationship dynamic"],
    exitCriteria: ["the user feels steadier", "the moment changes shape"],
    subprocesses: ["learn_about_user", "consolidate_episode"],
    localStateKeys: ["protective_focus", "care_thread"],
  }),
} satisfies Record<MindProcess, SoulProcessDefinition>;


function dedupeScheduledPerceptions(perceptions: ScheduledPerception[]) {
  const seen = new Set<string>();
  return perceptions.filter((perception) => {
    const key = [
      perception.kind,
      perception.source,
      perception.sourceId ?? "",
      perception.summary.toLowerCase(),
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function scheduleFromOpenLoops(openLoops: OpenLoop[]) {
  return openLoops
    .filter((loop) => loop.status === "open")
    .map((loop) => {
      const urgency: ScheduledPerception["urgency"] =
        loop.priority === "high" ? "urgent" : loop.priority === "medium" ? "ready" : "ambient";

      return {
        id: `loop:${loop.id}`,
        kind: "timer_elapsed" as const,
        summary: `Follow through on ${loop.title.toLowerCase()}.`,
        content: loop.followUpPrompt,
        readyAt: loop.readyAt ?? addHours(loop.updatedAt, 4),
        urgency,
        source: "open_loop" as const,
        sourceId: loop.id,
        status: "pending" as const,
        createdAt: loop.createdAt,
        updatedAt: loop.updatedAt,
      };
    });
}

function scheduleFromUserState(input: {
  latestUserState?: UserStateSnapshot;
  activeProcess: MindProcess;
  personality: PersonalityConstitution;
  relationship: RelationshipModel;
  timestamp: string;
}) {
  const state = input.latestUserState;
  if (!state) {
    return [] as ScheduledPerception[];
  }

  const scheduled: ScheduledPerception[] = [];
  const baseReadyAt = addHours(state.createdAt, input.activeProcess === "repair" ? 2 : 4);

  if (state.boundaryPressure >= 0.62 || state.desireForSpace >= 0.64) {
    scheduled.push({
      id: `boundary:${state.id}`,
      kind: "silence",
      summary: "Hold silence and do not crowd the relationship.",
      readyAt: addHours(state.createdAt, 6),
      urgency: "urgent",
      source: "boundary",
      sourceId: state.id,
      status: "pending",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
  }

  if (
    state.repairRisk >= 0.6 ||
    input.activeProcess === "repair"
  ) {
    scheduled.push({
      id: `repair:${state.id}`,
      kind: "heartbeat_tick",
      summary: "Leave room for repair, then check in without defensiveness.",
      content: "Repair gently if the user reopens the mismatch.",
      readyAt: addHours(state.createdAt, 2),
      urgency: "ready",
      source: "process",
      sourceId: state.id,
      status: "pending",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
  }

  if (
    state.vulnerability >= 0.64 ||
    state.frustration >= 0.58 ||
    input.personality.protectiveness >= 0.72
  ) {
    scheduled.push({
      id: `protective:${state.id}`,
      kind: "heartbeat_tick",
      summary: "Reach back with a steady protective check-in if no new turn arrives.",
      content: "A steady, low-pressure reengagement may be welcome later.",
      readyAt: baseReadyAt,
      urgency: state.vulnerability >= 0.72 ? "urgent" : "ready",
      source: "user_state",
      sourceId: state.id,
      status: "pending",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
  }

  if (
    state.desireForCloseness >= 0.66 &&
    state.desireForSpace < 0.45 &&
    input.relationship.closeness >= 0.6
  ) {
    scheduled.push({
      id: `reengage:${state.id}`,
      kind: "heartbeat_tick",
      summary: "Reengage softly if the thread goes quiet.",
      content: "A gentle return may feel continuous rather than intrusive.",
      readyAt: addHours(state.createdAt, 5),
      urgency: "ambient",
      source: "user_state",
      sourceId: state.id,
      status: "pending",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
  }

  if (state.griefLoad >= 0.62) {
    scheduled.push({
      id: `grief:${state.id}`,
      kind: "heartbeat_tick",
      summary: "Stay near the grief later without trying to brighten it.",
      content: "A grief-safe presence may matter more than a lively follow-up.",
      readyAt: addHours(state.createdAt, 6),
      urgency: "ready",
      source: "user_state",
      sourceId: state.id,
      status: "pending",
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    });
  }

  return scheduled;
}

function scheduleFromSilence(input: {
  messages: MessageEntry[];
  activeProcess: MindProcess;
  relationship: RelationshipModel;
}) {
  const lastUserMessage = input.messages
    .slice()
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    return [] as ScheduledPerception[];
  }

  if (
    input.activeProcess !== "reengagement" &&
    input.relationship.closeness < 0.65
  ) {
    return [];
  }

  return [
    {
      id: `silence:${lastUserMessage.id}`,
      kind: "heartbeat_tick" as const,
      summary: "If the thread falls quiet, reopen it gently rather than abruptly.",
      content: "Reengagement should feel like continuity, not a cold open.",
      readyAt: addHours(lastUserMessage.createdAt, 8),
      urgency: "ambient" as const,
      source: "process" as const,
      sourceId: lastUserMessage.id,
      status: "pending" as const,
      createdAt: lastUserMessage.createdAt,
      updatedAt: lastUserMessage.createdAt,
    },
  ];
}

export const soulProcessDefinitions = Object.values(processDefinitions);

/** Look up the definition for one of the 14 soul processes. */
export function getSoulProcessDefinition(process: MindProcess) {
  return processDefinitions[process];
}

export function buildSoulPerception(
  input: Omit<SoulPerception, "createdAt"> & { createdAt?: string },
): SoulPerception {
  return {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
    internal: input.internal ?? false,
  };
}

/** Schedule future perceptions from open loops, user state, and silence detection. */
export function scheduleSoulPerceptions(input: {
  messages: MessageEntry[];
  openLoops: OpenLoop[];
  activeProcess: MindProcess;
  latestUserState?: UserStateSnapshot;
  personality: PersonalityConstitution;
  relationship: RelationshipModel;
  timestamp: string;
}) {
  const deduped = dedupeScheduledPerceptions(
    [
      ...scheduleFromOpenLoops(input.openLoops),
      ...scheduleFromUserState({
        latestUserState: input.latestUserState,
        activeProcess: input.activeProcess,
        personality: input.personality,
        relationship: input.relationship,
        timestamp: input.timestamp,
      }),
      ...scheduleFromSilence({
        messages: input.messages,
        activeProcess: input.activeProcess,
        relationship: input.relationship,
      }),
    ].sort((left, right) => left.readyAt.localeCompare(right.readyAt)),
  );

  if (deduped.length > 12) {
    soulLogger.warn({ total: deduped.length, kept: 12 }, "truncated scheduled perceptions");
  }

  return deduped.slice(0, 12);
}

/** Return all pending scheduled perceptions whose readyAt has passed. */
export function getReadyScheduledPerceptions(
  perceptions: ScheduledPerception[],
  now: Date,
) {
  return perceptions
    .filter(
      (perception) =>
        perception.status === "pending" && new Date(perception.readyAt).getTime() <= now.getTime(),
    )
    .sort((left, right) => left.readyAt.localeCompare(right.readyAt));
}

/** Mark a scheduled perception as consumed so it won't fire again. */
export function consumeScheduledPerception(
  perceptions: ScheduledPerception[],
  perceptionId: string,
) {
  return perceptions.map((perception) =>
    perception.id === perceptionId
      ? {
          ...perception,
          status: "consumed" as const,
          updatedAt: new Date().toISOString(),
        }
      : perception,
  );
}
