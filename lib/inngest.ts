import { Inngest } from "inngest";
import { soulLogger } from "@/lib/soul-logger";
import type { InternalScheduledEvent, PendingShadowTurn } from "@/lib/types";

export const inngest = new Inngest({ id: "limerence" });

export function isInngestExecutionEnabled() {
  return Boolean(process.env.INNGEST_EVENT_KEY?.trim());
}

export async function publishSoulInternalEvents(input: {
  personaId: string;
  events: InternalScheduledEvent[];
}) {
  if (input.events.length === 0) {
    return [];
  }

  if (!isInngestExecutionEnabled()) {
    return [];
  }

  try {
    await inngest.send(
      input.events.map((event) => ({
        name: "soul/internal-event",
        data: {
          personaId: input.personaId,
          eventId: event.id,
          dedupeKey: event.dedupeKey,
          readyAt: event.readyAt,
          processHint: event.processHint,
          perception: event.perception,
        },
      })),
    );

    return input.events.map((event) => event.id);
  } catch (error) {
    soulLogger.warn(
      {
        personaId: input.personaId,
        eventCount: input.events.length,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to publish soul internal events",
    );
    return [];
  }
}

export async function publishPersonaShadowTurns(input: {
  personaId: string;
  jobs: PendingShadowTurn[];
}) {
  if (input.jobs.length === 0) {
    return [];
  }

  if (!isInngestExecutionEnabled()) {
    return [];
  }

  try {
    await inngest.send(
      input.jobs.map((job) => ({
        name: "soul/shadow-turn",
        data: {
          personaId: input.personaId,
          jobId: job.id,
          sessionId: job.sessionId,
          baseRevision: job.baseRevision,
          attempts: job.attempts,
          dedupeKey: `${input.personaId}:${job.id}`,
          perception: job.perception,
        },
      })),
    );

    return input.jobs.map((job) => job.id);
  } catch (error) {
    soulLogger.warn(
      {
        personaId: input.personaId,
        jobCount: input.jobs.length,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to publish soul shadow turns",
    );
    return [];
  }
}

export const soulInternalEventFunction = inngest.createFunction(
  { id: "soul-internal-event" },
  { event: "soul/internal-event" },
  async ({ event }) => {
    const { executeSoulInternalEvent } = await import("@/lib/services");
    const execution = await executeSoulInternalEvent(event.data.personaId, event.data.eventId);

    soulLogger.info(
      {
        personaId: event.data.personaId,
        eventId: event.data.eventId,
        dedupeKey: event.data.dedupeKey,
        handled: execution.handled,
      },
      "soul internal event received by inngest",
    );

    return {
      received: true,
      handled: execution.handled,
      personaId: event.data.personaId,
      eventId: event.data.eventId,
    };
  },
);

export const soulShadowTurnFunction = inngest.createFunction(
  { id: "soul-shadow-turn" },
  { event: "soul/shadow-turn" },
  async ({ event }) => {
    const { executeQueuedShadowTurn } = await import("@/lib/services");
    const execution = await executeQueuedShadowTurn(event.data.personaId, event.data.jobId);

    soulLogger.info(
      {
        personaId: event.data.personaId,
        jobId: event.data.jobId,
        sessionId: event.data.sessionId,
        handled: execution.handled,
      },
      "soul shadow turn received by inngest",
    );

    return {
      received: true,
      handled: execution.handled,
      personaId: event.data.personaId,
      jobId: event.data.jobId,
    };
  },
);

export const inngestFunctions = [soulInternalEventFunction, soulShadowTurnFunction];
