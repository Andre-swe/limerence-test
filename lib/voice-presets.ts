export const houseVoicePresets = [
  {
    id: "a7ecc00a-6fc0-4546-8126-e12cfd8de3bf",
    name: "Ava",
    tone: "Warm female",
    description: "Soft, steady, and intimate. Good for a calm, emotionally present default.",
    humeVoiceProvider: "HUME_AI" as const,
  },
  {
    id: "f60ecf9e-ff1e-4bae-9206-dba7c653a69e",
    name: "Mark",
    tone: "Grounded male",
    description: "Warm, direct, and low-drama. Good for a steadier presence.",
    humeVoiceProvider: "HUME_AI" as const,
  },
] as const;

export function getHouseVoicePreset(voiceId?: string | null) {
  if (!voiceId) {
    return null;
  }

  return houseVoicePresets.find((voice) => voice.id === voiceId) ?? null;
}
