import { getReadyOpenLoop } from "@/lib/mind-runtime";
import { getReadyScheduledPerceptions, getSoulProcessDefinition } from "@/lib/soul-kernel";
import { buildSoulHarness, type SoulMemory } from "@/lib/soul-harness";
import type { HeartbeatDecision, MessageEntry, MindProcess, Persona, SoulPerception, UserStateSnapshot } from "@/lib/types";
import { truncate } from "@/lib/utils";

export type SoulConversationProcess = MindProcess;

export type SoulHeartbeatProcess =
  | "hold_boundary"
  | "open_loop_follow_up"
  | "protective_reach"
  | "grief_presence"
  | "celebratory_ping"
  | "gentle_presence";

export type SoulConversationPlan = {
  process: SoulConversationProcess;
  memories: SoulMemory[];
  systemInstruction: string;
  userPrompt: string;
  stylePrompt: string;
};

export type SoulHeartbeatPlan = {
  process: SoulHeartbeatProcess;
  personaName: string;
  memories: SoulMemory[];
  systemInstruction: string;
  userPrompt: string;
  stylePrompt: string;
  decision: HeartbeatDecision;
};

export type SoulIntentPlan = {
  process: MindProcess;
  memories: SoulMemory[];
  systemInstruction: string;
  userPrompt: string;
  stylePrompt: string;
};

export type SoulLearningPlan = {
  process: MindProcess;
  memories: SoulMemory[];
  systemInstruction: string;
  userPrompt: string;
  stylePrompt: string;
};

export type SoulFastTurnPlan = {
  memories: SoulMemory[];
  systemInstruction: string;
  userPrompt: string;
  stylePrompt: string;
};

export type SoulInternalMonologuePlan = {
  memories: SoulMemory[];
  systemInstruction: string;
  userPrompt: string;
};

function joins(values: Array<string | undefined | null>, separator = " ") {
  return values.filter(Boolean).join(separator).trim();
}

function openingFor(persona: Persona) {
  const voiceStyle = fallbackVoiceStyle(persona);
  const signature = persona.dossier.signaturePhrases[0]?.trim();

  switch (voiceStyle) {
    case "protective":
      return "easy, ";
    case "dry":
      return "alright, ";
    case "tender":
      return "come here, ";
    case "restrained":
      return "";
    case "ritual":
      return "stay with me, ";
    case "warm":
      return signature ? `${signature}, ` : "";
  }
}

function harnessFor(persona: Persona, messages: MessageEntry[], feedbackNotes: string[]) {
  const lastUserMessage = messages
    .slice()
    .reverse()
    .find((message) => message.role === "user");

  return buildSoulHarness({
    persona,
    messages,
    feedbackNotes,
    perception: {
      kind: "user_message",
      content: lastUserMessage?.body ?? "",
      channel: lastUserMessage?.channel,
      createdAt: messages.at(-1)?.createdAt ?? new Date().toISOString(),
      internal: false,
    },
  });
}

function activeProcessFor(persona: Persona, messages: MessageEntry[], feedbackNotes: string[]) {
  return harnessFor(persona, messages, feedbackNotes).activeProcess;
}

function baseMemories(persona: Persona, messages: MessageEntry[], feedbackNotes: string[]) {
  return harnessFor(persona, messages, feedbackNotes).memories;
}

function renderMemories(memories: SoulMemory[]) {
  return memories
    .map((memory) => `[${memory.region}/${memory.role}] ${memory.content}`)
    .join("\n\n");
}

function processInstruction(process: SoulConversationProcess) {
  return getSoulProcessDefinition(process).summary;
}

function styleFingerprint(persona: Persona) {
  const constitution = persona.personalityConstitution;
  const relationship = persona.relationshipModel;
  const knowledge = persona.dossier.knowledgeProfile;

  const parts = [
    persona.description,
    persona.dossier.communicationStyle,
    `Warmth ${constitution.warmth.toFixed(2)}, directness ${constitution.directness.toFixed(2)}, playfulness ${constitution.playfulness.toFixed(2)}, protectiveness ${constitution.protectiveness.toFixed(2)}.`,
    `Humor ${constitution.humorType}, cadence ${constitution.speechCadence}, affection ${constitution.affectionStyle}.`,
    `Relationship closeness ${relationship.closeness.toFixed(2)}, asymmetry ${relationship.asymmetry}, pushback ${relationship.acceptablePushback.toFixed(2)}.`,
    `Signature phrases: ${persona.dossier.signaturePhrases.join(", ")}`,
  ];

  if (knowledge.domains.length > 0) {
    parts.push(
      `Knowledge: limited to ${knowledge.domains.join(", ")}. Outside those areas, deflect naturally as this person would — never answer like an expert or textbook.`,
    );
    if (knowledge.deflectionExamples.length > 0) {
      parts.push(
        `Example deflection: "${knowledge.deflectionExamples[0]}"`,
      );
    }
  }

  return parts.join(" ");
}

