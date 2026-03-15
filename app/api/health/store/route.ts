import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth";
import { listPersonas } from "@/lib/store";
import { withUserStore } from "@/lib/store-context";
import { getSupabaseRuntimeConfig } from "@/lib/supabase";

export const runtime = "nodejs";

/** Health check endpoint: returns store size, claim count, last-write timestamp. */
export async function GET(request: Request) {
  try {
    const userId = getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Valid session required." },
        { status: 401 }
      );
    }

    const stats = await withUserStore(userId, async () => {
      const personas = await listPersonas();

      // Aggregate claim counts across all personas
      let totalClaims = 0;
      let totalClaimSources = 0;
      let totalEpisodes = 0;
      let lastUpdatedAt: string | null = null;

      for (const persona of personas) {
        totalClaims += persona.mindState.memoryClaims.length;
        totalClaimSources += persona.mindState.claimSources.length;
        totalEpisodes += persona.mindState.episodes.length;

        if (!lastUpdatedAt || persona.updatedAt > lastUpdatedAt) {
          lastUpdatedAt = persona.updatedAt;
        }
      }

      return {
        personaCount: personas.length,
        totalClaims,
        totalClaimSources,
        totalEpisodes,
        lastUpdatedAt,
      };
    });

    const supabaseConfig = getSupabaseRuntimeConfig(userId);

    return NextResponse.json({
      status: "healthy",
      storeType: supabaseConfig ? "supabase" : "local",
      storeKey: supabaseConfig?.key ?? "local-file",
      ...stats,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Store health check failed.",
        checkedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
