import { getProviders } from "@/lib/providers";
import { getPersona, listMessages, updateMessage } from "@/lib/store";

export async function synthesizeStoredReply(personaId: string, messageId: string) {
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const message = (await listMessages(personaId)).find((entry) => entry.id === messageId);

  if (!message) {
    throw new Error("Message not found.");
  }

  if (message.role !== "assistant") {
    throw new Error("Only assistant messages can be synthesized.");
  }

  if (message.audioUrl) {
    return message;
  }

  // Text replies are still valid deliverables; synthesis should be a no-op when
  // voice output is unavailable instead of turning a readable message into an error.
  if (persona.voice.status === "unavailable" || !persona.voice.voiceId) {
    return message;
  }

  const providers = getProviders();
  const synthesized = await providers.voice.synthesize({
    personaName: persona.name,
    voiceId: persona.voice.voiceId,
    text: message.body,
    stylePrompt: [
      persona.dossier.communicationStyle,
      persona.description,
      message.channel === "heartbeat" ? "A brief voice note that feels naturally timed." : "One intimate reply.",
    ]
      .filter(Boolean)
      .join(" "),
  });

  if (!synthesized.audioUrl) {
    return message;
  }

  return updateMessage(message.id, (current) => ({
    ...current,
    kind: current.kind === "preview" ? "preview" : "audio",
    audioUrl: synthesized.audioUrl,
    audioStatus: synthesized.status,
  }));
}
