import { NextResponse } from "next/server";
import { withPersonaRoute } from "@/lib/persona-route";
import { buildPersonaSettingsSnapshot, updatePersonaSettings } from "@/lib/persona-settings";
import { listMessages } from "@/lib/store";

export const runtime = "nodejs";

/** Update persona settings (timezone, heartbeat policy). */
export const PATCH = withPersonaRoute(async ({ request, params }) => {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const updatedPersona = await updatePersonaSettings(params.personaId, payload);

    const messages = await listMessages(params.personaId);

    return NextResponse.json({
      persona: buildPersonaSettingsSnapshot(updatedPersona, messages),
    });
  }, { errorMessage: "Unable to update persona settings." });
