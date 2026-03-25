import { appendMessages, getPersona, listFeedback, listMessages, listPersonas, listPersonasForUser, listPerceptionObservations, updatePersona } from "@/lib/store";
import { runDueHeartbeatsAcrossStores } from "@/lib/heartbeat-scheduler";
import { getProviders } from "@/lib/providers";
import { runDreamCycleForPersona } from "@/lib/services/dreams";
import { executeReadyInternalEvents, queuePendingInternalEvents } from "@/lib/services/internal-events";
import { runVersionedSoulTurn } from "@/lib/services/turns";
import { createMessage } from "@/lib/services/assets";
import { calculateCircadianInterval, countOutboundToday as countOutboundTodayForPersona, isPersonaInQuietHours, isPersonaInWorkHours } from "@/lib/persona-schedule";
import { listSupabaseRuntimeStoreKeys, getSupabaseRuntimeConfig } from "@/lib/supabase";
import { withUserStore } from "@/lib/store-context";
import { isDreamCycleDue, isInDreamWindow, shouldShareDream } from "@/lib/dream-cycle";
import type { HeartbeatDecision, Persona } from "@/lib/types";

function getEmotionalStateModifier(persona: Persona): number {
  const mindState = persona.mindState;
  const internalState = mindState.internalState;

  const energy = internalState?.energy ?? 0.6;
  const engagementDrive = internalState?.engagementDrive ?? 0.6;
  const mood = internalState?.mood ?? "";

  if (energy > 0.7 && engagementDrive > 0.7) return 0.6;
  if (energy < 0.4 && engagementDrive < 0.4) return 1.5;

  const moodLower = mood.toLowerCase();
  if (/(excit|energetic|happy|joyful|enthusiastic|eager|thrilled)/i.test(moodLower)) return 0.7;
  if (/(withdrawn|sad|tired|exhausted|depressed|lonely|melanchol)/i.test(moodLower)) return 1.4;
  return 1.2 - energy * 0.4;
}

function getRelationshipWarmthModifier(persona: Persona): number {
  const relationshipModel = persona.relationshipModel;
  const internalState = persona.mindState.internalState;

  const closeness = relationshipModel?.closeness ?? 0.5;
  const acceptablePushback = relationshipModel?.acceptablePushback ?? 0.5;
  const warmthTowardUser = internalState?.warmthTowardUser ?? 0.7;

  const avgRelationship = (closeness + acceptablePushback + warmthTowardUser) / 3;
  return 1.3 - avgRelationship * 0.6;
}

function applyVariableReinforcement(baseInterval: number, minInterval: number, maxInterval: number): number {
  const randomFactor = 0.7 + Math.random() * 0.6;
  const randomizedInterval = baseInterval * randomFactor;
  return Math.max(minInterval, Math.min(maxInterval, randomizedInterval));
}

function calculateNextHeartbeatInterval(persona: Persona, now: Date): number {
  const policy = persona.heartbeatPolicy;
  const minInterval = policy.minIntervalHours ?? 1;
  const maxInterval = policy.maxIntervalHours ?? 8;

  if (!policy.variableInterval) {
    return applyVariableReinforcement(policy.intervalHours, minInterval, maxInterval);
  }

  let baseInterval = calculateCircadianInterval(persona, now);

  if (isPersonaInQuietHours(persona, now)) {
    return applyVariableReinforcement(maxInterval * 2, maxInterval, maxInterval * 2);
  }

  if (policy.workHoursEnabled && isPersonaInWorkHours(persona, now)) {
    return applyVariableReinforcement(maxInterval * 1.5, maxInterval, maxInterval * 2);
  }

  baseInterval = baseInterval * getEmotionalStateModifier(persona);
  baseInterval = baseInterval * getRelationshipWarmthModifier(persona);

  return applyVariableReinforcement(baseInterval, minInterval, maxInterval);
}

function buildHeartbeatDue(persona: Persona, now: Date) {
  if (!persona.heartbeatPolicy.enabled || persona.status !== "active") {
    return false;
  }

  if (persona.nextHeartbeatAt) {
    return now >= new Date(persona.nextHeartbeatAt);
  }

  if (!persona.lastHeartbeatAt) {
    return true;
  }

  const lastMs = new Date(persona.lastHeartbeatAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return true;
  }

  const elapsedHours = (now.getTime() - lastMs) / (1000 * 60 * 60);
  const requiredInterval = calculateNextHeartbeatInterval(persona, now);
  return elapsedHours >= requiredInterval;
}

function nextHeartbeatAtFor(persona: Persona, now: Date) {
  const nextIntervalHours = calculateNextHeartbeatInterval(persona, now);
  return new Date(now.getTime() + nextIntervalHours * 60 * 60 * 1000).toISOString();
}

