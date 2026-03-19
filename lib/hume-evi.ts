import { fetchAccessToken } from "hume";
import { buildSoulHarness, buildSoulSystemPrompt, buildStableSystemPrompt } from "@/lib/soul-harness";
import { listFeedback, listMessages } from "@/lib/store";
import type { LiveSessionMode, MessageEntry, Persona, SoulSessionFrame } from "@/lib/types";

export type HumeLiveSession = {
  accessToken: string;
  hostname: string;
  mode: LiveSessionMode;
  sessionSettings: {
    context?: {
      text: string;
      type: "persistent";
    };
    customSessionId: string;
    metadata?: Record<string, unknown>;
    systemPrompt: string;
    type: "session_settings";
    variables?: Record<string, string | number | boolean>;
    voiceId?: string;
  };
  soulFrame: SoulSessionFrame;
  voiceStatus: Persona["voice"]["status"];
};

const humeHostname = process.env.HUME_EVI_HOST?.trim() || "api.hume.ai";

/** Build the combined system prompt + context for testing/debugging live sessions. */
export function buildPersonaLivePrompt(input: {
  persona: Persona;
  messages: MessageEntry[];
  feedbackNotes: string[];
  mode?: LiveSessionMode;
}) {
  const snapshot = buildSoulHarness({
    persona: input.persona,
    messages: input.messages,
    feedbackNotes: input.feedbackNotes,
    perception: {
      kind: input.mode && input.mode !== "voice" ? "visual_session_start" : "session_start",
      createdAt: new Date().toISOString(),
      internal: true,
      metadata: input.mode && input.mode !== "voice" ? { mode: input.mode } : undefined,
    },
  });

  return [buildSoulSystemPrompt(snapshot), snapshot.sessionFrame.contextText].join("\n\n");
}

/**
 * Resolve the voice ID for a live EVI session.
 * Priority:
 *   1. Cloned voice (if ready and user is premium)
 *   2. Persona's configured voice ID
 *   3. Default house voice from environment
 */
function buildLiveVoiceId(persona: Persona, options?: { isPremium?: boolean }) {
  // Check for ready cloned voice (premium users only)
  if (
    options?.isPremium &&
    persona.voice.cloneState === "ready" &&
    persona.voice.cloneProfileId
  ) {
    // The cloneProfileId references a VoiceCloneProfile which has humeVoiceId
    // For now, we check if voiceId was updated to the cloned voice
    // In production, the cloning process updates voiceId when clone is ready
    if (persona.voice.voiceId?.trim()) {
      return persona.voice.voiceId.trim();
    }
  }

  // Fall back to configured voice ID
  if (persona.voice.provider === "hume" && persona.voice.voiceId?.trim()) {
    return persona.voice.voiceId.trim();
  }

  // Fall back to default house voice
  return process.env.HUME_DEFAULT_VOICE_ID?.trim() || undefined;
}

async function resolveAccessToken() {
  const accessToken = process.env.HUME_ACCESS_TOKEN?.trim();
  if (accessToken) {
    return accessToken;
  }

  const apiKey = process.env.HUME_API_KEY?.trim();
  const secretKey = process.env.HUME_SECRET_KEY?.trim();

  if (!apiKey || !secretKey) {
    throw new Error("Voice provider is not configured. Please check your Hume credentials.");
  }

  return fetchAccessToken({
    apiKey,
    secretKey,
    host: humeHostname,
  });
}

/**
 * Create a Hume EVI live session with the persona's stable system prompt,
 * full context, voice, and variables. The client sends these as the first
 * WebSocket message after connecting.
 */
export async function createPersonaLiveSession(
  persona: Persona,
  mode: LiveSessionMode = "voice",
  options?: { isPremium?: boolean },
): Promise<HumeLiveSession> {
  const [messages, feedbackNotes, accessToken] = await Promise.all([
    listMessages(persona.id),
    listFeedback(persona.id).then((entries) => entries.map((entry) => entry.note)),
    resolveAccessToken(),
  ]);
  const snapshot = buildSoulHarness({
    persona,
    messages,
    feedbackNotes,
    perception: {
      kind: mode === "voice" ? "session_start" : "visual_session_start",
      createdAt: new Date().toISOString(),
      internal: true,
      metadata: mode === "voice" ? undefined : { mode },
    },
  });
  const sessionId = `${persona.id}-${mode}-${Date.now()}`;

  return {
    accessToken,
    hostname: humeHostname,
    mode,
    sessionSettings: {
      context: {
        text: snapshot.sessionFrame.contextText,
        type: "persistent",
      },
      customSessionId: sessionId,
      metadata: {
        liveMode: mode,
        soulProcess: snapshot.activeProcess,
        soulProcessInstanceId: snapshot.sessionFrame.processInstanceId,
        soulDrive: snapshot.currentDrive,
        userStateSummary: snapshot.userStateSummary,
        soulContextVersion: snapshot.sessionFrame.contextVersion,
        soulLiveDeliveryVersion: snapshot.sessionFrame.liveDeliveryVersion,
        soulTraceVersion: snapshot.sessionFrame.traceVersion,
      },
      systemPrompt: buildStableSystemPrompt(snapshot),
      type: "session_settings",
      variables: {
        ...snapshot.sessionFrame.variables,
        live_mode: mode,
      },
      voiceId: buildLiveVoiceId(persona, options),
    },
    soulFrame: snapshot.sessionFrame,
    voiceStatus: persona.voice.status,
  };
}
