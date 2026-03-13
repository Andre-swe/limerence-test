import { format, formatDistanceToNow } from "date-fns";
import { clsx, type ClassValue } from "clsx";
import type { HeartbeatPolicy, PreferenceSignal } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(value: string, maxLength = 140) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "Not yet";
  }

  return format(new Date(value), "MMM d, yyyy 'at' h:mm a");
}

export function formatRelative(value?: string) {
  if (!value) {
    return "No activity yet";
  }

  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function addHours(iso: string, hours: number) {
  const date = new Date(iso);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

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

export function describePreferenceSignal(signal: PreferenceSignal) {
  return signal.status === "negotiating"
    ? `${signal.effectSummary} Heard, with a little personality.`
    : signal.effectSummary;
}
