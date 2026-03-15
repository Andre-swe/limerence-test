import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/auth";
import { createPersonaFromForm } from "@/lib/services";
import { withUserStore } from "@/lib/store-context";

export const runtime = "nodejs";

/** Creates a new persona from multipart form data and returns the new persona's id and status. */
export async function POST(request: Request) {
  try {
    const userId = getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized. Valid session required." },
        { status: 401 },
      );
    }

    const formData = await request.formData();
    const persona = await withUserStore(userId, () =>
      createPersonaFromForm(formData, userId)
    );

    return NextResponse.json({
      personaId: persona.id,
      status: persona.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create persona.",
      },
      { status: 400 },
    );
  }
}
