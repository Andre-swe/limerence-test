import { randomUUID } from "node:crypto";
import { appendMessages, claimPersonaShadowTurn, claimPersonaShadowTurnById, enqueuePersonaShadowTurn, getPersona, listFeedback, listMessages, listPerceptionObservations, updatePersona, updatePersonaShadowTurn } from "@/lib/store";
import { executeSoulTurn } from "@/lib/soul-engine";
import { publishPersonaShadowTurns, publishSoulInternalEvents } from "@/lib/inngest";
import {
  buildAwakeningInternalEvent,
} from "@/lib/memory-v2";
import { computeAwakeningReliability } from "@/lib/soul-runtime";
import { resolvePersonaTimeZone } from "@/lib/persona-schedule";
import { buildDebugContext, summarizePendingInternalEvents } from "@/lib/debug-observability";
import { soulLogger } from "@/lib/soul-logger";
import { createMessage } from "@/lib/services/assets";
import {
  clearAllLocalShadowExecutions,
  drainLocalShadowExecutions,
  getLocalShadowExecution,
  recordLocalShadowExecution,
  resetServiceRuntimeHelpers,
  resolveMetricsMode,
} from "@/lib/services/runtime";
import { commitTurnResultWithRevision, runVersionedSoulTurn } from "@/lib/services/turns";
import type { PendingShadowTurn, Persona, SoulEvent, SoulPerception } from "@/lib/types";

async function scheduleLocalShadowExecution(personaId: string, jobId: string) {
  const previous = getLocalShadowExecution(personaId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await executeQueuedShadowTurn(personaId, jobId);
    })
    .catch((error) => {
      soulLogger.warn(
        {
          personaId,
          jobId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Falling back to local background shadow execution",
      );
    });

  recordLocalShadowExecution(personaId, next);
}

export async function queuePendingInternalEvents(persona: Persona) {
  const pending = persona.mindState.pendingInternalEvents.filter((event) => event.status === "pending");

  if (pending.length === 0) {
    return persona;
  }

  const queuedIds = await publishSoulInternalEvents({
    personaId: persona.id,
    events: pending,
  });

  if (queuedIds.length === 0) {
    return persona;
  }

  return updatePersona(persona.id, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    mindState: {
      ...current.mindState,
      pendingInternalEvents: current.mindState.pendingInternalEvents.map((event) =>
        queuedIds.includes(event.id)
          ? {
              ...event,
              status: "queued",
              updatedAt: new Date().toISOString(),
            }
          : event,
      ),
    },
  }));
}

export async function enqueueShadowTurnForExecution(
  personaId: string,
  shadowTurn: PendingShadowTurn,
  options?: {
    backgroundFallback?: boolean;
  },
) {
  const queuedPersona = await enqueuePersonaShadowTurn(personaId, shadowTurn);
  const publishedIds = await publishPersonaShadowTurns({
    personaId,
    jobs: [shadowTurn],
  });

  if (options?.backgroundFallback !== false && !publishedIds.includes(shadowTurn.id)) {
    await scheduleLocalShadowExecution(personaId, shadowTurn.id);
  }

  return queuedPersona;
}

