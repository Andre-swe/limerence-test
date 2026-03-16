import { describe, expect, it } from "vitest";
import {
  assertValidTimeZone,
  calculateCircadianInterval,
  getPersonaLocalDateKey,
  getPersonaLocalHour,
  getPersonaLocalWeekday,
  getNextHeartbeatAt,
  isPersonaInQuietHours,
  isPersonaInWorkHours,
  isValidTimeZone,
  PERSONA_TIMEZONE_FALLBACK,
  resolvePersonaTimeZone,
} from "@/lib/persona-schedule";
import type { HeartbeatPolicy, Persona } from "@/lib/types";
import { personaSchema } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_HEARTBEAT: HeartbeatPolicy = {
  enabled: true,
  intervalHours: 4,
  maxOutboundPerDay: 3,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  preferredMode: "text",
  workHoursEnabled: false,
  workHoursStart: 9,
  workHoursEnd: 17,
  workDays: [1, 2, 3, 4, 5],
  boundaryNotes: [],
  variableInterval: false,
  hourlyActivityCounts: Array(24).fill(0),
  minIntervalHours: 1,
  maxIntervalHours: 8,
};

/** Build a minimal valid Persona with overrides for heartbeat/schedule tests. */
function makePersona(overrides: Record<string, unknown> = {}): Persona {
  return personaSchema.parse({
    id: "p-test",
    userId: "u-test",
    name: "Test",
    relationship: "friend",
    source: "living",
    description: "test persona",
    status: "active",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    pastedText: "",
    screenshotSummaries: [],
    interviewAnswers: {},
    heartbeatPolicy: { ...DEFAULT_HEARTBEAT },
    voice: { provider: "mock", status: "unavailable" },
    consent: { attestedRights: true, createdAt: "2025-01-01T00:00:00Z" },
    dossier: {
      essence: "test",
      communicationStyle: "casual",
      signaturePhrases: [],
      favoriteTopics: [],
      emotionalTendencies: [],
      routines: [],
      guidance: [],
      sourceSummary: "test",
    },
    voiceSamples: [],
    screenshots: [],
    personalityConstitution: {},
    relationshipModel: {},
    mindState: {
      activeProcess: "arrival",
      currentDrive: "test",
      unresolvedTension: "none",
      recentShift: "none",
      emotionalBaseline: "calm",
      recentTrend: "stable",
      learningState: {},
      workingMemory: {
        summary: "",
        currentFocus: "",
        emotionalWeather: "",
        lastUserNeed: "",
        updatedAt: "2025-01-01T00:00:00Z",
      },
      memoryRegions: {},
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// resolvePersonaTimeZone
// ---------------------------------------------------------------------------

describe("resolvePersonaTimeZone", () => {
  it("returns the timezone when valid IANA identifier is provided", () => {
    expect(resolvePersonaTimeZone("America/New_York")).toBe("America/New_York");
    expect(resolvePersonaTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(resolvePersonaTimeZone("Europe/London")).toBe("Europe/London");
  });

  it("falls back to UTC for undefined / null / empty", () => {
    expect(resolvePersonaTimeZone(undefined)).toBe(PERSONA_TIMEZONE_FALLBACK);
    expect(resolvePersonaTimeZone(null)).toBe(PERSONA_TIMEZONE_FALLBACK);
    expect(resolvePersonaTimeZone("")).toBe(PERSONA_TIMEZONE_FALLBACK);
    expect(resolvePersonaTimeZone("   ")).toBe(PERSONA_TIMEZONE_FALLBACK);
  });

  it("falls back to UTC for completely bogus timezone strings", () => {
    expect(resolvePersonaTimeZone("Mars/Olympus_Mons")).toBe(PERSONA_TIMEZONE_FALLBACK);
    expect(resolvePersonaTimeZone("Not_A_Zone")).toBe(PERSONA_TIMEZONE_FALLBACK);
  });

  it("trims whitespace before validating", () => {
    expect(resolvePersonaTimeZone("  America/Chicago  ")).toBe("America/Chicago");
  });
});

// ---------------------------------------------------------------------------
// isValidTimeZone / assertValidTimeZone
// ---------------------------------------------------------------------------

describe("isValidTimeZone", () => {
  it("accepts valid IANA identifiers", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("Pacific/Auckland")).toBe(true);
  });

  it("rejects clearly invalid identifiers", () => {
    expect(isValidTimeZone("Fake/Zone")).toBe(false);
    expect(isValidTimeZone("XYZZY")).toBe(false);
  });
});

describe("assertValidTimeZone", () => {
  it("returns the trimmed value when valid", () => {
    expect(assertValidTimeZone("  UTC  ")).toBe("UTC");
  });

  it("throws for empty string", () => {
    expect(() => assertValidTimeZone("")).toThrow("is required");
    expect(() => assertValidTimeZone("   ")).toThrow("is required");
  });

  it("throws for invalid timezone", () => {
    expect(() => assertValidTimeZone("Not/Real")).toThrow("Invalid");
  });

  it("includes custom label in error message", () => {
    expect(() => assertValidTimeZone("", "persona tz")).toThrow("persona tz is required");
    expect(() => assertValidTimeZone("Bad/Zone", "persona tz")).toThrow("Invalid persona tz");
  });
});

// ---------------------------------------------------------------------------
// getPersonaLocalHour / getPersonaLocalWeekday / getPersonaLocalDateKey
// ---------------------------------------------------------------------------

describe("getPersonaLocalHour", () => {
  it("returns the correct hour for a given timezone", () => {
    // 2025-06-15T12:00:00Z => in America/New_York (EDT, UTC-4) => 08:00
    const date = new Date("2025-06-15T12:00:00Z");
    expect(getPersonaLocalHour("America/New_York", date)).toBe(8);
  });

  it("handles UTC midnight correctly", () => {
    const midnight = new Date("2025-01-01T00:00:00Z");
    expect(getPersonaLocalHour("UTC", midnight)).toBe(0);
  });

  it("accepts a Persona object and reads its timezone field", () => {
    const persona = makePersona({ timezone: "Asia/Tokyo" });
    // 2025-01-15T00:00:00Z => Tokyo (UTC+9) => 09:00
    const date = new Date("2025-01-15T00:00:00Z");
    expect(getPersonaLocalHour(persona, date)).toBe(9);
  });

  it("falls back to UTC when persona has no timezone", () => {
    const persona = makePersona({ timezone: undefined });
    const date = new Date("2025-03-10T15:00:00Z");
    expect(getPersonaLocalHour(persona, date)).toBe(15);
  });
});

describe("getPersonaLocalWeekday", () => {
  it("returns 0 for Sunday, 6 for Saturday", () => {
    // 2025-06-15 is a Sunday
    const sunday = new Date("2025-06-15T12:00:00Z");
    expect(getPersonaLocalWeekday("UTC", sunday)).toBe(0);
    // 2025-06-14 is a Saturday
    const saturday = new Date("2025-06-14T12:00:00Z");
    expect(getPersonaLocalWeekday("UTC", saturday)).toBe(6);
  });

  it("accounts for timezone-induced day shift", () => {
    // 2025-06-15 Sunday 23:30 UTC => in Asia/Tokyo (UTC+9) it's Monday 08:30
    const date = new Date("2025-06-15T23:30:00Z");
    expect(getPersonaLocalWeekday("UTC", date)).toBe(0); // still Sunday in UTC
    expect(getPersonaLocalWeekday("Asia/Tokyo", date)).toBe(1); // Monday in Tokyo
  });
});

describe("getPersonaLocalDateKey", () => {
  it("returns YYYY-MM-DD in the persona's local timezone", () => {
    const date = new Date("2025-01-15T04:00:00Z");
    expect(getPersonaLocalDateKey("UTC", date)).toBe("2025-01-15");
    // Same instant in New York (EST, UTC-5) => 2025-01-14 23:00
    expect(getPersonaLocalDateKey("America/New_York", date)).toBe("2025-01-14");
  });

  it("pads single-digit months and days", () => {
    const date = new Date("2025-03-05T12:00:00Z");
    expect(getPersonaLocalDateKey("UTC", date)).toBe("2025-03-05");
  });
});

// ---------------------------------------------------------------------------
// DST edge cases
// ---------------------------------------------------------------------------

describe("DST edge cases", () => {
  it("spring-forward: hour skips from 1 to 3 in America/New_York", () => {
    // 2025-03-09 US spring forward. At 2:00 AM EST, clocks jump to 3:00 AM EDT.
    // 2025-03-09T06:30:00Z = 1:30 AM EST (before spring forward)
    // 2025-03-09T07:30:00Z = 3:30 AM EDT (after spring forward)
    const before = new Date("2025-03-09T06:30:00Z");
    const after = new Date("2025-03-09T07:30:00Z");
    expect(getPersonaLocalHour("America/New_York", before)).toBe(1);
    expect(getPersonaLocalHour("America/New_York", after)).toBe(3);
  });

  it("fall-back: 1 AM occurs twice in America/New_York", () => {
    // 2025-11-02 US fall back. At 2:00 AM EDT, clocks fall back to 1:00 AM EST.
    // 2025-11-02T05:30:00Z = 1:30 AM EDT (first occurrence)
    // 2025-11-02T06:30:00Z = 1:30 AM EST (second occurrence)
    // Both should report hour 1.
    const firstOccurrence = new Date("2025-11-02T05:30:00Z");
    const secondOccurrence = new Date("2025-11-02T06:30:00Z");
    expect(getPersonaLocalHour("America/New_York", firstOccurrence)).toBe(1);
    expect(getPersonaLocalHour("America/New_York", secondOccurrence)).toBe(1);
  });

  it("date key changes correctly across DST boundary", () => {
    // 2025-03-30 Europe/London clocks spring forward at 1:00 AM GMT to 2:00 AM BST
    // 2025-03-30T00:30:00Z => 00:30 GMT => date key 2025-03-30
    // 2025-03-30T01:30:00Z => 02:30 BST => date key 2025-03-30
    expect(getPersonaLocalDateKey("Europe/London", new Date("2025-03-30T00:30:00Z"))).toBe("2025-03-30");
    expect(getPersonaLocalDateKey("Europe/London", new Date("2025-03-30T01:30:00Z"))).toBe("2025-03-30");
  });

  it("weekday is correct around DST transition at midnight boundary", () => {
    // 2025-03-30 (Sunday) Europe/London spring forward.
    // 2025-03-29T23:30:00Z => 23:30 GMT Saturday => weekday 6
    // 2025-03-30T00:30:00Z => 00:30 GMT Sunday => weekday 0 (but BST kicks in at 01:00)
    expect(getPersonaLocalWeekday("Europe/London", new Date("2025-03-29T23:30:00Z"))).toBe(6);
    expect(getPersonaLocalWeekday("Europe/London", new Date("2025-03-30T00:30:00Z"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// calculateCircadianInterval
// ---------------------------------------------------------------------------

describe("calculateCircadianInterval", () => {
  it("returns fixed intervalHours when variableInterval is false", () => {
    const persona = makePersona({ timezone: "UTC" });
    expect(calculateCircadianInterval(persona, new Date())).toBe(4);
  });

  it("returns fixed intervalHours when total activity < 3", () => {
    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        variableInterval: true,
        hourlyActivityCounts: Array(24).fill(0),
      },
    });
    expect(calculateCircadianInterval(persona, new Date())).toBe(4);
  });

  it("returns minIntervalHours at peak activity", () => {
    const counts = Array(24).fill(0);
    counts[13] = 5;
    counts[14] = 10;
    counts[15] = 5;

    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        variableInterval: true,
        hourlyActivityCounts: counts,
        minIntervalHours: 1,
        maxIntervalHours: 8,
      },
    });

    // At hour 14: smoothed = 5*0.25 + 10*0.5 + 5*0.25 = 7.5
    // maxActivity = 10, ratio = 0.75
    // interval = 8 - 7*0.75 = 2.75
    const atPeak = new Date("2025-06-15T14:00:00Z");
    expect(calculateCircadianInterval(persona, atPeak)).toBeCloseTo(2.75);
  });

  it("returns maxIntervalHours during zero-activity hours", () => {
    const counts = Array(24).fill(0);
    counts[12] = 10;

    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        variableInterval: true,
        hourlyActivityCounts: counts,
        minIntervalHours: 1,
        maxIntervalHours: 8,
      },
    });

    // At hour 0: smoothed = 0, ratio = 0, interval = 8
    const atMidnight = new Date("2025-06-15T00:00:00Z");
    expect(calculateCircadianInterval(persona, atMidnight)).toBe(8);
  });

  it("smooths using neighboring hours (wraps at day boundaries)", () => {
    const counts = Array(24).fill(0);
    counts[23] = 8;

    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        variableInterval: true,
        hourlyActivityCounts: counts,
        minIntervalHours: 2,
        maxIntervalHours: 10,
      },
    });

    // At hour 0: prevHour=23, smoothed = 8*0.25 + 0 + 0 = 2
    // maxActivity = 8, ratio = 0.25
    // interval = 10 - 8*0.25 = 8
    const atMidnight = new Date("2025-06-15T00:00:00Z");
    expect(calculateCircadianInterval(persona, atMidnight)).toBe(8);
  });

  it("correctly uses persona timezone for hour lookup", () => {
    const counts = Array(24).fill(0);
    counts[9] = 10;

    const persona = makePersona({
      timezone: "Asia/Tokyo", // UTC+9
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        variableInterval: true,
        hourlyActivityCounts: counts,
        minIntervalHours: 1,
        maxIntervalHours: 8,
      },
    });

    // 2025-06-15T00:00:00Z = 09:00 JST => local hour 9
    // smoothed = 0*0.25 + 10*0.5 + 0*0.25 = 5
    // maxActivity = 10, ratio = 0.5
    // interval = 8 - 7*0.5 = 4.5
    const atTokyoPeak = new Date("2025-06-15T00:00:00Z");
    expect(calculateCircadianInterval(persona, atTokyoPeak)).toBeCloseTo(4.5);
  });

  it("falls back to intervalHours when activity is barely above zero", () => {
    const counts = Array(24).fill(0);
    counts[10] = 1;
    counts[14] = 1;
    // totalActivity = 2 < 3 => fallback

    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        variableInterval: true,
        hourlyActivityCounts: counts,
        intervalHours: 6,
      },
    });

    expect(calculateCircadianInterval(persona, new Date("2025-06-15T10:00:00Z"))).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// isPersonaInQuietHours
