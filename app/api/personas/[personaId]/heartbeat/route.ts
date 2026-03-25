import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { runHeartbeat } from "@/lib/services";

export const runtime = "nodejs";

/** Triggers a single heartbeat cycle for a persona, returning the autonomous decision it produced. */
export const POST = withPersonaRoute(async ({ params }) => {
    const decision = await runHeartbeat(params.personaId);

    return NextResponse.json({
      decision,
    });
  }, { errorMessage: "Unable to run heartbeat." });