async function processClaimedShadowTurn(
  personaId: string,
  claimed: NonNullable<Awaited<ReturnType<typeof claimPersonaShadowTurn>>>,
  sessionId?: string,
) {
  const { persona, job } = claimed;
  const providers = await import("@/lib/providers").then((mod) => mod.getProviders());
  const feedbackNotes = await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const perceptionMetadata =
    job.perception.metadata && typeof job.perception.metadata === "object"
      ? (job.perception.metadata as Record<string, unknown>)
      : undefined;
  const liveMode = resolveMetricsMode({
    metadata: perceptionMetadata,
  });
  const shadowTriggerReason =
    typeof perceptionMetadata?.shadowTriggerReason === "string"
      ? perceptionMetadata.shadowTriggerReason
      : undefined;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const executionPersona = attempt === 0 ? persona : await getPersona(personaId);
    if (!executionPersona) {
      break;
    }

    const messages = await listMessages(personaId);
    const observations = await listPerceptionObservations(personaId);

    const turnResult = await executeSoulTurn({
      persona: executionPersona,
      messages,
      observations,
      feedbackNotes,
      perception: job.perception,
      latestUserText:
        job.perception.kind === "user_message" ||
        job.perception.kind === "text_message" ||
        job.perception.kind === "voice_turn"
          ? job.perception.content ?? ""
          : "",
      providedUserState: attempt === 0 ? job.providedUserState : undefined,
      reasoning: providers.reasoning,
      renderReply: false,
      boundaryTriggered: false,
    });

    const updatedAt = new Date().toISOString();
    const committed = await commitTurnResultWithRevision({
      personaId,
      baseRevision: executionPersona.revision,
      turnResult,
      updatedAt,
      lastActiveAt: updatedAt,
      shadowJobId: job.id,
      liveSessionId: sessionId,
      liveMode,
      liveDeliveryMetricReason:
        shadowTriggerReason === "periodic_sync"
          ? "periodic_sync"
          : turnResult.sessionFrame.deliveryReason,
    });

    if (committed.matched) {
      const didRequestLiveDelivery =
        committed.persona.mindState.liveDeliveryVersion >
        executionPersona.mindState.liveDeliveryVersion;

      if (didRequestLiveDelivery) {
        soulLogger.debug(
          {
            personaId,
            sessionId,
            mode: liveMode,
            version: committed.persona.mindState.liveDeliveryVersion,
            reason:
              shadowTriggerReason === "periodic_sync"
                ? "periodic_sync"
                : turnResult.sessionFrame.deliveryReason,
            event: "live_delivery_requested",
          },
          "Live delivery requested by shadow cognition",
        );
      }

      soulLogger.debug(
        {
          personaId,
          jobId: job.id,
          sessionId,
          revision: committed.persona.revision,
        },
        "Shadow turn committed",
      );
      return committed.persona;
    }

    soulLogger.debug(
      {
        personaId,
        jobId: job.id,
        sessionId,
        expectedRevision: executionPersona.revision,
        actualRevision: committed.persona.revision,
        attempt: attempt + 1,
      },
      "Shadow turn revision mismatch; retrying",
    );
  }

  await updatePersonaShadowTurn(personaId, job.id, (current) => ({
    ...current,
    status: current.attempts >= 3 ? "failed" : "pending",
    lastError:
      current.attempts >= 3
        ? "Shadow cognition exceeded retry limit after revision conflicts."
        : "Revision mismatch; requeued for retry.",
    completedAt: current.attempts >= 3 ? new Date().toISOString() : current.completedAt,
  }));

  return getPersona(personaId);
}

async function processNextShadowTurn(personaId: string, sessionId?: string) {
  const claimed = await claimPersonaShadowTurn(personaId, sessionId);
  if (!claimed) {
    return null;
  }

  return processClaimedShadowTurn(personaId, claimed, sessionId);
}

export async function processNextShadowTurnForServices(personaId: string, sessionId?: string) {
  return processNextShadowTurn(personaId, sessionId);
}

export async function executeQueuedShadowTurn(personaId: string, jobId: string) {
  const claimed = await claimPersonaShadowTurnById(personaId, jobId);
  if (!claimed) {
    return {
      handled: false,
      persona: await getPersona(personaId),
    };
  }

  const persona = await processClaimedShadowTurn(personaId, claimed, claimed.job.sessionId);
  return {
    handled: true,
    persona,
  };
}

