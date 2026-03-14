export const houseVoicePresets = [
  {
    id: "dbe14cac-f477-4114-8a62-2b482ff10f69",
    name: "Soft",
    tone: "Warm female",
    description: "Soft, steady, and intimate. Good for a calm, emotionally present default.",
    humeVoiceProvider: "CUSTOM_VOICE" as const,
  },
  {
    id: "65d2f293-f116-48d8-be96-01a263e2f9b8",
    name: "Steady",
    tone: "Grounded male",
    description: "Warm, direct, and low-drama. Good for a steadier presence.",
    humeVoiceProvider: "CUSTOM_VOICE" as const,
  },
] as const;

export function getHouseVoicePreset(voiceId?: string | null) {
  if (!voiceId) {
    return null;
  }

  return houseVoicePresets.find((voice) => voice.id === voiceId) ?? null;
}
