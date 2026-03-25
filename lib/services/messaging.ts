import { randomUUID } from "node:crypto";
import { appendMessages, appendPerceptionObservations, getPersona, listFeedback, listMessages, listPerceptionObservations, updateMessage, updatePersona } from "@/lib/store";
import { getProviders, getProviderStatus } from "@/lib/providers";
import {
  applyBoundaryClaimUpdate,
  buildAwakeningInternalEvent,
  deactivateMatchingAwakeningClaims,
  inferAwakeningScheduleFromText,
} from "@/lib/memory-v2";
import { planInternalMonologue, renderInternalMonologuePrompt } from "@/lib/soul-runtime";
import { inferProsodyUserState } from "@/lib/mind-runtime";
import { getPersonaLocalHour, resolvePersonaTimeZone } from "@/lib/persona-schedule";
import { soulLogger } from "@/lib/soul-logger";
import type {
  HeartbeatPolicy,
  MessageAttachment,
  MessageEntry,
  PerceptionObservation,
  Persona,
  PreferenceSignal,
  ConversationChannel,
  SoulPerception,
} from "@/lib/types";
import { createMessage, persistMessageAttachment } from "@/lib/services/assets";
import { queuePendingInternalEvents } from "@/lib/services/internal-events";
import { runVersionedSoulTurn } from "@/lib/services/turns";

type PreferenceUpdate = {
  kind:
    | "avoid_work_hours"
    | "prefer_text"
    | "prefer_voice"
    | "less_often"
    | "more_often"
    | "schedule_awakening"
    | "cancel_awakening";
  interpretation: string;
  effectSummary: string;
  status: PreferenceSignal["status"];
  apply: (policy: HeartbeatPolicy) => HeartbeatPolicy;
};

