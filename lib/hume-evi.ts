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

function buildLiveVoiceId(persona: Persona) {
  if (persona.voice.provider === "hume" && persona.voice.voiceId?.trim()) {
    return persona.voice.voiceId.trim();
  }

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
    throw new Error("HUME_API_KEY and HUME_SECRET_KEY are required for Hume EVI live voice.");
  }

  return fetchAccessToken({
    apiKey,
    secretKey,
    host: humeHostname,
  });
}

export async function createPersonaLiveSession(
  persona: Persona,
  mode: LiveSessionMode = "voice",
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
      voiceId: buildLiveVoiceId(persona),
    },
    soulFrame: snapshot.sessionFrame,
    voiceStatus: persona.voice.status,
  };
}
