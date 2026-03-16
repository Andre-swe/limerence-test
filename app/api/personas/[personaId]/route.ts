import { NextResponse } from "next/server";
import { verifyPersonaOwnership } from "@/lib/auth";
import { buildPersonaSettingsSnapshot, updatePersonaSettings } from "@/lib/persona-settings";
import { listMessages } from "@/lib/store";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Update persona settings (timezone, heartbeat policy). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;

    const ownership = await verifyPersonaOwnership(request, personaId);
    if (!ownership.authorized) {
      return NextResponse.json({ error: ownership.error }, { status: ownership.status });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const updatedPersona = await withUserStore(ownership.userId, () =>
      updatePersonaSettings(personaId, payload),
    );

    const messages = await withUserStore(ownership.userId, () =>
      listMessages(personaId),
    );

    return NextResponse.json({
      persona: buildPersonaSettingsSnapshot(updatedPersona, messages),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update persona settings.",
      },
      { status: 400 },
    );
  }
}