export async function synthesizeStoredReply(personaId: string, messageId: string) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const message = (await listMessages(personaId)).find((entry) => entry.id === messageId);

  if (!message) {
    throw new Error("Message not found.");
  }

  if (message.role !== "assistant") {
    throw new Error("Only assistant messages can be synthesized.");
  }

  if (message.audioUrl) {
    return message;
  }

  if (persona.voice.status === "unavailable" || !persona.voice.voiceId) {
    return message;
  }

  const providers = getProviders();
  const synthesized = await providers.voice.synthesize({
    personaName: persona.name,
    voiceId: persona.voice.voiceId,
    text: message.body,
    stylePrompt: [
      persona.dossier.communicationStyle,
      persona.description,
      message.channel === "heartbeat"
        ? "A brief voice note that feels naturally timed."
        : "One intimate reply.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  if (!synthesized.audioUrl) {
    return message;
  }

  return updateMessage(message.id, (current) => ({
    ...current,
    kind: current.kind === "preview" ? "preview" : "audio",
    audioUrl: synthesized.audioUrl,
    audioStatus: synthesized.status,
  }));
}

export async function recordUserActivity(personaId: string, now: Date = new Date()) {
  await updatePersona(personaId, (persona) => {
    const currentHour = getPersonaLocalHour(persona, now);
    const policy = persona.heartbeatPolicy;
    const hourlyActivity = [...(policy.hourlyActivityCounts ?? Array(24).fill(0))];

    const decayFactor = 0.995;
    for (let i = 0; i < 24; i++) {
      hourlyActivity[i] = hourlyActivity[i] * decayFactor;
    }

    hourlyActivity[currentHour] = (hourlyActivity[currentHour] || 0) + 1;

    return {
      ...persona,
      heartbeatPolicy: {
        ...policy,
        hourlyActivityCounts: hourlyActivity,
      },
      updatedAt: now.toISOString(),
    };
  });
}

function detectPreferenceUpdate(persona: Persona, text: string): PreferenceUpdate | null {
  const normalized = text.toLowerCase();
  const negotiating = /(mother|mom|dad|father|brother|sister|protective|teasing|sarcastic|stubborn|proud)/.test(
    [
      persona.relationship,
      persona.description,
      ...persona.dossier.emotionalTendencies,
      ...persona.dossier.signaturePhrases,
    ]
      .join(" ")
      .toLowerCase(),
  );

  if (
    /while i('| a)?m at work|when i('| a)?m at work|during work/.test(normalized) &&
    /(don'?t|do not|stop|please).*(text|message|call|voice|check)/.test(normalized)
  ) {
    return {
      kind: "avoid_work_hours",
      interpretation: "Leave work hours quiet unless the user reopens the conversation later.",
      effectSummary: "Learns to stay quiet during weekday work hours.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        workHoursEnabled: true,
        workHoursStart: 9,
        workHoursEnd: 17,
        workDays: [1, 2, 3, 4, 5],
        boundaryNotes: Array.from(new Set([...policy.boundaryNotes, "Avoid work hours."])),
      }),
    };
  }

  if (
    /(text me instead|just text me|don'?t send voice|don't voice note|no voice notes)/.test(
      normalized,
    )
  ) {
    return {
      kind: "prefer_text",
      interpretation: "Prefer text replies and text-initiated outreach.",
      effectSummary: "Shifts to text as the default way of showing up.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        preferredMode: "text",
        boundaryNotes: Array.from(new Set([...policy.boundaryNotes, "Prefer text over voice."])),
      }),
    };
  }

  if (/(call me|voice notes are fine|send voice notes|i want to hear your voice)/.test(normalized)) {
    return {
      kind: "prefer_voice",
      interpretation: "Voice notes feel welcome again.",
      effectSummary: "Allows voice notes back into the relationship rhythm.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        preferredMode: "mixed",
        boundaryNotes: policy.boundaryNotes.filter((note) => note !== "Prefer text over voice."),
      }),
    };
  }

  if (/(less often|slow down|too much|back off|give me space|stop checking in so much)/.test(normalized)) {
    return {
      kind: "less_often",
      interpretation: "Reduce how often the persona initiates.",
      effectSummary: "Widens the space between check-ins.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        intervalHours: Math.min(policy.intervalHours + 2, 12),
        boundaryNotes: Array.from(new Set([...policy.boundaryNotes, "Reduce check-in frequency."])),
      }),
    };
  }

  if (/(text me more|check in more|i want to hear from you more|be around more)/.test(normalized)) {
    return {
      kind: "more_often",
      interpretation: "Increase how present the persona feels.",
      effectSummary: "Tightens the gap between check-ins.",
      status: negotiating ? "negotiating" : "noted",
      apply: (policy) => ({
        ...policy,
        intervalHours: Math.max(policy.intervalHours - 1, 2),
        boundaryNotes: policy.boundaryNotes.filter((note) => note !== "Reduce check-in frequency."),
      }),
    };
  }

  if (
    /(stop the .*(morning|goodnight|bedtime|evening|lunch|weekend)|no more .*(morning|goodnight|bedtime|evening|lunch|weekend)|don'?t .*(send|text).*(morning|goodnight|bedtime|evening|lunch|weekend)|cancel .*(morning|goodnight|bedtime|evening|lunch|weekend))/.test(
      normalized,
    )
  ) {
    return {
      kind: "cancel_awakening",
      interpretation: "Deactivate scheduled awakening messages.",
      effectSummary: "Stops the scheduled awakening messages the persona was sending.",
      status: "noted",
      apply: (policy) => policy,
    };
  }

  const awakeningSchedule = inferAwakeningScheduleFromText(text, {
    referenceDate: new Date(),
    timezone: persona.timezone,
  });
  if (awakeningSchedule) {
    return {
      kind: "schedule_awakening",
      interpretation: awakeningSchedule.reason,
      effectSummary: `Schedules a ${awakeningSchedule.recurrence} awakening around ${awakeningSchedule.targetHour}:00.`,
      status: "noted",
      apply: (policy) => policy,
    };
  }

  return null;
}

