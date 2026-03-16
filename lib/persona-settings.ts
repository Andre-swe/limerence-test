import { updatePersona } from "@/lib/store";
import {
  type MessageEntry,
  type Persona,
  personaSettingsInputSchema,
  type PersonaSettingsInput,
} from "@/lib/types";
import {
  assertValidTimeZone,
  getHeartbeatBlockReason,
  getNextHeartbeatAt,
  getNextPendingInternalEvent,
  resolvePersonaTimeZone,
} from "@/lib/persona-schedule";

export function buildPersonaSettingsSnapshot(
  persona: Persona,
  messages: MessageEntry[],
  now: Date = new Date(),
) {
  const nextRitual = getNextPendingInternalEvent(persona, "ritual");
  const quietReason = getHeartbeatBlockReason(persona, messages, now);

  return {
    personaId: persona.id,
    name: persona.name,
    relationship: persona.relationship,
    timezone: resolvePersonaTimeZone(persona.timezone),
    heartbeatPolicy: {
      intervalHours: persona.heartbeatPolicy.intervalHours,
      quietHoursStart: persona.heartbeatPolicy.quietHoursStart,
      quietHoursEnd: persona.heartbeatPolicy.quietHoursEnd,
      preferredMode: persona.heartbeatPolicy.preferredMode,
      enabled: persona.heartbeatPolicy.enabled,
      maxOutboundPerDay: persona.heartbeatPolicy.maxOutboundPerDay,
      variableInterval: persona.heartbeatPolicy.variableInterval,
    },
    deliveryChannels: {
      web: true,
    },
    preferenceSignals: persona.preferenceSignals.slice(0, 8),
    diagnostics: {
      pendingInternalEventCount: persona.mindState.pendingInternalEvents.filter(
        (event) => event.status === "pending" || event.status === "queued",
      ).length,
      pendingRitualCount: persona.mindState.pendingInternalEvents.filter(
        (event) =>
          event.origin === "ritual" && (event.status === "pending" || event.status === "queued"),
      ).length,
      pendingShadowTurnCount: persona.mindState.pendingShadowTurns.filter(
        (job) => job.status === "pending" || job.status === "processing",
      ).length,
      nextHeartbeatAt: getNextHeartbeatAt(persona, now),
      nextRitualAt: nextRitual?.readyAt ?? null,
      quietReason,
    },
  };
}

export async function updatePersonaSettings(personaId: string, input: unknown) {
  const parsed = personaSettingsInputSchema.parse(input);
  const now = new Date().toISOString();
  const timezone = assertValidTimeZone(parsed.timezone);

  return updatePersona(personaId, (current) => applyPersonaSettings(current, {
    ...parsed,
    timezone,
  }, now));
}

function applyPersonaSettings(
  persona: Persona,
  input: PersonaSettingsInput,
  updatedAt: string,
): Persona {
  return {
    ...persona,
    timezone: input.timezone,
    updatedAt,
    heartbeatPolicy: {
      ...persona.heartbeatPolicy,
      intervalHours: input.heartbeatIntervalHours,
      quietHoursStart: input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd,
      preferredMode: input.preferredMode,
    },
  };
}
