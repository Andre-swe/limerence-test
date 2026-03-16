import type { InternalScheduledEvent, MessageEntry, Persona } from "@/lib/types";

export const PERSONA_TIMEZONE_FALLBACK = "UTC";

const weekdayIndexByLabel: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getLocalParts(date: Date, timezone: string) {
  const normalizedTimezone = resolvePersonaTimeZone(timezone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    timezone: normalizedTimezone,
    year: Number(parts.year ?? 0),
    month: Number(parts.month ?? 1),
    day: Number(parts.day ?? 1),
    hour: Number(parts.hour ?? 0),
    weekday: weekdayIndexByLabel[parts.weekday ?? "Sun"] ?? 0,
  };
}

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(value: string, label = "timezone") {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  if (!isValidTimeZone(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }

  return normalized;
}

export function resolvePersonaTimeZone(value?: string | null) {
  const normalized = value?.trim();
  return normalized && isValidTimeZone(normalized) ? normalized : PERSONA_TIMEZONE_FALLBACK;
}

export function getPersonaLocalHour(persona: Persona | string | undefined, date: Date) {
  const timezone =
    typeof persona === "string" || persona === undefined
      ? resolvePersonaTimeZone(persona)
      : resolvePersonaTimeZone(persona.timezone);
  return getLocalParts(date, timezone).hour;
}

export function getPersonaLocalWeekday(persona: Persona | string | undefined, date: Date) {
  const timezone =
    typeof persona === "string" || persona === undefined
      ? resolvePersonaTimeZone(persona)
      : resolvePersonaTimeZone(persona.timezone);
  return getLocalParts(date, timezone).weekday;
}

export function getPersonaLocalDateKey(persona: Persona | string | undefined, date: Date) {
  const timezone =
    typeof persona === "string" || persona === undefined
      ? resolvePersonaTimeZone(persona)
      : resolvePersonaTimeZone(persona.timezone);
  const local = getLocalParts(date, timezone);
  return `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
}

export function calculateCircadianInterval(persona: Persona, now: Date) {
  const policy = persona.heartbeatPolicy;

  if (!policy.variableInterval) {
    return policy.intervalHours;
  }

  const currentHour = getPersonaLocalHour(persona, now);
  const hourlyActivity = policy.hourlyActivityCounts ?? Array(24).fill(0);
  const minInterval = policy.minIntervalHours ?? 1;
  const maxInterval = policy.maxIntervalHours ?? 8;
  const prevHour = (currentHour + 23) % 24;
  const nextHour = (currentHour + 1) % 24;
  const smoothedActivity =
    hourlyActivity[prevHour] * 0.25 +
    hourlyActivity[currentHour] * 0.5 +
    hourlyActivity[nextHour] * 0.25;

  let maxActivity = 1;
  for (let index = 0; index < hourlyActivity.length; index += 1) {
    if (hourlyActivity[index] > maxActivity) {
      maxActivity = hourlyActivity[index];
    }
  }

  const totalActivity = hourlyActivity.reduce((sum: number, value) => sum + value, 0);
  if (totalActivity < 3) {
    return policy.intervalHours;
  }

  const activityRatio = smoothedActivity / maxActivity;
  return maxInterval - (maxInterval - minInterval) * activityRatio;
}

export function isPersonaInQuietHours(persona: Persona, now: Date) {
  const hour = getPersonaLocalHour(persona, now);
  const start = persona.heartbeatPolicy.quietHoursStart;
  const end = persona.heartbeatPolicy.quietHoursEnd;
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export function isPersonaInWorkHours(persona: Persona, now: Date) {
  const policy = persona.heartbeatPolicy;
  const hour = getPersonaLocalHour(persona, now);
  const weekday = getPersonaLocalWeekday(persona, now);

  return (
    policy.workHoursEnabled &&
    policy.workDays.includes(weekday) &&
    hour >= policy.workHoursStart &&
    hour < policy.workHoursEnd
  );
}

export function countOutboundToday(messages: MessageEntry[], persona: Persona, now: Date) {
  const dateKey = getPersonaLocalDateKey(persona, now);
  return messages.filter((message) => {
    if (
      message.personaId !== persona.id ||
      message.role !== "assistant" ||
      message.channel !== "heartbeat"
    ) {
      return false;
    }

    return getPersonaLocalDateKey(persona, new Date(message.createdAt)) === dateKey;
  }).length;
}

export function getHeartbeatBlockReason(
  persona: Persona,
  messages: MessageEntry[],
  now: Date,
) {
  if (!persona.heartbeatPolicy.enabled) {
    return "Heartbeats are disabled.";
  }

  if (persona.status !== "active") {
    return "Persona is inactive.";
  }

  if (countOutboundToday(messages, persona, now) >= persona.heartbeatPolicy.maxOutboundPerDay) {
    return "Daily outbound cap reached.";
  }

  if (isPersonaInWorkHours(persona, now)) {
    return "Within learned work hours.";
  }

  if (isPersonaInQuietHours(persona, now)) {
    return "Within quiet hours.";
  }

  return null;
}

export function getNextHeartbeatAt(persona: Persona, now: Date) {
  if (!persona.heartbeatPolicy.enabled || persona.status !== "active") {
    return null;
  }

  if (!persona.lastHeartbeatAt) {
    return now.toISOString();
  }

  const nextMs =
    new Date(persona.lastHeartbeatAt).getTime() +
    calculateCircadianInterval(persona, now) * 60 * 60 * 1000;

  return new Date(Math.max(nextMs, now.getTime())).toISOString();
}

export function getNextPendingInternalEvent(
  persona: Persona,
  origin?: InternalScheduledEvent["origin"],
) {
  return [...persona.mindState.pendingInternalEvents]
    .filter((event) => {
      if (event.status !== "pending" && event.status !== "queued") {
        return false;
      }

      return origin ? event.origin === origin : true;
    })
    .sort((left, right) => new Date(left.readyAt).getTime() - new Date(right.readyAt).getTime())[0];
}