export async function runHeartbeat(personaId: string): Promise<HeartbeatDecision> {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const now = new Date();
  let activePersona = persona;

  if (isInDreamWindow(activePersona, now)) {
    if (isDreamCycleDue(activePersona, now)) {
      await runDreamCycleForPersona(personaId);
    }
    const nextHeartbeatAt = nextHeartbeatAtFor(activePersona, now);
    await updatePersona(personaId, (current) => ({
      ...current,
      lastHeartbeatAt: now.toISOString(),
      nextHeartbeatAt,
      updatedAt: now.toISOString(),
    }));
    return {
      action: "SILENT",
      reason: "Quiet hours — dream cycle active.",
    };
  }

  const feedback = await listFeedback(personaId);
  const feedbackNotes = feedback.map((entry) => entry.note);

  if (
    activePersona.mindState.pendingInternalEvents.some(
      (event) => (event.status === "pending" || event.status === "queued") && new Date(event.readyAt).getTime() <= now.getTime(),
    )
  ) {
    activePersona = await executeReadyInternalEvents({
      persona: activePersona,
      now,
      feedbackNotes,
    });
  }

  const messages = await listMessages(personaId);

  if (activePersona.mindState.lastDreamSummary) {
    const dreamCheck = shouldShareDream(activePersona, { isPremium: true });
    if (dreamCheck.share) {
      const dreamContent = activePersona.mindState.lastDreamSummary;
      await updatePersona(personaId, (current) => ({
        ...current,
        mindState: {
          ...current.mindState,
          lastDreamSummary: undefined,
          lastDreamVividness: undefined,
        },
      }));
      return {
        action: "TEXT",
        content: dreamContent,
        reason: "Sharing a vivid dream from last night.",
      };
    }
    await updatePersona(personaId, (current) => ({
      ...current,
      mindState: {
        ...current.mindState,
        lastDreamSummary: undefined,
        lastDreamVividness: undefined,
      },
    }));
  }

  if (countOutboundTodayForPersona(messages, activePersona, now) >= activePersona.heartbeatPolicy.maxOutboundPerDay) {
    const nextHeartbeatAt = nextHeartbeatAtFor(activePersona, now);

    await updatePersona(personaId, (current) => ({
      ...current,
      lastHeartbeatAt: now.toISOString(),
      nextHeartbeatAt,
      updatedAt: now.toISOString(),
    }));

    return {
      action: "SILENT",
      reason: "Daily outbound heartbeat cap reached.",
    };
  }

  const providers = getProviders();
  const decision = await providers.reasoning.runHeartbeatDecision({
    persona: activePersona,
    messages,
    feedbackNotes,
    now,
  });

  if (decision.action === "SILENT" || !decision.content) {
    const nextHeartbeatAt = nextHeartbeatAtFor(activePersona, now);

    await updatePersona(personaId, (current) => ({
      ...current,
      lastHeartbeatAt: now.toISOString(),
      nextHeartbeatAt,
      updatedAt: now.toISOString(),
    }));
    return decision;
  }

  const synthesized = await providers.voice.synthesize({
    personaName: activePersona.name,
    voiceId: activePersona.voice.voiceId,
    text: decision.content,
    stylePrompt: [
      activePersona.dossier.communicationStyle,
      activePersona.description,
      "A gentle proactive check-in.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  const heartbeatMessage = createMessage({
    personaId,
    role: "assistant",
    kind: synthesized.audioUrl ? "audio" : "text",
    channel: "heartbeat",
    body: decision.content,
    audioUrl: synthesized.audioUrl,
    audioStatus: synthesized.status,
    replyMode: decision.action === "VOICE_NOTE" ? "voice_note" : "text",
    delivery: {
      webInbox: true,
      attempts: 0,
    },
  });

  await appendMessages([heartbeatMessage]);

  const nextHeartbeatAt = nextHeartbeatAtFor(activePersona, now);

  const assistantTurnExecution = await runVersionedSoulTurn({
    personaId,
    basePersona: activePersona,
    updatedAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
    lastHeartbeatAt: now.toISOString(),
    nextHeartbeatAt,
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
        kind: "assistant_message",
        channel: "heartbeat",
        modality: decision.action === "VOICE_NOTE" ? "voice_note" : "text",
        content: heartbeatMessage.body,
        createdAt: heartbeatMessage.createdAt,
        internal: true,
        causationId: heartbeatMessage.id,
        correlationId: heartbeatMessage.id,
        metadata: {
          messageId: heartbeatMessage.id,
          heartbeatAction: decision.action,
        },
      },
      latestUserText: "",
      reasoning: providers.reasoning,
      renderReply: false,
    }),
  });
  activePersona = assistantTurnExecution.persona;
  await queuePendingInternalEvents(activePersona);

  return decision;
}

export async function runDueHeartbeats() {
  const now = new Date();

  if (!getSupabaseRuntimeConfig()) {
    return runDueHeartbeatsAcrossStores({
      now,
      listPersonasForStore: () => listPersonas(),
      runHeartbeatForStore: (personaId) => runHeartbeat(personaId),
      isDue: buildHeartbeatDue,
    });
  }

  const storeKeys = await listSupabaseRuntimeStoreKeys();
  if (storeKeys.length === 0) {
    return [];
  }

  return runDueHeartbeatsAcrossStores({
    now,
    storeKeys,
    listPersonasForStore: (storeKey) => {
      if (!storeKey) {
        return listPersonas();
      }

      return listPersonasForUser(storeKey);
    },
    runHeartbeatForStore: (personaId, storeKey) => {
      if (!storeKey) {
        return runHeartbeat(personaId);
      }

      return withUserStore(storeKey, () => runHeartbeat(personaId));
    },
    isDue: buildHeartbeatDue,
  });
}