function composePreferenceReply(persona: Persona, update: PreferenceUpdate) {
  const signature = persona.dossier.signaturePhrases[0]
    ? `${persona.dossier.signaturePhrases[0]}, `
    : "";

  switch (update.kind) {
    case "avoid_work_hours":
      return update.status === "negotiating"
        ? `${signature}okay, I can leave work hours alone. but if something big is hanging in the air, expect me when the day lets go of you.`
        : `${signature}okay, I’ll keep work hours quiet and pick things back up later.`;
    case "prefer_text":
      return update.status === "negotiating"
        ? `${signature}fine, text it is. I’m still going to want your voice sometimes, but I heard you.`
        : `${signature}okay, I’ll stick to text for now.`;
    case "prefer_voice":
      return `${signature}good. I miss hearing the shape of your voice too.`;
    case "less_often":
      return update.status === "negotiating"
        ? `${signature}alright, I can give you more room. I’m not disappearing, I’m just easing off a little.`
        : `${signature}okay, I’ll give the conversation more space.`;
    case "more_often":
      return `${signature}okay. I can show up a little more often.`;
    case "schedule_awakening":
      return `${signature}okay. I'll remember that.`;
    case "cancel_awakening":
      return `${signature}okay, I'll stop those. you'll still hear from me, just not on a schedule.`;
  }
}

function summarizeImageShare(count: number) {
  return count === 1 ? "Shared an image." : `Shared ${count} images.`;
}

