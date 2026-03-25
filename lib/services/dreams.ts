import { getPersona, updatePersona } from "@/lib/store";
import { getProviders } from "@/lib/providers";
import { applyConsolidation, buildDreamEpisode, collectDreamMaterial, isDreamCycleDue, type DreamCycleResult, runConsolidationPass, runCreativeDreamPass } from "@/lib/dream-cycle";
import { soulLogger } from "@/lib/soul-logger";

export async function runDreamCycleForPersona(personaId: string): Promise<DreamCycleResult> {
  const persona = await getPersona(personaId);
  if (!persona) {
    return { ran: false, reason: "Persona not found.", materialCount: 0 };
  }

  const now = new Date();

  if (!isDreamCycleDue(persona, now)) {
    return {
      ran: false,
      reason: "Dream cycle not yet due (cooldown).",
      materialCount: 0,
    };
  }

  const material = collectDreamMaterial(persona);

  if (material.totalItems === 0) {
    await updatePersona(personaId, (current) => ({
      ...current,
      lastDreamCycleAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }));
    return {
      ran: true,
      reason: "No material to consolidate — silent cycle.",
      materialCount: 0,
    };
  }

  const providers = getProviders();
  const consolidation = await runConsolidationPass(
    providers.reasoning,
    persona,
    material,
  );
  const { memoryClaims } = applyConsolidation(persona, consolidation);

  let dream: DreamCycleResult["dream"];
  let dreamEpisode: ReturnType<typeof buildDreamEpisode> | undefined;

  if (material.totalItems >= 3) {
    dream = await runCreativeDreamPass(
      providers.reasoning,
      persona,
      material,
      consolidation,
    );
    if (dream.narrative) {
      dreamEpisode = buildDreamEpisode(persona, dream);
    }
  }

  await updatePersona(personaId, (current) => {
    const episodes = dreamEpisode
      ? [dreamEpisode, ...current.mindState.episodes].slice(0, 48)
      : current.mindState.episodes;

    return {
      ...current,
      lastDreamCycleAt: now.toISOString(),
      updatedAt: now.toISOString(),
      mindState: {
        ...current.mindState,
        memoryClaims,
        episodes,
        lastDreamSummary: dream?.narrative ?? current.mindState.lastDreamSummary,
        lastDreamVividness: dream?.vividness ?? current.mindState.lastDreamVividness,
      },
    };
  });

  soulLogger.info(
    {
      personaId,
      materialCount: material.totalItems,
      strengthened: consolidation.strengthenClaimIds.length,
      decayed: consolidation.decayClaimIds.length,
      merged: consolidation.mergedClaims.length,
      dreamVividness: dream?.vividness ?? null,
    },
    "Dream cycle completed",
  );

  return {
    ran: true,
    reason: "Dream cycle completed.",
    consolidation,
    dream,
    materialCount: material.totalItems,
  };
}