export async function executeSoulInternalEvent(
  personaId: string,
  eventId: string,
  options?: {
    now?: Date;
    feedbackNotes?: string[];
  },
) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const pendingEventsBefore = summarizePendingInternalEvents(
    persona.mindState.pendingInternalEvents,
  );

  const internalEvent = persona.mindState.pendingInternalEvents.find((event) => event.id === eventId);
  if (!internalEvent || (internalEvent.status !== "pending" && internalEvent.status !== "queued")) {
    return {
      handled: false,
      persona,
    };
  }

  const now = options?.now ?? new Date();
  if (new Date(internalEvent.readyAt).getTime() > now.getTime()) {
    return {
      handled: false,
      persona,
    };
  }

  if (internalEvent.origin === "ritual" || internalEvent.origin === "awakening") {
    return executeAwakeningOccurrence(personaId, internalEvent, options);
  }

  const localShadowQueue = getLocalShadowExecution(personaId);
  if (localShadowQueue) {
    await localShadowQueue.catch(() => undefined);
  }

  const feedbackNotes: string[] = options?.feedbackNotes
    ? [...options.feedbackNotes]
    : await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const providers = await import("@/lib/providers").then((mod) => mod.getProviders());
  const execution = await runVersionedSoulTurn({
    personaId,
    basePersona: persona,
    updatedAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
        ...internalEvent.perception,
        internal: true,
        createdAt: now.toISOString(),
      },
      latestUserText: "",
      reasoning: providers.reasoning,
      renderReply: false,
    }),
  });

  let activePersona = execution.persona;
  activePersona = await updatePersona(activePersona.id, (current) => {
    const executedEvent = {
      id: randomUUID(),
      type: "internal_event_executed",
      perceptionId: internalEvent.perception.id,
      process: internalEvent.processHint,
      processInstanceId: current.mindState.currentProcessInstanceId,
      channel: internalEvent.perception.channel,
      sessionId: internalEvent.perception.sessionId,
      summary: internalEvent.dedupeKey,
      outputSummary: "Internal event executed by the soul scheduler.",
      memoryKeys: [],
      fallback: false,
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      durationMs: 0,
    } satisfies SoulEvent;

    return {
      ...current,
      updatedAt: now.toISOString(),
      mindState: {
        ...current.mindState,
        pendingInternalEvents: current.mindState.pendingInternalEvents.map((event) =>
          event.id === internalEvent.id
            ? {
                ...event,
                status: "executed",
                updatedAt: now.toISOString(),
              }
            : event,
        ),
        recentEvents: [executedEvent, ...current.mindState.recentEvents].slice(0, 32),
      },
    };
  });
  activePersona = await queuePendingInternalEvents(activePersona);

  soulLogger.debug(
    {
      ...buildDebugContext(activePersona, {
        event: "internal_event_executed",
        eventId,
        channel: internalEvent.perception.channel,
        sessionId: internalEvent.perception.sessionId,
      }),
      beforePendingInternalEvents: pendingEventsBefore,
      afterPendingInternalEvents: summarizePendingInternalEvents(
        activePersona.mindState.pendingInternalEvents,
      ),
    },
    "Internal scheduled event executed",
  );

  return {
    handled: true,
    persona: activePersona,
    eventId,
  };
}

export async function executeReadyInternalEvents(input: {
  persona: Persona;
  now: Date;
  feedbackNotes: string[];
}) {
  let activePersona = input.persona;
  const readyEvents = activePersona.mindState.pendingInternalEvents
    .filter(
      (event) =>
        (event.status === "pending" || event.status === "queued") &&
        new Date(event.readyAt).getTime() <= input.now.getTime(),
    )
    .slice(0, 4);

  if (readyEvents.length === 0) {
    return activePersona;
  }

  for (const internalEvent of readyEvents) {
    const execution = await executeSoulInternalEvent(activePersona.id, internalEvent.id, {
      now: input.now,
      feedbackNotes: input.feedbackNotes,
    });

    if (execution.persona) {
      activePersona = execution.persona;
    }
  }

  return activePersona;
}

