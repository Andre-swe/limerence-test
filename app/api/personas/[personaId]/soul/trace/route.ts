import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { getPersona } from "@/lib/store";
import { buildMemoryRetrievalPack } from "@/lib/memory-v2";

/** Debug route: returns the persona's cognitive state, memory claims, and trace. */
export async function GET(
  request: Request,
  context: { params: Promise<{ personaId: string }> },
) {
  const isDev = process.env.NODE_ENV === "development";

  if (!isDev) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Server misconfiguration." },
        { status: 500 }
      );
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          const cookieHeader = request.headers.get("cookie") ?? "";
          return cookieHeader.split(";").map((c) => {
            const [name, ...rest] = c.trim().split("=");
            return { name, value: rest.join("=") };
          });
        },
        setAll() {},
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim());
    const isAdmin = user && adminEmails.includes(user.email ?? "");

    if (error || !user || !isAdmin) {
      return NextResponse.json(
        { error: "Forbidden. Admin access required." },
        { status: 403 }
      );
    }
  }

  try {
    const { personaId } = await context.params;

    // In production, also verify ownership (unless admin already passed)
    if (!isDev) {
      const ownership = await verifyPersonaOwnership(request, personaId);
      if (!ownership.authorized) {
        return NextResponse.json({ error: ownership.error }, { status: ownership.status });
      }
    }

    const persona = await getPersona(personaId);

    if (!persona) {
      return NextResponse.json({ error: "Persona not found." }, { status: 404 });
    }

    return NextResponse.json({
      personaId: persona.id,
      personaName: persona.name,
      activeProcess: persona.mindState.activeProcess,
      currentProcessInstanceId: persona.mindState.currentProcessInstanceId,
      // Persona's inner life — private thoughts and emotional state
      internalState: persona.mindState.internalState,
      learningState: persona.mindState.learningState,
      liveSessionMetrics: persona.mindState.liveSessionMetrics,
      memoryClaims: persona.mindState.memoryClaims.slice(0, 12),
      recentChangedClaims: persona.mindState.recentChangedClaims.slice(0, 8),
      contradictedClaims: persona.mindState.memoryClaims
        .filter((claim) => claim.status === "contradicted" || claim.status === "stale")
        .slice(0, 8),
      claimSources: persona.mindState.claimSources.slice(0, 24),
      episodes: persona.mindState.episodes.slice(0, 12),
      lastRetrievalPack:
        persona.mindState.lastRetrievalPack ??
        buildMemoryRetrievalPack({
          persona,
        }),
      pendingInternalEvents: persona.mindState.pendingInternalEvents,
      pendingShadowTurns: persona.mindState.pendingShadowTurns,
      recentEvents: persona.mindState.recentEvents,
      traceHead: persona.mindState.traceHead,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load soul trace." },
      { status: 500 },
    );
  }
}
