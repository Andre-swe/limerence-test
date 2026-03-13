import { NextResponse } from "next/server";
import { createPersonaFromForm } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const persona = await createPersonaFromForm(formData);

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