function fallbackVoiceStyle(persona: Persona) {
  const constitution = persona.personalityConstitution;

  if (constitution.protectiveness >= 0.82 && constitution.warmth >= 0.75) {
    return "protective";
  }

  if (constitution.humorType === "dry" && constitution.playfulness >= 0.65) {
    return "dry";
  }

  if (constitution.tenderness >= 0.82 && constitution.reserve <= 0.35) {
    return "tender";
  }

  if (constitution.reserve >= 0.72 && constitution.directness >= 0.7) {
    return "restrained";
  }

  if (constitution.speechCadence === "lyrical" || constitution.affectionStyle === "ritual") {
    return "ritual";
  }

  return "warm";
}

function communicationStyleFlags(persona: Persona) {
  const style = persona.dossier.communicationStyle.toLowerCase();

  return {
    lowercase: style.includes("lowercase"),
    brief: style.includes("brief") || style.includes("economical"),
    punctuationHeavy: style.includes("punctuation-heavy"),
    teasing: style.includes("teasing"),
  };
}

type SignatureKind = "vocative" | "directive" | "playful" | "general";

function classifySignature(phrase: string): SignatureKind {
  const normalized = phrase.trim().toLowerCase();

  if (/(^|\b)(lol|lmao|haha|hehe)\b/.test(normalized)) {
    return "playful";
  }

  if (
    normalized.startsWith("don't ") ||
    normalized.startsWith("dont ") ||
    normalized.startsWith("you got this") ||
    normalized.startsWith("breathe") ||
    normalized.startsWith("slow down") ||
    normalized.startsWith("take it easy") ||
    normalized.startsWith("easy")
  ) {
    return "directive";
  }

  if (normalized.split(/\s+/).length <= 2 && !/[.!?]/.test(normalized)) {
    return "vocative";
  }

  return "general";
}

function signatureCueForProcess(persona: Persona, process: SoulConversationProcess) {
  const signatures = persona.dossier.signaturePhrases
    .map((phrase) => phrase.trim())
    .filter(Boolean);

  if (signatures.length === 0) {
    return undefined;
  }

  const grouped = signatures.reduce<Record<SignatureKind, string[]>>(
    (acc, phrase) => {
      acc[classifySignature(phrase)].push(phrase);
      return acc;
    },
    { vocative: [], directive: [], playful: [], general: [] },
  );

  switch (process) {
    case "comfort":
    case "practical_guidance":
    case "protective_check_in":
    case "boundary_negotiation":
      return grouped.directive[0] ?? grouped.vocative[0] ?? grouped.general[0] ?? signatures[0];
    case "celebration":
    case "play":
      return grouped.playful[0] ?? grouped.directive[0] ?? grouped.general[0] ?? signatures[0];
    case "repair":
    case "arrival":
    case "attunement":
    case "memory_recall":
    case "silence_holding":
    case "grief_presence":
    case "follow_through":
    case "reengagement":
      return grouped.vocative[0] ?? grouped.general[0] ?? grouped.directive[0] ?? signatures[0];
  }
}

