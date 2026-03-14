export const houseVoicePresets = [
  {
    id: "5bb7de05-c8fe-426a-8fcc-ba4fc4ce9f9c",
    name: "Warm",
    tone: "Warm female",
    description: "Soft, steady, and intimate. Good for a calm, emotionally present default.",
    humeVoiceProvider: "HUME_AI" as const,
  },
  {
    id: "f60ecf9e-ff1e-4bae-9206-dba7c653a69e",
    name: "Grounded",
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