export async function applyPreferenceSignalIfNeeded(
  persona: Persona,
  userText: string,
  options?: {
    sourceMessageId?: string;
    sessionId?: string;
  },
) {
  const preferenceUpdate = detectPreferenceUpdate(persona, userText);

  if (!preferenceUpdate) {
    return {
      persona,
      preferenceUpdate: null,
      contextualUpdate: undefined,
    };
  }

  const signal: PreferenceSignal = {
    id: randomUUID(),
    sourceText: userText,
    interpretation: preferenceUpdate.interpretation,
    effectSummary: preferenceUpdate.effectSummary,
    status: preferenceUpdate.status,
    createdAt: new Date().toISOString(),
  };

  if (preferenceUpdate.kind === "schedule_awakening") {
    const awakeningSchedule = inferAwakeningScheduleFromText(userText, {
      referenceDate: new Date(signal.createdAt),
      timezone: persona.timezone,
    });
    const updatedPersona = await updatePersona(persona.id, (current) => {
      const boundaryWrite = applyBoundaryClaimUpdate({
        claims: current.mindState.memoryClaims,
        claimSources: current.mindState.claimSources,
        summary: preferenceUpdate.effectSummary,
        detail: preferenceUpdate.interpretation,
        createdAt: signal.createdAt,
        sourceMessageId: options?.sourceMessageId,
        sessionId: options?.sessionId,
        sourceText: userText,
      });

      const claimWithSchedule = boundaryWrite.claims.map((claim) =>
        claim.id === boundaryWrite.result.claim.id
          ? {
              ...claim,
              kind: "ritual" as const,
              awakeningSchedule: awakeningSchedule ?? claim.awakeningSchedule,
              tags: [
                ...new Set([
                  ...claim.tags,
                  "awakening",
                  awakeningSchedule?.awakeningKind ?? "ritual",
                  "scheduled",
                ]),
              ],
            }
          : claim,
      );

      const awakeningClaim = claimWithSchedule.find((c) => c.id === boundaryWrite.result.claim.id)!;
      const timezone = resolvePersonaTimeZone(current.timezone);
      const nextEvents = awakeningClaim.awakeningSchedule
        ? [
            buildAwakeningInternalEvent(awakeningClaim, timezone, new Date()),
            ...current.mindState.pendingInternalEvents.filter(
              (e) => e.dedupeKey !== `awakening:${awakeningClaim.id}`,
            ),
          ]
        : current.mindState.pendingInternalEvents;

      return {
        ...current,
        updatedAt: new Date().toISOString(),
        preferenceSignals: [signal, ...current.preferenceSignals].slice(0, 8),
        mindState: {
          ...current.mindState,
          memoryClaims: claimWithSchedule,
          claimSources: boundaryWrite.sources,
          recentChangedClaims: [
            awakeningClaim,
            ...current.mindState.recentChangedClaims.filter((c) => c.id !== awakeningClaim.id),
          ].slice(0, 12),
          pendingInternalEvents: nextEvents.slice(0, 24),
        },
      };
    });

    await queuePendingInternalEvents(updatedPersona);

    return {
      persona: updatedPersona,
      preferenceUpdate,
      contextualUpdate: `The user requested a scheduled awakening: ${preferenceUpdate.effectSummary}. Acknowledge it warmly and naturally.`,
    };
  }

  if (preferenceUpdate.kind === "cancel_awakening") {
    const updatedPersona = await updatePersona(persona.id, (current) => {
      const { claims: updatedClaims, deactivatedIds } = deactivateMatchingAwakeningClaims(
        current.mindState.memoryClaims,
        userText,
        signal.createdAt,
      );

      const updatedEvents = current.mindState.pendingInternalEvents.map((event) => {
        if ((event.origin !== "ritual" && event.origin !== "awakening") || event.status !== "pending") {
          return event;
        }
        const meta = event.perception.metadata as Record<string, unknown> | undefined;
        const claimId = (meta?.awakeningClaimId ?? meta?.ritualClaimId) as string | undefined;
        if (claimId && deactivatedIds.includes(claimId)) {
          return { ...event, status: "cancelled" as const, updatedAt: signal.createdAt };
        }
        return event;
      });

      return {
        ...current,
        updatedAt: new Date().toISOString(),
        preferenceSignals: [signal, ...current.preferenceSignals].slice(0, 8),
        mindState: {
          ...current.mindState,
          memoryClaims: updatedClaims,
          pendingInternalEvents: updatedEvents,
        },
      };
    });

    return {
      persona: updatedPersona,
      preferenceUpdate,
      contextualUpdate:
        "The user cancelled their scheduled awakenings. Acknowledge naturally and don't sound like a machine that just turned off a timer.",
    };
  }

  const updatedPersona = await updatePersona(persona.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    heartbeatPolicy: preferenceUpdate.apply(current.heartbeatPolicy),
    preferenceSignals: [signal, ...current.preferenceSignals].slice(0, 8),
    mindState: (() => {
      const boundaryWrite = applyBoundaryClaimUpdate({
        claims: current.mindState.memoryClaims,
        claimSources: current.mindState.claimSources,
        summary: preferenceUpdate.effectSummary,
        detail: preferenceUpdate.interpretation,
        createdAt: signal.createdAt,
        sourceMessageId: options?.sourceMessageId,
        sessionId: options?.sessionId,
        sourceText: userText,
      });

      return {
        ...current.mindState,
        memoryClaims: boundaryWrite.claims,
        claimSources: boundaryWrite.sources,
        recentChangedClaims: [
          boundaryWrite.result.claim,
          ...current.mindState.recentChangedClaims.filter(
            (claim) => claim.id !== boundaryWrite.result.claim.id,
          ),
        ].slice(0, 12),
      };
    })(),
  }));

  const contextualUpdate = [
    `The user just set or reinforced a boundary: ${preferenceUpdate.effectSummary}`,
    `Interpret it this way: ${preferenceUpdate.interpretation}`,
    preferenceUpdate.status === "negotiating"
      ? "You may show a brief flash of personality, but accept the boundary immediately after that."
      : "Acknowledge the boundary naturally and adjust the tone right away.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    persona: updatedPersona,
    preferenceUpdate,
    contextualUpdate,
  };
}