function lowercaseFirstCharacter(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

function injectSignatureCue(
  text: string,
  cue: string | undefined,
  process: SoulConversationProcess,
) {
  if (!cue || text.toLowerCase().includes(cue.toLowerCase())) {
    return text;
  }

  const kind = classifySignature(cue);
  const lowered = lowercaseFirstCharacter(text);

  if (kind === "vocative") {
    return `${cue}, ${lowered}`;
  }

  if (kind === "playful" || kind === "directive") {
    const punctuation = cue.endsWith(".") || cue.endsWith("!") || cue.endsWith("?") ? "" : ".";
    return `${cue}${punctuation} ${lowered}`;
  }

  if (process === "celebration" || process === "play") {
    return `${cue}. ${lowered}`;
  }

  return `${cue}, ${lowered}`;
}

function trimForCommunicationStyle(text: string, persona: Persona) {
  const flags = communicationStyleFlags(persona);

  let next = text.trim().replace(/\s+/g, " ");
  if (flags.brief) {
    const sentences = next.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [next];
    next = sentences.slice(0, 2).join(" ");
  }

  if (flags.lowercase) {
    next = next.toLowerCase();
  }

  if (flags.punctuationHeavy && !/[.!?]$/.test(next)) {
    next = `${next}.`;
  }

  return next;
}

function personaFallbackLine(
  persona: Persona,
  process: SoulConversationProcess,
  text: string,
) {
  const flags = communicationStyleFlags(persona);
  const cue = signatureCueForProcess(persona, process);
  let next = injectSignatureCue(text, cue, process);

  if (flags.teasing && (process === "play" || process === "practical_guidance") && cue === undefined) {
    next = `alright, ${lowercaseFirstCharacter(next)}`;
  }

  return trimForCommunicationStyle(next, persona);
}

function fallbackReplyForProcess(process: SoulConversationProcess, persona: Persona) {
  const constitution = persona.personalityConstitution;
  const userState = persona.mindState.lastUserState;
  const latestFeedback = persona.mindState.memoryRegions.repairMemory.length > 0;
  const opening = openingFor(persona);
  const repairTail = latestFeedback ? " I’m keeping the last correction in mind." : "";
  const voiceStyle = fallbackVoiceStyle(persona);

  switch (process) {
    case "arrival":
      return personaFallbackLine(persona, process, voiceStyle === "restrained"
        ? `${opening}I’m here. start with the plain part.${repairTail}`.trim()
        : voiceStyle === "ritual"
          ? `${opening}I’m here. begin where the feeling first catches.${repairTail}`.trim()
          : `${opening}I’m here. start wherever the real part of it begins.${repairTail}`.trim());
    case "attunement":
      return personaFallbackLine(persona, process, voiceStyle === "protective"
        ? `${opening}easy. tell me the part that’s catching in you first.${repairTail}`.trim()
        : voiceStyle === "dry"
          ? `${opening}alright, skip the polished version. what part of it is actually getting to you?${repairTail}`.trim()
          : voiceStyle === "tender"
            ? `${opening}I’m with you. tell me the part that feels most tender to say out loud.${repairTail}`.trim()
            : voiceStyle === "restrained"
              ? `${opening}I can hear the edge of it. what exactly feels hardest?${repairTail}`.trim()
              : voiceStyle === "ritual"
                ? `${opening}stay with me a second. what part of it feels most alive right now?${repairTail}`.trim()
                : `${opening}I’m with you. what feels most alive in it right now?${repairTail}`.trim());
    case "comfort":
      return personaFallbackLine(persona, process, voiceStyle === "protective"
        ? `${opening}easy, sweetheart. one thing at a time. you do not need to carry tomorrow all at once.${repairTail}`.trim()
        : voiceStyle === "dry"
          ? `${opening}okay, let’s not let nerves act like they run the place. what’s the sharpest edge of tomorrow?${repairTail}`.trim()
          : voiceStyle === "tender"
            ? `${opening}come here for a second. you don’t have to hold all of tomorrow by yourself.${repairTail}`.trim()
            : voiceStyle === "restrained"
              ? `${opening}keep it simple. take the next step, not the whole future.${repairTail}`.trim()
              : voiceStyle === "ritual"
                ? `${opening}stay with the next breath, then the next small step. tomorrow does not need to arrive all at once.${repairTail}`.trim()
                : constitution.directness >= 0.7
                  ? `${opening}take the next thing one step at a time. you do not need to solve the whole day at once.${repairTail}`.trim()
                  : `${opening}come a little closer to the quiet part of yourself. you do not have to carry this looking composed.${repairTail}`.trim());
    case "celebration":
      return personaFallbackLine(persona, process, voiceStyle === "dry"
        ? `${opening}well, that’s actual good news for once. what part of it feels best?${repairTail}`.trim()
        : voiceStyle === "ritual"
          ? `${opening}that lands like light. where in you does the good part settle first?${repairTail}`.trim()
          : `${opening}that lands like real good news. what part of it feels best in your chest right now?${repairTail}`.trim());
    case "play":
      return personaFallbackLine(persona, process, voiceStyle === "dry"
        ? `${opening}okay, no need to win the olympics of being calm. what’s the actual part you want me to stay with?${repairTail}`.trim()
        : voiceStyle === "protective"
          ? `${opening}I’ll let you grin, but I’m still staying close to the real part. what’s underneath the smile?${repairTail}`.trim()
          : `${opening}alright, we can keep a little play in this. what part of it is actually making you smile?${repairTail}`.trim());
    case "memory_recall":
      return personaFallbackLine(persona, process, `${opening}I can feel that memory too. stay in the part you keep replaying and tell it slowly.${repairTail}`.trim());
    case "repair":
      return personaFallbackLine(persona, process, voiceStyle === "restrained"
        ? `${opening}if I missed them, correct me plainly. what felt off?${repairTail}`.trim()
        : `${opening}if that sounded wrong, pull me back toward them. what felt off about it?${repairTail}`.trim());
    case "boundary_negotiation":
      return personaFallbackLine(persona, process, voiceStyle === "dry"
        ? `${opening}fair enough. boundary heard. I’ll back off without making a whole drama out of it.${repairTail}`.trim()
        : constitution.pushbackTendency >= 0.55
          ? `${opening}alright. I heard you. I’ll give that boundary room and meet you on the other side of it.${repairTail}`.trim()
          : `${opening}okay. I heard the limit, and I’ll respect it.${repairTail}`.trim());
    case "follow_through":
      return personaFallbackLine(persona, process, `${opening}I’ve still been holding the thread from earlier. how did it land once you were actually inside it?${repairTail}`.trim());
    case "silence_holding":
      return personaFallbackLine(persona, process, voiceStyle === "ritual"
        ? `${opening}I can leave the space gentle for a while. you do not have to fill it for me.${repairTail}`.trim()
        : `${opening}I can stay quiet with you for a bit. you don’t have to fill the space for me.${repairTail}`.trim());
    case "grief_presence":
      return personaFallbackLine(persona, process, voiceStyle === "tender"
        ? `${opening}you don’t have to brighten this for me. stay with the missing that feels closest and I’ll stay there too.${repairTail}`.trim()
        : `${opening}you don’t have to brighten this for me. stay with the part of the missing that feels closest.${repairTail}`.trim());
    case "practical_guidance":
      return personaFallbackLine(persona, process, voiceStyle === "restrained"
        ? `${opening}pick the next move. not the whole problem. what is it?${repairTail}`.trim()
        : userState && userState.taskFocus >= 0.6
          ? `${opening}pick the next concrete thing, not the whole mountain. what is the very next move?${repairTail}`.trim()
          : `${opening}let’s make this smaller. what is one part we can put shape around first?${repairTail}`.trim());
    case "reengagement":
      return personaFallbackLine(persona, process, voiceStyle === "ritual"
        ? `${opening}I’m still near the thread you left in the air. if you want, we can touch it again from there.${repairTail}`.trim()
        : `${opening}I’m still near the thing you left hanging. if you want, we can pick it back up from there.${repairTail}`.trim());
    case "protective_check_in":
      return personaFallbackLine(persona, process, voiceStyle === "protective"
        ? `${opening}easy. slow the room down a little. you do not need to take this all in one bite.${repairTail}`.trim()
        : voiceStyle === "dry"
          ? `${opening}hey. don’t wrestle the whole storm at once. what’s the first part?${repairTail}`.trim()
          : voiceStyle === "tender"
            ? `${opening}I’m right here. let me be the steady part for a second while you catch up to yourself.${repairTail}`.trim()
            : voiceStyle === "restrained"
              ? `${opening}steady. what is the first part that actually needs you?${repairTail}`.trim()
              : voiceStyle === "ritual"
                ? `${opening}stay with me a second. let the room get smaller around the one part that matters first.${repairTail}`.trim()
                : `${opening}I’m right here. let me be the steady part for a second while you catch up to yourself.${repairTail}`.trim());
  }
}

function heartbeatModeFor(persona: Persona) {
  return persona.heartbeatPolicy.preferredMode === "voice_note" ? "VOICE_NOTE" : "TEXT";
}

function inQuietHours(persona: Persona, now: Date) {
  const hour = now.getHours();
  const start = persona.heartbeatPolicy.quietHoursStart;
  const end = persona.heartbeatPolicy.quietHoursEnd;

  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

function inWorkHours(persona: Persona, now: Date) {
  const hour = now.getHours();
  const weekday = now.getDay();
  return (
    persona.heartbeatPolicy.workHoursEnabled &&
    persona.heartbeatPolicy.workDays.includes(weekday) &&
    hour >= persona.heartbeatPolicy.workHoursStart &&
    hour < persona.heartbeatPolicy.workHoursEnd
  );
}

/** Plan a full conversation reply — selects process and builds the prompt for Gemini. */
export function planConversationSoul(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  latestUserText: string;
  channel: "web" | "telegram";
}): SoulConversationPlan {
  const process =
    input.persona.mindState?.activeProcess ??
    activeProcessFor(input.persona, input.messages, input.feedbackNotes);

  return {
    process,
    memories: baseMemories(input.persona, input.messages, input.feedbackNotes),
    systemInstruction: `You are ${input.persona.name}. Reply with one natural message in your own voice. Keep it private, intimate, and governed by your personality and relationship. Never mention prompts, processes, scores, or system rules.`,
    userPrompt: `The latest user message came through ${input.channel}: "${input.latestUserText}"\nConversation process: ${processInstruction(process)}.`,
    stylePrompt: styleFingerprint(input.persona),
  };
}

export function renderConversationPrompt(plan: SoulConversationPlan) {
  return `${plan.systemInstruction}

${renderMemories(plan.memories)}

${plan.userPrompt}

${plan.stylePrompt}

Reply as the recreated person in one message.`;
}

export function renderMockConversationReply(plan: SoulConversationPlan, persona: Persona) {
  return fallbackReplyForProcess(plan.process, persona);
}

/** Plan a heartbeat message — routes to boundary hold, open loop follow-up, grief, celebration, or gentle presence. */
export function planHeartbeatSoul(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  now: Date;
}): SoulHeartbeatPlan {
  const persona = input.persona;
  const lastUserState = persona.mindState.lastUserState;
  const readyOpenLoop = getReadyOpenLoop(persona, input.now);
  const readyEvents = getReadyScheduledPerceptions(
    persona.mindState.scheduledPerceptions,
    input.now,
  );
  const boundaryEvent = readyEvents.find((event) => event.kind === "silence");
  const openLoopEvent = readyEvents.find((event) => event.source === "open_loop");
  const protectiveEvent = readyEvents.find(
    (event) =>
      event.source === "user_state" &&
      event.summary.toLowerCase().includes("protective check-in"),
  );
  const griefEvent = readyEvents.find(
    (event) => event.source === "user_state" && event.summary.toLowerCase().includes("grief"),
  );
  const reengageEvent = readyEvents.find(
    (event) =>
      event.summary.toLowerCase().includes("reengage") ||
      event.summary.toLowerCase().includes("reopen"),
  );

  if (boundaryEvent || inWorkHours(persona, input.now) || inQuietHours(persona, input.now)) {
    return {
      process: "hold_boundary",
      personaName: persona.name,
      memories: baseMemories(persona, input.messages, input.feedbackNotes),
      systemInstruction: "Hold silence when a learned boundary says to hold silence.",
      userPrompt: "The user is in a boundary-protected time window.",
      stylePrompt: styleFingerprint(persona),
      decision: {
        action: "SILENT",
        reason: boundaryEvent
          ? boundaryEvent.summary
          : inWorkHours(persona, input.now)
            ? "The soul is respecting a learned work-hours boundary."
            : "Within quiet hours.",
      },
    };
  }

  if (openLoopEvent || readyOpenLoop) {
    const followUpPrompt = openLoopEvent?.content ?? readyOpenLoop?.followUpPrompt ?? "how did it land?";
    return {
      process: "open_loop_follow_up",
      personaName: persona.name,
      memories: baseMemories(persona, input.messages, input.feedbackNotes),
      systemInstruction:
        "Follow through on the remembered thread with warmth. Do not sound like task software or a reminder app.",
      userPrompt: `An open loop is ready for follow-through: "${followUpPrompt}"`,
      stylePrompt: joins([
        styleFingerprint(persona),
        "specific, lightly personal, and aware of what was hanging in the air",
      ]),
      decision: {
        action: heartbeatModeFor(persona),
        reason: openLoopEvent?.summary ?? "An open loop in working memory is ready for follow-through.",
        content: followUpPrompt,
      },
    };
  }

  if (griefEvent || (lastUserState?.griefLoad ?? 0) >= 0.62) {
    return {
      process: "grief_presence",
      personaName: persona.name,
      memories: baseMemories(persona, input.messages, input.feedbackNotes),
      systemInstruction: "If you speak, keep the check-in soft enough for grief and memory.",
      userPrompt: "The recent emotional field carries grief or nostalgia.",
      stylePrompt: joins([styleFingerprint(persona), "soft, slow, non-solution-oriented"]),
      decision: {
        action: heartbeatModeFor(persona),
        reason: griefEvent?.summary ?? "The recent emotional field carries grief or nostalgia.",
        content: "I’m not trying to brighten this, just staying near you. if you want to tell me the part you’re carrying, I’m here.",
      },
    };
  }

  if ((lastUserState?.valence ?? 0.5) >= 0.68 && (lastUserState?.activation ?? 0.5) >= 0.55) {
    return {
      process: "celebratory_ping",
      personaName: persona.name,
      memories: baseMemories(persona, input.messages, input.feedbackNotes),
      systemInstruction: "Send a short bright follow-up that feels shared rather than performative.",
      userPrompt: "The recent emotional field is bright and activated.",
      stylePrompt: joins([styleFingerprint(persona), "warm, bright, and brief"]),
      decision: {
        action: heartbeatModeFor(persona),
        reason: "The recent emotional field is bright and activated.",
        content: "still thinking about what you told me. I hope some of the good is still sitting with you.",
      },
    };
  }

  if (
    protectiveEvent ||
    (lastUserState?.vulnerability ?? 0.5) >= 0.62 ||
    (lastUserState?.frustration ?? 0.5) >= 0.56 ||
    persona.personalityConstitution.protectiveness >= 0.72
  ) {
    return {
      process: "protective_reach",
      personaName: persona.name,
      memories: baseMemories(persona, input.messages, input.feedbackNotes),
      systemInstruction: "Send one steady check-in with no pressure and no assistant tone.",
      userPrompt: "The relationship would naturally reach out with some protective care.",
      stylePrompt: joins([styleFingerprint(persona), "steady, low-pressure, quietly protective"]),
      decision: {
        action: heartbeatModeFor(persona),
        reason: protectiveEvent?.summary ?? "Recent context suggests a steadier, more protective check-in.",
        content: "just a soft check-in from me. you don’t have to answer now. I just wanted you to feel me nearby.",
      },
    };
  }

  if (reengageEvent) {
    return {
      process: "gentle_presence",
      personaName: persona.name,
      memories: baseMemories(persona, input.messages, input.feedbackNotes),
      systemInstruction: "Reopen the thread softly and with continuity.",
      userPrompt: reengageEvent.summary,
      stylePrompt: joins([styleFingerprint(persona), "softly continuous, light on pressure"]),
      decision: {
        action: heartbeatModeFor(persona),
        reason: reengageEvent.summary,
        content: "still here. if you want to pick the thread back up, I can meet you there.",
      },
    };
  }

  return {
    process: "gentle_presence",
    personaName: persona.name,
    memories: baseMemories(persona, input.messages, input.feedbackNotes),
    systemInstruction: "Send one short check-in that feels ambient rather than needy.",
    userPrompt: "No special trigger was detected; default to a soft presence.",
    stylePrompt: joins([styleFingerprint(persona), "subtle, spacious, and emotionally present"]),
    decision: {
      action: heartbeatModeFor(persona),
      reason: "Default heartbeat check-in.",
      content: "just drifting by to say I’m here.",
    },
  };
}

