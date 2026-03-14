import { format, formatDistanceToNow } from "date-fns";
import { clsx, type ClassValue } from "clsx";
import type { HeartbeatPolicy, PreferenceSignal } from "@/lib/types";

/** Merge Tailwind class names with clsx. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Convert a display name to a URL-safe slug. */
export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extract up to 2 uppercase initials from a name (e.g. "Mom" → "M"). */
export function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Truncate a string with an ellipsis if it exceeds maxLength. */
export function truncate(value: string, maxLength = 140) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/** Format an ISO timestamp as "Mar 13, 2026 at 7:42 PM". */
export function formatDateTime(value?: string) {
  if (!value) {
    return "Not yet";
  }

  return format(new Date(value), "MMM d, yyyy 'at' h:mm a");
}

/** Format an ISO timestamp as a relative string (e.g. "3 hours ago"). */
export function formatRelative(value?: string) {
  if (!value) {
    return "No activity yet";
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

/** Add hours to an ISO timestamp and return a new ISO string. */
export function addHours(iso: string, hours: number) {
  const date = new Date(iso);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

/** Parse JSON safely, returning fallback on any parse error. */
export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Human-readable description of a heartbeat policy for the persona card. */
export function describePresence(policy: HeartbeatPolicy) {
  if (policy.workHoursEnabled) {
    return "Learns to leave work hours quiet.";
  }

  if (policy.preferredMode === "text") {
    return "Usually shows up as text.";
  }

  if (policy.preferredMode === "voice_note") {
    return "Leans toward voice notes.";
  }

  if (policy.intervalHours <= 3) {
    return "Tends to check in more often.";
  }

  if (policy.intervalHours >= 6) {
    return "Keeps a little more distance.";
  }

  return "Shows up gently in the background.";
}

/** Human-readable description of a preference signal for the settings UI. */
export function describePreferenceSignal(signal: PreferenceSignal) {
  return signal.status === "negotiating"
    ? `${signal.effectSummary} Heard, with a little personality.`
    : signal.effectSummary;
}
