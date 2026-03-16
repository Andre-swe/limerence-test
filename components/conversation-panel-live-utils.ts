"use client";

import type { LiveSessionMode } from "@/lib/types";

export type LiveState = "idle" | "listening" | "thinking" | "replying";

export type VoiceEvent = {
  type: string;
  receivedAt: Date;
  [key: string]: unknown;
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isUserMessageEvent(
  event: VoiceEvent,
): event is VoiceEvent & {
  fromText?: boolean;
  interim?: boolean;
  language?: string;
  message?: { content?: string };
  models?: {
    prosody?: {
      scores?: Record<string, number>;
    };
  };
  time?: { begin?: number; end?: number };
  type: "user_message";
} {
  return event.type === "user_message";
}

export function isAssistantMessageEvent(
  event: VoiceEvent,
): event is VoiceEvent & {
  fromText?: boolean;
  id?: string;
  language?: string;
  message?: { content?: string };
  models?: {
    prosody?: {
      scores?: Record<string, number>;
    };
  };
  type: "assistant_message";
} {
  return event.type === "assistant_message";
}

export function isSocketErrorEvent(
  event: VoiceEvent,
): event is VoiceEvent & {
  code?: string;
  message?: string;
  slug?: string;
  type: "error";
} {
  return event.type === "error";
}

export function resolveEventText(event: VoiceEvent) {
  const maybeMessage = isObject(event.message) ? event.message : null;
  return typeof maybeMessage?.content === "string" ? maybeMessage.content.trim() : "";
}

export function resolveProsodyScores(event: VoiceEvent) {
  const maybeModels = isObject(event.models) ? event.models : null;
  const maybeProsody = maybeModels && isObject(maybeModels.prosody) ? maybeModels.prosody : null;
  const maybeScores = maybeProsody && isObject(maybeProsody.scores) ? maybeProsody.scores : null;

  if (!maybeScores) {
    return undefined;
  }

  const entries = Object.entries(maybeScores).filter((entry): entry is [string, number] => {
    return typeof entry[1] === "number";
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function resolveErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (isObject(error) && typeof error.message === "string") {
    return error.message;
  }

  return "Something went wrong.";
}

export function averageLevel(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sample = values.slice(0, 24);
  const total = sample.reduce((sum, value) => sum + value, 0);
  return total / sample.length;
}

export function statusCopyFor(state: LiveState) {
  switch (state) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "replying":
      return "Speaking";
    case "idle":
      return "Ready";
  }
}

export function modeLabel(mode: LiveSessionMode) {
  switch (mode) {
    case "voice":
      return "Talk";
    case "screen":
      return "Screen";
    case "camera":
      return "Camera";
  }
}

export function optimisticVisualContextText(
  current: string,
  mode: Extract<LiveSessionMode, "screen" | "camera">,
  active: boolean,
) {
  // This client-side overlay bridges the gap until server perception catches up,
  // so the live model immediately stops or starts implying visual awareness.
  const note = active
    ? mode === "screen"
      ? "VISUAL_CONTEXT\nScreen sharing is active right now. You can see the user's shared screen, even if detailed observations are still arriving."
      : "VISUAL_CONTEXT\nCamera sharing is active right now. You can see the user's camera view, even if detailed observations are still arriving."
    : mode === "screen"
      ? "VISUAL_CONTEXT\nScreen sharing has ended. Do not imply you can still see the user's screen."
      : "VISUAL_CONTEXT\nCamera sharing has ended. Do not imply you can still see the user's surroundings.";

  if (!current.trim()) {
    return note;
  }

  const cleaned = current.replace(
    /VISUAL_CONTEXT\n[\s\S]*?(?=\n\n[A-Z_]+\n|$)/g,
    "",
  ).trim();

  return `${cleaned}\n\n${note}`;
}
