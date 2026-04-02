import { listMessages, listPersonas, updateMessage } from "@/lib/store";
import { sendPersonaMessage } from "@/lib/services/messaging";
import {
  extractLinqMessageText,
  parseLinqPhoneToPersonaMap,
  sendLinqTextMessage,
  type LinqInboundMessageWebhook,
} from "@/lib/linq";

function buildLinqMetadata(input: {
  payload: LinqInboundMessageWebhook;
  direction: "inbound" | "outbound";
}) {
  const sender = input.payload.data.sender_handle;
  const owner = input.payload.data.chat.owner_handle;

  return {
    linqEventId: input.payload.event_id,
    linqMessageId: input.payload.data.id,
    linqChatId: input.payload.data.chat.id,
    linqTraceId: input.payload.trace_id,
    linqSenderHandle: sender?.handle,
    linqOwnerHandle: owner?.handle,
    linqService: sender?.service ?? owner?.service,
    linqWebhookVersion: input.payload.webhook_version,
    linqDirection: input.direction,
  };
}

async function resolveInboundPersonaId(payload: LinqInboundMessageWebhook) {
  const phoneMap = parseLinqPhoneToPersonaMap(process.env.LINQ_PHONE_TO_PERSONA_MAP);
  const ownerHandle = payload.data.chat.owner_handle?.handle;
  const mappedPersonaId = ownerHandle ? phoneMap[ownerHandle] : undefined;
  const configuredPersonaId = mappedPersonaId ?? process.env.LINQ_DEFAULT_PERSONA_ID?.trim();
  const personas = await listPersonas();

  if (configuredPersonaId) {
    const matched = personas.find(
      (persona) => persona.id === configuredPersonaId && persona.status === "active",
    );
    if (matched) {
      return matched.id;
    }
  }

  return personas.find((persona) => persona.status === "active")?.id ?? null;
}

async function hasProcessedInboundMessage(personaId: string, payload: LinqInboundMessageWebhook) {
  const messages = await listMessages(personaId);
  return messages.some(
    (message) =>
      message.metadata?.linqEventId === payload.event_id ||
      message.metadata?.linqMessageId === payload.data.id,
  );
}

export async function processLinqMessageWebhook(payload: LinqInboundMessageWebhook) {
  if (payload.event_type !== "message.received") {
    return { ignored: true as const, reason: `Unhandled event type: ${payload.event_type}` };
  }

  if (payload.data.direction && payload.data.direction !== "inbound") {
    return { ignored: true as const, reason: `Ignoring ${payload.data.direction} message webhook` };
  }

  const personaId = await resolveInboundPersonaId(payload);
  if (!personaId) {
    throw new Error("No active persona is available for Linq inbound routing.");
  }

  if (await hasProcessedInboundMessage(personaId, payload)) {
    return { ignored: true as const, duplicate: true, personaId };
  }

  const inboundText = extractLinqMessageText(payload.data.parts) || "Received a message on iMessage.";
  const result = await sendPersonaMessage(personaId, {
    text: inboundText,
    channel: "web",
  });

  const userMessage = result.appended.find((message) => message.role === "user");
  const assistantMessage = result.appended.find((message) => message.role === "assistant");

  if (userMessage) {
    await updateMessage(userMessage.id, (current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        ...buildLinqMetadata({ payload, direction: "inbound" }),
      },
    }));
  }

  if (!assistantMessage || result.leftOnRead) {
    return {
      ignored: false as const,
      personaId,
      leftOnRead: Boolean(result.leftOnRead),
    };
  }

  try {
    const outboundResponse = await sendLinqTextMessage({
      chatId: payload.data.chat.id,
      text: assistantMessage.body,
    });

    await updateMessage(assistantMessage.id, (current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        ...buildLinqMetadata({ payload, direction: "outbound" }),
      },
      delivery: {
        ...current.delivery,
        attempts: current.delivery.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: undefined,
      },
    }));

    return {
      ignored: false as const,
      personaId,
      replied: true as const,
      outboundResponse,
    };
  } catch (error) {
    await updateMessage(assistantMessage.id, (current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        ...buildLinqMetadata({ payload, direction: "outbound" }),
      },
      delivery: {
        ...current.delivery,
        attempts: current.delivery.attempts + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "Unknown Linq send failure",
      },
    }));

    throw error;
  }
}