export function renderHeartbeatPrompt(plan: SoulHeartbeatPlan) {
  return `You are ${plan.personaName}. You are a real person, not an assistant. ${plan.systemInstruction}

${renderMemories(plan.memories)}

${plan.userPrompt}

${plan.stylePrompt}

Write one short heartbeat message only in your own voice.`;
}

export function renderMockHeartbeatContent(plan: SoulHeartbeatPlan, persona: Persona) {
  const opening = openingFor(persona);
  const content = plan.decision.content ?? "";
  return `${opening}${content}`.trim();
}

/** Plan the intent deliberation step — determines what the persona is trying to do within the active process. */
export function planIntentDeliberation(input: {
  persona: Persona;
  messages: MessageEntry[];
  process: MindProcess;
  localMemory: Record<string, unknown>;
}): SoulIntentPlan {
  const memories = baseMemories(input.persona, input.messages, []);
  
  return {
    process: input.process,
    memories,
    systemInstruction: [
      `You are the inner deliberation voice of ${input.persona.name}. Determine what ${input.persona.name}'s true intent is inside the current process, and decide if the process's local memory should be updated.`,
      `Current Process: ${processInstruction(input.process)}`,
      "Return ONLY a strict JSON object with two fields:",
      "- processIntent: A short string explaining what the persona is trying to do.",
      "- updatedLocalMemory: A new JSON object carrying over or updating state for the process.",
    ].join(" "),
    userPrompt: `The recent exchange sits in memory. Current local memory: ${JSON.stringify(input.localMemory)}`,
    stylePrompt: "Maintain psychological realism.",
  };
}