// ---------------------------------------------------------------------------

describe("isPersonaInQuietHours", () => {
  it("detects quiet hours when range wraps midnight (22-8)", () => {
    const persona = makePersona({ timezone: "UTC" });

    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T23:00:00Z"))).toBe(true);
    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T03:00:00Z"))).toBe(true);
    // hour 8 => boundary end (exclusive) => not quiet
    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T08:00:00Z"))).toBe(false);
    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T12:00:00Z"))).toBe(false);
    // hour 22 => boundary start (inclusive) => quiet
    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T22:00:00Z"))).toBe(true);
  });

  it("handles non-wrapping quiet hours (e.g. 0-6)", () => {
    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        quietHoursStart: 0,
        quietHoursEnd: 6,
      },
    });

    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T03:00:00Z"))).toBe(true);
    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T06:00:00Z"))).toBe(false);
    expect(isPersonaInQuietHours(persona, new Date("2025-01-01T23:00:00Z"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPersonaInWorkHours
// ---------------------------------------------------------------------------

describe("isPersonaInWorkHours", () => {
  it("returns false when workHoursEnabled is false", () => {
    const persona = makePersona({ timezone: "UTC" });
    expect(isPersonaInWorkHours(persona, new Date("2025-01-15T10:00:00Z"))).toBe(false);
  });

  it("returns true during work hours on a work day", () => {
    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        workHoursEnabled: true,
      },
    });

    // 2025-01-15 is a Wednesday (weekday 3)
    expect(isPersonaInWorkHours(persona, new Date("2025-01-15T10:00:00Z"))).toBe(true);
  });

  it("returns false on weekends even if hour is within range", () => {
    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        workHoursEnabled: true,
      },
    });

    // 2025-01-18 is a Saturday (weekday 6)
    expect(isPersonaInWorkHours(persona, new Date("2025-01-18T10:00:00Z"))).toBe(false);
  });

  it("treats workHoursEnd as exclusive", () => {
    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        workHoursEnabled: true,
      },
    });

    // 2025-01-15 (Wed) at 17:00 => end boundary, should be false
    expect(isPersonaInWorkHours(persona, new Date("2025-01-15T17:00:00Z"))).toBe(false);
    // 2025-01-15 (Wed) at 16:30 => still within
    expect(isPersonaInWorkHours(persona, new Date("2025-01-15T16:30:00Z"))).toBe(true);
  });

  it("supports overnight work windows that wrap past midnight", () => {
    const persona = makePersona({
      timezone: "UTC",
      heartbeatPolicy: {
        ...DEFAULT_HEARTBEAT,
        workHoursEnabled: true,
        workHoursStart: 22,
        workHoursEnd: 6,
      },
    });

    expect(isPersonaInWorkHours(persona, new Date("2025-01-15T23:00:00Z"))).toBe(true);
    expect(isPersonaInWorkHours(persona, new Date("2025-01-16T05:30:00Z"))).toBe(true);
    expect(isPersonaInWorkHours(persona, new Date("2025-01-16T12:00:00Z"))).toBe(false);
  });
});

describe("getNextHeartbeatAt", () => {
  it("falls back to now when lastHeartbeatAt is malformed", () => {
    const persona = makePersona({
      lastHeartbeatAt: "not-a-date",
    });
    const now = new Date("2025-01-15T12:00:00Z");

    expect(getNextHeartbeatAt(persona, now)).toBe(now.toISOString());
  });
});