async function executeAwakeningOccurrence(
  personaId: string,
  internalEvent: import("@/lib/types").InternalScheduledEvent,
  options?: { now?: Date; feedbackNotes?: string[] },
) {
  const persona = await getPersona(personaId);
  if (!persona) {
    return { handled: false, persona: null, eventId: internalEvent.id };
  }

  const pendingEventsBefore = summarizePendingInternalEvents(
    persona.mindState.pendingInternalEvents,
  );

  const now = options?.now ?? new Date();
  const isoNow = now.toISOString();
  const metadata = internalEvent.perception.metadata as Record<string, unknown> | undefined;
  const awakeningClaimId = (metadata?.awakeningClaimId ?? metadata?.ritualClaimId) as string | undefined;

  if (!awakeningClaimId) {
    return { handled: false, persona, eventId: internalEvent.id };
  }

  const awakeningClaim = persona.mindState.memoryClaims.find((c) => c.id === awakeningClaimId);
  if (!awakeningClaim?.awakeningSchedule?.active) {
    const updated = await updatePersona(personaId, (current) => ({
      ...current,
      mindState: {
        ...current.mindState,
        pendingInternalEvents: current.mindState.pendingInternalEvents.map((e) =>
          e.id === internalEvent.id
            ? { ...e, status: "cancelled" as const, updatedAt: isoNow }
            : e,
        ),
      },
    }));
    soulLogger.debug(
      {
        ...buildDebugContext(updated, {
          event: "awakening_cancelled",
          eventId: internalEvent.id,
          channel: internalEvent.perception.channel,
          sessionId: internalEvent.perception.sessionId,
        }),
        beforePendingInternalEvents: pendingEventsBefore,
        afterPendingInternalEvents: summarizePendingInternalEvents(
          updated.mindState.pendingInternalEvents,
        ),
      },
      "Awakening cancelled because the claim is inactive",
    );
    return { handled: true, persona: updated, eventId: internalEvent.id };
  }

  const schedule = awakeningClaim.awakeningSchedule;
  const isOneShot = schedule.recurrence === "once";
  const awakeningKind = schedule.awakeningKind ?? "ritual";

  const reliability = computeAwakeningReliability(persona);
  const fires = Math.random() <= reliability;

  if (!fires) {
    const updated = await updatePersona(personaId, (current) => ({
      ...current,
      updatedAt: isoNow,
      mindState: {
        ...current.mindState,
        memoryClaims: current.mindState.memoryClaims.map((c) =>
          c.id === awakeningClaimId && c.awakeningSchedule
            ? {
                ...c,
                ...(isOneShot ? { status: "stale" as const } : {}),
                awakeningSchedule: {
                  ...c.awakeningSchedule,
                  skipCount: c.awakeningSchedule.skipCount + 1,
                  ...(isOneShot ? { active: false } : {}),
                },
              }
            : c,
        ),
        pendingInternalEvents: [
          ...current.mindState.pendingInternalEvents.map((e) =>
            e.id === internalEvent.id
              ? { ...e, status: "executed" as const, updatedAt: isoNow }
              : e,
          ),
          ...(!isOneShot
            ? [buildAwakeningInternalEvent(awakeningClaim, resolvePersonaTimeZone(current.timezone), now)]
            : []),
        ].slice(0, 24),
      },
    }));
    const queuedPersona = await queuePendingInternalEvents(updated);
    soulLogger.debug(
      {
        ...buildDebugContext(queuedPersona, {
          event: "awakening_skipped",
          eventId: internalEvent.id,
          channel: internalEvent.perception.channel,
          sessionId: internalEvent.perception.sessionId,
          awakeningKind,
        }),
        beforePendingInternalEvents: pendingEventsBefore,
        afterPendingInternalEvents: summarizePendingInternalEvents(
          queuedPersona.mindState.pendingInternalEvents,
        ),
      },
      "Awakening occurrence skipped by reliability roll",
    );
    return { handled: true, persona: queuedPersona, eventId: internalEvent.id };
  }

  const feedbackNotes: string[] = options?.feedbackNotes
    ? [...options.feedbackNotes]
    : await listFeedback(personaId).then((entries) => entries.map((entry) => entry.note));
  const messages = await listMessages(personaId);
  const providers = await import("@/lib/providers").then((mod) => mod.getProviders());

  const contextByKind: Record<string, string> = {
    ritual: [
      `[AWAKENING CONTEXT] You remembered something that made you want to reach out.`,
      `The ritual: "${awakeningClaim.summary}".`,
      `The user originally said: "${schedule.sourceUtterance}".`,
      `Send a natural message grounded in this ritual. Do NOT mention schedules or timers.`,
    ].join(" "),
    reminder: [
      `[AWAKENING CONTEXT] You're reminding them about something.`,
      `Remind them about: "${awakeningClaim.summary}".`,
      `The user originally said: "${schedule.sourceUtterance}".`,
      `Be direct but warm. This is a one-time reminder, not a recurring message.`,
    ].join(" "),
    followup: [
      `[AWAKENING CONTEXT] You wanted to check back about something.`,
      `You wanted to check back about: "${awakeningClaim.summary}".`,
      `Ask naturally, as if you've been thinking about it.`,
    ].join(" "),
    deferred: [
      `[AWAKENING CONTEXT] You said you'd get back to them about something.`,
      `You said you'd get back to them about: "${awakeningClaim.summary}".`,
      `Follow through now. Be warm and direct.`,
    ].join(" "),
  };

  const awakeningContext = contextByKind[awakeningKind] ?? contextByKind.ritual;

  let content: string;
  try {
    content = await providers.reasoning.generateReply({
      persona,
      messages,
      latestUserText: awakeningContext,
      feedbackNotes,
      channel: "web",
    });
  } catch {
    content = schedule.sourceUtterance;
  }
  const heartbeatMessage = createMessage({
    personaId,
    role: "assistant",
    kind: "text",
    channel: "heartbeat",
    body: content,
    audioStatus: "unavailable",
    delivery: {
      webInbox: true,
      attempts: 0,
    },
  });

  await appendMessages([heartbeatMessage]);

  const assistantTurnExecution = await runVersionedSoulTurn({
    personaId,
    basePersona: persona,
    updatedAt: isoNow,
    lastActiveAt: isoNow,
    lastHeartbeatAt: isoNow,
    build: async () => ({
      messages: await listMessages(personaId),
      observations: await listPerceptionObservations(personaId),
      feedbackNotes,
      perception: {
        kind: "assistant_message",
        channel: "heartbeat",
        modality: "text",
        content: heartbeatMessage.body,
        createdAt: heartbeatMessage.createdAt,
        internal: true,
        causationId: heartbeatMessage.id,
        correlationId: heartbeatMessage.id,
        metadata: {
          messageId: heartbeatMessage.id,
          heartbeatAction: "TEXT",
          awakeningClaimId,
          awakeningKind,
        },
      } satisfies SoulPerception,
      latestUserText: "",
      reasoning: providers.reasoning,
      renderReply: false,
    }),
  });

  let activePersona = assistantTurnExecution.persona;
  activePersona = await updatePersona(personaId, (current) => ({
    ...current,
    mindState: {
      ...current.mindState,
      memoryClaims: current.mindState.memoryClaims.map((c) =>
        c.id === awakeningClaimId && c.awakeningSchedule
          ? {
              ...c,
              ...(isOneShot ? { status: "stale" as const } : {}),
              awakeningSchedule: {
                ...c.awakeningSchedule,
                lastFiredAt: isoNow,
                fireCount: c.awakeningSchedule.fireCount + 1,
                ...(isOneShot ? { active: false } : {}),
              },
            }
          : c,
      ),
      pendingInternalEvents: [
        ...current.mindState.pendingInternalEvents.map((e) =>
          e.id === internalEvent.id
            ? { ...e, status: "executed" as const, updatedAt: isoNow }
            : e,
        ),
        ...(!isOneShot
          ? [buildAwakeningInternalEvent(awakeningClaim, resolvePersonaTimeZone(current.timezone), now)]
          : []),
      ].slice(0, 24),
    },
  }));

  activePersona = await queuePendingInternalEvents(activePersona);

  soulLogger.debug(
    {
      ...buildDebugContext(activePersona, {
        event: "awakening_fired",
        eventId: internalEvent.id,
        channel: internalEvent.perception.channel,
        sessionId: internalEvent.perception.sessionId,
        awakeningKind,
      }),
      beforePendingInternalEvents: pendingEventsBefore,
      afterPendingInternalEvents: summarizePendingInternalEvents(
        activePersona.mindState.pendingInternalEvents,
      ),
    },
    "Awakening occurrence fired and scheduled follow-up state",
  );

  return { handled: true, persona: activePersona, eventId: internalEvent.id };
}

export async function resetServiceRuntimeStateForTests() {
  await drainLocalShadowExecutions();
  clearAllLocalShadowExecutions();
  resetServiceRuntimeHelpers();
}
