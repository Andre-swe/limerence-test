export const houseVoicePresets = [
  {
    id: "65d2f293-f116-48d8-be96-01a263e2f9b8",
    name: "Steady",
    tone: "Warm and grounded",
    description: "Soft, steady, and intimate. Good for a calm, emotionally present default.",
    humeVoiceProvider: "CUSTOM_VOICE" as const,
  },
  {
    id: "dbe14cac-f477-4114-8a62-2b482ff10f69",
    name: "Soft",
    tone: "Gentle and close",
    description: "Warm, gentle, and low-drama. Good for a quieter presence.",
    humeVoiceProvider: "CUSTOM_VOICE" as const,
  },
] as const;

export function getHouseVoicePreset(voiceId?: string | null) {
  if (!voiceId) {
    return null;
  }

  return houseVoicePresets.find((voice) => voice.id === voiceId) ?? null;
}
