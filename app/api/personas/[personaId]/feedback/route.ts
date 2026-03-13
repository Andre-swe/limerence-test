import { NextResponse } from "next/server";
import { addPersonaFeedback } from "@/lib/services";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  try {
    const { personaId } = await params;
    const payload = await request.json();
    const feedback = await addPersonaFeedback(personaId, payload);

    return NextResponse.json({
      feedback,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save feedback.",
      },
      { status: 400 },
    );
  }
}