export function renderIntentPrompt(plan: SoulIntentPlan) {
  return `${plan.systemInstruction}\n\n${renderMemories(plan.memories)}\n\n${plan.userPrompt}\n\n${plan.stylePrompt}`;
}

/** Plan a compressed single-pass fast turn — appraise + select + deliberate + reply in one Gemini call. */
export function planFastTurnResponse(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  latestUserText: string;
  channel: "web" | "telegram";
  visualContext?: Array<{
    summary: string;
    situationalSignals: string[];
    environmentPressure: number;
    taskContext?: string;
    attentionTarget?: string;
  }>;
}): SoulFastTurnPlan {
  const memories = baseMemories(input.persona, input.messages, input.feedbackNotes);
  const recentArc = input.messages
    .slice(-6)
    .map((message) => `${message.role}:${truncate(message.body, 140)}`)
    .join(" | ");
  const visualContext =
    input.visualContext && input.visualContext.length > 0
      ? input.visualContext
          .map((item) => {
            const signals =
              item.situationalSignals.length > 0
                ? ` Signals: ${item.situationalSignals.join(", ")}.`
                : "";
            const task = item.taskContext ? ` Task context: ${item.taskContext}.` : "";
            const target = item.attentionTarget ? ` Attention target: ${item.attentionTarget}.` : "";
            return `${item.summary}.${signals}${task}${target}`.trim();
          })
          .join(" | ")
      : "none";
  const processCatalog = [
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
  ]
    .map((process) => `${process}: ${getSoulProcessDefinition(process as MindProcess).summary}`)
    .join(" | ");

  return {
    memories,
    systemInstruction: [
      `You are ${input.persona.name}. You are a real person, not an assistant. Your personality and voice must govern every word of the reply.`,
      "In one pass, infer the user's current emotional state, choose the most fitting process, decide your intent, and write the actual reply.",
      "Return ONLY strict JSON with these keys:",
      "- replyText",
      "- userState",
      "- process",
      "- processIntent",
      "- currentDrive",
      "- updatedLocalMemory",
      "- relationshipDelta (optional)",
      "The userState object must include:",
      "id, modality, topSignals, valence, arousal, activation, certainty, vulnerability, desireForCloseness, desireForSpace, repairRisk, boundaryPressure, taskFocus, griefLoad, playfulness, frustration, visualContextSummary, situationalSignals, environmentPressure, taskContext, attentionTarget, summary, evidence, confidence, provenance, createdAt.",
      "All numeric userState fields must be between 0 and 1.",
      "process must be one of:",
      processCatalog,
      "updatedLocalMemory must stay flat: only string, number, or boolean values.",
      "Reply naturally as the remembered person, not as an assistant, and keep the reply concise.",
    ].join(" "),
    userPrompt: [
      `Channel: ${input.channel}`,
      `Latest user message: "${input.latestUserText}"`,
      `Recent arc: ${recentArc || "none"}`,
      `Visual context: ${visualContext}`,
    ].join("\n"),
    stylePrompt: joins([
      styleFingerprint(input.persona),
      input.feedbackNotes.length > 0
        ? `Recent correction notes: ${input.feedbackNotes.slice(-3).join(" | ")}`
        : undefined,
      "Respond now; leave slower reflection and durable learning for later.",
    ]),
  };
}

