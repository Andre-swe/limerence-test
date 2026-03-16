import { randomUUID } from "node:crypto";
import { applyFeedbackToMemoryClaims } from "@/lib/memory-v2";
import { appendFeedback, getPersona, updatePersona } from "@/lib/store";
import { feedbackRequestSchema, type FeedbackEvent } from "@/lib/types";

export async function addPersonaFeedback(personaId: string, payload: unknown) {
  const parsed = feedbackRequestSchema.parse(payload);
  const persona = await getPersona(personaId);

  if (!persona) {
    throw new Error("Persona not found.");
  }

  const feedback: FeedbackEvent = {
    id: randomUUID(),
    personaId,
    messageId: parsed.messageId,
    note: parsed.note,
    createdAt: new Date().toISOString(),
  };

  await appendFeedback(feedback);
  await updatePersona(personaId, (current) => ({
    ...current,
    updatedAt: new Date().toISOString(),
    dossier: {
      ...current.dossier,
      guidance: Array.from(new Set([...current.dossier.guidance, `Avoid: ${parsed.note}`])),
    },
    mindState: (() => {
      const correction = applyFeedbackToMemoryClaims({
        claims: current.mindState.memoryClaims,
        claimSources: current.mindState.claimSources,
        feedback,
      });

      return {
        ...current.mindState,
        memoryClaims: correction.claims,
        claimSources: correction.claimSources,
        // Keep freshly corrected claims at the front without duplicating ids if
        // multiple feedback events touch the same memory in quick succession.
        recentChangedClaims: [
          ...correction.changedClaims,
          ...current.mindState.recentChangedClaims.filter(
            (claim) => !correction.changedClaims.some((changed) => changed.id === claim.id),
          ),
        ].slice(0, 12),
      };
    })(),
  }));

  return feedback;
}