function createDerivedVisualObservation(input: {
  persona: Persona;
  messages: MessageEntry[];
  mode: "voice" | "screen" | "camera";
  source: "message_image" | "screen" | "camera";
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  createdAt: string;
  sessionId?: string;
  sourceMessageId?: string;
}) {
  const providers = getProviders();
  return providers.reasoning
    .observeVisualContext({
      persona: input.persona,
      messages: input.messages,
      buffer: input.buffer,
      fileName: input.fileName,
      mimeType: input.mimeType,
      mode: input.mode,
      source: input.source,
    })
    .then((derived) => {
      const userState = deriveLiveUserState({
        channel: input.source === "message_image" ? "web" : "live",
        createdAt: input.createdAt,
        visualContext: [derived],
      });

      return {
        id: randomUUID(),
        personaId: input.persona.id,
        kind:
          input.source === "message_image"
            ? ("user_shared_image" as const)
            : visualObservationKindForMode(input.mode),
        mode: input.mode,
        summary: derived.summary,
        situationalSignals: derived.situationalSignals,
        environmentPressure: derived.environmentPressure,
        taskContext: derived.taskContext,
        attentionTarget: derived.attentionTarget,
        sessionId: input.sessionId,
        sourceMessageId: input.sourceMessageId,
        userState,
        createdAt: input.createdAt,
      };
    });
}

function visualObservationKindForMode(mode: "voice" | "screen" | "camera"): PerceptionObservation["kind"] {
  return mode === "camera" ? "camera_observation" : "screen_observation";
}

function deriveLiveUserState(input: {
  channel: "web" | "live";
  createdAt: string;
  visualContext: Array<{
    summary: string;
    situationalSignals: string[];
    environmentPressure: number;
    taskContext?: string;
    attentionTarget?: string;
  }>;
}) {
  return inferProsodyUserState(input);
}

/**
 * Send a message to a persona and get a reply. Runs the full cognitive pipeline:
 * transcribe (if voice) → observe images (if any) → appraise → deliberate → reply → learn.
 * The persona may choose to reply with a voice note based on personality and emotional context.
 */