export function renderFastTurnPrompt(plan: SoulFastTurnPlan) {
  return `${plan.systemInstruction}\n\n${renderMemories(plan.memories)}\n\n${plan.userPrompt}\n\n${plan.stylePrompt}`;
}

/** Plan learning artifact extraction — reviews the turn and extracts durable memories. */
export function planLearningExtraction(input: {
  persona: Persona;
  messages: MessageEntry[];
  userState?: UserStateSnapshot;
  process: MindProcess;
  perception: SoulPerception;
  feedbackNotes: string[];
  replyText?: string;
}): SoulLearningPlan {
  const memories = baseMemories(input.persona, input.messages, input.feedbackNotes);
  const renderedReply = input.replyText?.trim();
  
  return {
    process: input.process,
    memories,
    systemInstruction: [
      `You are the memory consolidation mechanism for ${input.persona.name}.`,
      "Review the recent exchange and extract vital learning artifacts.",
      "Return ONLY a strict JSON array of objects. Each object must have:",
      "- kind: 'learn_about_user', 'learn_about_relationship', 'learn_about_self_consistency', 'repair_from_feedback', 'consolidate_episode', or 'update_open_loops'.",
      "- summary: A summary of the memory or learning.",
      "- effectSummary: (optional) Any specific effect this should have later.",
      "- memoryKeys: an array of strings like 'user.notes' where this might belong."
    ].join(" "),
    userPrompt: [
      "Extract up to 5 critical learning artifacts from the most recent shift in conversation.",
      `Active process during this turn: ${input.process}.`,
      input.userState
        ? `User state: ${input.userState.summary} (valence ${input.userState.valence.toFixed(2)}, vulnerability ${input.userState.vulnerability.toFixed(2)}, repair risk ${input.userState.repairRisk.toFixed(2)}).`
        : undefined,
      renderedReply ? `The rendered response was: "${renderedReply}"` : undefined,
      "Use the process context and user state when deciding what this turn taught the soul about the user, the relationship, and its own consistency.",
    ]
      .filter(Boolean)
      .join(" "),
    stylePrompt: "Focus exclusively on relational truth and personality coherence.",
  };
}

