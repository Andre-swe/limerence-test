import { Inngest, NonRetriableError } from "inngest";
import * as Sentry from "@sentry/nextjs";
import { soulLogger } from "@/lib/soul-logger";
import type { InternalScheduledEvent, PendingShadowTurn } from "@/lib/types";

export const inngest = new Inngest({ id: "limerence" });

/**
 * Log error to Sentry and structured logging.
 */
function captureException(error: Error, context: Record<string, unknown>) {
  // Send to Sentry
  Sentry.captureException(error, {
    extra: context,
    tags: {
      deadLetter: context.deadLetter ? "true" : "false",
      nonRetriable: context.nonRetriable ? "true" : "false",
    },
  });
  
  // Also log locally for debugging
  soulLogger.error(
    {
      ...context,
      error: error.message,
      stack: error.stack,
    },
    "inngest function failed - sent to sentry",
  );
}

/**
 * Determine if an error is retriable.
 * Some errors (like validation errors) should not be retried.
 */
function isRetriableError(error: unknown): boolean {
  if (error instanceof NonRetriableError) {
    return false;
  }
  
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  
  // Non-retriable errors
  if (
    message.includes("persona not found") ||
    message.includes("validation") ||
    message.includes("invalid") ||
    message.includes("not authorized")
  ) {
    return false;
  }
  
  return true;
}

/** Check if Inngest is configured for background job execution. */
export function isInngestExecutionEnabled() {
  return Boolean(process.env.INNGEST_EVENT_KEY?.trim());
}

/** Publish scheduled soul events to Inngest for background execution. */
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

/** Publish pending shadow turns to Inngest for background cognitive processing. */
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
  {
    id: "soul-internal-event",
    retries: 3,
  },
  { event: "soul/internal-event" },
  async ({ event, attempt }) => {
    const context = {
      personaId: event.data.personaId,
      eventId: event.data.eventId,
      dedupeKey: event.data.dedupeKey,
      attempt,
    };

    try {
      const { executeSoulInternalEvent } = await import("@/lib/services");
      const execution = await executeSoulInternalEvent(event.data.personaId, event.data.eventId);

      soulLogger.info(
        { ...context, handled: execution.handled },
        "soul internal event executed by inngest",
      );

      return {
        received: true,
        handled: execution.handled,
        personaId: event.data.personaId,
        eventId: event.data.eventId,
      };
    } catch (error) {
      // Log failure with full context for monitoring
      const isLastAttempt = attempt >= 3;
      
      if (isLastAttempt) {
        // Dead-letter: all retries exhausted
        captureException(
          error instanceof Error ? error : new Error(String(error)),
          { ...context, deadLetter: true },
        );
      } else {
        soulLogger.warn(
          { ...context, error: error instanceof Error ? error.message : String(error) },
          "soul internal event failed, will retry",
        );
      }

      // Throw non-retriable errors immediately to avoid wasting retries
      if (!isRetriableError(error)) {
        captureException(
          error instanceof Error ? error : new Error(String(error)),
          { ...context, nonRetriable: true },
        );
        throw new NonRetriableError(
          error instanceof Error ? error.message : "Non-retriable error",
          { cause: error },
        );
      }

      throw error;
    }
  },
);

export const soulShadowTurnFunction = inngest.createFunction(
  {
    id: "soul-shadow-turn",
    retries: 5, // More retries for shadow turns since they're important
  },
  { event: "soul/shadow-turn" },
  async ({ event, attempt }) => {
    const context = {
      personaId: event.data.personaId,
      jobId: event.data.jobId,
      sessionId: event.data.sessionId,
      attempt,
    };

    try {
      const { executeQueuedShadowTurn } = await import("@/lib/services");
      const execution = await executeQueuedShadowTurn(event.data.personaId, event.data.jobId);

      soulLogger.info(
        { ...context, handled: execution.handled },
        "soul shadow turn executed by inngest",
      );

      return {
        received: true,
        handled: execution.handled,
        personaId: event.data.personaId,
        jobId: event.data.jobId,
      };
    } catch (error) {
      // Log failure with full context for monitoring
      const isLastAttempt = attempt >= 5;
      
      if (isLastAttempt) {
        // Dead-letter: all retries exhausted
        captureException(
          error instanceof Error ? error : new Error(String(error)),
          { ...context, deadLetter: true },
        );
      } else {
        soulLogger.warn(
          { ...context, error: error instanceof Error ? error.message : String(error) },
          "soul shadow turn failed, will retry",
        );
      }

      // Throw non-retriable errors immediately
      if (!isRetriableError(error)) {
        captureException(
          error instanceof Error ? error : new Error(String(error)),
          { ...context, nonRetriable: true },
        );
        throw new NonRetriableError(
          error instanceof Error ? error.message : "Non-retriable error",
          { cause: error },
        );
      }

      throw error;
    }
  },
);

export const inngestFunctions = [soulInternalEventFunction, soulShadowTurnFunction];