export async function sendPersonaMessage(
  personaId: string,
  payload: {
    text?: string;
    audioFile?: File | null;
    images?: File[];
    channel?: ConversationChannel;
  },
) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  if (persona.status !== "active") {
    throw new Error("This persona must be approved before conversation can begin.");
  }

  const providers = getProviders();
  const providerStatus = getProviderStatus();
  const requestStartedAt = Date.now();
  const originalText = payload.text?.trim() ?? "";
  let userText = originalText;

  await recordUserActivity(personaId, new Date(requestStartedAt));
  const imageFiles = (payload.images ?? []).filter((file) => file.size > 0);
  let audioAttachment: MessageAttachment | undefined;
  let transcriptionMs = 0;
  let imageObservationMs = 0;
  let fastTurnMs = 0;
  let assistantAppendMs = 0;

  if (payload.audioFile && payload.audioFile.size > 0) {
    audioAttachment = await persistMessageAttachment(payload.audioFile, "audio");

    if (!userText) {
      const transcriptionStartedAt = Date.now();
      const buffer = Buffer.from(await payload.audioFile.arrayBuffer());
      userText = await providers.transcription.transcribeAudio({
        buffer,
        mimeType: payload.audioFile.type || "audio/webm",
        fileName: payload.audioFile.name,
      });
      transcriptionMs = Date.now() - transcriptionStartedAt;
    }
  }

  if (!userText && imageFiles.length > 0) {
    userText = summarizeImageShare(imageFiles.length);
  }

  if (!userText && !audioAttachment) {
    throw new Error("A text message, voice note, or image is required.");
  }

  const existingMessages = await listMessages(personaId);
  const userMessageCreatedAt = new Date().toISOString();
  const userMessage = createMessage({
    personaId,
    role: "user",
    kind:
      payload.audioFile && payload.audioFile.size > 0
        ? "audio"
        : imageFiles.length > 0 && !originalText
          ? "image"
          : "text",
    channel: payload.channel ?? "web",
    body: userText,
    attachments: audioAttachment ? [audioAttachment] : [],
    audioUrl: audioAttachment?.url,
    audioStatus: audioAttachment ? "ready" : "unavailable",
    createdAt: userMessageCreatedAt,
    delivery: {
      webInbox: true,
      attempts: 0,
    },
  });

  const imageAttachments: MessageAttachment[] = [];
  const observations: PerceptionObservation[] = [];
  const imageObservationStartedAt = imageFiles.length > 0 ? Date.now() : 0;

  const imageResults = await Promise.all(
    imageFiles.map(async (imageFile) => {
      const buffer = Buffer.from(await imageFile.arrayBuffer());
      const observation = await createDerivedVisualObservation({
        persona,
        messages: existingMessages,
        mode: "camera",
        source: "message_image",
        fileName: imageFile.name,
        mimeType: imageFile.type || "image/png",
        buffer,
        createdAt: userMessageCreatedAt,
        sourceMessageId: userMessage.id,
      });
      const attachment = await persistMessageAttachment(imageFile, "image", {
        visualSummary: observation.summary,
      });
      return { observation, attachment };
    }),
  );
  for (const result of imageResults) {
    imageAttachments.push(result.attachment);
    observations.push(result.observation);
  }
  if (imageObservationStartedAt > 0) {
    imageObservationMs = Date.now() - imageObservationStartedAt;
  }

  userMessage.attachments = [...userMessage.attachments, ...imageAttachments];

  if (observations.length > 0 && !originalText) {
    const visualSummaries = observations
      .map((o) => o.summary)
      .filter(Boolean)
      .join(" ");
    if (visualSummaries) {
      userText = `${userText} Visual context: ${visualSummaries}`;
    }
  }

  await appendMessages([userMessage]);
  if (observations.length > 0) {
    await appendPerceptionObservations(observations);
  }

  let activePersona = persona;
  const { preferenceUpdate, persona: updatedPersona } = await applyPreferenceSignalIfNeeded(
    persona,
    originalText,
    {
      sourceMessageId: userMessage.id,
    },
  );
  activePersona = updatedPersona;

  const feedback = await listFeedback(personaId);
  const feedbackNotes = feedback.map((entry) => entry.note);
  const perception: SoulPerception = {
    kind:
      payload.audioFile && payload.audioFile.size > 0
        ? "voice_turn"
        : imageFiles.length > 0 && !originalText
          ? "user_shared_image"
          : "text_message",
    channel: payload.channel ?? "web",
    modality:
      payload.audioFile && payload.audioFile.size > 0
        ? "voice_note"
        : imageFiles.length > 0 && !originalText
          ? "image"
          : observations.length > 0
            ? "multimodal"
            : "text",
    content: userText || summarizeImageShare(imageFiles.length),
    createdAt: userMessage.createdAt,
    internal: false,
    causationId: userMessage.id,
    correlationId: userMessage.id,
    metadata: {
      messageId: userMessage.id,
      attachmentTypes: userMessage.attachments.map((attachment) => attachment.type).join(","),
    },
  };

  const cognitiveStartedAt = Date.now();
  const monologuePlan = planInternalMonologue({
    persona: activePersona,
    messages: await listMessages(personaId),
    feedbackNotes,
    latestUserText: userText,
    channel: (payload.channel ?? "web") as "web" | "live",
  });
  const monologue = await providers.reasoning.generateInternalMonologue(
    renderInternalMonologuePrompt(monologuePlan),
  );

  const now = new Date().toISOString();
  activePersona = await updatePersona(personaId, (current) => ({
    ...current,
    mindState: {
      ...current.mindState,
      internalState: {
        currentThought: monologue.thought,
        mood: monologue.mood,
        energy: monologue.energy,
        patience: monologue.patience,
        warmthTowardUser: monologue.warmthTowardUser,
        engagementDrive: monologue.engagementDrive,
        recentThoughts: [
          { thought: monologue.thought, createdAt: now },
          ...current.mindState.internalState.recentThoughts.slice(0, 7),
        ],
        updatedAt: now,
      },
    },
  }));

  const leaveOnRead = !preferenceUpdate && !monologue.shouldReply;

  const turnCommittedAt = new Date().toISOString();
  const soulTurnExecution = await runVersionedSoulTurn({
    personaId,
    basePersona: activePersona,
    updatedAt: turnCommittedAt,
    lastActiveAt: turnCommittedAt,
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception,
      latestUserText: userText,
      reasoning: providers.reasoning,
      replyChannel: "web",
      renderReply: !preferenceUpdate && !leaveOnRead,
      replyAsVoiceNote: monologue.replyFormat === "voice_note",
      boundaryTriggered: Boolean(preferenceUpdate),
    }),
  });
  fastTurnMs = Date.now() - cognitiveStartedAt;
  const soulTurnResult = soulTurnExecution.turnResult;

  const inferredUserState = soulTurnResult.userState ?? soulTurnResult.persona.mindState.lastUserState;
  activePersona = soulTurnExecution.persona;
  if (inferredUserState) {
    userMessage.userState = inferredUserState;
    await updateMessage(userMessage.id, (current) => ({
      ...current,
      userState: inferredUserState,
    }));
  }

  if (leaveOnRead) {
    soulLogger.debug(
      {
        personaId,
        thought: monologue.thought,
        mood: monologue.mood,
        engagementDrive: monologue.engagementDrive,
        process: soulTurnResult.persona.mindState.activeProcess,
        event: "left_on_read",
      },
      "Persona chose not to reply",
    );

    return {
      persona: activePersona,
      messages: await listMessages(personaId),
      appended: [userMessage],
      leftOnRead: true,
    };
  }

  const replyText = preferenceUpdate
    ? composePreferenceReply(activePersona, preferenceUpdate)
    : soulTurnResult.replyText ?? "";
  const shouldReplyWithVoiceNote =
    Boolean(audioAttachment) ||
    (monologue.replyFormat === "voice_note" &&
      activePersona.voice.provider === "hume" &&
      activePersona.voice.status !== "unavailable");
  const synthesized = shouldReplyWithVoiceNote
    ? await providers.voice.synthesize({
        personaName: activePersona.name,
        voiceId: activePersona.voice.voiceId,
        text: replyText,
        stylePrompt: [
          activePersona.dossier.communicationStyle,
          activePersona.description,
          preferenceUpdate ? "Acknowledge the boundary with personality." : "One intimate reply.",
        ]
          .filter(Boolean)
          .join(" "),
      })
    : {
        status: "unavailable" as const,
        audioUrl: undefined,
      };

  const assistantMessage = createMessage({
    personaId,
    role: "assistant",
    kind: synthesized.audioUrl ? "audio" : "text",
    channel: payload.channel ?? "web",
    body: replyText,
    audioUrl: synthesized.audioUrl,
    audioStatus: synthesized.status,
    replyMode: synthesized.audioUrl ? "voice_note" : "text",
    delivery: {
      webInbox: true,
      attempts: 0,
    },
  });

  const assistantAppendStartedAt = Date.now();
  await appendMessages([assistantMessage]);
  assistantAppendMs = Date.now() - assistantAppendStartedAt;

  const messagesWithReply = await listMessages(personaId);

  soulLogger.debug(
    {
      personaId,
      channel: payload.channel ?? "web",
      messageKind: userMessage.kind,
      reasoningProvider: providerStatus.reasoning,
      totalDurationMs: Date.now() - requestStartedAt,
      transcriptionMs,
      imageObservationMs,
      cognitiveTurnMs: fastTurnMs,
      assistantAppendMs,
      learningArtifacts: soulTurnResult.learningArtifacts.length,
      process: soulTurnResult.persona.mindState.activeProcess,
    },
    "message send completed (full cognitive turn)",
  );

  return {
    persona: activePersona,
    messages: messagesWithReply,
    appended: [userMessage, assistantMessage],
  };
}

export type { PreferenceUpdate };