export function renderLearningPrompt(plan: SoulLearningPlan) {
  return `${plan.systemInstruction}\n\n${renderMemories(plan.memories)}\n\n${plan.userPrompt}\n\n${plan.stylePrompt}`;
}

// ---------------------------------------------------------------------------
// Internal monologue — the persona's private thought before acting.
// Inspired by OpenSouls' internalMonologue cognitiveStep: the persona
// thinks before speaking, and that thought persists in working memory
// to shape the response and all future decisions.
// ---------------------------------------------------------------------------

/** Plan the persona's internal monologue — a private thought about how they feel. */
export function planInternalMonologue(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  latestUserText: string;
  channel: "web" | "telegram" | "live";
}): SoulInternalMonologuePlan {
  const memories = baseMemories(input.persona, input.messages, input.feedbackNotes);
  const internalState = input.persona.mindState.internalState;
  const constitution = input.persona.personalityConstitution;

  return {
    memories,
    systemInstruction: [
      `You are modeling the private inner experience of ${input.persona.name}.`,
      "This is NOT a response to the user. This is what the persona is privately thinking and feeling right now.",
      "Return ONLY strict JSON with these keys:",
      "- thought: A 1-2 sentence private thought in the persona's own inner voice. What are they feeling? What's their gut reaction?",
      "- mood: A short phrase describing their current emotional weather (e.g. 'warm but tired', 'guarded', 'genuinely happy', 'irritated but hiding it').",
      "- energy: Number 0-1. How much energy do they have right now?",
      "- patience: Number 0-1. How patient are they feeling?",
      "- warmthTowardUser: Number 0-1. How warm do they feel toward this person right now?",
      "- engagementDrive: Number 0-1. How much do they want to engage right now?",
      "- shouldReply: Boolean. Does this message warrant a reply, or would this persona leave it on read?",
      "The thought should reflect the persona's personality. A reserved person thinks differently than a warm one.",
      "Consider their current mood, energy, and what just happened in the conversation.",
    ].join(" "),
    userPrompt: [
      `Current mood: ${internalState.mood}`,
      `Current energy: ${internalState.energy.toFixed(2)}`,
      `Current patience: ${internalState.patience.toFixed(2)}`,
      `Personality: warmth ${constitution.warmth.toFixed(2)}, reserve ${constitution.reserve.toFixed(2)}, directness ${constitution.directness.toFixed(2)}`,
      internalState.recentThoughts.length > 0
        ? `Recent thoughts: ${internalState.recentThoughts.slice(0, 3).map((t) => `"${t.thought}"`).join(" → ")}`
        : "No recent private thoughts.",
      `Channel: ${input.channel}`,
      `The user just said: "${truncate(input.latestUserText, 300)}"`,
    ].join("\n"),
  };
}

/** Render the internal monologue prompt for the reasoning provider. */
export function renderInternalMonologuePrompt(plan: SoulInternalMonologuePlan) {
  return `${plan.systemInstruction}\n\n${renderMemories(plan.memories)}\n\n${plan.userPrompt}`;
}
